// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Things tool's properties panel: the form of the thing (or the imported area's own object) selected, with its settings in
// groups, what it holds and wears, where a transition leads, and the list of originals taken out.
// The code is ThingsTool methods, added to the class from here like newbp.js's; the class lists them.

// biome-ignore-all lint/complexity/useArrowFunction: these are ThingsTool methods, written as functions like the rest so that `this` works in them

import { ThingsTool } from './things.js';
import { renderVars } from './vars.js';
import { scriptPicker } from './scripts.js';
import { conversationPicker } from './dialogs.js';
import { api, json } from './api.js';

const BOOLEAN = new Set([
    'HasMapNote',
    'MapNoteEnabled',
    'Locked',
    'Plot',
    'Active',
    'Reset',
    'Looping',
    'Positional',
    'Lockable',
    'KeyRequired',
    'AutoRemoveKey',
    'TrapFlag',
    'TrapOneShot',
    'TrapDetectable',
    'TrapDisarmable',
    'Static',
    'Useable',
    'Random',
    'RandomPosition',
    'BlackMarket',
    'PlayerOnly',
    'Identified',
    'Cursed',
    'Stolen',
    'IsImmortal',
    'NoPermDeath',
    'Interruptable',
    'Lootable',
]);
/** Which group of the form a setting is in; the rest are scripts (resrefs) or plain settings. */
const SECTIONS = {
    Lock: ['Lockable', 'Locked', 'KeyRequired', 'KeyName', 'AutoRemoveKey', 'OpenLockDC', 'CloseLockDC'],
    Trap: ['TrapFlag', 'TrapType', 'TrapOneShot', 'TrapDetectable', 'TrapDetectDC', 'TrapDisarmable', 'DisarmDC'],
    'Hit points and saves': ['HP', 'CurrentHP', 'Hardness', 'Fort', 'Ref', 'Will'],
    'Sound timing': [
        'Random',
        'RandomPosition',
        'RandomRangeX',
        'RandomRangeY',
        'Interval',
        'IntervalVrtn',
        'PitchVariation',
        'VolumeVrtn',
        'Times',
    ],
    Prices: ['MarkUp', 'MarkDown', 'BlackMarket', 'BM_MarkDown', 'IdentifyPrice', 'MaxBuyPrice'],
};
const SECTION_ORDER = ['Settings', 'Lock', 'Trap', 'Hit points and saves', 'Sound timing', 'Prices', 'Scripts'];
const sectionOf = f =>
    Object.entries(SECTIONS).find(([, labels]) => labels.includes(f.label))?.[0] ?? (f.type === 'r' ? 'Scripts' : 'Settings');
const FRIENDLY = {
    Lockable: 'Can be locked',
    KeyRequired: 'Needs its key to open',
    KeyName: 'Key tag',
    AutoRemoveKey: 'The key is used up',
    OpenLockDC: 'Pick-lock DC',
    CloseLockDC: 'Lock DC',
    TrapFlag: 'Is trapped',
    TrapType: 'Trap',
    TrapOneShot: 'One shot',
    TrapDetectable: 'Can be detected',
    TrapDetectDC: 'Detect DC',
    TrapDisarmable: 'Can be disarmed',
    DisarmDC: 'Disarm DC',
    HP: 'Hit points',
    CurrentHP: 'Hit points now',
    Hardness: 'Hardness',
    Fort: 'Fortitude save',
    Ref: 'Reflex save',
    Will: 'Will save',
    Static: 'Static (only scenery)',
    Useable: 'Can be used',
    Cursor: 'Cursor over it',
    HighlightHeight: 'Highlight height',
    DifficultyIndex: 'Difficulty (0 very easy to 4 impossible)',
    SpawnOption: 'Spawns (0 again and again, 1 once)',
    PlayerOnly: 'Only when a player sets it off',
    Random: 'Plays at random',
    RandomPosition: 'At a random spot',
    RandomRangeX: 'Spread east-west (m)',
    RandomRangeY: 'Spread north-south (m)',
    Interval: 'Every (ms)',
    IntervalVrtn: 'Varying by (ms)',
    PitchVariation: 'Pitch varies by',
    VolumeVrtn: 'Volume varies by',
    Times: 'Plays at (1 day, 2 night, 3 always)',
    BlackMarket: 'A black market',
    BM_MarkDown: 'Black-market mark-down %',
    IdentifyPrice: 'Identify price (-1 none)',
    MaxBuyPrice: 'Most it pays (-1 no limit)',
    Charges: 'Charges',
    StackSize: 'Stack size',
    Identified: 'Identified',
    Cursed: 'Cursed',
    Stolen: 'Stolen',
    IsImmortal: 'Immortal',
    NoPermDeath: 'No permanent death (can be raised)',
    Interruptable: 'Can be interrupted',
    Lootable: 'Can be looted',
    HasMapNote: 'Shows a map note',
    MapNote: 'Map note text',
    MapNoteEnabled: 'Map note enabled',
    LinkedTo: 'Leads to (tag)',
    LinkedToFlags: 'Leads to a (1 door, 2 waypoint)',
    TransitionDestin: 'Destination name',
    Type: 'Type (0 generic, 1 transition, 2 trap)',
    MaxCreatures: 'Most creatures',
    RecCreatures: 'Recommended creatures',
    ResetTime: 'Reset time (s)',
    MarkUp: 'Mark-up %',
    MarkDown: 'Mark-down %',
    MaxDistance: 'Hearing range (m)',
    MinDistance: 'Full volume range (m)',
};
const label = l =>
    FRIENDLY[l] ??
    l
        .replace(/^(Script|On)/, m => `${m} `)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .trim();

