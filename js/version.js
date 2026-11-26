// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The version beside the title in the top bar: the engine's (from /api/me) and this editor's (from the CHANGELOG.md served
// next to it), the same on a release; a click shows both and a link to the release's notes. A build between releases says
// `+dev` after the last release's version: changelog.d/ holds an entry for the next one (the engine lists them), or its
// changelog starts with `## Unreleased`.

import { api, json } from './api.js';

const RELEASES = 'https://github.com/plenarius/nwn-landscaper/releases/tag/';

/**
 * The version a CHANGELOG.md says: its first `## X.Y.Z` heading, with `+dev` when `## Unreleased` comes before it or changes are
 * `waiting` in changelog.d/; null without.
 */
export function changelogVersion(text, waiting = false) {
    let unreleased = false;
    for (const line of String(text ?? '').split('\n')) {
        const heading = line.match(/^## +(.+?)\s*$/)?.[1];
        if (!heading) continue;
        if (/^unreleased$/i.test(heading)) unreleased = true;
        else if (/^\d+\.\d+\.\d+$/.test(heading)) return unreleased || waiting ? `${heading}+dev` : heading;
    }
    return null;
}

/** The release a version is or follows (`0.6.1+dev`: 0.6.1). */
const release = v => v.replace(/\+.*/, '');

/**
 * What the top bar says for the engine's and the editor's versions (either null when unknown): `text` beside the title, and
 * `other`, the editor's, after it when they differ (`mismatch`); `title` for its tooltip, `lines` for its menu, and `links`
 * (label, url) to the release notes.
 */
export function describe(engine, editor) {
    if (!engine && !editor) return null;
    const mismatch = !!(engine && editor && engine !== editor);
    const differ = 'They are from different releases: some things may not work.';
    const lines = [`Engine ${engine ?? 'unknown'}`, `Editor ${editor ?? 'unknown'}`];
    if (mismatch) lines.push(differ);
    const dev = [engine, editor].find(v => v?.includes('+dev'));
    if (dev) lines.push(`+dev: a build after ${release(dev)}, with changes not released yet.`);
    const links = [...new Set([engine, editor].filter(Boolean).map(release))].map(v => ({
        label: `Release notes of ${v}`,
        url: `${RELEASES}v${v}`,
    }));
    return {
        text: engine ?? editor,
        other: mismatch ? editor : null,
        title: `Engine ${engine ?? 'unknown'}, editor ${editor ?? 'unknown'}.${mismatch ? ` ${differ}` : ''} Click for the release notes.`,
        lines,
        links,
        mismatch,
    };
}

/** This editor's version, from its CHANGELOG.md and changelog.d/; null when it can't be read (a copy without it). */
async function editorVersion() {
    const [res, more] = await Promise.all([api('CHANGELOG.md', { cache: 'no-cache' }), waiting()]);
    return res.ok ? changelogVersion(await res.text(), more) : null;
}

/** Whether changelog.d/ beside the page holds entries for the next release: the engine lists them (an older one doesn't). */
async function waiting() {
    try {
        const res = await api('changelog.d/', { cache: 'no-cache' });
        return res.ok && hasEntries(await json(res));
    } catch {
        return false;
    }
}

/** Whether the engine's `/changelog.d/` answer lists any entry (anything else, a page of a plain file server, lists none). */
export const hasEntries = answer => Array.isArray(answer?.fragments) && answer.fragments.length > 0;

/** Shows the versions beside the title; `engine` is /api/me's `version` (missing: an older engine, or none). */
export async function showVersion(engine) {
    const d = describe(engine || null, await editorVersion());
    const btn = document.getElementById('versionBtn');
    if (!d || !btn) return;
    // (an editor of another release after the engine's: `≠ 0.6.0`, the version itself left out where the bar is short of room)
    const other = document.createElement('span');
    other.className = 'version-other';
    other.textContent = ` ${d.other}`;
    btn.replaceChildren(d.text, ...(d.other ? [' ≠', other] : []));
    btn.title = d.title;
    btn.classList.toggle('mismatch', d.mismatch);
    document.getElementById('versionLines').replaceChildren(
        ...d.lines.map(l => {
            const p = document.createElement('p');
            p.textContent = l;
            return p;
        }),
    );
    document.getElementById('versionLinks').replaceChildren(
        ...d.links.map(({ label, url }) => {
            const a = document.createElement('a');
            a.className = 'menu-item';
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = label;
            return a;
        }),
    );
    document.getElementById('menuAbout').hidden = false;
}
