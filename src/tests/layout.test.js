// node v4/tests/layout.test.js   — LAYOUT.build / capacity (single process, a few seconds)
const assert = require('node:assert');
const { performance } = require('node:perf_hooks');
const LAYOUT = require('./load')('layout.js', 'LAYOUT');
const FX = require('./layout.fixtures');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}

/* ---------- helpers (independent of layout.js internals) ---------- */
const deskRect = d => { const s = Math.abs(Math.sin(d.a)) > 0.5, ex = (s ? d.dd : d.w) / 2, ez = (s ? d.w : d.dd) / 2; return { x0: d.x - ex, x1: d.x + ex, z0: d.z - ez, z1: d.z + ez }; };
const shrink = (r, g) => ({ x0: r.x0 + g, x1: r.x1 - g, z0: r.z0 + g, z1: r.z1 - g });
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const roomRect = r => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 });
const distRect = (b, x, z) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));

// BFS over a 0.25 m walker grid: blocks/posts with m&4 or m&1, inflated 0.3 m; 8-connected without corner cutting
function walkerGrid(m) {
  const C = 0.25, nx = Math.ceil(m.w / C), nz = Math.ceil(m.d / C), bad = new Uint8Array(nx * nz);
  const cx = i => -m.w / 2 + (i + 0.5) * C, cz = j => -m.d / 2 + (j + 0.5) * C;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = cx(i), z = cz(j);
    if (Math.abs(x) > m.w / 2 - 0.3 || Math.abs(z) > m.d / 2 - 0.3) bad[j * nx + i] = 1;
  }
  for (const b of m.blocks) if (b.m & 5) {
    for (let j = 0; j < nz; j++) { const z = cz(j); if (z < b.z0 - 0.3 || z > b.z1 + 0.3) continue;
      for (let i = 0; i < nx; i++) { const x = cx(i); if (x >= b.x0 - 0.3 && x <= b.x1 + 0.3) bad[j * nx + i] = 1; } }
  }
  for (const p of m.posts) if (p.m & 5) {
    const r = p.r + 0.3;
    for (let j = Math.max(0, Math.floor((p.z - r + m.d / 2) / C)); j < nz && cz(j) <= p.z + r; j++)
      for (let i = Math.max(0, Math.floor((p.x - r + m.w / 2) / C)); i < nx && cx(i) <= p.x + r; i++)
        if (Math.hypot(cx(i) - p.x, cz(j) - p.z) <= r) bad[j * nx + i] = 1;
  }
  const cell = (x, z) => { const i = Math.floor((x + m.w / 2) / C), j = Math.floor((z + m.d / 2) / C); return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : j * nx + i; };
  const seen = new Uint8Array(nx * nz), start = cell(m.spawn.x, m.spawn.z);
  if (start >= 0 && !bad[start]) {
    const st = [start]; seen[start] = 1;
    while (st.length) {
      const c = st.pop(), i = c % nx, j = (c - i) / nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const I = i + di, J = j + dj; if (I < 0 || J < 0 || I >= nx || J >= nz) continue;
        const k = J * nx + I; if (seen[k] || bad[k]) continue;
        if (di && dj && (bad[j * nx + I] || bad[J * nx + i])) continue;
        seen[k] = 1; st.push(k);
      }
    }
  }
  return { reach: (x, z) => { const c = cell(x, z); return c >= 0 && seen[c] === 1; }, startOk: start >= 0 && !bad[start] };
}
function rampRect(r) {
  const a = -r.len / 2, b = r.len / 2 + (r.k === 'kick' ? 0.28 : 0), p = r.dir > 0 ? [a, b] : [-b, -a];
  return r.ax === 'x' ? { x0: r.x + p[0], x1: r.x + p[1], z0: r.z - r.w / 2, z1: r.z + r.w / 2 } : { x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z + p[0], z1: r.z + p[1] };
}
// a plate with one 30 x 16 zone of the given arrangement
function zoneFloor(arr, dir) {
  const v = dir === 'v';
  return { v: 1, key: 'T-1', b: 'T', f: 1, w: v ? 24 : 40, d: v ? 40 : 24, door: null, walls: [], glass: [], rooms: [], ramps: [],
    zones: [{ id: 'zz', team: 'Team ' + arr, arr, x: 0, z: 0, w: v ? 16 : 30, d: v ? 30 : 16, dir: dir || null }], desks: [] };
}
function bigRoster(n, teams) { const out = []; for (let i = 0; i < n; i++) out.push(['', 'Person ' + i, teams[i % teams.length], 'Engineer']); return out; }
const builds = {};
for (const k of Object.keys(FX.floors)) builds[k] = LAYOUT.build(FX.floors[k], FX.roster(k), FX.teams);
const ARRS = ['bench', 'cubes', 'offices', 'lab', 'hot'];
const EXPECT = { bench: [48, 90], cubes: [24, 40], offices: [12, 20], lab: [24, 60], hot: [60, 96] };
const arrBuilds = {};
for (const a of ARRS) for (const d of ['h', 'v']) arrBuilds[a + d] = LAYOUT.build(zoneFloor(a, d), [], {});
const all = () => [...Object.entries(builds), ...Object.entries(arrBuilds)];

