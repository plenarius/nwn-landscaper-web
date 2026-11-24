// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The one hidden WebGL renderer that draws the small pictures of models (the Place tool's list, preview.js) and creatures
// (preview.js). Each had its own: three WebGL contexts with the view's, and the models' one kept every model it drew.

import * as THREE from 'three';

let renderer = null,
    picture = null,
    bottomFirst = null;

/** The renderer's `size` pixels square, as readPixels gives them. */
function read(size) {
    const gl = renderer.getContext(),
        px = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
}

/**
 * Whether readPixels gives this browser's rows bottom first, as WebGL says, measured once on a picture whose top half is filled:
 * on a builder's machine the pictures came out upside down both from the canvas's toDataURL and from readPixels.
 */
function rowsBottomFirst() {
    const scene = new THREE.Scene(),
        geometry = new THREE.PlaneGeometry(2, 1),
        material = new THREE.MeshBasicMaterial({ color: 0xffffff }),
        top = new THREE.Mesh(geometry, material);
    top.position.y = 0.5;
    scene.add(top);
    renderer.setSize(8, 8, false);
    renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1));
    const px = read(8);
    geometry.dispose();
    material.dispose();
    // The first row read is transparent when it is the bottom one.
    return px[3] <= px[7 * 8 * 4 + 3];
}

/** `scene` seen by `camera`, drawn `size` pixels square on a clear background: a PNG data URL. */
export function thumbnail(scene, camera, size) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    bottomFirst ??= rowsBottomFirst();
    renderer.setSize(size, size, false);
    renderer.render(scene, camera);
    // Read with readPixels, not the WebGL canvas's toDataURL, which some browsers and drivers hand back upside down; the rows
    // are put top first by the order measured above.
    const px = read(size);
    picture ??= document.createElement('canvas');
    picture.width = picture.height = size;
    const ctx = picture.getContext('2d'),
        image = ctx.createImageData(size, size),
        row = size * 4;
    for (let y = 0; y < size; y++) {
        const from = (bottomFirst ? size - 1 - y : y) * row;
        for (let i = 0; i < row; i += 4) {
            const a = px[from + i + 3],
                to = y * row + i;
            // (The canvas's colours are premultiplied by alpha; ImageData's aren't.)
            const k = a ? 255 / a : 0;
            image.data[to] = Math.min(255, Math.round(px[from + i] * k));
            image.data[to + 1] = Math.min(255, Math.round(px[from + i + 1] * k));
            image.data[to + 2] = Math.min(255, Math.round(px[from + i + 2] * k));
            image.data[to + 3] = a;
        }
    }
    ctx.putImageData(image, 0, 0);
    return picture.toDataURL('image/png');
}
