// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page in the browser (try/): the stand-ins it makes for the game's files, the export's zip, what the OPFS store writes
// after a request, and the names and links webdemo.js makes. The engine itself runs in a browser only (README, "In a browser").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { emptyPalette, environment, standIns } = await import('../try/standins.js');
const { zip, crc32 } = await import('../try/zip.js');
const { Store } = await import('../try/opfs.js');
const { File, Directory } = await import('../try/engine.js');
const { OpenFile } = await import('../vendor/browser_wasi_shim/index.js');
const { nameFromFile, sourceUrl } = await import('../js/webdemo.js');

test('an empty palette is a GFF of type ITP with one empty MAIN list', () => {
    const p = emptyPalette();
    assert.equal(p.length, 100);
    assert.equal(new TextDecoder().decode(p.subarray(0, 8)), 'ITP V3.2');
    const v = new DataView(p.buffer, p.byteOffset);
    assert.equal(v.getUint32(8, true), 56, 'the struct follows the header');
    assert.equal(new TextDecoder().decode(p.subarray(80, 84)), 'MAIN');
    assert.equal(v.getUint32(96, true), 0, 'the list holds nothing');
});

test("environment.2da has one row, as many values as columns, and the game's columns an export reads", () => {
    const lines = new TextDecoder().decode(environment()).trim().split('\n');
    assert.equal(lines[0], '2DA V2.0');
    const cols = lines[2].trim().split(/\s+/);
    const row = lines[3].trim().split(/\s+/);
    assert.equal(lines.length, 4);
    assert.equal(row.length, cols.length + 1, 'the row number, then a value a column');
    for (const c of ['LIGHT_AMB_RED', 'DARK_FOG_BLUE', 'MAIN1_COLOR1', 'SHADOW_ALPHA']) assert.ok(cols.includes(c), c);
});

test('the stand-in install has the key and talk table the engine looks for, and the override its ten files', () => {
    const install = standIns.install();
    assert.ok(install.get('data').contents.get('nwn_base.key') instanceof File);
    assert.ok(install.get('lang').contents.get('en').contents.get('data').contents.get('dialog.tlk') instanceof File);
    assert.deepEqual(
        standIns
            .override()
            .map(([n]) => n)
            .sort(),
        [
            ...['creature', 'door', 'encounter', 'item', 'placeable', 'sound', 'store', 'trigger', 'waypoint'].map(p => `${p}pal.itp`),
            'environment.2da',
        ].sort(),
    );
});

/** The entries of zip `bytes` from its central directory: { name, data } each, inflated, its CRC checked. */
function unzip(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset);
    const end = bytes.length - 22;
    assert.equal(v.getUint32(end, true), 0x06054b50);
    const count = v.getUint16(end + 10, true);
    let at = v.getUint32(end + 16, true);
    const out = [];
    for (let k = 0; k < count; k++) {
        const method = v.getUint16(at + 10, true);
        const crc = v.getUint32(at + 16, true);
        const size = v.getUint32(at + 20, true);
        const nameLen = v.getUint16(at + 28, true);
        const local = v.getUint32(at + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
        const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const body = bytes.subarray(start, start + size);
        const data = body;
        assert.equal(crc32(data), crc, name);
        out.push({ name, data, method });
        at += 46 + nameLen;
    }
    return out;
}

test('an export zip holds each file as it was, stored, with its CRC', async () => {
    const hak = new Uint8Array(50_000).map((_, i) => i % 13);
    const mod = new TextEncoder().encode('a module');
    const blob = zip([
        ['modules/hill.mod', mod],
        ['hak/hill.hak', hak],
    ]);
    assert.equal(blob.type, 'application/zip');
    const entries = unzip(new Uint8Array(await blob.arrayBuffer()));
    assert.deepEqual(
        entries.map(e => [e.name, e.method]),
        [
            ['modules/hill.mod', 0],
            ['hak/hill.hak', 0],
        ],
    );
    assert.deepEqual(entries[0].data, mod);
    assert.deepEqual(entries[1].data, hak);
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
});

/** A folder of OPFS, in memory: what Store calls on it. `files` holds what was written, by path. */
function fakeOpfs(files = new Map(), at = '') {
    const handle = {
        kind: 'directory',
        async getDirectoryHandle(name) {
            return fakeOpfs(files, `${at}${name}/`);
        },
        async getFileHandle(name) {
            const path = `${at}${name}`;
            return {
                kind: 'file',
                async createSyncAccessHandle() {
                    let data = files.get(path) ?? new Uint8Array();
                    return {
                        truncate: () => (data = new Uint8Array()),
                        write: bytes => (data = bytes.slice()),
                        flush: () => files.set(path, data),
                        close() {},
                    };
                },
                async getFile() {
                    return new Blob([files.get(path)]);
                },
            };
        },
        async removeEntry(name) {
            files.delete(`${at}${name}`);
        },
        async *entries() {
            const names = new Set([...files.keys()].filter(p => p.startsWith(at)).map(p => p.slice(at.length).split('/')[0]));
            for (const n of names) yield [n, files.has(`${at}${n}`) ? await handle.getFileHandle(n) : fakeOpfs(files, `${at}${n}/`)];
        },
    };
    return handle;
}

