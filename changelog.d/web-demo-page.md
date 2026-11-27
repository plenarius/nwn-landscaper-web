<!-- markdownlint-disable-file MD041 -->
- **The editor can run its engine in the browser**, with nothing to install: the coming "try it" page (the engine's
  [DESIGN-web-demo.md](https://github.com/plenarius/nwn-landscaper/blob/master/docs/DESIGN-web-demo.md)). The engine built for
  WebAssembly runs in a Worker of the page, a Service Worker passes it the editor's requests, and the areas and the texture
  library stay in the browser's storage between visits. File has **Download area** and **Open area from a file**; Export
  downloads a zip of the module and its haks. `scripts/try-site.sh` makes the page from a release's engine and the demo
  texture pack. From `landscaper serve` and the desktop app the editor is as before.
- **A yes-or-no question no longer shows an empty text box** (Delete area, replacing an area of the same name).
