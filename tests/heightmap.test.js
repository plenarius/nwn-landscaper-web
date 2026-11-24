// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Import heightmap (heightmap.js): a 16-bit PNG read at full precision through each of PNG's row filters, and an image fitted
// to an area's ground (north at the top, averaged or blended, stretched or cropped, smoothed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import './browser.js';

const { Area } = await import('../js/area.js');
const { decodePng16, fitHeights } = await import('../js/heightmap.js');

/** A PNG chunk: length, type, body, and a CRC (never checked by the reader, so zero). */
function chunk(type, body) {
    const b = Buffer.alloc(12 + body.length);
    b.writeUInt32BE(body.length, 0);
    b.write(type, 4, 'latin1');
    body.copy(b, 8);
    return b;
}

/** A PNG of `width` x `height` 16-bit pixels: `pixel(x, y)` gives each its channels (1 grey, 3 RGB...); colour type `type`.
 *  Row y is written with filter y % 5, so every filter is read. */
function png16(width, height, type, channels, pixel) {
    const bpp = channels * 2,
        stride = width * bpp;
    const rows = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const channels16 = pixel(x, y);
            for (let c = 0; c < channels16.length; c++) rows.writeUInt16BE(channels16[c], y * stride + x * bpp + c * 2);
        }
    const out = Buffer.alloc(height * (stride + 1));
    for (let y = 0; y < height; y++) {
        const f = y % 5;
        out[y * (stride + 1)] = f;
        for (let x = 0; x < stride; x++) {
            const p = rows[y * stride + x],
                a = x >= bpp ? rows[y * stride + x - bpp] : 0,
                b = y > 0 ? rows[(y - 1) * stride + x] : 0,
                c = x >= bpp && y > 0 ? rows[(y - 1) * stride + x - bpp] : 0;
            let pred = 0;
            if (f === 1) pred = a;
            else if (f === 2) pred = b;
            else if (f === 3) pred = (a + b) >> 1;
            else if (f === 4) {
                const e = a + b - c,
                    pa = Math.abs(e - a),
                    pb = Math.abs(e - b),
                    pc = Math.abs(e - c);
                pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            out[y * (stride + 1) + 1 + x] = (p - pred) & 255;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 16;
    ihdr[9] = type;
    const z = deflateSync(out);
    // (two IDAT chunks: the reader joins them)
    const half = z.length >> 1;
    return new Uint8Array(
        Buffer.concat([
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            chunk('IHDR', ihdr),
            chunk('IDAT', z.subarray(0, half)),
            chunk('IDAT', z.subarray(half)),
            chunk('IEND', Buffer.alloc(0)),
        ]),
    );
}

test('a 16-bit greyscale PNG is read at full precision through every row filter', async () => {
    const value = (x, y) => (x * 4099 + y * 7919 + ((x * y) % 13) * 97) % 65536;
    const img = await decodePng16(png16(9, 11, 0, 1, (x, y) => [value(x, y)]));
    assert.equal(img.width, 9);
    assert.equal(img.height, 11);
    assert.equal(img.bits, 16);
    for (let y = 0; y < 11; y++)
        for (let x = 0; x < 9; x++) assert.equal(Math.round(img.values[y * 9 + x] * 65535), value(x, y), `${x},${y}`);
});

test('a 16-bit RGB PNG is read as the mean of its channels; grey and alpha as its grey', async () => {
    const rgb = await decodePng16(png16(3, 2, 2, 3, () => [0, 30000, 60000]));
    assert.equal(Math.round(rgb.values[4] * 65535), 30000);
    const ga = await decodePng16(png16(3, 2, 4, 2, () => [1234, 65535]));
    assert.equal(Math.round(ga.values[5] * 65535), 1234);
});

test('an 8-bit PNG or another file is left to the browser', async () => {
    const eight = png16(2, 2, 0, 1, () => [0]);
    eight[8 + 8 + 8] = 8; // IHDR's bit depth
    assert.equal(await decodePng16(eight), null);
    assert.equal(await decodePng16(new Uint8Array([1, 2, 3])), null);
});

/** An image of `width` x `height` from `f(x, y)`, 0 to 1, rows from the top. */
const image = (width, height, f) => {
    const values = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = f(x, y);
    return { width, height, values, bits: 16 };
};

test("the image's top is the area's north, black and white at the heights given", () => {
    const a = Area.create('aa', 4, 'flat', 0);
    // Top half white, bottom half black, 400 x 400 pixels over 65 x 65 ground points: each averages about 6 pixels each way.
    const h = fitHeights(
        a,
        image(400, 400, (_, y) => (y < 200 ? 1 : 0)),
        { low: 2, high: 12 },
    );
    assert.equal(h[(a.ny - 1) * a.nx + 10], 12, 'north edge');
    assert.equal(h[10], 2, 'south edge');
});

test('a small image is blended between its pixels; a large one averaged over each sample', () => {
    const a = Area.create('aa', 4, 'flat', 0);
    // 2 x 1 pixels, black then white: the heights rise smoothly from west to east, never a step.
    const h = fitHeights(
        a,
        image(2, 1, x => x),
        { low: 0, high: 10 },
    );
    const row = Array.from(h.subarray(0, a.nx));
    assert.ok(row.every((v, i) => i === 0 || v >= row[i - 1]));
    assert.ok(row[0] < 0.5 && row.at(-1) > 9.5);
    assert.ok(row.some(v => v > 3 && v < 7));
    // A checkerboard of single pixels much finer than the samples averages to grey.
    const fine = fitHeights(
        a,
        image(1000, 1000, (x, y) => (x + y) % 2),
        { low: 0, high: 10 },
    );
    assert.ok(fine.every(v => Math.abs(v - 5) < 0.2));
});

test('crop keeps the middle of a wide image; stretch uses all of it', () => {
    const a = Area.create('aa', 4, 'flat', 0);
    // 300 x 100: the outer thirds white, the middle black. Cropped to a square area, only the black middle is left.
    const img = image(300, 100, x => (x < 100 || x >= 200 ? 1 : 0));
    const crop = fitHeights(a, img, { low: 0, high: 10, fit: 'crop' });
    assert.ok(crop.every(v => v < 0.5));
    const stretch = fitHeights(a, img, { low: 0, high: 10, fit: 'stretch' });
    assert.equal(stretch[5 * a.nx], 10);
    assert.equal(stretch[5 * a.nx + (a.nx >> 1)], 0);
});

test('smoothing rounds off the steps of an 8-bit image', () => {
    const a = Area.create('aa', 16, 'flat', 0);
    // A gentle ramp using 41 of an 8-bit image's 256 levels over 30 m: steps of 12 cm, each a kink in the ground.
    const img = image(257, 10, x => Math.round((x / 256) * 40) / 255);
    // The sharpest kink along a row: the largest second difference of its heights (m).
    const kink = h => {
        let m = 0;
        for (let i = 2; i < a.nx; i++) m = Math.max(m, Math.abs(h[i] - 2 * h[i - 1] + h[i - 2]));
        return m;
    };
    const raw = fitHeights(a, img, { low: 0, high: 30 });
    const smooth = fitHeights(a, img, { low: 0, high: 30, smooth: 2 });
    assert.ok(kink(smooth) < kink(raw) / 3, `${kink(raw)} -> ${kink(smooth)}`);
    assert.ok(Math.abs(smooth[a.nx >> 1] - raw[a.nx >> 1]) < 0.2);
});
