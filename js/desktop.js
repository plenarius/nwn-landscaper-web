// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Whether the page runs in the desktop app (the engine's docs/DESIGN-desktop-app.md), and what differs there. The app's window
// opens the editor at `/?app`: the flag is in the address from the first line of script, before the view is made and whether or
// not the engine answers, and a reload keeps it. In a browser nothing here changes the page.

/**
 * Keep the 3D view's drawing buffer in the app on macOS, where GitHub's virtual Mac showed the view empty without it
 * (DESIGN-desktop-app.md, "The empty view on macOS"). Off until a real Mac shows the same: it costs a copy of each frame.
 */
export const KEEP_BUFFER_ON_MAC = false;

/** Whether the page's address `search` (`location.search`) says the app opened it. */
export const inApp = search => new URLSearchParams(search).has('app');

/** Whether the page runs on macOS, from the browser's `platform` (`navigator.platform`: `MacIntel` on every Mac). */
export const onMac = platform => /^Mac/.test(platform ?? '');

/** Whether the view keeps its drawing buffer: in the app on macOS, while `keep` (KEEP_BUFFER_ON_MAC) says so. */
export const keepBuffer = (app, mac, keep = KEEP_BUFFER_ON_MAC) => keep && app && mac;

/** Whether this page runs in the app. */
export const IN_APP = inApp(globalThis.location?.search ?? '');

/** The view's WebGLRenderer keeps its drawing buffer (view.js). */
export const KEEP_BUFFER = keepBuffer(IN_APP, onMac(globalThis.navigator?.platform));
