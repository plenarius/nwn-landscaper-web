// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The Things tool: creatures, waypoints, triggers (area transitions too), sounds, encounters, stores, items
// on the ground, doors and real placeables, placed on the ground and given the settings a builder needs
// (tag, name, scripts, variables). The area keeps them in `area.things`; landscaper writes them into the
// area's GIT on export. Blueprints (what a creature, door or sound is) are searched on the server.

import { THING_COLOURS, css } from './thingcolours.js';
import { creaturePreview, itemPreview, modelPreview } from './preview.js';
import { api, failure, json } from './api.js';
import { store } from './dom.js';

const KINDS = [
    { id: 'creature', kind: 'creature', label: 'Creature', blueprint: true, bearing: true },
    { id: 'waypoint', kind: 'waypoint', label: 'Waypoint', bearing: true },
    {
        id: 'transition',
        kind: 'trigger',
        label: 'Transition',
        shape: true,
        preset: { fields: { Type: 1 } },
        note: 'Draw the area a character steps into to be taken to another area: click its corners, then Enter. Fill in its destination (a waypoint or door tag) below.',
    },
    {
        id: 'trigger',
        kind: 'trigger',
        label: 'Trigger',
        shape: true,
        note: 'Draw its outline: click the corners, then Enter (or click the first corner). Scripts go below.',
    },
    { id: 'sound', kind: 'sound', label: 'Sound', blueprint: true },
    {
        id: 'encounter',
        kind: 'encounter',
        label: 'Encounter',
        blueprint: true,
        shape: true,
        note: 'Pick an encounter, then draw where it spawns: click the corners, then Enter.',
    },
    { id: 'store', kind: 'store', label: 'Store', blueprint: true, bearing: true },
    { id: 'item', kind: 'item', label: 'Item', blueprint: true },
    { id: 'door', kind: 'door', label: 'Door', blueprint: true, bearing: true },
    {
        id: 'placeable',
        kind: 'placeable',
        label: 'Placeable',
        blueprint: true,
        bearing: true,
        note: 'Pick a blueprint below (its settings come with it), then click the ground to place it. For scenery from a model, the Place tool is quicker.',
    },
];
/** Which kinds of thing show on the map out of the Things tool (the Show menu), kept in this browser. In the tool, all do. */
const SHOW_KEY = 'landscaper.showThings';
const SHOW_DEFAULT = ['creature', 'waypoint', 'trigger', 'sound', 'encounter', 'store', 'item', 'door'];

/**
 * The Things tool: its panel, its markers on the map, and the forms of the thing selected.
 *
 * Two files add methods to this class when app.js imports them, so that neither this file nor they grow too long:
 * - thingprops.js, the properties panel: `linkTargets`, `renderOriginals`, `loadLists`, `propsForm`, `renderProps`,
 *   `contentsSection`, `equipmentSection` and `destinationPicker`;
 * - newbp.js, the builder's own blueprints (many methods, and only that feature uses them): `bpFinder`, `bpCreateForm`, `bpEdit`,
 *   `bpConversationRow`, `bpProperties`, `bpGear`, `bpAppearance` and `bpDoorLook`.
 * Every other method is here.
 */
