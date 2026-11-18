// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// A name box made a picker, for scripts (scripts.js) and conversations (dialogs.js): the names found as you type, offered in
// a datalist, and a button beside the box that opens the one it names (Edit when it is the builder's own, View when not) or
// writes a new one. Each of the two gives it its own search, editor and way to make a new one.

import { viewing } from './api.js';
import { el } from './dom.js';

let listId = 0;

/**
 * Makes `input` a name picker and returns the row to place beside it: the list, and the button unless `button` is false.
 * - `noun`: what the box names ('script', 'conversation'), for the button's label.
 * - `search(q)`: resolves to the `<option>`s for typed text `q` (2 characters or more).
 * - `isMine(name)`: resolves to whether the one named is the builder's own.
 * - `open(name, made)`: opens it in its editor; `made(name)` puts the name of a copy made there into the box.
 * - `create()`: asks for a new one and makes it, resolving to its name, or null when the builder cancelled.
 */
export function namePicker(input, { noun, search, isMine, open, create, button = true }) {
    const list = el('datalist', { id: `names${++listId}` });
    input.setAttribute('list', list.id);
    // Only the answer for what is typed now fills the list: a slow answer for earlier text used to replace it.
    let timer = null,
        searched = 0;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const mine = ++searched,
                q = input.value.trim();
            if (q.length < 2) return;
            const options = await search(q);
            if (mine === searched) list.replaceChildren(...options);
        }, 250);
    });
    const row = el('span', { className: 'scriptbtns' }, list);
    if (!button) return row;

    const b = el('button', { type: 'button', className: 'small' });
    const named = () => input.value.trim().toLowerCase();
    // (the label for the name in the box now, not for one typed before it whose answer came later)
    let labelled = 0;
    const sync = async () => {
        const mine = ++labelled,
            name = named();
        // (in someone else's workspace, read-only: one to look at, never one to write)
        b.hidden = !name && !!viewing.user;
        const own = name !== '' && !viewing.user && (await isMine(name));
        if (mine !== labelled) return;
        b.textContent = own ? `Edit ${noun}` : name ? `View ${noun}` : `Write a ${noun}`;
    };
    sync();
    input.addEventListener('change', sync);
    const made = name => {
        input.value = name;
        input.dispatchEvent(new Event('change'));
    };
    b.onclick = async () => {
        let name = named();
        if (!name) {
            name = await create();
            if (!name) return;
            made(name);
        }
        await open(name, made);
        sync();
    };
    row.appendChild(b);
    return row;
}
