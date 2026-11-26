// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Spike (wasm-demo): answers the editor's engine requests in the browser. `/api/...` and the texture library (`textures/...`)
// go to the engine compiled to WebAssembly (try/engine.js); everything else is the static site's.

import { Engine } from './try/engine.js';

const BASE = new URL('./', self.location).pathname;
// The demo's own ground textures (procedural, none of the game's), under the ids the editor uses by default.
const DEMO_TEXTURES = ['Grass/grassMedium', 'Earth/dirt', 'Rock/rock', 'Rock/rockCliff', 'Sand/sand'];
const STANDINS = ['creaturepal', 'doorpal', 'encounterpal', 'itempal', 'placeablepal', 'soundpal', 'storepal', 'triggerpal', 'waypointpal']
    .map(p => `${p}.itp`)
    .concat('environment.2da');
let ready = null;

/** Logs `msg` here and in the pages' consoles (a worker's console is hard to reach from a test). */
function log(msg) {
    console.log(msg);
    self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ engineLog: String(msg) })));
}
let queue = Promise.resolve();

/** The engine, started once: compiled, with the demo's own textures built into its library. */
function engine() {
    ready ??= (async () => {
        const t0 = performance.now();
        const bytes = await (await fetch(`${BASE}try/landscaper.wasm`)).arrayBuffer();
        const t1 = performance.now();
        const e = new Engine(await WebAssembly.compile(bytes), m => log(`[engine] ${m}`));
        const t2 = performance.now();
        for (const n of DEMO_TEXTURES) e.put(`tex/${n}.png`, new Uint8Array(await (await fetch(`${BASE}try/textures/${n}.png`)).arrayBuffer()));
        // Stand-ins for the game files an export reads (none of them the game's): empty palettes, one lighting scheme.
        for (const n of STANDINS) e.put(`user/override/${n}`, new Uint8Array(await (await fetch(`${BASE}try/standin/${n}`)).arrayBuffer()));
        await e.run(['textures', 'build', '/work/tex']);
        e.boot = { fetch: t1 - t0, compile: t2 - t1, textures: performance.now() - t2, bytes: bytes.byteLength };
        log(`[engine] ready ${JSON.stringify(e.boot)}`);
        return e;
    })();
    return ready;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil(self.clients.claim()));

self.addEventListener('fetch', ev => {
    const url = new URL(ev.request.url);
    if (url.origin !== self.location.origin) return;
    let path = null;
    if (url.pathname.startsWith('/api/')) path = url.pathname + url.search;
    else if (url.pathname.startsWith(`${BASE}textures/`)) path = `/${url.pathname.slice(BASE.length)}${url.search}`;
    if (url.pathname === `${BASE}try/engine-files`) {
        ev.respondWith(engine().then(e => Response.json({ boot: e.boot, files: e.list() })));
        return;
    }
    if (url.pathname.startsWith(`${BASE}try/file/`)) {
        const rel = decodeURIComponent(url.pathname.slice(`${BASE}try/file/`.length));
        ev.respondWith(engine().then(e => {
            const data = e.get(rel);
            return data ? new Response(data, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${rel.split('/').at(-1)}"` } }) : new Response('not found', { status: 404 });
        }));
        return;
    }
    if (!path) return;
    ev.respondWith((async () => {
      try {
        const body = ['GET', 'HEAD'].includes(ev.request.method) ? new Uint8Array() : new Uint8Array(await ev.request.arrayBuffer());
        const e = await engine();
        // One request at a time: they share the engine's files.
        const run = queue.then(() => e.request(ev.request.method, path, [...ev.request.headers], body));
        queue = run.catch(() => {});
        const t = performance.now();
        const r = await run;
        log(`[engine] ${ev.request.method} ${path.slice(0, 80)} ${r.status} ${(performance.now() - t).toFixed(0)} ms, memory ${(e.memory / 2 ** 20).toFixed(0)} MB`);
        const empty = r.status === 204 || r.status === 304 || ev.request.method === 'HEAD';
        return new Response(empty ? null : r.body, { status: r.status, statusText: r.statusText, headers: r.headers });
      } catch (err) {
        log(`[engine] ${ev.request.method} ${path.slice(0, 80)} failed: ${err?.stack ?? err}`);
        return Response.json({ error: `the in-browser engine failed: ${err}` }, { status: 500 });
      }
    })());
});
