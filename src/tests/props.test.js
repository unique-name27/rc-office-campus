// Loose props (js/props.js): where they go on each sample floor, the fixed-step clock and the collider heights the
// physics world is built from. usage: node src/tests/props.test.js
const assert = require('assert'), load = require('./load');
const LAYOUT = load('layout.js', 'LAYOUT'), CAMPUS = load('campus.js', 'CAMPUS', { LAYOUT }), PROPS = load('props.js', 'PROPS');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message) } }

const D = CAMPUS.demo(LAYOUT), KEYS = Object.keys(D.floors), MODELS = {};
for (const k of KEYS) MODELS[k] = LAYOUT.build(D.floors[k], D.rosters[k] || [], D.campus.teams);
// the same question the game answers with its collider grid: does a circle touch a wall, post or piece of furniture?
const colliders = m => [...(m.blocks || []), ...(m.posts || [])].filter(c => c.m & 5);
const touches = (c, x, z, r) => { if (c.r != null) return Math.hypot(x - c.x, z - c.z) < r + c.r; const cx = Math.max(c.x0, Math.min(c.x1, x)), cz = Math.max(c.z0, Math.min(c.z1, z)); return Math.hypot(x - cx, z - cz) < r };
const freeOf = m => { const cols = colliders(m); return (x, z, r) => !cols.some(c => touches(c, x, z, r)) };
const PLANS = {};
for (const k of KEYS) PLANS[k] = PROPS.plan(MODELS[k], k, freeOf(MODELS[k]));

test('module shape', () => {
  for (const f of ['plan', 'rad', 'hash', 'rng', 'ticks', 'span']) assert.strictEqual(typeof PROPS[f], 'function', f);
  assert.deepStrictEqual(Object.keys(PROPS.KINDS).sort(), ['bin', 'bottle', 'box', 'boxS', 'cone', 'ream']);
  for (const k in PROPS.KINDS) { const K = PROPS.KINDS[k]; assert.ok(K.h > 0 && K.m > 0 && (K.r > 0 || (K.w > 0 && K.d > 0)), k); assert.ok(PROPS.rad(k) > .1 && PROPS.rad(k) < .3, k + ' radius') }
  assert.ok(KEYS.length >= 8, 'sample floors');
});

test('every sample floor gets 20 to 40 props', () => {
  for (const k of KEYS) assert.ok(PLANS[k].length >= PROPS.MIN && PLANS[k].length <= PROPS.MAX, `${k}: ${PLANS[k].length}`);
});

test('the same floor always gets the same props; different floors differ', () => {
  for (const k of KEYS) {
    assert.deepStrictEqual(PROPS.plan(MODELS[k], k, freeOf(MODELS[k])), PLANS[k], k);
    assert.deepStrictEqual(PROPS.plan(LAYOUT.build(D.floors[k], D.rosters[k] || [], D.campus.teams), k, freeOf(MODELS[k])), PLANS[k], k + ' (model rebuilt)');
  }
  assert.notDeepStrictEqual(PLANS[KEYS[0]], PLANS[KEYS[1]]);
  assert.notDeepStrictEqual(PROPS.plan(MODELS[KEYS[0]], 'other-key', freeOf(MODELS[KEYS[0]])), PLANS[KEYS[0]], 'the floor key seeds the plan');
});

test('props are valid, on the plate, and clear of walls and furniture', () => {
  for (const k of KEYS) {
    const m = MODELS[k], cols = colliders(m);
    for (const p of PLANS[k]) {
      const K = PROPS.KINDS[p.kind]; assert.ok(K, `${k}: kind ${p.kind}`);
      for (const f of ['x', 'y', 'z', 'a']) assert.ok(Number.isFinite(p[f]), `${k}: ${f}`);
      assert.ok(Number.isInteger(p.g) && p.g >= 0, 'group');
      assert.ok(Math.abs(p.x) < m.w / 2 - .45 && Math.abs(p.z) < m.d / 2 - .45, `${k}: ${p.kind} off the plate`);
      assert.ok(p.y >= K.h / 2 && p.y < 1.2, `${k}: ${p.kind} height ${p.y}`);
      const r = PROPS.rad(p.kind);
      assert.ok(!cols.some(c => touches(c, p.x, p.z, r)), `${k}: ${p.kind} at ${p.x},${p.z} touches a collider`);
    }
  }
});

test('props keep clear of the spawn point, pads, ramps, route ends and chairs', () => {
  for (const k of KEYS) {
    const m = MODELS[k], far = (p, x, z, d, what) => assert.ok(Math.hypot(p.x - x, p.z - z) >= d + PROPS.rad(p.kind) - 1e-3, `${k}: ${p.kind} too close to ${what}`);
    for (const p of PLANS[k]) {
      far(p, m.spawn.x, m.spawn.z, 2.2, 'the spawn point');
      for (const e of m.elevators) if (e.pad) far(p, e.pad.x, e.pad.z, 2, 'an elevator pad');
      if (m.exit) far(p, m.exit.x, m.exit.z, 2.2, 'the exit pad');
      if (m.kitchen) far(p, m.kitchen.pickup.x, m.kitchen.pickup.z, 1.4, 'the coffee pickup');
      for (const r of m.ramps) far(p, r.x, r.z, 1.3, 'a ramp');
      for (const d of m.dests) far(p, d.x, d.z, .75, 'a route end ' + d.id);
      for (const c of m.chairs) far(p, c.x, c.z, .5, 'a chair');
    }
  }
});