/* ---------- tests ---------- */
test('exports ARR, build, capacity', () => {
  assert.deepStrictEqual(LAYOUT.ARR, ['bench', 'cubes', 'offices', 'lab', 'hot']);
  assert.strictEqual(typeof LAYOUT.build, 'function'); assert.strictEqual(typeof LAYOUT.capacity, 'function');
});

test('deterministic: two builds deep-equal, JSON-clean (no NaN/undefined/-0)', () => {
  for (const k of Object.keys(FX.floors)) {
    const a = LAYOUT.build(FX.floors[k], FX.roster(k), FX.teams), b = LAYOUT.build(FX.floors[k], FX.roster(k), FX.teams);
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), a, k + ' is not JSON-clean');
  }
});

test('FloorModel has every SPEC field with the right types', () => {
  const m = builds['B1-1'];
  for (const f of ['key', 'b', 'f', 'w', 'd', 'walls', 'rooms', 'areas', 'desks', 'people', 'unplaced', 'chairs', 'items', 'blocks', 'posts', 'elevators', 'stairs', 'exit', 'spawn', 'kitchen', 'coffee', 'ramps', 'signs', 'dests', 'teams', 'stats'])
    assert.ok(f in m, 'missing ' + f);
  assert.strictEqual(m.key, 'B1-1'); assert.strictEqual(m.f, 1);
  for (const w of m.walls) assert.ok(['ext', 'int', 'glass', 'part'].includes(w.kind) && w.t > 0 && w.h > 0);
  assert.ok(m.walls.some(w => w.kind === 'part') && !builds['B1-3'].walls.some(w => w.kind === 'part'));
  for (const d of m.desks) { assert.ok(typeof d.id === 'string' && d.id); assert.ok(LAYOUT.ARR.includes(d.arr)); assert.ok(d.chair === -1 || m.chairs[d.chair].desk === m.desks.indexOf(d)); }
  for (const c of m.chairs) assert.ok(['task', 'stool', 'conf', 'guest'].includes(c.kind));
  for (const b of m.blocks) assert.ok(b.x1 > b.x0 && b.z1 > b.z0 && b.m >= 1 && b.m <= 7 && (b.tall === 0 || b.tall === 1));
  for (const a of m.areas) assert.ok(['carpet', 'esd', 'tile', 'lobby', 'wood'].includes(a.kind));
  assert.ok(m.kitchen && m.kitchen.pickup.r === 0.9);
  assert.deepStrictEqual(Object.keys(m.stats).sort(), ['desks', 'occupied', 'open', 'unplaced']);
  assert.strictEqual(m.stats.desks, m.desks.length); assert.strictEqual(m.stats.occupied, m.people.length);
  assert.strictEqual(m.stats.open, m.desks.length - m.people.length); assert.strictEqual(m.stats.unplaced, m.unplaced.length);
});

