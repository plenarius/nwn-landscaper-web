# Changelog

All notable changes to the Landscaper's web editor. Versions follow [Semantic Versioning](https://semver.org/). Each release is
tagged with the same `vX.Y.Z` as the engine's, [nwn-landscaper](https://github.com/plenarius/nwn-landscaper), and works with the engine
of that release; before 1.0, a minor version may change the HTTP API between them. The engine has its own changelog. Changes
not released yet wait in `changelog.d/`, a file each, until the release puts them in its section.

## 0.7.4

- **Update to X.Y.Z in the app.** In the desktop app, the version menu offers a newer release when the app finds one (a dot
  shows beside the version), with what is new, and asks before the app installs it and starts again. An app installed from the
  `.deb` offers the release's page instead, to download the new `.deb`.
- **Scenery past the edge: the mix brush, Scatter and Place work on the band.** The mix paints the band round the area with the
  area's own patches, so they run on across the edge. Scatter and Place stand trees, rocks and bushes on the band, which the game
  draws past the edge (models near it, cards farther out), casting shade and never in the way; Scatter keeps off the band's steep
  ground and water, and Shift-drag erases there too. Placeables, things, entrances and particles stay inside the area, and the
  editor says why when you try. The export's report counts the objects on the band as scenery, not as outside the area.
- **Carry the scenery outward,** in the Scatter panel, fills the band with scenery like what stands near the area's edge: the
  same models in about the same density and mix, off steep ground and water, thinning a little towards the band's rim. One undo
  takes it back, and pressing it again tops the band up rather than doubling it.
- **The band's first fill eases out from the edge.** It carried each edge sample straight out, so a hilly edge ran out as long
  ridges and steps. Now the strip by the edge matches it and further out the bumps spread into slopes. A band still as the old
  first fill left it is filled again when the area opens; a band you shaped is kept.
- **Help → Handbook and the browser page's links go to <https://landscaper.layonara.com/>,** where the handbook moved.
- **The browser page starts without downloading its engine again.** The page keeps `landscaper.wasm` and the stock models it
  fetched in the browser's Cache Storage, named by their SHA-256 in `try/site.json`, and reads them from there on later
  visits; a release with a new engine or stock bundle fetches the new files and deletes the old ones. The engine is kept only
  when its SHA-256 matches. Firefox is no longer asked for persistent storage, which made it show a prompt.
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
- **An interior's walls stand upright in the view,** on the room's edge, as the game draws them with the engine of the same
  release. A door pushed a little into a wall is drawn on the wall's line, and any other thing there on the floor at its foot,
  where the game puts them.
- **Natural ground no longer has dark dots every metre or so.** Since 0.7.3 grass, dirt, mud, sand and rock drew a small dark
  triangle in the middle of each of the cells that hide their repeat, on every texture and on the lake beds. The view now
  blends those cells without the sum of their weights dropping out.
- **Walkable is in the top bar,** beside the path check's status, instead of at the foot of the tool column, where a laptop's
  screen had to scroll to reach it. W still toggles it. Where the bar is short of room, Walkable, Markers, Check paths and
  Export show their icons only, in that order, with the name in the tooltip; in the Things tool the Show button says
  **Show: all**.
- **The path check's markers start hidden.** The status button still counts the spots; **Markers** (M) shows them on the map,
  and the browser remembers that choice. The Check paths report and the status's tooltip say so.
- **The browser page's title stays in the top bar.** With the bar full, its "Download to desktop" badge broke onto a second
  line and pushed the title out of the bar.
- **Show > Scenery (Place and Scatter).** Untick it to hide the trees, rocks and bushes in the view, to sculpt or paint the
  ground under a forest. Place, Scatter and Things still show them, and the area and its export keep them. The browser
  remembers it.
- **An interior's walls show their own paint down to the floor** in the view, as the game draws them with the engine of the
  same release: the floor's paint no longer climbs the lower part of a wall.

## 0.7.3

- **Grass in the Sky & fog panel.** A tick turns on the game's own animated grass for the area, with its density and height;
  off by default. Picking a look keeps it. It needs the engine's grass (nwn-landscaper 0.7.3 or later).
