// The Things tool: creatures, waypoints, triggers (area transitions too), sounds, encounters, stores, items
// on the ground, doors and real placeables, placed on the ground and given the settings a builder needs
// (tag, name, scripts, variables). The area keeps them in `area.things`; landscaper writes them into the
// area's GIT on export. Blueprints (what a creature, door or sound is) are searched on the server.

import { renderVars } from './vars.js';
import { THING_COLOURS, css } from './thingcolours.js';
import { creaturePreview, itemPreview, modelPreview } from './preview.js';

const KINDS = [
    { id: 'creature', kind: 'creature', label: 'Creature', blueprint: true, bearing: true },
    { id: 'waypoint', kind: 'waypoint', label: 'Waypoint', bearing: true },
    { id: 'transition', kind: 'trigger', label: 'Transition', shape: true, preset: { fields: { Type: 1 } }, note: 'Draw the area a character steps into to be taken to another area: click its corners, then Enter. Fill in its destination (a waypoint or door tag) below.' },
    { id: 'trigger', kind: 'trigger', label: 'Trigger', shape: true, note: 'Draw its outline: click the corners, then Enter (or click the first corner). Scripts go below.' },
    { id: 'sound', kind: 'sound', label: 'Sound', blueprint: true },
    { id: 'encounter', kind: 'encounter', label: 'Encounter', blueprint: true, shape: true, note: 'Pick an encounter, then draw where it spawns: click the corners, then Enter.' },
    { id: 'store', kind: 'store', label: 'Store', blueprint: true, bearing: true },
    { id: 'item', kind: 'item', label: 'Item', blueprint: true },
    { id: 'door', kind: 'door', label: 'Door', blueprint: true, bearing: true },
    { id: 'placeable', kind: 'placeable', label: 'Placeable', blueprint: true, bearing: true },
];
const BOOLEAN = new Set([
    'HasMapNote', 'MapNoteEnabled', 'Locked', 'Plot', 'Active', 'Reset', 'Looping', 'Positional',
    'Lockable', 'KeyRequired', 'AutoRemoveKey', 'TrapFlag', 'TrapOneShot', 'TrapDetectable', 'TrapDisarmable', 'Static', 'Useable',
    'Random', 'RandomPosition', 'BlackMarket', 'PlayerOnly', 'Identified', 'Cursed', 'Stolen', 'IsImmortal', 'NoPermDeath', 'Interruptable', 'Lootable',
]);
/** Which group of the form a setting is in; the rest are scripts (resrefs) or plain settings. */
const SECTIONS = {
    Lock: ['Lockable', 'Locked', 'KeyRequired', 'KeyName', 'AutoRemoveKey', 'OpenLockDC', 'CloseLockDC'],
    Trap: ['TrapFlag', 'TrapType', 'TrapOneShot', 'TrapDetectable', 'TrapDetectDC', 'TrapDisarmable', 'DisarmDC'],
    'Hit points and saves': ['HP', 'CurrentHP', 'Hardness', 'Fort', 'Ref', 'Will'],
    'Sound timing': ['Random', 'RandomPosition', 'RandomRangeX', 'RandomRangeY', 'Interval', 'IntervalVrtn', 'PitchVariation', 'VolumeVrtn', 'Times'],
    Prices: ['MarkUp', 'MarkDown', 'BlackMarket', 'BM_MarkDown', 'IdentifyPrice', 'MaxBuyPrice'],
};
const SECTION_ORDER = ['Settings', 'Lock', 'Trap', 'Hit points and saves', 'Sound timing', 'Prices', 'Scripts'];
const sectionOf = f => Object.entries(SECTIONS).find(([, labels]) => labels.includes(f.label))?.[0] ?? (f.type === 'r' ? 'Scripts' : 'Settings');
const FRIENDLY = {
    Lockable: 'Can be locked', KeyRequired: 'Needs its key to open', KeyName: 'Key tag', AutoRemoveKey: 'The key is used up', OpenLockDC: 'Pick-lock DC', CloseLockDC: 'Lock DC',
    TrapFlag: 'Is trapped', TrapType: 'Trap', TrapOneShot: 'One shot', TrapDetectable: 'Can be detected', TrapDetectDC: 'Detect DC', TrapDisarmable: 'Can be disarmed', DisarmDC: 'Disarm DC',
    HP: 'Hit points', CurrentHP: 'Hit points now', Hardness: 'Hardness', Fort: 'Fortitude save', Ref: 'Reflex save', Will: 'Will save', Static: 'Static (only scenery)', Useable: 'Can be used',
    Cursor: 'Cursor over it', HighlightHeight: 'Highlight height', DifficultyIndex: 'Difficulty (0 very easy to 4 impossible)', SpawnOption: 'Spawns (0 again and again, 1 once)', PlayerOnly: 'Only when a player sets it off',
    Random: 'Plays at random', RandomPosition: 'At a random spot', RandomRangeX: 'Spread east-west (m)', RandomRangeY: 'Spread north-south (m)', Interval: 'Every (ms)', IntervalVrtn: 'Varying by (ms)',
    PitchVariation: 'Pitch varies by', VolumeVrtn: 'Volume varies by', Times: 'Plays at (1 day, 2 night, 3 always)',
    BlackMarket: 'A black market', BM_MarkDown: 'Black-market mark-down %', IdentifyPrice: 'Identify price (-1 none)', MaxBuyPrice: 'Most it pays (-1 no limit)',
    Charges: 'Charges', StackSize: 'Stack size', Identified: 'Identified', Cursed: 'Cursed', Stolen: 'Stolen', IsImmortal: 'Immortal', NoPermDeath: 'No permanent death (can be raised)', Interruptable: 'Can be interrupted', Lootable: 'Can be looted',
    HasMapNote: 'Shows a map note', MapNote: 'Map note text', MapNoteEnabled: 'Map note enabled', LinkedTo: 'Leads to (tag)', LinkedToFlags: 'Leads to a (1 door, 2 waypoint)',
    TransitionDestin: 'Destination name', Type: 'Type (0 generic, 1 transition, 2 trap)', MaxCreatures: 'Most creatures', RecCreatures: 'Recommended creatures',
    ResetTime: 'Reset time (s)', MarkUp: 'Mark-up %', MarkDown: 'Mark-down %', MaxDistance: 'Hearing range (m)', MinDistance: 'Full volume range (m)',
};
const label = l => FRIENDLY[l] ?? l.replace(/^(Script|On)/, m => m + ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

export class ThingsTool {
    /** `ctx`: { $, area(), view, saveSoon(), say(text) }. */
    constructor(ctx) {
        this.ctx = ctx;
        this.armed = KINDS[0];
        this.blueprint = null;
        this.selectedId = null;
        this.draft = null;
        this.drag = null;
        this.meta = null;
        this.originals = [];
        this.selectedKey = null;
        this.results = [];
        this.seq = 0;
        const { $ } = ctx;
        const chips = $('thingKinds');
        for (const k of KINDS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.kind = k.id;
            b.textContent = k.label;
            b.style.setProperty('--kind', css(THING_COLOURS[k.kind] ?? 0xffffff));
            b.onclick = () => this.arm(k);
            chips.appendChild(b);
        }
        let timer = null;
        $('thingSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(() => this.search(), 250); };
        $('thingDelete').onclick = () => this.remove(this.selected());
        $('thingFinish').onclick = () => this.finishDraft();
        this.arm(KINDS[0], false);
    }

    area() { return this.ctx.area(); }
    selected() { return this.area()?.things.find(t => t.id === this.selectedId) ?? null; }
    kindOf(t) { return KINDS.find(k => k.kind === t.kind && (!k.preset || Object.entries(k.preset.fields).every(([f, v]) => t.fields?.[f] === v))) ?? KINDS.find(k => k.kind === t.kind); }

    async loadMeta() {
        if (this.meta) return this.meta;
        try {
            const r = await fetch('/api/things-meta');
            if (r.ok) this.meta = await r.json();
        } catch { /* try again next time */ }
        return this.meta ?? { kinds: [], template: {} };
    }

    /** The waypoints and doors the other areas of this area's module have. */
    async loadLinks() {
        const a = this.area();
        this.moduleLinks = [];
        if (!a) return;
        let list = [];
        try { const r = await fetch(`/api/links?module=${encodeURIComponent(a.module || a.name)}`); if (r.ok) list = (await r.json()).links ?? []; } catch { /* none */ }
        if (this.area() === a) this.moduleLinks = list;
    }

    /** An imported area's own objects (the server reads them from the kept original). */
    async loadOriginals() {
        const a = this.area();
        this.originals = [];
        this.selectedKey = null;
        if (!a) return;
        const name = a.name;
        let list = [];
        try { const r = await fetch(`/api/originals?name=${encodeURIComponent(name)}`); if (r.ok) list = (await r.json()).originals ?? []; } catch { /* none */ }
        if (this.area() !== a) return;   // another area was opened meanwhile
        this.originals = list;
        this.refresh();
    }

    /** The originals still in the area, where the editor now has them. */
    ghosts() {
        const o = this.area()?.originals;
        if (!o) return [];
        return this.originals.filter(g => !o.removed.includes(g.key)).map(g => {
            const m = o.moved[g.key];
            if (!m) return g;
            const dx = m.x - g.x, dy = m.y - g.y;
            return { ...g, x: m.x, y: m.y, bearing: m.bearing ?? g.bearing, outline: g.outline?.map(([x, y]) => [x + dx, y + dy]) };
        });
    }

    show() {
        this.active = true;
        this.loadMeta();
        this.loadLinks();
        this.refresh();
        this.search();
    }

    hide() {
        this.active = false;
        this.draft = null;
        this.redrawing = null;
        this.drag = null;
        this.selectedId = null;
        this.selectedKey = null;
        this.ctx.view.setThings(this.area()?.things ?? [], null);
        this.ctx.$('thingProps').hidden = true;
        this.ctx.$('thingOrigs').hidden = true;
    }

    arm(k, now = true) {
        this.armed = k;
        this.draft = null;
        this.redrawing = null;
        this.blueprint = null;
        const { $ } = this.ctx;
        for (const b of $('thingKinds').children) b.classList.toggle('active', b.dataset.kind === k.id);
        $('thingPick').hidden = !k.blueprint;
        $('thingSearch').value = '';
        $('thingHint').textContent = k.note ?? (k.blueprint ? 'Pick one below, then click the ground to place it (drag to turn it).' : 'Click the ground to place it (drag to turn it).');
        if (now) { this.search(); this.refresh(); }
    }

    async search() {
        const k = this.armed;
        if (!k.blueprint) { this.ctx.$('thingResults').textContent = ''; return; }
        const mine = ++this.seq, q = this.ctx.$('thingSearch').value.trim();
        let list = [];
        try { list = (await (await fetch(`/api/blueprints?kind=${k.kind}&q=${encodeURIComponent(q)}&limit=60`)).json()).blueprints ?? []; } catch { /* none */ }
        if (mine !== this.seq) return;
        const box = this.ctx.$('thingResults');
        box.textContent = '';
        for (const b of list) {
            const e = document.createElement('button');
            e.type = 'button';
            e.className = 'bp' + (this.blueprint?.resref === b.resref ? ' active' : '');
            e.innerHTML = `<span class="thumb"></span><span class="txt"><b></b><small></small></span>`;
            e.querySelector('b').textContent = b.name;
            e.querySelector('small').textContent = `${b.resref}${b.source === 'game' ? ' · stock' : ''}`;
            // What a creature looks like, drawn when its entry scrolls into view.
            // The module's creatures and items come from the ops API; a placeable's or door's model from the game's data.
            if ((['creature', 'item'].includes(k.kind) && b.source !== 'game') || ['placeable', 'door'].includes(k.kind)) {
                e.classList.add('has-thumb');
                this.previews().observe(e.querySelector('.thumb'), k.kind, b.resref);
            }
            e.onclick = () => { this.blueprint = b; for (const x of box.children) x.classList.remove('active'); e.classList.add('active'); this.ctx.say(`${k.label}: ${b.name}. Click the ground to place it.`); };
            box.appendChild(e);
        }
        if (!list.length) box.textContent = q ? 'Nothing matches.' : 'Nothing found.';
    }

    /** Watches the thumbnail boxes and fills each in once, as it comes into view. */
    previews() {
        if (this._previews) return this._previews;
        const what = new WeakMap();
        const make = (kind, resref) => kind === 'creature' ? creaturePreview(resref) : kind === 'item' ? itemPreview(resref) : modelPreview(this.ctx.view.models, kind, resref);
        const io = new IntersectionObserver(entries => {
            for (const en of entries) {
                if (!en.isIntersecting) continue;
                io.unobserve(en.target);
                const [kind, resref] = what.get(en.target);
                make(kind, resref).then(url => {
                    if (!url || !en.target.isConnected) return;
                    en.target.style.backgroundImage = `url(${url})`;
                    en.target.classList.add('ready');
                });
            }
        }, { root: this.ctx.$('thingResults'), rootMargin: '40px' });
        this._previews = { observe: (el, kind, resref) => { what.set(el, [kind, resref]); io.observe(el); } };
        return this._previews;
    }

    // --- The mouse -------------------------------------------------------------------------

    /** A press on the terrain at `p` ({x, y}); true if it started something that follows the mouse. */
    down(e, p) {
        const area = this.area();
        const hit = this.ctx.view.pickThing(e.clientX, e.clientY);
        if (!this.draft && typeof hit === 'string') {
            // One of an imported area's own objects.
            const g = this.ghosts().find(x => x.key === hit);
            if (!g) return false;
            this.selectedId = null;
            this.selectedKey = hit;
            this.drag = { orig: hit, from: p, x: g.x, y: g.y, bearing: g.bearing };
            this.refresh();
            this.ctx.say(`${g.name || g.tag || g.resref} (original ${g.kind}): drag to move · Q/E to turn · Delete takes it out · Esc to deselect`);
            return true;
        }
        if (!this.draft && hit != null) {
            const t = area.things.find(x => x.id === hit);
            this.select(hit);
            this.drag = { t, from: p, x: t.x, y: t.y, outline: t.outline?.map(q => [...q]) };
            return true;
        }
        const k = this.armed;
        if (this.draft) {
            // Closing: back on the first corner.
            const [fx, fy] = this.draft[0] ?? [Infinity, Infinity];
            if (this.draft.length >= 3 && Math.hypot(p.x - fx, p.y - fy) < 1.5) { this.finishDraft(); return false; }
            this.draft.push([round(p.x), round(p.y)]);
            this.refresh();
            return false;
        }
        if (k.shape) {
            if (k.blueprint && !this.blueprint) { this.ctx.say(`Pick a ${k.label.toLowerCase()} blueprint first.`); return false; }
            this.draft = [[round(p.x), round(p.y)]];
            this.ctx.say('Click the other corners, then press Enter (or click the first corner).');
            this.refresh();
            return false;
        }
        if (k.blueprint && !this.blueprint) { this.ctx.say(`Pick a ${k.label.toLowerCase()} below first.`); return false; }
        area.beginStroke();
        const t = this.make(k, { x: round(p.x), y: round(p.y) });
        area.things.push(t);
        this.select(t.id);
        this.drag = { t, from: p, turn: true, began: true };
        this.changed();
        return true;
    }

    move(p) {
        const d = this.drag;
        if (!d) return;
        // One undo step for a drag, taken when it first moves something (a click that only selects makes none).
        if (!d.began && Math.hypot(p.x - d.from.x, p.y - d.from.y) > 0.05) { this.area().beginStroke(); d.began = true; }
        if (!d.began) return;
        if (d.orig) {
            const a = this.area(), clamp = (v, hi) => Math.min(hi, Math.max(0, v));
            a.originals.moved[d.orig] = { x: round(clamp(d.x + p.x - d.from.x, a.sizeX)), y: round(clamp(d.y + p.y - d.from.y, a.sizeY)), bearing: d.bearing };
            this.refreshSoon();
            return;
        }
        if (d.turn) {
            if (Math.hypot(p.x - d.t.x, p.y - d.t.y) > 0.5) d.t.bearing = round(Math.atan2(p.y - d.t.y, p.x - d.t.x), 3);
        } else {
            const dx = p.x - d.from.x, dy = p.y - d.from.y, a = this.area();
            const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
            d.t.x = round(clamp(d.x + dx, a.sizeX));
            d.t.y = round(clamp(d.y + dy, a.sizeY));
            if (d.outline) d.t.outline = d.outline.map(([x, y]) => [round(clamp(x + dx, a.sizeX)), round(clamp(y + dy, a.sizeY))]);
        }
        this.refreshSoon();
    }

    /** The markers redrawn once a frame, however many mouse events came (the panels wait for the end of the drag). */
    refreshSoon() {
        if (this.pending) return;
        this.pending = requestAnimationFrame(() => {
            this.pending = 0;
            const a = this.area();
            if (a && this.active) this.ctx.view.setThings(a.things, this.selectedId, this.draft, this.ghosts(), this.selectedKey);
        });
    }

    up() {
        const d = this.drag;
        if (!d) return;
        this.drag = null;
        if (d.began) this.changed(); else this.refresh();
    }

    // --- Things ----------------------------------------------------------------------------

    make(k, at) {
        const a = this.area(), id = a.nextThingId++;
        const t = { id, kind: k.kind, blueprint: this.blueprint?.resref ?? '', x: at.x, y: at.y, bearing: 0, ...(at.outline ? { outline: at.outline } : {}) };
        if (k.preset) t.fields = { ...k.preset.fields };
        if (!k.blueprint) {
            // A plain one has no blueprint to name it: a tag from the area and its number.
            const prefix = { waypoint: 'WP', trigger: 'TRG', transition: 'TRG' }[k.id] ?? 'T';
            t.tag = `${prefix}_${a.name}_${id}`.slice(0, 32);
        }
        if (this.blueprint?.name && k.blueprint) t.label = this.blueprint.name;
        return t;
    }

    finishDraft() {
        const a = this.area(), pts = this.draft;
        this.draft = null;
        if (!pts || pts.length < 3) { this.redrawing = null; this.ctx.say('An outline needs at least three corners.'); this.refresh(); return; }
        a.beginStroke();
        if (this.redrawing) {
            Object.assign(this.redrawing, { outline: pts, x: pts[0][0], y: pts[0][1] });
            this.redrawing = null;
        } else {
            const t = this.make(this.armed, { x: pts[0][0], y: pts[0][1], outline: pts });
            a.things.push(t);
            this.select(t.id);
        }
        this.changed();
    }

    cancelDraft() {
        if (!this.draft) return false;
        this.draft = null;
        this.redrawing = null;
        this.ctx.say('');
        this.refresh();
        return true;
    }

    remove(t) {
        if (!t) return;
        const a = this.area();
        a.beginStroke();
        a.things = a.things.filter(x => x !== t);
        this.selectedId = null;
        this.changed();
    }

    select(id) {
        this.selectedId = id;
        this.selectedKey = null;
        this.refresh();
        const t = this.selected();
        if (t) this.ctx.say(`${t.name || t.label || t.blueprint || t.tag || t.kind}: drag to move · Q/E to turn · Delete to remove · Esc to deselect`);
    }

    /** Keys: true when handled. */
    key(e) {
        const t = this.selected();
        if (this.selectedKey && !this.draft) {
            const g = this.ghosts().find(x => x.key === this.selectedKey);
            if (e.key === 'Escape') { this.selectedKey = null; this.refresh(); return true; }
            if (g && (e.key === 'Delete' || e.key === 'Backspace')) { this.takeOut(g.key); return true; }
            const turn = { q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
            if (g && turn && !e.ctrlKey && !e.metaKey) {
                const a = this.area();
                a.beginStroke();
                a.originals.moved[g.key] = { x: g.x, y: g.y, bearing: round(g.bearing + turn, 3) };
                this.changed();
                return true;
            }
        }
        if (e.key === 'Enter' && this.draft) { this.finishDraft(); return true; }
        if (e.key === 'Escape') {
            if (this.cancelDraft()) return true;
            if (t) { this.selectedId = null; this.refresh(); return true; }
            return false;
        }
        if (!t) return false;
        if (e.key === 'Delete' || e.key === 'Backspace') { this.remove(t); return true; }
        const turn = { q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
        if (turn && !e.ctrlKey && !e.metaKey) { this.area().beginStroke(); t.bearing = round((t.bearing ?? 0) + turn, 3); this.changed(); return true; }
        return false;
    }

    takeOut(key) {
        const a = this.area();
        a.beginStroke();
        if (!a.originals.removed.includes(key)) a.originals.removed.push(key);
        delete a.originals.moved[key];
        this.selectedKey = null;
        this.changed();
    }

    putBack(key) {
        const a = this.area();
        a.beginStroke();
        a.originals.removed = a.originals.removed.filter(k => k !== key);
        this.changed();
    }

    changed() {
        this.refresh();
        this.ctx.saveSoon();
    }

    /** After undo, redo or opening an area. */
    refreshAll() {
        if (this.selectedId != null && !this.selected()) this.selectedId = null;
        this.refresh();
    }

    refresh() {
        const a = this.area();
        if (!a) return;
        // (Out of the Things tool, only the markers show: no grey originals, no selection, no panel.)
        if (!this.active) { this.ctx.view.setThings(a.things, null); return; }
        this.ctx.view.setThings(a.things, this.selectedId, this.draft, this.ghosts(), this.selectedKey);
        this.renderProps();
        this.renderOriginals();
        this.ctx.$('thingFinish').hidden = !this.draft;
        // A read-only session (someone else's workspace) can look but not change.
        if (this.ctx.readOnly?.()) for (const el of document.querySelectorAll('#thingProps input, #thingProps select, #thingProps button, #thingOrigs button, #thingFinish, #thingDelete')) el.disabled = true;
    }

    // --- The selected thing's properties ---------------------------------------------------------

    /** Tags of the waypoints and doors in this area (the editor's and the original's), for a link. */
    linkTargets(self) {
        const a = this.area(), tags = new Set(this.moduleLinks?.filter(l => l.area !== a.name).map(l => l.tag));
        for (const t of a.things) if (t !== self && ['waypoint', 'door'].includes(t.kind) && t.tag) tags.add(t.tag);
        for (const g of this.ghosts()) if (['waypoint', 'door'].includes(g.kind) && g.tag) tags.add(g.tag);
        return [...tags].sort();
    }

    renderOriginals() {
        const { $ } = this.ctx, box = $('thingOrigs'), a = this.area();
        if (!this.active) { box.hidden = true; return; }
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
    }

    /** The game's lists a setting is picked from (the traps), once. */
    async loadLists() {
        this.lists = {};
        try { this.lists = await (await fetch('/api/area-lists')).json(); } catch { /* the setting is a plain number then */ }
        if (this.active) this.renderProps();
    }

    renderProps() {
        const { $ } = this.ctx, box = $('thingProps'), t = this.active ? this.selected() : null;
        const g = this.active && this.selectedKey ? this.originals.find(x => x.key === this.selectedKey) : null;
        if (g) {
            box.hidden = false;
            $('thingDelete').hidden = true;
            box.textContent = '';
            const head = document.createElement('h4');
            head.textContent = `Original ${g.kind}: ${g.name || g.tag || g.resref}`;
            box.appendChild(head);
            const info = document.createElement('p');
            info.className = 'note';
            const m = this.area().originals.moved[g.key];
            info.textContent = `Tag ${g.tag || '-'} · ${g.resref || 'no blueprint'} · at ${round(m?.x ?? g.x, 1)}, ${round(m?.y ?? g.y, 1)}${m ? ' (moved)' : ''}. Its scripts and settings stay as the toolset has them.`;
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
                back.onclick = () => { const a = this.area(); a.beginStroke(); delete a.originals.moved[g.key]; this.changed(); };
                box.appendChild(back);
            }
            return;
        }
        box.hidden = !t;
        $('thingDelete').hidden = !t;
        if (!t) return;
        // Typing in a field must not be torn down by the redraw its own change causes.
        if (box.contains(document.activeElement) && document.activeElement.dataset.keep === String(t.id)) return;
        box.textContent = '';
        const k = this.kindOf(t);
        const head = document.createElement('h4');
        head.textContent = `${k.label}${t.blueprint ? `: ${t.label ?? t.blueprint}` : ''}`;
        box.appendChild(head);
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
            if (type === 'checkbox') i.checked = !!value; else i.value = value ?? '';
            i.onchange = () => { this.area().beginStroke(); apply(type === 'checkbox' ? i.checked : i.value); this.changed(); };
            return i;
        };
        row('Tag', field('text', t.tag ?? '', v => { t.tag = v.trim() || undefined; }, { maxLength: 32, placeholder: t.blueprint ? 'the blueprint\'s' : '' }));
        row('Name', field('text', t.name ?? '', v => { t.name = v.trim() || undefined; }, { maxLength: 60, placeholder: t.blueprint ? 'the blueprint\'s' : '' }));
        const at = (axis, v) => {
            const a = this.area(), hi = axis === 'x' ? a.sizeX : a.sizeY, to = round(Math.min(hi, Math.max(0, Number.isFinite(+v) ? +v : 0)));
            const by = to - (t.outline?.length ? t.outline[0][axis === 'x' ? 0 : 1] : t[axis]);
            // A trigger or encounter stands at its first corner: all of its outline moves with it.
            if (t.outline?.length) t.outline = t.outline.map(([x, y]) => [round(Math.min(a.sizeX, Math.max(0, x + (axis === 'x' ? by : 0)))), round(Math.min(a.sizeY, Math.max(0, y + (axis === 'y' ? by : 0))))]);
            t[axis] = t.outline?.length ? t.outline[0][axis === 'x' ? 0 : 1] : to;
        };
        row('East (m)', field('number', t.outline?.length ? t.outline[0][0] : t.x, v => at('x', v), { step: 0.5 }));
        row('North (m)', field('number', t.outline?.length ? t.outline[0][1] : t.y, v => at('y', v), { step: 0.5 }));
        if (k.bearing) row('Facing (°)', field('number', Math.round((t.bearing ?? 0) * 180 / Math.PI), v => { t.bearing = round(+v * Math.PI / 180, 3); }, { step: 15 }));
        if (k.shape) {
            const p = document.createElement('p');
            p.className = 'note';
            p.textContent = `${t.outline?.length ?? 0} corners. `;
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = 'Redraw the outline';
            b.onclick = () => { this.draft = []; this.redrawing = t; this.ctx.say('Click the corners, then Enter.'); this.refresh(); };
            p.appendChild(b);
            box.appendChild(p);
        }
        const kinds = this.meta?.kinds?.find(m => m.kind === t.kind)?.fields ?? [];
        t.fields ??= {};
        // The settings in groups: the plain ones open, then lock, trap, hit points, sound timing, prices and scripts, each
        // folded unless something in it is set.
        const groups = new Map();
        for (const f of kinds) {
            if (f.label in (k.preset?.fields ?? {}) && f.label === 'Type') continue;   // the chosen kind sets it
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
            details.addEventListener('toggle', () => { (this.openSections ??= new Set())[details.open ? 'add' : 'delete'](`${t.id}:${name}`); });
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
                const setv = v => { if (v === '' || v === false || v === undefined) delete t.fields[f.label]; else t.fields[f.label] = v; };
                if (f.label === 'TrapType' && this.lists?.traps?.length) {
                    const sel = document.createElement('select');
                    sel.dataset.keep = String(t.id);
                    sel.add(new Option('(none)', ''));
                    for (const tr of this.lists.traps) sel.add(new Option(`${tr.name}`, String(tr.row)));
                    sel.value = t.fields.TrapType !== undefined ? String(t.fields.TrapType) : '';
                    sel.onchange = () => { this.area().beginStroke(); setv(sel.value === '' ? undefined : +sel.value); this.changed(); };
                    into(label(f.label), sel);
                } else if (BOOLEAN.has(f.label)) into(label(f.label), field('checkbox', !!t.fields[f.label], v => setv(v ? 1 : undefined)));
                else if ('bifwdh'.includes(f.type)) into(label(f.label), field('number', t.fields[f.label] ?? '', v => setv(v === '' ? undefined : +v), { step: f.type === 'f' ? 0.5 : 1 }));
                else {
                    const input = into(label(f.label), field('text', t.fields[f.label] ?? '', v => setv(v.trim()), { maxLength: f.type === 'r' ? 16 : 200 }));
                    // A transition's or door's destination: the waypoints and doors this area has to pick from
                    // (another area's: type its tag, or pick it below).
                    if (f.label === 'LinkedTo') {
                        const list = document.createElement('datalist');
                        list.id = `links${t.id}`;
                        for (const tag of this.linkTargets(t)) list.appendChild(Object.assign(document.createElement('option'), { value: tag }));
                        input.setAttribute('list', list.id);
                        input.after(list);
                        list.after(this.destinationPicker(t, input));
                    }
                }
            }
        }
        // Local variables.
        const vh = document.createElement('h4');
        vh.textContent = 'Local variables';
        box.appendChild(vh);
        t.vars ??= [];
        renderVars(box, t.vars, { before: () => this.area().beginStroke(), after: () => this.changed(), keep: String(t.id) });
    }
}

/** Reads a response body as JSON, or {} when it isn't. */
const json = r => r.json().catch(() => ({}));

ThingsTool.prototype.destinationPicker = function (t, input) {
    // Leads to a waypoint of an existing area: search it, then pick one of its waypoints.
    const d = document.createElement('details');
    d.className = 'dest-picker';
    const sum = document.createElement('summary');
    sum.textContent = 'Pick a waypoint of an existing area';
    d.appendChild(sum);
    const find = Object.assign(document.createElement('input'), { type: 'search', placeholder: '3 letters of the area\'s name or tag', autocomplete: 'off' });
    const areas = document.createElement('div');
    areas.className = 'bplist';
    const wps = document.createElement('select');
    wps.hidden = true;
    const note = document.createElement('p');
    note.className = 'note';
    d.append(find, areas, wps, note);
    let seq = 0, timer = null;
    find.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            const mine = ++seq, q = find.value.trim();
            areas.textContent = '';
            wps.hidden = true;
            if (q.length < 3) return;
            const r = await fetch(`/api/import-sources?q=${encodeURIComponent(q)}`).then(json).catch(() => ({}));
            if (mine !== seq) return;
            for (const s of (r.sources ?? []).slice(0, 8)) {
                const b = document.createElement('button');
                b.type = 'button';
                b.innerHTML = `<b>${s.tag || s.area}</b> <small>${s.area}</small>`;
                b.onclick = async () => {
                    note.textContent = `Waypoints of ${s.area}…`;
                    const w = await fetch(`/api/dev-test/waypoints?area=${encodeURIComponent(s.area)}`).then(json).catch(() => ({}));
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

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** What goes to the server: the area's things, without the editor's own `label`. */
export function thingsForExport(things) {
    return things.map(({ label: _label, ...t }) => ({
        ...t,
        vars: (t.vars ?? []).filter(v => v.name && v.name.trim()),
        fields: t.fields && Object.keys(t.fields).length ? t.fields : undefined,
    }));
}