const text = s => new TextEncoder().encode(s);

test('after a request the store writes only what changed, and removes what is gone', async () => {
    const opfs = new Map([['areas/a.json', text('{"a":1}')]]);
    const store = new Store(fakeOpfs(opfs));
    store.skip = path => path.startsWith('exports');
    const dir = new Directory(new Map());
    assert.equal(await store.load(dir), 7);
    assert.equal(await store.save(dir), 0, 'nothing changed since the load');

    // The engine's save: a temporary file renamed over the old one (a new File at the same path), and a new area.
    const areas = dir.contents.get('areas');
    areas.contents.set('a.json', new File(text('{"a":2}')));
    areas.contents.set('b.json', new File(text('{"b":1}')));
    dir.contents.set('exports', new Directory(new Map([['big.hak', new File(new Uint8Array(10))]])));
    assert.equal(await store.save(dir), 2);
    assert.deepEqual([...opfs.keys()].sort(), ['areas/a.json', 'areas/b.json'], 'exports stay in memory');

    // A file written in place (the same File) is written again; a deleted one goes.
    const b = areas.contents.get('b.json');
    const fd = b.path_open(0, 0n, 0).fd_obj;
    assert.ok(fd instanceof OpenFile);
    fd.fd_write(text('{"b":2}'));
    areas.contents.delete('a.json');
    assert.equal(await store.save(dir), 1);
    assert.deepEqual([...opfs.keys()], ['areas/b.json']);
    assert.equal(new TextDecoder().decode(opfs.get('areas/b.json')), '{"b":2}');
});

test('a downloaded file without an area name gives one New area would take', () => {
    assert.equal(nameFromFile('My Hill (2).json'), 'my_hill_2');
    assert.equal(nameFromFile('.json'), 'area');
    assert.match(nameFromFile('a-very-long-name-indeed.json'), /^[a-z0-9_]{1,9}$/);
});

test("Help's source link names the release's tag, or the main branch between releases", () => {
    assert.equal(sourceUrl('0.7.0'), 'https://github.com/plenarius/nwn-landscaper/tree/v0.7.0');
    assert.equal(sourceUrl('0.7.0+dev'), 'https://github.com/plenarius/nwn-landscaper');
    assert.equal(sourceUrl(undefined), 'https://github.com/plenarius/nwn-landscaper');
});

const { readShaders, openFiles, SHADERS } = await import('../try/shaders.js');

/** A BIF V1 holding `res` ([bytes]) as variable resources 0, 1, ... */
function bif(res) {
    const tableAt = 20;
    const dataAt = tableAt + 16 * res.length;
    const size = res.reduce((n, r) => n + r.length, 0);
    const out = new Uint8Array(dataAt + size);
    const v = new DataView(out.buffer);
    out.set(new TextEncoder().encode('BIFFV1  '));
    v.setUint32(8, res.length, true);
    v.setUint32(16, tableAt, true);
    let at = dataAt;
    res.forEach((r, i) => {
        v.setUint32(tableAt + 16 * i, i, true);
        v.setUint32(tableAt + 16 * i + 4, at, true);
        v.setUint32(tableAt + 16 * i + 8, r.length, true);
        v.setUint32(tableAt + 16 * i + 12, 2069, true);
        out.set(r, at);
        at += r.length;
    });
    return out;
}

/** A KEY V1 naming archive `path` and, in it, `names` (resref, type) at resource indexes 0, 1, ... */
function key(path, names) {
    const fileAt = 64;
    const nameAt = fileAt + 12;
    const keyAt = nameAt + path.length + 1;
    const out = new Uint8Array(keyAt + 22 * names.length);
    const v = new DataView(out.buffer);
    out.set(new TextEncoder().encode('KEY V1  '));
    for (const [i, n] of [1, names.length, fileAt, keyAt].entries()) v.setUint32(8 + 4 * i, n, true);
    v.setUint32(fileAt + 4, nameAt, true);
    v.setUint16(fileAt + 8, path.length + 1, true);
    out.set(new TextEncoder().encode(path), nameAt);
    names.forEach(([resref, type], i) => {
        out.set(new TextEncoder().encode(resref), keyAt + 22 * i);
        v.setUint16(keyAt + 22 * i + 16, type, true);
        v.setUint32(keyAt + 22 * i + 18, i, true); // archive 0, resource i
    });
    return out;
}

