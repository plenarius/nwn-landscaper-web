<!-- markdownlint-disable-file MD041 -->
- **Cutting a canvas into pieces:** a canvas has a **Pieces** mode next to **Sculpt**. It shows the canvas from above: drag
  across the ground to cut out a piece on tile lines, drag a cut to move it (the pieces on both sides follow), **Join** two
  pieces that make a rectangle, or **Grid…** for an even grid to start from. Ground no piece covers is a gap, hatched, never
  exported. While a cut moves, the panel lists what changes piece (entrances, placeables, creatures, lakes) and says that their
  tags stay; a piece over 32 tiles a side, the game's limit, is refused while dragging, with the piece named. **Open this
  piece** edits one piece at full detail with an 8-tile ring of its neighbours' ground dimmed round it, so a brush crosses the
  cut; a small map of the canvas marks it. **Check paths** checks one piece or all of them and across their crossings, with an
  engine that cuts canvases. Every cut change is one undo step.
