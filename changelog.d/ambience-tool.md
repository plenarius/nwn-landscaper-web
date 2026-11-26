<!-- markdownlint-disable-file MD041 -->
- **The Ambience tool (A) places particles.** A palette of the particle pack's kinds; **Fill** puts the ticked ones where the
  area calls for them (mist on water, more where it is wide; spray where water drops; leaves under trees; fireflies on grass
  near water; motes and light shafts in gaps in the trees and at cave mouths; sand on dune crests; snow on ridges; ground fog in
  hollows), at a density the builder sets, with the wind's bearing for snow and sand. The brush adds the chosen kind, Shift-drag
  clears it. The panel counts the particles alive by day and at night against the area's cap of 1,500, and Fill and the brush
  stop there. The view draws them as moving points in each kind's colour, night-only kinds by night. The area keeps them, with
  undo, and an export sends them as `ambience`, each standing on the ground or water as it is then. Needs the engine's
  `/api/particles` and baked emitters.
