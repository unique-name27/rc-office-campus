// Avatar skills: runs the game's own physics (carStep in game-3-play.js) with the world stubbed out: a flat floor,
// no walls, no chairs. Checks the cat's double jump, the jump buffer, the car's charged drift and turbo, the boost
// lockout, and that countdowns (park) and spawn leave no skill behind.
// usage: node src/tests/skills.test.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'game-3-play.js'), 'utf8');
const cut = (from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + 1); assert(i >= 0 && j > i, 'cannot find ' + from); return src.slice(i, j) };
const code = [
  cut('function newCar', '\nconst PAINTS'),
  cut('function spawn', 'function smokeCol'),
  cut('function airJump', '// what everyone sees and hears'),
].join('\n');

function world(opt) {
  const calls = [], chairs = (opt && opt.chairs) || [], bot = { x: 99, z: 99, y: 0, vx: 0, vz: 0, rev: 0 };
  const env = {
    groundY: () => 0, query: () => (opt && opt.desk ? [opt.desk] : []), chairsNear: () => chairs, circleVs: () => false, HIT: {}, CHR: .27, chairCell() {}, dirtyChairs: new Set(),
    puff() {}, spark() {}, smokeCol: () => '#fff', toastAir() {}, bumpedChair() {}, pop() {},
    clamp: (v, a, b) => v < a ? a : v > b ? b : v, angDiff: (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a)),
    PW: 200, PD: 200, WKIND: 'floor', H: 3, REDUCED: true, bot, BOTPATH: [[0, 0], [1, 1]],
    SFX: new Proxy({}, { get: (_, k) => (...a) => calls.push(['SFX.' + k, ...a]) }),
    skillFx: (c, ev, vol, tier) => calls.push(['fx', ev, tier]),
    PHYS: { blast: (...a) => calls.push(['blast', ...a]) },
    FX: { crash: (...a) => calls.push(['FX.crash', ...a]), land: (...a) => calls.push(['FX.land', ...a]) },
  };
  const names = Object.keys(env);
  const api = new Function(...names, '"use strict";let presDirty=false;\n' + code + '\n;return {newCar,spawn,carStep,woofAt,IDLE,AVP,G};')(...names.map(n => env[n]));
  return Object.assign(api, { calls, chairs, bot });
}
const DT = 1 / 120;
const ctl = o => Object.assign({ thr: 0, steer: 0, boost: false, drift: false, jumpHeld: false, park: false }, o || {});
// run for t seconds; fn(c, time) may change the controls (return a new ctl) each step; returns the highest y reached
function run(W, c, t, controls, fn) {
  let ct = controls, top = c.y, time = 0;
  for (let i = 0; i < Math.round(t / DT); i++) { if (fn) ct = fn(c, time) || ct; W.carStep(c, ct, DT, true); top = Math.max(top, c.y); time += DT }
  return top;
}
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++ } catch (e) { fail++; console.log('FAIL', name, '\n ', e.message) } }
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(3)} not within ${tol} of ${b}`);

test('cat: a second press shortly after take-off reaches about 1.79 m', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'cat');
  c.jumpReq = true;
  const top = run(W, c, 2, ctl(), (c, t) => { if (Math.abs(t - .05) < DT / 2) c.jumpReq = true });
  near(top, 1.79, .04, 'peak');
  assert.strictEqual(c.y, 0, 'landed'); assert.strictEqual(c.airJumps, 0, 'air jumps reset on landing');
});
test('cat: a second press at the top also adds .75 m', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'cat');
  c.jumpReq = true; let pressed = false;
  const top = run(W, c, 2, ctl(), c => { if (!pressed && c.air && c.vy <= 0) { c.jumpReq = true; pressed = true } });
  near(top, 25 / 24 + .75, .04, 'peak');
});
test('cat: holding jump doubles by itself; a third press does nothing', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'cat');
  c.jumpReq = true;
  const top = run(W, c, 2.2, ctl({ jumpHeld: true }), (c, t) => { if (Math.abs(t - .6) < DT / 2) c.jumpReq = true });
  near(top, 1.79, .05, 'peak while holding');
  assert.strictEqual(W.calls.filter(x => x[1] === 'jump2').length, 1, 'exactly one air jump');
});
test('cat: landing from a double jump is soft (no thud)', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'cat');
  c.jumpReq = true; run(W, c, 2.2, ctl({ jumpHeld: true }));
  assert(!W.calls.some(x => x[0] === 'SFX.land'), 'no hard landing');
});
test('cat: the floor ceiling stops a double jump from a high perch', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'cat');
  c.y = c.gPrev = 1.6; c.air = true; c.hop = true; c.vy = 5;
  const top = run(W, c, .5, ctl({ jumpHeld: true }));
  assert(top <= 3 - .05 - .45 + 1e-9, 'stays under the ceiling, peak ' + top.toFixed(3));
});
test('car and dog: a press in the air adds no height, but one just before landing jumps on landing', () => {
  for (const kind of ['car', 'dog']) {
    const W = world(), c = W.newCar(0, 0, 0, '#fff', kind);
    c.jumpReq = true; const P = W.AVP[kind], plain = P.jump * P.jump / (2 * W.G);
    let top = run(W, c, .2, ctl()); c.jumpReq = true; top = Math.max(top, run(W, c, 1.4, ctl()));
    near(top, plain, .03, kind + ' peak with an extra air press');
    // fall from a height: press .15 s before touching down -> a new jump right after landing
    const d = W.newCar(0, 0, 0, '#fff', kind); d.y = d.gPrev = 1; d.air = true;
    const tLand = Math.sqrt(2 / W.G);
    let jumped = false;
    run(W, d, tLand + .3, ctl(), (c, t) => { if (Math.abs(t - (tLand - .15)) < DT / 2) c.jumpReq = true; if (t > tLand + .05 && c.vy > 1) jumped = true });
    assert(jumped, kind + ': buffered press jumps on landing');
    const e = W.newCar(0, 0, 0, '#fff', kind); e.y = e.gPrev = 1; e.air = true; jumped = false;
    run(W, e, tLand + .3, ctl(), (c, t) => { if (Math.abs(t - (tLand - .5)) < DT / 2) c.jumpReq = true; if (t > tLand + .05 && c.vy > 1) jumped = true });
    assert(!jumped, kind + ': a press .5 s early is forgotten');
  }
});
// a car rolling forward at speed v (heading 0 = facing -z)
const rolling = (W, v) => { const c = W.newCar(0, 0, 0, '#fff', 'car'); c.vz = -v; c.vF = v; return c };
test('car: holding drift fires the big turbo by itself at 1.4 s', () => {
  const W = world(), c = rolling(W, 6);
  let fired = null;
  run(W, c, 1.6, ctl({ thr: 1, steer: .8, drift: true }), (c, t) => { if (fired == null && W.calls.some(x => x[1] === 'turbo')) fired = t });
  assert(fired != null, 'turbo fired');
  near(fired, 1.4, .05, 'fires at');
  assert.strictEqual(W.calls.find(x => x[1] === 'turbo')[2], 2, 'tier 2');
  assert(c.driftCd >= 0, 'cooldown set');
});
test('car: holding drift through a long bend chains the next charge', () => {
  const W = world(), c = rolling(W, 7);
  run(W, c, 3.4, ctl({ thr: 1, steer: .8, drift: true }));
  assert(W.calls.filter(x => x[1] === 'turbo').length >= 2, 'two turbos in 3.4 s');
  assert(Math.hypot(c.vx, c.vz) <= W.AVP.car.bmax + 1.5 + 1e-6, 'never past 13 m/s');
});
test('car: letting go after 1 s gives the small turbo, after .5 s nothing', () => {
  for (const [hold, want] of [[1, 1], [.5, 0]]) {
    const W = world(), c = rolling(W, 6);
    run(W, c, hold, ctl({ thr: 1, steer: .8, drift: true }));
    const before = Math.hypot(c.vx, c.vz);
    run(W, c, DT * 2, ctl({ thr: 1, steer: 0, drift: false }));
    const t = W.calls.filter(x => x[1] === 'turbo');
    if (want) { assert.strictEqual(t.length, 1); assert.strictEqual(t[0][2], 1, 'tier 1'); assert(Math.hypot(c.vx, c.vz) > before + 2, 'faster by about 2.6') }
    else assert.strictEqual(t.length, 0, 'no turbo after .5 s');
  }
});
test('car: a drift that is stopped (a wall) pays nothing', () => {
  const W = world(), c = rolling(W, 6);
  run(W, c, 1.1, ctl({ thr: 1, steer: .8, drift: true }));
  c.vx = c.vz = 0; c.vF = 0;
  run(W, c, .2, ctl({ thr: 0, steer: .8, drift: true }));
  assert(!W.calls.some(x => x[1] === 'turbo'), 'no turbo'); assert(!c.drift, 'drift over');
});
test('boost: an empty meter locks until it has refilled to a quarter', () => {
  const W = world(), c = rolling(W, 5);
  let flips = 0, last = null, lockedAt = null, freeAt = null;
  run(W, c, 4.9, ctl({ thr: 1, boost: true }), (c, t) => { if (t > .1 && last !== null && c.boosting !== last) { flips++; if (!c.boosting) lockedAt = t; else freeAt = t } last = c.boosting });
  assert(lockedAt != null, 'ran dry'); assert.strictEqual(flips, 2, 'off once, back on once (no flicker)');
  near(freeAt - lockedAt, (.25 - .02) / .11, .1, 'locked for'); // from about empty back to a quarter
});
test('park (countdowns): pending jumps and woofs are dropped', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'dog');
  c.jumpReq = true; c.woofReq = true; W.carStep(c, W.IDLE, DT, true);
  run(W, c, .5, ctl());
  assert.strictEqual(c.y, 0, 'no jump'); assert(!W.calls.some(x => x[1] === 'woof'), 'no woof');
});
test('dog: spamming bark woofs at most every 1.5 s', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'dog');
  let n = 0; const at = []; run(W, c, 3.6, ctl(), (c, t) => { if (n++ % 60 === 0) c.woofReq = true; if (W.calls.filter(x => x[1] === 'woof').length > at.length) at.push(t) }); // a press every .5 s
  assert(at.length >= 2 && at.length <= 3, 'woofs: ' + at.length);
  for (let i = 1; i < at.length; i++) assert(at[i] - at[i - 1] >= 1.49, 'gap ' + (at[i] - at[i - 1]).toFixed(2));
});
test('spawn clears every skill state', () => {
  const W = world(), c = rolling(W, 6);
  Object.assign(c, { driftT: 1, driftTier: 1, driftCd: .2, turboT: .5, turboPend: 2, boostLock: true, jumpBuf: .1, airJumps: 1, flipT: .3, woofReq: true, woofCd: 1, woofT: .2 });
  W.spawn(c, 0, 0, 0);
  for (const k of ['driftT', 'driftTier', 'driftCd', 'turboT', 'turboPend', 'jumpBuf', 'airJumps', 'flipT', 'woofCd', 'woofT']) assert.strictEqual(c[k], 0, k);
  assert.strictEqual(c.boostLock, false); assert.strictEqual(c.woofReq, false);
});
test('dog: woofs push chairs outward but repeated woofs do not stack', () => {
  const ch = { x: 1, z: 0, vx: 0, vz: 0, va: 0 }, W = world({ chairs: [ch] });
  W.woofAt(0, 0, null);
  const v1 = Math.hypot(ch.vx, ch.vz);
  near(v1, 1 + 3 * (1 - 1 / 2.4), 1e-9, 'push at 1 m'); assert(ch.vx > 0, 'outward');
  for (let i = 0; i < 20; i++) W.woofAt(0, 0, null);
  near(Math.hypot(ch.vx, ch.vz), v1, 1e-9, 'speed after 21 woofs'); assert(Math.abs(ch.va) <= 6, 'spin capped');
  W.bot.x = 1; W.bot.z = 0; for (let i = 0; i < 10; i++) W.woofAt(0, 0, null);
  near(Math.hypot(W.bot.vx, W.bot.vz), 2, 1e-9, 'Mailbot pushed at 2 m/s, not more');
});
test('cat: holding jump under a desk does not waste the air jump on the bump', () => {
  const W = world({ desk: { u: .72, h: .76, x0: -1, x1: 1, z0: -1, z1: 1 } }), c = W.newCar(0, 0, 0, '#fff', 'cat');
  c.jumpReq = true; const top = run(W, c, .8, ctl({ jumpHeld: true }));
  assert(top <= .72 - .45 + .02, 'stays under the desk, peak ' + top.toFixed(3));
  assert(!W.calls.some(x => x[1] === 'jump2'), 'no air jump fired');
});
test('a hard landing tells FX (desk scatter) only for the player, with the landing speed', () => {
  const W = world(), c = W.newCar(0, 0, 0, '#fff', 'dog');
  c.y = c.gPrev = 2.5; c.air = true; c.vy = 0; run(W, c, 1.2, ctl());
  const fx = W.calls.filter(x => x[0] === 'FX.land'), snd = W.calls.filter(x => x[0] === 'SFX.land');
  assert.strictEqual(fx.length, 1, 'one FX.land'); assert.strictEqual(snd.length, 1, 'one thud');
  assert(fx[0][1] > 2.4 && Math.abs(fx[0][1] - snd[0][1]) < 1e-9 && fx[0][2] === c, 'same speed, this car');
  const W2 = world(), b = W2.newCar(0, 0, 0, '#fff', 'dog');
  b.y = b.gPrev = 2.5; b.air = true; b.vy = 0;
  for (let i = 0; i < Math.round(1.2 / DT); i++) W2.carStep(b, ctl(), DT, false);
  assert(!W2.calls.some(x => x[0] === 'FX.land' || x[0] === 'SFX.land'), 'a bot or remote car landing hard does not');
});
console.log(`skills: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
