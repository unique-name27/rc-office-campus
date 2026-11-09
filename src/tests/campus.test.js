// CAMPUS tests: node v4/tests/campus.test.js [--ascii]   (--ascii prints every demo floor at 2 m per character)
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const load = require('./load');
const LAYOUT = load('layout.js', 'LAYOUT');
const CAMPUS = load('campus.js', 'CAMPUS', { LAYOUT });
const ascii = fs.existsSync(path.join(__dirname, 'ascii.js')) ? require('./ascii') : null;
const NAV = fs.existsSync(path.join(__dirname, '..', 'js', 'nav.js')) ? load('nav.js', 'NAV') : null;
const SHOW = process.argv.includes('--ascii');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
}
const fin = v => typeof v === 'number' && Number.isFinite(v);
const HEX = /^#[0-9A-Fa-f]{6}$/;
const ARR = ['bench', 'cubes', 'offices', 'lab', 'hot'];
const LAYOUT_ROOM_TYPES = ['conf', 'office', 'phone', 'kitchen', 'lab', 'restroom', 'stairs', 'elevator', 'lobby', 'server', 'storage', 'mail', 'wellness', 'open'];
const box = o => ({ x0: o.x - o.w / 2, x1: o.x + o.w / 2, z0: o.z - o.d / 2, z1: o.z + o.d / 2 });
const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const inside = (a, b, e = 1e-6) => a.x0 >= b.x0 - e && a.x1 <= b.x1 + e && a.z0 >= b.z0 - e && a.z1 <= b.z1 + e;
const deep = v => JSON.stringify(v);

// Grid BFS over a model's colliders (mask & 5 = car or walker), inflated by `clr`. Returns reached(x, z).
function reachFrom(m, sx, sz, cell, clr) {
  const nx = Math.ceil(m.w / cell), nz = Math.ceil(m.d / cell), x0 = -m.w / 2, z0 = -m.d / 2, B = new Uint8Array(nx * nz);
  const ci = x => Math.floor((x - x0) / cell), cj = z => Math.floor((z - z0) / cell);
  for (const b of m.blocks) { if (!(b.m & 5)) continue;
    for (let j = Math.max(0, cj(b.z0 - clr)); j <= Math.min(nz - 1, cj(b.z1 + clr)); j++) for (let i = Math.max(0, ci(b.x0 - clr)); i <= Math.min(nx - 1, ci(b.x1 + clr)); i++) {
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell, dx = Math.max(b.x0 - cx, 0, cx - b.x1), dz = Math.max(b.z0 - cz, 0, cz - b.z1);
      if (dx * dx + dz * dz < clr * clr) B[j * nx + i] = 1; } }
  for (const p of m.posts) { if (!(p.m & 5)) continue; const r = p.r + clr;
    for (let j = Math.max(0, cj(p.z - r)); j <= Math.min(nz - 1, cj(p.z + r)); j++) for (let i = Math.max(0, ci(p.x - r)); i <= Math.min(nx - 1, ci(p.x + r)); i++) {
      const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell; if ((cx - p.x) ** 2 + (cz - p.z) ** 2 < r * r) B[j * nx + i] = 1; } }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell;
    if (Math.min(cx - x0, -x0 - cx, cz - z0, -z0 - cz) < clr) B[j * nx + i] = 1; }
  const R = new Uint8Array(nx * nz), q = new Int32Array(nx * nz); let h = 0, t = 0;
  const s = cj(sz) * nx + ci(sx); if (!B[s]) { R[s] = 1; q[t++] = s; }
  while (h < t) { const c = q[h++], i = c % nx;
    for (const n of [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, c - nx, c + nx]) if (n >= 0 && n < nx * nz && !B[n] && !R[n]) { R[n] = 1; q[t++] = n; } }
  // a point counts as reached when any open cell within one cell of it was reached
  return (x, z) => { const i = ci(x), j = cj(z); for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz && R[b * nx + a]) return true; } return false; };
}
const insideCollider = (m, x, z, mask) => m.blocks.some(b => (b.m & mask) && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) || m.posts.some(p => (p.m & mask) && Math.hypot(x - p.x, z - p.z) < p.r);

// ---------------------------------------------------------------------------------------------------------------------------------
const D = CAMPUS.demo(LAYOUT);
const KEYS = ['B1-1', 'B1-2', 'B1-3', 'B1-4', 'B2-1', 'B2-2', 'B2-3', 'B2-4'];
const MODELS = {};
for (const k of KEYS) MODELS[k] = LAYOUT.build(D.floors[k], D.rosters[k], D.campus.teams);
const EXT = CAMPUS.exterior(D.campus, D.floors);

test('module shape and constants', () => {
  for (const f of ['demo', 'exterior', 'key', 'parseKey', 'defaultArr', 'teamColor']) assert.strictEqual(typeof CAMPUS[f], 'function', f);
  assert.deepStrictEqual(Object.keys(CAMPUS.ARR_NAMES).sort(), ARR.slice().sort());
  assert.deepStrictEqual(CAMPUS.ARR_NAMES, { bench: 'Open benches', cubes: 'Cubicles', offices: 'Private offices', lab: 'Lab benches', hot: 'Hot desks' });
  assert.deepStrictEqual(CAMPUS.ROOM_TYPES.map(t => t.type).sort(), LAYOUT_ROOM_TYPES.slice().sort());
  for (const t of CAMPUS.ROOM_TYPES) { assert.ok(typeof t.name === 'string' && t.name.length > 2); assert.strictEqual(CAMPUS.ROOM_NAMES[t.type], t.name); }
  assert.throws(() => { 'use strict'; CAMPUS.ARR_NAMES.bench = 'x'; });   // frozen
});

