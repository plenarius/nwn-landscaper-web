<!-- markdownlint-disable-file MD041 -->
- **The browser page has the Preset skies pack and the game's skies.** When the page carries them (the engine's
  `scripts/try-page.sh`), its engine installs the pack on the first visit, so each preset shows its sky, the Sky row lists the
  seven as installed, and an area with one exports with `ls_skies.hak`.
- **The Sky & fog panel no longer shows a broken picture** for a sky it can't picture, such as one that isn't installed: it
  showed one again whenever the panel was redrawn. It shows nothing there now.
- **The note for a preset whose sky isn't installed** says how to install Preset skies: `landscaper skies get preset-skies`.
- **The Sky & fog looks show their colours:** each look's swatch had no width, so its button showed only its name.
- **The browser page exports a 16 by 16 area,** such as the swamp showcase. Its export ran out of memory at the end, so the page
  draws the area's in-game minimaps from its terrain, not from above with its objects; and an export over 5 minutes was cut
  off by the browser, so the editor now sends its requests to the page's engine directly, not through the Service Worker.
