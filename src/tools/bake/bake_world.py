"""Bake one world's lightmaps from a game capture (src/tools/bake/capture.mjs). Cycles on the GPU only (OptiX).

usage:
  blender -b --factory-startup -t 4 --python src/tools/bake/bake_world.py -- <capture.json> <out dir> [--samples 160]
      [--reencode]   redo the denoise and encoding from the saved EXRs (no Cycles)
Writes <out dir>/<key>/: lm-floor.png, lm-atlas.png (8-bit sRGB of light/K, dithered), lm-*.exr (raw light, half
float) and bake.json (K, hash, packing density, the light for moving things, exposure). src/tools/bake/pack_bakes.py
encodes them as AVIF files in src/assets/bake/ and writes their table to src/js/bake-data.js.

Light (indoors): the sun on the game's compass bearing but 28 degrees up (a morning sun that reaches into the room), a
sky, a grid of soft 0.6 x 1.2 m ceiling panels plus one in any closed room the grid misses, and a white ceiling that
exists only here (the game draws floors without one). Outdoors: exactly the game's Studio sun and a soft sky, so the
baked ground shadows line up with the realtime light on everything else.
Cycles' DIFFUSE bake with direct + indirect light and no color is irradiance / pi; the game multiplies by pi * K.
"""
import bpy, sys, os, json, math, time, base64, struct, zlib
import numpy as np
from mathutils import Vector

T0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pos = [a for a in argv if not a.startswith('--')]
def opt(name, d):
    return type(d)(argv[argv.index(name) + 1]) if name in argv else d
C = json.load(open(pos[0], encoding='utf-8'))
KEY, KIND, H = C['key'], C['kind'], C['H']
OUT = os.path.join(os.path.abspath(pos[1]), KEY); os.makedirs(OUT, exist_ok=True)
SAMPLES = opt('--samples', 160)
INDOOR = KIND != 'campus'
PANEL_W, SUN_I, SUN_ELEV, SKY = (14.0, 10.0, 28.0, 0.8) if INDOOR else (0.0, 2.8, -1.0, 1.0)   # outdoors the sky stands in for Studio's strong image-based light
PAD = C['atlas']['pad']
log = lambda *a: print('[%s %5.1fs]' % (KEY, time.time() - T0), *a, flush=True)


def srgb2lin(h):
    c = np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255
    return tuple(float(v) for v in np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4))
f32 = lambda b: np.frombuffer(base64.b64decode(b), dtype=np.float32)


# ---------------------------------------------------------------- scene from the capture --------------------------
def tri_mesh(name, part, uv=None, target=None):
    n = part['n']
    if not n: return None
    p = f32(part['p']).reshape(-1, 3)
    verts = np.stack([p[:, 0], -p[:, 2], p[:, 1]], 1)                    # game (x, y, z) -> Blender (x, -z, y)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(n)])
    if uv is not None:
        uvl = me.uv_layers.new(name='lightmap'); u = uv.copy(); u[:, 1] = 1 - u[:, 1]   # the game reads rows top-first
        uvl.data.foreach_set('uv', u.ravel())
    col = f32(part['c']).reshape(-1, 3)
    ca = me.color_attributes.new('alb', 'FLOAT_COLOR', 'CORNER')
    ca.data.foreach_set('color', np.repeat(np.concatenate([col, np.ones((n, 1), np.float32)], 1), 3, 0).ravel())
    me.update()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = .8; bsdf.inputs['Metallic'].default_value = 0.0   # irradiance only: all diffuse
    a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'alb'; nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
    if target is not None:
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = target
        for x in nt.nodes: x.select = False
        tn.select = True; nt.nodes.active = tn
    me.materials.append(m)
    return ob