test('key / parseKey', () => {
  assert.strictEqual(CAMPUS.key('B1', 3), 'B1-3');
  assert.strictEqual(CAMPUS.key(' B2 ', '4'), 'B2-4');
  assert.strictEqual(CAMPUS.key('B1', 2.6), 'B1-3');
  assert.strictEqual(CAMPUS.key('', 1), '');
  assert.strictEqual(CAMPUS.key('B1', NaN), '');
  assert.strictEqual(CAMPUS.key(null, undefined), '');
  assert.deepStrictEqual(CAMPUS.parseKey('B1-3'), { b: 'B1', f: 3 });
  assert.deepStrictEqual(CAMPUS.parseKey(' D-12 '), { b: 'D', f: 12 });
  for (const bad of ['campus', '', 'B1', 'B1-', '-3', 'B1-x', 'B 1-2', null, undefined, 42, {}, []]) assert.strictEqual(CAMPUS.parseKey(bad), null, String(bad));
  for (const k of KEYS) { const p = CAMPUS.parseKey(k); assert.strictEqual(CAMPUS.key(p.b, p.f), k); }
});

test('defaultArr follows SPEC §2', () => {
  const cases = { 'Validation Lab': 'lab', 'Silicon Validation': 'lab', 'Characterization': 'lab', 'Reliability': 'lab', 'Failure Analysis': 'lab', 'Board Bring-up': 'lab', 'Test Floor': 'lab',
    'Finance': 'offices', 'Legal': 'offices', 'Executive': 'offices', 'Office of the CEO': 'offices', 'Corporate Counsel': 'offices',
    'People & HR': 'cubes', 'Accounting': 'cubes', 'Payroll': 'cubes', 'Procurement': 'cubes', 'Operations & Supply Chain': 'cubes', 'Quality': 'cubes', 'Facilities': 'cubes',
    'Sales & Marketing': 'hot', 'Customer Engineering': 'hot', 'Field Applications': 'hot', 'Support': 'hot', 'Business Development': 'hot',
    'Digital Design': 'bench', 'Physical Design': 'bench', 'IT': 'bench', '': 'bench' };
  for (const [t, a] of Object.entries(cases)) assert.strictEqual(CAMPUS.defaultArr(t), a, t);
  for (const bad of [null, undefined, 7, {}, []]) assert.ok(ARR.includes(CAMPUS.defaultArr(bad)));
});

test('teamColor: hex, stable by name, distinct for consecutive indices', () => {
  assert.strictEqual(CAMPUS.teamColor('Finance', 0), CAMPUS.teamColor('Finance'));
  assert.strictEqual(CAMPUS.teamColor('Finance', 0), CAMPUS.teamColor('finance', 0));
  const seen = new Set();
  for (let i = 1; i <= 24; i++) { const c = CAMPUS.teamColor('Team ' + i, i); assert.match(c, HEX); seen.add(c); }
  assert.strictEqual(seen.size, 24, 'first 24 indices are all different');
  for (const bad of [null, undefined, 3, {}, NaN]) assert.match(CAMPUS.teamColor(bad, bad), HEX);
  // readable on a light and a dark ground: mid luminance
  for (let i = 1; i <= 24; i++) { const c = CAMPUS.teamColor('x', i), n = parseInt(c.slice(1), 16);
    const L = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; assert.ok(L > 0.25 && L < 0.62, c + ' luminance ' + L.toFixed(2)); }
});

test('demo campus doc', () => {
  const c = D.campus;
  assert.strictEqual(c.v, 1); assert.strictEqual(c.name, 'San Jose campus'); assert.strictEqual(c.demo, true);
  assert.deepStrictEqual(c.buildings, [{ id: 'B1', name: 'Building 1', short: 'B1', floors: 4, x: -46, z: 0, w: 72, d: 44 }, { id: 'B2', name: 'Building 2', short: 'B2', floors: 4, x: 46, z: 0, w: 64, d: 48 }]);
  assert.deepStrictEqual(Object.keys(D.floors).sort(), KEYS); assert.deepStrictEqual(Object.keys(D.rosters).sort(), KEYS);
  const names = Object.keys(c.teams);
  assert.ok(names.length >= 20, 'teams ' + names.length);
  const colors = new Set();
  for (const n of names) { const t = c.teams[n]; assert.match(t.color, HEX); assert.ok(ARR.includes(t.arr), n); colors.add(t.color.toUpperCase()); }
  assert.strictEqual(colors.size, names.length, 'every demo team has its own color');
  assert.strictEqual(c.teams['Finance'].arr, 'offices'); assert.strictEqual(c.teams['Validation'].arr, 'lab'); assert.strictEqual(c.teams['Sales & Marketing'].arr, 'hot');
  assert.strictEqual(c.teams['People & HR'].arr, 'cubes'); assert.strictEqual(c.teams['Physical Design'].arr, 'bench');
});

