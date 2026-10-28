// One colour per kind of thing, shared by the view (markers, outlines) and the Things panel (its chips).
export const THING_COLOURS = {
    creature: 0xe0402a, waypoint: 0x4aa3ff, trigger: 0xffd34a, sound: 0xb06bff, encounter: 0xff8a2a,
    store: 0x55c24a, item: 0xeeeeee, door: 0xc08a5a, placeable: 0x9aa7b4,
};
export const css = hex => `#${hex.toString(16).padStart(6, '0')}`;
