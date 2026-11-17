// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The app's own question dialog (`#askDialog`): a title, some text, optionally one text box, and OK / Cancel. Used instead of the
// browser's prompt/confirm/alert so it looks like the rest of the app.
//
// ask({ title, text, ok, cancel, danger, input: { label, value, placeholder }, submit })
//   resolves to true (OK, no text box), the trimmed text (OK with a text box), or null (cancelled).
//   `cancel`, when given, names the Cancel button as a second answer: it then resolves to false, and only Escape gives null.
//   `submit(value)`, when given, runs on OK: it returns an error message to show in the dialog (which stays open for another
//   try) or nothing to accept. That is how a name the server refuses is reported without a popup.

import { $ } from './dom.js';

/** Asks with the app's question dialog: see the top of this file for the arguments and what it resolves to. */
export function ask({ title, text, ok = 'OK', cancel = null, danger = false, input = null, submit = null }) {
    const dlg = $('askDialog');
    $('askTitle').textContent = title;
    $('askText').textContent = '';
    for (const para of text.split('\n\n')) {
        const p = document.createElement('p');
        p.textContent = para;
        $('askText').appendChild(p);
    }
    $('askLabel').hidden = !input;
    if (input) {
        $('askLabelText').textContent = input.label;
        $('askInput').value = input.value ?? '';
        $('askInput').placeholder = input.placeholder ?? '';
    }
    $('askError').hidden = true;
    $('askOk').textContent = ok;
    $('askCancel').textContent = cancel ?? 'Cancel';
    $('askOk').classList.toggle('danger', danger);
    $('askOk').disabled = false;
    $('askOk').onclick = submit
        ? async e => {
              e.preventDefault();
              $('askOk').disabled = true;
              $('askError').hidden = true;
              const problem = await submit(input ? $('askInput').value.trim() : true);
              $('askOk').disabled = false;
              if (problem) {
                  $('askError').textContent = problem;
                  $('askError').hidden = false;
                  return;
              }
              dlg.close('ok');
          }
        : null;
    return new Promise(resolve => {
        dlg.returnValue = '';
        const answer = () => {
            if (dlg.returnValue === 'ok') return input ? $('askInput').value.trim() : true;
            return cancel && dlg.returnValue === 'cancel' ? false : null;
        };
        dlg.addEventListener('close', () => resolve(answer()), { once: true });
        dlg.showModal();
        (input ? $('askInput') : $('askCancel')).focus();
    });
}