def box(name, x0, x1, y0, y1, z0, z1):
    """a closed box in game coordinates (bake-only geometry)"""
    me = bpy.data.meshes.new(name)
    vs = [(x, -z, y) for y in (y0, y1) for z in (z0, z1) for x in (x0, x1)]
    me.from_pydata(vs, [], [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)])
    me.update(); ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new(name); m.use_nodes = True; m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*srgb2lin('#F2F0EC'), 1)
    me.materials.append(m)

def lights():
    sc = bpy.context.scene
    sd = Vector((C['sunDir'][0], -C['sunDir'][2], C['sunDir'][1])).normalized()
    if SUN_ELEV > 0:
        hz = Vector((sd.x, sd.y, 0)).normalized(); e = math.radians(SUN_ELEV); sd = Vector((hz.x * math.cos(e), hz.y * math.cos(e), math.sin(e)))
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = SUN_I; sun.data.angle = math.radians(2.5 if INDOOR else 1.5); sun.data.color = (1.0, .95, .88)
    sun.rotation_euler = sd.to_track_quat('Z', 'Y').to_euler()
    w = bpy.data.worlds.new('sky'); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (*srgb2lin('#D6E4F5'), 1); bg.inputs['Strength'].default_value = SKY
    if not INDOOR: return 0
    W, D = C['w'], C['d']
    box('ceiling', -W / 2 - .3, W / 2 + .3, H, H + .2, -D / 2 - .3, D / 2 + .3)
    solid = [r for r in C['rooms'] if r['solid']]
    inside = lambda x, z, r, g=0: abs(x - r['x']) < r['w'] / 2 + g and abs(z - r['z']) < r['d'] / 2 + g
    pts, SP = [], 2.4
    nx, nz = int(W // SP), int(D // SP)
    for i in range(nx):
        for j in range(nz):
            x = -W / 2 + (W - (nx - 1) * SP) / 2 + i * SP; z = -D / 2 + (D - (nz - 1) * SP) / 2 + j * SP
            if not any(inside(x, z, r, .35) for r in solid): pts.append((x, z))
    for r in C['rooms']:
        if r['solid'] or r['type'] == 'open': continue
        if not any(inside(x, z, r) for x, z in pts): pts.append((r['x'], r['z']))
    ld = bpy.data.lights.new('panel', 'AREA'); ld.shape = 'RECTANGLE'; ld.size = .6; ld.size_y = 1.2; ld.energy = PANEL_W; ld.color = (1.0, .96, .9)
    for k, (x, z) in enumerate(pts):
        o = bpy.data.objects.new('panel%d' % k, ld); o.location = (x, -z, H - .03); sc.collection.objects.link(o)
    return len(pts)

def gpu_only():
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.render.threads_mode = 'FIXED'; sc.render.threads = 4
    p = bpy.context.preferences.addons['cycles'].preferences
    p.compute_device_type = 'OPTIX'; p.refresh_devices()
    if not [d for d in p.devices if d.type == 'OPTIX']: raise SystemExit('no OptiX GPU found: refusing to bake on the CPU')
    for d in p.devices: d.use = d.type == 'OPTIX'
    sc.cycles.device = 'GPU'
    log('devices:', [(d.name, d.type) for d in p.devices if d.use])


# ---------------------------------------------------------------- encode ------------------------------------------
def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].tobytes() for y in range(h))
    ck = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ck(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ck(b'IDAT', zlib.compress(raw, 9)) + ck(b'IEND', b''))

def img_array(img):
    w, h = img.size; a = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[::-1, :, :3].copy()          # top row first, like the game reads it

def encode(arr, K, path, seed):
    v = np.clip(arr / K, 0, 1)
    s = np.where(v <= .0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - .055)
    q = np.clip(np.floor(s * 255 + np.random.default_rng(seed).random(s.shape) * .999), 0, 255).astype(np.uint8)
    write_png(path, q)