test('every arrangement fills a 30 x 16 zone with sane counts (both row directions)', () => {
  for (const a of ARRS) {
    const h = arrBuilds[a + 'h'], v = arrBuilds[a + 'v'];
    for (const m of [h, v]) {
      const n = m.desks.length;
      assert.ok(n >= EXPECT[a][0] && n <= EXPECT[a][1], `${a}: ${n} desks`);
      assert.ok(m.desks.every(d => d.arr === a && d.zone === 'zz' && d.team === 'Team ' + a), a + ' desk fields');
      assert.ok(m.desks.every(d => d.chair >= 0), a + ' every desk has a chair');
    }
    assert.strictEqual(h.desks.length, v.desks.length, a + ': h and v give the same count');
    assert.strictEqual(h.areas[0].kind, a === 'lab' ? 'esd' : 'carpet');
  }
  assert.ok(arrBuilds.cubesh.walls.filter(w => w.kind === 'part').every(w => w.h === 1.3 && w.t === 0.06));
  assert.ok(arrBuilds.cubesh.blocks.some(b => b.m === 7 && b.tall === 1 && (b.x1 - b.x0 < 0.07 || b.z1 - b.z0 < 0.07)), 'partitions collide');
  assert.ok(arrBuilds.officesh.walls.filter(w => w.kind === 'int').length > 20, 'office walls');
  assert.ok(arrBuilds.officesh.chairs.filter(c => c.kind === 'guest').length === arrBuilds.officesh.desks.length, 'guest chairs');
  const lab = arrBuilds.labh;
  assert.ok(lab.items.some(i => i.t === 'rack' && /^#[0-9A-F]{6}$/i.test(i.c)) && lab.items.some(i => i.t === 'bench') && lab.items.some(i => i.t === 'shelf') && lab.items.some(i => i.t === 'scope'));
  assert.ok(lab.items.some(i => i.t === 'chamber' || i.t === 'probe'), 'test gear at row ends');
  assert.ok(lab.chairs.every(c => c.kind === 'stool') && lab.desks.every(d => !d.mon && d.w === 1.5 && d.dd === 0.9));
  assert.ok(arrBuilds.hoth.items.filter(i => i.t === 'rtable').length * 6 === arrBuilds.hoth.desks.length);
  assert.ok(arrBuilds.benchh.items.filter(i => i.t === 'panel').length * 6 === arrBuilds.benchh.desks.length && arrBuilds.benchh.desks.every(d => d.mon));
});

test('auto desk ids are <floor>-<zone letter><nn>, unique', () => {
  const ids = arrBuilds.benchh.desks.map(d => d.id);
  assert.strictEqual(ids[0], '1-A01'); assert.strictEqual(ids[11], '1-A12');
  for (const [k, m] of all()) { const s = new Set(m.desks.map(d => d.id.toLowerCase())); assert.strictEqual(s.size, m.desks.length, k + ' duplicate desk ids'); }
  for (const [k, m] of all()) { const s = new Set(m.dests.map(d => d.id)); assert.strictEqual(s.size, m.dests.length, k + ' duplicate dest ids'); }
});

test('nothing overlaps: desks vs walls, rooms, other desks; aisles >= 1.4 m between groups', () => {
  for (const [k, m] of all()) {
    const rects = m.desks.map(d => shrink(deskRect(d), 0.005));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlap(rects[i], rects[j]), `${k}: desks ${m.desks[i].id} and ${m.desks[j].id} overlap`);
    for (const w of m.walls) {
      const L = Math.hypot(w.x2 - w.x1, w.z2 - w.z1), n = Math.ceil(L / 0.05);
      for (let s = 0; s <= n; s++) { const x = w.x1 + (w.x2 - w.x1) * s / n, z = w.z1 + (w.z2 - w.z1) * s / n;
        for (let i = 0; i < rects.length; i++) assert.ok(!inRect(shrink(rects[i], -w.t / 2 + 0.01), x, z), `${k}: wall (${w.kind}) crosses desk ${m.desks[i].id}`); }
    }
    for (const r of m.rooms) {
      if (r.type === 'lab' || r.type === 'open') continue;
      const rr = roomRect(r);
      m.desks.forEach((d, i) => { if (d.id === r.id) assert.ok(inRect(rr, d.x, d.z), 'office desk inside its room'); else assert.ok(!overlap(rects[i], rr), `${k}: desk ${d.id} inside room ${r.id}`); });
    }
    // aisles: desks of different zones (or a zone and an explicit desk) are >= 1.4 m apart; zone desks keep 1.4 m from rooms
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = m.desks[i], b = m.desks[j]; if (a.zone === b.zone) continue;
      if (a.zone === null && b.zone === null) continue;   // two explicit desks: facilities data decides
      assert.ok(!overlap(shrink(rects[i], -1.4 + 0.01), rects[j]), `${k}: desks ${a.id} / ${b.id} closer than a 1.4 m aisle`);
    }
    for (const r of m.rooms) if (r.type !== 'lab' && r.type !== 'open') m.desks.forEach((d, i) => { if (d.zone !== null) assert.ok(!overlap(shrink(rects[i], -1.4 + 0.01), roomRect(r)), `${k}: zone desk ${d.id} within 1.4 m of room ${r.id}`); });
  }
});

