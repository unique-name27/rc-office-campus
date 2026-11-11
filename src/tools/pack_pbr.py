"""Pack the Blender-baked PBR texture sets into src/js/pbr-data.js (const PBR_DATA + function pbrSet), so the page
needs no image files.

usage: python -I src/tools/pack_pbr.py <dir written by src/blender/pbr_textures.py> [--dry]

Reads <name>_albedo.png, <name>_normal.png, <name>_rough.png and sets.json, scales each map to the size in PLAN,
encodes it as WebP (Pillow) and writes base64. Budget: all maps together at most 200 KB before base64.
"""
import base64, io, json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'js', 'pbr-data.js'))
BUDGET = 200 * 1024

# name: (albedo px, quality), (normal px, quality), (roughness px, quality), suggested normalScale, metalness
PLAN = {
    'concrete': ((512, 90), (512, 88), (256, 85), .6, 0),
    'carpet':   ((512, 78), (256, 80), (32, 50), .8, 0),
    'birch':    ((512, 90), (256, 88), (256, 85), .5, 0),
    'oak':      ((512, 88), (512, 86), (256, 85), .7, 0),
    'metal':    ((256, 90), (256, 90), (256, 88), .5, 1),
    'terrazzo': ((512, 80), (256, 80), (256, 80), .3, 0),
    'tile':     ((256, 90), (256, 88), (256, 85), .8, 0),
}


# near-white sets are tinted by the material color: the color that lands them on today's finish (others: white)
TARGET = {'carpet': '#A29E97', 'metal': '#AEB3B8'}
def lin(h): return [((int(h[i:i + 2], 16) / 255 + .055) / 1.055) ** 2.4 if int(h[i:i + 2], 16) / 255 > .04045 else int(h[i:i + 2], 16) / 255 / 12.92 for i in (1, 3, 5)]
def tint(target, avg):
    out = []
    for t, a in zip(lin(target), lin(avg)):
        v = min(1.0, t / a); out.append(round((1.055 * v ** (1 / 2.4) - .055 if v > .0031308 else v * 12.92) * 255))
    return '#%02X%02X%02X' % tuple(out)


def webp(img, size, q, grey=False):
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)
    if grey: img = img.convert('L').convert('RGB')
    b = io.BytesIO(); img.save(b, 'WEBP', quality=q, method=6)
    return b.getvalue()


def renorm(img, size):
    """scale a normal map, then make every texel a unit vector again"""
    if img.size[0] == size: return img
    img = img.resize((size, size), Image.LANCZOS); px = img.load()
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]; nx, ny, nz = r / 127.5 - 1, g / 127.5 - 1, b / 127.5 - 1
            l = (nx * nx + ny * ny + nz * nz) ** .5 or 1
            px[x, y] = (round((nx / l + 1) * 127.5), round((ny / l + 1) * 127.5), round((nz / l + 1) * 127.5))
    return img


