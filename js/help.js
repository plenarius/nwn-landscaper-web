// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What the page shows only in the desktop app (desktop.js says when): the Help menu, which opens the data folder and the log;
// Area, Game folders…, which shows the app's page for the game's folders again; and the app's own words where a browser's would
// mislead (no "How to start the engine": the app starts it). Each item asks the engine inside the app, which a browser's engine
// doesn't answer: `POST /api/app/open` with `{"what": "data" | "log" | "folders"}`, 204 when done, else `{ error }`.

import { api, failure } from './api.js';
import { $ } from './dom.js';
import { IN_APP } from './desktop.js';
import { showError } from './report.js';

/** What each app-only item asks the app to open, by its button's id, and what fails to open when it can't. */
export const OPENS = {
    helpData: { what: 'data', name: 'the data folder' },
    helpLog: { what: 'log', name: 'the log' },
    btnFolders: { what: 'folders', name: 'the game folders page' },
};

/** Asks the app to open `what` (OPENS); says why in the report box when it can't. Resolves to whether it did. */
export async function openInApp({ what, name }) {
    const res = await api('/api/app/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ what }),
    });
    if (res.ok) return true;
    showError(await failure(res), `Couldn't open ${name}`);
    return false;
}

/** In the app (`app`), shows the app's items and words in place of the browser's; in a browser, leaves the page as it is. */
export function initDesktop(app = IN_APP) {
    if (!app) return;
    $('noEngineHow').hidden = true;
    $('noEngineWhy').textContent =
        "The engine inside the app stopped answering, so importing, exporting, the path check, the texture library and the game's models and blueprints are off. Sculpting works, and the app keeps your area. Restart the app; its log, landscaper.log in the data folder, says what went wrong.";
    $('nowebglBrowser').hidden = true;
    $('nowebglApp').hidden = false;
    $('menuHelp').hidden = false;
    $('btnFolders').hidden = false;
    for (const [id, item] of Object.entries(OPENS)) $(id).onclick = () => openInApp(item);
}