test('chairs are not inside chair-blocking (m&2) blocks', () => {
  for (const [k, m] of all()) for (const c of m.chairs) for (const b of m.blocks) if (b.m & 2)
    assert.ok(distRect(b, c.x, c.z) >= 0.2, `${k}: chair at ${c.x},${c.z} (${c.kind}) inside block ${JSON.stringify(b)}`);
});

test('dests, elevator pads, exit and spawn are free and reachable from spawn (independent BFS)', () => {
  for (const [k, m] of all()) {
    const g = walkerGrid(m);
    assert.ok(g.startOk, k + ': spawn cell blocked');
    for (const d of m.dests) {
      assert.ok(g.reach(d.x, d.z), `${k}: dest ${d.id} unreachable at ${d.x},${d.z}`);
      for (const b of m.blocks) if (b.m & 4) assert.ok(distRect(b, d.x, d.z) >= 0.35 - 1e-6, `${k}: dest ${d.id} too close to a block`);
      assert.ok(typeof d.name === 'string' && d.name && typeof d.sub === 'string' && Number.isFinite(d.a));
    }
    for (const e of m.elevators) assert.ok(g.reach(e.pad.x, e.pad.z), `${k}: elevator pad ${e.id} unreachable`);
    if (m.exit) assert.ok(g.reach(m.exit.x, m.exit.z), k + ': exit unreachable');
    if (m.kitchen) assert.ok(g.reach(m.kitchen.pickup.x, m.kitchen.pickup.z), k + ': coffee pickup unreachable');
    assert.deepStrictEqual(m.problems.filter(p => /reachable|free spot/.test(p)), [], k);
  }
});

test('dest shapes: desk dests carry the person / Open desk and "Desk id · team"', () => {
  const m = builds['B1-1'];
  const dd = m.dests.filter(d => d.kind === 'desk');
  assert.strictEqual(dd.length, m.desks.length);
  m.desks.forEach(d => {
    const t = m.dests.find(x => x.id === 'desk:' + d.id);
    assert.strictEqual(t.name, d.person >= 0 ? m.people[d.person].name : 'Open desk');
    assert.strictEqual(t.sub, 'Desk ' + d.id + (d.team ? ' · ' + d.team : ''));
    const fx = -Math.sin(t.a), fz = -Math.cos(t.a), vx = d.x - t.x, vz = d.z - t.z;   // facing toward the desk
    assert.ok(fx * vx + fz * vz > 0.5 * Math.hypot(vx, vz));
  });
  for (const id of ['kitchen', 'exit', 'elev:e1', 'elev:e2', 'room:c1', 'room:lob']) assert.ok(m.dests.some(d => d.id === id), 'missing dest ' + id);
  assert.match(m.dests.find(d => d.id === 'room:c1').sub, /^Conference · 10 seats$/);
});

test('people: exact desk-id match (case/space-insensitive), team fill, open zones, one person per desk', () => {
  const m = builds['B1-1'];
  const ex = m.people.find(p => p.name === 'Exact Match');
  assert.ok(ex && !ex.auto && m.desks[ex.desk].id === '1-A05');
  const m3 = builds['B1-3'];
  const fd = m3.people.find(p => p.name === 'Facility Desk'), oh = m3.people.find(p => p.name === 'Office Holder');
  assert.ok(fd && !fd.auto && m3.desks[fd.desk].id === '3-210');
  assert.ok(oh && !oh.auto && m3.desks[oh.desk].id === '3-101');
  for (const [k, mm] of all()) {
    const seen = new Set();
    mm.people.forEach((p, i) => { assert.ok(!seen.has(p.desk), k + ' two people on one desk'); seen.add(p.desk); assert.strictEqual(mm.desks[p.desk].person, i); });
    assert.strictEqual(mm.desks.filter(d => d.person >= 0).length, mm.people.length);
  }
  // team people land in their own zones first
  m.people.filter(p => p.auto).forEach(p => { const d = m.desks[p.desk]; const z = FX.floors['B1-1'].zones.find(z => z.id === d.zone); assert.ok(z && (z.team === p.team || !z.team)); });
  // Design Verification has no desks of its own on B1-3 (its zone yields to an overlapping one): they go to the team-less zone
  m3.people.filter(p => p.team === 'Design Verification').forEach(p => assert.strictEqual(m3.desks[p.desk].zone, 'z4'));
  // a second claim on a taken desk id goes through the auto steps
  const spec = zoneFloor('bench'), r = [['1-A01', 'First', 'Team bench', ''], ['1-a01', 'Second', 'Team bench', '']];
  const mm = LAYOUT.build(spec, r, {});
  assert.ok(!mm.people[0].auto && mm.desks[mm.people[0].desk].id === '1-A01');
  assert.ok(mm.people[1].auto && mm.desks[mm.people[1].desk].id !== '1-A01');
});

