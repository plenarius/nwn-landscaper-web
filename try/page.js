// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The page's side of the engine in the browser (the engine's docs/DESIGN-web-demo.md): starts the Service Worker (sw.js) and
// the engine's Worker (worker.js), passes the Service Worker's requests to the Worker, and shows the start until the engine is
// ready. js/start.js runs it before the editor, so the editor's first request already reaches the engine.

import { el } from '../js/dom.js';
import { web } from '../js/web.js';

/** The start's card over the page: `say(text)` changes its line, `done()` takes it away. */
function startCard() {
    const line = el('p', { textContent: 'Starting…' });
    const card = el(
        'div',
        { className: 'web-start', id: 'webStart' },
        el('div', {}, el('h2', {}, 'NWN ', el('b', { textContent: 'Landscaper' })), line),
    );
    card.setAttribute('role', 'status');
    document.body.append(card);
    return { say: text => (line.textContent = text), done: () => card.remove() };
}

/** The Service Worker, controlling this page. */
async function serviceWorker() {
    const sw = navigator.serviceWorker;
    if (!sw) throw new Error('this browser has no Service Workers here (a private window in some browsers)');
    const reg = await sw.register('sw.js', { scope: './' });
    if (sw.controller) return;
    const active = (await sw.ready).active ?? reg.active;
    const claimed = new Promise(done => sw.addEventListener('controllerchange', done, { once: true }));
    // (A page loaded with the cache bypassed isn't controlled until the Service Worker claims it.)
    active?.postMessage('claim');
    await claimed;
}

/**
 * Holds the browser-wide lock on the engine's files while this page is open; waits, saying why, while another tab has it. Both
 * would write the same files. (The page holds it, not its Worker: a closed tab's Worker can outlive it by seconds.)
 */
async function lock(card) {
    if (!navigator.locks) return;
    const held = () => new Promise(() => {});
    const got = await new Promise(done =>
        navigator.locks.request('landscaper-engine', { ifAvailable: true }, l => {
            done(!!l);
            return l ? held() : null;
        }),
    );
    if (got) return;
    card.say('The Landscaper is open in another tab of this browser. Close it there, and it starts here.');
    await new Promise(done =>
        navigator.locks.request('landscaper-engine', () => {
            done();
            return held();
        }),
    );
}

/** Starts the engine for `site` (try/site.json); the editor then starts whether or not it could. */
export async function startEngine(site) {
    const t0 = performance.now();
    const card = startCard();
    // (So the browser keeps the areas when it is short of space; some browsers ask, some decide alone.)
    navigator.storage?.persist?.().catch(() => {});
    try {
        await lock(card);
        await serviceWorker();
        const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        const replies = new Map();
        let next = 0;
        const ready = new Promise((done, fail) => {
            worker.onmessage = ev => {
                const m = ev.data;
                if (m.kind === 'progress') card.say(m.text);
                else if (m.kind === 'log') console.debug(`[engine] ${m.text}`);
                else if (m.kind === 'ready') done(m.boot);
                else if (m.kind === 'failed') fail(new Error(m.error));
                else if (m.kind === 'reply') {
                    const r = replies.get(m.id);
                    replies.delete(m.id);
                    if (m.error) r?.fail(new Error(m.error));
                    else r?.done(m.value);
                }
            };
            worker.onerror = ev => fail(new Error(ev.message || 'the engine could not start'));
        });
        navigator.serviceWorker.onmessage = ev => {
            const m = ev.data;
            if (m?.kind === 'landscaper-request')
                worker.postMessage({ ...m, kind: 'request' }, m.body ? [ev.ports[0], m.body] : [ev.ports[0]]);
        };
        web.call = (what, ...args) =>
            new Promise((done, fail) => {
                const id = ++next;
                replies.set(id, { done, fail });
                worker.postMessage({ kind: 'call', id, what, args });
            });
        worker.postMessage({ kind: 'start', site });
        web.boot = { ...(await ready), total: performance.now() - t0 };
        performance.mark('landscaper-engine-ready');
        console.info(`[engine] ready: ${JSON.stringify(web.boot)}`);
    } catch (err) {
        web.failed = String(err?.message ?? err);
        console.error(`[engine] ${web.failed}`);
    } finally {
        card.done();
    }
}