test('demo specs are well-formed (SPEC §1)', () => {
  const teams = D.campus.teams;
  for (const k of KEYS) {
    const s = D.floors[k], p = CAMPUS.parseKey(k), b = D.campus.buildings.find(x => x.id === p.b);
    assert.deepStrictEqual(Object.keys(s).sort(), ['b', 'd', 'desks', 'door', 'f', 'glass', 'key', 'plan', 'ramps', 'rooms', 'updatedAt', 'v', 'w', 'walls', 'zones'].sort(), k);
    assert.strictEqual(s.v, 1); assert.strictEqual(s.key, k); assert.strictEqual(s.b, p.b); assert.strictEqual(s.f, p.f);
    assert.strictEqual(s.w, b.w); assert.strictEqual(s.d, b.d); assert.strictEqual(s.plan, null); assert.strictEqual(s.ramps, null); assert.strictEqual(s.updatedAt, 0);
    assert.deepStrictEqual(s.door, p.f === 1 ? { side: 's', at: 0, w: 3 } : null, k);
    for (const a of ['walls', 'glass', 'desks']) assert.ok(Array.isArray(s[a]));
    const plate = { x0: -s.w / 2, x1: s.w / 2, z0: -s.d / 2, z1: s.d / 2 }, ids = new Set();
    for (const r of s.rooms) {
      assert.ok(typeof r.id === 'string' && r.id && !ids.has(r.id.toLowerCase()), k + ' room id ' + r.id); ids.add(r.id.toLowerCase());
      assert.ok(LAYOUT_ROOM_TYPES.includes(r.type), r.type); assert.ok(typeof r.name === 'string' && r.name);
      assert.ok([r.x, r.z, r.w, r.d].every(fin) && r.w >= 1.5 && r.d >= 1.5, k + ' ' + r.id);
      assert.ok(inside(box(r), plate), k + ' room inside plate ' + r.id);
      assert.ok(r.door === null || ['n', 's', 'e', 'w'].includes(r.door), r.id);
      if (r.seats !== undefined) assert.ok(Number.isInteger(r.seats) && r.seats > 0);
    }
    const zids = new Set();
    for (const z of s.zones) {
      assert.ok(z.id && !zids.has(z.id)); zids.add(z.id);
      assert.ok(teams[z.team], k + ' zone team ' + z.team); assert.ok(z.arr === null || ARR.includes(z.arr));
      assert.ok([z.x, z.z, z.w, z.d].every(fin) && inside(box(z), plate), k + ' zone ' + z.id);
    }
  }
});

test('zones and rooms never collide: zones sit in open floor or wholly inside a lab', () => {
  for (const k of KEYS) {
    const s = D.floors[k];
    for (let i = 0; i < s.rooms.length; i++) for (let j = i + 1; j < s.rooms.length; j++)
      assert.ok(overlap(box(s.rooms[i]), box(s.rooms[j])) < 1e-6, `${k}: rooms ${s.rooms[i].id} / ${s.rooms[j].id} overlap`);
    for (let i = 0; i < s.zones.length; i++) for (let j = i + 1; j < s.zones.length; j++)
      assert.ok(overlap(box(s.zones[i]), box(s.zones[j])) < 1e-6, `${k}: zones ${s.zones[i].id} / ${s.zones[j].id} overlap`);
    for (const z of s.zones) for (const r of s.rooms) {
      const o = overlap(box(z), box(r));
      if (r.type === 'lab') assert.ok(o < 1e-6 || inside(box(z), box(r)), `${k}: zone ${z.id} half in lab ${r.id}`);
      else assert.ok(o < 1e-6, `${k}: zone ${z.id} overlaps room ${r.id}`);
    }
    // every lab room holds a lab zone of a lab team, with an entry strip left by its door
    for (const r of s.rooms.filter(r => r.type === 'lab')) {
      const zs = s.zones.filter(z => inside(box(z), box(r)));
      assert.ok(zs.length >= 1, k + ' lab ' + r.id + ' has no zone');
      for (const z of zs) assert.strictEqual(z.arr || D.campus.teams[z.team].arr, 'lab', k + ' ' + z.id);
    }
  }
});

test('building core: same elevators (ids, places) on every floor of a building, plus stairs and solid restrooms', () => {
  for (const b of ['B1', 'B2']) {
    const per = KEYS.filter(k => k.startsWith(b + '-')).map(k => D.floors[k].rooms.filter(r => r.type === 'elevator'));
    for (const els of per) { assert.deepStrictEqual(els.map(e => e.id).sort(), ['e1', 'e2']); }
    for (const els of per.slice(1)) assert.deepStrictEqual(deep(els), deep(per[0]), b);
    for (const k of KEYS.filter(k => k.startsWith(b + '-'))) {
      const rs = D.floors[k].rooms;
      assert.ok(rs.some(r => r.type === 'stairs'), k + ' stairs');
      assert.ok(rs.some(r => r.type === 'restroom' && r.door === null), k + ' solid restrooms');
      const m = MODELS[k];
      assert.deepStrictEqual(m.elevators.map(e => e.id).sort(), ['e1', 'e2']);
      for (const e of m.elevators) assert.deepStrictEqual(e.pad, MODELS[b + '-1'].elevators.find(x => x.id === e.id).pad, k + ' pad ' + e.id);
    }
  }
});

