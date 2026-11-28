<!-- markdownlint-disable-file MD041 -->
- **The browser page's export downloads compressed:** each file of the zip is deflated, so the swamp showcase's export is
  236 MB instead of 691 MB, its files the same bytes. Deflating it takes about 17 s.
- **The browser page fetches the game's TGA textures compressed,** as `<name>.tga.bin`, which GitHub Pages compresses and the
  engine's `scripts/try-page.sh` names so: a sky's 3.1 MB TGA downloads as about 1.4 MB.
