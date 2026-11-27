// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// When the engine has none of the game's files (the web demo, before the visitor gives it their game folder: /api/me's `game`
// is false), the panels that read them say so, with a button to give the page the game folder, instead of lists that stay empty.

import { $, el, say } from './dom.js';

/** Each panel or dialog that needs the game: its id, its name, and what it reads from the game. */
export const NEEDS_GAME = [
    ['placePanel', 'Place', "puts down the game's placeables"],
    ['scatterPanel', 'Scatter', "scatters the game's placeables"],
    ['thingsPanel', 'Things', "places doors, creatures, chests and the rest from the game's blueprints"],
    ['scriptDialog', 'Scripts', "checks your scripts with the game's own compiler"],
    ['importDialog', 'Import', "rebuilds an area from the game's tilesets"],
];

/** What the game-folder button says it will do: reading the game in the page comes in a later version. */
export const GAME_FOLDER_SOON =
    'Using your game folder in this page is coming soon. Until then, the panels that say they need the game need the Landscaper on your computer.';

/** The notice for `name`, which `what`. */
function notice(name, what) {
    const button = el('button', { type: 'button', className: 'game-folder', textContent: 'Use my game folder…' });
    button.onclick = () => {
        button.disabled = true;
        button.textContent = 'Coming soon';
        say(GAME_FOLDER_SOON);
    };
    const box = el(
        'div',
        { className: 'needs-game' },
        el('p', { textContent: `${name} needs your copy of Neverwinter Nights: it ${what}, and this page has none of the game's files.` }),
        button,
    );
    box.setAttribute('role', 'note');
    return box;
}

/** The panels the page's own stock placeables serve (the web demo with stock/: /api/me's `stock`). */
export const STOCK_SERVES = new Set(['placePanel', 'scatterPanel']);

/** Marks each panel that needs the game, with its notice, when `noGame`; takes the marks off otherwise. With `stock`, the
 *  panels the page's stock placeables serve need nothing more. */
export function showNoGame(noGame, stock = false) {
    for (const [id, name, what] of NEEDS_GAME) {
        const host = $(id);
        if (!host) continue;
        const needs = noGame && !(stock && STOCK_SERVES.has(id));
        host.classList.toggle('no-game', needs);
        // In a dialog, the notice goes under its title (inside its form, when it has one).
        const inner = host.querySelector(':scope > form') ?? host;
        const had = inner.querySelector(':scope > .needs-game');
        if (!needs) {
            had?.remove();
            continue;
        }
        if (had) continue;
        const title = inner.querySelector(':scope > h2, :scope > h3');
        const box = notice(name, what);
        if (title) title.after(box);
        else inner.prepend(box);
    }
}
