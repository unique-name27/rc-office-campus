// Test floors for layout.test.js / ascii.js. Fake people, deterministic.
const teams = {
  'Design Verification': { color: '#3E7CB1', arr: 'bench' },
  'Validation Lab': { color: '#2E9C7A', arr: 'lab' },
  'Finance': { color: '#C2456B', arr: 'offices' },
  'Supply Chain': { color: '#D9822B', arr: 'cubes' },
  'Field Applications': { color: '#8E6FBF', arr: 'hot' },
  'Physical Design': { color: '#5B8C3A', arr: 'bench' },
};

// shared building core (same elevator ids/positions on every floor of B1)
const core = () => [
  { id: 'e1', type: 'elevator', name: 'Elevator A', x: -4.2, z: -3, w: 2.8, d: 2.6, door: 's' },
  { id: 'e2', type: 'elevator', name: 'Elevator B', x: -1.4, z: -3, w: 2.8, d: 2.6, door: 's' },
  { id: 'st1', type: 'stairs', name: 'Stairs', x: 2.4, z: -3, w: 4.8, d: 2.6, door: 's' },
  { id: 'rr1', type: 'restroom', name: 'Restrooms', x: 7.4, z: -3, w: 5.2, d: 2.6, door: 's' },
];

const floors = {
  // ground floor: lobby + entrance, kitchen, conference rooms, bench / lab / offices / cubes neighborhoods
  'B1-1': {
    v: 1, key: 'B1-1', b: 'B1', f: 1, w: 72, d: 44,
    door: { side: 's', at: 0, w: 3 },
    plan: null,
    walls: [],
    glass: [[-7, 3, -10.5, 8.5]],           // angled glass screen
    rooms: [
      ...core(),
      { id: 'lob', type: 'lobby', name: 'Lobby', x: 0, z: 16, w: 16, d: 12, door: 's' },
      { id: 'k1', type: 'kitchen', name: 'Café', x: 22, z: 16.5, w: 12, d: 9, door: 'n' },
      { id: 'c1', type: 'conf', name: 'Silicon', x: -18, z: 17, w: 8, d: 6, door: 'n', seats: 10 },
      { id: 'c2', type: 'conf', name: 'Wafer', x: -27.5, z: 17, w: 6, d: 6, door: 'n' },
      { id: 'p1', type: 'phone', name: 'Booth 1', x: -10.6, z: 19.6, w: 2.0, d: 2.2, door: 'n' },
      { id: 'srv', type: 'server', name: 'IDF 1', x: 31.6, z: 17, w: 5, d: 7, door: 'w' },
      { id: 'L1', type: 'lab', name: 'Validation Lab', x: 23, z: -12.3, w: 25, d: 17, door: 'w' },
    ],
    zones: [
      { id: 'z1', team: 'Design Verification', arr: null, x: -21, z: -12, w: 28, d: 18 },
      { id: 'z2', team: 'Validation Lab', arr: null, x: 23, z: -12.3, w: 24.6, d: 16.6 },
      { id: 'z3', team: 'Finance', arr: null, x: -21, z: 5.5, w: 28, d: 9 },
      { id: 'z4', team: 'Supply Chain', arr: null, x: 22, z: 4.8, w: 26, d: 9.4 },
    ],
    desks: [],
    ramps: null,
    updatedAt: 0,
  },
  // upper floor: no exterior door, private office rooms, explicit facilities desks, hot desks, overlapping zones
  'B1-3': {
    v: 1, key: 'B1-3', b: 'B1', f: 3, w: 72, d: 44, door: null, plan: null,
    walls: [[10, 6, 10, 14], [-12, 21.85, -6, 14]],         // a straight wall and an angled one
    glass: [],
    rooms: [
      ...core(),
      { id: '3-101', type: 'office', name: 'Office 3-101', x: -32.4, z: -19.6, w: 3.2, d: 4, door: 's' },
      { id: '3-102', type: 'office', name: 'Office 3-102', x: -29.2, z: -19.6, w: 3.2, d: 4, door: 's' },
      { id: '3-103', type: 'office', name: 'Office 3-103', x: -26.0, z: -19.6, w: 3.2, d: 4, door: null },
      { id: 'k3', type: 'kitchen', name: 'Kitchen', x: 0, z: 17, w: 10, d: 8, door: 'n' },
      { id: 'c31', type: 'conf', name: 'Fab', x: 24, z: 18.5, w: 7, d: 5, door: 'n' },
      { id: 'w3', type: 'wellness', name: 'Wellness', x: 31, z: 18.5, w: 4, d: 5, door: 'n' },
      { id: 'm3', type: 'mail', name: 'Mail', x: -30, z: 19, w: 4, d: 4, door: 'n' },
      { id: 's3', type: 'storage', name: 'Storage', x: -25, z: 19, w: 4, d: 4, door: null },
    ],
    zones: [
      { id: 'z1', team: 'Field Applications', arr: null, x: 20, z: -12, w: 28, d: 16 },
      { id: 'z2', team: 'Physical Design', arr: null, x: -14, z: -8, w: 20, d: 14 },
      { id: 'z3', team: 'Design Verification', arr: 'bench', x: -10, z: -2, w: 16, d: 10 },   // overlaps z2: yields
      { id: 'z4', team: '', arr: 'hot', x: 22, z: 6, w: 20, d: 9 },
    ],
    desks: [
      { id: '3-210', x: -30, z: 3, a: 0, team: 'Finance' },
      { id: '3-211', x: -30, z: 7, a: 3.1, team: 'Finance', arr: 'offices' },
      { id: '3-212', x: -24, z: 3, a: 1.6, team: 'Supply Chain', arr: 'cubes' },
      { id: '3-213', x: -24, z: 8, a: -1.5, arr: 'lab' },
      { id: '3-214', x: -18, z: 5, a: 0.2, arr: 'hot' },
      { id: '3-214', x: -18, z: 10, a: 0 },                 // duplicate id: renamed
    ],
    ramps: null,
    updatedAt: 0,
  },
  // a packed floor (~340 desks) with an east entrance; used for the timing test
  "D-2": {
    v: 1, key: "D-2", b: "D", f: 2, w: 72, d: 44, door: { side: "e", at: 6, w: 3 }, walls: [], glass: [], desks: [], ramps: null,
    rooms: [{ id: "e1", type: "elevator", x: 0, z: -2, w: 3, d: 3, door: "w" }, { id: "k", type: "kitchen", x: 0, z: 15, w: 10, d: 8, door: "e" },
      { id: "c1", type: "conf", name: "Gate", x: -12, z: 17, w: 6, d: 8, door: "w" }],
    zones: [{ id: "a", team: "Physical Design", x: -19, z: -10.5, w: 33, d: 21 }, { id: "b", team: "Design Verification", x: 19, z: -10.5, w: 33, d: 21 },
      { id: "c", team: "Field Applications", x: 22, z: 9, w: 26, d: 14 }, { id: "d", team: "Supply Chain", x: -26, z: 6, w: 18, d: 12 }],
  },
};

