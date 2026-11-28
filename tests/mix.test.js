// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Paint tool's mix (mix.js): the weights' shares, patches rather than single samples, the same ground painted the same way
// on every pass, the strength as cover, undo, and the mix kept in the browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './importmap.js';

const { Area, SPACING } = await import('../js/area.js');
const mixjs = await import('../js/mix.js');
const { stamp } = await import('../js/tools.js');
const { sampleMix } = await import('../js/blend.js');
const { newMix, withTexture, withWeight, toggledTexture, shiftAdded, shares, readMix, writeMix, keptTextures, mixPlan, mixStamp } = mixjs;

/** A mix of `ids` (weights `weights`, equal by default) with `opts`, painted on a flat area `tiles` a side: the area, its
 *  plan (the textures at palette indices 1, 2, …; 0 is the ground's own grass). */
function setup(ids, { weights, tiles = 8, ...opts } = {}) {
    let mix = { ...newMix(), on: true, ...opts };
    for (const id of ids) mix = withTexture(mix, id);
    if (weights) for (const [k, id] of ids.entries()) mix = withWeight(mix, id, weights[k]);
    const area = Area.create('mix', tiles, 'flat', 5);
    const plan = mixPlan(
        mix,
        ids.map(id => area.materialIndex(id)),
    );
    return { area, plan, mix };
}

/** How many samples hold each palette index. */
function counts(area) {
    const c = new Map();
    for (const m of area.materials) c.set(m, (c.get(m) ?? 0) + 1);
    return c;
}

/** Paints the whole area (every sample) with `plan` at `strength`, in brush dabs. */
function paintAll(area, plan, strength = 1) {
    for (let y = 0; y <= area.sizeY; y += 10) for (let x = 0; x <= area.sizeX; x += 10) mixStamp(area, x, y, 9, strength, plan);
}

/** The share of side-by-side sample pairs that hold the same texture. */
function sameNeighbours(area) {
    let same = 0,
        all = 0;
    for (let j = 0; j < area.ny; j++) {
        for (let i = 0; i + 1 < area.nx; i++) {
            all++;
            if (area.materials[j * area.nx + i] === area.materials[j * area.nx + i + 1]) same++;
        }
    }
    return same / all;
}

test('equal weights share the ground about equally', () => {
    const { area, plan } = setup(['grassLong', 'sand', 'snow'], { patch: 2, soft: false, tiles: 16 });
    paintAll(area, plan);
    const c = counts(area);
    assert.equal(c.get(0), undefined, 'every sample painted at full strength');
    for (const k of [1, 2, 3]) {
        const share = c.get(k) / area.materials.length;
        assert.ok(Math.abs(share - 1 / 3) < 0.05, `texture ${k}: ${share.toFixed(3)}`);
    }
});

test('weights set the shares', () => {
    const { area, plan, mix } = setup(['grassLong', 'sand'], { weights: [2, 6], patch: 2, soft: false, tiles: 16 });
    assert.deepEqual(shares(mix), [0.25, 0.75]);
    paintAll(area, plan);
    const sand = counts(area).get(2) / area.materials.length;
    assert.ok(Math.abs(sand - 0.75) < 0.05, `sand ${sand.toFixed(3)}`);
});

test('the mix paints patches, not salt and pepper, and a bigger patch makes bigger ones', () => {
    const small = setup(['grassLong', 'sand', 'snow'], { patch: 1.5, soft: false });
    const big = setup(['grassLong', 'sand', 'snow'], { patch: 8, soft: false });
    paintAll(small.area, small.plan);
    paintAll(big.area, big.plan);
    // A sample picked at random from 3 equal textures matches its neighbour 1 time in 3.
    const s = sameNeighbours(small.area),
        b = sameNeighbours(big.area);
    assert.ok(s > 0.6, `1.5 m patches: ${s.toFixed(3)}`);
    assert.ok(b > 0.9, `8 m patches: ${b.toFixed(3)}`);
    assert.ok(b > s);
});

