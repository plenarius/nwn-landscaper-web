// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// Scripts: a picker beside every script-name box, and (for admins, who may write them) an editor with the compiler's errors
// underlined as you type. The compiler is Moonglow's built-in one, the same the game and Aurora use; it stops at the first error.

import { ask } from './ask.js';
import { api, engine, failure, json, viewing } from './api.js';
import { $ } from './dom.js';
import { namePicker } from './picker.js';

/** What app.js gives this file (initScripts): `me()`, who is signed in (/api/me's answer). */
let ctx = null;

/** Gives the script pickers who is signed in. */
export function initScripts(c) {
    ctx = c;
}

/** Whether the script pickers offer the editor: the engine opens, writes and compiles scripts for admins only (its script
 *  routes check the same `admin` that /api/me reports; on your own machine you are one), and only while it is there. */
const scriptsWritable = () => engine.up && !!ctx?.me().admin;

// Whether a script is the builder's own, asked once per name: every redraw of a properties panel or a conversation built
// each box's button again, and each asked the engine (about 150 requests for one edit of a 50-line conversation). Forgotten
// when a script is made, copied or deleted.
const ownScripts = new Map();
function isMine(name) {
    if (!name) return Promise.resolve(false);
    if (!ownScripts.has(name))
        ownScripts.set(
            name,
            api(`/api/scripts?q=${encodeURIComponent(name)}`).then(async res => {
                if (!res.ok) ownScripts.delete(name); // (asked again next time)
                return ((await json(res)).scripts ?? []).some(s => s.source === 'mine' && s.resref === name);
            }),
        );
    return ownScripts.get(name);
}

// How many times the script dialog has been opened: an answer for an earlier opening is dropped (closed while it loaded and
// opened on another script, the dialog showed one script and deleted or saved the other).
let opening = 0;

