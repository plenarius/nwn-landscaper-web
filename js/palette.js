// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Paint panel's categories: their order, and which are collapsed. A collapsed category hides its textures under its heading,
// all but the one being painted with, so the panel never hides what the brush paints. Which are collapsed is kept in this
// browser (app.js reads and writes it through dom.js's store), by name, so a category that leaves the library and comes back
// keeps its state.

/** The storage key of the collapsed categories (a JSON list of their names). */
export const COLLAPSED_KEY = 'landscaper.paletteCollapsed';

/** The categories in the panel's order: the starter library's first, as below, then any other (a team's own, Tileset) after. */
const CATEGORY_ORDER = ['Grass', 'Flowers & leaves', 'Earth', 'Rock', 'Sand', 'Snow', 'Floors', 'Walls', 'Special'];

/** The categories of `catalog` (the library's textures, each with its `category`), each once, in the panel's order. */
export function categoriesOf(catalog) {
    const rank = c => CATEGORY_ORDER.indexOf(c) + 1 || 99;
    return [...new Set(catalog.map(t => t.category))].sort((a, b) => rank(a) - rank(b));
}

/** The collapsed categories from what `stored` holds (the text kept under COLLAPSED_KEY): none when it is missing or not a
 *  list of names, as when the browser's storage is blocked. */
export function readCollapsed(stored) {
    try {
        const names = JSON.parse(stored ?? '[]');
        return new Set(Array.isArray(names) ? names.filter(n => typeof n === 'string') : []);
    } catch {
        return new Set();
    }
}

/** The text to keep under COLLAPSED_KEY for the set `collapsed`: its names, sorted so the same set is always the same text. */
export function writeCollapsed(collapsed) {
    return JSON.stringify([...collapsed].sort());
}

/** `collapsed` with `category` collapsed when it was open, opened when it was collapsed (a new set). */
export function toggled(collapsed, category) {
    const next = new Set(collapsed);
    if (!next.delete(category)) next.add(category);
    return next;
}

/** `collapsed` with `category` open (a new set): the category of a texture chosen from outside the panel. */
export function opened(collapsed, category) {
    const next = new Set(collapsed);
    next.delete(category);
    return next;
}

/** `collapsed` with every one of `categories` collapsed too (a new set). */
export function allCollapsed(collapsed, categories) {
    return new Set([...collapsed, ...categories]);
}

/** Whether texture `id` of `category` is hidden: its category is collapsed and it is not `selected`, the texture painted with. */
export function swatchHidden(collapsed, category, id, selected) {
    return collapsed.has(category) && id !== selected;
}
