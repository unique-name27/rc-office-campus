// NAV tests: node v4/tests/nav.test.js   (single process, < 10 s)
const assert = require('node:assert/strict');
const NAV = require('./load')('nav.js', 'NAV');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String((e && e.stack) || e).split('\n').slice(0, 5).join('\n     ')); }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` expected ${b}, got ${a}`);
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- synthetic geometry (SPEC section 4 shapes) ---------- */
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const box = (x0, z0, x1, z1, m = 7, tall = 1) => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), m, tall });
// axis-aligned wall segment, 0.15 m thick
const wall = (x1, z1, x2, z2, t = 0.15) => x1 === x2 ? box(x1 - t / 2, z1, x1 + t / 2, z2) : box(x1, z1 - t / 2, x2, z2 + t / 2);
function desk(x, z) {   // 1.6 x 0.8 desk: walker-only top + 4 legs (m=3)
  const block = box(x - 0.8, z - 0.4, x + 0.8, z + 0.4, 4, 0);
  const posts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) posts.push({ x: x + sx * 0.74, z: z + sz * 0.35, r: 0.03, m: 3, tall: 0 });
  return { block, posts };
}
const room = (key, w, d, blocks = [], posts = [], extra = {}) => Object.assign({ key, w, d, blocks, posts, elevators: [], exit: null }, extra);

function cellAt(G, x, z) {
  const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
  return i < 0 || j < 0 || i >= G.nx || j >= G.nz ? -1 : j * G.nx + i;
}
function obstacleDist(model, x, z) {
  let best = Math.min(x + model.w / 2, model.w / 2 - x, z + model.d / 2, model.d / 2 - z);
  for (const b of model.blocks) if (b.m & 5) best = Math.min(best, Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1)));
  for (const p of model.posts) if (p.m & 5) best = Math.min(best, Math.hypot(x - p.x, z - p.z) - p.r);
  return best;
}
function samplesOf(pts, step = 0.1) {
  const out = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let s = 0; s <= n; s++) out.push([ax + (bx - ax) * s / n, az + (bz - az) * s / n]);
  }
  return out;
}
// Every 0.1 m: never in a blocked cell; with free=true never in the clearance ring either, which keeps the
// path at least clear - cell*sqrt(2)/2 from every raw obstacle (a free cell's center is >= clear away).
function checkPath(G, model, pts, free = true) {
  const bound = G.clear - G.cell * Math.SQRT1_2 - 1e-9;
  let minD = Infinity;
  for (const [x, z] of samplesOf(pts)) {
    const c = cellAt(G, x, z);
    assert.ok(c >= 0, `sample off grid ${x},${z}`);
    assert.notEqual(G.block[c], 1, `sample in blocked cell at ${x.toFixed(3)},${z.toFixed(3)}`);
    if (free) assert.equal(G.block[c], 0, `sample in clearance ring at ${x.toFixed(3)},${z.toFixed(3)}`);
    minD = Math.min(minD, obstacleDist(model, x, z));
  }
  if (free) assert.ok(minD >= bound, `path within ${minD} of an obstacle`);
  assert.ok(minD > 0, `path touches an obstacle (${minD})`);
  return minD;
}
function pathLen(pts) { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return L; }
// Optimal free-cell octile distance (cells), same move rules as NAV's free-space A*.
function dijkstraFree(G, s, t) {
  const N = G.nx * G.nz, dist = new Float64Array(N).fill(Infinity), done = new Uint8Array(N);
  dist[s] = 0;
  const open = [s];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (dist[open[k]] < dist[open[bi]]) bi = k;
    const c = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    if (done[c]) continue; done[c] = 1;
    if (c === t) return dist[c];
    const ci = c % G.nx, cj = (c - ci) / G.nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
      const n = j * G.nx + i;
      if (G.block[n] !== 0 || done[n]) continue;
      if (di && dj && (G.block[cj * G.nx + i] !== 0 || G.block[j * G.nx + ci] !== 0)) continue;
      const nd = dist[c] + (di && dj ? Math.SQRT2 : 1);
      if (nd < dist[n]) { dist[n] = nd; open.push(n); }
    }
  }
  return Infinity;
}

/* ---------- grid ---------- */
test('grid: shape, plate edge blocked, cached per model and options', () => {
  const m = room('t', 20, 12);
  const G = NAV.grid(m, { cell: 0.4, clear: 0.32 });
  assert.equal(G.nx, 50); assert.equal(G.nz, 30); near(G.x0, -10); near(G.z0, -6);
  assert.equal(G.cell, 0.4); assert.equal(G.key, 't'); assert.equal(G.model, m);
  assert.equal(G.block.length, 1500);
  assert.equal(G.block[0], 1); assert.equal(G.block[G.nx - 1], 1); assert.equal(G.block[cellAt(G, 0, 0)], 0);
  assert.equal(NAV.grid(m, { cell: 0.4, clear: 0.32 }), G, 'cached');
  assert.equal(NAV.grid(m), G, 'defaults are cell .4 / clear .32');
  assert.notEqual(NAV.grid(m, { cell: 0.5 }), G);
});

