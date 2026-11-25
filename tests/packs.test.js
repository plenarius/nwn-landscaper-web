// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Get more textures dialog's logic (packs.js): what each pack's row says and offers, and how an install's progress reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { creditsText, packRows, progressOf, rowFacts, sizeText, stillThere } = await import('../js/packs.js');

const offered = (over = {}) => ({
    id: 'team-art',
    name: 'Team art',
    version: '1.1',
    description: 'Ground textures.',
    licence: 'CC-BY-4.0',
    credits: ['Alice', 'Bob', 'Carol'],
    size: 3.5 * 1024 * 1024,
    textures: 40,
    categories: ['Grass', 'Rock'],
    swatches: ['data:image/png;base64,AA', 'https://elsewhere.example/x.png'],
    installed: null,
    ...over,
});

test('sizes and credits read the way people say them', () => {
    assert.equal(sizeText(100), '1 KB');
    assert.equal(sizeText(640 * 1024), '640 KB');
    assert.equal(sizeText(3.5 * 1024 * 1024), '3.5 MB');
    assert.equal(sizeText(120 * 1024 * 1024), '120 MB');
    assert.equal(sizeText(undefined), '');
    assert.equal(creditsText(['Alice']), 'By Alice');
    assert.equal(creditsText(['Alice', 'Bob', 'Carol']), 'By Alice, Bob and Carol');
    assert.equal(creditsText([' ', null]), '');
});

test('a pack on offer can be installed; once installed, removed; at another version, updated', () => {
    const [row] = packRows({ available: [offered()], installed: [], manage: true });
    assert.equal(row.state, 'available');
    assert.equal(row.install, 'Install');
    assert.equal(row.remove, false);
    assert.equal(row.credits, 'By Alice, Bob and Carol');
    // Only pictures carried in the answer are shown: nothing is loaded from another site.
    assert.deepEqual(row.swatches, ['data:image/png;base64,AA']);
    assert.equal(rowFacts(row), '40 textures · 3.5 MB · Licence: CC-BY-4.0');

    const have = { id: 'team-art', name: 'Team art', version: '1.1', textures: ['taMoss'] };
    const [same] = packRows({ available: [offered()], installed: [have], manage: true });
    assert.deepEqual([same.state, same.install, same.remove], ['installed', null, true]);
    assert.match(rowFacts(same), /installed \(1\.1\)$/);

    const [older] = packRows({ available: [offered()], installed: [{ ...have, version: '1.0' }], manage: true });
    assert.deepEqual([older.state, older.install, older.remove], ['update', 'Update to 1.1', true]);
});

test('an installed pack the index no longer lists is still shown, to remove', () => {
    const rows = packRows({
        available: [offered()],
        installed: [{ id: 'own', name: 'Our own', version: '3', licence: 'MIT', credits: ['Us'], textures: ['owA', 'owB'] }],
        manage: true,
    });
    assert.deepEqual(
        rows.map(r => [r.id, r.state]),
        [
            ['team-art', 'available'],
            ['own', 'installed'],
        ],
    );
    assert.deepEqual([rows[1].count, rows[1].remove, rows[1].install], [2, true, null]);
});

test('a builder on a team server sees the packs but is offered nothing', () => {
    const rows = packRows({ available: [offered()], installed: [{ id: 'team-art', version: '1.0' }], manage: false });
    assert.deepEqual([rows[0].install, rows[0].remove], [null, false]);
});

test('while an install runs, only its own row says so and nothing else is offered', () => {
    const rows = packRows({
        available: [offered(), offered({ id: 'other', name: 'Other' })],
        installed: [],
        manage: true,
        job: { running: true, pack: 'other' },
    });
    assert.deepEqual(
        rows.map(r => [r.id, r.install, r.busy]),
        [
            ['team-art', null, false],
            ['other', null, true],
        ],
    );
    assert.deepEqual(packRows(undefined), []);
});

test("an install's progress fills the bar a third for each step, and says how far it is", () => {
    assert.deepEqual(progressOf(null), { fraction: null, text: '' });
    const dl = progressOf({ pack: 'team-art', name: 'Team art', step: 'downloading', done: 512 * 1024, total: 1024 * 1024 });
    assert.equal(dl.fraction, 0.5 / 3);
    assert.equal(dl.text, 'Downloading Team art… 512 KB of 1.0 MB');
    // A download that doesn't say its size: the bar has no value yet.
    assert.equal(progressOf({ pack: 'p', step: 'downloading', done: 10, total: 0 }).fraction, null);
    const check = progressOf({ pack: 'p', step: 'checking', done: 3, total: 4 });
    assert.equal(check.fraction, (1 + 0.75) / 3);
    assert.equal(check.text, 'Checking p… 3 of 4 files');
    assert.equal(progressOf({ pack: 'p', step: 'installing', done: 4, total: 4 }).fraction, 1);

    const done = progressOf({ pack: 'p', step: 'done', result: { name: 'P', version: '2', textures: 12, replaced: '1' } });
    assert.deepEqual([done.fraction, done.done, done.text], [1, true, 'Installed P 2: 12 textures (replacing 1).']);
    assert.equal(
        progressOf({ pack: 'p', step: 'done', result: { name: 'P', version: '2', unchanged: true } }).text,
        'P 2 was installed already.',
    );
    const failed = progressOf({ pack: 'p', step: 'failed', error: 'the download stopped' });
    assert.deepEqual([failed.failed, failed.text], [true, 'Could not install p: the download stopped']);
});

test('the texture painted with gives way to the default when its pack is removed', () => {
    const catalog = [{ id: 'grassMedium' }, { id: 'taMoss' }];
    assert.equal(stillThere(catalog, 'taMoss'), true);
    assert.equal(stillThere([{ id: 'grassMedium' }], 'taMoss'), false);
    assert.equal(stillThere(undefined, 'x'), false);
});
