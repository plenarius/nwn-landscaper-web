# NWN Landscaper (web editor)

Sculpt a Neverwinter Nights area in the browser and export it as an area with its own generated
tileset (hak + module), checked against NWN's pathfinding by
[landscaper](../landscaper).

Forked from [ergin3d/heightmap-generator](https://github.com/ergin3d/heightmap-generator) (MIT),
which supplied the three.js view, raycast painting, brush falloff, noise and filters. The UI and
data model are rebuilt around NWN areas.

## Run

```bash
cd ../landscaper && cargo build --release
./target/release/landscaper serve          # http://127.0.0.1:8765/  (only on this machine)
```

Then open http://127.0.0.1:8765/. `serve` finds this folder at `~/dev/layonara/landscaper-web`,
or pass `--web <folder>` (or set `LANDSCAPER_WEB`). `--port` changes the port.

The page needs WebGL. Without a GPU (e.g. a remote desktop), start a separate browser window with
software rendering:

```bash
brave-browser --user-data-dir=/tmp/landscaper-browser --enable-unsafe-swiftshader --ignore-gpu-blocklist http://127.0.0.1:8765/
```

## Use

- **New area**: name (1-9 of a-z 0-9 _, prefixes every resref), size in 10 m NWN tiles,
  start flat or from hills. Your work is kept in the browser between sessions.
- **Tools** (big buttons, keys 1-4): Raise, Lower, Smooth, Flatten. Brush size `[` `]`, strength
  slider. Left-drag sculpts; right-drag turns the view, middle-drag moves it, the wheel zooms;
  `F` reframes. Undo/redo with Ctrl+Z / Ctrl+Y.
- **Walkable** (`W`) tints ground too steep for NWN creatures in red, by the same rule the exporter
  uses. The status bar shows position, height, tile and walkability under the cursor.
- **Export to NWN** builds the hak (into your NWN `hak/` folder) and module (into `modules/`, ready
  to play), then simulates NWN's pathfinding on random routes. Red markers: a route stops short.
  Orange: a tile whose walkable ground is too winding for NWN's in-tile search; straighten or widen
  the passage.

## Third-party code (vendored, MIT)

- `vendor/three`: three.js r170
- `vendor/simplex-noise`: simplex-noise 4.0.3
