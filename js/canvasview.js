// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// How a canvas is drawn (the engine's docs/DESIGN-canvas-cut.md, question 1, option A): a window of it at full detail (the view's
// own mesh, at most WINDOW_TILES a side) and the whole canvas at a quarter of the detail, a vertex every 2.5 m (Coarse), with a
// hole where the window is. The two share every fourth sample on the window's edge, and the window's edge samples between those
// are drawn on the straight line between them, so no crack opens along it.

import * as THREE from 'three';
import { SPACING, TILE } from './area.js';
import { groundNormals } from './normals.js';

/** Samples a quarter-detail vertex stands apart each way (2.5 m). */
export const QUARTER = 4;
/** The full-detail window's most tiles a side: a 32-tile piece and an 8-tile ring round it (question 1). */
export const WINDOW_TILES = 48;
/** The window moves in steps of this many tiles, so it isn't made again at every turn of the camera. */
const WINDOW_STEP = 8;
const PER_TILE = TILE / SPACING;

/** All of area `a` as the window: an area is drawn whole at full detail. */
export const wholeWindow = a => ({ i0: 0, j0: 0, nx: a.nx, ny: a.ny });

/** The window for canvas `a` round area point (x, y): WINDOW_TILES a side (less on a smaller canvas), on tile lines in steps of
 *  WINDOW_STEP, within the canvas. */
export function windowAt(a, x, y) {
    const side = (tiles, at) => {
        const n = Math.min(tiles, WINDOW_TILES),
            start = Math.round((at / TILE - n / 2) / WINDOW_STEP) * WINDOW_STEP;
        return [Math.max(0, Math.min(tiles - n, start)), n];
    };
    const [tx, wx] = side(a.tiles, x),
        [ty, wy] = side(a.tilesY, y);
    return { i0: tx * PER_TILE, j0: ty * PER_TILE, nx: wx * PER_TILE + 1, ny: wy * PER_TILE + 1 };
}

/** The canvas at a quarter of the detail: a mesh of every QUARTER-th sample in the view's ground material, its cells under the
 *  full-detail window left out. */
export class Coarse {
    constructor(view) {
        this.view = view;
        const a = view.area;
        this.nx = (a.nx - 1) / QUARTER + 1;
        this.ny = (a.ny - 1) / QUARTER + 1;
        const n = this.nx * this.ny,
            geo = new THREE.BufferGeometry();
        const attr = (size, fill = 0) => new THREE.BufferAttribute(new Float32Array(n * size).fill(fill), size);
        geo.setAttribute('position', attr(3));
        geo.setAttribute('normal', attr(3));
        geo.setAttribute('color', attr(3, 1));
        geo.setAttribute('aGap', attr(1, 1e9));
        geo.setAttribute('aDeep', attr(1));
        geo.setAttribute('aUp', attr(1, 1));
        geo.setAttribute('aShift', attr(2));
        geo.setAttribute('aWall', attr(2));
        const pos = geo.attributes.position;
        for (let cj = 0, v = 0; cj < this.ny; cj++)
            for (let ci = 0; ci < this.nx; ci++, v++) pos.setXYZ(v, ci * QUARTER * SPACING, 0, a.sizeY - cj * QUARTER * SPACING);
        this.mesh = new THREE.Mesh(geo, view.mesh.material);
        this.mesh.receiveShadow = true;
        // (its box is kept by hand: the ground moves under strokes)
        this.mesh.frustumCulled = false;
        // The drawn heights' lowest and highest, for picking (grown as the ground moves, as updateBounds does).
        this.box = new THREE.Box3(new THREE.Vector3(0, Infinity, 0), new THREE.Vector3(a.sizeX, -Infinity, a.sizeY));
        view.scene.add(this.mesh);
        this.setHole(view.win);
    }

    dispose() {
        this.view.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
    }

    /** Leaves out the cells under window `win` (null: none, the whole canvas at a quarter). */
    setHole(win) {
        const { nx, ny } = this,
            out = new Uint32Array((nx - 1) * (ny - 1) * 6);
        let k = 0;
        for (let cj = 0; cj < ny - 1; cj++)
            for (let ci = 0; ci < nx - 1; ci++) {
                const i = ci * QUARTER,
                    j = cj * QUARTER;
                if (win && i >= win.i0 && i + QUARTER <= win.i0 + win.nx - 1 && j >= win.j0 && j + QUARTER <= win.j0 + win.ny - 1) continue;
                const a = cj * nx + ci;
                // Counter-clockwise from above, as the band's (rows from the south).
                out.set([a, a + 1, a + nx + 1, a, a + nx + 1, a + nx], k);
                k += 6;
            }
        this.mesh.geometry.setIndex(new THREE.BufferAttribute(out.subarray(0, k), 1));
        this.hole = win;
    }

