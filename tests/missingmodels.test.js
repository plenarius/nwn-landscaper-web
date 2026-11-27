// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Placeables whose models the engine doesn't have (an area from another install, a hak's model in the web demo): a box in the view
// (models.js), one notice for the area (missingmodels.js), Live not red (routes.js); and the web demo's stock placeables (try/stock.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { ModelLibrary, STAND_IN_FLAT, standInSize } = await import('../js/models.js');
const { missingText, missingIn } = await import('../js/missingmodels.js');
const { liveState } = await import('../js/routes.js');
const { Stock, objectsOf } = await import('../try/stock.js');

test('a model the engine has none of is a box: drawn, placed and moved, said once, casting no shadow', async () => {
    engine.reset();
    const m = new ModelLibrary();
    const said = [];
    m.onMissing = model => said.push(model);
    await assert.rejects(m.flat('tnp_tree_t11'));
    const g = await m.group('tnp_tree_t11');
    assert.ok(g.userData.standIn);
    assert.equal(g.userData.flat, STAND_IN_FLAT);
    const box = g.children.find(c => c.isMesh);
    box.castShadow = true;
    assert.equal(box.castShadow, false);
    assert.equal(box.clone().castShadow, false);
    // Its base at the origin, a tree taller than a rock.
    box.geometry.computeBoundingBox();
    assert.deepEqual([box.geometry.boundingBox.min.y, box.geometry.boundingBox.max.y], [0, standInSize('tnp_tree_t11')[1]]);
    assert.ok(standInSize('tnp_tree_t11')[1] > standInSize('plc_rock01')[1]);
    assert.equal(await m.shape('tnp_tree_t11'), STAND_IN_FLAT);
    await m.group('tnp_tree_t11');
    assert.deepEqual(said, ['tnp_tree_t11']);
    assert.deepEqual([...m.missing], ['tnp_tree_t11']);
});

test('a model the engine fails on for another reason is no stand-in', async () => {
    engine.reset();
    engine.routes.set('GET /api/model/plc_broken', () => [{ error: 'engine stopped' }, 500]);
    const m = new ModelLibrary();
    await assert.rejects(m.group('plc_broken'));
    await assert.rejects(m.shape('plc_broken'));
    assert.equal(m.missing.size, 0);
});

test("the notice counts the open area's placeables and names a few models, worded for the page or the desktop", () => {
    const area = { objects: ['tnp_tree_t11', 'tnp_tree_t11', 'plc_rock01', 'my_hak_a', 'my_hak_b', 'my_hak_c'].map(model => ({ model })) };
    const { count, models } = missingIn(area, new Set(['tnp_tree_t11', 'my_hak_a', 'my_hak_b', 'my_hak_c']));
    assert.equal(count, 5);
    assert.deepEqual(models, ['tnp_tree_t11', 'my_hak_a', 'my_hak_b', 'my_hak_c']);
    const page = missingText(count, models, true);
    assert.match(page, /^5 placeables use models this page doesn't have \(tnp_tree_t11, my_hak_a, my_hak_b, …\)\. They show as boxes/);
    const desk = missingText(1, ['my_hak_a'], false);
    assert.match(desk, /^A placeable uses a model the Landscaper can't find/);
    assert.doesNotMatch(desk, /demo|page/);
});

test('Live is amber, not red, when the only fault is models the engine lacks; blocked routes stay red', () => {
    const missing = { missing_models: ['tnp_tree_t11'] };
    const [state, text, title] = liveState({ routes: { ok: 40, total: 40 }, warnings: [], ...missing });
    assert.deepEqual([state, text], ['warn', 'Paths OK']);
    assert.match(title, /1 model the engine doesn't have \(the boxes\) don't block paths/);
    assert.equal(liveState({ routes: { ok: 40, total: 40 }, warnings: [], missing_models: [] })[0], 'ok');
    const failed = { kind: 'failed_route' };
    assert.equal(liveState({ routes: { ok: 39, total: 40 }, warnings: [failed], ...missing })[0], 'bad');
});

/** A check's body as the editor sends it (export.js sendArea): heights, paint, then the JSON. */
function body(tiles, extra, paint = true) {
    const n = (tiles * 16 + 1) ** 2;
    const json = new TextEncoder().encode(JSON.stringify(extra));
    const out = new Uint8Array(n * 4 + (paint ? n : 0) + json.length);
    out.set(json, n * 4 + (paint ? n : 0));
    return out;
}

test("the page's stock: a request gets its model's files first, a check every placed model's, the lists from files", async () => {
    engine.reset();
    const index = {
        start: ['placeables.2da', 'fslit.shd'],
        models: { tnp_tree_t11: ['tnp_tree_t11.mdl', 'tnp_tree_t11.pwk', 'tnp_bark.dds'], plc_rock01: ['plc_rock01.mdl', 'rock.tga'] },
        textures: { tnp_bark: 'tnp_bark.dds', rock: 'rock.tga' },
    };
    engine.routes.set('GET /try/stock/index.json', () => [index]);
    engine.routes.set('GET /try/stock/placeables.json', () => [{ placeables: [{ row: 555, model: 'tnp_tree_t11', source: 'game' }] }]);
    const site = new URL('/try/', location.href);
    const stock = await Stock.open(site, undefined, () => {});
    assert.equal(stock.models, 2);
    const req = (method, path, b) => ({ method, path, body: b?.buffer });
    assert.deepEqual(stock.filesFor(req('GET', '/api/model/TNP_TREE_T11')), index.models.tnp_tree_t11);
    assert.deepEqual(stock.filesFor(req('GET', '/api/texture/rock')), ['rock.tga']);
    assert.deepEqual(stock.filesFor(req('GET', '/api/texture/nowhere')), []);
    const objects = [{ model: 'plc_rock01' }, { model: 'tnp_tree_t11' }, { model: 'plc_rock01' }, { model: 'my_hak_a' }];
    const check = req('POST', '/api/check?name=a&tiles=3&tilesY=3', body(3, { palette: [], objects }));
    assert.deepEqual(stock.filesFor(check), [...index.models.plc_rock01, ...index.models.tnp_tree_t11]);
    // (Unpainted: no paint bytes between the heights and the JSON.)
    assert.deepEqual(objectsOf(new URLSearchParams('tiles=3'), body(3, { objects }, false)), objects);
    assert.deepEqual(objectsOf(new URLSearchParams('tiles=3'), body(3, {}, true)), []);
    const listed = await stock.answer(req('GET', '/api/placeables'));
    assert.equal(JSON.parse(new TextDecoder().decode(listed.body)).placeables[0].model, 'tnp_tree_t11');
    assert.equal(await stock.answer(req('GET', '/api/me')), null);
    // Each file into the engine's override once; one that can't be fetched is left for the next request.
    engine.routes.set('GET /try/stock/res/plc_rock01.mdl', () => [{}]);
    const put = [];
    const fake = { put: path => put.push(path) };
    await stock.give(fake, ['plc_rock01.mdl', 'rock.tga']);
    await stock.give(fake, ['plc_rock01.mdl', 'rock.tga']);
    assert.deepEqual(put, ['user/override/plc_rock01.mdl']);
    assert.equal(await Stock.open(new URL('/elsewhere/', location.href), undefined, () => {}), null);
});