test('rosters: four string fields, known teams, names unique across the campus, realistic titles', () => {
  const all = new Set(); let total = 0;
  for (const k of KEYS) {
    for (const r of D.rosters[k]) {
      assert.deepStrictEqual(Object.keys(r).sort(), ['desk', 'name', 'team', 'title']);
      for (const f of ['desk', 'name', 'team', 'title']) assert.strictEqual(typeof r[f], 'string');
      assert.ok(r.name.trim() === r.name && /^\S+ \S/.test(r.name), r.name);
      assert.ok(D.campus.teams[r.team], r.team); assert.ok(r.title.length > 2);
      const n = r.name.toLowerCase(); assert.ok(!all.has(n), 'duplicate name ' + r.name); all.add(n); total++;
    }
  }
  assert.ok(total > 1100, 'people ' + total);
  for (const famous of ['lisa su', 'jensen huang', 'emma watson', 'kevin hart']) assert.ok(!all.has(famous), famous);
  // leadership: every team of 8+ has one lead (director / VP / general counsel / chief) and at least one manager
  const byTeam = {};
  for (const k of KEYS) for (const r of D.rosters[k]) (byTeam[r.team] = byTeam[r.team] || []).push(r.title);
  for (const [t, ts] of Object.entries(byTeam)) {
    if (t === 'Executive') { assert.ok(ts.includes('Chief executive officer') && ts.includes('Chief financial officer')); continue; }
    if (ts.length >= 8) assert.strictEqual(ts.filter(x => /^(Director|Vice president|General counsel)/.test(x)).length, 1, t);
    if (ts.length >= 4) assert.ok(ts.some(x => /manager|lead|controller|director|counsel/i.test(x)), t);
  }
  assert.ok(byTeam['Design Verification'].includes('Design verification engineer'));
  assert.ok(byTeam['Finance'].includes('FP&A analyst') && byTeam['People & HR'].includes('Recruiter'));
});

test('LAYOUT.build on all 8 floors: everyone placed at their exact desk, 140-230 people, clean', () => {
  const seen = new Set();
  for (const k of KEYS) {
    const m = MODELS[k], s = D.floors[k];
    assert.strictEqual(m.unplaced.length, 0, k + ' unplaced');
    assert.strictEqual(m.people.length, D.rosters[k].length, k);
    assert.ok(m.people.length >= 140 && m.people.length <= 230, `${k}: ${m.people.length} people`);
    assert.ok(m.people.every(p => !p.auto), k + ': every desk id matched');
    assert.deepStrictEqual(m.problems, [], k);
    for (const p of m.people) {
      assert.ok(!seen.has(p.name), 'duplicate ' + p.name); seen.add(p.name);
      const d = m.desks[p.desk]; assert.strictEqual(d.person, m.people.indexOf(p)); assert.strictEqual(d.team, p.team, k + ' ' + p.name + ' sits with their team');
    }
    // every team zone is 85-92% full (±1 desk for rounding)
    for (const z of s.zones) {
      const ds = m.desks.filter(d => d.zone === z.id), occ = ds.filter(d => d.person >= 0).length;
      assert.ok(ds.length > 0, k + ' zone ' + z.id + ' got no desks');
      assert.ok(occ >= Math.floor(ds.length * 0.85) - 1 && occ <= Math.ceil(ds.length * 0.92), `${k} ${z.id}: ${occ}/${ds.length}`);
    }
    assert.ok(m.kitchen && m.kitchen.pickup, k + ' kitchen');
    const nc = m.rooms.filter(r => r.type === 'conf').length;
    assert.ok(nc >= 2 && nc <= 6, k + ' conference rooms ' + nc);
    assert.strictEqual(m.elevators.length, 2, k);
    assert.ok(m.rooms.some(r => r.type === 'phone'), k + ' phone booths');
    assert.strictEqual(m.coffee.length, 5, k + ' coffee run');
    if (k.endsWith('-1')) { assert.ok(m.exit, k + ' exit'); assert.ok(m.rooms.some(r => r.type === 'lobby'), k + ' lobby'); }
    else assert.strictEqual(m.exit, null);
  }
  assert.ok(MODELS['B2-2'].rooms.some(r => r.type === 'server'), 'server room on B2 F2');
  assert.ok(KEYS.filter(k => MODELS[k].rooms.some(r => r.type === 'mail')).length >= 3, 'mail/print on some floors');
  // conference room names: elements in Building 1, San Jose neighborhoods in Building 2
  const confs = b => KEYS.filter(k => k.startsWith(b)).flatMap(k => D.floors[k].rooms.filter(r => r.type === 'conf').map(r => r.name));
  for (const n of ['Silicon', 'Gallium', 'Germanium', 'Hafnium']) assert.ok(confs('B1').includes(n), n);
  for (const n of ['Willow Glen', 'Almaden', 'Japantown', 'Rose Garden']) assert.ok(confs('B2').includes(n), n);
  assert.strictEqual(new Set(confs('B1')).size, confs('B1').length); assert.strictEqual(new Set(confs('B2')).size, confs('B2').length);
});

