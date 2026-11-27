// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's engine (the engine's docs/DESIGN-web-demo.md, question 2): a Worker of the page's own, started by page.js. It
// answers the editor's requests one at a time, which the Service Worker (sw.js) passes it through the page; keeps the engine's
// data folder in OPFS (opfs.js); builds the texture library from the demo's pictures on the first visit; and makes an export's
// zip. One at a time in a browser: page.js holds the lock that keeps a second tab waiting.

import { Engine } from './engine.js';
import { Kept, sha256 } from './kept.js';
import { Store } from './opfs.js';
import { Stock } from './stock.js';
import { zip } from './zip.js';

/** The engine's data folder under /work (HOME is /work): areas, the texture library, settings. */
const DATA = '.local/share/landscaper';
/** The file in the data folder that says which demo pack the texture library was built from (its pack.json's SHA-256). */
const PACK_STAMP = 'demo-pack.sha256';
/** The file in the data folder that says which sky packs are installed (site.json's `skyPacks`, their SHA-256). */
const SKIES_STAMP = 'demo-skies.sha256';
const SITE = new URL('./', import.meta.url);

let engine = null;
let store = null;
let started = null;
let queue = Promise.resolve();
// Whether the engine has the game's shaders for an export: the page's stock ones, else the visitor's game folder's this visit
// (in the engine's override, in memory only).
let shaders = false;
// The game's stock placeables, when the page has them (stock.js).
let stock = null;

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

/** The sky packs beside the page (site.json's `skyPacks`: `[{ file, sha256 }]`), installed into the engine's sky library as
 *  `landscaper skies get` installs them, unless the data folder has them already: ms it took, 0 when kept. Needs the game's
 *  skyboxes.2da from the stock files, which decides their rows as on the desktop. A pack that fails is left out, said in the log. */
async function skies(site) {
    const packs = Array.isArray(site.skyPacks) ? site.skyPacks : [];
    if (!packs.length || !stock?.has('skyboxes.2da')) return 0;
    const want = packs.map(p => p.sha256).join(' ');
    const stamp = engine.get(`${DATA}/${SKIES_STAMP}`);
    if (stamp && new TextDecoder().decode(stamp) === want && engine.get(`${DATA}/skies/catalog.json`)) return 0;
    const t = performance.now();
    say('Preparing the skies (the first visit only)…');
    const kept = await Kept.open('skies', await sha256(new TextEncoder().encode(want)), log);
    let all = true;
    for (const p of packs) {
        const name = p.file.split('/').at(-1);
        try {
            const res = await kept.get(new URL(p.file, SITE), async bytes => (await sha256(bytes)) === p.sha256);
            if (!res.ok) throw new Error(`${res.status}`);
            engine.put(`skypacks/${name}`, new Uint8Array(await res.arrayBuffer()));
            const { code } = await engine.run(['skies', 'get', `/work/skypacks/${name}`]);
            if (code !== 0) throw new Error(`exit ${code}`);
        } catch (err) {
            all = false;
            log(`the sky pack ${name} couldn't be installed: ${err?.message ?? err}`);
        } finally {
            engine.remove('skypacks');
        }
    }
    if (all) engine.put(`${DATA}/${SKIES_STAMP}`, new TextEncoder().encode(want));
    return performance.now() - t;
}

/** Starts the engine: compiled, its data folder from OPFS, the texture library ready. What each step took, for the page. */
async function start(site) {
    const boot = {};
    let t = performance.now();
    say('Starting the engine…');
    const url = new URL(site.engine, SITE);
    // (Kept by its SHA-256, checked before it is kept; compiled from the stream either way, so Chrome keeps its code too.)
    const kept = await Kept.open('engine', site.engineSha256, log);
    const check = async bytes => (await sha256(bytes)) === site.engineSha256;
    let module;
    try {
        module = await WebAssembly.compileStreaming(kept.get(url, check));
    } catch {
        // (A server that doesn't call it application/wasm.)
        module = await WebAssembly.compile(await (await kept.get(url, check)).arrayBuffer());
    }
    boot.engineKept = kept.hits > 0;
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
    stock = await Stock.open(SITE, site.stockSha256, log);
    if (stock) {
        await stock.start(engine);
        shaders = true;
        boot.stock = { models: stock.models, shaders, kept: stock.kept.hits, fetched: stock.kept.fetched };
    }
    boot.stockStart = performance.now() - t;
    boot.skies = await skies(site);
    t = performance.now();
    if (store) boot.written = await store.save(engine.dir(DATA, true));
    boot.save = performance.now() - t;
    boot.keeps = !!store;
    return boot;
}

/** Answers one request from the editor (`m`, as sw.js sends it), then writes what it changed to OPFS. */
async function answer(m) {
    const t = performance.now();
    const listed = await stock?.answer(m);
    if (listed) return listed;
    if (stock) await stock.give(engine, stock.filesFor(m));
    const r = await engine.request(m.method, m.path, m.headers, m.body ? new Uint8Array(m.body) : new Uint8Array());
    // (With the stock placeables, Place and Scatter work without the visitor's game: nogame.js.)
    if (stock && m.method === 'GET' && m.path === '/api/me' && r.status === 200) {
        try {
            const me = JSON.parse(new TextDecoder().decode(r.body));
            r.body = new TextEncoder().encode(JSON.stringify({ ...me, stock: true }));
            r.headers = r.headers.filter(([k]) => k.toLowerCase() !== 'content-length');
        } catch {}
    }
    const ran = performance.now() - t;
    const written = store ? await store.save(engine.dir(DATA, true)) : 0;
    log(`${m.method} ${m.path.slice(0, 80)} ${r.status} ${ran.toFixed(0)} ms${written ? `, ${written} file(s) kept` : ''}`);
    return r;
}

/** The game's shaders (shaders.js: { name: bytes }) where the engine reads them before the game's own: the user folder's
 *  `override`, in memory. Not in OPFS: nothing of the game's is kept past the visit. */
function putShaders(files) {
    for (const [name, bytes] of Object.entries(files)) engine.put(`user/override/${name}.shd`, bytes);
    shaders = true;
    return true;
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
        ...(shaders
            ? []
            : [
                  "This export was made without your game folder, so the tiles' shaders in it are stand-ins: the area doesn't draw",
                  'right in the game. Export it again and choose your game folder when the page asks.',
                  '',
              ]),
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
            .then(() => {
                if (m.what === 'export-zip') return exportZip(...m.args);
                if (m.what === 'shaders') return putShaders(...m.args);
                throw new Error(`no call ${m.what}`);
            });
        queue = run.catch(() => {});
        run.then(
            value => self.postMessage({ kind: 'reply', id: m.id, value }),
            err => self.postMessage({ kind: 'reply', id: m.id, error: String(err?.message ?? err) }),
        );
    }
};
