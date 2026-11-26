// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Spike (wasm-demo): starts the in-browser engine (sw.js) before the editor, so the editor's first request already reaches it.
const reg = await navigator.serviceWorker.register('sw.js', { type: 'module', scope: './' });
if (!navigator.serviceWorker.controller) {
    await new Promise(done => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
}
void reg;
navigator.serviceWorker.addEventListener('message', ev => ev.data?.engineLog && console.log(ev.data.engineLog));
await import('../js/app.js');
