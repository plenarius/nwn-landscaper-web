// The builder's own blueprints: a creature or item made as a copy of an existing one, then changed in a dialog.
// The engine keeps them in the builder's workspace and Publish sends the ones an area uses.

import { ThingsTool } from './things.js';
import { openConversation } from './dialogs.js';

const json = r => r.json().catch(() => ({}));

/** How each setting reads in the form, in the order shown: [label, text, group]. Anything the engine lists that isn't here
 *  comes last under "Other" with its own name. */
const NAMES = {
    utc: [
        ['FirstName', 'First name', 'Who'], ['LastName', 'Last name', 'Who'], ['Description', 'Description', 'Who'], ['Tag', 'Tag', 'Who'],
        ['Appearance_Type', 'Appearance (appearance.2da row)', 'Looks'], ['Gender', 'Gender (0 male, 1 female)', 'Looks'], ['Phenotype', 'Phenotype', 'Looks'],
        ['PortraitId', 'Portrait row', 'Looks'], ['SoundSetFile', 'Sound set row', 'Looks'],
        ['Race', 'Race (racialtypes.2da row)', 'Stats'], ['Str', 'Strength', 'Stats'], ['Dex', 'Dexterity', 'Stats'], ['Con', 'Constitution', 'Stats'],
        ['Int', 'Intelligence', 'Stats'], ['Wis', 'Wisdom', 'Stats'], ['Cha', 'Charisma', 'Stats'], ['HitPoints', 'Base hit points', 'Stats'],
        ['MaxHitPoints', 'Most hit points', 'Stats'], ['CurrentHitPoints', 'Hit points now', 'Stats'], ['NaturalAC', 'Natural armor', 'Stats'],
        ['fortbonus', 'Fortitude bonus', 'Stats'], ['refbonus', 'Reflex bonus', 'Stats'], ['willbonus', 'Will bonus', 'Stats'],
        ['ChallengeRating', 'Challenge rating', 'Stats'], ['CRAdjust', 'Challenge rating adjustment', 'Stats'], ['WalkRate', 'Walk rate (7 is the appearance\'s)', 'Stats'],
        ['PerceptionRange', 'Perception range', 'Stats'], ['GoodEvil', 'Good/evil (0 evil to 100 good)', 'Stats'], ['LawfulChaotic', 'Lawful/chaotic', 'Stats'],
        ['FactionID', 'Faction (repute.2da/ factions row)', 'Behaviour'], ['Conversation', 'Conversation', 'Behaviour'],
        ['Plot', 'Plot (can\'t be hurt)', 'Behaviour'], ['IsImmortal', 'Immortal', 'Behaviour'], ['NoPermDeath', 'Doesn\'t die for good', 'Behaviour'],
        ['Interruptable', 'Can be interrupted in conversation', 'Behaviour'], ['Lootable', 'Corpse can be looted', 'Behaviour'], ['Disarmable', 'Traps on it can be disarmed', 'Behaviour'],
        ['ScriptSpawn', 'On spawn', 'Scripts'], ['ScriptAttacked', 'On attacked', 'Scripts'], ['ScriptDamaged', 'On damaged', 'Scripts'], ['ScriptDeath', 'On death', 'Scripts'],
        ['ScriptDialogue', 'On conversation', 'Scripts'], ['ScriptDisturbed', 'On inventory disturbed', 'Scripts'], ['ScriptEndRound', 'On end of round', 'Scripts'],
        ['ScriptHeartbeat', 'On heartbeat', 'Scripts'], ['ScriptOnBlocked', 'On blocked', 'Scripts'], ['ScriptOnNotice', 'On perception', 'Scripts'],
        ['ScriptRested', 'On rested', 'Scripts'], ['ScriptSpellAt', 'On spell cast at', 'Scripts'], ['ScriptUserDefine', 'On user defined', 'Scripts'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
    uti: [
        ['LocalizedName', 'Name', 'The item'], ['Description', 'Description (unidentified)', 'The item'], ['DescIdentified', 'Description (identified)', 'The item'], ['Tag', 'Tag', 'The item'],
        ['AddCost', 'Added cost (gold on top of its properties)', 'Value'], ['StackSize', 'Stack size', 'Value'], ['Charges', 'Charges', 'Value'],
        ['Plot', 'Plot (can\'t be sold or destroyed)', 'Flags'], ['Cursed', 'Cursed', 'Flags'], ['Stolen', 'Stolen', 'Flags'], ['Identified', 'Identified', 'Flags'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
};

ThingsTool.prototype.bpFinder = function () {
    const { $ } = this.ctx;
    const box = $('thingMake');
    if (!box) return;
    const k = this.armed;
    box.hidden = !['creature', 'item'].includes(k?.kind);
    if (box.hidden) return;
    box.textContent = '';
    const sel = this.blueprint;
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: sel ? `Make my own ${k.label.toLowerCase()} from ${sel.name}` : `Make my own ${k.label.toLowerCase()}: pick one to start from` });
    b.disabled = !sel;
    b.onclick = () => this.bpCreateForm(box, sel);
    box.appendChild(b);
    if (sel?.source === 'mine') {
        const e = Object.assign(document.createElement('button'), { type: 'button', textContent: `Change ${sel.name}` });
        e.onclick = () => this.bpEdit(k.kind === 'creature' ? 'utc' : 'uti', sel.resref);
        box.appendChild(e);
    }
};

/** A resref from a name: lower case letters and digits and _, at most 16. */
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 16);

ThingsTool.prototype.bpCreateForm = function (box, from) {
    const ext = this.armed.kind === 'creature' ? 'utc' : 'uti';
    box.textContent = '';
    const name = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Its name', maxLength: 60 });
    const resref = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'resref (16 letters, digits or _)', maxLength: 16 });
    let typed = false;
    resref.oninput = () => { typed = true; };
    name.oninput = () => { if (!typed) resref.value = slug(name.value); };
    const note = Object.assign(document.createElement('p'), { className: 'note' });
    note.textContent = `A copy of ${from.name}. The resref is its file name in the module; it can't be changed later and can't be one that exists.`;
    const go = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Make it' });
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    cancel.onclick = () => this.bpFinder();
    go.onclick = async () => {
        const q = `ext=${ext}&resref=${encodeURIComponent(resref.value.trim())}&from=${encodeURIComponent(from.resref)}&name=${encodeURIComponent(name.value.trim())}`;
        const res = await fetch(`/api/new-blueprint?${q}`, { method: 'POST' });
        const r = await json(res);
        if (!res.ok) { note.textContent = r.error || res.statusText; note.classList.add('err'); return; }
        this.blueprint = { resref: r.resref, name: r.name, source: 'mine' };
        this.ctx.$('thingSearch').value = r.resref;
        await this.search();
        this.bpFinder();
        this.bpEdit(ext, r.resref);
    };
    box.append(name, resref, note, go, cancel);
    name.focus();
};

