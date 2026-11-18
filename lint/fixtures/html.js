// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// What lint/no-html-from-values.grit must refuse (each line ending in `flagged`) and let through (the others). Not part of the
// page: biome.json leaves this folder out, and tests/lint.test.js lints it with the plugins alone.

export function refused(e, v, range, parser) {
    e.innerHTML = v; // flagged
    e.innerHTML += v; // flagged
    e.innerHTML = `<b>${v}</b>`; // flagged
    e.innerHTML = '<b>' + v + '</b>'; // flagged
    e.outerHTML = v; // flagged
    e.outerHTML += v; // flagged
    e.srcdoc = v; // flagged
    e['innerHTML'] = v; // flagged
    e['outerHTML'] += v; // flagged
    e['srcdoc'] = v; // flagged
    Object.assign(e, { innerHTML: v }); // flagged
    Object.assign(e, { 'srcdoc': v }); // flagged
    e.insertAdjacentHTML('beforeend', v); // flagged
    range.createContextualFragment(v); // flagged
    e.setHTMLUnsafe(v); // flagged
    Document.parseHTMLUnsafe(v); // flagged
    parser.parseFromString(v, 'text/html'); // flagged
    e.setAttribute('srcdoc', v); // flagged
    e.setAttribute('SrcDoc', v); // flagged
    e.setAttributeNS(null, 'srcdoc', v); // flagged
    document.write(v); // flagged
    document.writeln(v); // flagged
}

export function allowed(e, v) {
    e.innerHTML = '<b>fixed</b>';
    e.innerHTML = "<b>fixed</b>";
    e.innerHTML = `<b>fixed</b>`;
    e.srcdoc = '';
    Object.assign(e, { innerHTML: '' });
    e.insertAdjacentHTML('beforeend', '<hr>');
    e.setAttribute('srcdoc', '<p>fixed</p>');
    e.setAttribute('title', v);
    e.textContent = v;
    e.title = v;
}
