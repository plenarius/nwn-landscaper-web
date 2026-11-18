// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The blueprint dialog (newbp.js) in someone else's workspace: it shows the blueprint, and nothing in it can be changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine, enabled, stub } from './browser.js';

stub('things.js', 'scripts.js', 'dialogs.js');
// (newbp.js adds the dialog to the Things tool's class)
await import('../js/newbp.js');
const { ThingsTool } = await import('../js/things.js');

/** A door blueprint of the builder's, with a text field, an on/off setting, a description and a script. */
function door() {
    engine.reset();
    engine.blueprints.set('door01', {
        resref: 'door01',
        name: 'Old door',
        fields: [
            { label: 'Tag', type: 's', value: 'door01' },
            { label: 'Plot', type: 'b', value: '0' },
            { label: 'Description', type: 'l', value: 'An old door.' },
            { label: 'OnOpen', type: 'r', value: 'my_open' },
        ],
    });
}

test('the blueprint dialog opened in a read-only view shows every field disabled, and no Delete', async () => {
    door();
    // (opened through code: the buttons that open it aren't shown in the read-only view)
    await new ThingsTool({ readOnly: () => true }).bpEdit('utd', 'door01');
    const body = document.getElementById('bpBody');
    assert.ok(body.children.length > 0, 'the blueprint is shown');
    assert.deepEqual(enabled(body), []);
    assert.equal(document.getElementById('bpDelete').hidden, true);
});

test('the blueprint dialog in your own workspace can be changed', async () => {
    door();
    document.getElementById('bpBody').children.length = 0;
    await new ThingsTool({ readOnly: () => false }).bpEdit('utd', 'door01');
    assert.ok(enabled(document.getElementById('bpBody')).length >= 4);
    assert.equal(document.getElementById('bpDelete').hidden, false);
});
