// SPDX-FileCopyrightText: Copyright (C) 2026 plenarius
// SPDX-License-Identifier: MIT

// The 3D view of one area: the terrain with its painted textures (or
// coloured by height until they load), tinted where NWN won't walk, the
// 10 m NWN tile grid draped on it, the brush cursor, and export warnings.
//
// Frames: NWN x = three x; NWN y (north) = size - three z, so north is -Z,
// away from the default camera; height is three y.

import { THING_COLOURS } from './thingcolours.js';
import * as THREE from 'three';
import { KEEP_BUFFER } from './desktop.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPACING, TILE, VOID_BELOW, WALKABLE_NZ, CHASM_DARK, SHALLOW, uprightFoot, uprightShift } from './area.js';
import { waterMesh, WATER_FILM } from './watermesh.js';
import { REACH, groundNormals } from './normals.js';
import { fogRange, waterView, workShare } from './atmosphere.js';
import { BOUNCE, shadeArea, shadeChanged, SHADE_STEP } from './shade.js';
import { lightTexels, LIGHT_HEIGHT, LIGHT_RADIUS } from './lights.js';
import { at as entranceAt, groundBehind, scenery as entranceScenery } from './entrance.js';
import { metresOf, triplanarGlsl, variedGlsl, varyOf } from './triplanar.js';
import { AmbienceLayer } from './ambienceview.js';
import { SOFT_GLSL, SoftGrid, edgeOf, seed } from './softpaint.js';
import { Coarse, QUARTER, windowAt, wholeWindow } from './canvasview.js';

const GRASS_LOW = new THREE.Color(0x4f7a32);
const GRASS_HIGH = new THREE.Color(0x7d9b4a);
const ROCK = new THREE.Color(0x8a8378);
const BLOCKED = new THREE.Color(0xc0503c);
const WHITE = new THREE.Color(1, 1, 1);
/** The layer table (uLayers): 256 texels a row, a palette index each. Row 0, the soft paint's (softpaint.js): its edge, mean
 *  luminance and noise seed; row 1: in r, the metres one repeat of its texture covers (triplanar.js, TRI_METRES), in g the hex
 *  cells to a repeat its features are varied by (TRI_VARY; 0 for a plain repeat). */
