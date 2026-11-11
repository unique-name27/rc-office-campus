"""Pack the Blender-simulated physics moments into src/js/fx-data.js (const FX_DATA), played by src/js/game-2d-fx.js.

usage: python -I src/tools/pack_fx.py <dir written by src/blender/fx_sim.py> [--dry]

fx.json holds float tracks at 30 fps in the game's axes. Here they become little-endian Int16, base64:
  scatter.t  frames x pieces x 7: position (x, y, z) / ps, then the rotation quaternion (x, y, z, w) x 32767
  splash.t   frames x drops x 3: position / ps;  splash.land: the frame each drop reaches the floor
The scatter's last 0.8 s is slowed down smoothly to a stop (a mug or a pen may still be rolling when the recording
ends; frozen mid-roll it would look wrong). Budget: at most 60 KB of base64 in all.
"""
import base64, json, math, os, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'js', 'fx-data.js'))
BUDGET = 60 * 1024
EASE = 24      # output frames over which the scatter comes to rest (they cover EASE / 2 recorded frames)


def b64(vals): return base64.b64encode(struct.pack('<%dh' % len(vals), *vals)).decode()
def q16(v, s): return max(-32767, min(32767, round(v / s)))


def lerp(a, b, t): return [x + (y - x) * t for x, y in zip(a, b)]
def nlerp(a, b, t):
    q = lerp(a, b, t); l = math.sqrt(sum(x * x for x in q)) or 1
    return [x / l for x in q]


def settle(track, mix, n_out):
    """play the track 1:1, then ease the last EASE frames to a stop (source time 2s - s*s, slope 1 -> 0)"""
    f0 = n_out - 1 - EASE; out = []
    for f in range(n_out):
        if f <= f0: src = float(f)
        else:
            s = (f - f0) / EASE; src = f0 + EASE / 2 * (2 * s - s * s)
        i = min(int(src), len(track) - 2); out.append(mix(track[i], track[i + 1], src - i))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: raise SystemExit(__doc__)
    d = json.load(open(os.path.join(args[0], 'fx.json')))
    sc, sp = d['scatter'], d['splash']
    # ---- desk scatter
    n = sc['frames']
    for p in sc['pieces']:
        for i in range(1, len(p['q'])):                 # keep neighbouring quaternions on the same side (for nlerp)
            if sum(a * b for a, b in zip(p['q'][i - 1], p['q'][i])) < 0: p['q'][i] = [-x for x in p['q'][i]]
        p['p'] = settle(p['p'], lerp, n); p['q'] = settle(p['q'], nlerp, n)
    ps = max(abs(v) for p in sc['pieces'] for q in p['p'] for v in q) / 32767
    vals = []
    for f in range(n):
        for p in sc['pieces']:
            vals += [q16(v, ps) for v in p['p'][f]] + [q16(v, 1 / 32767) for v in p['q'][f]]
    scatter = {'fps': sc['fps'], 'n': n, 'top': sc['top'], 'ps': ps, 'pieces': [{'k': p['kind'], 'c': p['c'], 's': p['s'], 'd': p['d']} for p in sc['pieces']], 't': b64(vals)}
    # ---- splash
    n2 = sp['frames']; ps2 = max(abs(v) for dr in sp['drops'] for q in dr['p'] for v in q) / 32767
    vals = []
    for f in range(n2):
        for dr in sp['drops']: vals += [q16(v, ps2) for v in dr['p'][f]]
    splash = {'fps': sp['fps'], 'n': n2, 'h': sp['h'], 'ps': ps2, 'count': len(sp['drops']), 'land': [dr['land'] for dr in sp['drops']], 't': b64(vals)}
    size = len(scatter['t']) + len(splash['t'])
    print('scatter: %d pieces x %d frames, %d bytes base64 (%.2f mm per step)' % (len(sc['pieces']), n, len(scatter['t']), ps * 1000))
    print('splash:  %d drops x %d frames, %d bytes base64 (%.2f mm per step)' % (splash['count'], n2, len(splash['t']), ps2 * 1000))
    print('total %.1f KB base64 (raw %.1f KB) of %d KB' % (size / 1024, size * 3 / 4 / 1024, BUDGET // 1024))
    if size > BUDGET: raise SystemExit('over the FX budget')
    if '--dry' in sys.argv: return
    js = ('/* pre-recorded physics moments simulated in Blender (src/blender/fx_sim.py: Bullet rigid bodies, a particle burst), packed by\n'
          '   src/tools/pack_fx.py. Axes: x = the way things fly, y up, meters. Tracks are Int16 (little-endian), base64:\n'
          '   scatter.t = frames x pieces x [x,y,z (x ps), quaternion x,y,z,w (/32767)], y = 0 on the desk top, the floor "top" below;\n'
          '   splash.t = frames x drops x [x,y,z (x ps)], y = 0 at the burst, the floor "h" below; land = the frame each drop lands. */\n'
          'const FX_DATA=' + json.dumps({'v': 1, 'scatter': scatter, 'splash': splash}, separators=(',', ':')) + ';\n')
    open(OUT, 'w', encoding='utf-8', newline='\n').write(js)
    print('wrote %s (%.1f KB)' % (OUT, len(js) / 1024))


main()
