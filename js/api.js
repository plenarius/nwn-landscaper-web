// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Every request the page makes to the engine (`landscaper serve`) goes through api(). It adds the `X-Landscaper: 1`
// header, which another site's page can't send without the engine's permission (a custom header needs a CORS preflight,
// and the engine answers none), so the engine can refuse requests that don't carry it. Pictures the page loads with
// `<img>` or a texture loader, and downloads, are plain GETs and can't carry it.

/** What api() answers when the engine can't be reached (stopped, or the network dropped). */
export const NO_ANSWER = 'The Landscaper engine did not answer: is `landscaper serve` still running?';

/**
 * Whether the engine is there: `up` is false once a request got no answer, or /api/me (asked at start) found the page served by
 * something else (a plain file server answers 404), and true again after an engine request succeeds. Tools that need the engine read it to say so instead of failing.
 */
export const engine = { up: true };

/** What a tool that needs the engine says when it isn't there. */
export const NEEDS_ENGINE =
    'This needs the Landscaper engine (landscaper serve), which is not running: sculpting and painting work without it.';

/** Why an answer isn't ok, to show: "needs the engine" when it isn't there, else the engine's JSON `error` or the status. */
export async function failure(res) {
    if (!engine.up) return NEEDS_ENGINE;
    const body = await res
        .clone()
        .json()
        .catch(() => ({}));
    return body.error || `${res.status} ${res.statusText}`.trim();
}

/**
 * fetch() for the engine: same-origin URLs only, with the `X-Landscaper` header. When the request can't reach the engine
 * at all, it resolves to a 503 answer whose JSON body is `{ error }`, so callers handle it like any refusal from the engine.
 */
export async function api(url, opts = {}) {
    const where = new URL(url, location.href);
    if (where.origin !== location.origin) throw new Error(`api(): ${url} is not on this server`);
    const headers = new Headers(opts.headers);
    headers.set('X-Landscaper', '1');
    try {
        // biome-ignore lint/plugin: the one fetch() the page has; everything else calls api()
        const res = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
        if (res.ok && where.pathname.startsWith('/api/')) engine.up = true; // (started again since)
        return res;
    } catch {
        engine.up = false;
        return new Response(JSON.stringify({ error: NO_ANSWER }), {
            status: 503,
            statusText: NO_ANSWER,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
