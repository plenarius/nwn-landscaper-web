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

/** Shows `text` in the status line under the view (the empty string clears it). */
export function say(text) {
    $('statusMsg').textContent = text;
}

/**
 * Storage in this browser that never throws. With the site's data blocked (cookies off for it, some private modes) even
 * reading `localStorage` throws `SecurityError`, and a full one throws on writing; the page works without it, so `get` then
 * answers null, `keys` an empty list, and `set` and `remove` return false. `which()` names the browser's storage.
 */
function storage(which) {
    const guard = (f, otherwise) => {
        try {
            return f(which());
        } catch {
            return otherwise;
        }
    };
    return {
        get: key => guard(s => s.getItem(key), null),
        set: (key, value) =>
            guard(s => {
                s.setItem(key, value);
                return true;
            }, false),
        remove: key =>
            guard(s => {
                s.removeItem(key);
                return true;
            }, false),
        keys: () => guard(s => Object.keys(s), []),
    };
}

/** `localStorage` through storage(): kept in this browser. */
export const store = storage(() => localStorage);

/** `sessionStorage` through storage(): kept until the tab closes. */
export const session = storage(() => sessionStorage);
