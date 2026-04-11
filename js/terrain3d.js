import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls, terrainMesh;
let lastW = 0, lastH = 0;

/**
 * Initialize the Three.js scene in the given container element.
 */
export function initScene(container) {
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x87ceeb);
    container.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.003);

    // Camera
    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 80, 120);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 20;
    controls.maxDistance = 400;

    // Lighting
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(80, 120, 60);
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0x607080, 0.6);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5f3a, 0.3);
    scene.add(hemiLight);

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
        resize(container);
    });
    resizeObserver.observe(container);

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        resize(container); // ensure size stays in sync every frame
        controls.update();
        renderer.render(scene, camera);
    }
    // Defer first frame so layout is settled
    requestAnimationFrame(animate);
}

function resize(container) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

/**
 * Color palettes: each has a water gradient and terrain gradient stops.
 * Terrain stops are [threshold, colorFrom, colorTo].
 */
const COLOR_PALETTES = {
    default: {
        water: [0x0a4a6e, 0x2389c7],
        terrain: [
            [0.25, 0x2d8a3e, 0x7ec850],
            [0.50, 0x7ec850, 0x8b7355],
            [0.75, 0x8b7355, 0x888888],
            [1.00, 0xaaaaaa, 0xffffff],
        ],
    },
    'snowy-peaks': {
        water: [0x1a5276, 0x2e86c1],
        terrain: [
            [0.15, 0x2e7d32, 0x66bb6a],
            [0.30, 0x66bb6a, 0x8d6e63],
            [0.45, 0x8d6e63, 0x9e9e9e],
            [1.00, 0xbdbdbd, 0xffffff],
        ],
    },
    desert: {
        water: [0x0d4f6e, 0x1a8aad],
        terrain: [
            [0.20, 0xc2b280, 0xd4c89a],
            [0.45, 0xd4c89a, 0xb8860b],
            [0.70, 0xb8860b, 0x8b6914],
            [1.00, 0xa0522d, 0xdeb887],
        ],
    },
    volcanic: {
        water: [0x1a1a2e, 0x2d2d44],
        terrain: [
            [0.20, 0x2c2c2c, 0x444444],
            [0.45, 0x444444, 0x5c3a1e],
            [0.70, 0x8b4513, 0xcc4400],
            [1.00, 0xff4500, 0xff6600],
        ],
    },
    arctic: {
        water: [0x1c3f5a, 0x4a90b8],
        terrain: [
            [0.15, 0x8faaaa, 0xb0c4c4],
            [0.35, 0xb0c4c4, 0xd0dede],
            [0.55, 0xd0dede, 0xe8eeee],
            [1.00, 0xeef4f4, 0xffffff],
        ],
    },
    tropical: {
        water: [0x006994, 0x00b4d8],
        terrain: [
            [0.15, 0xf5deb3, 0xe8c87a],
            [0.30, 0x228b22, 0x32cd32],
            [0.55, 0x32cd32, 0x006400],
            [1.00, 0x556b2f, 0x8fbc8f],
        ],
    },
    greyscale: {
        water: [0x222222, 0x444444],
        terrain: [
            [0.25, 0x555555, 0x777777],
            [0.50, 0x777777, 0x999999],
            [0.75, 0x999999, 0xbbbbbb],
            [1.00, 0xcccccc, 0xffffff],
        ],
    },
    mars: {
        water: [0x3d1c02, 0x5a2d0c],
        terrain: [
            [0.25, 0x8b4513, 0xb5651d],
            [0.50, 0xb5651d, 0xcd853f],
            [0.75, 0xcd853f, 0xc4a882],
            [1.00, 0xc4a882, 0xdec4a8],
        ],
    },
};

let activeColorPreset = 'default';
let colorMode = 'height'; // 'height', 'slope', 'blend'

/** Set the active color palette by name. */
export function setColorPreset(name) {
    activeColorPreset = name;
}

/** Set the coloring mode. */
export function setColorMode(mode) {
    colorMode = mode;
}

/**
 * Get terrain color for a given normalized height value.
 */
function getTerrainColor(h, waterLevel) {
    const palette = COLOR_PALETTES[activeColorPreset] || COLOR_PALETTES.default;

    if (h <= waterLevel) {
        const t = waterLevel > 0 ? h / waterLevel : 0;
        return lerpColor(palette.water[0], palette.water[1], t);
    }

    // Remap above-water height to [0, 1]
    const t = (h - waterLevel) / (1 - waterLevel);

    const stops = palette.terrain;
    let prev = 0;
    for (const [threshold, c1, c2] of stops) {
        if (t <= threshold) {
            const local = (t - prev) / (threshold - prev);
            return lerpColor(c1, c2, local);
        }
        prev = threshold;
    }
    // Fallback to last stop
    const last = stops[stops.length - 1];
    return lerpColor(last[1], last[2], 1);
}

