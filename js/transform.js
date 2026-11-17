// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Moving, turning and sizing the selected placeable, the way Blender does it.
//
// Keyboard (selected object, Place tool): G grab, R rotate, S scale, then move the mouse with no
// button held; click or Enter confirms, Esc or right click cancels. X or Y locks a move to that
// axis (again: free). Type a number for an exact value (G X 2, R 45, S 1.5). Shift is fine
// control, Ctrl snaps. Mouse: the same three, from handles drawn on the object (two arrows, a
// square, a ring and a corner box): press on one and drag.
//
// Everything goes through one `begin(mode, axis)`; the handles call it with the button held.

import * as THREE from 'three';

const SNAP_MOVE = 0.5; // m
const SNAP_TURN = Math.PI / 36; // 5 degrees
const SNAP_SCALE = 0.1;
const FINE = 0.2; // Shift: a fifth of the movement
const SCALE_RANGE = [0.1, 5];

const LABEL = { move: 'Move', rotate: 'Turn', scale: 'Size' };

/** Moving, turning and sizing the selected object, from the keys and from its handles: see the top of this file. */
export class Transformer {
    /**
     * @param {object} d
     * @param {object} d.view  the 3D view (scene, camera, pick, selected, updateObjects, controls)
     * @param {() => object} d.area
     * @param {(o) => Promise<object>} d.flat  an object's model outline
     * @param {(o, flat) => number} d.settle  an object's height on the ground
     * @param {(msg: string) => void} d.say  the status line
     * @param {(o) => void} d.changed  called after a change (panel, autosave)
     */
    constructor(d) {
        Object.assign(this, d);
        this.mode = null;
        this.axis = null;
        this.typed = '';
        this.held = false; // started from a handle, button down
        this.group = null;
        this.mods = { shift: false, ctrl: false };
    }

    get active() {
        return this.mode !== null;
    }

    // --- The handles -------------------------------------------------------------------------------------------------

