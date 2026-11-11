// Capture each world's static geometry from the real game, for the Blender bake (src/tools/bake/bake_world.py).
// usage: node src/tools/bake/capture.mjs <out dir> [keys...]     (default: every sample floor and the campus)
// Builds a --test page into <out dir>, opens it in a hidden Edge window on the real GPU, switches to Studio and, per
// world, writes <out dir>/<key>.json with BAKE.capture(): the lightmapped faces with their atlas coordinates (packed by
// the game's own code, so the bake matches what the game draws), the ground pieces, the light blockers and the hash.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = resolve(process.argv[2] || join(tmpdir(), 'rc-bake'));
const KEYS = process.argv.slice(3);
mkdirSync(OUT, { recursive: true });
const b = spawnSync('python', ['-I', join(ROOT, 'src', 'build.py'), join(OUT, 'rc.html'), '--test'], { encoding: 'utf8' });
if (b.status) { console.error(b.stdout, b.stderr); process.exit(1) }
console.log(b.stdout.trim());

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', PORT = 9361, HTTP = 9362, PROF = join(tmpdir(), 'rc-bake-edge');
const server = createServer((req, res) => {
  const p = join(OUT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(OUT) || !existsSync(p)) { res.writeHead(404); res.end(); return }
  const body = readFileSync(p); res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
}).listen(HTTP, '127.0.0.1');
try { rmSync(PROF, { recursive: true, force: true }) } catch (_) {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, '--window-size=1280,800', '--force-device-scale-factor=1',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = t.find(x => x.type === 'page');
      if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
        ws.onclose = () => { for (const [, r] of pending) r({ result: { exceptionDetails: { text: 'Edge closed the connection' } } }); pending.clear() };
        ws.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') console.error('page error:', JSON.stringify(m.params.exceptionDetails).slice(0, 400));
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }; return } } catch (_) {}
    await sleep(250);
  }
  throw new Error('Edge did not start');
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
const evalJS = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value };
try {
  await connect(); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/rc.html` });
  let ok = false; for (let i = 0; i < 160; i++) { await sleep(250); try { if (await evalJS('!!(window.__rc&&window.__rc.WM)')) { ok = true; break } } catch (_) {} }
  if (!ok) throw new Error('the game never started');
  await evalJS('__rc.applyStyle(0)');
  const keys = KEYS.length ? KEYS : [...await evalJS('__rc.floorKeys()'), 'campus'];
  for (const key of keys) {
    let t = Date.now(); await evalJS(`__rc.enterWorld(${JSON.stringify(key)})`); await sleep(400);
    const tw = Date.now() - t; t = Date.now();
    const len = await evalJS('(window.__cap=JSON.stringify(__rc.BAKE.capture())).length'), tc = Date.now() - t, parts = [];
    for (let o = 0; o < len; o += 1e6) parts.push(await evalJS(`window.__cap.slice(${o},${o + 1e6})`));   // CDP replies stay small
    await evalJS('window.__cap=null'); const s = parts.join('');
    console.log(`${key}: world ${tw} ms, capture ${tc} ms`);
    const j = JSON.parse(s);
    writeFileSync(join(OUT, key + '.json'), s);
    console.log(`${key}: hash ${j.hash}, ${j.A.n} lightmapped tris (${j.atlas.rects.length} faces, ${j.atlas.d.toFixed(1)} px/m), ${j.F.n} ground tris, ${j.O.n} blocker tris, ${(s.length / 1048576).toFixed(1)} MB`);
  }
} catch (e) { console.error('failed:', e.message); process.exitCode = 1 }
finally { try { await send('Browser.close') } catch (_) {} await sleep(800); try { edge.kill() } catch (_) {} server.close() }
