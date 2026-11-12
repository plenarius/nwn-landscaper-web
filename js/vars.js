// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Local variables (an int, a float or a string, with a name) as a list of rows to edit: shared by the Things
// properties and the Area settings dialog.

/** A variable's value as its type holds it (a number that isn't one becomes 0). */
function coerce(v) {
    if (v.type === 'string') return String(v.value ?? '');
    const n = Number(v.value);
    return Number.isFinite(n) ? (v.type === 'int' ? Math.trunc(n) : n) : 0;
}

/**
 * Draws `vars` (an array, changed in place) into `box`: a row each (name, type, value, remove) and an
 * "Add a variable" button. `before()` is called before each change (an undo step) and `after()` after it.
 */
export function renderVars(box, vars, { before = () => {}, after = () => {}, redraw = () => {}, keep = '' } = {}) {
    vars.forEach((v, n) => {
        const row = document.createElement('div');
        row.className = 'varrow';
        const name = Object.assign(document.createElement('input'), { value: v.name, maxLength: 32, placeholder: 'name' });
        name.dataset.keep = keep;
        name.onchange = () => {
            before();
            v.name = name.value.trim();
            after();
        };
        const type = document.createElement('select');
        for (const o of ['int', 'float', 'string']) type.add(new Option(o, o, false, v.type === o));
        type.onchange = () => {
            before();
            v.type = type.value;
            v.value = coerce(v);
            after();
            redraw();
        };
        const val = Object.assign(document.createElement('input'), { value: v.value });
        val.dataset.keep = keep;
        val.onchange = () => {
            before();
            v.value = coerce({ type: v.type, value: val.value });
            after();
            redraw();
        };
        const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '×' });
        del.onclick = () => {
            before();
            vars.splice(n, 1);
            after();
            redraw();
        };
        row.append(name, type, val, del);
        box.appendChild(row);
    });
    const add = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Add a variable' });
    add.onclick = () => {
        before();
        vars.push({ name: '', type: 'int', value: 0 });
        after();
        redraw();
    };
    box.appendChild(add);
}
