// An area's light and fog: the .are's sun and moon colours, fog and view
// distance, and whether it cycles day and night. Colours are #rrggbb
// (landscaper stores them as the .are wants). Presets follow the lighting
// of Layonara's outdoor areas.

const sky = (ambient, diffuse, fog, fogAmount, shadows = true) => ({ ambient, diffuse, fog, fogAmount, shadows });

const NIGHT = sky('#000000', '#505050', '#1e1e1e', 7);

export const PRESETS = [
    { id: 'clear', name: 'Clear day', time: 'cycle', fogClip: 150, sun: sky('#504f60', '#d6d6d6', '#bbbbbb', 7), moon: NIGHT },
    {
        id: 'golden',
        name: 'Golden haze',
        time: 'cycle',
        fogClip: 150,
        sun: sky('#5b4f3c', '#e1c86f', '#b9a04a', 10),
        moon: sky('#000000', '#51481a', '#3c3d21', 10),
    },
    {
        id: 'dusk',
        name: 'Dusk',
        time: 'cycle',
        fogClip: 150,
        sun: sky('#5a3c46', '#ffa060', '#a0605a', 10),
        moon: sky('#101020', '#404870', '#101828', 8),
    },
    {
        id: 'overcast',
        name: 'Overcast',
        time: 'cycle',
        fogClip: 120,
        sun: sky('#454950', '#a8a693', '#7a7a7a', 14, false),
        moon: sky('#000000', '#4d4d4d', '#000000', 14, false),
    },
    {
        id: 'swamp',
        name: 'Swamp',
        time: 'cycle',
        fogClip: 150,
        sun: sky('#4e3127', '#b4c594', '#6b844a', 10),
        moon: sky('#302821', '#425238', '#183117', 10),
    },
    {
        id: 'mist',
        name: 'Thick mist',
        time: 'cycle',
        fogClip: 60,
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
        sun: sky('#504f60', '#d6d6d6', '#bbbbbb', 7),
        moon: sky('#0a0a18', '#3c4878', '#05070f', 12),
    },
];

export function defaultAtmosphere() {
    return copyPreset(PRESETS[0]);
}

export function copyPreset(p) {
    return { preset: p.id, time: p.time, fogClip: p.fogClip, sun: { ...p.sun }, moon: { ...p.moon } };
}

/** The game's fog at the client (landscaper and Moonglow read it from its
 *  shader): linear, ending at the view distance, starting FogAmount metres
 *  nearer than 30 m from a camera kept near the player. */
export function fogRange(atmosphere, night) {
    const s = night ? atmosphere.moon : atmosphere.sun;
    const end = atmosphere.fogClip;
    return { start: Math.min(30 - s.fogAmount, end - 1), end, color: s.fog };
}

/** Whether the game shows the area at night when it isn't cycling. */
export function nightOnly(atmosphere) {
    return atmosphere.time === 'night';
}
