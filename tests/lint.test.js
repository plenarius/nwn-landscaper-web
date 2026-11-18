// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Biome plugins in lint/ against their fixtures in lint/fixtures/: each line marked `// flagged` gets a diagnostic and no other
// line does, so a pattern that stops matching (after a Biome upgrade, or an edit) fails here. Needs `biome` on the PATH, the
// version scripts/check.sh pins; without it the test is skipped, except in CI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const lint = fileURLToPath(new URL('../lint/', import.meta.url));
const haveBiome = spawnSync('biome', ['--version']).status === 0;

/** The line numbers (from 1) of `file`'s lines that end in `// flagged`. */
function marked(file) {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.flatMap((line, k) => (line.trimEnd().endsWith('// flagged') ? [k + 1] : []));
}

/** The line numbers Biome reports for fixture `name` with plugin `plugin` alone (its own folder, so the page's biome.json and
 *  its exclusion of the fixtures don't apply). */
function flagged(plugin, name) {
    const dir = mkdtempSync(join(tmpdir(), 'landscaper-lint-'));
    try {
        cpSync(join(lint, plugin), join(dir, plugin));
        cpSync(join(lint, 'fixtures', name), join(dir, name));
        const config = { plugins: [`./${plugin}`], formatter: { enabled: false }, linter: { rules: { preset: 'none' } } };
        writeFileSync(join(dir, 'biome.json'), JSON.stringify(config));
        const run = spawnSync('biome', ['lint', '--reporter=github', name], { cwd: dir, encoding: 'utf8' });
        const lines = [...run.stdout.matchAll(/^::error title=plugin,file=[^,]*,line=(\d+),/gm)].map(m => Number(m[1]));
        assert.ok(lines.length > 0 || run.status === 0, `biome failed:\n${run.stdout}${run.stderr}`);
        return [...new Set(lines)].sort((a, b) => a - b);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const skip = !haveBiome && !process.env.CI && 'biome is not installed';

test('requests go through api(): fetch, XMLHttpRequest and sendBeacon are refused in every form', { skip }, () => {
    assert.deepEqual(flagged('fetch-through-api.grit', 'requests.js'), marked(join(lint, 'fixtures', 'requests.js')));
});

test('HTML is set from fixed strings only: every sink is refused with a value, and allowed with a fixed string', { skip }, () => {
    assert.deepEqual(flagged('no-html-from-values.grit', 'html.js'), marked(join(lint, 'fixtures', 'html.js')));
});
