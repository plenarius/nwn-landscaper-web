// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Triplanar texturing, as landscaper draws a library texture in the game (its triplanar.rs, the shader ls_tp_fs, and the tiles it
// bakes): the texture from three sides at once (along x, along y and from above), blended by which way the ground faces, so it
// keeps its size on every slope from every direction. Drawn from above only, it stretched 1.6 times on the steepest walkable
// ground; drawn along x + y, as steep ground had it, it smeared into streaks on ground facing north-east or south-west.
//
// Area frame here: x east, y north, z up (metres). The view's texture array runs its rows top first, the game's bottom first, so
// the view negates v (GLSL below); the functions here give the game's coordinates.

/** Metres one texture repeat covers (landscaper's TEXTURE_METRES), unless its catalog entry's `metres` says more (metresOf). */
export const TEXTURE_METRES = 4;

/** The metres one repeat of a catalog entry's picture covers: its `metres` (1 to 64; the starter set's cliff rock has 8, its fine
 *  layers at 4 m blurring into streaks up a tall wall), else TEXTURE_METRES. As landscaper's paint.rs, `metres_of`. */
export const metresOf = entry => {
    const m = entry?.metres;
    return typeof m === 'number' && m >= 1 && m <= 64 ? m : TEXTURE_METRES;
};

/** How sharply the projections blend: each weighs as the normal's part along its axis to this power (landscaper's SHARPNESS). With 4,
 *  ground at 45 degrees takes the top and a side evenly, and ground 30 degrees from flat takes 90% from the top. */
export const SHARPNESS = 4;

/** The weights of the projections along x, along y and from above, summing to 1, for ground facing `n` ([x, y, z], unit or not). */
export const weights = n => {
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len === 0) return [0, 0, 1];
    const w = n.map(c => Math.abs(c / len) ** SHARPNESS);
    const sum = w[0] + w[1] + w[2];
    return w.map(c => c / sum);
};

/** The texture coordinates of area point `p` ([x, y, z], metres) in projection `axis` (0 along x, 1 along y, 2 from above), in
 *  repeats of `metres` (the texture's, metresOf), as the game has them: (y, z), (x, z), (x, y). */
export const uv = (axis, p, metres = TEXTURE_METRES) => {
    const [x, y, z] = p.map(c => c / metres);
    return axis === 0 ? [y, z] : axis === 1 ? [x, z] : [x, y];
};

/** A natural texture's repeat varied, as landscaper's triplanar.rs has it (`varied`, `shade`; hex tiling after Mikkelsen's
 *  "Practical Real-Time Hex-Tiling", 2022): each projection split into hex cells, each drawing the picture shifted by its own
 *  offset, the three round a point blended by their shares; and a slow change of brightness. The same numbers as landscaper's. */
export const VARY_CELLS = 1.5;
export const VARY_SHARPNESS = 14;
export const VARY_LIGHT = 0.25;
export const VARY_SHADE = 0.07;
export const SKEW = [0.57735027, 1.1547005];
export const OFFSET = [
    [1.7, 3.1, 0.0],
    [2.3, -1.3, 0.7],
];
export const SHADE_WAVES = [
    [0.13, 0.07, 0.05, 0.0],
    [-0.06, 0.11, 0.09, 2.1],
];

/** Hex cells to a repeat a catalog entry's features are varied by: VARY_CELLS times its picture's own repeats, for natural
 *  ground and rock (its `vary`, else a broken edge, `edge`) and 0 for laid surfaces, as landscaper's paint.rs (`Repeat::of`). */
export const varyOf = (entry, edge) => {
    const on = typeof entry?.vary === 'boolean' ? entry.vary : edge === 'broken';
    const r = entry?.repeats;
    return on ? VARY_CELLS * (Number.isInteger(r) && r >= 1 && r <= 4 ? r : 1) : 0;
};

/** A cell's offset (repeats) from its whole-number coordinates. */
export const cellOffset = v => OFFSET.map(([a, b, c]) => Math.sin(v[0] * a + v[1] * b + c));

/** The three hex cells round texture point `uv` (`cells` a repeat), by slot (a cell's x + 2y modulo 3): [cell, share]. */
export const hexCells = (uv, cells) => {
    const [su, sv] = [uv[0] * cells, uv[1] * cells];
    const k = [su - SKEW[0] * sv, SKEW[1] * sv];
    const b = [Math.floor(k[0]), Math.floor(k[1])];
    const f = [k[0] - b[0], k[1] - b[1]];
    const fz = 1 - f[0] - f[1];
    const s = fz < 0 ? 1 : 0;
    const s2 = 2 * s - 1;
    const w = [-fz * s2, s - f[1] * s2, s - f[0] * s2];
    const v = [
        [b[0] + s, b[1] + s],
        [b[0] + s, b[1] + 1 - s],
        [b[0] + 1 - s, b[1] + s],
    ];
    const out = [];
    v.forEach((c, i) => {
        out[(((c[0] + 2 * c[1]) % 3) + 3) % 3] = [c, Math.max(w[i], 0)];
    });
    return out;
};

/** The varied colour at `uv`: `tap(u, v)` at the three cells' offsets, blended by their shares to VARY_SHARPNESS, the brighter
 *  winning. */
export const varied = (uv, cells, tap) => {
    const sum = [0, 0, 0];
    let total = 0;
    for (const [v, w] of hexCells(uv, cells)) {
        const o = cellOffset(v);
        const c = tap(uv[0] + o[0], uv[1] + o[1]);
        const weight = w ** VARY_SHARPNESS * (VARY_LIGHT + 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]);
        for (let k = 0; k < 3; k++) sum[k] += c[k] * weight;
        total += weight;
    }
    return sum.map(c => c / Math.max(total, Number.MIN_VALUE));
};

