// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The app's updates in the version menu (the engine's DESIGN-desktop-app.md, question 6), in the desktop app only. At start the
// app asks GitHub whether a newer version is out; `GET /api/app/update` says what it found:
//   { state: 'checking' }                               still asking (asked again below)
//   { state: 'none' }                                   nothing newer, or no answer: the menu shows nothing
//   { state: 'available', version, notes, how, error }  `how`: 'install' (the app installs it), 'deb' or 'download' (by hand)
//   { state: 'installing', version, done, total }       downloading (bytes), then installing; the app starts again after
// "Update to X.Y.Z" shows the release notes and asks first; on yes, `POST /api/app/update` starts the install (202).

import { api, failure, json } from './api.js';
import { ask } from './ask.js';
import { $ } from './dom.js';
import { IN_APP } from './desktop.js';
import { showError } from './report.js';

const RELEASES = 'https://github.com/plenarius/nwn-landscaper/releases/tag/';

/** How often the menu asks again while the app checks or installs, and for how long at most while it checks. */
export const POLL_MS = 2000;
const CHECKING_FOR_MS = 120_000;

/** Release notes (the changelog's Markdown) as plain paragraphs for the question dialog: headings, bullets, bold and links. */
export function plainNotes(md) {
    return String(md ?? '')
        .split('\n')
        .map(l =>
            l
                .replace(/^#+\s*(.*)$/, '$1:')
                .replace(/^\s*[-*]\s+/, '')
                .replace(/\*\*(.+?)\*\*/g, '$1')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .trim(),
        )
        .filter(Boolean)
        .join('\n\n');
}

/**
 * What the menu shows for the app's answer `s`: null for nothing, else the item's `label`, its `title`, whether it is a link to
 * the release page (`url`) or a button (`busy` while installing), and the last install's `error`.
 */
export function describeUpdate(s) {
    if (s?.state === 'installing') {
        const pct = s.total ? ` ${Math.min(100, Math.floor((100 * s.done) / s.total))}%` : '';
        return {
            label: `Updating to ${s.version}…${pct}`,
            title: 'The app downloads the update, checks it, installs it and starts again.',
            busy: true,
        };
    }
    if (s?.state !== 'available' || !s.version) return null;
    if (s.how === 'install') {
        return {
            label: `Update to ${s.version}`,
            title: 'Shows what is new, then asks before it installs and starts the app again.',
            error: s.error ?? null,
        };
    }
    const url = `${RELEASES}v${s.version}`;
    if (s.how === 'deb') {
        return {
            label: `Download ${s.version}'s .deb`,
            title: `An app installed from a .deb updates by installing the new .deb: ${s.version}'s is on its release page.`,
            url,
        };
    }
    return { label: `Download ${s.version}`, title: `This copy of the app can't update itself: ${s.version} is on its release page.`, url };
}

/** The question before installing: the release notes, then what happens. Resolves to whether the person said yes. */
export async function askToInstall({ version, notes }) {
    const what = plainNotes(notes);
    const yes = await ask({
        title: `Update to ${version}?`,
        text: `${what ? `${what}\n\n` : ''}The app downloads ${version}, checks its signature, installs it and starts again. Your area is kept.`,
        ok: 'Update and restart',
    });
    return yes === true;
}

let last = null;
let timer = null;

/** Shows `s` (the app's answer) in the version menu. */
function show(s) {
    last = s;
    const d = describeUpdate(s);
    const slot = $('appUpdate');
    $('versionBtn').classList.toggle('has-update', !!d && !d.busy);
    if (!d) {
        slot.hidden = true;
        slot.replaceChildren();
        return;
    }
    const item = document.createElement(d.url ? 'a' : 'button');
    item.className = 'menu-item update-item';
    item.textContent = d.label;
    item.title = d.title;
    if (d.url) {
        item.href = d.url;
        item.target = '_blank';
        item.rel = 'noopener';
    } else {
        item.type = 'button';
        item.disabled = !!d.busy;
        item.onclick = () => install();
    }
    slot.replaceChildren(item);
    slot.hidden = false;
}

/** Asks the app what its updater found, shows it, and asks again while it checks (for a while) or installs. */
export async function refresh(started = Date.now()) {
    clearTimeout(timer);
    let s = null;
    try {
        const res = await api('/api/app/update', { cache: 'no-store' });
        s = res.ok ? await json(res) : null;
    } catch {
        s = null;
    }
    const before = last;
    show(s);
    if (before?.state === 'installing' && s?.state === 'available' && s.error) showError(s.error, `Couldn't update to ${s.version}`);
    const again = s?.state === 'installing' || (s?.state === 'checking' && Date.now() - started < CHECKING_FOR_MS);
    if (again) timer = setTimeout(() => refresh(started), POLL_MS);
}

/** "Update to X.Y.Z": the notes and the question, then the install. */
async function install() {
    if (last?.state !== 'available' || !(await askToInstall(last))) return;
    const res = await api('/api/app/update', { method: 'POST' });
    if (!res.ok) {
        showError(await failure(res), `Couldn't update to ${last.version}`);
        return;
    }
    refresh();
}

/** In the app (`app`), asks the app about updates and shows the item when there is one; in a browser, does nothing. */
export function initUpdate(app = IN_APP) {
    if (app) refresh();
}
