// Integration test: CAMPUS + LAYOUT + NAV + IMPORT + EDITOR used together, the way the game uses them.
//   node v4/tests/integration.test.js     (single process, a few seconds)
// Also writes tests/ascii-all.txt: every demo floor at 0.5 m per character (see tests/ascii.js for the legend).
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const load = require('./load');
const LAYOUT = load('layout.js', 'LAYOUT');
const CAMPUS = load('campus.js', 'CAMPUS');
const NAV = load('nav.js', 'NAV');
const IMPORT = load('importers.js', 'IMPORT');
const EDITOR = load('editor.js', 'EDITOR');   // no DOM in node: it must not touch document at load
const ascii = fs.existsSync(path.join(__dirname, 'ascii.js')) ? require('./ascii') : null;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String((e && e.stack) || e).split('\n').slice(0, 8).join('\n     ')); }
}
const info = s => console.log('     ' + s);
const fin = v => typeof v === 'number' && Number.isFinite(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const P = p => ({ x: p[0], z: p[1] });
const fwd = a => [-Math.sin(a), -Math.cos(a)];                    // SPEC yaw: forward = (-sin a, -cos a)
// cosine between the facing a and the vector (dx, dz); 1 = facing straight at it
const facing = (a, dx, dz) => { const f = fwd(a), L = Math.hypot(dx, dz); return L < 1e-9 ? 1 : (f[0] * dx + f[1] * dz) / L; };
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const QUARTERS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const isQuarter = a => QUARTERS.some(q => Math.abs(a - q) < 1e-9);
// distance from (x,z) to the nearest car/walker obstacle (mask & 5) of a model
function clearance(m, x, z) {
  let best = Infinity;
  for (const b of m.blocks) if (b.m & 5) best = Math.min(best, Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1)));
  for (const p of m.posts) if (p.m & 5) best = Math.min(best, Math.hypot(x - p.x, z - p.z) - p.r);
  return best;
}
const cellOf = (G, x, z) => { const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell); return i < 0 || j < 0 || i >= G.nx || j >= G.nz ? -1 : j * G.nx + i; };

/* ================= the timed pipeline: demo -> 8 floors -> exterior -> all grids -> 50 random plans ================= */
const T0 = performance.now();
const D = CAMPUS.demo(LAYOUT);
const KEYS = Object.keys(D.floors);
const MODELS = {};
for (const k of KEYS) MODELS[k] = LAYOUT.build(D.floors[k], D.rosters[k], D.campus.teams);
const T1 = performance.now();
const EXT = CAMPUS.exterior(D.campus, D.floors);
const T2 = performance.now();
const GRIDS = new Map();
const gridOf = k => { if (!GRIDS.has(k)) { const m = k === 'campus' ? EXT : MODELS[k]; GRIDS.set(k, m ? NAV.grid(m) : null); } return GRIDS.get(k); };
const WORLD = { campus: EXT, floors: MODELS, grid: gridOf };   // same shape as the game's navWorld()
const WORLDS = ['campus', ...KEYS];
for (const k of WORLDS) gridOf(k);
const T3 = performance.now();
const modelOf = w => w === 'campus' ? EXT : MODELS[w];
const ALL = [];   // every routable dest on the campus
for (const w of WORLDS) for (const d of modelOf(w).dests) ALL.push({ w, x: d.x, z: d.z, name: d.name, id: d.id });
const RND = mulberry32(20261109), RANDOM = [];
for (let i = 0; i < 50; i++) {
  const a = ALL[Math.floor(RND() * ALL.length)], b = ALL[Math.floor(RND() * ALL.length)];
  RANDOM.push({ a, b, r: NAV.plan(WORLD, a, b) });
}
const T4 = performance.now();

/* ================= 1. every floor builds clean ================= */
test('demo campus: 8 floors, 2 buildings x 4, keys match CAMPUS.key', () => {
  assert.equal(KEYS.length, 8);
  for (const b of D.campus.buildings) for (let f = 1; f <= b.floors; f++) assert.ok(D.floors[CAMPUS.key(b.id, f)], 'missing ' + CAMPUS.key(b.id, f));
  for (const k of KEYS) {
    const p = CAMPUS.parseKey(k), m = MODELS[k];
    assert.deepEqual([m.key, m.b, m.f], [k, p.b, p.f], k + ' model key/b/f');
  }
  const people = KEYS.reduce((s, k) => s + D.rosters[k].length, 0);
  info(`${people} people on ${KEYS.length} floors; ${EXT.buildings.length} buildings outside`);
});

test('every floor: unplaced 0, coffee 5, kitchen, 2 elevators with pads, spawn free, exit iff floor 1', () => {
  for (const k of KEYS) {
    const m = MODELS[k], f = CAMPUS.parseKey(k).f, G = gridOf(k);
    assert.equal(m.unplaced.length, 0, `${k}: unplaced ${m.unplaced.map(u => u.name + ' (' + u.team + ')').slice(0, 5).join(', ')}`);
    assert.equal(m.people.length, D.rosters[k].length, k + ': everyone on the roster is seated');
    assert.equal(m.coffee.length, 5, k + ': coffee recipients');
    assert.equal(new Set(m.coffee).size, 5, k + ': coffee desks distinct');
    for (const i of m.coffee) assert.ok(m.desks[i] && m.desks[i].person >= 0, k + ': coffee desk occupied');
    assert.ok(m.kitchen && fin(m.kitchen.x) && fin(m.kitchen.pickup.x) && m.kitchen.pickup.r === 0.9, k + ': kitchen');
    assert.equal(m.elevators.length, 2, k + ': elevators');
    for (const e of m.elevators) assert.ok(e.pad && fin(e.pad.x) && fin(e.pad.z) && e.pad.r === 1.0, k + ': elevator pad ' + e.id);
    const c = cellOf(G, m.spawn.x, m.spawn.z);
    assert.ok(c >= 0 && G.block[c] !== 1, `${k}: spawn ${m.spawn.x},${m.spawn.z} is in a blocked NAV cell`);
    assert.ok(clearance(m, m.spawn.x, m.spawn.z) >= 0.3, `${k}: spawn only ${clearance(m, m.spawn.x, m.spawn.z).toFixed(2)} m from an obstacle`);
    assert.equal(!!m.exit, f === 1, k + ': exit present iff floor 1');
    if (m.exit) assert.ok(clearance(m, m.exit.x, m.exit.z) >= 0.3, k + ': exit pad is free');
    for (const e of m.elevators) assert.ok(clearance(m, e.pad.x, e.pad.z) >= 0.3, `${k}: elevator ${e.id} pad is free`);
  }
});

