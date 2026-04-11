const sliderIds = ['mapSize', 'octaves', 'persistence', 'lacunarity', 'scale', 'panX', 'panY', 'blackLevel', 'whiteLevel', 'heightMultiplier', 'waterLevel'];

const PRESETS = {
    'rolling-hills': { octaves: 4, persistence: 0.35, lacunarity: 2.2, scale: 200, heightMultiplier: 20, waterLevel: 0.2 },
    'sharp-peaks': { octaves: 8, persistence: 0.55, lacunarity: 2.5, scale: 80, heightMultiplier: 60, waterLevel: 0.25 },
    'archipelago': { octaves: 5, persistence: 0.45, lacunarity: 2.0, scale: 120, heightMultiplier: 25, waterLevel: 0.55 },
    'plateaus': { octaves: 3, persistence: 0.3, lacunarity: 3.0, scale: 150, heightMultiplier: 40, waterLevel: 0.3 },
    'gentle-dunes': { octaves: 3, persistence: 0.25, lacunarity: 2.0, scale: 300, heightMultiplier: 15, waterLevel: 0.1 },
    'alpine': { octaves: 7, persistence: 0.5, lacunarity: 2.2, scale: 100, heightMultiplier: 80, waterLevel: 0.35 },
};

/**
 * Read all current parameter values from the DOM.
 */
export function getParams() {
    return {
        seed: parseInt(document.getElementById('seed').value, 10) || 0,
        mapSize: parseInt(document.getElementById('mapSize').value, 10),
        octaves: parseInt(document.getElementById('octaves').value, 10),
        persistence: parseFloat(document.getElementById('persistence').value),
        lacunarity: parseFloat(document.getElementById('lacunarity').value),
        scale: parseFloat(document.getElementById('scale').value),
        panX: parseFloat(document.getElementById('panX').value),
        panY: parseFloat(document.getElementById('panY').value),
        blackLevel: parseFloat(document.getElementById('blackLevel').value),
        whiteLevel: parseFloat(document.getElementById('whiteLevel').value),
        heightMultiplier: parseFloat(document.getElementById('heightMultiplier').value),
        waterLevel: parseFloat(document.getElementById('waterLevel').value),
    };
}

/**
 * Format a numeric value for display based on its step size.
 */
function formatValue(id, value) {
    const el = document.getElementById(id);
    const step = parseFloat(el.step);
    if (step < 1) {
        return parseFloat(value).toFixed(2);
    }
    return value;
}

/**
 * Apply a preset's values to the sliders and update their labels.
 */
function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;

    for (const [key, value] of Object.entries(preset)) {
        const el = document.getElementById(key);
        if (el) {
            el.value = value;
            const valLabel = document.getElementById(`${key}-val`);
            if (valLabel) valLabel.textContent = formatValue(key, value);
        }
    }
}

/**
 * Bind slider events and buttons. Calls `onChange` when any parameter changes.
 */
export function bindControls(onChange) {
    // Initialize value labels
    for (const id of sliderIds) {
        const el = document.getElementById(id);
        document.getElementById(`${id}-val`).textContent = formatValue(id, el.value);
    }

    // Preset dropdown
    document.getElementById('preset').addEventListener('change', (e) => {
        if (e.target.value !== 'custom') {
            applyPreset(e.target.value);
            onChange();
        }
    });

    // Slider input events — switch preset to "Custom" when manually adjusted
    for (const id of sliderIds) {
        const el = document.getElementById(id);
        el.addEventListener('input', () => {
            document.getElementById(`${id}-val`).textContent = formatValue(id, el.value);
            document.getElementById('preset').value = 'custom';
            onChange();
        });
    }

    // Seed input
    document.getElementById('seed').addEventListener('change', onChange);

    // Randomize seed
    document.getElementById('randomize').addEventListener('click', () => {
        document.getElementById('seed').value = Math.floor(Math.random() * 100000);
        onChange();
    });

    // Regenerate button
    document.getElementById('regenerate').addEventListener('click', onChange);

    // Export button is handled separately in main.js
}
