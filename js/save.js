// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Autosave (each change, a moment later, to the engine's disk, or this browser when that fails), areas left in this browser
// moved to disk at start or when opened, opening an area in turn with the saves, and Save a version (into the team's history).

import { Area } from './area.js';
import { api, engine, failure, json } from './api.js';
import { ask } from './ask.js';
import { $, store } from './dom.js';
import { checkSoon } from './live.js';

/** What app.js gives this file (initSave): `area()`, `me()`, `readOnly()`, and `open(name)`, which opens area `name` from
 *  the engine as Open does. */
let ctx = null;

let saveTimer = null;
// The area whose autosave is waiting for its timer (null when none is).
let pending = null;
// Saves go to the engine one at a time, in order (`saving` is the last one's promise): two at once could finish in either
// order, and the engine writes both through the same temporary file. `queued` maps each area with a save waiting its turn
// or under way to that save's promise; a save asked for while one is waiting is the same save, and sends the area as it is
// when its turn comes.
let saving = Promise.resolve();
const queued = new Map();
// The area whose save is on its way to the engine (null when none is).
let sending = null;
// When the engine last saved each area, as it says (Unix seconds): its answer to a save, and its list of areas. A copy kept in
// this browser records the one it was based on, so the next start can tell whether the engine's has changed since.
const engineSaved = new Map();
// The version of each area's working copy this page last read or saved, as the engine says (its `X-Landscaper-Version` on
// open, its answer to a save). Each save sends it as `base`, and the engine refuses one (409, `moved`) when the area was saved
// from another tab or computer since: two tabs on one area no longer save over each other. A copy kept in this browser keeps
// the version it was based on too (`landscaper.version.<name>`).
const engineVersion = new Map();
// The area (the object) each copy kept in this browser holds a state of, by name: kept by its failed save, or opened from the
// copy. Only a later save of that area replaces the copy; another area of the same name (the engine's, opened since) never
// drops it.
const keptFrom = new Map();
// Areas whose saves the engine refuses because another area of their name was made since (another tab or computer), and the
// builder kept the other: they are kept in this browser only, without asking at each change.
const refused = new WeakSet();

/** Autosave: the area to landscaper (areas/<name>.json on disk) a moment after each change. If that fails, into this browser
 *  until it works again, and the status line says so. The area is the one open now: when another area's save is still
 *  waiting (an area opened or made within the moment), that one is written first. */
export function saveSoon() {
    // Looking at someone else's workspace: nothing is saved (not into yours either).
    if (ctx.readOnly()) return;
    const a = ctx.area();
    if (pending && pending !== a) flushSave();
    clearTimeout(saveTimer);
    pending = a;
    saveTimer = setTimeout(flushSave, 800);
    checkSoon();
}

/**
 * The first save of a new area `a`: true once saved (on disk, or in this browser without an engine), false when the engine
 * refuses because an area of that name exists. `replace`: the builder agreed to replace it (sends `replace=1`).
 */
export async function saveNew(a, replace) {
    if (ctx.readOnly()) return true;
    try {
        await inTurn(() => writeArea(a, `&new=1${replace ? '&replace=1' : ''}`));
        return true;
    } catch (err) {
        if (err.status === 409) return false;
        throw err;
    }
}

/**
 * Area `name` from the engine, to open it. First its copy in this browser, if there is one, goes to the engine (or the builder
 * picks which to keep, see settleCopy), and the request waits for every save before it: its answer is never older than a save
 * this page has made (an area reopened while its last change is on its way). `settle` false leaves the copy as it is (the
 * builder chose to keep it and open the engine's, or re-imported the area).
 */
export async function loadArea(name, settle = true) {
    await flushSave();
    if (settle && browserCopy(name) && !ctx.readOnly()) await settleCopy(name, { saved: engineSaved.get(name) ?? 0 });
    const res = await inTurn(() => api(`/api/area?name=${encodeURIComponent(name)}`));
    if (!res.ok) throw new Error(await failure(res));
    const version = res.headers.get('X-Landscaper-Version');
    if (version) engineVersion.set(name, version);
    return Area.fromJSON(await res.json());
}