/** The slow change of a varied texture's brightness at area point `p` (metres), a factor about 1. */
export const shade = p =>
    1 + VARY_SHADE * SHADE_WAVES.reduce((t, [a, b, c, d]) => t + 0.5 * Math.sin(a * p[0] + b * p[1] + c * p[2] + d), 0);

const g = v => v.toFixed(8);

/** GLSL (global): `vec4 triVaried(vec2 uv, float layer, float cells)`, the varied (or, with `cells` 0, plain) colour of layer
 *  `layer` of uTex at the game's texture point `uv` (v up; the array's rows run the other way), and `float triShade(vec3 p)`. A
 *  slot changes cell only where its share is 0, so the texture's mipmaps never jump. */
export const variedGlsl = `
float triClass(vec2 v) { float c = v.x + 2.0 * v.y; return c - 3.0 * floor((c + 0.5) / 3.0); }
vec4 triTap(vec2 uv, float layer) { return texture(uTex, vec3(uv.x, -uv.y, layer)); }
vec4 triVaried(vec2 uv, float layer, float cells) {
    if (cells <= 0.0) return triTap(uv, layer);
    vec2 su = uv * cells;
    vec2 k = vec2(su.x - ${g(SKEW[0])} * su.y, ${g(SKEW[1])} * su.y);
    vec2 b = floor(k);
    vec2 f = k - b;
    float fz = 1.0 - f.x - f.y;
    float s = 1.0 - step(0.0, fz);
    float s2 = 2.0 * s - 1.0;
    vec3 w = vec3(-fz * s2, s - f.y * s2, s - f.x * s2);
    vec2 v1 = b + vec2(s, s), v2 = b + vec2(s, 1.0 - s), v3 = b + vec2(1.0 - s, s);
    vec3 cls = vec3(triClass(v1), triClass(v2), triClass(v3));
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = 0; i < 3; i++) {
        vec3 e = vec3(1.0) - step(vec3(0.5), abs(cls - vec3(float(i))));
        vec2 v = v1 * e.x + v2 * e.y + v3 * e.z;
        vec4 c = triTap(uv + vec2(${OFFSET.map(([a, b2, c]) => `sin(v.x * ${g(a)} + v.y * ${g(b2)} + ${g(c)})`).join(', ')}), layer);
        float weight = pow(max(dot(w, e), 0.0), ${g(VARY_SHARPNESS)}) * (${g(VARY_LIGHT)} + dot(c.rgb, vec3(0.3, 0.59, 0.11)));
        sum += c * weight;
        total += weight;
    }
    return sum / max(total, 1e-6);
}
float triShade(vec3 p) {
    return 1.0 + ${g(VARY_SHADE)} * (${SHADE_WAVES.map(([a, b, c, d]) => `0.5 * sin(p.x * ${g(a)} + p.y * ${g(b)} + p.z * ${g(c)} + ${g(d)})`).join(' + ')});
}`;

/** Where the face's own normal and the smoothed `normal` agree this closely (the cosine between them), the weights take the
 *  smoothed one, so rolling ground blends smoothly; where they part (floor meeting a wall, a cliff's foot), the face's own, as
 *  landscaper's export blends by the ground's own slope there (its triplanar.rs, `blend_normal`). */
export const CREASE = [0.9, 0.98];

/**
 * GLSL for a fragment shader's main(): the weights `triW` from the varying `normal` (area frame) and the macro `TRIPLANAR(layer)`,
 * layer `layer` of the sampler2DArray `uTex` drawn from three sides at the area point (`area`, a vec2, and `up`, its height), a
 * repeat every `TRI_METRES(layer)` metres and varied by `TRI_VARY(layer)` hex cells a repeat (macros the shader defines before
 * this; else TEXTURE_METRES and 0), with variedGlsl among its functions.
 * At a crease the face's own normal (from the area point's screen derivatives) takes over from the smoothed one: blended by the
 * smoothed normal, flat floor at a wall's foot took the side's projection and smeared into stripes, the wall's foot the one from
 * above.
 */
export const triplanarGlsl = (normal, area, up) => `
        vec3 triS = normalize(${normal});
        vec3 triF = cross(dFdx(vec3(${area}, ${up})), dFdy(vec3(${area}, ${up})));
        vec3 triN = dot(triF, triF) > 0.0 ? normalize(triF) : triS;
        triN = mix(triN, triS, smoothstep(${CREASE[0].toFixed(2)}, ${CREASE[1].toFixed(2)}, abs(dot(triN, triS))));
        vec3 triW = pow(abs(triN), vec3(${SHARPNESS.toFixed(1)}));
        triW /= triW.x + triW.y + triW.z;
        vec2 triX = vec2(${area}.y, ${up});
        vec2 triY = vec2(${area}.x, ${up});
        vec2 triZ = vec2(${area}.x, ${area}.y);
        vec3 triP = vec3(${area}, ${up});
        #ifndef TRI_METRES
        #define TRI_METRES(layer) ${TEXTURE_METRES.toFixed(1)}
        #endif
        #ifndef TRI_VARY
        #define TRI_VARY(layer) 0.0
        #endif
        #define TRIPLANAR(layer) ((${['x', 'y', 'z'].map(a => `triVaried(tri${a.toUpperCase()} / TRI_METRES(layer), layer, TRI_VARY(layer)) * triW.${a}`).join(' + ')}) * (TRI_VARY(layer) > 0.0 ? triShade(triP) : 1.0))`;
