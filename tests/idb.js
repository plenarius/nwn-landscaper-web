// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The part of IndexedDB the page uses (copies.js), for the tests: databases of object stores in memory, transactions that
// answer a moment later and in order, and the ways a browser refuses (`idb` below).

/** How the test browser's IndexedDB behaves: `blocked` throws on reading `indexedDB` (the site's data blocked), `failOpen`
 *  answers opening with an error (some private modes), `quota` is the most bytes of JSON it holds before a write aborts
 *  with QuotaExceededError (null: no limit). `databases` holds what is stored, by database name. */
export const idb = { blocked: false, failOpen: false, quota: null, databases: new Map() };

/** Empties the test browser's IndexedDB and lets it work again. */
export function clearIdb() {
    idb.databases.clear();
    idb.blocked = false;
    idb.failOpen = false;
    idb.quota = null;
}

const later = f => setTimeout(f, 0);
const error = (name, message) => Object.assign(new Error(message), { name });
const size = db => [...db.stores.values()].reduce((n, s) => n + [...s.values()].reduce((m, v) => m + JSON.stringify(v).length, 0), 0);

class Transaction {
    constructor(db, mode) {
        this.db = db;
        this.mode = mode;
        this.requests = [];
        this.error = null;
        // (as a browser: the requests run after the task that made them, then complete or abort)
        later(() => this.run());
    }
    objectStore(name) {
        const s = this.db.stores.get(name);
        if (!s) throw error('NotFoundError', `no object store ${name}`);
        const ask = f => {
            const req = { result: undefined, onsuccess: null, onerror: null, f };
            this.requests.push(req);
            return req;
        };
        return {
            put: (value, key) =>
                ask(() => {
                    if (this.mode !== 'readwrite') throw error('ReadOnlyError', 'read-only transaction');
                    s.set(key, structuredClone(value));
                    if (idb.quota !== null && size(this.db) > idb.quota) throw error('QuotaExceededError', 'over the quota');
                    return key;
                }),
            delete: key =>
                ask(() => {
                    s.delete(key);
                }),
            get: key => ask(() => structuredClone(s.get(key))),
            getAll: () => ask(() => [...s.values()].map(v => structuredClone(v))),
            getAllKeys: () => ask(() => [...s.keys()]),
        };
    }
    commit() {
        // (as Chromium 131 did: a read-only transaction told to commit completes before its requests have answered)
        if (this.mode === 'readonly') this.early = true;
    }
    run() {
        if (this.early) {
            this.oncomplete?.();
            return;
        }
        const saved = new Map([...this.db.stores].map(([n, s]) => [n, new Map(s)]));
        for (const req of this.requests) {
            try {
                req.result = req.f();
                req.onsuccess?.();
            } catch (err) {
                // (a failed request aborts the transaction: nothing it wrote stays)
                this.db.stores = saved;
                this.error = err;
                req.onerror?.();
                this.onerror?.();
                this.onabort?.();
                return;
            }
        }
        this.oncomplete?.();
    }
}

const factory = {
    open(name, version) {
        const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        later(() => {
            if (idb.failOpen) {
                req.error = error('InvalidStateError', 'IndexedDB is off');
                req.onerror?.();
                return;
            }
            let db = idb.databases.get(name);
            const upgrade = !db || db.version < version;
            if (!db) {
                db = { name, version: 0, stores: new Map() };
                idb.databases.set(name, db);
            }
            req.result = {
                createObjectStore: store => db.stores.set(store, new Map()),
                transaction: (_names, mode = 'readonly') => new Transaction(db, mode),
                close() {},
            };
            if (upgrade) {
                db.version = version;
                req.onupgradeneeded?.();
            }
            req.onsuccess?.();
        });
        return req;
    },
};

Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get() {
        if (idb.blocked) throw error('SecurityError', 'the site may not keep data');
        return factory;
    },
});
