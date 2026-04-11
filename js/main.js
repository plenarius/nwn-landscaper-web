import { generateHeightMap } from './noise.js';
import { renderCanvas2D, exportPNG } from './heightmap.js';
import { initScene, updateTerrain, getRendererCanvas, getCamera, getTerrainMesh, setOrbitEnabled, setColorPreset, setColorMode } from './terrain3d.js';
import { getParams, bindControls } from './ui.js';
import { initBrush, setBrushData, setEnabled, isEnabled, init3DBrush, set3DEnabled, is3DEnabled } from './brush.js';
import { applyFilter } from './filters.js';

// Initialize 3D scene
const viewport = document.getElementById('viewport3d');
initScene(viewport);

// Shared height data
let currentHeightData = null;
let currentParams = null;

// Debounced regeneration
let debounceTimer = null;
function regenerate() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        currentParams = getParams();
        currentHeightData = generateHeightMap(currentParams);
        setBrushData(currentHeightData, currentParams.mapSize);
        renderCanvas2D(currentHeightData, currentParams.mapSize);
        updateTerrain(currentHeightData, currentParams);
    }, 50);
}

// Wire up UI
bindControls(regenerate);

// Brush system
let terrain3dTimer = null;
initBrush({
    onPaint() {
        // Update 2D canvas immediately for responsiveness
        renderCanvas2D(currentHeightData, currentParams.mapSize);
        // Debounce 3D update (heavier)
        clearTimeout(terrain3dTimer);
        terrain3dTimer = setTimeout(() => {
            updateTerrain(currentHeightData, currentParams);
        }, 100);
    },
    onPaintEnd() {
        // Final 3D update when stroke ends
        clearTimeout(terrain3dTimer);
        updateTerrain(currentHeightData, currentParams);
    },
});

// 3D brush system
init3DBrush({
    getCamera,
    getMesh: getTerrainMesh,
    rendererCanvas: getRendererCanvas(),
    onPaint() {
        renderCanvas2D(currentHeightData, currentParams.mapSize);
        clearTimeout(terrain3dTimer);
        terrain3dTimer = setTimeout(() => {
            updateTerrain(currentHeightData, currentParams);
        }, 100);
    },
    onPaintEnd() {
        clearTimeout(terrain3dTimer);
        updateTerrain(currentHeightData, currentParams);
    },
});

// Paint mode toggles
const paintToggle = document.getElementById('paintToggle');
const paint3DToggle = document.getElementById('paint3DToggle');

paintToggle.addEventListener('click', () => {
    const on = !isEnabled();
    setEnabled(on);
    paintToggle.textContent = on ? '2D Paint ON' : '2D Paint';
    paintToggle.classList.toggle('active', on);
    // Disable 3D paint if enabling 2D
    if (on && is3DEnabled()) {
        set3DEnabled(false);
        setOrbitEnabled(true);
        paint3DToggle.textContent = '3D Paint';
        paint3DToggle.classList.remove('active');
    }
});

paint3DToggle.addEventListener('click', () => {
    const on = !is3DEnabled();
    set3DEnabled(on);
    setOrbitEnabled(!on);
    paint3DToggle.textContent = on ? '3D Paint ON' : '3D Paint';
    paint3DToggle.classList.toggle('active', on);
    // Disable 2D paint if enabling 3D
    if (on && isEnabled()) {
        setEnabled(false);
        paintToggle.textContent = '2D Paint';
        paintToggle.classList.remove('active');
    }
});

// Brush color swatch
const brushColorSlider = document.getElementById('brushColor');
const colorSwatch = document.getElementById('colorSwatch');
const brushColorVal = document.getElementById('brushColor-val');
function updateSwatch() {
    const v = brushColorSlider.value;
    colorSwatch.style.background = `rgb(${v},${v},${v})`;
    brushColorVal.textContent = v;
}
brushColorSlider.addEventListener('input', updateSwatch);
updateSwatch();

// Brush size label
const brushSizeSlider = document.getElementById('brushSize');
const brushSizeVal = document.getElementById('brushSize-val');
brushSizeSlider.addEventListener('input', () => {
    brushSizeVal.textContent = brushSizeSlider.value;
});

// Brush opacity label
const brushOpacitySlider = document.getElementById('brushOpacity');
const brushOpacityVal = document.getElementById('brushOpacity-val');
brushOpacitySlider.addEventListener('input', () => {
    brushOpacityVal.textContent = parseFloat(brushOpacitySlider.value).toFixed(2);
});

// Brush pressure label
const brushPressureSlider = document.getElementById('brushPressure');
const brushPressureVal = document.getElementById('brushPressure-val');
brushPressureSlider.addEventListener('input', () => {
    brushPressureVal.textContent = parseFloat(brushPressureSlider.value).toFixed(2);
});

