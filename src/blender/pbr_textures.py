"""Tileable PBR texture sets for the Studio style, made from procedural shader nodes and baked on the GPU.

usage (Cycles on OptiX only; the script refuses to run on the CPU):
  blender -b --factory-startup -t 4 --python src/blender/pbr_textures.py -- <out dir> [--size 512] [--only concrete,carpet]
then: python -I src/tools/pack_pbr.py <out dir>      (writes src/js/pbr-data.js)

Sets: concrete (polished floor), carpet (loop pile), birch (desk tops), oak (plank floor), metal (brushed steel /
aluminium), terrazzo, tile. Per set it writes <name>_albedo.png (sRGB), <name>_normal.png (tangent space, +Y up, as
three.js wants) and <name>_rough.png (grey), plus sets.json (tile size in meters, average color, suggested values).

How they tile: every Noise / Voronoi texture is 4D and is fed a torus mapping of UV,
  (cos 2 pi u, sin 2 pi u, cos 2 pi v, sin 2 pi v) x radius,
so u and v each run once around a circle and the pattern closes on itself exactly. Stripes, planks, tiles and carpet
loops use whole numbers of periods per tile. Each set is baked twice through an emission shader (EMIT bake: albedo,
then height / roughness packed in R / G); the normal map is made from the height with numpy (wrapping differences, so
it tiles too).
"""
import bpy, sys, os, json, math, time, struct, zlib
import numpy as np

T0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pos = [a for a in argv if not a.startswith('--')]
def opt(name, d):
    if name in argv:
        return type(d)(argv[argv.index(name) + 1])
    return d
OUT = os.path.abspath(pos[0]) if pos else os.path.abspath('pbr-out')
SIZE = opt('--size', 512)
ONLY = [s for s in opt('--only', '').split(',') if s]
os.makedirs(OUT, exist_ok=True)
log = lambda *a: print('[pbr %5.1fs]' % (time.time() - T0), *a, flush=True)
TAU = 2 * math.pi


def gpu_only():
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'
    sc.render.threads_mode = 'FIXED'; sc.render.threads = 4
    p = bpy.context.preferences.addons['cycles'].preferences
    p.compute_device_type = 'OPTIX'; p.refresh_devices()
    gpus = [d for d in p.devices if d.type == 'OPTIX']
    if not gpus: raise SystemExit('no OptiX GPU found: refusing to bake on the CPU')
    for d in p.devices: d.use = d.type == 'OPTIX'
    sc.cycles.device = 'GPU'
    log('devices:', [(d.name, d.type) for d in p.devices if d.use])


def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))
    ck = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ck(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ck(b'IDAT', zlib.compress(raw, 9)) + ck(b'IEND', b''))


