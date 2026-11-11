// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The top bar's menus (File, Area, Show, Share): one open at a time, closed by a pick, a click elsewhere or Escape.
// From the keyboard: Enter, Space or the down arrow opens one at its first item, the arrows (and Home, End) move through
// its items, Escape closes it and gives the focus back to its button, and Tab out of it closes it.
function closeMenus() {
    for (const m of document.querySelectorAll('.menu')) {
        m.querySelector('.menu-list').hidden = true;
        const btn = m.querySelector('.menu-btn');
        btn.classList.remove('active');
        btn.setAttribute('aria-expanded', 'false');
    }
}
/** A menu's items that can take the focus now: its buttons and ticks, shown and not off. */
const menuItems = list =>
    [...list.querySelectorAll('button, input')].filter(i => !i.disabled && !i.closest('[hidden]') && i.getClientRects().length);

/** Wires every `.menu` of the page: opening, closing and moving through it from the keyboard. */
export function initMenus() {
    for (const m of document.querySelectorAll('.menu')) {
        const btn = m.querySelector('.menu-btn'),
            list = m.querySelector('.menu-list');
        const open = focus => {
            closeMenus();
            list.hidden = false;
            btn.classList.add('active');
            btn.setAttribute('aria-expanded', 'true');
            if (focus) menuItems(list)[0]?.focus();
        };
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (list.hidden)
                open(e.detail === 0); // (detail 0: Enter or Space, not a click)
            else closeMenus();
        });
        btn.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation(); // (not the camera's arrow too)
                open(true);
            }
        });
        list.addEventListener('keydown', e => {
            const items = menuItems(list),
                at = items.indexOf(document.activeElement);
            const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
            if (to !== undefined && items.length) {
                e.preventDefault();
                e.stopPropagation();
                items[(to + items.length) % items.length].focus();
            } else if (e.key === 'Escape') {
                e.stopPropagation();
                closeMenus();
                btn.focus();
            }
        });
        m.addEventListener('focusout', e => {
            if (!list.hidden && e.relatedTarget && !m.contains(e.relatedTarget)) closeMenus();
        });
        // (A menu whose items are ticked stays open: its items say `data-stay`.)
        list.addEventListener('click', e => {
            if (e.target.closest('[data-stay]')) e.stopPropagation();
            else closeMenus();
        });
    }
    document.addEventListener('click', closeMenus);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeMenus();
    });
}