test('grid: only masks with bit 1 or 4 are rasterized, inflated by clear', () => {
  const m = room('t', 20, 12, [box(-6, -1, -4, 1, 2), box(-1, -1, 1, 1, 4), box(4, -1, 6, 1, 1)],
    [{ x: 0, z: 4, r: 0.2, m: 2 }, { x: 4, z: 4, r: 0.2, m: 3 }]);
  const G = NAV.grid(m);
  assert.equal(G.block[cellAt(G, -5, 0)], 0, 'chair-only block ignored');
  assert.equal(G.block[cellAt(G, 0, 0)], 1, 'walker block');
  assert.equal(G.block[cellAt(G, 5, 0)], 1, 'car block');
  assert.equal(G.block[cellAt(G, 0, 4)], 0, 'chair-only post ignored');
  assert.equal(G.block[cellAt(G, 4, 4)], 1, 'leg post');
  // every cell center within `clear` of an obstacle is non-zero; centers further out are free
  for (let k = 0; k < G.block.length; k++) {
    const i = k % G.nx, j = (k - i) / G.nx, x = G.x0 + (i + 0.5) * G.cell, z = G.z0 + (j + 0.5) * G.cell;
    const d = obstacleDist(m, x, z);
    if (d < G.clear - 1e-6) assert.notEqual(G.block[k], 0, `cell ${x},${z} d=${d}`);
    if (d > G.clear + 1e-6) assert.equal(G.block[k], 0, `cell ${x},${z} d=${d}`);
    if (d < G.core - 1e-6) assert.equal(G.block[k], 1, `cell ${x},${z} d=${d}`);
  }
});

/* ---------- findPath ---------- */
test('open room: straight line, exact endpoints', () => {
  const m = room('t', 20, 12), G = NAV.grid(m);
  const r = NAV.findPath(G, -8, -4, 8, 4);
  assert.deepEqual(r.pts, [[-8, -4], [8, 4]]);
  near(r.len, Math.hypot(16, 8));
  const z = NAV.findPath(G, 1.23, 2.34, 1.23, 2.34);
  assert.deepEqual(z.pts, [[1.23, 2.34], [1.23, 2.34]]); assert.equal(z.len, 0);
});

test('straight corridor string-pulls to 2 points', () => {
  const m = room('t', 40, 6, [wall(-18, -1, 18, -1), wall(-18, 1, 18, 1)]);
  const G = NAV.grid(m);
  for (const dz of [0, 0.13, -0.27]) {
    const r = NAV.findPath(G, -17, dz, 17, dz);
    assert.equal(r.pts.length, 2, JSON.stringify(r.pts));
    near(r.len, 34);
    checkPath(G, m, r.pts);
  }
});

test('U-shaped corridor: goes round the divider, few corners, near-taut length', () => {
  const m = room('t', 30, 14, [wall(-15, 0, 9, 0), box(-15, -7, 9, -3), box(-15, 3, 9, 7)]);
  const G = NAV.grid(m);
  const r = NAV.findPath(G, -12, -1.5, -12, 1.5);
  assert.ok(r, 'route');
  assert.ok(r.pts.length <= 7, `${r.pts.length} points`);
  const maxX = Math.max(...r.pts.map(p => p[0]));
  assert.ok(maxX > 9.075 + G.core, 'rounds the divider end');
  // taut continuous path with clearance ~0.32: ~ 2*hypot(21.4,1.5) + small bend
  assert.ok(r.len > 42 && r.len < 45.5, 'len ' + r.len);
  checkPath(G, m, r.pts);
});

test('room with a 1.0 m door: routable at every grid alignment, crosses inside the gap', () => {
  let worst = Infinity, n = 0;
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
    const wx = 2 + a * 0.05, dz = b * 0.05;
    const m = room('t', 20, 14, [
      wall(wx, -3, wx, dz - 0.5), wall(wx, dz + 0.5, wx, 3),          // west wall with the door gap
      wall(wx, -3, wx + 6, -3), wall(wx, 3, wx + 6, 3), wall(wx + 6, -3, wx + 6, 3)]);
    const G = NAV.grid(m);
    const r = NAV.findPath(G, -6, 0.3, wx + 3, 0.1);
    assert.ok(r, `no route for wall x=${wx} door z=${dz}`);
    worst = Math.min(worst, checkPath(G, m, r.pts, false));
    for (const [x, z] of samplesOf(r.pts)) if (Math.abs(x - wx) <= 0.075) assert.ok(z > dz - 0.5 && z < dz + 0.5, 'crosses the wall outside the door');
    n++;
  }
  assert.equal(n, 64);
  assert.ok(worst >= 0.1, 'door clearance ' + worst);
});

