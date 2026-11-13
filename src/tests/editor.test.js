// node v4/tests/editor.test.js — pure logic of the floor editor (EDITOR._t). Single process, < 1 s.
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const load = require('./load');

let pass = 0, fail = 0, skip = 0;
function test(name, fn){
  try { fn(); pass++; }
  catch (e){ fail++; console.log('FAIL ' + name + '\n   ' + (e && e.message || e).split('\n').join('\n   ')); }
}
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` expected ${b}, got ${a}`);
const nearPt = (p, q, eps = 1e-6) => { near(p[0], q[0], eps, 'x'); near(p[1], q[1], eps, 'z'); };

// ---------------------------------------------------------------- module shape
let EDITOR;
test('loads in node with no DOM and no side effects', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  EDITOR = load('editor.js', 'EDITOR');
  assert.equal(typeof EDITOR.open, 'function');
  assert.equal(typeof EDITOR.isOpen, 'function');
  assert.equal(EDITOR.isOpen(), false);
  const h = EDITOR.open({ spec: {} });          // no document: harmless stub
  assert.equal(typeof h.close, 'function');
  h.close();
});
test('source has one top-level declaration and no Math.random', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'editor.js'), 'utf8');
  assert.ok(!/Math\.random/.test(src));
  assert.ok(/^const EDITOR=\(\(\)=>\{/m.test(src));
  assert.ok(!/^\s*(import|export)\s/m.test(src) && !/\brequire\(/.test(src));
});
const T = EDITOR._t;
const PI = Math.PI, HALF = PI / 2;

// ---------------------------------------------------------------- basics
test('snap to 0.25 m grid', () => {
  assert.equal(T.snap(1.12), 1.0);
  assert.equal(T.snap(1.13), 1.25);
  assert.equal(T.snap(-0.1), 0);
  assert.ok(!Object.is(T.snap(-0.1), -0));
  assert.equal(T.snap(7.3, 1), 7);
});
test('yaw snaps to 90° with SPEC names', () => {
  assert.equal(T.snapYaw(0.3), 0);
  assert.equal(T.snapYaw(1.4), HALF);
  assert.equal(T.snapYaw(3.3), PI);
  assert.equal(T.snapYaw(-PI), PI);
  assert.equal(T.snapYaw(-1.6), -HALF);
  assert.equal(T.snapYaw(2 * PI + 0.1), 0);
  assert.equal(T.snapYaw('nope'), 0);
  assert.deepEqual([0, HALF, PI, -HALF].map(T.facingName), ['north', 'west', 'south', 'east']);
});

// ---------------------------------------------------------------- snapping
test('snapPoint: grid when nothing else applies', () => {
  assert.deepEqual(T.snapPoint(3.13, -2.6, {}), { x: 3.25, z: -2.5, kind: 'grid' });
});
test('snapPoint: existing end within 0.4 m wins over grid and angle', () => {
  const ends = [[1.1, 1.1]];
  const p = T.snapPoint(1.4, 1.3, { ends, anchor: [0, 5] });
  assert.equal(p.kind, 'end'); assert.equal(p.x, 1.1); assert.equal(p.z, 1.1);
  const q = T.snapPoint(1.6, 1.1, { ends });            // 0.5 m away: grid
  assert.equal(q.kind, 'grid');
  const r = T.snapPoint(1.0, 1.0, { ends: [[0, 0], [1.2, 1.2]] });  // nearest end
  assert.deepEqual([r.x, r.z], [1.2, 1.2]);
});
test('snapPoint: 0/45/90° from the anchor, run on the grid', () => {
  const a = [0, 0];
  let p = T.snapPoint(4.1, 0.6, { anchor: a });          // ~8°: horizontal
  assert.deepEqual([p.x, p.z, p.kind, p.deg], [4, 0, 'angle', 0]);
  p = T.snapPoint(0.4, -3.13, { anchor: a });            // up (north): 90°
  assert.deepEqual([p.x, p.z, p.deg], [0, -3.25, 90]);
  p = T.snapPoint(2.1, 1.9, { anchor: a });              // 45° down-right
  assert.equal(p.x, p.z); assert.equal(p.x, 2);
  p = T.snapPoint(-2.4, -2.6, { anchor: [1, 1] });       // 45° up-left, anchor off origin
  assert.equal(p.x - 1, p.z - 1); assert.ok(p.x < 1);
  assert.equal(T.snap(p.x - 1), p.x - 1);
});
test('snapPoint: Shift = free angle (grid only), Alt = no snapping', () => {
  const p = T.snapPoint(4.1, 0.6, { anchor: [0, 0], free: true });
  assert.deepEqual([p.x, p.z, p.kind], [4, 0.5, 'grid']);
  const q = T.snapPoint(4.1, 0.6, { anchor: [0, 0], ends: [[4.1, 0.65]], off: true });
  assert.deepEqual([q.x, q.z, q.kind], [4.1, 0.6, 'free']);
});
test('collectEnds includes walls, glass, plate and room corners; can skip one segment', () => {
  const spec = { w: 10, d: 8, walls: [[0, 0, 1, 0]], glass: [[2, 2, 3, 2]], rooms: [{ x: 0, z: 0, w: 2, d: 2 }] };
  const e = T.collectEnds(spec);
  assert.equal(e.length, 2 + 2 + 4 + 4);
  assert.ok(e.some(p => p[0] === -5 && p[1] === 4));
  assert.equal(T.collectEnds(spec, { kind: 'wall', i: 0 }).length, e.length - 2);
});

// ---------------------------------------------------------------- hit testing
const HSPEC = {
  w: 40, d: 30,
  walls: [[-10, 0, 10, 0]],
  glass: [[-10, 0.1, 10, 0.1]],
  rooms: [{ id: 'r1', type: 'lab', x: 0, z: 5, w: 16, d: 8 }, { id: 'r2', type: 'phone', x: 4, z: 5, w: 1.5, d: 1.5 }],
  zones: [{ id: 'z1', team: 'A', x: -3, z: 5, w: 6, d: 4 }, { id: 'z2', team: 'B', x: 4, z: 5, w: 1.5, d: 1.5 }],
  desks: [{ id: 'd1', x: -3, z: 5, a: 0 }],
};
test('hitTest: desk beats zone and room under it', () => {
  assert.deepEqual(T.hitTest(HSPEC, -3, 5.2, 0.1), { kind: 'desk', i: 0 });
});
test('hitTest: smallest room/zone wins (zone inside a lab room)', () => {
  assert.deepEqual(T.hitTest(HSPEC, -5, 6, 0.1), { kind: 'zone', i: 0 });
  assert.deepEqual(T.hitTest(HSPEC, 6, 8, 0.1), { kind: 'room', i: 0 });
});
test('hitTest: equal size room and zone -> room', () => {
  assert.deepEqual(T.hitTest(HSPEC, 4, 5, 0.1), { kind: 'room', i: 1 });
});
test('hitTest: nearest wall/glass line within tolerance', () => {
  assert.deepEqual(T.hitTest(HSPEC, 3, -0.15, 0.1), { kind: 'wall', i: 0 });
  assert.deepEqual(T.hitTest(HSPEC, 3, 0.2, 0.1), { kind: 'glass', i: 0 });
  assert.equal(T.hitTest(HSPEC, 3, -2, 0.1), null);
  assert.equal(T.hitTest(HSPEC, 15, 0, 0.1), null);
});
test('hitTest: only filter', () => {
  assert.deepEqual(T.hitTest(HSPEC, -3, 5.2, 0.1, ['room']), { kind: 'room', i: 0 });
  assert.equal(T.hitTest(HSPEC, 3, -0.15, 0.1, ['desk']), null);
});
test('hitTest: rotated desk footprint', () => {
  const s = { desks: [{ id: 'x', x: 0, z: 0, a: HALF }] };   // turned: long side along z
  assert.ok(T.hitTest(s, 0, 0.75, 0));
  assert.equal(T.hitTest(s, 0.75, 0, 0), null);
});
test('cornerAt and wallEndAt', () => {
  const r = { x: 0, z: 0, w: 4, d: 2 };
  assert.equal(T.cornerAt(r, -2.1, -1.05, 0.2), 0);
  assert.equal(T.cornerAt(r, 2, -1, 0.2), 1);
  assert.equal(T.cornerAt(r, 1.95, 1.1, 0.2), 2);
  assert.equal(T.cornerAt(r, -2, 1, 0.2), 3);
  assert.equal(T.cornerAt(r, 0, 0, 0.2), -1);
  assert.equal(T.wallEndAt([0, 0, 5, 0], 4.9, 0.1, 0.3), 1);
  assert.equal(T.wallEndAt([0, 0, 5, 0], 2, 0, 0.3), -1);
});

// ---------------------------------------------------------------- move / resize
test('moveRect snaps the top-left corner to the grid and keeps size', () => {
  const o = { x: 1.1, z: 0.9, w: 3, d: 2.5 };
  const m = T.moveRect(o, 1.04, -0.37, true);
  assert.equal(T.snap(m.x - o.w / 2), m.x - o.w / 2);
  assert.equal(T.snap(m.z - o.d / 2), m.z - o.d / 2);
  assert.deepEqual(m, { x: 2.25, z: 0.5 });          // edges land on 0.75 and -0.75
  assert.deepEqual(T.moveRect(o, 0.25, 0, false), { x: 1.35, z: 0.9 });
});
test('moveSeg keeps the shape, snaps its first end; movePt snaps', () => {
  const g = T.moveSeg([0.1, 0.1, 3.1, 0.1], 1.02, 0, true);
  assert.deepEqual(g, [1, 0, 4, 0]);
  assert.deepEqual(T.moveSeg([0, 0, 1, 1], 0.3, 0.3, false), [0.3, 0.3, 1.3, 1.3]);
  assert.deepEqual(T.movePt(1, 1, 0.37, -0.12, true), { x: 1.25, z: 1 });
});
test('resizeRect: each corner keeps the opposite corner fixed', () => {
  const o = { x: 0, z: 0, w: 4, d: 2 };            // x -2..2, z -1..1
  assert.deepEqual(T.resizeRect(o, 2, 3.1, 2.05, true), { x: 0.5, z: 0.5, w: 5, d: 3 });
  assert.deepEqual(T.resizeRect(o, 0, -3, -2, true), { x: -0.5, z: -0.5, w: 5, d: 3 });
  assert.deepEqual(T.resizeRect(o, 1, 4, -1.5, true), { x: 1, z: -0.25, w: 6, d: 2.5 });
  assert.deepEqual(T.resizeRect(o, 3, -2.5, 1, true), { x: -0.25, z: 0, w: 4.5, d: 2 });
});
test('resizeRect: never smaller than 1 m and never flips', () => {
  const o = { x: 0, z: 0, w: 4, d: 2 };
  const r = T.resizeRect(o, 2, -10, -10, true);     // drag se corner past nw
  assert.deepEqual(r, { x: -1.5, z: -0.5, w: 1, d: 1 });
});
test('rectFromDrag: any direction, snapped, min 1 m', () => {
  assert.deepEqual(T.rectFromDrag(5.1, 4.9, 1.05, 1.1, true), { x: 3, z: 3, w: 4, d: 4 });
  assert.deepEqual(T.rectFromDrag(0, 0, 0.3, -0.2, true), { x: 0.5, z: -0.5, w: 1, d: 1 });
});
test('presetRect centers on the cursor with edges on the grid', () => {
  const p = T.PRESETS.find(p => p.k === 'phone');
  const r = T.presetRect(p, 0.1, 0.1, true);
  assert.equal(r.w, 1.5); assert.equal(T.snap(r.x - 0.75), r.x - 0.75);
  assert.deepEqual(T.PRESETS.map(p => [p.k, p.w, p.d, p.door]), [
    ['conf', 6, 4, 's'], ['phone', 1.5, 1.5, 's'], ['kitchen', 8, 5, 's'], ['restroom', 6, 4, null], ['elevator', 2.6, 2.4, 's'], ['stairs', 3, 5, null]]);
});
test('roomOutline: 1 m door gap, 2 m for lobby, none for elevator/solid', () => {
  const total = segs => segs.reduce((a, g) => a + T.segLen(g), 0);
  const r = { type: 'conf', x: 0, z: 0, w: 6, d: 4, door: 's' };
  assert.equal(T.roomOutline(r).length, 5); near(total(T.roomOutline(r)), 20 - 1);
  near(total(T.roomOutline({ ...r, type: 'lobby' })), 20 - 2);
  near(total(T.roomOutline({ ...r, type: 'elevator' })), 20);
  near(total(T.roomOutline({ ...r, door: null })), 20);
  const gapSeg = T.roomOutline(r).filter(g => g[1] === 2 && g[3] === 2);
  assert.deepEqual(gapSeg.map(g => [g[0], g[2]]), [[-3, -0.5], [0.5, 3]]);
});
test('plateOutline: doorway gap at its offset, clamped inside the wall', () => {
  const segs = T.plateOutline({ w: 20, d: 10, door: { side: 's', at: 4, w: 3 } });
  const south = segs.filter(g => g[1] === 5 && g[3] === 5);
  assert.deepEqual(south.map(g => [g[0], g[2]]), [[-10, 2.5], [5.5, 10]]);
  const e = T.plateOutline({ w: 20, d: 10, door: { side: 'e', at: 99, w: 2 } }).filter(g => g[0] === 10 && g[2] === 10);
  assert.deepEqual(e.map(g => [g[1], g[3]]), [[-5, 3]]);     // gap pushed to the end, one piece left
  assert.equal(T.plateOutline({ w: 20, d: 10, door: null }).length, 4);
});

// ---------------------------------------------------------------- wall chain
test('chainStep: click, click, click, end', () => {
  let r = T.chainStep({ pts: [] }, { t: 'click', p: [0, 0] });
  assert.equal(r.seg, null); assert.equal(r.done, false);
  r = T.chainStep(r.st, { t: 'click', p: [4, 0] });
  assert.deepEqual(r.seg, [0, 0, 4, 0]);
  r = T.chainStep(r.st, { t: 'click', p: [4, 3] });
  assert.deepEqual(r.seg, [4, 0, 4, 3]);
  assert.equal(r.st.pts.length, 3);
  r = T.chainStep(r.st, { t: 'end' });
  assert.equal(r.done, true); assert.deepEqual(r.st.pts, []); assert.equal(r.seg, null);
});
test('chainStep: second click of a double-click adds nothing; dbl ends', () => {
  let r = T.chainStep({ pts: [[0, 0], [2, 0]] }, { t: 'click', p: [2, 0.01] });
  assert.equal(r.seg, null); assert.equal(r.st.pts.length, 2);
  r = T.chainStep(r.st, { t: 'dbl' });
  assert.equal(r.done, true);
});
test('chainStep: clicking the start closes the loop and ends', () => {
  let st = { pts: [[0, 0], [3, 0], [3, 3]] };
  const r = T.chainStep(st, { t: 'click', p: [0, 0] });
  assert.deepEqual(r.seg, [3, 3, 0, 0]); assert.equal(r.done, true);
  const r2 = T.chainStep({ pts: [[0, 0], [3, 0]] }, { t: 'click', p: [0, 0] });   // 2 points: just a segment back
  assert.equal(r2.done, false);
});
test('chainStep: junk input never throws', () => {
  assert.doesNotThrow(() => T.chainStep(null, { t: 'click', p: ['a', 1] }));
  assert.equal(T.chainStep({ pts: [[0, 0]] }, { t: 'click', p: [NaN, 1] }).seg, null);
  assert.equal(T.chainStep({}, null).done, false);
});

// ---------------------------------------------------------------- history
test('history: undo / redo / new edit clears redo', () => {
  const h = T.createHistory(100);
  h.record('A'); h.record('B');               // states before edit 1 and edit 2; current = C
  assert.equal(h.undo('C'), 'B');
  assert.equal(h.undo('B'), 'A');
  assert.equal(h.undo('A'), null);
  assert.equal(h.redo('A'), 'B');
  assert.equal(h.redo('B'), 'C');
  assert.equal(h.redo('C'), null);
  h.undo('C'); assert.equal(h.canRedo(), true);
  h.record('B'); assert.equal(h.canRedo(), false);
});
test('history: cap of 100 and coalescing keys', () => {
  const h = T.createHistory(100);
  for (let i = 0; i < 150; i++) h.record('s' + i);
  assert.equal(h.size().past, 100);
  let last; while (h.canUndo()) last = h.undo('x');
  assert.equal(last, 's50');
  const g = T.createHistory();
  g.record('a', 'name'); g.record('b', 'name'); g.record('c', 'name');
  assert.equal(g.size().past, 1);
  g.breakCoalesce(); g.record('d', 'name');
  assert.equal(g.size().past, 2);
  g.record('e'); g.record('f');
  assert.equal(g.size().past, 4);
});
test('reselect: undo/redo keep the selection on the same item, not the same index', () => {
  const A = [0, 0, 1, 0], B = [0, 5, 1, 5], C = [0, 9, 1, 9], sp = walls => ({ walls, glass: [], rooms: [], zones: [], desks: [] });
  // delete A, select C (index 1), undo brings A back at 0: C is now index 2, not B
  assert.deepEqual(T.reselect(sp([B, C]), sp([A, B, C]), { kind: 'wall', i: 1 }), { kind: 'wall', i: 2 });
  // redo the delete: C slides back to 1
  assert.deepEqual(T.reselect(sp([A, B, C]), sp([B, C]), { kind: 'wall', i: 2 }), { kind: 'wall', i: 1 });
  // undoing a nudge of the selected item (same length, item changed) keeps the index
  assert.deepEqual(T.reselect(sp([A, [0, 5.25, 1, 5.25], C]), sp([A, B, C]), { kind: 'wall', i: 1 }), { kind: 'wall', i: 1 });
  // the selected item itself is gone (undo of its duplicate / creation) -> nothing selected
  assert.equal(T.reselect(sp([A, B, C]), sp([A, B]), { kind: 'wall', i: 2 }), null);
  // an edit to another list leaves the index alone; an append after it too
  const s1 = sp([A, B]), s2 = Object.assign(sp([A, B]), { desks: [{ id: 'd1', x: 0, z: 0 }] });
  assert.deepEqual(T.reselect(s1, s2, { kind: 'wall', i: 1 }), { kind: 'wall', i: 1 });
  assert.deepEqual(T.reselect(sp([A, B]), sp([A, B, C]), { kind: 'wall', i: 0 }), { kind: 'wall', i: 0 });
  // junk never throws
  assert.equal(T.reselect(null, null, null), null);
  assert.equal(T.reselect(sp([A]), sp([A]), { kind: 'nope', i: 0 }), null);
  assert.equal(T.reselect(sp([A]), {}, { kind: 'wall', i: 0 }), null);
  // with the real history, as the editor uses it: delete A, pick C, undo, delete the selection -> C goes
  const h = T.createHistory(), json = s => JSON.stringify(s);
  let spec = sp([A, B, C]), sel;
  h.record(json(spec)); spec = sp([B, C]);
  sel = { kind: 'wall', i: 1 };
  const old = spec; spec = JSON.parse(h.undo(json(spec))); sel = T.reselect(old, spec, sel);
  spec.walls.splice(sel.i, 1);
  assert.deepEqual(spec.walls, [A, B]);
});

// ---------------------------------------------------------------- validation
const base = () => ({ v: 1, key: 'B1-3', b: 'B1', f: 3, w: 40, d: 30, door: null, plan: null, walls: [], glass: [],
  rooms: [{ id: 'e1', type: 'elevator', name: 'Elevator', x: 0, z: 0, w: 2.6, d: 2.4, door: 's' }], zones: [], desks: [] });
test('validate: clean floor has no errors or warnings', () => {
  const v = T.validate(base(), {});
  assert.deepEqual(v, { errors: [], warnings: [] });
});
test('validate: duplicate desk ids (case-insensitive) and missing id block saving', () => {
  const s = base();
  s.desks = [{ id: '3-114', x: 0, z: 5, a: 0 }, { id: '3-114 ', x: 2, z: 5, a: 0 }, { id: '3-114'.toUpperCase(), x: 4, z: 5, a: 0 }, { id: '', x: 6, z: 5, a: 0 }];
  s.desks[2].id = '3-114';
  const v = T.validate(s);
  assert.equal(v.errors.length, 2);
  assert.match(v.errors[0].msg, /no id/);
  assert.match(v.errors[1].msg, /"3-114" is used by 3 desks/);
  assert.deepEqual(v.errors[1].ref, { kind: 'desk', i: 1 });
});
test('validate: zero-size rooms and zones are errors', () => {
  const s = base();
  s.rooms.push({ id: 'r1', type: 'conf', name: 'Silicon', x: 3, z: 3, w: 0, d: 4, door: 's' });
  s.zones.push({ id: 'z1', team: 'Finance', x: 3, z: 3, w: 5, d: 0 });
  const v = T.validate(s);
  assert.equal(v.errors.length, 2);
  assert.match(v.errors[0].msg, /"Silicon" \(conference room\) has no size/);
  assert.match(v.errors[1].msg, /"Finance" team area has no size/);
});
test('validate: rooms past the plate edge -> clipped warning; fully outside -> won\'t show', () => {
  const s = base();
  s.rooms.push({ id: 'r1', type: 'conf', name: 'Edge', x: 19, z: 0, w: 4, d: 4, door: 's' });
  s.rooms.push({ id: 'r2', type: 'phone', name: '', x: 40, z: 0, w: 2, d: 2, door: 's' });
  const v = T.validate(s);
  assert.equal(v.errors.length, 0);
  assert.match(v.warnings[0].msg, /"Edge".*sticks out past the edge.*cut off/);
  assert.match(v.warnings[1].msg, /unnamed phone booth is outside the floor/);
});
test('validate: elevator missing warns unless the building has one floor', () => {
  const s = base(); s.rooms = [];
  assert.match(T.validate(s).warnings[0].msg, /no elevator/);
  assert.match(T.validate(s, { floors: 4 }).warnings[0].msg, /no elevator/);
  assert.equal(T.validate(s, { floors: 1 }).warnings.length, 0);
});
test('validate: floor 1 without a doorway warns; office id clash and duplicate room ids are errors', () => {
  const s = base(); s.f = 1;
  assert.ok(T.validate(s).warnings.some(w => /no outside doorway/.test(w.msg)));
  s.door = { side: 's', at: 0, w: 3 };
  assert.ok(!T.validate(s).warnings.some(w => /doorway/.test(w.msg)));
  s.rooms.push({ id: '1-101', type: 'office', name: 'CFO', x: 5, z: 5, w: 3, d: 3, door: 'n' }, { id: 'e1', type: 'elevator', x: 9, z: 9, w: 2.6, d: 2.4, door: 's' });
  s.desks.push({ id: '1-101', x: -5, z: 5, a: 0 });
  const v = T.validate(s);
  assert.ok(v.errors.some(e => /"1-101" is also used by the private office "CFO"/.test(e.msg)));
  assert.ok(v.errors.some(e => /Two rooms share the id "e1"/.test(e.msg)));
});
test('validate: desks outside the plate, team area with no team, unplaced people', () => {
  const s = base();
  s.desks = [{ id: 'a', x: 30, z: 0, a: 0 }, { id: 'b', x: 0, z: -20, a: 0 }, { id: 'c', x: 0, z: 0, a: 0 }];
  s.zones = [{ id: 'z1', team: '', x: 0, z: 5, w: 4, d: 4 }];
  const v = T.validate(s, { model: { unplaced: [{ name: 'X' }, { name: 'Y' }] } });
  assert.ok(v.warnings.some(w => /2 desks are outside the floor: a, b\./.test(w.msg)));
  assert.ok(v.warnings.some(w => /no team picked/.test(w.msg)));
  assert.ok(v.warnings.some(w => /2 people on this floor don't have a desk/.test(w.msg)));
});
test('validate: never throws on junk', () => {
  assert.doesNotThrow(() => T.validate(null));
  assert.doesNotThrow(() => T.validate({ rooms: 'x', desks: [{}], zones: [null].filter(Boolean) }));
});

// ---------------------------------------------------------------- normalization
test('normalize: garbage in, clean spec out (never throws)', () => {
  for (const junk of [null, undefined, 42, 'x', [], { w: 'abc' }]) assert.doesNotThrow(() => T.normalize(junk, { key: 'B2-1' }));
  const { spec, dropped } = T.normalize({
    key: 'B2-1', w: '64', d: 1e9, door: { side: 'q' },
    walls: [[0, 0, 5, 0], [0, 0, 'x', 1], { x1: 1, z1: 1, x2: 1, z2: 4 }, [1, 1, 1, 1]],
    rooms: [{ type: 'CONF', x: 1, z: 1, w: -4, d: 3, door: 'z', seats: '7.6', extra: 'kept' }, { type: 'elevator', x: 5, z: 5, w: 2, d: 2 }, 'bad', { x: 'no' }],
    zones: [{ team: '  Finance ', arr: 'nope', x: 0, z: 0, w: 5, d: 5, dir: 'v' }],
    desks: [{ id: 314, x: '2', z: 3, a: 1.4, arr: 'lab', team: '' }, { id: 'n', x: null, z: 1 }],
    plan: { asset: 'abc', x: 0, z: 0, w: 0, d: 4 }, ramps: 'no',
  }, {});
  assert.equal(spec.b, 'B2'); assert.equal(spec.f, 1);
  assert.equal(spec.w, 64); assert.equal(spec.d, 400);
  assert.equal(spec.door, null); assert.equal(spec.plan, null); assert.equal(spec.ramps, null);
  assert.equal(spec.walls.length, 2);
  assert.deepEqual(spec.walls[1], [1, 1, 1, 4]);
  assert.equal(spec.rooms.length, 2);
  assert.deepEqual([spec.rooms[0].type, spec.rooms[0].w, spec.rooms[0].door, spec.rooms[0].seats, spec.rooms[0].extra], ['conf', 4, null, 8, 'kept']);
  assert.equal(spec.rooms[0].id, 'r1'); assert.equal(spec.rooms[1].id, 'e1');
  assert.deepEqual([spec.zones[0].team, spec.zones[0].arr, spec.zones[0].dir, spec.zones[0].id], ['Finance', null, 'v', 'z1']);
  assert.equal(spec.desks.length, 1);
  assert.deepEqual([spec.desks[0].id, spec.desks[0].x, spec.desks[0].a, spec.desks[0].arr, 'team' in spec.desks[0]], ['314', 2, HALF, 'lab', false]);
  assert.equal(dropped, 2 + 2 + 1);
});
test('finalize rounds to the millimeter and keeps exact yaws', () => {
  const s = T.finalize({ key: 'B1-2', walls: [[0.12345, 0, 1, 0]], desks: [{ id: 'a', x: 1.23456, z: 0, a: 3.1 }] });
  assert.deepEqual(s.walls[0], [0.123, 0, 1, 0]);
  assert.equal(s.desks[0].x, 1.235); assert.equal(s.desks[0].a, PI);
  assert.equal(s.v, 1); assert.equal(s.f, 2);
});

// ---------------------------------------------------------------- facilities desks
const ROSTER = [
  { desk: '3-101', name: 'Ana', team: 'Finance', title: '', x: 10, y: 50 },
  { desk: '3-102', name: 'Ben', team: 'Finance', title: '', x: '110', y: '50', rot: 90 },
  { desk: '3-103', name: 'Cy', team: 'Lab', title: '', x: 60, y: 20, rot: 180 },
  { desk: '3-103', name: 'Dup', team: 'Lab', title: '', x: 61, y: 20 },
  { desk: '', name: 'NoDesk', team: 'Lab', title: '', x: 1, y: 1 },
  { desk: '3-104', name: 'NoXY', team: 'Lab', title: '' },
  ['3-105', 'Array Row', 'Sales', 'AE'],
];
test('facilityRows: only rows with a desk and numeric x,y; one per desk id', () => {
  const f = T.facilityRows(ROSTER);
  assert.deepEqual(f.rows.map(r => r.desk), ['3-101', '3-102', '3-103']);
  assert.equal(f.dupes, 1);
  assert.equal(f.rows[1].x, 110);
  assert.equal(T.rosterRows(ROSTER)[6].team, 'Sales');
});
test('farthestPair picks the two desks farthest apart', () => {
  const rows = T.facilityRows(ROSTER).rows;
  assert.deepEqual(T.farthestPair(rows), [0, 1]);
  assert.equal(T.farthestPair(rows.slice(0, 1)), null);
  const many = []; for (let i = 0; i < 1600; i++) many.push({ desk: 'd' + i, x: (i * 37) % 200, y: (i * 91) % 150 });
  many.push({ desk: 'far', x: 900, y: 900 });
  const p = T.farthestPair(many);
  assert.ok(p.includes(many.length - 1));
});
test('facilityPlace: feet -> meters with the y flip', () => {
  const rows = T.facilityRows(ROSTER).rows;
  // A (10,50) clicked at (-15,-5); B (110,50) is 100 ft = 30.48 m east
  const res = T.facilityPlace(rows, 0, 1, [-15, -5], [15.48, -5]);
  near(res.s, 0.3048, 1e-9);
  const c = res.desks[2];
  near(c.x, -15 + 50 * 0.3048, 1e-3);
  near(c.z, -5 + 30 * 0.3048, 1e-3);           // 30 ft further south (smaller y) = larger z
  assert.equal(res.desks[0].a, 0);                // no rot -> faces north
  assert.equal(res.desks[1].a, HALF);             // rot 90° (CCW from north) -> west
  assert.equal(res.desks[2].a, PI);
});
test('facilityPlace: rotated drawing turns desk facing with it', () => {
  const rows = [{ desk: 'A', x: 0, y: 0, rot: 0 }, { desk: 'B', x: 0, y: 100, rot: 90 }];
  // B is north of A in the drawing but east of A on the floor plan: the mapping turns north -> east
  const res = T.facilityPlace(rows, 0, 1, [0, 0], [30.48, 0]);
  assert.equal(res.desks[0].a, -HALF);            // faced drawing-north -> faces east
  assert.equal(res.desks[1].a, 0);                // faced drawing-west -> faces north
  nearPt([res.desks[1].x, res.desks[1].z], [30.48, 0], 1e-3);
});
test('facilityPlace: degenerate picks return null, bad similarity is survived', () => {
  const rows = [{ desk: 'A', x: 5, y: 5 }, { desk: 'B', x: 5, y: 5 }];
  assert.equal(T.facilityPlace(rows, 0, 1, [0, 0], [1, 1]), null);
  const ok = [{ desk: 'A', x: 0, y: 0 }, { desk: 'B', x: 1, y: 0 }];
  assert.equal(T.facilityPlace(ok, 0, 1, [0, 0], [0, 0]), null);
  assert.equal(T.facilityPlace(ok, 0, 1, [0, 0], [1, 0], () => { throw new Error('x'); }), null);
  assert.equal(T.facilityPlace(ok, 0, 1, [0, 0], [1, 0], () => ({})), null);
  assert.equal(T.facilityPlace(ok, 0, 5, [0, 0], [1, 0]), null);
});
test('facilityPlace: the y flip happens before calling the injected similarity()', () => {
  const calls = [];
  const spy = (p1, p2, q1, q2) => { calls.push([p1, p2, q1, q2]); return T.simFallback(p1, p2, q1, q2); };
  T.facilityPlace([{ desk: 'A', x: 1, y: 2 }, { desk: 'B', x: 3, y: 7 }], 0, 1, [0, 0], [5, 5], spy);
  assert.deepEqual(calls[0].slice(0, 2), [[1, -2], [3, -7]]);
});
test('unitPlace: centered, scaled, y flipped', () => {
  const d = T.unitPlace([{ desk: 'A', x: 0, y: 0 }, { desk: 'B', x: 100, y: 50, rot: 270 }], 'ft');
  nearPt([d[0].x, d[0].z], [-15.24, 7.62], 1e-3);
  nearPt([d[1].x, d[1].z], [15.24, -7.62], 1e-3);
  assert.equal(d[1].a, -HALF);
  assert.deepEqual(T.unitPlace([], 'm'), []);
});
test('mergeDesks replaces same ids (keeping arr/team), appends new, drops older duplicates', () => {
  const old = [{ id: '3-101', x: 0, z: 0, a: 0, arr: 'offices' }, { id: 'keep', x: 1, z: 1, a: 0 }, { id: '3-101', x: 9, z: 9, a: 0 }];
  const out = T.mergeDesks(old, [{ id: '3-101', x: 5, z: 5, a: PI }, { id: 'new', x: 2, z: 2, a: 0 }]);
  assert.deepEqual(out.map(d => d.id), ['3-101', 'keep', 'new']);
  assert.deepEqual([out[0].x, out[0].a, out[0].arr], [5, PI, 'offices']);
});
test('unitFromScale reads back feet / meters', () => {
  assert.equal(T.unitFromScale(0.3049), 'ft');
  assert.equal(T.unitFromScale(1.01), 'm');
  assert.equal(T.unitFromScale(0.5), null);
});

// ---------------------------------------------------------------- DXF
const DXF = {
  units: 'ft', scale: 0.3048,
  segments: [
    { layer: 'A-WALL', x1: 0, y1: 0, x2: 100, y2: 0 },
    { layer: 'A-WALL', x1: 100, y1: 0, x2: 0, y2: 0 },     // duplicate (reversed)
    { layer: 'A-WALL', x1: 0, y1: 0, x2: 0.5, y2: 0 },     // 0.15 m: too short
    { layer: 'A-GLAZ', x1: 0, y1: 0, x2: 0, y2: 50 },
    { layer: 'FURN', x1: 10, y1: 10, x2: 20, y2: 10 },
    { layer: 'FURN', x1: 10, y1: 12, x2: 20, y2: 12 },
    { layer: 'FURN', x1: 10, y1: 14, x2: 20, y2: 14 },
    { layer: '', x1: 'x', y1: 0, x2: 1, y2: 1 },
  ],
};
test('dxfLayers: counts, most lines first, walls/glazing pre-checked', () => {
  const L = T.dxfLayers(DXF);
  assert.deepEqual(L.map(l => [l.name, l.count, l.checked, l.glass]), [
    ['A-WALL', 3, true, false], ['FURN', 3, false, false], ['0', 1, false, false], ['A-GLAZ', 1, true, true]]);
  assert.ok(T.dxfLayers({ segments: [{ layer: 'I-PTN-FULL' }, { layer: 'Partitions' }, { layer: 'WALLS' }] }).every(l => l.checked));
  assert.deepEqual(T.dxfLayers(null), []);
});
test('dxfUnit: from the file name, from the scale, or a guess near the floor size', () => {
  assert.deepEqual(T.dxfUnit({ units: 'ft' }), { unit: 'ft', factor: 0.3048, how: 'file', label: 'Feet' });
  assert.equal(T.dxfUnit({ units: 'unknown', scale: 0.001 }).unit, 'mm');
  assert.equal(T.dxfUnit({ units: 6 }).unit, 'm');
  const yd = T.dxfUnit({ units: 'yd', scale: 0.9144 });
  assert.deepEqual([yd.unit, yd.factor], ['file', 0.9144]);
  const g = T.dxfUnit({ units: 'unknown', scale: null, segments: [{ x1: 0, y1: 0, x2: 72000, y2: 44000 }] }, 72);
  assert.deepEqual([g.unit, g.how], ['mm', 'guess']);
  assert.equal(T.dxfUnit({ segments: [{ x1: 0, y1: 0, x2: 236, y2: 0 }] }, 72).unit, 'ft');
  assert.equal(T.dxfUnit(null).unit, 'm');
});
test('dxfToWalls: units, y flip, centered, short/duplicate pieces skipped, glazing -> glass', () => {
  const r = T.dxfToWalls(DXF, ['A-WALL', 'A-GLAZ'], 'ft');
  assert.equal(r.walls.length, 1); assert.equal(r.glass.length, 1);
  assert.equal(r.skipped, 1); assert.equal(r.dups, 1);
  assert.deepEqual(r.walls[0], [-15.24, 7.62, 15.24, 7.62]);
  assert.deepEqual(r.glass[0], [-15.24, 7.62, -15.24, -7.62]);   // drawing y up -> floor z down
  assert.equal(r.w, 30.48); assert.equal(r.d, 15.24);
  const m = T.dxfToWalls(DXF, new Set(['FURN']), 0.3048);
  assert.equal(m.walls.length, 3); assert.equal(m.glass.length, 0);
  const capped = T.dxfToWalls(DXF, ['FURN'], 'ft', { cap: 2 });
  assert.equal(capped.walls.length, 2); assert.equal(capped.capped, 1);
  assert.deepEqual(T.dxfToWalls(null, [], 'm').walls, []);
});

// ---------------------------------------------------------------- plan image
test('planFit keeps the image aspect inside the plate, centered', () => {
  const p = T.planFit(2000, 1000, 72, 44, 'abc');
  assert.deepEqual(p, { asset: 'abc', x: -36, z: -18, w: 72, d: 36, opacity: 0.55 });
  const q = T.planFit(1000, 1000, 72, 44, 'abc', 0.8);
  assert.deepEqual([q.w, q.d, q.x, q.opacity], [44, 44, -22, 0.8]);
  assert.equal(T.planFit(0, NaN, 72, 44, 'a').w, 72);
});
test('planRescale: two clicks + real distance rescale about the first point', () => {
  const plan = { asset: 'a', x: -10, z: -5, w: 20, d: 10, opacity: 0.5 };
  // clicked 4 m apart on screen, really 30 ft = 9.144 m
  const p = T.planRescale(plan, [0, 0], [4, 0], 30, 'ft');
  const k = 9.144 / 4;
  near(p.w, 20 * k, 1e-3); near(p.d, 10 * k, 1e-3);
  near(p.x, -10 * k, 1e-3); near(p.z, -5 * k, 1e-3);
  const q = T.planRescale(plan, [2, 2], [2, 4], 4, 'm');      // k = 2 about (2,2)
  assert.deepEqual([q.x, q.z, q.w, q.d], [-22, -12, 40, 20]);
  assert.equal(T.planRescale(plan, [0, 0], [0, 0], 5, 'm'), null);
  assert.equal(T.planRescale(plan, [0, 0], [1, 0], 'abc', 'm'), null);
  assert.equal(T.planRescale(null, [0, 0], [1, 0], 1, 'm'), null);
});
test('matchFloorToPlan: plate takes the plan size; everything shifts to keep its place on the plan', () => {
  const s = T.normSpec({ w: 40, d: 30, plan: { asset: 'a', x: -10, z: -8, w: 50, d: 20 }, walls: [[0, 0, 1, 0]], rooms: [{ x: 5, z: 5, w: 2, d: 2, type: 'conf' }], desks: [{ id: 'a', x: 1, z: 1 }] });
  assert.equal(T.matchFloorToPlan(s), true);
  assert.deepEqual([s.w, s.d], [50, 20]);
  assert.deepEqual([s.plan.x, s.plan.z], [-25, -10]);
  assert.deepEqual(s.walls[0], [-15, -2, -14, -2]);
  assert.deepEqual([s.rooms[0].x, s.rooms[0].z, s.desks[0].x], [-10, 3, -14]);
  assert.equal(T.matchFloorToPlan({ plan: null }), false);
});

// ---------------------------------------------------------------- teams, ids, misc
test('arrangement guesses follow SPEC §2 and the teams map wins', () => {
  assert.equal(T.guessArr('Validation Lab'), 'lab');
  assert.equal(T.guessArr('Finance'), 'offices');
  assert.equal(T.guessArr('Supply Chain'), 'cubes');
  assert.equal(T.guessArr('Field Sales'), 'hot');
  assert.equal(T.guessArr('Verification'), 'bench');
  assert.equal(T.teamArr({ Finance: { arr: 'cubes' } }, 'Finance'), 'cubes');
  assert.equal(T.teamArr({ Finance: { arr: 'bogus' } }, 'Finance'), 'offices');
  assert.equal(T.teamColor({ A: { color: '#112233' } }, 'A'), '#112233');
  assert.equal(T.teamColor({}, 'Finance'), T.teamColor(null, 'finance'));
  assert.match(T.teamColor({ A: { color: 'red' } }, 'A'), /^#[0-9A-F]{6}$/i);
});
test('teamNames merges teams map, roster and zones, case-insensitively', () => {
  const n = T.teamNames({ Finance: {} }, [{ team: 'finance' }, { team: 'Lab' }], { zones: [{ team: 'Sales' }], desks: [{ team: 'Lab' }] });
  assert.deepEqual(n, ['Finance', 'Lab', 'Sales']);
});
test('suggestDeskId follows the most common pattern and skips used ids', () => {
  assert.equal(T.suggestDeskId({ desks: [{ id: '3-114' }, { id: '3-118' }, { id: 'X' }] }), '3-119');
  assert.equal(T.suggestDeskId({ desks: [{ id: '3-114' }] }, ['3-115']), '3-116');
  assert.equal(T.suggestDeskId({ desks: [{ id: 'A007' }, { id: 'A009' }] }), 'A010');
  assert.equal(T.suggestDeskId({ f: 2, desks: [] }), '2-101');
  assert.equal(T.suggestDeskId({ desks: [], rooms: [{ type: 'office', id: '4-201' }] }), '4-202');
  assert.equal(T.nextId('r', [{ id: 'r1' }, { id: 'r7' }, { id: 'e3' }]), 'r8');
  // preview-invented ids are avoided but never set the numbering pattern
  const avoid = []; for (let i = 0; i < 90; i++) avoid.push('z3-' + i);
  assert.equal(T.suggestDeskId({ desks: [] }, ['1-101', '1-116', '1-201'], avoid.concat(['1-202'])), '1-203');
});
test('zoneCounts uses model zone tags, else desks inside the rectangle', () => {
  const spec = { zones: [{ id: 'z1', team: 'Finance', x: 0, z: 0, w: 10, d: 10 }] };
  const roster = [{ team: 'Finance' }, { team: 'finance ' }, { team: 'Lab' }];
  assert.deepEqual(T.zoneCounts({ desks: [{ zone: 'z1' }, { zone: 'z1' }, { zone: 'z2' }] }, spec, 0, roster), { desks: 2, people: 2 });
  assert.deepEqual(T.zoneCounts({ desks: [{ x: 1, z: 1 }, { x: 20, z: 1 }] }, spec, 0, roster), { desks: 1, people: 2 });
  assert.deepEqual(T.zoneCounts(null, spec, 5, roster), { desks: 0, people: 0 });
});
test('describe gives screen-reader text', () => {
  const s = base(); s.desks = [{ id: '3-114', x: 0, z: 0, a: PI }]; s.walls = [[0, 0, 3, 4]];
  assert.equal(T.describe(s, { kind: 'room', i: 0 }), 'Elevator Elevator, 2.6 by 2.4 meters');
  assert.equal(T.describe(s, { kind: 'desk', i: 0 }), 'Desk 3-114, faces south');
  assert.equal(T.describe(s, { kind: 'wall', i: 0 }), 'Wall, 5 meters long');
  assert.equal(T.describe(s, null), 'Nothing selected');
  assert.equal(T.describe(s, { kind: 'zone', i: 9 }), 'Nothing selected');
});
test('throttle: preview rebuilds at most every 150 ms', () => {
  assert.deepEqual(T.throttle(-Infinity, 0, 150), { run: true, wait: 0 });
  assert.deepEqual(T.throttle(1000, 1100, 150), { run: false, wait: 50 });
  assert.deepEqual(T.throttle(1000, 1150, 150), { run: true, wait: 0 });
  // simulate a 1 s drag with a pointer event every 16 ms: builds = ceil(1000/150)
  let last = -Infinity, builds = 0, timerAt = null;
  for (let t = 0; t <= 1000; t += 16){
    if (timerAt != null && t >= timerAt){ last = timerAt; builds++; timerAt = null; }
    const d = T.throttle(last, t, 150);
    if (d.run){ last = t; builds++; } else if (timerAt == null) timerAt = t + d.wait;
  }
  assert.ok(builds >= 6 && builds <= 8, 'builds ' + builds);
});
test('isDark reads hex and rgba theme colors', () => {
  assert.equal(T.isDark('#07071A'), true);
  assert.equal(T.isDark('#EEF0EA'), false);
  assert.equal(T.isDark('rgb(10, 10, 20)'), true);
  assert.equal(T.isDark('#fff'), false);
  assert.equal(T.isDark('nonsense'), false);
});

// ---------------------------------------------------------------- with the real IMPORT module (if present)
let IMPORT = null;
try { IMPORT = load('importers.js', 'IMPORT'); } catch (_){ IMPORT = null; }
if (IMPORT && typeof IMPORT.parseDXF === 'function' && typeof IMPORT.similarity === 'function'){
  test('IMPORT.parseDXF output feeds dxfLayers / dxfUnit / dxfToWalls', () => {
    const txt = ['0','SECTION','2','HEADER','9','$INSUNITS','70','2','0','ENDSEC','0','SECTION','2','ENTITIES',
      '0','LINE','8','A-WALL','10','0','20','0','11','100','21','0',
      '0','LINE','8','A-GLAZ','10','0','20','0','11','0','21','50',
      '0','LINE','8','FURN','10','1','20','1','11','3','21','1',
      '0','ENDSEC','0','EOF',''].join('\n');
    const dxf = IMPORT.parseDXF(txt);
    const L = T.dxfLayers(dxf);
    assert.deepEqual(L.filter(l => l.checked).map(l => l.name).sort(), ['A-GLAZ', 'A-WALL']);
    const u = T.dxfUnit(dxf, 72);
    assert.deepEqual([u.unit, u.how], ['ft', 'file']);
    const r = T.dxfToWalls(dxf, L.filter(l => l.checked).map(l => l.name), u.unit);
    assert.deepEqual(r.walls, [[-15.24, 7.62, 15.24, 7.62]]);
    assert.deepEqual(r.glass, [[-15.24, 7.62, -15.24, -7.62]]);
  });
  test('IMPORT.similarity gives the same placement as the fallback', () => {
    const rows = T.facilityRows(ROSTER).rows;
    const a = T.facilityPlace(rows, 0, 1, [-15, -5], [10, 12], IMPORT.similarity);
    const b = T.facilityPlace(rows, 0, 1, [-15, -5], [10, 12]);
    assert.equal(a.desks.length, b.desks.length);
    a.desks.forEach((d, i) => { nearPt([d.x, d.z], [b.desks[i].x, b.desks[i].z], 1e-6); assert.equal(d.a, b.desks[i].a); });
  });
} else { skip += 2; console.log('skip: importers.js not loadable, IMPORT cross-checks skipped'); }

console.log(`editor.test.js: ${pass} passed, ${fail} failed${skip ? `, ${skip} skipped` : ''}`);
if (fail) process.exitCode = 1;
