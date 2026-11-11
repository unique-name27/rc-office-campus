"""Pack baked lightmaps into the page: <bake dir>/<key>/{lm-floor,lm-atlas}.png + bake.json -> src/js/bake-data.js

usage: python -I src/tools/bake/pack_bakes.py <bake dir> [--webp] [--q 60]
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
Q = int(sys.argv[sys.argv.index('--q') + 1]) if '--q' in sys.argv else (80 if WEBP else 62)


def data_url(path):
    im = Image.open(path).convert('RGB'); b = io.BytesIO()
    if WEBP: im.save(b, 'WEBP', quality=Q, method=6); mime = 'image/webp'
    else: im.save(b, 'AVIF', quality=Q, speed=4); mime = 'image/avif'
    raw = b.getvalue()
    return 'data:%s;base64,%s' % (mime, base64.b64encode(raw).decode()), len(raw)


bakes, total = {}, 0
for key in sorted(os.listdir(DIR)):
    d = os.path.join(DIR, key); mp = os.path.join(d, 'bake.json')
    if not os.path.isdir(d) or not os.path.exists(mp): continue
    m = json.load(open(mp))
    rec = {'h': m['hash'], 'K': m['K'], 'd': m['d']}
    rec['f'], nf = data_url(os.path.join(d, 'lm-floor.png'))
    na = 0
    if os.path.exists(os.path.join(d, 'lm-atlas.png')) and m.get('S'): rec['a'], na = data_url(os.path.join(d, 'lm-atlas.png'))
    if m.get('hemi'): rec['hemi'] = m['hemi']
    if m.get('exp'): rec['exp'] = m['exp']
    bakes[key] = rec; total += nf + na
    print('%-7s floor %4d KB  atlas %4d KB  K %.1f  hash %s' % (key, nf // 1024, na // 1024, m['K'], m['hash']))
src = ('/* baked lightmaps per world, made in Blender from the game\'s own geometry (src/tools/bake/: capture.mjs ->\n'
       '   bake_world.py -> pack_bakes.py). h: hash of the static geometry they were baked for; K: light scale; d: atlas\n'
       '   packing density; f/a: floor and atlas lightmaps; hemi/exp: light for moving things and exposure indoors. */\n'
       'const BAKES=' + json.dumps(bakes, separators=(',', ':')) + ';\n')
if '</script' in src.lower(): raise SystemExit('bake data would end the inline script')
open(OUT_JS, 'w', encoding='utf-8', newline='\n').write(src)
print('wrote src/js/bake-data.js: %d worlds, images %d KB, file %d KB' % (len(bakes), total // 1024, len(src) // 1024))
