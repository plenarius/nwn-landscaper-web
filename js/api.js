// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Every request the page makes to the engine (`landscaper serve`) goes through api(). It adds the `X-Landscaper: 1`
// header, which another site's page can't send without the engine's permission (a custom header needs a CORS preflight,
// and the engine answers none), so the engine can refuse requests that don't carry it. Pictures the page loads with
// `<img>` or a texture loader, and downloads, are plain GETs and can't carry it.

/** What api() answers when the engine can't be reached (stopped, or the network dropped). */
const NO_ANSWER = 'The Landscaper engine did not answer: is `landscaper serve` still running?';

/**
 * fetch() for the engine: same-origin URLs only, with the `X-Landscaper` header. When the request can't reach the engine
 * at all, it resolves to a 503 answer whose JSON body is `{ error }`, so callers handle it like any refusal from the engine.
 */
export async function api(url, opts = {}) {
    if (new URL(url, location.href).origin !== location.origin) throw new Error(`api(): ${url} is not on this server`);
    const headers = new Headers(opts.headers);
    headers.set('X-Landscaper', '1');
    try {
        // biome-ignore lint/plugin: the one fetch() the page has; everything else calls api()
        return await fetch(url, { ...opts, headers, credentials: 'same-origin' });
    } catch {
        return new Response(JSON.stringify({ error: NO_ANSWER }), {
            status: 503,
            statusText: NO_ANSWER,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
