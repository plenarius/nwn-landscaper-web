// Big, plain toolbar icons (inline SVG, currentColor).

const svg = body => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
    raise: svg('<path d="M4 40 L18 20 L26 30 L32 22 L44 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M36 16 V4 M30 10 L36 4 L42 10"/>'),
    lower: svg('<path d="M4 18 L16 18 L24 34 L32 18 L44 18 L44 40 L4 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M24 4 V16 M18 10 L24 16 L30 10"/>'),
    smooth: svg('<path d="M4 30 L10 20 L14 34 L20 16 L24 30" /><path d="M28 26 C32 22 36 22 40 26 C42 28 44 28 46 26" stroke-opacity="0.9"/><path d="M24 26 H28" stroke-dasharray="2 3"/>'),
    flatten: svg('<path d="M4 40 L10 26 L18 26 L30 26 L38 26 L44 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M8 14 H40 M14 8 L8 14 L14 20 M34 8 L40 14 L34 20"/>'),
    paint: svg('<path d="M30 6 L42 18 L24 36 L12 24 Z" fill="currentColor" fill-opacity="0.25"/><path d="M12 24 C6 30 8 38 4 42 C10 42 18 42 22 36"/><path d="M30 6 L42 18"/>'),
    newArea: svg('<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M8 19 H40 M8 30 H40 M19 8 V40 M30 8 V40" stroke-width="1.5" stroke-opacity="0.6"/><circle cx="38" cy="38" r="9" fill="currentColor"/><path d="M38 33 V43 M33 38 H43" stroke="#1d2228" stroke-width="3"/>'),
    undo: svg('<path d="M14 16 H30 A10 10 0 0 1 30 36 H18"/><path d="M20 10 L14 16 L20 22"/>'),
    redo: svg('<path d="M34 16 H18 A10 10 0 0 0 18 36 H30"/><path d="M28 10 L34 16 L28 22"/>'),
    exportNwn: svg('<path d="M8 30 V40 H40 V30"/><path d="M24 6 V30 M16 22 L24 30 L32 22"/>'),
    walk: svg('<path d="M4 40 L16 22 L24 32 L32 18 L44 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M26 30 L32 18 L38 28" stroke="#e0402a" stroke-width="4"/>'),
};
