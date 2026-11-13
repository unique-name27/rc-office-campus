/* FUN: the coins and power-up boxes scattered through every floor and the campus (pure: no DOM, no three.js).
   The same world key and the same free() give the same layout on every machine, so everyone sees the coins in the same
   places; which ones you have picked up is yours alone (the game keeps that). */
const FUN = (() => {
  // FNV-1a, then mulberry32: one fixed sequence per world key
  function hash(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

  // what a box gives you: one of these, for dur seconds
  //   turbo: top speed and flames, like a drift turbo that lasts;  jumpH: every jump this high (m), grav: gravity scale
  //   magnet: coins within this many metres fly to you;  coin: each coin counts this many times
  const POWERS = {
    coffee: { n: 'Coffee rush', d: 'Full speed, flames and all', dur: 6, turbo: true },
    moon: { n: 'Moon jump', d: 'Huge floaty jumps', dur: 10, jumpH: 1.7, grav: .55 },
    magnet: { n: 'Coin magnet', d: 'Coins fly to you', dur: 10, magnet: 5 },
    double: { n: 'Double coins', d: 'Every coin counts twice', dur: 15, coin: 2 },
  };
  const IDS = Object.keys(POWERS);
  // a power-up for a box (u in [0, 1)), never the one already running
  function roll(u, cur) { const l = IDS.filter(k => k !== cur); u = Number.isFinite(u) ? Math.min(Math.max(u, 0), .999999) : 0; return l[Math.floor(u * l.length)] }

  const COIN_Y = .32, HOP = .62, STEP = .9, LANE = .45;
  const rd = v => Math.round(v * 100) / 100;
  // Coins come in short straight trails (5 to 7, .9 m apart, along open lanes); every third trail arcs up in the middle,
  // so those coins need a jump. Boxes float alone, spread out across the world.
  // free(x, z) -> true where a coin or box may sit (open floor, clear of walls, desks and tables).
  // o: { avoid: [[x, z, r]] (spawn spot, elevator and door pads), trails, boxes } (counts default from the area)
  // -> { coins: [{x, z, y (above the ground)}], boxes: [{x, z}] }
  function place(key, w, d, free, o) {
    o = o || {}; const r = rng(hash('fun|' + key)), avoid = Array.isArray(o.avoid) ? o.avoid : [];
    if (!(w > 6) || !(d > 6) || typeof free !== 'function') return { coins: [], boxes: [] };
    const area = w * d;
    const nT = Number.isFinite(o.trails) ? o.trails : Math.max(4, Math.min(18, Math.round(area / 220)));
    const nB = Number.isFinite(o.boxes) ? o.boxes : Math.max(3, Math.min(9, Math.round(area / 420)));
    const coins = [], boxes = [], taken = [];
    const blocked = (x, z, m) => taken.some(([a, b, rr]) => Math.hypot(a - x, b - z) < rr + m) || avoid.some(([a, b, rr]) => Math.hypot(a - x, b - z) < rr);
    const ok = (x, z) => Math.abs(x) < w / 2 - 1 && Math.abs(z) < d / 2 - 1 && !!free(x, z);
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let trails = 0;
    for (let tries = 0; tries < nT * 60 && trails < nT; tries++) {
      const x0 = (r() - .5) * (w - 4), z0 = (r() - .5) * (d - 4), dir = DIRS[Math.floor(r() * 4)], n = 5 + Math.floor(r() * 3), hop = trails % 3 === 1;
      const dx = dir[0], dz = dir[1], pts = []; let good = true;
      for (let i = 0; i < n && good; i++) {
        const x = x0 + dx * STEP * i, z = z0 + dz * STEP * i;
        // a lane you can drive along: clear on both sides of the coin too
        if (!ok(x, z) || !ok(x - dz * LANE, z + dx * LANE) || !ok(x + dz * LANE, z - dx * LANE) || blocked(x, z, 1.2)) good = false;
        pts.push([x, z]);
      }
      if (!good) continue;
      pts.forEach(([x, z], i) => coins.push({ x: rd(x), z: rd(z), y: rd(COIN_Y + (hop ? HOP * Math.sin(Math.PI * i / (n - 1)) : 0)) }));
      for (const [x, z] of pts) taken.push([x, z, .45]);
      trails++;
    }
    const gap = Math.max(5, Math.sqrt(area / nB) * .6);
    for (let tries = 0; tries < nB * 80 && boxes.length < nB; tries++) {
      const x = (r() - .5) * (w - 4), z = (r() - .5) * (d - 4);
      if (!ok(x, z) || !ok(x + .5, z) || !ok(x - .5, z) || !ok(x, z + .5) || !ok(x, z - .5)) continue;
      if (blocked(x, z, 1.2) || boxes.some(b => Math.hypot(b.x - x, b.z - z) < gap)) continue;
      boxes.push({ x: rd(x), z: rd(z) }); taken.push([x, z, .6]);
    }
    return { coins, boxes };
  }

  return { POWERS, IDS, roll, place, hash, rng, COIN_Y, HOP };
})();