test('every roster desk id lands on exactly that desk (no auto placement in the demo)', () => {
  for (const k of KEYS) {
    const m = MODELS[k];
    m.people.forEach((p, i) => {
      const row = D.rosters[k].find(r => r.name === p.name);
      assert.ok(row, k + ': unknown person ' + p.name);
      assert.equal(m.desks[p.desk].id, row.desk, `${k}: ${p.name} wanted ${row.desk}, got ${m.desks[p.desk].id}`);
      assert.equal(p.auto, false, k + ': ' + p.name + ' auto-placed');
      assert.equal(m.desks[p.desk].person, i);
    });
  }
});

test('demo floors build without layout problems', () => {
  for (const k of KEYS) {
    const bad = MODELS[k].problems.filter(s => /no reachable|no free spot|no free desk|skipped|invalid|unknown type|clipped|outside/i.test(s));
    assert.deepEqual(bad, [], k + ' problems');
    if (MODELS[k].problems.length) info(k + ': ' + MODELS[k].problems.join(' | '));
  }
  if (EXT.problems.length) info('campus: ' + EXT.problems.join(' | '));
  assert.deepEqual(EXT.problems, [], 'campus exterior problems');
});

/* ================= 2. NAV: every dest reachable from spawn ================= */
test('NAV: from spawn, every dest on every floor (and outside) has a route that ends at the dest', () => {
  const counts = [], misses = [], far = [];
  let worst = 0;
  for (const w of WORLDS) {
    const m = modelOf(w), from = { w, x: m.spawn.x, z: m.spawn.z };
    let ok = 0;
    for (const d of m.dests) {
      const r = NAV.plan(WORLD, from, { w, x: d.x, z: d.z, name: d.name });
      if (!r || r.legs.length !== 1) { misses.push(`${w} ${d.id} (${d.x},${d.z})`); continue; }
      const pts = r.legs[0].pts, end = pts[pts.length - 1], off = Math.hypot(end[0] - d.x, end[1] - d.z);
      worst = Math.max(worst, off);
      if (off > 0.35) far.push(`${w} ${d.id} ends ${off.toFixed(2)} m away`);
      else ok++;
    }
    counts.push(`${w} ${ok}/${m.dests.length}`);
  }
  info('reachable: ' + counts.join(', ') + `  (worst end offset ${worst.toFixed(3)} m)`);
  assert.deepEqual(misses, [], 'unreachable dests');
  assert.deepEqual(far, [], 'routes that stop short of their dest');
});

/* ================= 3. elevators line up across floors ================= */
test('elevator pads of the same id are identical on all floors of a building (within 1 cm)', () => {
  for (const b of D.campus.buildings) {
    const ks = KEYS.filter(k => CAMPUS.parseKey(k).b === b.id);
    assert.equal(ks.length, 4, b.id + ' floors');
    const ref = MODELS[ks[0]].elevators;
    for (const k of ks.slice(1)) {
      const els = MODELS[k].elevators;
      assert.deepEqual(els.map(e => e.id).sort(), ref.map(e => e.id).sort(), k + ' elevator ids');
      for (const e of ref) {
        const o = els.find(x => x.id === e.id);
        assert.ok(dist(o.pad, e.pad) <= 0.01 && dist(o, e) <= 0.01 && o.a === e.a, `${k} ${e.id}: pad ${o.pad.x},${o.pad.z} vs ${e.pad.x},${e.pad.z}`);
      }
    }
  }
});

/* ================= 4. doors and cross-building routes ================= */
test('campus door pad = building center + floor-1 exit pad, 2.4 m straight out', () => {
  for (const b of EXT.buildings) {
    const m1 = MODELS[CAMPUS.key(b.id, 1)];
    assert.ok(m1 && m1.exit, b.id + '-1 has an exit');
    const ix = b.x + m1.exit.x, iz = b.z + m1.exit.z, dx = b.door.x - ix, dz = b.door.z - iz, L = Math.hypot(dx, dz);
    assert.ok(L >= 2.2 && L <= 2.6, `${b.id}: door pad ${L.toFixed(3)} m from the exit pad (want 2.4 +/- 0.2)`);
    assert.ok(facing(m1.exit.a, dx, dz) > 0.999, b.id + ': door pad is straight out through the doorway');
    assert.equal(b.door.a, m1.exit.a, b.id + ': both pads face out');
    assert.ok(facing(b.door.a, b.door.x - b.x, b.door.z - b.z) > 0, b.id + ': door a faces away from the building');
    // the doorway gap in the exterior shell is where the pads are
    const gapOK = !m1.blocks.some(k => (k.m & 5) && k.x0 < m1.exit.x + 0.2 && k.x1 > m1.exit.x - 0.2 && k.z0 < m1.exit.z + 1.5 && k.z1 > m1.exit.z - 1.5 && k.tall);
    assert.ok(gapOK, b.id + ': the floor-1 doorway is open between the pads');
    // the approach stays clear both ways: 3.5 m in from the exit pad (lobby side), 6 m out from the door pad (campus side)
    const fi = fwd(m1.exit.a + Math.PI), fo = fwd(b.door.a);
    for (let s = 0; s <= 3.5; s += 0.25) assert.ok(clearance(m1, m1.exit.x + fi[0] * s, m1.exit.z + fi[1] * s) >= 0.4, `${b.id}-1: blocked ${s} m inside the door`);
    for (let s = 0; s <= 6; s += 0.25) assert.ok(clearance(EXT, b.door.x + fo[0] * s, b.door.z + fo[1] * s) >= 0.4, `${b.id}: blocked ${s} m outside the door`);
  }
});

function checkLegs(r, spec) {
  assert.ok(r, 'no route');
  assert.deepEqual(r.legs.map(l => l.end.kind), spec.map(s => s.kind), 'leg kinds');
  assert.deepEqual(r.legs.map(l => l.w), spec.map(s => s.w), 'leg worlds');
  r.legs.forEach((l, i) => {
    const s = spec[i], a = l.pts[0], z = l.pts[l.pts.length - 1];
    assert.ok(Math.hypot(a[0] - s.first.x, a[1] - s.first.z) <= 1.5, `leg ${i} (${l.w}) starts ${Math.hypot(a[0] - s.first.x, a[1] - s.first.z).toFixed(2)} m from ${s.firstName}`);
    if (s.last) assert.ok(Math.hypot(z[0] - s.last.x, z[1] - s.last.z) <= 1.0, `leg ${i} (${l.w}) ends ${Math.hypot(z[0] - s.last.x, z[1] - s.last.z).toFixed(2)} m from ${s.lastName}`);
    // a leg may be 0 m long (starting on the very elevator pad the route rides), never negative or NaN
    assert.ok(l.len >= 0 && fin(l.len) && l.pts.length >= 2 && typeof l.end.label === 'string' && l.end.label, `leg ${i} len/label`);
  });
  const sum = r.legs.reduce((s, l) => s + l.len, 0);
  assert.ok(Math.abs(sum - r.len) < 1e-6, 'route len = sum of legs');
}
const bldg = id => EXT.buildings.find(b => b.id === id);
const padOf = (k, id) => MODELS[k].elevators.find(e => e.id === id).pad;

