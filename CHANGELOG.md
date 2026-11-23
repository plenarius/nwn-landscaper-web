# Changelog

All notable changes to the Landscaper's web editor. Versions follow [Semantic Versioning](https://semver.org/). Each release is
tagged with the same `vX.Y.Z` as the engine's, [nwn-landscaper](https://github.com/plenarius/nwn-landscaper), and works with the engine
of that release; before 1.0, a minor version may change the HTTP API between them. The engine has its own changelog.

## Unreleased

- **Try on dev**, beside the Publish dialog's button, where the review service takes trials. It puts the area, or with the box
  ticked its whole module, on the dev server with no restart, once the check finds no errors. The dialog then says whether to
  reconnect, how to walk in (`;forge <area>`, with a Copy button for each area), what went wrong or needs a look, and how long
  the trial has left. **Keep it longer** pushes the hour back; **Release** puts dev's areas back to live. Opening the dialog shows
  the trial you have, without keeping it longer. Needs the engine of the same release.

## 0.1.2

- No change to the page. Tagged with the engine's 0.1.2, whose publish now sends only the files the Landscaper made.

## 0.1.1

- **Released as downloads with the engine.** Each nwn-landscaper release now has an archive per system (Windows, macOS, Linux)
  holding the engine and this page, in `web/` beside the program: unpack it and start the program, and the editor opens in the
  browser. The page itself is unchanged. README, "Install".

## 0.1.0

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
  replaced by the engine's older copy and then deleted. Opening an area no longer saves it straight back (#75).