test('stacks rest on each other and groups do not overlap', () => {
  for (const k of KEYS) {
    const groups = new Map(); for (const p of PLANS[k]) { if (!groups.has(p.g)) groups.set(p.g, []); groups.get(p.g).push(p) }
    for (const g of groups.values()) {
      // the lowest prop of a group stands on the floor; anything higher has a prop under it
      for (const p of g) {
        const K = PROPS.KINDS[p.kind], bottom = p.y - K.h / 2;
        if (bottom < .01) continue;
        assert.ok(g.some(q => q !== p && Math.abs(q.y + PROPS.KINDS[q.kind].h / 2 - bottom) < .01 && Math.hypot(q.x - p.x, q.z - p.z) < .3), `${k}: a floating ${p.kind} at y ${p.y}`);
      }
    }
    // props standing on the floor in different groups never share space
    const low = PLANS[k].filter(p => p.y - PROPS.KINDS[p.kind].h / 2 < .01);
    for (let i = 0; i < low.length; i++) for (let j = i + 1; j < low.length; j++) { const a = low[i], b = low[j]; if (a.g === b.g) continue;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > .3, `${k}: ${a.kind} and ${b.kind} overlap`) }
  }
});

test('every kind shows up somewhere, and paper reams only where there is a printer', () => {
  const seen = new Set(); for (const k of KEYS) for (const p of PLANS[k]) seen.add(p.kind);
  assert.deepStrictEqual([...seen].sort(), Object.keys(PROPS.KINDS).sort());
  for (const k of KEYS) { const printers = MODELS[k].items.filter(i => i.t === 'printer');
    for (const p of PLANS[k]) if (p.kind === 'ream') assert.ok(printers.some(i => Math.hypot(i.x - p.x, i.z - p.z) < 1.6), `${k}: a ream far from any printer`) }
});

test('bad input never throws', () => {
  assert.deepStrictEqual(PROPS.plan(null, 'x', () => true), []);
  assert.deepStrictEqual(PROPS.plan({ w: 0, d: 0 }, 'x', () => true), []);
  assert.deepStrictEqual(PROPS.plan(MODELS[KEYS[0]], KEYS[0], null), []);
  assert.deepStrictEqual(PROPS.plan(MODELS[KEYS[0]], KEYS[0], () => false), [], 'nothing is free');
  const odd = { w: 30, d: 20, walls: [null, { kind: 'ext', x1: NaN, z1: 0, x2: 1, z2: 1 }, { kind: 'int', x1: -10, z1: 0, x2: 10, z2: 0 }], items: [null, { t: 'printer', x: NaN, z: 0 }, { t: 'printer', x: 5, z: 5 }], rooms: [null, { type: 'restroom' }], chairs: [null], dests: [null], ramps: [null], elevators: [null, {}] };
  const p = PROPS.plan(odd, 'odd', () => true);
  assert.ok(p.length > 0 && p.length <= PROPS.MAX && p.every(q => Number.isFinite(q.x) && Number.isFinite(q.z)));
});

test('fixed-step clock: 60 Hz steps whatever the frame rate, never more than the cap', () => {
  const STEP = 1 / 60, run = (dt, frames, max) => { const c = { acc: 0 }; let n = 0; for (let i = 0; i < frames; i++) n += PROPS.ticks(c, dt, STEP, max); return n };
  assert.strictEqual(run(1 / 60, 600, 3), 600, '60 fps');
  assert.ok(Math.abs(run(1 / 144, 1440, 3) - 600) <= 1, '144 fps');
  assert.ok(Math.abs(run(1 / 30, 300, 3) - 600) <= 1, '30 fps');
  assert.strictEqual(run(.05, 100, 3), 300, '20 fps frames run 3 steps each');
  const c = { acc: 0 }; assert.strictEqual(PROPS.ticks(c, 5, STEP, 3), 3, 'a long pause runs only the cap'); assert.ok(c.acc < STEP, 'and drops the rest');
  assert.strictEqual(PROPS.ticks({ acc: 0 }, 0, STEP, 3), 0); assert.strictEqual(PROPS.ticks({ acc: 0 }, NaN, STEP, 3), 0); assert.strictEqual(PROPS.ticks({ acc: 0 }, -1, STEP, 3), 0);
});

test('collider heights for the physics world', () => {
  assert.deepStrictEqual(PROPS.span({ b: 1, m: 7, tall: 1 }, 3), { y0: 0, y1: 3 }, 'a wall');
  assert.deepStrictEqual(PROPS.span({ b: 1, m: 7, tall: 0 }, 3), { y0: 0, y1: .7 }, 'a low blocker');
  assert.deepStrictEqual(PROPS.span({ b: 1, m: 8, h: .775, u: .725 }, 3), { y0: .725, y1: .775 }, 'a desk top is a slab');
  assert.deepStrictEqual(PROPS.span({ b: 1, m: 8, h: .9 }, 3), { y0: 0, y1: .9 }, 'a lab bench is solid');
  assert.deepStrictEqual(PROPS.span({ b: 1, m: 7, tall: 1, top: .9 }, 3), { y0: 0, y1: .9 }, 'a block under a surface ends at the surface');
  { const s = PROPS.span({ b: 1, m: 1, tall: 1, minY: .7 }, 3); assert.ok(s.y0 === .7 && Math.abs(s.y1 - 1.12) < 1e-9, 'a monitor on a desk') }
  assert.strictEqual(PROPS.span({ b: 1, m: 4 }, 3), null, 'walker-only blocks are ignored');
  assert.strictEqual(PROPS.span({ b: 1, m: 2 }, 3), null, 'chair-only blocks are ignored');
  assert.strictEqual(PROPS.span({ b: 1, m: 8, h: NaN }, 3), null); assert.strictEqual(PROPS.span(null, 3), null);
});

console.log(`props: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
