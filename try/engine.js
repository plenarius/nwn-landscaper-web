// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Landscaper engine built for WASI (the engine's docs/DESIGN-web-demo.md), run on files in memory by browser_wasi_shim.
// Each API request runs the engine once (`landscaper wasi-request`), the request and the answer in files of their own; its
// files (the data folder, the texture library, exports) stay in `work` between runs. Runs in the page's Worker and in Node.

import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory } from '../vendor/browser_wasi_shim/index.js';
import { standIns } from './standins.js';

const enc = new TextEncoder();

/** Headers the engine is not given: the page's own, which its gate would read as another site's. */
const DROPPED = /^(host|origin|referer|cookie|content-length|sec-fetch-.*|x-forwarded-.*)$/i;

/** Headers of the engine's answer that are the server's, not the route's. */
const SERVERS = /^(server|date|connection|transfer-encoding)$/i;

// Files written since they were last saved (opfs.js): marked by every write, truncation or resize, whichever open file did it.
for (const m of ['fd_write', 'fd_pwrite', 'fd_allocate', 'fd_filestat_set_size']) {
    const plain = OpenFile.prototype[m];
    OpenFile.prototype[m] = function (...args) {
        this.file.changed = true;
        return plain.apply(this, args);
    };
}
const openPlain = File.prototype.path_open;
File.prototype.path_open = function (oflags, ...rest) {
    if (oflags & 8) this.changed = true; // (OFLAGS_TRUNC)
    return openPlain.call(this, oflags, ...rest);
};

/** The folder at `parts` under `dir`, made when `make`; null when it isn't there. */
function folder(dir, parts, make) {
    for (const p of parts) {
        let next = dir.contents.get(p);
        if (!next && make) {
            next = new Directory(new Map());
            dir.contents.set(p, next);
        }
        if (!(next instanceof Directory)) return null;
        dir = next;
    }
    return dir;
}

const split = path => path.split('/').filter(Boolean);

export class Engine {
    /** `module` is the compiled landscaper.wasm; `log` takes what the engine prints. */
    constructor(module, log = console.warn) {
        this.module = module;
        this.log = log;
        this.work = new PreopenDirectory('/work', new Map());
        this.game = new PreopenDirectory('/game', standIns.install());
        this.web = new PreopenDirectory('/web', new Map());
        for (const [name, bytes] of standIns.override()) this.put(`user/override/${name}`, bytes);
        this.memory = 0;
    }

    /** Runs the engine once with `args`: its exit code. `io` (name to bytes) are the files of `/io`, read back after. */
    async run(args, io = new Map()) {
        const files = new Map([...io].map(([n, b]) => [n, new File(b)]));
        // (LS_MINIMAP: an export's minimaps from the terrain, not drawn from above, which reads the area's hak back whole: a
        // 16 by 16 area's 600 MB ran the engine out of memory.)
        const env = [
            'HOME=/work',
            'NWN_ROOT=/game',
            'NWN_HOME=/work/user',
            'LANDSCAPER_JOBS=1',
            'LANDSCAPER_GAME=none',
            'LS_MINIMAP=terrain',
            // (An export's progress, a line each tile: the page's progress bar, as the engine answers nothing until it is done.)
            'LS_PROGRESS=1',
        ];
        const fds = [
            new OpenFile(new File(new Uint8Array())),
            ConsoleStdout.lineBuffered(this.log),
            ConsoleStdout.lineBuffered(this.log),
            this.work,
            this.game,
            this.web,
            new PreopenDirectory('/io', files),
        ];
        let outOfMemory = false;
        const said = line => {
            if (/memory allocation of \d+ bytes failed/.test(line)) outOfMemory = true;
            this.log(line);
        };
        fds[1] = ConsoleStdout.lineBuffered(said);
        fds[2] = ConsoleStdout.lineBuffered(said);
        const wasi = new WASI(['landscaper', ...args], env, fds, { debug: false });
        let inst;
        let code;
        try {
            inst = await WebAssembly.instantiate(this.module, { wasi_snapshot_preview1: wasi.wasiImport });
            code = wasi.start(inst);
        } catch (e) {
            // (A trap: a panic that aborts, or memory that can't grow, which Rust says before it aborts.)
            this.log(`the engine stopped: ${e}`);
            code = outOfMemory || e instanceof RangeError ? 'memory' : 101;
        }
        if (inst) this.memory = Math.max(this.memory, inst.exports.memory.buffer.byteLength);
        const out = wasi.fds[6]?.dir?.contents ?? new Map();
        return { code, files: new Map([...out].map(([n, f]) => [n, f.data])) };
    }

    /** One API request: `{ status, statusText, headers, body }`, as a Response takes them. */
    async request(method, path, headers, body = new Uint8Array()) {
        const head = [`${method} ${path} HTTP/1.1`, 'Host: localhost', `Content-Length: ${body.length}`];
        for (const [k, v] of headers) if (!DROPPED.test(k)) head.push(`${k}: ${v}`);
        const req = new Uint8Array(enc.encode(`${head.join('\r\n')}\r\n\r\n`).length + body.length);
        req.set(enc.encode(`${head.join('\r\n')}\r\n\r\n`));
        req.set(body, req.length - body.length);
        const { code, files } = await this.run(['wasi-request', '/io/request', '/io/answer'], new Map([['request', req]]));
        const out = files.get('answer');
        const at = out ? out.findIndex((_, i) => out[i] === 13 && out[i + 1] === 10 && out[i + 2] === 13 && out[i + 3] === 10) : -1;
        if (code !== 0 || at < 0) {
            const error =
                code === 'memory'
                    ? 'This area is too big for this browser: it ran out of memory. A smaller area works, or the Landscaper on your computer.'
                    : `The engine in this page stopped (exit ${code}).`;
            return {
                status: 500,
                statusText: 'engine failed',
                headers: [['Content-Type', 'application/json']],
                body: enc.encode(JSON.stringify({ error })),
            };
        }
        const lines = new TextDecoder().decode(out.subarray(0, at)).split('\r\n');
        const [, status, ...reason] = lines[0].split(' ');
        const hs = lines
            .slice(1)
            .map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()])
            .filter(([k]) => !SERVERS.test(k));
        return { status: Number(status), statusText: reason.join(' '), headers: hs, body: out.subarray(at + 4) };
    }

    /** Puts `bytes` at `path` (under /work), making its folders. */
    put(path, bytes) {
        const parts = split(path);
        folder(this.work.dir, parts.slice(0, -1), true).contents.set(parts.at(-1), new File(bytes));
    }

    /** The file at `path` under /work (its bytes), or null. */
    get(path) {
        const parts = split(path);
        const node = folder(this.work.dir, parts.slice(0, -1), false)?.contents.get(parts.at(-1));
        return node instanceof File ? node.data : null;
    }

    /** The folder at `path` under /work (a shim Directory), made when `make`; else null when it isn't there. */
    dir(path, make = false) {
        return folder(this.work.dir, split(path), make);
    }

    /** Takes `path` (a file or a folder) out of /work. */
    remove(path) {
        const parts = split(path);
        folder(this.work.dir, parts.slice(0, -1), false)?.contents.delete(parts.at(-1));
    }
}

export { File, Directory };
