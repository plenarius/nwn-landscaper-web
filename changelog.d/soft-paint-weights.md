<!-- markdownlint-disable-file MD041 -->
- **Paint has a Softness.** The texture fades out towards the brush's rim, and each point under the fade keeps the new
  texture and the old one by weight, so the edge lies where the brush put it, not on the 0.625 m grid's steps. Natural ground
  draws it ragged, laid surfaces sharp, and a texture whose `edge` is `soft` as a blend as wide as the fade; the export bakes
  the same edges. Softness 0 paints hard, as before. A point holds two textures at most: painting a third over it keeps the
  two that weigh most there.
- **The Mix brush's soft edge fades the mix in by weight** instead of breaking it up into specks the smoothing then removed.
- **The sample landscapes' edges follow their rules:** the snowy pass's snow ends where the slope passes about 60 degrees, the
  canyon's sand where its floor rises, between the grid's points.
- An area saves its weights in a `blend` field; an area painted without them saves exactly as before.
