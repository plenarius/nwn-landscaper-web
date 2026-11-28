// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Every request the page makes to the engine (`landscaper serve`) goes through api(). It adds the `X-Landscaper: 1`
// header, which another site's page can't send without the engine's permission (a custom header needs a CORS preflight,
// and the engine answers none), so the engine can refuse requests that don't carry it. Pictures the page loads with
// `<img>` or a texture loader are plain GETs and can't carry it.

import { IN_APP } from './desktop.js';
import { web } from './web.js';

/** What api() answers when the engine can't be reached (stopped, or the network dropped); the app starts its own engine. */
const NO_ANSWER = IN_APP
    ? 'The engine inside the app did not answer: restart the app. Its log, landscaper.log in the data folder, says what went wrong.'
    : web.on
      ? 'The engine in this page did not answer: reload the page.'
      : 'The Landscaper engine did not answer: is `landscaper serve` still running?';

/**
 * Whether the engine is there: `up` is false once a request got no answer, or /api/me (asked at start) found the page served by
 * something else (a plain file server answers 404), and true again after an engine request succeeds. Tools that need the engine
 * read it to say so instead of failing.
 */
export const engine = { up: true };

/**
 * Whose workspace the page shows: `user` is the builder an admin is looking at (read-only), null for one's own. The engine
 * reads that workspace for GETs only and does everything else in the admin's own, so while it is set api() sends no request
 * that could change something (anything but a GET, apart from CHANGE_NOTHING) and answers it as a refusal instead. app.js
 * sets it from /api/me.
 */
export const viewing = { user: null };

/** The requests other than GETs that change nothing in a workspace: going back to one's own, and checking paths. */
const CHANGE_NOTHING = new Set(['/api/view-as', '/api/check']);

/** What a tool that needs the engine says when it isn't there. */
export const NEEDS_ENGINE = IN_APP
    ? 'This needs the engine inside the app, which stopped answering: restart the app. Sculpting works without it.'
    : web.on
      ? "This needs the engine, which couldn't start in this browser: sculpting works without it."
      : 'This needs the Landscaper engine (landscaper serve), which is not running: sculpting works without it.';

/** A JSON answer's body, or `{}` when it has none (an error page, an empty answer). `res` is a fetch() Response. */
export const json = res => res.json().catch(() => ({}));

/** Why an answer isn't ok, to show: "needs the engine" when it isn't there, else the engine's JSON `error` or the status. */
export async function failure(res) {
    if (!engine.up) return NEEDS_ENGINE;
    const body = await json(res.clone());
    return body.error || `${res.status} ${res.statusText}`.trim();
}

// Whether an engine request other than /api/me has succeeded on this page (so the engine was there and may come back), and when
// api() last asked /api/me whether it has (ms since 1970). A page served by a plain file server never asks again: each request
// would only log another error in the browser's console.
let answered = false;
let askedAt = 0;
const ASK_AGAIN_MS = 5000;

/**
 * fetch() for the engine: same-origin URLs only, with the `X-Landscaper` header. When the request can't reach the engine
 * at all, it resolves to a 503 answer whose JSON body is `{ error }`, so callers handle it like any refusal from the engine.
 * While the engine is down it sends nothing to `/api/` but /api/me (which finds out whether it is back), and answers the same way;
 * so too a request that could change something while the page shows someone else's workspace (`viewing`).
 */
export async function api(url, opts = {}) {
    const where = new URL(url, location.href);
    if (where.origin !== location.origin) throw new Error(`api(): ${url} is not on this server`);
    const engineRoute = where.pathname.startsWith('/api/');
    const reads = (opts.method ?? 'GET').toUpperCase() === 'GET' || CHANGE_NOTHING.has(where.pathname);
    if (viewing.user && engineRoute && !reads) return refusal(`${viewing.user}'s workspace is read-only here: nothing was changed.`);
    if (!engine.up && engineRoute && where.pathname !== '/api/me' && !(await isBack())) return refusal(NEEDS_ENGINE);
    const headers = new Headers(opts.headers);
    headers.set('X-Landscaper', '1');
    try {
        // (In the browser page, straight to its engine: through the Service Worker, Chrome cuts a request off after 5 minutes,
        // and a 16 by 16 area's export takes longer.)
        const res =
            web.request && engineRoute
                ? await web.request(opts.method ?? 'GET', where.pathname + where.search, headers, opts.body)
                : // biome-ignore lint/plugin: the one fetch() the page has; everything else calls api()
                  await fetch(url, { ...opts, headers, credentials: 'same-origin' });
        // Only a JSON answer is the engine's: a file server that answers every path with the page (a common single-page
        // setting) also answers 200, and isn't an engine coming back. (The engine's files, a package or a picture, leave
        // engine.up as it is.)
        if (res.ok && engineRoute && (res.headers.get('Content-Type') ?? '').includes('json')) {
            engine.up = true; // (started again since)
            if (where.pathname !== '/api/me') answered = true;
        }
        return res;
    } catch {
        engine.up = false;
        return refusal(NO_ANSWER);
    }
}

/** Whether an engine that answered on this page and then stopped is back: asks /api/me, at most once every 5 s. */
async function isBack() {
    if (!answered || Date.now() - askedAt < ASK_AGAIN_MS) return false;
    askedAt = Date.now();
    await api('/api/me');
    return engine.up;
}

/** A 503 answer made here, with `text` as its status text and its JSON `error`. */
function refusal(text) {
    return new Response(JSON.stringify({ error: text }), {
        status: 503,
        statusText: text,
        headers: { 'Content-Type': 'application/json' },
    });
}
