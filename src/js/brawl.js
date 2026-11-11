/* BRAWL: the rules of Banana Brawl, a kart battle on any floor (pure: no DOM, no three.js).
 *
 *   Everyone who joins the brawl on a floor plays everyone else brawling there. There is no host: each player is the
 *   only authority on themselves (their hearts, their item, their own throws). Throws travel in the thrower's presence
 *   as absolute positions; a player who gets hit says so in their own presence ("hit by <peer>, throw <id>"), and the
 *   thrower counts the point from that. Presence is untrusted, so everything read from it goes through validBw().
 *
 *   Items: a banana (thrown in an arc, it lands as a peel; or dropped behind), a bunch of three, a paper ball that
 *   bounces off walls, a paper plane that homes in, coffee (a big boost) and a bubble that blocks one hit.
 *   Three hearts; a hit spins you out and costs one; at none you're knocked out (a KO for the thrower) and come back.
 */
const BRAWL = (() => {
  const HEARTS = 3, SPIN = 1.1, INVULN = 2.2, RESPAWN = 2.5, BUBBLE = 8, ARM = .5, PEEL_ARM = 1, MAX_PJ = 10, MAX_HB = 8;
  // [key, name, weight for the leader, weight for everyone behind]
  const ITEMS = [['banana', 'Banana', 30, 22], ['bunch', 'Banana bunch', 14, 14], ['paper', 'Paper ball', 22, 20],
    ['plane', 'Paper plane', 8, 18], ['coffee', 'Coffee', 14, 16], ['bubble', 'Bubble shield', 12, 10]];
  const ITEM = Object.fromEntries(ITEMS.map(([k, n]) => [k, { n, uses: k === 'bunch' ? 3 : 1 }]));
  // throws in the air or on the floor: hit radius (m), life (s), speed (m/s)
  const PJ = { nana: { r: .17, life: 3, speed: 9 }, peel: { r: .2, life: 30 }, ball: { r: .13, life: 4, speed: 13, bounces: 3 },
    plane: { r: .16, life: 6, speed: 8.5, turn: 2.6 } };
  const GRAV = 12;

  // FNV-1a and a small seeded generator (same as PEOPLE): every client derives the same crate spots for a floor
  function hash(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

  // u in [0,1): the item a crate gives. Anyone behind the leader gets more planes and coffee.
  function rollItem(u, behind) {
    const col = behind ? 3 : 2, total = ITEMS.reduce((a, it) => a + it[col], 0);
    let w = Math.min(Math.max(u, 0), .999999) * total;
    for (const it of ITEMS) { if (w < it[col]) return it[0]; w -= it[col] }
    return ITEMS[ITEMS.length - 1][0];
  }

  // pick up to n crate spots from candidates [[x, z]] at least `spacing` apart, the same on every client for this key
  function crateSpots(key, cands, n, spacing) {
    // each spot's place in line comes from the floor and the spot itself, so the candidates' order doesn't matter
    const list = cands.filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [p[0], p[1], hash('crates|' + key + '|' + p[0].toFixed(2) + ',' + p[1].toFixed(2))]);
    list.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const [x, z] of list) { if (out.length >= n) break; if (out.every(q => Math.hypot(q[0] - x, q[1] - z) >= spacing)) out.push([x, z]) }
    return out;
  }

  // a new throw from a car at (x, y, z) heading h (facing -sin h, -cos h) moving at vF. back = drop it behind.
  function launch(kind, car, id, back) {
    const fx = -Math.sin(car.h), fz = -Math.cos(car.h), v = Math.max(0, car.vF || 0);
    if (kind === 'peel' || back) return { i: id, k: 'peel', x: car.x - fx * .42, y: 0, z: car.z - fz * .42, vx: 0, vy: 0, vz: 0, t: 0, n: 0 };
    if (kind === 'nana') { const s = PJ.nana.speed + v * .6; return { i: id, k: 'nana', x: car.x + fx * .3, y: (car.y || 0) + .3, z: car.z + fz * .3, vx: fx * s, vy: 4.2, vz: fz * s, t: 0, n: 0 } }
    const s = PJ[kind].speed + v * .5;
    return { i: id, k: kind, x: car.x + fx * .36, y: (car.y || 0) + (kind === 'plane' ? .45 : .14), z: car.z + fz * .36, vx: fx * s, vy: 0, vz: fz * s, t: 0, n: 0 };
  }

  // move a throw by dt. env: {blocked(x, z, r) -> bool, ground(x, z) -> y, target(p) -> {x, z} | null}.
  // Returns false when it is spent (hit a wall, ran out of bounces or time). A banana in flight lands as a peel.
  function step(p, dt, env) {
    p.t += dt;
    const spec = PJ[p.k];
    if (!spec || p.t > spec.life) return false;
    if (p.k === 'peel') return true;
    if (p.k === 'nana') {
      p.vy -= GRAV * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + p.vy * dt;
      if (env.blocked(nx, nz, spec.r)) { p.vx *= -.25; p.vz *= -.25 } else { p.x = nx; p.z = nz }
      const g = env.ground(p.x, p.z);
      if (ny <= g) { p.k = 'peel'; p.y = g; p.vx = p.vy = p.vz = 0; p.t = 0; return true }
      p.y = ny;
      return true;
    }
    if (p.k === 'plane') {
      const tg = env.target(p);
      if (tg) {
        const want = Math.atan2(tg.x - p.x, tg.z - p.z), cur = Math.atan2(p.vx, p.vz);
        let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
        const a = cur + Math.max(-spec.turn * dt, Math.min(spec.turn * dt, d)), s = Math.hypot(p.vx, p.vz);
        p.vx = Math.sin(a) * s; p.vz = Math.cos(a) * s;
      }
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      if (env.blocked(nx, nz, spec.r)) return false;
      p.x = nx; p.z = nz; p.y = env.ground(p.x, p.z) + .45 + Math.sin(p.t * 6) * .04;
      return true;
    }
    // paper ball: slides along the floor and bounces off walls and furniture, one axis at a time
    let bounced = false;
    const nx = p.x + p.vx * dt;
    if (env.blocked(nx, p.z, spec.r)) { p.vx = -p.vx; bounced = true } else p.x = nx;
    const nz = p.z + p.vz * dt;
    if (env.blocked(p.x, nz, spec.r)) { p.vz = -p.vz; bounced = true } else p.z = nz;
    if (bounced && ++p.n > spec.bounces) return false;
    p.y = env.ground(p.x, p.z) + .13;
    return true;
  }

  // does a throw touch a player's body? car: {x, y, z, r, tall}
  function touches(p, car) {
    const spec = PJ[p.k]; if (!spec) return false;
    const dy = p.y - (car.y || 0);
    if (dy < -.15 || dy > (car.tall || .3) + .2) return false;
    return Math.hypot(p.x - car.x, p.z - car.z) < spec.r + (car.r || .2);
  }
  // may this throw hit this player yet? (your own banana can't hit you the moment you throw it; your own peel arms after a second)
  function armed(p, own) { return !own || p.t > (p.k === 'peel' ? PEEL_ARM : ARM) }

  // a fresh player state, and what one hit does to it at time now (s). Returns {state, took, ko, blocked}.
  const fresh = now => ({ hp: HEARTS, sc: 0, kos: 0, spinUntil: 0, invUntil: now + INVULN, bubbleUntil: 0, outUntil: 0 });
  function hit(st, now) {
    if (st.outUntil > now || st.invUntil > now) return { state: st, took: false, ko: false, blocked: false };
    if (st.bubbleUntil > now) return { state: Object.assign({}, st, { bubbleUntil: 0, invUntil: now + .6 }), took: false, ko: false, blocked: true };
    const hp = st.hp - 1, ko = hp <= 0;
    const s = Object.assign({}, st, { hp: Math.max(0, hp), spinUntil: now + SPIN, invUntil: now + SPIN + INVULN });
    if (ko) { s.outUntil = now + RESPAWN; s.spinUntil = now + RESPAWN }
    return { state: s, took: true, ko, blocked: false };
  }
  // back in after a KO
  const respawn = (st, now) => Object.assign({}, st, { hp: HEARTS, outUntil: 0, spinUntil: 0, invUntil: now + INVULN, bubbleUntil: 0 });

  // what a player shows everyone (kept small: presence is at most 4 KiB). pj: their live throws; hb: hits they took,
  // as [thrower, throw id, 0 hit | 1 knockout | 2 blocked by a bubble]; iv: can't be hit right now; tk: a heartbeat (whole
  // seconds), so a brawler whose page stopped running looks stale to everyone else within a few seconds
  const r2 = v => Math.round(v * 100) / 100;
  function enc(st, now, item, uses, pj, hb) {
    return { hp: st.hp, sc: st.sc, ko: st.kos, it: item || null, n: uses || 0, sh: st.bubbleUntil > now ? 1 : 0, out: st.outUntil > now ? 1 : 0,
      iv: st.invUntil > now || st.outUntil > now ? 1 : 0, tk: Math.floor(now) % 100000,
      pj: pj.slice(-MAX_PJ).map(p => [p.i, p.k, r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vz)]), hb: hb.slice(-MAX_HB) };
  }
  const KIND = new Set(Object.keys(PJ)), PEER = /^[A-Za-z0-9_-]{1,64}$/;
  const num = (v, a, b) => typeof v === 'number' && isFinite(v) && v >= a && v <= b ? v : null;
  const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b ? v : null;
  // read someone else's brawl presence: anything malformed is dropped, never trusted
  function validBw(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const hp = int(v.hp, 0, HEARTS); if (hp == null) return null;
    const o = { hp, sc: int(v.sc, 0, 9999) || 0, ko: int(v.ko, 0, 9999) || 0, it: ITEM[v.it] ? v.it : null, n: int(v.n, 0, 3) || 0,
      sh: v.sh === 1 ? 1 : 0, out: v.out === 1 ? 1 : 0, iv: v.iv === 1 ? 1 : 0, pj: [], hb: [] };
    if (Array.isArray(v.pj)) for (const p of v.pj.slice(0, MAX_PJ)) {
      if (!Array.isArray(p) || p.length < 7) continue;
      const i = int(p[0], 0, 1e9), x = num(p[2], -400, 400), y = num(p[3], -5, 20), z = num(p[4], -400, 400), vx = num(p[5], -40, 40), vz = num(p[6], -40, 40);
      if (i == null || !KIND.has(p[1]) || x == null || y == null || z == null || vx == null || vz == null) continue;
      o.pj.push({ i, k: p[1], x, y, z, vx, vz });
    }
    if (Array.isArray(v.hb)) for (const h of v.hb.slice(0, MAX_HB)) {
      if (!Array.isArray(h) || h.length < 3) continue;
      const by = typeof h[0] === 'string' && PEER.test(h[0]) ? h[0] : null, id = int(h[1], 0, 1e9);
      if (by && id != null) o.hb.push([by, id, h[2] === 1 || h[2] === 2 ? h[2] : 0]);
    }
    return o;
  }

  // the thrower's side: what others say my throws did, as [{victim, id, ko, blocked}], each only once (counted: Set of
  // "victim|id"). mine (optional): the ids I really threw, so nobody can make me score for throws I never made
  function credits(myPeer, others, counted, mine) {
    const out = [];
    for (const [victim, bw] of others) {
      if (!bw || !bw.hb) continue;
      for (const [by, id, f] of bw.hb) {
        if (by !== myPeer || (mine && !mine.has(id))) continue;
        const k = victim + '|' + id; if (counted.has(k)) continue;
        counted.add(k); out.push({ victim, id, ko: f === 1, blocked: f === 2 });
      }
    }
    return out;
  }

  // standings: [{id, sc, ko}] -> sorted, best first (KOs, then hits)
  const standings = list => list.slice().sort((a, b) => (b.ko - a.ko) || (b.sc - a.sc) || String(a.id).localeCompare(String(b.id)));

  return { HEARTS, SPIN, INVULN, RESPAWN, BUBBLE, MAX_PJ, ITEMS, ITEM, PJ, hash, rng, rollItem, crateSpots, launch, step, touches, armed,
    fresh, hit, respawn, enc, validBw, credits, standings };
})();
