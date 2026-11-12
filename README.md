# RC Office Campus

Drive a tiny remote-control car (or run around as a dog or a cat) on a two-building, eight-floor office campus in San Jose. Look up a coworker or a conference room and follow the arrows there, or race the route against the clock.

**Play it:** https://unique-name27.github.io/rc-office-campus/

> The public page uses **made-up sample people**. The team version, with real seating, live coworker cars and shared leaderboards, runs as a private claude.ai page. Never commit real names, desk assignments or floor plans to this repository.

## What's in it

- **Straight into the driver's seat.** The page opens with you driving on the floor you last visited (Building 1's lobby the first time), with the options card beside you: jump to any floor or outside, pick car, dog or cat, paint and style. Esc hides or shows it. On a phone it's a sheet you close with **Drive**.
- **Campus overview.** Two buildings, four floors each (O). Click a building to open a floor, or drive in through a front door.
- **Floors arranged by team.** Each team sits the way it really works: open benches, cubicles, private offices (finance, legal), lab benches with racks, scopes and test chambers (validation, characterization, failure analysis), or hot desks.
- **Routes.** Search anyone or any room. Chevrons on the floor lead you there, including elevator rides and walking between buildings.
- **Races.** "Race there" sets up gates from a standard start to any desk or room. There's also a coffee run on every floor: kitchen, then five desks.
- **Five graphic styles.** Studio (realistic materials in soft daylight, with ambient occlusion, a little glow, Kenney furniture and lab gear made in Blender), Neon night, Blueprint, Comic and Vector arcade. Keys 1–5 switch them; N toggles Neon night.
- **Quality levels for Studio.** Auto (the default) times the graphics card and steps between High, Balanced and Low to stay smooth, so laptops can run it too. You can also fix a level in the Style panel. Low and Lowest also use a smaller sun shadow map (on phones and tablets, only Lowest does). On a laptop with two graphics chips, the page asks the browser for the faster one.
- **Baked light and Blender materials in Studio.** On the sample floors and the campus, Studio uses light baked in Blender: light bouncing off the walls, soft shadows and ambient occlusion, and it is lighter on the graphics card: 1.4 to 2.6 times less time per frame than realtime light at High (measured before realtime frames stopped drawing the sun's shadows twice, so the gap is smaller now). Floors, carpet, desks and metal use textures made in Blender. A floor whose layout you change switches back to realtime light by itself. The light images (about 90 to 150 KB a floor) are not part of the page: the floor you start on loads its own, the rest download in the background afterwards, and changing floors waits behind the fade until the new floor's light is on. How to re-bake: `src/tools/bake/README.md`.
- **Fewer draws.** Each model's plain parts are drawn as one piece with the same look, so a lab floor full of Blender-made instruments takes about a third fewer draw calls. On floors without baked light, the sun's shadows are drawn at most once a frame (the ambient-occlusion pass used to draw them a second time), and not at all while nothing near you moves.
- **Play as a car, a dog or a cat.** All three are modeled in Blender from code (`src/blender/avatars.py`). Everyone can jump, and P switches between them. Each has a special skill:
  - **Car: charged drift.** Hold Space through a turn: blue sparks mean a turbo is ready (let go for a burst); keep holding and at orange the big turbo fires by itself. Shift boosts.
  - **Dog: big woof.** H barks and pushes nearby chairs (with whoever sits on them) and the Mailbot out of the way.
  - **Cat: double jump.** Press jump again in the air, or just keep holding it, for a flip and a second jump. Cats land softly and can reach desks, counters and cabinets.
  Dog and cat times have their own leaderboards.
- **Coworkers at their desks are creatures.** Dragons, dogs, cats, foxes, bears, pandas, bunnies, frogs, penguins, owls, robots, unicorns, dinos and aliens, each typing away in a scarf of its team's color. Who gets what is picked per desk, never from a name. Heads turn as you drive past, and a pushed chair rolls away with whoever sits on it. They type in bursts, breathe, stretch now and then and look around.
- **Coworkers get up and walk around.** Now and then a creature leaves its desk, walks to the kitchen, a meeting room, the printer or a teammate's desk, waits there a moment and walks back to its chair. Everyone on the floor sees the same walks at the same time, with nothing sent between players: they follow the clock. Walkers step aside for cars, hop when you bump into them or a dog woofs, and nudge loose boxes out of their way.
- **My look.** Open your own desk and choose **This is me** to pick your creature and its coat, or the plain seated person (shirt, face and hands color, headwear, extras). With sample people (like on this page) your look is saved in your browser only.
- **Banana Brawl (B).** A kart battle on the floor you're on. Drive through supply crates for an item: a banana (throw it, or drop the peel behind you), a bunch of three, a paper ball that bounces off walls, a paper plane that homes in, coffee (a big boost) or a bubble that blocks one hit. Three hearts; a hit spins you out, and losing your last heart is a KO for whoever threw it. Everyone brawling on the same floor plays together; when nobody else is, three bots (Stapler, Shredder and Laminator) join you.
- **Real sounds.** The car's engine is a real Ford Escort (CC0) that revs through six gears as you speed up, with tyre screech, wall grind and crashes from "FREE CAR SFX" by LMGLolo (CC BY-ND 4.0); the horn, the dog's barks and the cat's meows are CC0 recordings (credits in `src/assets/sounds/CREDITS.md`).
- **Driving.** Drift (Space), boost (Shift), ramps, pushable chairs, a Mailbot, and chase, bumper, high and top-down cameras.
- **Loose props you can crash into.** Every floor has 20 to 40 of them: stacks of cardboard boxes along the walls, recycling bins, wet-floor cones, spare water-cooler bottles by the fridge and paper reams by the printers. Drive into them and they tumble, roll and land with a thud (real rigid-body physics from [Rapier](https://rapier.rs/), loaded after the page is up). The dog's big woof blows them over too, and brawl crates burst into cardboard when you grab them. They are back in place when you come back to the floor. Where the physics engine can't load, the floors stay as they were, without the props. Hit a desk hard and its papers, mug and pens fly off; crash into the kitchen counter or the coffee machine and coffee splashes back (both moments are simulated in Blender and replayed).
- **Setup.** Load seating from a facilities CSV, then edit each floor: load a PNG, JPG or PDF plan and set its scale, trace rooms, import CAD walls (DXF), draw team areas, or place desks from facilities X/Y coordinates.

On this public page, setup changes and imported files stay in your browser tab and are gone on reload. Nothing is uploaded.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Drive | W A S D / arrows | stick + Go / Brake |
| Jump | J (Space for a dog or cat) | Jump |
| Drift · Boost · Horn | Space · Shift · H (car); Shift sprint · H woof/meow (dog, cat) | buttons |
| Skills | hold Space through a turn (car turbo) · H (dog woof) · jump again or hold jump (cat double jump) | hold Drift · Woof · hold Jump ×2 |
| Join a coworker's race | Y | Join race |
| Camera | V | — |
| Find a person or room | / | Find |
| Overview / campus | O | Overview |
| Show / hide the options card | Esc | Options |
| Start / leave Banana Brawl | B | Banana Brawl (options card) |
| Use your item (hold S to drop a banana behind) | F | Item |
| Drop a banana behind you | G | Item while braking |
| Walk ↔ drive | C | Walk |
| Elevator floor | 1–4 on the elevator pad | tap a floor |
| Coffee run | Enter | Coffee run |
| Clear route | X | × on the route bar |
| Switch car / dog / cat | P | Car button |
| My look | L | My look |

## Loading real seating (team version)

1. Export your seating list as CSV: one row per person with name, team, building, floor and desk. Common HR and facilities export headers are recognized. Only name, team, title and desk are kept; every other column is ignored.
2. In **Set up**, drop the file in. You'll see who's new, who moved and who left before anything is saved.
3. Floors you haven't drawn get laid out automatically, with each team's area sized to its headcount.
4. To match the real building, open a floor and load its plan. Set the scale with two points of known distance, then trace rooms and team areas. If your export has desk coordinates, use **Place desks from your facilities file**.

## Build and test

The page is one HTML file built from `src/`. It loads each floor's baked-light images from `src/assets/bake/` beside it, so serve or publish that folder with it (`--inline-bakes` puts them inside the page instead):

```bash
python -I src/build.py index.html --standalone
```

Module tests (Node 18+, no dependencies):

```bash
node src/tests/layout.test.js
node src/tests/nav.test.js
node src/tests/importers.test.js
node src/tests/campus.test.js
node src/tests/editor.test.js
node src/tests/people.test.js
node src/tests/skills.test.js
node src/tests/brawl.test.js
node src/tests/props.test.js
```

`src/SPEC.md` describes the data formats: the floor layout spec, the floor model, the routing API, and how importing works.

Built with [three.js](https://threejs.org/) r165 and the [Rapier](https://rapier.rs/) physics engine (`@dimforge/rapier3d-compat` 0.21.0, Apache-2.0, fetched from jsDelivr when the page is running). Furniture from Kenney's [Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0). Printers, storage cupboards, lockers, whiteboards, desk items (mugs, cups, headphones, books, cacti) and the campus trees, lamps, benches, planters, bike racks, bollards and flag poles are models by [Polyfork](https://polyfork.dev), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), found on [patch.gg](https://patch.gg/create/toolbox/assets); each one is credited in [`src/assets/patch/CREDITS.md`](src/assets/patch/CREDITS.md) and in the page's source. The car, dog, cat and lab props are built in Blender by scripts in `src/blender/`; `src/tools/pack_kit.py` packs the models into the page.
