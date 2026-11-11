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
- **Quality levels for Studio.** Auto (the default) times the graphics card and steps between High, Balanced and Low to stay smooth, so laptops can run it too. You can also fix a level in the Style panel.
- **Play as a car, a dog or a cat.** All three are modeled in Blender from code (`src/blender/avatars.py`). Everyone can jump, and P switches between them. Each has a special skill:
  - **Car: charged drift.** Hold Space through a turn: blue sparks mean a turbo is ready (let go for a burst); keep holding and at orange the big turbo fires by itself. Shift boosts.
  - **Dog: big woof.** H barks and pushes nearby chairs (with whoever sits on them) and the Mailbot out of the way.
  - **Cat: double jump.** Press jump again in the air, or just keep holding it, for a flip and a second jump. Cats land softly and can reach desks, counters and cabinets.
  Dog and cat times have their own leaderboards.
- **Coworkers at their desks are creatures.** Dragons, dogs, cats, foxes, bears, pandas, bunnies, frogs, penguins, owls, robots, unicorns, dinos and aliens, each typing away in a scarf of its team's color. Who gets what is picked per desk, never from a name. Heads turn as you drive past, and a pushed chair rolls away with whoever sits on it.
- **My look.** Open your own desk and choose **This is me** to pick your creature and its coat, or the plain seated person (shirt, face and hands color, headwear, extras). With sample people (like on this page) your look is saved in your browser only.
- **Real sounds.** The car's motor, horn, the dog's barks and the cat's meows are CC0 recordings (credits in `src/assets/sounds/CREDITS.md`); the motor's pitch follows your speed.
- **Driving.** Drift (Space), boost (Shift), ramps, pushable chairs, a Mailbot, and chase, bumper, high and top-down cameras.
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

The page is one HTML file built from `src/`:

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
```

`src/SPEC.md` describes the data formats: the floor layout spec, the floor model, the routing API, and how importing works.

Built with [three.js](https://threejs.org/) r165. Furniture from Kenney's [Furniture Kit](https://kenney.nl/assets/furniture-kit) (CC0). Printers, storage cupboards, lockers, whiteboards, desk items (mugs, cups, headphones, books, cacti) and the campus trees, lamps, benches, planters, bike racks, bollards and flag poles are models by [Polyfork](https://polyfork.dev), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), found on [patch.gg](https://patch.gg/create/toolbox/assets); each one is credited in [`src/assets/patch/CREDITS.md`](src/assets/patch/CREDITS.md) and in the page's source. The car, dog, cat and lab props are built in Blender by scripts in `src/blender/`; `src/tools/pack_kit.py` packs the models into the page.