test('overflow -> unplaced (2000 people on a small floor), 0 people', () => {
  const spec = zoneFloor('bench'), r = bigRoster(2000, ['Team bench', 'Nobody Team']);
  const t0 = performance.now(), m = LAYOUT.build(spec, r, {}), ms = performance.now() - t0;
  assert.strictEqual(m.people.length, m.desks.length);
  assert.strictEqual(m.unplaced.length, 2000 - m.desks.length);
  assert.ok(m.unplaced.every(u => 'name' in u && 'team' in u && 'title' in u && 'desk' in u));
  assert.ok(m.people.every(p => p.team === 'Team bench'), 'team-less zones only: other teams stay unplaced');
  assert.ok(ms < 200, 'build with 2000 people took ' + ms.toFixed(1) + ' ms');
  const e = LAYOUT.build(spec, [], {});
  assert.strictEqual(e.people.length, 0); assert.deepStrictEqual(e.coffee, []); assert.ok(e.dests.every(d => d.kind !== 'desk' || d.name === 'Open desk'));
});

test('explicit desks: ids verbatim, yaw snapped, arrangement from desk/team, duplicates renamed', () => {
  const m = builds['B1-3'];
  const get = id => m.desks.find(d => d.id === id);
  for (const id of ['3-210', '3-211', '3-212', '3-213', '3-214', '3-214~2']) assert.ok(get(id), 'missing ' + id);
  assert.ok(m.problems.some(p => p.includes('3-214')));
  assert.strictEqual(get('3-210').arr, 'offices');            // team Finance -> offices
  assert.strictEqual(get('3-214~2').arr, 'bench');
  assert.strictEqual(get('3-213').arr, 'lab'); assert.ok(m.items.some(i => i.t === 'bench' && i.x === get('3-213').x));
  for (const d of m.desks) assert.ok(Math.abs(Math.round(d.a / (Math.PI / 2)) * Math.PI / 2 - d.a) < 1e-9, 'yaw not snapped');
  assert.ok(Math.abs(get('3-211').a - Math.PI) < 1e-9 && Math.abs(get('3-212').a - Math.PI / 2) < 1e-9 && Math.abs(get('3-213').a + Math.PI / 2) < 1e-9);
  // explicit office desks get a guest chair but no walls around them
  const d = get('3-211');
  assert.ok(m.chairs.some(c => c.kind === 'guest' && Math.hypot(c.x - d.x, c.z - d.z) < 1.0));
  assert.ok(!m.walls.some(w => w.kind === 'int' && Math.hypot((w.x1 + w.x2) / 2 - d.x, (w.z1 + w.z2) / 2 - d.z) < 2.5));
  assert.ok(get('3-210').zone === null);
});

test('office rooms: walls with a doorway, one desk with the room id, guest chair', () => {
  const m = builds['B1-3'];
  for (const id of ['3-101', '3-102', '3-103']) {
    const r = m.rooms.find(x => x.id === id), d = m.desks.find(x => x.id === id);
    assert.ok(r && d && !r.solid && r.type === 'office');
    assert.ok(inRect(roomRect(r), d.x, d.z));
    assert.ok(m.chairs.some(c => c.kind === 'guest' && inRect(roomRect(r), c.x, c.z)));
    // door side: the wall on that side is split (two pieces leaving a ~1 m gap)
    const zs = r.z + r.d / 2;
    const south = m.walls.filter(w => Math.abs(w.z1 - zs) < 1e-6 && Math.abs(w.z2 - zs) < 1e-6 && Math.min(w.x1, w.x2) >= r.x - r.w / 2 - 1e-6 && Math.max(w.x1, w.x2) <= r.x + r.w / 2 + 1e-6);
    const len = south.reduce((s, w) => s + Math.abs(w.x2 - w.x1), 0);
    assert.ok(south.length === 2 && Math.abs(r.w - len - 1.0) < 1e-6, id + ' doorway');
    assert.strictEqual(r.door, 's');      // 3-103 had door:null -> defaulted toward the plate center
  }
});

