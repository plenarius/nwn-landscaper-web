// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's engine (the engine's docs/DESIGN-web-demo.md, question 2): a Worker of the page's own, started by page.js. It
// answers the editor's requests one at a time, which the Service Worker (sw.js) passes it through the page; keeps the engine's
// data folder in OPFS (opfs.js); builds the texture library from the demo's pictures on the first visit; and makes an export's
// zip. One at a time in a browser: page.js holds the lock that keeps a second tab waiting.

import { Engine } from './engine.js';
import { Store } from './opfs.js';
import { zip } from './zip.js';

/** The engine's data folder under /work (HOME is /work): areas, the texture library, settings. */
const DATA = '.local/share/landscaper';
/** The file in the data folder that says which demo pack the texture library was built from (its pack.json's SHA-256). */
const PACK_STAMP = 'demo-pack.sha256';
const SITE = new URL('./', import.meta.url);

let engine = null;
let store = null;
let started = null;
let queue = Promise.resolve();

const say = text => self.postMessage({ kind: 'progress', text });
const log = text => self.postMessage({ kind: 'log', text: String(text) });

/** `blob` (a WebP) as PNG bytes: the engine reads PNG, TGA and DDS. */
async function png(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** The texture library from the demo pack, unless the data folder has it from the same pack: ms it took, 0 when kept. */
async function library(site) {
    const stamp = engine.get(`${DATA}/${PACK_STAMP}`);
    if (stamp && new TextDecoder().decode(stamp) === site.packSha256 && engine.dir(`${DATA}/textures`)) return 0;
    const t = performance.now();
    say('Preparing the textures (the first visit only)…');
    engine.remove(`${DATA}/textures`);
    const packUrl = new URL(site.pack, SITE);
    // biome-ignore lint/plugin: the demo's own pictures, not an engine request
    const pack = await (await fetch(packUrl)).json();
    await Promise.all(
        pack.textures.map(async t => {
            // biome-ignore lint/plugin: the demo's own pictures, not an engine request
            const res = await fetch(new URL(t.file, packUrl));
            if (!res.ok) throw new Error(`${t.file}: ${res.status}`);
            engine.put(`pictures/${t.id}.png`, await png(await res.blob()));
        }),
    );
    const { code } = await engine.run(['textures', 'init', '--pictures', '/work/pictures']);
    engine.remove('pictures');
    if (code !== 0) throw new Error(`the texture library couldn't be built (exit ${code})`);
    engine.put(`${DATA}/${PACK_STAMP}`, new TextEncoder().encode(site.packSha256));
    return performance.now() - t;
}

/** Starts the engine: compiled, its data folder from OPFS, the texture library ready. What each step took, for the page. */
async function start(site) {
    const boot = {};
    let t = performance.now();
    say('Starting the engine…');
    const url = new URL(site.engine, SITE);
    let module;
    try {
        // biome-ignore lint/plugin: the engine's own file, not an engine request
        module = await WebAssembly.compileStreaming(fetch(url));
    } catch {
        // (A server that doesn't call it application/wasm.)
        // biome-ignore lint/plugin: the engine's own file, not an engine request
        module = await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
    }
    boot.engine = performance.now() - t;
    engine = new Engine(module, log);
    t = performance.now();
    try {
        store = await Store.open('landscaper');
        store.skip = path => path === 'exports' || path.startsWith('exports/');
        boot.loadedBytes = await store.load(engine.dir(DATA, true));
    } catch (err) {
        log(`no OPFS: ${err}`);
        store = null;
    }
    boot.storage = performance.now() - t;
    boot.textures = await library(site);
    t = performance.now();
    if (store) boot.written = await store.save(engine.dir(DATA, true));
    boot.save = performance.now() - t;
    boot.keeps = !!store;
    return boot;
}

/** Answers one request from the editor (`m`, as sw.js sends it), then writes what it changed to OPFS. */
async function answer(m) {
    const t = performance.now();
    const r = await engine.request(m.method, m.path, m.headers, m.body ? new Uint8Array(m.body) : new Uint8Array());
    const ran = performance.now() - t;
    const written = store ? await store.save(engine.dir(DATA, true)) : 0;
    log(`${m.method} ${m.path.slice(0, 80)} ${r.status} ${ran.toFixed(0)} ms${written ? `, ${written} file(s) kept` : ''}`);
    return r;
}

/** The export of area `name` into module file `module` (the report's path), as a zip: { name, blob }. */
async function exportZip(name, module) {
    const rel = module.replace(/^\/work\//, '');
    const mod = engine.get(rel);
    if (!mod) throw new Error(`the export's module (${module}) isn't there: export again`);
    const modName = rel.split('/').at(-1);
    const haks = [...(engine.dir('user/hak')?.contents ?? [])].filter(([n, f]) => n.endsWith('.hak') && f.data);
    const readme = [
        `${name}, exported by the NWN Landscaper in a browser.`,
        '',
        'Put the files of hak/ in the hak folder of your Neverwinter Nights user folder, and the module in its modules folder',
        '(Documents/Neverwinter Nights on Windows and macOS, ~/.local/share/Neverwinter Nights on Linux).',
        '',
        "This page has none of the game's files, so the tiles' shaders in this export are stand-ins: the area doesn't draw",
        'right in the game yet. Export it again from the Landscaper on your computer, or from this page once it can use your',
        'game folder.',
        '',
    ].join('\r\n');
    const t = performance.now();
    const blob = zip([
        [`modules/${modName}`, mod],
        ...haks.map(([n, f]) => [`hak/${n}`, f.data]),
        ['README.txt', new TextEncoder().encode(readme)],
    ]);
    log(`the export's zip: ${(blob.size / 2 ** 20).toFixed(1)} MB in ${(performance.now() - t).toFixed(0)} ms`);
    return { name: `${name}.zip`, blob };
}

self.onmessage = ev => {
    const m = ev.data;
    if (m.kind === 'start') {
        started ??= start(m.site);
        started.then(
            boot => self.postMessage({ kind: 'ready', boot }),
            err => self.postMessage({ kind: 'failed', error: String(err?.message ?? err) }),
        );
    } else if (m.kind === 'request') {
        const port = ev.ports[0];
        const run = queue.then(() => started).then(() => answer(m));
        queue = run.catch(() => {});
        run.then(
            r => {
                const body = r.body.slice();
                port.postMessage({ status: r.status, statusText: r.statusText, headers: r.headers, body: body.buffer }, [body.buffer]);
            },
            err => {
                log(`${m.method} ${m.path} failed: ${err?.stack ?? err}`);
                const body = new TextEncoder().encode(JSON.stringify({ error: `The engine in this page failed: ${err?.message ?? err}` }));
                port.postMessage(
                    { status: 500, statusText: 'engine failed', headers: [['Content-Type', 'application/json']], body: body.buffer },
                    [body.buffer],
                );
            },
        );
    } else if (m.kind === 'call') {
        const run = queue
            .then(() => started)
            .then(() => (m.what === 'export-zip' ? exportZip(...m.args) : Promise.reject(new Error(m.what))));
        queue = run.catch(() => {});
        run.then(
            value => self.postMessage({ kind: 'reply', id: m.id, value }),
            err => self.postMessage({ kind: 'reply', id: m.id, error: String(err?.message ?? err) }),
        );
    }
};
