/* NAV: routing on FloorModels and the CampusModel (SPEC section 6).
 *   grid      occupancy grid over the plate
 *   findPath  A* (8-connected, no corner cutting) + string pulling with exact supercover line of sight
 *   plan      multi-leg routes: elevators between floors, exit -> campus -> door between buildings
 *   track     where a car is along a leg;  gates: race checkpoints;  sample: chevrons along a path
 * Pure and deterministic. Bad data never throws: it is skipped, and impossible routes come back as null.
 *
 * Grid cells (block[]): 0 = free; 1 = blocked (inside an obstacle's core margin, or off the plate);
 * 2 = "tight": within `clear` of an obstacle but outside the core. Tight cells are usable at TIGHT x the step cost,
 * so a 1.0 m doorway (1.0 - 2*0.32 = 0.36 m of fully free width, narrower than one 0.4 m cell) stays routable
 * whatever its alignment to the grid. Treat any non-zero cell as "inside the inflated obstacles" when drawing. */
const NAV = (() => {
  const SQRT2 = Math.SQRT2;
  const CORE = 0.2;        // m: hard margin around obstacles (block 1); `clear` is the soft margin (block 2)
  const TIGHT = 3;         // step-cost multiplier for tight cells
  const EPS = 1e-6;
  const FAR = 1e6;         // m: obstacle coordinates/radii are clamped to this (nonsense data must not overflow)
  const SNAP_R = 4;       // m: endpoints in blocked cells snap to a free cell within this radius
  const POCKET = 4;        // m^2: a closed-off island of passable cells this small is a rasterization sliver (between parked cars, behind a desk)
  const MAX_CELLS = 4e6;   // grid size guard (absurd plates / cell sizes get a coarser cell)
  const NEAR = 3;          // m: track() does a full scan when the near-hint projection is further off than this
  const AHEAD = 3;         // m: track().ahead look-ahead
  const GATE_GAP = 4;      // m: race gates keep at least this far from the start (and the finish)
  const MAX_GATES = 500, MAX_SAMPLES = 20000;
  const CAMPUS = 'campus';
  const KEY_RE = /^(.+)-(\d+)$/;
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];   // 4 orthogonal, then 4 diagonal

  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const isObj = v => v !== null && typeof v === 'object';

  /* ---------------- grid ---------------- */
  const GRIDS = new WeakMap();   // model -> Map(options key -> Grid)
  const COMPS = new WeakMap();   // Grid -> Int32Array component label per cell (-1 = blocked)

  function grid(model, opts) {
    const o = isObj(opts) ? opts : {};
    const cell = fin(o.cell) && o.cell > 0 ? Math.min(Math.max(o.cell, 0.05), 10) : 0.4;
    const clear = fin(o.clear) && o.clear >= 0 ? Math.min(o.clear, 5) : 0.32;
    const core = Math.min(clear, fin(o.core) && o.core >= 0 ? o.core : CORE);
    const m = isObj(model) ? model : null, ck = cell + '|' + clear + '|' + core;
    let byOpts = m ? GRIDS.get(m) : null;
    const hit = byOpts && byOpts.get(ck);
    if (hit) return hit;
    const g = rasterize(m, cell, clear, core);
    if (m) { if (!byOpts) GRIDS.set(m, byOpts = new Map()); byOpts.set(ck, g); }
    return g;
  }

  function rasterize(model, cell, clear, core) {
    const w = model && fin(model.w) && model.w > 0 ? model.w : 0;
    const d = model && fin(model.d) && model.d > 0 ? model.d : 0;
    const key = model && (typeof model.key === 'string' || fin(model.key)) ? String(model.key) : '';
    if (!w || !d) return { x0: 0, z0: 0, nx: 1, nz: 1, cell, clear, core, block: new Uint8Array([1]), key, model };
    while ((w / cell + 1) * (d / cell + 1) > MAX_CELLS) cell *= 1.5;
    const nx = Math.max(1, Math.ceil(w / cell - 1e-9)), nz = Math.max(1, Math.ceil(d / cell - 1e-9));
    const x0 = -w / 2, z0 = -d / 2, B = new Uint8Array(nx * nz);
    const G = { x0, z0, nx, nz, cell, clear, core, block: B, key, model };
    // The plate edge behaves like a wall (cells whose center is off the plate are blocked too).
    for (let j = 0; j < nz; j++) {
      const cz = z0 + (j + 0.5) * cell, ez = Math.min(cz - z0, -z0 - cz);
      for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * cell, e = Math.min(ez, cx - x0, -x0 - cx);
        if (e <= core + EPS) B[j * nx + i] = 1; else if (e < clear) B[j * nx + i] = 2;
      }
    }
    const routable = m => (fin(m) ? m : 7) & 5;   // car (1) or walker (4) obstacles; a missing mask counts as solid
    const lim = v => v < -FAR ? -FAR : v > FAR ? FAR : v;   // keeps squared distances finite
    for (const b of Array.isArray(model.blocks) ? model.blocks : []) {
      if (!isObj(b) || !routable(b.m) || !fin(b.x0) || !fin(b.x1) || !fin(b.z0) || !fin(b.z1)) continue;
      let ax = lim(b.x0), bx = lim(b.x1), az = lim(b.z0), bz = lim(b.z1);
      if (ax > bx) { const t = ax; ax = bx; bx = t; }
      if (az > bz) { const t = az; az = bz; bz = t; }
      stamp(G, ax, bx, az, bz, 0, 0, 0);
    }
    for (const p of Array.isArray(model.posts) ? model.posts : []) {
      if (!isObj(p) || !routable(p.m) || !fin(p.x) || !fin(p.z) || Math.abs(p.x) > FAR || Math.abs(p.z) > FAR) continue;
      stamp(G, p.x, p.x, p.z, p.z, fin(p.r) && p.r > 0 ? Math.min(p.r, FAR) : 0, p.x, p.z);
    }
    return G;
  }

  // Marks cells whose center is within core (-> 1) or clear (-> 2) of an AABB (r = 0) or of a disc (r > 0 at px,pz).
  function stamp(G, ax, bx, az, bz, r, px, pz) {
    const { x0, z0, nx, nz, cell, block: B, core, clear } = G;
    const R = r + Math.max(clear, core + EPS);
    const i0 = Math.max(0, Math.ceil((ax - R - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((bx + R - x0) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((az - R - z0) / cell - 0.5)), j1 = Math.min(nz - 1, Math.floor((bz + R - z0) / cell - 0.5));
    if (r > 0) {
      const h2 = (r + core + EPS) ** 2, c2 = (r + clear) ** 2;
      for (let j = j0; j <= j1; j++) {
        const dz = z0 + (j + 0.5) * cell - pz;
        for (let i = i0; i <= i1; i++) {
          const dx = x0 + (i + 0.5) * cell - px, dd = dx * dx + dz * dz, k = j * nx + i;
          if (dd <= h2) B[k] = 1; else if (dd < c2 && B[k] === 0) B[k] = 2;
        }
      }
    } else {
      const h2 = (core + EPS) ** 2, c2 = clear * clear;
      for (let j = j0; j <= j1; j++) {
        const cz = z0 + (j + 0.5) * cell, dz = cz < az ? az - cz : cz > bz ? cz - bz : 0, dz2 = dz * dz;
        for (let i = i0; i <= i1; i++) {
          const cx = x0 + (i + 0.5) * cell, dx = cx < ax ? ax - cx : cx > bx ? cx - bx : 0, dd = dx * dx + dz2, k = j * nx + i;
          if (dd <= h2) B[k] = 1; else if (dd < c2 && B[k] === 0) B[k] = 2;
        }
      }
    }
    // Footprint: any cell holding a point of the obstacle is blocked, so thin posts and wall tips that sit
    // more than `core` from their cell's center can never end up inside a usable cell.
    const fi0 = Math.max(0, Math.floor((ax - r - x0) / cell)), fi1 = Math.min(nx - 1, Math.floor((bx + r - x0) / cell));
    const fj0 = Math.max(0, Math.floor((az - r - z0) / cell)), fj1 = Math.min(nz - 1, Math.floor((bz + r - z0) / cell));
    for (let j = fj0; j <= fj1; j++) {
      const lz = z0 + j * cell, dz = pz < lz ? lz - pz : pz > lz + cell ? pz - lz - cell : 0;
      for (let i = fi0; i <= fi1; i++) {
        if (r > 0) {   // disc: skip cells of its bounding box that the circle itself misses
          const lx = x0 + i * cell, dx = px < lx ? lx - px : px > lx + cell ? px - lx - cell : 0;
          if (dx * dx + dz * dz > r * r) continue;
        }
        B[j * nx + i] = 1;
      }
    }
  }

  function isGrid(G) {
    return isObj(G) && G.block instanceof Uint8Array && Number.isInteger(G.nx) && Number.isInteger(G.nz) &&
      G.nx > 0 && G.nz > 0 && G.block.length === G.nx * G.nz && fin(G.cell) && G.cell > 0 && fin(G.x0) && fin(G.z0);
  }

  function cellAt(G, x, z) {
    const i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
    return i < 0 || j < 0 || i >= G.nx || j >= G.nz ? -1 : j * G.nx + i;
  }
  function center(G, k) {
    const i = k % G.nx, j = (k - i) / G.nx;
    return [G.x0 + (i + 0.5) * G.cell, G.z0 + (j + 0.5) * G.cell];
  }

  // Connected components of passable cells. 4-connectivity is exact here: a diagonal step is only allowed
  // when both side cells are passable, so it never connects anything the side cells don't.
  function comps(G) {
    let comp = COMPS.get(G);
    if (comp) return comp;
    const { nx, block: B } = G, N = B.length, q = new Int32Array(N);
    comp = new Int32Array(N).fill(-1);
    let label = 0;
    for (let s = 0; s < N; s++) {
      if (B[s] === 1 || comp[s] !== -1) continue;
      let h = 0, t = 0;
      q[t++] = s; comp[s] = label;
      while (h < t) {
        const c = q[h++], i = c % nx;
        if (i > 0 && B[c - 1] !== 1 && comp[c - 1] === -1) { comp[c - 1] = label; q[t++] = c - 1; }
        if (i < nx - 1 && B[c + 1] !== 1 && comp[c + 1] === -1) { comp[c + 1] = label; q[t++] = c + 1; }
        if (c >= nx && B[c - nx] !== 1 && comp[c - nx] === -1) { comp[c - nx] = label; q[t++] = c - nx; }
        if (c + nx < N && B[c + nx] !== 1 && comp[c + nx] === -1) { comp[c + nx] = label; q[t++] = c + nx; }
      }
      label++;
    }
    COMPS.set(G, comp);
    return comp;
  }

  /* ---------------- A* scratch (shared, grown on demand; single-threaded so reuse is safe) ---------------- */
  let SN = 0, Sg = null, Scame = null, Sseen = null, Sclosed = null, gen = 0;
  let HC = 0, HN = 0, HI = null, HF = null, HH = null;   // binary heap: cell, f, h (ties -> smaller h first)

  function scratch(N) {
    if (N <= SN) return;
    SN = N; Sg = new Float64Array(N); Scame = new Int32Array(N); Sseen = new Uint32Array(N); Sclosed = new Uint32Array(N);
  }
  function nextGen() {
    if (++gen >= 0xffffffff) { gen = 1; Sseen.fill(0); Sclosed.fill(0); }
    return gen;
  }
  function hpush(c, f, h) {
    if (HN === HC) {
      HC = Math.max(1024, HC * 2);
      const I = new Int32Array(HC), F = new Float64Array(HC), H = new Float64Array(HC);
      if (HI) { I.set(HI); F.set(HF); H.set(HH); }
      HI = I; HF = F; HH = H;
    }
    let k = HN++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (HF[p] < f || (HF[p] === f && HH[p] <= h)) break;
      HI[k] = HI[p]; HF[k] = HF[p]; HH[k] = HH[p]; k = p;
    }
    HI[k] = c; HF[k] = f; HH[k] = h;
  }
  function hpop() {
    const top = HI[0], n = --HN;
    if (n > 0) {
      const c = HI[n], f = HF[n], h = HH[n];
      let k = 0;
      for (;;) {
        let m = 2 * k + 1;
        if (m >= n) break;
        if (m + 1 < n && (HF[m + 1] < HF[m] || (HF[m + 1] === HF[m] && HH[m + 1] < HH[m]))) m++;
        if (HF[m] > f || (HF[m] === f && HH[m] >= h)) break;
        HI[k] = HI[m]; HF[k] = HF[m]; HH[k] = HH[m]; k = m;
      }
      HI[k] = c; HF[k] = f; HH[k] = h;
    }
    return top;
  }

  // A* from cell s to cell t; returns the cell indices (s..t) or null.
  function astar(G, s, t) {
    const { nx, nz, block: B } = G;
    scratch(B.length);
    const gn = nextGen(), ti = t % nx, tj = (t - ti) / nx;
    const hc = (i, j) => { const a = Math.abs(i - ti), b = Math.abs(j - tj); return a + b + (SQRT2 - 2) * (a < b ? a : b); };
    HN = 0;
    Sg[s] = 0; Sseen[s] = gn; Scame[s] = -1;
    const si = s % nx, h0 = hc(si, (s - si) / nx);
    hpush(s, h0, h0);
    let found = false;
    while (HN > 0) {
      const c = hpop();
      if (Sclosed[c] === gn) continue;
      if (c === t) { found = true; break; }
      Sclosed[c] = gn;
      const ci = c % nx, cj = (c - ci) / nx, gc = Sg[c], bc = B[c];
      for (let k = 0; k < 8; k++) {
        const i = ci + DI[k], j = cj + DJ[k];
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        const n = j * nx + i, bn = B[n];
        if (bn === 1 || Sclosed[n] === gn) continue;
        let step = 1;
        if (k >= 4) {
          const s1 = B[cj * nx + i], s2 = B[j * nx + ci];
          if (s1 === 1 || s2 === 1) continue;                  // no corner cutting
          if (bc === 0 && bn === 0 && (s1 | s2)) continue;     // free-space diagonals never clip a tight corner
          step = SQRT2;
        }
        if (bn === 2) step *= TIGHT;
        const ng = gc + step;
        if (Sseen[n] === gn && ng >= Sg[n]) continue;
        Sseen[n] = gn; Sg[n] = ng; Scame[n] = c;
        const h = hc(i, j);
        hpush(n, ng + h, h);
      }
    }
    if (!found) return null;
    let len = 1;
    for (let c = t; c !== s; c = Scame[c]) len++;
    const out = new Int32Array(len);
    for (let c = t, k = len - 1; k >= 0; c = Scame[c], k--) out[k] = c;
    return out;
  }

  // Exact supercover line of sight: every cell the segment touches must be free, except the two endpoint cells
  // (which may be tight). Passing exactly through a grid corner touches both side cells.
  function los(G, ax, az, bx, bz) {
    const { x0, z0, nx, nz, cell, block: B } = G;
    const u0 = (ax - x0) / cell, v0 = (az - z0) / cell, u1 = (bx - x0) / cell, v1 = (bz - z0) / cell;
    let i = Math.floor(u0), j = Math.floor(v0);
    const ie = Math.floor(u1), je = Math.floor(v1);
    if (i < 0 || j < 0 || i >= nx || j >= nz || ie < 0 || je < 0 || ie >= nx || je >= nz) return false;
    const ka = j * nx + i, kb = je * nx + ie;
    const ok = (ii, jj) => {
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) return false;
      const k = jj * nx + ii;
      return B[k] === 0 || k === ka || k === kb;
    };
    const du = u1 - u0, dv = v1 - v0, si = du > 0 ? 1 : -1, sj = dv > 0 ? 1 : -1;
    const tdu = du ? 1 / Math.abs(du) : Infinity, tdv = dv ? 1 / Math.abs(dv) : Infinity;
    let tu = du > 0 ? (i + 1 - u0) * tdu : du < 0 ? (u0 - i) * tdu : Infinity;
    let tv = dv > 0 ? (j + 1 - v0) * tdv : dv < 0 ? (v0 - j) * tdv : Infinity;
    for (let n = Math.abs(ie - i) + Math.abs(je - j) + 1; n > 0; n--) {
      if (!ok(i, j)) return false;
      if (i === ie && j === je) return true;
      if ((tu < tv ? tu : tv) > 1) break;
      if (Math.abs(tu - tv) < 1e-9) {
        if (!ok(i + si, j) || !ok(i, j + sj)) return false;
        i += si; j += sj; tu += tdu; tv += tdv;
      } else if (tu < tv) { i += si; tu += tdu; } else { j += sj; tv += tdv; }
    }
    return ok(ie, je);
  }

  // String pulling: from each anchor, jump to the furthest raw point still in sight; then drop corners
  // whose neighbours can see each other.
  function pull(G, cells, ax, az, bx, bz) {
    const n = cells.length;
    if (n < 2) return [[ax, az], [bx, bz]];
    const P = new Array(n);
    for (let k = 1; k < n - 1; k++) P[k] = center(G, cells[k]);
    P[0] = [ax, az]; P[n - 1] = [bx, bz];
    const out = [P[0]];
    for (let i = 0; i < n - 1;) {
      let j = i + 1;
      while (j + 1 < n && los(G, P[i][0], P[i][1], P[j + 1][0], P[j + 1][1])) j++;
      out.push(P[j]);
      i = j;
    }
    for (let k = 1; k + 1 < out.length;) {
      if (los(G, out[k - 1][0], out[k - 1][1], out[k + 1][0], out[k + 1][1])) out.splice(k, 1); else k++;
    }
    return out;
  }

  // Cells an endpoint may start from: its own cell when passable (exact point kept), else (or with snap) passable
  // cells within SNAP_R ordered free-before-tight, then by distance (cell index breaks ties).
  function endpoints(G, x, z, snap) {
    const B = G.block, own = cellAt(G, x, z);
    if (!snap && own >= 0 && B[own] !== 1) return [{ c: own, x, z, k: 0, own: true }];
    const { x0, z0, nx, nz, cell } = G, out = [];
    const i0 = Math.max(0, Math.floor((x - SNAP_R - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((x + SNAP_R - x0) / cell));
    const j0 = Math.max(0, Math.floor((z - SNAP_R - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((z + SNAP_R - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * nx + i;
        if (B[c] === 1) continue;
        const cx = x0 + (i + 0.5) * cell, cz = z0 + (j + 0.5) * cell, dd = Math.hypot(cx - x, cz - z);
        if (dd <= SNAP_R) out.push({ c, x: cx, z: cz, k: dd + (B[c] === 2 ? 2 * SNAP_R : 0) });
      }
    }
    out.sort((a, b) => a.k - b.k || a.c - b.c);
    return out;
  }

  function polyLen(pts) {
    let L = 0;
    for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    return L;
  }

  // Nearest start candidate whose component also holds a goal candidate: [start, goal] or null.
  function pairUp(comp, A, Bc) {
    const goalIn = new Map();
    for (const b of Bc) if (!goalIn.has(comp[b.c])) goalIn.set(comp[b.c], b);
    for (const a of A) { const b = goalIn.get(comp[a.c]); if (b) return [a, b]; }
    return null;
  }
  // Does the segment cross any routable obstacle (wall, desk top, parked car, chair post) of the grid's model?
  // Exact shapes, no margin: a real sliver is closed only by the grid's inflation, so a clear line out exists.
  function throughWall(G, ax, az, bx, bz) {
    for (const b of G.model && Array.isArray(G.model.blocks) ? G.model.blocks : []) {
      if (!isObj(b) || !((fin(b.m) ? b.m : 7) & 5) || !fin(b.x0) || !fin(b.x1) || !fin(b.z0) || !fin(b.z1)) continue;
      let t0 = 0, t1 = 1;   // slab test
      for (const [p, d, lo, hi] of [[ax, bx - ax, Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)], [az, bz - az, Math.min(b.z0, b.z1), Math.max(b.z0, b.z1)]]) {
        if (Math.abs(d) < EPS) { if (p < lo || p > hi) { t0 = 2; break; } continue; }
        let u = (lo - p) / d, v = (hi - p) / d;
        if (u > v) { const w = u; u = v; v = w; }
        if (u > t0) t0 = u;
        if (v < t1) t1 = v;
        if (t0 > t1) break;
      }
      if (t0 <= t1) return true;
    }
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    for (const p of G.model && Array.isArray(G.model.posts) ? G.model.posts : []) {
      if (!isObj(p) || !((fin(p.m) ? p.m : 7) & 5) || !fin(p.x) || !fin(p.z)) continue;
      const t = L2 > EPS ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.z - az) * dz) / L2)) : 0;
      if (Math.hypot(ax + dx * t - p.x, az + dz * t - p.z) <= (fin(p.r) && p.r > 0 ? p.r : 0)) return true;
    }
    return false;
  }

  function findPath(G, ax, az, bx, bz) {
    if (!isGrid(G) || !fin(ax) || !fin(az) || !fin(bx) || !fin(bz)) return null;
    const A = endpoints(G, ax, az), Bc = endpoints(G, bx, bz);
    if (!A.length || !Bc.length) return null;
    // Pick the nearest start candidate whose component also holds a goal candidate (so a snapped endpoint
    // never lands in a pocket the other end can't reach).
    const comp = comps(G);
    let pair = pairUp(comp, A, Bc);
    if (!pair) {
      // an endpoint standing in a tiny closed-off island snaps out like a blocked one, but never through an obstacle
      // (a sealed room stays unreachable)
      const area = l => { let n = 0; for (let k = 0; k < comp.length; k++) if (comp[k] === l) n++; return n * G.cell * G.cell; };
      const out = (E, x, z) => E[0].own && area(comp[E[0].c]) <= POCKET ? endpoints(G, x, z, true).filter(c => !throughWall(G, x, z, c.x, c.z)) : E;
      const A2 = out(A, ax, az), B2 = out(Bc, bx, bz);
      if (A2 !== A || B2 !== Bc) pair = pairUp(comp, A2, B2);
      if (!pair) return null;
    }
    const s = pair[0], t = pair[1];
    const cells = s.c === t.c ? [s.c] : astar(G, s.c, t.c);
    if (!cells) return null;
    const raw = pull(G, cells, s.x, s.z, t.x, t.z), pts = [raw[0]];
    for (let k = 1; k < raw.length; k++) {
      const p = raw[k], q = pts[pts.length - 1];
      if (k === raw.length - 1 || Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9) pts.push(p);
    }
    if (pts.length > 2 && polyLen([pts[pts.length - 2], pts[pts.length - 1]]) < 1e-9) pts.splice(pts.length - 2, 1);
    return { pts, len: polyLen(pts) };
  }

  /* ---------------- multi-leg plans ---------------- */
  function parseKey(k) {
    const m = typeof k === 'string' ? KEY_RE.exec(k) : null;
    return m ? { b: m[1], f: +m[2] } : null;
  }
  const validXZ = p => isObj(p) && fin(p.x) && fin(p.z);

  function worldCtx(world) {
    const floors = world.floors, memo = new Map();
    const model = k => {
      if (k === CAMPUS) return isObj(world.campus) ? world.campus : null;
      if (floors instanceof Map) { const m = floors.get(k); return isObj(m) ? m : null; }
      return isObj(floors) && Object.prototype.hasOwnProperty.call(floors, k) && isObj(floors[k]) ? floors[k] : null;
    };
    const keys = () => floors instanceof Map ? [...floors.keys()] : isObj(floors) ? Object.keys(floors) : [];
    const gridOf = k => {
      if (memo.has(k)) return memo.get(k);
      let g = null;
      if (typeof world.grid === 'function') {
        try { const r = world.grid(k); if (isGrid(r)) g = r; } catch (e) { g = null; }
      }
      if (!g) { const m = model(k); if (m) g = grid(m); }
      memo.set(k, g);
      return g;
    };
    return { model, keys, grid: gridOf, campus: model(CAMPUS) };
  }

  function walk(W, w, p, q, end) {
    const G = W.grid(w), r = G && findPath(G, p.x, p.z, q.x, q.z);
    return r ? { w, pts: r.pts, len: r.len, end: Object.assign({}, end) } : null;
  }

  // Elevators of a floor as [{ id, x, z }] at their pads (the elevator's own x,z if the pad is missing).
  function elevPads(m) {
    const out = [], seen = new Set();
    for (const e of Array.isArray(m.elevators) ? m.elevators : []) {
      if (!isObj(e) || e.id == null || seen.has(e.id)) continue;
      const p = validXZ(e.pad) ? e.pad : e;
      if (!validXZ(p)) continue;
      seen.add(e.id);
      out.push({ id: e.id, x: p.x, z: p.z });
    }
    return out;
  }

  // Two legs wa:p -> (elevator) -> wb:q through whichever shared elevator id gives the shortest total.
  function viaElevator(W, wa, p, wb, q, endB) {
    const ma = W.model(wa), mb = W.model(wb), kb = parseKey(wb);
    if (!ma || !mb || !kb) return null;
    const padsB = elevPads(mb);
    let best = null;
    for (const e of elevPads(ma)) {
      const o = padsB.find(x => x.id === e.id);
      if (!o) continue;
      const l1 = walk(W, wa, p, e, { kind: 'elev', to: wb, elev: e.id, label: 'Take the elevator to Floor ' + kb.f });
      if (!l1 || (best && l1.len >= best.len)) continue;
      const l2 = walk(W, wb, o, q, endB);
      if (l2 && (!best || l1.len + l2.len < best.len)) best = { len: l1.len + l2.len, legs: [l1, l2] };
    }
    return best ? best.legs : null;
  }

  // Floor of building b that has the exterior exit: "<b>-1" when it has one, else the lowest such floor.
  function groundKey(W, b) {
    const k1 = b + '-1', m1 = W.model(k1);
    if (m1 && validXZ(m1.exit)) return k1;
    let best = null, bf = Infinity;
    for (const k of W.keys()) {
      const pk = parseKey(k), m = pk && pk.b === b ? W.model(k) : null;
      if (m && validXZ(m.exit) && pk.f < bf) { best = k; bf = pk.f; }
    }
    return best;
  }

  function building(W, b) {
    const list = W.campus && Array.isArray(W.campus.buildings) ? W.campus.buildings : [];
    return list.find(x => isObj(x) && x.id === b) || null;
  }

  function planRoute(world, from, to) {
    const pt = p => isObj(p) && typeof p.w === 'string' && fin(p.x) && fin(p.z);
    if (!isObj(world) || !pt(from) || !pt(to)) return null;
    const W = worldCtx(world);
    const name = to.name == null ? '' : String(to.name).trim();
    const arrive = { kind: 'dest', label: name ? 'Arrive at ' + name : 'Arrive at destination' };
    const done = legs => ({ legs, len: legs.reduce((s, l) => s + l.len, 0) });
    if (from.w === to.w) {
      const l = walk(W, from.w, from, to, arrive);
      return l ? done([l]) : null;
    }
    const A = from.w === CAMPUS ? null : parseKey(from.w), Bk = to.w === CAMPUS ? null : parseKey(to.w);
    if ((from.w !== CAMPUS && !A) || (to.w !== CAMPUS && !Bk)) return null;
    if (A && Bk && A.b === Bk.b) {
      const legs = viaElevator(W, from.w, from, to.w, to, arrive);
      return legs ? done(legs) : null;
    }
    const legs = [];
    let cur = from;
    if (A) {   // leave building A: (elevator down) -> exit pad, then continue outside from A's door pad
      const g = groundKey(W, A.b), gm = g && W.model(g), bA = building(W, A.b);
      if (!gm || !bA || !validXZ(bA.door)) return null;
      const out = { kind: 'exit', to: CAMPUS, label: 'Head outside' };
      const ls = from.w === g ? [walk(W, g, from, gm.exit, out)] : viaElevator(W, from.w, from, g, gm.exit, out);
      if (!ls || !ls[0]) return null;
      legs.push(...ls);
      cur = { w: CAMPUS, x: bA.door.x, z: bA.door.z };
    }
    if (Bk) {  // campus -> B's door pad -> floor-1 exit pad -> (elevator up) -> destination
      const g = groundKey(W, Bk.b), gm = g && W.model(g), bB = building(W, Bk.b);
      if (!gm || !bB || !validXZ(bB.door)) return null;
      const bname = String(bB.name || bB.short || bB.id).trim();
      const enter = walk(W, CAMPUS, cur, bB.door, { kind: 'enter', to: g, label: 'Go into ' + bname });
      if (!enter) return null;
      legs.push(enter);
      const ls = to.w === g ? [walk(W, g, gm.exit, to, arrive)] : viaElevator(W, g, gm.exit, to.w, to, arrive);
      if (!ls || !ls[0]) return null;
      legs.push(...ls);
    } else {
      const l = walk(W, CAMPUS, cur, to, arrive);
      if (!l) return null;
      legs.push(l);
    }
    return done(legs);
  }

  function plan(world, from, to) {
    try { return planRoute(world, from, to); } catch (e) { return null; }   // last-resort guard: never throw into the game loop
  }

  /* ---------------- following a path: track / gates / sample ---------------- */
  const PATHS = new WeakMap();   // pts array -> { pts (clean [x,z] copy), cum, L, src }

  function pathOf(pts) {
    if (!Array.isArray(pts)) return null;
    const hit = PATHS.get(pts);
    if (hit && hit.src === pts.length) return hit;
    const P = [];
    for (const p of pts) {
      const x = Array.isArray(p) ? p[0] : isObj(p) ? p.x : NaN, z = Array.isArray(p) ? p[1] : isObj(p) ? p.z : NaN;
      if (fin(x) && fin(z)) P.push([x, z]);
    }
    if (!P.length) return null;
    const cum = new Float64Array(P.length);
    for (let k = 1; k < P.length; k++) cum[k] = cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
    const info = { pts: P, cum, L: cum[P.length - 1], src: pts.length };
    PATHS.set(pts, info);
    return info;
  }

  // Yaw for travel direction (dx,dz): forward = (-sin a, -cos a). South is +PI (never -PI), north is +0.
  function yaw(dx, dz) {
    const a = Math.atan2(-dx, -dz);
    return a === 0 ? 0 : a <= -Math.PI ? Math.PI : a;
  }
  // Yaw of segment k, or of the nearest non-degenerate segment (forward first, then backward).
  function dirAt(P, k) {
    const p = P.pts;
    for (let q = k; q < p.length - 1; q++) { const dx = p[q + 1][0] - p[q][0], dz = p[q + 1][1] - p[q][1]; if (dx || dz) return yaw(dx, dz); }
    for (let q = k - 1; q >= 0; q--) { const dx = p[q + 1][0] - p[q][0], dz = p[q + 1][1] - p[q][1]; if (dx || dz) return yaw(dx, dz); }
    return 0;
  }
  // Point at arc length s (clamped). At a vertex the outgoing direction wins; at the end, the incoming one.
  function at(P, s) {
    const { pts, cum, L } = P, n = pts.length;
    if (n < 2) return { x: pts[0][0], z: pts[0][1], a: 0 };
    s = s > 0 ? (s < L ? s : L) : 0;
    let lo = 0, hi = n - 2;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
    const a = pts[lo], b = pts[lo + 1], sl = cum[lo + 1] - cum[lo], t = sl > 0 ? (s - cum[lo]) / sl : 0;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, a: dirAt(P, lo) };
  }

  function nearest(P, x, z, lo, hi) {
    const { pts, cum } = P;
    let best = null, bd = Infinity;
    for (let k = lo; k <= hi; k++) {
      const a = pts[k], b = pts[k + 1], vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz;
      let t = l2 > 0 ? ((x - a[0]) * vx + (z - a[1]) * vz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a[0] + vx * t, pz = a[1] + vz * t, d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < bd) { bd = d2; best = { i: k, along: cum[k] + t * Math.sqrt(l2), off: Math.sqrt(d2) }; }
    }
    return best;
  }

  function track(leg, x, z, hint) {
    const P = pathOf(Array.isArray(leg) ? leg : isObj(leg) ? leg.pts : null);
    if (!P || !fin(x) || !fin(z)) {
      const p = P ? P.pts[0] : [fin(x) ? x : 0, fin(z) ? z : 0];
      return { i: 0, along: 0, remain: P ? P.L : 0, off: Infinity, ahead: [p[0], p[1]] };
    }
    const last = P.pts.length - 2;
    if (last < 0) {
      const p = P.pts[0];
      return { i: 0, along: 0, remain: 0, off: Math.hypot(x - p[0], z - p[1]), ahead: [p[0], p[1]] };
    }
    let best = null;
    if (fin(hint)) {
      const h = Math.min(last, Math.max(0, Math.floor(hint)));
      best = nearest(P, x, z, Math.max(0, h - 2), Math.min(last, h + 8));
    }
    if (!best || best.off > NEAR) best = nearest(P, x, z, 0, last);
    const a = at(P, Math.min(P.L, best.along + AHEAD));
    return { i: best.i, along: best.along, remain: Math.max(0, P.L - best.along), off: best.off, ahead: [a.x, a.z] };
  }

  function gates(pts, spacing) {
    const P = pathOf(pts);
    if (!P) return [];
    const sp = fin(spacing) && spacing > 0 ? Math.max(spacing, 0.5) : 10;
    const s0 = P.pts[0], out = [];
    for (let k = 1; k <= MAX_GATES; k++) {
      const s = k * sp;
      if (s > P.L - GATE_GAP) break;
      const g = at(P, s);
      if (Math.hypot(g.x - s0[0], g.z - s0[1]) >= GATE_GAP) out.push(g);   // also skips loop-backs near the start
    }
    const e = P.pts[P.pts.length - 1];
    out.push({ x: e[0], z: e[1], a: dirAt(P, Math.max(0, P.pts.length - 2)) });
    return out;
  }

  function sample(pts, spacing, offset) {
    const P = pathOf(pts);
    if (!P) return [];
    const sp = fin(spacing) && spacing > 0 ? Math.max(spacing, 0.05) : 1.2;
    let s0 = fin(offset) ? offset : 0;
    if (s0 < 0) s0 += Math.ceil(-s0 / sp) * sp;   // first point of the offset lattice that is on the path
    const out = [];
    for (let k = 0; out.length < MAX_SAMPLES; k++) {
      const s = s0 + k * sp;
      if (s > P.L + 1e-9) break;
      out.push(at(P, s));
    }
    return out;
  }

  return { grid, findPath, plan, track, gates, sample };
})();
