// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The conversation editor: one of the builder's own conversations as a tree of lines. The NPC's lines ("NPC") lead to the
// player's replies ("You"), which lead to more NPC lines. A line reached from more than one place is shown once in full and
// as a link elsewhere. Every change is saved as it is made (lines keep their places); closing tidies the numbering.

import { scriptPicker } from './scripts.js';
import { ask } from './ask.js';
import { api, json } from './api.js';
import { $, el } from './dom.js';

const excerpt = (t, n = 48) => (t || '(empty)').replace(/\s+/g, ' ').slice(0, n) + ((t || '').length > n ? '…' : '');

async function openConversation(resref, onMade = null) {
    const dlg = $('dlgDialog');
    const tree = $('dlgTree');
    const status = $('dlgStatus');
    $('dlgTitle').textContent = `Conversation ${resref}`;
    tree.textContent = 'Loading…';
    status.textContent = '';
    status.className = 'note';
    dlg.showModal();
    const res = await api(`/api/dialog?resref=${encodeURIComponent(resref)}&any=1`);
    const m = await json(res);
    if (!res.ok) {
        tree.textContent = m.error || res.statusText;
        return;
    }
    // One that isn't yours (the module's or the game's) is shown to read, with a button to start your own from it.
    const readOnly = !m.mine;
    tree.classList.toggle('ro', readOnly);
    $('dlgCopy').hidden = !readOnly;
    $('dlgTitle').textContent = readOnly ? `Conversation ${resref} (read only)` : `Conversation ${resref}`;
    $('dlgNote').textContent = readOnly
        ? `This is the module's (or the game's), so it can't be changed here. Make your own copy to change it.`
        : 'Your own conversation. Changes are saved as you make them and go to review with what uses it.';
    $('dlgCopy').onclick = async () => {
        let made = null;
        const ok = await ask({
            title: 'Make your own copy',
            text: `A conversation of yours that starts as a copy of ${resref}. Its name is what the game calls it: up to 16 lower case letters, digits or _.`,
            ok: 'Make the copy',
            input: { label: 'Name', placeholder: 'e.g. my_innkeeper' },
            submit: async name => {
                const r = await api(`/api/dialog?resref=${encodeURIComponent(name.toLowerCase())}&from=${encodeURIComponent(resref)}`, {
                    method: 'POST',
                });
                const out = await json(r);
                if (!r.ok) return out.error || r.statusText;
                made = out.resref;
            },
        });
        if (!ok || !made) return;
        dlg.close();
        onMade?.(made);
        await openConversation(made, onMade);
    };
    let timer = null,
        saving = Promise.resolve();
    const save = (compact = false) => {
        if (readOnly) return Promise.resolve();
        clearTimeout(timer);
        const body = JSON.stringify(m);
        saving = saving.then(async () => {
            const r = await api(`/api/dialog-save?resref=${encodeURIComponent(resref)}${compact ? '&compact=1' : ''}`, {
                method: 'POST',
                body,
            });
            const out = await json(r);
            status.className = r.ok ? 'note' : 'note err';
            status.textContent = r.ok ? 'Saved.' : out.error || r.statusText;
        });
        return saving;
    };
    const later = () => {
        if (readOnly) return;
        status.textContent = 'Saving…';
        clearTimeout(timer);
        timer = setTimeout(() => save(), 700);
    };
    const redraw = () => {
        later();
        render();
    };

    /** One line and what follows it. `link` is the link that leads here (it holds the condition). */
    const node = (side, i, link, seen, parentLinks) => {
        const n = (side === 0 ? m.entries : m.replies)[i];
        const box = el('div', { className: `dlgnode ${side === 0 ? 'npc' : 'pc'}` });
        const head = el('div', { className: 'dlghead' }, el('b', { textContent: side === 0 ? 'NPC' : 'You' }));
        const rm = el('button', {
            type: 'button',
            textContent: '×',
            title: 'Take this out (the lines below it go too, unless something else leads to them)',
        });
        rm.onclick = () => {
            parentLinks.splice(parentLinks.indexOf(link), 1);
            redraw();
        };
        head.appendChild(rm);
        box.appendChild(head);
        if (seen.has(`${side}:${i}`)) {
            box.classList.add('dlglink');
            box.appendChild(el('p', { className: 'note', textContent: `↪ goes on as: ${excerpt(n.text)}` }));
            return box;
        }
        seen.add(`${side}:${i}`);
        const text = el('textarea', { rows: 2, value: n.text ?? '', placeholder: side === 0 ? 'What the NPC says' : 'What you answer' });
        text.oninput = () => {
            n.text = text.value;
            later();
        };
        box.appendChild(text);
        const small = el('details', { className: 'dlgmore' }, el('summary', { textContent: 'Conditions and actions' }));
        const field = (label, get, set, ph = '', max = 32, kind = null) => {
            const inp = el('input', { type: 'text', value: get() ?? '', placeholder: ph, maxLength: max });
            inp.onchange = () => {
                set(inp.value);
                later();
            };
            const row = el('label', {}, el('span', { textContent: label }), inp);
            if (kind) row.appendChild(scriptPicker(inp, kind));
            small.appendChild(row);
        };
        field(
            'Only if (script)',
            () => link.active,
            v => {
                link.active = v.trim();
            },
            'a conditional script, e.g. a check',
            16,
            'condition',
        );
        field(
            'Then run (script)',
            () => n.script,
            v => {
                n.script = v.trim();
            },
            'an action script',
            16,
            'action',
        );
        if (side === 0)
            field(
                'Speaker tag',
                () => n.speaker,
                v => {
                    n.speaker = v.trim();
                },
                'blank: the owner of the conversation',
            );
        field(
            'Note',
            () => n.comment,
            v => {
                n.comment = v;
            },
            'for builders',
            200,
        );
        box.appendChild(small);
        const kids = el('div', { className: 'dlgkids' });
        n.links ??= [];
        for (const l of n.links) kids.appendChild(node(1 - side, l.index, l, seen, n.links));
        box.appendChild(kids);
        const bar = el('div', { className: 'dlgbar' });
        const add = el('button', { type: 'button', textContent: side === 0 ? '+ Your reply' : '+ NPC line' });
        add.onclick = () => {
            const list = side === 0 ? m.replies : m.entries;
            list.push(
                side === 0
                    ? { text: '', script: '', comment: '', links: [] }
                    : { text: '', speaker: '', script: '', comment: '', links: [] },
            );
            n.links.push({ index: list.length - 1, active: '' });
            redraw();
        };
        const to = el('select', {});
        to.add(new Option('↪ Link to a line…', ''));
        const others = side === 0 ? m.replies : m.entries;
        others.forEach((o, k) => {
            if (reachable(1 - side).has(k)) to.add(new Option(`${side === 0 ? 'You' : 'NPC'}: ${excerpt(o.text, 40)}`, String(k)));
        });
        to.onchange = () => {
            if (to.value !== '') {
                n.links.push({ index: Number(to.value), active: '' });
                redraw();
            }
        };
        bar.append(add, to);
        box.appendChild(bar);
        return box;
    };

    /** Which lines of a side are reached from a start (the ones worth linking to). */
    const reachable = side => {
        const out = [new Set(), new Set()];
        const go = (s, i) => {
            if (out[s].has(i)) return;
            out[s].add(i);
            for (const l of (s === 0 ? m.entries : m.replies)[i]?.links ?? []) go(1 - s, l.index);
        };
        for (const s of m.starts) go(0, s.index);
        return out[side];
    };

    function render() {
        tree.textContent = '';
        const seen = new Set();
        for (const s of m.starts) tree.appendChild(node(0, s.index, s, seen, m.starts));
        const add = el('button', { type: 'button', textContent: '+ Another way for the NPC to start' });
        add.onclick = () => {
            m.entries.push({ text: '', speaker: '', script: '', comment: '', links: [] });
            m.starts.push({ index: m.entries.length - 1, active: '' });
            redraw();
        };
        tree.appendChild(add);
        const end = el('details', { className: 'dlgmore' }, el('summary', { textContent: 'When it ends' }));
        for (const [label, key] of [
            ['Script when it ends', 'end'],
            ['Script when it is aborted', 'abort'],
        ]) {
            const inp = el('input', { type: 'text', value: m[key] ?? '', maxLength: 16 });
            inp.onchange = () => {
                m[key] = inp.value.trim();
                later();
            };
            end.appendChild(el('label', {}, el('span', { textContent: label }), inp, scriptPicker(inp, 'action')));
        }
        tree.appendChild(end);
        if (readOnly) for (const e of tree.querySelectorAll('textarea, input, select')) e.disabled = true;
    }
    render();
    await new Promise(done => {
        const close = async () => {
            dlg.removeEventListener('close', close);
            await save(true);
            done();
        };
        dlg.addEventListener('close', close);
    });
}

