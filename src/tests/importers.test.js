// Tests for js/importers.js (IMPORT). Run: node v4/tests/importers.test.js
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const IMPORT = require('./load')('importers.js', 'IMPORT');

const CAMPUS = { v: 1, name: 'San Jose campus', demo: true, teams: {},
  buildings: [{ id: 'B1', name: 'Building 1', short: 'B1', floors: 4, x: -46, z: 0, w: 72, d: 44 },
              { id: 'B2', name: 'Building 2', short: 'B2', floors: 4, x: 46, z: 0, w: 64, d: 48 }] };
const ONE_BUILDING = { buildings: [{ id: 'B1', name: 'Building 1', short: 'B1', floors: 4 }] };

let passed = 0, failed = 0;
const asyncTests = [];
function test(name, fn){
  try { fn(); passed++; }
  catch (e){ failed++; console.error('FAIL ' + name + '\n   ' + String(e && e.message).split('\n').join('\n   ')); }
}
function testAsync(name, fn){ asyncTests.push([name, fn]); }
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ' expected ' + b + ' got ' + a);
const csvLoad = (text, campus = CAMPUS, alias) => { const p = IMPORT.parseCSV(text); return IMPORT.normalize(p, IMPORT.mapColumns(p.header), campus, alias); };
const allPeople = res => Object.values(res.floors).flat();

// ====================================================================== module rules
test('module: one top-level const, ASCII only, no Math.random / imports / globals', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'importers.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '').trim();
  assert.ok(code.startsWith('const IMPORT=(()=>{'), 'starts with const IMPORT=(()=>{');
  assert.ok(code.endsWith('})();'), 'ends with })();');
  assert.ok(!/Math\.random/.test(src), 'no Math.random');
  assert.ok(!/\brequire\(|^\s*import\s|^\s*export\s/m.test(src), 'no require/import/export');
  assert.ok(!/[^\x00-\x7E]/.test(src), 'ASCII only (escapes for everything else)');
  const api = ['parseCSV', 'mapColumns', 'normalize', 'diff', 'parseDXF', 'similarity', 'template', 'toCSV', 'renderPDF'];
  for (const k of api) assert.strictEqual(typeof IMPORT[k], 'function', k);
});

// ====================================================================== parseCSV
test('csv: comma, CRLF, UTF-8 BOM', () => {
  const p = IMPORT.parseCSV('\uFEFFName,Team,Desk\r\nPriya Shah,Verification,3-114\r\nKen Ito,Finance,3-200\r\n');
  assert.deepStrictEqual(p.header, ['Name', 'Team', 'Desk']);
  assert.strictEqual(p.delimiter, ',');
  assert.deepStrictEqual(p.rows, [['Priya Shah', 'Verification', '3-114'], ['Ken Ito', 'Finance', '3-200']]);
  assert.strictEqual(p.headerLine, 1);
  assert.deepStrictEqual(p.lines, [2, 3]);
});
test('csv: semicolon Excel export with decimal commas and unquoted "Last, First"', () => {
  const t = '\uFEFFBuilding;Floor;Desk;Name;Team;Title;X;Y\r\n' +
            'B1;3;3-114;Shah, Priya;Verification;"Staff engineer; DFT";12,5;-4,25\r\n' +
            'B1;3;3-115;Ito, Ken;Verification;Engineer;13,5;-4,25\r\n';
  const p = IMPORT.parseCSV(t);
  assert.strictEqual(p.delimiter, ';');
  assert.strictEqual(p.header.length, 8);
  assert.strictEqual(p.rows[0][3], 'Shah, Priya');
  assert.strictEqual(p.rows[0][5], 'Staff engineer; DFT');
  assert.strictEqual(p.rows[0][6], '12,5');
});
test('csv: tab and pipe delimiters', () => {
  assert.strictEqual(IMPORT.parseCSV('Name\tTeam\tFloor\nA B\tLab\t3\nC D\tLab\t2\n').delimiter, '\t');
  const p = IMPORT.parseCSV('Name|Team|Floor\nA|B|3\nC|D|4\n');
  assert.strictEqual(p.delimiter, '|');
  assert.deepStrictEqual(p.rows[1], ['C', 'D', '4']);
});
test('csv: quoted newlines and "" escapes keep line numbers right', () => {
  const p = IMPORT.parseCSV('Name,Title,Desk\n"Priya ""PJ"" Shah","Staff engineer\r\nDFT lead",3-114\nKen Ito,Analyst,3-200\n');
  assert.strictEqual(p.rows[0][0], 'Priya "PJ" Shah');
  assert.strictEqual(p.rows[0][1], 'Staff engineer\nDFT lead');
  assert.deepStrictEqual(p.lines, [2, 4]);
  assert.deepStrictEqual(p.rows[1], ['Ken Ito', 'Analyst', '3-200']);
});
test('csv: header not on line 1 (title lines, blank line)', () => {
  const p = IMPORT.parseCSV('Facilities seating export\r\nGenerated 2024-05-01 by OfficeSpace\r\n\r\nBuilding,Floor,Desk,Name\r\nB1,3,3-114,Priya Shah\r\n');
  assert.deepStrictEqual(p.header, ['Building', 'Floor', 'Desk', 'Name']);
  assert.strictEqual(p.headerLine, 4);
  assert.deepStrictEqual(p.lines, [5]);
  // a two-cell title row that isn't a header is skipped too
  const q = IMPORT.parseCSV('Report,Q3 2024\nName,Team,Floor\nA,B,3\n');
  assert.deepStrictEqual(q.header, ['Name', 'Team', 'Floor']);
  assert.strictEqual(q.headerLine, 2);
});
test('csv: no recognizable header -> first row with 2+ cells (title line skipped)', () => {
  const p = IMPORT.parseCSV('My export\nFoo,Bar\n1,2\n');
  assert.deepStrictEqual(p.header, ['Foo', 'Bar']);
  assert.deepStrictEqual(p.rows, [['1', '2']]);
  const one = IMPORT.parseCSV('Names\nPriya\nKen\n');
  assert.deepStrictEqual(one.header, ['Names']);
  assert.strictEqual(one.rows.length, 2);
});
test('csv: ragged rows padded, filler and trailing empty lines dropped', () => {
  const p = IMPORT.parseCSV('Name,Team,Desk,Floor\nA,B\nC,D,E,F,G\n,,,\n\n\n');
  assert.deepStrictEqual(p.rows, [['A', 'B', '', ''], ['C', 'D', 'E', 'F', 'G']]);
  assert.deepStrictEqual(p.lines, [2, 3]);
});
test('csv: CR-only line endings, no final newline', () => {
  const p = IMPORT.parseCSV('Name,Team\rA,B\rC,D');
  assert.deepStrictEqual(p.rows, [['A', 'B'], ['C', 'D']]);
  assert.deepStrictEqual(p.lines, [2, 3]);
});
test('csv: Excel "sep=" hint line', () => {
  const p = IMPORT.parseCSV('sep=;\r\nName;Team\r\nA, B;C\r\n');
  assert.strictEqual(p.delimiter, ';');
  assert.strictEqual(p.headerLine, 2);
  assert.deepStrictEqual(p.rows, [['A, B', 'C']]);
});
test('csv: empty / non-text input never throws', () => {
  for (const v of ['', '   \n  \n', null, undefined, 42, {}, []]){
    const p = IMPORT.parseCSV(v);
    assert.deepStrictEqual(p.header, []);
    assert.deepStrictEqual(p.rows, []);
  }
});
test('csv: lenient quoting (unterminated quote, text after closing quote, space before quote)', () => {
  assert.deepStrictEqual(IMPORT.parseCSV('Name,Note\nA,"oops\nB,ok\n').rows, [['A', '"oops'], ['B', 'ok']]);
  assert.strictEqual(IMPORT.parseCSV('Name,Desk\n"Priya" Shah,3-1\n').rows[0][0], 'Priya Shah');
  assert.strictEqual(IMPORT.parseCSV('Name, Desk\nA, "3-1, east"\n').rows[0][1], '3-1, east');
});
test('csv: bytes in (UTF-16 "Unicode text", Windows-1252, UTF-8)', () => {
  const u16 = Buffer.from('\uFEFFName\tTeam\r\nJos\u00E9 \u00C1lvarez\tLab\r\n', 'utf16le');
  const p = IMPORT.parseCSV(new Uint8Array(u16));
  assert.deepStrictEqual(p.header, ['Name', 'Team']);
  assert.strictEqual(p.rows[0][0], 'Jos\u00E9 \u00C1lvarez');
  const cp = Uint8Array.from([...Buffer.from('Name,Team\nJos'), 0xE9, ...Buffer.from(',Lab\n')]);
  assert.strictEqual(IMPORT.parseCSV(cp.buffer).rows[0][0], 'Jos\u00E9');
  assert.strictEqual(IMPORT.parseCSV(Buffer.from('Name,Team\nRen\u00E9e,Lab\n', 'utf8')).rows[0][0], 'Ren\u00E9e');
  // UTF-8 BOM wins over one stray Windows-1252 byte: header intact, only that byte is lost
  const mixed = Buffer.concat([Buffer.from('\uFEFFBuilding,Name\r\nB1,Zo\u00EB M\u00FCller\r\n', 'utf8'), Buffer.from('B1,Jos\u00E9 Ruiz\r\n', 'latin1')]);
  const pm = IMPORT.parseCSV(new Uint8Array(mixed));
  assert.deepStrictEqual(pm.header, ['Building', 'Name']);
  assert.deepStrictEqual(pm.rows.map(r => r[1]), ['Zo\u00EB M\u00FCller', 'Jos\uFFFD Ruiz']);
  // UTF-16 that was read as 8-bit text (NULs between letters)
  const garbled = '\uFFFD\uFFFD' + 'Name\tTeam\r\nAna\tLab\r\n'.split('').join('\u0000') + '\u0000';
  assert.deepStrictEqual(IMPORT.parseCSV(garbled).rows, [['Ana', 'Lab']]);
});