test('floors: every dest reachable from the spawn (independent 0.25 m BFS), elevator lobbies open', () => {
  for (const k of KEYS) {
    const m = MODELS[k], reach = reachFrom(m, m.spawn.x, m.spawn.z, 0.25, 0.25);
    const missed = m.dests.filter(d => !reach(d.x, d.z)).map(d => d.id);
    assert.deepStrictEqual(missed, [], k + ' unreachable dests');
    for (const e of m.elevators) {   // 2.4 x 2.4 m around each elevator pad is free of walker obstacles
      const b = { x0: e.pad.x - 1.2, x1: e.pad.x + 1.2, z0: e.pad.z - 1.2, z1: e.pad.z + 1.2 };
      assert.ok(!m.blocks.some(o => (o.m & 4) && overlap(o, b) > 0), k + ' elevator lobby ' + e.id);
    }
  }
});

test('exterior: shape, size, buildings, doors line up with the floor-1 exits', () => {
  const E = EXT;
  assert.strictEqual(E.key, 'campus'); assert.ok(E.w >= 220 && E.w <= 260 && E.d >= 140 && E.d <= 170, E.w + ' x ' + E.d);
  for (const f of ['buildings', 'areas', 'lines', 'items', 'blocks', 'posts', 'ramps', 'signs', 'dests']) assert.ok(Array.isArray(E[f]), f);
  assert.strictEqual(E.buildings.length, 2);
  for (const b of E.buildings) {
    const src = D.campus.buildings.find(x => x.id === b.id);
    for (const f of ['id', 'name', 'short', 'x', 'z', 'w', 'd', 'floors']) assert.strictEqual(b[f], src[f], f);
    assert.ok(b.h > 10); assert.strictEqual(b.door.r, 1.2);
    const ex = MODELS[b.id + '-1'].exit, o = [-Math.sin(b.door.a), -Math.cos(b.door.a)];
    // campus pad = building center + floor exit pad + 2.4 m straight out; and the pad faces away from the building
    assert.ok(Math.abs(b.door.x - (b.x + ex.x + o[0] * 2.4)) < 1e-6 && Math.abs(b.door.z - (b.z + ex.z + o[1] * 2.4)) < 1e-6, b.id + ' door/exit');
    assert.ok(Math.abs(((b.door.a - ex.a) % (2 * Math.PI))) < 1e-9, 'same facing');
    assert.ok((b.door.x - b.x) * o[0] + (b.door.z - b.z) * o[1] > 0, 'faces away');
    assert.ok(Math.abs(b.door.z - b.z) > b.d / 2 || Math.abs(b.door.x - b.x) > b.w / 2, 'pad outside the footprint');
    assert.ok(!insideCollider(E, b.door.x, b.door.z, 5), b.id + ' pad not inside a collider');
    // footprint blocks cover the building except a doorway gap the car can nose into
    const fb = E.blocks.filter(q => q.m === 7 && q.tall === 1 && inside(q, { x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }));
    const area = fb.reduce((s, q) => s + (q.x1 - q.x0) * (q.z1 - q.z0), 0);
    assert.ok(area < b.w * b.d && area > b.w * b.d - 10, b.id + ' footprint area ' + area);
    assert.ok(!insideCollider(E, b.door.x + (b.x + ex.x - b.door.x) * 0.55, b.door.z + (b.z + ex.z - b.door.z) * 0.55, 1), b.id + ' doorway open');
  }
});

test('exterior: spawn faces Building 1, door pads + every dest reachable (0.5 m BFS), nothing blocks a doorway', () => {
  const E = EXT, b1 = E.buildings.find(b => b.id === 'B1');
  assert.ok(Math.hypot(E.spawn.x - b1.door.x, E.spawn.z - b1.door.z) > 3 && Math.hypot(E.spawn.x - b1.door.x, E.spawn.z - b1.door.z) < 8);
  const f = [-Math.sin(E.spawn.a), -Math.cos(E.spawn.a)];
  assert.ok((b1.x - E.spawn.x) * f[0] + (b1.z - E.spawn.z) * f[1] > 0, 'spawn faces the building');
  const reach = reachFrom(E, E.spawn.x, E.spawn.z, 0.5, 0.3);
  for (const b of E.buildings) assert.ok(reach(b.door.x, b.door.z), b.id + ' door pad reachable');
  for (const d of E.dests) { assert.ok(reach(d.x, d.z), 'dest ' + d.id); assert.ok(!insideCollider(E, d.x, d.z, 5), 'dest free ' + d.id); assert.strictEqual(d.kind, 'amenity'); }
  assert.deepStrictEqual(E.dests.filter(d => d.id.startsWith('bldg:')).map(d => d.id).sort(), ['bldg:B1', 'bldg:B2']);
  assert.ok(E.dests.find(d => d.id === 'bldg:B2').name === 'Building 2 entrance');
  for (const b of E.buildings) {   // 5 m straight out of each doorway is clear for walkers and cars
    const o = [-Math.sin(b.door.a), -Math.cos(b.door.a)];
    for (let t = -1; t <= 5; t += 0.25) for (const s of [-1, 0, 1]) assert.ok(!insideCollider(E, b.door.x + o[0] * t + o[1] * s, b.door.z + o[1] * t - o[0] * s, 5), b.id + ' approach');
  }
});

