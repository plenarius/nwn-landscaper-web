import { createNoise2D } from '../vendor/simplex-noise/simplex-noise.js';

/**
 * Apply a terrain filter to heightData in-place.
 * @param {Float32Array} data - height values [0,1]
 * @param {number} size - map width/height
 * @param {string} type - filter name
 * @param {number} strength - 0..1
 */
export function applyFilter(data, size, type, strength) {
    switch (type) {
        case 'smooth':
            return smooth(data, size, strength);
        case 'sharpen':
            return sharpen(data, size, strength);
        case 'erode':
            return erode(data, size, strength);
        case 'terrace':
            return terrace(data, size, strength);
        case 'ridged':
            return ridged(data, size, strength);
        case 'invert':
            return invert(data, size, strength);
        case 'clamp':
            return clamp(data, size, strength);
        case 'normalize':
            return normalize(data, size, strength);
        case 'noise':
            return addNoise(data, size, strength);
        case 'hydraulic':
            return hydraulic(data, size, strength);
        default:
            return;
    }
}

function idx(x, y, size) {
    return Math.max(0, Math.min(size - 1, y)) * size + Math.max(0, Math.min(size - 1, x));
}

/**
 * Gaussian-like blur — averages neighbors. Multiple passes for stronger effect.
 */
function smooth(data, size, strength) {
    const passes = Math.max(1, Math.round(strength * 8));
    const copy = new Float32Array(data.length);

    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const c = data[idx(x, y, size)];
                const n = data[idx(x, y - 1, size)];
                const s = data[idx(x, y + 1, size)];
                const w = data[idx(x - 1, y, size)];
                const e = data[idx(x + 1, y, size)];
                const nw = data[idx(x - 1, y - 1, size)];
                const ne = data[idx(x + 1, y - 1, size)];
                const sw = data[idx(x - 1, y + 1, size)];
                const se = data[idx(x + 1, y + 1, size)];
                copy[idx(x, y, size)] = (c * 4 + n + s + w + e + nw * 0.5 + ne * 0.5 + sw * 0.5 + se * 0.5) / 10;
            }
        }
        data.set(copy);
    }
}

/**
 * Sharpen — enhances edges by subtracting blurred version.
 */
function sharpen(data, size, strength) {
    const blurred = new Float32Array(data);
    smooth(blurred, size, 0.2); // light blur

    const amount = strength * 2;
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.max(0, Math.min(1, data[i] + (data[i] - blurred[i]) * amount));
    }
}

/**
 * Thermal erosion — material flows from steep to low neighbors.
 * Uses its own UI settings for iterations, talus, transfer rate, and radius.
 */
function erode(data, size, strength) {
    const iterations = parseInt(document.getElementById('erodeIterations').value, 10);
    const talus = parseFloat(document.getElementById('erodeTalus').value);
    const transferRate = parseFloat(document.getElementById('erodeTransfer').value);
    const radius = parseInt(document.getElementById('erodeRadius').value, 10);

    const passes = Math.max(1, Math.round(iterations * strength));

    for (let p = 0; p < passes; p++) {
        for (let y = radius; y < size - radius; y++) {
            for (let x = radius; x < size - radius; x++) {
                const ci = idx(x, y, size);
                const h = data[ci];

                // Find lowest neighbor within radius
                let minH = h;
                let minIdx = -1;
                const lowerNeighbors = [];

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const ni = idx(x + dx, y + dy, size);
                        if (data[ni] < h) {
                            lowerNeighbors.push({ idx: ni, h: data[ni] });
                        }
                        if (data[ni] < minH) {
                            minH = data[ni];
                            minIdx = ni;
                        }
                    }
                }

                const diff = h - minH;
                if (diff > talus && minIdx >= 0) {
                    // Distribute sediment to lower neighbors proportionally
                    const totalDrop = lowerNeighbors.reduce((s, n) => s + (h - n.h), 0);
                    const transfer = diff * transferRate * strength;

                    if (totalDrop > 0) {
                        data[ci] -= transfer;
                        for (const n of lowerNeighbors) {
                            const share = (h - n.h) / totalDrop;
                            data[n.idx] += transfer * share;
                        }
                    } else {
                        data[ci] -= transfer;
                        data[minIdx] += transfer;
                    }
                }
            }
        }
    }
}

/**
 * Terrace — quantizes heights into steps like rice paddies.
 */
