// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Spike (wasm-demo): the Landscaper engine compiled to WASI (wasm32-wasip1), run in the browser on in-memory files. Each API
// request runs the engine once (`landscaper wasi-request`): the request on its stdin, the HTTP answer on its stdout. Its files
// (the workspace, the texture library, exports) stay in `work` between requests. Works in a Service Worker and in Node.

import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory } from './shim/index.js';

const enc = new TextEncoder();
const u32 = (...v) => new Uint8Array(new Uint32Array(v).buffer);
const cat = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};

/** A stand-in for a game install with none of the game's files: an empty key and an empty talk table. */
function emptyInstall() {
    const key = cat(enc.encode('KEY V1  '), u32(0, 0, 64, 64, 126, 1), new Uint8Array(32));
    const tlk = cat(enc.encode('TLK V3.0'), u32(0, 0, 20));
    const dir = entries => new Directory(new Map(entries));
    return [
        ['data', dir([['nwn_base.key', new File(key)]])],
        ['lang', dir([['en', dir([['data', dir([['dialog.tlk', new File(tlk)]])]])]])],
    ];
}

export class Engine {
    /** `module` is the compiled landscaper.wasm. */
    constructor(module, log = console.warn) {
        this.module = module;
        this.log = log;
        this.work = new PreopenDirectory('/work', new Map([['user', new Directory(new Map())]]));
        this.game = new PreopenDirectory('/game', new Map(emptyInstall()));
        this.web = new PreopenDirectory('/web', new Map());
    }

    /** Runs the engine once with `args`, `stdin` (bytes) on its stdin: its exit code and stdout. */
    async run(args, stdin = new Uint8Array()) {
        const out = new File(new Uint8Array());
        const env = ['HOME=/work', 'NWN_ROOT=/game', 'NWN_HOME=/work/user', 'LANDSCAPER_JOBS=1'];
        const fds = [new OpenFile(new File(stdin)), new OpenFile(out), ConsoleStdout.lineBuffered(this.log), this.work, this.game, this.web];
        const wasi = new WASI(['landscaper', ...args], env, fds, { debug: false });
        const inst = await WebAssembly.instantiate(this.module, { wasi_snapshot_preview1: wasi.wasiImport });
        let code;
        try {
            code = wasi.start(inst);
            this.memory = inst.exports.memory.buffer.byteLength;
        } catch (e) {
            this.log(`engine stopped: ${e}`);
            code = 101;
        }
        return { code, out: out.data };
    }

    /** One API request: a Response-like `{ status, statusText, headers, body }`. */
    async request(method, path, headers, body = new Uint8Array()) {
        const head = [`${method} ${path} HTTP/1.1`, 'Host: localhost', `Content-Length: ${body.length}`];
        for (const [k, v] of headers) if (!/^(host|origin|referer|cookie|content-length|sec-fetch-.*)$/i.test(k)) head.push(`${k}: ${v}`);
        const run = await this.run(['wasi-request'], cat(enc.encode(`${head.join('\r\n')}\r\n\r\n`), body));
        const { code } = run;
        // (What the engine printed while answering comes before the answer: logged.)
        const text = new TextDecoder('latin1').decode(run.out);
        const at = text.search(/(^|\n)HTTP\/1\.0 \d{3}/);
        const start = at <= 0 ? 0 : at + 1;
        if (start > 0) for (const line of text.slice(0, start).trimEnd().split('\n')) this.log(line);
        const out = run.out.subarray(start);
        const split = out.findIndex((_, i) => out[i] === 13 && out[i + 1] === 10 && out[i + 2] === 13 && out[i + 3] === 10);
        if (code !== 0 || split < 0) return { status: 500, statusText: 'engine failed', headers: [['Content-Type', 'application/json']], body: enc.encode(JSON.stringify({ error: `the engine stopped (exit ${code})` })) };
        const lines = new TextDecoder().decode(out.subarray(0, split)).split('\r\n');
        const [, status, ...reason] = lines[0].split(' ');
        const hs = lines.slice(1).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]).filter(([k]) => !/^(server|date|connection|transfer-encoding)$/i.test(k));
        return { status: Number(status), statusText: reason.join(' '), headers: hs, body: out.subarray(split + 4) };
    }

    /** Puts `bytes` at `path` (under /work), making its folders. */
    put(path, bytes) {
        const parts = path.split('/').filter(Boolean);
        let dir = this.work.dir;
        for (const p of parts.slice(0, -1)) {
            if (!dir.contents.has(p)) dir.contents.set(p, new Directory(new Map()));
            dir = dir.contents.get(p);
        }
        dir.contents.set(parts.at(-1), new File(bytes));
    }

    /** The file at `path` under /work, or null. */
    get(path) {
        let node = this.work.dir;
        for (const p of path.split('/').filter(Boolean)) node = node?.contents?.get(p);
        return node instanceof File ? node.data : null;
    }

    /** Every file under /work: [path, size]. */
    list(dir = this.work.dir, at = '') {
        return [...dir.contents].flatMap(([n, v]) => (v instanceof Directory ? this.list(v, `${at}/${n}`) : [[`${at}/${n}`, v.data.length]]));
    }
}
