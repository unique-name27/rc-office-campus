# Baked light for Studio

Studio worlds (the 8 sample floors and the campus) can carry light baked in Blender: bounced light, soft shadows
and ambient occlusion in two images per world, in `src/assets/bake/` (named in `src/js/bake-data.js`).
`src/js/game-2e-bake.js` loads a world's images when the world is entered (and the others in the background) and applies
them, so publish `src/assets/bake/`
with the page (`src/build.py --inline-bakes` puts them inside the page instead; the bake tools below build that way).

- **What gets lightmaps.** The game still builds every world itself. The static boxes that Studio draws in instanced
  batches (walls, cores, desk tops and frames, partitions, big furniture) get a lightmap rectangle per face through
  instance attributes. The ground pieces read a top-down lightmap.
- **When a bake is used.** Only when a hash of the world's static geometry equals the hash it was baked for. Any change
  falls back to today's realtime Studio by itself: an editor edit, an import that changes a floor, or a code change to
  what Studio draws.
- **What changes on a baked world.**
  - The sun, the fill light and the shadow map are switched off.
  - GTAO is skipped, because the AO is in the lightmap. Bloom and MSAA still follow the quality level.
  - A hemisphere light measured from the bake lights the things that move: cars, creatures and chairs.
  - Chairs get soft contact blobs. Cars and pets already have theirs.
  - Outdoors, the realtime sun stays on for everything except the ground, but without its shadow map.

## Re-baking (after changing a sample floor or what Studio draws)

The user's PC crashes under heavy CPU load, so these rules apply:
- run one Blender process at a time, with `-t 4`
- use Cycles on the GPU only (OptiX; the script refuses the CPU)
- `run_bakes.mjs` takes the shared `.blender.lock` in the repo root and bakes the worlds one after another

Run these from the repo root:
```bash
node src/tools/bake/capture.mjs <dir>
node src/tools/bake/run_bakes.mjs <dir> --samples 160
python -I src/tools/bake/pack_bakes.py <dir>
node src/tools/bake/bench.mjs <dir> shots
node src/tools/bake/bench.mjs <dir> perf 1920x1080
```
What each command does:
- `capture.mjs` captures every world from a `--test` build in a hidden Edge window. Add keys after `<dir>` to capture
  only some worlds.
- `run_bakes.mjs` bakes them in Blender: about 20 s per B1 floor, 65 s per B2 floor and 20 s for the campus on an
  RTX 4080.
- `pack_bakes.py` writes the AVIF images to `src/assets/bake/` (B2's 2048 atlases scaled to 1536), named after a hash of
  their bytes, and their table to `src/js/bake-data.js`. Commit both, and republish the folder with the page.
- The two `bench.mjs` runs take before/after screenshots and frame times. Before means the bake is switched off.

Test bakes: `--samples 32` takes a few seconds per world. Fewer than about 120 samples leaves visible blotches, and
noisy lightmaps also compress much worse.

## Files

| file | what |
|---|---|
| `capture.mjs` | builds a `--test` page, enters each world in Studio and saves `BAKE.capture()`: the lightmapped faces with their atlas coordinates (packed by the game's own code), the ground pieces, the light blockers (minus things that move) and the hash |
| `bake_world.py` | Blender: rebuilds the captured triangles and lights them, then bakes Cycles' DIFFUSE light (direct + indirect) into the atlas and the floor map. It then removes speckles, applies an edge-aware denoise and encodes light/K as dithered 8-bit sRGB. Indoors: a morning sun on the game's bearing at 28°, a sky, 0.6 × 1.2 m ceiling panels on a 2.4 m grid and a bake-only ceiling. Outdoors: Studio's own sun and a sky. |
| `run_bakes.mjs` | runs `bake_world.py` world by world, behind the lock |
| `pack_bakes.py` | PNG → AVIF files in `src/assets/bake/` + the table in `src/js/bake-data.js` |
| `bench.mjs` | screenshots and GPU frame times, baked vs realtime |
