// Coins and power-up boxes (js/fun.js): where they go on each sample floor, that everyone gets the same layout, and the
// power-up table. usage: node src/tests/fun.test.js
const assert = require('assert'), load = require('./load');
const LAYOUT = load('layout.js', 'LAYOUT'), CAMPUS = load('campus.js', 'CAMPUS', { LAYOUT }), FUN = load('fun.js', 'FUN');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message) } }

const D = CAMPUS.demo(LAYOUT), KEYS = Object.keys(D.floors), MODELS = {};
for (const k of KEYS) MODELS[k] = LAYOUT.build(D.floors[k], D.rosters[k] || [], D.campus.teams);
// the game's question: is this spot open floor? (no wall, post, desk or table within .3 m, like walkBlocked)
const colliders = m => [...(m.blocks || []), ...(m.posts || [])].filter(c => c.m & 5);
const touches = (c, x, z, r) => { if (c.r != null) return Math.hypot(x - c.x, z - c.z) < r + c.r; const cx = Math.max(c.x0, Math.min(c.x1, x)), cz = Math.max(c.z0, Math.min(c.z1, z)); return Math.hypot(x - cx, z - cz) < r };
const freeOf = m => { const cols = colliders(m); return (x, z) => !cols.some(c => touches(c, x, z, .3)) };
const avoidOf = m => { const a = []; if (m.spawn) a.push([m.spawn.x, m.spawn.z, 2]); for (const e of m.elevators || []) if (e.pad) a.push([e.pad.x, e.pad.z, (e.pad.r || 1) + .8]); if (m.exit) a.push([m.exit.x, m.exit.z, (m.exit.r || 1.2) + 1]); return a };
const PLACED = {};
for (const k of KEYS) { const m = MODELS[k]; PLACED[k] = FUN.place(k, m.w, m.d, freeOf(m), { avoid: avoidOf(m) }) }

test('module shape', () => {
  for (const f of ['place', 'roll', 'hash', 'rng']) assert.strictEqual(typeof FUN[f], 'function', f);
  assert.deepStrictEqual(FUN.IDS.slice().sort(), ['coffee', 'double', 'magnet', 'moon']);
  for (const id of FUN.IDS) { const p = FUN.POWERS[id]; assert.ok(p.n && p.d && p.dur > 0 && p.dur <= 20, id) }
});

test('every sample floor gets coin trails and boxes', () => {
  for (const k of KEYS) {
    const { coins, boxes } = PLACED[k];
    assert.ok(coins.length >= 20, `${k}: ${coins.length} coins`);
    assert.ok(boxes.length >= 3, `${k}: ${boxes.length} boxes`);
    assert.ok(coins.some(c => c.y > .7), `${k}: some coins need a jump`);
    assert.ok(coins.some(c => c.y < .4), `${k}: most coins sit low`);
  }
});

test('coins and boxes sit on open floor, inside the plate, away from pads and the spawn', () => {
  for (const k of KEYS) {
    const m = MODELS[k], free = freeOf(m), avoid = avoidOf(m), { coins, boxes } = PLACED[k];
    for (const c of [...coins, ...boxes]) {
      assert.ok(Math.abs(c.x) < m.w / 2 - 1 && Math.abs(c.z) < m.d / 2 - 1, `${k}: (${c.x}, ${c.z}) inside`);
      assert.ok(free(c.x, c.z), `${k}: (${c.x}, ${c.z}) on open floor`);
      for (const [x, z, r] of avoid) assert.ok(Math.hypot(c.x - x, c.z - z) >= r - .01, `${k}: (${c.x}, ${c.z}) clear of a pad`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(Math.hypot(boxes[i].x - boxes[j].x, boxes[i].z - boxes[j].z) >= 5, `${k}: boxes spread out`);
    for (let i = 0; i < coins.length; i++) for (let j = i + 1; j < coins.length; j++) assert.ok(Math.hypot(coins[i].x - coins[j].x, coins[i].z - coins[j].z) > .85, `${k}: coins don't overlap`);
  }
});

test('the same layout for everyone; different floors differ', () => {
  for (const k of KEYS) { const m = MODELS[k]; assert.deepStrictEqual(FUN.place(k, m.w, m.d, freeOf(m), { avoid: avoidOf(m) }), PLACED[k], k) }
  assert.notDeepStrictEqual(PLACED[KEYS[0]].coins, PLACED[KEYS[1]].coins);
});

test('bad input gives an empty layout, never a throw', () => {
  for (const [w, d, f] of [[0, 10, () => true], [10, NaN, () => true], [20, 20, null], [3, 3, () => true]]) assert.deepStrictEqual(FUN.place('x', w, d, f), { coins: [], boxes: [] });
  assert.deepStrictEqual(FUN.place('x', 40, 40, () => false), { coins: [], boxes: [] }, 'nowhere free');
  const open = FUN.place('x', 40, 30, () => true, { trails: 3, boxes: 2 });
  assert.ok(open.coins.length >= 15 && open.coins.length <= 21 && open.boxes.length === 2);
});

test('roll never repeats the running power-up and stays in the table', () => {
  for (const cur of [undefined, ...FUN.IDS]) for (let i = 0; i < 50; i++) {
    const id = FUN.roll(i / 50, cur); assert.ok(FUN.IDS.includes(id) && id !== cur, `${cur} -> ${id}`);
  }
  for (const u of [NaN, -1, 1, 5, Infinity]) assert.ok(FUN.IDS.includes(FUN.roll(u)), String(u));
});

console.log(`fun: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
