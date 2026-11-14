# RC Office Campus

Drive a tiny remote-control car (or run around as a dog or a cat) on a two-building, eight-floor office campus in San Jose. Look up a coworker or a conference room and follow the arrows there, or race the route against the clock.

**Play it:** https://unique-name27.github.io/rc-office-campus/

> The public page uses **made-up sample people**. The team version, with real seating, live coworker cars and shared leaderboards, runs as a private claude.ai page. Never commit real names, desk assignments or floor plans to this repository.

## What's in it

- **Straight into the driver's seat.** The page opens with you driving on the floor you last visited (Building 1's lobby the first time), with a small card beside you: pick the car, the dog or the cat (and its color), then type where you want to go: a coworker, a team, a room, a floor or "outside". Pick one and you're taken there (a floor through the fade, a person or room by a route to follow). **Surprise me** picks somewhere for you, usually a coworker's desk. Esc hides or shows the card; on a phone, **Keep driving** closes it.
- **Campus overview.** Two buildings, four floors each (O). Click a building to open a floor, or drive in through a front door.
- **Floors arranged by team.** Each team sits the way it really works: open benches, cubicles, private offices (finance, legal), lab benches with racks, scopes and test chambers (validation, characterization, failure analysis), or hot desks.
- **Routes.** Search anyone or any room. Chevrons on the floor lead you there, including elevator rides and walking between buildings.
- **Races.** "Race there" sets up gates from a standard start to any desk or room. There's also a coffee run on every floor: kitchen, then five desks.
- **One look, built for speed.** Realistic materials in soft daylight (Kenney furniture and lab gear made in Blender), drawn without post-processing so it stays smooth on laptops and phones. A device that still can't keep up drops to a lower resolution by itself. On a laptop with two graphics chips, the page asks the browser for the faster one.
- **Baked light and Blender materials in Studio.** On the sample floors and the campus, Studio uses light baked in Blender: light bouncing off the walls, soft shadows and ambient occlusion, and it is lighter on the graphics card: less time per frame than realtime light. Floors, carpet, desks and metal use textures made in Blender. A floor whose layout you change switches back to realtime light by itself. The light images (about 90 to 150 KB a floor) are not part of the page: the floor you start on loads its own, the rest download in the background afterwards, and changing floors waits behind the fade until the new floor's light is on. How to re-bake: `src/tools/bake/README.md`.
- **Fewer draws.** Each model's plain parts are drawn as one piece with the same look, so a lab floor full of Blender-made instruments takes about a third fewer draw calls. On floors without baked light, the sun's shadows are drawn at most once a frame (the ambient-occlusion pass used to draw them a second time), and not at all while nothing near you moves.
- **Play as a car, a dog or a cat.** All three are modeled in Blender from code (`src/blender/avatars.py`). Everyone can jump, and P switches between them. Each has a special skill:
  - **Car: charged drift.** Hold Space through a turn: blue sparks mean a turbo is ready (let go for a burst); keep holding and at orange the big turbo fires by itself. Shift boosts.
  - **Dog: big woof.** H barks and pushes nearby chairs (with whoever sits on them) and the Mailbot out of the way.
  - **Cat: double jump.** Press jump again in the air, or just keep holding it, for a flip and a second jump. Cats land softly and can reach desks, counters and cabinets.
  Dog and cat times have their own leaderboards.
