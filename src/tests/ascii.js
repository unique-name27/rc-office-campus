// Prints a FloorModel as ASCII at 0.5 m per char (north up) so layouts can be eyeballed.
//   '#' walls/partitions  'g' glass  'd' desk  'c' chair  'i' item  '^' ramp  'E' elevator pad  'X' exit pad
//   '*' dest standing point  'S' spawn  '.' floor finish (zone / room area)  ' ' bare floor
// usage: node tests/ascii.js [fixtureName ...]     (fixtures from tests/layout.fixtures.js; default: all)
const SC = 0.5;
function ascii(m) {
  const nx = Math.ceil(m.w / SC), nz = Math.ceil(m.d / SC);
  const g = Array.from({ length: nz }, () => new Array(nx).fill(' '));
  const put = (x, z, ch) => { const i = Math.min(nx - 1, Math.floor((x + m.w / 2) / SC)), j = Math.min(nz - 1, Math.floor((z + m.d / 2) / SC)); if (i >= 0 && j >= 0 && i < nx && j < nz) g[j][i] = ch; };
  const fill = (x0, x1, z0, z1, ch) => {
    for (let j = 0; j < nz; j++) { const cz = -m.d / 2 + (j + 0.5) * SC; if (cz < z0 || cz > z1) continue;
      for (let i = 0; i < nx; i++) { const cx = -m.w / 2 + (i + 0.5) * SC; if (cx >= x0 && cx <= x1) g[j][i] = ch; } }
    put((x0 + x1) / 2, (z0 + z1) / 2, ch); // tiny things still show up
  };
  const box = (o, w, d, ch) => { const s = Math.abs(Math.sin(o.a || 0)) > 0.5, ex = (s ? d : w) / 2, ez = (s ? w : d) / 2; fill(o.x - ex, o.x + ex, o.z - ez, o.z + ez, ch); };
  for (const a of m.areas) fill(a.x - a.w / 2, a.x + a.w / 2, a.z - a.d / 2, a.z + a.d / 2, '.');
  for (const it of m.items) box(it, it.w, it.d, 'i');
  for (const d of m.desks) box(d, d.w, d.dd, 'd');
  for (const r of m.ramps) { const along = (r.k === 'kick' ? r.len + 0.28 : r.len); box({ x: r.x, z: r.z, a: r.ax === 'z' ? Math.PI / 2 : 0 }, along, r.w, '^'); }
  for (const w of m.walls) {
    const L = Math.hypot(w.x2 - w.x1, w.z2 - w.z1), n = Math.max(1, Math.ceil(L / 0.1));
    for (let k = 0; k <= n; k++) put(w.x1 + (w.x2 - w.x1) * k / n, w.z1 + (w.z2 - w.z1) * k / n, w.kind === 'glass' ? 'g' : '#');
  }
  for (const c of m.chairs) put(c.x, c.z, 'c');
  for (const d of m.dests) put(d.x, d.z, '*');
  for (const e of m.elevators) put(e.pad.x, e.pad.z, 'E');
  if (m.exit) put(m.exit.x, m.exit.z, 'X');
  put(m.spawn.x, m.spawn.z, 'S');
  return g.map(r => r.join('')).join('\n');
}
module.exports = ascii;

if (require.main === module) {
  const LAYOUT = require('./load')('layout.js', 'LAYOUT');
  const FX = require('./layout.fixtures');
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FX.floors);
  for (const n of names) {
    const spec = FX.floors[n]; if (!spec) { console.log('no fixture ' + n); continue; }
    const m = LAYOUT.build(spec, FX.roster(n), FX.teams);
    console.log(`\n=== ${n}  ${m.w} x ${m.d} m  desks ${m.stats.desks}  people ${m.stats.occupied}  open ${m.stats.open}  unplaced ${m.stats.unplaced}  ramps ${m.ramps.length}`);
    console.log(ascii(m));
    if (m.problems.length) console.log('problems:\n  ' + m.problems.join('\n  '));
  }
}
