// The conversation editor: one of the builder's own conversations as a tree of lines. The NPC's lines ("NPC") lead to the
// player's replies ("You"), which lead to more NPC lines. A line reached from more than one place is shown once in full and
// as a link elsewhere. Every change is saved as it is made (lines keep their places); closing tidies the numbering.

const json = r => r.json().catch(() => ({}));
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const excerpt = (t, n = 48) => (t || '(empty)').replace(/\s+/g, ' ').slice(0, n) + ((t || '').length > n ? '…' : '');

export async function openConversation(resref) {
    const dlg = document.getElementById('dlgDialog');
    const tree = document.getElementById('dlgTree');
    const status = document.getElementById('dlgStatus');
    document.getElementById('dlgTitle').textContent = `Conversation ${resref}`;
    tree.textContent = 'Loading…';
    status.textContent = '';
    status.className = 'note';
    dlg.showModal();
    const res = await fetch(`/api/dialog?resref=${encodeURIComponent(resref)}`);
    const m = await json(res);
    if (!res.ok) { tree.textContent = m.error || res.statusText; return; }
    let timer = null, saving = Promise.resolve();
    const save = (compact = false) => {
        clearTimeout(timer);
        const body = JSON.stringify(m);
        saving = saving.then(async () => {
            const r = await fetch(`/api/dialog-save?resref=${encodeURIComponent(resref)}${compact ? '&compact=1' : ''}`, { method: 'POST', body });
            const out = await json(r);
            status.className = r.ok ? 'note' : 'note err';
            status.textContent = r.ok ? 'Saved.' : (out.error || r.statusText);
        });
        return saving;
    };
    const later = () => { status.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(() => save(), 700); };
    const redraw = () => { later(); render(); };

    /** One line and what follows it. `link` is the link that leads here (it holds the condition). */
    const node = (side, i, link, seen, parentLinks) => {
        const n = (side === 0 ? m.entries : m.replies)[i];
        const box = el('div', { className: `dlgnode ${side === 0 ? 'npc' : 'pc'}` });
        const head = el('div', { className: 'dlghead' }, el('b', { textContent: side === 0 ? 'NPC' : 'You' }));
        const rm = el('button', { type: 'button', textContent: '×', title: 'Take this out (the lines below it go too, unless something else leads to them)' });
        rm.onclick = () => { parentLinks.splice(parentLinks.indexOf(link), 1); redraw(); };
        head.appendChild(rm);
        box.appendChild(head);
        if (seen.has(`${side}:${i}`)) {
            box.classList.add('dlglink');
            box.appendChild(el('p', { className: 'note', textContent: `↪ goes on as: ${excerpt(n.text)}` }));
            return box;
        }
        seen.add(`${side}:${i}`);
        const text = el('textarea', { rows: 2, value: n.text ?? '', placeholder: side === 0 ? 'What the NPC says' : 'What you answer' });
        text.oninput = () => { n.text = text.value; later(); };
        box.appendChild(text);
        const small = el('details', { className: 'dlgmore' }, el('summary', { textContent: 'Conditions and actions' }));
        const field = (label, get, set, ph = '', max = 32) => {
            const inp = el('input', { type: 'text', value: get() ?? '', placeholder: ph, maxLength: max });
            inp.onchange = () => { set(inp.value); later(); };
            small.appendChild(el('label', {}, el('span', { textContent: label }), inp));
        };
        field('Only if (script)', () => link.active, v => { link.active = v.trim(); }, 'a conditional script, e.g. a check');
        field('Then run (script)', () => n.script, v => { n.script = v.trim(); }, 'an action script');
        if (side === 0) field('Speaker tag', () => n.speaker, v => { n.speaker = v.trim(); }, 'blank: the owner of the conversation');
        field('Note', () => n.comment, v => { n.comment = v; }, 'for builders', 200);
        box.appendChild(small);
        const kids = el('div', { className: 'dlgkids' });
        n.links ??= [];
        for (const l of n.links) kids.appendChild(node(1 - side, l.index, l, seen, n.links));
        box.appendChild(kids);
        const bar = el('div', { className: 'dlgbar' });
        const add = el('button', { type: 'button', textContent: side === 0 ? '+ Your reply' : '+ NPC line' });
        add.onclick = () => {
            const list = side === 0 ? m.replies : m.entries;
            list.push(side === 0 ? { text: '', script: '', comment: '', links: [] } : { text: '', speaker: '', script: '', comment: '', links: [] });
            n.links.push({ index: list.length - 1, active: '' });
            redraw();
        };
        const to = el('select', {});
        to.add(new Option('↪ Link to a line…', ''));
        const others = side === 0 ? m.replies : m.entries;
        others.forEach((o, k) => { if (reachable(1 - side).has(k)) to.add(new Option(`${side === 0 ? 'You' : 'NPC'}: ${excerpt(o.text, 40)}`, String(k))); });
        to.onchange = () => { if (to.value !== '') { n.links.push({ index: Number(to.value), active: '' }); redraw(); } };
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
            for (const l of ((s === 0 ? m.entries : m.replies)[i]?.links ?? [])) go(1 - s, l.index);
        };
        for (const s of m.starts) go(0, s.index);
        return out[side];
    };

    function render() {
        tree.textContent = '';
        const seen = new Set();
        m.starts.forEach(s => tree.appendChild(node(0, s.index, s, seen, m.starts)));
        const add = el('button', { type: 'button', textContent: '+ Another way for the NPC to start' });
        add.onclick = () => { m.entries.push({ text: '', speaker: '', script: '', comment: '', links: [] }); m.starts.push({ index: m.entries.length - 1, active: '' }); redraw(); };
        tree.appendChild(add);
        const end = el('details', { className: 'dlgmore' }, el('summary', { textContent: 'When it ends' }));
        for (const [label, key] of [['Script when it ends', 'end'], ['Script when it is aborted', 'abort']]) {
            const inp = el('input', { type: 'text', value: m[key] ?? '', maxLength: 16 });
            inp.onchange = () => { m[key] = inp.value.trim(); later(); };
            end.appendChild(el('label', {}, el('span', { textContent: label }), inp));
        }
        tree.appendChild(end);
    }
    render();
    await new Promise(done => {
        const close = async () => { dlg.removeEventListener('close', close); await save(true); done(); };
        dlg.addEventListener('close', close);
    });
}