/** A game folder of `files` (path to bytes) as the upload field gives it, under a folder `pick`. */
const folder = (files, pick = 'Neverwinter Nights') =>
    openFiles(Object.entries(files).map(([p, b]) => Object.assign(new Blob([b]), { webkitRelativePath: `${pick}/${p}` })));

const shd = s => new TextEncoder().encode(s);

test("the export's shaders come from the game's keys, nwn_retail's over nwn_base's, whichever folder was picked", async () => {
    const files = {
        'data/nwn_base.key': key('data\\base_shaders.bif', [
            ['fslit', 2069],
            ['vslit', 2069],
            ['inc_lighting', 2069],
            ['fslit', 2017], // (a 2DA of that name: not a shader)
        ]),
        'data/base_shaders.bif': bif([shd('fs base'), shd('vs base'), shd('lighting base'), shd('not a shader')]),
        'data/nwn_retail.key': key('data\\retail.bif', [['inc_lighting', 2069]]),
        'data/retail.bif': bif([shd('lighting retail')]),
    };
    const want = { fslit: 'fs base', vslit: 'vs base', inc_lighting: 'lighting retail' };
    const read = async open =>
        Object.fromEntries(Object.entries(await readShaders(open)).map(([k, v]) => [k, new TextDecoder().decode(v)]));
    assert.deepEqual(await read(folder(files)), want);
    // The data folder itself picked.
    const data = Object.fromEntries(Object.entries(files).map(([p, b]) => [p.replace('data/', ''), b]));
    assert.deepEqual(await read(folder(data, 'data')), want);
    assert.deepEqual(Object.keys(want).sort(), [...SHADERS].sort());
});

test("a folder that isn't the game's, or a game without shaders, says so", async () => {
    await assert.rejects(readShaders(folder({ 'modules/a.mod': shd('x') })), /isn't the game's/);
    const noShaders = { 'data/nwn_base.key': key('data\\a.bif', [['fslit', 2069]]), 'data/a.bif': bif([shd('fs')]) };
    await assert.rejects(readShaders(folder(noShaders)), /no vslit, inc_lighting/);
});

const { exportGb, bigAreaOk } = await import('../js/webdemo.js');
const { web } = await import('../js/web.js');

test('in the browser an area over 16 by 16 asks first; up to it, and on the desktop, never', async () => {
    assert.equal(exportGb(16, 16).toFixed(2), '0.39');
    assert.equal(exportGb(32, 32).toFixed(2), '1.17');
    assert.equal(await bigAreaOk(32, 32), true, 'not in the browser');
    web.on = true;
    try {
        assert.equal(await bigAreaOk(16, 16), true);
        assert.equal(await bigAreaOk(12, 16), true);
    } finally {
        web.on = false;
    }
});

const { AREA_ORIGINS, areaLink, freeName } = await import('../js/webdemo.js');

test("an ?area= link opens a file of the page's own site only", () => {
    const page = 'https://plenarius.github.io/nwn-landscaper/try/';
    const here = ['https://plenarius.github.io'];
    assert.equal(
        areaLink('?area=../assets/showcase/areas/lsvale.json', page, here)?.href,
        'https://plenarius.github.io/nwn-landscaper/assets/showcase/areas/lsvale.json',
    );
    assert.equal(areaLink('?area=/x/a.json', page, here)?.pathname, '/x/a.json');
    assert.equal(areaLink('?area=https://example.com/a.json', page, here), null, 'another site');
    assert.equal(areaLink('?area=//example.com/a.json', page, here), null, 'another site, no scheme');
    assert.equal(areaLink('?area=http://plenarius.github.io/a.json', page, here), null, 'another scheme');
    assert.equal(areaLink('?area=data:application/json,{}', page, here), null);
    assert.equal(areaLink('?area=', page, here), null);
    assert.equal(areaLink('?review=a/b', page, here), null);
    assert.equal(
        areaLink('?area=https://library.test/a/1.json', page, [...here, 'https://library.test'])?.host,
        'library.test',
        'an origin the list adds',
    );
    assert.deepEqual(AREA_ORIGINS, [location.origin], "by default, the page's own");
});

test('a free name for a copy keeps to 9 characters and skips names taken', () => {
    assert.equal(freeName('lsvale', new Set(['lsvale'])), 'lsvale2');
    assert.equal(freeName('lsvale', new Set(['lsvale', 'lsvale2', 'lsvale3'])), 'lsvale4');
    assert.equal(freeName('lsdescent', new Set(['lsdescent'])), 'lsdescen2');
    const taken = new Set(['lsdescent', ...Array.from({ length: 8 }, (_, k) => `lsdescen${k + 2}`)]);
    assert.equal(freeName('lsdescent', taken), 'lsdesce10');
});