/** The creature inventory slots by name, in the order of the game's slot numbers (INVENTORY_SLOT_HEAD is 0). */
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

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Tags of the waypoints and doors in this area (the editor's and the original's), for a link. */
ThingsTool.prototype.linkTargets = function (self) {
    const a = this.area(),
        tags = new Set(this.moduleLinks?.filter(l => l.area !== a.name).map(l => l.tag));
    for (const t of a.things) if (t !== self && ['waypoint', 'door'].includes(t.kind) && t.tag) tags.add(t.tag);
    for (const g of this.ghosts()) if (['waypoint', 'door'].includes(g.kind) && g.tag) tags.add(g.tag);
    return [...tags].sort();
};

ThingsTool.prototype.renderOriginals = function () {
    const { $ } = this.ctx,
        box = $('thingOrigs'),
        a = this.area();
    if (!this.active) {
        box.hidden = true;
        return;
    }
    const gone = this.originals.filter(g => a.originals.removed.includes(g.key));
    const moved = Object.keys(a.originals.moved).length;
    box.hidden = !this.originals.length;
    if (!this.originals.length) return;
    box.textContent = '';
    const h = document.createElement('h4');
    h.textContent = `The area's own objects (grey): ${this.originals.length - gone.length} here, ${gone.length} taken out, ${moved} moved`;
    box.appendChild(h);
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Click a grey marker to move it, turn it or take it out.';
    box.appendChild(p);
    for (const g of gone) {
        const r = document.createElement('div');
        r.className = 'varrow origrow';
        const s = document.createElement('span');
        s.textContent = `${g.name || g.tag || g.resref} (${g.kind})`;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Put back';
        b.onclick = () => this.putBack(g.key);
        r.append(s, b);
        box.appendChild(r);
    }
};

/** The first choice of an on/off setting on a thing made from a blueprint: what the blueprint has, when `fields` (its own
 *  values, from blueprintFields) is known; a setting the blueprint doesn't have is off in the game. */
const blueprintsChoice = (fields, f) => (fields ? `The blueprint's (${fields[f] ? 'on' : 'off'})` : "The blueprint's");

/** A blueprint's own values for the settings a thing made from it can change (`GET /api/blueprint-fields`: `{label: value}`),
 *  asked once per blueprint. Null while it is asked, false when the engine has none to give (an engine from before that call,
 *  or a blueprint it doesn't know): the form then says only "The blueprint's". When the answer comes, the open form's
 *  choices are relabelled in place, so a choice the builder has open stays as it is. */