test('maze: valid, within the optimal grid length, never through walls', () => {
  const C = 2.5, MX = 8, MZ = 6, rnd = mulberry32(7);
  const open = new Set(), seen = new Set(['0,0']), stack = [[0, 0]];
  while (stack.length) {   // DFS backtracker
    const [ci, cj] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [ci + a, cj + b]).filter(([i, j]) => i >= 0 && j >= 0 && i < MX && j < MZ && !seen.has(i + ',' + j));
    if (!nb.length) { stack.pop(); continue; }
    const [ni, nj] = nb[Math.floor(rnd() * nb.length)];
    seen.add(ni + ',' + nj); open.add([Math.min(ci, ni), Math.min(cj, nj), ni !== ci ? 'v' : 'h'].join(','));
    stack.push([ni, nj]);
  }
  const W = MX * C, D = MZ * C, x0 = -W / 2, z0 = -D / 2, blocks = [];
  for (let i = 0; i < MX; i++) for (let j = 0; j < MZ; j++) {
    if (i < MX - 1 && !open.has([i, j, 'v'].join(','))) blocks.push(wall(x0 + (i + 1) * C, z0 + j * C, x0 + (i + 1) * C, z0 + (j + 1) * C));
    if (j < MZ - 1 && !open.has([i, j, 'h'].join(','))) blocks.push(wall(x0 + i * C, z0 + (j + 1) * C, x0 + (i + 1) * C, z0 + (j + 1) * C));
  }
  const m = room('maze', W, D, blocks), G = NAV.grid(m);
  const sx = x0 + C / 2, sz = z0 + C / 2, gx = x0 + W - C / 2, gz = z0 + D - C / 2;
  const r = NAV.findPath(G, sx, sz, gx, gz);
  assert.ok(r, 'route');
  checkPath(G, m, r.pts);
  const best = dijkstraFree(G, cellAt(G, sx, sz), cellAt(G, gx, gz));
  assert.ok(r.len <= best * G.cell + G.cell * Math.SQRT2 + 1e-6, `len ${r.len} vs grid optimum ${best * G.cell}`);
  assert.ok(r.len >= Math.hypot(gx - sx, gz - sz));
  near(r.len, pathLen(r.pts), 1e-9);
});

test('blocked endpoints snap to the nearest free cell within 4 m; else null', () => {
  const m = room('t', 20, 12, [box(-1, -1, 1, 1)]), G = NAV.grid(m);
  const r = NAV.findPath(G, 0.1, 0.05, 6, 3);
  assert.ok(r, 'route');
  let bd = Infinity, bc = -1;
  for (let k = 0; k < G.block.length; k++) {
    if (G.block[k] !== 0) continue;
    const i = k % G.nx, j = (k - i) / G.nx, d = Math.hypot(G.x0 + (i + 0.5) * G.cell - 0.1, G.z0 + (j + 0.5) * G.cell - 0.05);
    if (d < bd) { bd = d; bc = k; }
  }
  const [px, pz] = r.pts[0];
  assert.equal(cellAt(G, px, pz), bc, 'nearest free cell');
  near(Math.hypot(px - 0.1, pz - 0.05), bd, 1e-9);
  assert.deepEqual(r.pts[r.pts.length - 1], [6, 3]);
  const g = NAV.findPath(G, 6, 3, -0.3, 0.2);                 // goal inside the pillar
  assert.equal(G.block[cellAt(G, ...g.pts[g.pts.length - 1])], 0);
  assert.deepEqual(g.pts[0], [6, 3]);
  assert.ok(NAV.findPath(G, 10.5, 0, -6, 0), 'just off the plate snaps back on');
  assert.equal(NAV.findPath(G, 30, 0, -6, 0), null, 'far off the plate');
  const big = room('t', 30, 20, [box(-6, -4.5, 6, 4.5)]), GB = NAV.grid(big);
  assert.equal(NAV.findPath(GB, 0, 0, 10, 8), null, 'no free cell within 4 m');
});

test('unreachable -> null (sealed room, enclosed goal)', () => {
  const m = room('t', 20, 12, [wall(2, -3, 2, 3), wall(8, -3, 8, 3), wall(2, -3, 8, -3), wall(2, 3, 8, 3)]);
  const G = NAV.grid(m);
  assert.equal(NAV.findPath(G, -6, 0, 5, 0), null);
  assert.equal(NAV.findPath(G, 5, 0, -6, 0), null);
  assert.ok(NAV.findPath(G, 4, -1, 6, 1), 'inside to inside is fine');
});

test('snapped goal prefers a cell the start can actually reach', () => {
  // goal inside a thick wall between a sealed pocket (closer) and the open side (further)
  const m = room('t', 20, 12, [box(0, -6, 0.9, 6), wall(0.9, -1, 2.5, -1), wall(0.9, 1, 2.5, 1), wall(2.5, -1, 2.5, 1)]);
  const G = NAV.grid(m);
  const r = NAV.findPath(G, -6, 0, 0.75, 0);
  assert.ok(r, 'route');
  assert.ok(r.pts[r.pts.length - 1][0] < 0, 'snapped to the reachable (west) side');
});

/* ---------- desk floor (also the performance fixture) ---------- */
function deskFloor() {
  const w = 72, d = 44, blocks = [], posts = [];
  blocks.push(box(-36, -22, 36, -21.7), box(-36, 21.7, 36, 22), box(-36, -22, -35.7, 22), box(35.7, -22, 36, 22));
  for (let c = 0; c < 10; c++) for (let r = 0; r < 5; r++) {
    const px = -31.5 + c * 7, pz = -16 + r * 8;
    for (const dx of [-1.6, 0, 1.6]) for (const dz of [-0.4, 0.4]) {
      const dk = desk(px + dx, pz + dz);
      blocks.push(dk.block); posts.push(...dk.posts);
      blocks.push(box(px - 2.4, pz - 0.02, px + 2.4, pz + 0.02, 7, 0));   // divider panel
    }
  }
  for (const [x, z] of [[-28, -12], [0, 4], [21, -4], [-14, 12]]) blocks.push(box(x - 2, z - 1.5, x + 2, z + 1.5));
  return room('B1-3', w, d, blocks, posts);
}
function aislePoints(n, seed) {
  const rnd = mulberry32(seed), out = [];
  while (out.length < n) {
    const z = [-12, -4, 4, 12][Math.floor(rnd() * 4)], x = -34 + rnd() * 68;
    if ([[-28, -12], [0, 4], [21, -4], [-14, 12]].some(([rx, rz]) => Math.abs(x - rx) < 3 && Math.abs(z - rz) < 2.5)) continue;
    out.push([x, z + (rnd() - 0.5) * 2]);
  }
  return out;
}

