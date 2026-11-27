<!-- markdownlint-disable-file MD041 -->
- **The view draws painted edges as the export now bakes them.** Where two textures meet, the view showed the paint's 0.625 m
  grid, the same sawtooth the game did. It now smooths each texture's paint over about 1.5 m and draws the edge there, by the
  engine's own rule: sharp on a smooth line for laid surfaces (cobbles, flagstones, floors, planks), ragged by the same noise and
  by the textures' own light and dark for natural ground, as the texture catalog's `edge` (or the texture's category) says.
  What the view shows is what the game will show after export, to a few millimetres. Specks a sample or two across, like the mix
  brush's soft edge, are smoothed away in the view as in the game. Steep ground keeps its one texture a face. Needs the engine's
  soft paint bake (nwn-landscaper #95).
