"""Pack baked lightmaps for the page: <bake dir>/<key>/{lm-floor,lm-atlas}.png + bake.json -> src/assets/bake/
<key>-floor-<hash>.avif, <key>-atlas-<hash>.avif and the table in src/js/bake-data.js

usage: python -I src/tools/bake/pack_bakes.py <bake dir> [--webp] [--q 62] [--qa 55] [--max-atlas 1536]
  --q floor quality, --qa atlas quality; atlases bigger than --max-atlas are scaled down (their UVs are 0..1, and
  bake_world.py pads every rectangle by 3 px, which leaves more than 2 px at 1536).
Images are AVIF by default (about 40% smaller than WebP for these smooth images); a browser that can't decode them simply
keeps realtime Studio light. The page loads a world's two images when the world is entered (src/build.py --inline-bakes
puts them in the page instead). Each file is named after a hash of its bytes, so a page and its images can't come from
different bakes through a browser or CDN cache. The table names exactly the worlds in <bake dir>.
Nothing on disk changes unless every image encodes; then the new files go in, the table is replaced, and images the new
table doesn't name are removed. Needs Pillow.
"""
import os, sys, json, io, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_JS = os.path.join(HERE, '..', '..', 'js', 'bake-data.js')
OUT_DIR = os.path.join(HERE, '..', '..', 'assets', 'bake')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
DIR = args[0]
WEBP = '--webp' in sys.argv
arg = lambda n, d: int(sys.argv[sys.argv.index(n) + 1]) if n in sys.argv else d
Q, QA, MAXA = arg('--q', 80 if WEBP else 62), arg('--qa', 72 if WEBP else 55), arg('--max-atlas', 1536)


def encode(path, stem, q, cap=0):
    from PIL import Image
    im = Image.open(path).convert('RGB'); b = io.BytesIO()
    if cap and im.size[0] > cap: im = im.resize((cap, round(im.size[1] * cap / im.size[0])), Image.LANCZOS)
    if WEBP: im.save(b, 'WEBP', quality=q, method=6)
    else: im.save(b, 'AVIF', quality=q, speed=4)
    raw = b.getvalue()
    return '%s-%s%s' % (stem, hashlib.sha256(raw).hexdigest()[:10], '.webp' if WEBP else '.avif'), raw


# 1. encode everything in memory
bakes, out, total = {}, [], 0
for key in sorted(os.listdir(DIR)):
    d = os.path.join(DIR, key); mp = os.path.join(d, 'bake.json')
    if not os.path.isdir(d) or not os.path.exists(mp): continue
    m = json.load(open(mp))
    rec = {'h': m['hash'], 'K': m['K'], 'd': m['d']}
    rec['f'], raw = encode(os.path.join(d, 'lm-floor.png'), key + '-floor', Q); out.append((rec['f'], raw)); nf = len(raw)
    na = 0
    if os.path.exists(os.path.join(d, 'lm-atlas.png')) and m.get('S'):
        rec['a'], raw = encode(os.path.join(d, 'lm-atlas.png'), key + '-atlas', QA, MAXA); out.append((rec['a'], raw)); na = len(raw)
    if m.get('hemi'): rec['hemi'] = m['hemi']
    if m.get('exp'): rec['exp'] = m['exp']
    if m.get('gain'): rec['g'] = m['gain']
    bakes[key] = rec; total += nf + na
    print('%-7s floor %4d KB  atlas %4d KB  K %.1f  hash %s' % (key, nf // 1024, na // 1024, m['K'], m['hash']))
src = ('/* baked lightmaps per world, made in Blender from the game\'s own geometry (src/tools/bake/: capture.mjs ->\n'
       '   bake_world.py -> pack_bakes.py). h: hash of the static geometry they were baked for; K: light scale; d: atlas\n'
       '   packing density; f/a: floor and atlas lightmap files in BAKE_DIR (loaded when a world is entered); hemi/exp: light for moving things and exposure indoors. */\n'
       'const BAKE_DIR="src/assets/bake/";\n'
       'const BAKES=' + json.dumps(bakes, separators=(',', ':')) + ';\n')

# 2. write: new images, then the table, then drop the images it no longer names
os.makedirs(OUT_DIR, exist_ok=True)
for name, raw in out:
    p = os.path.join(OUT_DIR, name)
    open(p + '.tmp', 'wb').write(raw); os.replace(p + '.tmp', p)
open(OUT_JS + '.tmp', 'w', encoding='utf-8', newline='\n').write(src); os.replace(OUT_JS + '.tmp', OUT_JS)
keep = {name for name, _ in out}
for f in os.listdir(OUT_DIR):
    if f.endswith(('.avif', '.webp')) and f not in keep: os.remove(os.path.join(OUT_DIR, f))
print('wrote src/js/bake-data.js (%d worlds) and src/assets/bake/: images %d KB' % (len(bakes), total // 1024))
