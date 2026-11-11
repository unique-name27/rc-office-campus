// Bake captured worlds one at a time (the user's PC crashes under heavy CPU load: one Blender, -t 4, GPU-only Cycles).
// usage: node src/tools/bake/run_bakes.mjs <capture dir> [--samples 160] [keys...]
// Waits for the shared lock (.blender.lock in the repo root) and for any other headless Blender to finish, takes the
// lock for one world, bakes it with bake_world.py into <capture dir>/<key>/, releases it, then the next world.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BLENDER = 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe', LOCK = join(ROOT, '.blender.lock');
const args = process.argv.slice(2), DIR = resolve(args[0]);
const samples = args.includes('--samples') ? args[args.indexOf('--samples') + 1] : '160';
let keys = args.slice(1).filter((a, i, l) => !a.startsWith('--') && l[i - 1] !== '--samples');
if (!keys.length) keys = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const headless = () => +spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='blender.exe'\" | Where-Object { $_.CommandLine -like '* -b *' } | Measure-Object | % Count"], { encoding: 'utf8' }).stdout.trim() || 0;
for (const key of keys) {
  for (let i = 0; existsSync(LOCK) || headless(); i++) { if (i % 12 === 0) console.log(`${key}: waiting for Blender to be free...`); sleep(5000) }
  writeFileSync(LOCK, 'main-bake ' + key);
  try {
    const t = Date.now();
    const r = spawnSync(BLENDER, ['-b', '--factory-startup', '-t', '4', '--python', join(ROOT, 'src', 'tools', 'bake', 'bake_world.py'), '--', join(DIR, key + '.json'), DIR, '--samples', samples], { encoding: 'utf8', maxBuffer: 64 << 20 });
    const lines = (r.stdout + r.stderr).split('\n').filter(l => /^\[|Error|Traceback|line \d+/.test(l));
    console.log(lines.join('\n'));
    console.log(`${key}: Blender exited ${r.status} after ${((Date.now() - t) / 1000).toFixed(0)} s`);
  } finally { rmSync(LOCK, { force: true }) }
}
