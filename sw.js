// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Service Worker of the page in the browser (try/, the engine's docs/DESIGN-web-demo.md): it passes the editor's engine
// requests (`/api/...` and the texture library, `textures/...`) to the page that made them, which hands them to its own engine
// Worker (try/worker.js), and returns the answer. Only a Service Worker can answer a picture's URL (`<img>`, three.js's loader).
// It keeps nothing itself: a browser may stop it whenever it is idle. Everything else is the site's own files.

const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', ev => ev.waitUntil(self.clients.claim()));
// (A page loaded with the cache bypassed has no Service Worker until it asks.)
self.addEventListener('message', ev => {
    if (ev.data === 'claim') ev.waitUntil(self.clients.claim());
});

/** The engine's path for `url` (the API, or the texture library's `/textures/...`), or null for the site's own files. */
function enginePath(url) {
    if (url.origin !== self.location.origin) return null;
    if (url.pathname.startsWith('/api/')) return url.pathname + url.search;
    if (url.pathname.startsWith(`${SCOPE}textures/`)) return `/${url.pathname.slice(SCOPE.length)}${url.search}`;
    return null;
}

/** A JSON answer `{ error }` made here. */
const refusal = (status, error) =>
    new Response(JSON.stringify({ error }), { status, statusText: error, headers: { 'Content-Type': 'application/json' } });

/** `request` (to the engine's `path`) answered by the engine of the page `clientId`. */
async function ask(request, path, clientId) {
    const client = clientId ? await self.clients.get(clientId) : null;
    if (!client) return refusal(503, 'No page to answer this: reload the page.');
    const reads = request.method === 'GET' || request.method === 'HEAD';
    const body = reads ? null : await request.arrayBuffer();
    const { port1, port2 } = new MessageChannel();
    const answered = new Promise(done => {
        port1.onmessage = m => done(m.data);
    });
    const headers = [...request.headers];
    client.postMessage({ kind: 'landscaper-request', method: request.method, path, headers, body }, body ? [port2, body] : [port2]);
    const a = await answered;
    const empty = a.status === 204 || a.status === 304 || request.method === 'HEAD';
    return new Response(empty ? null : a.body, { status: a.status, statusText: a.statusText, headers: a.headers });
}

self.addEventListener('fetch', ev => {
    const path = enginePath(new URL(ev.request.url));
    if (path) ev.respondWith(ask(ev.request, path, ev.clientId));
});
