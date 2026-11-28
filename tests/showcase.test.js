// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The engine's showcase areas (nwn-landscaper's docs/assets/showcase/areas, in LANDSCAPER_SHOWCASE; CI checks them out) open,
// save smaller and open again as the same areas: saves written before the band and the objects were saved compactly still open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import './browser.js';

const { Area } = await import('../js/area.js');

const dir = process.env.LANDSCAPER_SHOWCASE;
const files = dir ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : [];

test('every showcase area saves smaller and opens again as the same area', { skip: !dir && 'LANDSCAPER_SHOWCASE is not set' }, () => {
    assert.ok(files.length >= 8, `${files.length} areas in ${dir}`);
    for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8'),
            a = Area.fromJSON(JSON.parse(text)),
            saved = JSON.stringify(a.toJSON()),
            b = Area.fromJSON(JSON.parse(saved));
        assert.ok(saved.length < text.length, `${f}: ${saved.length} bytes, was ${text.length}`);
        assert.deepEqual(b.heights, a.heights, f);
        assert.deepEqual(b.materials, a.materials, f);
        // The band: its heights to the centimetre (exactly, when untouched: it is filled again), its paint exactly.
        if (a.band) {
            let worst = 0;
            for (let k = 0; k < a.band.heights.length; k++) worst = Math.max(worst, Math.abs(b.band.heights[k] - a.band.heights[k]));
            assert.ok(worst <= 0.005 + 1e-4, `${f}: the band is ${worst} m off`);
            if (!JSON.parse(saved).band) assert.equal(worst, 0, f);
            assert.deepEqual(b.band.materials, a.band.materials, f);
        }
        // The objects: the same fields, their numbers within a save's rounding.
        const off = { x: 0.0005, y: 0.0005, z: 0.0005, bearing: 0.00005, scale: 0.00005 };
        assert.equal(b.objects.length, a.objects.length, f);
        for (const [k, o] of a.objects.entries()) {
            const back = b.objects[k];
            assert.deepEqual(Object.keys(back).sort(), Object.keys(o).sort(), `${f} object ${k}`);
            for (const field in o)
                if (field in off) assert.ok(Math.abs(back[field] - o[field]) <= off[field] + 1e-9, `${f} object ${k} ${field}`);
                else assert.equal(back[field], o[field], `${f} object ${k} ${field}`);
        }
        // The rest as it was, and a second save the same as the first.
        const rest = o => ({ ...o, objects: null, band: null });
        assert.deepEqual(rest(JSON.parse(saved)), rest(a.toJSON()), f);
        assert.equal(JSON.stringify(b.toJSON()), saved, f);
    }
});