test('rooms: conf glass + chairs + screen, kitchen pickup, elevators, solid rooms, lobby', () => {
  const m = builds['B1-1'];
  const c1 = m.rooms.find(r => r.id === 'c1');
  assert.ok(m.walls.some(w => w.kind === 'glass' && inRect(roomRect(c1), w.x1, w.z1)));
  assert.strictEqual(m.chairs.filter(c => c.kind === 'conf' && inRect(roomRect(c1), c.x, c.z)).length, 10);
  assert.ok(m.items.some(i => i.t === 'screen' && inRect(roomRect(c1), i.x, i.z)) && m.items.some(i => i.t === 'rtable' && i.x === c1.x));
  assert.ok(m.signs.some(s => s.lines[0] === 'Silicon' && s.lines[1] === 'Conference · 10 seats'));
  const k = m.rooms.find(r => r.id === 'k1');
  assert.ok(inRect(roomRect(k), m.kitchen.pickup.x, m.kitchen.pickup.z));
  const cof = m.items.find(i => i.t === 'coffee'); assert.ok(Math.hypot(cof.x - m.kitchen.pickup.x, cof.z - m.kitchen.pickup.z) < 1.6);
  assert.ok(['counter', 'fridge', 'table'].every(t => m.items.some(i => i.t === t && inRect(roomRect(k), i.x, i.z))));
  assert.ok(m.areas.some(a => a.kind === 'tile') && m.areas.some(a => a.kind === 'lobby'));
  assert.strictEqual(m.elevators.length, 2);
  for (const e of m.elevators) {
    const r = m.rooms.find(x => x.id === e.id);
    assert.ok(r.solid && Math.abs(e.a - Math.PI) < 1e-9 && e.pad.r === 1.0);
    assert.ok(Math.abs(e.pad.z - (r.z + r.d / 2 + 1.3)) < 1e-6 && Math.abs(e.pad.x - r.x) < 1e-6);
    assert.ok(m.items.some(i => i.t === 'elevdoor' && Math.abs(i.x - r.x) < 1e-6));
  }
  assert.deepStrictEqual(m.stairs, [{ id: 'st1', x: 2.4, z: -3 }]);
  assert.ok(m.rooms.find(r => r.id === 'p1').solid && m.items.some(i => i.t === 'booth'));
  assert.ok(['reception', 'sofa', 'plant'].every(t => m.items.some(i => i.t === t)));
  const s3 = builds['B1-3'].rooms.find(r => r.id === 's3');
  assert.ok(s3.solid && builds['B1-3'].blocks.some(b => b.m === 7 && Math.abs(b.x0 - (s3.x - s3.w / 2)) < 1e-6 && Math.abs(b.z1 - (s3.z + s3.d / 2)) < 1e-6));
});

test('exterior: shell with doorway, exit pad facing out, spawn facing in; door-less floor spawns at an elevator', () => {
  const m = builds['B1-1'];
  const ext = m.walls.filter(w => w.kind === 'ext');
  assert.strictEqual(ext.length, 5);
  const south = ext.filter(w => w.z1 === 22 && w.z2 === 22);
  assert.strictEqual(south.length, 2);
  assert.deepStrictEqual(m.exit, { x: 0, z: 20.8, a: Math.PI, r: 1.2 });
  assert.deepStrictEqual(m.spawn, { x: 0, z: 19.4, a: 0 });
  const m3 = builds['B1-3'];
  assert.strictEqual(m3.exit, null); assert.strictEqual(m3.walls.filter(w => w.kind === 'ext').length, 4);
  assert.ok(Math.hypot(m3.spawn.x - m3.elevators[0].pad.x, m3.spawn.z - m3.elevators[0].pad.z) < 0.01 && m3.spawn.a === m3.elevators[0].a);
});

test('non-axis walls: drawn as one segment, collide as a chain of small boxes', () => {
  const m = builds['B1-3'];
  const w = m.walls.find(x => x.x1 === -12 && x.z1 === 21.85 && x.x2 === -6 && x.z2 === 14);
  assert.ok(w && w.kind === 'int');
  const L = Math.hypot(6, 7.85);
  const chain = m.blocks.filter(b => b.m === 7 && b.x0 >= -12.2 && b.x1 <= -5.8 && b.z0 >= 13.8 && b.z1 <= 22.1 && b.x1 - b.x0 < 0.5 && b.z1 - b.z0 < 0.5);
  assert.ok(chain.length >= Math.floor(L / 0.25), 'chain boxes: ' + chain.length);
  for (let s = 0; s <= 100; s++) { const x = -12 + 6 * s / 100, z = 21.85 - 7.85 * s / 100; assert.ok(chain.some(b => inRect(b, x, z)), 'gap in chain at ' + x + ',' + z); }
  const g = builds['B1-1'].walls.find(x => x.kind === 'glass' && x.x1 === -7 && x.z1 === 3);
  assert.ok(g, 'angled glass segment kept whole');
});

