// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The one hidden WebGL renderer that draws the small pictures of models (the Place tool's list, preview.js) and creatures
// (preview.js). Each had its own: three WebGL contexts with the view's, and the models' one kept every model it drew.

import * as THREE from 'three';

let renderer = null;

/** `scene` seen by `camera`, drawn `size` pixels square on a clear background: a PNG data URL. */
export function thumbnail(scene, camera, size) {
    renderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
}