const layersTexture = () => {
    const t = new THREE.DataTexture(new Float32Array(256 * 2 * 4), 256, 2, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    return t;
};
/** The rectangle (i0..i1, j0..j1) covering rectangles `a` and `b`, either of which may be none (null or false). */
const union = (a, b) =>
    a && b ? { i0: Math.min(a.i0, b.i0), i1: Math.max(a.i1, b.i1), j0: Math.min(a.j0, b.j0), j1: Math.max(a.j1, b.j1) } : a || b || null;
// The working light: the view's own, when it doesn't show the area's light (setAtmosphere).
const WORK_SUN = 2.2;
const WORK_SKY = 1.0;
const WORK_FOG = new THREE.Color(0x3a4048);
// Multiplies the painted texture on ground too steep to walk.
const BLOCKED_TINT = new THREE.Color(1.0, 0.42, 0.36);
// Splat shading, as landscaper bakes it into the NWN tiles: each sample has
// a texture (an index into the area palette, stored in uMat). Walkable
// ground draws the paint smoothed (softpaint.js, uSoft), its edges crisp or
// broken as the bake draws them. Ground too steep to walk takes the
// texture that weighs most in the four samples round a point, blended
// bilinearly, as landscaper cuts steep faces (its split.rs; in a tie, the
// lower palette index). Every texture is drawn from three sides by
// the ground's slope (triplanar.js), as the game's shader and landscaper's
// bake draw it, so it keeps its size on every slope.
// Baked shadows over the lit ground, as the game's shadow-map shader
// multiplies them (fog comes after, in three.js as in the game).
// Only over the area: the edge scenery has no shadow map. With baked
// objects, their shadows from the view's shadow map join the terrain's as
// the engine joins them (landscaper shade.rs, combine; without the sky they
// hide, which it adds).
const SHADE_FRAGMENT = `
    {
        vec2 extent = (uShadeCells - 1.0) * ${SHADE_STEP.toFixed(4)};
        if (all(greaterThanEqual(vArea, vec2(0.0))) && all(lessThanEqual(vArea, extent)))
        {
            vec4 sh = texture2D(uShade, (vArea / ${SHADE_STEP.toFixed(4)} + 0.5) / uShadeCells);
            float s = sh.r;
            #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
            if (uObjectShadows) {
                float through = getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize,
                    directionalLightShadows[0].shadowIntensity, directionalLightShadows[0].shadowBias,
                    directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]);
                float lit = 1.0 - 0.6 * (1.0 - (1.0 - sh.g) * through);
                s = clamp(1.0 - uShadowStrength * (1.0 - lit * (1.0 - 0.8 * sh.b)), 0.15, 1.0) * sh.a;
            }
            #endif
            // (The game multiplies in display colours, three.js in linear ones: 0.64 there is about 0.37 here.)
            diffuseColor.rgb *= pow(s, 2.2);
        }
        if (vGap <= ${VOID_BELOW.toFixed(2)}) diffuseColor.rgb = vec3(0.0);
        // A chasm's walls fade to black going down, as landscaper's fade darkens them (chasmFade, in the game's colours).
        if (vDeep > 0.0) diffuseColor.rgb *= pow(pow(max(0.0, 1.0 - vDeep / ${CHASM_DARK.toFixed(2)}), 1.6), 2.2);
    }`;

// The tiles' own lights (the Light tool, lights.js): each tile's two hang LIGHT_HEIGHT m over its middle and reach LIGHT_RADIUS m,
// so a point takes light from its tile and the eight round it (two tiles off is more than LIGHT_RADIUS away). uLights is one texel
// a tile, the two lights' colours added. Added after the sun's and the sky's light, so the baked shade (already in diffuseColor)
// darkens it as the game's shader does today. The lights hang over the point's own height, not the tile's: on a slope the game's
// pool sits a little higher or lower.
const LIGHTS_FRAGMENT = `
    // (only over the area: the edge scenery's models are not the tiles')
    if (uLightsOn && all(greaterThanEqual(vArea, vec2(0.0))) && all(lessThanEqual(vArea, uSize))) {
        ivec2 at = ivec2(floor(vArea / ${TILE.toFixed(1)}));
        vec3 wash = vec3(0.0);
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                ivec2 t = at + ivec2(dx, dy);
                if (any(lessThan(t, ivec2(0))) || any(greaterThanEqual(t, ivec2(uLightTiles)))) continue;
                vec3 c = texelFetch(uLights, t, 0).rgb;
                if (c == vec3(0.0)) continue;
                vec3 to = vec3((vec2(t) + 0.5) * ${TILE.toFixed(1)} - vArea, ${LIGHT_HEIGHT.toFixed(1)});
                float d = length(to);
                float fall = max(0.0, 1.0 - d / ${LIGHT_RADIUS.toFixed(1)});
                wash += c * fall * fall * max(0.0, dot(normalize(vNormalArea), to / d));
            }
        }
        reflectedLight.directDiffuse += diffuseColor.rgb * wash;
    }`;

// The underlay (underlay.js): a picture lying on the ground to trace over, blended over the ground's colour where it covers
// it. uUnderM maps area metres to the picture's 0..1; uUnderOpacity 0 hides it.
const UNDERLAY_FRAGMENT = `
    if (uUnderOpacity > 0.0) {
        vec2 uv = (uUnderM * vec3(vArea, 1.0)).xy;
        if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
            vec4 under = texture2D(uUnder, uv);
            diffuseColor.rgb = mix(diffuseColor.rgb, under.rgb, under.a * uUnderOpacity);
        }
    }`;

const SPLAT_VERTEX = `
    vArea = vec2(transformed.x, uSize.y - transformed.z);
    vPaint = vArea - aShift;
    vShift = aShift;
    vWall = aWall;
    vUp = transformed.y;
    vGap = aGap;
    vDeep = aDeep;
    vNormalUp = aUp;
    vNormalArea = vec3(normal.x, -normal.z, normal.y);`;
const SPLAT_FRAGMENT = `
    if (uTextured) {
        // An interior's upright wall (every corner a foot or a top): the top's paint from the foot up, as the game paints it. vShift
        // over vWall.y is the tops' shift, whole at any height.
        bool upright = vWall.y > 1e-6 && vWall.x + vWall.y > 0.999;
        vec2 paintAt = upright ? vArea - vShift / vWall.y : vPaint;
        vec2 f = clamp(paintAt / ${SPACING.toFixed(4)} + uOrigin, vec2(0.0), uN - 1.0);
        vec2 base = min(floor(f), uN - 2.0);
        vec2 t = f - base;
        ivec2 b = ivec2(base);
${triplanarGlsl('vNormalArea', 'vArea', 'vUp')}
        float m00 = floor(texelFetch(uMat, b, 0).r * 255.0 + 0.5);
        float m10 = floor(texelFetch(uMat, b + ivec2(1, 0), 0).r * 255.0 + 0.5);
        float m01 = floor(texelFetch(uMat, b + ivec2(0, 1), 0).r * 255.0 + 0.5);
        float m11 = floor(texelFetch(uMat, b + ivec2(1, 1), 0).r * 255.0 + 0.5);
        // An imported area's ground: its picture over the whole area; beyond
        // the edge, the border's outer 5 m mirrored out and back every 10 m
        // (as landscaper's edge models draw it).
        vec2 folded = vArea;
        for (int k = 0; k < 2; k++) {
            float c = folded[k];
            if (c < 0.0 || c > uSize[k]) {
                float m = mod(c < 0.0 ? -c : c - uSize[k], 10.0);
                m = m > 5.0 ? 10.0 - m : m;
                folded[k] = c < 0.0 ? m : uSize[k] - m;
            }
        }
        vec4 imported = texture2D(uImport, folded / uSize);
        // (metres a pixel: worked out here, where every pixel of the ground takes the same branch)
        float softPx = length(fwidth(vArea));
        vec4 splat;
        if (upright || vNormalUp < ${WALKABLE_NZ.toFixed(2)}) {
            float wq[4] = float[4]((1.0 - t.x) * (1.0 - t.y), t.x * (1.0 - t.y), (1.0 - t.x) * t.y, t.x * t.y);
            float mq[4] = float[4](m00, m10, m01, m11);
            float heaviest = m00, most = -1.0;
            for (int a = 0; a < 4; a++) {
                float w = 0.0;
                for (int b = 0; b < 4; b++) w += mq[b] == mq[a] ? wq[b] : 0.0;
                if (w > most || (w == most && mq[a] < heaviest)) {
                    most = w;
                    heaviest = mq[a];
                }
            }
            splat = heaviest == uImportLayer ? imported : TRIPLANAR(heaviest);
        } else {
            // Walkable ground: the paint smoothed, its edges crisp or broken, as the export bakes it (softpaint.js).
            #define SPLAT(l) ((l) == uImportLayer ? imported : TRIPLANAR(l))
            SOFT_SPLAT(vArea, softPx, splat)
        }
        diffuseColor.rgb *= splat.rgb;
    }`;

// The things' markers (View.setThings): each kind's parts, made at MARKER_SIZE (a selected one is drawn a quarter bigger),
// standing `y` marker sizes up (`fixed`: metres), turned by `rot`. A trigger's and an encounter's are the same.
const MARKER_SIZE = 1.35;
const FLAG = [
    { geo: k => new THREE.CylinderGeometry(0.12 * k, 0.12 * k, 1.6 * k, 6), y: 0.8 },
    { geo: k => new THREE.OctahedronGeometry(0.3 * k), y: 1.8 },
];
const MARKER_PARTS = {
    creature: [
        { geo: k => new THREE.ConeGeometry(0.32 * k, 1.5 * k, 10), y: 0.75 },
        { geo: k => new THREE.SphereGeometry(0.27 * k, 10, 8), y: 1.75 },
    ],
    waypoint: [
        { geo: k => new THREE.CylinderGeometry(0.05 * k, 0.05 * k, 2 * k, 6), y: 1 },
        { geo: k => new THREE.OctahedronGeometry(0.35 * k), y: 2.2 },
    ],
    trigger: FLAG,
    encounter: FLAG,
    sound: [
        { geo: k => new THREE.TorusGeometry(0.7 * k, 0.07 * k, 6, 20), y: 1.2, rot: [Math.PI / 2, 0, 0] },
        { geo: k => new THREE.SphereGeometry(0.22 * k, 8, 6), y: 1.2 },
    ],
    store: [
        { geo: k => new THREE.BoxGeometry(0.9 * k, 0.9 * k, 0.9 * k), y: 0.45 },
        { geo: k => new THREE.ConeGeometry(0.55 * k, 0.5 * k, 4), y: 1.15 },
    ],
    item: [{ geo: k => new THREE.OctahedronGeometry(0.28 * k), y: 0.45 }],
    door: [{ geo: k => new THREE.BoxGeometry(0.15 * k, 2 * k, 1.1 * k), y: 1 }],
    placeable: [{ geo: k => new THREE.BoxGeometry(0.55 * k, 0.55 * k, 0.55 * k), y: 0.28 }],
};
const OTHER_MARKER = [{ geo: k => new THREE.SphereGeometry(0.3 * k, 8, 6), y: 0.5, fixed: true }];
// A corner post of an outline (a selected one's are 1.8 times as thick and 1.5 times as tall).
const POST = () => new THREE.CylinderGeometry(0.1, 0.1, 0.8, 6);

/** How far the sky is drawn (m): inside the camera's far plane (4,000 m). */
const SKY_RADIUS = 3000;
/** The engine's sky panorama runs from 90° above the horizon to 30° below it. The view draws it down to 3° below: further down,
 *  the game shows its fog colour past the area's edge, not the sky model's lower part (the stock skies paint land there). */
const SKY_TOP = 90,
    SKY_BOTTOM = -30,
    SKY_CUT = -3;

/** The 3D view in `container`: the ground, objects, water, things and markers of the area, the camera, and picking with the
 *  pointer. */
export class View {
    constructor(container) {
        this.container = container;
        this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: KEEP_BUFFER });
        this.renderer.localClippingEnabled = true;
        // Imported tiles' roofs and upper floors: cut away above this height (null: whole).
        this.cut = null;
        this.cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
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

        // The working light, and the area's own (setAtmosphere).
        this.workSun = new THREE.DirectionalLight(0xffffff, WORK_SUN);
        this.workSun.position.set(-0.6, 1.0, 0.5);
        this.workSky = new THREE.HemisphereLight(0xcfe3ff, 0x3a3226, WORK_SKY);
        // The game's sun and moon shine from towards (4000, 4500, 7000).
        this.areaSun = new THREE.DirectionalLight(0xffffff, Math.PI);
        this.areaSun.position.set(4000, 7000, -4500).normalize();
        this.areaAmbient = new THREE.AmbientLight(0x000000, Math.PI);
        // The sun or moon bounced off the ground onto steep ground, as the export's tile shaders add it (landscaper shared.rs,
        // BOUNCE): from below only, none on flat ground, half of BOUNCE on a wall.
        this.areaBounce = new THREE.HemisphereLight(0x000000, 0x000000, Math.PI);
        // The baked objects' shadows, from the game's sun in either light: a light that lights nothing, only its shadow map
        // (the ground reads it, see SHADE_FRAGMENT). Drawn again only when the objects change (updateObjectShadows).
        this.shadowSun = new THREE.DirectionalLight(0xffffff, 0);
        this.shadowSun.shadow.radius = 3;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.scene.add(this.workSun, this.workSky, this.areaSun, this.areaAmbient, this.areaBounce, this.shadowSun, this.shadowSun.target);
        this.areaSun.visible = this.areaAmbient.visible = this.areaBounce.visible = false;
        this.fog = null; // { start, end } as the game's camera sees it

        this.cursor = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff }));
        this.cursor.visible = false;
        this.scene.add(this.cursor);

        this.showWalkability = true;
        this.library = null;
        this.textured = false;
        this.uniforms = {
            uTex: { value: new THREE.DataArrayTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, 1) },
            uMat: { value: null },
            // Samples and metres, across and up.
            uN: { value: new THREE.Vector2(2, 2) },
            // Samples from the paint grid's first to the area's first: 0 for the area, the band's width for the band (band.js).
            uOrigin: { value: 0 },
            uSize: { value: new THREE.Vector2(1, 1) },
            uTextured: { value: false },
            // The soft paint (softpaint.js, SoftGrid): each sample's two heaviest textures and their weights, the grid's samples,
            // and samples from its first to the area's (the band's width when it has one).
            uSoft: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) },
            uSoftN: { value: new THREE.Vector2(2, 2) },
            uSoftOrigin: { value: 0 },
            // One texel a palette index: its edge (r: 1 broken), mean luminance (g) and noise seed (b, a: its low and high 16 bits).
            uLayers: { value: layersTexture() },
            // Baked shadows (shade.js): a grid SHADE_STEP apart over the area.
            uShade: { value: null },
            uShadeCells: { value: new THREE.Vector2(1, 1) },
            // The baked objects' shadows (updateObjectShadows), and the area's shadow strength they are drawn at.
            uObjectShadows: { value: false },
            uShadowStrength: { value: 0 },
            // A cave's rock tops from here up are void: black.
            // An imported area's picture, and its palette index (-1: none).
            uImport: { value: null },
            uImportLayer: { value: -1 },
            // The underlay's picture, where it lies (area metres to its 0..1) and how opaque it is (0: not shown).
            uUnder: { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1) },
            uUnderM: { value: new THREE.Matrix3() },
            uUnderOpacity: { value: 0 },
            // The tiles' lights (updateLights): one texel a tile, and whether any is lit.
            uLights: { value: new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType) },
            uLightTiles: { value: new THREE.Vector2(1, 1) },
            uLightsOn: { value: false },
        };
        this.uniforms.uUnder.value.needsUpdate = true;
        this.uniforms.uTex.value.needsUpdate = true;
        this.raycaster = new THREE.Raycaster();
        this.dirty = null;
        // Counts the ground's changes and redraws, so a kept pick (lastPick) or outline (setThings) knows the ground moved.
        this.groundVersion = 0;
        this.lastPick = null;
        // The Ambience tool's placements (updateAmbience): the pack's kinds by id, whether the view shows night, and whether the
        // placements out of their hours show as dots (while the tool is open).
        this.ambience = new AmbienceLayer(this.scene);
        this.ambienceKinds = new Map();
        this.night = false;
        this.ambienceMarking = false;
        new ResizeObserver(() => this.resize()).observe(container);
        const loop = () => {
            requestAnimationFrame(loop);
            this.onFrame?.();
            if (this.dirty) this.flush();
            else this.followWindow();
            if (this.bandDirty) this.updateBand();
            this.controls.update();
            this.updateFog();
            const px = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
            this.ambience.frame(performance.now() / 1000, px);
            this.renderer.render(this.scene, this.camera);
        };
        requestAnimationFrame(loop);
    }

    /**
     * Lights the view as the game will (`atmosphere`, by day or `night`),
     * or with `null` the plain working light.
     */
    setAtmosphere(atmosphere, night) {
        const on = !!atmosphere;
        this.workSun.visible = this.workSky.visible = true;
        this.workSun.intensity = WORK_SUN;
        this.workSky.intensity = WORK_SKY;
        this.areaSun.visible = this.areaAmbient.visible = this.areaBounce.visible = on;
        // (the particles' night look and night-only kinds, as the game shows them)
        if (this.night !== (on && !!night)) {
            this.night = on && !!night;
            this.updateAmbience();
        }
        if (!on) {
            this.fog = null;
            this.scene.fog = null;
            this.renderer.setClearColor(0x1d2228);
            return;
        }
        const s = night ? atmosphere.moon : atmosphere.sun;
        // Colours are gamma-space; three.js lights in linear and divides by pi.
        this.areaAmbient.color.set(s.ambient);
        this.areaSun.color.set(s.diffuse);
        this.areaBounce.groundColor.set(s.diffuse).multiplyScalar(BOUNCE);
        // Light too dark to work in (a cave by night) keeps that share of the working light under it, its fog lifted as much.
        const w = workShare(s);
        this.workSun.visible = this.workSky.visible = w > 0;
        this.workSun.intensity = WORK_SUN * w;
        this.workSky.intensity = WORK_SKY * w;
        const f = fogRange(atmosphere, night);
        this.fog = f;
        const fog = new THREE.Color(f.color).lerp(WORK_FOG, w);
        this.scene.fog = new THREE.Fog(fog, f.start, f.end);
        this.renderer.setClearColor(fog);
    }

    /**
     * Draws the area's sky around the camera, as the game draws its sky model: `url`, the engine's panorama of it
     * (/api/sky-picture/, kind panorama), or null for none. The panorama's columns turn from east towards north and its rows
     * run from overhead to below the horizon (SKY_TOP, SKY_BOTTOM); where it is clear or cut (SKY_CUT), the fog colour (the clear
     * colour) shows, as in the game.
     */
    setSky(url) {
        if (url === (this.skyUrl ?? null)) return;
        this.skyUrl = url;
        if (!url) {
            if (this.sky) this.sky.visible = false;
            return;
        }
        if (!this.sky) {
            // A sphere from the top down to SKY_CUT, inside the camera's far plane and never fogged.
            const down = THREE.MathUtils.degToRad(SKY_TOP - SKY_CUT);
            const geometry = new THREE.SphereGeometry(SKY_RADIUS, 96, 32, 0, Math.PI * 2, 0, down);
            const material = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, transparent: true });
            this.sky = new THREE.Mesh(geometry, material);
            this.sky.renderOrder = -1;
            this.sky.frustumCulled = false;
            this.sky.onBeforeRender = (_r, _s, camera) => this.sky.position.copy(camera.position);
            this.skyTextures = new Map();
            this.scene.add(this.sky);
        }
        let texture = this.skyTextures.get(url);
        if (!texture) {
            // (A sky the engine can't picture leaves the fog colour.)
            texture = new THREE.TextureLoader().load(url, undefined, undefined, () => {
                if (this.skyUrl === url) this.sky.visible = false;
            });
            texture.colorSpace = THREE.SRGBColorSpace;
            // The sphere's seam is in the west, the panorama's in the east.
            texture.wrapS = THREE.RepeatWrapping;
            texture.offset.x = 0.5;
            // (the sphere's rows: the panorama's from the top to SKY_CUT)
            texture.repeat.y = (SKY_TOP - SKY_CUT) / (SKY_TOP - SKY_BOTTOM);
            texture.offset.y = (SKY_CUT - SKY_BOTTOM) / (SKY_TOP - SKY_BOTTOM);
            this.skyTextures.set(url, texture);
            // A few kept, for flipping between day and night or between skies.
            if (this.skyTextures.size > 6) {
                const [old, t] = this.skyTextures.entries().next().value;
                t.dispose();
                this.skyTextures.delete(old);
            }
        }
        this.sky.material.map = texture;
        this.sky.material.needsUpdate = true;
        this.sky.visible = true;
    }

    /** The game measures fog from its camera, which stays about 20 m from
     *  the player: the fog as such a camera at the view's target sees it
     *  (as Moonglow shows it), so pulling back doesn't fog everything. */
    updateFog() {
        if (!this.fog || !this.scene.fog) return;
        const beyond = Math.max(0, this.camera.position.distanceTo(this.controls.target) - 20);
        this.scene.fog.near = this.fog.start + beyond;
        this.scene.fog.far = this.fog.end + beyond;
    }

    resize() {
        const w = this.container.clientWidth,
            h = this.container.clientHeight;
        if (!w || !h) return;
        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
    }

    /** Shows a new area and frames the camera on it. */
    setArea(area) {
        this.area = area;
        for (const o of [
            this.mesh,
            this.grid,
            this.markers,
            this.water,
            this.skirt,
            this.band,
            this.entranceGroup,
            this.objectGroup,
            this.thingGroup,
        ]) {
            if (o) {
                this.scene.remove(o);
                o.traverse?.(c => {
                    c.geometry?.dispose();
                    // (a marker's label is a texture drawn for it, as setMarkers disposes it)
                    if (o === this.markers) c.material?.map?.dispose();
                    c.material?.dispose?.();
                });
            }
        }
        this.markers = null;
        this.water = null;
        this.lastPick = null;
        this.fit = null;
        this.chasmFit = null;
        this.drawn = null;
        this.coarse?.dispose();
        this.coarse = null;
        this.windowPinned = false;
        const { nx, ny, sizeX, sizeY } = area;
        // A canvas draws a window of it at full detail and all of it at a quarter (Coarse); an area is all window.
        this.win = area.canvas ? windowAt(area, sizeX / 2, sizeY / 2) : wholeWindow(area);
        this.uniforms.uMat.value?.dispose();
        const mat = new THREE.DataTexture(area.materials, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
        mat.minFilter = mat.magFilter = THREE.NearestFilter;
        mat.unpackAlignment = 1;
        mat.needsUpdate = true;
        this.uniforms.uMat.value = mat;
        this.buildSoft();
        this.uniforms.uN.value.set(nx, ny);
        this.uniforms.uSize.value.set(sizeX, sizeY);
        this.shadeDirty = null;
        this.updateShade(true);
        this.mesh = new THREE.Mesh(this.windowGeometry(), this.splatMaterial());
        // (So three.js hands it the object shadows' map. Its own dimming darkens only the shadow light, which lights nothing.)
        this.mesh.receiveShadow = true;
        this.scene.add(this.mesh);
        if (area.canvas) this.coarse = new Coarse(this);
        this.buildSkirt();
        this.buildBand();
        this.grid = new THREE.LineSegments(
            new THREE.BufferGeometry(),
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
        );
        // (its lines are moved in place, so a bounding sphere worked out once would go stale)
        this.grid.frustumCulled = false;
        this.scene.add(this.grid);
        this.paletteKey = null;
        // (the shadows were baked whole above)
        this.markDirty(this.everything(), false);
        this.flush();
        this.updateWater();
        this.updateEntrances();
        this.updateObjects();
        this.updateAmbience();
        this.updateLights();
        this.frame();
        this.syncPalette();
    }

    /** The full-detail mesh's geometry over the window (`win`, samples of the area), its values filled by flush. */
    windowGeometry() {
        const { i0, j0, nx, ny } = this.win,
            w = (nx - 1) * SPACING,
            h = (ny - 1) * SPACING;
        const geo = new THREE.PlaneGeometry(w, h, nx - 1, ny - 1);
        geo.rotateX(-Math.PI / 2);
        geo.translate(i0 * SPACING + w / 2, 0, this.area.sizeY - j0 * SPACING - h / 2);
        // How far under its ceiling each sample is: the rock tops (0.3 or less) are void, drawn black.
        geo.setAttribute('aGap', new THREE.BufferAttribute(new Float32Array(nx * ny).fill(1e9), 1));
        // How far down a chasm each sample is, over its depth: 0 out of one, 1 on its floor (drawn black, its walls fading).
        geo.setAttribute('aDeep', new THREE.BufferAttribute(new Float32Array(nx * ny), 1));
        // Each sample's own slope's up part: whether it is too steep to walk (its normal, steep ground's taken wider, isn't).
        geo.setAttribute('aUp', new THREE.BufferAttribute(new Float32Array(nx * ny).fill(1), 1));
        // How far an interior's wall top was moved onto its foot's line (uprightShift; m east, north): its paint is read where
        // it was.
        geo.setAttribute('aShift', new THREE.BufferAttribute(new Float32Array(nx * ny * 2), 2));
        // Whether each sample is an upright wall's foot and its top (uprightFoot): the shader paints the wall between them.
        geo.setAttribute('aWall', new THREE.BufferAttribute(new Float32Array(nx * ny * 2), 2));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3));
        return geo;
    }

    /**
     * Moves a canvas's full-detail window to `win` (windowAt's; null: none, the whole canvas at a quarter of the detail): the
     * mesh is made again there and drawn whole. `pin`: it stays there instead of following the camera (Open piece, step 6,
     * gives it the piece and its ring).
     */
    setWindow(win, pin = false) {
        if (!this.coarse) return;
        this.windowPinned = pin;
        const same = a => a && win && a.i0 === win.i0 && a.j0 === win.j0 && a.nx === win.nx && a.ny === win.ny;
        this.mesh.visible = !!win;
        if (win && !same(this.win)) {
            this.win = win;
            this.mesh.geometry.dispose();
            this.mesh.geometry = this.windowGeometry();
            this.grid.geometry.dispose();
            this.grid.geometry = new THREE.BufferGeometry();
            this.markDirty(this.everything(), false);
            this.flush();
        }
        this.grid.visible = !!win;
        this.coarse.setHole(win && this.win);
        this.groundVersion++;
    }

    /** Draws the Ambience tool's placements again (the tool, an undo, the ground moved, the light changed). */
    updateAmbience() {
        this.ambience.set(this.area, this.ambienceKinds, this.night, this.ambienceMarking);
    }

    /** The particle pack's kinds (ambience.js kindsOf), and whether the placements out of their hours show as dots. */
    setAmbienceKinds(kinds, marking = this.ambienceMarking) {
        this.ambienceKinds = new Map(kinds.map(k => [k.id, k]));
        this.ambienceMarking = marking;
        this.updateAmbience();
    }

    /** The ground's material; `uniforms`: the band's (its own paint grid and origin, the rest the area's). */
    splatMaterial(uniforms = this.uniforms) {
        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        material.onBeforeCompile = shader => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    '#include <common>\nuniform vec2 uSize;\nattribute float aGap;\nattribute float aDeep;\nattribute float aUp;\nattribute vec2 aShift;\nattribute vec2 aWall;\nvarying vec2 vShift;\nvarying vec2 vWall;\nvarying float vGap;\nvarying float vDeep;\nvarying vec2 vArea;\nvarying vec2 vPaint;\nvarying float vUp;\nvarying float vNormalUp;\nvarying vec3 vNormalArea;',
                )
                .replace('#include <begin_vertex>', `#include <begin_vertex>${SPLAT_VERTEX}`);
            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>\nprecision highp sampler2DArray;\nuniform sampler2DArray uTex;\nuniform sampler2D uMat;\nuniform vec2 uN;\nuniform float uOrigin;\nuniform bool uTextured;\nuniform sampler2D uShade;\nuniform vec2 uShadeCells;\nuniform bool uObjectShadows;\nuniform float uShadowStrength;\nuniform sampler2D uImport;\nuniform float uImportLayer;\nuniform sampler2D uUnder;\nuniform mat3 uUnderM;\nuniform float uUnderOpacity;\nuniform vec2 uSize;\nuniform sampler2D uLights;\nuniform vec2 uLightTiles;\nuniform bool uLightsOn;\nuniform sampler2D uSoft;\nuniform vec2 uSoftN;\nuniform float uSoftOrigin;\nuniform sampler2D uLayers;\n#define TRI_METRES(layer) texelFetch(uLayers, ivec2(int(layer), 1), 0).r\n#define TRI_VARY(layer) texelFetch(uLayers, ivec2(int(layer), 1), 0).g\nvarying float vGap;\nvarying float vDeep;\nvarying vec2 vArea;\nvarying vec2 vPaint;\nvarying vec2 vShift;\nvarying vec2 vWall;\nvarying float vUp;\nvarying float vNormalUp;\nvarying vec3 vNormalArea;${SOFT_GLSL}${variedGlsl}`,
                )
                .replace('#include <color_fragment>', `#include <color_fragment>${SPLAT_FRAGMENT}${UNDERLAY_FRAGMENT}${SHADE_FRAGMENT}`)
                .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>${LIGHTS_FRAGMENT}`);
        };
        material.customProgramCacheKey = () => 'landscaper-splat';
        return material;
    }

    /** Draws the tiles' lights again (the Light tool, an undo, another area). */
    updateLights() {
        const a = this.area;
        const texels = a && lightTexels(a);
        this.uniforms.uLightsOn.value = !!texels;
        if (!texels) return;
        const old = this.uniforms.uLights.value;
        if (old.image.width === a.tiles && old.image.height === a.tilesY) {
            old.image.data.set(texels);
            old.needsUpdate = true;
            return;
        }
        const tex = new THREE.DataTexture(texels, a.tiles, a.tilesY, THREE.RGBAFormat, THREE.FloatType);
        tex.minFilter = tex.magFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        old.dispose();
        this.uniforms.uLights.value = tex;
        this.uniforms.uLightTiles.value.set(a.tiles, a.tilesY);
    }

    /** Bakes the shadows again after the ground changed: where the changes since the last bake (markDirty) can reach.
     *  `all`: the whole area (another area, the shadows' strength or the entrances changed). */
    updateShade(all = false) {
        const r = this.shadeDirty,
            baked = this.uniforms.uShade.value;
        this.shadeDirty = null;
        if (!all && !r) return;
        if (!all && baked?.image.data && r) {
            shadeChanged(this.area, this.area.shadow, baked.image.data, {
                x0: r.i0 * SPACING,
                y0: r.j0 * SPACING,
                x1: r.i1 * SPACING,
                y1: r.j1 * SPACING,
            });
            baked.needsUpdate = true;
            return;
        }
        const { mx, my, data } = shadeArea(this.area, this.area.shadow);
        const old = this.uniforms.uShade.value;
        const tex = new THREE.DataTexture(data, mx, my, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        this.uniforms.uShade.value = tex;
        this.uniforms.uShadeCells.value.set(mx, my);
        old?.dispose();
        // (the strength or the kind of area may have changed)
        this.updateObjectShadows();
    }

    /** Draws the baked objects' shadows again (they moved, came or went, or the area changed): the shadow light's map over
     *  the area and its objects, about 6 cm a texel up to 4096 a side. None underground, at strength 0, or with no baked
     *  object (the engine bakes none then either). */
    updateObjectShadows() {
        const area = this.area,
            light = this.shadowSun,
            group = this.objectGroup;
        const casting = group?.visible && group.children.some(c => c.userData.object?.baked !== false && !c.userData.decal);
        const on = !!(area && area.shadow > 0 && !area.enclosed() && casting);
        this.uniforms.uShadowStrength.value = area?.shadow ?? 0;
        this.uniforms.uObjectShadows.value = on;
        if (light.castShadow !== on) light.castShadow = on;
        if (!on) return;
        // Towards the game's sun, (4000, 4500, 7000) in NWN axes, from the middle of the area and everything in it.
        const box = new THREE.Box3().setFromObject(group);
        box.expandByPoint(new THREE.Vector3(0, box.min.y, 0)).expandByPoint(new THREE.Vector3(area.sizeX, box.max.y, area.sizeY));
        const centre = box.getCenter(new THREE.Vector3()),
            reach = box.getSize(new THREE.Vector3()).length();
        light.target.position.copy(centre);
        light.position.copy(centre).addScaledVector(new THREE.Vector3(4000, 7000, -4500).normalize(), reach);
        light.target.updateMatrixWorld();
        light.updateMatrixWorld();
        // The camera's box: the area's and objects' corners as the light sees them.
        const cam = light.shadow.camera;
        cam.position.copy(light.position);
        cam.lookAt(light.target.position);
        cam.updateMatrixWorld();
        const lo = new THREE.Vector3(Infinity, Infinity, Infinity),
            hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        for (let k = 0; k < 8; k++) {
            const p = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
            p.applyMatrix4(cam.matrixWorldInverse);
            lo.min(p);
            hi.max(p);
        }
        Object.assign(cam, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(0.1, -hi.z - 1), far: -lo.z + 1 });
        cam.updateProjectionMatrix();
        const size = Math.min(
            4096,
            this.renderer.capabilities.maxTextureSize,
            2 ** Math.ceil(Math.log2(Math.max(hi.x - lo.x, hi.y - lo.y) / 0.06)),
        );
        if (light.shadow.mapSize.x !== size) {
            light.shadow.mapSize.set(size, size);
            light.shadow.map?.dispose();
            light.shadow.map = null;
        }
        this.renderer.shadowMap.needsUpdate = true;
        // Cut-outs cast through their pictures' alpha, so a picture still loading casts nothing: again once they are all in.
        const loading = [...(this.models?.loaded.values() ?? [])];
        Promise.all(loading).then(() => {
            if (this.uniforms.uObjectShadows.value) this.renderer.shadowMap.needsUpdate = true;
        });
    }

    /** Puts a copy of object `o`'s model where it stands; a baked one casts a shadow, a placeable (object mode) none, as the
     *  engine bakes them. */
    place(inst, o) {
        inst.position.set(o.x, o.z, this.area.sizeY - o.y);
        inst.rotation.y = o.bearing;
        inst.scale.setScalar(o.scale);
        const casts = o.baked !== false;
        inst.traverse(m => {
            if (m.isMesh) m.castShadow = casts;
        });
    }

    /** Uses the texture library to show painted textures. */
    setLibrary(library) {
        this.library = library;
        if (this.area) this.updateEntrances();
        this.paletteKey = null;
        this.syncPalette();
    }

    /** Rebuilds the texture array when the area's palette changed. */
    async syncPalette() {
        if (!this.library || !this.area) return;
        const key = this.area.palette.join(',');
        if (key === this.paletteKey) return;
        this.paletteKey = key;
        const tex = await this.library.buildArray(this.area.palette.slice());
        // An import's picture (exports/<name>.import.view.png).
        const at = this.area.palette.findIndex(id => id.startsWith('@import:'));
        let picture = null;
        if (at >= 0) {
            const name = this.area.palette[at].slice('@import:'.length);
            picture = await new Promise(resolve =>
                new THREE.TextureLoader().load(`/api/import/${encodeURIComponent(name)}`, resolve, undefined, () => resolve(null)),
            );
            if (picture) {
                picture.colorSpace = THREE.SRGBColorSpace;
                picture.wrapS = picture.wrapT = THREE.ClampToEdgeWrapping;
                picture.anisotropy = 4;
            }
        }
        if (key !== this.paletteKey) {
            tex.dispose();
            picture?.dispose();
            return;
        }
        this.uniforms.uImport.value?.dispose();
        this.uniforms.uImport.value = picture ?? new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
        this.uniforms.uImport.value.needsUpdate = !picture;
        this.uniforms.uImportLayer.value = picture ? at : -1;
        this.setLayers(tex.userData.luma, picture && meanLuma(picture.image), at);
        const old = this.uniforms.uTex.value;
        this.uniforms.uTex.value = tex;
        old.dispose();
        if (!this.textured) {
            this.textured = true;
            this.uniforms.uTextured.value = true;
            this.markDirty(this.everything(), false);
        }
    }

    /** Each palette index's edge (the catalog's; an import's is crisp), mean luminance (`luma`, by layer; the import's
     *  `importLuma` at `importAt`) and noise seed, for the soft paint's edges; and the metres a repeat of its texture covers. */
    setLayers(luma, importLuma, importAt) {
        const data = this.uniforms.uLayers.value.image.data;
        data.fill(0);
        for (const [k, id] of this.area.palette.entries()) {
            if (k > 255) break;
            const s = seed(id);
            data[k * 4] = k !== importAt && edgeOf(this.library.byId.get(id)) === 'broken' ? 1 : 0;
            data[k * 4 + 1] = k === importAt && importLuma != null ? importLuma : (luma?.[k] ?? 0.5);
            data[k * 4 + 2] = s & 0xffff;
            data[k * 4 + 3] = s >>> 16;
            const entry = this.library.byId.get(id);
            data[(256 + k) * 4] = metresOf(entry);
            data[(256 + k) * 4 + 1] = k === importAt ? 0 : varyOf(entry, edgeOf(entry));
        }
        this.uniforms.uLayers.value.needsUpdate = true;
    }

    frame() {
        const { sizeX: sx, sizeY: sy } = this.area,
            s = Math.max(sx, sy);
        // The whole area in view, from the south, tilted down ~40 degrees.
        const mid = this.area.heightAt(sx / 2, sy / 2);
        this.controls.target.set(sx / 2, mid, sy / 2);
        this.camera.position.set(sx / 2, mid + s * 0.95, sy / 2 + s * 1.15);
        this.controls.minDistance = 5;
        this.controls.maxDistance = s * 3 + 100;
        this.controls.update();
    }

    // --- The camera from the keyboard (the mouse's: right-drag turns, middle-drag moves, wheel zooms) ----------------

    /** Moves the view along the ground: `right` and `forward` in steps of a tenth of the distance to what it looks at. */
    panBy(right, forward) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const away = new THREE.Vector3(-off.x, 0, -off.z);
        if (away.lengthSq() < 1e-6) away.set(0, 0, -1);
        away.normalize();
        const side = new THREE.Vector3().crossVectors(away, new THREE.Vector3(0, 1, 0)).normalize();
        const move = side.multiplyScalar(right * off.length() * 0.1).add(away.multiplyScalar(forward * off.length() * 0.1));
        this.camera.position.add(move);
        this.controls.target.add(move);
        this.controls.update();
    }

    /** Turns the view round what it looks at: `dTheta` about the vertical, `dPhi` up or down (radians). */
    orbitBy(dTheta, dPhi) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const sph = new THREE.Spherical().setFromVector3(off);
        sph.theta += dTheta;
        sph.phi = Math.min(this.controls.maxPolarAngle, Math.max(0.02, sph.phi + dPhi));
        this.camera.position.copy(this.controls.target).add(off.setFromSpherical(sph));
        this.controls.update();
    }

    /** Moves in (factor < 1) or out, within the limits the wheel has. */
    zoomBy(factor) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const d = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, off.length() * factor));
        this.camera.position.copy(this.controls.target).add(off.setLength(d));
        this.controls.update();
    }

    /** Straight down on what it looks at, from where it is now. */
    topDown() {
        const off = this.camera.position.clone().sub(this.controls.target);
        const sph = new THREE.Spherical().setFromVector3(off);
        sph.phi = 0.02;
        this.camera.position.copy(this.controls.target).add(off.setFromSpherical(sph));
        this.controls.update();
    }

    /** Lays picture `image` (an HTMLImageElement or canvas; null: none) under the ground, as underlay.js keeps it. */
    setUnderlayPicture(image) {
        const old = this.uniforms.uUnder.value;
        const tex = image ? new THREE.Texture(image) : new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        if (image) {
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        }
        tex.needsUpdate = true;
        this.uniforms.uUnder.value = tex;
        old.dispose();
    }

    /** Where the underlay lies: `u` is { x, y (its middle, area metres), w, h (metres), angle (radians, anticlockwise),
     *  opacity (0 to 1), shown }, or null for none. */
    setUnderlayPlace(u) {
        if (!u?.shown || !(u.w > 0) || !(u.h > 0)) {
            this.uniforms.uUnderOpacity.value = 0;
            return;
        }
        const c = Math.cos(u.angle ?? 0),
            s = Math.sin(u.angle ?? 0);
        // Area point p: its offset from the middle turned back by the angle, over the size, plus a half.
        this.uniforms.uUnderM.value.set(
            c / u.w,
            s / u.w,
            -(c * u.x + s * u.y) / u.w + 0.5,
            -s / u.h,
            c / u.h,
            (s * u.x - c * u.y) / u.h + 0.5,
            0,
            0,
            1,
        );
        this.uniforms.uUnderOpacity.value = Math.min(1, Math.max(0, u.opacity ?? 0.6));
    }

    /** The whole area, as a dirty range. */
    everything() {
        return { i0: 0, i1: this.area.nx - 1, j0: 0, j1: this.area.ny - 1 };
    }

    /** Samples `r` (i0..i1, j0..j1) changed: redrawn at the next frame (flush), and their shadows at the next updateShade.
     *  `moved` false: only their colour changed (paint, water, walkability), which the shadows don't depend on; a later
     *  stroke's bake then covers its own change only (after one press of W it covered the whole area, 430 ms against 63). */
    markDirty(r, moved = true) {
        if (!r) return;
        const join = d =>
            d
                ? { i0: Math.min(d.i0, r.i0), i1: Math.max(d.i1, r.i1), j0: Math.min(d.j0, r.j0), j1: Math.max(d.j1, r.j1) }
                : { i0: r.i0, i1: r.i1, j0: r.j0, j1: r.j1 };
        this.dirty = join(this.dirty);
        if (!moved) return;
        this.shadeDirty = join(this.shadeDirty);
        this.groundVersion++;
    }

    /** Entrance `e`'s mouth darkens the shadows round it (entrance.js, darkness): the samples it reaches, as a change of the
     *  ground there, baked at the next updateShade. */
    markEntrance(e) {
        const reach = Math.hypot(e.depth + 1.5, e.width / 2 + 1.5) + SHADE_STEP,
            { nx, ny } = this.area;
        const r = {
            i0: Math.max(0, Math.floor((e.x - reach) / SPACING)),
            i1: Math.min(nx - 1, Math.ceil((e.x + reach) / SPACING)),
            j0: Math.max(0, Math.floor((e.y - reach) / SPACING)),
            j1: Math.min(ny - 1, Math.ceil((e.y + reach) / SPACING)),
        };
        const d = this.shadeDirty;
        this.shadeDirty = d
            ? { i0: Math.min(d.i0, r.i0), i1: Math.max(d.i1, r.i1), j0: Math.min(d.j0, r.j0), j1: Math.max(d.j1, r.j1) }
            : r;
    }

    /** Vertex index of sample (i, j): plane rows run north to south. */
    vertex(i, j) {
        const w = this.win;
        return (w.j0 + w.ny - 1 - j) * w.nx + i - w.i0;
    }

    /** Rectangle i0..i1, j0..j1 cut to the full-detail window, or null when they don't meet. */
    inWindow(i0, i1, j0, j1) {
        const w = this.win,
            r = { i0: Math.max(i0, w.i0), i1: Math.min(i1, w.i0 + w.nx - 1), j0: Math.max(j0, w.j0), j1: Math.min(j1, w.j0 + w.ny - 1) };
        return r.i0 > r.i1 || r.j0 > r.j1 ? null : r;
    }

    flush() {
        this.groundVersion++;
        this.flushedAt = performance.now();
        const area = this.area,
            n = area.nx,
            d = this.dirty;
        this.dirty = null;
        const pos = this.mesh.geometry.attributes.position;
        const col = this.mesh.geometry.attributes.color;
        // A roof that follows the floor (a ceiling height) can move far from an edit: fitted again whole, then redrawn where
        // the fit changed as well (a whole redraw took 86 ms a Dig frame on a 32×32 cave).
        const fit = area.ceilingFit(),
            chasm = area.chasmFit(fit ? fit.shown : area.heights),
            moved = union(fit && this.fitChanged(this.fit, fit), this.chasmChanged(this.chasmFit, chasm));
        this.fit = fit;
        this.chasmFit = chasm;
        const r = moved
            ? { i0: Math.min(d.i0, moved.i0), i1: Math.max(d.i1, moved.i1), j0: Math.min(d.j0, moved.j0), j1: Math.max(d.j1, moved.j1) }
            : d;
        // Heights of the changed rows and a margin (walkability uses neighbours).
        // (on a canvas, out to the quarter vertices round them: the window's edge is drawn between those, see Coarse.seal)
        const q = this.coarse ? QUARTER : 1,
            i0 = Math.max(0, Math.floor((r.i0 - 1) / q) * q),
            i1 = Math.min(n - 1, Math.ceil((r.i1 + 1) / q) * q),
            j0 = Math.max(0, Math.floor((r.j0 - 1) / q) * q),
            j1 = Math.min(area.ny - 1, Math.ceil((r.j1 + 1) / q) * q);
        const gap = this.mesh.geometry.attributes.aGap,
            deep = this.mesh.geometry.attributes.aDeep,
            shift = this.mesh.geometry.attributes.aShift,
            upright = area.kind === 'interior',
            shownHeights = chasm ? chasm.shown : fit ? fit.shown : area.heights;
        // (the edge scenery carries these out)
        this.drawn = shownHeights;
        // The colour range of the untextured ground (with the library's textures it isn't used).
        let lo = Infinity,
            hi = -Infinity;
        if (!this.textured)
            for (const v of area.heights) {
                if (v < lo) lo = v;
                if (v > hi) hi = v;
            }
        const span = Math.max(hi - lo, 1);
        const c = new THREE.Color();
        this.colourOf = (i, j, out) => this.sampleColour(i, j, out, lo, span);
        this.coarse?.update({ i0, i1, j0, j1 });
        const inside = this.inWindow(i0, i1, j0, j1) ?? { i0: 0, i1: -1, j0: 0, j1: -1 };
        for (let j = inside.j0; j <= inside.j1; j++) {
            for (let i = inside.i0; i <= inside.i1; i++) {
                const v = this.vertex(i, j),
                    z = area.heights[j * n + i],
                    shown = shownHeights[j * n + i];
                pos.setY(v, shown);
                // An interior's walls upright, as the game draws them.
                const [dx, dy] = upright ? uprightShift(shownHeights, n, area.ny, i, j) : [0, 0];
                pos.setX(v, i * SPACING + dx);
                pos.setZ(v, area.sizeY - j * SPACING - dy);
                shift.setXY(v, dx, dy);
                gap.setX(v, !area.enclosed() ? 1e9 : fit ? fit.ceiling[j * n + i] - shown : area.roof - shown);
                deep.setX(v, chasm ? chasm.deep[j * n + i] : 0);
                this.sampleColour(i, j, c, lo, span, z);
                col.setXYZ(v, c.r, c.g, c.b);
            }
        }
        this.coarse?.seal(pos, inside);
        for (const a of [pos, gap, deep, col, shift]) this.uploadRows(a, i0, i1, j0, j1);
        // A foot depends on its neighbour's neighbours: a sample further out.
        const wall = this.mesh.geometry.attributes.aWall,
            [w0, w1, v0, v1] = [Math.max(0, i0 - 1), Math.min(n - 1, i1 + 1), Math.max(0, j0 - 1), Math.min(area.ny - 1, j1 + 1)];
        const wi = this.inWindow(w0, w1, v0, v1) ?? { i0: 0, i1: -1, j0: 0, j1: -1 };
        for (let j = wi.j0; j <= wi.j1; j++)
            for (let i = wi.i0; i <= wi.i1; i++) {
                const top = upright && uprightShift(shownHeights, n, area.ny, i, j).some(d => d !== 0);
                wall.setXY(this.vertex(i, j), upright && uprightFoot(shownHeights, n, area.ny, i, j) ? 1 : 0, top ? 1 : 0);
            }
        this.uploadRows(wall, w0, w1, v0, v1);
        this.uploadPaint(i0, i1, j0, j1);
        this.refreshSoft(r);
        // Only what the change reaches: on a 32×32 area each of these over the whole mesh took most of a 245 ms frame.
        this.updateNormals(i0 - REACH, i1 + REACH, j0 - REACH, j1 + REACH);
        this.updateBounds(i0, i1, j0, j1);
        this.updateGrid({ i0, i1, j0, j1 });
        // (the edge scenery carries the outer rows and columns out: a fifth of a stroke's redraw, for a stroke far from them)
        if (i0 === 0 || j0 === 0 || i1 === n - 1 || j1 === area.ny - 1) {
            this.updateSkirt();
            // (the band's inner edge is the area's)
            if (area.band) this.markBand();
        }
    }

    /** A canvas's full-detail window follows what the camera looks at, once the ground has been still a moment: never in the
     *  middle of a stroke. Off while the whole canvas is shown at a quarter of the detail (setWindow(null)). */
    followWindow() {
        if (!this.coarse || this.windowPinned || !this.mesh.visible || performance.now() - (this.flushedAt ?? 0) < 400) return;
        const t = this.controls.target,
            a = this.area,
            next = windowAt(a, t.x, a.sizeY - t.z);
        if (next.i0 !== this.win.i0 || next.j0 !== this.win.j0) this.setWindow(next);
    }

    /** Sample (i, j)'s vertex colour into `c`: white over paint (red where it can't be walked, with Walkability on), or by
     *  height (`lo`, `span`) before the textures load. */
    sampleColour(i, j, c, lo, span, z = this.area.heights[j * this.area.nx + i]) {
        const area = this.area,
            k = j * area.nx + i;
        // Under water the water shows it; no red tint. (Nor in a chasm: it is dark.)
        const wet = !Number.isNaN(area.waterLevel[k]);
        if (this.chasmFit?.deep[k]) c.copy(this.textured ? WHITE : ROCK);
        else if (this.textured) {
            // White leaves the painted texture as it is.
            if (wet || area.walkable(i, j) || !this.showWalkability) c.setRGB(1, 1, 1);
            else c.copy(BLOCKED_TINT);
        } else if (area.walkable(i, j)) {
            c.copy(GRASS_LOW).lerp(GRASS_HIGH, (z - lo) / span);
        } else {
            c.copy(this.showWalkability ? BLOCKED : ROCK);
        }
        return c;
    }

    /**
     * Ground attribute `attr` goes to the GPU at the next draw for samples i0..i1, j0..j1 only (clamped to the area): one range
     * from the first of them to the last, the rows between whole, as one upload. Whole buffers were 12.7 MB a stroke frame on a
     * 32×32 area, ranges 0.67 MB, and the frame took 3.6 ms instead of 7.3 (a GeForce GTX 1050). The whole of it when that is
     * the whole area, and until a whole upload asked for has been made.
     */
    uploadRows(attr, i0, i1, j0, j1) {
        const w = this.win,
            r = this.inWindow(i0, i1, j0, j1);
        if (!r) return;
        ({ i0, i1, j0, j1 } = r);
        attr.needsUpdate = true;
        if (wholeLeft(attr, i0 === w.i0 && j0 === w.j0 && i1 === w.i0 + w.nx - 1 && j1 === w.j0 + w.ny - 1)) return;
        // (rows run north to south: the northmost row's first vertex comes first)
        const first = this.vertex(i0, j1),
            last = this.vertex(i1, j0);
        attr.addUpdateRange(first * attr.itemSize, (last - first + 1) * attr.itemSize);
    }

    /** The paint texture (uMat) goes to the GPU at the next draw for samples i0..i1, j0..j1 only (clamped), a range a row: three.js
     *  uploads a texture's ranges a row at a time. The whole of it as uploadRows sends a whole buffer. */
    uploadPaint(i0, i1, j0, j1) {
        const tex = this.uniforms.uMat.value,
            { nx, ny } = this.area;
        i0 = Math.max(0, i0);
        j0 = Math.max(0, j0);
        i1 = Math.min(nx - 1, i1);
        j1 = Math.min(ny - 1, j1);
        tex.needsUpdate = true;
        if (wholeLeft(tex, i0 === 0 && j0 === 0 && i1 === nx - 1 && j1 === ny - 1)) return;
        // (three.js counts a texture's ranges in RGBA components, 4 a texel, and uploads them in texels of the texture's own
        // format: one byte each here)
        for (let j = j0; j <= j1; j++) tex.addUpdateRange((j * nx + i0) * 4, (i1 - i0 + 1) * 4);
    }

    /** The soft paint (softpaint.js) for the area as it is now, sent to the GPU whole. */
    buildSoft() {
        this.soft = new SoftGrid(this.area, SPACING);
        const { nx, ny, origin, out } = this.soft;
        this.uniforms.uSoft.value.dispose();
        const tex = new THREE.DataTexture(out, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.minFilter = tex.magFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        this.uniforms.uSoft.value = tex;
        this.uniforms.uSoftN.value.set(nx, ny);
        this.uniforms.uSoftOrigin.value = origin;
    }

    /** The paint changed over area samples `r` (null: anywhere in the band): smoothed again as far as it reaches, and only that
     *  sent to the GPU (a row at a time, as uploadPaint). */
    refreshSoft(r) {
        if (!this.soft?.fits(this.area)) {
            this.buildSoft();
            return;
        }
        const s = this.soft.refresh(r);
        if (!s) return;
        const tex = this.uniforms.uSoft.value,
            { nx, ny } = this.soft;
        tex.needsUpdate = true;
        if (wholeLeft(tex, s.i0 === 0 && s.j0 === 0 && s.i1 === nx - 1 && s.j1 === ny - 1)) return;
        for (let j = s.j0; j <= s.j1; j++) tex.addUpdateRange((j * nx + s.i0) * 4, (s.i1 - s.i0 + 1) * 4);
    }

    /** The samples whose ceiling or drawn height differ between ceiling fits `was` and `now` (i0..i1, j0..j1), null when none
     *  do; the whole area when there was no fit before. */
    fitChanged(was, now) {
        const { nx } = this.area;
        if (!was || was.shown.length !== now.shown.length) return this.everything();
        let i0 = Infinity,
            i1 = -1,
            j0 = Infinity,
            j1 = -1;
        for (let k = 0; k < now.shown.length; k++) {
            if (was.shown[k] === now.shown[k] && was.ceiling[k] === now.ceiling[k]) continue;
            const i = k % nx,
                j = (k - i) / nx;
            if (i < i0) i0 = i;
            if (i > i1) i1 = i;
            if (j < j0) j0 = j;
            j1 = j;
        }
        return i1 < 0 ? null : { i0, i1, j0, j1 };
    }

    /** The samples whose drawn height differs between chasm fits `was` and `now` (i0..i1, j0..j1), null when none do: a chasm
     *  sample's rim is the nearest ground's, which can be far from an edit. The whole area when a chasm came or went. */
    chasmChanged(was, now) {
        if (!was && !now) return null;
        if (!was || !now || was.shown.length !== now.shown.length) return this.everything();
        const { nx } = this.area;
        let i0 = Infinity,
            i1 = -1,
            j0 = Infinity,
            j1 = -1;
        for (let k = 0; k < now.shown.length; k++) {
            if (was.shown[k] === now.shown[k] && was.deep[k] === now.deep[k]) continue;
            const i = k % nx,
                j = (k - i) / nx;
            if (i < i0) i0 = i;
            if (i > i1) i1 = i;
            if (j < j0) j0 = j;
            j1 = j;
        }
        return i1 < 0 ? null : { i0, i1, j0, j1 };
    }

    /** The ground's normals at samples i0..i1, j0..j1 (clamped to the area), from its drawn heights, as landscaper gives them to
     *  the game (normals.js), and each sample's own slope's up part for the steep test (aUp). */
    updateNormals(i0, i1, j0, j1) {
        const { nx, ny } = this.area,
            geo = this.mesh.geometry,
            y = this.drawn,
            nor = geo.attributes.normal,
            up = geo.attributes.aUp,
            r = this.inWindow(i0, i1, j0, j1);
        if (!r) return;
        ({ i0, i1, j0, j1 } = r);
        // (three.js's y is up and its z runs south; the drawn heights, so a window's edge has its neighbours outside it)
        groundNormals(
            (i, j) => y[j * nx + i],
            nx,
            ny,
            SPACING,
            i0,
            i1,
            j0,
            j1,
            (i, j, n, near) => {
                const v = this.vertex(i, j);
                nor.setXYZ(v, n[0], n[2], -n[1]);
                up.setX(v, near[2]);
            },
        );
        this.uploadRows(nor, i0, i1, j0, j1);
        this.uploadRows(up, i0, i1, j0, j1);
    }

    /** The ground's bounds (for picking): worked out whole when everything changed, else grown to the changed heights. A
     *  box that is too tall after the ground is lowered only costs the picking an early miss. */
    updateBounds(i0, i1, j0, j1) {
        const geo = this.mesh.geometry,
            w = this.win,
            r = this.inWindow(i0, i1, j0, j1);
        if (!r) return;
        ({ i0, i1, j0, j1 } = r);
        if (!geo.boundingBox || (i0 === w.i0 && j0 === w.j0 && i1 === w.i0 + w.nx - 1 && j1 === w.j0 + w.ny - 1)) {
            geo.computeBoundingBox();
            geo.computeBoundingSphere();
            return;
        }
        const y = geo.attributes.position.array,
            box = geo.boundingBox;
        for (let j = j0; j <= j1; j++)
            for (let i = i0; i <= i1; i++) {
                const v = y[this.vertex(i, j) * 3 + 1];
                if (v < box.min.y) box.min.y = v;
                if (v > box.max.y) box.max.y = v;
            }
        box.getBoundingSphere(geo.boundingSphere);
    }

    /** Entrances as the game will show them: the roof in the hill's paint,
     *  its rock, the dark back, and the door (orange) to link. */
    updateEntrances() {
        if (this.entranceGroup) {
            this.scene.remove(this.entranceGroup);
            this.entranceGroup.traverse(c => {
                c.geometry?.dispose();
                if (c.material && !c.material.userData.shared) c.material.dispose();
            });
        }
        this.entranceGroup = new THREE.Group();
        const area = this.area,
            size = area.sizeY,
            height = (x, y) => area.heightAt(x, y);
        // Texture coordinates as landscaper writes them: from above, and
        // tilted with height for the rock.
        const flat = (x, y) => [x / 4, y / 4];
        const tilted = (x, y, z) => [(x + 0.6 * z) / 4, (y - 0.4 * z) / 4];
        const mesh = (tris, uvOf, material) => {
            const pos = [],
                uv = [];
            for (let k = 0; k < tris.length; k += 3) {
                const [x, y, z] = [tris[k], tris[k + 1], tris[k + 2]];
                pos.push(x, z, size - y);
                uv.push(...uvOf(x, y, z));
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            g.computeVertexNormals();
            return new THREE.Mesh(g, material);
        };
        for (const e of area.entrances) {
            const sc = entranceScenery(e, height);
            const hill = groundBehind(area, e);
            this.blackMaterial ??= Object.assign(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }), {
                userData: { shared: true },
            });
            this.entranceGroup.add(
                mesh(sc.top, flat, this.libraryMaterial(hill, 0x5d7a3a)),
                mesh(sc.rock, tilted, this.libraryMaterial(e.rock ?? 'rockCliff', 0x77716a)),
                mesh(sc.back, flat, this.blackMaterial),
            );
            const door = new THREE.Mesh(
                new THREE.PlaneGeometry(e.width * 0.8, 2.2),
                new THREE.MeshBasicMaterial({ color: 0xff9a1f, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
            );
            const [dx, dy] = entranceAt(e, e.depth - 0.15, 0);
            door.position.set(dx, e.floor + 1.1, size - dy);
            door.rotation.y = e.dir + Math.PI / 2;
            this.entranceGroup.add(door);
        }
        this.scene.add(this.entranceGroup);
    }

    /** Placed objects, from the model library (set by the app). The models' geometry and materials are the library's,
     *  shared by every copy and kept; what this group made itself (the ground patches) is freed with it. */
    async updateObjects() {
        if (this.objectGroup) {
            this.scene.remove(this.objectGroup);
            for (const c of this.objectGroup.children) if (c.userData.decal) disposeDecal(c);
        }
        const group = new THREE.Group();
        group.visible = this.showScenery !== false;
        this.objectGroup = group;
        this.scene.add(group);
        this.updateObjectShadows();
        if (!this.models) return;
        // All at once, each drawn as its model arrives. (syncObjects waits for this to end before matching what is drawn.)
        this.objectsLoading = group;
        await Promise.all(
            this.area.objects.map(async o => {
                let model;
                try {
                    model = await this.models.group(o.model);
                } catch {
                    return;
                }
                if (group !== this.objectGroup) return; // rebuilt meanwhile
                const inst = model.clone();
                this.place(inst, o);
                inst.userData.object = o;
                group.add(inst);
                this.addDecal(group, o, model.userData.flat);
                if (o === this.selected) this.showSelection(inst);
            }),
        );
        if (this.objectsLoading === group) this.objectsLoading = null;
        if (group === this.objectGroup) this.updateObjectShadows();
    }

    /** Draws the area's objects again after undo or redo, which gives the area new copies of them all: each one drawn is
     *  matched to its copy by id and moved if it moved, and only those added, taken out or given another model are drawn
     *  again or taken away (updateObjects cloned all 300 of an area's rocks again, 226 ms). */
    syncObjects() {
        const group = this.objectGroup,
            objects = this.area.objects,
            byId = new Map(objects.map(o => [o.id, o]));
        // (ids missing or given twice, or models still arriving for the objects drawn: all of them again)
        if (!group || !this.models || this.objectsLoading || byId.size !== objects.length || byId.has(undefined)) {
            this.updateObjects();
            return;
        }
        const gone = new Set(),
            moved = new Set(),
            drawn = new Set();
        for (const c of group.children) {
            const was = c.userData.object,
                now = byId.get(was.id);
            if (!now || now.model !== was.model) {
                gone.add(was);
                continue;
            }
            c.userData.object = now;
            if (!c.userData.decal) drawn.add(now);
            // (a ground patch follows the ground, which undo may have moved: drawn again with its object)
            if (c.userData.decal || ['x', 'y', 'z', 'bearing', 'scale'].some(k => now[k] !== was[k])) moved.add(now);
        }
        this.removeObjects(gone);
        for (const o of moved) if (drawn.has(o)) this.moveObject(o);
        for (const o of objects) if (!drawn.has(o)) this.addObject(o);
    }

    /** Draws object `o` where it now is (moved, turned or sized), its model and its ground patch, without rebuilding the
     *  others: a drag calls it on every pointer move. Rebuilds them all when `o` isn't drawn yet. */
    moveObject(o) {
        const group = this.objectGroup;
        const inst = group?.children.find(c => c.userData.object === o && !c.userData.decal);
        if (!inst) {
            this.updateObjects();
            return;
        }
        this.place(inst, o);
        const old = group.children.find(c => c.userData.object === o && c.userData.decal);
        if (old) {
            group.remove(old);
            disposeDecal(old);
        }
        this.addDecal(group, o, inst.userData.flat);
        if (o === this.selected) this.showSelection(inst);
        this.updateObjectShadows();
    }

    /** An imported thing's patch of ground, draped on the ground where it
     *  stands (turned and scaled with it), as the export paints it. */
    addDecal(group, o, flat) {
        const d = flat?.decal;
        if (!d) return;
        const name = o.model.slice('@import:'.length).split(':')[0];
        const [x0, y0, x1, y1] = d.rect,
            n = 8,
            c = Math.cos(o.bearing),
            s = Math.sin(o.bearing),
            area = this.area;
        const pos = [],
            uv = [],
            index = [];
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                const u = x0 + ((x1 - x0) * i) / n,
                    v = y0 + ((y1 - y0) * j) / n;
                const x = o.x + (c * u - s * v) * o.scale,
                    y = o.y + (s * u + c * v) * o.scale;
                pos.push(
                    x,
                    area.heightAt(Math.min(area.sizeX, Math.max(0, x)), Math.min(area.sizeY, Math.max(0, y))) + 0.04,
                    area.sizeY - y,
                );
                uv.push(i / n, j / n);
            }
        }
        for (let j = 0; j < n; j++)
            for (let i = 0; i < n; i++) {
                const a = j * (n + 1) + i;
                index.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
            }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);
        geo.computeVertexNormals();
        const map = this.models.picture(`/api/import-file/${encodeURIComponent(name)}/${encodeURIComponent(d.file)}`);
        const mesh = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({
                map,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -2,
                polygonOffsetUnits: -2,
                side: THREE.DoubleSide,
            }),
        );
        mesh.renderOrder = 1;
        mesh.userData.object = o;
        mesh.userData.decal = true;
        group.add(mesh);
    }

    /** Adds one object's model to the view (painting many at once). */
    async addObject(o) {
        const group = this.objectGroup;
        if (!group || !this.models) return;
        let model;
        try {
            model = await this.models.group(o.model);
        } catch {
            return;
        }
        if (group !== this.objectGroup || !this.area.objects.includes(o)) return;
        const inst = model.clone();
        this.place(inst, o);
        inst.userData.object = o;
        group.add(inst);
        this.applyCut(inst);
        this.addDecal(group, o, model.userData.flat);
        this.updateObjectShadows();
    }

    /** Adds many objects' models to the view, the shadows worked out once at the end (each addObject works them out). */
    async addObjects(list) {
        const group = this.objectGroup;
        if (!group || !this.models) return;
        const loaded = await Promise.all(
            list.map(o =>
                this.models.group(o.model).then(
                    m => [o, m],
                    () => null,
                ),
            ),
        );
        if (group !== this.objectGroup) return;
        const still = new Set(this.area.objects);
        for (const [o, model] of loaded.filter(Boolean)) {
            if (!still.has(o)) continue;
            const inst = model.clone();
            this.place(inst, o);
            inst.userData.object = o;
            group.add(inst);
            this.addDecal(group, o, model.userData.flat);
        }
        this.updateObjectShadows();
    }

    /** Cuts the imported tiles' roofs and upper floors away above `h` metres (null: shows them whole). Only imported tile
     *  models are cut: the ground, things and anything else stay as they are. */
    setCut(h) {
        this.cut = h;
        if (h != null) this.cutPlane.constant = h;
        if (this.objectGroup) for (const c of this.objectGroup.children) this.applyCut(c);
    }

    applyCut(inst) {
        if (!inst.userData.object?.model?.startsWith('@import:')) return;
        const planes = this.cut == null ? [] : [this.cutPlane];
        inst.traverse(m => {
            if (!m.material) return;
            for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
                mat.clippingPlanes = planes;
                mat.needsUpdate = true;
            }
        });
    }

    /** Takes objects (a Set) out of the view. */
    removeObjects(gone) {
        if (!this.objectGroup) return;
        for (const c of [...this.objectGroup.children])
            if (gone.has(c.userData.object)) {
                this.objectGroup.remove(c);
                if (c.userData.decal) disposeDecal(c);
            }
        this.updateObjectShadows();
    }

    /**
     * The things placed in the area (creatures, waypoints, triggers, sounds...) and, greyed, the imported area's
     * own objects (`ghosts`): each kind has its own colour and shape, standing on the ground with an arrow for the
     * way it faces; a trigger's or encounter's outline is a filled, draped polygon with a ribbon round it and a post
     * at each corner. The one selected (`selectedId`/`selectedKey`) is white. `draft` is an outline being drawn. `inert`:
     * to look at only, nothing can be picked. A door or placeable whose model is known (`thingModel(t)`, set by the Things tool)
     * is drawn as that model instead (see thingModelAt).
     */
    setThings(things, selectedId = null, draft = null, ghosts = [], selectedKey = null, inert = false) {
        this.lastThings = [things, selectedId, draft, ghosts, selectedKey, inert];
        const models = this.beginThingModels();
        // An outline's fill and ribbon are kept while its shape, colour, selection and the ground stay the same: a drag
        // makes only the dragged one again (500 triggers took 72 ms a frame).
        const free = c => {
            // (the markers' shapes are kept for the next time; a batch frees its copies' places and colours)
            if (!c.userData.sharedGeometry) c.geometry?.dispose();
            if (c.isInstancedMesh) c.dispose();
            c.material?.dispose?.();
        };
        const before = this.thingOutlines ?? new Map(),
            keep = new Set([...before.values()].flat());
        this.thingOutlines = new Map();
        if (this.thingGroup) {
            this.scene.remove(this.thingGroup);
            this.thingGroup.traverse(c => {
                if (!keep.has(c)) free(c);
            });
        }
        const group = new THREE.Group();
        this.thingGroup = group;
        this.scene.add(group);
        if (!this.area) {
            for (const m of keep) free(m);
            models.end();
            return;
        }
        const area = this.area,
            size = area.sizeY;
        const at = (x, y, lift = 0) => new THREE.Vector3(x, area.floorAt(x, y) + lift, size - y);
        const GREY = new THREE.Color(0x8a929b);
        // The colour a thing is drawn in: its kind's, or white when selected; an original's is the kind's washed toward grey.
        const tone = (kind, sel, ghost) => {
            if (sel) return new THREE.Color(0xffffff);
            const c = new THREE.Color(THING_COLOURS[kind] ?? 0xffffff);
            return ghost ? c.lerp(GREY, 0.2) : c;
        };
        // (Out of the Things tool the markers are only to look at: nothing to pick.)
        this.thingsInert = inert;
        const tag = (m, id) => {
            m.userData.thing = id;
            return m;
        };

        /** A ribbon of `width` metres along the outline, draped on the ground (thin GL lines vanish at a distance). */
        const ribbon = (pts, width, c, closed = true, ghost = false) => {
            const n = pts.length,
                samples = [];
            for (let i = 0; i < (closed ? n : n - 1); i++) {
                const [ax, ay] = pts[i],
                    [bx, by] = pts[(i + 1) % n];
                const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
                for (let j = 0; j < k; j++) samples.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]);
            }
            if (!closed) samples.push(pts[n - 1]);
            const m = samples.length,
                pos = [],
                idx = [];
            for (let i = 0; i < m; i++) {
                const prev = samples[(i - 1 + m) % m],
                    next = samples[(i + 1) % m];
                const lo = closed || i > 0 ? prev : samples[i],
                    hi = closed || i < m - 1 ? next : samples[i];
                let tx = hi[0] - lo[0],
                    ty = hi[1] - lo[1];
                const len = Math.hypot(tx, ty) || 1;
                tx /= len;
                ty /= len;
                const [x, y] = samples[i],
                    nx = (-ty * width) / 2,
                    ny = (tx * width) / 2;
                for (const sgn of [1, -1]) {
                    const v = at(x + nx * sgn, y + ny * sgn, 0.2);
                    pos.push(v.x, v.y, v.z);
                }
                if (i < m - 1 || closed) {
                    const a = i * 2,
                        b = ((i + 1) % m) * 2;
                    idx.push(a, a + 1, b, a + 1, b + 1, b);
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            const mesh = new THREE.Mesh(
                g,
                new THREE.MeshBasicMaterial({
                    color: c,
                    side: THREE.DoubleSide,
                    depthTest: false,
                    transparent: ghost,
                    opacity: ghost ? 0.9 : 1,
                }),
            );
            mesh.renderOrder = 5;
            return mesh;
        };

        /** The polygon filled, draped: triangulated, then cut small enough to follow the ground. */
        const fill = (pts, c, opacity) => {
            const tris = THREE.ShapeUtils.triangulateShape(
                pts.map(([x, y]) => new THREE.Vector2(x, y)),
                [],
            );
            const pos = [];
            const put = p => {
                const v = at(p[0], p[1], 0.12);
                pos.push(v.x, v.y, v.z);
            };
            const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
            const cut = (a, b, d, depth) => {
                if (
                    depth >= 5 ||
                    Math.max(
                        Math.hypot(a[0] - b[0], a[1] - b[1]),
                        Math.hypot(b[0] - d[0], b[1] - d[1]),
                        Math.hypot(d[0] - a[0], d[1] - a[1]),
                    ) <= 2
                ) {
                    put(a);
                    put(b);
                    put(d);
                    return;
                }
                const ab = mid(a, b),
                    bd = mid(b, d),
                    da = mid(d, a);
                cut(a, ab, da, depth + 1);
                cut(ab, b, bd, depth + 1);
                cut(da, bd, d, depth + 1);
                cut(ab, bd, da, depth + 1);
            };
            for (const [i, j, k] of tris) cut(pts[i], pts[j], pts[k], 0);
            if (!pos.length) return null;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            const mesh = new THREE.Mesh(
                g,
                new THREE.MeshBasicMaterial({
                    color: c,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity,
                    depthWrite: false,
                    polygonOffset: true,
                    polygonOffsetFactor: -2,
                }),
            );
            mesh.renderOrder = 4;
            return mesh;
        };

        // Markers, corner posts and facing lines go in batches: one draw for each shape, solid or see-through (the originals),
        // each copy with its own place and colour. As a mesh and a material for every part, 500 things were 1,800 objects
        // and 1,900 draws, all made again on every frame of a drag (54 ms).
        const batches = new Map(),
            lines = [
                { pos: [], col: [] },
                { pos: [], col: [] },
            ];
        const batch = (geo, ghost, matrix, c, id = null) => {
            const key = `${geo.uuid}:${ghost}`;
            if (!batches.has(key)) batches.set(key, { geo, ghost, items: [] });
            batches.get(key).items.push({ matrix, c, id });
        };
        const shape = make => {
            this.thingShapes ??= new Map();
            if (!this.thingShapes.has(make)) this.thingShapes.set(make, make(MARKER_SIZE));
            return this.thingShapes.get(make);
        };

        /** A marker of the kind's own shape standing at `p`; every part picks as `id`. */
        const marker = (kind, p, c, sel, ghost, id) => {
            const grow = sel ? 1.25 : 1,
                k = grow * MARKER_SIZE;
            for (const part of MARKER_PARTS[kind] ?? OTHER_MARKER) {
                const matrix = new THREE.Matrix4().compose(
                    new THREE.Vector3(p.x, p.y + (part.fixed ? part.y : part.y * k), p.z),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rot ?? [0, 0, 0]))),
                    new THREE.Vector3(grow, grow, grow),
                );
                batch(shape(part.geo), ghost, matrix, c, id);
            }
        };

        /** The way a creature, door, placeable or waypoint faces: a line from the marker (bearing 0 faces east, as the game's). */
        const facing = (p, bearing, c, ghost) => {
            const dir = new THREE.Vector3(Math.cos(bearing ?? 0), 0, -Math.sin(bearing ?? 0));
            const a = p.clone().add(new THREE.Vector3(0, 0.3, 0)),
                b = a.clone().addScaledVector(dir, 1.6);
            const l = lines[ghost ? 1 : 0];
            l.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
            l.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        };

        /** The whole of one thing, the editor's or an original's. */
        const draw = (t, id, sel, ghost) => {
            const c = tone(t.kind, sel, ghost);
            const hasOutline = t.outline?.length >= 3;
            // (a door pushed into an interior's wall goes onto its line, as the engine places it)
            const p = hasOutline
                ? at(t.outline[0][0], t.outline[0][1])
                : t.kind === 'door' && !ghost
                  ? at(...area.wallFoot(t.x, t.y))
                  : at(t.x, t.y);
            // A door or placeable as its model, once it is in (its marker until then, and when it has none).
            if (!hasOutline && models.put(t, id, p, sel, ghost)) return;
            marker(t.kind, p, c, sel, ghost, id);
            if (hasOutline) {
                const key = `${this.groundVersion}|${id}|${sel}|${ghost}|${c.getHexString()}|${t.outline.join(';')}`;
                let meshes = before.get(key);
                if (meshes) before.delete(key);
                else
                    meshes = [
                        fill(t.outline, c, sel ? 0.42 : ghost ? 0.26 : 0.34),
                        tag(ribbon(t.outline, sel ? 0.6 : 0.42, c, true, ghost), id),
                    ].filter(Boolean);
                this.thingOutlines.set(key, meshes);
                group.add(...meshes);
                // A post at every corner, so the shape reads from far away; the selected one's are the handles.
                let corner = 0;
                for (const [x, y] of t.outline) {
                    if (sel) {
                        // A big invisible ball over the post: what a press on a corner grabs.
                        const grab = new THREE.Mesh(
                            new THREE.SphereGeometry(0.9, 8, 6),
                            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
                        );
                        const gq = at(x, y, 0.5);
                        grab.position.copy(gq);
                        grab.userData.corner = { id, index: corner };
                        group.add(grab);
                    }
                    corner++;
                    const q = at(x, y);
                    const matrix = new THREE.Matrix4().makeScale(sel ? 1.8 : 1, sel ? 1.5 : 1, sel ? 1.8 : 1);
                    matrix.setPosition(q.x, q.y + (sel ? 0.6 : 0.4), q.z);
                    batch(shape(POST), ghost, matrix, c);
                }
            } else if (['creature', 'door', 'placeable', 'waypoint', 'store'].includes(t.kind)) {
                facing(p, t.bearing, c, ghost);
            }
        };
        for (const g of ghosts) draw(g, g.key, g.key === selectedKey, true);
        for (const t of things) draw(t, t.id, t.id === selectedId, false);
        models.end();
        // (the outlines that changed or went: their old meshes)
        for (const meshes of before.values()) for (const m of meshes) free(m);
        for (const { geo, ghost, items } of batches.values()) {
            const mesh = new THREE.InstancedMesh(
                geo,
                new THREE.MeshBasicMaterial({ transparent: ghost, opacity: ghost ? 0.8 : 1 }),
                items.length,
            );
            items.forEach(({ matrix, c }, k) => {
                mesh.setMatrixAt(k, matrix);
                mesh.setColorAt(k, c);
            });
            mesh.computeBoundingSphere();
            // (what each copy picks as; the posts pick as nothing)
            if (items.some(it => it.id != null)) mesh.userData.things = items.map(it => it.id);
            mesh.userData.sharedGeometry = true;
            group.add(mesh);
        }
        lines.forEach(({ pos, col }, ghost) => {
            if (!pos.length) return;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            const l = new THREE.LineSegments(
                g,
                new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: !!ghost, opacity: ghost ? 0.6 : 1 }),
            );
            l.renderOrder = 5;
            group.add(l);
        });
        if (draft?.length) {
            const white = new THREE.Color(0xffffff);
            if (draft.length >= 3) {
                const f = fill(draft, white, 0.2);
                if (f) group.add(f);
            }
            if (draft.length >= 2) group.add(ribbon(draft, 0.35, white, false));
            for (const [x, y] of draft) {
                const c = new THREE.Mesh(
                    new THREE.SphereGeometry(0.35, 8, 6),
                    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
                );
                c.position.copy(at(x, y, 0.3));
                c.renderOrder = 6;
                group.add(c);
            }
        }
    }

    /** Draws the things again as last given (a model they wait for has come in), once a frame however many come. */
    redrawThings() {
        if (this.thingsRedraw || !this.lastThings) return;
        this.thingsRedraw = requestAnimationFrame(() => {
            this.thingsRedraw = 0;
            if (this.lastThings) this.setThings(...this.lastThings);
        });
    }

    /** The model `name` as the library's group, or null while it comes in (setThings is drawn again then), if it can't be read, or
     *  if it has nothing to draw (a tile door the tile itself shows: doortypes.2da's VisibleModel 0). Each model is read once,
     *  however many doors have it. */
    thingModelAt(name) {
        this.thingLoaded ??= new Map();
        if (!this.thingLoaded.has(name)) {
            this.thingLoaded.set(name, null);
            this.models?.group(name).then(
                g => {
                    if (!g.children.length) return;
                    this.thingLoaded.set(name, g);
                    this.redrawThings();
                },
                () => {},
            );
        }
        return this.thingLoaded.get(name);
    }

    /**
     * The things drawn as their models in one setThings: `put(t, id, p, sel, ghost)` stands thing `t`'s model at `p`, turned by
     * its bearing (as the Place tool's objects: bearing 0 is the model as made), and is false when it has none to draw; `end()`
     * takes away the ones not put again. Each thing keeps its copy between calls (a drag only moves it). A copy shares the
     * library's geometry; an original's has the model's materials washed toward grey, as its marker is, made once a model. The
     * selected one has a white box round it.
     */
    beginThingModels() {
        if (!this.thingModelGroup) {
            this.thingModelGroup = new THREE.Group();
            this.scene.add(this.thingModelGroup);
            this.thingCopies = new Map();
            this.thingWashed = new Map();
        }
        const group = this.thingModelGroup,
            copies = this.thingCopies,
            used = new Set();
        let selected = null;
        const washed = (name, model) => {
            if (!this.thingWashed.has(name))
                this.thingWashed.set(
                    name,
                    model.children.map(m => {
                        const w = m.material.clone();
                        w.color.set(0xb4bac2);
                        w.emissive = new THREE.Color(0x30353b);
                        return w;
                    }),
                );
            return this.thingWashed.get(name);
        };
        const put = (t, id, p, sel, ghost) => {
            if (!this.area || !this.models) return false;
            const name = this.thingModel?.(t);
            const model = name ? this.thingModelAt(name) : null;
            if (!model) return false;
            const key = `${ghost ? 'o' : 't'}:${id}`;
            let copy = copies.get(key);
            if (copy && (copy.userData.model !== name || copy.userData.ghost !== ghost)) {
                group.remove(copy);
                copy = null;
            }
            if (!copy) {
                const materials = ghost ? washed(name, model) : null;
                copy = new THREE.Group();
                for (const [i, m] of model.children.entries()) copy.add(new THREE.Mesh(m.geometry, materials?.[i] ?? m.material));
                copy.userData = { model: name, ghost };
                copies.set(key, copy);
                group.add(copy);
            }
            for (const m of copy.children) m.userData.thing = id;
            copy.position.copy(p);
            copy.rotation.y = t.bearing ?? 0;
            used.add(key);
            if (sel) selected = copy;
            return true;
        };
        const end = () => {
            for (const [key, copy] of copies)
                if (!used.has(key)) {
                    group.remove(copy);
                    copies.delete(key);
                }
            if (selected) {
                selected.updateMatrixWorld(true);
                this.thingBox ??= new THREE.BoxHelper(selected, 0xffffff);
                this.thingBox.setFromObject(selected);
                if (!this.thingBox.parent) this.scene.add(this.thingBox);
            } else if (this.thingBox?.parent) {
                this.scene.remove(this.thingBox);
            }
        };
        return { put, end };
    }

    /** Points the raycaster from the camera through the pointer at `clientX`, `clientY` (page pixels, as a pointer event gives
     *  them). */
    aim(clientX, clientY) {
        const r = this.renderer.domElement.getBoundingClientRect();
        this.raycaster.setFromCamera(
            new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1),
            this.camera,
        );
    }

    /** The id of the thing whose marker is under the pointer, or null. Markers out of the Things tool are to look at, so
     *  they are only found with `any` (the right-click menu). */
    pickThing(clientX, clientY, any = false) {
        if (!this.thingGroup || (this.thingsInert && !any)) return null;
        this.aim(clientX, clientY);
        this.raycaster.params.Line.threshold = 0.6;
        // (a marker in a batch picks as its copy's thing)
        const thing = h => h.object.userData.thing ?? h.object.userData.things?.[h.instanceId] ?? null;
        const hit = this.raycaster
            .intersectObjects([this.thingGroup, this.thingModelGroup].filter(Boolean), true)
            .find(h => thing(h) != null);
        this.raycaster.params.Line.threshold = 1;
        return hit ? thing(hit) : null;
    }

    /** The corner of the selected outline under the pointer: { id, index }, or null. */
    pickCorner(clientX, clientY) {
        if (!this.thingGroup) return null;
        this.aim(clientX, clientY);
        const hit = this.raycaster.intersectObject(this.thingGroup, true).find(h => h.object.userData.corner);
        return hit?.object.userData.corner ?? null;
    }

    /** The placed object under the pointer, or null. */
    pickObject(clientX, clientY) {
        if (!this.objectGroup?.visible) return null;
        this.aim(clientX, clientY);
        const hit = this.raycaster.intersectObject(this.objectGroup, true)[0];
        let n = hit?.object;
        while (n && !n.userData.object) n = n.parent;
        return n?.userData.object ?? null;
    }

    /** Marks object `o` (or none) as selected: a box round it. */
    select(o) {
        this.selected = o;
        if (this.selectionBox) this.selectionBox.visible = false;
        const inst = this.objectGroup?.children.find(c => c.userData.object === o && !c.userData.decal);
        if (inst) this.showSelection(inst);
    }

    /** The selection box round `inst`: one box, fitted again on each move of a drag (a new one each move kept its material). */
    showSelection(inst) {
        if (!this.selectionBox) {
            this.selectionBox = new THREE.BoxHelper(inst);
            this.scene.add(this.selectionBox);
        }
        const box = this.selectionBox;
        box.setFromObject(inst);
        // Gold for scenery, blue for a real placeable.
        box.material.color.set(inst.userData.object?.baked === false ? 0x5aa0ff : 0xd8a24a);
        box.visible = true;
    }

    /** A library texture as a plain lit material (shared; `fallback` colour
     *  while the library isn't there). */
    libraryMaterial(id, fallback) {
        const entry = this.library?.byId.get(id);
        this.libraryMaterials ??= new Map();
        const key = entry ? id : `#${fallback}`;
        if (!this.libraryMaterials.has(key)) {
            let material;
            if (entry) {
                const t = new THREE.TextureLoader().load(`textures/${entry.render}`);
                t.colorSpace = THREE.SRGBColorSpace;
                t.wrapS = t.wrapT = THREE.RepeatWrapping;
                material = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide });
            } else {
                material = new THREE.MeshLambertMaterial({ color: fallback, side: THREE.DoubleSide });
            }
            material.userData.shared = true;
            this.libraryMaterials.set(key, material);
        }
        return this.libraryMaterials.get(key);
    }

    /** What the game draws beyond the edge (landscaper's edge models): each
     *  boundary's profile carried 50 m straight out, and the corners flat
     *  at the corner's height; a little darker, as it can't be walked. The
     *  splat shading clamps to the edge, so its textures carry out too. */
    buildSkirt() {
        const { nx, ny } = this.area;
        // Strips west and east (ny samples, two vertices each), south and
        // north (nx), then four corner quads.
        const strips = [ny, ny, nx, nx],
            first = [0, ny, 2 * ny, 2 * ny + nx],
            corners = 2 * (2 * ny + 2 * nx);
        const verts = corners + 4 * 4;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3).fill(0.72), 3));
        geo.setAttribute('aDeep', new THREE.BufferAttribute(new Float32Array(verts), 1));
        // (no cave void out there: without it the shader read 0, under VOID_BELOW, and drew the edge scenery black)
        geo.setAttribute('aGap', new THREE.BufferAttribute(new Float32Array(verts).fill(1e9), 1));
        geo.setAttribute('aUp', new THREE.BufferAttribute(new Float32Array(verts).fill(1), 1));
        const index = [];
        for (let s = 0; s < 4; s++) {
            for (let k = 0; k < strips[s] - 1; k++) {
                const a = (first[s] + k) * 2,
                    b = a + 2;
                index.push(a, a + 1, b + 1, a, b + 1, b);
            }
        }
        for (let c = 0; c < 4; c++) {
            const a = corners + c * 4;
            index.push(a, a + 1, a + 2, a, a + 2, a + 3);
        }
        geo.setIndex(index);
        this.skirt = new THREE.Mesh(geo, this.mesh.material);
        // A cave has no edge scenery.
        this.skirt.visible = !this.area.enclosed() && !this.area.band;
        this.skirt.material.side = THREE.DoubleSide;
        this.scene.add(this.skirt);
    }

    /** The band round the area (band.js): its ground beyond the edge at full detail, the area's own cells left out (the area's
     *  mesh draws them, and both share the samples on the edge, so they meet), painted from its own paint grid by the area's
     *  shader. A little darker, as it can't be walked. */
    buildBand() {
        const area = this.area,
            band = area.band;
        this.band = null;
        this.bandDirty = false;
        if (!band) return;
        const { n, nx, ny } = band;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nx * ny * 3), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * ny * 3).fill(0.8), 3));
        geo.setAttribute('aDeep', new THREE.BufferAttribute(new Float32Array(nx * ny), 1));
        geo.setAttribute('aGap', new THREE.BufferAttribute(new Float32Array(nx * ny).fill(1e9), 1));
        geo.setAttribute('aUp', new THREE.BufferAttribute(new Float32Array(nx * ny).fill(1), 1));
        const index = [],
            inside = (i, j) => i >= n && j >= n && i + 1 <= n + area.nx - 1 && j + 1 <= n + area.ny - 1;
        for (let j = 0; j < ny - 1; j++)
            for (let i = 0; i < nx - 1; i++) {
                if (inside(i, j)) continue;
                const a = j * nx + i;
                // Counter-clockwise from above (rows from the south; three.js's z runs north to south).
                index.push(a, a + 1, a + nx + 1, a, a + nx + 1, a + nx);
            }
        geo.setIndex(index);
        const mat = new THREE.DataTexture(band.materials, nx, ny, THREE.RedFormat, THREE.UnsignedByteType);
        mat.minFilter = mat.magFilter = THREE.NearestFilter;
        mat.unpackAlignment = 1;
        mat.needsUpdate = true;
        this.bandUniforms = { ...this.uniforms, uMat: { value: mat }, uN: { value: new THREE.Vector2(nx, ny) }, uOrigin: { value: n } };
        this.band = new THREE.Mesh(geo, this.splatMaterial(this.bandUniforms));
        this.band.material.side = THREE.DoubleSide;
        this.band.receiveShadow = true;
        this.scene.add(this.band);
        this.updateBand();
    }

    /** The band changed (a brush beyond the edge, the area's edge moved, an undo): redrawn at the next frame. */
    markBand() {
        this.bandDirty = true;
        this.groundVersion++;
    }

    updateBand() {
        this.bandDirty = false;
        const area = this.area,
            band = area.band;
        if (!this.band || !band) return;
        band.sync(area);
        const { n, nx, ny, heights: h } = band,
            sy = area.sizeY,
            pos = this.band.geometry.attributes.position;
        for (let j = 0, k = 0; j < ny; j++)
            for (let i = 0; i < nx; i++, k++) pos.setXYZ(k, (i - n) * SPACING, h[k], sy - (j - n) * SPACING);
        pos.needsUpdate = true;
        const geo = this.band.geometry;
        geo.computeVertexNormals();
        const nor = geo.attributes.normal,
            up = geo.attributes.aUp;
        for (let v = 0; v < up.count; v++) up.setX(v, nor.getY(v));
        up.needsUpdate = true;
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        this.bandUniforms.uMat.value.needsUpdate = true;
        this.refreshSoft(null);
        this.band.visible = !area.enclosed();
    }

    /** Where the ray from `o` along `d` first meets the band (three.js's frame), or null: marched in half-metre steps over its
     *  ground, then halved down to a centimetre. */
    bandHit(o, d) {
        const area = this.area,
            band = area?.band;
        if (!band || !this.band?.visible) return null;
        const sy = area.sizeY,
            r = band.offset,
            above = t => {
                const x = o.x + d.x * t,
                    y = sy - (o.z + d.z * t);
                return o.y + d.y * t - band.heightAt(x, y);
            },
            outside = t => {
                const x = o.x + d.x * t,
                    y = sy - (o.z + d.z * t);
                return x < -r || y < -r || x > area.sizeX + r || y > sy + r;
            };
        const far = 4 * (r + Math.max(area.sizeX, sy)) + Math.abs(o.y);
        let prev = 0;
        for (let t = 0.5; t < far; t += 0.5) {
            if (outside(t)) {
                if (t > far / 2) break;
                prev = t;
                continue;
            }
            if (above(t) <= 0) {
                let lo = prev,
                    hi = t;
                while (hi - lo > 0.01) {
                    const mid = (lo + hi) / 2;
                    if (above(mid) <= 0) hi = mid;
                    else lo = mid;
                }
                return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
            }
            prev = t;
        }
        return null;
    }

    updateSkirt() {
        if (!this.skirt) return;
        const area = this.area,
            { nx, ny, sizeX: sx, sizeY: sy } = area,
            h = this.drawn ?? area.heights,
            deep = this.chasmFit?.deep,
            D = 50;
        const pos = this.skirt.geometry.attributes.position,
            dark = this.skirt.geometry.attributes.aDeep;
        // Area point (x, y) at the height of sample k, as three.js wants it; a chasm on the boundary carries on out, dark as it.
        const put = (v, x, y, k) => {
            pos.setXYZ(v, x, h[k], sy - y);
            dark.setX(v, deep ? deep[k] : 0);
        };
        for (let k = 0; k < ny; k++) {
            const t = k * SPACING;
            put(k * 2, -D, t, k * nx);
            put(k * 2 + 1, 0, t, k * nx);
            put((ny + k) * 2, sx, t, k * nx + nx - 1);
            put((ny + k) * 2 + 1, sx + D, t, k * nx + nx - 1);
        }
        for (let k = 0; k < nx; k++) {
            const t = k * SPACING;
            put((2 * ny + k) * 2, t, -D, k);
            put((2 * ny + k) * 2 + 1, t, 0, k);
            put((2 * ny + nx + k) * 2, t, sy, (ny - 1) * nx + k);
            put((2 * ny + nx + k) * 2 + 1, t, sy + D, (ny - 1) * nx + k);
        }
        const first = 2 * (2 * ny + 2 * nx);
        const corners = [
            [0, 0, -D, -D],
            [0, sy, -D, sy + D],
            [sx, 0, sx + D, -D],
            [sx, sy, sx + D, sy + D],
        ];
        // (each corner flat at its corner sample's height)
        const cornerSample = [0, (ny - 1) * nx, nx - 1, ny * nx - 1];
        corners.forEach(([x, y, fx, fy], c) => {
            const k = cornerSample[c],
                a = first + c * 4;
            put(a, x, y, k);
            put(a + 1, fx, y, k);
            put(a + 2, fx, fy, k);
            put(a + 3, x, fy, k);
        });
        pos.needsUpdate = true;
        dark.needsUpdate = true;
        this.skirt.geometry.computeVertexNormals();
        // (its steep test from its own normals)
        const nor = this.skirt.geometry.attributes.normal,
            up = this.skirt.geometry.attributes.aUp;
        for (let v = 0; v < up.count; v++) up.setX(v, nor.getY(v));
        up.needsUpdate = true;
        this.skirt.geometry.computeBoundingSphere();
    }

    /** The water's surface (watermesh.js): over the shallows up to the bank, faint where it is shallow and gone where the
     *  ground comes up through it, as the game draws it. */
    updateWater() {
        if (this.water) {
            this.scene.remove(this.water);
            this.water.geometry.dispose();
            this.water.material.dispose();
        }
        this.water = null;
        const { pos, depth } = waterMesh(this.area, this.drawn ?? this.area.heights);
        if (!pos.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
        geo.computeVertexNormals();
        const look = waterView(this.area.atmosphere);
        const material = new THREE.MeshPhongMaterial({
            color: look.color,
            specular: 0x557788,
            shininess: 60,
            transparent: true,
            opacity: look.opacity,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        // Where the ground is over the level, nothing (the ground hid it, flickering where the two all but met); a film over the
        // shallows, deepening to the full colour where it is too deep to walk.
        material.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying float vDepth;')
                .replace(
                    '#include <color_fragment>',
                    `#include <color_fragment>\nif (vDepth <= 0.0) discard;\ndiffuseColor.a *= mix(${WATER_FILM.toFixed(3)}, 1.0, smoothstep(0.0, ${SHALLOW.toFixed(3)}, vDepth));`,
                );
        };
        material.customProgramCacheKey = () => 'landscaper-water';
        this.water = new THREE.Mesh(geo, material);
        this.water.renderOrder = 1;
        this.scene.add(this.water);
    }

    setShowWalkability(on) {
        this.showWalkability = on;
        this.markDirty(this.everything(), false);
    }

    /** The tile grid, draped 5 cm above the ground: the lines along the tile edges, one segment between each two samples,
     *  moved where samples `r` (i0..i1, j0..j1; the whole area when not given) changed. */
    updateGrid(r = this.everything()) {
        const w = this.win,
            { nx, ny, i0: wi, j0: wj } = w,
            per = Math.round(TILE / SPACING), // samples along a tile
            tilesX = (nx - 1) / per,
            tilesY = (ny - 1) / per;
        // Over the full-detail window, in its own samples (the window starts on a tile line).
        const cut = this.inWindow(r.i0, r.i1, r.j0, r.j1);
        if (!cut) return;
        r = { i0: cut.i0 - wi, i1: cut.i1 - wi, j0: cut.j0 - wj, j1: cut.j1 - wj };
        // Segments: lines of constant x (running north, ny - 1 each), then of constant y (running east, nx - 1 each).
        const north = (tilesX + 1) * (ny - 1),
            segments = north + (tilesY + 1) * (nx - 1);
        let attr = this.grid.geometry.attributes.position;
        if (attr?.count !== segments * 2) {
            this.grid.geometry.dispose();
            this.grid.geometry = new THREE.BufferGeometry();
            attr = new THREE.BufferAttribute(new Float32Array(segments * 6), 3);
            this.grid.geometry.setAttribute('position', attr);
            r = { i0: 0, i1: nx - 1, j0: 0, j1: ny - 1 };
        }
        const a = attr.array,
            ground = this.mesh.geometry.attributes.position.array,
            shift = this.mesh.geometry.attributes.aShift.array;
        // Each segment between two samples as the ground draws them, lifted off it. One up an interior's upright wall
        // (uprightShift) is moved off the wall into the room instead, the way its top was moved: on the wall, the wall hid it.
        const put = (seg, i0, j0, i1, j1) => {
            const p = this.vertex(i0 + wi, j0 + wj),
                q = this.vertex(i1 + wi, j1 + wj);
            const dx = shift[p * 2] + shift[q * 2],
                dy = shift[p * 2 + 1] + shift[q * 2 + 1],
                d = Math.hypot(dx, dy);
            const [ox, oz, up] = d > 0 ? [(0.05 * dx) / d, (-0.05 * dy) / d, 0] : [0, 0, 0.05];
            a.set(
                [
                    ground[p * 3] + ox,
                    ground[p * 3 + 1] + up,
                    ground[p * 3 + 2] + oz,
                    ground[q * 3] + ox,
                    ground[q * 3 + 1] + up,
                    ground[q * 3 + 2] + oz,
                ],
                seg * 6,
            );
        };
        // (only the segments moved go to the GPU, a range a line, as uploadRows sends the ground)
        attr.needsUpdate = true;
        const whole = wholeLeft(attr, r.i0 <= 0 && r.j0 <= 0 && r.i1 >= nx - 1 && r.j1 >= ny - 1);
        const upload = (seg, count) => !whole && count > 0 && attr.addUpdateRange(seg * 6, count * 6);
        for (let t = Math.ceil(r.i0 / per); t * per <= r.i1 && t <= tilesX; t++) {
            const i = t * per,
                k0 = Math.max(0, r.j0 - 1),
                k1 = Math.min(ny - 2, r.j1);
            for (let k = k0; k <= k1; k++) put(t * (ny - 1) + k, i, k, i, k + 1);
            upload(t * (ny - 1) + k0, k1 - k0 + 1);
        }
        for (let t = Math.ceil(r.j0 / per); t * per <= r.j1 && t <= tilesY; t++) {
            const j = t * per,
                k0 = Math.max(0, r.i0 - 1),
                k1 = Math.min(nx - 2, r.i1);
            for (let k = k0; k <= k1; k++) put(north + t * (nx - 1) + k, k, j, k + 1, j);
            upload(north + t * (nx - 1) + k0, k1 - k0 + 1);
        }
    }

    /** Area point (NWN metres) under the mouse, or null. With `open`, a cave's or an interior's rock tops (solid rock, drawn
     *  black) are looked through to the ground behind them: the Light brush's, as only open ground can show a tile's light. The
     *  answer is kept while the pointer, the camera and the ground stay as they are: the view asks every frame, and a drag asks
     *  again on each pointer move. */
    pick(clientX, clientY, open = false) {
        this.aim(clientX, clientY);
        const { origin, direction } = this.raycaster.ray,
            last = this.lastPick;
        if (
            !last ||
            last.ground !== this.groundVersion ||
            last.open !== open ||
            !last.origin.equals(origin) ||
            !last.direction.equals(direction)
        ) {
            const hit = this.groundHit(origin, direction, open) ?? this.bandHit(origin, direction);
            this.lastPick = {
                ground: this.groundVersion,
                open,
                origin: origin.clone(),
                direction: direction.clone(),
                point: hit && { x: hit.x, y: this.area.sizeY - hit.z, z: hit.y },
            };
        }
        const p = this.lastPick.point;
        return p && { ...p };
    }

    /** Where the pointer at (clientX, clientY) meets the level `z` metres up (area metres, `z` that height), or null when it
     *  points away from it. The Chasm tool's brush follows the rim's level this way: on the ground it would drop into the chasm
     *  it opens, and away from where the pointer is. */
    pickLevel(clientX, clientY, z) {
        this.aim(clientX, clientY);
        const { origin, direction } = this.raycaster.ray;
        if (Math.abs(direction.y) < 1e-6) return null;
        const t = (z - origin.y) / direction.y;
        if (t <= 0) return null;
        return { x: origin.x + direction.x * t, y: this.area.sizeY - (origin.z + direction.z * t), z };
    }

    /** Where the ray from `o` along `d` first meets the ground as drawn, in three.js's frame (or null). It walks the cells the
     *  ray crosses in order (a 2D DDA over the sample grid) and tests each cell's two triangles, as PlaneGeometry splits it:
     *  three.js's raycast tests every triangle (524,288 on a 32×32 area, 41 ms a pick), this about as many cells as the ray
     *  crosses. With `open`, a triangle of rock top (each corner void, see aGap) lets the ray through. */
    groundHit(o, d, open = false) {
        const { nx, ny, sizeX, sizeY } = this.area,
            y = this.mesh.geometry.attributes.position.array,
            box = this.coarse ? this.coarse.box : this.mesh.geometry.boundingBox,
            gap = open && !this.coarse ? this.mesh.geometry.attributes.aGap.array : null,
            drawn = this.drawn;
        // The part of the ray over the area, between the ground's lowest and highest point.
        let t0 = 0,
            t1 = Infinity;
        for (const [oa, da, lo, hi] of [
            [o.x, d.x, 0, sizeX],
            [o.y, d.y, box.min.y - 1e-3, box.max.y + 1e-3],
            [o.z, d.z, 0, sizeY],
        ]) {
            if (Math.abs(da) < 1e-12) {
                if (oa < lo || oa > hi) return null;
                continue;
            }
            const a = (lo - oa) / da,
                b = (hi - oa) / da;
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
        }
        if (t0 > t1) return null;
        // Cell (cx, cz) spans x from cx and z from cz spacings; its corner vertices are rows of nx, z = row × SPACING.
        const ex = o.x + d.x * t0,
            ez = o.z + d.z * t0;
        let cx = Math.min(nx - 2, Math.max(0, Math.floor(ex / SPACING))),
            cz = Math.min(ny - 2, Math.max(0, Math.floor(ez / SPACING)));
        const sx = Math.sign(d.x),
            sz = Math.sign(d.z),
            stepX = sx ? SPACING / Math.abs(d.x) : Infinity,
            stepZ = sz ? SPACING / Math.abs(d.z) : Infinity;
        let nextX = sx ? ((cx + (sx > 0 ? 1 : 0)) * SPACING - o.x) / d.x : Infinity,
            nextZ = sz ? ((cz + (sz > 0 ? 1 : 0)) * SPACING - o.z) / d.z : Infinity;
        // (a canvas's ground is picked at full detail everywhere, from its drawn heights: the window covers only part of it)
        const corner = this.coarse
            ? (i, k) => [i * SPACING, drawn[(ny - 1 - k) * nx + i], k * SPACING]
            : (i, k) => {
                  const v = (k * nx + i) * 3;
                  return [y[v], y[v + 1], y[v + 2]];
              };
        const rock = (...corners) => gap && corners.every(([i, k]) => gap[k * nx + i] <= VOID_BELOW);
        for (;;) {
            const a = corner(cx, cz),
                b = corner(cx, cz + 1),
                c = corner(cx + 1, cz + 1),
                e = corner(cx + 1, cz);
            const [ka, kb, kc, ke] = [
                [cx, cz],
                [cx, cz + 1],
                [cx + 1, cz + 1],
                [cx + 1, cz],
            ];
            const t = Math.min(
                rock(ka, kb, ke) ? Infinity : rayTriangle(o, d, a, b, e),
                rock(kb, kc, ke) ? Infinity : rayTriangle(o, d, b, c, e),
            );
            if (t < Infinity) return new THREE.Vector3().copy(o).addScaledVector(d, t);
            const across = nextX < nextZ;
            if ((across ? nextX : nextZ) > t1) return null;
            if (across) {
                cx += sx;
                nextX += stepX;
            } else {
                cz += sz;
                nextZ += stepZ;
            }
            if (cx < 0 || cz < 0 || cx > nx - 2 || cz > ny - 2) return null;
        }
    }

    /** The room being dragged out: its outline on the floor (or none). */
    setRoomOutline(r, z) {
        if (this.roomLine) {
            this.scene.remove(this.roomLine);
            this.roomLine.geometry.dispose();
            this.roomLine.material.dispose();
            this.roomLine = null;
        }
        if (!r) return;
        const s = this.area.sizeY,
            y = z + 0.1;
        const pts = [
            [r.x0, r.y0],
            [r.x1, r.y0],
            [r.x1, r.y1],
            [r.x0, r.y1],
            [r.x0, r.y0],
        ].map(([x, yy]) => new THREE.Vector3(x, y, s - yy));
        this.roomLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0xd8a24a, depthTest: false }),
        );
        this.roomLine.renderOrder = 2;
        this.scene.add(this.roomLine);
    }

    /** The descent being dragged: its box, each hall at its floor, and each ramp's line (null hides it; an error shows the box alone). */
    setDescentPreview(plan) {
        if (this.descentLine) {
            this.scene.remove(this.descentLine);
            this.descentLine.geometry.dispose();
            this.descentLine.material.dispose();
            this.descentLine = null;
        }
        if (!plan) return;
        const s = this.area.sizeY,
            pts = [];
        const rect = (r, z) => {
            const c = [
                [r.x0, r.y0],
                [r.x1, r.y0],
                [r.x1, r.y1],
                [r.x0, r.y1],
            ];
            for (let i = 0; i < 4; i++) for (const [x, y] of [c[i], c[(i + 1) % 4]]) pts.push(new THREE.Vector3(x, z + 0.1, s - y));
        };
        const top = plan.halls[0]?.floor ?? this.area.roof - 6;
        rect(plan.box, top);
        for (const h of plan.halls) rect(h.rect, h.floor);
        for (const r of plan.ramps)
            pts.push(new THREE.Vector3(r.a.x, top + 0.2, s - r.a.y), new THREE.Vector3(r.b.x, top + 0.2, s - r.b.y));
        this.descentLine = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: plan.error ? 0xe08a3a : 0xd8a24a, depthTest: false }),
        );
        this.descentLine.renderOrder = 2;
        this.scene.add(this.descentLine);
    }

    /** The ramp being dragged: its outline at the heights it will have, and its centre line (null hides it). */
    setRampPreview(plan, width) {
        if (this.rampLine) {
            this.scene.remove(this.rampLine);
            this.rampLine.geometry.dispose();
            this.rampLine.material.dispose();
            this.rampLine = null;
        }
        if (!plan || plan.len < 0.1) return;
        const s = this.area.sizeY,
            half = width / 2,
            nx = -(plan.b.y - plan.a.y) / plan.len,
            ny = (plan.b.x - plan.a.x) / plan.len;
        const v = (x, y, z) => new THREE.Vector3(x, z + 0.15, s - y);
        const A = k => v(plan.a.x + nx * half * k, plan.a.y + ny * half * k, plan.hA),
            B = k => v(plan.b.x + nx * half * k, plan.b.y + ny * half * k, plan.hB);
        const pts = [A(1), B(1), B(0), B(-1), A(-1), A(0), A(1)];
        this.rampLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: plan.eased ? 0xe08a3a : 0xd8a24a, depthTest: false }),
        );
        this.rampLine.renderOrder = 2;
        this.scene.add(this.rampLine);
    }

    /** Brush ring at area point p (or hide it). */
    setCursor(p, radius) {
        if (!p) {
            this.cursor.visible = false;
            return;
        }
        const pts = [];
        for (let k = 0; k <= 64; k++) {
            const a = (k / 64) * Math.PI * 2;
            const x = p.x + Math.cos(a) * radius,
                y = p.y + Math.sin(a) * radius;
            pts.push(new THREE.Vector3(x, this.area.heightAt(x, y) + 0.15, this.area.sizeY - y));
        }
        this.cursor.geometry.setFromPoints(pts);
        this.cursor.visible = true;
    }

    /** Pillars at export warnings: red where a route stops (it breaks
     *  routes); orange to look at: a passage closed, a tile too winding. */
    setMarkers(warnings) {
        if (this.markers) {
            this.scene.remove(this.markers);
            this.markers.traverse(c => {
                c.geometry?.dispose();
                c.material?.map?.dispose();
                c.material?.dispose?.();
            });
        }
        this.markers = new THREE.Group();
        for (const w of warnings) {
            const failed = w.kind === 'failed_route',
                closed = w.kind === 'closed_passage';
            const at = failed ? w.stops_at : closed ? w.at : [(w.from[0] + w.to[0]) / 2, (w.from[1] + w.to[1]) / 2];
            const color = failed ? 0xe0402a : 0xff9a1f;
            const ground = this.area.heightAt(at[0], at[1]);
            const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 12), new THREE.MeshBasicMaterial({ color }));
            pillar.position.set(at[0], ground + 2.5, this.area.sizeY - at[1]);
            this.markers.add(pillar);
            const label = makeLabel(
                failed ? 'Route stops here' : closed ? 'Passage closed' : `Tile ${w.tile[0]},${w.tile[1]}: too winding`,
                color,
            );
            label.position.set(at[0], ground + 6, this.area.sizeY - at[1]);
            this.markers.add(label);
        }
        this.markers.visible = this.showMarkers !== false;
        this.scene.add(this.markers);
    }

    /** Shows or hides the placed objects (Place and Scatter) with their ground patches and shadows: in the view only. */
    setShowScenery(on) {
        this.showScenery = on;
        if (this.objectGroup) this.objectGroup.visible = on;
        this.updateObjectShadows();
    }

    /** Shows or hides the markers (they stay, and update, either way). */
    setShowMarkers(on) {
        this.showMarkers = on;
        if (this.markers) this.markers.visible = on;
    }
}