- **A tab can't save over an area made again elsewhere.** Each new area carries an id (`created`) that the engine of the same
  release checks: when another tab or computer has made a new area of that name since, the page keeps your copy in the browser
  and asks whether to replace that area or open it (#75).
- **Two tabs on one area no longer save over each other.** Each save sends the version of the area it started from, and the
  engine of the same release refuses it when another tab or computer has saved the area since (areas from before `created` ids
  too). The page keeps that tab's copy in the browser and asks: keep this tab's (the engine keeps the other as
  `<name>.json.replaced-<time>`), or open the other one. A tab's own autosaves, however fast, never refuse each other (#77).
- **An admin's read-only view of another builder's workspace changes nothing.** Opening that builder's script no longer saves
  it over your own of the same name, their blueprints offer no Change, Delete or Make my own (which acted on yours), their
  conversations aren't saved on close, and the Things form stays locked after it redraws. A blueprint's dialog shows every
  field disabled, however it was opened. The page sends no request that changes something while you look, and the engine of
  the same release refuses one too (#75, #77).
- **Another area opening ends what was under way in the last one.** A stroke ends on the area it began on, an imported object's
  form no longer writes into the next area's object of the same key, and Export or Check paths that finish after you opened
  another area put no markers on it (#75).
- **Per user on a shared browser:** the area to open at the start and the dev server's way in. Area settings ask the engine for
  the music and load-screen names again after a failed load, instead of showing numbers until the page reloads (#75).
- **Room, Descent and Entrance work in an area with 255 textures.** They stopped halfway with an error, and a Descent then
  kept every tool key from working. Now the room or the descent is cut and the entrance made, with the floor or the rock left
  unpainted, and the status line says so (#76).
- **Undo takes back Sky & fog.** A preset, a colour, the fog, the view distance or the shadows' strength is one step each; a
  drag of a slider is one step (#76).
- **The Entrance panel follows undo, redo and opening another area.** A "leads to" choice made after an undo is kept and saved (#76).
- **A click on water that leaves its level as it was takes no undo step**, so Redo still works after it (#76).
- **Dialogs show and change the item opened last.** A blueprint, script or conversation dialog closed while it loaded and
  opened on another shows the second one and acts on it. Closing the dev server dialog while it loads stops its checks, which
  kept your claim on the dev server alive while the page was open. The Activity dialog shows the filter chosen last (#76).
- **Script and conversation suggestions are for what you typed last.** The script button (Write, View or Edit) shows for
  admins, read from `/api/me`, instead of from a search for a made-up name (#76).
- **A conversation you can't change no longer offers "+ Another way for the NPC to start"**, whose line was never saved (#76).
- Values from an area file (a thing's kind, a cave's roof height) go into request URLs encoded, and a picture name from the
  review service is used only when it is the 64 hexadecimal digits the service gives (#76).
- **The pointer over the view costs next to nothing.** The ground under it is found by walking the cells its ray crosses, and
  only again when the pointer, the camera or the ground moved: 0.08 ms instead of 27 ms on a 32×32 area, where a resting pointer
  held the editor near 20 frames a second (#78).
- **Sculpting a cave with a ceiling height redraws only what changed**, not the whole area each frame: a Dig frame on a 32×32
  cave takes 16 ms instead of 76 (#78).
- **Shadows bake again only where the ground moved.** Painting, Walkable (W), water, the textures arriving and opening the area
  no longer make the next stroke bake the whole area (317 ms against 40 on 32×32); undoing a Paint stroke bakes nothing, and an
  entrance added or undone bakes its surroundings (70 ms instead of 344). A water drag redraws the samples it wets or dries:
  4.5 ms a move instead of 49 (#78).
- **Many placed objects or things stay quick.** Placing, removing and undoing redraw only the objects that changed (with 300
  rocks: 1.2 ms to place or remove one instead of 240 and 221, 28 ms to undo instead of 550), and the things' markers are drawn
  in batches: 500 things take 351 draws instead of 1,892, and a frame of a drag 3 to 8 ms instead of 24 to 70 (#78).
- **The page starts lighter.** The texture library loads once instead of twice, the blank area shown when none was open isn't
  checked or looked up on the engine, and the script editor (CodeMirror, 512 KB) loads when it first opens. Thumbnails share one
  hidden renderer, which keeps nothing of what it drew (#78).
- **A new area with hills that isn't square gets hills of their full height.** Its hills were cut from a square as wide as its
  longer side, so they could stand lower than the hills asked for: on an 8 × 2 tile area with Hills (6 m), 1.1 m lower in half
  the areas and up to 3.2 m. Square areas get the same hills as before (#79).
- **File, Delete area.** It asks, naming the area open, then deletes it: it leaves your areas with its export, its name is free
  again, and the page opens your newest other area, or a blank one. Its copy in this browser goes too. The engine keeps its last
  copy for an admin (or you, on your own machine) to bring back; the module it was exported into and its hak stay. An area
  another tab or computer saved since this tab opened it is not deleted, nor one whose import your other areas use: the status
  line says which. Off in an admin's read-only view. It needs the engine of the same release (#80).
- **Export and Check paths send the area's palette, water, entrances and atmosphere in the request's body**, not its address,
  which keeps only the name and simple settings. It needs the engine of the same release, which refuses the old form (#80).

In this release too:

- **Things: "The blueprint's (on)" or "(off)".** The first choice of an on/off setting says what the blueprint has, read from the
  engine's `GET /api/blueprint-fields`. With an older engine, or one that can't be reached, it reads "The blueprint's" as before.
- The lint finds a request made without `api()` in any form (`window.fetch`, an aliased `fetch`, `XMLHttpRequest`, `sendBeacon`)
  and `srcdoc` set through `setAttribute`. `lint/fixtures/` holds what it must find and what it must let through, and
  `tests/lint.test.js` checks both (#79).
- README: the publishing note at the top is gone; autosave, Publish, the New area size (3 to 32 tiles each way) and the
  Content-Security-Policy are described as they work now.
- Tests: `node --test 'tests/*.test.js'` runs the area's undo, JSON and entrance ids, the save queue, Delete area, what an export
  sends and the read-only guard without a browser; CI runs them (#75, #80).
- `STYLE.md` is nwn-bake 0.5.2's again (measured layout data is CC0-1.0), and `scripts/shared-files.sh` checks the shared files
  against nwn-bake's in CI.
