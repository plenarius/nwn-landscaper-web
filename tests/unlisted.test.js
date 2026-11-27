// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Open's files that can't be opened (unlisted.js): read from the engine's `/api/areas`, and none from an engine that doesn't
// send them yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './browser.js';

const { unlistedOf, unlistedRows } = await import('../js/unlisted.js');

const WHY = 'its name "showcanyon" is longer than 9 characters (1-9 lower case letters, digits or _)';

test('an older engine sends no unlisted files, and Open shows nothing for them', () => {
    for (const answer of [{ areas: [] }, {}, null, undefined, { unlisted: 'x' }]) assert.deepEqual(unlistedOf(answer), []);
    assert.deepEqual(unlistedRows([]), []);
});

test("each unlisted file is shown greyed below a heading, with the engine's reason", () => {
    const unlisted = unlistedOf({
        areas: [{ name: 'bay' }],
        unlisted: [{ file: 'showcanyon.json', why: WHY }, { file: 'broken.json' }, { why: 'no file' }, 7],
    });
    assert.deepEqual(unlisted, [
        { file: 'showcanyon.json', why: WHY },
        { file: 'broken.json', why: '' },
    ]);
    const rows = unlistedRows(unlisted);
    assert.equal(rows.length, 3);
    assert.match(rows[0].textContent, /can't be opened/);
    assert.equal(rows[1].className, 'open-unlisted');
    assert.deepEqual(
        rows[1].children.map(k => k.textContent),
        ['showcanyon.json', WHY],
    );
    // (Not a button: nothing to open.)
    assert.equal(rows[1].tagName, 'DIV');
});
