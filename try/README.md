# Spike: the engine in this page (not for merge)

`sw.js` answers the editor's engine requests (`/api/...`, `textures/...`) with the Landscaper engine built for WASI, run on
in-memory files by [browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) 0.4.2 (`try/shim/`, MIT). `try/boot.js`
starts it before the editor. The engine's build and the design are in nwn-landscaper (`research/wasm-demo/`,
`docs/DESIGN-web-demo.md`).

- `try/engine.js`: runs the engine once per request, keeps its files between requests.
- `try/standin/`: what an export reads from the game, made here, none of it the game's: nine empty palettes and one lighting row.
- `try/landscaper.wasm` and `try/textures/` (the demo's own procedural ground textures) are not committed: the site build copies
  them in.