test('cross-building: B1-1 spawn -> a desk on B2-3', () => {
  const m3 = MODELS['B2-3'], di = m3.desks.findIndex(d => d.person >= 0 && d.arr === 'lab');
  const dest = m3.dests.find(d => d.id === 'desk:' + m3.desks[di].id);
  const s = MODELS['B1-1'].spawn;
  const r = NAV.plan(WORLD, { w: 'B1-1', x: s.x, z: s.z }, { w: 'B2-3', x: dest.x, z: dest.z, name: dest.name });
  assert.ok(r, 'no route');
  const elev = r.legs[2] && r.legs[2].end.elev;
  checkLegs(r, [
    { kind: 'exit', w: 'B1-1', first: s, firstName: 'B1-1 spawn', last: MODELS['B1-1'].exit, lastName: 'B1-1 exit pad' },
    { kind: 'enter', w: 'campus', first: bldg('B1').door, firstName: 'B1 door pad', last: bldg('B2').door, lastName: 'B2 door pad' },
    { kind: 'elev', w: 'B2-1', first: MODELS['B2-1'].exit, firstName: 'B2-1 exit pad', last: padOf('B2-1', elev), lastName: 'B2-1 ' + elev + ' pad' },
    { kind: 'dest', w: 'B2-3', first: padOf('B2-3', elev), firstName: 'B2-3 ' + elev + ' pad', last: dest, lastName: dest.id },
  ]);
  assert.equal(r.legs[0].end.to, 'campus');
  assert.equal(r.legs[1].end.to, 'B2-1');
  assert.equal(r.legs[2].end.to, 'B2-3');
  assert.match(r.legs[2].end.label, /Floor 3/);
  assert.match(r.legs[3].end.label, new RegExp(dest.name));
  info(`B1-1 spawn -> ${dest.name} (B2-3): ${r.legs.map(l => l.w + ' ' + l.len.toFixed(1) + ' m').join(' -> ')} = ${r.len.toFixed(1)} m via ${elev}`);
});

test('cross-building: B2-4 elevator pad -> a conference room on B1-1', () => {
  const m4 = MODELS['B2-4'], e = m4.elevators[1];
  const conf = MODELS['B1-1'].rooms.find(x => x.type === 'conf');
  const dest = MODELS['B1-1'].dests.find(d => d.id === 'room:' + conf.id);
  const r = NAV.plan(WORLD, { w: 'B2-4', x: e.pad.x, z: e.pad.z }, { w: 'B1-1', x: dest.x, z: dest.z, name: conf.name });
  assert.ok(r, 'no route');
  const elev = r.legs[0].end.elev;
  checkLegs(r, [
    { kind: 'elev', w: 'B2-4', first: e.pad, firstName: 'B2-4 ' + e.id + ' pad', last: padOf('B2-4', elev), lastName: 'B2-4 ' + elev + ' pad' },
    { kind: 'exit', w: 'B2-1', first: padOf('B2-1', elev), firstName: 'B2-1 ' + elev + ' pad', last: MODELS['B2-1'].exit, lastName: 'B2-1 exit pad' },
    { kind: 'enter', w: 'campus', first: bldg('B2').door, firstName: 'B2 door pad', last: bldg('B1').door, lastName: 'B1 door pad' },
    { kind: 'dest', w: 'B1-1', first: MODELS['B1-1'].exit, firstName: 'B1-1 exit pad', last: dest, lastName: dest.id },
  ]);
  assert.match(r.legs[0].end.label, /Floor 1/);
  assert.match(r.legs[3].end.label, new RegExp(conf.name));
  info(`B2-4 ${e.id} -> ${conf.name} (B1-1): ${r.legs.map(l => l.w + ' ' + l.len.toFixed(1) + ' m').join(' -> ')} = ${r.len.toFixed(1)} m`);
});

test('same building, floor to floor: the ride keeps the elevator id', () => {
  for (const b of ['B1', 'B2']) {
    const a = MODELS[b + '-4'], z = MODELS[b + '-2'], dest = z.dests.find(d => d.kind === 'room');
    const r = NAV.plan(WORLD, { w: b + '-4', x: a.spawn.x, z: a.spawn.z }, { w: b + '-2', x: dest.x, z: dest.z, name: dest.name });
    assert.ok(r && r.legs.length === 2, b + ': 2 legs');
    const id = r.legs[0].end.elev, p2 = padOf(b + '-2', id);
    assert.ok(Math.hypot(r.legs[1].pts[0][0] - p2.x, r.legs[1].pts[0][1] - p2.z) <= 1.5, b + ': second leg starts at the same elevator');
  }
});

test('campus <-> floor routes: from the outdoor spawn into B1-2, and from a B2-2 desk out to the east lot', () => {
  const m2 = MODELS['B1-2'], d = m2.dests.find(x => x.kind === 'desk');
  const r1 = NAV.plan(WORLD, { w: 'campus', x: EXT.spawn.x, z: EXT.spawn.z }, { w: 'B1-2', x: d.x, z: d.z, name: d.name });
  assert.ok(r1, 'campus -> B1-2');
  assert.deepEqual(r1.legs.map(l => l.w + ':' + l.end.kind), ['campus:enter', 'B1-1:elev', 'B1-2:dest']);
  const lot = EXT.dests.find(x => x.id === 'lot:E'), b = MODELS['B2-2'], dd = b.dests.find(x => x.kind === 'desk');
  assert.ok(lot, 'east lot dest');
  const r2 = NAV.plan(WORLD, { w: 'B2-2', x: dd.x, z: dd.z }, { w: 'campus', x: lot.x, z: lot.z, name: lot.name });
  assert.ok(r2, 'B2-2 -> campus');
  assert.deepEqual(r2.legs.map(l => l.w + ':' + l.end.kind), ['B2-2:elev', 'B2-1:exit', 'campus:dest']);
  const end = r2.legs[2].pts[r2.legs[2].pts.length - 1];
  assert.ok(Math.hypot(end[0] - lot.x, end[1] - lot.z) < 0.35, 'ends at the lot');
});

