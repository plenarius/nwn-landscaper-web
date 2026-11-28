// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Publish: sends the last export to the team as pull requests through the review service, or, where there is none, builds a
// package of its files to download. Its dialog checks first and says what would be sent.

import { api, failure, json } from './api.js';
import { $ } from './dom.js';
import { initTrial, trialChecked, trialClosed, trialOpen } from './trial.js';
import { initCanvasPublish, openCanvasPublish } from './canvaspubui.js';
import { exportCanvas } from './export.js';

/** What app.js gives this file (initPublish): `area()`, `me()` (who is signed in) and `readOnly()`. */
let ctx = null;

// Publish: checks the last export with the publishing service, says what the pull requests would
// hold, and opens them when asked. Only what the last export built is sent.
async function publishCall(dry) {
    const note = encodeURIComponent($('pubNote').value.trim());
    const whole = $('pubWhole').checked;
    const url = whole
        ? `/api/publish-module?module=${encodeURIComponent(ctx.area().module || ctx.area().name)}`
        : `/api/publish?name=${encodeURIComponent(ctx.area().name)}`;
    // (No review service: a package to download. Its check is the same call with `dry`; the download is a separate one.)
    if (ctx.me().package) {
        const res = await api(`/api/package?name=${encodeURIComponent(ctx.area().name)}&whole=${whole ? 1 : 0}`, { method: 'POST' });
        if (!res.ok) throw new Error(await failure(res));
        return json(res);
    }
    const res = await api(`${url}&dry=${dry ? 1 : 0}&note=${note}`, { method: 'POST' });
    if (!res.ok) throw new Error(await failure(res));
    return json(res);
}

/** The dialog's text and look: 'work' shows a moving bar and the seconds so far, 'err' red, 'ok' green. */
let pubClock = null;
function pubShow(text, mode = '') {
    clearInterval(pubClock);
    $('pubText').textContent = text;
    $('pubText').className = `note ${mode}`.trim();
    $('pubBar').hidden = mode !== 'work';
    $('pubTime').hidden = mode !== 'work';
    if (mode === 'work') {
        const t0 = Date.now();
        const tick = () => {
            $('pubTime').textContent = `${Math.round((Date.now() - t0) / 1000)} s`;
        };
        tick();
        pubClock = setInterval(tick, 500);
    }
}

// How many checks have been asked (see pubCheck).
let pubSeq = 0;

