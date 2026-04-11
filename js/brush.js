const canvas = document.getElementById('canvas2d');
let enabled = false;
let painting = false;
let heightData = null;
let mapSize = 0;
let onPaint = null;
let onPaintEnd = null;
let lastX = -1, lastY = -1;

function getBrushParams() {
    return {
        color: parseInt(document.getElementById('brushColor').value, 10) / 255,
        size: parseInt(document.getElementById('brushSize').value, 10),
        opacity: parseFloat(document.getElementById('brushOpacity').value),
        feather: parseFloat(document.getElementById('brushFeather').value),
        pressure: parseFloat(document.getElementById('brushPressure').value),
        type: document.getElementById('brushType').value,
    };
}

/**
 * Convert mouse event to canvas pixel coordinates.
 */
function toCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
    };
}

/**
 * Compute brush falloff at a given distance.
 */
function computeFalloff(dist, coreRadius, featherExtent, totalRadius) {
    if (dist > totalRadius) return 0;
    if (dist <= coreRadius) return 1;
    const t = (dist - coreRadius) / featherExtent;
    return (1 - t) * (1 - t);
}

/**
 * Compute the brush area bounds and radii.
 */
function brushArea(cx, cy, size, feather) {
    const coreRadius = size / 2;
    const featherExtent = coreRadius * feather * 3;
    const totalRadius = coreRadius + featherExtent;
    return {
        coreRadius, featherExtent, totalRadius,
        x0: Math.max(0, Math.floor(cx - totalRadius)),
        y0: Math.max(0, Math.floor(cy - totalRadius)),
        x1: Math.min(mapSize - 1, Math.ceil(cx + totalRadius)),
        y1: Math.min(mapSize - 1, Math.ceil(cy + totalRadius)),
    };
}

/**
 * Paint brush — blends toward the selected color.
 */
function stampPaint(cx, cy) {
    const { color, size, opacity, feather, pressure } = getBrushParams();
    const a = brushArea(cx, cy, size, feather);

    for (let y = a.y0; y <= a.y1; y++) {
        for (let x = a.x0; x <= a.x1; x++) {
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const falloff = computeFalloff(dist, a.coreRadius, a.featherExtent, a.totalRadius);
            if (falloff <= 0) continue;

            const blend = opacity * pressure * falloff;
            const idx = y * mapSize + x;
            heightData[idx] = heightData[idx] + (color - heightData[idx]) * blend;
        }
    }
}

/**
 * Smooth brush — averages neighbors to blur the area under the brush.
 */
function stampSmooth(cx, cy) {
    const { size, opacity, feather, pressure } = getBrushParams();
    const a = brushArea(cx, cy, size, feather);

    // Pre-compute blurred values from current data
    const blurred = new Float32Array((a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1));
    const w = a.x1 - a.x0 + 1;

    for (let y = a.y0; y <= a.y1; y++) {
        for (let x = a.x0; x <= a.x1; x++) {
            let sum = 0, count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < mapSize && ny >= 0 && ny < mapSize) {
                        const weight = (dx === 0 && dy === 0) ? 4 : (Math.abs(dx) + Math.abs(dy) === 1 ? 2 : 1);
                        sum += heightData[ny * mapSize + nx] * weight;
                        count += weight;
                    }
                }
            }
            blurred[(y - a.y0) * w + (x - a.x0)] = sum / count;
        }
    }

    // Blend toward blurred values based on brush falloff
    for (let y = a.y0; y <= a.y1; y++) {
        for (let x = a.x0; x <= a.x1; x++) {
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const falloff = computeFalloff(dist, a.coreRadius, a.featherExtent, a.totalRadius);
            if (falloff <= 0) continue;

            const blend = opacity * pressure * falloff;
            const idx = y * mapSize + x;
            const target = blurred[(y - a.y0) * w + (x - a.x0)];
            heightData[idx] = heightData[idx] + (target - heightData[idx]) * blend;
        }
    }
}

/**
 * Level brush — samples height at click point, then flattens surrounding area toward that level.
 */
let levelTarget = -1;
function stampLevel(cx, cy) {
    const { size, opacity, feather, pressure } = getBrushParams();
    const a = brushArea(cx, cy, size, feather);

    // On first stamp of a stroke, sample the center height as the target level
    if (levelTarget < 0) {
        const sx = Math.round(Math.max(0, Math.min(mapSize - 1, cx)));
        const sy = Math.round(Math.max(0, Math.min(mapSize - 1, cy)));
        levelTarget = heightData[sy * mapSize + sx];
    }

    for (let y = a.y0; y <= a.y1; y++) {
        for (let x = a.x0; x <= a.x1; x++) {
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
            const falloff = computeFalloff(dist, a.coreRadius, a.featherExtent, a.totalRadius);
            if (falloff <= 0) continue;

            const blend = opacity * pressure * falloff;
            const idx = y * mapSize + x;
            heightData[idx] = heightData[idx] + (levelTarget - heightData[idx]) * blend;
        }
    }
}

/**
 * Dispatch to the correct stamp function based on brush type.
 */
function stamp(cx, cy) {
    const { type } = getBrushParams();
    switch (type) {
        case 'smooth': return stampSmooth(cx, cy);
        case 'level': return stampLevel(cx, cy);
        default: return stampPaint(cx, cy);
    }
}

/**
 * Interpolate stamps between two points for smooth strokes.
 */