/** Area `name` from this user's copy in this browser (an area only there); a save of it then replaces the copy. */
export function openCopy(name) {
    const text = browserCopy(name);
    if (!text) throw new Error('this browser no longer has it');
    const a = Area.fromJSON(JSON.parse(text));
    keptFrom.set(name, a);
    // (its saves start from the engine's copy this one was based on, when the browser knows it)
    const version = store.get(key('version', name));
    if (version) engineVersion.set(name, version);
    return a;
}

/** Notes that area `name` is open, so the next start opens it (not while looking at someone else's workspace). */
export function noteOpen(name) {
    if (!ctx.readOnly()) store.set(currentKey(), name);
}

/** The area this user last had open in this browser (its name), or null. */
export const lastOpen = () => store.get(currentKey());

/** Whether area `a` has a change not yet answered by the engine: its save waiting for its moment, its turn, or the answer. */
export const unsaved = a => pending === a || sending === a || queued.has(a);

/** Writes the waiting autosave now instead of after its moment: before another area opens, and before the page reloads.
 *  Resolves when it is saved (or kept in this browser), after any save before it. */
export function flushSave() {
    clearTimeout(saveTimer);
    const a = pending;
    pending = null;
    if (a) saveArea(a);
    return saving;
}

/** Runs `f` (it returns a promise) after the saves before it; resolves or rejects as `f` does. */
function inTurn(f) {
    const p = saving.then(f);
    saving = p.catch(() => {});
    return p;
}

/** The page is going away (tab closed, reloaded by the browser, navigated) or hidden, which on a phone may be the last
 *  chance: an area whose save is waiting or not yet answered is kept in this browser at once, and the next start moves it
 *  to the engine (moveBrowserAreas). A request can't carry it: the browser lets a request outlive the page only up to
 *  64 KB, and an 8×8 area is about 110 KB. While the page stays (a hidden tab), the save also goes now. */
