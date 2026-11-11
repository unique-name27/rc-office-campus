/* PEOPLE: how coworkers look in the 3D world (pure: no DOM, no three.js).
 *
 *   Coworkers are fun creatures by default - dragons, dogs, cats, foxes, robots, aliens and more (SPECIES) - each in a
 *   coat color of its kind and a scarf in its team's color, picked from a hash of the floor and desk id. Never from a
 *   person's name or title. Anyone can pick another creature for themselves, or the plain seated person: one body
 *   shape, no hair, no gendered clothing, variety only from neutral things (shirt, pants, shoes, headwear, glasses, a mug)
 *   and one neutral, non-skin face tone unless they pick their own.
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
  // [id, name, how often it is picked by default, coats [[hex, name]]]; the game draws each one (game-2b-people.js)
  const SPECIES = [
    ['dragon', 'Dragon', 3, [['#4FA36B', 'Emerald'], ['#D9534A', 'Ruby'], ['#8E6CC4', 'Amethyst'], ['#3E7CB1', 'Sapphire'], ['#2BA69A', 'Teal'], ['#E0A43A', 'Gold']]],
    ['dog', 'Dog', 1, [['#C8924E', 'Golden'], ['#6B4226', 'Chocolate'], ['#2B2622', 'Black'], ['#EFE8DC', 'Cream'], ['#8C8F94', 'Gray']]],
    ['cat', 'Cat', 1, [['#E08A3C', 'Orange'], ['#2A2724', 'Black'], ['#F2EEE6', 'White'], ['#9AA0A6', 'Gray'], ['#C9B79A', 'Siamese']]],
    ['fox', 'Fox', 1, [['#E07A2E', 'Red'], ['#EDEAE3', 'Arctic'], ['#8C8F94', 'Silver']]],
    ['bear', 'Bear', 1, [['#8A5A3C', 'Brown'], ['#3A302B', 'Black'], ['#C8955B', 'Honey'], ['#EDEAE3', 'Polar']]],
    ['panda', 'Panda', 1, [['#F2F0EB', 'Classic'], ['#EADFCB', 'Cream']]],
    ['bunny', 'Bunny', 1, [['#F2EFEA', 'White'], ['#A88566', 'Brown'], ['#A9A9B0', 'Gray'], ['#3A3633', 'Black']]],
    ['frog', 'Frog', 1, [['#6DBE4B', 'Green'], ['#3F8F4D', 'Forest'], ['#3E8FD1', 'Blue'], ['#F08A2E', 'Orange']]],
    ['penguin', 'Penguin', 1, [['#2E3440', 'Classic'], ['#1F2A44', 'Navy'], ['#8C8F94', 'Fluffy gray']]],
    ['owl', 'Owl', 1, [['#8A6A4A', 'Brown'], ['#B08A5A', 'Tawny'], ['#7E7A76', 'Gray'], ['#F0EDE6', 'Snowy']]],
    ['robot', 'Robot', 1, [['#B8C0C8', 'Silver'], ['#D9534A', 'Red'], ['#3E7CB1', 'Blue'], ['#F2C14E', 'Yellow'], ['#A9D8C5', 'Mint']]],
    ['unicorn', 'Unicorn', 1, [['#F4F1FA', 'White'], ['#F7D6E6', 'Pink'], ['#DCD3F5', 'Lavender'], ['#D5F0E3', 'Mint']]],
    ['dino', 'Dino', 2, [['#6BB36B', 'Green'], ['#E07A9A', 'Pink'], ['#F2A33A', 'Orange'], ['#5EA8D6', 'Blue'], ['#9B7BD4', 'Purple']]],
    ['alien', 'Alien', 1, [['#8BDC6B', 'Lime'], ['#6EC6E6', 'Sky'], ['#C59BF0', 'Violet'], ['#F59BC7', 'Pink']]],
  ];
  const KINDS = ['person'].concat(SPECIES.map(s => s[0]));
  const KIND_NAMES = Object.fromEntries([['person', 'Person']].concat(SPECIES.map(s => [s[0], s[1]])));
  const coatsOf = kind => { const s = SPECIES.find(x => x[0] === kind); return s ? s[3] : [] };
  const SP_TOTAL = SPECIES.reduce((a, s) => a + s[2], 0);
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
    const look = { kind: 'person', shirt: 'team', tone: DEFAULT_TONE, hat, glasses, mug, labCoat: lab, coat: null,
      pants: pick(PANTS), shoes: pick(SHOES), hatColor: pick(ACC), mugColor: pick(ACC) };
    // the creature at this desk (the person fields above stay ready for anyone who picks the person instead)
    let w = r() * SP_TOTAL, sp = SPECIES[SPECIES.length - 1];
    for (const s of SPECIES) { if (w < s[2]) { sp = s; break } w -= s[2] }
    look.kind = sp[0]; look.coat = pick(sp[3])[0];
    return look;
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

  return { TONES, DEFAULT_TONE, HATS, KINDS, KIND_NAMES, SPECIES, coatsOf, CHOSEN, hash, defaultLook, validLook, merge, chosenOf, validClaim, norm, locate, resolve };
})();
