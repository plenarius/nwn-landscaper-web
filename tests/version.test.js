// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The version beside the title (version.js): read from a changelog, and what the top bar says for the engine's and the editor's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changelogVersion, describe, hasEntries } from '../js/version.js';

test('a changelog says its last release, with +dev while changes wait under Unreleased', () => {
    const released = '# Changelog\n\nIntro.\n\n## 0.6.1\n\n- A fix.\n\n## 0.6.0\n';
    assert.equal(changelogVersion(released), '0.6.1');
    assert.equal(changelogVersion('# Changelog\n\n## Unreleased\n\n- New.\n\n## 0.6.1\n\n- A fix.\n'), '0.6.1+dev');
    assert.equal(changelogVersion('## 0.6.1\n\n### Unreleased\n'), '0.6.1');
    assert.equal(changelogVersion('# Changelog\n'), null);
    assert.equal(changelogVersion('<!doctype html><title>Not found</title>'), null);
    assert.equal(changelogVersion(null), null);
});

test('a changelog says +dev while entries wait in changelog.d/, which the engine lists', () => {
    const released = '# Changelog\n\n## 0.6.1\n\n- A fix.\n';
    assert.equal(changelogVersion(released, true), '0.6.1+dev');
    assert.equal(changelogVersion(released, false), '0.6.1');
    assert.equal(changelogVersion('# Changelog\n', true), null);
    assert.equal(hasEntries({ fragments: ['dig-edge.md'] }), true);
    assert.equal(hasEntries({ fragments: [] }), false);
    // An older engine (no such answer) or a plain file server's page of the folder: none.
    assert.equal(hasEntries({}), false);
    assert.equal(hasEntries(null), false);
});

test('one release shows one version and its notes', () => {
    const d = describe('0.6.1', '0.6.1');
    assert.equal(d.text, '0.6.1');
    assert.equal(d.mismatch, false);
    assert.deepEqual(d.lines, ['Engine 0.6.1', 'Editor 0.6.1']);
    assert.deepEqual(d.links, [
        { label: 'Release notes of 0.6.1', url: 'https://github.com/plenarius/nwn-landscaper/releases/tag/v0.6.1' },
    ]);
    assert.equal(d.other, null);
    assert.equal(d.title, 'Engine 0.6.1, editor 0.6.1. Click for the release notes.');
});

test('a build after a release says +dev and links the release it follows', () => {
    const d = describe('0.6.1+dev', '0.6.1+dev');
    assert.equal(d.text, '0.6.1+dev');
    assert.equal(d.mismatch, false);
    assert.equal(d.lines.at(-1), '+dev: a build after 0.6.1, with changes not released yet.');
    assert.deepEqual(
        d.links.map(l => l.url),
        ['https://github.com/plenarius/nwn-landscaper/releases/tag/v0.6.1'],
    );
});

test('an engine and editor of different releases show both, flagged', () => {
    const d = describe('0.6.1', '0.5.0');
    assert.equal(d.text, '0.6.1');
    assert.equal(d.other, '0.5.0');
    assert.equal(d.mismatch, true);
    assert.equal(
        d.title,
        'Engine 0.6.1, editor 0.5.0. They are from different releases: some things may not work. Click for the release notes.',
    );
    assert.deepEqual(
        d.links.map(l => l.label),
        ['Release notes of 0.6.1', 'Release notes of 0.5.0'],
    );
    // (a release and a build after it differ too)
    assert.equal(describe('0.6.1', '0.6.1+dev').mismatch, true);
});

test('without the engine, or an engine too old to say, the editor version alone', () => {
    const d = describe(null, '0.6.1');
    assert.equal(d.text, '0.6.1');
    assert.equal(d.mismatch, false);
    assert.deepEqual(d.lines, ['Engine unknown', 'Editor 0.6.1']);
    assert.equal(describe('0.6.1', null).text, '0.6.1');
    assert.equal(describe(null, null), null);
});