test('desk floor: paths never pass through inflated blocks (sampled every 0.1 m)', () => {
  const m = deskFloor(), G = NAV.grid(m), P = aislePoints(30, 3);
  for (let k = 0; k + 1 < P.length; k += 2) {
    const r = NAV.findPath(G, P[k][0], P[k][1], P[k + 1][0], P[k + 1][1]);
    assert.ok(r, 'route ' + k);
    checkPath(G, m, r.pts);
  }
  // corner to corner across the whole floor
  const r = NAV.findPath(G, -34.5, -20.5, 34.5, 20.5);
  checkPath(G, m, r.pts);
  assert.ok(r.len < 1.25 * Math.hypot(69, 41), 'reasonable length ' + r.len);
});

/* ---------- plan ---------- */
function bFloor(key, w, d, { exitAt = null, elevs = [], extra = [] } = {}) {
  const hw = w / 2, hd = d / 2, T = 0.3, blocks = [];
  blocks.push(box(-hw, -hd, hw, -hd + T), box(-hw, -hd, -hw + T, hd), box(hw - T, -hd, hw, hd));
  if (exitAt == null) blocks.push(box(-hw, hd - T, hw, hd));
  else blocks.push(box(-hw, hd - T, exitAt - 1.5, hd), box(exitAt + 1.5, hd - T, hw, hd));
  const elevators = elevs.map(([id, x, z]) => { blocks.push(box(x - 1, z - 1, x + 1, z + 1)); return { id, x, z, a: Math.PI, pad: { x, z: z + 2.2, r: 1 } }; });
  blocks.push(...extra);
  return { key, w, d, blocks, posts: [], elevators, exit: exitAt == null ? null : { x: exitAt, z: hd - 1.2, a: Math.PI, r: 1.2 } };
}
function makeWorld(memoGrid = true) {
  const E1 = [['E-west', -30, -8], ['E-east', 25, -8]];
  const floors = {
    'B1-1': bFloor('B1-1', 72, 44, { exitAt: 0, elevs: E1 }),
    'B1-2': bFloor('B1-2', 72, 44, { elevs: E1, extra: [wall(-10, -21.7, -10, 10)] }),
    'B1-3': bFloor('B1-3', 72, 44, { elevs: E1 }),
    'B1-4': bFloor('B1-4', 72, 44, { elevs: [E1[0]] }),
    'B1-5': bFloor('B1-5', 72, 44, { elevs: [['Z', 0, 0]] }),
    'B2-1': bFloor('B2-1', 64, 48, { exitAt: 5, elevs: [['C', 0, -10]] }),
    'B2-2': bFloor('B2-2', 64, 48, { elevs: [['C', 0, -10]] }),
  };
  const campus = {
    key: 'campus', w: 220, d: 120,
    buildings: [
      { id: 'B1', name: 'Building 1', short: 'B1', x: -46, z: 0, w: 72, d: 44, floors: 5, h: 20, door: { x: -46, z: 23.2, a: Math.PI, r: 1.2 } },
      { id: 'B2', name: 'Building 2', short: 'B2', x: 46, z: 0, w: 64, d: 48, floors: 2, h: 8, door: { x: 51, z: 25.2, a: Math.PI, r: 1.2 } }],
    blocks: [box(-82, -22, -10, 22), box(14, -24, 78, 24), box(-5, 30, 5, 34)], posts: [{ x: 0, z: 25, r: 0.4, m: 7 }],
  };
  const world = { campus, floors };
  if (memoGrid) { const memo = new Map(); world.grid = k => { if (!memo.has(k)) memo.set(k, NAV.grid(k === 'campus' ? campus : floors[k])); return memo.get(k); }; }
  return world;
}
const first = l => l.pts[0], last = l => l.pts[l.pts.length - 1];

test('plan: same world is one leg with the arrive label', () => {
  const W = makeWorld();
  const r = NAV.plan(W, { w: 'B1-3', x: -20, z: 5 }, { w: 'B1-3', x: 20, z: 5, name: ' Silicon ' });
  assert.equal(r.legs.length, 1);
  assert.equal(r.legs[0].w, 'B1-3');
  assert.deepEqual(r.legs[0].end, { kind: 'dest', label: 'Arrive at Silicon' });
  near(r.len, r.legs[0].len);
  assert.equal(NAV.plan(W, { w: 'campus', x: 0, z: 40 }, { w: 'campus', x: 30, z: 40 }).legs[0].end.label, 'Arrive at destination');
});

