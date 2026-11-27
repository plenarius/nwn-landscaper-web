// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The game's stock placeables, when the page has them in stock/ (the engine's `landscaper demo-stock`, which its
// scripts/try-page.sh puts there): each model's files go into the engine's `override` when a request first needs them, so
// stock trees and rocks draw, block paths and export as on the desktop. The tables and shaders the engine reads with them go
// in at the start, and the Place panel's lists are answered from the files the engine made with the game. Every file of stock/ is
// kept in Cache Storage under the bundle's SHA-256 (site.json's `stockSha256`, kept.js), so a repeat visit fetches none.

import { Kept } from './kept.js';

/** The answers that are files of stock/, made by the engine with the game: path -> file. */
const LISTS = { '/api/placeables': 'placeables.json', '/api/placeable-groups': 'placeable-groups.json' };

export class Stock {
    /** The stock placeables beside the page at `site` (a URL), kept by `hash` (site.json's `stockSha256`), or null when the page
     *  has none. */
    static async open(site, hash, log) {
        const base = new URL('stock/', site);
        const kept = await Kept.open('stock', hash, log);
        try {
            const res = await kept.get(new URL('index.json', base));
            return res.ok ? new Stock(base, kept, await res.json(), log) : null;
        } catch {
            return null;
        }
    }

    constructor(base, kept, index, log) {
        this.base = base;
        this.kept = kept;
        this.index = index;
        this.log = log;
        this.put = new Set(); // files already in the engine's override
    }

    get models() {
        return Object.keys(this.index.models).length;
    }

    /** Puts `files` (names in stock/res) in the engine's override, those not there yet. One that can't be fetched is left out:
     *  the engine then treats its model as one it doesn't have. */
    async give(engine, files) {
        await Promise.all(
            files
                .filter(f => !this.put.has(f))
                .map(async f => {
                    this.put.add(f);
                    try {
                        const res = await this.kept.get(new URL(`res/${encodeURIComponent(f)}`, this.base));
                        if (!res.ok) throw new Error(`${res.status}`);
                        engine.put(`user/override/${f}`, new Uint8Array(await res.arrayBuffer()));
                    } catch (err) {
                        this.put.delete(f);
                        this.log(`stock ${f}: ${err?.message ?? err}`);
                    }
                }),
        );
    }

    /** The tables and shaders, before the engine's first request. */
    start(engine) {
        return this.give(engine, this.index.start ?? []);
    }

    /** The files request `m` (as sw.js sends it) needs: a model's, a texture's, or the models an area's check or export reads. */
    filesFor(m) {
        const url = new URL(m.path, 'http://page');
        const name = decodeURIComponent(url.pathname.split('/').at(-1)).toLowerCase();
        const ofModels = models => [...new Set(models)].flatMap(model => this.index.models[model] ?? []);
        if (m.method === 'GET' && url.pathname.startsWith('/api/model/')) return ofModels([name]);
        if (m.method === 'GET' && url.pathname.startsWith('/api/texture/')) {
            const file = this.index.textures[name];
            return file ? [file] : [];
        }
        if (m.method === 'POST' && (url.pathname === '/api/check' || url.pathname === '/api/export') && m.body)
            return ofModels(objectsOf(url.searchParams, new Uint8Array(m.body)).map(o => String(o.model ?? '').toLowerCase()));
        return [];
    }

    /** The answer to `m` from stock/'s lists, or null when the engine answers it. */
    async answer(m) {
        const file = m.method === 'GET' && LISTS[new URL(m.path, 'http://page').pathname];
        if (!file) return null;
        const res = await this.kept.get(new URL(file, this.base));
        if (!res.ok) return null;
        return {
            status: 200,
            statusText: 'OK',
            headers: [['Content-Type', 'application/json']],
            body: new Uint8Array(await res.arrayBuffer()),
        };
    }
}

/** The placed objects of a check's or export's body: the heights (f32 a sample), the paint (a byte a sample), then JSON with
 *  `objects` (the engine's export_request reads it the same way). Empty when it has none. */
export function objectsOf(query, body) {
    const tiles = Number(query.get('tiles')),
        tilesY = Number(query.get('tilesY') ?? tiles),
        halo = Number(query.get('halo') ?? 0);
    const samples = (tiles * 16 + 1 + 2 * halo) * (tilesY * 16 + 1 + 2 * halo);
    let at = samples * 4;
    if (body.length - at >= samples) at += samples;
    if (!(samples > 0) || at >= body.length) return [];
    try {
        const extra = JSON.parse(new TextDecoder().decode(body.subarray(at)));
        return Array.isArray(extra?.objects) ? extra.objects : [];
    } catch {
        return [];
    }
}
