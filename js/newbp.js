// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The builder's own blueprints: a creature or item made as a copy of an existing one, then changed in a dialog.
// The engine keeps them in the builder's workspace and Publish sends the ones an area uses.

// biome-ignore-all lint/complexity/useArrowFunction: these are ThingsTool methods, written as functions like the rest so that `this` works in them

import { ThingsTool } from './things.js';
import { conversationPicker } from './dialogs.js';
import { scriptPicker } from './scripts.js';
import { ask } from './ask.js';
import { api } from './api.js';

const json = r => r.json().catch(() => ({}));

/** How each setting reads in the form, in the order shown: [label, text, group]. Anything the engine lists that isn't here
 *  comes last under "Other" with its own name. */
/** The blueprint file type of each kind the builder can make their own of. */
const EXT = { creature: 'utc', item: 'uti', placeable: 'utp', door: 'utd', store: 'utm' };

/** Settings that are on or off (stored as 0 or 1): shown as a tick box. */
const BOOLS = new Set([
    'Static',
    'Useable',
    'Plot',
    'HasInventory',
    'Locked',
    'Lockable',
    'KeyRequired',
    'AutoRemoveKey',
    'TrapFlag',
    'TrapOneShot',
    'TrapDetectable',
    'TrapDisarmable',
    'Interruptable',
    'IsImmortal',
    'NoPermDeath',
    'Lootable',
    'Disarmable',
    'Cursed',
    'Stolen',
    'Identified',
    'BlackMarket',
]);