- **The browser page opens an area from a link.** `?area=<address>` (the handbook showcase's **Open in Landscaper**) fetches
  that area file from the page's own site, keeps it in the browser and opens it. If the browser already has an area of that
  name, you choose to open yours or the link's under a free name; yours is never replaced.
- **The browser page links to the desktop app.** A small "Download to desktop" badge under the title opens the handbook's
  page on installing it for each system.
- **Natural ground and rock hide their repeat.** The view draws a natural texture's repeat in small hex cells, each shifted its
  own way and blended into its neighbours, with a slow change of brightness, as the game's tiles do
  (plenarius/nwn-landscaper's matching change); laid surfaces keep their regular pattern, and a texture's `vary` in the catalog
  sets it.
- **Water that isn't clear.** Sky & fog has **Water**: Clear, Murky, Stagnant green or Dark pool, saved in the area's light and
  fog (`atmosphere.water`) and drawn in its colour in the view. The Swamp look picks Murky; an area without one stays Clear.
- **An area always opens in light to work in.** Sky & fog's **Show in the view** starts off, so an area opens in the view's
  working light; tick it to see the area's own light and fog, and the page remembers that. Light too dark to work in (a cave by
  night) keeps some of the working light under it, its fog lifted as much: such a cave drew as a black screen.

## 0.7.2

- **Each texture at its own size.** The view draws a texture repeating every `metres` its library entry gives (4 when it
  doesn't say), as the game's tiles do: the starter set's cliff rock, swamp rock and canyon rock repeat every 8 m
  (plenarius/nwn-landscaper's matching change).

## 0.7.1

- **The Ambience tool's kinds say which one the brush paints.** Each kind's tooltip said "The brush places it", the chosen one
  or not; now the chosen kind says the brush paints it, and the others say a click makes it the brush's.
- **Ambience: no particle cap.** The brush and Fill no longer stop at 1,500 particles alive: how busy an area is, is the
  builder's call. The panel still counts them by day and at night, and past 1,500 notes the area may be heavy on slower
  machines, as a guide rather than a limit.
- **Cliffs turned from the sun are lit as the export lights them.** The view's shade no longer darkens ground turned away
  from the game's sun for the shadow it casts on itself (the sun doesn't reach it anyway), and steep ground takes some of the
  sun or moon bounced off the ground below it, as the game's tiles now do (plenarius/nwn-landscaper's matching change).
- **A placeable whose model the engine doesn't have shows as a box.** An area from another install drew nothing where those
  stood; now each is a translucent box you can see, select and move, one line over the view names the models once for the area,
  and Live stays green or amber instead of red.
- **The browser page uses its stock placeables.** With the game's stock models beside it, the page fetches each one when an area
  or a panel first needs it, Place and Scatter work, and Export takes the page's own shaders without asking for the game folder.
- **Missing textures:** an area painted with textures the library hasn't got draws them as a magenta checker, not grey ground,
  and a notice says which and how much of the ground each covers. Its dialog adds starter ones from the game (an admin, with an
  engine that can) or swaps each for a library texture, as one step of undo. Export refuses with the same words.
- **The view draws painted edges as the export now bakes them.** Where two textures meet, the view showed the paint's 0.625 m
  grid, the same sawtooth the game did. It now smooths each texture's paint over about 1.5 m and draws the edge there, by the
  engine's own rule: sharp on a smooth line for laid surfaces (cobbles, flagstones, floors, planks), ragged by the same noise and
  by the textures' own light and dark for natural ground, as the texture catalog's `edge` (or the texture's category) says.
  What the view shows is what the game will show after export, to a few millimetres. Specks a sample or two across, like the mix
  brush's soft edge, are smoothed away in the view as in the game. Steep ground keeps its one texture a face. Needs the engine's
  soft paint bake (nwn-landscaper #95).
- **Walls meet the floor without stripes in the view.** At a crease, where the face's own slope and the smoothed one part (a
  cave wall's foot, a cliff's base), a texture's three projections blend by the face's own, as the export now blends them in
  the game. Blended by the smoothed normal, the wall's foot streaked in a band where it met the floor.
- **The browser page's start card no longer says there is nothing to install.**
- **Open shows the area files it can't open.** Below your areas, greyed, each `.json` of the areas folder the engine leaves out
  of its list, with the reason: a name longer than 9 characters, broken JSON, or a `name` that isn't the file's name. A file
  copied in by hand used to vanish from Open without a word. Needs the engine's `unlisted` (nwn-landscaper #94); with an older
  engine Open is as before.
- **A lake's shore is smooth in the view, not a sawtooth.** The water stopped at the 0.625 m cells where the shallows under 15 cm
  began, so its edge stepped along the grid. It now runs on over the shallows to where the ground comes up through it, as the
  game draws it (nwn-landscaper #89): a ford shows a faint film of water, and the band's and the edge scenery's water follow. The
  shallows stay dry to walk on and paint.

## 0.7.0

- **Every area has a band of ground round it, shown past its edge in the game.** 50 m beyond each side, drawn round the area in
  place of the old extruded edge. Raise, Lower, Smooth, Flatten and Paint shape and paint it where the brush reaches past the
  edge, with undo; the area's water runs on into it where its ground is lower. A new area, and an old one when it is opened, gets
  a first fill that carries its edge straight out, as the game's edge scenery showed it before. An export sends it as the
  area's halo, and the engine draws it past the edge in the game. A cave or an interior has none. Needs the engine's `halo`
  (nwn-landscaper #78 and its band export).
- **The Ambience tool (A) places particles.** A palette of the particle pack's kinds; **Fill** puts the ticked ones where the
  area calls for them (mist on water, more where it is wide; spray where water drops; leaves under trees; fireflies on grass
  near water; motes and light shafts in gaps in the trees and at cave mouths; sand on dune crests; snow on ridges; ground fog in
  hollows), at a density the builder sets, with the wind's bearing for snow and sand. The brush adds the chosen kind, Shift-drag
  clears it. The panel counts the particles alive by day and at night against the area's cap of 1,500, and Fill and the brush
  stop there. The view draws them as moving points in each kind's colour, night-only kinds by night. The area keeps them, with
  undo, and an export sends them as `ambience`, each standing on the ground or water as it is then. Needs the engine's
  `/api/particles` and baked emitters.
- **Delete works on the area the page opens at its start.** The area last open, opened again when the page starts (a reload,
  or the browser reloading a tab it put to sleep), didn't keep which copy of it the engine had. Delete then said another tab
  or computer had saved it when none had, until the area was opened again from File, Open, or changed. Its first save after
  the start is checked now too.
- **The editor in the desktop app.** Opened by the app (at `/?app`), the editor has a Help menu with the handbook, the data
  folder and the log, and an Area, Game folders… item that shows the app's page for the game's folders again. It leaves out
  "How to start the engine", since the app starts its engine, and says to restart the app if that engine stops answering. In a
  browser the editor is as before. Needs the app's engine for the menu's items (the engine's step 2 of
  [DESIGN-desktop-app.md](https://github.com/plenarius/nwn-landscaper/blob/master/docs/DESIGN-desktop-app.md)).
- **Dig's edges are clean outdoors.** In an outdoor area a dug edge is now a steep bank (about 63°, still too steep to walk)
  that climbs from the floor to the ground around it, instead of a saw-tooth of drops straight down that followed the grid's
  0.625 m steps. The edge keeps its ragged outline. In a cave or an interior, Dig's walls go straight down as before.
- **Tool keys work after Sky & fog.** A tool's letter (B Light, A Ambience and the others) picks the tool right after a click
  on a slider, radio button or tick box in a panel, which used to swallow it until a click in the view; text and number boxes
  still keep every key. Picking a tool closes Sky & fog, which lay over the tool's panel.
- **A small Valley with a lake can be walked.** Its hills rose 15 m wherever the area was, so in an 8 by 8 area they made a
  ring of slopes too steep to climb, with gaps the game can't path through: Check paths showed up to 50 blocked routes, most
  into a corner cut off behind it. Under 16 tiles across the hills are now lower, as steep as in the 16 by 16 sample and no
  steeper; 100 new 8 by 8 valleys had no blocked routes. The 16 by 16 sample and larger are unchanged.
- **The Light tool (B) paints local light.** Each tile has two lights, and the tool gives the tiles under the brush two of
  the game's 32 tile light colours (`lightcolor.2da`); Shift-drag turns them off, and Whole area and All off do the whole area
  as one undo step. Presets per kind of area (none outdoors by day, warm pools in a village at night, cold blue in a cave, and
  more), outlined when they suit the open area. A tile is 10 m, so this is a broad wash: lamps stay placeables. The view draws
  the wash on the ground, and the area keeps the colours and sends them with an export as `lights`. Needs the engine of this
  release (an older one leaves the lights off).
- **The Light brush lights the hall the pointer is over in a cave.** A cave's rock tops are drawn black, so from a slanted
  camera a lower hall shows through the space above the rock in front of it; the brush lit the rock's tiles there, where no
  light shows, and the hall stayed dark (a *Descending cave*'s bottom hall, say). It now looks through rock tops to the
  ground behind them. The other tools still stop at the rock.
- **A long descent no longer shows as blocked.** A new *Descending cave* showed "68 blocked" in the live check, though every
  route in it is walkable: NWN's route search gives up when the way is about 20 tiles longer than going straight there, so
  one click from one end of the descent to the other stops, and two or three shorter clicks get there. With an engine that
  tells these routes apart (`routes.long`), the live check says *Paths OK* and its tooltip counts them, and Check paths says
  how many are too long for one click and how many clicks they take. Blocked routes stay red as before.
- **Place, Scatter, Things, Scripts and Import say when they need the game.** With an engine that has none of the game's
  files (the coming web demo; `/api/me` answers `"game": false`), each says so plainly, in place of lists that would stay
  empty, with a **Use my game folder** button. Reading the game folder in the page comes later; for now the button says so.
- **The snowy pass and rough hills can be walked everywhere.** The pass's cliffs rose 30 to 46 m over 26 m, eased at both
  ends, so a lower cliff was hardly steeper than walkable ground but in its middle, and the shoulder's wandering width
  flattened ledges into it: Check paths showed blocked routes onto them in about 1 in 6 new passes. Its cliffs now rise half
  straight, half eased, over 16 m, too steep to climb from foot to top. Rough hills scattered small patches too steep to walk
  over their slopes, and NWN's route search got lost among the holes they left: 15 blocked and 25 too-long routes in 32 new
  areas. Patches under about 16 m² are now smoothed away (the hills keep their whole height). Over 24 new areas of each, both
  have no blocked routes; the other samples are unchanged.
- **Sky & fog picks the sky.** Each preset names its sky, so choosing a preset sets the sky too: the Preset skies pack's when it
  is installed, else the game's nearest one. A Sky row shows the sky's picture and lists the installed skies and the game's, to
  pick another; Area settings no longer has a sky box of its own. The 3D view draws the sky around its camera, by day or by
  night, so the horizon looks as in the game. A new preset, Dawn, goes with the pack's Dawn haze sky, and the sample landscapes
  take their presets' skies. Needs the engine of this release (an older one shows no pictures and keeps the area's sky box).
- **Steep ground lit and painted as the engine exports it.** A steep face slanting across the samples, like a river's bank,
  takes its slope over 1.25 m each way for its light, blended in between 15 and 30 degrees, as the engine now gives the game:
  each sample's own slope swung from one to the next there and showed as dark blotches along the face. Gentler ground is lit
  as before, and whether ground is too steep to walk still goes by each sample's own slope. Steep ground now takes the texture
  that weighs most where the four samples around it blend, as the engine cuts it, instead of the nearest sample's.
- **The editor can run its engine in the browser**, with nothing to install: the coming "try it" page (the engine's
  [DESIGN-web-demo.md](https://github.com/plenarius/nwn-landscaper/blob/master/docs/DESIGN-web-demo.md)). The engine built for
  WebAssembly runs in a Worker of the page, a Service Worker passes it the editor's requests, and the areas and the texture
  library stay in the browser's storage between visits. File has **Download area** and **Open area from a file**; Export
  downloads a zip of the module and its haks. `scripts/try-site.sh` makes the page from a release's engine and the demo
  texture pack. From `landscaper serve` and the desktop app the editor is as before.
- **A yes-or-no question no longer shows an empty text box** (Delete area, replacing an area of the same name).
- **In the browser, Export asks for your game folder**, so the area draws right in the game: its tiles' shaders are made from
  three small files of the game, read from your own install and kept only while the page is open. Chromium remembers the
  folder; Firefox and Safari ask each visit. Without it the export still downloads, with a line saying it needs them.
- **In the browser, an area over 16 by 16 asks first**: exporting it may need more memory than the browser has.
- **Water too shallow to see is drawn dry.** Ground under less than 15 cm of water shows as dry ground, as the engine now
  exports it and the game shows it: the game draws water that shallow almost clear. A click there starts a new body of water
  instead of taking the one around it, and a body's level can't be dragged below 20 cm over the ground clicked. Needs the
  engine of this release.
- **Doors look like doors.** In the Things tool a door, and a placeable placed from a blueprint, is drawn as its model, with
  its textures, turned the way it faces and standing on the ground, instead of a coloured box that never turned; an imported
  area's own doors too, a little greyed as their markers were. The selected one has the Place tool's handles and keys: drag,
  G to move, R to turn, Q/E, the arrows and the ring (no size: the game has none for doors). A door the tile itself draws,
  or one whose model can't be found, keeps its marker.
- **The version beside the title.** The top bar says which version is running, small, after *NWN Landscaper*: the engine's
  (from its `/api/me`, which needs this release's engine) and this editor's (from the CHANGELOG.md next to it). A click shows
  both and links to the release's notes. An engine and editor of different releases show both, in orange; a build from
  `main` or `master` after a release says `+dev` after that release's version.

## 0.6.1

- **No change to the editor.** Released with the engine's 0.6.1: no more dark teeth along river banks, and a signed Windows
  build.

## 0.6.0

- **Paint a mix of textures.** Mix, at the top of the Paint panel, paints several textures at once as a blend of patches,
  the way Scatter mixes models: click textures to put them in the mix or take them out (Shift-click starts a mix from One
  texture, Shift with the eyedropper adds the ground's texture), and give each a weight. *Patch size* sets how big the patches
  are, 1 to 20 m. The same ground always takes the same patches, so going over it again changes nothing; *Reshuffle* lays them
  out anew. With a mix the brush's strength is *Cover*: how much of the ground the mix paints, in whole patches, the rest
  keeping its texture; *Soft edge* thins it out toward the brush's rim. The mix stays in this browser for every area; the area
  file is the same as for any painting. A tile with several textures gets its own baked texture in the hak (about 175 KB):
  half of a 16 × 16 area in a mix made its hak 24 MB larger and its export 11 seconds longer (on four cores).
- **The quick buttons match whole words.** **rock** found anything with "rock" inside a word, a rocking chair with an old
  woman among them; it now finds rock, rocks and rocky. The other buttons do the same (cacti for cactus, bushy for bush).
  Typed searches still match inside words.
- **Lighter undo, browser copy and brush.** Each undo step keeps only the rectangle of ground it changed and the lists it
  changed, not a copy of the whole area: 40 brush strokes on a 32×32 area hold 2.1 MB instead of 66 MB. Undo and redo work
  as before. The copy the editor keeps when a save fails is in IndexedDB instead of localStorage, so an area bigger than
  localStorage's 5 to 10 MB still fits; a copy an older page kept is moved there at the next start. While you sculpt or paint,
  only the changed part of the ground goes to the GPU: 0.67 MB a frame instead of 12.7 MB on a 32×32 area, and a frame
  takes about 3.6 ms instead of 7.3 ms on a GeForce GTX 1050.

## 0.5.0

- **Texture categories fold.** Each category in the Paint panel is a heading that opens and closes, with its count, and
  *Collapse all* and *Expand all* sit at the top; which ones are closed is remembered in the browser. A closed category still
  shows the texture you paint with, and picking a texture from the ground opens its category.
- **Sample landscapes take a team library's own textures.** Where a library lacks the starter library's ids, each part of a
  sample landscape takes the library's texture of the same category (snow, sand, rock…) instead of the default grass: the
  snowy pass is snowy and the dunes sandy with any library that has snow and sand.
- **The module's haks' placeables in Place and Scatter.** With an engine that reads the module's haks, the panels offer their placeables
  too (a module of 57 haks: 6,259 models where the game alone gives 1,304; "cactus" finds 52, "bush" 71). Each result names where it comes
  from (the game or a hak), and a list under the search box picks one source alone. Results come 48 at a time with **Show more**, the
  count above them. The list is indexed once (about 220 ms in Chromium, with its download); a search then takes under 1 ms, and results
  show 50 to 90 ms after the typing pause. Rows whose model is nowhere (placeables.2da's `user01` placeholders) are no longer offered.
- **Small plants and Large plants.** Two chips beside rock, tree, bush and the rest, and a new **cactus** chip. The engine finds the
  plants by their names (bush, shrub, fern, flower, cactus, reed, grass, weed...; not trees, vases, planters or wall ivy) and sizes each
  by its model's height: from 1.5 m a plant is large (with that module's haks, 274 small and 93 large). In Scatter a group's chip also
  makes the mix: up to 12 of the group's models, a few of each kind in turn and spread across each kind, without cacti and reeds (they
  grow in their own places: their chip or a search adds them). Needs the engine of the same release (`/api/placeable-groups`).
- **Thumbnails don't pile up.** A search's pictures not drawn yet when the next search replaces its results are skipped, and the page
  takes clicks and keys between two pictures.
- **Get more textures** (the Paint panel): a dialog of the texture packs the engine offers (name, size, texture count, licence,
  credits and a few swatches) and those installed, with **Install** (its download, check and install shown on a progress bar,
  going on with the dialog closed) and **Remove** (refused, with the areas named, while one paints with the pack). After either,
  the library and the palette load again; a texture painted with that left gives way to the default. Builders on a team server
  see the list without the buttons. Needs the engine of the same release (`/api/textures/packs`).
- **Textures keep their size on every slope.** The view draws each texture from three sides at once (from above, along x and
  along y), blended by which way the ground faces, as the engine of the same release draws it in the game. Steep ground took its
  texture from the side along x + y, so a slope facing north-east or south-west smeared it into streaks; walkable slopes took it
  from above, 1.6 times stretched at 50 degrees. An older engine still exports the old way.
- **Scattered and placed objects stand on their base.** On a slope, a tree sank until only its crown showed, and a bush
  until only its top did: the editor stood each one on the lowest ground under its whole bounding box, crown and all. It now
  stands on the lowest ground under its base: its walkmesh's footprint (a tree's trunk), or else its lowest 0.3 m. Moving,
  turning or sizing one settles it the same way.
- **"Not on steep ground or water" looks under the whole base**, not only its middle: a bush no longer stands in a lake
  beside its shore.

## 0.4.0

- **Chasm** (key `c`): a bottomless drop that blocks the way, for a cliff edge, a canyon rim, a gap between ledges or a
  floating island. The brush opens one with a slightly ragged rim; Shift-drag fills it back in, the ground as it was.
  *Along the whole edge* opens one the brush's width all round the area. The view draws its walls fading to black and its
  floor black, as the game does; nothing walks in it or on its rim, and water stops at it. To cross one, leave ground at
  least 6 m wide over the middle of a tile edge. Not in caves or interiors. Needs the engine of the same release: an older
  one exports the ground there as it is.
- **The ground beyond the area's edge is drawn as ground again.** The view drew it black on every outdoor area, as if it
  were a cave's rock.

## 0.3.1

- **No change to the editor.** Released with the engine's 0.3.1, whose exports of imported areas are quicker again.

## 0.3.0

- **The view shows baked objects' shadows.** Trees and other baked objects cast their shadows on the ground as the engine
  bakes them: from the game's sun, through the gaps in leaves, at the area's shadow strength, in either light.
  Placeables (object mode) cast none, as in the game.
- **Baked shadows are as dark as in the game.** The view darkened them about half as much: the game multiplies them in display
  colours and the view did in linear ones.
- **Four sample landscapes** in New area: a canyon (a sandy floor between stepped rock walls), a snowy mountain pass (a path
  over a saddle between cliffs, snow falling), a dune desert and a valley with a lake. Each is painted with the starter
  library's textures (or the area's default where a team's library lacks them), lit, and given a sky box and weather; each is
  different every time. Their walkable ground passes the path check: every route works, with a few *too winding* tiles where a
  wall crosses the grid at an angle.
- **Import heightmap** (Area menu): a greyscale image becomes the open area's ground, black and white at the heights you give,
  stretched over the area or cropped to its shape. 16-bit PNGs are read at full precision (the browser alone gives 8 bits,
  256 levels); 8-bit images can be smoothed to hide their steps. Undoable.
- **Underlay** (Area menu): a picture under the ground to paint, raise and place on top of, such as a battlemat or a map from
  a book. It can be made see-through, moved by dragging, turned, sized by its width or by two points a known distance apart
  (in metres or feet), and hidden with `U`. Where it lies is saved with the area; the picture is kept by the engine beside
  the area, so it is there on another computer. Needs the engine of the same release (`/api/underlay`).

## 0.2.4

- **The Place list's pictures check which way up they come back.** On a builder's machine they stayed upside down after
  0.2.3, so the editor now draws a test picture once and reads which way its rows arrive before turning the pictures.

## 0.2.3

- **The Place list's pictures are the right way up in every browser.** Some browsers turned them upside down (a builder's
  birch trees stood on their crowns); the editor now reads each picture's pixels itself.

## 0.2.2

- **The Show button says when it doesn't apply.** In the Things tool every kind of thing shows, whatever is ticked, so the
  button reads *Show: all (Things tool)* there and *Show (n)* elsewhere.

## 0.2.1

- **Test on the dev server is gone** from the Share menu, with its dialog: Try on dev, in the Publish dialog, replaces it. New
  scripts can't be tried on dev; they go through Publish. A transition's *Pick a waypoint of an existing area* now asks the
  engine's `/api/waypoints`. Needs the engine of the same release.

## 0.2.0

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