/**
 * Whether buffer attribute or texture `x` goes to the GPU whole at its next upload: `whole` asks for that (its ranges are then
 * dropped, which three.js reads as the whole of it), and it stays so until the upload is made, so a range added meanwhile
 * can't shrink it. Ranges are added only when this is false.
 */
function wholeLeft(x, whole) {
    if (!wholeUploads.has(x)) {
        // (whole until its first upload: three.js sends a new texture's ranges only, the rest of it left unset)
        wholeUploads.set(x, true);
        // (three.js calls these after each upload)
        if (x.isTexture) x.onUpdate = () => wholeUploads.set(x, false);
        else x.onUpload(() => wholeUploads.set(x, false));
    }
    if (whole) {
        x.clearUpdateRanges();
        wholeUploads.set(x, true);
    }
    return wholeUploads.get(x);
}
// Each buffer attribute and texture waiting for a whole upload (wholeLeft).
const wholeUploads = new WeakMap();

function makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 40px system-ui, sans-serif';
    canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
    canvas.height = 60;
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(20,22,26,0.85)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.fillText(text, 12, 44);
    // A fixed size on screen, however near the camera is.
    const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, sizeAttenuation: false }),
    );
    sprite.scale.set((0.024 * canvas.width) / canvas.height, 0.024, 1);
    return sprite;
}