test('auto ramps: 3-6, open aisles only, never on dests, pads, spawn, exit, or near chairs', () => {
  for (const [k, m] of all()) {
    if (k.startsWith('bench') || k.startsWith('cubes') || k.startsWith('offices') || k.startsWith('lab') || k.startsWith('hot')) { assert.deepStrictEqual(m.ramps, []); continue; }  // spec.ramps = []
    assert.ok(m.ramps.length >= 3 && m.ramps.length <= 6, k + ': ' + m.ramps.length + ' ramps');
    assert.ok(m.ramps.some(r => r.k === 'hump') && m.ramps.some(r => r.k === 'kick'), k + ': mix of kinds');
    for (const r of m.ramps) {
      const rr = rampRect(r);
      if (r.k === 'hump') assert.deepStrictEqual([r.len, r.w, r.h], [1.5, 1.8, 0.14]); else assert.deepStrictEqual([r.len, r.w, r.h], [1.4, 1.3, 0.32]);
      for (const d of m.dests) assert.ok(distRect(rr, d.x, d.z) > 0.5, `${k}: ramp on dest ${d.id}`);
      for (const e of m.elevators) assert.ok(distRect(rr, e.pad.x, e.pad.z) > e.pad.r, `${k}: ramp on pad`);
      assert.ok(distRect(rr, m.spawn.x, m.spawn.z) > 2, k + ': ramp on spawn');
      if (m.exit) assert.ok(distRect(rr, m.exit.x, m.exit.z) > m.exit.r, k + ': ramp on exit');
      for (const c of m.chairs) assert.ok(distRect(rr, c.x, c.z) >= 1.0 + 0.27 - 0.2, `${k}: ramp near chair`);
      for (const b of m.blocks) assert.ok(!overlap(shrink(rr, -0.3), b), `${k}: ramp touches a block`);
      for (const p of m.posts) assert.ok(distRect(rr, p.x, p.z) > p.r + 0.3, `${k}: ramp touches a post`);
    }
  }
  const spec = Object.assign({}, FX.floors['B1-1'], { ramps: [{ k: 'kick', x: 1, z: 2, ax: 'z', dir: -1, len: 1.4, w: 1.3, h: 0.32 }] });
  assert.deepStrictEqual(LAYOUT.build(spec, [], FX.teams).ramps, [{ k: 'kick', x: 1, z: 2, ax: 'z', dir: -1, len: 1.4, w: 1.3, h: 0.32 }]);
});