// Brush feather label
const brushFeatherSlider = document.getElementById('brushFeather');
const brushFeatherVal = document.getElementById('brushFeather-val');
brushFeatherSlider.addEventListener('input', () => {
    brushFeatherVal.textContent = parseFloat(brushFeatherSlider.value).toFixed(2);
});

// Filter strength label
const filterStrengthSlider = document.getElementById('filterStrength');
const filterStrengthVal = document.getElementById('filterStrength-val');
filterStrengthSlider.addEventListener('input', () => {
    filterStrengthVal.textContent = parseFloat(filterStrengthSlider.value).toFixed(2);
});

// Show/hide filter-specific settings
const filterTypeSelect = document.getElementById('filterType');
const noiseSettings = document.getElementById('noiseSettings');
const erodeSettings = document.getElementById('erodeSettings');
const hydraulicSettings = document.getElementById('hydraulicSettings');
filterTypeSelect.addEventListener('change', () => {
    noiseSettings.style.display = filterTypeSelect.value === 'noise' ? '' : 'none';
    erodeSettings.style.display = filterTypeSelect.value === 'erode' ? '' : 'none';
    hydraulicSettings.style.display = filterTypeSelect.value === 'hydraulic' ? '' : 'none';
});

// Noise setting value labels
for (const id of ['noiseSeed', 'noiseOctaves', 'noiseScale']) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(`${id}-val`);
    el.addEventListener('input', () => { valEl.textContent = el.value; });
}
for (const id of ['noisePersistence', 'noiseLacunarity']) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(`${id}-val`);
    el.addEventListener('input', () => { valEl.textContent = parseFloat(el.value).toFixed(2); });
}

// Erode setting value labels
for (const id of ['erodeIterations', 'erodeRadius']) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(`${id}-val`);
    el.addEventListener('input', () => { valEl.textContent = el.value; });
}
for (const id of ['erodeTalus', 'erodeTransfer']) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(`${id}-val`);
    el.addEventListener('input', () => { valEl.textContent = parseFloat(el.value).toFixed(2); });
}

// Hydraulic erosion setting value labels
for (const id of ['hydDroplets', 'hydLife', 'hydCapacity', 'hydRadius']) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(`${id}-val`);
    el.addEventListener('input', () => { valEl.textContent = el.value; });
}
for (const id of ['hydInertia', 'hydErosion', 'hydDeposit', 'hydEvaporation']) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(`${id}-val`);
    el.addEventListener('input', () => { valEl.textContent = parseFloat(el.value).toFixed(2); });
}

// Color preset
document.getElementById('colorPreset').addEventListener('change', (e) => {
    setColorPreset(e.target.value);
    if (currentHeightData) {
        updateTerrain(currentHeightData, currentParams);
    }
});

// Color mode
document.getElementById('colorMode').addEventListener('change', (e) => {
    setColorMode(e.target.value);
    if (currentHeightData) {
        updateTerrain(currentHeightData, currentParams);
    }
});

// Apply filter
document.getElementById('applyFilter').addEventListener('click', () => {
    const type = document.getElementById('filterType').value;
    if (type === 'none' || !currentHeightData) return;
    const strength = parseFloat(filterStrengthSlider.value);
    applyFilter(currentHeightData, currentParams.mapSize, type, strength);
    renderCanvas2D(currentHeightData, currentParams.mapSize);
    updateTerrain(currentHeightData, currentParams);
});

// Clear paint — re-generate from noise
document.getElementById('clearPaint').addEventListener('click', regenerate);

// Export button
document.getElementById('exportPng').addEventListener('click', () => {
    const params = getParams();
    exportPNG(params.seed, params.mapSize);
});

// Load height map from image
const loadFileInput = document.getElementById('loadFile');
document.getElementById('loadPng').addEventListener('click', () => {
    loadFileInput.click();
});
loadFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
        // Use loaded image dimensions or current mapSize
        const size = img.width;

        // Draw image to offscreen canvas to read pixels
        const offscreen = document.createElement('canvas');
        offscreen.width = size;
        offscreen.height = size;
        const ctx = offscreen.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);
        const pixels = imageData.data;

        // Convert to height data (use red channel / luminance)
        const data = new Float32Array(size * size);
        for (let i = 0; i < size * size; i++) {
            const p = i * 4;
            // Luminance from RGB
            data[i] = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) / 255;
        }

        // Update map size slider to match loaded image
        const mapSizeSlider = document.getElementById('mapSize');
        mapSizeSlider.value = size;
        document.getElementById('mapSize-val').textContent = size;

        // Update state
        currentParams = getParams();
        currentParams.mapSize = size;
        currentHeightData = data;
        setBrushData(currentHeightData, size);
        renderCanvas2D(currentHeightData, size);
        updateTerrain(currentHeightData, currentParams);

        // Switch preset to Custom
        document.getElementById('preset').value = 'custom';
    };
    img.src = URL.createObjectURL(file);

    // Reset file input so same file can be loaded again
    loadFileInput.value = '';
});

// Initial generation
regenerate();