test('per-team arrangements: every zone is filled with its own arr or its team default (finance offices, lab benches...)', () => {
  const seen = new Set();
  for (const k of KEYS) {
    const spec = D.floors[k], m = MODELS[k];
    for (const z of spec.zones) {
      const want = z.arr || (D.campus.teams[z.team] && D.campus.teams[z.team].arr) || CAMPUS.defaultArr(z.team);
      const ds = m.desks.filter(d => d.zone === z.id);
      assert.ok(ds.length > 0, `${k} ${z.id} (${z.team}) has desks`);
      assert.ok(ds.every(d => d.arr === want), `${k} ${z.id} (${z.team}) is ${want}`);
      seen.add(want);
    }
  }
  assert.deepEqual([...seen].sort(), [...LAYOUT.ARR].sort(), 'the demo shows all five arrangements');
  // teams map arr agrees with the SPEC §2 guesses for every demo team except where the demo picks on purpose
  for (const [t, v] of Object.entries(D.campus.teams)) assert.ok(LAYOUT.ARR.includes(v.arr) && /^#[0-9A-F]{6}$/i.test(v.color), t);
});

test('an offices zone drawn flush with the window wall keeps both rows (EDITOR rect -> LAYOUT)', () => {
  // what a facilities person does in the editor: drag a Finance area from the plate corner along the north windows.
  // On a plain 72 x 44 m floor with a central core (Building 1's plate is too small and full for this).
  const T = EDITOR._t, core = (id, type, x0, z0, x1, z1, door) => ({ id, type, name: id, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, door });
  const base = { v: 1, key: 'B1-4', b: 'B1', f: 4, w: 72, d: 44, door: null, plan: null, walls: [], glass: [], desks: [], ramps: null, updatedAt: 0,
    rooms: [core('e1', 'elevator', -2.8, -7.6, 0, -2.4, 's'), core('e2', 'elevator', 0, -7.6, 2.8, -2.4, 's'), core('st1', 'stairs', -8, -7.6, -2.8, -2.4, null), core('rr1', 'restroom', 2.8, -7.6, 8, -2.4, null)],
    zones: [] };
  const rect = T.rectFromDrag(10, -22, 36, -9.5, true);
  const mk = r => Object.assign({}, base, { zones: base.zones.filter(z => z.id !== 'z2').concat([Object.assign({ id: 'z2', team: 'Legal', arr: null }, r, { dir: r.w >= r.d ? 'h' : 'v' })]) });
  const flush = LAYOUT.build(T.finalize(mk(rect)), [], D.campus.teams), inset = LAYOUT.build(mk({ x: rect.x - 0.15, z: rect.z + 0.15, w: rect.w - 0.3, d: rect.d - 0.3 }), [], D.campus.teams);
  const n = m => m.desks.filter(d => d.zone === 'z2').length;
  assert.ok(n(flush) >= 14, `flush Legal zone holds ${n(flush)} offices`);
  assert.equal(n(flush), n(inset), 'flush and inset hold the same number of offices');
  for (const w of flush.walls) if (w.kind === 'int' && w.z1 < -15) assert.ok(Math.min(w.z1, w.z2) >= -22 + 1.2 - 0.08 - 1e-6, 'office walls stay 1.2 m off the exterior wall');
  const G = NAV.grid(flush), s = flush.spawn;
  for (const d of flush.dests.filter(x => x.kind === 'desk' && flush.desks.find(k => 'desk:' + k.id === x.id).zone === 'z2')) {
    const r = NAV.findPath(G, s.x, s.z, d.x, d.z);
    assert.ok(r && Math.hypot(r.pts[r.pts.length - 1][0] - d.x, r.pts[r.pts.length - 1][1] - d.z) < 0.35, d.id + ' reachable');
  }
});

test('hand-placed desks: imported people whose desk ids are not found still get desks (team-tagged first, then untagged)', () => {
  // what a seating import does to Building 1: its desk grid stays, the demo's team tags are dropped, zones are re-teamed
  for (const k of ['B1-1', 'B1-2', 'B1-3', 'B1-4']) {
    const base = D.floors[k], spec = Object.assign({}, base, { desks: base.desks.map(d => Object.assign({}, d, { team: '' })) });
    const free = base.desks.filter(d => d.arr !== 'hot').length + MODELS[k].desks.filter(d => d.zone != null).length;
    const people = D.rosters[k].map((r, i) => ({ desk: 'nowhere-' + i, name: r.name, team: 'Imported ' + r.team, title: r.title }));
    const m = LAYOUT.build(spec, people, D.campus.teams);
    assert.equal(m.people.length, Math.min(people.length, free), k + ' seated');
    assert.ok(m.people.every(p => p.auto && m.desks[p.desk].arr !== 'hot'), k + ': auto-placed, never at a hot desk');
  }
  // a desk tagged with a team is used for that team before anyone else's
  const one = { v: 1, key: 'Z-2', b: 'Z', f: 2, w: 20, d: 14, door: null, plan: null, walls: [], glass: [], zones: [], ramps: null, updatedAt: 0,
    rooms: [{ id: 'e1', type: 'elevator', name: 'Elevator', x: 0, z: -5.5, w: 2.6, d: 2.4, door: 's' }],
    desks: [{ id: 'a', x: -4, z: 2, a: 0, team: 'Blue' }, { id: 'b', x: 4, z: 2, a: 0 }] };
  const m = LAYOUT.build(one, [{ desk: '', name: 'Ann Lee', team: 'Red', title: 't' }, { desk: '', name: 'Bo Kim', team: 'Blue', title: 't' }], {});
  assert.equal(m.desks[m.people.find(p => p.name === 'Bo Kim').desk].id, 'a', 'Blue takes the Blue desk');
  assert.equal(m.desks[m.people.find(p => p.name === 'Ann Lee').desk].id, 'b', 'Red takes the untagged desk');
});

test('Building 1: no desk sits on a room, a column or another desk', () => {
  const foot = d => { const s = Math.abs(Math.sin(d.a)) > 0.5, ex = (s ? d.dd : d.w) / 2, ez = (s ? d.w : d.dd) / 2; return { x0: d.x - ex, x1: d.x + ex, z0: d.z - ez, z1: d.z + ez }; };
  const hit = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.01;
  for (const k of ['B1-1', 'B1-2', 'B1-3', 'B1-4']) {
    const m = MODELS[k], ds = m.desks.map(foot);
    for (const r of m.rooms) { const b = { x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 };
      m.desks.forEach((d, i) => assert.ok(r.type === 'open' || r.type === 'lobby' || !hit(ds[i], b), `${k}: desk ${d.id} sits on ${r.name}`)); }
    // bench desks in a run butt together (1.56 m tops at the plan's 1.55 m pitch): only more than 3 cm counts as overlapping
    const deep = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.03 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.03;
    for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) assert.ok(!deep(ds[i], ds[j]), `${k}: desks ${m.desks[i].id} / ${m.desks[j].id} overlap`);
    for (const w of m.walls) if (w.kind !== 'ext') m.desks.forEach((d, i) => { const f = ds[i], mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2;
      if (Math.hypot(w.x2 - w.x1, w.z2 - w.z1) < 0.5) assert.ok(!(mx > f.x0 - .05 && mx < f.x1 + .05 && mz > f.z0 - .05 && mz < f.z1 + .05), `${k}: desk ${d.id} is on a column`); });
  }
});

