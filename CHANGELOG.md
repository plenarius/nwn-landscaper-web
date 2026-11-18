# Changelog

All notable changes to the Landscaper's web editor. Versions follow [Semantic Versioning](https://semver.org/). Each release is
tagged with the same `vX.Y.Z` as the engine's, [landscaper](https://github.com/plenarius/landscaper), and works with the engine
of that release; before 1.0, a minor version may change the HTTP API between them. The engine has its own changelog.

## 0.1.0 (unreleased)

The first public release: the page that sculpts, paints, digs caves and places things in an NWN area, and talks to the engine to
open, save, import, check and export it.

What changed for builders since the review of the private builds (#61 to #73):

- **New area: Escape and Cancel make nothing.** After one Create, Escape used to make a blank area over the open one. The name
  box starts empty, and a name that an area already has asks before replacing it; the engine of the same release also refuses
  to replace it unless you agreed (#61).
- **Area settings: OK applies nothing while a number is out of range.** The dialog stays open and shows which one; Cancel always
  closes it (#62).
- **Autosave loses no change.** Opening another area, reloading, switching to another tab or closing the tab writes the waiting
  change first, or keeps it in the browser and hands it to the engine at the next start. Saves go one at a time. When the
  browser's copy and the engine's differ, the page asks which to keep. On a team server each builder's browser copies are their
  own (#63).
- **Undo: one step per action.** A drag of the size slider is one step, a click that only selects a placeable takes none, the
  ceiling height comes back with the descent that set it, and a cancelled move, turn or resize leaves undo and redo alone (#64).
- **Things: on/off settings can be turned off.** Locked, Plot, Useable and the other on/off settings are a choice of the
  blueprint's, On or Off, so Off turns off what the blueprint has on. An imported trigger or encounter you reshaped keeps its
  shape when you move or turn it (#65).
- **The page runs only its own code.** A Content-Security-Policy refuses scripts and requests from other sites; the engine of the
  same release also sends it as a header and keeps other sites from showing the editor in a frame (#66).
- **Sculpting and undo redraw only what changed**, ground, grid and shadows alike, and dragging a placeable moves only that one,
  so a stroke on a large area does far less work each frame. The page no longer holds on to memory for what it has replaced
  (#67, #68).
- **A stroke keeps its tool.** A tool key pressed during a stroke waits; a full texture list (255) says so before Paint or Dig
  starts, instead of painting with the wrong texture; and in a read-only area (an admin looking at another builder's workspace)
  a stroke changes nothing (#69).
- **Script, conversation and blueprint dialogs: Copy and Delete act on the item shown**, never on the one shown before it (#70).
- **The last thing you asked for wins.** Opening two areas quickly opens the second, and the publish check shows the plan you
  asked for last. A file server that only serves the page no longer counts as the engine (#71).
- **The sample descents paint with textures the library has**: the starter library's Flagstones, Cobblestones and Pebbles when
  the library lacks the samples' own, instead of failing the export (#72).
- **Entrances keep their number.** Each entrance's door is tagged `<area>_ent<number>`, and taking another entrance out no longer
  renames it. It needs the engine of the same release (#73).
- **Opening an area never loses a change.** Opening an area waits for its last change to be saved, so reopening it (or going
  back to it) within a moment of a change no longer shows the older copy and saves that over the change. An area the browser
  kept after a failed save goes to the engine when you open it again, or the page asks which copy to keep, instead of being
  replaced by the engine's older copy and then deleted. Opening an area no longer saves it straight back.
- **A tab can't save over an area made again elsewhere.** Each new area carries an id (`created`) that the engine of the same
  release checks: when another tab or computer has made a new area of that name since, the page keeps your copy in the browser
  and asks whether to replace that area or open it.
- **An admin's read-only view of another builder's workspace changes nothing.** Opening that builder's script no longer saves
  it over your own of the same name, their blueprints offer no Change, Delete or Make my own (which acted on yours), their
  conversations aren't saved on close, and the Things form stays locked after it redraws. The page sends no request that
  changes something while you look.
- **Another area opening ends what was under way in the last one.** A stroke ends on the area it began on, an imported object's
  form no longer writes into the next area's object of the same key, and Export or Check paths that finish after you opened
  another area put no markers on it.
- **Per user on a shared browser:** the area to open at the start and the dev server's way in. Area settings ask the engine for
  the music and load-screen names again after a failed load, instead of showing numbers until the page reloads.

In this release too:

- **Things: "The blueprint's (on)" or "(off)".** The first choice of an on/off setting says what the blueprint has, read from the
  engine's `GET /api/blueprint-fields`. With an older engine, or one that can't be reached, it reads "The blueprint's" as before.
- README: the publishing note at the top is gone; autosave, Publish, the New area size (3 to 32 tiles each way) and the
  Content-Security-Policy are described as they work now.
- Tests: `node --test 'tests/*.test.js'` runs the area's undo, JSON and entrance ids, the save queue and the read-only guard
  without a browser; CI runs them.
- `STYLE.md` is nwn-bake 0.5.2's again (measured layout data is CC0-1.0), and `scripts/shared-files.sh` checks the shared files
  against nwn-bake's in CI.
