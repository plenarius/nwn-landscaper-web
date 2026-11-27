// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The three game files an export's tile shaders are made from (the engine's docs/DESIGN-web-demo.md, question 5): `fslit`,
// `vslit` and `inc_lighting`, read from the visitor's own game folder. Only what finds them is read: the key's tables, then each
// one's entry and bytes in its archive (a few hundred KB of the 5.6 GB install). Nothing read is kept beyond the visit.

/** The shaders an export needs. */
export const SHADERS = ['fslit', 'vslit', 'inc_lighting'];

/** The game's resource type of a shader (`.shd`). */
const SHD = 2069;

const ascii = bytes => new TextDecoder('latin1').decode(bytes).replace(/\0.*$/s, '');

/** The bytes `from` to `to` of `file` (a Blob). */
async function slice(file, from, to) {
    return new DataView(await file.slice(from, to).arrayBuffer());
}

/** The game's keys, the first over the next, as the engine's resource manager reads them (Moonglow's `ResMan::for_game`). */
const KEYS = ['nwn_retail', 'nwn_base'];

/** Of `names`, the ones key file `key` (a Blob) has, read from their archives through `open`: { name: bytes }. */
async function fromKey(key, names, open, inData) {
    const head = await slice(key, 0, 64);
    if (ascii(new Uint8Array(head.buffer, 0, 8)) !== 'KEY V1  ') throw new Error("the game's key file is not one this page reads");
    const [bifs, keys, fileTable, keyTable] = [8, 12, 16, 20].map(at => head.getUint32(at, true));
    const table = await slice(key, keyTable, keyTable + 22 * keys);
    const found = new Map();
    for (let i = 0; i < keys; i++) {
        const at = 22 * i;
        if (table.getUint16(at + 16, true) !== SHD) continue;
        const name = ascii(new Uint8Array(table.buffer, at, 16)).toLowerCase();
        if (names.includes(name)) found.set(name, table.getUint32(at + 18, true));
    }
    const files = await slice(key, fileTable, fileTable + 12 * bifs);
    const out = {};
    for (const [name, id] of found) {
        const bif = id >>> 20;
        const entry = files.getUint32(12 * bif + 4, true);
        const length = files.getUint16(12 * bif + 8, true);
        const path = ascii(new Uint8Array(await key.slice(entry, entry + length).arrayBuffer())).replaceAll('\\', '/');
        const file = await open(inData ? path.replace(/^data\//i, '') : path);
        if (!file) throw new Error(`${path} is missing from the game's folder`);
        const bh = await slice(file, 0, 20);
        if (ascii(new Uint8Array(bh.buffer, 0, 8)) !== 'BIFFV1  ') throw new Error(`${path} is not an archive this page reads`);
        const row = bh.getUint32(16, true) + 16 * (id & 0xfffff);
        const entryRow = await slice(file, row, row + 16);
        const offset = entryRow.getUint32(4, true);
        out[name] = new Uint8Array(await file.slice(offset, offset + entryRow.getUint32(8, true)).arrayBuffer());
    }
    return out;
}

/**
 * The shaders from a game folder, as { name: bytes }. `open(path)` gives the file at `path` in the folder the visitor picked (a
 * File, or null when it isn't there), `/` between folders. The folder may be the game's own (with `data/nwn_base.key`) or its
 * `data` folder. Throws, saying what is missing, when it is not the game's folder.
 */
export async function readShaders(open) {
    let inData = false;
    if (!(await open('data/nwn_base.key'))) {
        if (!(await open('nwn_base.key')))
            throw new Error(
                "that folder isn't the game's: it has no data/nwn_base.key. Choose the folder Neverwinter Nights is installed in, the one with data and lang in it (not the user folder in Documents).",
            );
        inData = true;
    }
    const out = {};
    for (const k of KEYS) {
        const key = await open(`${inData ? '' : 'data/'}${k}.key`);
        const left = SHADERS.filter(n => !(n in out));
        if (key && left.length) Object.assign(out, await fromKey(key, left, open, inData));
    }
    const missing = SHADERS.filter(n => !(n in out));
    if (missing.length) throw new Error(`the game's keys have no ${missing.join(', ')} (the dedicated server's download has no shaders)`);
    return out;
}

/** `open` for a folder picked with the folder picker (a FileSystemDirectoryHandle). */
export function openHandle(dir) {
    return async path => {
        try {
            let h = dir;
            const parts = path.split('/');
            for (const p of parts.slice(0, -1)) h = await h.getDirectoryHandle(p);
            return await (await h.getFileHandle(parts.at(-1))).getFile();
        } catch {
            return null;
        }
    };
}

/** `open` for a folder chosen in an upload field (`webkitdirectory`): its files, by their path below the folder chosen. */
export function openFiles(files) {
    const byPath = new Map();
    for (const f of files) byPath.set(f.webkitRelativePath.split('/').slice(1).join('/').toLowerCase(), f);
    return async path => byPath.get(path.toLowerCase()) ?? null;
}
