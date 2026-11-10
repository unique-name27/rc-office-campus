// PEOPLE tests: node src/tests/people.test.js
const assert = require('node:assert/strict');
const PEOPLE = require('./load')('people.js', 'PEOPLE');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String((e && e.stack) || e).split('\n').slice(0, 5).join('\n     ')); }
}

test('default looks are deterministic per desk and never take a name', () => {
  assert.equal(PEOPLE.defaultLook.length, 2);
  const a = PEOPLE.defaultLook('B1-3|3-A01', 'bench'), b = PEOPLE.defaultLook('B1-3|3-A01', 'bench');
  assert.deepEqual(a, b);
  assert.notDeepEqual(PEOPLE.defaultLook('B2-3|3-A01', 'bench'), a, 'same desk id on another floor is a different person');
});

test('every default is a person in their team shirt with the neutral tone', () => {
  for (let i = 0; i < 400; i++) {
    const l = PEOPLE.defaultLook('B1-2|2-C' + i, i % 5 ? 'bench' : 'lab');
    assert.equal(l.kind, 'person'); assert.equal(l.shirt, 'team'); assert.equal(l.tone, PEOPLE.DEFAULT_TONE);
    assert.ok(PEOPLE.HATS.includes(l.hat));
    for (const k of ['pants', 'shoes', 'hatColor', 'mugColor']) assert.match(l[k], /^#[0-9A-F]{6}$/i);
  }
});

test('defaults spread across the neutral options', () => {
  const hats = {}, pants = new Set(); let glasses = 0, mugs = 0;
  for (let i = 0; i < 2000; i++) { const l = PEOPLE.defaultLook('K|' + i, 'bench'); hats[l.hat] = (hats[l.hat] || 0) + 1; pants.add(l.pants); if (l.glasses) glasses++; if (l.mug) mugs++ }
  for (const h of PEOPLE.HATS) assert.ok(hats[h] > 200, h + ' should be common: ' + JSON.stringify(hats));
  assert.equal(pants.size, 5);
  assert.ok(glasses > 400 && glasses < 750, 'glasses ' + glasses);
  assert.ok(mugs > 600 && mugs < 920, 'mugs ' + mugs);
});

test('lab desks get a lab coat and no mug or hat other than headphones', () => {
  for (let i = 0; i < 300; i++) { const l = PEOPLE.defaultLook('B2-1|1-L' + i, 'lab'); assert.equal(l.labCoat, true); assert.equal(l.mug, false); assert.ok(l.hat === 'none' || l.hat === 'phones') }
  assert.equal(PEOPLE.defaultLook('x', 'bench').labCoat, false);
});

test('validLook keeps only valid chosen fields', () => {
  assert.equal(PEOPLE.validLook(null), null);
  assert.equal(PEOPLE.validLook([]), null);
  assert.equal(PEOPLE.validLook({}), null);
  assert.deepEqual(PEOPLE.validLook({ kind: 'dog', shirt: '#123ABC', tone: '#A9D8C5', hat: 'cap', glasses: true, mug: false, labCoat: false, coat: '#FFFFFF' }),
    { kind: 'dog', shirt: '#123ABC', tone: '#A9D8C5', hat: 'cap', glasses: true, mug: false, labCoat: false, coat: '#FFFFFF' });
  assert.deepEqual(PEOPLE.validLook({ kind: 'dragon', shirt: 'red', tone: '#12345', hat: 'crown', glasses: 'yes', coat: 5, pants: '#000000', extra: 1 }), null);
  assert.deepEqual(PEOPLE.validLook({ shirt: 'team', hat: 'none' }), { shirt: 'team', hat: 'none' });
  const evil = JSON.parse('{"__proto__":{"polluted":1},"kind":"cat"}');
  assert.deepEqual(PEOPLE.validLook(evil), { kind: 'cat' });
  assert.equal({}.polluted, undefined);
});

test('merge puts chosen fields over the desk default and ignores the rest', () => {
  const base = PEOPLE.defaultLook('B1-1|1-A01', 'bench');
  const m = PEOPLE.merge(base, { tone: '#5A3A26', hat: 'beanie', pants: '#FF0000' });
  assert.equal(m.tone, '#5A3A26'); assert.equal(m.hat, 'beanie'); assert.equal(m.pants, base.pants);
  assert.deepEqual(PEOPLE.merge(base, null), base);
  assert.deepEqual(PEOPLE.chosenOf(m), { kind: 'person', shirt: 'team', tone: '#5A3A26', hat: 'beanie', glasses: base.glasses, mug: base.mug, labCoat: false });
});

test('validClaim checks the floor key, desk, name and sizes', () => {
  const ok = { w: 'B1-3', desk: '3-A01', name: 'Kim Lee', look: { hat: 'cap' }, at: 5 };
  assert.deepEqual(PEOPLE.validClaim(ok), { w: 'B1-3', desk: '3-A01', name: 'Kim Lee', look: { hat: 'cap' }, at: 5 });
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { w: 'campus' })), null);
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { w: '../x' })), null);
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { desk: '' })), null);
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { desk: 'x'.repeat(25) })), null);
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { name: 'n'.repeat(81) })), null);
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { name: 7 })), null);
  assert.deepEqual(PEOPLE.validClaim(Object.assign({}, ok, { look: 'x', at: -1 })).look, {});
  assert.equal(PEOPLE.validClaim(Object.assign({}, ok, { at: NaN })).at, 0);
  assert.equal(PEOPLE.validClaim(null), null);
});