function lerpColor(c1, c2, t) {
    const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
    const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
    return {
        r: (r1 + (r2 - r1) * t) / 255,
        g: (g1 + (g2 - g1) * t) / 255,
        b: (b1 + (b2 - b1) * t) / 255,
    };
}

/**
 * Get slope-based color. Flat faces (normal pointing up) get grass/low colors,
 * steep faces (normal pointing sideways) get rock/cliff colors.
 * slope: 0 = flat, 1 = vertical cliff
 */
function getSlopeColor(slope, h, waterLevel) {
    const palette = COLOR_PALETTES[activeColorPreset] || COLOR_PALETTES.default;

    if (h <= waterLevel) {
        const t = waterLevel > 0 ? h / waterLevel : 0;
        return lerpColor(palette.water[0], palette.water[1], t);
    }

    // Flat color (low slope) — use first terrain stop
    const flatColor = lerpColor(palette.terrain[0][1], palette.terrain[0][2], 0.5);
    // Steep color (high slope) — use third/fourth terrain stop (rock-like)
    const steepIdx = Math.min(palette.terrain.length - 1, 2);
    const steepColor = lerpColor(palette.terrain[steepIdx][1], palette.terrain[steepIdx][2], 0.5);

    // Blend based on slope
    return {
        r: flatColor.r + (steepColor.r - flatColor.r) * slope,
        g: flatColor.g + (steepColor.g - flatColor.g) * slope,
        b: flatColor.b + (steepColor.b - flatColor.b) * slope,
    };
}

/**
 * Build or rebuild the terrain mesh from height data.
 */
export function updateTerrain(heightData, params) {
    const { mapSize, heightMultiplier, waterLevel } = params;

    // Dispose old mesh
    if (terrainMesh) {
        terrainMesh.geometry.dispose();
        terrainMesh.material.dispose();
        scene.remove(terrainMesh);
    }

    const planeSize = 150;
    const geometry = new THREE.PlaneGeometry(planeSize, planeSize, mapSize - 1, mapSize - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;

    // First pass: set vertex heights
    for (let i = 0; i < mapSize * mapSize; i++) {
        const h = heightData[i];
        const displayH = h < waterLevel ? waterLevel : h;
        positions[i * 3 + 1] = displayH * heightMultiplier;
    }

    // Compute normals BEFORE coloring (needed for slope mode)
    geometry.computeVertexNormals();

    // Second pass: assign colors based on mode
    const colors = new Float32Array(positions.length);
    const normals = geometry.attributes.normal.array;

    for (let i = 0; i < mapSize * mapSize; i++) {
        const h = heightData[i];

        let color;
        if (colorMode === 'height') {
            color = getTerrainColor(h, waterLevel);
        } else {
            // Normal Y component: 1 = flat, 0 = vertical
            const ny = normals[i * 3 + 1];
            const slope = 1 - Math.max(0, ny); // 0 = flat, 1 = cliff

            // Smooth the slope curve for more natural look
            const smoothSlope = slope * slope * (3 - 2 * slope); // smoothstep

            if (colorMode === 'slope') {
                color = getSlopeColor(smoothSlope, h, waterLevel);
            } else {
                // blend mode: mix height and slope coloring
                const heightColor = getTerrainColor(h, waterLevel);
                const slopeColor = getSlopeColor(smoothSlope, h, waterLevel);
                const blendFactor = smoothSlope;
                color = {
                    r: heightColor.r + (slopeColor.r - heightColor.r) * blendFactor,
                    g: heightColor.g + (slopeColor.g - heightColor.g) * blendFactor,
                    b: heightColor.b + (slopeColor.b - heightColor.b) * blendFactor,
                };
            }
        }

        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    terrainMesh = new THREE.Mesh(geometry, material);
    scene.add(terrainMesh);
}

/** Get the Three.js renderer DOM element. */
export function getRendererCanvas() { return renderer.domElement; }

/** Get the camera for raycasting. */
export function getCamera() { return camera; }

/** Get the current terrain mesh for raycasting. */
export function getTerrainMesh() { return terrainMesh; }

/** Enable or disable OrbitControls. */
export function setOrbitEnabled(on) { controls.enabled = on; }