test('coffee: 5 distinct occupied desks spread apart; teams, signs', () => {
  const m = builds['B1-1'];
  assert.strictEqual(m.coffee.length, 5); assert.strictEqual(new Set(m.coffee).size, 5);
  assert.ok(m.coffee.every(i => m.desks[i].person >= 0));
  let mn = 1e9; for (const a of m.coffee) for (const b of m.coffee) if (a !== b) mn = Math.min(mn, Math.hypot(m.desks[a].x - m.desks[b].x, m.desks[a].z - m.desks[b].z));
  assert.ok(mn > 10, 'coffee desks too close: ' + mn.toFixed(1));
  const t = m.teams.find(x => x.team === 'Design Verification');
  assert.ok(t && t.color === '#3E7CB1' && t.count === m.people.filter(p => p.team === 'Design Verification').length);
  const zs = m.signs.find(s => s.lines[0] === 'Design Verification');
  assert.ok(zs && zs.y === 3.4 && zs.stripe === '#3E7CB1' && /^Zone A · \d+ people$/.test(zs.lines[1]));
  assert.ok(m.signs.filter(s => s.y === 2.9).length >= m.rooms.length - 1);
  assert.ok(builds['B1-3'].teams.some(x => x.team === 'Marketing' && /^#[0-9A-F]{6}$/.test(x.color)), 'fallback team color');
});

test('capacity(): totals per zone without people', () => {
  const c = LAYOUT.capacity(FX.floors['B1-1'], FX.teams), m = builds['B1-1'];
  assert.strictEqual(c.total, m.desks.length);
  assert.deepStrictEqual(Object.keys(c.byZone), ['z1', 'z2', 'z3', 'z4']);
  for (const z of ['z1', 'z2', 'z3', 'z4']) assert.strictEqual(c.byZone[z], m.desks.filter(d => d.zone === z).length);
  assert.deepStrictEqual(LAYOUT.capacity(null, null), { total: 0, byZone: {} });
});

test('robust to messy input: never throws, clamps, reports', () => {
  const junk = [undefined, null, 5, 'x', [], {},
    { w: 'abc', d: -30, rooms: [null, { x: NaN }, { id: 'big', type: 'Meeting Room', x: 40, z: 0, w: 30, d: -8, door: 'North' }, { type: 'weird', x: 0, z: 0, w: 4, d: 4 }],
      zones: [{ w: -10, d: -8, x: 0, z: 8, team: 'X', arr: 'pods' }, { x: 0, z: 8, w: 12, d: 10, team: 'X', dir: 'diag' }, 'zone'],
      desks: [{ x: '5', z: 'oops' }, { id: 'ok', x: '3', z: '-4', a: 'NaN' }, { id: 'far', x: 900, z: 900 }], walls: [[0, 0, 0, 0], [1, 2], 'x', { x1: -20, z1: -50, x2: -20, z2: 50 }],
      glass: [[NaN, 1, 2, 3]], door: { side: 'q' }, ramps: [null, { x: 'a' }, { x: 2, z: 3, k: 'zoom', len: -2 }] },
  ];
  for (const s of junk) for (const r of [undefined, null, 'x', [null, 5, ['', ''], { name: 'Ok Person', team: 'X' }], [[1, 2, 3, 4]]]) for (const t of [undefined, null, 7, { X: { color: 'red', arr: 'nope' } }]) {
    const m = LAYOUT.build(s, r, t);
    assert.ok(m && Array.isArray(m.desks) && m.stats && Array.isArray(m.problems));
    JSON.stringify(m);
  }
  const m = LAYOUT.build(junk[6], [{ name: 'Ok Person', team: 'X' }], null);
  assert.strictEqual(m.w, 72); assert.strictEqual(m.d, 30);
  const big = m.rooms.find(r => r.id === 'big');
  assert.ok(big && big.type === 'conf' && big.door === 'n' && big.x + big.w / 2 <= 36 + 1e-9, 'clipped room');
  assert.strictEqual(m.rooms.find(r => r.name === 'Open area' || r.type === 'open').type, 'open');
  assert.ok(m.desks.some(d => d.id === 'ok' && d.a === 0) && m.desks.some(d => d.id === 'far' && d.x <= 36 && d.z <= 15));
  assert.ok(m.desks.filter(d => d.zone).every(d => d.arr === 'bench'), 'unknown arr falls back to bench');
  assert.ok(m.walls.some(w => w.x1 === -20 && w.z1 === -15 && w.z2 === 15), 'wall clipped to the plate');
  assert.deepStrictEqual(m.ramps, [{ k: 'hump', x: 2, z: 3, ax: 'x', dir: 1, len: 2, w: 1.8, h: 0.14 }]);
  assert.ok(m.problems.length >= 6, m.problems.join(' | '));
  assert.strictEqual(m.people.length, 1);
});

test('timing: 72 x 44 floor with 400 people builds in < 20 ms', () => {
  const spec = FX.floors['D-2'], r = FX.roster('D-2');
  for (let i = 0; i < 4; i++) LAYOUT.build(spec, r, FX.teams);         // warm up
  const t = [];
  for (let i = 0; i < 7; i++) { const t0 = performance.now(); LAYOUT.build(spec, r, FX.teams); t.push(performance.now() - t0); }
  t.sort((a, b) => a - b);
  const m = LAYOUT.build(spec, r, FX.teams);
  console.log(`       median ${t[3].toFixed(2)} ms, min ${t[0].toFixed(2)} ms; ${m.desks.length} desks, ${m.people.length} seated, ${m.blocks.length} blocks, ${m.posts.length} posts`);
  assert.ok(m.desks.length >= 300, 'dense floor should hold ~400 desks, got ' + m.desks.length);
  assert.ok(t[3] < 20, 'median ' + t[3].toFixed(2) + ' ms');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