export class ThingsTool {
    /** `ctx`: { $, area(), view, readOnly(), saveSoon(), say(text) }. */
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
        try {
            this.shown = new Set(JSON.parse(store.get(SHOW_KEY)) ?? SHOW_DEFAULT);
        } catch {
            this.shown = new Set(SHOW_DEFAULT);
        }
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
        $('thingSearch').oninput = () => {
            clearTimeout(timer);
            timer = setTimeout(() => this.search(), 250);
        };
        $('thingDelete').onclick = () => this.remove(this.selected());
        $('thingFinish').onclick = () => this.finishDraft();
        $('inspectorClose').onclick = () => this.deselect();
        this.arm(KINDS[0], false);
    }

    area() {
        return this.ctx.area();
    }
    selected() {
        return this.area()?.things.find(t => t.id === this.selectedId) ?? null;
    }
    kindOf(t) {
        return (
            KINDS.find(k => k.kind === t.kind && (!k.preset || Object.entries(k.preset.fields).every(([f, v]) => t.fields?.[f] === v))) ??
            KINDS.find(k => k.kind === t.kind)
        );
    }

    async loadMeta() {
        if (this.meta) return this.meta;
        try {
            const r = await api('/api/things-meta');
            if (r.ok) this.meta = await r.json();
        } catch {
            /* try again next time */
        }
        return this.meta ?? { kinds: [], template: {} };
    }

    /** The waypoints and doors the other areas of this area's module have. */
    async loadLinks() {
        const a = this.area();
        this.moduleLinks = [];
        if (!a) return;
        let list = [];
        try {
            const r = await api(`/api/links?module=${encodeURIComponent(a.module || a.name)}`);
            if (r.ok) list = (await r.json()).links ?? [];
        } catch {
            /* none */
        }
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
        try {
            const r = await api(`/api/originals?name=${encodeURIComponent(name)}`);
            if (r.ok) list = (await r.json()).originals ?? [];
        } catch {
            /* none */
        }
        if (this.area() !== a) return; // another area was opened meanwhile
        this.originals = list;
        this.refresh();
    }

    /** The originals still in the area, where the editor now has them. */
    ghosts() {
        const o = this.area()?.originals;
        if (!o) return [];
        return this.originals
            .filter(g => !o.removed.includes(g.key))
            .map(g => {
                const m = o.moved[g.key];
                if (!m) return g;
                const dx = m.x - g.x,
                    dy = m.y - g.y;
                return {
                    ...g,
                    x: m.x,
                    y: m.y,
                    bearing: m.bearing ?? g.bearing,
                    outline: m.outline ?? g.outline?.map(([x, y]) => [x + dx, y + dy]),
                };
            });
    }

    /** Ticks or unticks a kind of thing in the Show menu. */
    setShown(kind, on) {
        this.shown[on ? 'add' : 'delete'](kind);
        store.set(SHOW_KEY, JSON.stringify([...this.shown]));
        this.refresh();
    }

    show() {
        this.active = true;
        this.loadMeta();
        this.loadLinks();
        this.refresh();
        this.search();
    }

    /** The properties panel on the right is there while something is selected in the tool. */
    syncInspector() {
        const el = this.ctx.$('inspector');
        if (el) el.hidden = !this.active || this.ctx.$('thingProps').hidden;
    }

    /** Closes the inspector: nothing selected. */
    deselect() {
        this.selectedId = null;
        this.selectedKey = null;
        this.workOrig = null;
        this.refresh();
    }

    hide() {
        this.active = false;
        this.workOrig = null;
        this.draft = null;
        this.redrawing = null;
        this.drag = null;
        this.selectedId = null;
        this.selectedKey = null;
        this.refresh();
        this.ctx.$('thingProps').hidden = true;
        this.ctx.$('thingOrigs').hidden = true;
        this.syncInspector();
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
        $('thingHint').textContent =
            k.note ??
            (k.blueprint
                ? 'Pick one below, then click the ground to place it (drag to turn it).'
                : 'Click the ground to place it (drag to turn it).');
        if (now) {
            this.search();
            this.refresh();
        }
    }

    async search() {
        const k = this.armed;
        if (!k.blueprint) {
            this.ctx.$('thingResults').textContent = '';
            return;
        }
        const mine = ++this.seq,
            q = this.ctx.$('thingSearch').value.trim();
        const res = await api(`/api/blueprints?kind=${k.kind}&q=${encodeURIComponent(q)}&limit=60`);
        const list = res.ok ? ((await json(res)).blueprints ?? []) : [];
        const why = res.ok ? '' : await failure(res);
        if (mine !== this.seq) return;
        const box = this.ctx.$('thingResults');
        box.textContent = '';
        for (const b of list) {
            const e = document.createElement('button');
            e.type = 'button';
            e.className = `bp${this.blueprint?.resref === b.resref ? ' active' : ''}`;
            e.innerHTML = `<span class="thumb"></span><span class="txt"><b></b><small></small></span>`;
            e.querySelector('b').textContent = b.name;
            e.querySelector('small').textContent = `${b.resref}${b.source === 'game' ? ' · stock' : b.source === 'mine' ? ' · mine' : ''}`;
            // What a creature looks like, drawn when its entry scrolls into view.
            // The module's creatures and items come from the review service; a placeable's or door's model from the game's data.
            if ((['creature', 'item'].includes(k.kind) && b.source === 'module') || ['placeable', 'door'].includes(k.kind)) {
                e.classList.add('has-thumb');
                this.previews().observe(e.querySelector('.thumb'), k.kind, b.resref);
            }
            e.onclick = () => {
                this.blueprint = b;
                for (const x of box.children) x.classList.remove('active');
                e.classList.add('active');
                this.ctx.say(`${k.label}: ${b.name}. Click the ground to place it.`);
                this.bpFinder();
            };
            box.appendChild(e);
        }
        if (!list.length) box.textContent = why || (q ? 'Nothing matches.' : 'Nothing found.');
        this.bpFinder();
    }

    /** Watches the thumbnail boxes and fills each in once, as it comes into view. */
    previews() {
        if (this._previews) return this._previews;
        const what = new WeakMap();
        const make = (kind, resref) =>
            kind === 'creature'
                ? creaturePreview(resref)
                : kind === 'item'
                  ? itemPreview(resref)
                  : modelPreview(this.ctx.view.models, kind, resref);
        const io = new IntersectionObserver(
            entries => {
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
            },
            { root: this.ctx.$('thingResults'), rootMargin: '40px' },
        );
        this._previews = {
            observe: (el, kind, resref) => {
                what.set(el, [kind, resref]);
                io.observe(el);
            },
        };
        return this._previews;
    }

    // --- The mouse ---------------------------------------------------------------------------------------------------

    /** A press on the terrain at `p` ({x, y}); true if it started something that follows the mouse. */
    down(e, p) {
        const area = this.area();
        // The corners of the selected outline: drag one, Shift+click takes it out; Alt+click on an edge adds one.
        if (!this.draft) {
            const c = this.outlineOf();
            if (c) {
                const corner = this.ctx.view.pickCorner(e.clientX, e.clientY);
                if (corner && String(corner.id) === String(c.id)) {
                    if (e.shiftKey) {
                        this.removeCorner(c, corner.index);
                        return false;
                    }
                    this.drag = { corner: corner.index, c, from: p };
                    return true;
                }
                if (e.altKey && this.addCorner(c, p)) return false;
            }
        }
        const hit = this.ctx.view.pickThing(e.clientX, e.clientY);
        if (!this.draft && typeof hit === 'string') {
            // One of an imported area's own objects.
            const g = this.ghosts().find(x => x.key === hit);
            if (!g) return false;
            this.selectedId = null;
            this.selectedKey = hit;
            this.drag = { orig: hit, from: p, x: g.x, y: g.y, bearing: g.bearing };
            this.refresh();
            this.ctx.say(
                `${g.name || g.tag || g.resref} (original ${g.kind}): drag to move · Q/E to turn · Delete takes it out${g.outline?.length ? ' · drag a corner, Alt+click an edge to add one, Shift+click a corner to remove it' : ''} · Esc to deselect`,
            );
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
            if (this.draft.length >= 3 && Math.hypot(p.x - fx, p.y - fy) < 1.5) {
                this.finishDraft();
                return false;
            }
            this.draft.push([round(p.x), round(p.y)]);
            this.refresh();
            return false;
        }
        if (k.shape) {
            if (k.blueprint && !this.blueprint) {
                this.ctx.say(`Pick a ${k.label.toLowerCase()} blueprint first.`);
                return false;
            }
            this.draft = [[round(p.x), round(p.y)]];
            this.ctx.say('Click the other corners, then press Enter (or click the first corner).');
            this.refresh();
            return false;
        }
        if (k.blueprint && !this.blueprint) {
            this.ctx.say(`Pick a ${k.label.toLowerCase()} below first.`);
            return false;
        }
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
        if (!d.began && Math.hypot(p.x - d.from.x, p.y - d.from.y) > 0.05) {
            this.area().beginStroke();
            d.began = true;
        }
        if (!d.began) return;
        if (d.corner !== undefined) {
            const a = this.area(),
                clamp = (v, hi) => Math.min(hi, Math.max(0, v));
            this.setCorner(d.c, d.corner, [round(clamp(p.x, a.sizeX)), round(clamp(p.y, a.sizeY))]);
            this.refreshSoon();
            return;
        }
        if (d.orig) {
            const a = this.area(),
                clamp = (v, hi) => Math.min(hi, Math.max(0, v));
            a.originals.moved[d.orig] = {
                x: round(clamp(d.x + p.x - d.from.x, a.sizeX)),
                y: round(clamp(d.y + p.y - d.from.y, a.sizeY)),
                bearing: d.bearing,
            };
            this.refreshSoon();
            return;
        }
        if (d.turn) {
            if (Math.hypot(p.x - d.t.x, p.y - d.t.y) > 0.5) d.t.bearing = round(Math.atan2(p.y - d.t.y, p.x - d.t.x), 3);
        } else {
            const dx = p.x - d.from.x,
                dy = p.y - d.from.y,
                a = this.area();
            const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
            d.t.x = round(clamp(d.x + dx, a.sizeX));
            d.t.y = round(clamp(d.y + dy, a.sizeY));
            if (d.outline) d.t.outline = d.outline.map(([x, y]) => [round(clamp(x + dx, a.sizeX)), round(clamp(y + dy, a.sizeY))]);
        }
        this.refreshSoon();
    }

    /** The outline being edited: the selected thing's (`{ id, thing }`), or the selected original's (`{ id: key, ghost }`). */
    outlineOf() {
        const t = this.selected();
        if (t?.outline?.length >= 3) return { id: t.id, thing: t };
        const g = this.selectedKey && this.ghosts().find(x => x.key === this.selectedKey);
        return g?.outline?.length >= 3 ? { id: g.key, ghost: g } : null;
    }

    /** Writes `outline` back: onto the thing (its first corner is where it stands), or as the original's new shape. */
    putOutline(c, outline) {
        if (c.thing) {
            c.thing.outline = outline;
            [c.thing.x, c.thing.y] = outline[0];
        } else {
            const o = this.area().originals,
                g = c.ghost,
                m = o.moved[g.key];
            o.moved[g.key] = { x: m?.x ?? g.x, y: m?.y ?? g.y, bearing: m?.bearing ?? g.bearing, outline };
        }
    }

    setCorner(c, index, point) {
        const outline = (c.thing ?? c.ghost).outline.map(q => [...q]);
        outline[index] = point;
        this.putOutline(c, outline);
        // (the original's next move reads the new shape)
        if (c.ghost) c.ghost = this.ghosts().find(x => x.key === c.ghost.key) ?? c.ghost;
    }

    removeCorner(c, index) {
        const outline = (c.thing ?? c.ghost).outline;
        if (outline.length <= 3) {
            this.ctx.say('An outline needs at least three corners.');
            return;
        }
        this.area().beginStroke();
        this.putOutline(
            c,
            outline.filter((_, i) => i !== index).map(q => [...q]),
        );
        this.changed();
    }

    /** Alt+click: a new corner on the edge nearest to `p` (within 2 m); false if no edge is near. */
    addCorner(c, p) {
        const o = (c.thing ?? c.ghost).outline;
        let best = null;
        for (let i = 0; i < o.length; i++) {
            const [ax, ay] = o[i],
                [bx, by] = o[(i + 1) % o.length];
            const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
            const t = Math.min(1, Math.max(0, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / len2));
            const q = [ax + (bx - ax) * t, ay + (by - ay) * t],
                d = Math.hypot(p.x - q[0], p.y - q[1]);
            if (d < 2 && (!best || d < best.d)) best = { i, q, d };
        }
        if (!best) return false;
        this.area().beginStroke();
        const next = o.map(q => [...q]);
        next.splice(best.i + 1, 0, [round(best.q[0]), round(best.q[1])]);
        this.putOutline(c, next);
        this.changed();
        return true;
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
        if (d.began) this.changed();
        else this.refresh();
    }

    // --- Things ------------------------------------------------------------------------------------------------------

    /** Selects what `hit` names (a thing's id, or an original's key) for editing: its properties open in the panel. */
    pick(hit) {
        if (typeof hit === 'string') {
            this.selectedId = null;
            this.selectedKey = hit;
            this.workOrig = null;
            this.refresh();
            const g = this.ghosts().find(x => x.key === hit);
            if (g) this.ctx.say(`${g.name || g.tag || g.resref} (original ${g.kind}): edit its properties on the left`);
        } else {
            this.select(hit);
        }
    }

    /** What a right-click on `hit` can do: [{ label, run }]. */
    menuFor(hit) {
        if (typeof hit === 'string') {
            const g = this.ghosts().find(x => x.key === hit);
            if (!g) return [];
            return [
                { label: 'Edit properties', run: () => this.pick(hit) },
                { label: 'Take it out', run: () => this.takeOut(hit) },
            ];
        }
        const t = this.area()?.things.find(x => x.id === hit);
        if (!t) return [];
        return [
            { label: 'Edit properties', run: () => this.pick(hit) },
            { label: 'Delete', run: () => this.remove(t) },
        ];
    }

    make(k, at) {
        const a = this.area(),
            id = a.nextThingId++;
        const t = {
            id,
            kind: k.kind,
            blueprint: this.blueprint?.resref ?? '',
            x: at.x,
            y: at.y,
            bearing: 0,
            ...(at.outline ? { outline: at.outline } : {}),
        };
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
        const a = this.area(),
            pts = this.draft;
        this.draft = null;
        if (!pts || pts.length < 3) {
            this.redrawing = null;
            this.ctx.say('An outline needs at least three corners.');
            this.refresh();
            return;
        }
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
        this.workOrig = null;
        this.refresh();
        const t = this.selected();
        if (t)
            this.ctx.say(
                `${t.name || t.label || t.blueprint || t.tag || t.kind}: drag to move · Q/E to turn · Delete to remove${t.outline?.length ? ' · drag a corner, Alt+click an edge to add one, Shift+click a corner to remove it' : ''} · Esc to deselect`,
            );
    }

    /** Keys: true when handled. */
    key(e) {
        const t = this.selected();
        if (this.selectedKey && !this.draft) {
            const g = this.ghosts().find(x => x.key === this.selectedKey);
            if (e.key === 'Escape') {
                this.selectedKey = null;
                this.refresh();
                return true;
            }
            if (g && (e.key === 'Delete' || e.key === 'Backspace')) {
                this.takeOut(g.key);
                return true;
            }
            const turn = { q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
            if (g && turn && !e.ctrlKey && !e.metaKey) {
                const a = this.area();
                a.beginStroke();
                a.originals.moved[g.key] = { x: g.x, y: g.y, bearing: round(g.bearing + turn, 3) };
                this.changed();
                return true;
            }
        }
        if (e.key === 'Enter' && this.draft) {
            this.finishDraft();
            return true;
        }
        if (e.key === 'Escape') {
            if (this.cancelDraft()) return true;
            if (t) {
                this.selectedId = null;
                this.refresh();
                return true;
            }
            return false;
        }
        if (!t) return false;
        if (e.key === 'Delete' || e.key === 'Backspace') {
            this.remove(t);
            return true;
        }
        const turn = { q: Math.PI / 12, e: -Math.PI / 12 }[e.key.toLowerCase()];
        if (turn && !e.ctrlKey && !e.metaKey) {
            this.area().beginStroke();
            t.bearing = round((t.bearing ?? 0) + turn, 3);
            this.changed();
            return true;
        }
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
        if (this.workOrig) this.syncOriginal();
        this.refresh();
        this.ctx.saveSoon();
    }

    /** An original's properties as the form edits them: what it has, with the editor's changes on top. */
    workingCopy(g) {
        const e = this.area().originals.edited?.[g.key];
        const t = {
            id: g.key,
            kind: g.kind,
            blueprint: g.resref,
            tag: e?.tag ?? g.tag,
            name: e?.name ?? g.name,
            fields: { ...(g.fields ?? {}) },
            vars: structuredClone(e?.vars ?? g.vars ?? []),
            contents: g.contents,
            inventory: structuredClone(e?.inventory),
            creatures: structuredClone(e?.creatures),
            equipment: structuredClone(e?.equipment),
        };
        for (const [label, v] of Object.entries(e?.fields ?? {})) {
            if (v === null) delete t.fields[label];
            else t.fields[label] = v;
        }
        return t;
    }

    /** Keeps, for the original being edited, only what differs from what it had. */
    syncOriginal() {
        const { g, t } = this.workOrig,
            a = this.area();
        a.originals.edited ??= {};
        const e = {};
        if ((t.tag ?? '') !== (g.tag ?? '')) e.tag = t.tag ?? '';
        if ((t.name ?? '') !== (g.name ?? '')) e.name = t.name ?? '';
        const before = g.fields ?? {},
            f = {};
        for (const label of new Set([...Object.keys(before), ...Object.keys(t.fields ?? {})])) {
            if (JSON.stringify(before[label]) !== JSON.stringify(t.fields?.[label])) f[label] = t.fields?.[label] ?? null;
        }
        if (Object.keys(f).length) e.fields = f;
        if (JSON.stringify(g.vars ?? []) !== JSON.stringify(t.vars ?? [])) e.vars = t.vars ?? [];
        // What it holds: the list as edited, when it differs from the original's (item, whether it never runs out).
        const same = (x, y) =>
            JSON.stringify((x ?? []).map(i => [i.resref, !!i.infinite])) === JSON.stringify((y ?? []).map(i => [i.resref, !!i.infinite]));
        if (t.inventory !== undefined && !same(t.inventory, g.contents?.items)) e.inventory = t.inventory;
        if (t.creatures !== undefined && !same(t.creatures, g.contents?.creatures)) e.creatures = t.creatures;
        const worn = x => JSON.stringify((x ?? []).map(i => [i.slot, i.resref]).sort());
        if (t.equipment !== undefined && worn(t.equipment) !== worn(g.contents?.equipment)) e.equipment = t.equipment;
        if (Object.keys(e).length) a.originals.edited[g.key] = e;
        else delete a.originals.edited[g.key];
    }

    /** After undo, redo or opening an area. */
    refreshAll() {
        if (this.selectedId != null && !this.selected()) this.selectedId = null;
        this.refresh();
    }

    refresh() {
        const a = this.area();
        if (!a) return;
        // Out of the Things tool, the kinds ticked in the Show menu: the editor's own and the original's, as plain markers
        // (nothing to grab, no selection, no panel).
        if (!this.active) {
            this.ctx.view.setThings(
                a.things.filter(t => this.shown.has(t.kind)),
                null,
                null,
                this.ghosts().filter(g => this.shown.has(g.kind)),
                null,
                true,
            );
            return;
        }
        this.ctx.view.setThings(a.things, this.selectedId, this.draft, this.ghosts(), this.selectedKey);
        this.renderProps();
        this.renderOriginals();
        this.ctx.$('thingFinish').hidden = !this.draft;
        this.syncInspector();
        // A read-only session (someone else's workspace) can look but not change.
        if (this.ctx.readOnly?.())
            for (const el of document.querySelectorAll(
                '#thingProps input, #thingProps select, #thingProps button, #thingOrigs button, #thingFinish, #thingDelete',
            ))
                el.disabled = true;
    }
}

const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** What goes to the server: the area's things, without the editor's own `label`. */
export function thingsForExport(things) {
    return things.map(({ label: _label, ...t }) => ({
        ...t,
        vars: (t.vars ?? []).filter(v => v.name?.trim()),
        fields: t.fields && Object.keys(t.fields).length ? t.fields : undefined,
    }));
}