ThingsTool.prototype.blueprintFields = function (t) {
    const key = `${t.kind}:${t.blueprint}`;
    // (A change to one of the builder's own blueprints drops the whole cache, so an answer still under way lands in the old one.)
    this.fieldsCache ??= new Map();
    const cache = this.fieldsCache;
    if (!cache.has(key)) {
        cache.set(key, null);
        api(`/api/blueprint-fields?kind=${encodeURIComponent(t.kind)}&resref=${encodeURIComponent(t.blueprint)}`)
            .then(async res => {
                const v = res.ok ? await json(res) : null;
                if (v?.fields && typeof v.fields === 'object') cache.set(key, v.fields);
                // No engine (stopped, or the page is on a plain file server): asked again when the form is next drawn.
                else if (res.status === 503) cache.delete(key);
                else cache.set(key, false);
            })
            .catch(() => cache.delete(key))
            .finally(() => {
                const fields = cache.get(key);
                if (!fields || cache !== this.fieldsCache) return;
                for (const o of this.ctx.$('thingProps').querySelectorAll('option[data-bp-field]'))
                    if (o.dataset.bpKey === key) o.text = blueprintsChoice(fields, o.dataset.bpField);
            });
    }
    return cache.get(key);
};

/** The game's lists a setting is picked from (the traps), once. */
ThingsTool.prototype.loadLists = async function () {
    // (`{}` while it loads, so it is asked once; after a failure the setting is a plain number, and a form drawn 10 s later
    // asks again)
    this.lists = {};
    try {
        const res = await api('/api/area-lists');
        if (!res.ok) throw new Error(res.statusText);
        this.lists = await res.json();
    } catch {
        setTimeout(() => {
            this.lists = null;
        }, 10000);
        return;
    }
    if (this.active) this.renderProps();
};