// ====================================================================== mapColumns
function named(header){
  const { map, ignored } = IMPORT.mapColumns(header);
  const out = {};
  for (const k of Object.keys(map)) if (map[k] >= 0) out[k] = header[map[k]];
  return { named: out, ignored };
}
test('map: Workday-like report', () => {
  const r = named(['Employee ID', 'Worker', 'Business Title', 'Supervisory Organization', 'Cost Center', 'Manager',
    'Location Building', 'Floor', 'Workspace', 'Work Email', 'Hire Date']);
  assert.deepStrictEqual(r.named, { building: 'Location Building', floor: 'Floor', desk: 'Workspace', name: 'Worker',
    team: 'Supervisory Organization', title: 'Business Title' });
  assert.deepStrictEqual(r.ignored, ['Employee ID', 'Cost Center', 'Manager', 'Work Email', 'Hire Date']);
});
test('map: OfficeSpace-like export', () => {
  const r = named(['Employee Id', 'First Name', 'Last Name', 'Title', 'Department', 'Building', 'Floor', 'Seat', 'Email', 'Photo URL', 'Start Date']);
  assert.deepStrictEqual(r.named, { building: 'Building', floor: 'Floor', desk: 'Seat', first: 'First Name', last: 'Last Name',
    team: 'Department', title: 'Title' });
  assert.deepStrictEqual(r.ignored, ['Employee Id', 'Email', 'Photo URL', 'Start Date']);
});
test('map: Serraview-like export', () => {
  const r = named(['Site', 'Building', 'Level', 'Space ID', 'Space Type', 'Occupant Name', 'Occupant Business Unit', 'Cost Centre', 'Neighbourhood', 'Employee Number']);
  assert.deepStrictEqual(r.named, { building: 'Building', floor: 'Level', desk: 'Space ID', name: 'Occupant Name', team: 'Occupant Business Unit' });
  assert.deepStrictEqual(r.ignored, ['Site', 'Space Type', 'Cost Centre', 'Neighbourhood', 'Employee Number']);
});
test('map: Archibus-like export (headings and raw field names)', () => {
  const r = named(['Building Code', 'Floor Code', 'Room Code', 'Employee Name', 'Division Code', 'Department Code', 'Employee Standard', 'Phone Extension']);
  assert.deepStrictEqual(r.named, { building: 'Building Code', floor: 'Floor Code', desk: 'Room Code', name: 'Employee Name', team: 'Department Code' });
  assert.deepStrictEqual(r.ignored, ['Division Code', 'Employee Standard', 'Phone Extension']);
  const raw = named(['bl_id', 'fl_id', 'rm_id', 'em_id']);
  assert.deepStrictEqual(raw.named, { building: 'bl_id', floor: 'fl_id', desk: 'rm_id' });
});
test('map: plain Excel sheet', () => {
  const r = named(['Name', 'Team', 'Building', 'Floor', 'Desk', 'Title']);
  assert.deepStrictEqual(r.named, { building: 'Building', floor: 'Floor', desk: 'Desk', name: 'Name', team: 'Team', title: 'Title' });
  assert.deepStrictEqual(r.ignored, []);
});
test('map: CAD space export with centroids', () => {
  const r = named(['Layer', 'Handle', 'Space Number', 'Space Name', 'Occupant', 'Area (sq ft)', 'Centroid X', 'Centroid Y', 'Rotation', 'Floor', 'Bldg']);
  assert.deepStrictEqual(r.named, { building: 'Bldg', floor: 'Floor', desk: 'Space Number', name: 'Occupant', x: 'Centroid X', y: 'Centroid Y', rot: 'Rotation' });
  assert.deepStrictEqual(r.ignored, ['Layer', 'Handle', 'Space Name', 'Area (sq ft)']);
});
test('map: case, spacing, punctuation, camelCase, underscores', () => {
  const r = named(['FirstName', 'LAST_NAME', 'DeskID', 'Bldg.', ' floor  no ', 'posX', 'POS_Y', 'Dept', 'Desk #']);
  assert.deepStrictEqual(r.named, { building: 'Bldg.', floor: ' floor  no ', desk: 'DeskID', first: 'FirstName', last: 'LAST_NAME', team: 'Dept', x: 'posX', y: 'POS_Y' });
  assert.deepStrictEqual(named(['X Coordinate (ft)', 'Y Coordinate (ft)', 'Angle (deg)']).named, { x: 'X Coordinate (ft)', y: 'Y Coordinate (ft)', rot: 'Angle (deg)' });
});
test('normalize: a rotation column in radians is stored in degrees', () => {
  for (const h of ['Rotation (rad)', 'Angle Radians', 'AngleRad', 'Rotation_Radian']){
    const res = csvLoad('Building,Floor,Desk,Name,X,Y,' + h + '\nB1,1,1-1,Ada Example,0,0,3.14159265\nB1,1,1-2,Sam Sample,1,0,-1.5707963\n');
    assert.deepStrictEqual(res.floors['B1-1'].map(e => Math.round(e.rot * 1e4) / 1e4), [180, -90], h);
  }
  for (const h of ['Rotation', 'Angle (deg)', 'Rotation (degrees)'])
    assert.strictEqual(csvLoad('Building,Floor,Desk,Name,X,Y,' + h + '\nB1,1,1-1,Ada Example,0,0,90\n').floors['B1-1'][0].rot, 90, h);
  const p = IMPORT.parseCSV('Building,Floor,Desk,Name,X,Y,Radial\nB1,1,1-1,Ada Example,0,0,90\n');   // column picked by hand
  assert.strictEqual(IMPORT.normalize(p, Object.assign(IMPORT.mapColumns(p.header).map, { rot: 6 }), CAMPUS).floors['B1-1'][0].rot, 90);
});
test('map: privacy - look-alike columns are never picked up', () => {
  const r = named(['Name', 'Manager Name', 'Job Level', 'Space Type', 'Employee ID', 'Emergency Contact Name', 'Floor Warden', 'Team Lead', 'Job Code']);
  assert.deepStrictEqual(r.named, { name: 'Name' });
  assert.strictEqual(r.ignored.length, 8);
});
test('map: exact beats partial; "Location" is the building unless a building column exists, then a desk', () => {
  assert.strictEqual(named(['Building Name', 'Building']).named.building, 'Building');
  // HR exports (Workday-style) carry the site/building as "Location" / "Work Location"
  assert.strictEqual(named(['Name', 'Location']).named.building, 'Location');
  assert.strictEqual(named(['Worker', 'Work Location', 'Workspace']).named.building, 'Work Location');
  const r = named(['Name', 'Location', 'Desk']);
  assert.strictEqual(r.named.desk, 'Desk');
  assert.strictEqual(r.named.building, 'Location');
  assert.deepStrictEqual(r.ignored, []);
  // with a real building column, a bare "Location" falls back to the desk
  assert.strictEqual(named(['Name', 'Building', 'Location']).named.desk, 'Location');
  assert.strictEqual(named(['Name (Last, First)', 'Floor']).named.name, 'Name (Last, First)');
  assert.deepStrictEqual(named(['Full Name', 'First Name', 'Last Name']).named, { name: 'Full Name', first: 'First Name', last: 'Last Name' });
});
test('map: unnamed columns and bad input', () => {
  const r = IMPORT.mapColumns(['Name', '', ' Team ']);
  assert.strictEqual(r.map.team, 2);
  assert.deepStrictEqual(r.ignored, ['(unnamed column 2)']);
  for (const v of [null, undefined, 'Name', 7]){
    const m = IMPORT.mapColumns(v);
    assert.strictEqual(m.map.name, -1);
    assert.deepStrictEqual(m.ignored, []);
  }
});