test('the same ground comes out the same on every pass, in any order', () => {
    const a = setup(['grassLong', 'sand', 'snow'], { patch: 4, soft: false });
    const b = setup(['grassLong', 'sand', 'snow'], { patch: 4, soft: false });
    // One stroke west to east, the other east to west, over the same ground: the same paint.
    for (let x = 5; x <= 75; x += 1.3) mixStamp(a.area, x, 40, 6, 1, a.plan);
    for (let x = 75; x >= 5; x -= 2.1) mixStamp(b.area, x, 40, 6, 1, b.plan);
    const inside = (area, k) => {
        const x = (k % area.nx) * SPACING,
            y = Math.floor(k / area.nx) * SPACING;
        return x >= 5 && x <= 75 && Math.abs(y - 40) <= 6;
    };
    for (let k = 0; k < a.area.materials.length; k++) {
        if (inside(a.area, k)) assert.equal(a.area.materials[k], b.area.materials[k], `sample ${k}`);
    }
    // A second pass, in other steps, changes nothing it passed over before.
    const before = a.area.materials.slice();
    for (let x = 5; x <= 73.9; x += 0.7) mixStamp(a.area, x, 40, 6, 1, a.plan);
    for (let k = 0; k < before.length; k++) if (before[k] !== 0) assert.equal(a.area.materials[k], before[k], `sample ${k}`);
});

test('another seed (Reshuffle) lays the patches out again', () => {
    const a = setup(['grassLong', 'sand', 'snow'], { patch: 4, soft: false, seed: 1 });
    const b = setup(['grassLong', 'sand', 'snow'], { patch: 4, soft: false, seed: 2 });
    paintAll(a.area, a.plan);
    paintAll(b.area, b.plan);
    let differ = 0;
    for (let k = 0; k < a.area.materials.length; k++) if (a.area.materials[k] !== b.area.materials[k]) differ++;
    assert.ok(differ / a.area.materials.length > 0.4, `${differ} differ`);
});

test('the strength is how much of the ground the mix covers, in patches, and repainting does not creep', () => {
    for (const strength of [0.25, 0.5, 0.8]) {
        const { area, plan } = setup(['sand'], { patch: 2, soft: false, tiles: 16 });
        paintAll(area, plan, strength);
        const covered = counts(area).get(1) / area.materials.length;
        assert.ok(Math.abs(covered - strength) < 0.06, `strength ${strength}: covered ${covered.toFixed(3)}`);
        // The uncovered ground is in patches too, and stays as it was however often the brush passes.
        const before = area.materials.slice();
        paintAll(area, plan, strength);
        assert.deepEqual(area.materials, before);
    }
    // A higher strength covers what a lower one did, and more.
    const lo = setup(['sand'], { patch: 2, soft: false });
    const hi = setup(['sand'], { patch: 2, soft: false });
    paintAll(lo.area, lo.plan, 0.3);
    paintAll(hi.area, hi.plan, 0.6);
    for (let k = 0; k < lo.area.materials.length; k++) if (lo.area.materials[k] === 1) assert.equal(hi.area.materials[k], 1);
});

test('a soft edge covers the middle of the brush and fades out by weight toward its rim, no specks; a hard one fills the circle', () => {
    // Sand's share of each sample (blend.js), by ring: the mean, the least and the most.
    const ring = (area, x, y, r0, r1) => {
        const shares = [];
        for (let j = 0; j < area.ny; j++) {
            for (let i = 0; i < area.nx; i++) {
                const d = Math.hypot(i * SPACING - x, j * SPACING - y);
                if (d < r0 || d >= r1) continue;
                const k = j * area.nx + i;
                shares.push(sampleMix(area.materials[k], area.blend[k]).find(([m]) => m !== 0)?.[1] ?? 0);
            }
        }
        return { mean: shares.reduce((a, b) => a + b, 0) / shares.length, least: Math.min(...shares), most: Math.max(...shares) };
    };
    const soft = setup(['sand'], { patch: 1.5, soft: true });
    mixStamp(soft.area, 40, 40, 16, 1, soft.plan);
    assert.equal(ring(soft.area, 40, 40, 0, 8).least, 1);
    const inner = ring(soft.area, 40, 40, 10, 13),
        rim = ring(soft.area, 40, 40, 13, 16);
    assert.ok(rim.mean > 0.05 && rim.mean < 0.5 && rim.mean < inner.mean, `rim ${rim.mean.toFixed(3)}, inside it ${inner.mean.toFixed(3)}`);
    const near = ring(soft.area, 40, 40, 13, 15.5);
    assert.ok(rim.most < 1 && near.least > 0, `rim from ${near.least} to ${rim.most}: every sample some sand, none all sand`);
    assert.equal(ring(soft.area, 40, 40, 16.5, 30).most, 0);
    const hard = setup(['sand'], { patch: 1.5, soft: false });
    mixStamp(hard.area, 40, 40, 16, 1, hard.plan);
    assert.equal(ring(hard.area, 40, 40, 0, 15.9).least, 1);
    assert.ok(
        hard.area.blend.every(v => v === 0),
        'a hard edge writes no weights',
    );
});

