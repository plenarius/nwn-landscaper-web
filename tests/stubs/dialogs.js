// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The conversation picker, for the tests: a button beside the field, as the real one adds.

/** The buttons beside a conversation field `_input`. */
export function conversationPicker(_input) {
    return Object.assign(document.createElement('button'), { type: 'button', textContent: 'View conversation' });
}
