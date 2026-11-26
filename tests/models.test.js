// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Place and Scatter panels' search (models.js): a module's haks give placeables.2da 21,201 rows, searched on every key, a page
// at a time, from one source (a hak, or the game) when the builder picks one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { ModelLibrary, PAGE, MIX } = await import('../js/models.js');

/** A library of `list` as the engine gives it. */
function library(list) {
    const m = new ModelLibrary();
    m.setList(list);
    return m;
}

/** About a module's size: 21,201 rows, a few rows sharing a model, some models nowhere, three sources. */
function big() {
    const list = [];
    for (let row = 0; row < 21201; row++) {
        const kind = ['Saguaro cactus', 'Bush, green', 'Tree, oak', 'Rock, grey', 'Crate'][row % 5];
        const source = row < 500 ? 'game' : row % 7 === 0 ? null : row % 3 ? 'my_placeables' : 'my_plc_hd';
        list.push({ row, label: `${kind.replaceAll(/\W+/g, '_')}_${row}`, name: `${kind} ${row}`, model: `plc_${row % 20000}`, source });
    }
    return list;
}

test('a search gives a page of the models that match, and how many match in all', () => {
    const m = library(big());
    const first = m.search('cactus');
    assert.equal(first.results.length, PAGE);
    assert.ok(first.results.every(p => p.name.includes('cactus')));
    // Each model once (rows 20000 and up share models with the first rows), and none that is nowhere.
    const all = m.search('cactus', { limit: 1e6 });
    assert.equal(first.total, all.results.length);
    assert.equal(new Set(all.results.map(p => p.model)).size, all.total);
    assert.ok(all.results.every(p => p.source !== null));
    // The next page goes on where the first stopped.
    const second = m.search('cactus', { offset: PAGE });
    assert.deepEqual(second.results[0], all.results[PAGE]);
    assert.equal(second.total, first.total);
});

test('every word must match, in the name, the label or the model; an underscore is a space', () => {
    const m = library([
        { row: 1, label: 'Saguaro_Cactus_Green', name: 'Saguaro cactus, green', model: 'lyn_cactus01', source: 'my_plc' },
        { row: 2, label: 'Bush01', name: 'Bush', model: 'plc_bush01', source: 'game' },
        { row: 3, label: 'Cactus_Lost', name: 'Lost cactus', model: 'gone', source: null },
    ]);
    assert.deepEqual(
        m.search('saguaro green').results.map(p => p.row),
        [1],
    );
    assert.deepEqual(
        m.search('saguaro_cactus').results.map(p => p.row),
        [1],
    );
    assert.deepEqual(
        m.search('CACTUS').results.map(p => p.row),
        [1],
    );
    assert.deepEqual(
        m.search('bush01').results.map(p => p.row),
        [2],
    );
    assert.equal(m.search('lost').total, 0);
});

test('a search from one source finds only its models; the sources are the game first, then the haks by size', () => {
    const m = library(big());
    const hd = m.search('bush', { source: 'my_plc_hd', limit: 1e6 });
    assert.ok(hd.total > 0 && hd.results.every(p => p.source === 'my_plc_hd'));
    assert.ok(hd.total < m.search('bush').total);
    const sources = m.sources();
    assert.deepEqual(
        sources.map(s => s.source),
        ['game', 'my_placeables', 'my_plc_hd'],
    );
    assert.equal(
        sources.reduce((n, s) => n + s.count, 0),
        m.index.length,
    );
});

test('an engine that gives no sources: every row is the game’s, searched as before', () => {
    const m = library([
        { row: 0, label: 'Rock', name: 'Rock', model: 'plc_rock' },
        { row: 1, label: 'Rock2', name: 'Rock', model: 'plc_rock' },
    ]);
    assert.deepEqual(m.sources(), [{ source: 'game', count: 1 }]);
    assert.deepEqual(
        m.search('rock').results.map(p => p.row),
        [0],
    );
});

test('a search of 21,201 rows takes a few milliseconds, not a freeze', () => {
    const m = library(big());
    const queries = ['c', 'cactus', 'bush green', 'tree oak 1', 'nothing at all'];
    // Against a plain scan of the same rows for the same words, each the best of 10 taken in turn and in the process's CPU
    // time, so a slow or busy machine slows both alike: 50 ms of wall time failed whenever other work shared the machine. A
    // search costs about 3 to 5 scans (a few milliseconds); past 20, something does more work a row than it should.
    const time = f => {
        const c0 = process.cpuUsage();
        f();
        const c = process.cpuUsage(c0);
        return (c.user + c.system) / 1000;
    };
    let search = Infinity,
        scan = Infinity;
    for (let k = 0; k < 10; k++) {
        search = Math.min(
            search,
            time(() => {
                for (const q of queries) m.search(q);
            }),
        );
        scan = Math.min(
            scan,
            time(() => {
                for (const q of queries) {
                    const words = q.split(' ');
                    m.index.filter(e => words.every(w => e.text.includes(w)));
                }
            }),
        );
    }
    assert.ok(search < 20 * scan, `${(search / 5).toFixed(1)} ms a search, ${(search / scan).toFixed(1)} scans`);
});

