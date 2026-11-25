// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Big, plain toolbar icons (inline SVG, currentColor).

const svg = body =>
    `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
    raise: svg(
        '<path d="M4 40 L18 20 L26 30 L32 22 L44 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M36 16 V4 M30 10 L36 4 L42 10"/>',
    ),
    lower: svg(
        '<path d="M4 18 L16 18 L24 34 L32 18 L44 18 L44 40 L4 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M24 4 V16 M18 10 L24 16 L30 10"/>',
    ),
    smooth: svg(
        '<path d="M4 30 L10 20 L14 34 L20 16 L24 30" /><path d="M28 26 C32 22 36 22 40 26 C42 28 44 28 46 26" stroke-opacity="0.9"/><path d="M24 26 H28" stroke-dasharray="2 3"/>',
    ),
    flatten: svg(
        '<path d="M4 40 L10 26 L18 26 L30 26 L38 26 L44 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M8 14 H40 M14 8 L8 14 L14 20 M34 8 L40 14 L34 20"/>',
    ),
    paint: svg(
        '<path d="M30 6 L42 18 L24 36 L12 24 Z" fill="currentColor" fill-opacity="0.25"/><path d="M12 24 C6 30 8 38 4 42 C10 42 18 42 22 36"/><path d="M30 6 L42 18"/>',
    ),
    sky: svg(
        '<circle cx="18" cy="16" r="7"/><path d="M18 3 V5 M5 16 H7 M8.8 6.8 L10.2 8.2 M27.2 6.8 L25.8 8.2"/><path d="M14 38 H38 A7 7 0 0 0 36 24.4 A9 9 0 0 0 19 26 A6 6 0 0 0 14 38 Z" fill="currentColor" fill-opacity="0.25"/>',
    ),
    // Two ledges and the drop between them, dark to its bottom.
    chasm: svg(
        '<path d="M4 16 H18 L20 44 H4 Z M44 16 H30 L28 44 H44 Z" fill="currentColor" fill-opacity="0.25"/><path d="M20 22 L28 22 L28 44 L20 44 Z" fill="currentColor" fill-opacity="0.9"/><path d="M4 16 H18 L20 44 M44 16 H30 L28 44"/>',
    ),
    water: svg(
        '<path d="M24 6 C30 15 35 21 35 28 A11 11 0 0 1 13 28 C13 21 18 15 24 6 Z" fill="currentColor" fill-opacity="0.25"/><path d="M4 42 C9 38 13 38 18 42 C23 46 27 46 32 42 C37 38 41 38 46 42"/>',
    ),
    entrance: svg(
        '<path d="M4 42 L10 20 L24 8 L38 20 L44 42 Z" fill="currentColor" fill-opacity="0.25"/><path d="M16 42 V30 A8 8 0 0 1 32 30 V42" fill="currentColor" fill-opacity="0.9"/>',
    ),
    place: svg(
        '<path d="M6 40 C8 30 14 26 20 28 C24 22 34 22 36 30 C42 30 44 36 42 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M34 6 V18 M28 12 H40"/>',
    ),
    scatter: svg(
        '<circle cx="12" cy="30" r="5" fill="currentColor" fill-opacity="0.3"/><circle cx="26" cy="22" r="4" fill="currentColor" fill-opacity="0.3"/><circle cx="36" cy="34" r="6" fill="currentColor" fill-opacity="0.3"/><circle cx="22" cy="38" r="3" fill="currentColor" fill-opacity="0.3"/><path d="M38 6 L42 10 M40 6 V14 M36 10 H44" stroke-width="2"/>',
    ),
    things: svg(
        '<path d="M24 4 L32 40 H16 Z" fill="currentColor" fill-opacity="0.25"/><circle cx="24" cy="12" r="5" fill="currentColor" fill-opacity="0.5"/><path d="M6 42 H42"/>',
    ),
    check: svg(
        '<path d="M6 36 C14 36 14 22 22 22 S30 10 40 10" stroke-dasharray="4 4"/><circle cx="6" cy="36" r="3" fill="currentColor"/><path d="M34 32 L39 37 L46 28" stroke-width="3.5"/>',
    ),
    dig: svg(
        '<path d="M4 40 V14 H44 V40 Z" fill="currentColor" fill-opacity="0.35"/><path d="M14 40 C14 26 34 26 34 40" fill="#1d2228" stroke="currentColor"/><path d="M30 6 L40 16 M40 6 L36 10"/>',
    ),
    open: svg('<path d="M6 38 V12 H18 L22 16 H40 V22"/><path d="M6 38 L12 22 H44 L38 38 Z" fill="currentColor" fill-opacity="0.25"/>'),
    ramp: svg(
        '<path d="M6 36 H14 V30 H22 V24 H30 V18 H38 V12 H44" stroke-width="3"/><path d="M6 40 H44" stroke-opacity="0.5"/><path d="M8 36 L40 14" stroke="#e0b24a" stroke-width="2.5" stroke-dasharray="3 3"/>',
    ),
    descent: svg(
        '<path d="M6 10 H42 M42 10 V20 M42 20 H6 M6 20 V30 M6 30 H42 M42 30 V40 M42 40 H12" stroke-width="3"/><path d="M40 12 L44 18 M8 22 L4 28" stroke="#e0b24a" stroke-width="2.5"/>',
    ),
    room: svg(
        '<rect x="6" y="10" width="36" height="28" fill="currentColor" fill-opacity="0.35"/><path d="M14 18 H34 V30 H14 Z" fill="#1d2228"/><path d="M24 30 V38" stroke-width="4" stroke="#1d2228"/>',
    ),
    newArea: svg(
        '<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M8 19 H40 M8 30 H40 M19 8 V40 M30 8 V40" stroke-width="1.5" stroke-opacity="0.6"/><circle cx="38" cy="38" r="9" fill="currentColor"/><path d="M38 33 V43 M33 38 H43" stroke="#1d2228" stroke-width="3"/>',
    ),
    undo: svg('<path d="M14 16 H30 A10 10 0 0 1 30 36 H18"/><path d="M20 10 L14 16 L20 22"/>'),
    redo: svg('<path d="M34 16 H18 A10 10 0 0 0 18 36 H30"/><path d="M28 10 L34 16 L28 22"/>'),
    exportNwn: svg('<path d="M8 30 V40 H40 V30"/><path d="M24 6 V30 M16 22 L24 30 L32 22"/>'),
    walk: svg(
        '<path d="M4 40 L16 22 L24 32 L32 18 L44 40 Z" fill="currentColor" fill-opacity="0.25"/><path d="M26 30 L32 18 L38 28" stroke="#e0402a" stroke-width="4"/>',
    ),
};
