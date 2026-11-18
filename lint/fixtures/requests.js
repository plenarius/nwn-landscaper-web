// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What lint/fetch-through-api.grit must refuse (each line ending in `flagged`) and let through (the others). Not part of the
// page: biome.json leaves this folder out, and tests/lint.test.js lints it with the plugins alone.

import { api } from '../../js/api.js';

export async function refused(url, data) {
    await fetch(url); // flagged
    await window.fetch(url); // flagged
    await globalThis.fetch(url); // flagged
    await self.fetch(url); // flagged
    await globalThis['fetch'](url); // flagged
    const f = fetch; // flagged
    const { fetch: g } = globalThis; // flagged
    const x = new XMLHttpRequest(); // flagged
    const y = new window.XMLHttpRequest(); // flagged
    navigator.sendBeacon(url, data); // flagged
    const s = navigator.sendBeacon; // flagged
    navigator['sendBeacon'](url, data); // flagged
    return [f, g, x, y, s];
}

export async function allowed(url, o, log) {
    const res = await api(url);
    o.fetchCount = 1;
    const fetched = await res.json();
    log('fetch failed');
    log(`sendBeacon is not used`);
    return fetched;
}
