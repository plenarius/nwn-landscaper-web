// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The visitor's game folder, for an export's tile shaders (the engine's docs/DESIGN-web-demo.md, question 5): asked for at an
// export until it is given, read for three small files (try/shaders.js), which go to the page's engine for this visit only.
// Chromium has a folder picker and remembers the folder (its handle, in this site's IndexedDB: no file of the game is kept);
// Firefox and Safari choose it each visit in an upload field, which reads nothing but the files asked for.

import { ask } from './ask.js';
import { say } from './dom.js';
import { web } from './web.js';
import { openFiles, openHandle, readShaders } from '../try/shaders.js';

/** Where Chromium's folder handle is remembered. */
const DB = 'landscaper-web';
const STORE = 'folders';

/** Whether this visit's engine has the shaders. */
export const game = { shaders: false };

/** The remembered folder handle (Chromium), or null. */
function remembered(put) {
    return new Promise(done => {
        try {
            const open = indexedDB.open(DB, 1);
            open.onupgradeneeded = () => open.result.createObjectStore(STORE);
            open.onerror = () => done(null);
            open.onsuccess = () => {
                const tx = open.result.transaction(STORE, put === undefined ? 'readonly' : 'readwrite');
                const req = put === undefined ? tx.objectStore(STORE).get('game') : tx.objectStore(STORE).put(put, 'game');
                req.onsuccess = () => done(put === undefined ? (req.result ?? null) : put);
                req.onerror = () => done(null);
            };
        } catch {
            done(null);
        }
    });
}

/** The folder the visitor chooses: `open(path)` for its files (shaders.js), or null when they chose none. */
async function choose() {
    if (globalThis.showDirectoryPicker) {
        try {
            const dir = await showDirectoryPicker({ id: 'nwn-game', mode: 'read' });
            remembered(dir);
            return openHandle(dir);
        } catch {
            return null; // (cancelled)
        }
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.hidden = true;
    document.body.append(input);
    const files = await new Promise(done => {
        input.onchange = () => done(input.files);
        input.oncancel = () => done(null);
        input.click();
    });
    input.remove();
    return files?.length ? openFiles(files) : null;
}

/** Reads the shaders through `open` and gives them to the engine: true when it has them, else says why. */
async function give(open) {
    try {
        const files = await readShaders(open);
        await web.call('shaders', files);
        game.shaders = true;
        say("Your game's shaders are in this export: it draws right in the game.");
        return true;
    } catch (err) {
        say(`Couldn't read the game's shaders: ${err.message}`);
        await ask({ title: "Couldn't read the game folder", text: err.message });
        return false;
    }
}

/**
 * Before an export (in the click's own turn, so the browser lets it ask): the game's shaders for this visit's engine. A folder
 * Chromium remembers is read again, asking the browser's permission if needed; otherwise the visitor is asked, at each export
 * until they give it (one click to go on without).
 * Resolves to whether the engine has them; the export goes on either way.
 */
export async function shadersForExport() {
    // (The page's own copy of the game's shaders, with its stock placeables: nothing to ask.)
    if (web.boot?.stock?.shaders) game.shaders = true;
    if (!web.on || game.shaders) return game.shaders;
    const dir = await remembered();
    if (dir?.queryPermission) {
        let allowed = await dir.queryPermission({ mode: 'read' }).catch(() => 'denied');
        if (allowed === 'prompt') allowed = await dir.requestPermission({ mode: 'read' }).catch(() => 'denied');
        if (allowed === 'granted' && (await give(openHandle(dir)))) return true;
    }
    const upload = !globalThis.showDirectoryPicker;
    const yes = await ask({
        title: "Your game's shaders",
        text:
            "To draw right in the game, an export needs three small files from your copy of Neverwinter Nights: its tiles' shaders. Choose the folder the game is installed in (the one with data and lang in it). Only those files are read, and they stay in this page until you close it." +
            (upload ? '\n\nYour browser will say it uploads the folder: nothing leaves this computer.' : ''),
        ok: 'Choose the game folder…',
        cancel: 'Export without them',
    });
    if (yes !== true) return false;
    const open = await choose();
    return open ? give(open) : false;
}