test('plan: floor -> floor picks the elevator with the shortest TOTAL route', () => {
  const W = makeWorld();
  let r = NAV.plan(W, { w: 'B1-3', x: 22, z: 0 }, { w: 'B1-2', x: 20, z: 10 });
  assert.equal(r.legs.length, 2); assert.equal(r.legs[0].end.elev, 'E-east');
  r = NAV.plan(W, { w: 'B1-3', x: -27, z: 0 }, { w: 'B1-2', x: -25, z: 10 });
  assert.equal(r.legs[0].end.elev, 'E-west');
  // start is nearer the west elevator, but the destination is right by the east one
  r = NAV.plan(W, { w: 'B1-3', x: -5, z: 0 }, { w: 'B1-2', x: 24, z: 5 });
  assert.equal(r.legs[0].end.elev, 'E-east');
  const L0 = r.legs[0], L1 = r.legs[1];
  assert.deepEqual(L0.end, { kind: 'elev', to: 'B1-2', elev: 'E-east', label: 'Take the elevator to Floor 2' });
  const pad = W.floors['B1-3'].elevators[1].pad;
  assert.deepEqual(last(L0), [pad.x, pad.z]); assert.deepEqual(first(L1), [pad.x, pad.z]);
  assert.equal(L1.w, 'B1-2'); assert.equal(L1.end.kind, 'dest');
  near(r.len, L0.len + L1.len);
  // only E-west exists on floor 4
  r = NAV.plan(W, { w: 'B1-3', x: 22, z: 0 }, { w: 'B1-4', x: 20, z: 10 });
  assert.equal(r.legs[0].end.elev, 'E-west');
  assert.equal(r.legs[0].end.label, 'Take the elevator to Floor 4');
  // no shared elevator id -> null
  assert.equal(NAV.plan(W, { w: 'B1-3', x: 22, z: 0 }, { w: 'B1-5', x: 20, z: 10 }), null);
});

test('plan: building -> building leg sequence, continuity and labels', () => {
  const W = makeWorld();
  const r = NAV.plan(W, { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5, name: 'Silicon' });
  assert.ok(r, 'route');
  assert.deepEqual(r.legs.map(l => l.w), ['B1-3', 'B1-1', 'campus', 'B2-1', 'B2-2']);
  assert.deepEqual(r.legs.map(l => l.end.kind), ['elev', 'exit', 'enter', 'elev', 'dest']);
  assert.deepEqual(r.legs.map(l => l.end.label),
    ['Take the elevator to Floor 1', 'Head outside', 'Go into Building 2', 'Take the elevator to Floor 2', 'Arrive at Silicon']);
  const [a, b, c, d, e] = r.legs;
  const xz = p => [p.x, p.z], F = W.floors;
  assert.equal(a.end.to, 'B1-1'); assert.equal(a.end.elev, 'E-east');
  assert.equal(b.end.to, 'campus'); assert.equal(c.end.to, 'B2-1'); assert.equal(d.end.to, 'B2-2'); assert.equal(d.end.elev, 'C');
  assert.deepEqual(last(a), xz(F['B1-3'].elevators[1].pad)); assert.deepEqual(first(b), xz(F['B1-1'].elevators[1].pad));
  assert.deepEqual(last(b), xz(F['B1-1'].exit));
  assert.deepEqual(first(c), xz(W.campus.buildings[0].door)); assert.deepEqual(last(c), xz(W.campus.buildings[1].door));
  assert.deepEqual(first(d), xz(F['B2-1'].exit)); assert.deepEqual(last(d), xz(F['B2-1'].elevators[0].pad));
  assert.deepEqual(first(e), xz(F['B2-2'].elevators[0].pad)); assert.deepEqual(last(e), [10, 5]);
  assert.deepEqual(first(a), [20, 0]);
  near(r.len, r.legs.reduce((s, l) => s + l.len, 0));
  for (const l of r.legs) checkPath(W.grid(l.w), l.w === 'campus' ? W.campus : W.floors[l.w], l.pts, false);
});

test('plan: campus <-> floor, ground floor without elevator, missing pieces -> null', () => {
  const W = makeWorld();
  let r = NAV.plan(W, { w: 'campus', x: 0, z: 40 }, { w: 'B2-1', x: 0, z: 0, name: 'Lobby' });
  assert.deepEqual(r.legs.map(l => [l.w, l.end.kind]), [['campus', 'enter'], ['B2-1', 'dest']]);
  assert.deepEqual(first(r.legs[1]), [W.floors['B2-1'].exit.x, W.floors['B2-1'].exit.z]);
  r = NAV.plan(W, { w: 'B1-2', x: 0, z: 0 }, { w: 'campus', x: 0, z: 40 });
  assert.deepEqual(r.legs.map(l => [l.w, l.end.kind]), [['B1-2', 'elev'], ['B1-1', 'exit'], ['campus', 'dest']]);
  assert.deepEqual(first(r.legs[2]), [-46, 23.2]);
  r = NAV.plan(W, { w: 'B1-1', x: 0, z: 0 }, { w: 'B2-1', x: 0, z: 0 });
  assert.deepEqual(r.legs.map(l => l.end.kind), ['exit', 'enter', 'dest']);
  assert.equal(NAV.plan(W, { w: 'B1-1', x: 0, z: 0 }, { w: 'B3-1', x: 0, z: 0 }), null, 'unknown building');
  assert.equal(NAV.plan(W, { w: 'B1-9', x: 0, z: 0 }, { w: 'B1-1', x: 0, z: 0 }), null, 'unknown floor');
  const noDoor = makeWorld(); delete noDoor.campus.buildings[1].door;
  assert.equal(NAV.plan(noDoor, { w: 'B1-1', x: 0, z: 0 }, { w: 'B2-1', x: 0, z: 0 }), null, 'building without a door');
  const noExit = makeWorld(); noExit.floors['B2-1'].exit = null;
  assert.equal(NAV.plan(noExit, { w: 'B1-1', x: 0, z: 0 }, { w: 'B2-2', x: 0, z: 0 }), null, 'no exit pad');
  const sealed = makeWorld(); sealed.floors['B1-3'].blocks.push(wall(10, 0, 30, 0), wall(10, 15, 30, 15), wall(10, 0, 10, 15), wall(30, 0, 30, 15));
  assert.equal(NAV.plan(sealed, { w: 'B1-1', x: 0, z: 0 }, { w: 'B1-3', x: 20, z: 8 }), null, 'destination sealed off');
});

