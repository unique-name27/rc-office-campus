# RC Campus v4 — module contracts

The page is ONE html file (a claude.ai artifact; the baked-light images in `src/assets/bake/` sit beside it, section 11) built by concatenating modules into a single
`(function(){"use strict"; ... })();` script inside one `<script type="module">`, which imports three.js r165 (and its post-processing
add-ons) from jsDelivr through an import map; only the game/renderer uses `THREE`. Generated data modules: `js/avatar-meshes.js`
(`AVMESH`, from `src/blender/avatars.py`), `js/kit-meshes.js` (`KITMESH`, from `src/tools/pack_kit.py`) and `js/sound-data.js`
(`SOUND_DATA`, the recordings in `src/assets/sounds`, from `src/tools/pack_sounds.py`). Studio is the HD style
(`js/game-2c-hd.js`: color-managed, image-based light, GTAO, bloom, quality levels); the other styles keep the classic unmanaged colors.
Today it is a single-floor RC-car game ("Floor 4 Walkthrough"). v4 turns it into a **San Jose campus: 2 buildings x 4 floors**
with real coworkers loaded from facilities data, per-team desk arrangements, floor-plan import, routes and races.

Files (all under `v4/`):

| file | global | owner | depends on |
|---|---|---|---|
| `js/layout.js` | `LAYOUT` | agent | nothing |
| `js/campus.js` | `CAMPUS` | agent | nothing at load; tests may use LAYOUT |
| `js/nav.js` | `NAV` | agent | nothing |
| `js/importers.js` | `IMPORT` | agent | nothing (pdf.js passed in at call time) |
| `js/editor.js` | `EDITOR` | agent | nothing at load; gets helpers via `open(opts)` |
| `js/props.js` | `PROPS` | agent | nothing (section 10) |
| `js/game.js` | — | main | everything above + THREE |
| `js/game-2f-physics.js` | `PHYS` | agent | the game scope, `PROPS`, Rapier (lazy, optional; section 10) |
| `js/game-2d-fx.js` | `FX` | agent | the game scope, `FX_DATA` (`js/fx-data.js`, from `src/blender/fx_sim.py`; section 11) |
| `js/game-2e-bake.js` | `BAKE` | agent | the game scope, `BAKES` (`js/bake-data.js`, from `src/tools/bake/`; section 11) |

## Module rules (all modules)
* Exactly one top-level declaration: `const NAME=(()=>{ ... return { ... }; })();` — no `import`/`export`/`require`, no other globals,
  no side effects at load (no DOM access, no timers) except `EDITOR` may touch the DOM inside `open()`.
