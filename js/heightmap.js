// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Import a heightmap: a greyscale image becomes the open area's ground, black at one height and white at another, stretched over
// the area or cropped to its shape. A 16-bit PNG is read at its full 65,536 levels (a browser draws images at 8 bits a channel,
// 256 levels, which leaves terraces 12 cm high over 30 m); an 8-bit image can be smoothed to hide its steps.

import { $, say } from './dom.js';

/** What app.js gives this file (initHeightmap): `area()`, `readOnly()` and `changed()`, which redraws and saves the whole area. */
let ctx = null;

/** The image picked in the dialog: { width, height, values (0 to 1, rows from the top), bits }; null before one is. */
let picked = null;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Inflates zlib data `bytes` (a PNG's joined IDAT chunks) with the browser's own DecompressionStream. */
async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads a 16-bit PNG (`bytes`, a Uint8Array) at full precision: greyscale, greyscale with alpha, RGB or RGBA, not interlaced.
 * Returns { width, height, values, bits: 16 }, values 0 to 1 a pixel, rows from the top (of RGB, the mean of its three), or
 * null for any other PNG: the browser reads those (readHeightImage).
 */
export async function decodePng16(bytes) {
    if (bytes.length < 33 || PNG_SIGNATURE.some((b, k) => bytes[k] !== b)) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0,
        height = 0,
        depth = 0,
        type = 0,
        interlace = 0;
    const data = [];
    for (let at = 8; at + 8 <= bytes.length; ) {
        const length = view.getUint32(at),
            kind = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
        const body = bytes.subarray(at + 8, at + 8 + length);
        if (kind === 'IHDR') {
            width = view.getUint32(at + 8);
            height = view.getUint32(at + 12);
            depth = body[8];
            type = body[9];
            interlace = body[12];
        } else if (kind === 'IDAT') data.push(body);
        else if (kind === 'IEND') break;
        at += 12 + length;
    }
    // Channels a pixel by colour type: 0 grey, 2 RGB, 4 grey and alpha, 6 RGBA.
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
    if (depth !== 16 || !channels || interlace !== 0 || !width || !height) return null;
    const joined = new Uint8Array(data.reduce((n, d) => n + d.length, 0));
    let o = 0;
    for (const d of data) {
        joined.set(d, o);
        o += d.length;
    }
    const raw = await inflate(joined);
    const bpp = channels * 2,
        stride = width * bpp;
    if (raw.length < height * (stride + 1)) return null;
    // Undo each row's filter (PNG specification, section 9) in place, byte by byte.
    const rows = new Uint8Array(height * stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)],
            src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
            row = rows.subarray(y * stride, (y + 1) * stride),
            up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? row[x - bpp] : 0,
                b = up[x],
                c = x >= bpp ? up[x - bpp] : 0;
            let p = src[x];
            if (filter === 1) p += a;
            else if (filter === 2) p += b;
            else if (filter === 3) p += (a + b) >> 1;
            else if (filter === 4) {
                const e = a + b - c,
                    pa = Math.abs(e - a),
                    pb = Math.abs(e - b),
                    pc = Math.abs(e - c);
                p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            row[x] = p & 255;
        }
    }
    const grey = type === 2 || type === 6 ? 3 : 1,
        values = new Float32Array(width * height);
    for (let k = 0; k < width * height; k++) {
        let sum = 0;
        for (let g = 0; g < grey; g++) sum += (rows[k * bpp + g * 2] << 8) | rows[k * bpp + g * 2 + 1];
        values[k] = sum / grey / 65535;
    }
    return { width, height, values, bits: 16 };
}

/** Reads image `file` (a File or Blob): a 16-bit PNG at full precision, anything else the browser can draw at 8 bits (the mean
 *  of red, green and blue). Returns { width, height, values, bits }; throws when the browser can't read it. */
export async function readHeightImage(file) {
    const exact = await decodePng16(new Uint8Array(await file.arrayBuffer())).catch(() => null);
    if (exact) return exact;
    const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
        g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(bitmap, 0, 0);
    const px = g.getImageData(0, 0, bitmap.width, bitmap.height).data,
        values = new Float32Array(bitmap.width * bitmap.height);
    for (let k = 0; k < values.length; k++) values[k] = (px[k * 4] + px[k * 4 + 1] + px[k * 4 + 2]) / 765;
    bitmap.close();
    return { width: canvas.width, height: canvas.height, values, bits: 8 };
}

/**
 * The heights (metres, one a sample of `area`, rows from the south as the area keeps them) that image `img` gives: black at
 * `low`, white at `high`. `fit` 'stretch' covers the area with the whole image; 'crop' keeps the image's shape and cuts its
 * longer side to the area's. Each sample averages the pixels it covers (a large image) or blends the four nearest (a small one).
 * `smooth`: passes of a 3 x 3 blur afterwards, to round off an 8-bit image's steps.
 */