/** A library with plants measured as the engine gives them (plants.rs): `kinds` is [kind, small count, large count]. */
function withPlants(kinds) {
    const list = [],
        plants = [];
    let row = 0;
    for (const [kind, small, large] of kinds) {
        for (let i = 0; i < small + large; i++, row++) {
            const model = `${kind}_${i}`;
            list.push({ row, label: model, name: `${kind} ${i}`, model, source: i % 2 ? 'my_plc' : 'game' });
            const height = i < small ? 0.8 : 2.5;
            plants.push({ model, kind, height, width: 1, large: i >= small });
        }
    }
    list.push({ row, label: 'Rock', name: 'Rock', model: 'plc_rock', source: 'game' });
    const m = library(list);
    m.plants = new Map(plants.map(p => [p.model, p]));
    return m;
}

test('a group’s chip shows the plants of that size, and no other placeable', () => {
    const m = withPlants([
        ['bush', 5, 3],
        ['cactus', 2, 4],
    ]);
    const small = m.search('small plants', { limit: 1e6 });
    assert.equal(small.total, 7);
    assert.ok(small.results.every(p => m.groupOf(p.model) === 'small'));
    assert.equal(m.search('Large Plants').total, 7);
    assert.equal(m.search('large plants', { source: 'my_plc' }).total, 4);
    assert.equal(m.groupOf('plc_rock'), null);
    // The mix comes first when it is given.
    const first = new Set(['bush_4', 'cactus_1']);
    assert.deepEqual(
        m
            .search('small plants', { first })
            .results.slice(0, 2)
            .map(p => p.model),
        ['bush_4', 'cactus_1'],
    );
});

test('a group’s mix: a few of each kind in turn, spread over each kind, no cacti or reeds, at most MIX', () => {
    const m = withPlants([
        ['bush', 30, 0],
        ['fern', 2, 0],
        ['flower', 20, 0],
        ['cactus', 10, 0],
        ['reed', 5, 0],
    ]);
    const mix = m.groupMix('small');
    assert.equal(mix.length, MIX);
    assert.equal(new Set(mix).size, mix.length);
    assert.ok(mix.every(model => !model.startsWith('cactus') && !model.startsWith('reed')));
    // Every kind is in it, the small kind whole; the big ones spread (not their first few in a row).
    for (const k of ['bush', 'fern', 'flower'])
        assert.ok(
            mix.some(model => model.startsWith(`${k}_`)),
            k,
        );
    const bushes = mix.filter(model => model.startsWith('bush_')).map(model => +model.split('_')[1]);
    assert.ok(Math.max(...bushes) - Math.min(...bushes) >= 15, `${bushes}`);
    // From one source alone; a group with nothing in it gives no mix.
    assert.ok(m.groupMix('small', 'my_plc').every(model => +model.split('_')[1] % 2 === 1));
    assert.deepEqual(m.groupMix('large'), []);
});

test('a picture no longer wanted when its turn comes is skipped, and drawn when asked again', async () => {
    const m = new ModelLibrary();
    const drawn = [];
    m.render = async model => {
        drawn.push(model);
        return `url:${model}`;
    };
    const gone = m.thumbnail('old', () => false);
    const shown = m.thumbnail('new', () => true);
    // Asked again by someone who wants it while it waits: drawn.
    const both = m.thumbnail('shared', () => false);
    m.thumbnail('shared', () => true);
    assert.deepEqual(await Promise.all([gone, shown, both]), ['', 'url:new', 'url:shared']);
    assert.deepEqual(drawn, ['new', 'shared']);
    assert.equal(await m.thumbnail('old'), 'url:old');
});

test("a quick button's word matches whole words only: rock finds rocks, not a rocking chair", () => {
    const m = library([
        { row: 1, label: 'Rock_Grey', name: 'Rock, grey', model: 'plc_rock', source: 'game' },
        { row: 2, label: 'Rocks_Small', name: 'Rocks, small', model: 'plc_rocks', source: 'game' },
        { row: 3, label: 'Rocking_chair_with_old_woman', name: 'Rocking chair with old woman', model: 'zlc_g53', source: 'my_plc' },
        { row: 4, label: 'Cacti_small', name: 'Cacti, small', model: 'plc_cac', source: 'game' },
        { row: 5, label: 'Bushy_shrub', name: 'Bushy shrub', model: 'plc_shrub', source: 'game' },
    ]);
    assert.deepEqual(
        m.search('rock').results.map(p => p.row),
        [1, 2],
    );
    assert.deepEqual(
        m.search('cactus').results.map(p => p.row),
        [4],
    );
    assert.deepEqual(
        m.search('bush').results.map(p => p.row),
        [5],
    );
    // Typed text still matches inside words.
    assert.deepEqual(
        m.search('rocki').results.map(p => p.row),
        [3],
    );
});
