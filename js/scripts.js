// Scripts: a picker beside every script-name box, and (for admins, who may write them) an editor with the compiler's errors
// underlined as you type. The compiler is Moonglow's built-in one, the same the game and Aurora use; it stops at the first error.

import { EditorView, EditorState, basicSetup, cpp, setDiagnostics, lintGutter, oneDark } from '../vendor/codemirror/codemirror.js';

const json = r => r.json().catch(() => ({}));
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

let canWrite = null;
export async function scriptsWritable() {
    if (canWrite === null) canWrite = !!(await json(await fetch('/api/scripts?q=zzzz'))).canWrite;
    return canWrite;
}

/** The script editor for one of your own scripts, in its dialog. Saved (and checked) as you type. */
export async function openScript(resref) {
    const dlg = document.getElementById('scriptDialog');
    const host = document.getElementById('scriptHost');
    const status = document.getElementById('scriptStatus');
    document.getElementById('scriptTitle').textContent = `Script ${resref}`;
    host.textContent = 'Loading…';
    status.textContent = '';
    status.className = 'note';
    dlg.showModal();
    const res = await fetch(`/api/script?resref=${encodeURIComponent(resref)}`);
    const d = await json(res);
    if (!res.ok) { host.textContent = d.error || res.statusText; return; }
    host.textContent = '';
    let timer = null, saving = Promise.resolve(), view = null;
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
        saving = saving.then(async () => show(await json(await fetch(`/api/script-save?resref=${encodeURIComponent(resref)}`, { method: 'POST', body: text }))));
        return saving;
    };
    view = new EditorView({
        parent: host,
        state: EditorState.create({
            doc: d.source,
            extensions: [basicSetup, cpp(), oneDark, lintGutter(), EditorView.updateListener.of(u => {
                if (u.docChanged) { status.className = 'note'; status.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(save, 700); }
            })],
        }),
    });
    save();
    document.getElementById('scriptDelete').onclick = async () => {
        if (!confirm(`Delete ${resref}? Anything that names it will then name a script that isn't there.`)) return;
        await fetch(`/api/script-delete?resref=${encodeURIComponent(resref)}`, { method: 'POST' });
        dlg.close();
    };
    await new Promise(done => {
        const close = async () => { dlg.removeEventListener('close', close); await save(); view.destroy(); done(); };
        dlg.addEventListener('close', close);
    });
}

let listId = 0;

/** Makes a script-name box a picker (the module's and your own scripts, found as you type) and, for admins, adds a button to
 *  write or change the script it names. `kind`: 'condition' (a StartingConditional) or 'action' (a main). Returns the button
 *  row to place beside the box. */
export function scriptPicker(input, kind = 'action') {
    const list = el('datalist', { id: `scripts${++listId}` });
    input.setAttribute('list', list.id);
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = input.value.trim();
            if (q.length < 2) return;
            const r = await json(await fetch(`/api/scripts?q=${encodeURIComponent(q)}`));
            list.textContent = '';
            for (const s of r.scripts ?? []) list.appendChild(new Option(s.source === 'mine' ? `${s.resref} (yours)` : s.folder ? `${s.resref} · ${s.folder}` : s.resref, s.resref));
        }, 250);
    });
    const row = el('span', { className: 'scriptbtns' }, list);
    scriptsWritable().then(ok => {
        if (!ok) return;
        const b = el('button', { type: 'button', className: 'small' });
        const mine = async () => ((await json(await fetch(`/api/scripts?q=${encodeURIComponent(input.value.trim().toLowerCase())}`))).scripts ?? []).some(s => s.source === 'mine' && s.resref === input.value.trim().toLowerCase());
        const sync = async () => { b.textContent = (await mine()) ? 'Edit script' : input.value.trim() ? 'Write my own from this' : 'Write a script'; };
        sync();
        input.addEventListener('change', sync);
        b.onclick = async () => {
            const name = input.value.trim().toLowerCase();
            if (await mine()) { await openScript(name); return; }
            const pick = prompt('A name for your script (16 letters, digits or _):', '');
            if (!pick) return;
            const q = `resref=${encodeURIComponent(pick.trim().toLowerCase())}&from=${encodeURIComponent(name)}&kind=${kind}`;
            const res = await fetch(`/api/script?${q}`, { method: 'POST' });
            const r = await json(res);
            if (!res.ok) { alert(r.error || res.statusText); return; }
            input.value = r.resref;
            input.dispatchEvent(new Event('change'));
            await openScript(r.resref);
            sync();
        };
        row.appendChild(b);
    });
    return row;
}