JS_HELPER = r'''
// pbrSet(name, spanW, spanD): the set's THREE textures, built once and kept (SHARED: world rebuilds never dispose them).
//   spanW / spanD: meters covered by the surface's 0..1 UVs (a floor area's w and d); the textures then repeat every
//   set.meters. Leave them out for repeat 1 (surfaces whose UVs are already in tiles).
// Returns {map, normalMap, roughnessMap, meters, normalScale, metalness, avg, tint} or null (tint: the material color that
// gives today's finish; white for the true-color sets, a grey for carpet and metal, which any other color may replace). The images decode a moment after
// the first call: until then each texture is one texel of the set's average, so nothing flashes black.
// Wiring: new THREE.MeshStandardMaterial({color:'#FFFFFF' (or a tint, see PBR_DATA.sets[name].tint), map, normalMap,
//   normalScale:new THREE.Vector2(s,s), roughnessMap, roughness:1, metalness}): three multiplies roughness by the map.
const PBR_CACHE={},PBR_IMG={};
function pbrSet(name,spanW,spanD){
  const d=PBR_DATA&&PBR_DATA.sets[name];if(!d)return null;
  const ru=spanW>0?Math.round(spanW/d.meters*1000)/1000:1,rv=spanD>0?Math.round(spanD/d.meters*1000)/1000:1,key=name+"|"+ru+"|"+rv;
  if(PBR_CACHE[key])return PBR_CACHE[key];
  const aniso=renderer.capabilities.getMaxAnisotropy();
  const one=(k,fill,srgb)=>{
    const id=name+"."+k,src=PBR_IMG[id]||(PBR_IMG[id]={source:null,users:[]});
    let t;
    if(src.source){t=new THREE.Texture();t.source=src.source} // one decoded image (and one GPU texture) for every repeat
    else{
      const c=document.createElement("canvas");c.width=c.height=1;const g=c.getContext("2d");g.fillStyle=fill;g.fillRect(0,0,1,1);t=new THREE.Texture(c);
      src.users.push(t);
      if(!src.loading){src.loading=true;const im=new Image();
        im.onload=()=>{src.source=new THREE.Source(im);for(const u of src.users){u.dispose();u.source=src.source;u.needsUpdate=true}src.users.length=0};
        im.src="data:image/webp;base64,"+d[k]}
    }
    t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(ru,rv);t.anisotropy=aniso;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;SHARED.add(t);return t;
  };
  const gr=Math.round(d.rough*255);
  return PBR_CACHE[key]={map:one("a",d.avg,true),normalMap:one("n","#8080FF",false),roughnessMap:one("r","rgb("+gr+","+gr+","+gr+")",false),
    meters:d.meters,normalScale:d.normalScale,metalness:d.metal,avg:d.avg,tint:d.tint};
}
'''.strip('\n')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: raise SystemExit(__doc__)
    src = args[0]; meta = json.load(open(os.path.join(src, 'sets.json')))
    sets, total = {}, 0
    print('%-9s %9s %9s %9s %8s' % ('set', 'albedo', 'normal', 'rough', 'sum'))
    for name, ((asz, aq), (nsz, nq), (rsz, rq), ns, metal) in PLAN.items():
        m = meta[name]
        a = webp(Image.open(os.path.join(src, name + '_albedo.png')).convert('RGB'), asz, aq)
        n = webp(renorm(Image.open(os.path.join(src, name + '_normal.png')).convert('RGB'), nsz), nsz, nq)
        r = webp(Image.open(os.path.join(src, name + '_rough.png')).convert('RGB'), rsz, rq, grey=True)
        s = len(a) + len(n) + len(r); total += s
        print('%-9s %4d %4d %4d %4d %4d %4d %8d' % (name, asz, len(a), nsz, len(n), rsz, len(r), s))
        e = lambda b: base64.b64encode(b).decode()
        sets[name] = {'meters': m['meters'], 'avg': m['avg'], 'rough': m['rough'][0], 'metal': metal, 'normalScale': ns, 'tint': tint(TARGET[name], m['avg']) if name in TARGET else '#FFFFFF', 'note': m['note'],
                      'px': [asz, nsz, rsz], 'a': e(a), 'n': e(n), 'r': e(r)}
    print('total %d bytes (%.1f KB) of %d KB; base64 %.1f KB' % (total, total / 1024, BUDGET // 1024, total * 4 / 3 / 1024))
    if total > BUDGET: raise SystemExit('over the PBR budget')
    if '--dry' in sys.argv: return
    js = ('/* PBR texture sets made in Blender (src/blender/pbr_textures.py: procedural nodes on a torus mapping so they tile, baked on\n'
          '   the GPU), packed by src/tools/pack_pbr.py. a = albedo (sRGB), n = tangent-space normal, r = roughness (grey); WebP, base64.\n'
          '   meters = real size of one repeat; avg = the albedo\'s average color; rough = the roughness map\'s average. */\n'
          'const PBR_DATA=' + json.dumps({'v': 1, 'sets': sets}, separators=(',', ':')) + ';\n' + JS_HELPER + '\n')
    open(OUT, 'w', encoding='utf-8', newline='\n').write(js)
    print('wrote %s (%.1f KB)' % (OUT, len(js) / 1024))


main()
