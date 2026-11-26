// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Doors and placeables in the Things tool: each blueprint's model asked for once (an imported area has hundreds of doors), and
// the Place tool's move and turn code working on a door, which has no size.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from './browser.js';

const THREE = await import('three');
const { blueprintModel } = await import('../js/preview.js');
const { Transformer } = await import('../js/transform.js');

test("a blueprint's model is asked for once, however many doors have it, and one it can't name is none", async () => {
    engine.reset();
    let asked = 0;
    engine.routes.set('GET /api/blueprint-model', u => {
        asked++;
        return u.searchParams.get('resref') === 'gone' ? [{ error: 'no door blueprint gone' }, 404] : [{ model: 'door_iron' }];
    });
    const all = await Promise.all(Array.from({ length: 300 }, () => blueprintModel('door', 'iron_door')));
    assert.ok(all.every(m => m === 'door_iron'));
    assert.equal(asked, 1);
    assert.equal(await blueprintModel('door', 'gone'), null);
    assert.equal(await blueprintModel('door', 'gone'), null);
    assert.equal(asked, 2, "a blueprint the engine hasn't is not asked for again");
});

test('a model the engine could not be asked for is asked for again', async () => {
    engine.reset();
    let down = true;
    engine.routes.set('GET /api/blueprint-model', () => (down ? [{ error: 'busy' }, 500] : [{ model: 'tn_gdoor_04' }]));
    assert.equal(await blueprintModel('door', 'busy_door'), undefined);
    down = false;
    assert.equal(await blueprintModel('door', 'busy_door'), 'tn_gdoor_04');
});

/** A Transformer as the Things tool makes it, over a stand-in view, moving `door` (a thing) and saying what it moved. */
function doorHandles(door) {
    const view = {
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        area: { sizeY: 32 },
        controls: { enabled: true },
        pick: () => null,
    };
    const undo = [];
    const area = { sizeX: 32, sizeY: 32, snapshot: () => ({ ...door }), beginStroke: s => undo.push(s) };
    const handle = { x: door.x, y: door.y, z: 0, bearing: door.bearing, scale: 1 };
    const moved = [];
    const t = new Transformer({
        view,
        area: () => area,
        selected: () => handle,
        flat: async () => null,
        settle: () => 1.5,
        moved: o => {
            Object.assign(door, { x: o.x, y: o.y, bearing: o.bearing });
            moved.push(o.z);
        },
        say: () => {},
        changed: () => {},
        sizes: false,
    });
    return { t, view, undo, moved };
}
const tick = () => new Promise(r => setTimeout(r));
const press = (t, ...keys) => {
    for (const key of keys) t.key({ key });
};

test('a door is moved and turned by the handles and keys, has no size, and a cancelled turn puts it back', async () => {
    const door = { id: 4, kind: 'door', x: 10, y: 12, bearing: 0 };
    const { t, view, undo, moved } = doorHandles(door);
    t.show({ x: 10, y: 12, z: 0 });
    const kinds = [];
    t.group.traverse(m => m.userData.handle && kinds.push(m.userData.handle.kind));
    assert.ok(kinds.includes('move') && kinds.includes('rotate'));
    assert.ok(!kinds.includes('scale'), 'no size handle');
    assert.equal(t.begin('scale'), false);
    assert.ok(t.begin('rotate'));
    assert.equal(view.controls.enabled, false);
    press(t, '9', '0');
    await tick();
    assert.ok(Math.abs(door.bearing - Math.PI / 2) < 1e-9);
    assert.equal(moved.at(-1), 1.5, 'stood on the ground');
    press(t, 'Escape');
    await tick();
    assert.equal(door.bearing, 0);
    assert.equal(undo.length, 0, 'a cancelled turn takes no undo step');
    assert.ok(t.begin('move'));
    press(t, '2', 'Enter');
    await tick();
    assert.equal(door.x, 12);
    assert.deepEqual(undo, [{ id: 4, kind: 'door', x: 10, y: 12, bearing: 0 }], 'one undo step, back to where it was');
});