export function fitHeights(area, img, { low, high, fit = 'stretch', smooth = 0 }) {
    const { nx, ny } = area,
        { width: w, height: h, values } = img;
    // The part of the image used: all of it, or its middle cut to the area's shape.
    let x0 = 0,
        y0 = 0,
        cw = w,
        ch = h;
    if (fit === 'crop') {
        const want = area.sizeX / area.sizeY;
        if (w / h > want) {
            cw = h * want;
            x0 = (w - cw) / 2;
        } else {
            ch = w / want;
            y0 = (h - ch) / 2;
        }
    }
    // A summed-area table, to average any rectangle of pixels in four reads.
    const sat = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += values[y * w + x];
            sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
        }
    }
    const box = (ax, ay, bx, by) => {
        const s = (x, y) => sat[y * (w + 1) + x];
        return (s(bx, by) - s(ax, by) - s(bx, ay) + s(ax, ay)) / ((bx - ax) * (by - ay));
    };
    const bilinear = (u, v) => {
        const fx = Math.min(Math.max(u - 0.5, 0), w - 1),
            fy = Math.min(Math.max(v - 0.5, 0), h - 1);
        const i = Math.min(Math.floor(fx), Math.max(w - 2, 0)),
            j = Math.min(Math.floor(fy), Math.max(h - 2, 0));
        const tx = w > 1 ? fx - i : 0,
            ty = h > 1 ? fy - j : 0;
        const at = (a, b) => values[Math.min(b, h - 1) * w + Math.min(a, w - 1)];
        const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx,
            bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
        return top + (bottom - top) * ty;
    };
    // Pixels a sample spans each way.
    const sx = cw / nx,
        sy = ch / ny;
    const out = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        // (the image's top row is the area's north edge)
        const v = y0 + (ny - 1 - j + 0.5) * sy;
        for (let i = 0; i < nx; i++) {
            const u = x0 + (i + 0.5) * sx;
            let t;
            if (sx > 1 || sy > 1) {
                const ax = Math.max(0, Math.floor(u - sx / 2)),
                    bx = Math.min(w, Math.max(ax + 1, Math.ceil(u + sx / 2))),
                    ay = Math.max(0, Math.floor(v - sy / 2)),
                    by = Math.min(h, Math.max(ay + 1, Math.ceil(v + sy / 2)));
                t = box(ax, ay, bx, by);
            } else t = bilinear(u, v);
            out[j * nx + i] = low + (high - low) * t;
        }
    }
    for (let pass = 0; pass < smooth; pass++) blur(out, nx, ny);
    return out;
}

/** One pass of a 3 x 3 binomial blur over heights `h` (`nx` by `ny`), the edges clamped. */
function blur(h, nx, ny) {
    const copy = h.slice();
    const at = (i, j) => copy[Math.min(Math.max(j, 0), ny - 1) * nx + Math.min(Math.max(i, 0), nx - 1)];
    for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
            h[j * nx + i] =
                (4 * at(i, j) +
                    2 * (at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1)) +
                    at(i - 1, j - 1) +
                    at(i + 1, j - 1) +
                    at(i - 1, j + 1) +
                    at(i + 1, j + 1)) /
                16;
        }
}

/** Draws `img` greyscale on the dialog's preview canvas, at most 160 pixels a side. */
function preview(img) {
    const canvas = $('heightmapPreview'),
        scale = Math.min(1, 160 / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const g = canvas.getContext('2d'),
        data = g.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++) {
            const v = img.values[Math.floor(y / scale) * img.width + Math.floor(x / scale)] * 255,
                o = (y * canvas.width + x) * 4;
            data.data[o] = data.data[o + 1] = data.data[o + 2] = v;
            data.data[o + 3] = 255;
        }
    g.putImageData(data, 0, 0);
    canvas.hidden = false;
}

/** Wires the Import heightmap dialog. `c`: { area(), readOnly(), changed() } from app.js. */
export function initHeightmap(c) {
    ctx = c;
    $('btnHeightmap').onclick = () => {
        if (!ctx.area() || ctx.readOnly()) return;
        picked = null;
        $('heightmapFile').value = '';
        $('heightmapPreview').hidden = true;
        $('heightmapInfo').textContent = 'Black is the lowest ground, white the highest.';
        $('heightmapError').hidden = true;
        $('heightmapOk').disabled = true;
        $('heightmapDialog').showModal();
    };
    $('heightmapFile').onchange = async () => {
        const file = $('heightmapFile').files[0];
        picked = null;
        $('heightmapOk').disabled = true;
        $('heightmapError').hidden = true;
        if (!file) return;
        try {
            picked = await readHeightImage(file);
        } catch {
            $('heightmapError').textContent = `${file.name} isn't an image this browser can read (PNG, JPEG, WebP, GIF or BMP).`;
            $('heightmapError').hidden = false;
            return;
        }
        preview(picked);
        const a = ctx.area(),
            perSample = Math.max(picked.width / a.nx, picked.height / a.ny);
        $('heightmapInfo').textContent =
            `${picked.width} × ${picked.height} pixels, ${picked.bits}-bit${picked.bits === 8 ? ' (256 levels: smoothing hides the steps)' : ''}. ` +
            `The area has ${a.nx} × ${a.ny} ground points` +
            (perSample > 1 ? `: each averages ${perSample.toFixed(1)} pixels each way.` : ': the image is blended between its pixels.');
        $('heightmapSmooth').checked = picked.bits === 8;
        $('heightmapOk').disabled = false;
    };
    $('heightmapOk').onclick = e => {
        e.preventDefault();
        const low = Number($('heightmapLow').value),
            high = Number($('heightmapHigh').value);
        if (!picked || !Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 200 || high <= low) {
            $('heightmapError').textContent = 'White must be higher than black, between 0 and 200 m.';
            $('heightmapError').hidden = false;
            return;
        }
        const a = ctx.area();
        const fit = new FormData($('heightmapDialog').querySelector('form')).get('heightmapFit');
        const heights = fitHeights(a, picked, { low, high, fit, smooth: $('heightmapSmooth').checked ? 2 : 0 });
        a.beginStroke();
        a.heights.set(heights);
        a.floodWater();
        $('heightmapDialog').close('ok');
        ctx.changed();
        say(`Ground from the heightmap: ${low} m (black) to ${high} m (white). Undo puts the old ground back.`);
    };
}