/** The form of a thing's (or, `original`, an imported object's) properties into `box`. */
ThingsTool.prototype.propsForm = function (box, t, k, original) {
    if (!original) {
        const head = document.createElement('h4');
        head.textContent = `${k.label}${t.blueprint ? `: ${t.label ?? t.blueprint}` : ''}`;
        box.appendChild(head);
    }
    const row = (text, input) => {
        const l = document.createElement('label');
        const s = document.createElement('span');
        s.textContent = text;
        l.append(s, input);
        box.appendChild(l);
        return input;
    };
    const field = (type, value, apply, attrs = {}) => {
        const i = document.createElement('input');
        i.type = type;
        Object.assign(i, attrs);
        i.dataset.keep = String(t.id);
        if (type === 'checkbox') i.checked = !!value;
        else i.value = value ?? '';
        i.onchange = () => {
            this.area().beginStroke();
            apply(type === 'checkbox' ? i.checked : i.value);
            this.changed();
        };
        return i;
    };
    row(
        'Tag',
        field(
            'text',
            t.tag ?? '',
            v => {
                t.tag = v.trim() || undefined;
            },
            { maxLength: 32, placeholder: t.blueprint ? "the blueprint's" : '' },
        ),
    );
    row(
        'Name',
        field(
            'text',
            t.name ?? '',
            v => {
                t.name = v.trim() || undefined;
            },
            { maxLength: 60, placeholder: t.blueprint ? "the blueprint's" : '' },
        ),
    );
    const at = (axis, v) => {
        const a = this.area(),
            hi = axis === 'x' ? a.sizeX : a.sizeY,
            to = round(Math.min(hi, Math.max(0, Number.isFinite(+v) ? +v : 0)));
        const by = to - (t.outline?.length ? t.outline[0][axis === 'x' ? 0 : 1] : t[axis]);
        // A trigger or encounter stands at its first corner: all of its outline moves with it.
        if (t.outline?.length)
            t.outline = t.outline.map(([x, y]) => [
                round(Math.min(a.sizeX, Math.max(0, x + (axis === 'x' ? by : 0)))),
                round(Math.min(a.sizeY, Math.max(0, y + (axis === 'y' ? by : 0)))),
            ]);
        t[axis] = t.outline?.length ? t.outline[0][axis === 'x' ? 0 : 1] : to;
    };
    // (An original is moved and turned by dragging it; its outline is reshaped by its corners.)
    if (!original)
        row(
            'East (m)',
            field('number', t.outline?.length ? t.outline[0][0] : t.x, v => at('x', v), { step: 0.5 }),
        );
    if (!original)
        row(
            'North (m)',
            field('number', t.outline?.length ? t.outline[0][1] : t.y, v => at('y', v), { step: 0.5 }),
        );
    if (k.bearing && !original)
        row(
            'Facing (°)',
            field(
                'number',
                Math.round(((t.bearing ?? 0) * 180) / Math.PI),
                v => {
                    t.bearing = round((+v * Math.PI) / 180, 3);
                },
                { step: 15 },
            ),
        );
    if (k.shape && !original) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = `${t.outline?.length ?? 0} corners. `;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Redraw the outline';
        b.onclick = () => {
            this.draft = [];
            this.redrawing = t;
            this.ctx.say('Click the corners, then Enter.');
            this.refresh();
        };
        p.appendChild(b);
        box.appendChild(p);
    }
    const kinds = this.meta?.kinds?.find(m => m.kind === t.kind)?.fields ?? [];
    t.fields ??= {};
    // The settings in groups: the plain ones open, then lock, trap, hit points, sound timing, prices and scripts, each
    // folded unless something in it is set.
    const groups = new Map();
    for (const f of kinds) {
        if (f.label in (k.preset?.fields ?? {}) && f.label === 'Type') continue; // the chosen kind sets it
        const name = sectionOf(f);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(f);
    }
    if (!this.lists) this.loadLists();
    for (const name of SECTION_ORDER.filter(n => groups.has(n))) {
        const fs = groups.get(name);
        const details = document.createElement('details');
        details.className = 'fsec';
        const set = fs.filter(f => t.fields[f.label] !== undefined && t.fields[f.label] !== '').length;
        details.open = name === 'Settings' || set > 0 || this.openSections?.has(`${t.id}:${name}`);
        const sum = document.createElement('summary');
        sum.textContent = set ? `${name} (${set} set)` : name;
        details.appendChild(sum);
        details.addEventListener('toggle', () => {
            this.openSections ??= new Set();
            this.openSections[details.open ? 'add' : 'delete'](`${t.id}:${name}`);
        });
        box.appendChild(details);
        const into = (text, input) => {
            const l = document.createElement('label');
            const sp = document.createElement('span');
            sp.textContent = text;
            l.append(sp, input);
            details.appendChild(l);
            return input;
        };
        for (const f of fs) {
            const setv = v => {
                if (v === '' || v === false || v === undefined) delete t.fields[f.label];
                else t.fields[f.label] = v;
            };
            if (f.label === 'TrapType' && this.lists?.traps?.length) {
                const sel = document.createElement('select');
                sel.dataset.keep = String(t.id);
                sel.add(new Option('(none)', ''));
                for (const tr of this.lists.traps) sel.add(new Option(`${tr.name}`, String(tr.row)));
                sel.value = t.fields.TrapType !== undefined ? String(t.fields.TrapType) : '';
                sel.onchange = () => {
                    this.area().beginStroke();
                    setv(sel.value === '' ? undefined : +sel.value);
                    this.changed();
                };
                into(label(f.label), sel);
            } else if (BOOLEAN.has(f.label)) {
                // On, off, or (not for an original, which shows what it has) left to the blueprint: a tick box could only
                // turn a setting on, since unticking dropped the change and the blueprint's value came back.
                const sel = document.createElement('select');
                sel.dataset.keep = String(t.id);
                if (!original && t.blueprint) {
                    // Its text says the blueprint's own value once the engine has said it.
                    const own = new Option(blueprintsChoice(this.blueprintFields(t), f.label), '');
                    own.dataset.bpKey = `${t.kind}:${t.blueprint}`;
                    own.dataset.bpField = f.label;
                    sel.add(own);
                } else if (!original) sel.add(new Option('Not set', ''));
                sel.add(new Option('On', '1'));
                sel.add(new Option('Off', '0'));
                const v = t.fields[f.label];
                sel.value = v === undefined || v === '' ? (original ? '0' : '') : v ? '1' : '0';
                sel.onchange = () => {
                    this.area().beginStroke();
                    setv(sel.value === '' ? undefined : +sel.value);
                    this.changed();
                };
                into(label(f.label), sel);
            } else if ('bifwdh'.includes(f.type))
                into(
                    label(f.label),
                    field('number', t.fields[f.label] ?? '', v => setv(v === '' ? undefined : +v), { step: f.type === 'f' ? 0.5 : 1 }),
                );
            else {
                const input = into(
                    label(f.label),
                    field('text', t.fields[f.label] ?? '', v => setv(v.trim()), { maxLength: f.type === 'r' ? 16 : 200 }),
                );
                // A script: found by name as you type, and (for admins) opened beside it.
                if (f.type === 'r' && /^(Script|On)/.test(f.label)) input.parentElement.appendChild(scriptPicker(input, 'action'));
                // A conversation: found by name, viewed, written or changed beside the box.
                if (f.label === 'Conversation')
                    input.parentElement.appendChild(
                        conversationPicker(
                            input,
                            (t.blueprint || t.tag || '')
                                .toLowerCase()
                                .replace(/[^a-z0-9_]/g, '')
                                .slice(0, 16),
                        ),
                    );
                // A transition's or door's destination: the waypoints and doors this area has to pick from
                // (another area's: type its tag, or pick it below).
                if (f.label === 'LinkedTo') {
                    const list = document.createElement('datalist');
                    list.id = `links${t.id}`;
                    for (const tag of this.linkTargets(t))
                        list.appendChild(Object.assign(document.createElement('option'), { value: tag }));
                    input.setAttribute('list', list.id);
                    input.after(list);
                    list.after(this.destinationPicker(t, input));
                }
            }
        }
    }
    this.contentsSection(box, t, original);
    this.equipmentSection(box, t, original);
    // Local variables.
    const vh = document.createElement('h4');
    vh.textContent = 'Local variables';
    box.appendChild(vh);
    t.vars ??= [];
    renderVars(box, t.vars, { before: () => this.area().beginStroke(), after: () => this.changed(), keep: String(t.id) });
};