function leaving(e) {
    if (e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
    for (const a of new Set([pending, sending, ...queued.keys()])) if (a) keepInBrowser(a, JSON.stringify(a.toJSON()));
    if (e.type === 'visibilitychange') flushSave();
}

// An area's copy in this browser: `landscaper.area.<name>` (its JSON), `landscaper.base.<name>` (when the engine had saved
// the copy it started from, Unix seconds; 0 when not known) and `landscaper.version.<name>` (that copy's version, see
// engineVersion; none when not known). On a team server the name is `<user>:<name>`, so one builder's
// copy never goes into another's workspace on a shared browser.
const key = (what, name) => `landscaper.${what}.${ctx.me().team ? `${ctx.me().user}:` : ''}${name}`;

/** The key in this browser's storage of this user's `what` for `name` (`landscaper.<what>.<name>`, on a team server
 *  `landscaper.<what>.<user>:<name>`): what one builder keeps never shows for another on a shared browser. */
export const userKey = key;

// The area last open: `landscaper.current`, on a team server `landscaper.current.<user>`.
const currentKey = () => (ctx.me().team ? `landscaper.current.${ctx.me().user}` : 'landscaper.current');

/** This user's copy of area `name` kept in this browser (its JSON), or null. */
export const browserCopy = name => store.get(key('area', name));

/** The names of the areas this user has a copy of in this browser. */
export function browserCopies() {
    const prefix = key('area', '');
    return store
        .keys()
        .filter(k => k.startsWith(prefix) && !k.slice(prefix.length).includes(':'))
        .map(k => k.slice(prefix.length));
}

/** Notes when the engine saved the areas of its list (`/api/areas`'s `areas`). */
export function noteSaved(areas) {
    for (const a of areas) if (a.saved) engineSaved.set(a.name, a.saved);
}

/** Keeps area `a` (its JSON) in this browser; false when it doesn't fit (or storage is off). */
function keepInBrowser(a, json) {
    store.set(currentKey(), a.name);
    keptFrom.set(a.name, a);
    const base = engineSaved.get(a.name) ?? +(store.get(key('base', a.name)) ?? 0);
    const version = engineVersion.get(a.name) ?? store.get(key('version', a.name));
    if (version) store.set(key('version', a.name), version);
    return store.set(key('area', a.name), json) && store.set(key('base', a.name), String(base));
}

/** Drops the copy of area `name` kept in this browser (and the time stamp older pages kept with it). */
function dropCopy(name) {
    keptFrom.delete(name);
    store.remove(key('area', name));
    store.remove(key('base', name));
    store.remove(key('version', name));
    store.remove(`landscaper.saved.${name}`);
}

/** Saves area `a` in its turn (see `queued`). Never rejects: a failed save keeps it in this browser. */
function saveArea(a) {
    if (queued.has(a)) return queued.get(a);
    const p = inTurn(() => {
        // Taken from here on: a change made while it is on its way asks for another save.
        if (queued.get(a) === p) queued.delete(a);
        return writeArea(a);
    });
    queued.set(a, p);
    return p;
}

// `also`: more of the query (`&new=1` on a new area's first save). The engine's 409 on a new area's first save (an area of that
// name exists) is thrown: the area is not kept in this browser either, so it can't replace the other one later. On an
// autosave it means another area of that name was made since this one was opened (see replaced).
async function writeArea(a, also = '') {
    sending = a;
    const json = JSON.stringify(a.toJSON());
    const copy = browserCopy(a.name);
    try {
        if (refused.has(a)) throw Object.assign(new Error('another area of that name was made since'), { status: 409 });
        await putArea(a.name, json, also);
        store.set(currentKey(), a.name);
        // The copy kept here goes when this save holds it: it was kept from this area (unless the page kept a newer copy here
        // while this one was on its way), or it is the same. A copy of another area of that name stays (see settleCopy).
        if (browserCopy(a.name) === json || (keptFrom.get(a.name) === a && browserCopy(a.name) === copy)) dropCopy(a.name);
        if ($('statusMsg').dataset.saveFailed) {
            $('statusMsg').textContent = 'Saved.';
            delete $('statusMsg').dataset.saveFailed;
        }
    } catch (err) {
        if (err.status === 409 && also) throw err;
        if (err.status === 409) return replaced(a, json, err.moved);
        if (keepInBrowser(a, json))
            $('statusMsg').textContent = engine.up
                ? `Couldn't save ${a.name} to disk (${err.message}): kept in this browser for now.`
                : `Saved ${a.name} in this browser (no engine to save it to disk).`;
        else
            $('statusMsg').textContent =
                `Couldn't save ${a.name} anywhere (${err.message}): export it, or your latest changes may be lost.`;
        $('statusMsg').dataset.saveFailed = '1';
    } finally {
        sending = null;
    }
}

/**
 * The engine refused an autosave of `a` (409). Either its `created` differs from the saved copy's (another tab or computer made a
 * new area of that name since this one was opened), or `moved` (the engine's `{ moved, saved }`): the same area was saved from
 * another tab or computer since this tab opened or last saved it. `a` is kept in this browser, and the builder picks: replace
 * the engine's copy with this one, or open that one (this one stays in this browser, and the next start asks again). Closing
 * the question keeps `a` here without asking again at each change.
 */
async function replaced(a, json, moved) {
    const kept = keepInBrowser(a, json);
    if (refused.has(a)) return;
    const when = moved?.saved ? ` at ${new Date(moved.saved * 1000).toLocaleTimeString()}` : '';
    const keptNote = kept ? ' Your changes are kept in this browser for now.' : '';
    const then = kept ? ' (this one stays in this browser, and the next start asks again)' : ' (your changes here are then lost)';
    const answer = await ask(
        moved
            ? {
                  title: `${a.name} was saved elsewhere`,
                  text: `Another tab or computer saved ${a.name}${when}, after this tab opened it, so this tab no longer saves over it.${keptNote}\n\nKeep this tab's (it replaces that copy, which the engine keeps as ${a.name}.json.replaced-<time>), or open that one${then}.`,
                  ok: "Keep this tab's",
                  cancel: 'Open that one',
              }
            : {
                  title: `Another ${a.name}`,
                  text: `Another tab or computer made a new area called ${a.name} since you opened this one, so this one no longer saves over it.${keptNote}\n\nReplace that area with this one, or open that one${then}.`,
                  ok: 'Replace it with this one',
                  cancel: 'Open that one',
              },
    );
    if (answer === true) {
        try {
            await putArea(a.name, JSON.stringify(a.toJSON()), '&replace=1');
            if (keptFrom.get(a.name) === a) dropCopy(a.name);
            $('statusMsg').textContent = `Saved ${a.name} over the other one (the engine keeps that as ${a.name}.json.replaced-<time>).`;
            return;
        } catch (err) {
            $('statusMsg').textContent = `Couldn't save ${a.name}: ${err.message}`;
        }
    }
    refused.add(a);
    $('statusMsg').dataset.saveFailed = '1';
    const why = moved ? 'it was saved from another tab or computer since' : 'another area of that name was made since';
    $('statusMsg').textContent = kept
        ? `${a.name} is kept in this browser only: ${why}.`
        : `Couldn't keep ${a.name} anywhere: ${why}. Export it, or your changes may be lost.`;
    // (not awaited: opening waits for the saves before it, this one among them)
    if (answer === false) ctx.open(a.name);
}

/**
 * Sends area `name` (its JSON `text`) to the engine; throws when it isn't saved, with the answer's `status` and, for a 409
 * because the area was saved elsewhere since, `moved` (`{ saved }`, when, in Unix seconds). `also`: more of the query. `base`:
 * the version the area started from (engineVersion's, by default); not sent with a new area's first save, which the engine
 * checks by name.
 */
async function putArea(name, text, also = '', base = engineVersion.get(name)) {
    const since = base && !also.includes('new=1') ? `&base=${encodeURIComponent(base)}` : '';
    const res = await api(`/api/save?name=${encodeURIComponent(name)}${also}${since}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: text,
    });
    if (!res.ok) {
        const body = await json(res.clone());
        throw Object.assign(new Error(await failure(res)), { status: res.status, moved: body.moved ? { saved: body.saved } : undefined });
    }
    const answer = await json(res);
    if (answer.saved) engineSaved.set(name, answer.saved);
    if (answer.version) engineVersion.set(name, answer.version);
}

/** Areas kept in this browser (before landscaper saved to disk, or when a save failed) go to landscaper, then leave the
 *  browser. A copy goes without asking when the engine's is the one it started from (or there is none); when the engine's
 *  has been saved since (another tab, another computer), or the copy doesn't say what it started from, the builder picks.
 *  The engine's own times are compared, never this browser's clock. */
export async function moveBrowserAreas() {
    let list = [];
    try {
        const res = await api('/api/areas');
        if (!res.ok) return; // (no engine: they stay in the browser until there is one)
        list = (await res.json()).areas ?? [];
    } catch {
        return;
    }
    noteSaved(list);
    let moved = 0;
    for (const name of browserCopies())
        if (
            await settleCopy(
                name,
                list.find(a => a.name === name),
            )
        )
            moved++;
    if (moved) $('statusMsg').textContent = `Moved ${moved} area${moved > 1 ? 's' : ''} from this browser to landscaper's folder.`;
}

/**
 * This browser's copy of area `name` goes to the engine, or the builder picks; true when it went. `there`: the engine's entry
 * for the area (its `saved`), undefined when the engine has none. The copy goes without asking when the engine's is the one it
 * started from (or there is none); the same as the engine's, it is dropped; otherwise (the engine's saved since, from another
 * tab or computer, or another area of that name made since) the builder picks, and closing the question leaves it here for
 * the next start.
 */
async function settleCopy(name, there) {
    const base = +(store.get(key('base', name)) ?? 0);
    if (!there || (base > 0 && (there.saved ?? 0) <= base)) {
        try {
            // (With the version the copy started from, when it knows it: a save since from elsewhere is then asked about,
            // even within the same second.)
            await inTurn(() => putArea(name, browserCopy(name), '', store.get(key('version', name)) ?? engineVersion.get(name)));
            dropCopy(name);
            return true;
        } catch (err) {
            // (refused as another area of that name: asked below)
            if (err.status !== 409) {
                console.warn(`couldn't move ${name} to disk`, err);
                return false;
            }
        }
    }
    // The same area as the engine's (its save got there, but the page closed before hearing so): nothing to move or ask.
    if (await sameAsEngine(name)) {
        dropCopy(name);
        return false;
    }
    const answer = await ask({
        title: `Two copies of ${name}`,
        text: `This browser kept a copy of ${name} that never reached the engine. The engine's copy was saved after it started (from another tab or computer), or this browser can't tell.\n\nUse this browser's copy (it replaces the engine's), or keep the engine's and drop this one. Close this to decide at the next start.`,
        ok: "Use this browser's",
        cancel: "Keep the engine's",
    });
    if (answer === null) return false;
    try {
        // (the builder agreed to replace it, whichever area it is)
        if (answer) await inTurn(() => putArea(name, browserCopy(name), '&replace=1'));
        dropCopy(name);
        return answer;
    } catch (err) {
        console.warn(`couldn't move ${name} to disk`, err);
        return false;
    }
}

/** Whether this browser's copy of area `name` holds the same as the engine's (compared as data: key order aside). */
async function sameAsEngine(name) {
    try {
        const res = await api(`/api/area?name=${encodeURIComponent(name)}`);
        return res.ok && canonical(await res.json()) === canonical(JSON.parse(browserCopy(name)));
    } catch {
        return false;
    }
}

/** `v` as JSON with every object's keys sorted, so two copies compare equal whatever order their keys were written in. */
function canonical(v) {
    return JSON.stringify(v, (_, x) =>
        x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
    );
}

/** Sets up the Save a version button, and keeping a waiting autosave when the page goes away. */
export function initSave(c) {
    ctx = c;
    addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', leaving);
    // Keeps this version of the area in the team's history (a commit in the team server's history repository).
    $('btnVersion').onclick = async () => {
        if (ctx.readOnly() || !ctx.area()) return;
        const note = await ask({
            title: `Save a version of ${ctx.area().name}`,
            text: "Keeps this copy in the team's history. Autosave never does.",
            ok: 'Save version',
            input: { label: 'A short note (optional)', placeholder: 'what changed' },
        });
        if (note === null) return;
        const btn = $('btnVersion');
        btn.disabled = true;
        $('statusMsg').textContent = `Saving a version of ${ctx.area().name}…`;
        try {
            clearTimeout(saveTimer);
            pending = null;
            const a = ctx.area();
            await inTurn(() => putArea(a.name, JSON.stringify(a.toJSON())));
            const res = await api(`/api/version?name=${encodeURIComponent(ctx.area().name)}&note=${encodeURIComponent(note)}`, {
                method: 'POST',
            });
            if (!res.ok) throw new Error(await failure(res));
            const body = await json(res);
            $('statusMsg').textContent = `Saved a version of ${ctx.area().name} (${String(body.commit).slice(0, 7)}).`;
        } catch (err) {
            $('statusMsg').textContent = `Couldn't save a version: ${err.message}`;
        } finally {
            btn.disabled = ctx.readOnly();
        }
    };
}
