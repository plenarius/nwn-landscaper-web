// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's big files of one version (the engine, the stock placeables) kept in the browser's Cache Storage, named by that
// version's SHA-256 from try/site.json: a repeat visit reads them from there without asking the network, which GitHub Pages'
// ten-minute Cache-Control would otherwise make it do, and the browser's HTTP cache may drop them. A new version is a new
// cache; the caches of other versions are deleted.

const PREFIX = 'landscaper-';

/** The SHA-256 of `bytes`, in hex. */
export async function sha256(bytes) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

export class Kept {
    /** The cache of `kind`'s files at version `hash`, deleting `kind`'s others; without a hash or Cache Storage, the network
     *  only. `log` takes what went wrong. */
    static async open(kind, hash, log = () => {}) {
        const store = globalThis.caches;
        if (!store) return new Kept(null, log);
        const name = hash ? `${PREFIX}${kind}-${hash}` : null;
        try {
            const others = (await store.keys()).filter(n => n.startsWith(`${PREFIX}${kind}-`) && n !== name);
            for (const other of others) await store.delete(other);
            return new Kept(name ? await store.open(name) : null, log);
        } catch (err) {
            // (Some private windows have no Cache Storage.)
            log(`no cache for ${kind}: ${err?.message ?? err}`);
            return new Kept(null, log);
        }
    }

    constructor(cache, log) {
        this.cache = cache;
        this.log = log;
        // How many files came from the cache and from the network.
        this.hits = 0;
        this.fetched = 0;
    }

    /**
     * `url` from the cache, else from the network and kept. The network is asked to revalidate (`no-cache`): the HTTP cache may
     * still hold an older version's file for ten minutes. `check(bytes)`, when given, must pass for the file to be kept; a
     * file that fails it is still answered, the network's own, but asked for again next time.
     */
    async get(url, check) {
        const hit = this.cache && (await this.cache.match(url).catch(() => undefined));
        if (hit) {
            this.hits++;
            return hit;
        }
        this.fetched++;
        // biome-ignore lint/plugin: the page's own files, not an engine request
        const res = await fetch(url, this.cache ? { cache: 'no-cache' } : {});
        if (this.cache && res.ok) this.keep(url, res.clone(), check);
        return res;
    }

    /** Puts `res` (the file at `url`) in the cache, if it passes `check`. Not awaited: the answer doesn't wait for it. */
    async keep(url, res, check) {
        try {
            if (!check) return await this.cache.put(url, res);
            const bytes = await res.arrayBuffer();
            if (!(await check(bytes))) {
                this.log(`${url}: not the version site.json names, so not kept`);
                return;
            }
            const type = res.headers.get('Content-Type');
            await this.cache.put(url, new Response(bytes, { headers: type ? { 'Content-Type': type } : {} }));
        } catch (err) {
            this.log(`${url} not kept: ${err?.message ?? err}`);
        }
    }
}