def srgb2lin(c):
    c = np.asarray(c, float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lin2srgb(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= .0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - .055)
def hexlin(h):
    return tuple(float(v) for v in srgb2lin([int(h[i:i + 2], 16) for i in (1, 3, 5)]))


# ---------------------------------------------------------------- a small node-expression helper ---------------------
NT = None   # the node tree being built

class X:
    """a float (or color / vector) socket; arithmetic builds Math nodes"""
    def __init__(self, s): self.s = s
    def __add__(a, b): return m('ADD', a, b)
    def __radd__(a, b): return m('ADD', b, a)
    def __sub__(a, b): return m('SUBTRACT', a, b)
    def __rsub__(a, b): return m('SUBTRACT', b, a)
    def __mul__(a, b): return m('MULTIPLY', a, b)
    def __rmul__(a, b): return m('MULTIPLY', b, a)
    def __truediv__(a, b): return m('DIVIDE', a, b)
    def __neg__(a): return m('MULTIPLY', a, -1.0)

def put(v, inp):
    if isinstance(v, X): NT.links.new(v.s, inp)
    elif isinstance(v, (tuple, list)):
        inp.default_value = tuple(v) + ((1.0,) if len(v) == 3 and len(inp.default_value) == 4 else ())
    else: inp.default_value = v

def m(op, a, b=None, c=None, clamp=False):
    n = NT.nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
    put(a, n.inputs[0])
    if b is not None: put(b, n.inputs[1])
    if c is not None: put(c, n.inputs[2])
    return X(n.outputs[0])

sin = lambda a: m('SINE', a)
cos = lambda a: m('COSINE', a)
fract = lambda a: m('FRACT', a)
floor = lambda a: m('FLOOR', a)
absv = lambda a: m('ABSOLUTE', a)
vmin = lambda a, b: m('MINIMUM', a, b)
vmax = lambda a, b: m('MAXIMUM', a, b)
power = lambda a, b: m('POWER', a, b)
sat = lambda a: m('ADD', a, 0.0, clamp=True)

def smooth(e0, e1, x):
    """smoothstep(e0, e1, x), clamped; e0 > e1 gives the falling edge"""
    n = NT.nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP'
    put(x, n.inputs[0]); put(e0, n.inputs[1]); put(e1, n.inputs[2]); n.inputs[3].default_value = 0; n.inputs[4].default_value = 1
    return X(n.outputs[0])

def lerp(t, a, b): return a + (b - a) * t if isinstance(a, X) or isinstance(b, X) else a + (b - a) * t

def mixc(t, a, b):
    """color a -> b by t (colors: linear rgb tuples or X)"""
    n = NT.nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.clamp_factor = True
    put(t, n.inputs[0]); put(a, n.inputs[6]); put(b, n.inputs[7])
    return X(n.outputs[2])

def scalec(c, k):
    """color x scalar"""
    n = NT.nodes.new('ShaderNodeVectorMath'); n.operation = 'SCALE'
    put(c, n.inputs[0]); put(k, n.inputs['Scale'])
    return X(n.outputs[0])

def combine(x, y, z):
    n = NT.nodes.new('ShaderNodeCombineXYZ'); put(x, n.inputs[0]); put(y, n.inputs[1]); put(z, n.inputs[2])
    return X(n.outputs[0])

def uv():
    tc = NT.nodes.new('ShaderNodeTexCoord'); sp = NT.nodes.new('ShaderNodeSeparateXYZ')
    NT.links.new(tc.outputs['UV'], sp.inputs[0])
    return X(sp.outputs[0]), X(sp.outputs[1])

def torus(u, v, nu, nv, seed):
    """4D point for (u, v): u and v each go once around a circle whose circumference is nu (nv) noise units"""
    ru, rv = nu / TAU, nv / TAU
    a, b = u * TAU, v * TAU
    return combine(cos(a) * ru + (seed * 17.13 + 3.1), sin(a) * ru + (seed * 5.77 - 8.2), cos(b) * rv + (seed * 9.31 + 1.7)), sin(b) * rv + (seed * 3.39 - 4.4)

def noise(u, v, nu, nv=None, detail=2.0, rough=.5, seed=0):
    """tileable fractal noise, about nu x nv blobs per tile; 0..1, centered on .5"""
    vec, w = torus(u, v, nu, nv or nu, seed)
    n = NT.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '4D'
    put(vec, n.inputs['Vector']); put(w, n.inputs['W'])
    n.inputs['Scale'].default_value = 1; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    return X(n.outputs[0])

def voronoi(u, v, nu, nv=None, seed=0, feature='F1', randomness=1.0):
    """tileable cells, about nu x nv per tile: (distance, random color per cell)"""
    vec, w = torus(u, v, nu, nv or nu, seed)
    n = NT.nodes.new('ShaderNodeTexVoronoi'); n.voronoi_dimensions = '4D'; n.feature = feature
    put(vec, n.inputs['Vector']); put(w, n.inputs['W']); n.inputs['Scale'].default_value = 1; n.inputs['Randomness'].default_value = randomness
    col = NT.nodes.new('ShaderNodeSeparateXYZ'); NT.links.new(n.outputs['Color'], col.inputs[0])
    return X(n.outputs['Distance']), X(col.outputs[0]), X(col.outputs[1])

def edge(x):
    """distance (0...5) of a 0..1 coordinate from the nearest tile edge"""
    return vmin(x, 1.0 - x)


# ---------------------------------------------------------------- the sets ---------------------------------------------
# every set returns (albedo color X, height X in 0..1, roughness X); 'bump' is the relief depth in mm that the height's
# 0..1 stands for (exaggerated on purpose where the real relief would be invisible), 'meters' the tile's real size.
def concrete():
    u, v = uv()
    big = noise(u, v, 3, detail=3, rough=.55, seed=1)             # slow mottling
    mid = noise(u, v, 9, detail=4, rough=.6, seed=2)              # trowel clouds
    grit = noise(u, v, 110, detail=1, rough=.5, seed=3)           # fine sand
    d, r1, _ = voronoi(u, v, 46, seed=4)                           # sparse aggregate specks
    speck = smooth(.16, .07, d) * smooth(.72, .9, r1)
    pit = smooth(.10, .04, d) * smooth(.12, .03, r1)               # a few small pores
    cut = smooth(.0032, .0012, vmin(edge(u), edge(v)))             # saw cut along the tile edge (every 3 m, 5 mm)
    base = mixc(smooth(.3, .7, big), hexlin('#B4AEA1'), hexlin('#C5BFB2'))
    tone = 1.0 + (mid - .5) * .16 + (grit - .5) * .07 + speck * .07 - pit * .22 - cut * .3
    height = sat(.6 + (mid - .5) * .25 + (grit - .5) * .12 - pit * .5 - cut * .6)
    rough = sat(.5 + (mid - .5) * .34 + (big - .5) * .14 + (grit - .5) * .06 + pit * .3 + cut * .35)
    return scalec(base, tone), height, rough

def carpet():
    u, v = uv()
    N, M = 44, 60                                                   # loops along a row, rows per tile
    row = floor(v * M); vq = (row + .5) / M; vl = fract(v * M)
    ph = noise(u * 0.0, vq, 1, 41, detail=0, seed=6)                # every row starts somewhere else
    loop = power(cos((u * N + ph * 4.0) * TAU) * .5 + .5, .6) * power(sin(vl * math.pi), .7)
    fib = noise(u, v, 150, detail=1, seed=1)                        # fibers
    tuft = noise(u, v, 34, detail=2, seed=2)                        # loop-to-loop variation
    slow = noise(u, v, 5, detail=2, seed=3)                         # traffic / pile lean, very faint
    fleck = smooth(.62, .78, noise(u, v, 90, detail=0, seed=4))     # heather flecks
    tone = .72 + loop * .28 + (fib - .5) * .18 + (tuft - .5) * .20 + (slow - .5) * .05
    col = mixc(fleck * .5, (1.0, 1.0, 1.0), (.80, .82, .86))
    col = mixc(smooth(.6, .8, noise(u, v, 80, detail=0, seed=5)) * .35, col, (.98, .93, .86))
    height = sat(loop * .7 + (tuft - .5) * .35 + (fib - .5) * .25 + .15)
    rough = sat(.95 + (fib - .5) * .06)
    return scalec(col, tone), height, rough

def birch():
    u, v = uv()                                                     # grain runs along u
    warp = noise(u, v, 1, 2.5, detail=1, seed=1)
    band = sin((v * 5.0 + (warp - .5) * 1.3) * TAU) * .5 + .5        # growth bands, 5 across the tile
    streak = noise(u, v, 2.5, 70, detail=2, rough=.6, seed=2)       # long fine streaks
    pore = smooth(.62, .8, noise(u, v, 14, 260, detail=0, seed=3))  # short dark pores
    sheen = noise(u, v, 2, 3, detail=1, seed=4)                     # figure
    base = mixc(smooth(.1, .9, band * .45 + streak * .55), hexlin('#DECCAB'), hexlin('#D3BF9B'))
    base = mixc((sheen - .5) * .5 + .5, base, scalec(base, 1.06))
    tone = 1.0 + (streak - .5) * .12 - pore * .10
    height = sat(.6 + (streak - .5) * .3 - pore * .45)
    rough = sat(.46 + (streak - .5) * .14 + pore * .16 + (sheen - .5) * .08)
    return scalec(base, tone), height, rough

def oak():
    u, v = uv()                                                     # 8 planks across v, running along u
    P = 8
    row = floor(v * P); vq = (row + .5) / P; vl = fract(v * P)       # plank index, its center, 0..1 across the plank
    rnd1 = noise(u * 0.0, vq, 1, 23, detail=0, seed=1)               # per plank: tone
    rnd2 = noise(u * 0.0, vq, 1, 31, detail=0, seed=2)               # per plank: where its end joint sits
    us = u + rnd2 * 5.0                                               # slide each plank along its length
    warp = noise(us, v, 1.5, 10, detail=2, seed=3)
    ring = sin((vl * 2.2 + (warp - .5) * 2.2 + rnd1 * 4.0) * TAU) * .5 + .5   # cathedral grain inside the plank
    streak = noise(us, v, 3, 120, detail=2, rough=.6, seed=4)
    pore = smooth(.6, .78, noise(us, v, 22, 300, detail=0, seed=5))
    seam = smooth(.024, .008, edge(vl))                              # long joints between planks
    butt = smooth(.0035, .0012, edge(fract(us)))                     # one end joint per plank
    gap = vmax(seam, butt)
    base = mixc(smooth(.1, .9, ring * .45 + streak * .55), hexlin('#B4946E'), hexlin('#9A7B58'))
    tone = (1.0 + (smooth(.3, .7, rnd1) - .5) * .26 + (streak - .5) * .14 - pore * .12) * (1.0 - gap * .5)
    height = sat(.7 + (streak - .5) * .2 - pore * .3 - gap * .7)
    rough = sat(.5 + (streak - .5) * .16 + pore * .14 + gap * .3 + (rnd1 - .5) * .1)
    return scalec(base, tone), height, rough

def metal():
    u, v = uv()                                                     # brushed along u
    fine = noise(u, v, 1.2, 230, detail=1, rough=.6, seed=1)
    mid = noise(u, v, 2.5, 60, detail=2, rough=.6, seed=2)
    slow = noise(u, v, 2, 3, detail=1, seed=3)
    scr = smooth(.80, .86, noise(u, v, 5, 150, detail=0, seed=4))   # a few brighter hairlines
    tone = .90 + (fine - .5) * .10 + (mid - .5) * .08 + (slow - .5) * .04 + scr * .03
    height = sat(.5 + (fine - .5) * .7 + (mid - .5) * .4 - scr * .2)
    rough = sat(.30 + (fine - .5) * .16 + (mid - .5) * .12 + (slow - .5) * .08 - scr * .05)
    return scalec((1.0, 1.0, 1.0), tone), height, rough

def terrazzo():
    u, v = uv()
    pal = [hexlin(h) for h in ('#B9B4AC', '#8D8A86', '#F3F1EC', '#A9A49C')]
    col = mixc((noise(u, v, 4, detail=2, seed=9) - .5) * .5 + .5, hexlin('#D8D4CC'), hexlin('#E0DCD5'))
    chips = None
    for k, (n, lo, hi) in enumerate(((14, .46, .37), (26, .46, .37), (50, .44, .34))):
        d, r1, r2 = voronoi(u, v, n, seed=10 + k, randomness=1.0)
        wob = (noise(u, v, n * 2.5, detail=1, seed=20 + k) - .5) * .16       # ragged chip outlines
        size = .55 + r2 * .45                                               # every chip its own size, some none
        chip = smooth(lo * 1.0, hi * 1.0, (d + wob) / size) * smooth(.12, .2, r2)
        c = mixc(smooth(.24, .26, r1), pal[0], pal[1]); c = mixc(smooth(.49, .51, r1), c, pal[2]); c = mixc(smooth(.74, .76, r1), c, pal[3])
        c = mixc(smooth(.955, .965, r1), c, hexlin('#B87333'))             # the odd copper-colored chip
        col = mixc(chip, col, c)
        chips = chip if chips is None else vmax(chips, chip)
    grit = noise(u, v, 120, detail=1, seed=30)
    tone = 1.0 + (grit - .5) * .05
    height = sat(.5 + chips * .12 + (grit - .5) * .1)
    rough = sat(.33 - chips * .08 + (noise(u, v, 6, detail=3, seed=31) - .5) * .2)
    return scalec(col, tone), height, rough

def tile():
    u, v = uv()
    N = 4                                                           # 4 x 4 tiles
    lu, lv = fract(u * N), fract(v * N)
    uq, vq = (floor(u * N) + .5) / N, (floor(v * N) + .5) / N
    rnd = noise(uq, vq, 9, detail=0, seed=1)                         # per tile tone
    e = vmin(edge(lu), edge(lv))
    grout = smooth(.013, .007, e)
    bevel = smooth(.007, .03, e)                                     # pillowed edge
    cloud = noise(u, v, 7, detail=3, seed=2)
    grit = noise(u, v, 130, detail=1, seed=3)
    face = scalec(hexlin('#ECEAE5'), 1.0 + (smooth(.3, .7, rnd) - .5) * .05 + (cloud - .5) * .04 + (grit - .5) * .02)
    col = mixc(grout, face, scalec(hexlin('#A8A39A'), 1.0 + (grit - .5) * .2))
    height = sat(bevel * .85 + (grit - .5) * .06 * (1.0 - grout) + .08 + grout * (grit - .5) * .1)
    rough = sat(.36 + (cloud - .5) * .16 + grout * .5)
    return col, height, rough

# name: (builder, tile size in meters, relief in mm for the normal map (exaggerated: a true polished floor would give a
# flat map), notes for whoever wires it)
SETS = {
    'concrete': (concrete, 3.0, 12.0, 'polished concrete floor, true color (use a white material color)'),
    'carpet': (carpet, 0.6, 1.7, 'loop-pile carpet, near-white so the material color tints it'),
    'birch': (birch, 1.2, 2.5, 'birch desk tops, true color; grain along u'),
    'oak': (oak, 1.6, 2.5, 'oak plank floor (8 planks per tile, along u), true color'),
    'metal': (metal, 0.5, 0.8, 'brushed steel / aluminium, near-white so the material color tints it; brushed along u; metalness 1'),
    'terrazzo': (terrazzo, 1.5, 3.0, 'polished terrazzo, true color'),
    'tile': (tile, 1.2, 2.0, 'floor tile, 4 x 4 tiles of 30 cm per repeat, true color'),
}


# ---------------------------------------------------------------- bake -------------------------------------------------
def img_array(img):
    w, h = img.size; a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[:, :, :3].copy()          # bottom row first (v up)

def bake_set(name, plane):
    global NT
    fn, meters, bump, note = SETS[name]
    mat = bpy.data.materials.new(name); mat.use_nodes = True; NT = mat.node_tree   # (use_nodes: still needed before Blender 6)
    for n in list(NT.nodes): NT.nodes.remove(n)
    out = NT.nodes.new('ShaderNodeOutputMaterial'); em = NT.nodes.new('ShaderNodeEmission')
    NT.links.new(em.outputs[0], out.inputs['Surface'])
    albedo, height, rough = fn()
    data = combine(height, rough, 0.0)
    plane.data.materials.clear(); plane.data.materials.append(mat)
    res = []
    for tag, val in (('albedo', albedo), ('data', data)):
        for l in list(em.inputs['Color'].links): NT.links.remove(l)
        put(val, em.inputs['Color'])
        img = bpy.data.images.new('%s_%s' % (name, tag), SIZE, SIZE, float_buffer=True, alpha=False)
        tn = NT.nodes.new('ShaderNodeTexImage'); tn.image = img
        for n in NT.nodes: n.select = False
        tn.select = True; NT.nodes.active = tn
        bpy.ops.object.bake(type='EMIT', margin=0, use_clear=True, target='IMAGE_TEXTURES')
        res.append(img_array(img)); NT.nodes.remove(tn); bpy.data.images.remove(img)
    alb, dat = res
    h, rg = dat[:, :, 0].astype(np.float64), dat[:, :, 1]
    # tangent-space normal from the height (wrapping central differences: the map tiles like the height does)
    k = (bump / 1000.0) / meters * SIZE                 # height units -> slope per pixel
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5 * k
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5 * k    # rows run bottom to top here, so this is d/dv
    nrm = np.stack([-dx, -dy, np.ones_like(h)], 2); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    rng = np.random.default_rng(7)
    q = lambda a: np.clip(np.floor(a * 255 + rng.random(a.shape) * .999), 0, 255).astype(np.uint8)[::-1]   # dithered, top row first
    write_png(os.path.join(OUT, name + '_albedo.png'), q(lin2srgb(alb)))
    write_png(os.path.join(OUT, name + '_normal.png'), q(nrm * .5 + .5))
    write_png(os.path.join(OUT, name + '_rough.png'), q(np.repeat(rg[:, :, None], 3, 2)))
    avg = lin2srgb(alb.reshape(-1, 3).mean(0))
    slope = np.degrees(np.arctan(np.hypot(dx, dy)))
    info = {'meters': meters, 'bumpMm': bump, 'note': note, 'avg': '#' + ''.join('%02X' % round(float(c) * 255) for c in avg),
            'rough': [round(float(rg.mean()), 3), round(float(rg.min()), 3), round(float(rg.max()), 3)],
            'slopeDeg': [round(float(slope.mean()), 2), round(float(np.percentile(slope, 99)), 2)],
            'height': [round(float(h.min()), 3), round(float(h.max()), 3)]}
    log(name, info)
    return info


def main():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.mesh.primitive_plane_add(size=2)            # comes with a 0..1 UV map
    plane = bpy.context.active_object
    gpu_only()
    sc = bpy.context.scene; sc.cycles.samples = 4; sc.cycles.use_denoising = False; sc.cycles.max_bounces = 0
    sc.render.bake.margin = 0
    plane.select_set(True); bpy.context.view_layer.objects.active = plane
    meta_path = os.path.join(OUT, 'sets.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    for name in SETS:
        if ONLY and name not in ONLY: continue
        t = time.time(); meta[name] = bake_set(name, plane); meta[name]['size'] = SIZE
        log('%s baked in %.1fs' % (name, time.time() - t))
    json.dump(meta, open(meta_path, 'w'), indent=1)
    log('done')

main()