def despeckle(img, ids=None, tol=.45):
    """texels far darker or brighter than the median of their 3 x 3 neighbours (same rectangle only) are sampling noise"""
    h, w, _ = img.shape; lum = img.mean(2); P = np.pad(lum, 1, mode='edge')
    PI = np.pad(ids, 1, mode='constant', constant_values=-2) if ids is not None else None
    nb = []
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            v = P[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
            if PI is not None: v = np.where(PI[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] == ids, v, lum)
            nb.append(v)
    med = np.median(np.stack(nb), 0)
    bad = np.abs(np.log(lum + .02) - np.log(med + .02)) > tol
    out = img.copy(); out[bad] *= ((med[bad] + 1e-4) / (lum[bad] + 1e-4))[:, None]
    return out, int(bad.sum())

def denoise(img, ids=None, radius=3, sigma_s=1.8, sigma_r=.2, passes=2):
    """edge-aware smoothing on log light; with ids it never mixes two atlas rectangles"""
    img, nbad = despeckle(img, ids)
    h, w, _ = img.shape
    for _ in range(passes):
        lum = np.log(np.maximum(img.mean(2), 0) + .02)
        P = np.pad(img, ((radius, radius), (radius, radius), (0, 0)), mode='edge'); PL = np.pad(lum, radius, mode='edge')
        PI = np.pad(ids, radius, mode='constant', constant_values=-2) if ids is not None else None
        acc = np.zeros_like(img); ws = np.zeros((h, w), np.float32)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                sl = (slice(radius + dy, radius + dy + h), slice(radius + dx, radius + dx + w)); d = PL[sl] - lum
                wt = math.exp(-(dx * dx + dy * dy) / (2 * sigma_s ** 2)) * np.exp(-(d * d) / (2 * sigma_r ** 2))
                if PI is not None: wt = wt * (PI[sl] == ids)
                acc += P[sl] * wt[..., None]; ws += wt
        img = (acc / np.maximum(ws, 1e-6)[..., None]).astype(np.float32)
    return img

def save_exr(img, path):
    st = bpy.context.scene.render.image_settings
    st.file_format = 'OPEN_EXR'; st.color_depth = '16'; st.exr_codec = 'ZIP'; st.color_mode = 'RGB'
    img.save_render(path, scene=bpy.context.scene)

def finish(fl, at, meta):
    F = C['floor']; fh, fw = fl.shape[:2]
    # inside the building (indoors) vs the ground around it
    ix0, ix1 = int((-C['w'] / 2 - F['x0']) / F['w'] * fw) + 3, int((C['w'] / 2 - F['x0']) / F['w'] * fw) - 3
    iz0, iz1 = int((-C['d'] / 2 - F['z0']) / F['d'] * fh) + 3, int((C['d'] / 2 - F['z0']) / F['d'] * fh) - 3
    t = time.time(); fl = denoise(fl)
    if at is not None:
        S = at.shape[0]; ids = np.full((S, S), -1, np.int32)
        for k, (x, y, pw, ph) in enumerate(C['atlas']['rects']): ids[max(0, y - PAD):y + ph + PAD, max(0, x - PAD):x + pw + PAD] = k
        at = denoise(at, ids)
    log('denoised in %.1fs' % (time.time() - t))
    lum = fl.mean(2)
    inner = lum[iz0:iz1, ix0:ix1] if INDOOR else lum
    med = float(np.median(inner[inner > .02])) if (inner > .02).any() else .5
    mask = np.ones_like(lum, bool); mask[iz0:iz1, ix0:ix1] = False
    apron = lum[mask] if INDOOR and mask.any() else lum.ravel()
    capv = float(np.percentile(apron, 80))
    if at is not None:
        for blk, val in ((C['atlas']['cap'], capv), (C['atlas']['dark'], 0.0)):
            x, y, w, h = blk[:4]; at[max(0, y - PAD):y + h + PAD, max(0, x - PAD):x + w + PAD] = val
    hi = max(np.percentile(fl, 99.7), np.percentile(at, 99.7) if at is not None else 0)
    K = float(math.ceil(hi * 1.08 * 10) / 10)
    encode(fl, K, os.path.join(OUT, 'lm-floor.png'), 1)
    if at is not None: encode(at, K, os.path.join(OUT, 'lm-atlas.png'), 2)
    meta.update({'K': K, 'medianLight': round(med, 4), 'capLight': round(capv, 4)})
    if INDOOR:
        # moving things: a hemisphere light that gives an up-facing surface the room's typical irradiance (pi x median),
        # the floor's bounce from below; exposure meters the room the way a camera would indoors
        meta['hemi'] = ['#FFF4E6', '#7A746B', round(math.pi * med, 3)]
        meta['exp'] = round(.72 * min(1.6, max(.6, .93 / med)), 3)
    else:
        meta['gain'] = 1.3   # outdoors: Studio's image-based light makes the realtime ground about this much brighter
    log('K', K, 'median', round(med, 3), 'cap', round(capv, 3))


# ---------------------------------------------------------------- main ------------------------------------------------
def main():
    meta_path = os.path.join(OUT, 'bake.json'); has_atlas = C['A']['n'] > 0
    if '--reencode' in argv:
        meta = json.load(open(meta_path))
        fl = img_array(bpy.data.images.load(os.path.join(OUT, 'lm-floor.exr')))
        at = img_array(bpy.data.images.load(os.path.join(OUT, 'lm-atlas.exr'))) if has_atlas else None
        finish(fl, at, meta); json.dump(meta, open(meta_path, 'w'), indent=1); log('re-encoded'); return
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    F = C['floor']
    floor_img = bpy.data.images.new('lm_floor', F['px'][0], F['px'][1], float_buffer=True, alpha=False)
    atlas_img = bpy.data.images.new('lm_atlas', C['atlas']['S'], C['atlas']['S'], float_buffer=True, alpha=False) if has_atlas else None
    fp = f32(C['F']['p']).reshape(-1, 3)
    fuv = np.stack([(fp[:, 0] - F['x0']) / F['w'], (fp[:, 2] - F['z0']) / F['d']], 1).astype(np.float32)
    ground = tri_mesh('ground', C['F'], fuv, floor_img)
    atlas = tri_mesh('atlas', C['A'], f32(C['A']['u']).reshape(-1, 2), atlas_img) if has_atlas else None
    tri_mesh('blockers', C['O'])
    nl = lights()
    log('scene: %d lightmapped, %d ground and %d blocker triangles, %d ceiling panels' % (C['A']['n'], C['F']['n'], C['O']['n'], nl))
    gpu_only()
    sc = bpy.context.scene; cy = sc.cycles
    cy.samples = SAMPLES; cy.max_bounces = 6; cy.diffuse_bounces = 4; cy.glossy_bounces = 2; cy.transmission_bounces = 2
    cy.use_light_tree = True; cy.sample_clamp_indirect = 8.0
    bk = sc.render.bake; bk.margin = PAD; bk.margin_type = 'EXTEND'; bk.use_clear = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in (ground, atlas):
        if o: o.select_set(True)
    bpy.context.view_layer.objects.active = atlas or ground
    t = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=PAD, margin_type='EXTEND', use_clear=True, uv_layer='lightmap', target='IMAGE_TEXTURES')
    meta = {'key': KEY, 'kind': KIND, 'hash': C['hash'], 'd': C['atlas']['d'], 'S': C['atlas']['S'], 'samples': SAMPLES, 'bakeSeconds': round(time.time() - t, 1),
            'panels': nl, 'sun': SUN_I, 'sunElev': SUN_ELEV, 'sky': SKY}
    log('baked in %.1fs' % meta['bakeSeconds'])
    save_exr(floor_img, os.path.join(OUT, 'lm-floor.exr'))
    if atlas_img: save_exr(atlas_img, os.path.join(OUT, 'lm-atlas.exr'))
    finish(img_array(floor_img), img_array(atlas_img) if atlas_img else None, meta)
    json.dump(meta, open(meta_path, 'w'), indent=1)
    log('done')

main()