test('plan: works without world.grid, with a throwing world.grid, and with a Map of floors', () => {
  const ref = NAV.plan(makeWorld(), { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5 });
  const a = makeWorld(false);
  assert.deepEqual(NAV.plan(a, { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5 }), ref);
  const b = makeWorld(false); b.grid = () => { throw new Error('boom'); };
  assert.deepEqual(NAV.plan(b, { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5 }), ref);
  const c = makeWorld(false); c.floors = new Map(Object.entries(c.floors));
  assert.deepEqual(NAV.plan(c, { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5 }), ref);
});

test('determinism: identical routes from fresh copies of the same data', () => {
  const r1 = NAV.plan(makeWorld(), { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5, name: 'Silicon' });
  const r2 = NAV.plan(makeWorld(false), { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5, name: 'Silicon' });
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
  const m1 = deskFloor(), m2 = clone(m1);
  const p1 = NAV.findPath(NAV.grid(m1), -34, -12, 33, 12.5), p2 = NAV.findPath(NAV.grid(m2), -34, -12, 33, 12.5);
  assert.equal(JSON.stringify(p1), JSON.stringify(p2));
});

/* ---------- track / gates / sample ---------- */
test('track: monotonic along a route with hint chaining, exact off distance, ahead', () => {
  const m = room('t', 30, 14, [wall(-15, 0, 9, 0), box(-15, -7, 9, -3), box(-15, 3, 9, 7)]);
  const r = NAV.findPath(NAV.grid(m), -12, -1.5, -12, 1.5), leg = { w: 't', pts: r.pts, len: r.len };
  let hint = 0, prev = -1;
  const S = NAV.sample(r.pts, 0.25);
  assert.equal(S.length, Math.floor(r.len / 0.25) + 1);
  for (let k = 0; k < S.length; k++) {
    const p = { x: S[k].x, z: S[k].z, s: k * 0.25 }, t = NAV.track(leg, p.x, p.z, hint);
    assert.ok(t.along >= prev - 1e-9, 'monotonic');
    assert.ok(t.off < 1e-6, 'on the path');
    near(t.along + t.remain, r.len, 1e-9);
    near(t.along, p.s, 1e-6, 'along = arc length');
    prev = t.along; hint = t.i;
  }
  assert.ok(prev > r.len - 0.25 - 1e-9, 'reached the end');
  const s = NAV.track({ pts: [[0, 0], [10, 0]] }, 2, 0.5, 0);
  assert.deepEqual([s.i, s.along, s.remain, s.off], [0, 2, 8, 0.5]);
  assert.deepEqual(s.ahead, [5, 0]);
  assert.deepEqual(NAV.track({ pts: [[0, 0], [10, 0]] }, 9, 0).ahead, [10, 0], 'ahead clamps to the end');
  const e = NAV.track([[0, 0], [10, 0]], 12, 0);
  assert.deepEqual([e.along, e.remain, e.off], [10, 0, 2]);
});

test('track: hint keeps you on your side of a hairpin; full scan when > 3 m off', () => {
  const pts = [];
  for (let x = 0; x <= 20; x++) pts.push([x, 0]);
  pts.push([20, 1]);
  for (let x = 20; x >= 0; x--) pts.push([x, 2]);
  const leg = { pts };
  const h = NAV.track(leg, 5.3, 1.2, 5);
  assert.equal(h.i, 5); near(h.along, 5.3); near(h.off, 1.2);
  const f = NAV.track(leg, 5.3, 1.2);                     // no hint: global nearest (return lane)
  near(f.off, 0.8); near(f.along, 22 + 14.7);
  const j = NAV.track(leg, 15, 2.1, 1);                   // hint far away (> 3 m) -> full scan
  near(j.off, 0.1); near(j.along, 22 + 5);
});

