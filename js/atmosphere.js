// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// An area's light and fog: the .are's sun and moon colours, fog and view
// distance, and whether it cycles day and night. Colours are #rrggbb
// (landscaper stores them as the .are wants). Presets follow the lighting
// of a persistent world's outdoor areas.
//
// Its sky too: `sky`, the id of an installed Landscaper sky (a sky pack's, which the export turns into its skyboxes.2da row),
// or else `skyRow`, a row of the module's own skyboxes.2da. Each preset outdoors names its sky (`sky`, from the Preset skies
// pack) and the game's row nearest to it (`skyRow`) for when that pack isn't installed.

const sky = (ambient, diffuse, fog, fogAmount, shadows = true) => ({ ambient, diffuse, fog, fogAmount, shadows });

const NIGHT = sky('#000000', '#505050', '#1e1e1e', 7);

export const PRESETS = [
    {
        id: 'clear',
        name: 'Clear day',
        time: 'cycle',
        fogClip: 150,
        skyRow: 1,
        sun: sky('#504f60', '#d6d6d6', '#bbbbbb', 7),
        moon: NIGHT,
    },
    {
        id: 'golden',
        name: 'Golden haze',
        time: 'cycle',
        fogClip: 150,
        sky: 'golden-haze',
        skyRow: 3,
        sun: sky('#5b4f3c', '#e1c86f', '#b9a04a', 10),
        moon: sky('#000000', '#51481a', '#3c3d21', 10),
    },
    {
        // A low sun through haze: warm light, cool lilac shade and pale fog. Its sky is Dawn haze (the Preset skies pack).
        id: 'dawn',
        name: 'Dawn',
        time: 'cycle',
        fogClip: 130,
        sky: 'dawn-haze',
        skyRow: 4,
        sun: sky('#4f4a5e', '#f0c49c', '#b8adb4', 14),
        moon: sky('#08080f', '#3a4260', '#141821', 12),
    },
    {
        id: 'dusk',
        name: 'Dusk',
        time: 'cycle',
        fogClip: 150,
        sky: 'dusk',
        skyRow: 1,
        sun: sky('#5a3c46', '#ffa060', '#a0605a', 10),
        moon: sky('#101020', '#404870', '#101828', 8),
    },
    {
        id: 'overcast',
        name: 'Overcast',
        time: 'cycle',
        fogClip: 120,
        sky: 'overcast',
        skyRow: 2,
        sun: sky('#454950', '#a8a693', '#7a7a7a', 14, false),
        moon: sky('#000000', '#4d4d4d', '#000000', 14, false),
    },
    {
        id: 'swamp',
        name: 'Swamp',
        time: 'cycle',
        fogClip: 150,
        sky: 'swamp',
        skyRow: 2,
        sun: sky('#4e3127', '#b4c594', '#6b844a', 10),
        moon: sky('#302821', '#425238', '#183117', 10),
    },
    {
        id: 'mist',
        name: 'Thick mist',
        time: 'cycle',
        fogClip: 60,
        sky: 'thick-mist',
        skyRow: 4,
        sun: sky('#707070', '#b0b0b0', '#c8c8c8', 25, false),
        moon: sky('#101010', '#404040', '#303030', 25, false),
    },
    {
        id: 'cave',
        name: 'Cave',
        time: 'day',
        fogClip: 60,
        sun: sky('#2d2d2d', '#878a62', '#000000', 5, false),
        moon: sky('#2d2d2d', '#878a62', '#000000', 5, false),
    },
    {
        id: 'torchlit',
        name: 'Torchlit cave',
        time: 'day',
        fogClip: 45,
        sun: sky('#3a2a1a', '#d08040', '#100804', 6, false),
        moon: sky('#3a2a1a', '#d08040', '#100804', 6, false),
    },
    {
        id: 'indoors',
        name: 'Indoors',
        time: 'day',
        fogClip: 45,
        sun: sky('#5a5048', '#c0a080', '#000000', 0, false),
        moon: sky('#5a5048', '#c0a080', '#000000', 0, false),
    },
    {
        id: 'night',
        name: 'Dark night',
        time: 'night',
        fogClip: 150,
        sky: 'starry-night',
        skyRow: 3,
        sun: sky('#504f60', '#d6d6d6', '#bbbbbb', 7),
        moon: sky('#0a0a18', '#3c4878', '#05070f', 12),
    },
];

/** The light and fog a new area starts with: a copy of the first preset. */
export function defaultAtmosphere() {
    return copyPreset(PRESETS[0]);
}

/** The Landscaper skies installed in the engine (`/api/skies`: `{ id, name, preset }`), which sky.js keeps up to date. */
export const installedSkies = [];

/** Replaces the list of installed skies. */
export function setInstalledSkies(list) {
    installedSkies.splice(0, installedSkies.length, ...list.filter(s => typeof s?.id === 'string'));
}

/** The sky preset `p` gives an area: `{ sky }` when its own sky (or another installed one made for it) is installed, else
 *  `{ skyRow }`, the game's nearest row; `{}` for a preset with neither (underground). */
export function presetSky(p) {
    const own = installedSkies.find(s => s.id === p.sky) ?? installedSkies.find(s => s.preset === p.id);
    if (own) return { sky: own.id };
    return p.skyRow != null ? { skyRow: p.skyRow } : {};
}

/** An area's light and fog from preset `p`: a copy, so changing it leaves the preset alone. */
export function copyPreset(p) {
    return { preset: p.id, time: p.time, fogClip: p.fogClip, sun: { ...p.sun }, moon: { ...p.moon }, ...presetSky(p) };
}

/** How bright colour `hex` ('#rrggbb') is, 0 to 1, as typed (gamma). */
const brightness = hex => {
    const n = Number.parseInt(String(hex).slice(1), 16);
    if (!Number.isFinite(n)) return 0;
    return (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
};

/** The least light the view works in: a sun's or a moon's ambient and diffuse brightness added. The presets' nights are 0.27 to
 *  0.36; the showcase's cave by night is 0.18, too dark to see the ground. */
export const WORK_FLOOR = 0.3;

/** How much of the view's working light stays on under light `s` (a sun's or a moon's settings) when the view shows the area's
 *  light: none at WORK_FLOOR and over, all of it for black. Without it a dark cave opened as a black screen. */
export const workShare = s => Math.max(0, Math.min(1, 1 - (brightness(s.ambient) + brightness(s.diffuse)) / WORK_FLOOR));

/** The game's fog at the client (landscaper and Moonglow read it from its
 *  shader): linear, ending at the view distance, starting FogAmount metres
 *  nearer than 30 m from a camera kept near the player. */
export function fogRange(atmosphere, night) {
    const s = night ? atmosphere.moon : atmosphere.sun;
    const end = atmosphere.fogClip;
    return { start: Math.min(30 - s.fogAmount, end - 1), end, color: s.fog };
}