test('exterior: lots, plaza, road, items and colliders make sense', () => {
  const E = EXT, kinds = new Set(E.areas.map(a => a.kind));
  for (const k of ['road', 'parking', 'plaza', 'walk']) assert.ok(kinds.has(k), k);
  assert.ok(E.areas.every(a => ['road', 'parking', 'grass', 'plaza', 'walk'].includes(a.kind) && a.w > 0 && a.d > 0));
  assert.strictEqual(E.areas.filter(a => a.kind === 'parking').length, 2, 'two lots');
  const T = ['tree', 'lamp', 'car', 'bench', 'bollard', 'planter', 'bikerack', 'flag', 'sign'], count = {};
  for (const it of E.items) { assert.ok(T.includes(it.t), it.t); assert.ok([it.x, it.z, it.a].every(fin)); count[it.t] = (count[it.t] || 0) + 1; }
  assert.ok(count.car >= 40 && count.tree >= 60 && count.lamp >= 20 && count.bench >= 6 && count.planter >= 4 && count.bikerack >= 2, JSON.stringify(count));
  assert.strictEqual(count.flag, 3, 'flagpole trio'); assert.strictEqual(count.sign, 1);
  assert.strictEqual(E.items.find(i => i.t === 'sign').text, 'San Jose campus');
  const carColors = new Set(E.items.filter(i => i.t === 'car').map(i => i.c)); assert.ok(carColors.size >= 6);
  for (const c of E.items.filter(i => i.t === 'car' || i.t === 'flag')) assert.match(c.c, HEX);
  assert.ok(E.items.filter(i => i.t === 'car').some(c => Math.abs(Math.sin(c.a)) > 0.005), 'cars sit a little off-square');
  const lots = E.areas.filter(a => a.kind === 'parking').map(box), roads = E.areas.filter(a => a.kind === 'road').map(box);
  for (const c of E.items.filter(i => i.t === 'car')) assert.ok(lots.some(l => c.x > l.x0 && c.x < l.x1 && c.z > l.z0 && c.z < l.z1), 'car in a lot');
  for (const it of E.items.filter(i => i.t !== 'car')) assert.ok(!roads.some(r => it.x > r.x0 && it.x < r.x1 && it.z > r.z0 && it.z < r.z1), it.t + ' on a road at ' + it.x + ',' + it.z);
  const bld = E.buildings.map(b => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }));
  for (const it of E.items) assert.ok(!bld.some(b => it.x > b.x0 - 0.5 && it.x < b.x1 + 0.5 && it.z > b.z0 - 0.5 && it.z < b.z1 + 0.5), it.t + ' inside a building');
  const plate = { x0: -E.w / 2, x1: E.w / 2, z0: -E.d / 2, z1: E.d / 2 };
  for (const q of E.blocks) { assert.ok([q.x0, q.x1, q.z0, q.z1].every(fin) && q.x1 > q.x0 && q.z1 > q.z0 && inside(q, plate)); assert.ok([1, 2, 3, 4, 7].includes(q.m) && (q.tall === 0 || q.tall === 1)); }
  for (const p of E.posts) assert.ok([p.x, p.z, p.r].every(fin) && p.r > 0 && p.x > plate.x0 && p.x < plate.x1);
  // solid things never overlap: posts (trees, lamps, bollards, flags) stay out of every other collider, blocks out of each other
  const solidB = E.blocks.filter(q => q.m & 5);
  for (const p of E.posts.filter(p => p.m === 7)) assert.ok(!solidB.some(q => p.x > q.x0 - p.r && p.x < q.x1 + p.r && p.z > q.z0 - p.r && p.z < q.z1 + p.r), `post at ${p.x},${p.z} overlaps a block`);
  const big = E.posts.filter(p => p.m === 7);
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) assert.ok(Math.hypot(big[i].x - big[j].x, big[i].z - big[j].z) >= big[i].r + big[j].r, 'posts overlap');
  const outer = E.blocks.filter(q => q.m === 7 || (q.m === 4 && q.tall === 1));   // buildings, planters, signs, car bodies, benches
  for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) {
    const a = outer[i], b = outer[j], o = overlap(a, b);
    const sameBuilding = a.m === 7 && b.m === 7 && a.tall && b.tall && E.buildings.some(B => inside(a, box(B)) && inside(b, box(B)));
    assert.ok(o < 1e-6 || sameBuilding, `blocks overlap at ${a.x0},${a.z0}`);
  }
  for (const l of E.lines) { assert.ok([l.x1, l.z1, l.x2, l.z2].every(fin)); assert.match(l.c, HEX); }
  assert.ok(E.lines.length > 150, 'stripes + markings');
  for (const s of E.signs) { assert.ok(Array.isArray(s.lines) && s.lines.length && [s.x, s.y, s.z, s.h].every(fin)); }
});

