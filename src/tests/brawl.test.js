// BRAWL tests: node src/tests/brawl.test.js
const assert = require('node:assert/strict');
const BRAWL = require('./load')('brawl.js', 'BRAWL');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String((e && e.stack) || e).split('\n').slice(0, 5).join('\n     ')); }
}
// an open 20 x 20 m room with one wall at x = 5 (from z = -10 to 10)
const room = { blocked: (x, z, r) => Math.abs(x) > 10 - r || Math.abs(z) > 10 - r || Math.abs(x - 5) < r, ground: () => 0, target: () => null };

test('items: every roll is a known item, weights favor the trailing players with planes', () => {
  const lead = {}, back = {};
  for (let i = 0; i < 5000; i++) { const u = i / 5000; lead[BRAWL.rollItem(u, false)] = (lead[BRAWL.rollItem(u, false)] || 0) + 1; back[BRAWL.rollItem(u, true)] = (back[BRAWL.rollItem(u, true)] || 0) + 1 }
  for (const [k] of BRAWL.ITEMS) { assert.ok(lead[k] > 0, k); assert.ok(back[k] > 0, k); assert.ok(BRAWL.ITEM[k].n) }
  assert.ok(back.plane > lead.plane * 1.5, 'planes ' + lead.plane + ' -> ' + back.plane);
  assert.equal(BRAWL.ITEM.bunch.uses, 3); assert.equal(BRAWL.ITEM.banana.uses, 1);
  assert.ok(BRAWL.ITEMS.some(it => it[0] === BRAWL.rollItem(.9999, false)));
  assert.equal(BRAWL.rollItem(-1, false), BRAWL.ITEMS[0][0]);
});

test('crate spots: same on every client, spaced apart, at most n', () => {
  const c = []; for (let x = -9; x <= 9; x += 1.5) for (let z = -9; z <= 9; z += 1.5) c.push([x, z]);
  const a = BRAWL.crateSpots('B1-2', c, 8, 5), b = BRAWL.crateSpots('B1-2', c.slice().reverse(), 8, 5);
  assert.equal(a.length, 8);
  assert.deepEqual(a.slice().sort(), b.slice().sort(), 'candidate order does not matter');
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]) >= 5);
  assert.notDeepEqual(BRAWL.crateSpots('B2-3', c, 8, 5), a, 'another floor gets other spots');
  assert.deepEqual(BRAWL.crateSpots('x', [[NaN, 1], null, [1, 2]], 4, 1), [[1, 2]]);
});

test('a thrown banana arcs forward and lands as a peel', () => {
  const p = BRAWL.launch('nana', { x: 0, y: 0, z: 0, h: 0, vF: 0 }, 1);
  assert.equal(p.k, 'nana'); assert.ok(p.vz < 0, 'heading 0 faces -z');
  let t = 0; while (p.k === 'nana' && t < 3) { assert.ok(BRAWL.step(p, 1 / 60, room)); t += 1 / 60 }
  assert.equal(p.k, 'peel'); assert.equal(p.y, 0);
  assert.ok(p.z < -5 && p.z > -9.6, 'lands a few meters ahead: ' + p.z);
  assert.ok(Math.abs(p.x) < 1e-9);
});

test('a dropped peel sits behind the car and expires', () => {
  const p = BRAWL.launch('nana', { x: 1, y: 0, z: 1, h: Math.PI / 2, vF: 3 }, 2, true);
  assert.equal(p.k, 'peel'); assert.ok(p.x > 1.3, 'facing -x, so behind is +x: ' + p.x);
  assert.ok(BRAWL.step(p, 1, room));
  assert.equal(BRAWL.step(p, 31, room), false);
});

test('a paper ball bounces off walls and is spent after its bounces', () => {
  const p = BRAWL.launch('ball', { x: 0, y: 0, z: 0, h: -Math.PI / 2, vF: 0 }, 3); // facing +x, toward the wall at x = 5
  assert.ok(p.vx > 0);
  let alive = true, bounced = false, t = 0;
  while (alive && t < 4) { const vx = p.vx; alive = BRAWL.step(p, 1 / 60, room); if (alive && Math.sign(p.vx) !== Math.sign(vx)) bounced = true; t += 1 / 60 }
  assert.ok(bounced, 'it came back off the wall');
  assert.ok(p.n > BRAWL.PJ.ball.bounces || t >= BRAWL.PJ.ball.life, 'spent by bounces or time');
  for (let i = 0; i < 400; i++) assert.ok(!(Math.abs(p.x - 5) < .13) || !alive);
});

test('a paper plane turns toward its target and dies on a wall', () => {
  const env = Object.assign({}, room, { target: () => ({ x: -8, z: 0 }) });
  const p = BRAWL.launch('plane', { x: 0, y: 0, z: 0, h: 0, vF: 0 }, 4);
  for (let i = 0; i < 60; i++) BRAWL.step(p, 1 / 60, env);
  assert.ok(p.vx < 0, 'turning toward -x');
  let alive = true, n = 0; while (alive && n++ < 600) alive = BRAWL.step(p, 1 / 60, env);
  assert.equal(alive, false);
  assert.ok(p.y > .3 && p.y < .6);
});

