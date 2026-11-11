"""Pack baked lightmaps into the page: <bake dir>/<key>/{lm-floor,lm-atlas}.png + bake.json -> src/js/bake-data.js

usage: python -I src/tools/bake/pack_bakes.py <bake dir> [--webp] [--q 62] [--qa 55] [--max-atlas 1536]
  --q floor quality, --qa atlas quality; atlases bigger than --max-atlas are scaled down (their UVs are 0..1, and
  bake_world.py pads every rectangle by 3 px, which leaves more than 2 px at 1536).
Images go in as AVIF data URLs by default (about 40% smaller than WebP for these smooth images); a browser that can't
decode them simply keeps realtime Studio light. Needs Pillow.
"""
import os, sys, json, base64, io
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JS = os.path.join(HERE, '..', '..', 'js', 'bake-data.js')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DIR = args[0]
WEBP = '--webp' in sys.argv
arg = lambda n, d: int(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
Q, QA, MAXA = arg('--q', 80 if WEBP else 62), arg('--qa', 72 if WEBP else 55), arg('--max-atlas', 1536)


def data_url(path, q, cap=0):
    im = Image.open(path).convert('RGB'); b = io.BytesIO()
    if cap and im.size[0] > cap: im = im.resize((cap, round(im.size[1] * cap / im.size[0])), Image.LANCZOS)
    if WEBP: im.save(b, 'WEBP', quality=q, method=6); mime = 'image/webp'
    else: im.save(b, 'AVIF', quality=q, speed=4); mime = 'image/avif'
    raw = b.getvalue()
    return 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode()), len(raw)


bakes, total = {}, 0
for key in sorted(os.listdir(DIR)):
    d = os.path.join(DIR, key); mp = os.path.join(d, 'bake.json')
    if not os.path.isdir(d) or not os.path.exists(mp): continue
    m = json.load(open(mp))
    rec = {'h': m['hash'], 'K': m['K'], 'd': m['d']}
    rec['f'], nf = data_url(os.path.join(d, 'lm-floor.png'), Q)
    na = 0
    if os.path.exists(os.path.join(d, 'lm-atlas.png')) and m.get('S'): rec['a'], na = data_url(os.path.join(d, 'lm-atlas.png'), QA, MAXA)
    if m.get('hemi'): rec['hemi'] = m['hemi']
    if m.get('exp'): rec['exp'] = m['exp']
    if m.get('gain'): rec['g'] = m['gain']
    bakes[key] = rec; total += nf + na
    print('%-7s floor %4d KB  atlas %4d KB  K %.1f  hash %s' % (key, nf // 1024, na // 1024, m['K'], m['hash']))
src = ('/* baked lightmaps per world, made in Blender from the game\'s own geometry (src/tools/bake/: capture.mjs ->\n'
       '   bake_world.py -> pack_bakes.py). h: hash of the static geometry they were baked for; K: light scale; d: atlas\n'
       '   packing density; f/a: floor and atlas lightmaps; hemi/exp: light for moving things and exposure indoors. */\n'
       'const BAKES=' + json.dumps(bakes, separators=(',', ':')) + ';\n')
if '</script' in src.lower(): raise SystemExit('bake data would end the inline script')
open(OUT_JS, 'w', encoding='utf-8', newline='\n').write(src)
print('wrote src/js/bake-data.js: %d worlds, images %d KB, file %d KB' % (len(bakes), total // 1024, len(src) // 1024))