/** Draws the properties panel again for what is selected; in someone else's workspace (read-only) with every control off,
 *  however often it is drawn (its lists and the blueprint's values arrive later and draw it again). */
ThingsTool.prototype.renderProps = function () {
    this.drawProps();
    this.lockReadOnly();
};

/** The properties panel: of the selected thing, or of the selected original (an imported area's own object). */
ThingsTool.prototype.drawProps = function () {
    const { $ } = this.ctx,
        box = $('thingProps'),
        t = this.active ? this.selected() : null;
    const g = this.active && this.selectedKey ? this.originals.find(x => x.key === this.selectedKey) : null;
    if (g) {
        box.hidden = false;
        $('thingDelete').hidden = true;
        // Typing in a field must not be torn down by the redraw its own change causes.
        if (box.contains(document.activeElement) && document.activeElement.dataset.keep === String(g.key)) return;
        box.textContent = '';
        const head = document.createElement('h4');
        head.textContent = `Original ${g.kind}: ${g.name || g.tag || g.resref}`;
        box.appendChild(head);
        const info = document.createElement('p');
        info.className = 'note';
        const m = this.area().originals.moved[g.key];
        info.textContent = `Tag ${g.tag || '-'} · ${g.resref || 'no blueprint'} · at ${round(m?.x ?? g.x, 1)}, ${round(m?.y ?? g.y, 1)}${m ? ' (moved)' : ''}.`;
        box.appendChild(info);
        const out = document.createElement('button');
        out.type = 'button';
        out.className = 'danger';
        out.textContent = 'Take it out';
        out.onclick = () => this.takeOut(g.key);
        box.appendChild(out);
        if (m) {
            const back = document.createElement('button');
            back.type = 'button';
            back.textContent = 'Put it back where it was';
            back.onclick = () => {
                const a = this.area();
                a.beginStroke();
                delete a.originals.moved[g.key];
                this.changed();
            };
            box.appendChild(back);
        }
        // Its properties: edited on a copy of what it has, and what differs from the original is what is kept.
        const edited = this.area().originals.edited?.[g.key];
        const k = this.kindOf({ kind: g.kind });
        const t = this.workingCopy(g);
        this.workOrig = { g, t };
        this.propsForm(box, t, k, true);
        if (edited) {
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.textContent = 'Put its properties back';
            reset.onclick = () => {
                const a = this.area();
                a.beginStroke();
                this.workOrig = null;
                delete a.originals.edited[g.key];
                this.changed();
            };
            box.appendChild(reset);
        }
        return;
    }
    box.hidden = !t;
    $('thingDelete').hidden = !t;
    // (nothing selected: no original's form is being worked on either, so a change can't write one into another area)
    if (!t) {
        this.workOrig = null;
        return;
    }
    // Typing in a field must not be torn down by the redraw its own change causes.
    if (box.contains(document.activeElement) && document.activeElement.dataset.keep === String(t.id)) return;
    box.textContent = '';
    this.workOrig = null;
    const k = this.kindOf(t);
    this.propsForm(box, t, k, false);
};

