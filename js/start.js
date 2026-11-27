// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's start: when the site carries an engine for the browser (`try/site.json`, written by scripts/try-site.sh), the
// engine starts in this page first (try/page.js); then the editor. From `landscaper serve` or the desktop app there is no such
// file (the engine answers 404), and the editor starts at once.

import { web } from './web.js';

async function site() {
    try {
        // biome-ignore lint/plugin: the site's own file, not an engine request
        const res = await fetch('try/site.json', { cache: 'no-cache' });
        if (!res.ok || !(res.headers.get('Content-Type') ?? '').includes('json')) return null;
        return await res.json();
    } catch {
        return null;
    }
}

const inBrowser = await site();
if (inBrowser) {
    web.on = true;
    const { startEngine } = await import('../try/page.js');
    await startEngine(inBrowser);
} else if (navigator.serviceWorker?.controller) {
    // The browser page was served from this address before (a test of the site on this machine): its Service Worker would
    // pass the engine's requests to a page that has no engine. It goes, and the page loads again without it.
    await (await navigator.serviceWorker.getRegistration())?.unregister();
    location.reload();
    await new Promise(() => {});
}
await import('./app.js');
