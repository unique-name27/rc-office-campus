# RC Campus v4 — module contracts

The page is ONE html file (a claude.ai artifact) built by concatenating modules into a single
`(function(){"use strict"; ... })();` script inside one `<script type="module">`, which imports three.js r165 (and its post-processing
add-ons) from jsDelivr through an import map; only the game/renderer uses `THREE`. Generated data modules: `js/avatar-meshes.js`
(`AVMESH`, from `src/blender/avatars.py`) and `js/kit-meshes.js` (`KITMESH`, from `src/tools/pack_kit.py`). Studio is the HD style
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
| `js/game.js` | — | main | everything above + THREE |

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

## 9. PEOPLE  (`PEOPLE`)  — how coworkers look (pure)
Everyone is the same seated figure. Neutral variety only, picked from a hash of `"<floor key>|<desk id>"` (never a name or title).
```js
PEOPLE.defaultLook(key, arr) -> { kind:'person', shirt:'team', tone, hat:'none'|'phones'|'beanie'|'cap', glasses, mug, labCoat, coat:null,
                                  pants, shoes, hatColor, mugColor }      // lab desks: lab coat, no mug
PEOPLE.validLook(v) -> chosen fields only {kind, shirt:'team'|#hex, tone:#hex, hat, glasses, mug, labCoat, coat:#hex} | null
PEOPLE.merge(base, chosen);  PEOPLE.chosenOf(look);  PEOPLE.norm(name)
PEOPLE.validClaim(v) -> { w, desk, name, look, at } | null
PEOPLE.locate(claim, peopleOn(w) -> [{desk,name}], floorKeys) -> { key, moved } | null   // same desk+name, else the one person with that name
PEOPLE.resolve(claims, locateFn, nameMatch) -> { winners: Map key -> claim, status: Map uid -> { key, state:'ok'|'moved'|'lost'|'taken' } }
```
Claims: db doc `looks/<uid>` = `{ w, desk, name, look, at }`, one per viewer. Rules: `looks` read view / write admin (editors can
remove a claim), `looks/{self}` read view / write interact. Two claims on one person: the claimant whose own profile name matches the
seating name wins, then the earliest `at`. With sample people, or no db, your claim lives in localStorage `rc-mylook` (this browser only).

## UI tokens (for EDITOR, which draws its own DOM)
CSS variables on :root that follow the current theme: `--ground --ink --muted --glass --glass2 --line --accent --on-accent --chip --btn`,
fonts `--display` (Archivo) and `--mono` (IBM Plex Mono). Buttons in the page use classes `.tb` (tool button) and `.primary`.
Minimum hit target 32 px, visible focus ring `outline:2px solid var(--accent)`, everything keyboard reachable, works at 375 px wide.