/** What a container, creature or store holds, or what an encounter spawns: the list the blueprint has to start from, changed
 *  here (the change replaces the blueprint's whole list; "Use the blueprint's" takes it back). */
ThingsTool.prototype.contentsSection = function (box, t, original = false) {
    if (!['placeable', 'creature', 'store', 'encounter'].includes(t.kind) || (!t.blueprint && !original)) return;
    const encounter = t.kind === 'encounter',
        stock = t.kind === 'store';
    const field = encounter ? 'creatures' : 'inventory';
    const title = encounter ? 'Creatures it spawns' : stock ? 'Stock' : t.kind === 'creature' ? 'Items it carries' : 'Contents';
    const key = `${t.kind}:${t.blueprint}`;
    this.contentsCache ??= new Map();
    const d = document.createElement('details');
    d.className = 'fsec contents';
    const sum = document.createElement('summary');
    d.appendChild(sum);
    box.appendChild(d);
    d.open = t[field] !== undefined || this.openSections?.has(`${t.id}:contents`);
    d.addEventListener('toggle', () => {
        this.openSections ??= new Set();
        this.openSections[d.open ? 'add' : 'delete'](`${t.id}:contents`);
    });
    // The blueprint's own list, fetched once (an original's is what it holds, sent with it).
    if (!original && !this.contentsCache.has(key)) {
        this.contentsCache.set(key, null);
        api(`/api/blueprint-contents?kind=${encodeURIComponent(t.kind)}&resref=${encodeURIComponent(t.blueprint)}`)
            .then(json)
            .then(v => {
                this.contentsCache.set(key, v);
                if (this.active) this.renderProps();
            })
            .catch(() => this.contentsCache.set(key, { items: [], creatures: [], container: true }));
    }
    const base = original ? t.contents : this.contentsCache.get(key);
    const mine = t[field];
    const list = mine ?? (encounter ? base?.creatures : base?.items) ?? [];
    sum.textContent = `${title} (${base || mine ? list.length : '…'})${mine ? ' · changed' : ''}`;
    if (base && base.container === false) {
        const p = document.createElement('p');
        p.className = 'note';
        p.textContent = "This one isn't a container: it holds nothing.";
        d.appendChild(p);
        return;
    }
    const edit = fn => {
        this.area().beginStroke();
        const next = (mine ?? (encounter ? base?.creatures : base?.items) ?? []).map(i => ({ ...i }));
        fn(next);
        t[field] = next;
        this.changed();
    };
    const rows = document.createElement('div');
    rows.className = 'stock';
    list.forEach((it, i) => {
        const r = document.createElement('div');
        r.className = 'stock-row';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = it.name || it.resref;
        const small = document.createElement('small');
        small.textContent = it.resref;
        name.appendChild(small);
        r.appendChild(name);
        if (stock) {
            const inf = document.createElement('label');
            inf.className = 'check';
            inf.title = 'Never runs out';
            const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: !!it.infinite });
            cb.dataset.keep = String(t.id);
            cb.onchange = () =>
                edit(l => {
                    l[i].infinite = cb.checked;
                });
            inf.append(cb, document.createTextNode('∞'));
            r.appendChild(inf);
        }
        const rm = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Take it out' });
        rm.onclick = () =>
            edit(l => {
                l.splice(i, 1);
            });
        r.appendChild(rm);
        rows.appendChild(r);
    });
    if (!list.length) rows.textContent = base || mine ? 'Nothing.' : 'Loading…';
    d.appendChild(rows);
    // Add: search the item (or creature) blueprints.
    const find = Object.assign(document.createElement('input'), {
        type: 'search',
        placeholder: encounter ? 'Add a creature: type its name' : 'Add an item: type its name',
        autocomplete: 'off',
    });
    find.dataset.keep = String(t.id);
    const found = document.createElement('div');
    found.className = 'bplist';
    let timer = null,
        seq = 0;
    find.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const me = ++seq,
                q = find.value.trim();
            found.textContent = '';
            if (q.length < 2) return;
            const r = await api(`/api/blueprints?kind=${encounter ? 'creature' : 'item'}&q=${encodeURIComponent(q)}&limit=8`)
                .then(json)
                .catch(() => ({}));
            if (me !== seq) return;
            for (const b of r.blueprints ?? []) {
                const e = document.createElement('button');
                e.type = 'button';
                e.className = 'bp';
                e.innerHTML = '<span class="txt"><b></b><small></small></span>';
                e.querySelector('b').textContent = b.name;
                e.querySelector('small').textContent = b.resref;
                e.onclick = () => {
                    find.value = '';
                    found.textContent = '';
                    edit(l => {
                        l.push(encounter ? { resref: b.resref, name: b.name } : { resref: b.resref, name: b.name, infinite: false });
                    });
                };
                found.appendChild(e);
            }
            if (!found.children.length) found.textContent = 'Nothing matches.';
        }, 250);
    };
    d.append(find, found);
    if (mine) {
        const back = Object.assign(document.createElement('button'), {
            type: 'button',
            textContent: original ? 'Put its contents back' : "Use the blueprint's",
        });
        back.onclick = () => {
            this.area().beginStroke();
            delete t[field];
            this.changed();
        };
        d.appendChild(back);
    }
};

