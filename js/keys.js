// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Which keys the editor's shortcuts leave to the page element that has the focus.

/** Inputs that take no typing: a letter pressed in one is a shortcut. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file']);

/**
 * Whether key event `e` belongs to the focused `target` rather than to the shortcuts. A text or number box, a list, a text area,
 * an editor or a dialog keeps every key; a tick box, radio button, slider or colour keeps its own (arrows, Space, Home...), so a
 * tool's letter still works after a click in a panel.
 */
export function keyBelongsTo(target, e) {
    if (target?.closest?.('select, textarea, dialog, [contenteditable]:not([contenteditable="false"])')) return true;
    if (target?.tagName !== 'INPUT') return false;
    return !NOT_TYPED.has(target.type) || e.key.length !== 1 || e.key === ' ';
}