let listId = 0;

/** Beside a creature's (or door's, placeable's) Conversation box: conversations found by name as you type, and a button to
 *  write one (new, named by `suggest`), look at the module's (read only, with a copy button) or change one of yours. */
export function conversationPicker(input, suggest = '') {
    const list = el('datalist', { id: `convs${++listId}` });
    input.setAttribute('list', list.id);
    let timer = null;
    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const q = input.value.trim();
            if (q.length < 2) return;
            list.textContent = '';
            for (const d of (await json(await api(`/api/dialogs?q=${encodeURIComponent(q)}`))).found ?? [])
                list.appendChild(new Option(d.source === 'mine' ? `${d.resref} (yours)` : d.resref, d.resref));
        }, 250);
    });
    const row = el('span', { className: 'scriptbtns' }, list);
    const b = el('button', { type: 'button', className: 'small' });
    const mine = async () => ((await json(await api('/api/dialogs'))).dialogs ?? []).includes(input.value.trim().toLowerCase());
    const sync = async () => {
        b.textContent = (await mine()) ? 'Edit conversation' : input.value.trim() ? 'View conversation' : 'Write a conversation';
    };
    sync();
    input.addEventListener('change', sync);
    const made = r => {
        input.value = r;
        input.dispatchEvent(new Event('change'));
    };
    b.onclick = async () => {
        const name = input.value.trim().toLowerCase();
        if (name) {
            await openConversation(name, made);
            sync();
            return;
        }
        let r = null;
        const ok = await ask({
            title: 'Write a conversation',
            text: 'A new conversation of yours, with a first line for the NPC to say. Its name is what the game calls it: up to 16 lower case letters, digits or _.',
            ok: 'Start writing',
            input: { label: 'Name', value: suggest, placeholder: 'e.g. my_innkeeper' },
            submit: async pick => {
                const res = await api(`/api/dialog?resref=${encodeURIComponent(pick.toLowerCase())}&from=`, { method: 'POST' });
                const out = await json(res);
                if (!res.ok) return out.error || res.statusText;
                r = out;
            },
        });
        if (!ok || !r) return;
        made(r.resref);
        await openConversation(r.resref, made);
        sync();
    };
    row.appendChild(b);
    return row;
}
