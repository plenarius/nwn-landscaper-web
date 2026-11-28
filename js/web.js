// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Whether the page runs its engine itself, in the browser (the page in try/, the engine's docs/DESIGN-web-demo.md), and what
// differs there. start.js decides before the editor's modules load, so they read it as they start. On the desktop or from
// `landscaper serve` nothing here changes the page.

/**
 * `on`: the engine runs in this page. `call(what, ...args)`: asks the page's engine Worker for something that isn't an API
 * request (an export's zip). `request(method, path, headers, body)`: an API request to that Worker, as a Response. `boot`: what
 * the start took, for the tests and the console.
 */
export const web = { on: false, call: null, request: null, boot: null };

/** Saves `bytes` (a Uint8Array, or a Blob) as a download called `name`. */
export function download(name, bytes, type = 'application/octet-stream') {
    const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
