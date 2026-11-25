// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The copies of areas kept in this browser when a save can't reach the engine (save.js): in IndexedDB, which holds far more
// than localStorage's 5 to 10 MB (a 64×64 area's copy is about 8.4 MB), else in localStorage as before, else only in this
// page. Each copy is `{ json, base, version }`: the area's JSON, when the engine had saved the copy it started from (Unix
// seconds, 0 when not known) and that copy's version (null when not known). They are read once (loadCopies) and kept in
// memory too, so reading one never waits; writing one goes to the browser's storage in the background, in order.

import { store } from './dom.js';

const DB = 'landscaper';
const STORE = 'copies';
// How long opening IndexedDB, or reading it, may take before the page goes on without it (a browser that never answers),
// and how long a write may take before it counts as failed: the page's start and its saves wait for them.
const OPEN_WAIT = 5000;
const WRITE_WAIT = 20000;

// The copies, by key (the area's name, `<user>:<name>` on a team server).
const copies = new Map();
// The database (IndexedDB), null where it can't be opened (blocked, private mode, no IndexedDB): then localStorage.
let opening = null;

// localStorage's keys of a copy, as the page kept them before IndexedDB.
const AREA = 'landscaper.area.';
const lsKey = (what, key) => `landscaper.${what}.${key}`;

/** Opens the database once; resolves with it, or null when it can't be opened. Never rejects. */
function database() {
    opening ??= new Promise(resolve => {
        const done = db => {
            clearTimeout(timer);
            resolve(db);
        };
        const timer = setTimeout(() => done(null), OPEN_WAIT);
        try {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE);
            req.onsuccess = () => done(req.result);
            req.onerror = () => done(null);
            req.onblocked = () => done(null);
        } catch {
            // (reading `indexedDB` throws with the site's data blocked)
            done(null);
        }
    });
    return opening;
}

/** Runs `f(store)` in one transaction of the copies' store; resolves with what the requests `f` returns answered (one, or a
 *  list of them), or rejects, also when it hasn't finished in its time (OPEN_WAIT, WRITE_WAIT). */
function inStore(db, mode, f) {
    return new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error("IndexedDB didn't answer")), mode === 'readwrite' ? WRITE_WAIT : OPEN_WAIT);
        const resolve = v => {
                clearTimeout(timer);
                done(v);
            },
            reject = err => {
                clearTimeout(timer);
                fail(err);
            };
        try {
            const tx = db.transaction(STORE, mode);
            const made = f(tx.objectStore(STORE)),
                reqs = Array.isArray(made) ? made : made ? [made] : [],
                results = [];
            reqs.forEach((r, n) => {
                r.onsuccess = () => {
                    results[n] = r.result;
                };
            });
            tx.oncomplete = () => resolve(Array.isArray(made) ? results : results[0]);
            tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
            // (a write is sent now, not when the page's task ends: the page may be going away. Not a read: Chromium 131
            // completed a read-only transaction told to commit before its requests had answered.)
            if (mode === 'readwrite') tx.commit?.();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Reads the copies kept in this browser into memory, moving any localStorage still holds (kept before IndexedDB) into
 * IndexedDB, once: a moved copy leaves localStorage only when IndexedDB has it. One IndexedDB already holds is left in
 * localStorage, not lost. Call it before reading them; again, it reads them afresh.
 */
export async function loadCopies() {
    copies.clear();
    // (opened afresh: the tests change the browser's storage between runs)
    opening?.then(db => db?.close());
    opening = null;
    const db = await database();
    const old = store
        .keys()
        .filter(k => k.startsWith(AREA))
        .map(k => k.slice(AREA.length));
    const fromLs = key => ({
        json: store.get(lsKey('area', key)),
        base: +(store.get(lsKey('base', key)) ?? 0),
        version: store.get(lsKey('version', key)),
    });
    if (!db) {
        for (const key of old) copies.set(key, fromLs(key));
        return;
    }
    try {
        // (in one transaction, so the keys and the values are of the same moment)
        const [keys, values] = await inStore(db, 'readonly', s => [s.getAllKeys(), s.getAll()]);
        for (let n = 0; n < keys.length; n++) copies.set(keys[n], values[n]);
    } catch (err) {
        console.warn("couldn't read the copies kept in this browser", err);
    }
    for (const key of old) {
        if (copies.has(key)) {
            console.warn(`${key}: IndexedDB has a copy already; the older one stays in localStorage`);
            continue;
        }
        const copy = fromLs(key);
        if (copy.json === null) continue;
        try {
            await inStore(db, 'readwrite', s => s.put(copy, key));
            copies.set(key, copy);
            for (const what of ['area', 'base', 'version']) store.remove(lsKey(what, key));
        } catch (err) {
            console.warn(`couldn't move ${key} into IndexedDB`, err);
            copies.set(key, copy);
        }
    }
}

/** The copy kept under `key` (`{ json, base, version }`), or null. */
export const copyOf = key => copies.get(key) ?? null;

/** The keys of the copies kept. */
export const copyKeys = () => [...copies.keys()];

/**
 * Keeps `copy` (`{ json, base, version }`) under `key`: at once in memory, then in the browser's storage. Resolves true once
 * stored, false when it doesn't fit or storage is off; the copy before it then comes back in memory, as the storage still
 * holds it.
 */
export async function keepCopy(key, copy) {
    const before = copies.get(key);
    copies.set(key, copy);
    const db = await database();
    let kept;
    if (db) {
        try {
            await inStore(db, 'readwrite', s => s.put(copy, key));
            kept = true;
        } catch (err) {
            console.warn(`couldn't keep ${key} in this browser`, err);
            kept = false;
        }
    } else {
        kept = store.set(lsKey('area', key), copy.json) && store.set(lsKey('base', key), String(copy.base));
        if (kept && copy.version) store.set(lsKey('version', key), copy.version);
    }
    // (a newer copy kept meanwhile stays)
    if (!kept && copies.get(key) === copy) {
        if (before) copies.set(key, before);
        else copies.delete(key);
    }
    return kept;
}

/** Drops the copy kept under `key`. Resolves when the storage has dropped it. */
export async function dropCopyOf(key) {
    copies.delete(key);
    const db = await database();
    if (db) {
        try {
            await inStore(db, 'readwrite', s => s.delete(key));
        } catch (err) {
            console.warn(`couldn't drop ${key} from this browser`, err);
        }
    }
    // (and what localStorage held of it, before IndexedDB or without it)
    for (const what of ['area', 'base', 'version']) store.remove(lsKey(what, key));
}