function terrace(data, _size, strength) {
    const levels = Math.max(2, Math.round(3 + strength * 15));
    for (let i = 0; i < data.length; i++) {
        const original = data[i];
        const stepped = Math.round(original * levels) / levels;
        data[i] = original + (stepped - original) * strength;
    }
}

/**
 * Ridged — creates sharp ridgelines from the noise (abs + invert).
 */
function ridged(data, _size, strength) {
    for (let i = 0; i < data.length; i++) {
        const original = data[i];
        // Map to [-1,1], take abs, invert, map back to [0,1]
        const centered = original * 2 - 1;
        const ridge = 1 - Math.abs(centered);
        data[i] = original + (ridge - original) * strength;
    }
}

/**
 * Invert — flips heights (valleys become peaks).
 */
function invert(data, _size, strength) {
    for (let i = 0; i < data.length; i++) {
        const inverted = 1 - data[i];
        data[i] = data[i] + (inverted - data[i]) * strength;
    }
}

/**
 * Clamp extremes — pushes values toward mid-range, reducing extreme peaks/valleys.
 */
function clamp(data, _size, strength) {
    const low = strength * 0.3;
    const high = 1 - strength * 0.3;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < low) {
            data[i] = data[i] + (low - data[i]) * strength;
        } else if (data[i] > high) {
            data[i] = data[i] + (high - data[i]) * strength;
        }
    }
}

/**
 * Normalize — stretches the height range to fill full [0,1].
 */
function normalize(data, _size, strength) {
    let min = Infinity,
        max = -Infinity;
    for (let i = 0; i < data.length; i++) {
        if (data[i] < min) min = data[i];
        if (data[i] > max) max = data[i];
    }
    const range = max - min || 1;
    for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - min) / range;
        data[i] = data[i] + (normalized - data[i]) * strength;
    }
}

// Mulberry32 seeded PRNG
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
 * Add noise — overlays fractal simplex noise on the existing terrain
 * using its own seed, octaves, scale, persistence, and lacunarity.
 */
function addNoise(data, size, strength) {
    const nSeed = parseInt(document.getElementById('noiseSeed').value, 10) || 0;
    const nOctaves = parseInt(document.getElementById('noiseOctaves').value, 10);
    const nScale = parseFloat(document.getElementById('noiseScale').value);
    const nPersistence = parseFloat(document.getElementById('noisePersistence').value);
    const nLacunarity = parseFloat(document.getElementById('noiseLacunarity').value);

    const prng = mulberry32(nSeed);
    const noise2D = createNoise2D(prng);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let total = 0;
            let amplitude = 1;
            let frequency = 1;
            let maxAmplitude = 0;

            for (let o = 0; o < nOctaves; o++) {
                const sx = (x / nScale) * frequency;
                const sy = (y / nScale) * frequency;
                total += noise2D(sx, sy) * amplitude;
                maxAmplitude += amplitude;
                amplitude *= nPersistence;
                frequency *= nLacunarity;
            }

            const noiseVal = total / maxAmplitude; // [-1, 1]
            const idx = y * size + x;
            data[idx] = Math.max(0, Math.min(1, data[idx] + noiseVal * strength * 0.5));
        }
    }
}

/**
 * Get height at a fractional position using bilinear interpolation.
 */
function sampleHeight(data, size, x, y) {
    const x0 = Math.floor(x),
        y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, size - 1),
        y1 = Math.min(y0 + 1, size - 1);
    const fx = x - x0,
        fy = y - y0;

    const cx0 = Math.max(0, Math.min(size - 1, x0));
    const cy0 = Math.max(0, Math.min(size - 1, y0));

    const h00 = data[cy0 * size + cx0];
    const h10 = data[cy0 * size + x1];
    const h01 = data[y1 * size + cx0];
    const h11 = data[y1 * size + x1];

    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
}

/**
 * Compute terrain gradient at a fractional position.
 * Returns { gx, gy } pointing in the direction of steepest descent.
 */
function computeGradient(data, size, x, y) {
    const x0 = Math.floor(x),
        y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, size - 1),
        y1 = Math.min(y0 + 1, size - 1);
    const fx = x - x0,
        fy = y - y0;

    const cx0 = Math.max(0, Math.min(size - 1, x0));
    const cy0 = Math.max(0, Math.min(size - 1, y0));

    const h00 = data[cy0 * size + cx0];
    const h10 = data[cy0 * size + x1];
    const h01 = data[y1 * size + cx0];
    const h11 = data[y1 * size + x1];

    // Gradient via bilinear interpolation partial derivatives
    const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
    const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

    return { gx, gy };
}

