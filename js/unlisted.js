// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The files of the areas folder that the engine's area list leaves out, and why (`/api/areas`'s `unlisted`): Open shows them
// greyed below the areas, so a file copied in by hand with a name the engine can't open doesn't vanish without a word.

import { el } from './dom.js';

/** The left-out files ({ file, why }) of an `/api/areas` answer; none from an engine too old to send them. */
export function unlistedOf(answer) {
    const list = Array.isArray(answer?.unlisted) ? answer.unlisted : [];
    return list.filter(u => typeof u?.file === 'string').map(u => ({ file: u.file, why: typeof u.why === 'string' ? u.why : '' }));
}

/** Open's rows for `unlisted` (unlistedOf): a heading, then each file greyed with its reason. Nothing when there are none. */
export function unlistedRows(unlisted) {
    if (!unlisted.length) return [];
    return [
        el('div', { className: 'open-unlisted-head', textContent: "Files in your areas folder that can't be opened" }),
        ...unlisted.map(u =>
            el('div', { className: 'open-unlisted', title: u.why }, el('b', { textContent: u.file }), el('small', { textContent: u.why })),
        ),
    ];
}