/** What a creature wears and wields, slot by slot: the blueprint's own list to start from, changed here (the change replaces the
 *  blueprint's whole list). */
ThingsTool.prototype.equipmentSection = function (box, t, original = false) {
    if (t.kind !== 'creature' || (!t.blueprint && !original)) return;
    const key = `${t.kind}:${t.blueprint}`;
    this.contentsCache ??= new Map();
    const d = document.createElement('details');
    d.className = 'fsec contents';
    const sum = document.createElement('summary');
    d.appendChild(sum);
    box.appendChild(d);
    d.open = t.equipment !== undefined || this.openSections?.has(`${t.id}:equipment`);
    d.addEventListener('toggle', () => {
        this.openSections ??= new Set();
        this.openSections[d.open ? 'add' : 'delete'](`${t.id}:equipment`);
    });
    if (!original && !this.contentsCache.has(key)) {
        this.contentsCache.set(key, null);
        api(`/api/blueprint-contents?kind=${encodeURIComponent(t.kind)}&resref=${encodeURIComponent(t.blueprint)}`)
            .then(json)
            .then(v => {
                this.contentsCache.set(key, v);
                if (this.active) this.renderProps();
            })
            .catch(() => this.contentsCache.set(key, { items: [], equipment: [], container: true }));
    }
    const base = original ? t.contents : this.contentsCache.get(key);
    const mine = t.equipment;
    const list = mine ?? base?.equipment ?? [];
    sum.textContent = `Worn and wielded (${base || mine ? list.length : '…'})${mine ? ' · changed' : ''}`;
    const edit = fn => {
        this.area().beginStroke();
        const next = (mine ?? base?.equipment ?? []).map(i => ({ ...i }));
        fn(next);
        t.equipment = next;
        this.changed();
    };
    const rows = document.createElement('div');
    rows.className = 'stock';
    list.forEach((it, i) => {
        const r = document.createElement('div');
        r.className = 'stock-row';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = `${it.slot}: ${it.name || it.resref}`;
        const small = document.createElement('small');
        small.textContent = it.resref;
        name.appendChild(small);
        const rm = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Take it off' });
        rm.onclick = () =>
            edit(l => {
                l.splice(i, 1);
            });
        r.append(name, rm);
        rows.appendChild(r);
    });
    if (!list.length) rows.textContent = base || mine ? 'Nothing.' : 'Loading…';
    d.appendChild(rows);
    // Add: pick a free slot, then search the item blueprints (an item put in a slot that's taken replaces what was there).
    const slot = document.createElement('select');
    slot.dataset.keep = String(t.id);
    for (const n of SLOTS) slot.add(new Option(n, n));
    const find = Object.assign(document.createElement('input'), {
        type: 'search',
        placeholder: "Put on or in hand: type the item's name",
        autocomplete: 'off',
    });
    find.dataset.keep = String(t.id);
    const found = document.createElement('div');
    found.className = 'bplist';
    let timer = null,
        seq = 0;
    find.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const me = ++seq,
                q = find.value.trim();
            found.textContent = '';
            if (q.length < 2) return;
            const r = await api(`/api/blueprints?kind=item&q=${encodeURIComponent(q)}&limit=8`)
                .then(json)
                .catch(() => ({}));
            if (me !== seq) return;
            for (const b of r.blueprints ?? []) {
                const e = document.createElement('button');
                e.type = 'button';
                e.className = 'bp';
                e.innerHTML = '<span class="txt"><b></b><small></small></span>';
                e.querySelector('b').textContent = b.name;
                e.querySelector('small').textContent = b.resref;
                e.onclick = () => {
                    const at = slot.value;
                    find.value = '';
                    found.textContent = '';
                    edit(l => {
                        const i = l.findIndex(x => x.slot === at);
                        if (i >= 0) l.splice(i, 1);
                        l.push({ slot: at, resref: b.resref, name: b.name });
                    });
                };
                found.appendChild(e);
            }
            if (!found.children.length) found.textContent = 'Nothing matches.';
        }, 250);
    };
    d.append(slot, find, found);
    if (mine) {
        const back = Object.assign(document.createElement('button'), {
            type: 'button',
            textContent: original ? 'Put its gear back' : "Use the blueprint's",
        });
        back.onclick = () => {
            this.area().beginStroke();
            delete t.equipment;
            this.changed();
        };
        d.appendChild(back);
    }
};

