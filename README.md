# RC Office Campus

Drive a tiny remote-control car (or run around as a dog or a cat) on a two-building, eight-floor office campus in San Jose. Look up a coworker or a conference room and follow the arrows there, or race the route against the clock.

**Play it:** https://unique-name27.github.io/rc-office-campus/

> The public page uses **made-up sample people**. The team version, with real seating, live coworker cars and shared leaderboards, runs as a private claude.ai page. Never commit real names, desk assignments or floor plans to this repository.

## What's in it

- **Campus overview.** Two buildings, four floors each. Click a building to open a floor, or drive in through a front door.
- **Floors arranged by team.** Each team sits the way it really works: open benches, cubicles, private offices (finance, legal), lab benches with racks, scopes and test chambers (validation, characterization, failure analysis), or hot desks.
- **Routes.** Search anyone or any room. Chevrons on the floor lead you there, including elevator rides and walking between buildings.
- **Races.** "Race there" sets up gates from a standard start to any desk or room. There's also a coffee run on every floor: kitchen, then five desks.
- **Five graphic styles.** Studio (realistic materials and soft light), Neon night, Blueprint, Comic and Vector arcade. Keys 1–5 switch them; N toggles Neon night.
- **Play as a car, a dog or a cat.** Everyone can jump. Cats jump high enough to land on desks, counters and parked cars.
- **Driving.** Drift (Space), boost (Shift), ramps, pushable chairs, a Mailbot, and chase, bumper, high and top-down cameras.
- **Setup.** Load seating from a facilities CSV, then edit each floor: load a PNG, JPG or PDF plan and set its scale, trace rooms, import CAD walls (DXF), draw team areas, or place desks from facilities X/Y coordinates.

On this public page, setup changes and imported files stay in your browser tab and are gone on reload. Nothing is uploaded.

## Controls

| | Keyboard | Touch |
|---|---|---|
| Drive | W A S D / arrows | stick + Go / Brake |
| Jump | J (Space for a dog or cat) | Jump |
| Drift · Boost · Horn | Space · Shift · H (car); Shift sprint · H bark/meow (dog, cat) | buttons |
| Join a coworker's race | Y | Join race |
| Camera | V | — |
| Find a person or room | / | Find |
| Overview / campus | O | Overview |
| Walk ↔ drive | C | Walk |
| Elevator floor | 1–4 on the elevator pad | tap a floor |
| Coffee run | Enter | Coffee run |
| Clear route | X | × on the route bar |

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
```

`src/SPEC.md` describes the data formats: the floor layout spec, the floor model, the routing API, and how importing works.

Built with [three.js](https://threejs.org/) r128.
