// SPDX-FileCopyrightText: Copyright (c) 2026 ergin3d
// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Seeded simplex noise in octaves: a new area's starting heights (area.js).
// ergin3d's file from https://github.com/ergin3d/heightmap-generator (MIT), the project this one was forked from.
// Changed here: simplex-noise comes through the page's import map; the map is `width` by `height` (it was square), and the pan
// and black and white levels are gone (the one caller passed 0, 0, 0 and 1). Biome formatted it and fixed its lint findings.

import { createNoise2D } from 'simplex-noise';

// Mulberry32 seeded PRNG - returns function () => [0, 1)
function mulberry32(seed) {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A height map from fractal Brownian motion (fBm): `width` by `height` values in rows of `width`, normalised to [0, 1] over the map.
 * `seed` picks the noise, `octaves` how many layers it adds, each `lacunarity` times finer than the last and `persistence` times
 * its strength; `scale` is the first layer's feature size, in samples.
 * @returns {Float32Array}
 */
export function generateHeightMap({ seed, width, height, octaves, persistence, lacunarity, scale }) {
    const prng = mulberry32(seed);
    const noise2D = createNoise2D(prng);

    const data = new Float32Array(width * height);
    let min = Infinity;
    let max = -Infinity;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let total = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxAmplitude = 0;

            for (let o = 0; o < octaves; o++) {
                const sx = (x / scale) * frequency;
                const sy = (y / scale) * frequency;
                total += noise2D(sx, sy) * amplitude;
                maxAmplitude += amplitude;
                amplitude *= persistence;
                frequency *= lacunarity;
            }

            const value = total / maxAmplitude; // [-1, 1]
            data[y * width + x] = value;

            if (value < min) min = value;
            if (value > max) max = value;
        }
    }

    // Normalize to [0, 1]
    const range = max - min || 1;
    for (let i = 0; i < data.length; i++) {
        data[i] = (data[i] - min) / range;
    }

    return data;
}
