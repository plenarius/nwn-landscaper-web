// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Ambience tool's placements in the view (ambience.js): a few animated points each, in its kind's day or night colour, moving
// about as its particles will (mist rising slowly, leaves falling, snow and sand blowing along the placement's bearing). A kind
// out of its hours (fireflies by day, motes at night) isn't drawn, as in the game; while the tool is open it shows as a grey dot,
// so the brush can find it. A sketch of where particles go, not the game's look: the client draws the pack's emitters.

import * as THREE from 'three';
import { surfaceAt } from './ambience.js';

/** How each kind's points move: `n` points a placement, spread `spread` m round it, starting `lift` m up and rising `rise` m
 *  (falling when negative) over `period` s, `size` m across at `alpha`. `glow`: drawn adding light (fireflies, embers, motes);
 *  `wander`: drifting about; `blow`: carried that far along the placement's bearing; `lean`: along a light shaft leaning that
 *  way (the pack's shaft: 5.6 m over 12 m up). */
const STYLES = {
    mist: { n: 6, spread: 3, lift: 0.2, rise: 1.2, period: 9, size: 2.6, alpha: 0.35 },
    waterfall: { n: 10, spread: 1.2, lift: 0, rise: 1.8, period: 1.6, size: 0.35, alpha: 0.8 },
    rapids: { n: 6, spread: 0.8, lift: 0, rise: 0.6, period: 1.2, size: 0.25, alpha: 0.8 },
    fireflies: { n: 8, spread: 4, lift: 0.4, rise: 1.4, period: 5, size: 0.18, alpha: 1, glow: true, wander: true },
    motes: { n: 10, spread: 2.5, lift: 0.5, rise: 2.5, period: 8, size: 0.12, alpha: 0.8, glow: true, wander: true },
    leaves: { n: 4, spread: 2.5, lift: 4, rise: -4, period: 6, size: 0.22, alpha: 1, wander: true },
    snow: { n: 12, spread: 1.5, lift: 0.3, rise: 1.2, period: 2, size: 0.12, alpha: 0.9, blow: 6 },
    sand: { n: 8, spread: 1.5, lift: 0.05, rise: 0.5, period: 3, size: 0.5, alpha: 0.45, blow: 5 },
    embers: { n: 6, spread: 0.3, lift: 0.6, rise: 2.5, period: 2, size: 0.1, alpha: 1, glow: true },
    shafts: { n: 12, spread: 0.6, lift: 0, rise: 12, period: 20, size: 0.9, alpha: 0.22, glow: true, lean: 5.6 / 12 },
    groundfog: { n: 5, spread: 5, lift: 1, rise: 0.2, period: 14, size: 5, alpha: 0.3 },
};
const OTHER = { n: 6, spread: 2, lift: 0.5, rise: 1, period: 4, size: 0.4, alpha: 0.7 };
/** A placement out of its hours, or of a kind the pack lacks, while the tool is open. */
const MARK = { size: 0.7, alpha: 0.6, colour: new THREE.Color(0x9aa3ad) };

const VERTEX = `
    attribute float aSize;
    attribute float aAlpha;
    attribute vec3 aColour;
    uniform float uPx;
    varying float vAlpha;
    varying vec3 vColour;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPx / max(-mv.z, 0.1), 2.0, 256.0);
        vAlpha = aAlpha;
        vColour = aColour;
    }`;
const FRAGMENT = `
    varying float vAlpha;
    varying vec3 vColour;
    void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = vAlpha * (1.0 - smoothstep(0.35, 1.0, d));
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColour, a);
    }`;