/**
 * Hydraulic (river) erosion — simulates water droplets flowing downhill,
 * eroding terrain and depositing sediment to carve realistic river channels.
 */
function hydraulic(data, size, strength) {
    const numDroplets = parseInt(document.getElementById('hydDroplets').value, 10);
    const maxLife = parseInt(document.getElementById('hydLife').value, 10);
    const inertia = parseFloat(document.getElementById('hydInertia').value);
    const sedimentCap = parseFloat(document.getElementById('hydCapacity').value);
    const erosionRate = parseFloat(document.getElementById('hydErosion').value) * strength;
    const depositRate = parseFloat(document.getElementById('hydDeposit').value);
    const evapRate = parseFloat(document.getElementById('hydEvaporation').value);
    const radius = parseInt(document.getElementById('hydRadius').value, 10);

    const rng = mulberry32(42);

    for (let drop = 0; drop < numDroplets; drop++) {
        // Random starting position
        let posX = rng() * (size - 2) + 1;
        let posY = rng() * (size - 2) + 1;
        let dirX = 0,
            dirY = 0;
        let speed = 1;
        let water = 1;
        let sediment = 0;

        for (let step = 0; step < maxLife; step++) {
            const xi = Math.floor(posX),
                yi = Math.floor(posY);

            // Compute gradient
            const grad = computeGradient(data, size, posX, posY);

            // Update direction with inertia
            dirX = dirX * inertia - grad.gx * (1 - inertia);
            dirY = dirY * inertia - grad.gy * (1 - inertia);

            // Normalize direction
            const len = Math.sqrt(dirX * dirX + dirY * dirY);
            if (len > 0.0001) {
                dirX /= len;
                dirY /= len;
            } else {
                // Random direction if flat
                const angle = rng() * Math.PI * 2;
                dirX = Math.cos(angle);
                dirY = Math.sin(angle);
            }

            // Move droplet
            const newX = posX + dirX;
            const newY = posY + dirY;

            // Check bounds
            if (newX < 1 || newX >= size - 2 || newY < 1 || newY >= size - 2) break;

            // Height difference
            const oldH = sampleHeight(data, size, posX, posY);
            const newH = sampleHeight(data, size, newX, newY);
            const deltaH = newH - oldH;

            // Carry capacity based on speed, water, and slope
            const capacity = Math.max(-deltaH, 0.01) * speed * water * sedimentCap;

            if (sediment > capacity || deltaH > 0) {
                // Deposit sediment
                const depositAmount =
                    deltaH > 0
                        ? Math.min(sediment, deltaH) // Fill up to new height
                        : (sediment - capacity) * depositRate;

                sediment -= depositAmount;

                // Deposit in area around current position
                data[yi * size + xi] += depositAmount * 0.25;
                if (xi + 1 < size) data[yi * size + xi + 1] += depositAmount * 0.25;
                if (yi + 1 < size) data[(yi + 1) * size + xi] += depositAmount * 0.25;
                if (xi + 1 < size && yi + 1 < size) data[(yi + 1) * size + xi + 1] += depositAmount * 0.25;
            } else {
                // Erode terrain
                const erodeAmount = Math.min((capacity - sediment) * erosionRate, -deltaH);

                // Erode in radius around drop position
                let totalWeight = 0;
                const weights = [];
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const ex = xi + dx,
                            ey = yi + dy;
                        if (ex < 0 || ex >= size || ey < 0 || ey >= size) continue;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > radius) continue;
                        const w = Math.max(0, radius - dist);
                        weights.push({ x: ex, y: ey, w });
                        totalWeight += w;
                    }
                }

                if (totalWeight > 0) {
                    for (const { x, y, w } of weights) {
                        const share = (w / totalWeight) * erodeAmount;
                        data[y * size + x] = Math.max(0, data[y * size + x] - share);
                    }
                    sediment += erodeAmount;
                }
            }

            // Update speed from height difference
            speed = Math.sqrt(Math.max(0, speed * speed + deltaH));

            // Evaporate water
            water *= 1 - evapRate;

            // Move
            posX = newX;
            posY = newY;

            // Die if too slow or dry
            if (water < 0.001 || speed < 0.001) break;
        }
    }

    // Clamp final values
    for (let i = 0; i < data.length; i++) {
        data[i] = Math.max(0, Math.min(1, data[i]));
    }
}
