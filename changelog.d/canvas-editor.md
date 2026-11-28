<!-- markdownlint-disable-file MD041 -->
- **Canvases in the editor:** File → **New canvas** makes a landscape of up to 128 by 128 tiles, and **Open canvas** opens one
  again. Every sculpting and painting tool works on it, with undo, as on an area. It is drawn at full detail round what the
  camera looks at (48 by 48 tiles at most) and at a quarter of the detail beyond, so a 64 by 64 canvas draws 1.2 million
  triangles instead of 2.1 million; **Full detail near** turns the full detail off for broad shaping. Saves send only the
  16 by 16 tile blocks a change reached: one Raise stroke across a block border sends two blocks, not the 16 of a 64 by 64
  canvas. Cutting a canvas into areas, and its export, path check and publish, come next.