test('gates: spacing, 4 m from start/finish, finish = last point, travel yaw', () => {
  let g = NAV.gates([[0, 0], [0, -35]]);
  assert.deepEqual(g.map(q => -q.z), [10, 20, 30, 35]);
  for (const q of g) { near(q.x, 0); assert.equal(q.a, 0); }
  g = NAV.gates([[0, 0], [0, -33]], 10);
  assert.deepEqual(g.map(q => -q.z), [10, 20, 33]);
  g = NAV.gates([[0, 0], [20, 0]], 3);
  assert.deepEqual(g.map(q => +q.x.toFixed(9)), [6, 9, 12, 15, 20]);
  for (const q of g) near(q.a, -Math.PI / 2);
  // loop back toward the start: the gate that lands within 4 m of the start is skipped
  g = NAV.gates([[0, 0], [10, 0], [10, 1], [-10, 1]], 5);
  assert.deepEqual(g.map(q => [+q.x.toFixed(9), +q.z.toFixed(9)]), [[5, 0], [10, 0], [6, 1], [-4, 1], [-10, 1]]);
  assert.equal(g[1].a, Math.PI, 'gate on a vertex faces the outgoing segment (south)');
  near(g[4].a, Math.PI / 2, 1e-12, 'finish faces west');
  const L = NAV.gates([[0, 0], [0, 10], [10, 10]], 10);
  assert.deepEqual(L.map(q => [q.x, q.z, q.a]), [[0, 10, -Math.PI / 2], [10, 10, -Math.PI / 2]]);
  assert.deepEqual(NAV.gates([[0, 0], [0, 2]]).map(q => [q.x, q.z, q.a]), [[0, 2, Math.PI]], 'short path: finish only, south = PI');
});

test('sample: spacing along arc length, offset, yaw', () => {
  let s = NAV.sample([[0, 0], [10, 0]]);
  assert.equal(s.length, 9);
  s.forEach((p, k) => { near(p.x, k * 1.2, 1e-9); assert.equal(p.z, 0); near(p.a, -Math.PI / 2); });
  s = NAV.sample([[0, 0], [10, 0]], 1.2, 0.5);
  assert.deepEqual(s.map(p => +p.x.toFixed(6)), [0.5, 1.7, 2.9, 4.1, 5.3, 6.5, 7.7, 8.9]);
  assert.deepEqual(NAV.sample([[0, 0], [10, 0]], 1.2, -0.7).map(p => +p.x.toFixed(6)), [0.5, 1.7, 2.9, 4.1, 5.3, 6.5, 7.7, 8.9]);
  s = NAV.sample([[0, 0], [0, -5], [5, -5]], 1);   // north then east
  assert.equal(s.length, 11);
  assert.deepEqual(s.map(p => [+p.x.toFixed(9), +p.z.toFixed(9)]).slice(4, 7), [[0, -4], [0, -5], [1, -5]]);
  assert.equal(s[4].a, 0); near(s[5].a, -Math.PI / 2); near(s[10].a, -Math.PI / 2);
  for (const p of s) { const fx = -Math.sin(p.a), fz = -Math.cos(p.a); assert.ok(fx >= -1e-9 && fz <= 1e-9, 'forward follows travel'); }
  assert.deepEqual(NAV.sample([[0, 0], [0, 3]], 1).map(p => p.a), [Math.PI, Math.PI, Math.PI, Math.PI]);
  assert.deepEqual(NAV.sample([[0, 0], [-3, 0]], 1).map(p => p.a), [Math.PI / 2, Math.PI / 2, Math.PI / 2, Math.PI / 2]);
});

