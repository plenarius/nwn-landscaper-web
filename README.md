# NWN Landscaper (web editor)

Sculpt a Neverwinter Nights area in the browser and export it as an area with its own generated
tileset (hak + module), checked against NWN's pathfinding. This repository is the page (three.js, no build step); the
engine that reads the game, builds the areas and serves this page is [landscaper](https://github.com/plenarius/landscaper),
a separate repository (Rust). The page talks to it over HTTP. Sculpting and painting work in the page alone; importing,
exporting, the path check, the texture library, the game's models and blueprints need the engine.

## You need

- The engine, [landscaper](https://github.com/plenarius/landscaper), and what it needs (your own copy of NWN:EE).
- A browser with WebGL.

## Run

Clone [landscaper](https://github.com/plenarius/landscaper) next to this folder, then:

```bash
cd ../landscaper && cargo build --release
./target/release/landscaper serve          # http://127.0.0.1:8765/  (only on this machine)
```

Then open <http://127.0.0.1:8765/>. `serve` finds this folder at `~/dev/layonara/landscaper-web`,
or pass `--web <folder>` (or set `LANDSCAPER_WEB`). `--port` changes the port. landscaper's
[SELF-HOSTING.md](https://github.com/plenarius/landscaper/blob/master/docs/SELF-HOSTING.md) covers a team server.

The page needs WebGL. Without a GPU (e.g. a remote desktop), start a separate browser window with
software rendering:

```bash
brave-browser --user-data-dir=/tmp/landscaper-browser --enable-unsafe-swiftshader --ignore-gpu-blocklist http://127.0.0.1:8765/
```

## Use

- **New area**: name (1-9 of a-z 0-9 _, prefixes every resref), size in 10 m NWN tiles (up to 32 x 32), and a start. The
  starts are flat ground, gentle or rough hills, a cave or an interior (solid rock to cut rooms out of), or a sample descending
  crypt, dungeon or cave to change. The browser keeps your work between sessions.
- **Tools** (big buttons; the key is under each): Raise `1`, Lower `2`, Smooth `3`, Flatten `4`, Paint `5`, Water `6`, Entrance `7`,
  Place `8`, Scatter `9` and Things `t`. Caves and interiors add Dig `0`, Ramp `p`, Descent `d` and Room `r`. Brush size `[` `]`,
  strength slider. Left-drag sculpts; right-drag turns the view, middle-drag moves it, the wheel zooms; `F` reframes. Undo/redo with
  Ctrl+Z / Ctrl+Y.
- **Pick a texture up**: in the Paint tool press `I` (or the **Pick from the ground** button, or Alt-click) and click the ground. On painted
  ground it picks that texture; on an imported area it picks the tileset's own texture under the click and adds it to the library
  (under **Tileset**) the first time.
- **Caves and interiors**: cut rooms and passages out of the rock with Room and Dig (passages about 6 m wide at least, along tile
  middles). Lay a Ramp between levels (a little wider than the passage), or drag a box with Descent to fill it with halls that
  step down, joined by ramps. **Area > Ceiling height** keeps the same headroom over the floor everywhere, so a descent stays tight. See
  landscaper's [BUILDER-WORKFLOW.md](https://github.com/plenarius/landscaper/blob/master/docs/BUILDER-WORKFLOW.md) for the rules and the limits.
- **Walkable** (`W`) tints ground too steep for NWN creatures in red, by the same rule the exporter
  uses. The status bar shows position, height, tile and walkability under the cursor.
- **Export to NWN** builds the hak (into your NWN `hak/` folder) and module (into `modules/`, ready
  to play), then simulates NWN's pathfinding on random routes. Red markers: a route stops short.
  Orange: a tile whose walkable ground is too winding for NWN's in-tile search; straighten or widen
  the passage.

## Development

There is no build step: edit the files and reload the page. `scripts/check.sh` runs every check the way CI does (Biome,
html-validate, spelling, writing, Markdown, links, licences, secrets); [STYLE.md](STYLE.md) is the standard it checks.

Two rules of this repository's own, as Biome plugins in `lint/`:

- Data goes into the page as text: build elements with `el()` from `js/dom.js`, `textContent` or `new Option()`.
  `innerHTML` and its relatives take only a fixed string. Area files, the engine's answers and the browser's storage hold
  text that builders typed, and an admin opens builders' areas.
- Every request to the engine goes through `api()` in `js/api.js`, which sends the `X-Landscaper: 1` header the engine
  checks. Another site's page can't send that header, so the engine can refuse requests that don't carry it.

## Credits

Forked from [ergin3d/heightmap-generator](https://github.com/ergin3d/heightmap-generator) (MIT), which supplied the three.js
view, raycast painting, brush falloff, noise and filters. The UI and data model are rebuilt around NWN areas; `js/noise.js` is
still ergin3d's file.

Vendored, unmodified, each with its own `LICENSE`:

- `vendor/three`: [three.js](https://threejs.org/) r186 (npm `three` 0.186.1: `build/three.module.js`, the
  `build/three.core.js` it imports, and `examples/jsm/controls/OrbitControls.js`), MIT.
- `vendor/simplex-noise`: [simplex-noise](https://github.com/jwagner/simplex-noise.js) 4.0.3 (`dist/esm/simplex-noise.js`), MIT.
- `vendor/codemirror`: [CodeMirror](https://codemirror.net/) 6 for the script editor, all MIT. It is one file that esbuild 0.28.2
  bundled from `codemirror` 6.0.2, `@codemirror/view` 6.43.15, `@codemirror/state` 6.7.6, `@codemirror/lint` 6.9.7,
  `@codemirror/lang-cpp` 6.0.3 and `@codemirror/theme-one-dark` 6.1.3, with the packages they pull in.
  [vendor/codemirror/README.md](vendor/codemirror/README.md) lists every version and how to rebuild it.

## Licence

MIT: see [LICENSE](LICENSE). Copyright (c) 2026 ergin3d and (C) 2026 plenarius. The vendored packages keep their own licences
(all MIT), recorded in [REUSE.toml](REUSE.toml).
