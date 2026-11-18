// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What the page's modules need of a browser, for the tests (`node --test`): the elements they write status into or build, this
// browser's storage, the page's address, and an engine answering fetch() (`engine` below). The modules that draw or ask
// (live.js, ask.js) are swapped for the stubs in `stubs/`, and a test can swap more with stub(). Import this file first, then
// the page's modules with import(): the swap applies only to modules loaded after it.

import { registerHooks } from 'node:module';

const STUBS = ['live.js', 'ask.js'];

/** Swaps the page's modules `names` (`things.js`) for the stubs of those names in `stubs/`, for the modules loaded after. */
export function stub(...names) {
    STUBS.push(...names);
}
registerHooks({
    resolve(specifier, context, next) {
        const found = next(specifier, context);
        const name = STUBS.find(s => found.url.endsWith(`/js/${s}`));
        return name ? { ...found, url: new URL(`./stubs/${name}`, import.meta.url).href } : found;
    },
});

/**
 * A page element: what the modules set on it is kept, to read back, and the elements appended to it are its `children`. A
 * `<fieldset>`'s `disabled` disables what is in it, as in a browser: see enabled().
 */
function element(id, tag = 'div') {
    return {
        id,
        tagName: tag.toUpperCase(),
        textContent: '',
        dataset: {},
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        children: [],
        hidden: false,
        disabled: false,
        onclick: null,
        addEventListener() {},
        appendChild(kid) {
            this.children.push(kid);
            return kid;
        },
        append(...kids) {
            for (const k of kids) if (typeof k === 'object') this.children.push(k);
        },
        showModal() {},
        close() {},
        focus() {},
    };
}
const elements = new Map();
globalThis.document = {
    getElementById: id => elements.get(id) ?? elements.set(id, element(id)).get(id),
    createElement: tag => element(null, tag),
    addEventListener() {},
    visibilityState: 'visible',
};

/** The controls under element `e` (inputs, text areas, selects and buttons) a builder could use: not disabled themselves,
 *  nor in a disabled `<fieldset>`. */
export function enabled(e, off = false) {
    const out = [];
    for (const k of e.children ?? []) {
        const offHere = off || (k.tagName === 'FIELDSET' && k.disabled);
        if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(k.tagName) && !offHere && !k.disabled) out.push(k);
        out.push(...enabled(k, offHere));
    }
    return out;
}
globalThis.addEventListener = () => {};
globalThis.location = new URL('http://landscaper.test/');

/** `localStorage`: its items are its own keys, as `Object.keys(localStorage)` lists them in a browser. */
class Storage {
    getItem(k) {
        return Object.hasOwn(this, k) ? this[k] : null;
    }
    setItem(k, v) {
        this[k] = String(v);
    }
    removeItem(k) {
        delete this[k];
    }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();

/** Empties this browser's storage. */
export function clearStorage() {
    for (const k of Object.keys(localStorage)) delete localStorage[k];
}

/** The status line's text. */
export const status = () => document.getElementById('statusMsg').textContent;

/**
 * The engine: its saved areas (`areas`, name to JSON text), each request it was sent (`log`: method, path and query), and
 * how it answers saves: `failSaves` answers 500, `saveDelay` (ms) holds each save that long. Saves are refused with 409 as
 * the engine refuses them: a new area over an existing one, an area whose `created` differs from the saved copy's, or a save
 * whose `base` isn't the saved copy's version (`version`, the copy's text here; `none` without one), unless `replace=1`.
 * `blueprints`: the answers to `/api/new-blueprint` (a builder's blueprint), by resref.
 */
export const engine = {
    areas: new Map(),
    saved: new Map(),
    blueprints: new Map(),
    log: [],
    failSaves: false,
    saveDelay: 0,
    version: name => (engine.areas.has(name) ? hash(engine.areas.get(name)) : 'none'),
    reset() {
        this.areas.clear();
        this.saved.clear();
        this.blueprints.clear();
        this.log = [];
        this.failSaves = false;
        this.saveDelay = 0;
    },
};
let clock = 1000;
/** A version of `text` (the engine hashes the saved bytes; any hash that differs when the text does will do here). */
const hash = text => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7).toString(16);
const answer = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The engine's answer to a request: fetch() in the tests. */
async function handle(url, opts = {}) {
    const u = new URL(url, location.href);
    const method = opts.method ?? 'GET';
    const name = u.searchParams.get('name');
    engine.log.push(`${method} ${u.pathname}${u.search}`);
    if (u.pathname === '/api/areas')
        return answer({ areas: [...engine.areas.keys()].map(n => ({ name: n, tiles: 3, module: n, saved: engine.saved.get(n) })) });
    if (u.pathname === '/api/area')
        return engine.areas.has(name)
            ? new Response(engine.areas.get(name), {
                  headers: { 'Content-Type': 'application/json', 'X-Landscaper-Version': engine.version(name) },
              })
            : answer({ error: 'no such area' }, 404);
    if (u.pathname === '/api/new-blueprint' && method === 'GET') {
        const bp = engine.blueprints.get(u.searchParams.get('resref'));
        return bp ? answer(bp) : answer({ error: 'no such blueprint' }, 404);
    }
    if (u.pathname === '/api/save') {
        const body = opts.body;
        if (engine.saveDelay) await new Promise(r => setTimeout(r, engine.saveDelay));
        if (engine.failSaves) return answer({ error: 'disk full' }, 500);
        const replace = u.searchParams.has('replace');
        const old = engine.areas.has(name) ? JSON.parse(engine.areas.get(name)).created : null;
        const created = JSON.parse(body).created;
        if (!replace && ((u.searchParams.has('new') && engine.areas.has(name)) || (old && created && old !== created)))
            return answer({ error: `there is already an area called ${name}`, exists: name }, 409);
        const base = u.searchParams.get('base');
        if (!replace && base && base !== engine.version(name))
            return answer(
                { error: `${name} was saved from another tab or computer`, exists: name, moved: true, saved: engine.saved.get(name) },
                409,
            );
        engine.areas.set(name, body);
        engine.saved.set(name, ++clock);
        return answer({ saved: clock, version: engine.version(name) });
    }
    return answer({ error: `no ${u.pathname} in the test engine` }, 404);
}
globalThis.fetch = handle;

/** A save of `area` from another tab or computer (`query` after `name=<its name>`, such as `&new=1&replace=1`). */
export const otherTab = (area, query = '') =>
    handle(`/api/save?name=${area.name}${query}`, { method: 'PUT', body: JSON.stringify(area.toJSON()) });