- **Coworkers at their desks are creatures.** Dragons, dogs, cats, foxes, bears, pandas, bunnies, frogs, penguins, owls, robots, unicorns, dinos and aliens, each typing away in a scarf of its team's color. Who gets what is picked per desk, never from a name. Heads turn as you drive past, and a pushed chair rolls away with whoever sits on it. They type in bursts, breathe, stretch now and then and look around.
- **Coworkers get up and walk around.** Now and then a creature leaves its desk, walks to the kitchen, a meeting room, the printer or a teammate's desk, waits there a moment and walks back to its chair. Everyone on the floor sees the same walks at the same time, with nothing sent between players: they follow the clock. Walkers step aside for cars, hop when you bump into them or a dog woofs, and nudge loose boxes out of their way.
- **My look.** Open your own desk and choose **This is me** to pick your creature and its coat, or the plain seated person (shirt, face and hands color, headwear, extras). With sample people (like on this page) your look is saved in your browser only.
- **Coins and power-ups.** Every floor and the campus have gold coins in short trails; some trails arc up, so jump for those. Drive (or walk) through them to collect; your total sits next to the floor name and stays in your browser. Floating supply boxes give a power-up for a few seconds: **Coffee rush** (full speed, flames and all), **Moon jump** (huge floaty jumps), **Coin magnet** (coins fly to you) or **Double coins**. Power-ups stay out of races and coffee runs, so times stay fair. Picked-up coins come back after a while; everyone sees the coins in the same places, but what you've collected is yours.
- **Real sounds.** The car's engine is a real Ford Escort (CC0) that revs through six gears as you speed up, with tyre screech, wall grind and crashes from "FREE CAR SFX" by LMGLolo (CC BY-ND 4.0); the horn, the dog's barks and the cat's meows are CC0 recordings (credits in `src/assets/sounds/CREDITS.md`).
- **Driving.** Drift (Space), boost (Shift), ramps, pushable chairs, a Mailbot, and chase, bumper, high and top-down cameras.
- **Loose props you can crash into.** Every floor has 20 to 40 of them: stacks of cardboard boxes along the walls, recycling bins, wet-floor cones, spare water-cooler bottles by the fridge and paper reams by the printers. Drive into them and they tumble, roll and land with a thud (real rigid-body physics from [Rapier](https://rapier.rs/), loaded after the page is up). The dog's big woof blows them over too, and power-up boxes burst into cardboard when you grab them. They are back in place when you come back to the floor. Where the physics engine can't load, the floors stay as they were, without the props. Hit a desk hard and its papers, mug and pens fly off; crash into the kitchen counter or the coffee machine and coffee splashes back (both moments are simulated in Blender and replayed).
- **Suggest a change.** The people who sit on a floor know it best. On a floor, **Suggest a change to this floor** opens the floor editor for anyone: move a room, redraw a team area, fix a desk, then **Send suggestion** with a short note. The page's admins see it in Set up (the Set up button shows how many are waiting): **Review** opens it in the editor, where Save applies it for everyone, or **Dismiss** drops it. On this public page it stays in your browser tab, so you can try both sides.
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
| Where to? | type in the card, Enter | type in the card |
| Walk ↔ drive | C | Walk |
| Elevator floor | 1–4 on the elevator pad | tap a floor |
| Coffee run | Enter | Coffee run |
| Clear route | X | × on the route bar |
| Switch car / dog / cat | P | Switch to … button |
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
node src/tests/fun.test.js
node src/tests/props.test.js
```

`src/SPEC.md` describes the data formats: the floor layout spec, the floor model, the routing API, and how importing works.

Built with [three.js](https://threejs.org/) r165 and the [Rapier](https://rapier.rs/) physics engine (`@dimforge/rapier3d-compat` 0.21.0, Apache-2.0, fetched from jsDelivr when the page is running). Furniture from Kenney's [Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0). Printers, storage cupboards, lockers, whiteboards, desk items (mugs, cups, headphones, books, cacti) and the campus trees, lamps, benches, planters, bike racks, bollards and flag poles are models by [Polyfork](https://polyfork.dev), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), found on [patch.gg](https://patch.gg/create/toolbox/assets); each one is credited in [`src/assets/patch/CREDITS.md`](src/assets/patch/CREDITS.md) and in the page's source. The car, dog, cat and lab props are built in Blender by scripts in `src/blender/`; `src/tools/pack_kit.py` packs the models into the page.