test('50 random campus-wide plans all succeed and chain up', () => {
  const bad = RANDOM.filter(x => !x.r).map(x => `${x.a.w} ${x.a.id} -> ${x.b.w} ${x.b.id}`);
  assert.deepEqual(bad, [], 'failed plans');
  for (const { a, b, r } of RANDOM) {
    assert.equal(r.legs[0].w, a.w);
    assert.equal(r.legs[r.legs.length - 1].w, b.w);
    for (let i = 0; i + 1 < r.legs.length; i++) {
      const e = r.legs[i].end;
      assert.ok(e.kind !== 'dest' && e.to === r.legs[i + 1].w, `leg ${i} hands over to ${r.legs[i + 1].w}`);
    }
    assert.equal(r.legs[r.legs.length - 1].end.kind, 'dest');
  }
  const multi = RANDOM.filter(x => x.r.legs.length > 1).length;
  info(`${multi} of 50 cross floors or buildings; longest ${Math.max(...RANDOM.map(x => x.r.len)).toFixed(0)} m`);
});

test('race gates and chevrons along a real route use the SPEC yaw', () => {
  const m = MODELS['B1-2'], d = m.dests.filter(x => x.kind === 'desk').sort((p, q) => Math.hypot(q.x - m.spawn.x, q.z - m.spawn.z) - Math.hypot(p.x - m.spawn.x, p.z - m.spawn.z))[0];
  const r = NAV.findPath(gridOf('B1-2'), m.spawn.x, m.spawn.z, d.x, d.z);
  assert.ok(r && r.len > 20);
  const gs = NAV.gates(r.pts, 10), ch = NAV.sample(r.pts, 1.2, 0);
  assert.ok(gs.length >= 2);
  const last = gs[gs.length - 1];
  assert.ok(Math.hypot(last.x - d.x, last.z - d.z) < 0.35, 'finish gate at the dest');
  // every gate / chevron yaw is the SPEC yaw of the segment it sits on (or a neighbour, at a corner)
  const segA = [];
  for (let k = 0; k + 1 < r.pts.length; k++) segA.push(Math.atan2(-(r.pts[k + 1][0] - r.pts[k][0]), -(r.pts[k + 1][1] - r.pts[k][1])));
  const adiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const s of gs.concat(ch)) {
    const i = NAV.track(r.pts, s.x, s.z).i;
    assert.ok([i - 1, i, i + 1].some(j => j >= 0 && j < segA.length && adiff(s.a, segA[j]) < 1e-6), `yaw ${s.a} at ${s.x.toFixed(2)},${s.z.toFixed(2)} is not along segment ${i}`);
    const f = fwd(s.a), ahead = NAV.track(r.pts, s.x + f[0] * 0.05, s.z + f[1] * 0.05);
    assert.ok(ahead.along >= NAV.track(r.pts, s.x, s.z).along - 1e-6, 'forward along the yaw moves along the route');
  }
});

/* ================= 5. facilities CSV -> IMPORT -> LAYOUT ================= */
test('importers -> layout: a messy facilities CSV for B2-3 puts everyone on their exact desk', () => {
  const key = 'B2-3', roster = D.rosters[key], m0 = MODELS[key];
  const flip = n => { const i = n.lastIndexOf(' '); return n.slice(i + 1) + ', ' + n.slice(0, i); };
  const B = ['B2', 'Bldg 2', 'Building 2', ' bldg. 2 '], F = ['3', 'L3', 'Level 3', '03', 'Floor 3'];
  const rows = [['Building', 'Floor', 'Desk', 'Name', 'Team', 'Title']];
  roster.forEach((p, i) => rows.push([B[i % B.length], F[i % F.length], p.desk, i % 5 === 0 ? flip(p.name) : p.name, i % 7 === 0 ? ' ' + p.team.toLowerCase() + ' ' : p.team, p.title]));
  const open = m0.desks.find(d => d.person < 0);
  rows.push(['Bldg 2', 'L3', open.id, 'Vacant', '', '']);                       // an open desk: dropped quietly
  rows.push(['B2', '3', roster[3].desk, roster[3].name.toUpperCase(), roster[3].team, roster[3].title]);   // duplicate person
  rows.push(['', '', '', '', '', '']);                                          // filler row
  const csv = '﻿' + IMPORT.toCSV(rows);
  const parsed = IMPORT.parseCSV(csv), mapped = IMPORT.mapColumns(parsed.header);
  assert.deepEqual(['building', 'floor', 'desk', 'name', 'team', 'title'].map(f => mapped.map[f]), [0, 1, 2, 3, 4, 5], 'column map');
  const n = IMPORT.normalize(parsed, mapped.map, D.campus);
  assert.deepEqual(Object.keys(n.floors), [key], 'only B2-3');
  assert.equal(n.problems.length, 1, 'one problem (the duplicate): ' + JSON.stringify(n.problems));
  assert.match(n.problems[0].msg, /more than once/);
  const imported = n.floors[key];
  assert.equal(imported.length, roster.length, 'everyone kept once');
  assert.ok(imported.every(e => !e.vacant && e.name), 'no vacant rows kept');
  for (const v of Object.values(n.buildings)) assert.equal(v, 'B2', 'every building spelling resolves to B2');
  // the game stores only desk/name/team/title (applyImport), then builds the floor
  const stored = imported.map(r => ({ desk: r.desk || '', name: r.name, team: r.team || '', title: r.title || '' }));
  const m = LAYOUT.build(D.floors[key], stored, D.campus.teams);
  assert.equal(m.unplaced.length, 0);
  assert.equal(m.people.length, roster.length);
  const want = new Map(roster.map(p => [p.name, p.desk]));
  for (const p of m.people) {
    assert.equal(m.desks[p.desk].id, want.get(p.name), `${p.name} on ${m.desks[p.desk].id}, wanted ${want.get(p.name)}`);
    assert.equal(p.auto, false);
  }
  // the people are exactly where the demo roster put them, so geometry and seating match the demo model
  assert.deepEqual(m.desks.map(d => [d.id, d.person >= 0 ? m.people[d.person].name : '']), m0.desks.map(d => [d.id, d.person >= 0 ? m0.people[d.person].name : '']));
  // re-importing the same people is a no-op for IMPORT.diff
  const df = IMPORT.diff(D.rosters, Object.assign({}, D.rosters, { [key]: stored }));
  assert.deepEqual([df.added.length, df.removed.length, df.moved.length], [0, 0, 0], 'diff of an identical re-import');
});

