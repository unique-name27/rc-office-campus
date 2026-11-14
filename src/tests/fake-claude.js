// Test-only stand-in for the claude.ai artifact runtime (db/user/room), enabled with #fakedb in the URL.
// In-memory, async like the real store, notifies listeners after writes. Never shipped in the published page.
(function () {
  if (!/fakedb/.test(location.hash)) return;
  // #fakedb-coworker: a Contributor (no Set up); #fakedb-persist: the store survives reloads (try one role, then the other)
  const role = /coworker/.test(location.hash) ? 'coworker' : 'admin', persist = /persist/.test(location.hash);
  const store = new Map(persist ? (() => { try { return JSON.parse(localStorage.getItem('__fakeStore') || '[]') } catch (_) { return [] } })() : []), subs = new Set(), later = f => setTimeout(f, 30);
  const save = () => { if (persist) try { localStorage.setItem('__fakeStore', JSON.stringify([...store])) } catch (_) {} };
  const clone = v => JSON.parse(JSON.stringify(v));
  const segs = p => p.split('/');
  const snapDoc = path => { const d = store.get(path); return { id: segs(path).pop(), exists: !!d, data: () => d && clone(d), metadata: { fromCache: false, hasPendingWrites: false } } };
  const snapCol = (path, lim) => {
    const n = segs(path).length + 1;
    const docs = [...store.keys()].filter(k => k.startsWith(path + '/') && segs(k).length === n).sort().slice(0, lim || 1000).map(snapDoc);
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
  };
  const notify = () => { save(); for (const s of subs) later(() => s.cb(s.kind === 'doc' ? snapDoc(s.path) : snapCol(s.path, s.lim))) };
  const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') merge(a[k], b[k]); else a[k] = b[k] } };
  window.__fakeWrites = [];
  function docRef(path) {
    return {
      id: segs(path).pop(), path,
      get: () => Promise.resolve(snapDoc(path)),
      set: d => { if (JSON.stringify(d).length > 262144) return Promise.reject({ code: 'invalid_argument', message: 'too big' }); store.set(path, clone(d)); window.__fakeWrites.push('set ' + path); notify(); return Promise.resolve() },
      update: d => { const c = store.get(path); if (!c) return Promise.reject({ code: 'invalid_argument' }); merge(c, clone(d)); window.__fakeWrites.push('update ' + path); notify(); return Promise.resolve() },
      delete: () => { store.delete(path); notify(); return Promise.resolve() },
      onSnapshot: (cb) => { const s = { kind: 'doc', path, cb }; subs.add(s); later(() => cb(snapDoc(path))); return () => subs.delete(s) },
    };
  }
  function colRef(path, lim) {
    const q = {
      path, where: () => q, orderBy: () => q, limit: n => colRef(path, n),
      get: () => Promise.resolve(snapCol(path, lim)),
      onSnapshot: (cb) => { const s = { kind: 'col', path, lim, cb }; subs.add(s); later(() => cb(snapCol(path, lim))); return () => subs.delete(s) },
      doc: id => docRef(path + '/' + id),
    };
    return q;
  }
  const db = { doc: docRef, collection: p => colRef(p) };
  const user = {
    id: async () => window.__fakeUid || (role === 'coworker' ? 'u_cowork' : 'u_test'), canEdit: async () => role === 'admin', isOwner: async () => role === 'admin', can: async () => role === 'admin',
    profiles: async ids => Object.fromEntries(ids.map(i => [i, { name: i === 'u_test' ? (window.__fakeName || localStorage.getItem('__fakeName') || 'Test Person') : i === 'u_cowork' ? 'Sam Rivera' : 'Coworker ' + i }])),
  };
  const room = { presence: () => Promise.resolve(), onPeers: () => () => {} };
  window.__fakeStore = store;
  window.claude = { use: n => Promise.resolve(n === 'db' ? db : n === 'user' ? user : n === 'room' ? room : null) };
})();
