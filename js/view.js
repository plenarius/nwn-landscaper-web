// The 3D view of one area: the terrain coloured by walkability, the 10 m
// NWN tile grid draped on it, the brush cursor, and export warnings.
//
// Frames: NWN x = three x; NWN y (north) = size - three z, so north is -Z,
// away from the default camera; height is three y.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPACING, TILE } from './area.js';

const GRASS_LOW = new THREE.Color(0x4f7a32);
const GRASS_HIGH = new THREE.Color(0x7d9b4a);
const ROCK = new THREE.Color(0x8a8378);
const BLOCKED = new THREE.Color(0xc0503c);

export class View {
    constructor(container) {
        this.container = container;
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x1d2228);
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4000);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;
        this.controls.maxPolarAngle = Math.PI / 2.05;
        // Left button sculpts; right orbits, middle pans, wheel zooms.
        this.controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
        this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(-0.6, 1.0, 0.5);
        this.scene.add(sun);
        this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x3a3226, 1.0));

        this.cursor = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.cursor.visible = false;
        this.scene.add(this.cursor);

        this.showWalkability = true;
        this.raycaster = new THREE.Raycaster();
        this.dirty = null;
        new ResizeObserver(() => this.resize()).observe(container);
        const loop = () => {
            requestAnimationFrame(loop);
            this.onFrame?.();
            if (this.dirty) this.flush();
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        requestAnimationFrame(loop);
    }

    resize() {
        const w = this.container.clientWidth, h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Shows a new area and frames the camera on it. */
    setArea(area) {
        this.area = area;
        for (const o of [this.mesh, this.grid, this.markers]) {
            if (o) { this.scene.remove(o); o.traverse?.(c => { c.geometry?.dispose(); c.material?.dispose?.(); }); }
        }
        this.markers = null;
        const n = area.n, size = area.size;
        const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(size / 2, 0, size / 2);
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * n * 3), 3));
        this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
        this.scene.add(this.mesh);
        this.grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
        this.scene.add(this.grid);
        this.markDirty({ i0: 0, i1: n - 1, j0: 0, j1: n - 1 });
        this.flush();
        this.frame();
    }

    frame() {
        const s = this.area.size;
        // The whole area in view, from the south, tilted down ~40 degrees.
        const mid = this.area.heightAt(s / 2, s / 2);
        this.controls.target.set(s / 2, mid, s / 2);
        this.camera.position.set(s / 2, mid + s * 0.95, s / 2 + s * 1.15);
        this.controls.minDistance = 5;
        this.controls.maxDistance = s * 3;
        this.controls.update();
    }

    markDirty(r) {
        if (!r) return;
        this.dirty = this.dirty
            ? { i0: Math.min(this.dirty.i0, r.i0), i1: Math.max(this.dirty.i1, r.i1), j0: Math.min(this.dirty.j0, r.j0), j1: Math.max(this.dirty.j1, r.j1) }
            : { ...r };
    }

    /** Vertex index of sample (i, j): plane rows run north to south. */
    vertex(i, j) { return (this.area.n - 1 - j) * this.area.n + i; }

    flush() {
        const area = this.area, n = area.n, d = this.dirty;
        this.dirty = null;
        const pos = this.mesh.geometry.attributes.position;
        const col = this.mesh.geometry.attributes.color;
        // Heights of the changed rows and a margin (walkability uses neighbours).
        const i0 = Math.max(0, d.i0 - 1), i1 = Math.min(n - 1, d.i1 + 1), j0 = Math.max(0, d.j0 - 1), j1 = Math.min(n - 1, d.j1 + 1);
        let lo = Infinity, hi = -Infinity;
        for (const v of area.heights) { if (v < lo) lo = v; if (v > hi) hi = v; }
        const span = Math.max(hi - lo, 1);
        const c = new THREE.Color();
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const v = this.vertex(i, j), z = area.heights[j * n + i];
                pos.setY(v, z);
                if (area.walkable(i, j)) {
                    c.copy(GRASS_LOW).lerp(GRASS_HIGH, (z - lo) / span);
                } else {
                    c.copy(this.showWalkability ? BLOCKED : ROCK);
                }
                col.setXYZ(v, c.r, c.g, c.b);
            }
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        this.mesh.geometry.computeVertexNormals();
        this.mesh.geometry.computeBoundingSphere();
        this.mesh.geometry.computeBoundingBox();
        this.updateGrid();
    }

    setShowWalkability(on) {
        this.showWalkability = on;
        this.markDirty({ i0: 0, i1: this.area.n - 1, j0: 0, j1: this.area.n - 1 });
    }

    /** The tile grid, draped 5 cm above the ground. */
    updateGrid() {
        const area = this.area, n = area.n, size = area.size, tiles = area.tiles;
        const pts = [];
        const per = n - 1;
        for (let t = 0; t <= tiles; t++) {
            const along = t * TILE;
            for (let k = 0; k < per; k++) {
                const a = k * SPACING, b = (k + 1) * SPACING;
                // Line of constant x (running north) and of constant y.
                pts.push(along, area.heightAt(along, a) + 0.05, size - a, along, area.heightAt(along, b) + 0.05, size - b);
                pts.push(a, area.heightAt(a, along) + 0.05, size - along, b, area.heightAt(b, along) + 0.05, size - along);
            }
        }
        this.grid.geometry.dispose();
        this.grid.geometry = new THREE.BufferGeometry();
        this.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    }

    /** Area point (NWN metres) under the mouse, or null. */
    pick(clientX, clientY) {
        const r = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hit = this.raycaster.intersectObject(this.mesh)[0];
        if (!hit) return null;
        return { x: hit.point.x, y: this.area.size - hit.point.z, z: hit.point.y };
    }

    /** Brush ring at area point p (or hide it). */
    setCursor(p, radius) {
        if (!p) { this.cursor.visible = false; return; }
        const pts = [];
        for (let k = 0; k <= 64; k++) {
            const a = (k / 64) * Math.PI * 2;
            const x = p.x + Math.cos(a) * radius, y = p.y + Math.sin(a) * radius;
            pts.push(new THREE.Vector3(x, this.area.heightAt(x, y) + 0.15, this.area.size - y));
        }
        this.cursor.geometry.setFromPoints(pts);
        this.cursor.visible = true;
    }

    /** Pillars at export warnings: red where a route stops, orange on winding tiles. */
    setMarkers(warnings) {
        if (this.markers) { this.scene.remove(this.markers); this.markers.traverse(c => { c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose?.(); }); }
        this.markers = new THREE.Group();
        for (const w of warnings) {
            const failed = w.kind === 'failed_route';
            const at = failed ? w.stops_at : [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
            const color = failed ? 0xe0402a : 0xff9a1f;
            const ground = this.area.heightAt(at[0], at[1]);
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 12), new THREE.MeshBasicMaterial({ color }));
            pillar.position.set(at[0], ground + 2.5, this.area.size - at[1]);
            this.markers.add(pillar);
            const label = makeLabel(failed ? 'Route stops here' : `Tile ${w.tile[0]},${w.tile[1]}: too winding`, color);
            label.position.set(at[0], ground + 6, this.area.size - at[1]);
            this.markers.add(label);
        }
        this.scene.add(this.markers);
    }
}

function makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 40px system-ui, sans-serif';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.height = 60;
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(20,22,26,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillText(text, 12, 44);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    sprite.scale.set(canvas.width / 30, canvas.height / 30, 1);
    return sprite;
}