for (const deg of [0, 30]) test(`facilities X/Y (feet, y up, drawing turned ${deg} deg) -> EDITOR.facilityPlace with IMPORT.similarity -> desks where they were`, () => {
  const key = 'B1-3', m0 = MODELS[key], T = EDITOR._t, th = deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  const sample = m0.desks.filter((d, i) => i % 9 === 0 && d.person >= 0).slice(0, 40);
  // CAD drawing: feet, y up (north), offset origin, turned th counter-clockwise; Rotation = CCW degrees of the sitter's facing from drawing north
  const toRaw = d => { const x = d.x + 200, y = -d.z + 120; return [(x * c - y * s) / 0.3048, (x * s + y * c) / 0.3048]; };
  const rows = [['Bldg', 'Level', 'Space ID', 'Employee Name', 'Department', 'Job Title', 'X Coord', 'Y Coord', 'Rotation']];
  for (const d of sample) { const p = m0.people[d.person], r = toRaw(d); rows.push(['B1', '3', d.id, p.name, p.team, p.title, r[0].toFixed(4), r[1].toFixed(4), String(Math.round(d.a * 180 / Math.PI) + deg)]); }
  const parsed = IMPORT.parseCSV(IMPORT.toCSV(rows)), mapped = IMPORT.mapColumns(parsed.header);
  assert.deepEqual(['building', 'floor', 'desk', 'name', 'team', 'title', 'x', 'y', 'rot'].map(f => mapped.map[f]), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const n = IMPORT.normalize(parsed, mapped.map, D.campus), list = n.floors[key];
  assert.equal(list.length, sample.length);
  const fr = T.facilityRows(list);
  assert.equal(fr.rows.length, sample.length);
  const pair = T.farthestPair(fr.rows), A = fr.rows[pair[0]], Bq = fr.rows[pair[1]];
  const at = id => m0.desks.find(d => d.id === id);
  const placed = T.facilityPlace(fr.rows, pair[0], pair[1], [at(A.desk).x, at(A.desk).z], [at(Bq.desk).x, at(Bq.desk).z], IMPORT.similarity);
  assert.ok(placed && Math.abs(placed.s - 0.3048) < 1e-6, 'scale = feet');
  for (const p of placed.desks) {
    const d = at(p.id);
    assert.ok(Math.hypot(p.x - d.x, p.z - d.z) < 0.01, `${p.id} placed at ${p.x},${p.z}, was ${d.x},${d.z}`);
    assert.ok(Math.abs(Math.atan2(Math.sin(p.a - d.a), Math.cos(p.a - d.a))) < 1e-9, `${p.id} faces ${p.a}, was ${d.a}`);
  }
  // explicit desks keep their facilities ids, so the same people land on them in a layout of just those desks
  const spec = Object.assign({}, D.floors[key], { zones: [], desks: placed.desks.map(d => ({ id: d.id, x: d.x, z: d.z, a: d.a, team: 'Firmware & Software' })) });
  const m = LAYOUT.build(spec, list.map(r => ({ desk: r.desk, name: r.name, team: r.team, title: r.title })), D.campus.teams);
  assert.equal(m.unplaced.length, 0);
  for (const p of m.people) assert.equal(p.auto, false, p.name + ' on an explicit desk');
});

/* ================= 6. EDITOR pure logic with real floors ================= */
test('EDITOR loads without a DOM and open() is inert there', () => {
  assert.equal(typeof document, 'undefined');
  assert.ok(EDITOR._t && typeof EDITOR._t.normalize === 'function');
  const h = EDITOR.open({ key: 'B1-1', spec: D.floors['B1-1'] });
  assert.equal(typeof h.close, 'function');
  assert.equal(EDITOR.isOpen(), false);
});

test('EDITOR: saving an untouched demo floor changes nothing in the built floor', () => {
  const T = EDITOR._t;
  const parts = m => ({ desks: m.desks.map(d => [d.id, d.x, d.z, d.a, d.arr, d.person].join(' ')), walls: m.walls.map(w => [w.x1, w.z1, w.x2, w.z2, w.kind].join(' ')),
    rooms: m.rooms.map(r => [r.id, r.type, r.door, r.solid].join(' ')), ramps: m.ramps.map(r => JSON.stringify(r)), dests: m.dests.map(d => [d.id, d.x, d.z].join(' ')) });
  for (const k of KEYS) {
    const s2 = T.finalize(D.floors[k], { key: k });
    const a = parts(LAYOUT.build(s2, D.rosters[k], D.campus.teams)), b = parts(MODELS[k]);
    for (const f of Object.keys(b)) {
      const i = b[f].findIndex((v, j) => v !== a[f][j]);
      assert.ok(i < 0 && a[f].length === b[f].length, `${k}: editor round trip changed ${f} (${a[f].length} vs ${b[f].length}; first diff #${i}: "${a[f][i]}" vs "${b[f][i]}")`);
    }
    assert.deepEqual(T.finalize(s2, { key: k }), s2, k + ': finalize is idempotent');
    s2.zones.forEach((z, i) => assert.equal(z.dir, D.floors[k].zones[i].dir || (z.w >= z.d ? 'h' : 'v'), `${k} ${z.id}: dir kept`));
  }
});

test('EDITOR: a save keeps loosely written fields LAYOUT already understands (door "South", arr "Lab", dir "V")', () => {
  const T = EDITOR._t;
  const spec = { v: 1, key: 'B1-1', b: 'B1', f: 1, w: 40, d: 30, door: { side: ' South ', at: 2, w: 3 }, walls: [], glass: [],
    rooms: [{ id: 'k', type: 'kitchen', name: 'Kitchen', x: -12, z: -9, w: 10, d: 8, door: 'S' }, { id: 'e1', type: 'elevator', x: 0, z: -12, w: 2.6, d: 4, door: 'south' }],
    zones: [{ id: 'z1', team: 'Validation', arr: 'Lab', x: 10, z: -3, w: 14, d: 18, dir: 'V' }, { id: 'z2', team: 'Finance', arr: ' OFFICES ', x: -11, z: 6, w: 14, d: 12 }],
    desks: [{ id: 'X1', x: 2, z: 8, a: 3.1, arr: 'Cubes', team: 'Quality' }], ramps: null };
  const sig = m => JSON.stringify([m.exit, m.desks.map(d => [d.id, d.x, d.z, d.a, d.arr]), m.walls.length, m.rooms.map(r => r.door), m.elevators]);
  const a = LAYOUT.build(spec, [], D.campus.teams), b = LAYOUT.build(T.finalize(spec, { key: 'B1-1' }), [], D.campus.teams);
  assert.ok(a.exit && a.desks.some(d => d.arr === 'lab') && a.desks.some(d => d.arr === 'offices'), 'LAYOUT reads the loose fields');
  assert.equal(sig(b), sig(a), 'editor save changed the built floor');
});

const LAYOUT_ROOM_TYPES = ['conf', 'office', 'phone', 'kitchen', 'lab', 'restroom', 'stairs', 'elevator', 'lobby', 'server', 'storage', 'mail', 'wellness', 'open'];
test('bad data across modules: prototype-ish words never throw or resolve to inherited members', () => {
  const T = EDITOR._t;
  for (const w of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const spec = { key: 'B9-1', b: 'B9', f: 1, w: 30, d: 20, door: { side: w }, rooms: [{ id: w, type: w, x: 0, z: 0, w: 4, d: 4, door: w }],
      zones: [{ id: w, team: w, arr: w, x: 8, z: 0, w: 8, d: 8, dir: w }], desks: [{ id: w, x: -10, z: 5, a: 0, arr: w, team: w }] };
    let m;
    assert.doesNotThrow(() => { m = LAYOUT.build(spec, [[w, w, w, w]], { [w]: { arr: w, color: w } }); }, 'LAYOUT ' + w);
    assert.ok(m.rooms.every(r => r.door === null || 'nsew'.includes(r.door)), 'room door is a side or null for ' + w);
    assert.equal(m.exit, null, 'no exterior door from side ' + w);
    const e = T.normalize(spec, { key: 'B9-1' }).spec;
    assert.ok(e.rooms.every(r => typeof r.type === 'string' && LAYOUT_ROOM_TYPES.includes(r.type)), 'EDITOR room type for ' + w);
    assert.doesNotThrow(() => CAMPUS.exterior({ buildings: [{ id: w, x: 0, z: 0, w: 40, d: 30 }] }, { [w + '-1']: spec }));
    assert.doesNotThrow(() => IMPORT.normalize(IMPORT.parseCSV(`Building,Floor,Desk,Name,Team\n${w},${w},${w},${w},${w}\nB1,1,1-A01,Real Person,${w}`), null, D.campus, { [w]: w }));
  }
});

test('floor keys parse the same in CAMPUS, NAV and EDITOR', () => {
  // NAV and EDITOR split at the last "-<digits>"; CAMPUS.key builds the key the game stores floors under
  for (const [b, f] of [['B1', 3], ['B2', 12], ['SJ-1', 2], ['Bldg_7', 1]]) {
    const k = CAMPUS.key(b, f), p = CAMPUS.parseKey(k);
    assert.deepEqual(p, { b, f }, 'CAMPUS round trip ' + k);
    const s = EDITOR._t.normalize({ key: k }).spec;
    assert.deepEqual([s.b, s.f], [b, f], 'EDITOR ' + k);
  }
});

test('EDITOR: demo floors validate clean; zone desk counts agree with LAYOUT', () => {
  const T = EDITOR._t;
  for (const k of KEYS) {
    const spec = D.floors[k], m = MODELS[k], v = T.validate(spec, { floors: 4, model: m });
    assert.deepEqual(v.errors, [], k + ' errors');
    assert.deepEqual(v.warnings, [], k + ' warnings');
    const cap = LAYOUT.capacity(spec, D.campus.teams);
    spec.zones.forEach((z, zi) => {
      const c = T.zoneCounts(m, spec, zi, D.rosters[k]);
      assert.equal(c.desks, m.desks.filter(d => d.zone === z.id).length, `${k} ${z.id} desks`);
      assert.equal(c.desks, cap.byZone[z.id], `${k} ${z.id} capacity`);
    });
    // a desk id the editor suggests never collides with an id LAYOUT generated
    const id = T.suggestDeskId(spec, D.rosters[k].map(r => r.desk), m.desks.map(d => d.id));
    assert.ok(!m.desks.some(d => d.id.toLowerCase() === id.toLowerCase()), k + ': suggested id ' + id + ' already used');
  }
});

/* ================= 8. contract shapes (SPEC §4/§5) ================= */
const ITEM_T = new Set('panel table rtable bench shelf rack scope chamber probe cabinet plant counter coffee fridge screen sofa reception printer whiteboard elevdoor booth locker'.split(' '));
const ROOM_T = new Set('conf office phone kitchen lab restroom stairs elevator lobby server storage mail wellness open'.split(' '));
test('FloorModel shapes follow SPEC §4 (fields, yaw, masks, vocab)', () => {
  for (const k of KEYS) {
    const m = MODELS[k], at = s => k + ': ' + s;
    for (const f of ['key', 'b', 'f', 'w', 'd', 'walls', 'rooms', 'areas', 'desks', 'people', 'unplaced', 'chairs', 'items', 'blocks', 'posts', 'elevators', 'stairs', 'exit', 'spawn', 'kitchen', 'coffee', 'ramps', 'signs', 'dests', 'teams', 'stats'])
      assert.ok(f in m, at('missing ' + f));
    for (const w of m.walls) assert.ok([w.x1, w.z1, w.x2, w.z2, w.t, w.h].every(fin) && ['ext', 'int', 'glass', 'part'].includes(w.kind), at('wall'));
    for (const r of m.rooms) assert.ok(ROOM_T.has(r.type) && [r.x, r.z, r.w, r.d].every(fin) && (r.door === null || 'nsew'.includes(r.door)) && typeof r.solid === 'boolean', at('room ' + r.id));
    for (const a of m.areas) assert.ok(['carpet', 'esd', 'tile', 'lobby', 'wood'].includes(a.kind) && [a.x, a.z, a.w, a.d].every(fin), at('area'));
    m.desks.forEach((d, i) => {
      assert.ok(typeof d.id === 'string' && d.id && [d.x, d.z, d.w, d.dd].every(fin) && isQuarter(d.a), at('desk ' + d.id));
      assert.ok(LAYOUT.ARR.includes(d.arr) && typeof d.mon === 'boolean', at('desk arr/mon ' + d.id));
      if (d.person >= 0) assert.equal(m.people[d.person].desk, i, at('desk.person <-> people.desk'));
      if (d.chair >= 0) assert.equal(m.chairs[d.chair].desk, i, at('desk.chair <-> chairs.desk'));
    });
    for (const c of m.chairs) assert.ok([c.x, c.z, c.a].every(fin) && ['task', 'stool', 'conf', 'guest'].includes(c.kind), at('chair'));
    for (const it of m.items) assert.ok(ITEM_T.has(it.t) && [it.x, it.z, it.a, it.w, it.d, it.h].every(fin), at('item ' + it.t));
    for (const b of m.blocks) assert.ok(b.x1 > b.x0 && b.z1 > b.z0 && Number.isInteger(b.m) && b.m >= 1 && b.m <= 7 && (b.tall === 0 || b.tall === 1), at('block'));
    for (const p of m.posts) assert.ok([p.x, p.z].every(fin) && p.r > 0 && Number.isInteger(p.m) && p.m >= 1 && p.m <= 7 && (p.tall === 0 || p.tall === 1), at('post'));
    // facing: elevators face out of their doors (toward the pad); exit faces outward; floor-1 spawn faces in
    for (const e of m.elevators) assert.ok(facing(e.a, e.pad.x - e.x, e.pad.z - e.z) > 0.999, at('elevator a faces its pad'));
    if (m.exit) {
      const ex = m.exit, f = fwd(ex.a), out = Math.max(Math.abs(ex.x + f[0] * 3) - m.w / 2, Math.abs(ex.z + f[1] * 3) - m.d / 2);
      assert.ok(out > 0, at('exit a faces out of the building'));
      assert.ok(facing(m.spawn.a, ex.x - m.spawn.x, ex.z - m.spawn.z) < -0.999, at('spawn faces in, away from the exit'));
    } else assert.ok(m.elevators.some(e => dist(e.pad, m.spawn) < 0.5 && e.a === m.spawn.a), at('upper-floor spawn on an elevator pad facing out'));
    const ids = new Set();
    for (const d of m.dests) {
      assert.ok(!ids.has(d.id), at('duplicate dest ' + d.id)); ids.add(d.id);
      assert.ok(['desk', 'room', 'amenity'].includes(d.kind) && typeof d.name === 'string' && typeof d.sub === 'string' && [d.x, d.z, d.a].every(fin), at('dest ' + d.id));
      if (d.kind === 'desk') { const k2 = m.desks.find(x => 'desk:' + x.id === d.id); assert.ok(facing(d.a, k2.x - d.x, k2.z - d.z) > 0.999, at(d.id + ' faces its desk')); }
    }
    assert.ok(ids.has('kitchen') && m.elevators.every(e => ids.has('elev:' + e.id)) && ids.has('exit') === !!m.exit, at('amenity dests'));
    for (const s of m.signs) assert.ok(Array.isArray(s.lines) && s.lines.length >= 1 && [s.x, s.y, s.z, s.h].every(fin) && (s.stripe === null || /^#[0-9A-F]{6}$/i.test(s.stripe)), at('sign'));
    for (const r of m.ramps) assert.ok(['kick', 'hump'].includes(r.k) && ['x', 'z'].includes(r.ax) && (r.dir === 1 || r.dir === -1) && [r.x, r.z, r.len, r.w, r.h].every(fin), at('ramp'));
    assert.equal(m.teams.reduce((s, t) => s + t.count, 0), m.people.length, at('team counts'));
    assert.deepEqual(m.stats, { desks: m.desks.length, occupied: m.people.length, open: m.desks.length - m.people.length, unplaced: 0 }, at('stats'));
    // teams map colors flow through to the model
    for (const t of m.teams) if (D.campus.teams[t.team]) assert.equal(t.color.toUpperCase(), D.campus.teams[t.team].color.toUpperCase(), at('team color ' + t.team));
  }
});

test('CampusModel shapes follow SPEC §5', () => {
  const C = EXT, CT = new Set('tree lamp car bench bollard planter bikerack flag sign'.split(' '));
  assert.equal(C.key, 'campus');
  for (const b of C.buildings) {
    const src = D.campus.buildings.find(x => x.id === b.id);
    assert.deepEqual([b.x, b.z, b.w, b.d, b.floors], [src.x, src.z, src.w, src.d, src.floors]);
    assert.equal(b.door.r, 1.2);
    // the footprint is solid except the doorway
    const c = cellOf(gridOf('campus'), b.x, b.z);
    assert.equal(gridOf('campus').block[c], 1, b.id + ' footprint is blocked');
  }
  for (const a of C.areas) assert.ok(['road', 'parking', 'grass', 'plaza', 'walk'].includes(a.kind), 'area ' + a.kind);
  for (const it of C.items) assert.ok(CT.has(it.t) && [it.x, it.z, it.a].every(fin), 'item ' + it.t);
  for (const b of C.blocks) assert.ok(b.x1 > b.x0 && b.z1 > b.z0 && b.m >= 1 && b.m <= 7);
  const ids = C.dests.map(d => d.id);
  assert.equal(new Set(ids).size, ids.length, 'dest ids unique');
  for (const b of C.buildings) {
    const d = C.dests.find(x => x.id === 'bldg:' + b.id);
    assert.ok(d && facing(d.a, b.x - d.x, b.z - d.z) > 0, b.id + ' dest faces the building');
  }
});

test('deterministic end to end: demo, floors, exterior and plans repeat exactly', () => {
  const D2 = CAMPUS.demo(LAYOUT);
  assert.equal(JSON.stringify(D2), JSON.stringify(D), 'demo');
  for (const k of ['B1-1', 'B2-3']) assert.equal(JSON.stringify(LAYOUT.build(D2.floors[k], D2.rosters[k], D2.campus.teams)), JSON.stringify(MODELS[k]), k);
  assert.equal(JSON.stringify(CAMPUS.exterior(D2.campus, D2.floors)), JSON.stringify(EXT), 'exterior');
  for (const x of RANDOM.slice(0, 10)) assert.equal(JSON.stringify(NAV.plan(WORLD, x.a, x.b)), JSON.stringify(x.r), 'plan ' + x.a.id + ' -> ' + x.b.id);
});

/* ================= 7. timing ================= */
test('timing: demo + 8 floors + exterior + 9 grids + 50 plans < 1.5 s (cold, one thread)', () => {
  const total = T4 - T0;
  info(`demo+build ${(T1 - T0).toFixed(0)} ms, exterior ${(T2 - T1).toFixed(0)} ms, grids ${(T3 - T2).toFixed(0)} ms, 50 plans ${(T4 - T3).toFixed(0)} ms = ${total.toFixed(0)} ms`);
  assert.ok(total < 1500, `pipeline took ${total.toFixed(0)} ms`);
});

/* ================= ASCII render of all 8 floors for eyeballing ================= */
if (ascii) {
  const out = ['RC Campus v4 demo floors at 0.5 m per character, north up. Legend (tests/ascii.js):',
    "  '#' walls/partitions  'g' glass  'd' desk  'c' chair  'i' item  '^' ramp  'E' elevator pad  'X' exit pad  '*' dest  'S' spawn  '.' zone/room floor", ''];
  for (const k of KEYS) {
    const m = MODELS[k];
    out.push(`=== ${k}  ${m.w} x ${m.d} m  desks ${m.stats.desks}  people ${m.stats.occupied}  open ${m.stats.open}  unplaced ${m.stats.unplaced}  rooms ${m.rooms.length}  ramps ${m.ramps.length}`);
    out.push('    teams: ' + m.teams.map(t => `${t.team} ${t.count}`).join(', '));
    if (m.problems.length) out.push('    problems: ' + m.problems.join(' | '));
    out.push(ascii(m), '');
  }
  fs.writeFileSync(path.join(__dirname, 'ascii-all.txt'), out.join('\n'));
  info('wrote tests/ascii-all.txt');
}

console.log(`\nintegration: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
