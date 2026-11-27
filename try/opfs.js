// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The engine's data folder kept in the browser's own storage for this site (OPFS), so areas and the texture library last across
// visits. The engine works on files in memory (engine.js); this copies them in at the start and writes back what a request
// changed before its answer goes out. (OPFS can't make a file while the engine waits for it: a file is made only by an async
// call. So the engine's files are not OPFS files themselves.) Only from a Worker: writing uses OPFS's sync access handles.

import { Directory, File } from './engine.js';

/** Every file under shim folder `dir`: [path, File], paths relative to it. `skip(path)` leaves a file or folder out. */
function files(dir, skip, at = '') {
    const out = [];
    for (const [name, node] of dir.contents) {
        const path = at ? `${at}/${name}` : name;
        if (skip(path)) continue;
        if (node instanceof Directory) out.push(...files(node, skip, path));
        else if (node instanceof File) out.push([path, node]);
    }
    return out;
}

export class Store {
    /** The store in OPFS folder `name`; throws where the browser has no OPFS (a private window in some browsers). */
    static async open(name) {
        const root = await navigator.storage.getDirectory();
        return new Store(await root.getDirectoryHandle(name, { create: true }));
    }

    constructor(handle) {
        this.handle = handle;
        // What OPFS holds, as of the last load or save: path to the File in memory it was written from.
        this.saved = new Map();
        this.skip = () => false;
    }

    /** Copies every file in OPFS into shim folder `dir`; returns how many bytes. */
    async load(dir) {
        let bytes = 0;
        const walk = async (handle, into, at) => {
            for await (const [name, h] of handle.entries()) {
                const path = at ? `${at}/${name}` : name;
                if (h.kind === 'directory') {
                    let sub = into.contents.get(name);
                    if (!(sub instanceof Directory)) {
                        sub = new Directory(new Map());
                        into.contents.set(name, sub);
                    }
                    await walk(h, sub, path);
                } else {
                    const data = new Uint8Array(await (await h.getFile()).arrayBuffer());
                    const file = new File(data);
                    into.contents.set(name, file);
                    this.saved.set(path, file);
                    bytes += data.length;
                }
            }
        };
        await walk(this.handle, dir, '');
        return bytes;
    }

    /** The OPFS folder for `parts`, made when missing. */
    async folder(parts) {
        let h = this.handle;
        for (const p of parts) h = await h.getDirectoryHandle(p, { create: true });
        return h;
    }

    /** Writes to OPFS what changed in shim folder `dir` since the last save, and removes what is gone: how many files written. */
    async save(dir) {
        const now = files(dir, this.skip);
        const seen = new Set();
        let written = 0;
        for (const [path, file] of now) {
            seen.add(path);
            if (this.saved.get(path) === file && !file.changed) continue;
            const parts = path.split('/');
            const folder = await this.folder(parts.slice(0, -1));
            const handle = await (await folder.getFileHandle(parts.at(-1), { create: true })).createSyncAccessHandle();
            try {
                handle.truncate(0);
                handle.write(file.data, { at: 0 });
                handle.flush();
            } finally {
                handle.close();
            }
            file.changed = false;
            this.saved.set(path, file);
            written++;
        }
        for (const path of [...this.saved.keys()]) {
            if (seen.has(path)) continue;
            const parts = path.split('/');
            try {
                await (await this.folder(parts.slice(0, -1))).removeEntry(parts.at(-1));
            } catch {
                /* already gone */
            }
            this.saved.delete(path);
        }
        return written;
    }

    /** Removes everything in OPFS (Start over). */
    async clear() {
        for await (const name of this.handle.keys()) await this.handle.removeEntry(name, { recursive: true });
        this.saved.clear();
    }
}
