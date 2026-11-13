// IMPORT: loading facilities data (seating CSV/TSV exports) and CAD floor plans (DXF, PDF) into the campus.
// Pure functions except renderPDF (browser only). Never throws on bad data: skips and reports in plain language.
const IMPORT=(()=>{
  // ================================================================ text helpers
  const ZW = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;   // invisible + bidi-override chars: removed
  const CC = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;                 // control chars: become spaces
  // fast check: anything other than plain single spaces between words needs cleaning
  const DIRTY = /[^\S ]|[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]|  |^ | $/;

  // String value with control/invisible chars stripped, whitespace collapsed and trimmed. Non-text -> "".
  function clean(v){
    let s;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') s = String(v);
    else return '';
    if (!DIRTY.test(s)) return s;
    return s.replace(ZW, '').replace(CC, ' ').replace(/\s+/g, ' ').trim();
  }
  // A spreadsheet cell: cleaned, and our own formula-injection guard (a leading ' before = + - @) undone.
  const cell = v => clean(v).replace(/^'(?=[=+\-@])/, '');
  // Cap at n code points (never splits an emoji / surrogate pair).
  function cap(s, n){
    if (s.length <= n) return s;
    const a = Array.from(s);
    return a.length <= n ? s : a.slice(0, n).join('').trim();
  }
  const stripAccents = s => s.normalize('NFKD').replace(/[\u0300-\u036F]/g, '');
  // Person-matching key: case, accents, punctuation and extra spaces don't matter. Other combining marks
  // (Indic/Thai vowel signs, kana dakuten) are part of the letter and stay; a mark left without a letter is dropped.
  function nameKey(s){
    return stripAccents(clean(s)).toLowerCase().replace(/['\u2019`.]/g, '').replace(/(^|[^\p{L}\p{M}\p{N}])\p{M}+/gu, '$1')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
  }
  const compact = s => stripAccents(clean(s)).toLowerCase().replace(/[^a-z0-9]/g, '');
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fmtInt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const CARDINALS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
  const ORDINALS = { first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10, eleventh:11, twelfth:12 };

  // ================================================================ column synonyms
  // syn: exact names (normalized), best first. allow: qualifier words that may surround a synonym for a
  // partial match ("Occupant Business Unit" -> team). Anything else blocks the partial match, so e.g.
  // "Manager Name", "Job Level" or "Space Type" are never mistaken for name / floor / desk.
  const FIELD_ORDER = ['building', 'floor', 'desk', 'name', 'first', 'last', 'team', 'title', 'x', 'y', 'rot'];
  const PLACE_OK = ['id', 'number', 'no', 'num', 'nbr', 'code', 'name', 'label', 'short', 'abbr', 'abbreviation', 'current',
    'assigned', 'primary', 'work', 'home', 'employee', 'emp', 'occupant', 'person', 'location', 'loc', 'office', 'site', 'campus'];
  const COORD_OK = ['coord', 'coords', 'coordinate', 'coordinates', 'pos', 'position', 'centroid', 'center', 'centre', 'loc',
    'location', 'value', 'val', 'm', 'meter', 'meters', 'metre', 'metres', 'ft', 'feet', 'foot', 'mm', 'cm', 'in', 'inch',
    'inches', 'unit', 'units', 'desk', 'seat', 'space', 'point', 'pt', 'insertion', 'insert'];
  const DEFS = {
    building: { syn: ['building', 'bldg', 'site building', 'facility', 'location building', 'building id', 'bldg id', 'bl id', 'bl',
      'building code', 'bldg code', 'building name', 'bldg name', 'facility name', 'facility code'], allow: PLACE_OK,
      // HR exports (Workday and similar) often carry the building only as a location/site column
      low: ['work location', 'location', 'site', 'work site', 'office location', 'location name', 'site name', 'campus location', 'primary work location'] },
    floor: { syn: ['floor', 'level', 'flr', 'story', 'storey', 'fl id', 'fl', 'floor id', 'floor number', 'floor no', 'floor code',
      'floor name', 'level name', 'level number', 'lvl'], allow: PLACE_OK.concat(['desk', 'seat']) },
    desk: { syn: ['desk', 'desk id', 'desk number', 'seat', 'seat id', 'seat number', 'space', 'space id', 'space number',
      'space name', 'workstation', 'workstation id', 'ws', 'station', 'room', 'room number', 'room id', 'cube', 'cubicle',
      'workspace', 'work space', 'workpoint', 'work point', 'rm id', 'rm', 'office number', 'office no'],
      allow: PLACE_OK.concat(['reference', 'ref', 'tag', 'desk', 'seat', 'space']), low: ['location'] },
    name: { syn: ['name', 'full name', 'employee name', 'occupant', 'occupant name', 'person', 'display name', 'assigned to',
      'employee', 'worker', 'worker name', 'person name', 'preferred name', 'legal name', 'staff name', 'employee full name'],
      allow: ['employee', 'emp', 'occupant', 'person', 'worker', 'full', 'display', 'preferred', 'legal', 'assigned', 'to',
        'current', 'primary', 'staff', 'member', 'of', 'the', 'first', 'last', 'given', 'family', 'official', 'resident', 'associate'] },
    first: { syn: ['first name', 'given name', 'first', 'forename', 'fname', 'first nm'],
      allow: ['employee', 'emp', 'preferred', 'legal', 'occupant', 'person', 'worker', 'name', 'staff', 'member', 'official'] },
    last: { syn: ['last name', 'surname', 'family name', 'last', 'lname', 'last nm'],
      allow: ['employee', 'emp', 'preferred', 'legal', 'occupant', 'person', 'worker', 'name', 'staff', 'member', 'official'] },
    team: { syn: ['team', 'department', 'dept', 'group', 'org', 'organization', 'business unit', 'function', 'cost center name',
      'division', 'organisation', 'team name', 'department name', 'dept name', 'cost centre name', 'bu', 'org unit'],
      allow: ['name', 'label', 'desc', 'description', 'home', 'primary', 'current', 'assigned', 'employee', 'emp', 'occupant',
        'person', 'worker', 'supervisory', 'sub', 'unit', 'business', 'code', 'short', 'full', 'long', 'text', 'team', 'org',
        'organization', 'department', 'dept', 'group', 'title'] },
    title: { syn: ['title', 'job title', 'position', 'role', 'job', 'business title', 'position title', 'job name', 'job profile',
      'designation'],
      allow: ['business', 'job', 'position', 'title', 'role', 'name', 'current', 'primary', 'employee', 'emp', 'occupant', 'person',
        'worker', 'official', 'working', 'display', 'short', 'full', 'long', 'corporate', 'description', 'desc', 'profile', 'text'] },
    x: { syn: ['x', 'x coord', 'x coordinate', 'pos x', 'posx', 'centroid x', 'easting', 'x pos', 'x position', 'coord x',
      'xcoord', 'location x', 'center x', 'centre x', 'x loc'], allow: COORD_OK },
    y: { syn: ['y', 'y coord', 'y coordinate', 'pos y', 'posy', 'centroid y', 'northing', 'y pos', 'y position', 'coord y',
      'ycoord', 'location y', 'center y', 'centre y', 'y loc'], allow: COORD_OK },
    rot: { syn: ['rotation', 'angle', 'orientation', 'rot', 'heading', 'facing'],
      allow: ['deg', 'degree', 'degrees', 'rad', 'radian', 'radians', 'desk', 'seat', 'space', 'symbol', 'block', 'value', 'in',
        'z', 'furniture', 'angle', 'rotation'] },
  };
  const HARD = new Set(['id', 'code', 'number', 'no', 'num', 'nbr', 'key', 'ref']);      // weaker qualifiers
  const SOFT = new Set(['name', 'full', 'display', 'preferred', 'current', 'primary']);   // nearly free qualifiers
  for (const f of FIELD_ORDER){
    const d = DEFS[f];
    d.synT = d.syn.map(s => s.split(' '));
    d.lowT = (d.low || []).map(s => s.split(' '));
    d.allowS = new Set(d.allow);
  }

  // "Desk #", "SpaceID", "pos_x", " Bldg. " -> "desk number", "space id", "pos x", "bldg"
  function normCol(h){
    return stripAccents(clean(h).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'))
      .toLowerCase().replace(/#/g, ' number ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function seqAt(toks, st){
    outer: for (let i = 0; i + st.length <= toks.length; i++){
      for (let j = 0; j < st.length; j++) if (toks[i + j] !== st[j]) continue outer;
      return i;
    }
    return -1;
  }
  // Score of synonym tokens `st` against a column's tokens (0 = no match).
  function synScore(toks, norm, st, rank, allow, exact, partial){
    if (st.join(' ') === norm) return exact - rank;
    const at = seqAt(toks, st);
    if (at < 0) return 0;
    let pen = 0;
    for (let i = 0; i < toks.length; i++){
      if (i >= at && i < at + st.length) continue;
      const t = toks[i];
      if (!allow.has(t)) return 0;
      pen += SOFT.has(t) ? 2 : HARD.has(t) ? 15 : 5;
    }
    return partial + 30 * st.length - pen - rank * 0.1;
  }
  // All fields a column name could be, as [{ field, score }].
  function fieldScores(norm){
    const out = [];
    if (!norm) return out;
    const toks = norm.split(' ');
    for (const f of FIELD_ORDER){
      const d = DEFS[f];
      let best = 0;
      d.synT.forEach((st, rank) => { best = Math.max(best, synScore(toks, norm, st, rank, d.allowS, 1000, 500)); });
      // low-priority synonyms ("Location" is a desk only if nothing better claims it)
      d.lowT.forEach(st => { best = Math.max(best, synScore(toks, norm, st, 0, d.allowS, 20, -80)); });
      if (best > 0) out.push({ field: f, score: best });
    }
    return out;
  }
  // How many cells of a row look like known column names (header detection). Header names don't contain digits.
  function headerHits(r){
    let n = 0;
    for (const c of r){
      if (typeof c !== 'string' || !c || c.length > 60 || /\d/.test(c)) continue;
      if (fieldScores(normCol(c)).length) n++;
    }
    return n;
  }

  function mapColumns(header){
    const h = Array.isArray(header) ? header : [];
    const map = {};
    for (const f of FIELD_ORDER) map[f] = -1;
    const cands = [];
    h.forEach((name, col) => {
      for (const s of fieldScores(normCol(name))) cands.push({ col, field: s.field, score: s.score });
    });
    // greedy: best score first, then leftmost column, then field order
    cands.sort((a, b) => b.score - a.score || a.col - b.col || FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
    const used = new Set();
    for (const c of cands){
      if (map[c.field] >= 0 || used.has(c.col)) continue;
      map[c.field] = c.col;
      used.add(c.col);
    }
    const ignored = [];
    h.forEach((name, col) => {
      if (used.has(col)) return;
      const n = clean(name);
      ignored.push(n || '(unnamed column ' + (col + 1) + ')');
    });
    return { map, ignored };
  }

  // ================================================================ CSV
  const DELIMS = [',', ';', '\t', '|'];

  // RFC 4180 records, lenient like Excel. Returns { recs, lines } where lines[i] = 1-based file line where record i starts.
  function parseRecords(text, d, start, firstLine, max){
    const D = d.charCodeAt(0), n = text.length;
    const recs = [], lines = [];
    let i = start, line = firstLine, row = [], rowLine = line;
    if (i >= n) return { recs, lines };
    for (;;){
      let field, c = i < n ? text.charCodeAt(i) : -1;
      // allow spaces before an opening quote:  a, "b, c", d
      let q = i;
      if (c === 32 && D !== 32){ while (q < n && text.charCodeAt(q) === 32) q++; }
      if (q < n && text.charCodeAt(q) === 34 && text.indexOf('"', q + 1) >= 0){
        // quoted field ("" = literal quote, delimiters and newlines allowed inside)
        let j = q + 1, buf = '';
        for (;;){
          const e = text.indexOf('"', j);
          if (e < 0){ buf += text.slice(j); i = n; break; }
          buf += text.slice(j, e);
          if (text.charCodeAt(e + 1) === 34){ buf += '"'; j = e + 2; continue; }
          i = e + 1;
          break;
        }
        if (buf.indexOf('\r') >= 0 || buf.indexOf('\n') >= 0){
          buf = buf.replace(/\r\n?/g, '\n');
          for (let k = buf.indexOf('\n'); k >= 0; k = buf.indexOf('\n', k + 1)) line++;
        }
        // text after the closing quote (malformed, e.g. "abc"def) is kept, like Excel does
        let j2 = i;
        while (j2 < n){ const cc = text.charCodeAt(j2); if (cc === D || cc === 10 || cc === 13) break; j2++; }
        if (j2 > i) buf += text.slice(i, j2);
        field = buf;
        i = j2;
      } else {
        let j = i;
        while (j < n){ const cc = text.charCodeAt(j); if (cc === D || cc === 10 || cc === 13) break; j++; }
        field = text.slice(i, j);
        i = j;
      }
      row.push(field);
      c = i < n ? text.charCodeAt(i) : -1;
      if (c === D){ i++; continue; }
      recs.push(row); lines.push(rowLine);
      if (c === 13){ i++; if (i < n && text.charCodeAt(i) === 10) i++; line++; }
      else if (c === 10){ i++; line++; }
      else break;                                  // end of text
      if (i >= n || (max && recs.length >= max)) break;
      row = []; rowLine = line;
    }
    return { recs, lines };
  }

  // Pick the delimiter whose split gives the most rows with the same (>1) field count; a row that looks like
  // a header (>= 2 known column names) is decisive.
  function detectDelimiter(text, start){
    const LIMIT = 65536, MAXR = 40;
    const sample = text.slice(start, start + LIMIT);
    const cut = text.length - start > LIMIT;
    let best = ',', bestScore = -1;
    for (const d of DELIMS){
      const { recs } = parseRecords(sample, d, 0, 1, MAXR);
      if (cut && recs.length < MAXR) recs.pop();                  // last record may be cut off mid-way
      const freq = new Map();
      let header = 0;
      for (const r of recs){
        if (r.length < 2) continue;
        freq.set(r.length, (freq.get(r.length) || 0) + 1);
        if (!header && headerHits(r) >= 2) header = 1;
      }
      let mode = 0, mf = 0;
      for (const [k, f] of freq) if (f > mf || (f === mf && k > mode)){ mode = k; mf = f; }
      const score = header * 1e6 + mf * 1000 + Math.min(mode, 999);
      if (score > bestScore){ bestScore = score; best = d; }
    }
    return best;
  }

  const blankRow = r => { for (const c of r) if (c && c.trim()) return false; return true; };

  // File bytes -> text: UTF-8 (BOM optional), UTF-16 with BOM (Excel "Unicode text"), else Windows-1252.
  function decodeBytes(u8){
    const dec = (enc, b) => {
      try { return new TextDecoder(enc).decode(b); } catch (e) { /* encoding not supported here */ }
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);     // latin-1 fallback
      return s;
    };
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return dec('utf-16le', u8.subarray(2));
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return dec('utf-16be', u8.subarray(2));
    // a UTF-8 BOM is trusted: a stray non-UTF-8 byte becomes U+FFFD instead of turning the whole file into Windows-1252
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return dec('utf-8', u8.subarray(3));
    if (typeof TextDecoder === 'function'){
      try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* not UTF-8 */ }
    }
    return dec('windows-1252', u8);
  }
  function toText(input){
    if (typeof input === 'string'){
      // UTF-16 text that was read as 8-bit (NULs between letters, BOM shown as two replacement chars)
      if (input.slice(0, 2000).indexOf('\u0000') >= 0) return input.replace(/^(\uFFFD\uFFFD|\u00FF\u00FE|\u00FE\u00FF)/, '').replace(/\u0000/g, '');
      return input;
    }
    if (input instanceof ArrayBuffer) return decodeBytes(new Uint8Array(input));
    if (ArrayBuffer.isView(input)) return decodeBytes(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    return '';
  }

  function parseCSV(text){
    const s = toText(text);
    let start = s.charCodeAt(0) === 0xFEFF ? 1 : 0, firstLine = 1, delimiter = null;
    // Excel's optional first line "sep=;"
    const m = /^sep=([^\r\n])[ ]*(\r\n|\n|\r|$)/i.exec(s.slice(start, start + 12));
    if (m){ delimiter = m[1]; start += m[0].length; firstLine = 2; }
    if (!delimiter) delimiter = detectDelimiter(s, start);
    const { recs, lines } = parseRecords(s, delimiter, start, firstLine, 0);
    // header = first row with >= 2 non-empty cells that names >= 2 known columns; else the first row with
    // >= 2 non-empty cells (skips a one-cell title line); else the first non-empty row
    let hi = -1, first = -1, wide = -1;
    for (let i = 0; i < recs.length && i < 50; i++){
      let filled = 0;
      for (const c of recs[i]) if (c.trim()) filled++;
      if (!filled) continue;
      if (first < 0) first = i;
      if (filled >= 2 && wide < 0) wide = i;
      if (filled >= 2 && headerHits(recs[i]) >= 2){ hi = i; break; }
    }
    if (hi < 0) hi = wide >= 0 ? wide : first;
    if (hi < 0) return { header: [], rows: [], delimiter, headerLine: 0, lines: [] };
    const header = recs[hi].map(clean);
    const rows = [], rowLines = [];
    for (let i = hi + 1; i < recs.length; i++){
      const r = recs[i];
      if (blankRow(r)) continue;                     // blank lines and ",,,," filler rows
      while (r.length < header.length) r.push('');   // ragged rows padded
      rows.push(r); rowLines.push(lines[i]);
    }
    return { header, rows, delimiter, headerLine: lines[hi], lines: rowLines };
  }

  // ================================================================ value parsing
  // "1,234.5" / "1.234,5" / "1234,5" / "12.5 m" / "-3" -> number. null = empty, NaN = not a number.
  // commaDecimal: the file uses ; as delimiter (European Excel), so a lone "1,234" means 1.234.
  function parseNum(raw, commaDecimal){
    let s = clean(raw);
    if (!s) return null;
    s = s.replace(/^'/, '').replace(/\u2212/g, '-').replace(/[\s']/g, '').replace(/(\u00B0|[a-z]+\.?)$/i, '');
    if (!s) return NaN;
    const hasC = s.indexOf(',') >= 0, hasD = s.indexOf('.') >= 0;
    if (hasC && hasD){
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (hasC){
      const p = s.split(',');
      if (p.length > 2) s = p.join('');                                                  // 1,234,567
      else if (!commaDecimal && /^[-+]?[1-9]\d{0,2}$/.test(p[0]) && /^\d{3}$/.test(p[1])) s = p.join(''); // 1,234
      else s = p.join('.');                                                              // 1234,5
    } else if (hasD && s.indexOf('.') !== s.lastIndexOf('.')) s = s.replace(/\./g, '');  // 1.234.567
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    const v = Number(s);
    return Number.isFinite(v) ? v : NaN;
  }

  const FLOOR_WORDS = new Set(['floor', 'flr', 'fl', 'f', 'level', 'lvl', 'lev', 'lv', 'l', 'story', 'storey', 'st', 'nd', 'rd',
    'th', 'no', 'number', 'num', 'nbr', 'the']);
  const FLOOR_LEAD = new Set(['floor', 'flr', 'fl', 'f', 'level', 'lvl', 'lev', 'lv', 'l', 'story', 'storey']);
  const GROUND = /^(g|gf|grd|ground|ground floor|ground level|lobby|lobby level|main|main floor|main level|street|street level|plaza|plaza level|entry level)$/;
  const BASEMENT = /^(b|bsmt|basement|ll|lower|p|parking|garage|sub|sublevel|sl|cellar|underground)$/;
  // "3", "03", "L3", "Level 3", "Floor 3", "3F", "3rd", "Fl. 3", "third", "G", "Ground", "Lobby" -> floor number.
  // Basements come back as 0 or negative (so they are reported as not on the campus). null = unreadable.
  function parseFloor(raw){
    let s = clean(raw).toLowerCase().replace(/^'/, '');
    if (!s) return null;
    if (/^\+?\d+(\.0+)?$/.test(s)) return parseInt(s.replace('+', ''), 10);
    if (/^-\s*\d+$/.test(s)) return -parseInt(s.replace(/\D/g, ''), 10);
    s = s.replace(/[^a-z0-9]+/g, ' ').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').trim();
    if (!s) return null;
    if (GROUND.test(s)) return 1;
    const toks = s.split(' ');
    const rest = toks.filter(t => !FLOOR_WORDS.has(t));
    // "B1", "P2", "LL", "Basement Level 1" (but not "B1-3", which is building 1 floor 3 and stays unreadable)
    if (rest.length && BASEMENT.test(rest[0]) && (rest.length === 1 || (rest.length === 2 && /^\d+$/.test(rest[1])))){
      return rest.length === 2 ? -parseInt(rest[1], 10) : 0;
    }
    // "SJ1 Floor 3": the number right after a floor word wins
    for (let i = 0; i + 1 < toks.length; i++) if (FLOOR_LEAD.has(toks[i]) && /^\d+$/.test(toks[i + 1])) return parseInt(toks[i + 1], 10);
    const nums = rest.filter(t => /^\d+$/.test(t));
    if (nums.length === 1) return parseInt(nums[0], 10);
    if (nums.length === 0){
      const w = rest.filter(t => hasOwn(ORDINALS, t) || hasOwn(CARDINALS, t));
      if (w.length === 1) return ORDINALS[w[0]] || CARDINALS[w[0]];
    }
    return null;
  }
  // Desk ids like "3-114", "03.114", "L3-114" start with the floor number.
  function floorFromDesk(desk){
    const m = /^(?:l|fl?|lvl|level)?\s*0*(\d{1,2})\s*[-._:/ ]\s*[a-z0-9]/i.exec(desk || '');
    return m ? parseInt(m[1], 10) : null;
  }

  // ---------------------------------------------------------------- buildings
  function numberIn(s){
    const str = clean(s);
    const m = /\d+/.exec(str);
    if (m) return parseInt(m[0], 10);
    for (const t of str.toLowerCase().split(/[^a-z]+/)) if (hasOwn(CARDINALS, t)) return CARDINALS[t];
    return null;
  }
  function buildingsOf(doc){
    const arr = doc && Array.isArray(doc.buildings) ? doc.buildings : [];
    const out = [];
    for (const b of arr){
      if (!b || typeof b !== 'object') continue;
      const id = clean(b.id);
      if (!id || out.some(o => o.id === id)) continue;
      const f = Number(b.floors);
      const floors = Number.isFinite(f) && f >= 1 ? Math.floor(f) : 4;
      const label = clean(b.name) || clean(b.short) || id;
      const keys = [id, b.short, b.name].map(compact).filter(Boolean);
      const nums = [...new Set([id, b.short, b.name].map(numberIn).filter(v => v != null))];
      out.push({ id, label, floors, keys, nums });
    }
    return out;
  }
  const byName = (v, bs) => { const c = compact(v); return c ? bs.find(b => b.keys.includes(c)) || null : null; };
  // alias lookup: exact key, then case/punctuation-insensitive key. undefined = no alias given.
  function aliasFor(alias, raw){
    if (hasOwn(alias, raw)) return alias[raw];
    const c = compact(raw);
    for (const k of Object.keys(alias)) if (compact(k) === c) return alias[k];
    return undefined;
  }
  function resolveBuilding(raw, bs, alias){
    const av = aliasFor(alias, raw);
    if (av !== undefined){
      if (av == null || av === '' || av === false) return null;     // explicitly "not on this campus"
      const hit = byName(av, bs);
      if (hit) return hit.id;
    }
    if (!raw) return bs.length === 1 ? bs[0].id : null;
    const hit = byName(raw, bs);
    if (hit) return hit.id;
    const n = numberIn(raw);                       // "SJ1", "SJC-02", "Bldg 2", "Building One", "B-1", "2"
    if (n != null){
      const c = bs.filter(b => b.nums.includes(n));
      if (c.length === 1) return c[0].id;
    }
    return null;
  }
  function matchBuilding(raw, campusDoc, buildingAlias){
    const alias = buildingAlias && typeof buildingAlias === 'object' ? buildingAlias : {};
    return resolveBuilding(clean(raw), buildingsOf(campusDoc), alias);
  }

  // ---------------------------------------------------------------- people
  const SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|md|dds|esq|cpa|pe|mba)\.?$/i;
  // "Shah, Priya" -> "Priya Shah"; "Smith, John, Jr." -> "John Smith Jr."; "Shah, Priya (Contractor)" keeps the note last.
  function flipComma(n){
    let tail = '';
    const m = /^(.*?)\s*(\([^()]*\))$/.exec(n);
    if (m && m[1]){ n = m[1]; tail = ' ' + m[2]; }
    const p = n.split(',').map(x => x.trim());
    if (p.length === 2 && p[0] && p[1]) return clean(SUFFIX.test(p[1]) ? p[0] + ' ' + p[1] : p[1] + ' ' + p[0]) + tail;
    if (p.length === 3 && p[0] && p[1] && SUFFIX.test(p[2])) return clean(p[1] + ' ' + p[0] + ' ' + p[2]) + tail;
    return n + tail;
  }
  function personName(full, first, last){
    if (full) return full.indexOf(',') >= 0 ? flipComma(full) : full;
    return clean((first || '') + ' ' + (last || ''));
  }
  // Some exports put the email in the name column. Emails are never stored: "priya.shah+x@corp.com" -> "Priya Shah".
  // "Priya Shah <priya.shah@corp.com>", "Sam (sam@corp.com)", "Lee, Kim kim@corp.com", "Ada | ada@corp.com",
  // "ada@corp.com (Ada)": the address is dropped, the name kept. "Pat (works @ HQ)" is a note, not an address.
  const EMAIL_IN = /<[^<>]*@[^<>]*>|\([^()]*[^\s()@]@[^\s()@][^()]*\)|[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+/g;
  function dropEmails(s){
    let addr = '';
    const name = clean(s.replace(EMAIL_IN, m => { if (!addr) addr = m.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/^mailto:\s*/i, ''); return ' '; })
      .replace(/^[\s,;:|\/"'\-\u2013\u2014]+|[\s,;:|\/"'\-\u2013\u2014]+$/g, '').replace(/^\(([^()]*)\)$/, '$1'));
    return { name, addr };
  }
  function nameFromEmail(s){
    const local = s.split('@')[0].replace(/\+.*$/, '');
    return clean(local.split(/[._\-]+/).filter(p => /^\p{L}+$/u.test(p))
      .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' '));
  }
  const ID_LIKE = /^#?\d[\d\s\-_./#]*$/;           // "10023", "#4471": an employee id, not a name
  const VACANT_EXACT = /^(open|available|empty|none|null|free|spare|shared|flex|n ?\/? ?a|hot|hotel|desk|seat|space)$/;
  const VACANT_PREFIX = /^(vacant|unassigned|unoccupied|unallocated|tbd|tba|tbh|to be (determined|assigned|hired|announced|confirmed)|new hire|reserved|available (desk|seat|space|office|cube|workstation)|hot ?desks?|hot ?desking|hotel+ing|hot ?seat|(open|free|empty|spare|shared|flex|bookable) (desk|seat|space|office|cube|cubicle|workstation|station|spot|position|req)|(desk|seat|space|office) (vacant|open|available|unassigned|empty))\b/;
  function isVacant(name){
    if (!name) return true;
    if (/^[\s\-\u2013\u2014_.?*#/\\|~]+$/.test(name)) return true;   // "--", "-", "?", "..."
    const k = name.toLowerCase().replace(/[^\p{L}\p{N}/]+/gu, ' ').trim();
    return !k || VACANT_EXACT.test(k) || VACANT_PREFIX.test(k);
  }

  // ================================================================ normalize
  function normalize(parsed, mapIn, campusDoc, buildingAlias){
    const P = parsed && typeof parsed === 'object' && Array.isArray(parsed.rows) ? parsed : { header: [], rows: [] };
    let map = mapIn && typeof mapIn === 'object' ? (mapIn.map && typeof mapIn.map === 'object' ? mapIn.map : mapIn) : null;
    if (!map) map = mapColumns(P.header).map;
    const ci = {};
    for (const f of FIELD_ORDER){
      const v = typeof map[f] === 'string' && /^\d+$/.test(map[f].trim()) ? +map[f] : map[f];
      ci[f] = Number.isInteger(v) && v >= 0 ? v : -1;
    }
    // a file value quoted inside a message, kept short
    const q = s => '"' + (s.length > 40 ? cap(s, 40) + '\u2026' : s) + '"';
    const bs = buildingsOf(campusDoc);
    const bById = new Map(bs.map(b => [b.id, b]));
    const alias = buildingAlias && typeof buildingAlias === 'object' ? buildingAlias : {};
    const commaDec = P.delimiter === ';';
    const headerLine = Number.isFinite(P.headerLine) && P.headerLine > 0 ? P.headerLine : 1;
    const lineOf = i => (Array.isArray(P.lines) && Number.isFinite(P.lines[i])) ? P.lines[i] : headerLine + 1 + i;
    // "Rotation (rad)": stored in degrees like every other rotation
    const rotRad = ci.rot >= 0 && Array.isArray(P.header) && /(^| )rad(ian)?s?( |$)/.test(normCol(P.header[ci.rot]));

    const floors = new Map();            // key -> entries
    const problems = [];
    const buildings = new Map();         // raw -> id|null
    const bCache = new Map();
    const seen = new Map();              // nameKey -> row of the kept person
    const deskOwner = new Map();         // "key|desk" -> name
    // rows: data rows read; people / vacant: entries kept; skipped: rows left out with a problem reported;
    // blank: empty rows and open desks without desk id + X/Y, dropped silently
    const stats = { rows: P.rows.length, people: 0, vacant: 0, skipped: 0, blank: 0 };
    const fCache = new Map();
    const report = (row, msg) => problems.push({ row, msg });
    const where = (bid, f) => (bById.get(bid) || { label: bid }).label + ' \u00B7 Floor ' + f;
    const bList = bs.map(b => b.label).join(', ') || 'none set up yet';

    const hasName = ci.name >= 0 || ci.first >= 0 || ci.last >= 0;
    if (!hasName) report(headerLine, 'Couldn\u2019t find a column with people\u2019s names (like "Name", or "First name" and "Last name"), so no one was imported. Only open desks with a desk id and X/Y were kept.');
    let noBuildingReported = false, noFloorCount = 0, noFloorRow = 0, deskFloorCount = 0, deskFloorRow = 0;
    let emailCount = 0, emailRow = 0, idCount = 0, idRow = 0, idExample = '';

    for (let i = 0; i < P.rows.length; i++){
      const r = Array.isArray(P.rows[i]) ? P.rows[i] : [];
      const row = lineOf(i);
      const get = f => (ci[f] >= 0 && ci[f] < r.length ? cell(r[ci[f]]) : '');

      // ---- name / vacant
      let nm = get('name'), fn = get('first'), ln = get('last'), addr = '';
      if ((nm + fn + ln).indexOf('@') >= 0){              // drop addresses before "Shah, Priya" is flipped
        const de = s => { const d = dropEmails(s); if (!d.addr) return s; addr = addr || d.addr; return d.name; };
        nm = de(nm); fn = de(fn); ln = de(ln);
        if (addr){ emailCount++; if (!emailRow) emailRow = row; }
      }
      const rawName = personName(nm, fn, ln) || (addr ? nameFromEmail(addr) : '');
      if (rawName && ID_LIKE.test(rawName)){
        idCount++; stats.skipped++;
        if (!idRow){ idRow = row; idExample = rawName; }
        continue;
      }
      const vacant = isVacant(rawName);
      const name = vacant ? '' : cap(rawName, 80);
      const deskRaw = get('desk'), desk = cap(deskRaw, 24);
      const team = cap(get('team'), 60), title = cap(get('title'), 80);
      const who = name || (desk ? 'Open desk ' + desk : 'This row');

      // ---- position
      const xs = get('x'), ys = get('y'), rs = get('rot');
      const x = parseNum(xs, commaDec), y = parseNum(ys, commaDec), rot = parseNum(rs, commaDec);
      const hasXY = Number.isFinite(x) && Number.isFinite(y);
      if (vacant && !(desk && hasXY)){ stats.blank++; continue; }   // empty row / vacant desk we can't place: silently dropped

      // ---- building
      const rawB = get('building');
      let bid;
      if (bCache.has(rawB)) bid = bCache.get(rawB);
      else { bid = resolveBuilding(rawB, bs, alias); bCache.set(rawB, bid); }
      if (!buildings.has(rawB)) buildings.set(rawB, bid);
      if (!bid){
        stats.skipped++;
        if (ci.building < 0){
          if (!noBuildingReported) report(headerLine, 'There\u2019s no building column, so it isn\u2019t clear which building (' + bList + ') these people are in. Choose a building for them.');
          noBuildingReported = true;
        } else if (!rawB) report(row, who + ': no building given. Skipped.');
        else if (aliasFor(alias, rawB) !== undefined && !byName(aliasFor(alias, rawB), bs)) report(row, who + ': building ' + q(rawB) + ' was marked as not on this campus. Skipped.');
        else report(row, who + ': building ' + q(rawB) + ' isn\u2019t one of this campus\u2019s buildings (' + bList + '). Choose which building it is, or the row is skipped.');
        continue;
      }
      const B = bById.get(bid);

      // ---- floor
      const rawF = get('floor');
      let f = null;
      if (rawF){
        if (fCache.has(rawF)) f = fCache.get(rawF);
        else { f = parseFloor(rawF); fCache.set(rawF, f); }
      }
      if (!rawF){
        const g = floorFromDesk(desk);
        if (g != null && g >= 1 && g <= B.floors){ f = g; deskFloorCount++; deskFloorRow = deskFloorRow || row; }
      }
      if (f == null){
        stats.skipped++;
        if (rawF) report(row, who + ': couldn\u2019t read the floor ' + q(rawF) + '. Skipped.');
        else if (ci.floor < 0){ noFloorCount++; noFloorRow = noFloorRow || row; }
        else report(row, who + ': no floor given. Skipped.');
        continue;
      }
      if (f < 1 || f > B.floors){
        stats.skipped++;
        report(row, who + ': ' + B.label + ' has floors 1\u2013' + B.floors + ', but this row says floor ' + q(rawF) + (f < 1 ? ' (below ground)' : '') + '. Skipped.');
        continue;
      }
      const key = bid + '-' + f;

      // ---- duplicates
      if (!vacant){
        const nk = nameKey(name);
        if (seen.has(nk)){
          stats.skipped++;
          report(row, name + ' is listed more than once (first on row ' + seen.get(nk) + '). Kept row ' + seen.get(nk) + ' and skipped this one. If they are two different people, add a middle initial to one of them.');
          continue;
        }
        seen.set(nk, row);
        if (desk){
          const dk = key + '|' + desk.toLowerCase();
          if (deskOwner.has(dk)) report(row, 'Desk ' + desk + ' (' + where(bid, f) + ') is assigned to both ' + deskOwner.get(dk) + ' and ' + name + '. Kept both.');
          else deskOwner.set(dk, name);
        }
      }

      // ---- notes that don't stop the row
      const cut = [];
      if (name.length < rawName.length && !vacant) cut.push('name (80)');
      if (desk.length < deskRaw.length) cut.push('desk id (24)');
      if (team.length < get('team').length) cut.push('team (60)');
      if (!vacant && title.length < get('title').length) cut.push('title (80)');
      if (cut.length) report(row, who + ': shortened the ' + cut.join(', ') + ' to the character limit.');
      if ((xs || ys) && !hasXY) report(row, who + ': the position (X ' + q(xs) + ', Y ' + q(ys) + ') isn\u2019t a pair of numbers, so it was ignored. The desk will be placed automatically.');
      if (rs && !Number.isFinite(rot)) report(row, who + ': the rotation ' + q(rs) + ' isn\u2019t a number, so it was ignored.');

      const e = { desk, name, team, title: vacant ? '' : title };
      if (hasXY){ e.x = x; e.y = y; if (Number.isFinite(rot)) e.rot = rotRad ? rot * 180 / Math.PI : rot; }
      if (vacant) e.vacant = true;
      if (!floors.has(key)) floors.set(key, []);
      floors.get(key).push(e);
    }
    if (noFloorCount) report(noFloorRow, 'There\u2019s no floor column, and ' + fmtInt(noFloorCount) + (noFloorCount === 1 ? ' row\u2019s desk id doesn\u2019t' : ' rows\u2019 desk ids don\u2019t') + ' start with a floor number (like 3-114), so ' + (noFloorCount === 1 ? 'it was' : 'they were') + ' skipped.');
    if (idCount) report(idRow, fmtInt(idCount) + (idCount === 1 ? ' name looks' : ' names look') + ' like an ID number, not a name (for example ' + q(idExample) + '), so ' + (idCount === 1 ? 'that row was' : 'those rows were') + ' skipped. Check that the name column holds people\u2019s names.');
    if (emailCount) report(emailRow, fmtInt(emailCount) + (emailCount === 1 ? ' name had an email address in it' : ' names had email addresses in them') + '. Email addresses are not kept: the name next to the address was used, or the part before the @ if there was no name (priya.shah@\u2026 \u2192 Priya Shah).');
    if (deskFloorCount) report(deskFloorRow, 'Floor was missing on ' + fmtInt(deskFloorCount) + (deskFloorCount === 1 ? ' row' : ' rows') + ', so it was taken from the start of the desk id (3-114 \u2192 Floor 3).');

    // Open desks that a person also sits at: the person wins, but keeps the open row's X/Y if they had none.
    for (const [key, list] of floors){
      const byDesk = new Map();
      for (const e of list) if (!e.vacant && e.desk && !byDesk.has(e.desk.toLowerCase())) byDesk.set(e.desk.toLowerCase(), e);
      const openSeen = new Set();
      const kept = list.filter(e => {
        if (!e.vacant) return true;
        const dk = e.desk.toLowerCase();
        const p = byDesk.get(dk);
        if (p){
          if (!('x' in p)){ p.x = e.x; p.y = e.y; if ('rot' in e) p.rot = e.rot; }
          return false;
        }
        if (openSeen.has(dk)) return false;            // same open desk listed twice
        openSeen.add(dk);
        return true;
      });
      floors.set(key, kept);
      for (const e of kept){ if (e.vacant) stats.vacant++; else stats.people++; }
    }
    problems.sort((a, b) => a.row - b.row);          // stable: file order, summaries next to their first row
    return { floors: Object.fromEntries(floors), problems, buildings: Object.fromEntries(buildings), stats };
  }

  // ================================================================ diff
  // Natural sort for floor keys ("B1-2" < "B1-10").
  function natCmp(a, b){
    const ra = String(a).split(/(\d+)/), rb = String(b).split(/(\d+)/);
    for (let i = 0; i < Math.min(ra.length, rb.length); i++){
      if (ra[i] === rb[i]) continue;
      const na = /^\d+$/.test(ra[i]), nb = /^\d+$/.test(rb[i]);
      if (na && nb) return parseInt(ra[i], 10) - parseInt(rb[i], 10) || (ra[i] < rb[i] ? -1 : 1);
      return ra[i] < rb[i] ? -1 : 1;
    }
    return ra.length - rb.length;
  }
  function rosterRows(v){
    const arr = Array.isArray(v) ? v : (v && typeof v === 'object' && Array.isArray(v.rows) ? v.rows : []);
    const out = [];
    for (const e of arr){
      if (Array.isArray(e)) out.push({ desk: e[0], name: e[1], team: e[2], title: e[3] });
      else if (e && typeof e === 'object') out.push(e);
    }
    return out;
  }
  function indexRosters(rosters){
    const m = new Map();
    if (!rosters || typeof rosters !== 'object') return m;
    for (const key of Object.keys(rosters).sort(natCmp)){
      for (const e of rosterRows(rosters[key])){
        if (e.vacant) continue;
        const name = clean(e.name);
        const k = nameKey(name);
        if (!k || m.has(k)) continue;              // first listing wins, like normalize
        m.set(k, { name, key, desk: clean(e.desk), team: clean(e.team), title: clean(e.title) });
      }
    }
    return m;
  }
  const at = e => e.key + (e.desk ? ' \u00B7 ' + e.desk : '');
  function diff(oldRosters, newRosters){
    const A = indexRosters(oldRosters), B = indexRosters(newRosters);
    const added = [], removed = [], moved = [], changed = [];
    let same = 0;
    for (const [k, n] of B){
      const o = A.get(k);
      if (!o){ added.push({ name: n.name, to: at(n), team: n.team, title: n.title }); continue; }
      let diffs = 0;
      if (o.key !== n.key || o.desk.toLowerCase() !== n.desk.toLowerCase()){ moved.push({ name: n.name, from: at(o), to: at(n) }); diffs++; }
      for (const field of ['team', 'title']){
        if (o[field].toLowerCase() !== n[field].toLowerCase()){ changed.push({ name: n.name, field, from: o[field], to: n[field] }); diffs++; }
      }
      if (!diffs) same++;
    }
    for (const [k, o] of A) if (!B.has(k)) removed.push({ name: o.name, from: at(o), team: o.team, title: o.title });
    return { added, removed, moved, changed, same };
  }

  // ================================================================ DXF
  // $INSUNITS -> [unit name, meters per drawing unit]
  const UNITS = { 1: ['in', 0.0254], 2: ['ft', 0.3048], 3: ['mi', 1609.344], 4: ['mm', 0.001], 5: ['cm', 0.01], 6: ['m', 1],
    7: ['km', 1000], 8: ['microinch', 2.54e-8], 9: ['mil', 2.54e-5], 10: ['yd', 0.9144], 11: ['angstrom', 1e-10],
    12: ['nm', 1e-9], 13: ['um', 1e-6], 14: ['dm', 0.1], 15: ['dam', 10], 16: ['hm', 100], 21: ['ft (US survey)', 1200 / 3937] };
  const HANDLED = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'ARC', 'TEXT', 'MTEXT', 'ATTRIB', 'INSERT']);

  // Group code in text[a, b): an integer with optional surrounding spaces/tabs/CR. NaN if the line isn't one.
  function codeAt(s, a, b){
    let i = a, v = 0, neg = false, digits = 0, c;
    while (i < b && ((c = s.charCodeAt(i)) === 32 || c === 9)) i++;
    if (i < b && s.charCodeAt(i) === 45){ neg = true; i++; }
    while (i < b && (c = s.charCodeAt(i)) >= 48 && c <= 57){ v = v * 10 + c - 48; digits++; i++; }
    while (i < b){ c = s.charCodeAt(i); if (c === 32 || c === 9 || c === 13) i++; else return NaN; }
    return digits ? (neg ? -v : v) : NaN;
  }
  // TEXT / MTEXT content -> plain label text.
  function dxfText(s, mtext){
    let t = String(s || '');
    t = t.replace(/%%%/g, '\u0004')
      .replace(/%%(\d{3})/g, (m, d) => String.fromCharCode(+d))
      .replace(/%%[cC]/g, '\u00D8').replace(/%%[dD]/g, '\u00B0').replace(/%%[pP]/g, '\u00B1').replace(/%%[uUoOkK]/g, '')
      .replace(/\u0004/g, '%')
      .replace(/\\U\+([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\M\+[0-9a-fA-F]{5}/g, '');
    if (mtext){
      t = t.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003')
        .replace(/\\P/g, ' ').replace(/\\~/g, ' ').replace(/\\X/g, ' ')
        .replace(/\\S([^;^/#\\]*)[\^/#]([^;\\]*);/g, '$1/$2')                 // stacked fraction
        .replace(/\\[ACcFfHhQqTtWwp][^;\\{}]{0,64};/g, '')                      // \fArial|b1; \H2.5x; \C1; ...
        .replace(/\\[LlOoKkN]/g, '')                                            // underline/overline/strike toggles
        .replace(/[{}]/g, '')
        .replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
    } else {
      t = t.replace(/\^J/g, ' ').replace(/\^I/g, ' ');
    }
    return clean(t);
  }

  function emptyDXF(error, note){
    return { units: 'unknown', scale: null, layers: {}, segments: [], texts: [], inserts: [], bounds: null, ignored: {}, note, error };
  }

  function parseDXF(text){
    if (typeof text !== 'string' || !text.trim()) return emptyDXF('empty', 'The file is empty.');
    const head = text.slice(0, 32);
    if (/^AutoCAD Binary DXF/i.test(head)) return emptyDXF('binary', 'This is a binary DXF. In CAD, save it as an ASCII (text) DXF and try again.');
    if (/^AC1\d{3}/.test(head)) return emptyDXF('dwg', 'This is a DWG drawing, not a DXF. In CAD, save it as an ASCII DXF and try again.');

    const n = text.length;
    const NL = text.indexOf('\n') >= 0 ? '\n' : '\r';     // very old files use bare CR
    let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    let code = 0, vs = 0, ve = 0;                        // current pair: code, value = text[vs, ve)
    const val = () => text.slice(vs, ve);
    const num = () => parseFloat(text.slice(vs, ve));
    function next(){
      for (;;){
        if (pos >= n) return false;
        let e = text.indexOf(NL, pos);
        if (e < 0) e = n;
        const c = codeAt(text, pos, e);
        if (c !== c){ pos = e + 1; continue; }        // NaN: blank/junk line, resync on the next one
        const s = e + 1;
        if (s > n) return false;
        let f = text.indexOf(NL, s);
        if (f < 0) f = n;
        pos = f + 1;
        ve = f > s && text.charCodeAt(f - 1) === 13 ? f - 1 : f;
        vs = s;
        code = c;
        return true;
      }
    }

    const segments = [], texts = [], inserts = [];
    const layerCount = new Map(), ignored = new Map();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const ok = v => v === v && v > -1e12 && v < 1e12;   // finite and sane
    function addSeg(layer, ax, ay, bx, by){
      if (!ok(ax) || !ok(ay) || !ok(bx) || !ok(by) || (ax === bx && ay === by)) return;
      segments.push({ layer, x1: ax, y1: ay, x2: bx, y2: by });
      layerCount.set(layer, (layerCount.get(layer) || 0) + 1);
      if (ax < x0) x0 = ax; if (ax > x1) x1 = ax; if (ay < y0) y0 = ay; if (ay > y1) y1 = ay;
      if (bx < x0) x0 = bx; if (bx > x1) x1 = bx; if (by < y0) y0 = by; if (by > y1) y1 = by;
    }
    const seeLayer = l => { if (!layerCount.has(l)) layerCount.set(l, 0); };
    function addPath(layer, xs, ys, closed, flip){
      const k = flip ? -1 : 1, m = xs.length;
      for (let i = 1; i < m; i++) addSeg(layer, k * xs[i - 1], ys[i - 1], k * xs[i], ys[i]);
      if (closed && m > 2) addSeg(layer, k * xs[m - 1], ys[m - 1], k * xs[0], ys[0]);
      seeLayer(layer);
    }

    let poly = null;                                   // open POLYLINE waiting for VERTEX ... SEQEND
    function closePoly(){ if (poly){ if (!poly.skip) addPath(poly.layer, poly.xs, poly.ys, poly.closed, poly.flip); poly = null; } }

    function newEntity(type){
      return { type, skip: !HANDLED.has(type), layer: '0', x1: NaN, y1: NaN, x2: NaN, y2: NaN, r: NaN, a1: 0, a2: 360,
        f70: 0, f72: 0, f73: 0, f74: 0, t1: '', t3: '', name: '', ez: 1,
        xs: type === 'LWPOLYLINE' ? [] : null, ys: type === 'LWPOLYLINE' ? [] : null };
    }
    function feed(e){
      switch (code){
        case 8: e.layer = val().trim() || '0'; break;
        case 10: if (e.xs){ e.xs.push(num()); e.ys.push(NaN); } else e.x1 = num(); break;
        case 20: if (e.xs){ if (e.ys.length) e.ys[e.ys.length - 1] = num(); } else e.y1 = num(); break;
        case 11: e.x2 = num(); break;
        case 21: e.y2 = num(); break;
        case 40: e.r = num(); break;
        case 50: e.a1 = num(); break;
        case 51: e.a2 = num(); break;
        case 70: e.f70 = parseInt(val(), 10) || 0; break;
        case 72: e.f72 = parseInt(val(), 10) || 0; break;
        case 73: e.f73 = parseInt(val(), 10) || 0; break;
        case 74: e.f74 = parseInt(val(), 10) || 0; break;
        case 1: e.t1 = val(); break;
        case 3: e.t3 += val(); break;
        case 2: e.name = val().trim(); break;
        case 230: { const z = num(); if (z === z) e.ez = z; break; }
      }
    }
    function endEntity(e){
      const t = e.type;
      if (t !== 'VERTEX' && t !== 'SEQEND' && poly) closePoly();   // POLYLINE missing its SEQEND
      if (e.skip){ ignored.set(t, (ignored.get(t) || 0) + 1); return; }
      const flip = e.ez < 0;                           // OCS extrusion (0,0,-1): mirrored in x
      const k = flip ? -1 : 1;
      switch (t){
        case 'LINE': addSeg(e.layer, e.x1, e.y1, e.x2, e.y2); seeLayer(e.layer); break;
        case 'LWPOLYLINE': addPath(e.layer, e.xs, e.ys, (e.f70 & 1) === 1, flip); break;   // bulges drawn straight
        case 'POLYLINE':
          poly = { layer: e.layer, closed: (e.f70 & 1) === 1, skip: (e.f70 & (16 | 64)) !== 0, xs: [], ys: [], flip: flip && !(e.f70 & 8) };
          break;
        case 'VERTEX': if (poly && !(e.f70 & 16)){ poly.xs.push(e.x1); poly.ys.push(e.y1); } break;
        case 'SEQEND': closePoly(); break;
        case 'ARC': {
          const r = e.r;
          if (!ok(r) || r <= 0 || !ok(e.x1) || !ok(e.y1) || !ok(e.a1) || !ok(e.a2)) break;
          let sweep = ((e.a2 - e.a1) % 360 + 360) % 360;
          if (sweep < 1e-9) sweep = 360;
          const steps = Math.max(1, Math.ceil(sweep / 15 - 1e-9));
          const xs = [], ys = [];
          for (let i = 0; i <= steps; i++){
            const a = (e.a1 + sweep * i / steps) * Math.PI / 180;
            xs.push(e.x1 + r * Math.cos(a)); ys.push(e.y1 + r * Math.sin(a));
          }
          addPath(e.layer, xs, ys, false, flip);
          break;
        }
        case 'TEXT': case 'MTEXT': case 'ATTRIB': {
          if (t === 'ATTRIB' && (e.f70 & 1)) break;    // invisible attribute
          const aligned = t === 'TEXT' ? (e.f72 || e.f73) : t === 'ATTRIB' ? (e.f72 || e.f74) : 0;
          const x = aligned && ok(e.x2) ? e.x2 : e.x1, y = aligned && ok(e.y2) ? e.y2 : e.y1;
          const s = dxfText(t === 'MTEXT' ? e.t3 + e.t1 : e.t1, t === 'MTEXT');
          if (!s || !ok(x) || !ok(y)) break;
          texts.push({ layer: e.layer, x: k * x, y, text: s, h: ok(e.r) ? e.r : 0 });
          seeLayer(e.layer);
          break;
        }
        case 'INSERT': {
          if (!ok(e.x1) || !ok(e.y1)) break;
          const rot = ok(e.a1) ? e.a1 : 0;
          inserts.push({ layer: e.layer, block: e.name, x: k * e.x1, y: e.y1, rot: flip ? 180 - rot : rot });
          seeLayer(e.layer);
          break;
        }
      }
    }

    let section = '', wantName = false, hvar = '', insunits = null, sawSection = false;
    let ent = null;
    while (next()){
      if (code === 0){
        if (ent){ endEntity(ent); ent = null; }
        const v = val().trim().toUpperCase();
        if (v === 'SECTION'){ wantName = true; sawSection = true; section = ''; continue; }
        if (v === 'ENDSEC'){ closePoly(); section = ''; continue; }
        if (v === 'EOF') break;
        if (section === 'ENTITIES') ent = newEntity(v);
        continue;
      }
      if (wantName){ wantName = false; if (code === 2){ section = val().trim().toUpperCase(); continue; } }
      if (section === 'HEADER'){
        if (code === 9) hvar = val().trim().toUpperCase();
        else if (hvar === '$INSUNITS' && code === 70) insunits = parseInt(val(), 10);
        continue;
      }
      if (ent && !ent.skip) feed(ent);
    }
    if (ent) endEntity(ent);
    closePoly();

    if (!sawSection) return emptyDXF('not-dxf', 'This doesn\u2019t look like a DXF drawing (no SECTION found).');
    const u = UNITS[insunits];
    if (!segments.length){                              // no walls: frame whatever labels/blocks there are
      for (const p of texts.concat(inserts)){ x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    }
    const notes = ['Read ' + fmtInt(segments.length) + ' line segments from the drawing\u2019s main ENTITIES section. Walls drawn inside blocks or external references (xrefs) are not read \u2014 if walls are missing, explode or bind them in CAD and export again.'];
    if (!u) notes.push('The drawing doesn\u2019t say what units it uses, so set the scale by picking two points a known distance apart.');
    if (inserts.length) notes.push(fmtInt(inserts.length) + ' block reference' + (inserts.length === 1 ? ' was' : 's were') + ' found; only their positions are shown.');
    return {
      units: u ? u[0] : 'unknown', scale: u ? u[1] : null,
      layers: Object.fromEntries(layerCount), segments, texts, inserts,
      bounds: x0 <= x1 ? { x0, y0, x1, y1 } : null,
      ignored: Object.fromEntries(ignored),
      note: notes.join(' '),
    };
  }

  // ================================================================ alignment
  function pt(p){
    let x, y;
    if (Array.isArray(p)){ x = +p[0]; y = +p[1]; }
    else if (p && typeof p === 'object'){ x = +p.x; y = +(p.y !== undefined ? p.y : p.z); }
    return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
  }
  // Similarity transform (uniform scale s, rotation r radians, translation tx,ty) mapping p1->q1 and p2->q2.
  // Points are [x, y] (or {x, y}). If either pair coincides there is no scale/rotation to learn: degenerate,
  // and it falls back to a plain translation p1 -> q1. No reflection: flip y yourself if the frames differ.
  function similarity(p1, p2, q1, q2){
    const a = pt(p1), b = pt(p2), c = pt(q1), d = pt(q2);
    const px = b[0] - a[0], py = b[1] - a[1], qx = d[0] - c[0], qy = d[1] - c[1];
    const lp = Math.hypot(px, py), lq = Math.hypot(qx, qy);
    let s = 1, r = 0, degenerate = true;
    if (lp > 1e-9 && lq > 1e-9){
      s = lq / lp;
      r = Math.atan2(qy, qx) - Math.atan2(py, px);
      r = Math.atan2(Math.sin(r), Math.cos(r));       // wrap to (-pi, pi]
      degenerate = false;
    }
    const cs = Math.cos(r), sn = Math.sin(r);
    const tx = c[0] - s * (cs * a[0] - sn * a[1]), ty = c[1] - s * (sn * a[0] + cs * a[1]);
    return {
      s, r, tx, ty, degenerate,
      apply(p){ const [x, y] = pt(p); return [s * (cs * x - sn * y) + tx, s * (sn * x + cs * y) + ty]; },
      invert(p){ const [x, y] = pt(p), u = (x - tx) / s, v = (y - ty) / s; return [cs * u + sn * v, -sn * u + cs * v]; },
    };
  }

  // ================================================================ CSV out
  const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
  function csvCell(v){
    let s;
    if (v == null) s = '';
    else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
    else if (typeof v === 'string') s = v;
    else if (typeof v === 'boolean' || typeof v === 'bigint') s = String(v);
    else s = '';
    // formula-injection guard: a spreadsheet would run =cmd|..., +..., -..., @... (plain numbers like -12.5 are safe)
    if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = "'" + s;
    if (/[",;\t|\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(rows){
    if (!Array.isArray(rows)) return '';
    let out = '';
    for (const r of rows){
      const cells = Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.values(r) : [r]);
      out += cells.map(csvCell).join(',') + '\r\n';
    }
    return out;
  }
  function template(){
    return toCSV([
      ['Building', 'Floor', 'Desk', 'Name', 'Team', 'Title', 'X', 'Y'],
      ['B1', 3, '3-114', 'Ada Example', 'Verification', 'Staff engineer', '', ''],
      ['B1', 3, '3-118', 'Sam Sample', 'Validation Lab', 'Lab technician', 12.5, -4],
      ['B2', 1, '1-020', 'Pat Placeholder', 'Finance', 'Senior analyst', '', ''],
    ]);
  }

  // ================================================================ PDF (browser only)
  // Page 1 of a PDF floor plan -> PNG Blob, long side ~4096 px (max 16M pixels), on white.
  function renderPDF(file, pdfjsLib){
    if (typeof document === 'undefined' || !document || typeof document.createElement !== 'function')
      return Promise.reject(new Error('Reading a PDF plan needs a web browser.'));
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function')
      return Promise.reject(new Error('The PDF reader didn\u2019t load, so the plan can\u2019t be read. Check your connection and try again.'));
    if (!file) return Promise.reject(new Error('No PDF file was chosen.'));
    const readBytes = () => {
      if (file instanceof ArrayBuffer) return Promise.resolve(file);
      if (ArrayBuffer.isView(file)) return Promise.resolve(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
      if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
      if (typeof FileReader === 'function') return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('Couldn\u2019t read the file.'));
        fr.readAsArrayBuffer(file);
      });
      return Promise.reject(new Error('Couldn\u2019t read the file.'));
    };
    let doc = null;
    // isEvalSupported:false: pdf.js must never build font paths with new Function (CVE-2024-4367, pdf.js <= 4.1)
    return readBytes().then(buf => pdfjsLib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise).then(d => {
      doc = d;
      return doc.getPage(1);
    }).then(page => {
      const base = page.getViewport({ scale: 1 });
      const long = Math.max(base.width, base.height, 1);
      let scale = 4096 / long;
      if (base.width * base.height * scale * scale > 16e6) scale = Math.sqrt(16e6 / Math.max(1, base.width * base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser couldn\u2019t make a drawing surface for the plan.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);   // PDFs are transparent; plans read best on white
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(() => new Promise((res, rej) => {
        canvas.toBlob(b => {
          canvas.width = canvas.height = 0;                   // free the bitmap right away (Safari keeps it)
          b ? res(b) : rej(new Error('Couldn\u2019t turn the PDF page into an image.'));
        }, 'image/png');
      }));
    }).then(blob => { if (doc && doc.destroy) doc.destroy(); return blob; }, err => {
      if (doc && doc.destroy) doc.destroy();
      const name = err && err.name;
      if (name === 'PasswordException') throw new Error('This PDF is password-protected. Save an unprotected copy and try again.');
      if (name === 'InvalidPDFException') throw new Error('This file isn\u2019t a readable PDF.');
      throw err instanceof Error ? err : new Error((err && err.message) || 'Couldn\u2019t read the PDF.');
    });
  }

  return { parseCSV, mapColumns, normalize, diff, parseDXF, similarity, template, toCSV, renderPDF,
    parseFloor, matchBuilding, nameKey };
})();