/** The script editor for one of your own scripts, in its dialog. Saved (and checked) as you type. */
async function openScript(resref, onMade = null) {
    const turn = ++opening;
    const dlg = $('scriptDialog');
    const host = $('scriptHost');
    const status = $('scriptStatus');
    $('scriptTitle').textContent = `Script ${resref}`;
    host.textContent = 'Loading…';
    status.textContent = '';
    status.className = 'note';
    // Nothing to copy or delete until this script has loaded: the buttons still held the one opened before.
    for (const id of ['scriptCopy', 'scriptDelete']) {
        $(id).hidden = true;
        $(id).onclick = null;
    }
    dlg.showModal();
    // CodeMirror (512 KB of the page's 3 MB of JavaScript) loads the first time the editor opens, not with the page.
    const [{ EditorView, EditorState, basicSetup, cpp, setDiagnostics, lintGutter, oneDark }, res] = await Promise.all([
        import('../vendor/codemirror/codemirror.js'),
        api(`/api/script?resref=${encodeURIComponent(resref)}&any=1`),
    ]);
    const d = await json(res);
    if (turn !== opening || !dlg.open) return;
    if (!res.ok) {
        host.textContent = d.error || res.statusText;
        return;
    }
    host.textContent = '';
    // One that isn't yours (the module's or the game's) is shown to read, with a button to make your own copy. In someone
    // else's workspace (read-only) every script is shown to read: theirs too, with no copy to make.
    const mineAlready = !!d.mine && !viewing.user;
    const copy = $('scriptCopy');
    copy.hidden = mineAlready || !!viewing.user;
    $('scriptDelete').hidden = !mineAlready;
    $('scriptTitle').textContent = mineAlready ? `Script ${resref}` : `Script ${resref} (read only)`;
    let timer = null,
        saving = Promise.resolve(),
        view = null;
    const show = r => {
        const doc = view.state.doc;
        if (r.ok === false && r.error) {
            // (An error inside an include is shown at the top: its file isn't open.)
            const mine = r.error.file === resref;
            const line = mine && r.error.line > 0 ? doc.line(Math.min(r.error.line, doc.lines)) : doc.line(1);
            view.dispatch(setDiagnostics(view.state, [{ from: line.from, to: line.to, severity: 'error', message: r.error.message }]));
            status.className = 'note err';
            status.textContent = mine ? `Line ${r.error.line}: ${r.error.message}` : `In ${r.error.file}: ${r.error.message}`;
        } else if (r.ok) {
            view.dispatch(setDiagnostics(view.state, []));
            status.className = 'note ok';
            status.textContent = 'Compiles. Saved.';
        } else {
            status.className = 'note err';
            status.textContent = r.error || 'Not saved.';
        }
    };
    const save = () => {
        clearTimeout(timer);
        const text = view.state.doc.toString();
        saving = saving.then(async () =>
            show(await json(await api(`/api/script-save?resref=${encodeURIComponent(resref)}`, { method: 'POST', body: text }))),
        );
        return saving;
    };
    view = new EditorView({
        parent: host,
        state: EditorState.create({
            doc: d.source,
            extensions: [
                basicSetup,
                cpp(),
                oneDark,
                lintGutter(),
                ...(mineAlready ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)]),
                EditorView.updateListener.of(u => {
                    if (u.docChanged && mineAlready) {
                        status.className = 'note';
                        status.textContent = 'Saving…';
                        clearTimeout(timer);
                        timer = setTimeout(save, 700);
                    }
                }),
            ],
        }),
    });
    if (mineAlready) save();
    else {
        status.className = 'note';
        status.textContent = viewing.user
            ? `You are looking at ${viewing.user}'s workspace: its scripts are shown to read.`
            : `This is the module's (or the game's), so it can't be changed here. Make your own copy to change it.`;
    }
    copy.onclick = async () => {
        let made = null;
        const ok = await ask({
            title: 'Make your own copy',
            text: `A script of yours that starts as a copy of ${resref}. Its name is what the game calls it: up to 16 lower case letters, digits or _.`,
            ok: 'Make the copy',
            input: { label: 'Name', placeholder: 'e.g. my_spawn' },
            submit: async name => {
                const res2 = await api(
                    `/api/script?resref=${encodeURIComponent(name.toLowerCase())}&from=${encodeURIComponent(resref)}&kind=action`,
                    { method: 'POST' },
                );
                const r2 = await json(res2);
                if (!res2.ok) return r2.error || res2.statusText;
                made = r2.resref;
            },
        });
        if (!ok || !made) return;
        ownScripts.clear();
        dlg.close();
        onMade?.(made);
        await openScript(made, onMade);
    };
    $('scriptDelete').onclick = async () => {
        if (
            !(await ask({
                title: `Delete ${resref}?`,
                text: `Anything that names it will then name a script that isn't there.`,
                ok: 'Delete it',
                danger: true,
            }))
        )
            return;
        const res = await api(`/api/script-delete?resref=${encodeURIComponent(resref)}`, { method: 'POST' });
        if (!res.ok) {
            status.className = 'note err';
            status.textContent = `Not deleted: ${await failure(res)}`;
            return;
        }
        ownScripts.clear();
        dlg.close();
    };
    await new Promise(done => {
        const close = async () => {
            dlg.removeEventListener('close', close);
            if (mineAlready) await save();
            view.destroy();
            done();
        };
        dlg.addEventListener('close', close);
    });
}

/** Asks for a new script's name and makes it, of `kind` ('condition' or 'action'). Its name, or null when cancelled. */
async function newScript(kind) {
    let created = null;
    const ok = await ask({
        title: 'Write a script',
        text: `A new script of yours (${kind === 'condition' ? 'a condition, which answers yes or no' : 'an action, which does something'}). Its name is what the game calls it: up to 16 lower case letters, digits or _.`,
        ok: 'Start writing',
        input: { label: 'Name', placeholder: 'e.g. my_spawn' },
        submit: async pick => {
            const res = await api(`/api/script?resref=${encodeURIComponent(pick.toLowerCase())}&from=&kind=${kind}`, {
                method: 'POST',
            });
            const r = await json(res);
            if (!res.ok) return r.error || res.statusText;
            created = r.resref;
        },
    });
    if (!ok || !created) return null;
    ownScripts.clear();
    return created;
}

/** Makes a script-name box a picker (the module's and your own scripts, found as you type) and, for admins, adds a button to
 *  write or change the script it names. `kind`: 'condition' (a StartingConditional) or 'action' (a main). Returns the button
 *  row to place beside the box. */
export function scriptPicker(input, kind = 'action') {
    return namePicker(input, {
        noun: 'script',
        search: async q =>
            ((await json(await api(`/api/scripts?q=${encodeURIComponent(q)}`))).scripts ?? []).map(
                s => new Option(s.source === 'mine' ? `${s.resref} (yours)` : s.folder ? `${s.resref} · ${s.folder}` : s.resref, s.resref),
            ),
        isMine,
        open: openScript,
        create: () => newScript(kind),
        button: scriptsWritable(),
    });
}