/* ---------- robustness ---------- */
test('bad input never throws', () => {
  for (const m of [null, undefined, 5, 'x', {}, { w: 'x', d: 3 }, { w: -1, d: 5 }, { w: 10, d: 10, blocks: 'no', posts: { a: 1 } }]) {
    const G = NAV.grid(m);
    assert.ok(G.block instanceof Uint8Array && G.block.length === G.nx * G.nz);
    if (m && m.w === 10) assert.ok(NAV.findPath(G, 0, 0, 1, 1)); else assert.equal(NAV.findPath(G, 0, 0, 1, 1), null);
  }
  const messy = { key: 'm', w: 20, d: 12, blocks: [null, 7, { x0: NaN, x1: 1, z0: 0, z1: 1 }, { x0: '1', x1: 2, z0: 0, z1: 1 }, { x0: 3, x1: 1, z0: 2, z1: -2 }, { x0: 5, x1: 6, z0: 0, z1: 1 }],
    posts: [null, { x: 1 }, { x: 0, z: 4, r: -2 }, { x: -5, z: 4, r: NaN, m: 1 }, { x: 1e308, z: -1e308, r: 1e308 }] };
  const G = NAV.grid(messy);
  assert.equal(G.block[cellAt(G, 2, 0)], 1, 'swapped corners still block');
  assert.equal(G.block[cellAt(G, 5.5, 0.5)], 1, 'missing mask counts as solid');
  assert.equal(G.block[cellAt(G, 0, 4)], 1, 'negative radius = point post');
  assert.equal(G.block[cellAt(G, 5, -3)], 0, 'absurd far-away post does not overflow into the plate');
  assert.ok(NAV.findPath(G, -8, -4, 8, 4));
  const inf = NAV.grid({ w: 10, d: 10, key: Symbol('k'), blocks: [{ x0: 2, x1: 1e300, z0: -1, z1: 1, m: 7 }] });
  assert.equal(inf.key, '');
  assert.equal(inf.block[cellAt(inf, 4, 0)], 1, 'huge block is clamped, still blocks');
  assert.equal(inf.block[cellAt(inf, 0, 0)], 0);
  assert.equal(NAV.grid({ w: 1e9, d: 1e9 }).block.length <= 4e6, true, 'huge plate gets a coarser grid');
  for (const args of [[null, 0, 0, 1, 1], [{}, 0, 0, 1, 1], [G, NaN, 0, 1, 1], [G, 0, 0, Infinity, 1], [{ block: [1], nx: 1, nz: 1 }, 0, 0, 0, 0]]) assert.equal(NAV.findPath(...args), null);
  const W = makeWorld();
  for (const [w, a, b] of [[null], [{}], [W, null, null], [W, { w: 'B1-3' }, { w: 'B1-3', x: 0, z: 0 }], [W, { w: 3, x: 0, z: 0 }, { w: 'B1-3', x: 0, z: 0 }],
    [W, { w: '__proto__', x: 0, z: 0 }, { w: 'B1-1', x: 0, z: 0 }], [W, { w: 'campus', x: NaN, z: 0 }, { w: 'B1-1', x: 0, z: 0 }], [{ floors: 5, campus: 'x' }, { w: 'B1-1', x: 0, z: 0 }, { w: 'B2-1', x: 0, z: 0 }]]) {
    assert.equal(NAV.plan(w, a, b), null);
  }
  const junk = makeWorld(false);
  junk.floors['B1-3'].elevators.push(null, { id: 'E-east' }, { id: null, x: 1, z: 1 }, { x: 1, z: 1, pad: 'x' });
  junk.campus.buildings.push(null, 'B9');
  assert.ok(NAV.plan(junk, { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5 }), 'junk entries are skipped');
  assert.equal(NAV.plan(junk, { w: 'B1-3', x: 20, z: 0 }, { w: 'B2-2', x: 10, z: 5, name: { toString() { throw new Error('x'); } } }), null);
  assert.deepEqual(NAV.track(null, 1, 2), { i: 0, along: 0, remain: 0, off: Infinity, ahead: [1, 2] });
  assert.equal(NAV.track({ pts: [] }, 1, 2).off, Infinity);
  assert.equal(NAV.track({ pts: [[0, 0]] }, 3, 4).off, 5);
  assert.equal(NAV.track({ pts: [[0, 0], [1, 0]] }, NaN, 4).off, Infinity);
  assert.equal(NAV.track({ pts: [[0, 0], [10, 0]] }, 3, 0, 99).along, 3, 'out-of-range hint');
  assert.deepEqual(NAV.gates(null), []); assert.deepEqual(NAV.gates([]), []);
  assert.deepEqual(NAV.gates([[1, 2]]), [{ x: 1, z: 2, a: 0 }]);
  assert.deepEqual(NAV.gates([[0, 0], [0, 0]]), [{ x: 0, z: 0, a: 0 }]);
  assert.equal(NAV.gates([[0, 0], [0, -100]], 0).length, 10, 'bad spacing -> default 10');
  assert.deepEqual(NAV.sample('x'), []); assert.deepEqual(NAV.sample(null, 1), []);
  assert.deepEqual(NAV.sample([[0, 0], [NaN, 1], { x: 10, z: 0 }], 5).map(p => p.x), [0, 5, 10], 'skips bad points, accepts {x,z}');
  assert.equal(NAV.sample([[0, 0], [1000, 0]], 0.0001).length <= 20000, true);
  assert.equal(NAV.sample([[0, 0], [10, 0]], 1, 50).length, 0);
});

test('performance: 72x44 floor, ~300 desks + 1200 posts: grid < 30 ms, same-floor plan < 15 ms', () => {
  const base = deskFloor();
  assert.ok(base.blocks.length >= 300 && base.posts.length >= 1200);
  for (let k = 0; k < 3; k++) NAV.grid(clone(base));   // warm up
  const times = [];
  let model = null;
  for (let k = 0; k < 3; k++) { const m = clone(base), t0 = performance.now(); NAV.grid(m); times.push(performance.now() - t0); model = m; }
  const gridMs = Math.min(...times);
  const world = { floors: { 'B1-3': model }, campus: null };
  const P = aislePoints(40, 11);
  for (let k = 0; k < 6; k++) NAV.plan(world, { w: 'B1-3', x: P[k][0], z: P[k][1] }, { w: 'B1-3', x: P[k + 1][0], z: P[k + 1][1] });
  const pt = [];
  for (let k = 0; k + 1 < P.length; k += 2) {
    const t0 = performance.now();
    const r = NAV.plan(world, { w: 'B1-3', x: P[k][0], z: P[k][1] }, { w: 'B1-3', x: P[k + 1][0], z: P[k + 1][1] });
    pt.push(performance.now() - t0);
    assert.ok(r, 'route');
  }
  const t0 = performance.now();
  assert.ok(NAV.plan(world, { w: 'B1-3', x: -34.5, z: -20.5 }, { w: 'B1-3', x: 34.5, z: 20.5 }));
  pt.push(performance.now() - t0);
  pt.sort((a, b) => a - b);
  const med = pt[pt.length >> 1], p90 = pt[Math.floor(pt.length * 0.9)], max = pt[pt.length - 1];
  console.log(`     grid ${gridMs.toFixed(2)} ms; plan median ${med.toFixed(2)} ms, p90 ${p90.toFixed(2)} ms, max ${max.toFixed(2)} ms`);
  assert.ok(gridMs < 30, 'grid build ' + gridMs);
  assert.ok(p90 < 15, 'plan p90 ' + p90);
  assert.ok(max < 30, 'plan max ' + max);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
