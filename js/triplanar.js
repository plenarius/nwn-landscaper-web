// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Triplanar texturing, as landscaper draws a library texture in the game (its triplanar.rs, the shader ls_tp_fs, and the tiles it
// bakes): the texture from three sides at once (along x, along y and from above), blended by which way the ground faces, so it
// keeps its size on every slope from every direction. Drawn from above only, it stretched 1.6 times on the steepest walkable
// ground; drawn along x + y, as steep ground had it, it smeared into streaks on ground facing north-east or south-west.
//
// Area frame here: x east, y north, z up (metres). The view's texture array runs its rows top first, the game's bottom first, so
// the view negates v (GLSL below); the functions here give the game's coordinates.

/** Metres one texture repeat covers (landscaper's TEXTURE_METRES). */
export const TEXTURE_METRES = 4;

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
 *  repeats, as the game has them: (y, z), (x, z), (x, y). */
export const uv = (axis, p) => {
    const [x, y, z] = p.map(c => c / TEXTURE_METRES);
    return axis === 0 ? [y, z] : axis === 1 ? [x, z] : [x, y];
};

/** Where the face's own normal and the smoothed `normal` agree this closely (the cosine between them), the weights take the
 *  smoothed one, so rolling ground blends smoothly; where they part (floor meeting a wall, a cliff's foot), the face's own, as
 *  landscaper's export blends by the ground's own slope there (its triplanar.rs, `blend_normal`). */
export const CREASE = [0.9, 0.98];

/**
 * GLSL for a fragment shader's main(): the weights `triW` from the varying `normal` (area frame) and the macro `TRIPLANAR(layer)`,
 * layer `layer` of the sampler2DArray `uTex` drawn from three sides at the area point (`area`, a vec2, and `up`, its height).
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
        vec2 triX = vec2(${area}.y, -${up}) / ${TEXTURE_METRES.toFixed(1)};
        vec2 triY = vec2(${area}.x, -${up}) / ${TEXTURE_METRES.toFixed(1)};
        vec2 triZ = vec2(${area}.x, -${area}.y) / ${TEXTURE_METRES.toFixed(1)};
        #define TRIPLANAR(layer) (${['x', 'y', 'z'].map(a => `texture(uTex, vec3(tri${a.toUpperCase()}, layer)) * triW.${a}`).join(' + ')})`;