const FLOORS = {
  'B1-1': [{ desk: '1-A01', name: 'Kim Lee' }, { desk: '1-A02', name: 'Sam Ortiz' }, { desk: '1-A03', name: 'Alex Chen' }],
  'B1-2': [{ desk: '2-A01', name: 'Jordan Smith' }, { desk: '2-A02', name: 'Alex Chen' }],
  'B2-1': [{ desk: '1-A01', name: 'José O\'Neil' }],
};
const on = k => FLOORS[k] || null, keys = Object.keys(FLOORS);

test('locate: same desk and name, or a unique name somewhere else, or nothing', () => {
  assert.deepEqual(PEOPLE.locate({ w: 'B1-1', desk: '1-a01', name: 'kim  LEE' }, on, keys), { key: 'B1-1|1-A01', moved: false });
  assert.deepEqual(PEOPLE.locate({ w: 'B1-1', desk: '1-A09', name: 'Jordan Smith' }, on, keys), { key: 'B1-2|2-A01', moved: true });
  assert.equal(PEOPLE.locate({ w: 'B1-1', desk: '1-A09', name: 'Alex Chen' }, on, keys), null, 'two people share the name: do not guess');
  assert.deepEqual(PEOPLE.locate({ w: 'B1-1', desk: '1-A03', name: 'Alex Chen' }, on, keys), { key: 'B1-1|1-A03', moved: false }, 'exact desk wins even when the name repeats');
  assert.equal(PEOPLE.locate({ w: 'B1-1', desk: '1-A01', name: 'Nobody Here' }, on, keys), null);
  assert.deepEqual(PEOPLE.locate({ w: 'B2-1', desk: '1-A01', name: 'Jose O Neil' }, on, keys), { key: 'B2-1|1-A01', moved: false });
  assert.equal(PEOPLE.locate({ w: 'B9-1', desk: '1-A01', name: '' }, on, keys), null);
});

test('resolve: one winner per person; the matching profile name, then the earliest claim', () => {
  const L = c => PEOPLE.locate(c, on, keys);
  const claims = [
    { uid: 'u2', w: 'B1-1', desk: '1-A01', name: 'Kim Lee', look: { hat: 'cap' }, at: 200 },
    { uid: 'u1', w: 'B1-1', desk: '1-A01', name: 'Kim Lee', look: { hat: 'beanie' }, at: 100 },
    { uid: 'u3', w: 'B1-1', desk: '1-A02', name: 'Sam Ortiz', look: {}, at: 50 },
    { uid: 'u4', w: 'B1-1', desk: '1-A09', name: 'Nobody', look: {}, at: 10 },
  ];
  let r = PEOPLE.resolve(claims, L, () => false);
  assert.equal(r.winners.get('B1-1|1-A01').uid, 'u1');
  assert.equal(r.status.get('u2').state, 'taken');
  assert.equal(r.status.get('u1').state, 'ok');
  assert.equal(r.status.get('u3').state, 'ok');
  assert.deepEqual(r.status.get('u4'), { key: null, state: 'lost' });
  r = PEOPLE.resolve(claims, L, c => c.uid === 'u2');
  assert.equal(r.winners.get('B1-1|1-A01').uid, 'u2', 'the person whose own name matches wins');
  assert.equal(r.status.get('u1').state, 'taken');
  const tie = [{ uid: 'b', w: 'B1-1', desk: '1-A02', name: 'Sam Ortiz', look: {}, at: 0 }, { uid: 'a', w: 'B1-1', desk: '1-A02', name: 'Sam Ortiz', look: {}, at: 0 }];
  assert.equal(PEOPLE.resolve(tie, L, () => false).winners.get('B1-1|1-A02').uid, 'a');
  assert.equal(PEOPLE.resolve(tie.slice().reverse(), L, () => false).winners.get('B1-1|1-A02').uid, 'a', 'order of docs does not matter');
});

test('resolve marks a moved claim', () => {
  const r = PEOPLE.resolve([{ uid: 'm', w: 'B1-1', desk: '1-A05', name: 'Jordan Smith', look: {}, at: 1 }], c => PEOPLE.locate(c, on, keys), () => false);
  assert.deepEqual(r.status.get('m'), { key: 'B1-2|2-A01', state: 'moved' });
});

console.log(`people: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
