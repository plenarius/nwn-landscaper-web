// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Building the page from data. Text from an area, the engine or the browser's storage always goes in as text, never as HTML:
// an area's names, tags and links are typed by builders, and an admin opens builders' areas.

/**
 * A new element: `props` are set on it (`className`, `textContent`, `title`, ...) and `kids` appended. A string kid is
 * added as text; `null`, `undefined` and `false` are skipped, so a kid can be a condition.
 */
export function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids.filter(k => k != null && k !== false));
    return e;
}

/** The page's element with id `id` (null when there is none). */
export const $ = id => document.getElementById(id);