/** A random number in [0, 1) from integer `n` (the same every time). */
function hash(n) {
    let t = (n + 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** One layer of points (soft or glowing), its arrays sized for `count`. */
function layer(scene, glow) {
    const material = new THREE.ShaderMaterial({
        uniforms: { uPx: { value: 500 } },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(new THREE.BufferGeometry(), material);
    // (the points move every frame; a bounding sphere worked out once would go stale)
    points.frustumCulled = false;
    points.renderOrder = 2;
    scene.add(points);
    return { points, list: [] };
}

/** The placements' points: `set` builds them for an area, `frame` moves them. */
export class AmbienceLayer {
    constructor(scene) {
        this.soft = layer(scene, false);
        this.glow = layer(scene, true);
    }

    /** Builds the points of `area`'s placements: `kinds` maps a kind's id to the pack's kind (ambience.js kindsOf), `night`
     *  whether the view shows night, `marking` whether to show the placements out of their hours as grey dots. */
    set(area, kinds, night, marking) {
        this.soft.list = [];
        this.glow.list = [];
        for (const p of area?.ambience ?? []) {
            const k = kinds.get(p.kind);
            const z = surfaceAt(area, p.x, p.y);
            const shown = k && (k.shows === 'always' || (k.shows === 'night') === night);
            if (!shown) {
                if (marking) this.soft.list.push({ x: p.x, y: p.y, z: z + 0.4, mark: true, colour: MARK.colour, size: MARK.size });
                continue;
            }
            const style = STYLES[p.kind] ?? OTHER;
            const colour = new THREE.Color(night ? k.night : k.day);
            const seed = (p.seed ?? 0) * 31;
            for (let n = 0; n < style.n; n++) {
                const r = [0, 1, 2, 3, 4].map(q => hash(seed + n * 7 + q));
                (style.glow ? this.glow : this.soft).list.push({
                    x: p.x,
                    y: p.y,
                    z,
                    bearing: p.bearing ?? 0,
                    style,
                    r,
                    colour,
                    size: style.size * (0.7 + 0.6 * r[3]),
                });
            }
        }
        this.sizeY = area?.sizeY ?? 0;
        for (const l of [this.soft, this.glow]) {
            const g = new THREE.BufferGeometry(),
                n = l.list.length;
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
            g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
            const size = new Float32Array(n),
                colour = new Float32Array(n * 3);
            l.list.forEach((q, k) => {
                size[k] = q.size;
                colour.set([q.colour.r, q.colour.g, q.colour.b], k * 3);
            });
            g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
            g.setAttribute('aColour', new THREE.BufferAttribute(colour, 3));
            l.points.geometry.dispose();
            l.points.geometry = g;
            l.points.visible = n > 0;
        }
        this.frame(this.time ?? 0);
    }

    /** Moves the points to time `t` (seconds); `px`: pixels a metre at 1 m from the camera. */
    frame(t, px) {
        this.time = t;
        for (const l of [this.soft, this.glow]) {
            if (!l.list.length) continue;
            if (px) l.points.material.uniforms.uPx.value = px;
            const pos = l.points.geometry.attributes.position,
                alpha = l.points.geometry.attributes.aAlpha;
            l.list.forEach((q, k) => {
                let x = q.x,
                    y = q.y,
                    z = q.z,
                    a = MARK.alpha;
                if (!q.mark) {
                    const s = q.style,
                        [r0, r1, r2, r3, r4] = q.r;
                    const f = (t / s.period + r0) % 1,
                        ang = r1 * Math.PI * 2,
                        d = s.spread * Math.sqrt(r2);
                    x += Math.cos(ang) * d;
                    y += Math.sin(ang) * d;
                    z += s.lift + s.rise * f;
                    if (s.wander) {
                        x += Math.sin(t * 0.7 + r3 * 6.3) * 0.6;
                        y += Math.cos(t * 0.5 + r4 * 6.3) * 0.6;
                    }
                    if (s.blow) {
                        const b = s.blow * (f - 0.5);
                        x += Math.cos(q.bearing) * b;
                        y += Math.sin(q.bearing) * b;
                    }
                    if (s.lean) {
                        x += Math.cos(q.bearing) * s.lean * s.rise * f;
                        y += Math.sin(q.bearing) * s.lean * s.rise * f;
                    }
                    a = s.alpha * Math.sin(Math.PI * f);
                }
                pos.setXYZ(k, x, z, this.sizeY - y);
                alpha.setX(k, a);
            });
            pos.needsUpdate = true;
            alpha.needsUpdate = true;
        }
    }
}