/** Says what the pull requests would hold (the area, or with the box ticked its whole module). */
async function pubCheck() {
    // (ticking "whole module" twice quickly: only the last check's answer is shown)
    const mine = ++pubSeq,
        whole = $('pubWhole').checked;
    $('pubGo').hidden = true;
    $('pubNote').disabled = true;
    trialChecked(false);
    pubShow(
        `Checking ${whole ? `module ${ctx.area().module}` : ctx.area().name}${ctx.me().package ? '' : ' with the publishing service'}…`,
        'work',
    );
    try {
        const { plan, findings = [], too_large: tooLarge } = await publishCall(true);
        if (mine !== pubSeq) return;
        if (tooLarge) return pubTooLarge(tooLarge, findings);
        // What the pull request will say about it (the review service writes it: what is new, or what changed against production).
        $('pubReview').textContent = (plan.review ?? '').replace(/^### /gm, '').replace(/[*`]/g, '');
        $('pubReviewBox').hidden = !plan.review;
        const errors = findings.filter(f => f.level === 'error').length;
        showFindings(findings);
        const files = `${plan.module_files.length} area file${plan.module_files.length === 1 ? '' : 's'} and ${plan.hak_files} tile file${plan.hak_files === 1 ? '' : 's'}`;
        const what = whole
            ? `the ${plan.areas.length} areas ${plan.areas.join(', ')}`
            : `${ctx.area().name} as ${plan.new ? 'a new area' : `a rework of ${plan.area}`}`;
        const reviewers = ctx.me().reviewers || 'your reviewers';
        pubShow(
            ctx.me().package
                ? `This packages ${what}: ${files}${plan.library ? ' (including the shared texture library)' : ''}, in the layout of your module's source, with a MANIFEST.md saying where each goes. It is what your last export built, so export first if you have changed anything.` +
                      (plan.warnings.length ? ` Notes: ${plan.warnings.join('; ')}.` : '')
                : `This sends ${what}: ${files}${plan.library ? ' (including the shared texture library)' : ''}. It is what your last export built, so export first if you have changed anything. Nothing is merged; ${reviewers} review the pull requests.` +
                      (plan.warnings.length ? ` Notes: ${plan.warnings.join('; ')}.` : ''),
        );
        $('pubGo').textContent = ctx.me().package ? 'Download the package' : 'Open the pull requests';
        $('pubNoteRow').hidden = !!ctx.me().package;
        $('pubGo').hidden = errors > 0;
        $('pubNote').disabled = errors > 0;
        trialChecked(errors === 0);
        if (errors)
            pubShow(
                `${errors} problem${errors === 1 ? '' : 's'} to fix before this can be published (listed below). Fix them, export again, and check again.`,
                'err',
            );
    } catch (err) {
        if (mine !== pubSeq) return;
        showFindings([]);
        $('pubReviewBox').hidden = true;
        pubShow(`Can't publish yet: ${err.message}`, 'err');
    }
}

/** A check refused for its size alone (`why`: the service's detail, size, limit, unit): it can't be published as it is, but Try on
 * dev takes any size, so the trial stays open (unless the check found errors). */
function pubTooLarge(why, findings) {
    $('pubReviewBox').hidden = true;
    showFindings(findings);
    const errors = findings.filter(f => f.level === 'error').length;
    trialChecked(errors === 0);
    pubShow(
        `Too large to publish: ${why.detail}. You can still try it on dev, which takes any size.` +
            (errors ? ` Fix the ${errors} problem${errors === 1 ? '' : 's'} below first.` : ''),
        'err',
    );
}

/** What the check found: errors stop a publish; warnings are for a look; each says which object. */
function showFindings(findings) {
    const box = $('pubFindings');
    box.textContent = '';
    box.hidden = !findings.length;
    for (const f of findings) {
        const li = document.createElement('li');
        li.className = `finding ${f.level}`;
        if (f.what) {
            const b = document.createElement('b');
            b.textContent = `${f.what} `;
            li.appendChild(b);
        }
        li.appendChild(document.createTextNode(f.msg));
        box.appendChild(li);
    }
}

/** Wires the Publish dialog. `c`: { area(), me(), readOnly() } from app.js. */
export function initPublish(c) {
    ctx = c;
    $('publishDialog').addEventListener('close', () => {
        clearInterval(pubClock);
        trialClosed();
    });
    initTrial({ area: () => ctx.area(), me: () => ctx.me(), whole: () => $('pubWhole').checked, show: pubShow });
    $('pubWhole').onchange = pubCheck;
    initCanvasPublish(() => exportCanvas(ctx.area()));
    $('btnPublish').onclick = async () => {
        if (ctx.readOnly() || !ctx.area()) return;
        if (ctx.area().canvas) return openCanvasPublish(ctx);
        const dlg = $('publishDialog');
        $('pubLinks').textContent = '';
        $('pubGo').disabled = false;
        // A module of two or more exported areas can go as one set.
        $('pubWhole').checked = false;
        $('pubWholeRow').hidden = true;
        try {
            const mine = (await (await api('/api/areas')).json()).areas ?? [];
            const same = mine.filter(a => a.exported && (a.module || a.name) === (ctx.area().module || ctx.area().name));
            if (same.length > 1) {
                $('pubWholeRow').hidden = false;
                $('pubWholeNames').textContent = `(${same.map(a => a.name).join(', ')})`;
            }
        } catch {
            /* the list fails to load: publish only this area */
        }
        dlg.showModal();
        await Promise.all([pubCheck(), trialOpen()]);
    };
    $('pubGo').onclick = async () => {
        if (ctx.me().package) {
            // A package: fetched (so an error shows here), then saved by the browser.
            $('pubGo').disabled = true;
            pubShow('Building the package…', 'work');
            try {
                const res = await api(
                    `/api/package-download?name=${encodeURIComponent(ctx.area().name)}&whole=${$('pubWhole').checked ? 1 : 0}`,
                );
                if (!res.ok) throw new Error(await failure(res));
                const file =
                    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `${ctx.area().name}-package.zip`;
                const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: file });
                document.body.appendChild(a);
                a.click();
                a.remove();
                // The zip is held in memory until its URL is let go: a minute is time enough for the browser to start saving it.
                setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
                pubShow(
                    `Downloaded ${file}. Unzip it into your module's repository (MANIFEST.md says what goes where), build the haks, and commit.`,
                    'ok',
                );
            } catch (err) {
                pubShow(`Couldn't build the package: ${err.message}`, 'err');
            }
            $('pubGo').disabled = false;
            return;
        }
        $('pubGo').disabled = true;
        $('pubNote').disabled = true;
        pubShow('Opening the pull requests (this can take a minute: it uploads the tile files)…', 'work');
        try {
            const { pr_urls } = await publishCall(false);
            pubShow('Done. The review service opened these pull requests:', 'ok');
            $('pubGo').hidden = true;
            // One link per repository, under the name the review service gives it (the engine passes its answer on as it is).
            for (const [label, url] of Object.entries(pr_urls ?? {})) {
                if (!/^https:\/\//.test(url ?? '')) continue; // (a link from the engine's answer: only a web address is followed)
                const a = document.createElement('a');
                a.href = url;
                a.target = '_blank';
                a.rel = 'noopener';
                a.textContent = `${label}: ${url}`;
                const p = document.createElement('p');
                p.appendChild(a);
                $('pubLinks').appendChild(p);
            }
        } catch (err) {
            pubShow(`Publishing failed: ${err.message}`, 'err');
            $('pubGo').disabled = false;
            $('pubNote').disabled = false;
        }
    };
}