const FIRST = 'Ava Ben Cleo Dev Eli Fay Gus Hana Ivan Jo Kai Lena Milo Nia Omar Priya Quinn Rosa Sam Tara Uma Vik Wren Xavi Yara Zane'.split(' ');
const LAST = 'Adams Baker Chen Diaz Ellis Fox Garcia Hill Ito Jensen Khan Lopez Moreau Nakamura Okafor Park Quist Rossi Silva Tanaka'.split(' ');
const name = i => FIRST[i % FIRST.length] + ' ' + LAST[Math.floor(i / FIRST.length) % LAST.length] + (i >= FIRST.length * LAST.length ? ' ' + Math.floor(i / 520) : '');

// a roster for a floor: people per team (desk ids blank or matching), plus a few exact desk ids
function roster(key) {
  const rows = []; let i = 0;
  const add = (team, n, desk) => { for (let k = 0; k < n; k++) rows.push({ desk: desk ? desk(k) : '', name: name(i++), team, title: 'Engineer' }); };
  if (key === 'B1-1') {
    add('Design Verification', 50); add('Validation Lab', 30); add('Finance', 7); add('Supply Chain', 14);
    rows.push({ desk: '1-a05', name: 'Exact Match', team: 'Supply Chain', title: 'Buyer' });   // z1 desk, case-insensitive
  } else if (key === 'B1-3') {
    add('Field Applications', 40); add('Physical Design', 20); add('Design Verification', 10);
    rows.push({ desk: '3-101', name: 'Office Holder', team: 'Finance', title: 'CFO' });
    rows.push({ desk: ' 3-210 ', name: 'Facility Desk', team: 'Finance', title: 'Controller' });
    add('Marketing', 6);
  } else if (key === 'D-2') {
    for (let k = 0; k < 400; k++) rows.push(['', name(i++), ['Physical Design', 'Design Verification', 'Field Applications', 'Supply Chain'][k % 4], 'Engineer']);
  }
  return rows;
}

module.exports = { teams, floors, roster };
