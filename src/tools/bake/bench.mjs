// Before/after screenshots and GPU frame times of baked vs realtime Studio, in the real game on the real GPU.
// usage: node src/tools/bake/bench.mjs <out dir> shots|perf [WxH] [keys...]
// Builds a --test page into <out dir> and drives it in a hidden Edge window (--use-angle=d3d11). "realtime" is the
// same world with the bake switched off (BAKE.enable(false)), i.e. today's Studio.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [outArg, what = 'shots', size = '1280x800', ...keyArgs] = process.argv.slice(2);
const OUT = resolve(outArg), [W, H] = size.split('x').map(Number), SHOTS = join(OUT, 'shots');
mkdirSync(SHOTS, { recursive: true });
const b = spawnSync('python', ['-I', join(ROOT, 'src', 'build.py'), join(OUT, 'rc.html'), '--test'], { encoding: 'utf8' });
if (b.status) { console.error(b.stdout, b.stderr); process.exit(1) }
console.log(b.stdout.trim());
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', PORT = 9381, HTTP = 9382, PROF = join(tmpdir(), 'rc-bench-edge');
const server = createServer((req, res) => {
  const p = join(OUT, decodeURIComponent(new URL(req.url, 'http://x').pathname)); if (!p.startsWith(OUT) || !existsSync(p)) { res.writeHead(404); res.end(); return }
  const body = readFileSync(p); res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream', 'Content-Length': body.length }); res.end(body);
}).listen(HTTP, '127.0.0.1');
try { rmSync(PROF, { recursive: true, force: true }) } catch (_) {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`, `--window-size=${W},${H}`, '--force-device-scale-factor=1',
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = t.find(x => x.type === 'page');
      if (p) {
        ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
        ws.onclose = () => { for (const [, r] of pending) r({ result: { exceptionDetails: { text: 'Edge closed the connection' } } }); pending.clear() };
        ws.onmessage = e => { const m = JSON.parse(e.data);
          if (m.method === 'Runtime.exceptionThrown') console.error('page error:', JSON.stringify(m.params.exceptionDetails).slice(0, 400));
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('page console:', m.params.args.map(a => a.value || a.description).join(' ').slice(0, 300));
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } };
        return;
      }
    } catch (_) {}
    await sleep(250);
  }
  throw new Error('Edge did not start');
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
const evalJS = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result.result.value };
const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(s.result.data, 'base64')) };
// views: the overview, standing at a spot (walk: x, z, yaw, pitch), and the car's chase camera (drive: x, z, heading)
const VIEWS = {
  'B1-1': [['overview'], ['walk', 13, -3, 2.4, -.25], ['walk', -12, -9, 2.6, -.3], ['drive', 11.6, 12, 0]],
  'B2-1': [['overview'], ['walk', 20, 0, 2.2, -.25], ['drive', 0, 10, 0]],
  campus: [['overview'], ['walk', -36, 22, 2.6, -.2]],
};
const pose = v => v[0] === 'overview' ? `__rc.flyTo('overview',.01)`
  : v[0] === 'walk' ? `Object.assign(__rc.walker,{x:${v[1]},z:${v[2]},yaw:${v[3]},pitch:${v[4]}}),__rc.flyTo('walk',.01)`
  : `Object.assign(__rc.me,{x:${v[1]},z:${v[2]},h:${v[3]},camH:${v[3]},vx:0,vz:0,vF:0}),__rc.flyTo('drive',.01)`;
// GPU time of n back-to-back frames of HD's own draw (post included when the quality level has it)
const MEASURE = `(async n=>{const gl=__rc.renderer.getContext(),TQ=gl.getExtension('EXT_disjoint_timer_query_webgl2'),px=new Uint8Array(4);
  for(let i=0;i<10;i++)__rc.HD.draw();gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);const qs=[],t0=performance.now();
  for(let i=0;i<n;i++){let q=null;if(TQ){q=gl.createQuery();gl.beginQuery(TQ.TIME_ELAPSED_EXT,q)}__rc.HD.draw();if(q){gl.endQuery(TQ.TIME_ELAPSED_EXT);qs.push(q)}}
  gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);const wall=(performance.now()-t0)/n,ms=[];
  for(const q of qs){for(let k=0;k<200&&!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE);k++)await new Promise(r=>setTimeout(r,5));if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))ms.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}
  const R=__rc.renderer;R.info.autoReset=false;R.info.reset();__rc.HD.draw();const inf={calls:R.info.render.calls,tris:R.info.render.triangles};R.info.autoReset=true;
  return{gpuMs:ms.length?+(ms.reduce((a,b)=>a+b,0)/ms.length).toFixed(3):null,wallMs:+wall.toFixed(3),...inf,baked:__rc.BAKE.on,shadows:R.shadowMap.enabled}})`;
try {
  await connect(); await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/rc.html` });
  let ok = false; for (let i = 0; i < 160; i++) { await sleep(250); try { if (await evalJS('!!(window.__rc&&window.__rc.WM)')) { ok = true; break } } catch (_) {} }
  if (!ok) throw new Error('the game never started');
  console.log('GPU:', await evalJS(`(()=>{const gl=__rc.renderer.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):''})()`));
  await evalJS('__rc.applyStyle(0)');
  const keys = keyArgs.length ? keyArgs : Object.keys(VIEWS), perf = [];
  for (const key of keys) for (const mode of ['realtime', 'baked']) {
    await evalJS(`__rc.BAKE.enable(${mode === 'baked'}),__rc.enterWorld(${JSON.stringify(key)})`); await sleep(1800);
    await evalJS(`document.body.classList.add('bench');document.querySelectorAll('body>*:not(#stage)').forEach(e=>{if(e.tagName!=='SCRIPT')e.style.visibility='hidden'})`);
    const info = await evalJS('__rc.BAKE.info'); if (mode === 'baked' && !info.on) console.log(`${key}: no matching bake, realtime only`);
    for (const [k, v] of (VIEWS[key] || [['overview']]).entries()) {
      await evalJS(pose(v)); await sleep(1300);
      if (what === 'shots') { await shot(`${key}-${k}-${v[0]}-${mode}`); console.log('shot', key, k, v[0], mode) }
      else for (const [lvl, name] of [[0, 'High'], [2, 'Low']]) {
        await evalJS(`__rc.HD.applyQuality(${lvl})`); await sleep(600);
        const r = await evalJS(MEASURE + '(240)'); perf.push({ key, view: v[0] + k, mode, quality: name, ...r });
        console.log(key.padEnd(7), (v[0] + k).padEnd(10), mode.padEnd(9), name.padEnd(5), JSON.stringify(r));
      }
    }
  }
  await evalJS('__rc.BAKE.enable(true)');
  if (perf.length) writeFileSync(join(SHOTS, `perf-${W}x${H}.json`), JSON.stringify(perf, null, 1));
} catch (e) { console.error('failed:', e.message); process.exitCode = 1 }
finally { try { await send('Browser.close') } catch (_) {} await sleep(800); try { edge.kill() } catch (_) {} server.close() }
