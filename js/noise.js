import { createNoise2D } from '../vendor/simplex-noise/simplex-noise.js';

// Mulberry32 seeded PRNG - returns function () => [0, 1)
function mulberry32(seed) {
    return function () {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Generate a height map using fractal Brownian motion (fBm).
 * @param {Object} params
 * @returns {Float32Array} height values normalized to [0, 1]
 */
export function generateHeightMap(params) {
    const { seed, mapSize, octaves, persistence, lacunarity, scale, panX, panY } = params;

    const prng = mulberry32(seed);
    const noise2D = createNoise2D(prng);

    const data = new Float32Array(mapSize * mapSize);
    let min = Infinity;
    let max = -Infinity;

    for (let y = 0; y < mapSize; y++) {
        for (let x = 0; x < mapSize; x++) {
            let total = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxAmplitude = 0;

            for (let o = 0; o < octaves; o++) {
                const sx = ((x + panX) / scale) * frequency;
                const sy = ((y + panY) / scale) * frequency;
                total += noise2D(sx, sy) * amplitude;
                maxAmplitude += amplitude;
                amplitude *= persistence;
                frequency *= lacunarity;
            }

            const value = total / maxAmplitude; // [-1, 1]
            const idx = y * mapSize + x;
            data[idx] = value;

            if (value < min) min = value;
            if (value > max) max = value;
        }
    }

    // Normalize to [0, 1]
    const range = max - min || 1;
    for (let i = 0; i < data.length; i++) {
        data[i] = (data[i] - min) / range;
    }

    // Apply black/white level adjustment
    const { blackLevel, whiteLevel } = params;
    if (blackLevel > 0 || whiteLevel < 1) {
        const lvlRange = whiteLevel - blackLevel || 0.001;
        for (let i = 0; i < data.length; i++) {
            data[i] = Math.max(0, Math.min(1, (data[i] - blackLevel) / lvlRange));
        }
    }

    return data;
}