test('a stroke of mix dabs is one undo step', () => {
    const { area, plan } = setup(['grassLong', 'sand', 'snow'], { patch: 3 });
    const before = area.materials.slice();
    area.beginStroke();
    for (let x = 10; x <= 60; x += 2) mixStamp(area, x, 30, 5, 1, plan);
    assert.notDeepEqual(area.materials, before);
    const after = area.materials.slice();
    assert.equal(area.undo(), true);
    assert.deepEqual(area.materials, before);
    assert.equal(area.redo(), true);
    assert.deepEqual(area.materials, after);
});

test('clicks add and take out textures; Shift starts a mix with the texture painted with', () => {
    let mix = newMix();
    mix = toggledTexture(mix, 'sand');
    mix = toggledTexture(mix, 'snow');
    assert.deepEqual(
        mix.textures.map(t => t.id),
        ['sand', 'snow'],
    );
    mix = toggledTexture(mix, 'sand');
    assert.deepEqual(
        mix.textures.map(t => t.id),
        ['snow'],
    );
    // Off and empty: Shift-clicking sand while painting grass mixes the two, at equal weights.
    const started = shiftAdded(newMix(), 'sand', 'grassLong');
    assert.equal(started.on, true);
    assert.deepEqual(started.textures, [
        { id: 'grassLong', weight: mixjs.WEIGHT_DEFAULT },
        { id: 'sand', weight: mixjs.WEIGHT_DEFAULT },
    ]);
    // A mix there already only gains the texture.
    assert.deepEqual(
        shiftAdded(mix, 'sand', 'grassLong').textures.map(t => t.id),
        ['snow', 'sand'],
    );
    // Weights stay in range.
    assert.equal(withWeight(started, 'sand', 99).textures[1].weight, mixjs.WEIGHT_MAX);
    assert.equal(withWeight(started, 'sand', -3).textures[1].weight, mixjs.WEIGHT_MIN);
    // At most MIX_MAX textures.
    let full = newMix();
    for (let k = 0; k < 12; k++) full = withTexture(full, `t${k}`);
    assert.equal(full.textures.length, mixjs.MIX_MAX);
});

test('the mix kept in the browser reads back, without textures the library lost, and broken text gives a new mix', () => {
    const mix = withWeight(shiftAdded({ ...newMix(), patch: 7.5, soft: false, seed: 42 }, 'sand', 'grassLong'), 'sand', 3);
    const back = readMix(writeMix(mix));
    assert.deepEqual(back, mix);
    assert.deepEqual(
        readMix(writeMix(mix), id => id !== 'sand').textures.map(t => t.id),
        ['grassLong'],
    );
    assert.deepEqual(readMix('{not json'), newMix());
    assert.deepEqual(readMix(null), newMix());
    assert.equal(readMix(JSON.stringify({ patch: 500 })).patch, mixjs.PATCH_MAX);
    assert.deepEqual(
        keptTextures(mix, id => id === 'sand').textures.map(t => t.id),
        ['sand'],
    );
    assert.equal(
        keptTextures(mix, () => true),
        mix,
    );
});

test('a large brush paints quickly', () => {
    const { area, plan } = setup(['grassLong', 'sand', 'snow', 'dirt'], { patch: 4, tiles: 16 });
    const sand = area.materialIndex('sand');
    // Against the plain Paint brush over the same 7,200 samples (a 30 m brush), each the best of 15 taken in turn and in the
    // process's CPU time, so a slow or busy machine slows both alike and time spent waiting for a core counts for neither: wall
    // time alone failed whenever other work shared the machine. The mix costs about 20 to 29 plain dabs (each patch is a
    // nearest-cell search and two hashes); past 60 it has got slower than it should, toward a frame's 16 ms on a slow machine.
    const time = f => {
        const c0 = process.cpuUsage();
        f();
        const c = process.cpuUsage(c0);
        return (c.user + c.system) / 1000;
    };
    let mix = Infinity,
        plain = Infinity;
    for (let k = 0; k < 15; k++) {
        mix = Math.min(
            mix,
            time(() => mixStamp(area, 80, 80, 30, 1, plan)),
        );
        // (ten plain dabs a measurement: one is under a millisecond, near the timer's grain)
        plain = Math.min(
            plain,
            time(() => {
                for (let r = 0; r < 10; r++) stamp(area, 'paint', 80, 80, 30, 1, 1 / 60, undefined, sand);
            }) / 10,
        );
    }
    assert.ok(mix < 60 * plain, `a mix dab ${mix.toFixed(1)} ms, ${(mix / plain).toFixed(0)} plain dabs`);
});