function strokeTo(x, y) {
    if (lastX < 0) {
        stamp(x, y);
    } else {
        const dx = x - lastX;
        const dy = y - lastY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const steps = Math.max(1, Math.floor(dist / 2));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            stamp(lastX + dx * t, lastY + dy * t);
        }
    }
    lastX = x;
    lastY = y;
}

function handleMouseDown(e) {
    if (!enabled || e.button !== 0) return;
    painting = true;
    levelTarget = -1; // reset level sample for new stroke
    canvas.setPointerCapture(e.pointerId); // keep receiving events outside canvas
    const { x, y } = toCanvasCoords(e);
    lastX = -1;
    lastY = -1;
    strokeTo(x, y);
    if (onPaint) onPaint();
}

function handleMouseMove(e) {
    if (!painting) return;
    // toCanvasCoords will return coordinates outside [0, mapSize] when
    // the cursor is beyond the canvas — stamp() already clamps to bounds
    const { x, y } = toCanvasCoords(e);
    strokeTo(x, y);
    if (onPaint) onPaint();
}

function handleMouseUp(e) {
    if (!painting) return;
    painting = false;
    lastX = -1;
    lastY = -1;
    if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
    }
    if (onPaintEnd) onPaintEnd();
}

/**
 * Initialize brush system.
 * @param {Object} callbacks - { onPaint, onPaintEnd }
 */
export function initBrush(callbacks) {
    onPaint = callbacks.onPaint;
    onPaintEnd = callbacks.onPaintEnd;

    canvas.addEventListener('pointerdown', handleMouseDown);
    canvas.addEventListener('pointermove', handleMouseMove);
    canvas.addEventListener('pointerup', handleMouseUp);
    canvas.addEventListener('pointercancel', handleMouseUp);

    // Prevent context menu on canvas while painting
    canvas.addEventListener('contextmenu', (e) => {
        if (enabled) e.preventDefault();
    });
}

/**
 * Update the heightData reference and mapSize (called on regenerate).
 */
export function setBrushData(data, size) {
    heightData = data;
    mapSize = size;
}

/**
 * Toggle paint mode on/off.
 */
export function setEnabled(on) {
    enabled = on;
    canvas.classList.toggle('paint-mode', on);
}

// ===================== 3D PAINTING =====================

import * as THREE from 'three';

let enabled3D = false;
let painting3D = false;
let raycaster = null;
let getCamera = null;
let getMesh = null;
let rendererCanvas = null;
let onPaint3D = null;
let onPaintEnd3D = null;
let last3DX = -1, last3DY = -1;

const PLANE_SIZE = 150;

/**
 * Convert a raycast intersection point on the terrain to heightData grid coords.
 */
function worldToGrid(point) {
    return {
        x: ((point.x + PLANE_SIZE / 2) / PLANE_SIZE) * mapSize,
        y: ((point.z + PLANE_SIZE / 2) / PLANE_SIZE) * mapSize,
    };
}

/**
 * Raycast from mouse position to terrain mesh.
 * Returns grid coordinates or null if no hit.
 */
function raycastToGrid(e) {
    const rect = rendererCanvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const cam = getCamera();
    const mesh = getMesh();
    if (!cam || !mesh) return null;

    raycaster.setFromCamera(mouse, cam);
    const hits = raycaster.intersectObject(mesh);
    if (hits.length === 0) return null;

    return worldToGrid(hits[0].point);
}

function handle3DDown(e) {
    if (!enabled3D || e.button !== 0) return;
    const coords = raycastToGrid(e);
    if (!coords) return;

    painting3D = true;
    levelTarget = -1;
    rendererCanvas.setPointerCapture(e.pointerId);
    last3DX = -1;
    last3DY = -1;

    // Use the existing strokeTo with temporary overrides
    lastX = -1;
    lastY = -1;
    strokeTo(coords.x, coords.y);
    if (onPaint3D) onPaint3D();
}

function handle3DMove(e) {
    if (!painting3D) return;
    const coords = raycastToGrid(e);
    if (!coords) return;

    strokeTo(coords.x, coords.y);
    if (onPaint3D) onPaint3D();
}

function handle3DUp(e) {
    if (!painting3D) return;
    painting3D = false;
    lastX = -1;
    lastY = -1;
    if (rendererCanvas.hasPointerCapture(e.pointerId)) {
        rendererCanvas.releasePointerCapture(e.pointerId);
    }
    if (onPaintEnd3D) onPaintEnd3D();
}

/**
 * Initialize 3D brush painting.
 * @param {Object} opts - { getCamera, getMesh, rendererCanvas, onPaint, onPaintEnd }
 */
export function init3DBrush(opts) {
    raycaster = new THREE.Raycaster();
    getCamera = opts.getCamera;
    getMesh = opts.getMesh;
    rendererCanvas = opts.rendererCanvas;
    onPaint3D = opts.onPaint;
    onPaintEnd3D = opts.onPaintEnd;

    rendererCanvas.addEventListener('pointerdown', handle3DDown);
    rendererCanvas.addEventListener('pointermove', handle3DMove);
    rendererCanvas.addEventListener('pointerup', handle3DUp);
    rendererCanvas.addEventListener('pointercancel', handle3DUp);

    rendererCanvas.addEventListener('contextmenu', (e) => {
        if (enabled3D) e.preventDefault();
    });
}

/**
 * Toggle 3D paint mode on/off.
 */
export function set3DEnabled(on) {
    enabled3D = on;
    rendererCanvas.style.cursor = on ? 'crosshair' : '';
}

export function is3DEnabled() {
    return enabled3D;
}

export function isEnabled() {
    return enabled;
}
