// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Which keys the shortcuts leave to the focused element (keys.js): a tool's letter still works after a click on a slider, a
// radio button or a tick box (Sky & fog's), and never while typing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { keyBelongsTo } = await import('../js/keys.js');

/** A focused element: `tag` with input `type`, inside a container that `inside` names ('dialog', 'textarea'...) or none. */
function focused(tag, type, inside = null) {
    return {
        tagName: tag.toUpperCase(),
        type,
        closest: sel => (inside && sel.split(',').some(s => s.trim().startsWith(inside)) ? {} : null),
    };
}
const key = k => ({ key: k });

test("a tool's letter is a shortcut after a click on a slider, a radio button, a tick box, a colour or a button", () => {
    for (const t of [focused('input', 'range'), focused('input', 'radio'), focused('input', 'checkbox'), focused('input', 'color')]) {
        assert.equal(keyBelongsTo(t, key('b')), false, t.type);
        assert.equal(keyBelongsTo(t, key('a')), false, t.type);
    }
    assert.equal(keyBelongsTo(focused('button', 'button'), key('b')), false);
    assert.equal(keyBelongsTo({ tagName: 'BODY' }, key('b')), false);
});

test('a slider, a radio button and a tick box keep their own keys', () => {
    for (const k of ['ArrowLeft', 'ArrowUp', 'Home', 'End', 'PageUp', ' ', 'Enter', 'Escape']) {
        assert.equal(keyBelongsTo(focused('input', 'range'), key(k)), true, k);
        assert.equal(keyBelongsTo(focused('input', 'radio'), key(k)), true, k);
    }
    assert.equal(keyBelongsTo(focused('input', 'checkbox'), key(' ')), true);
});

test('a text or number box, a list, a text area, an editor and a dialog keep every key', () => {
    for (const type of ['text', 'number', 'search', 'email', 'password', '']) {
        assert.equal(keyBelongsTo(focused('input', type), key('b')), true, type);
        assert.equal(keyBelongsTo(focused('input', type), key('ArrowLeft')), true, type);
    }
    assert.equal(keyBelongsTo(focused('select', undefined, 'select'), key('a')), true);
    assert.equal(keyBelongsTo(focused('textarea', undefined, 'textarea'), key('a')), true);
    assert.equal(keyBelongsTo(focused('div', undefined, '[contenteditable]'), key('a')), true);
    // (A tick box in a dialog: the dialog's.)
    assert.equal(keyBelongsTo(focused('input', 'checkbox', 'dialog'), key('b')), true);
});