test('touches and arming', () => {
  const p = { k: 'peel', x: 0, y: 0, z: 0, t: 0 };
  assert.ok(BRAWL.touches(p, { x: .3, y: 0, z: 0, r: .155, tall: .2 }));
  assert.ok(!BRAWL.touches(p, { x: .5, y: 0, z: 0, r: .155 }));
  assert.ok(!BRAWL.touches(p, { x: 0, y: 1.2, z: 0, r: .155, tall: .2 }), 'jumped over it');
  assert.ok(!BRAWL.armed(p, true)); p.t = 1.2; assert.ok(BRAWL.armed(p, true));
  assert.ok(BRAWL.armed({ k: 'ball', t: 0 }, false), 'others are hit at once');
  assert.ok(!BRAWL.touches({ k: 'boom', x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
});

test('hits: hearts, spin, invulnerability, the bubble, KO and respawn', () => {
  let s = BRAWL.fresh(0);
  assert.equal(s.hp, 3);
  assert.equal(BRAWL.hit(s, 1).took, false, 'still invulnerable after joining');
  let r = BRAWL.hit(s, 10); assert.ok(r.took && !r.ko); s = r.state; assert.equal(s.hp, 2); assert.ok(s.spinUntil > 10);
  assert.equal(BRAWL.hit(s, 11).took, false, 'invulnerable right after a hit');
  s = Object.assign({}, s, { bubbleUntil: 30 });
  r = BRAWL.hit(s, 20); assert.ok(r.blocked && !r.took); s = r.state; assert.equal(s.hp, 2); assert.equal(s.bubbleUntil, 0);
  r = BRAWL.hit(s, 25); s = r.state; r = BRAWL.hit(s, 40); assert.ok(r.ko); s = r.state;
  assert.equal(s.hp, 0); assert.ok(s.outUntil > 40);
  assert.equal(BRAWL.hit(s, 41).took, false, 'no hits while knocked out');
  s = BRAWL.respawn(s, 43); assert.equal(s.hp, 3); assert.equal(s.outUntil, 0);
});

test('presence: encode, then read back only what is valid', () => {
  const st = Object.assign(BRAWL.fresh(0), { sc: 4, kos: 1, bubbleUntil: 50 });
  const pj = [BRAWL.launch('ball', { x: 1, y: 0, z: 2, h: 0, vF: 3 }, 7)];
  const e = BRAWL.enc(st, 10, 'bunch', 2, pj, [['k3v6q2rt7wacd4fn', 5, 1]]);
  assert.ok(JSON.stringify(e).length < 400);
  const v = BRAWL.validBw(JSON.parse(JSON.stringify(e)));
  assert.equal(v.hp, 3); assert.equal(v.sc, 4); assert.equal(v.ko, 1); assert.equal(v.it, 'bunch'); assert.equal(v.n, 2); assert.equal(v.sh, 1);
  assert.equal(e.iv, 0, 'no longer invulnerable 10 s in'); assert.equal(v.iv, 0); assert.equal(e.tk, 10);
  assert.equal(BRAWL.enc(st, 1, null, 0, [], []).iv, 1, 'invulnerable just after joining');
  assert.equal(BRAWL.enc(st, 3, null, 0, [], []).tk, 3, 'the heartbeat ticks every second');
  assert.equal(v.pj.length, 1); assert.equal(v.pj[0].k, 'ball'); assert.equal(v.pj[0].i, 7);
  assert.deepEqual(v.hb, [['k3v6q2rt7wacd4fn', 5, 1]]);
  assert.equal(BRAWL.validBw(null), null); assert.equal(BRAWL.validBw({ hp: 9 }), null); assert.equal(BRAWL.validBw([]), null);
  const bad = BRAWL.validBw({ hp: 2, it: 'rocket', n: 99, iv: 'yes', pj: [[1, 'nuke', 0, 0, 0, 0, 0], [2, 'ball', 1e9, 0, 0, 0, 0], 'x', [3, 'peel', 1, 0, 1, 0, 0]], hb: [['<script>', 1, 1], ['ok', 'x', 0], ['ok', 2, 0]] });
  assert.equal(bad.iv, 0);
  assert.deepEqual(BRAWL.validBw({ hp: 1, hb: [['a', 1, 2], ['b', 2, 7]] }).hb, [['a', 1, 2], ['b', 2, 0]], 'blocks keep their flag, junk flags are plain hits');
  assert.equal(bad.it, null); assert.equal(bad.n, 0);
  assert.deepEqual(bad.pj.map(p => p.i), [3]);
  assert.deepEqual(bad.hb, [['ok', 2, 0]]);
  const many = BRAWL.enc(st, 10, null, 0, Array.from({ length: 30 }, (_, i) => BRAWL.launch('peel', { x: i / 10, y: 0, z: 0, h: 0 }, i)), Array.from({ length: 30 }, (_, i) => ['p', i, 0]));
  assert.ok(many.pj.length <= BRAWL.MAX_PJ && many.hb.length <= 8);
  assert.ok(JSON.stringify(many).length < 1200, 'stays well inside presence limits: ' + JSON.stringify(many).length);
});

test('credits: each acknowledged hit counts once, only for its thrower, only for throws they made', () => {
  const counted = new Set();
  const others = [['amy', { hb: [['me', 1, 0], ['bob', 2, 0]] }], ['cal', { hb: [['me', 1, 1], ['me', 9, 0], ['me', 4, 2]] }], ['dan', null]];
  const c1 = BRAWL.credits('me', others, counted, new Set([1, 4]));
  assert.deepEqual(c1, [{ victim: 'amy', id: 1, ko: false, blocked: false }, { victim: 'cal', id: 1, ko: true, blocked: false }, { victim: 'cal', id: 4, ko: false, blocked: true }]);
  assert.deepEqual(BRAWL.credits('me', others, counted, new Set([1, 4])), [], 'not again');
  assert.equal(BRAWL.credits('me', others, new Set()).length, 4, 'without a list of my throws, every claim counts');
});

test('standings: KOs first, then hits', () => {
  assert.deepEqual(BRAWL.standings([{ id: 'a', sc: 9, ko: 0 }, { id: 'b', sc: 1, ko: 2 }, { id: 'c', sc: 3, ko: 2 }]).map(x => x.id), ['c', 'b', 'a']);
});

console.log(`brawl: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
