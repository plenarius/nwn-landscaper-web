// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Try on dev (trial.js, in the Publish dialog): the trial shown on opening, what Try on dev sends and shows, Keep it longer,
// Release, and the button hidden where the service takes no trials.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const { initPublish } = await import('../js/publish.js');
const { trialClosed } = await import('../js/trial.js');

const $ = id => document.getElementById(id);
let me = { team: true, publish: true, user: 'alice' };
const area = { name: 'bay1', module: 'bay1' };
initPublish({ area: () => area, me: () => me, readOnly: () => false });

/** Every text under `e`, its children's too, as one string. */
const text = e => [e.textContent, ...(e.children ?? []).map(text)].join(' ');
const calls = prefix => engine.log.filter(l => l.startsWith(prefix));

/** The engine's answers: a clean check, and `trial` as this builder's trial (null: none). */
function serve(trial, { enabled = true } = {}) {
    engine.routes.set('POST /api/publish', () => [
        { plan: { module_files: ['a'], hak_files: 3, warnings: [], area: 'bay1', new: true }, findings: [] },
    ]);
    engine.routes.set('GET /api/dev-trial', () => [{ enabled, trial, join: 'dev.example.org port 5121' }]);
}

/** Opens the Publish dialog and waits for its check and the trial's status. */
async function open() {
    await $('btnPublish').onclick();
}

beforeEach(() => {
    engine.reset();
    trialClosed();
    me = { team: true, publish: true, user: 'alice' };
    $('pubWhole').checked = false;
    $('pubNote').value = '';
});

test('opening Publish shows an existing trial with its commands and time left, without touching it', async () => {
    serve({ akeys: ['bay1', 'cave2'], commands: { bay1: ';forge bay1', cave2: ';forge cave2' }, expires_in: 1500 });
    await open();
    assert.equal($('pubTry').hidden, false);
    assert.equal($('pubTry').disabled, false, 'the check found no errors');
    assert.equal($('pubTrial').hidden, false);
    const commands = text($('pubTrialCommands'));
    assert.match(commands, /;forge bay1/);
    assert.match(commands, /;forge cave2/);
    assert.match($('pubTrialText').textContent, /dev\.example\.org port 5121/);
    assert.match($('pubTrialLeft').textContent, /About 25 minutes left/);
    assert.equal($('pubTrialReconnect').hidden, true);
    assert.deepEqual(calls('GET /api/dev-trial'), ['GET /api/dev-trial'], 'no touch on opening');
    trialClosed();
});

test('no trial: the button is there and the panel is not', async () => {
    serve(null);
    await open();
    assert.equal($('pubTry').hidden, false);
    assert.equal($('pubTrial').hidden, true);
});

test('trials off, or a server without a review service: no Try on dev', async () => {
    serve(null, { enabled: false });
    await open();
    assert.equal($('pubTry').hidden, true);
    me = { team: true, package: true, user: 'alice' };
    engine.log = [];
    await open();
    assert.equal($('pubTry').hidden, true);
    assert.deepEqual(calls('GET /api/dev-trial'), [], 'a package server never asks');
});

test('Try on dev sends the area or its module and shows the reconnect line, the commands, warnings and errors', async () => {
    serve(null);
    let sent = null;
    engine.routes.set('POST /api/dev-trial', u => {
        sent = u.searchParams;
        return [
            {
                revs: { bay1: 3 },
                reconnect: true,
                way_in: 'Connect to dev, then type ;forge for your areas.',
                commands: { bay1: ';forge bay1' },
                areas: [{ akey: 'bay1', dev: { written: true, applied: false, message: 'nobody was in it' } }],
                errors: [{ akey: 'cave2', detail: 'its tileset is missing' }],
                skipped: ['old1'],
                dropped: [],
                warnings: ['2 new blueprints are not on dev in a trial'],
                expires_in: 3600,
            },
        ];
    });
    await open();
    $('pubWhole').checked = true;
    $('pubNote').value = 'first go';
    await $('pubTry').onclick();
    assert.deepEqual([sent.get('name'), sent.get('whole'), sent.get('note')], ['bay1', '1', 'first go']);
    assert.equal($('pubTrialReconnect').hidden, false);
    assert.match($('pubTrialReconnect').textContent, /disconnected in about 10 seconds.*Reconnect from the main menu/);
    assert.match(text($('pubTrialCommands')), /;forge bay1/);
    const notes = text($('pubTrialNotes'));
    for (const want of ['cave2: not on dev. its tileset is missing', 'bay1: nobody was in it', '2 new blueprints', 'old1'])
        assert.ok(notes.includes(want), want);
    assert.match($('pubTrialLeft').textContent, /About 60 minutes left/);
    assert.match($('pubText').textContent, /^On dev\./);
    assert.equal($('pubTry').disabled, false, 'ready for another');
    trialClosed();
});

test("a refusal shows the service's sentence", async () => {
    serve(null);
    engine.routes.set('POST /api/dev-trial', () => [{ error: 'bay1 is on dev for bob now.' }, 400]);
    await open();
    await $('pubTry').onclick();
    assert.equal($('pubText').textContent, "Couldn't put it on dev: bay1 is on dev for bob now.");
    assert.equal($('pubTrial').hidden, true);
});

test('Keep it longer touches the trial; Release ends it', async () => {
    serve({ akeys: ['bay1'], expires_in: 60 });
    await open();
    engine.routes.set('GET /api/dev-trial', u => [
        { enabled: true, trial: { akeys: ['bay1'], expires_in: u.searchParams.get('touch') ? 3600 : 60 } },
    ]);
    await $('pubTrialKeep').onclick();
    assert.deepEqual(calls('GET /api/dev-trial?'), ['GET /api/dev-trial?touch=1']);
    assert.match($('pubTrialLeft').textContent, /About 60 minutes left/);
    engine.routes.set('POST /api/dev-trial/release', () => [{ released: true }]);
    await $('pubTrialRelease').onclick();
    assert.deepEqual(calls('POST /api/dev-trial/release'), ['POST /api/dev-trial/release']);
    assert.equal($('pubTrial').hidden, true);
    assert.match($('pubText').textContent, /^Released/);
});
