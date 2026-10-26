// The Things tool: creatures, waypoints, triggers (area transitions too), sounds, encounters, stores, items
// on the ground, doors and real placeables, placed on the ground and given the settings a builder needs
// (tag, name, scripts, variables). The area keeps them in `area.things`; landscaper writes them into the
// area's GIT on export. Blueprints (what a creature, door or sound is) are searched on the server.

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
const BOOLEAN = new Set(['HasMapNote', 'MapNoteEnabled', 'Locked', 'Plot', 'Active', 'Reset', 'Looping', 'Positional']);
const FRIENDLY = {
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
        this.results = [];
        this.seq = 0;
        const { $ } = ctx;
        const chips = $('thingKinds');
        for (const k of KINDS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.dataset.kind = k.id;
            b.textContent = k.label;
            b.onclick = () => this.arm(k);
            chips.appendChild(b);
        }
        let timer = null;
        $('thingSearch').oninput = () => { clearTimeout(timer); timer = setTimeout(() => this.search(), 250); };
        $('thingDelete').onclick = () => this.remove(this.selected());
        $('thingFinish').onclick = () => this.finishDraft();
        this.arm(KINDS[0]);
    }

    area() { return this.ctx.area(); }
    selected() { return this.area()?.things.find(t => t.id === this.selectedId) ?? null; }
    kindOf(t) { return KINDS.find(k => k.kind === t.kind && (!k.preset || Object.entries(k.preset.fields).every(([f, v]) => t.fields?.[f] === v))) ?? KINDS.find(k => k.kind === t.kind); }

    async loadMeta() {
        if (this.meta) return this.meta;
        try { this.meta = await (await fetch('/api/things-meta')).json(); } catch { this.meta = { kinds: [], template: {} }; }
        return this.meta;
    }

    show() {
        this.loadMeta();
        this.refresh();
        this.search();
    }

    hide() {
        this.draft = null;
        this.drag = null;
        this.ctx.view.setThings(this.area()?.things ?? [], null);
    }

    arm(k) {
        this.armed = k;
        this.draft = null;
        this.redrawing = null;
        this.blueprint = null;
        const { $ } = this.ctx;
        for (const b of $('thingKinds').children) b.classList.toggle('active', b.dataset.kind === k.id);
        $('thingPick').hidden = !k.blueprint;
        $('thingSearch').value = '';
        $('thingHint').textContent = k.note ?? (k.blueprint ? 'Pick one below, then click the ground to place it (drag to turn it).' : 'Click the ground to place it (drag to turn it).');
        this.search();
        this.refresh();
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
            e.innerHTML = `<b></b><small></small>`;
            e.firstChild.textContent = b.name;
            e.lastChild.textContent = `${b.resref}${b.source === 'game' ? ' · stock' : ''}`;
            e.onclick = () => { this.blueprint = b; for (const x of box.children) x.classList.remove('active'); e.classList.add('active'); this.ctx.say(`${k.label}: ${b.name}. Click the ground to place it.`); };
            box.appendChild(e);
        }
        if (!list.length) box.textContent = q ? 'Nothing matches.' : 'Nothing found.';
    }

    // --- The mouse -------------------------------------------------------------------------

    /** A press on the terrain at `p` ({x, y}); true if it started something that follows the mouse. */
    down(e, p) {
        const area = this.area();
        const hit = this.ctx.view.pickThing(e.clientX, e.clientY);
        if (!this.draft && hit != null) {
            const t = area.things.find(x => x.id === hit);
            this.select(hit);
            area.beginStroke();
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
        this.drag = { t, from: p, turn: true };
        this.changed();
        return true;
    }

    move(p) {
        const d = this.drag;
        if (!d) return;
        if (d.turn) {
            if (Math.hypot(p.x - d.t.x, p.y - d.t.y) > 0.5) d.t.bearing = round(Math.atan2(p.y - d.t.y, p.x - d.t.x), 3);
        } else {
            const dx = p.x - d.from.x, dy = p.y - d.from.y, a = this.area();
            const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
            d.t.x = round(clamp(d.x + dx, a.sizeX));
            d.t.y = round(clamp(d.y + dy, a.sizeY));
            if (d.outline) d.t.outline = d.outline.map(([x, y]) => [round(clamp(x + dx, a.sizeX)), round(clamp(y + dy, a.sizeY))]);
        }
        this.refresh();
    }

    up() {
        if (!this.drag) return;
        this.drag = null;
        this.changed();
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
        if (!pts || pts.length < 3) { this.ctx.say('An outline needs at least three corners.'); this.refresh(); return; }
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
        this.refresh();
        const t = this.selected();
        if (t) this.ctx.say(`${t.name || t.label || t.blueprint || t.tag || t.kind}: drag to move · Q/E to turn · Delete to remove · Esc to deselect`);
    }

    /** Keys: true when handled. */
    key(e) {
        const t = this.selected();
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
        this.ctx.view.setThings(a.things, this.selectedId, this.draft);
        this.renderProps();
        this.ctx.$('thingFinish').hidden = !this.draft;
    }

    // --- The selected thing's properties ---------------------------------------------------------

    renderProps() {
        const { $ } = this.ctx, box = $('thingProps'), t = this.selected();
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
        row('East (m)', field('number', t.x, v => { t.x = round(+v); }, { step: 0.5 }));
        row('North (m)', field('number', t.y, v => { t.y = round(+v); }, { step: 0.5 }));
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
        if (kinds.length) {
            const h = document.createElement('h4');
            h.textContent = 'Scripts and settings';
            box.appendChild(h);
        }
        for (const f of kinds) {
            if (f.label in (k.preset?.fields ?? {}) && f.label === 'Type') continue;   // the chosen kind sets it
            const set = v => { if (v === '' || v === false || v === undefined) delete t.fields[f.label]; else t.fields[f.label] = v; };
            if (BOOLEAN.has(f.label)) row(label(f.label), field('checkbox', !!t.fields[f.label], v => set(v ? 1 : undefined)));
            else if ('bifwd'.includes(f.type)) row(label(f.label), field('number', t.fields[f.label] ?? '', v => set(v === '' ? undefined : +v), { step: f.type === 'f' ? 0.5 : 1 }));
            else row(label(f.label), field('text', t.fields[f.label] ?? '', v => set(v.trim()), { maxLength: f.type === 'r' ? 16 : 200 }));
        }
        // Local variables.
        const vh = document.createElement('h4');
        vh.textContent = 'Local variables';
        box.appendChild(vh);
        t.vars ??= [];
        t.vars.forEach((v, n) => {
            const r = document.createElement('div');
            r.className = 'varrow';
            const name = field('text', v.name, x => { v.name = x.trim(); }, { maxLength: 32, placeholder: 'name' });
            const type = document.createElement('select');
            for (const o of ['int', 'float', 'string']) type.add(new Option(o, o, false, v.type === o));
            type.onchange = () => { this.area().beginStroke(); v.type = type.value; this.changed(); };
            const val = field('text', v.value, x => { v.value = v.type === 'string' ? x : Number(x); });
            const del = document.createElement('button');
            del.type = 'button';
            del.textContent = '×';
            del.onclick = () => { this.area().beginStroke(); t.vars.splice(n, 1); this.changed(); };
            r.append(name, type, val, del);
            box.appendChild(r);
        });
        const add = document.createElement('button');
        add.type = 'button';
        add.textContent = 'Add a variable';
        add.onclick = () => { this.area().beginStroke(); t.vars.push({ name: '', type: 'int', value: 0 }); this.changed(); };
        box.appendChild(add);
    }
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** What goes to the server: the area's things, without the editor's own `label`. */
export function thingsForExport(things) {
    return things.map(({ label: _label, ...t }) => ({
        ...t,
        vars: (t.vars ?? []).filter(v => v.name && v.name.trim()),
        fields: t.fields && Object.keys(t.fields).length ? t.fields : undefined,
    }));
}