    /** Draws the handles at the selected object (or removes them). */
    show(o) {
        const view = this.view;
        if (this.group) {
            view.scene.remove(this.group);
            this.group = null;
        }
        if (!o) return;
        const g = new THREE.Group();
        this.group = g;
        const mat = color => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
        const add = (mesh, kind, axis) => {
            mesh.renderOrder = 999;
            mesh.userData.handle = { kind, axis };
            g.add(mesh);
            return mesh;
        };
        const arrow = (color, axis, dir) => {
            const a = new THREE.Group();
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), mat(color));
            shaft.position.y = 0.5;
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 12), mat(color));
            tip.position.y = 1.02;
            // The long, thin shaft is hard to hit: a fatter invisible one takes the clicks.
            const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2, 6), new THREE.MeshBasicMaterial({ visible: false }));
            hit.position.y = 0.65;
            for (const m of [shaft, tip, hit]) {
                m.renderOrder = 999;
                m.userData.handle = { kind: 'move', axis };
                a.add(m);
            }
            a.rotation.z = -Math.PI / 2; // +Y (the cylinder's axis) -> +X
            const holder = new THREE.Group();
            holder.add(a);
            holder.rotation.y = dir;
            g.add(holder);
        };
        arrow(0xe0402a, 'x', 0); // east
        arrow(0x55c24a, 'y', Math.PI / 2); // north (three -Z)
        add(new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), mat(0xffd34a)), 'move', null).rotation.x = -Math.PI / 2;
        g.children[g.children.length - 1].position.set(0.3, 0.02, -0.3);
        const ring = add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), mat(0x4a90ff)), 'rotate', null);
        ring.rotation.x = -Math.PI / 2;
        const ringHit = add(
            new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 6, 48), new THREE.MeshBasicMaterial({ visible: false })),
            'rotate',
            null,
        );
        ringHit.rotation.x = -Math.PI / 2;
        const box = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat(0xe8e8e8)), 'scale', null);
        box.position.set(0.95, 0, -0.95); // outside the ring, which would take the clicks
        view.scene.add(g);
        this.place(o);
    }

    /** Puts the handles where the object is, a size on screen that doesn't depend on distance. */
    place(o) {
        if (!this.group) return;
        const view = this.view;
        this.group.position.set(o.x, o.z + 0.05, view.area.sizeY - o.y);
        const d = view.camera.position.distanceTo(this.group.position);
        this.group.scale.setScalar(Math.max(0.6, d * 0.09));
    }

    /** The handle under the pointer, if any. */
    pickHandle(clientX, clientY) {
        if (!this.group) return null;
        const view = this.view;
        this.group.updateMatrixWorld(true); // (the last frame may predate the last move)
        const r = view.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        view.raycaster.setFromCamera(ndc, view.camera);
        const hits = view.raycaster.intersectObject(this.group, true);
        return hits[0]?.object.userData.handle ?? null;
    }

    // --- Starting, following, finishing ------------------------------------------------------------------------------

    /** Starts a transform of the selected object. `held`: from a handle, so releasing confirms. */
    begin(mode, axis = null, held = false, at = null) {
        const o = this.view.selected;
        if (!o || this.mode) return false;
        this.mode = mode;
        this.axis = axis;
        this.typed = '';
        this.held = held;
        this.o = o;
        this.orig = { x: o.x, y: o.y, bearing: o.bearing, scale: o.scale };
        // One undo step for the whole transform, kept when it is confirmed: a cancelled one leaves the undo and redo
        // history as it was.
        this.before = this.area().snapshot();
        this.view.controls.enabled = false; // no camera moves while the mouse drives the object
        this.start = at ?? this.ground(this.last ?? null);
        this.startAngle = this.start ? Math.atan2(this.start.y - o.y, this.start.x - o.x) : 0;
        this.startDist = this.start ? Math.max(0.3, Math.hypot(this.start.x - o.x, this.start.y - o.y)) : 1;
        this.say(this.text());
        return true;
    }

    ground(e) {
        if (!e) return null;
        const p = this.view.pick(e.clientX, e.clientY);
        return p ? { x: p.x, y: p.y } : null;
    }

    /** The pointer moved (button held or not). */
    move(e) {
        this.last = { clientX: e.clientX, clientY: e.clientY };
        this.mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
        if (!this.mode) return;
        if (!this.start) {
            this.start = this.ground(e);
            if (this.start) this.rebase();
            return;
        }
        if (this.typed !== '') return;
        const p = this.ground(e);
        if (!p) return;
        const o = this.o,
            k = this.mods.shift ? FINE : 1;
        if (this.mode === 'move') {
            let dx = (p.x - this.start.x) * k,
                dy = (p.y - this.start.y) * k;
            if (this.axis === 'x') dy = 0;
            if (this.axis === 'y') dx = 0;
            if (this.mods.ctrl) {
                dx = Math.round(dx / SNAP_MOVE) * SNAP_MOVE;
                dy = Math.round(dy / SNAP_MOVE) * SNAP_MOVE;
            }
            this.setPosition(this.orig.x + dx, this.orig.y + dy);
        } else if (this.mode === 'rotate') {
            let da = Math.atan2(p.y - o.y, p.x - o.x) - this.startAngle;
            da = Math.atan2(Math.sin(da), Math.cos(da)) * k; // the short way round
            if (this.mods.ctrl) da = Math.round(da / SNAP_TURN) * SNAP_TURN;
            o.bearing = this.orig.bearing + da;
        } else {
            const f = 1 + (Math.hypot(p.x - o.x, p.y - o.y) / this.startDist - 1) * k;
            let s = this.orig.scale * f;
            if (this.mods.ctrl) s = Math.round(s / SNAP_SCALE) * SNAP_SCALE;
            o.scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], s));
        }
        this.refresh();
    }

    rebase() {
        const o = this.o;
        this.startAngle = Math.atan2(this.start.y - o.y, this.start.x - o.x);
        this.startDist = Math.max(0.3, Math.hypot(this.start.x - o.x, this.start.y - o.y));
    }

    setPosition(x, y) {
        const a = this.area();
        this.o.x = Math.min(a.sizeX, Math.max(0, x));
        this.o.y = Math.min(a.sizeY, Math.max(0, y));
    }

    async refresh() {
        const o = this.o;
        o.z = this.settle(o, await this.flat(o));
        this.view.updateObjects();
        this.place(o);
        this.say(this.text());
        this.changed(o, false);
    }

    /** The key pressed during a transform: true if it was used. */
    key(e) {
        if (!this.mode) return false;
        const k = e.key;
        if (k === 'Escape') {
            this.cancel();
            return true;
        }
        if (k === 'Enter') {
            this.confirm();
            return true;
        }
        if (this.mode === 'move' && (k === 'x' || k === 'X' || k === 'y' || k === 'Y')) {
            const axis = k.toLowerCase();
            this.axis = this.axis === axis ? null : axis;
            this.reapply();
            return true;
        }
        if (/^[0-9.]$/.test(k) || (k === '-' && this.typed === '')) {
            this.typed += k;
            this.reapply();
            return true;
        }
        if (k === 'Backspace') {
            this.typed = this.typed.slice(0, -1);
            this.reapply();
            return true;
        }
        return k.length === 1 || k.startsWith('Arrow'); // nothing else while transforming
    }

    /** A typed value, or the pointer's again after the axis or the number changed. */
    reapply() {
        const o = this.o,
            v = parseFloat(this.typed);
        if (this.typed !== '' && Number.isFinite(v)) {
            if (this.mode === 'move') {
                if (this.axis === 'y') this.setPosition(this.orig.x, this.orig.y + v);
                else this.setPosition(this.orig.x + v, this.orig.y);
            } else if (this.mode === 'rotate') {
                o.bearing = this.orig.bearing + (v * Math.PI) / 180;
            } else {
                o.scale = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], v));
            }
        } else if (this.typed === '' || this.typed === '-') {
            // Back to where the mouse says.
            if (this.typed === '') {
                Object.assign(o, { x: this.orig.x, y: this.orig.y, bearing: this.orig.bearing, scale: this.orig.scale });
                if (this.last) this.move({ ...this.last, shiftKey: this.mods.shift, ctrlKey: this.mods.ctrl });
            }
        }
        this.refresh();
    }

    text() {
        const o = this.o;
        const typed = this.typed ? ` [${this.typed}]` : '';
        let now;
        if (this.mode === 'move')
            now = `${(o.x - this.orig.x).toFixed(2)} m east, ${(o.y - this.orig.y).toFixed(2)} m north${this.axis ? `, locked to ${this.axis.toUpperCase()}` : ''}`;
        else if (this.mode === 'rotate') now = `${(((((o.bearing - this.orig.bearing) * 180) / Math.PI + 540) % 360) - 180).toFixed(1)}°`;
        else now = `${o.scale.toFixed(2)}×`;
        const hints = this.mode === 'move' ? 'X/Y lock an axis · ' : '';
        return `${LABEL[this.mode]}: ${now}${typed} — ${hints}type a number · Shift fine · Ctrl snap · click or Enter to keep · Esc to cancel`;
    }

    confirm() {
        if (!this.mode) return;
        this.area().beginStroke(this.before);
        this.finish();
        this.say('');
        this.changed(this.o, true);
    }

    cancel() {
        if (!this.mode) return;
        const o = this.o;
        Object.assign(o, this.orig);
        this.finish();
        this.flat(o).then(f => {
            o.z = this.settle(o, f);
            this.view.updateObjects();
            this.place(o);
            this.changed(o, false);
        });
        this.say('');
    }

    finish() {
        this.mode = null;
        this.axis = null;
        this.typed = '';
        this.held = false;
        this.view.controls.enabled = true;
        this.before = null;
    }
}
