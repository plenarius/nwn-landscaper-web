// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The script picker, for the tests: a button beside the field, as the real one adds (which loads CodeMirror).

/** The buttons beside a script field `_input`. */
export function scriptPicker(_input) {
    return Object.assign(document.createElement('button'), { type: 'button', textContent: 'View script' });
}