test('exterior ramps: 2-3 kick ramps + humps, LAYOUT shapes, lanes clear of car obstacles', () => {
  const E = EXT, kicks = E.ramps.filter(r => r.k === 'kick'), humps = E.ramps.filter(r => r.k === 'hump');
  assert.ok(kicks.length >= 2 && kicks.length <= 3, 'kicks ' + kicks.length); assert.ok(humps.length >= 2, 'humps ' + humps.length);
  for (const r of E.ramps) {
    assert.ok(['x', 'z'].includes(r.ax) && (r.dir === 1 || r.dir === -1) && [r.x, r.z, r.len, r.w, r.h].every(fin));
    if (r.k === 'kick') assert.deepStrictEqual([r.len, r.w, r.h], [1.4, 1.3, 0.32]); else assert.ok(r.len === 1.5 && r.h === 0.14 && r.w <= 4.4);
    const L = r.len / 2 + (r.k === 'kick' ? 0.28 : 0) + 3, hw = r.w / 2;
    const lane = r.ax === 'x' ? { x0: r.x - L, x1: r.x + L, z0: r.z - hw, z1: r.z + hw } : { x0: r.x - hw, x1: r.x + hw, z0: r.z - L, z1: r.z + L };
    assert.ok(!E.blocks.some(q => (q.m & 1) && overlap(q, lane) > 0), 'ramp lane block at ' + r.x + ',' + r.z);
    assert.ok(!E.posts.some(p => (p.m & 1) && p.x > lane.x0 - p.r && p.x < lane.x1 + p.r && p.z > lane.z0 - p.r && p.z < lane.z1 + p.r), 'ramp lane post at ' + r.x + ',' + r.z);
  }
});

test('exterior follows the floor-1 doorway (east side, off-center) and stays aligned', () => {
  const floors = JSON.parse(JSON.stringify(D.floors));
  floors['B2-1'].door = { side: 'east', at: 5, w: 4 };
  floors['B1-1'].door = { side: 's', at: 999, w: 3 };   // clamped the same way LAYOUT clamps it
  const E = CAMPUS.exterior(D.campus, floors);
  for (const id of ['B1', 'B2']) {
    const b = E.buildings.find(x => x.id === id), m = LAYOUT.build(floors[id + '-1'], [], D.campus.teams), o = [-Math.sin(b.door.a), -Math.cos(b.door.a)];
    assert.ok(Math.abs(b.door.x - (b.x + m.exit.x + o[0] * 2.4)) < 1e-6 && Math.abs(b.door.z - (b.z + m.exit.z + o[1] * 2.4)) < 1e-6, id);
  }
  const b2 = E.buildings.find(x => x.id === 'B2');
  assert.deepStrictEqual([b2.door.x, b2.door.z, b2.door.a], [46 + 32 + 1.2, 5, -Math.PI / 2]);
  const reach = reachFrom(E, E.spawn.x, E.spawn.z, 0.5, 0.3);
  for (const b of E.buildings) assert.ok(reach(b.door.x, b.door.z), b.id);
  assert.ok(!insideCollider(E, b2.door.x, b2.door.z, 5));
  // no floor specs: default south doorway in the middle
  const E2 = CAMPUS.exterior(D.campus);
  assert.deepStrictEqual(E2.buildings.map(b => [b.door.x, b.door.z]), [[-46, 23.2], [46, 25.2]]);
});

test('never throws on messy input', () => {
  const bad = [undefined, null, 0, 'x', [], {}, { buildings: 'nope' }, { buildings: [null, 5, {}, { id: '' }] },
    { buildings: [{ id: 'A', x: 'NaN', z: Infinity, w: -50, d: 'big', floors: 'many' }] },
    { buildings: [{ id: 'A', x: 0, z: 0, w: 60, d: 40 }, { id: 'A', x: 100, z: 0, w: 60, d: 40 }, { id: 'B', x: 10, z: 5, w: 60, d: 40 }] },
    { buildings: [{ id: 'F', x: 900, z: -700, w: 300, d: 300, floors: 2 }, { id: 'G', x: -900, z: 700, w: 20, d: 20 }] },
    { name: { evil: 1 }, buildings: [{ id: 'S', x: 0, z: 0, w: 70, d: 40 }] }];
  for (const doc of bad) {
    for (const fsx of [undefined, null, 'x', {}, { 'A-1': null }, { 'A-1': { door: { side: 'up' } } }, { 'S-1': { door: { side: 'n', at: 'x', w: -9 } } },
      { 'S-1': { door: { side: 'constructor' } }, 'A-1': { door: { side: '__proto__' } }, 'F-1': { door: 'east' } }]) {
      const E = CAMPUS.exterior(doc, fsx);
      assert.strictEqual(E.key, 'campus'); assert.ok(E.w >= 230 && E.d >= 150 && fin(E.w) && fin(E.d));
      assert.ok([E.spawn.x, E.spawn.z, E.spawn.a].every(fin));
      for (const q of E.blocks) assert.ok([q.x0, q.x1, q.z0, q.z1].every(fin));
      assert.ok(Array.isArray(E.problems));
      // a pad can only land inside a collider when the buildings themselves overlap, and that is reported
      const overlapping = E.problems.some(p => /overlap/.test(p));
      for (const b of E.buildings) assert.ok([b.door.x, b.door.z, b.door.a].every(fin) && (overlapping || !insideCollider(E, b.door.x, b.door.z, 5)), b.id);
    }
  }
  // a single building with its door on the north side still gets an open approach and a reachable pad
  const one = CAMPUS.exterior({ buildings: [{ id: 'S', name: 'Solo', x: 10, z: -5, w: 50, d: 30, floors: 3 }] }, { 'S-1': { door: { side: 'n', at: -10, w: 3 } } });
  const reach = reachFrom(one, one.spawn.x, one.spawn.z, 0.5, 0.3);
  assert.ok(reach(one.buildings[0].door.x, one.buildings[0].door.z));
  for (const d of one.dests) assert.ok(reach(d.x, d.z), d.id);
  // demo with no / broken LAYOUT
  for (const L of [undefined, null, {}, { build: 5 }, { build: () => { throw new Error('x'); }, capacity: () => { throw new Error('y'); } }, { build: () => null, capacity: () => ({ byZone: { z1: 'lots' } }) }]) {
    const d = CAMPUS.demo(L);
    assert.deepStrictEqual(Object.keys(d.floors).sort(), KEYS);
    for (const k of KEYS) for (const r of d.rosters[k]) assert.strictEqual(r.desk, '');
  }
  for (const v of [undefined, null, {}, [], 'x', 12, { side: 1 }]) { CAMPUS.key(v, v); CAMPUS.parseKey(v); CAMPUS.defaultArr(v); CAMPUS.teamColor(v, v); }
});

