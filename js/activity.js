// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Activity dialog: what happened on a team server (searches, imports, exports, refusals...), for admins.

import { api } from './api.js';
import { $ } from './dom.js';

// What happened, for admins on a team server (searches, imports, exports, refusals...).
async function showActivity() {
    $('activityDialog').showModal();
    const rows = $('actRows');
    rows.textContent = '';
    const q = `limit=300&user=${encodeURIComponent($('actUser').value.trim())}&action=${encodeURIComponent($('actAction').value)}`;
    let events = [];
    try {
        events = (await (await api(`/api/audit?${q}`)).json()).events ?? [];
    } catch {
        /* none */
    }
    for (const e of events) {
        const tr = document.createElement('tr');
        const cell = (text, cls) => {
            const td = document.createElement('td');
            td.textContent = text ?? '';
            if (cls) td.className = cls;
            tr.appendChild(td);
        };
        cell(new Date(e.t * 1000).toLocaleString());
        cell((e.user ?? '(not signed in)') + (e.admin ? ' (admin)' : ''));
        cell(e.action);
        cell(e.area);
        cell(e.ok ? '✓' : '✗', e.ok ? 'ok' : 'bad');
        cell(e.detail);
        cell(e.ip);
        rows.appendChild(tr);
    }
    if (!events.length) rows.innerHTML = '<tr><td colspan="7">Nothing recorded yet.</td></tr>';
}

/** Wires the Activity menu item and the dialog's filters. */
export function initActivity() {
    $('btnActivity').onclick = showActivity;

    $('actRefresh').onclick = showActivity;
    $('actUser').onkeydown = e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            showActivity();
        }
    };
    $('actAction').onchange = showActivity;
}