* Plain modern JS (ES2020), runs in Chrome/Safari/Firefox and in Node 24 (tests).
* Deterministic: any randomness uses a seeded PRNG (mulberry32-style). Never `Math.random()` in LAYOUT/CAMPUS/NAV/IMPORT.
* Never throw on bad input data (it comes from spreadsheets and other people's edits): clamp, skip, and report.
* Tests: `v4/tests/<module>.test.js`, run with `node v4/tests/<module>.test.js` (use `node:assert`, no npm packages).
  Load modules with `require('./load')('nav.js','NAV')` (see tests/load.js). Keep test runtime < 10 s and single-threaded
  (the user's PC is unstable under heavy CPU load: no worker pools, no parallel test runners).

## Coordinates & conventions
* Meters. **Floor frame**: origin at the floor plate's center, +x = east (screen right), +z = south (screen down on maps).
  The plate is the rectangle x∈[-w/2, w/2], z∈[-d/2, d/2].
* **Yaw / facing `a`** (radians), same as the game's car heading: forward vector = (-sin a, -cos a).
  a=0 faces north (-z), a=π faces south (+z), a=π/2 faces west (-x), a=-π/2 faces east (+x).
* Floor keys: `"B1-3"` = building `B1`, floor 3. The outdoor world's key is `"campus"`.
* Heights: floor-to-ceiling interior walls are 3.0 m. Car is ~0.5 m long, 0.25 m wide, drives UNDER desks (desk top at 0.75 m).

## 1. Layout spec  (authored data; stored in db doc `floors/<key>`; produced by CAMPUS.demo() or the EDITOR)
```js
{
  v: 1, key: "B1-3", b: "B1", f: 3,
  w: 72, d: 44,                               // floor plate size, meters
  door: null | { side: "s"|"n"|"e"|"w", at: 0, w: 3 },  // exterior doorway (floor 1 only). at = offset along that wall from its center
  plan: null | { asset: "<32 hex>", x: -36, z: -22, w: 72, d: 44, opacity: 0.55 }, // plan image: top-left corner + size in floor meters, north up
  walls: [[x1,z1,x2,z2], ...],                // full-height interior walls (0.15 m thick). ANY angle allowed.
  glass: [[x1,z1,x2,z2], ...],                // full-height glass partitions. ANY angle.
  rooms: [{ id: "r1", type: ROOM_TYPE, name: "Silicon", x, z, w, d, door: "n"|"s"|"e"|"w"|null, seats?: 8 }], // x,z = center, axis-aligned
  zones: [{ id: "z1", team: "Validation Lab", arr: ARR|null, x, z, w, d, dir?: "h"|"v" }],  // team neighborhoods, auto-filled with desks
  desks: [{ id: "3-114", x, z, a, arr?: ARR, team?: "..." }],   // explicit desks (facilities coordinates / hand placed); a snapped to 90°
  ramps: null | [{ k: "kick"|"hump", x, z, ax: "x"|"z", dir: 1|-1, len, w, h }],  // null => LAYOUT auto-places fun ramps
  updatedAt: 0
}
```
* `ROOM_TYPE`: `conf` (glass walls, table, chairs, wall screen), `office` (private office, solid walls + door, one desk inside whose id is
  `room.id`), `phone` (1-2 person booth), `kitchen` (counter, coffee machine, fridge, tables; coffee-run pickup), `lab` (room shell only:
  contents come from zones inside it), `restroom`, `stairs`, `elevator` (shaft with doors on its `door` side), `lobby` (reception desk,
  sofas; floor 1), `server` (racks), `storage`, `mail` (counter+printer), `wellness`, `open` (label only, no walls).
  `door:null` => the room is a solid block (not enterable). Doorway = 1.0 m gap centered on that side (2.0 m for `lobby`, none for `elevator`:
  elevator doors are closed panels; the car rides by stopping on the elevator **pad** in front of them).
* `ARR` (desk arrangement): `"bench"` open bench pods, `"cubes"` cubicles, `"offices"` private offices, `"lab"` lab benches,
  `"hot"` hot desks / shared tables. `null` => use the team's default (teams map below), else `"bench"`.
* Elevators: every floor of a building has its elevator rooms at the same x,z (same `id` across floors) so a ride keeps you in place.

## 2. Teams map (stored in db doc `campus/main`.teams)
`{ "<team name>": { color: "#RRGGBB", arr: ARR } }`. Team names come from the people data verbatim (trimmed).
`CAMPUS.defaultArr(name)` guesses: /lab|validation|characteri|reliab|failure|test floor|bring.?up|silicon val/i→lab,
/financ|legal|exec|ceo|cfo|counsel/i→offices, /hr|people|account|payroll|procure|supply|operation|quality|facilit/i→cubes,
/sales|market|customer|field|support|business dev/i→hot, else bench.

## 3. Roster (people)  (db doc `roster/<key>` = `{ v:1, rows: [[desk, name, team, title], ...], src, updatedAt }`)
In code: `[{ desk: "3-114", name: "Priya Shah", team: "Verification", title: "Staff engineer" }]`. desk may be "" (unknown).
Only these four fields are ever stored. (Import ignores every other column: no ids, emails, managers, HR fields.)

## 4. FloorModel  = `LAYOUT.build(spec, roster, teams)`   (pure, deterministic, < 20 ms for 400 people)
```js
{
  key, b, f, w, d,
  walls:  [{ x1, z1, x2, z2, t, h, kind: "ext"|"int"|"glass"|"part" }],  // every wall to draw (exterior shell with door gap, spec walls,
                                                                          // room walls with door gaps, cube/office partitions). part = 1.3 m high
  rooms:  [{ id, type, name, x, z, w, d, door, solid }],                  // for signs, minimap, destinations
  areas:  [{ kind: "carpet"|"esd"|"tile"|"lobby"|"wood", x, z, w, d, team?, color? }],  // floor finishes (team neighborhoods = carpet tinted by team color, lab zones = esd)
  desks:  [{ id, x, z, a, w, dd, arr, team, zone, person: -1|peopleIndex, mon: bool, chair: chairIndex|-1 }],  // w = width across the sitter, dd = depth
  people: [{ name, team, title, desk: deskIndex, auto: bool }],          // auto = desk id didn't match; placed in their team's area
  unplaced: [{ name, team, title, desk }],                                 // no free desk anywhere on this floor
  chairs: [{ x, z, a, desk: deskIndex|-1, kind: "task"|"stool"|"conf"|"guest" }],  // pushable chairs, home positions
  items:  [{ t: ITEM, x, z, y?: 0, a, w, d, h, c?: "#hex" }],           // furniture/equipment to draw (desks/chairs/monitors are NOT items)
  blocks: [{ x0, x1, z0, z1, m, tall }],                                  // AABB colliders. m: 1 car, 2 chair, 4 walker (bitmask). tall: 1 if h > 0.7 m
  posts:  [{ x, z, r, m, tall }],                                          // circle colliders (desk legs r .03 m=3, pots, pedestals, rack feet...)
  elevators: [{ id, x, z, a, pad: { x, z, r: 1.0 } }],                   // a = facing out of the doors; pad = where the car stops to ride
  stairs: [{ id, x, z }],
  exit: null | { x, z, a, r: 1.2 },                                        // floor with `door`: pad just inside the doorway, a = facing outward
  spawn: { x, z, a },                                                      // where you appear: floor 1 = inside the door facing in; else in front of an elevator facing out
  kitchen: null | { x, z, pickup: { x, z, r: 0.9 } },
  coffee: [deskIndex x5],                                                  // coffee-run recipients: occupied desks spread far apart (deterministic). [] if < 5 occupied
  ramps:  [{ k, x, z, ax, dir, len, w, h }],                               // same shape as the game's RAMPS today; placed only in open aisle space
  signs:  [{ lines: [title, sub?], x, y, z, h, stripe: "#hex"|null }],    // team area signs (y≈3.4), room signs (y≈2.9)
  dests:  [{ id: "desk:3-114"|"room:r1"|"elev:e1"|"kitchen"|"exit", kind: "desk"|"room"|"amenity", name, sub, x, z, a }], // routable; x,z = a FREE standing point in front (aisle side), a = facing toward the thing
  teams:  [{ team, color, count }],
  stats:  { desks, occupied, open, unplaced }
}
```
Collision masks (match the game): walls/solid rooms/racks/cabinets m=7 tall=1. Desk tops: walker-only block m=4 over the desk
footprint (the car drives under), plus 4 leg posts r=.03 m=3. Bench divider panels: m=2 (chairs) + walker m=4 (cars pass under? no: panels
go down to 0.3 m, so m=7, tall=0). Lab benches: m=7 tall=1 (solid cabinets underneath). Tables: pedestal post m=3 + walker block m=4.
Chairs are NOT in blocks (they are dynamic). Everything must leave >= 1.4 m clear aisles between groups so cars, walkers and routes pass.

ITEM vocabulary (renderer draws these; y = base height, h = height, w along local x, d along local z, rotated by a):
`panel` bench divider, `table` round (w = diameter), `rtable` rectangle, `bench` lab bench (top 0.9), `shelf` lab riser shelf on a bench,
`rack` equipment rack (c = LED color), `scope` instrument box on a bench (y = bench top), `chamber` thermal test chamber, `probe` probe
station, `cabinet`, `plant`, `counter`, `coffee` machine (y = counter top), `fridge`, `screen` wall TV, `sofa`, `reception`, `printer`,
`whiteboard`, `elevdoor` elevator door pair (w = width, a = facing out), `booth` phone booth shell, `locker`.

## 5. Campus  (`CAMPUS`)
```js
CAMPUS.demo() -> { campus: CampusDoc, floors: { key: LayoutSpec }, rosters: { key: Roster } }   // 8 believable semiconductor floors, fake names
CAMPUS.exterior(campusDoc) -> CampusModel
CAMPUS.key(b, f) -> "B1-3";  CAMPUS.parseKey("B1-3") -> { b: "B1", f: 3 } | null
CAMPUS.defaultArr(team) -> ARR;  CAMPUS.teamColor(team, i) -> "#hex" (stable, distinct, readable on light and dark)
CAMPUS.sampleSeat(spec, roster) -> Roster   // sample mode only: seat the sample people at a hand-drawn floor's own assigned desks (not hot desks), team by team, ~1 in 8 left open
CAMPUS.ARR_NAMES = { bench: "Open benches", cubes: "Cubicles", offices: "Private offices", lab: "Lab benches", hot: "Hot desks" }
CAMPUS.ROOM_TYPES = [...]   // with display names
```
CampusDoc (db `campus/main`):
```js
{ v: 1, name: "San Jose campus", demo: true,       // demo=false once real people are imported
  buildings: [{ id: "B1", name: "Building 1", short: "B1", floors: 4, x: -46, z: 0, w: 72, d: 44 },
              { id: "B2", name: "Building 2", short: "B2", floors: 4, x: 46, z: 0, w: 64, d: 48 }],
  teams: { ... } }
```
Building x,z = footprint center in campus meters; floors share the building's w,d (the floor plate is the footprint, unrotated).
CampusModel (outdoor world, same frame rules, origin = campus center):
```js
{ key: "campus", w, d,
  buildings: [{ id, name, short, x, z, w, d, floors, h, door: { x, z, a, r: 1.2 } }],  // door pad OUTSIDE the floor-1 doorway; a faces away from the building
  areas: [{ kind: "road"|"parking"|"grass"|"plaza"|"walk", x, z, w, d }],
  lines: [{ x1, z1, x2, z2, c }],                    // parking stripes / road markings
  items: [{ t: "tree"|"lamp"|"car"|"bench"|"bollard"|"planter"|"bikerack"|"flag"|"sign", x, z, a, w?, d?, h?, c?, text? }],
  blocks, posts, ramps, signs, spawn: { x, z, a },
  dests: [{ id: "bldg:B1", kind: "amenity", name: "Building 1 entrance", sub, x, z, a }] }
```
Building footprints are blocks (m=7, tall=1) except their doorway. The building door pad (campus) and the floor-1 `exit` pad (floor frame)
are the same physical doorway: campus x = building.x + floorExit.x, campus z = building.z + floorExit.z (+/- the 2.4 m between the pads).

## 6. NAV  (`NAV`)
```js
NAV.grid(model, { cell: 0.4, clear: 0.32 }) -> Grid   // blocks/posts with (m & 5) rasterized + inflated by `clear`; outside plate = blocked
NAV.findPath(grid, ax, az, bx, bz) -> { pts: [[x,z],...], len } | null   // A* 8-conn, no corner cutting, string-pulled; snaps blocked endpoints to nearest free cell within 4 m
NAV.plan(world, from, to) -> Route | null
   world = { campus: CampusModel, floors: { key: FloorModel }, grid(key) -> Grid (memoized by caller or NAV) }
   from/to = { w: "B1-3"|"campus", x, z }
   Route = { legs: [{ w, pts, len, end: { kind: "dest"|"elev"|"exit"|"enter", to?: key, elev?: id, label } }], len }
   same world: 1 leg. Floor->floor same building: walk to the elevator whose total route is shortest, ride, continue from the SAME elevator id's pad.
   Other building: (elevator to floor 1) -> exit pad -> campus from door A to door B -> floor 1 from its exit pad -> (elevator) -> dest.
   label examples: "Take the elevator to Floor 3", "Head outside", "Go into Building 2", "Arrive at Silicon".
NAV.track(leg, x, z, hint) -> { i, along, remain, off, ahead: [x,z] }   // projection on the polyline; hint = previous i (search near it)
NAV.gates(pts, spacing = 10) -> [{ x, z, a }]                            // race checkpoints along a path (a = travel yaw); last gate = finish
NAV.sample(pts, spacing = 1.2, offset = 0) -> [{ x, z, a }]              // evenly spaced arrows along a path (for chevrons)
```

## 7. IMPORT  (`IMPORT`)
```js
IMPORT.parseCSV(text) -> { header: [...], rows: [[...]], delimiter }     // BOM, quotes, "" escapes, CRLF, , ; or \t
IMPORT.mapColumns(header) -> { map: { building, floor, desk, name, first, last, team, title, x, y, rot }, ignored: [colNames] }  // indices or -1
IMPORT.normalize(parsed, map, campusDoc, buildingAlias?) -> { floors: { key: [{ desk, name, team, title, x?, y?, rot? }] }, problems: [{ row, msg }], buildings: { rawValue: buildingId|null } }
IMPORT.diff(oldRosters, newRosters) -> { added: [...], removed: [...], moved: [{ name, from, to }], same: n }   // keyed by name (case/space-insensitive)
IMPORT.parseDXF(text) -> { units, scale, layers: { name: count }, segments: [{ layer, x1, y1, x2, y2 }], texts: [{ layer, x, y, text, h }], inserts: [{ layer, block, x, y, rot }], bounds }
IMPORT.similarity(p1, p2, q1, q2) -> { s, r, tx, ty, apply([x,y]) -> [x,y] }   // maps p1->q1, p2->q2 (scale+rotation+translation)
IMPORT.template() -> CSV string;  IMPORT.toCSV(rows) -> CSV string;  IMPORT.renderPDF(file, pdfjsLib) -> Promise<Blob(image/png)>
```

## 8. EDITOR  (`EDITOR`)  — owner/editor-only floor editor overlay
```js
EDITOR.open({
  key, title,                 // "Building 1 · Floor 3"
  spec,                       // LayoutSpec (editor deep-clones it)
  planUrl,                    // display URL for spec.plan.asset, or null
  teams, roster,              // teams map; this floor's people (rows may carry x,y from facilities data)
  build,                      // (spec) -> FloorModel  — live preview of auto-filled desks (LAYOUT.build bound to roster/teams)
  upload,                     // (File|Blob) -> Promise<{ asset, url }>, or null if this viewer can't upload images
  renderPDF, parseDXF, similarity,   // IMPORT helpers
  onSave,                     // (spec) -> Promise   (resolve => editor closes; reject(Error) => show message, stay open)
  onClose                     // () -> void
}) -> { close() }
```

## 8b. BRAWL  (`BRAWL`)  — Banana Brawl rules (pure); the game side is `js/game-3b-brawl.js`, item art `js/game-3a-brawl-art.js`
No host: each player is the authority on themselves. Presence field `bw` (null when not brawling):
`{ hp, sc (hits), ko (KOs), it (item | null), n (uses), sh (bubble 0/1), out (knocked out 0/1), iv (can't be hit right now 0/1),
tk (heartbeat: whole seconds; presence only goes out when something changes, and peers drop a brawler after 3 s without a new one),
pj: [[id, kind, x, y, z, vx, vz]] (≤10 live throws), hb: [[throwerPeer, throwId, 0 hit | 1 KO | 2 blocked by a bubble]] (hits taken,
last ~4 s, ≤8) }`. A victim decides its own hits from the thrower's `pj`;
the thrower counts a point when its peer shows up in someone's `hb` (`credits`). Bots exist only while nobody else brawls on the floor.
```js
BRAWL.ITEMS / ITEM / PJ;  BRAWL.rollItem(u, behind) -> 'banana'|'bunch'|'paper'|'plane'|'coffee'|'bubble'
BRAWL.crateSpots(floorKey, [[x,z]], n, spacing) -> [[x,z]]           // the same on every client
BRAWL.launch(kind, car, id, back) -> throw;  BRAWL.step(throw, dt, {blocked, ground, target}) -> alive (a banana lands as a peel)
BRAWL.touches(throw, {x,y,z,r,tall});  BRAWL.armed(throw, own)
BRAWL.fresh(now) / hit(state, now) -> {state, took, ko, blocked} / respawn(state, now)
BRAWL.enc(...) -> bw;  BRAWL.validBw(untrusted) -> bw | null;  BRAWL.credits(myPeer, [[peer, bw]], countedSet, mineIds) -> [{victim, id, ko, blocked}];  BRAWL.standings(rows)
```

## 9. PEOPLE  (`PEOPLE`)  — how coworkers look (pure)
Coworkers are creatures by default; the plain seated person is a pick. Everything is chosen from a hash of `"<floor key>|<desk id>"`
(never a name or title).
```js
PEOPLE.SPECIES -> [[id, name, weight, [[coatHex, coatName]]]]   // dragon (most common), dog, cat, fox, bear, panda, bunny, frog,
                                                                 // penguin, owl, robot, unicorn, dino, alien
PEOPLE.KINDS -> ['person', ...species ids];  PEOPLE.KIND_NAMES;  PEOPLE.coatsOf(kind) -> [[hex, name]]
PEOPLE.defaultLook(key, arr) -> { kind:<species>, coat:<one of its coats>, shirt:'team', tone, hat:'none'|'phones'|'beanie'|'cap',
                                  glasses, mug, labCoat, pants, shoes, hatColor, mugColor }   // person fields ready if they pick it; lab desks: no mug
PEOPLE.validLook(v) -> chosen fields only {kind, shirt:'team'|#hex, tone:#hex, hat, glasses, mug, labCoat, coat:#hex} | null
PEOPLE.merge(base, chosen);  PEOPLE.chosenOf(look);  PEOPLE.norm(name)
PEOPLE.validClaim(v) -> { w, desk, name, look, at } | null
PEOPLE.locate(claim, peopleOn(w) -> [{desk,name}], floorKeys) -> { key, moved } | null   // same desk+name, else the one person with that name
PEOPLE.resolve(claims, locateFn, nameMatch) -> { winners: Map key -> claim, status: Map uid -> { key, state:'ok'|'moved'|'lost'|'taken' } }
```
Claims: db doc `looks/<uid>` = `{ w, desk, name, look, at }`, one per viewer. Rules: `looks` read view / write admin (editors can
remove a claim), `looks/{self}` read view / write interact. Two claims on one person: the claimant whose own profile name matches the
seating name wins, then the earliest `at`. With sample people, or no db, your claim lives in localStorage `rc-mylook` (this browser only).

## 10. Loose props and live physics  (`PROPS` in `js/props.js`, pure; `PHYS` in `js/game-2f-physics.js`, game)
`PROPS` follows the module rules above (no THREE, no DOM, seeded randomness) and is tested by `tests/props.test.js`.
```js
PROPS.KINDS -> { box, boxS, ream, bin, bottle, cone }   // each { h, m (kg), and w,d (box-like) or r (round) }, meters
PROPS.plan(model, key, free) -> [{ kind, x, y, z, a, g }]   // 20 to 40 props, the same for the same floor key and model
   free(x, z, r) -> bool: true when a circle of radius r touches no wall, post or furniture (the game asks its collider grid and spotFree)
   y = height of the prop's center (stacked props rest on the ones below), a = yaw (three's rotation.y), g = stack/cluster number
   Paper reams and a bin by each printer, water bottles by the fridge, a bin by the kitchen counter, cones outside restrooms and
   the kitchen, box stacks along `ext`/`int` walls. Kept clear of the spawn point, elevator and exit pads, the coffee pickup,
   ramps, route end points (`dests`) and chairs.
PROPS.ticks(clock = { acc }, dt, step, max) -> steps to run now   // fixed-step accumulator; time beyond `max` steps is dropped
PROPS.span(gridCollider, wallH) -> { y0, y1 } | null              // height of a game grid collider in the physics world
```
`PHYS` is part of the game scope (it uses `mat`/`IG`/`crMerge`, the collider grid, `chairs`, `me`, `bot`, `remotes`):
```js
PHYS.floor()            // called at the end of loadColliders: a world was (re)entered, its props start over
PHYS.clear()            // called by clearRoot: forget the instanced meshes (clearRoot disposed them)
PHYS.build()            // called at the end of buildWorld: plan (if the floor is new), build one instanced mesh per prop kind
PHYS.frame(dt)          // called once per frame() after remoteFrame: fixed 60 Hz steps, at most 3 per frame
PHYS.burst(x, y, z, kind = "card" | "paper" | "confetti") -> 6 | 0   // six pieces fly up, tumble and are gone after 3 s; 0 (and nothing
                                                                     // happens) while the engine isn't running. At most 48 pieces live.
PHYS.blast(x, z, r, v = 3) -> n      // push every prop within r meters outward at up to v m/s; 0 without the engine
PHYS.track(car) / PHYS.untrack(car)  // extra car-like objects { x, y, z, h, kind } that should shove props (bots of a new mode)
PHYS.ready, PHYS.state ("idle" | "wait" | "loading" | "ready" | "failed"), PHYS.error, PHYS.props, PHYS.stats, PHYS.idle
```
* The engine is `@dimforge/rapier3d-compat` at an exact version (`PHYS.VER`), fetched with a dynamic `import()` from jsDelivr 350 ms after
  the first frame. If the import or the WebAssembly start-up fails (offline, a blocked CDN, a content security policy without
  WebAssembly), `PHYS.state` becomes `"failed"`, one `console.info` line says so, and the props are not shown (nothing would stop a
  car driving through them), so the floors look and play exactly as before. They appear once the engine is running. `#nophys` in the page address turns the engine off on purpose.
* One physics world per entered floor (and one, without props, for the outside): the floor, every collider of the game's grid that
  blocks cars (mask 1) or is a surface (mask 8) as a fixed box or cylinder (desk legs under 6 cm are left out), ramps as a small
  triangle mesh from `groundY`, props as dynamic bodies, chairs and every car (me, the Mailbot, coworkers on this floor,
  `PHYS.track`ed ones) as kinematic bodies that follow the game's own positions. **Props never push back**: `carStep`, the chairs'
  physics and the collider grid are untouched, so races and routes behave the same with or without the engine.
* Props are local to each browser: coworkers do not see your knocked-over boxes. A style change keeps them where they lie;
  entering the floor again (or any other) puts them back.
* Cost: nothing is stepped while every prop rests and no car or rolling chair is within 1.8 m of one. Only bodies that moved
  get their instance matrix rewritten.

## 11. Baked light, Blender materials, pre-recorded moments  (`BAKE`, `PBR_DATA`, `FX`; Studio only for the bake)
* `BAKE.world(key, model, kind)` runs at the end of `buildWorld` (before `PHYS.build`). It hashes the world's static geometry
  (the batches HD registers with `BAKE.reg` plus the flat ground pieces) and uses `BAKES[key]` only when the hash matches;
  otherwise realtime Studio. `BAKES[key].f`/`.a` name the world's floor and atlas images in `BAKE_DIR` (`src/assets/bake/`, beside the
  page, named after a hash of their bytes); a world's pair is fetched when the world is entered (a CORS `<img>` is tried when
  `fetch` is refused) and, once a world is lit, the others' bytes in the background. A failed download leaves the world
  realtime until its next visit; an image that can't be decoded keeps it realtime. `BAKE.ready()` resolves once this world's
  bake is applied (or won't be): `goWorld` waits for it behind the fade, up to 0.9 s. `build.py --inline-bakes` puts the images
  in the page as data URLs (the bake tools build that way).
  Anything that moves must not enter that hash: mark its meshes `userData.dyn = true`
  (the physics props and debris and the brawl items do; the figures and chairs are skipped by the capture itself). Full details and re-baking: `src/tools/bake/README.md`.
* On a baked world the sun, fill light and shadow map are off and GTAO is skipped; a hemisphere light measured from the
  bake lights cars, creatures, chairs and the physics props.
* Elsewhere (realtime Studio and the other styles) `HD.render` draws the sun's shadow map at most once a frame and only when a
  caster inside the sun's shadow box changed its world matrix, instance matrices or visibility, entered or left the box, or the
  sun's view changed (`shadowSig`); a still scene keeps the last map (and a restored WebGL context redraws it). Code that renders
  outside `HD.render` and needs fresh shadows sets `renderer.shadowMap.needsUpdate = true`. Studio's Low and Lowest use a
  smaller map on desktop; on touch devices only Lowest does (`HD.shadowSize()`).
* `placeKit` draws a model's plain opaque parts (standard material without textures or glow) as ONE merged mesh whose vertices
  carry color, roughness and metalness (`rm`), and its LEDs as one more; screens, glass and tinted parts stay separate.
  The merged geometry keeps each part's index range and color in `userData.parts`, so `BAKE.capture` colors the light
  blockers per part as before.
* `PBR_DATA` (`js/pbr-data.js`, from `src/blender/pbr_textures.py` + `src/tools/pack_pbr.py`): tiling albedo, normal and
  roughness sets for concrete, terrazzo, tile, carpet, birch, oak and metal; HD falls back to its canvas finishes without them.
* `FX.crash(x, z, speed, car, isMe)` (from `carStep` on a hit over 2.2 m/s): desk scatter or a coffee splash, replayed from
  Blender tracks with instanced groups; `FX.frame(dt)` from `HD.render`, `FX.clear()` on a new world.

## UI tokens (for EDITOR, which draws its own DOM)
CSS variables on :root that follow the current theme: `--ground --ink --muted --glass --glass2 --line --accent --on-accent --chip --btn`,
fonts `--display` (Archivo) and `--mono` (IBM Plex Mono). Buttons in the page use classes `.tb` (tool button) and `.primary`.
Minimum hit target 32 px, visible focus ring `outline:2px solid var(--accent)`, everything keyboard reachable, works at 375 px wide.