/** The dialog that changes one of the builder's blueprints. Each setting is saved as it is changed. */
ThingsTool.prototype.bpEdit = async function (ext, resref) {
    const dlg = document.getElementById('bpDialog');
    const body = document.getElementById('bpBody');
    body.textContent = 'Loading…';
    dlg.showModal();
    const res = await fetch(`/api/new-blueprint?ext=${ext}&resref=${encodeURIComponent(resref)}`);
    const d = await json(res);
    if (!res.ok) { body.textContent = d.error || res.statusText; return; }
    document.getElementById('bpTitle').textContent = `${d.name || d.resref} (${d.resref})`;
    body.textContent = '';
    const status = document.getElementById('bpStatus');
    status.textContent = '';
    const byLabel = new Map(d.fields.map(f => [f.label, f]));
    const order = (NAMES[ext] ?? []).filter(([l]) => byLabel.has(l));
    const known = new Set(order.map(([l]) => l));
    for (const f of d.fields) if (!known.has(f.label)) order.push([f.label, f.label, 'Other']);
    let group = null, section = null;
    for (const [label, text, g] of order) {
        const f = byLabel.get(label);
        if (g !== group) {
            group = g;
            section = document.createElement('fieldset');
            const lg = document.createElement('legend');
            lg.textContent = g;
            section.appendChild(lg);
            body.appendChild(section);
        }
        const row = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = text;
        const long = f.type === 'l' && /Description/.test(label);
        const input = document.createElement(long ? 'textarea' : 'input');
        if (!long) input.type = f.type === 's' || f.type === 'l' || f.type === 'r' ? 'text' : 'number';
        if (long) input.rows = 3;
        if (f.type === 'f') input.step = 'any';
        input.value = f.value ?? '';
        if (f.type === 'r') input.maxLength = 16;
        input.onchange = async () => {
            const r = await fetch(`/api/new-blueprint-edit?ext=${ext}&resref=${encodeURIComponent(resref)}`, { method: 'POST', body: JSON.stringify({ [label]: input.value }) });
            const out = await json(r);
            status.className = r.ok ? 'note' : 'note err';
            status.textContent = r.ok ? 'Saved.' : (out.error || r.statusText);
            if (r.ok) { document.getElementById('bpTitle').textContent = `${out.name || out.resref} (${out.resref})`; this.search(); }
        };
        row.append(span, input);
        section.appendChild(row);
        if (label === 'Conversation') this.bpConversationRow(ext, resref, input, section);
    }
    document.getElementById('bpDelete').onclick = async () => {
        if (!confirm(`Delete ${resref}? Placed copies of it stay in your areas, but it won't be published.`)) return;
        await fetch(`/api/new-blueprint-delete?ext=${ext}&resref=${encodeURIComponent(resref)}`, { method: 'POST' });
        dlg.close();
        if (this.blueprint?.resref === resref) this.blueprint = null;
        this.search();
        this.bpFinder();
    };
};

/** Beside a creature's Conversation: write a conversation (new, or a copy of the one named), or change one of your own. */
ThingsTool.prototype.bpConversationRow = function (ext, resref, input, section) {
    const bar = el('div', { className: 'dlgbar' });
    const mine = async () => ((await json(await fetch('/api/dialogs'))).dialogs ?? []).includes(input.value.trim().toLowerCase());
    const write = el('button', { type: 'button' });
    const sync = async () => { write.textContent = (await mine()) ? 'Change this conversation' : input.value.trim() ? 'Write my own from this one' : 'Write a conversation'; };
    sync();
    input.addEventListener('change', sync);
    write.onclick = async () => {
        const name = input.value.trim().toLowerCase();
        if (await mine()) { await openConversation(name); return; }
        const pick = prompt('A name for your conversation (16 letters, digits or _):', resref.slice(0, 16));
        if (!pick) return;
        const q = `resref=${encodeURIComponent(pick.trim().toLowerCase())}&from=${encodeURIComponent(name)}`;
        const res = await fetch(`/api/dialog?${q}`, { method: 'POST' });
        const r = await json(res);
        if (!res.ok) { alert(r.error || res.statusText); return; }
        input.value = r.resref;
        input.dispatchEvent(new Event('change'));
        await openConversation(r.resref);
        sync();
    };
    bar.appendChild(write);
    section.appendChild(bar);
};

function el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; }