// ====================================================================== buildings & floors
test('building names -> campus ids', () => {
  const table = [['B1', 'B1'], ['b1', 'B1'], ['Building 1', 'B1'], ['building 2', 'B2'], ['SJ1', 'B1'], ['SJC-02', 'B2'],
    ['Bldg 2', 'B2'], ['Building One', 'B1'], ['building two', 'B2'], ['B-1', 'B1'], ['2', 'B2'], [' B 2 ', 'B2'],
    ['SJ9', null], ['HQ', null], ['2001 Tasman Dr', null], ['', null]];
  for (const [raw, want] of table) assert.strictEqual(IMPORT.matchBuilding(raw, CAMPUS), want, JSON.stringify(raw));
  assert.strictEqual(IMPORT.matchBuilding('', ONE_BUILDING), 'B1', 'single building campus: blank means that building');
});
test('building alias wins (case-insensitive key, value by id or name, null = skip)', () => {
  assert.strictEqual(IMPORT.matchBuilding('SJ9', CAMPUS, { SJ9: 'B2' }), 'B2');
  assert.strictEqual(IMPORT.matchBuilding('sj9', CAMPUS, { SJ9: 'Building 2' }), 'B2');
  assert.strictEqual(IMPORT.matchBuilding('SJ1', CAMPUS, { SJ1: 'B2' }), 'B2');
  assert.strictEqual(IMPORT.matchBuilding('SJ1', CAMPUS, { SJ1: null }), null);
  assert.strictEqual(IMPORT.matchBuilding('', CAMPUS, { '': 'B1' }), 'B1');
  assert.strictEqual(IMPORT.matchBuilding('SJ1', CAMPUS, { SJ1: 'B7' }), 'B1', 'unknown alias target falls back to auto');
});
test('floor values -> floor numbers', () => {
  const table = [['3', 3], ['03', 3], ['L3', 3], ['Level 3', 3], ['Floor 3', 3], ['3F', 3], ['3rd', 3], ['Fl. 3', 3],
    ['third', 3], ['Third Floor', 3], ['three', 3], ['G', 1], ['Ground', 1], ['Lobby', 1], ['ground floor', 1], ['1st', 1],
    ['2nd floor', 2], ['Level-04', 4], ['F2', 2], ['3.0', 3], ['SJ1 Floor 3', 3], ['LEVEL 2', 2], ['4th Fl', 4],
    ['B1', -1], ['Basement', 0], ['LL', 0], ['P2', -2], ['-1', -1], ['Basement Level 1', -1], ['Level B1', -1], ['Lower Level', 0],
    ['B1-3', null], ['3.5', null], ['Mezz', null], ['', null], ['Roof', null], ['Floor', null], [null, null], [{}, null]];
  for (const [raw, want] of table) assert.strictEqual(IMPORT.parseFloor(raw), want, JSON.stringify(raw));
});

