# Canvases and pieces

Draft for the handbook (the engine's `docs/handbook/`), written with step 6 of `DESIGN-canvas-cut.md`. Step 8 moves it there.

A **canvas** is a landscape larger than one area, up to 128 by 128 tiles. You sculpt and paint it as one, then cut it into
**pieces**: each piece becomes one area of at most 32 by 32 tiles, the game's limit, and players walk from piece to piece
through crossings the export makes along the cuts.

## Make a canvas

1. **File → New canvas…**
2. Give it a name of 1 to 7 lower case letters, digits or `_`. Its pieces are named after it: `rivl01`, `rivl02`...
3. Set its size in tiles, up to 128 each way, and how its ground starts.

**File → Open canvas…** opens one again.

## Sculpt

The canvas opens in **Sculpt**. Every sculpting and painting tool works on it as on an area. It is drawn at full detail round
what the camera looks at and at a quarter of the detail beyond; **Full detail near** turns the full detail off for broad
shaping with large brushes.

## Cut it into pieces

Click **Pieces** in the top bar. The canvas shows from above, with the pieces on it and their list beside it.

- **Cut:** drag across the ground. Over a gap this makes a new piece. Across a piece it splits it: drag right across it, from
  one side past the other, and the larger part keeps the piece's name.
- **Move a cut:** drag a cut line. It snaps to tile lines, and the pieces on both sides follow. An outer edge moves alone,
  leaving a gap behind it. **Esc** puts the cut back.
- **Join:** click a piece, then the one beside it. They must share a whole side.
- **Grid…:** fills the canvas with an even grid, in place of the pieces there. The new pieces keep the names of the old ones
  they cover most of.
- **Make a gap:** takes the selected piece out. Its ground stays on the canvas and still shows in its neighbours' edges, but
  it is never exported.
- **Rename:** the piece's name (its resref prefix, 1 to 9 characters) and its name in the game.

A piece is 3 to 32 tiles a side. A cut or a move that would break that is refused while you drag, and the panel says which
piece and why: "Riverford would be 36 tiles wide; the game takes 32 at most."

While you drag, the panel lists **what moves**: the cave entrances, placeables, creatures and parts of lakes or chasms that
change piece. Their tags don't change: tags use the canvas's name, not the piece's, so a door or a script that names them
keeps working. Something left in a gap is kept on the canvas but not exported; a trigger whose outline a cut runs through is
refused at export.

**Undo** and **Redo** in Pieces mode undo each cut change.

## Open a piece

Double-click a piece, or select it and click **Open this piece** (Enter). The piece is drawn at full detail with 8 tiles of its
neighbours round it, dimmed. The dimmed ground is editable: a brush near the cut shapes both pieces, as the canvas is one
landscape. It is also what the piece's edge scenery shows in the game.

The small map at the top right shows the canvas with the open piece lit and its full-detail window; click another piece there
to open it. The crossings along the piece's sides are drawn on the ground once the engine has found them. The status line
gives the place on the canvas and in the piece.

**← Back to the canvas** returns to Pieces mode.

## Check paths

**Check paths** checks the selected piece, and **Check paths (all pieces)** every piece and the canvas as a whole: whether
each piece can be walked into from the start piece through the crossings. A piece with no way in shows **no way in** in the
list. It needs an engine that cuts canvases; an older one says so.

Exporting and publishing a canvas come next.
