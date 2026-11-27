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