    /** Samples `r` (i0..i1, j0..j1) changed: the quarter-detail vertices they reach drawn again, only those sent to the GPU. */
    update(r) {
        const view = this.view,
            a = view.area,
            drawn = view.drawn,
            deep = view.chasmFit?.deep,
            geo = this.mesh.geometry,
            { position: pos, normal: nor, color: col, aDeep: dark, aUp: up } = geo.attributes,
            c = new THREE.Color();
        // (a normal reaches REACH samples: one quarter vertex further each way covers it)
        const ci0 = Math.max(0, Math.floor(r.i0 / QUARTER) - 1),
            ci1 = Math.min(this.nx - 1, Math.ceil(r.i1 / QUARTER) + 1),
            cj0 = Math.max(0, Math.floor(r.j0 / QUARTER) - 1),
            cj1 = Math.min(this.ny - 1, Math.ceil(r.j1 / QUARTER) + 1);
        for (let cj = cj0; cj <= cj1; cj++)
            for (let ci = ci0; ci <= ci1; ci++) {
                const v = cj * this.nx + ci,
                    i = ci * QUARTER,
                    j = cj * QUARTER,
                    k = j * a.nx + i,
                    y = drawn[k];
                pos.setY(v, y);
                if (y < this.box.min.y) this.box.min.y = y;
                if (y > this.box.max.y) this.box.max.y = y;
                dark.setX(v, deep ? deep[k] : 0);
                view.colourOf(i, j, c);
                col.setXYZ(v, c.r, c.g, c.b);
            }
        // The full-detail normal at each quarter vertex: the window's edge shares them, so the light doesn't step there.
        groundNormals(
            (i, j) => drawn[j * a.nx + i],
            a.nx,
            a.ny,
            SPACING,
            ci0 * QUARTER,
            ci1 * QUARTER,
            cj0 * QUARTER,
            cj1 * QUARTER,
            (i, j, n, near) => {
                if (i % QUARTER || j % QUARTER) return;
                const v = (j / QUARTER) * this.nx + i / QUARTER;
                nor.setXYZ(v, n[0], n[2], -n[1]);
                up.setX(v, near[2]);
            },
        );
        const first = cj0 * this.nx + ci0,
            count = (cj1 - cj0) * this.nx + ci1 - ci0 + 1;
        for (const at of [pos, nor, col, dark, up]) {
            at.needsUpdate = true;
            at.addUpdateRange(first * at.itemSize, count * at.itemSize);
        }
    }

    /** The window's edge samples between quarter vertices (within `r`, the window's samples flush drew) put on the straight
     *  line between their two quarter vertices, where the quarter mesh meets it: no crack between the two. `pos`: the window
     *  mesh's positions. */
    seal(pos, r) {
        const view = this.view,
            w = view.win,
            a = view.area,
            drawn = view.drawn;
        if (!this.hole || r.i0 > r.i1) return;
        const line = (k0, k1, t) => drawn[k0] + (drawn[k1] - drawn[k0]) * t;
        const edgeI = [w.i0 > 0 && w.i0, w.i0 + w.nx - 1 < a.nx - 1 && w.i0 + w.nx - 1],
            edgeJ = [w.j0 > 0 && w.j0, w.j0 + w.ny - 1 < a.ny - 1 && w.j0 + w.ny - 1];
        for (const i of edgeI) {
            if (i === false || i < r.i0 || i > r.i1) continue;
            for (let j = r.j0; j <= r.j1; j++) {
                const m = j % QUARTER;
                if (!m) continue;
                const j0 = j - m;
                pos.setY(view.vertex(i, j), line(j0 * a.nx + i, (j0 + QUARTER) * a.nx + i, m / QUARTER));
            }
        }
        for (const j of edgeJ) {
            if (j === false || j < r.j0 || j > r.j1) continue;
            for (let i = r.i0; i <= r.i1; i++) {
                const m = i % QUARTER;
                if (!m) continue;
                const i0 = i - m;
                pos.setY(view.vertex(i, j), line(j * a.nx + i0, j * a.nx + i0 + QUARTER, m / QUARTER));
            }
        }
    }
}