// ====================================================================== normalize
const BIG = [
  'Seating export - do not forward',                                          // 1
  'Building,Floor,Desk,Name,Team,Title,X,Y,Rotation',                         // 2
  'B1,3,3-114,"Shah, Priya",Verification,Staff engineer,"1,234.5",-4,90',     // 3
  'SJ1,L3,3-115,Ken   Ito,Verification,Engineer,,,',                         // 4
  'Bldg 2,Ground,1-020,Vacant,Finance,,10,20,',                               // 5
  'B2,1,1-021,Open,Finance,,,,',                                              // 6 open desk without X/Y: silent
  'B2,1,,--,Finance,,,,',                                                     // 7 silent
  'SJ9,2,2-001,Lee Park,Sales,AE,,,',                                         // 8 unknown building
  'B1,7,7-001,Max Roe,Operations,Tech,,,',                                    // 9 floor out of range
  'B1,Mezz,M-01,Ann Lee,Operations,Tech,,,',                                  // 10 unreadable floor
  'B2,2,2-050,PRIYA  SHAH,Finance,Analyst,,,',                                // 11 duplicate person
  'B1,3,3-114,Raj Patel,Verification,Engineer,,,',                            // 12 shared desk
  ',3,3-117,Nadia Noor,Verification,Engineer,,,',                             // 13 no building
  'B1,,3-118,Omar Diaz,Verification,"Engineer,\nDFT",,,',                     // 14-15 floor from desk id (quoted newline)
  'B1,,X-9,Gil Hal,Verification,Engineer,,,',                                 // 16 no floor
  'B1,B1,1-001,Low Person,Ops,Tech,,,',                                       // 17 basement
  'B1,3,3-119,Pos Person,Ops,Tech,abc,5,',                                    // 18 bad X
  'B1,3,3-120,Rot Person,Ops,Tech,1,2,east',                                  // 19 bad rotation
].join('\r\n') + '\r\n';
test('normalize: realistic messy file', () => {
  const res = csvLoad(BIG);
  assert.deepStrictEqual(Object.keys(res.floors).sort(), ['B1-3', 'B2-1']);
  const b13 = res.floors['B1-3'];
  assert.deepStrictEqual(b13.map(e => e.name), ['Priya Shah', 'Ken Ito', 'Raj Patel', 'Omar Diaz', 'Pos Person', 'Rot Person']);
  assert.deepStrictEqual(b13[0], { desk: '3-114', name: 'Priya Shah', team: 'Verification', title: 'Staff engineer', x: 1234.5, y: -4, rot: 90 });
  assert.deepStrictEqual(b13[1], { desk: '3-115', name: 'Ken Ito', team: 'Verification', title: 'Engineer' });
  assert.strictEqual(b13[3].title, 'Engineer, DFT');
  assert.ok(!('x' in b13[4]), 'bad X drops the position');
  assert.deepStrictEqual(b13[5], { desk: '3-120', name: 'Rot Person', team: 'Ops', title: 'Tech', x: 1, y: 2 });
  assert.deepStrictEqual(res.floors['B2-1'], [{ desk: '1-020', name: '', team: 'Finance', title: '', x: 10, y: 20, vacant: true }]);
  assert.deepStrictEqual(res.buildings, { B1: 'B1', SJ1: 'B1', 'Bldg 2': 'B2', SJ9: null, B2: 'B2', '': null });
  const rows = res.problems.map(p => p.row);
  assert.deepStrictEqual(rows, [8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19]);
  const msg = row => res.problems.filter(p => p.row === row).map(p => p.msg).join(' | ');
  assert.match(msg(8), /Lee Park: building "SJ9" isn.t one of this campus.s buildings \(Building 1, Building 2\)/);
  assert.match(msg(9), /Max Roe: Building 1 has floors 1.4, but this row says floor "7"/);
  assert.match(msg(10), /Ann Lee: couldn.t read the floor "Mezz"/);
  assert.match(msg(11), /PRIYA SHAH is listed more than once \(first on row 3\)\. Kept row 3/);
  assert.match(msg(12), /Desk 3-114 \(Building 1 . Floor 3\) is assigned to both Priya Shah and Raj Patel\. Kept both\./);
  assert.match(msg(13), /Nadia Noor: no building given/);
  assert.match(msg(14), /taken from the start of the desk id/);
  assert.match(msg(16), /Gil Hal: no floor given/);
  assert.match(msg(17), /below ground/);
  assert.match(msg(18), /Pos Person: the position \(X "abc", Y "5"\)/);
  assert.match(msg(19), /rotation "east" isn.t a number/);
  // 16 records (lines 14-15 are one record); skipped = rows 8, 9, 10, 11, 13, 16, 17
  assert.deepStrictEqual(res.stats, { rows: 16, people: 6, vacant: 1, skipped: 7, blank: 2 });
});
test('normalize: names (Last, First / first+last / suffix / note / control chars / caps)', () => {
  const t = 'Building,Floor,Desk,Name,First Name,Last Name,Team,Title\n' +
    'B1,1,1-1,"Smith, John, Jr.",,,T,t\n' +
    'B1,1,1-2,"Shah, Priya (Contractor)",,,T,t\n' +
    'B1,1,1-3,,Ken,Ito,T,t\n' +
    'B1,1,1-4,"  Ana\t\u0007Lee\u200B ",,,T,t\n' +
    'B1,1,1-5,"John Smith, PhD",,,T,t\n' +
    'B1,1,1-6,,,Madonna,T,t\n' +
    'B1,1,' + 'D'.repeat(30) + ',' + 'N'.repeat(100) + ',,,' + 'T'.repeat(70) + ',' + 'x'.repeat(90) + '\n';
  const res = csvLoad(t);
  const list = res.floors['B1-1'];
  assert.deepStrictEqual(list.map(e => e.name).slice(0, 6), ['John Smith Jr.', 'Priya Shah (Contractor)', 'Ken Ito', 'Ana Lee', 'John Smith PhD', 'Madonna']);
  const long = list[6];
  assert.strictEqual(long.name.length, 80);
  assert.strictEqual(long.desk.length, 24);
  assert.strictEqual(long.team.length, 60);
  assert.strictEqual(long.title.length, 80);
  assert.strictEqual(res.problems.length, 1);
  assert.match(res.problems[0].msg, /shortened the name \(80\), desk id \(24\), team \(60\), title \(80\)/);
  assert.strictEqual(res.problems[0].row, 8);
});
test('normalize: vacant markers kept only with desk + X/Y', () => {
  const marks = ['Vacant', 'OPEN', 'Available', 'Unassigned', 'TBD', 'Hot Desk', '--', '(vacant)', 'Open desk', 'n/a', '', 'Reserved - new hire', 'Vacant Seat'];
  let t = 'Building,Floor,Desk,Name,Team,X,Y\n';
  marks.forEach((m, i) => { t += 'B1,2,2-' + i + ',"' + m + '",Lab,' + i + ',1\n'; });
  t += 'B1,2,2-90,Vacant,Lab,,\n';             // no X/Y -> dropped
  t += 'B1,2,,Vacant,Lab,4,4\n';               // no desk -> dropped
  t += 'B1,2,2-91,"Yilmaz, Nil",Lab,,\n';      // real names that look like markers
  t += 'B1,2,2-92,"Openshaw, Ann",Lab,,\n';
  const res = csvLoad(t);
  const list = res.floors['B1-2'];
  const open = list.filter(e => e.vacant);
  assert.strictEqual(open.length, marks.length);
  for (const e of open) assert.strictEqual(e.name, '');
  assert.deepStrictEqual(list.filter(e => !e.vacant).map(e => e.name), ['Nil Yilmaz', 'Ann Openshaw']);
  assert.deepStrictEqual(res.problems, []);
  assert.strictEqual(res.stats.blank, 2);
});
test('normalize: emails become names (never stored), ID numbers are not names', () => {
  const res = csvLoad('Building,Floor,Desk,Name\nB1,1,1-1,priya.shah+lab@corp.example\nB1,1,1-2,10023\nB1,1,1-3,#4471\nB1,1,1-4,KEN_ITO@corp.example\nB1,1,1-5,--\n');
  assert.deepStrictEqual(res.floors['B1-1'].map(e => e.name), ['Priya Shah', 'Ken Ito']);
  assert.ok(!JSON.stringify(res.floors).includes('@'), 'no email kept anywhere');
  assert.deepStrictEqual(res.problems.map(p => p.row), [2, 3]);
  assert.match(res.problems[0].msg, /2 names had email addresses in them/);
  assert.match(res.problems[1].msg, /2 names look like an ID number, not a name \(for example "10023"\)/);
  assert.strictEqual(res.stats.skipped, 2);
  assert.strictEqual(res.stats.blank, 1);
});
test('normalize: an email next to the name is dropped, the name kept', () => {
  const res = csvLoad('Building,Floor,Desk,Name,First,Last\n' +
    'B1,1,1-1,Ada Example <ada.example@corp.example>,,\n' +
    'B1,1,1-2,"Sample, Sam <sam.sample@corp.example>",,\n' +
    'B1,1,1-3,Pat (pat@corp.example),,\n' +
    'B1,1,1-4,"Placeholder, Kim, kim.p@corp.example",,\n' +
    'B1,1,1-5,"""Bo Demo"" <mailto:bo.demo@corp.example>",,\n' +
    'B1,1,1-6,<ann.ok@corp.example>,,\n' +
    'B1,1,1-7,,Lee,Test <lee.test@corp.example>\n' +
    'B1,1,1-8,"Shah, Priya (priya@corp.example)",,\n' +
    'B1,1,1-9,Ann @ Lab,,\n' +
    'B1,1,1-10,Ken Ito (Contractor),,\n' +
    'B1,1,1-11,Max Sample | max@corp.example,,\n' +
    'B1,1,1-12,Uma Test - uma@corp.example,,\n' +
    'B1,1,1-13,dee.demo@corp.example (Dee Demo),,\n' +
    'B1,1,1-14,<mailto: joe.sample@corp.example>,,\n' +
    'B1,1,1-15,Ray (works @ HQ),,\n');
  assert.deepStrictEqual(res.floors['B1-1'].map(e => e.name),
    ['Ada Example', 'Sam Sample', 'Pat', 'Kim Placeholder', 'Bo Demo', 'Ann Ok', 'Lee Test', 'Priya Shah', 'Ann @ Lab', 'Ken Ito (Contractor)',
     'Max Sample', 'Uma Test', 'Dee Demo', 'Joe Sample', 'Ray (works @ HQ)']);
  assert.ok(!JSON.stringify(res.floors).replace('Ann @ Lab', '').replace('Ray (works @ HQ)', '').includes('@'), 'no email kept anywhere');
  assert.strictEqual(res.problems.length, 1);
  assert.match(res.problems[0].msg, /^12 names had email addresses in them/);
});
test('normalize: open desk and person at the same desk -> person keeps the X/Y', () => {
  const res = csvLoad('Building,Floor,Desk,Name,Team,Title,X,Y\nB1,3,3-200,Vacant,,,5,6\nB1,3,3-200,Ken Ito,Finance,Analyst,,\nB1,3,3-201,Open,,,7,8\nB1,3,3-201,Open,,,7,8\n');
  assert.deepStrictEqual(res.floors['B1-3'], [
    { desk: '3-200', name: 'Ken Ito', team: 'Finance', title: 'Analyst', x: 5, y: 6 },
    { desk: '3-201', name: '', team: '', title: '', x: 7, y: 8, vacant: true }]);
});
test('normalize: duplicates across floors match on case, accents and spacing', () => {
  const res = csvLoad('Building,Floor,Name\nB1,1,Jos\u00E9 \u00C1lvarez\nB2,4,jose   alvarez\nB2,4,Ken Ito\n');
  assert.deepStrictEqual(Object.keys(res.floors), ['B1-1', 'B2-4']);
  assert.strictEqual(res.floors['B2-4'].length, 1);
  assert.deepStrictEqual(res.problems.map(p => p.row), [3]);
});
test('nameKey: Latin accents fold, other scripts keep their vowel signs and dakuten', () => {
  const k = IMPORT.nameKey;
  for (const [a, b] of [['José García', 'jose garcia'], ['Zoë', 'Zoe'], ['Nguyễn Văn', 'nguyen van'], ['O’Brien, Pat', 'obrien pat'],
    ['José', 'José'], ['ｶﾞｷ', 'ガキ'], ['Ann ❤️ Lee', 'ann lee']]) assert.strictEqual(k(a), k(b), a + ' = ' + b);
  for (const [a, b] of [['राजू शर्मा', 'राजा शर्मा'], ['रवि', 'रव'],
    ['ゆうご', 'ゆうこ'], ['ガキ', 'ガギ'], ['สมชาย', 'สมชาย่']]) assert.notStrictEqual(k(a), k(b), a + ' != ' + b);
  const res = csvLoad('Building,Floor,Desk,Name\nB1,1,1-1,राजू शर्मा\nB1,1,1-2,राजा शर्मा\n');
  assert.strictEqual(res.floors['B1-1'].length, 2);
  assert.deepStrictEqual(res.problems, []);
});
test('normalize: numbers with thousands separators and decimal commas', () => {
  const semi = csvLoad('Building;Floor;Desk;Name;X;Y\nB1;3;3-1;A B;1234,5;-0,5\nB1;3;3-2;C D;1.234,5;2\nB1;3;3-3;E F;1,234;3\n');
  assert.deepStrictEqual(semi.floors['B1-3'].map(e => [e.x, e.y]), [[1234.5, -0.5], [1234.5, 2], [1.234, 3]]);
  const comma = csvLoad('Building,Floor,Desk,Name,X,Y\nB1,3,3-1,A B,"1,234",12.5 m\nB1,3,3-2,C D,"0,5",\'-7\n');
  assert.deepStrictEqual(comma.floors['B1-3'].map(e => [e.x, e.y]), [[1234, 12.5], [0.5, -7]]);
});
test('normalize: missing building column', () => {
  const t = 'Name,Floor,Desk\nPriya Shah,3,3-114\nKen Ito,2,2-1\n';
  const two = csvLoad(t);
  assert.deepStrictEqual(two.floors, {});
  assert.strictEqual(two.problems.length, 1);
  assert.match(two.problems[0].msg, /no building column/);
  assert.deepStrictEqual(two.buildings, { '': null });
  assert.deepStrictEqual(Object.keys(csvLoad(t, CAMPUS, { '': 'B2' }).floors), ['B2-3', 'B2-2']);
  assert.deepStrictEqual(Object.keys(csvLoad(t, ONE_BUILDING).floors), ['B1-3', 'B1-2']);
});
test('normalize: missing floor column -> floor from desk id, else one summary', () => {
  const res = csvLoad('Building,Desk,Name\nB1,3-114,Priya Shah\nB1,L2-007,Ken Ito\nB1,X1,Ana Lee\nB1,,Raj Patel\n');
  assert.deepStrictEqual(Object.keys(res.floors), ['B1-3', 'B1-2']);
  assert.strictEqual(res.problems.length, 2);
  assert.match(res.problems[0].msg, /taken from the start of the desk id/);
  assert.match(res.problems[1].msg, /no floor column, and 2 rows. desk ids don.t start with a floor number/);
});
test('normalize: no name column reports once and keeps open desks with X/Y', () => {
  const res = csvLoad('Building,Floor,Desk,X,Y\nB1,1,1-1,3,4\nB1,1,1-2,,\n');
  assert.strictEqual(res.problems.length, 1);
  assert.match(res.problems[0].msg, /Couldn.t find a column with people.s names/);
  assert.deepStrictEqual(res.floors['B1-1'], [{ desk: '1-1', name: '', team: '', title: '', x: 3, y: 4, vacant: true }]);
});
test('normalize: alias marks a building as not on campus', () => {
  const res = csvLoad('Building,Floor,Name\nSJ1,1,A B\nSC5,1,C D\n', CAMPUS, { SC5: null });
  assert.match(res.problems[0].msg, /SC5" was marked as not on this campus/);
  assert.deepStrictEqual(res.buildings, { SJ1: 'B1', SC5: null });
});
test('normalize: long file values are shortened inside messages; string column indexes accepted', () => {
  const res = csvLoad('Building,Floor,Name\n' + 'Z'.repeat(5000) + ',1,A B\n');
  assert.ok(res.problems[0].msg.length < 300, 'message stays short');
  assert.match(res.problems[0].msg, /"Z{40}\u2026"/);
  const r = IMPORT.normalize({ rows: [['B1', '2', 'A B']] }, { building: '0', floor: ' 1 ', name: 2 }, CAMPUS);
  assert.deepStrictEqual(Object.keys(r.floors), ['B1-2']);
});
test('normalize: formula guard undone, odd keys safe', () => {
  const res = csvLoad('Building,Floor,Name,Team\nB1,1,A B,"\'=1+2"\n__proto__,1,C D,X\n');
  assert.strictEqual(res.floors['B1-1'][0].team, '=1+2');
  assert.ok(Object.prototype.hasOwnProperty.call(res.buildings, '__proto__'));
  assert.strictEqual(res.buildings.__proto__, null);
  assert.strictEqual(({}).B1, undefined);
});
test('normalize: never throws on garbage', () => {
  const bad = [[null, null, null], [{}, {}, {}], [{ rows: [null, 5, 'x', ['B1', '1', 'A B']] }, { building: 0, floor: 1, name: 2 }, CAMPUS],
    [{ rows: [['B1', '1', 'A B']] }, { building: 0, floor: '1', name: 9 }, { buildings: [null, { id: '' }, { id: 'B1', floors: 'abc' }] }],
    [IMPORT.parseCSV('Building,Floor,Name\nB1,2,A'), IMPORT.mapColumns(['Building', 'Floor', 'Name']), 'not a campus', 7]];
  for (const args of bad){
    const r = IMPORT.normalize(...args);
    assert.ok(r && typeof r.floors === 'object' && Array.isArray(r.problems) && typeof r.buildings === 'object');
  }
  // the plain map form and the mapColumns() result form both work
  const p = IMPORT.parseCSV('Building,Floor,Name\nB1,2,A B\n');
  const m = IMPORT.mapColumns(p.header);
  assert.deepStrictEqual(IMPORT.normalize(p, m.map, CAMPUS).floors, IMPORT.normalize(p, m, CAMPUS).floors);
  // building with floors:'abc' defaults to 4 floors
  const r = IMPORT.normalize({ rows: [['B1', '4', 'A B']] }, { building: 0, floor: 1, name: 2 }, { buildings: [{ id: 'B1', floors: 'abc' }] });
  assert.deepStrictEqual(Object.keys(r.floors), ['B1-4']);
});
test('normalize: 20k-row CSV parse + normalize < 500 ms', () => {
  const FIRST = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Priya'];
  const LAST = ['Adams', 'Baker', 'Chen', 'Diaz', 'Ellis', 'Fox', 'Garcia', 'Hill', 'Ito', 'Jensen', 'Khan', 'Lopez'];
  const TEAMS = ['Verification', 'Validation Lab', 'Finance', 'Physical Design', 'Sales'];
  const lines = ['Building,Floor,Desk,Name,Team,Title,X,Y'];
  for (let i = 0; i < 20000; i++){
    const b = i % 2 ? 'B2' : 'Building 1', f = 1 + (Math.floor(i / 2) % 4);
    lines.push([b, 'Level ' + f, f + '-' + (100 + (i % 900)), '"' + LAST[i % 12] + i + ', ' + FIRST[i % 16] + '"', TEAMS[i % 5],
      'Engineer', (i % 70) - 35 + '.5', (i % 40) - 20].join(','));
  }
  const text = lines.join('\r\n') + '\r\n';
  const t0 = process.hrtime.bigint();
  const p = IMPORT.parseCSV(text);
  const res = IMPORT.normalize(p, IMPORT.mapColumns(p.header), CAMPUS);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(res.stats.people, 20000);
  assert.strictEqual(Object.keys(res.floors).length, 8);
  assert.ok(ms < 500, '20k rows took ' + ms.toFixed(0) + ' ms');
  console.log('  perf: 20k rows parse+normalize ' + ms.toFixed(0) + ' ms');
});

// ====================================================================== diff
test('diff: added, removed, moved, changed, same', () => {
  const oldR = {
    'B1-3': [{ desk: '3-114', name: 'Priya Shah', team: 'Verification', title: 'Staff engineer' },
             { desk: '3-115', name: 'Ken Ito', team: 'Verification', title: 'Engineer' },
             { desk: '3-116', name: 'Jos\u00E9 \u00C1lvarez', team: 'Lab', title: 'Tech' },
             { desk: '3-117', name: 'Gone Person', team: 'Lab', title: 'Tech' }],
    'B2-1': [{ desk: '1-1', name: 'Same Person', team: 'Fin', title: 'Analyst' }],
  };
  const newR = {
    'B2-1': { v: 1, rows: [['1-1', 'Same Person', 'fin', 'analyst'], ['1-2', 'Jose  Alvarez', 'Lab', 'Tech'], ['1-3', 'New Person', 'Fin', 'Analyst'], ['1-4', '', 'Fin', '']] },
    'B1-3': [{ desk: '3-114', name: 'priya  shah', team: 'Verification', title: 'Principal engineer' },
             { desk: '3-120', name: 'Ken Ito', team: 'Physical Design', title: 'Engineer' }],
  };
  const d = IMPORT.diff(oldR, newR);
  assert.deepStrictEqual(d.added, [{ name: 'New Person', to: 'B2-1 \u00B7 1-3', team: 'Fin', title: 'Analyst' }]);
  assert.deepStrictEqual(d.removed, [{ name: 'Gone Person', from: 'B1-3 \u00B7 3-117', team: 'Lab', title: 'Tech' }]);
  assert.deepStrictEqual(d.moved, [{ name: 'Ken Ito', from: 'B1-3 \u00B7 3-115', to: 'B1-3 \u00B7 3-120' },
                                   { name: 'Jose Alvarez', from: 'B1-3 \u00B7 3-116', to: 'B2-1 \u00B7 1-2' }]);
  assert.deepStrictEqual(d.changed, [{ name: 'priya shah', field: 'title', from: 'Staff engineer', to: 'Principal engineer' },
                                     { name: 'Ken Ito', field: 'team', from: 'Verification', to: 'Physical Design' }]);
  assert.strictEqual(d.same, 1);
});
test('diff: floor keys sort naturally, empty desk shown without separator, garbage safe', () => {
  const d = IMPORT.diff({}, { 'B1-10': [{ name: 'Z Z', desk: '' }], 'B1-2': [{ name: 'A A', desk: '2-1' }] });
  assert.deepStrictEqual(d.added.map(a => a.to), ['B1-2 \u00B7 2-1', 'B1-10']);
  for (const [a, b] of [[null, null], [undefined, 5], ['x', { k: 'y' }], [{ k: [null, 3, { name: 7 }] }, {}]]){
    const r = IMPORT.diff(a, b);
    assert.ok(Array.isArray(r.added) && Array.isArray(r.removed) && Array.isArray(r.moved) && Array.isArray(r.changed));
  }
  assert.strictEqual(IMPORT.diff({ k: [{ name: 'A B', vacant: true }] }, {}).removed.length, 0);
});

// ====================================================================== DXF
// pairs -> DXF text, group codes right-aligned like AutoCAD writes them (with some odd spacing)
function dxf(pairs, eol = '\r\n'){
  return pairs.map(([c, v], i) => (i % 7 === 3 ? String(c) + '  ' : String(c).padStart(3)) + eol + v).join(eol) + eol;
}
const HEADER = units => units == null ? [] : [[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1027'], [9, '$INSUNITS'], [70, units], [9, '$EXTMIN'], [10, 0], [20, 0], [0, 'ENDSEC']];
const ENTITIES = list => [[0, 'SECTION'], [2, 'ENTITIES'], ...list, [0, 'ENDSEC'], [0, 'EOF']];
const LINE = (layer, a, b, c, d) => [[0, 'LINE'], [5, '1A'], [100, 'AcDbEntity'], [8, layer], [100, 'AcDbLine'], [10, a], [20, b], [30, 0], [11, c], [21, d], [31, 0]];
const doc = (units, list, eol) => dxf([...HEADER(units), ...ENTITIES(list)], eol);

test('dxf: LINE, units, layers, bounds, note', () => {
  const r = IMPORT.parseDXF(doc(4, [...LINE('A-WALL', 0, 0, 1000, 0), ...LINE('A-WALL', 1000, 0, 1000, 500), ...LINE('A-GLAZ', 0, 500, 0, 0)]));
  assert.strictEqual(r.error, undefined);
  assert.strictEqual(r.units, 'mm');
  assert.strictEqual(r.scale, 0.001);
  assert.deepStrictEqual(r.segments[0], { layer: 'A-WALL', x1: 0, y1: 0, x2: 1000, y2: 0 });
  assert.deepStrictEqual(r.layers, { 'A-WALL': 2, 'A-GLAZ': 1 });
  assert.deepStrictEqual(r.bounds, { x0: 0, y0: 0, x1: 1000, y1: 500 });
  assert.match(r.note, /blocks or external references \(xrefs\) are not read/);
});
test('dxf: $INSUNITS table', () => {
  const one = LINE('0', 0, 0, 1, 1);
  const cases = [[1, 'in', 0.0254], [2, 'ft', 0.3048], [4, 'mm', 0.001], [5, 'cm', 0.01], [6, 'm', 1], [0, 'unknown', null], [null, 'unknown', null], [99, 'unknown', null]];
  for (const [u, name, scale] of cases){
    const r = IMPORT.parseDXF(doc(u, one));
    assert.strictEqual(r.units, name, 'units ' + u);
    assert.strictEqual(r.scale, scale, 'scale ' + u);
  }
  assert.match(IMPORT.parseDXF(doc(0, one)).note, /doesn.t say what units/);
});
test('dxf: LWPOLYLINE closed / open (bulges drawn straight), extrusion flip', () => {
  const lw = (closed, pts, extra = []) => [[0, 'LWPOLYLINE'], [8, 'WALLS'], [90, pts.length], [70, closed ? 1 : 0], ...extra,
    ...pts.flatMap(([x, y], i) => i === 1 ? [[10, x], [20, y], [42, 0.5]] : [[10, x], [20, y]])];
  const r = IMPORT.parseDXF(doc(6, [...lw(true, [[0, 0], [10, 0], [10, 5], [0, 5]]), ...lw(false, [[20, 0], [30, 0], [30, 5]])]));
  assert.strictEqual(r.segments.length, 6);
  assert.deepStrictEqual(r.segments[3], { layer: 'WALLS', x1: 0, y1: 5, x2: 0, y2: 0 });
  assert.deepStrictEqual(r.segments[5], { layer: 'WALLS', x1: 30, y1: 0, x2: 30, y2: 5 });
  const f = IMPORT.parseDXF(doc(6, lw(false, [[1, 2], [3, 2]], [[210, 0], [220, 0], [230, -1]])));
  assert.deepStrictEqual(f.segments[0], { layer: 'WALLS', x1: -1, y1: 2, x2: -3, y2: 2 });
});
test('dxf: POLYLINE / VERTEX / SEQEND; meshes skipped; missing SEQEND tolerated', () => {
  const vtx = (x, y, fl = 0) => [[0, 'VERTEX'], [8, 'V'], [10, x], [20, y], [30, 0], [70, fl]];
  const poly = (flags) => [[0, 'POLYLINE'], [8, 'CORE'], [66, 1], [10, 0], [20, 0], [30, 0], [70, flags], ...vtx(0, 0), ...vtx(4, 0), ...vtx(4, 3), [0, 'SEQEND'], [8, 'CORE']];
  const r = IMPORT.parseDXF(doc(6, [...poly(1), ...poly(64)]));
  assert.strictEqual(r.segments.length, 3);
  assert.ok(r.segments.every(s => s.layer === 'CORE'));
  assert.deepStrictEqual(r.segments[2], { layer: 'CORE', x1: 4, y1: 3, x2: 0, y2: 0 });
  const noEnd = [[0, 'POLYLINE'], [8, 'P'], [70, 0], ...vtx(0, 0), ...vtx(1, 0), ...LINE('L', 5, 5, 6, 6)];
  const r2 = IMPORT.parseDXF(doc(6, noEnd));
  assert.deepStrictEqual(r2.layers, { P: 1, L: 1 });
});
test('dxf: ARC approximated every <= 15 degrees; CIRCLE ignored', () => {
  const arc = (a1, a2) => [[0, 'ARC'], [8, 'A-WALL'], [10, 0], [20, 0], [30, 0], [40, 10], [100, 'AcDbArc'], [50, a1], [51, a2]];
  const r = IMPORT.parseDXF(doc(6, [...arc(0, 90), [0, 'CIRCLE'], [8, 'COL'], [10, 5], [20, 5], [40, 0.3]]));
  assert.strictEqual(r.segments.length, 6);
  near(r.segments[0].x1, 10); near(r.segments[0].y1, 0);
  near(r.segments[5].x2, 0); near(r.segments[5].y2, 10);
  for (const s of r.segments){
    const a = Math.atan2(s.y2, s.x2) - Math.atan2(s.y1, s.x1);
    assert.ok(a > 0 && a <= 15 * Math.PI / 180 + 1e-9);
  }
  assert.deepStrictEqual(r.ignored, { CIRCLE: 1 });
  const wrap = IMPORT.parseDXF(doc(6, arc(350, 10)));
  assert.strictEqual(wrap.segments.length, 2);
  near(wrap.segments[1].x2, 10 * Math.cos(10 * Math.PI / 180));
  const full = IMPORT.parseDXF(doc(6, arc(30, 30)));
  assert.strictEqual(full.segments.length, 24);
});
test('dxf: TEXT and MTEXT cleaned', () => {
  const r = IMPORT.parseDXF(doc(6, [
    [0, 'TEXT'], [8, 'A-ANNO'], [10, 1], [20, 2], [40, 0.25], [1, 'COL %%c300 %%d %%p1 100%%%'],
    [0, 'TEXT'], [8, 'A-ANNO'], [10, 1], [20, 2], [40, 0.25], [1, 'CENTERED'], [72, 1], [11, 5], [21, 6],
    [0, 'MTEXT'], [8, 'RM-NAME'], [10, 7], [20, 8], [40, 0.5], [3, '{\\fArial|b1|i0|c0|p34;Sili'], [1, 'con}\\PConf \\H2.5x;Room\\~3-114'],
    [0, 'MTEXT'], [8, 'RM-NAME'], [10, 9], [20, 9], [40, 0.5], [1, '\\A1;Caf\\U+00E9 {\\C1;\\LKitchen\\l} 1\\S1/2; a\\\\b \\{x\\}'],
    [0, 'TEXT'], [8, 'EMPTY'], [10, 0], [20, 0], [1, '   '],
  ]));
  assert.deepStrictEqual(r.texts.map(t => t.text), ['COL \u00D8300 \u00B0 \u00B11 100%', 'CENTERED', 'Silicon Conf Room 3-114', 'Caf\u00E9 Kitchen 11/2 a\\b {x}']);
  assert.deepStrictEqual(r.texts[0], { layer: 'A-ANNO', x: 1, y: 2, text: 'COL \u00D8300 \u00B0 \u00B11 100%', h: 0.25 });
  assert.deepStrictEqual([r.texts[1].x, r.texts[1].y], [5, 6], 'aligned TEXT uses its alignment point');
  assert.strictEqual(r.segments.length, 0);
  assert.deepStrictEqual(r.bounds, { x0: 1, y0: 2, x1: 9, y1: 9 }, 'no walls: bounds frame the labels');
});
test('dxf: INSERT with attributes; BLOCKS section not read', () => {
  const blocks = [[0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [8, '0'], [2, 'DESK-60x30'], [10, 0], [20, 0], ...LINE('IN-BLOCK', 0, 0, 1.5, 0), [0, 'ENDBLK'], [0, 'ENDSEC']];
  const ents = [[0, 'INSERT'], [8, 'I-FURN'], [66, 1], [2, 'DESK-60x30'], [10, 5], [20, 6], [30, 0], [41, 1], [50, 90],
    [0, 'ATTRIB'], [8, 'I-FURN'], [10, 5], [20, 6], [40, 0.2], [1, '3-114'], [2, 'DESKID'], [70, 0],
    [0, 'ATTRIB'], [8, 'I-FURN'], [10, 5], [20, 6], [40, 0.2], [1, 'secret'], [2, 'HIDDEN'], [70, 1],
    [0, 'SEQEND'], [8, 'I-FURN'],
    [0, 'INSERT'], [8, 'I-FURN'], [2, 'CHAIR'], [10, 1], [20, 1]];
  const r = IMPORT.parseDXF(dxf([...HEADER(2), ...blocks, ...ENTITIES(ents)]));
  assert.deepStrictEqual(r.inserts, [{ layer: 'I-FURN', block: 'DESK-60x30', x: 5, y: 6, rot: 90 }, { layer: 'I-FURN', block: 'CHAIR', x: 1, y: 1, rot: 0 }]);
  assert.deepStrictEqual(r.texts.map(t => t.text), ['3-114']);
  assert.strictEqual(r.segments.length, 0);
  assert.ok(!('IN-BLOCK' in r.layers));
  assert.match(r.note, /2 block references were found/);
});
test('dxf: LF and CR line endings, blank trailing lines, junk', () => {
  const pairs = [...HEADER(6), ...ENTITIES(LINE('W', 0, 0, 2, 0))];
  for (const eol of ['\n', '\r']){
    const r = IMPORT.parseDXF(dxf(pairs, eol) + eol + eol);
    assert.strictEqual(r.segments.length, 1, JSON.stringify(eol));
    assert.strictEqual(r.units, 'm');
  }
  const bin = IMPORT.parseDXF('AutoCAD Binary DXF\r\n\u001a\u0000\u0000\u0001');
  assert.strictEqual(bin.error, 'binary');
  assert.deepStrictEqual(bin.segments, []);
  assert.strictEqual(IMPORT.parseDXF('AC1032\u0000\u0000junk').error, 'dwg');
  assert.strictEqual(IMPORT.parseDXF('hello world').error, 'not-dxf');
  for (const v of ['', null, undefined, 5, {}]) assert.strictEqual(IMPORT.parseDXF(v).error, 'empty');
  // NaN coordinates and zero-length lines are skipped, odd layer names are plain keys
  const odd = IMPORT.parseDXF(doc(6, [...LINE('__proto__', 0, 0, 0, 0), ...LINE('__proto__', 0, 0, 'abc', 1), ...LINE('__proto__', 0, 0, 1, 1)]));
  assert.strictEqual(odd.segments.length, 1);
  assert.ok(Object.prototype.hasOwnProperty.call(odd.layers, '__proto__'));
  assert.strictEqual(odd.layers.__proto__, 1);
});
test('dxf: 100k entities parse in < 1 s', () => {
  const parts = ['  0\r\nSECTION\r\n  2\r\nHEADER\r\n  9\r\n$INSUNITS\r\n 70\r\n     4\r\n  0\r\nENDSEC\r\n  0\r\nSECTION\r\n  2\r\nENTITIES\r\n'];
  for (let i = 0; i < 100000; i++){
    const x = (i % 400) * 250, y = Math.floor(i / 400) * 250;
    parts.push('  0\r\nLINE\r\n  5\r\n' + i.toString(16) + '\r\n100\r\nAcDbEntity\r\n  8\r\nA-WALL-' + (i % 7) + '\r\n100\r\nAcDbLine\r\n 10\r\n' + x +
      '.0\r\n 20\r\n' + y + '.0\r\n 30\r\n0.0\r\n 11\r\n' + (x + 120) + '.5\r\n 21\r\n' + (y + 60) + '.25\r\n 31\r\n0.0\r\n');
  }
  parts.push('  0\r\nENDSEC\r\n  0\r\nEOF\r\n');
  const text = parts.join('');
  const t0 = process.hrtime.bigint();
  const r = IMPORT.parseDXF(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(r.segments.length, 100000);
  assert.strictEqual(Object.keys(r.layers).length, 7);
  assert.ok(ms < 1000, '100k entities took ' + ms.toFixed(0) + ' ms');
  console.log('  perf: 100k DXF entities (' + (text.length / 1e6).toFixed(1) + ' MB) ' + ms.toFixed(0) + ' ms');
});

// ====================================================================== similarity
test('similarity: maps p1->q1, p2->q2 and round-trips', () => {
  const cases = [[[0, 0], [1, 0], [0, 0], [1, 0]], [[0, 0], [1, 0], [10, 10], [10, 12]], [[3.2, -1.5], [-7.1, 4.4], [100, -20], [80, 35]],
    [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: -2, y: 1 }, { x: -2, y: -9 }]];
  const probes = [[0, 0], [1, 1], [-4.5, 7.25], [1000, -333]];
  for (const [p1, p2, q1, q2] of cases){
    const T = IMPORT.similarity(p1, p2, q1, q2);
    assert.strictEqual(T.degenerate, false);
    const a = T.apply(p1), b = T.apply(p2);
    const Q1 = Array.isArray(q1) ? q1 : [q1.x, q1.y], Q2 = Array.isArray(q2) ? q2 : [q2.x, q2.y];
    near(a[0], Q1[0]); near(a[1], Q1[1]); near(b[0], Q2[0]); near(b[1], Q2[1]);
    for (const p of probes){ const back = T.invert(T.apply(p)); near(back[0], p[0], 1e-6); near(back[1], p[1], 1e-6); }
  }
  const T = IMPORT.similarity([0, 0], [1, 0], [10, 10], [10, 12]);
  near(T.s, 2); near(T.r, Math.PI / 2);
  const q = T.apply([1, 1]); near(q[0], 8); near(q[1], 12);
});
test('similarity: degenerate pairs fall back to a translation', () => {
  const T = IMPORT.similarity([2, 3], [2, 3], [10, 10], [50, 50]);
  assert.strictEqual(T.degenerate, true);
  assert.strictEqual(T.s, 1); assert.strictEqual(T.r, 0);
  assert.deepStrictEqual(T.apply([2, 3]), [10, 10]);
  assert.deepStrictEqual(T.apply([3, 3]), [11, 10]);
  assert.strictEqual(IMPORT.similarity([0, 0], [5, 0], [1, 1], [1, 1]).degenerate, true);
  const G = IMPORT.similarity(null, 'x', [NaN, 1], undefined);
  assert.ok(Number.isFinite(G.apply([1, 2])[0]));
});

// ====================================================================== CSV out
test('toCSV: quoting and CRLF', () => {
  assert.strictEqual(IMPORT.toCSV([['a,b', 'he said "hi"', 'line\nbreak', ' pad ', 'plain', 'x;y']]),
    '"a,b","he said ""hi""","line\nbreak"," pad ",plain,"x;y"\r\n');
  assert.strictEqual(IMPORT.toCSV([[null, undefined, NaN, Infinity, 0, 1.5, true]]), ',,,,0,1.5,true\r\n');
  assert.strictEqual(IMPORT.toCSV('nope'), '');
  assert.strictEqual(IMPORT.toCSV([{ a: 1, b: 'x' }, 'solo']), '1,x\r\nsolo\r\n');
});
test('toCSV: formula injection guard', () => {
  const out = IMPORT.toCSV([['=SUM(A1)', '+cmd|x', '-2+3', '@x', '\tfoo', '-12.5', -12.5, '+1', '=1', '1e5']]);
  assert.strictEqual(out, "'=SUM(A1),\"'+cmd|x\",'-2+3,'@x,\"'\tfoo\",-12.5,-12.5,+1,'=1,1e5\r\n");
  // round trip: guarded cells come back as the original text through parseCSV + normalize
  const rows = [['Building', 'Floor', 'Name', 'Team', 'Title', 'X', 'Y', 'Desk'], ['B1', 2, 'Ann Lee', '=HYPERLINK("x")', '@lead, "ops"', -3.5, '-2', '2-1']];
  const p = IMPORT.parseCSV(IMPORT.toCSV(rows));
  assert.deepStrictEqual(p.header, rows[0]);
  const e = IMPORT.normalize(p, IMPORT.mapColumns(p.header), CAMPUS).floors['B1-2'][0];
  assert.deepStrictEqual(e, { desk: '2-1', name: 'Ann Lee', team: '=HYPERLINK("x")', title: '@lead, "ops"', x: -3.5, y: -2 });
});
test('template: header + 3 fake rows that import cleanly', () => {
  const t = IMPORT.template();
  assert.ok(t.startsWith('Building,Floor,Desk,Name,Team,Title,X,Y\r\n'));
  assert.strictEqual(t.split('\r\n').filter(Boolean).length, 4);
  const res = csvLoad(t);
  assert.deepStrictEqual(res.problems, []);
  assert.deepStrictEqual(allPeople(res).map(e => e.name), ['Ada Example', 'Sam Sample', 'Pat Placeholder']);
  assert.deepStrictEqual(Object.keys(res.floors), ['B1-3', 'B2-1']);
});

// ====================================================================== renderPDF (guard + mocked browser)
testAsync('renderPDF: rejects outside a browser and without pdf.js', async () => {
  await assert.rejects(IMPORT.renderPDF(new Blob([new Uint8Array([1])]), {}), /needs a web browser/);
  globalThis.document = { createElement(){ throw new Error('should not be called'); } };
  try {
    await assert.rejects(IMPORT.renderPDF(new Blob([new Uint8Array([1])]), null), /PDF reader didn.t load/);
    await assert.rejects(IMPORT.renderPDF(null, { getDocument(){} }), /No PDF file/);
  } finally { delete globalThis.document; }
});
testAsync('renderPDF: page 1 -> PNG with long side 4096 px, capped at 16M px (mocked pdf.js + canvas)', async () => {
  const made = [];
  globalThis.document = { createElement(tag){
    const c = { tag, width: 0, height: 0,
      getContext(){ return { fillRect(){}, set fillStyle(v){ c.fill = v; } }; },
      toBlob(cb, type){ made.push({ w: c.width, h: c.height, type, fill: c.fill }); cb({ type, size: 1 }); } };
    return c;
  } };
  const fakePdf = (w, h, opts = {}) => ({
    getDocument({ data, isEvalSupported }){
      assert.ok(data instanceof Uint8Array && data.length === 4);
      assert.strictEqual(isEvalSupported, false, 'pdf.js eval off (CVE-2024-4367)');
      if (opts.fail) return { promise: Promise.reject(Object.assign(new Error('pw'), { name: 'PasswordException' })) };
      return { promise: Promise.resolve({ destroy(){ opts.destroyed = true; },
        getPage(n){ assert.strictEqual(n, 1); return Promise.resolve({
          getViewport({ scale }){ return { width: w * scale, height: h * scale }; },
          render({ canvasContext, viewport }){ assert.ok(canvasContext && viewport); return { promise: Promise.resolve() }; } }); } }) };
    } });
  try {
    const file = new Blob([new Uint8Array([37, 80, 68, 70])]);
    const lib = fakePdf(612, 792), state = {};
    const blob = await IMPORT.renderPDF(file, lib);
    assert.strictEqual(blob.type, 'image/png');
    assert.deepStrictEqual(made[0], { w: 3165, h: 4096, type: 'image/png', fill: '#ffffff' });
    await IMPORT.renderPDF(file, fakePdf(1000, 1000, state));
    assert.deepStrictEqual([made[1].w, made[1].h], [4000, 4000], '16M pixel cap');
    assert.ok(state.destroyed, 'document destroyed after rendering');
    await assert.rejects(IMPORT.renderPDF(file, fakePdf(1, 1, { fail: true })), /password-protected/);
  } finally { delete globalThis.document; }
});

(async () => {
  for (const [name, fn] of asyncTests){
    try { await fn(); passed++; }
    catch (e){ failed++; console.error('FAIL ' + name + '\n   ' + String(e && e.message).split('\n').join('\n   ')); }
  }
  console.log('importers: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})();
