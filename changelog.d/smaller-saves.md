<!-- markdownlint-disable-file MD041 -->
- **Saved areas are smaller.** A band you never shaped is left out of the save and filled again when the area opens; a shaped
  band keeps only its own samples, its heights to the centimetre. Objects keep their points to the millimetre and leave out a
  bearing, size, solid or baked setting that is the default. The forest showcase's save went from 2.6 MB to 1.5 MB. Older saves
  open as before. An editor older than this release opens a new save with a fresh first fill in place of a shaped band, and
  with objects missing those defaults, so open new saves only with this release or later.
- **A river running out past the edge keeps its bed in the band's first fill when the area opens.** The fill was made before
  the area's water was read, so it eased the bed away.