/** Where a transition leads, picked from an existing area: a search for the area, then one of its waypoints. */
ThingsTool.prototype.destinationPicker = function (t, _input) {
    // Leads to a waypoint of an existing area: search it, then pick one of its waypoints.
    const d = document.createElement('details');
    d.className = 'dest-picker';
    const sum = document.createElement('summary');
    sum.textContent = 'Pick a waypoint of an existing area';
    d.appendChild(sum);
    const find = Object.assign(document.createElement('input'), {
        type: 'search',
        placeholder: "3 letters of the area's name or tag",
        autocomplete: 'off',
    });
    const areas = document.createElement('div');
    areas.className = 'bplist';
    const wps = document.createElement('select');
    wps.hidden = true;
    const note = document.createElement('p');
    note.className = 'note';
    d.append(find, areas, wps, note);
    let seq = 0,
        timer = null;
    find.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const mine = ++seq,
                q = find.value.trim();
            areas.textContent = '';
            wps.hidden = true;
            if (q.length < 3) return;
            const r = await api(`/api/import-sources?q=${encodeURIComponent(q)}`)
                .then(json)
                .catch(() => ({}));
            if (mine !== seq) return;
            for (const s of (r.sources ?? []).slice(0, 8)) {
                const b = document.createElement('button');
                b.type = 'button';
                const title = document.createElement('b');
                title.textContent = s.name || s.tag || s.area;
                const small = document.createElement('small');
                small.textContent = s.area;
                b.append(title, ' ', small);
                b.onclick = async () => {
                    note.textContent = `Waypoints of ${s.area}…`;
                    const w = await api(`/api/waypoints?area=${encodeURIComponent(s.area)}`)
                        .then(json)
                        .catch(() => ({}));
                    wps.textContent = '';
                    wps.add(new Option(w.waypoints?.length ? 'Pick a waypoint' : 'this area has no waypoints', ''));
                    for (const p of w.waypoints ?? []) wps.add(new Option(`${p.tag}  (${Math.round(p.x)}, ${Math.round(p.y)})`, p.tag));
                    wps.hidden = !w.waypoints?.length;
                    note.textContent = w.error ? `Couldn't read its waypoints: ${w.error}` : '';
                };
                areas.appendChild(b);
            }
            if (!areas.children.length) areas.textContent = r.error || r.note || 'No area matches.';
        }, 300);
    };
    wps.onchange = () => {
        if (!wps.value) return;
        this.area().beginStroke();
        t.fields ??= {};
        t.fields.LinkedTo = wps.value;
        t.fields.LinkedToFlags = 2;
        this.changed();
        this.renderProps();
    };
    return d;
};