/** The mean brightness (0..1, display values) of picture `image`, as the bake's means weigh it (softpaint.js). */
function meanLuma(image) {
    if (!image) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, 0, 0, 64, 64);
    const px = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0;
    for (let k = 0; k < px.length; k += 4) sum += 0.3 * px[k] + 0.59 * px[k + 1] + 0.11 * px[k + 2];
    return sum / (64 * 64 * 255);
}

/** The distance along the ray from `o` along `d` to triangle (a, b, c), seen from either side (the ground's material is
 *  double-sided), or Infinity when it misses: Möller and Trumbore's test, as three.js's Ray.intersectTriangle. */
function rayTriangle(o, d, a, b, c) {
    const e1x = b[0] - a[0],
        e1y = b[1] - a[1],
        e1z = b[2] - a[2],
        e2x = c[0] - a[0],
        e2y = c[1] - a[1],
        e2z = c[2] - a[2];
    const px = d.y * e2z - d.z * e2y,
        py = d.z * e2x - d.x * e2z,
        pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity;
    const tx = o.x - a[0],
        ty = o.y - a[1],
        tz = o.z - a[2];
    const u = (tx * px + ty * py + tz * pz) / det;
    if (u < 0 || u > 1) return Infinity;
    const qx = ty * e1z - tz * e1y,
        qy = tz * e1x - tx * e1z,
        qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) / det;
    if (v < 0 || u + v > 1) return Infinity;
    const t = (e2x * qx + e2y * qy + e2z * qz) / det;
    return t >= 0 ? t : Infinity;
}

/** Frees a ground patch made by addDecal: its geometry and material are its own (its picture is the model library's, shared). */
function disposeDecal(mesh) {
    mesh.geometry.dispose();
    mesh.material.dispose();
}
