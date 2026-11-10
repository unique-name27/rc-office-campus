/* PEOPLE: how coworkers look in the 3D world (pure: no DOM, no three.js).
 *
 *   Everyone is the same simple seated figure: one body shape, no hair, no gendered clothing.
 *   Variety comes only from neutral things - the shirt (team color), pants, shoes, headwear, glasses, a mug -
 *   picked from a hash of the floor and desk id. Never from a person's name or title.
 *   Faces use one neutral, non-skin tone unless the person picks their own.
 *
 *   A coworker can claim their desk ("This is me") and choose their own look. A claim is one doc per viewer,
 *   looks/<uid> = {w: floor key, desk: desk id, name: the seating name at that desk, look: {chosen fields}, at: ms}.
 *   Claims are untrusted input: validClaim() sanitizes them, locate() finds the person they belong to today,
 *   and resolve() settles two claims on one person (a profile name that matches the seating name wins, then the earliest).
 */
const PEOPLE = (() => {
  const HEXR = /^#[0-9a-fA-F]{6}$/;
  const WKEY = /^[A-Za-z0-9]{1,8}-\d{1,2}$/;
  // tones a person can pick for their own figure; the first is everyone's default (a neutral gray, not a skin tone)
  const TONES = [['#C9CED6', 'Stone gray'], ['#A9D8C5', 'Mint'], ['#C9B8E6', 'Lilac'], ['#A9CBEB', 'Sky'],
    ['#F1D3BD', 'Light'], ['#DDB08E', 'Light medium'], ['#B98361', 'Medium'], ['#8A5A3C', 'Medium dark'], ['#5A3A26', 'Dark']];
  const DEFAULT_TONE = TONES[0][0];
  const PANTS = ['#3B3F46', '#3E5675', '#A8916B', '#5E6B4A', '#26282C'];
  const SHOES = ['#2A2B2F', '#ECEBE7', '#6B4A33'];
  const ACC = ['#E4572E', '#3E7CB1', '#F2C14E', '#4F9D69', '#8E6CC4', '#2E3035', '#E8E6E1', '#D96C9A'];
  const HATS = ['none', 'phones', 'beanie', 'cap'];
  const KINDS = ['person', 'dog', 'cat'];
  // the fields a person may choose; everything else (pants, shoes, accessory colors) stays as their desk's default
  const CHOSEN = ['kind', 'shirt', 'tone', 'hat', 'glasses', 'mug', 'labCoat', 'coat'];

  // FNV-1a, then a small seeded generator: the same desk always gets the same look
  function hash(s) { s = String(s); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

  // key = "<floor key>|<desk id>", arr = the desk's arrangement (lab desks get a lab coat, no mug)
  function defaultLook(key, arr) {
    const r = rng(hash(key)), lab = arr === 'lab', pick = a => a[Math.floor(r() * a.length) % a.length];
    const h = r();
    const hat = lab ? (h < .3 ? 'phones' : 'none') : h < .45 ? 'none' : h < .65 ? 'phones' : h < .83 ? 'beanie' : 'cap';
    const glasses = r() < (lab ? .55 : .28), mug = !lab && r() < .38;
    return { kind: 'person', shirt: 'team', tone: DEFAULT_TONE, hat, glasses, mug, labCoat: lab, coat: null,
      pants: pick(PANTS), shoes: pick(SHOES), hatColor: pick(ACC), mugColor: pick(ACC) };
  }

  // keep only valid chosen fields (a partial look is fine); null when there is nothing usable
  function validLook(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const o = {};
    if (KINDS.includes(v.kind)) o.kind = v.kind;
    if (v.shirt === 'team' || (typeof v.shirt === 'string' && HEXR.test(v.shirt))) o.shirt = v.shirt;
    if (typeof v.tone === 'string' && HEXR.test(v.tone)) o.tone = v.tone;
    if (HATS.includes(v.hat)) o.hat = v.hat;
    for (const k of ['glasses', 'mug', 'labCoat']) if (typeof v[k] === 'boolean') o[k] = v[k];
    if (typeof v.coat === 'string' && HEXR.test(v.coat)) o.coat = v.coat;
    return Object.keys(o).length ? o : null;
  }
  const merge = (base, chosen) => Object.assign({}, base, validLook(chosen) || {});
  const chosenOf = look => { const o = {}; for (const k of CHOSEN) if (look && look[k] != null) o[k] = look[k]; return validLook(o) || {} };

  function validClaim(v) {
    if (!v || typeof v !== 'object') return null;
    if (typeof v.w !== 'string' || !WKEY.test(v.w)) return null;
    if (typeof v.desk !== 'string' || !v.desk.trim() || v.desk.length > 24) return null;
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80) return null;
    const at = typeof v.at === 'number' && isFinite(v.at) && v.at > 0 ? v.at : 0;
    return { w: v.w, desk: v.desk, name: v.name, look: validLook(v.look) || {}, at };
  }

  // names compare without case, accents or punctuation ("José O'Neil" = "jose o neil")
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // which person a claim belongs to now: the same desk with the same name, else the one person anywhere with that name
  // (they moved). peopleOn(floorKey) -> [{desk, name}] or null; keys = every floor key. -> {key, moved} or null
  function locate(c, peopleOn, keys) {
    const n = norm(c.name); if (!n) return null;
    const here = peopleOn(c.w) || [], dl = c.desk.toLowerCase();
    const hit = here.find(p => String(p.desk).toLowerCase() === dl);
    if (hit && norm(hit.name) === n) return { key: c.w + '|' + hit.desk, moved: false };
    let found = null, count = 0;
    for (const k of keys) for (const p of peopleOn(k) || []) if (norm(p.name) === n) { count++; found = { key: k + '|' + p.desk, moved: true } }
    return count === 1 ? found : null;
  }

  // claims: [{uid, w, desk, name, look, at}]. locateFn(claim) -> {key, moved} | null. nameMatch(claim) -> true when the
  // claimant's own profile name is the seating name (that claim wins a tie). -> {winners: Map key -> claim,
  // status: Map uid -> {key, state: 'ok' | 'moved' | 'lost' | 'taken'}}
  function resolve(claims, locateFn, nameMatch) {
    const by = new Map(), status = new Map();
    const better = (a, b) => a.nm !== b.nm ? a.nm : a.c.at !== b.c.at ? a.c.at < b.c.at : String(a.c.uid) < String(b.c.uid);
    for (const c of claims) {
      const loc = locateFn(c);
      if (!loc) { status.set(c.uid, { key: null, state: 'lost' }); continue }
      status.set(c.uid, { key: loc.key, state: loc.moved ? 'moved' : 'ok' });
      const cand = { c, nm: !!nameMatch(c) }, cur = by.get(loc.key);
      if (!cur || better(cand, cur)) by.set(loc.key, cand);
    }
    for (const c of claims) { const s = status.get(c.uid); if (s && s.key && by.get(s.key).c !== c) s.state = 'taken' }
    const winners = new Map(); for (const [k, v] of by) winners.set(k, v.c);
    return { winners, status };
  }

  return { TONES, DEFAULT_TONE, HATS, KINDS, CHOSEN, hash, defaultLook, validLook, merge, chosenOf, validClaim, norm, locate, resolve };
})();
