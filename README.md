# NWN Landscaper (web editor)

> The engine, [plenarius/landscaper](https://github.com/plenarius/landscaper), is published at the same time as this page; until
> then, only sculpting runs without it.

Sculpt a Neverwinter Nights area in the browser and export it as an area with its own generated tileset (hak + module), checked
against NWN's pathfinding. It is for builders of NWN:EE modules. This repository is the page (three.js, no build step); the engine
that reads the game, builds the areas and serves this page is [landscaper](https://github.com/plenarius/landscaper), a separate
repository (Rust). The page talks to it over HTTP. Without the engine the page opens a blank area and only sculpting works: the
textures to paint with, saving to disk, importing, exporting, the path check, and the game's models and blueprints all come
from the engine.

![The editor with Dalos Lake, an outdoor area imported from a module, open in the Paint tool](docs/screenshot.png)

What it does (*team* marks what only a team server offers, see landscaper's
[TEAM-SERVER.md](https://github.com/plenarius/landscaper/blob/master/docs/TEAM-SERVER.md)):

- **Sculpt** the ground: raise, lower, smooth, flatten; water; cave entrances.
- **Paint** with a texture library the engine builds from your own game files, or pick a texture up from the ground.
- **Caves and interiors**: cut rooms and passages out of rock, ramps and descending halls, a ceiling height.
- **Things**: creatures, placeables, doors, waypoints, triggers, sounds, encounters, stores and items from the module's
  blueprints, with their tag, name, scripts and variables; your own creature and item blueprints made from existing ones.
- **Scripts and conversations**: pick scripts by name and edit them with the compiler's errors underlined as you type (on a
  team server, admins only); write conversations as a tree of lines.
- **Area settings**: name, tag, scripts, weather, music, sky and fog, as the toolset's Area Properties.
- **Import** an NWN area from the module's source or from a `.mod` or `.erf` you upload.
- **Check paths**: simulate NWN's pathfinding on random routes, after each edit or on demand, and show ground too steep to walk.
- **Export to NWN**: the hak and module, ready to play.
- **Publish**: on your own machine, a package (a zip) to unzip into your module's repository; on a team server, pull requests
  opened by a review service (*team*).
- **Test on the dev server**, **Save version** into the team's history, and an **Activity** log for admins (*team*).

Pull requests, the dev server, and the pictures of items and creatures need a review service: one you run yourself that answers
the calls in landscaper's [REVIEW-SERVICE.md](https://github.com/plenarius/landscaper/blob/master/docs/REVIEW-SERVICE.md).

## You need

- The engine, [landscaper](https://github.com/plenarius/landscaper), and what it needs: your own copy of NWN:EE and
  `nwn_gff`. Its [SELF-HOSTING.md](https://github.com/plenarius/landscaper/blob/master/docs/SELF-HOSTING.md) lists them.
- A browser with WebGL.

## Run

Clone [landscaper](https://github.com/plenarius/landscaper) next to this folder, then:

```bash
cd ../landscaper && cargo build --release
NWN_ROOT=/path/to/nwn ./target/release/landscaper serve   # http://127.0.0.1:8765/  (only on this machine)
```

`NWN_ROOT` is the game's install folder (the Steam install on Linux is found without it); `NWN_HOME` is your user folder, the
one with `hak/`, `modules/` and `tlk/`. Then open <http://127.0.0.1:8765/>. `serve` looks for this folder as `web/` beside the
program, then `landscaper-web` and `../landscaper-web` from where you start it; or pass `--web <folder>` (or set
`LANDSCAPER_WEB`). `--port` changes the port. landscaper's
[SELF-HOSTING.md](https://github.com/plenarius/landscaper/blob/master/docs/SELF-HOSTING.md) covers a team server.

The page needs WebGL. Without a GPU (e.g. a remote desktop), start a separate browser window with software rendering:

```bash
google-chrome --user-data-dir=/tmp/landscaper-browser --enable-unsafe-swiftshader --ignore-gpu-blocklist http://127.0.0.1:8765/
```

## Use

- **New area**: name (1-9 of a-z 0-9 _, prefixes every resref), size in 10 m NWN tiles (up to 32 x 32), and a start. The
  starts are flat ground, gentle or rough hills, a cave or an interior (solid rock to cut rooms out of), or a sample descending
  crypt, dungeon or cave to change. The engine saves your work to disk as you go; when it can't (no engine, or a failed save),
  the browser keeps the area until the engine is back and then hands it over.
- **Tools** (big buttons; the key is under each): Raise `1`, Lower `2`, Smooth `3`, Flatten `4`, Paint `5`, Water `6`, Entrance `7`,
  Place `8`, Scatter `9`, Things `t`, and for caves and interiors Dig `0`, Ramp `p`, Descent `d` and Room `r` (shown on every
  area). Brush size `[` `]`, strength slider. Left-drag sculpts; right-drag turns the view, middle-drag moves it, the wheel
  zooms; `F` reframes. Undo/redo with Ctrl+Z / Ctrl+Y.
- **Other keys**: `N` new area, `O` open, `L` sky & fog, `M` shows or hides the markers. The camera: the arrow keys move along
  the ground, Shift+arrows turn the view, `+` and `-` zoom, `Home` looks straight down.
- **A selected placeable** (Place tool): `G` moves it, `R` turns it, `S` sizes it (then the mouse or a number; click or Enter
  keeps it, Esc cancels), `Q` and `E` turn it 15°, `Delete` removes it, `Esc` deselects. A selected thing (Things tool) takes
  `Q`, `E`, `Delete` and `Esc` the same way.
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