const NAMES = {
    utd: [
        ['LocName', 'Name', 'The door'],
        ['Description', 'Description', 'The door'],
        ['Tag', 'Tag', 'The door'],
        ['Appearance', 'Appearance', 'The door'],
        ['Plot', "Plot (can't be hurt)", 'Behaviour'],
        ['Interruptable', 'Can be interrupted in conversation', 'Behaviour'],
        ['Conversation', 'Conversation', 'Behaviour'],
        ['Faction', 'Faction (repute.2da / factions row)', 'Behaviour'],
        ['Locked', 'Locked', 'Lock'],
        ['Lockable', 'Can be locked', 'Lock'],
        ['KeyRequired', 'Needs its key', 'Lock'],
        ['KeyName', 'Key tag', 'Lock'],
        ['AutoRemoveKey', 'Key is used up', 'Lock'],
        ['OpenLockDC', 'Pick-lock DC', 'Lock'],
        ['CloseLockDC', 'Lock DC', 'Lock'],
        ['TrapFlag', 'Trapped', 'Trap'],
        ['TrapType', 'Trap type (traps.2da row)', 'Trap'],
        ['TrapOneShot', 'Trap goes off once', 'Trap'],
        ['TrapDetectable', 'Trap can be found', 'Trap'],
        ['TrapDetectDC', 'Find DC', 'Trap'],
        ['TrapDisarmable', 'Trap can be disarmed', 'Trap'],
        ['DisarmDC', 'Disarm DC', 'Trap'],
        ['HP', 'Hit points', 'Strength'],
        ['CurrentHP', 'Hit points now', 'Strength'],
        ['Hardness', 'Hardness', 'Strength'],
        ['Fort', 'Fortitude save', 'Strength'],
        ['Ref', 'Reflex save', 'Strength'],
        ['Will', 'Will save', 'Strength'],
        ['OnOpen', 'On open', 'Scripts'],
        ['OnClosed', 'On closed', 'Scripts'],
        ['OnDeath', 'On death', 'Scripts'],
        ['OnDamaged', 'On damaged', 'Scripts'],
        ['OnHeartbeat', 'On heartbeat', 'Scripts'],
        ['OnLock', 'On lock', 'Scripts'],
        ['OnUnlock', 'On unlock', 'Scripts'],
        ['OnMeleeAttacked', 'On attacked', 'Scripts'],
        ['OnSpellCastAt', 'On spell cast at', 'Scripts'],
        ['OnTrapTriggered', 'On trap triggered', 'Scripts'],
        ['OnDisarm', 'On disarm', 'Scripts'],
        ['OnFailToOpen', 'On failing to open', 'Scripts'],
        ['OnUserDefined', 'On user defined', 'Scripts'],
        ['OnClick', 'On click', 'Scripts'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
    utm: [
        ['LocName', 'Name', 'The store'],
        ['Tag', 'Tag', 'The store'],
        ['MarkUp', "Sells at this % of an item's value", 'Prices'],
        ['MarkDown', "Buys at this % of an item's value", 'Prices'],
        ['StoreGold', 'Gold it has to buy with (-1: no limit)', 'Prices'],
        ['MaxBuyPrice', 'Most it pays for one item (-1: no limit)', 'Prices'],
        ['IdentifyPrice', 'Price to identify an item', 'Prices'],
        ['BlackMarket', 'Black market (buys stolen goods)', 'Prices'],
        ['BM_MarkDown', 'Black market buys at this % of value', 'Prices'],
        ['OnOpenStore', 'On opened', 'Scripts'],
        ['OnStoreClosed', 'On closed', 'Scripts'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
    utp: [
        ['LocName', 'Name', 'The placeable'],
        ['Description', 'Description', 'The placeable'],
        ['Tag', 'Tag', 'The placeable'],
        ['Appearance', 'Appearance', 'The placeable'],
        ['Static', 'Static (scenery only: nothing can be done with it)', 'Behaviour'],
        ['Useable', 'Can be used', 'Behaviour'],
        ['Plot', "Plot (can't be hurt)", 'Behaviour'],
        ['HasInventory', 'Holds items', 'Behaviour'],
        ['Conversation', 'Conversation', 'Behaviour'],
        ['Faction', 'Faction (repute.2da / factions row)', 'Behaviour'],
        ['Locked', 'Locked', 'Lock'],
        ['Lockable', 'Can be locked', 'Lock'],
        ['KeyRequired', 'Needs its key', 'Lock'],
        ['KeyName', 'Key tag', 'Lock'],
        ['AutoRemoveKey', 'Key is used up', 'Lock'],
        ['OpenLockDC', 'Pick-lock DC', 'Lock'],
        ['CloseLockDC', 'Lock DC', 'Lock'],
        ['TrapFlag', 'Trapped', 'Trap'],
        ['TrapType', 'Trap type (traps.2da row)', 'Trap'],
        ['TrapOneShot', 'Trap goes off once', 'Trap'],
        ['TrapDetectable', 'Trap can be found', 'Trap'],
        ['TrapDetectDC', 'Find DC', 'Trap'],
        ['TrapDisarmable', 'Trap can be disarmed', 'Trap'],
        ['DisarmDC', 'Disarm DC', 'Trap'],
        ['HP', 'Hit points', 'Strength'],
        ['CurrentHP', 'Hit points now', 'Strength'],
        ['Hardness', 'Hardness', 'Strength'],
        ['Fort', 'Fortitude save', 'Strength'],
        ['Ref', 'Reflex save', 'Strength'],
        ['Will', 'Will save', 'Strength'],
        ['OnUsed', 'On used', 'Scripts'],
        ['OnOpen', 'On open', 'Scripts'],
        ['OnClosed', 'On closed', 'Scripts'],
        ['OnDeath', 'On death', 'Scripts'],
        ['OnDamaged', 'On damaged', 'Scripts'],
        ['OnHeartbeat', 'On heartbeat', 'Scripts'],
        ['OnInvDisturbed', 'On inventory disturbed', 'Scripts'],
        ['OnLock', 'On lock', 'Scripts'],
        ['OnUnlock', 'On unlock', 'Scripts'],
        ['OnMeleeAttacked', 'On attacked', 'Scripts'],
        ['OnSpellCastAt', 'On spell cast at', 'Scripts'],
        ['OnTrapTriggered', 'On trap triggered', 'Scripts'],
        ['OnDisarm', 'On disarm', 'Scripts'],
        ['OnUserDefined', 'On user defined', 'Scripts'],
        ['OnClick', 'On click', 'Scripts'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
    utc: [
        ['FirstName', 'First name', 'Who'],
        ['LastName', 'Last name', 'Who'],
        ['Description', 'Description', 'Who'],
        ['Tag', 'Tag', 'Who'],
        ['Appearance_Type', 'Appearance (appearance.2da row)', 'Looks'],
        ['Gender', 'Gender (0 male, 1 female)', 'Looks'],
        ['Phenotype', 'Phenotype', 'Looks'],
        ['PortraitId', 'Portrait row', 'Looks'],
        ['SoundSetFile', 'Sound set row', 'Looks'],
        ['Race', 'Race (racialtypes.2da row)', 'Stats'],
        ['Str', 'Strength', 'Stats'],
        ['Dex', 'Dexterity', 'Stats'],
        ['Con', 'Constitution', 'Stats'],
        ['Int', 'Intelligence', 'Stats'],
        ['Wis', 'Wisdom', 'Stats'],
        ['Cha', 'Charisma', 'Stats'],
        ['HitPoints', 'Base hit points', 'Stats'],
        ['MaxHitPoints', 'Most hit points', 'Stats'],
        ['CurrentHitPoints', 'Hit points now', 'Stats'],
        ['NaturalAC', 'Natural armor', 'Stats'],
        ['fortbonus', 'Fortitude bonus', 'Stats'],
        ['refbonus', 'Reflex bonus', 'Stats'],
        ['willbonus', 'Will bonus', 'Stats'],
        ['ChallengeRating', 'Challenge rating', 'Stats'],
        ['CRAdjust', 'Challenge rating adjustment', 'Stats'],
        ['WalkRate', "Walk rate (7 is the appearance's)", 'Stats'],
        ['PerceptionRange', 'Perception range', 'Stats'],
        ['GoodEvil', 'Good/evil (0 evil to 100 good)', 'Stats'],
        ['LawfulChaotic', 'Lawful/chaotic', 'Stats'],
        ['FactionID', 'Faction (repute.2da/ factions row)', 'Behaviour'],
        ['Conversation', 'Conversation', 'Behaviour'],
        ['Plot', "Plot (can't be hurt)", 'Behaviour'],
        ['IsImmortal', 'Immortal', 'Behaviour'],
        ['NoPermDeath', "Doesn't die for good", 'Behaviour'],
        ['Interruptable', 'Can be interrupted in conversation', 'Behaviour'],
        ['Lootable', 'Corpse can be looted', 'Behaviour'],
        ['Disarmable', 'Traps on it can be disarmed', 'Behaviour'],
        ['ScriptSpawn', 'On spawn', 'Scripts'],
        ['ScriptAttacked', 'On attacked', 'Scripts'],
        ['ScriptDamaged', 'On damaged', 'Scripts'],
        ['ScriptDeath', 'On death', 'Scripts'],
        ['ScriptDialogue', 'On conversation', 'Scripts'],
        ['ScriptDisturbed', 'On inventory disturbed', 'Scripts'],
        ['ScriptEndRound', 'On end of round', 'Scripts'],
        ['ScriptHeartbeat', 'On heartbeat', 'Scripts'],
        ['ScriptOnBlocked', 'On blocked', 'Scripts'],
        ['ScriptOnNotice', 'On perception', 'Scripts'],
        ['ScriptRested', 'On rested', 'Scripts'],
        ['ScriptSpellAt', 'On spell cast at', 'Scripts'],
        ['ScriptUserDefine', 'On user defined', 'Scripts'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
    uti: [
        ['LocalizedName', 'Name', 'The item'],
        ['Description', 'Description (unidentified)', 'The item'],
        ['DescIdentified', 'Description (identified)', 'The item'],
        ['Tag', 'Tag', 'The item'],
        ['AddCost', 'Added cost (gold on top of its properties)', 'Value'],
        ['StackSize', 'Stack size', 'Value'],
        ['Charges', 'Charges', 'Value'],
        ['Plot', "Plot (can't be sold or destroyed)", 'Flags'],
        ['Cursed', 'Cursed', 'Flags'],
        ['Stolen', 'Stolen', 'Flags'],
        ['Identified', 'Identified', 'Flags'],
        ['Comment', 'Comment (for builders)', 'Other'],
    ],
};

ThingsTool.prototype.bpFinder = function () {
    const { $ } = this.ctx;
    const box = $('thingMake');
    if (!box) return;
    const k = this.armed;
    box.hidden = !(k?.kind in EXT);
    if (box.hidden) return;
    box.textContent = '';
    const sel = this.blueprint;
    const b = Object.assign(document.createElement('button'), {
        type: 'button',
        textContent: sel
            ? `Make my own ${k.label.toLowerCase()} from ${sel.name}`
            : `Make my own ${k.label.toLowerCase()}: pick one to start from`,
    });
    b.disabled = !sel;
    b.onclick = () => this.bpCreateForm(box, sel);
    box.appendChild(b);
    if (sel?.source === 'mine') {
        const e = Object.assign(document.createElement('button'), { type: 'button', textContent: `Change ${sel.name}` });
        e.onclick = () => this.bpEdit(EXT[k.kind], sel.resref);
        box.appendChild(e);
    }
};

/** A resref from a name: lower case letters and digits and _, at most 16. */
const slug = name =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 16);

ThingsTool.prototype.bpCreateForm = function (box, from) {
    const ext = EXT[this.armed.kind];
    box.textContent = '';
    const name = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'Its name', maxLength: 60 });
    const resref = Object.assign(document.createElement('input'), {
        type: 'text',
        placeholder: 'resref (16 letters, digits or _)',
        maxLength: 16,
    });
    let typed = false;
    resref.oninput = () => {
        typed = true;
    };
    name.oninput = () => {
        if (!typed) resref.value = slug(name.value);
    };
    const note = Object.assign(document.createElement('p'), { className: 'note' });
    note.textContent = `A copy of ${from.name}. The resref is its file name in the module; it can't be changed later and can't be one that exists.`;
    const go = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Make it' });
    const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel' });
    cancel.onclick = () => this.bpFinder();
    go.onclick = async () => {
        const q = `ext=${ext}&resref=${encodeURIComponent(resref.value.trim())}&from=${encodeURIComponent(from.resref)}&name=${encodeURIComponent(name.value.trim())}`;
        const res = await api(`/api/new-blueprint?${q}`, { method: 'POST' });
        const r = await json(res);
        if (!res.ok) {
            note.textContent = r.error || res.statusText;
            note.classList.add('err');
            return;
        }
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
    const res = await api(`/api/new-blueprint?ext=${ext}&resref=${encodeURIComponent(resref)}`);
    const d = await json(res);
    if (!res.ok) {
        body.textContent = d.error || res.statusText;
        return;
    }
    document.getElementById('bpTitle').textContent = `${d.name || d.resref} (${d.resref})`;
    body.textContent = '';
    const status = document.getElementById('bpStatus');
    status.textContent = '';
    const byLabel = new Map(d.fields.map(f => [f.label, f]));
    const order = (NAMES[ext] ?? []).filter(([l]) => byLabel.has(l));
    const known = new Set(order.map(([l]) => l));
    for (const f of d.fields) if (!known.has(f.label)) order.push([f.label, f.label, 'Other']);
    let group = null,
        section = null;
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
        const bool = BOOLS.has(label) && 'bhiwd'.includes(f.type);
        if (!long) input.type = bool ? 'checkbox' : f.type === 's' || f.type === 'l' || f.type === 'r' ? 'text' : 'number';
        if (long) input.rows = 3;
        if (f.type === 'f') input.step = 'any';
        if (bool) input.checked = !!Number(f.value);
        else input.value = f.value ?? '';
        if (f.type === 'r') input.maxLength = 16;
        input.onchange = async () => {
            const r = await api(`/api/new-blueprint-edit?ext=${ext}&resref=${encodeURIComponent(resref)}`, {
                method: 'POST',
                body: JSON.stringify({ [label]: bool ? (input.checked ? 1 : 0) : input.value }),
            });
            const out = await json(r);
            status.className = r.ok ? 'note' : 'note err';
            status.textContent = r.ok ? 'Saved.' : out.error || r.statusText;
            if (r.ok) {
                document.getElementById('bpTitle').textContent = `${out.name || out.resref} (${out.resref})`;
                this.search();
            }
        };
        row.append(span, input);
        section.appendChild(row);
        if (ext === 'utp' && label === 'Appearance') this.bpAppearance(input, row);
        if (ext === 'utd' && label === 'Appearance') this.bpDoorLook(resref, byLabel, input, row, status);
        if (label === 'Conversation') this.bpConversationRow(ext, resref, input, section);
        if (/^Script/.test(label) && f.type === 'r') row.appendChild(scriptPicker(input, 'action'));
    }
    if (ext === 'uti') await this.bpProperties(resref, body);
    if (ext === 'utc' || ext === 'utm' || (ext === 'utp' && byLabel.get('HasInventory'))) await this.bpGear(resref, body, ext);
    document.getElementById('bpDelete').onclick = async () => {
        if (
            !(await ask({
                title: `Delete ${resref}?`,
                text: `Placed copies of it stay in your areas, but it won't be published.`,
                ok: 'Delete it',
                danger: true,
            }))
        )
            return;
        const res = await api(`/api/new-blueprint-delete?ext=${ext}&resref=${encodeURIComponent(resref)}`, { method: 'POST' });
        if (!res.ok) {
            const status = document.getElementById('bpStatus');
            status.className = 'note err';
            status.textContent = `Not deleted: ${(await json(res)).error || res.statusText}`;
            return;
        }
        dlg.close();
        if (this.blueprint?.resref === resref) this.blueprint = null;
        this.search();
        this.bpFinder();
    };
};

/** Beside a creature's Conversation: pick, view, write or change one (the same picker the properties panel has). */
ThingsTool.prototype.bpConversationRow = function (_ext, resref, input, section) {
    section.appendChild(conversationPicker(input, resref.slice(0, 16)));
};

function el(tag, props = {}, ...kids) {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
}

/** An item's properties: the list (each can be taken off), its value, and a form to add one (type, then what the type offers). */
ThingsTool.prototype.bpProperties = async function (resref, body) {
    const q = `resref=${encodeURIComponent(resref)}`;
    const box = el('fieldset', {}, el('legend', { textContent: 'Properties' }));
    body.appendChild(box);
    const list = el('div', { className: 'stock' });
    const cost = el('p', { className: 'note' });
    const form = el('div', { className: 'propform' });
    box.append(list, cost, form);
    const types = (await json(await api(`/api/itemprops-types?${q}`))).types ?? [];
    const show = d => {
        list.textContent = '';
        (d.properties ?? []).forEach((p, i) => {
            const rm = el('button', { type: 'button', textContent: '×', title: 'Take it off the item' });
            rm.onclick = async () => show(await json(await api(`/api/itemprops-remove?${q}&index=${i}`, { method: 'POST' })));
            list.appendChild(el('div', { className: 'stock-row' }, el('span', { className: 'name', textContent: p.text }), rm));
        });
        if (!(d.properties ?? []).length) list.textContent = 'None.';
        cost.textContent = `Worth ${(d.cost ?? 0).toLocaleString()} gold (worked out as the game does).`;
        const t = document.getElementById('bpStatus');
        if (d.error) {
            t.className = 'note err';
            t.textContent = d.error;
        }
    };
    show(await json(await api(`/api/itemprops?${q}`)));
    const select = (options, label) => {
        const s = el('select', {});
        for (const o of options) s.add(new Option(o.text ?? o.name, String(o.row)));
        s.title = label;
        return s;
    };
    const type = select(types, 'Property');
    type.insertBefore(new Option('Add a property…', ''), type.firstChild);
    type.value = '';
    const more = el('div', { className: 'propmore' });
    const add = el('button', { type: 'button', textContent: 'Add it', hidden: true });
    form.append(type, more, add);
    let sub = null,
        val = null,
        par = null;
    const choose = async () => {
        more.textContent = '';
        sub = val = par = null;
        add.hidden = type.value === '';
        if (type.value === '') return;
        const c = await json(await api(`/api/itemprops-choices?${q}&property=${type.value}&subtype=${sub?.value ?? 0}`));
        if (c.subtypes?.length) {
            sub = select(c.subtypes, 'Which');
            sub.onchange = reparam;
            more.appendChild(sub);
        }
        if (c.costs?.length) {
            val = select(c.costs, 'Value');
            more.appendChild(val);
        }
        if (c.params?.length) {
            par = select(c.params, 'Parameter');
            more.appendChild(par);
        }
    };
    // (A subtype can bring its own parameter table.)
    const reparam = async () => {
        const c = await json(await api(`/api/itemprops-choices?${q}&property=${type.value}&subtype=${sub.value}`));
        par?.remove();
        par = null;
        if (c.params?.length) {
            par = select(c.params, 'Parameter');
            more.appendChild(par);
        }
    };
    type.onchange = choose;
    add.onclick = async () => {
        const req = { property: Number(type.value) };
        if (sub) req.subtype = Number(sub.value);
        if (val) req.costValue = Number(val.value);
        if (par) req.param1Value = Number(par.value);
        show(await json(await api(`/api/itemprops-add?${q}`, { method: 'POST', body: JSON.stringify(req) })));
        type.value = '';
        choose();
    };
};

const SLOTS = [
    'head',
    'chest',
    'boots',
    'arms',
    'right hand',
    'left hand',
    'cloak',
    'left ring',
    'right ring',
    'neck',
    'belt',
    'arrows',
    'bullets',
    'bolts',
    'claw left',
    'claw right',
    'bite',
    'skin',
];

/** What a new creature carries and wears, as its blueprint holds it (every copy placed gets it). Saved as it is changed. */
ThingsTool.prototype.bpGear = async function (resref, body, ext = 'utc') {
    const placeable = ext !== 'utc';
    const store = ext === 'utm';
    const title = store ? 'Stock' : placeable ? 'Holds' : 'Carries and wears';
    const box = el('fieldset', {}, el('legend', { textContent: title }));
    body.appendChild(box);
    const url = `/api/new-blueprint-gear?resref=${encodeURIComponent(resref)}${placeable ? `&ext=${ext}` : ''}`;
    const kind = store ? 'store' : placeable ? 'placeable' : 'creature';
    let c = await json(await api(`/api/blueprint-contents?kind=${kind}&resref=${encodeURIComponent(resref)}`));
    const put = async patch => {
        const r = await api(url, { method: 'POST', body: JSON.stringify(patch) });
        const out = await json(r);
        const st = document.getElementById('bpStatus');
        st.className = r.ok ? 'note' : 'note err';
        st.textContent = r.ok ? 'Saved.' : out.error || r.statusText;
        if (r.ok) c = await json(await api(`/api/blueprint-contents?kind=${kind}&resref=${encodeURIComponent(resref)}`));
        draw();
    };
    const finder = (placeholder, pick) => {
        const find = el('input', { type: 'search', placeholder, autocomplete: 'off' });
        const found = el('div', { className: 'bplist' });
        let timer = null,
            seq = 0;
        find.oninput = () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                const me = ++seq,
                    q = find.value.trim();
                found.textContent = '';
                if (q.length < 2) return;
                const r = await json(await api(`/api/blueprints?kind=item&q=${encodeURIComponent(q)}&limit=8`));
                if (me !== seq) return;
                for (const b of r.blueprints ?? []) {
                    const e = el('button', { type: 'button', className: 'bp' });
                    e.innerHTML = '<span class="txt"><b></b><small></small></span>';
                    e.querySelector('b').textContent = b.name;
                    e.querySelector('small').textContent = b.resref;
                    e.onclick = () => {
                        find.value = '';
                        found.textContent = '';
                        pick(b);
                    };
                    found.appendChild(e);
                }
                if (!found.children.length) found.textContent = 'Nothing matches.';
            }, 250);
        };
        return [find, found];
    };
    function draw() {
        box.textContent = '';
        box.appendChild(el('legend', { textContent: title }));
        const worn = c.equipment ?? [],
            items = c.items ?? [];
        if (!placeable) box.appendChild(el('h5', { textContent: `Worn and wielded (${worn.length})` }));
        const wl = el('div', { className: 'stock' });
        worn.forEach((w, i) => {
            const rm = el('button', { type: 'button', textContent: '×', title: 'Take it off' });
            rm.onclick = () => put({ equipment: worn.filter((_, k) => k !== i) });
            wl.appendChild(
                el(
                    'div',
                    { className: 'stock-row' },
                    el('span', { className: 'name', textContent: `${w.slot}: ${w.name || w.resref}` }),
                    rm,
                ),
            );
        });
        if (!worn.length) wl.textContent = 'Nothing.';
        const slot = el('select', {});
        for (const n of SLOTS) slot.add(new Option(n, n));
        const [wf, wfound] = finder("Put on or in hand: type the item's name", b =>
            put({ equipment: [...worn.filter(w => w.slot !== slot.value), { slot: slot.value, resref: b.resref }] }),
        );
        if (!placeable) box.append(wl, slot, wf, wfound);
        box.appendChild(el('h5', { textContent: `${store ? 'For sale' : placeable ? 'Contents' : 'Carries'} (${items.length})` }));
        const il = el('div', { className: 'stock' });
        items.forEach((it, i) => {
            const rm = el('button', { type: 'button', textContent: '×', title: 'Take it out' });
            rm.onclick = () => put({ inventory: items.filter((_, k) => k !== i) });
            const row = el('div', { className: 'stock-row' }, el('span', { className: 'name', textContent: it.name || it.resref }));
            if (store) {
                const cb = Object.assign(document.createElement('input'), {
                    type: 'checkbox',
                    checked: !!it.infinite,
                    title: 'Never runs out',
                });
                cb.onchange = () => put({ inventory: items.map((x, k) => (k === i ? { ...x, infinite: cb.checked } : x)) });
                row.append(el('label', { className: 'check' }, cb, document.createTextNode('∞')));
            }
            row.appendChild(rm);
            il.appendChild(row);
        });
        if (!items.length) il.textContent = 'Nothing.';
        const [cf, cfound] = finder('Add an item: type its name', b => put({ inventory: [...items, { resref: b.resref }] }));
        box.append(il, cf, cfound);
    }
    draw();
};

let placeableRows = null;

/** A placeable's Appearance: the game's placeables.2da rows (the game's own and the haks'), found by name as you type. The
 *  box keeps the row number the blueprint stores; the line above it says what that row is. */
ThingsTool.prototype.bpAppearance = async function (input, row) {
    placeableRows ??= (await json(await api('/api/placeables'))).placeables ?? [];
    const byRow = new Map(placeableRows.map(p => [p.row, p]));
    const shown = el('div', { className: 'note' });
    const label = () => {
        const p = byRow.get(Number(input.value));
        shown.textContent = p ? `${p.name || p.label} (row ${p.row}, model ${p.model})` : `row ${input.value}`;
    };
    label();
    const find = el('input', { type: 'search', placeholder: 'Search the appearances by name', autocomplete: 'off' });
    const found = el('div', { className: 'bplist' });
    find.oninput = () => {
        found.textContent = '';
        const q = find.value.trim().toLowerCase();
        if (q.length < 2) return;
        for (const p of placeableRows
            .filter(x => (x.name || '').toLowerCase().includes(q) || (x.label || '').toLowerCase().includes(q) || x.model.includes(q))
            .slice(0, 10)) {
            const b = el('button', { type: 'button', className: 'bp' });
            b.innerHTML = '<span class="txt"><b></b><small></small></span>';
            b.querySelector('b').textContent = p.name || p.label;
            b.querySelector('small').textContent = `row ${p.row} · ${p.model}`;
            b.onclick = () => {
                input.value = String(p.row);
                input.dispatchEvent(new Event('change'));
                label();
                find.value = '';
                found.textContent = '';
            };
            found.appendChild(b);
        }
        if (!found.children.length) found.textContent = 'Nothing matches.';
    };
    input.style.display = 'none';
    row.append(shown, find, found);
};

let doorLooks = null;

/** A door's look: a generic door (genericdoors.2da, Appearance 0 and a generic type) or a tile door (doortypes.2da, an Appearance row), found by name. */
ThingsTool.prototype.bpDoorLook = async function (resref, byLabel, input, row, status) {
    doorLooks ??= (await json(await api('/api/door-appearances'))).doors ?? [];
    const edit = async fields => {
        const r = await api(`/api/new-blueprint-edit?ext=utd&resref=${encodeURIComponent(resref)}`, {
            method: 'POST',
            body: JSON.stringify(fields),
        });
        const out = await json(r);
        status.className = r.ok ? 'note' : 'note err';
        status.textContent = r.ok ? 'Saved.' : out.error || r.statusText;
        return r.ok ? out : null;
    };
    let appearance = Number(byLabel.get('Appearance')?.value ?? 0),
        generic = Number(byLabel.get('GenericType_New')?.value ?? 0);
    const shown = el('div', { className: 'note' });
    const label = () => {
        const d = doorLooks.find(x => (appearance === 0 ? x.generic && x.row === generic : !x.generic && x.row === appearance));
        shown.textContent = d
            ? `${d.name || d.label} (${d.generic ? 'generic' : 'tile'} door ${d.row}, model ${d.model})`
            : `appearance ${appearance}, generic ${generic}`;
    };
    label();
    const find = el('input', { type: 'search', placeholder: 'Search the door looks by name', autocomplete: 'off' });
    const found = el('div', { className: 'bplist' });
    find.oninput = () => {
        found.textContent = '';
        const q = find.value.trim().toLowerCase();
        if (q.length < 2) return;
        for (const d of doorLooks
            .filter(x => (x.name || '').toLowerCase().includes(q) || (x.label || '').toLowerCase().includes(q) || x.model.includes(q))
            .slice(0, 10)) {
            const b = el('button', { type: 'button', className: 'bp' });
            b.innerHTML = '<span class="txt"><b></b><small></small></span>';
            b.querySelector('b').textContent = d.name || d.label;
            b.querySelector('small').textContent = `${d.generic ? 'generic' : 'tile'} door ${d.row} · ${d.model}`;
            b.onclick = async () => {
                const ok = await edit(d.generic ? { Appearance: 0, GenericType_New: d.row } : { Appearance: d.row });
                if (ok) {
                    appearance = d.generic ? 0 : d.row;
                    generic = d.generic ? d.row : generic;
                    label();
                }
                find.value = '';
                found.textContent = '';
            };
            found.appendChild(b);
        }
        if (!found.children.length) found.textContent = 'Nothing matches.';
    };
    input.style.display = 'none';
    row.append(shown, find, found);
};