test('demo without LAYOUT: sized from estimates, LAYOUT still seats everyone', () => {
  const d = CAMPUS.demo();
  for (const k of KEYS) {
    const m = LAYOUT.build(d.floors[k], d.rosters[k], d.campus.teams);
    assert.strictEqual(m.unplaced.length, 0, k + ' unplaced ' + m.unplaced.length);
    assert.ok(m.people.length >= 100, k + ' ' + m.people.length);
  }
  assert.deepStrictEqual(deep(d.floors), deep(D.floors), 'same floors either way');
});

test('deterministic', () => {
  assert.strictEqual(deep(CAMPUS.demo(LAYOUT)), deep(D));
  assert.strictEqual(deep(CAMPUS.exterior(D.campus, D.floors)), deep(EXT));
  assert.strictEqual(deep(CAMPUS.demo()), deep(CAMPUS.demo()));
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'campus.js'), 'utf8');
  assert.ok(!/Math\.random|Date\.now|performance\.now|\brequire\(|\bimport\b|\bexport\b|document\.|window\./.test(src), 'no randomness, clocks, imports or DOM');
  assert.ok(/^(?:\/\*[\s\S]*?\*\/\s*)?const CAMPUS=\(\(\)=>\{/.test(src) && /\}\)\(\);\s*$/.test(src), 'one top-level const');
});

test('demo() + exterior() together run in < 150 ms', () => {
  const t0 = process.hrtime.bigint();
  const d = CAMPUS.demo(LAYOUT); CAMPUS.exterior(d.campus, d.floors);
  const cold = Number(process.hrtime.bigint() - t0) / 1e6;
  const ms = [];
  for (let i = 0; i < 3; i++) { const t = process.hrtime.bigint(); const e = CAMPUS.demo(LAYOUT); CAMPUS.exterior(e.campus, e.floors); ms.push(Number(process.hrtime.bigint() - t) / 1e6); }
  ms.sort((a, b) => a - b);
  console.log(`     demo+exterior: first ${cold.toFixed(1)} ms, median ${ms[1].toFixed(1)} ms`);
  assert.ok(ms[1] < 150, 'median ' + ms[1]);
});

test('NAV routes across the campus: desk on B1-3 -> desk on B2-2 (if nav.js is present)', () => {
  if (!NAV) { console.log('     (nav.js not found: skipped)'); return; }
  const floors = {}; for (const k of KEYS) floors[k] = MODELS[k];
  const grids = new Map(), world = { campus: EXT, floors, grid: k => { if (!grids.has(k)) grids.set(k, NAV.grid(k === 'campus' ? EXT : floors[k])); return grids.get(k); } };
  const a = MODELS['B1-3'].dests.find(d => d.kind === 'desk' && d.name !== 'Open desk'), b = MODELS['B2-2'].dests.find(d => d.kind === 'desk' && d.name !== 'Open desk');
  const r = NAV.plan(world, { w: 'B1-3', x: a.x, z: a.z }, { w: 'B2-2', x: b.x, z: b.z, name: b.name });
  assert.ok(r && r.legs, 'route found');
  assert.deepStrictEqual(r.legs.map(l => l.w), ['B1-3', 'B1-1', 'campus', 'B2-1', 'B2-2']);
  const conf = MODELS['B1-1'].dests.find(d => d.id === 'room:c11');
  const r2 = NAV.plan(world, { w: 'campus', x: EXT.spawn.x, z: EXT.spawn.z }, { w: 'B1-1', x: conf.x, z: conf.z, name: conf.name });
  assert.ok(r2 && r2.legs.length === 2, 'campus -> Silicon');
});

// eyeball: every floor at 2 m per character
if (ascii) {
  for (const k of KEYS) {
    const m = MODELS[k];
    console.log(`     ${k}: ${m.people.length} people, ${m.stats.desks} desks, ${m.rooms.filter(r => r.type === 'conf').length} conference rooms, ${m.ramps.length} ramps`);
    if (!SHOW) continue;
    const rows = ascii(m).split('\n'), PRI = '#gEXS*^dci. ', out = [];
    for (let j = 0; j < rows.length; j += 4) { let s = ''; for (let i = 0; i < rows[j].length; i += 4) { let best = ' ';
      for (let dj = 0; dj < 4; dj++) for (let di = 0; di < 4; di++) { const ch = (rows[j + dj] || '')[i + di]; if (ch && PRI.indexOf(ch) < PRI.indexOf(best)) best = ch; } s += best; } out.push('     ' + s); }
    console.log(out.join('\n'));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
