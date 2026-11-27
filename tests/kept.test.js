// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's big files kept in Cache Storage by version (try/kept.js): a repeat visit asks the network for none, a new version
// replaces the old one's cache, and the engine is kept only when its SHA-256 is site.json's.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { Kept, sha256 } = await import('../try/kept.js');

/** Cache Storage in memory: name -> Map of url -> [body bytes, Content-Type]. */
function fakeCaches() {
    const all = new Map();
    const cache = map => ({
        async match(url) {
            const kept = map.get(String(url));
            return kept && new Response(kept[0], { headers: kept[1] ? { 'Content-Type': kept[1] } : {} });
        },
        async put(url, res) {
            map.set(String(url), [new Uint8Array(await res.arrayBuffer()), res.headers.get('Content-Type')]);
        },
    });
    return {
        all,
        keys: async () => [...all.keys()],
        delete: async name => all.delete(name),
        open: async name => cache(all.get(name) ?? all.set(name, new Map()).get(name)),
    };
}

/** fetch() of `files` (url -> text), counting the requests and their `cache` option. */
function fakeFetch(files) {
    const asked = [];
    const f = async (url, opts = {}) => {
        asked.push([String(url), opts.cache]);
        const text = files[String(url)];
        return text === undefined
            ? new Response('', { status: 404 })
            : new Response(text, { headers: { 'Content-Type': 'application/wasm' } });
    };
    return { f, asked };
}

/** Cache Storage is `store` for test `t` (Node has none). */
function useCaches(t, store) {
    globalThis.caches = store;
    t.after(() => delete globalThis.caches);
}

const settled = () => new Promise(r => setTimeout(r, 10));

test('a file is fetched once, revalidated, then answered from its version cache; a new version deletes the old', async t => {
    const store = fakeCaches();
    const { f, asked } = fakeFetch({ 'https://site/try/stock/a.mdl': 'model a' });
    useCaches(t, store);
    t.mock.property(globalThis, 'fetch', f);
    const url = new URL('https://site/try/stock/a.mdl');

    const first = await Kept.open('stock', 'v1');
    assert.equal(await (await first.get(url)).text(), 'model a');
    await settled();
    assert.deepEqual(asked, [[url.href, 'no-cache']]);

    const again = await Kept.open('stock', 'v1');
    assert.equal(await (await again.get(url)).text(), 'model a');
    assert.equal(asked.length, 1, 'a repeat visit asks the network nothing');
    assert.deepEqual([again.hits, again.fetched], [1, 0]);

    await Kept.open('engine', 'e1');
    const next = await Kept.open('stock', 'v2');
    assert.deepEqual([...store.all.keys()].sort(), ['landscaper-engine-e1', 'landscaper-stock-v2']);
    await next.get(url);
    assert.equal(asked.length, 2, "a new version's cache starts empty");

    // A failed fetch is not kept; without a version, nothing is kept and the old versions go.
    await next.get(new URL('https://site/try/stock/missing.mdl'));
    await settled();
    assert.equal(store.all.get('landscaper-stock-v2').size, 1);
    const none = await Kept.open('stock', undefined);
    assert.equal(none.cache, null);
    assert.deepEqual([...store.all.keys()], ['landscaper-engine-e1']);
});

test("the engine is kept only when its SHA-256 is site.json's, as application/wasm", async t => {
    const store = fakeCaches();
    const { f, asked } = fakeFetch({ 'https://site/try/landscaper.wasm': 'engine bytes' });
    useCaches(t, store);
    t.mock.property(globalThis, 'fetch', f);
    const url = new URL('https://site/try/landscaper.wasm');
    const good = await sha256(new TextEncoder().encode('engine bytes'));

    const logged = [];
    const wrong = await Kept.open('engine', 'f'.repeat(64), line => logged.push(line));
    const check = hash => async bytes => (await sha256(bytes)) === hash;
    assert.equal(await (await wrong.get(url, check('f'.repeat(64)))).text(), 'engine bytes', 'still answered');
    await settled();
    assert.equal(store.all.get(`landscaper-engine-${'f'.repeat(64)}`).size, 0);
    assert.match(logged[0], /not the version site.json names/);

    const right = await Kept.open('engine', good);
    await right.get(url, check(good));
    await settled();
    const hit = await (await Kept.open('engine', good)).get(url, check(good));
    assert.equal(hit.headers.get('Content-Type'), 'application/wasm');
    assert.equal(await hit.text(), 'engine bytes');
    assert.equal(asked.length, 2);
    assert.deepEqual([...store.all.keys()], [`landscaper-engine-${good}`]);
});

test('without Cache Storage, the network as before', async t => {
    useCaches(t, undefined);
    const { f, asked } = fakeFetch({ 'https://site/x': 'x' });
    t.mock.property(globalThis, 'fetch', f);
    const kept = await Kept.open('stock', 'v1');
    await kept.get(new URL('https://site/x'));
    await kept.get(new URL('https://site/x'));
    assert.deepEqual(asked, [
        ['https://site/x', undefined],
        ['https://site/x', undefined],
    ]);
});
