"""Semiconductor-lab props for the campus game, built in Blender from code (no hand modeling).

usage (from the repo root):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -t 4 --python src/blender/props.py -- src/assets/lab [preview-dir]
  python -I src/tools/pack_kit.py      # then pack the GLBs into src/js/kit-meshes.js for the page

Writes one GLB per prop into the folder given after "--" (Y-up, 1 unit = 1 m, origin at the bottom center, front facing
+Z in glTF). The preview renders go to the second folder (default: src/blender/out, never the asset folder):
props-preview.png (all six props as a product shot) and props-closeups.png (a 3 x 2 grid, one prop per tile).
Style: chunky low-poly with small bevels and flat colors, to sit next to Kenney's kits. Each prop carries a baked
ambient-occlusion color attribute ("AO"), multiplied into its colors, so it looks grounded even where the page turns
its own soft shadows off (phones). Material names are stable so the page can swap some (e.g. "screen" gets a live image).
Light on the machine: one process, a few threads, GPU (Eevee) for the preview renders, AO baked with Python ray casts.
"""
import bpy, bmesh, math, os, sys, json, struct
from array import array
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else os.path.join(HERE, '..', 'assets', 'lab'))    # the GLBs (absolute: Blender would resolve a relative path against the drive root)
PREV = os.path.abspath(ARGS[1] if len(ARGS) > 1 else os.path.join(HERE, 'out'))           # the preview renders
os.makedirs(OUT, exist_ok=True); os.makedirs(PREV, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- materials ----------
MATS = {}
def mat(name, color, rough=.6, metal=0.0, emit=None, alpha=1.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF')
    c = tuple(int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = tuple(((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in c)
    b.inputs['Base Color'].default_value = (*lin, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit:
        ec = tuple(int(emit[i:i + 2], 16) / 255 for i in (1, 3, 5))
        b.inputs['Emission Color'].default_value = (*ec, 1); b.inputs['Emission Strength'].default_value = 2.0
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    # baked AO (color attribute "AO") multiplies the base color, in Blender and in the exported glTF
    attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'AO'
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.0
    mul.inputs[6].default_value = (*lin, 1)
    nt.links.new(attr.outputs['Color'], mul.inputs[7]); nt.links.new(mul.outputs[2], b.inputs['Base Color'])
    MATS[name] = m; return m

M = dict(
    body=lambda: mat('instrBody', '#8A9199', .5, .2), bezel=lambda: mat('bezel', '#24282D', .45, .1), screen=lambda: mat('screen', '#0B1410', .2, 0, emit='#1E3A2A'),
    knob=lambda: mat('knob', '#3A3F45', .4, .3), metal=lambda: mat('metal', '#B9BEC4', .3, .9), dark=lambda: mat('darkMetal', '#2A2D31', .45, .6),
    white=lambda: mat('enamel', '#E6E4DE', .45), glass=lambda: mat('glass', '#BFD6E0', .05, 0, alpha=.35), rubber=lambda: mat('rubber', '#1C1D1F', .9),
    led=lambda: mat('led', '#62F0A8', .3, 0, emit='#62F0A8'), ledAmber=lambda: mat('ledAmber', '#FFB547', .3, 0, emit='#FFB547'), ledRed=lambda: mat('ledRed', '#FF5A4E', .3, 0, emit='#FF5A4E'),
    blue=lambda: mat('accentBlue', '#3E7CB1', .5), accentBlueDark=lambda: mat('accentBlueDark', '#2C5C88', .5), plastic=lambda: mat('podPlastic', '#7FA6C9', .25, 0, alpha=.55), chuck=lambda: mat('chuck', '#C7A64A', .3, 1.0),
)
# the material names work as keys too
M.update(enamel=M['white'], darkMetal=M['dark'], podPlastic=M['plastic'], accentBlue=M['blue'])

# ---------- building blocks (Blender units: Z up, front = -Y) ----------
# Budget: ~1,500 faces and ~150 KB per prop. Every flat-shaded face costs 4 unshared vertices in the GLB, so:
# bevel only the big silhouette pieces, and draw small panel details (LEDs, vents, digits, drive bays) as "decals",
# single quads floating EPS off the surface.
EPS = .002
AXES = {'+X': (1, 0, 0), '-X': (-1, 0, 0), '+Y': (0, 1, 0), '-Y': (0, -1, 0), '+Z': (0, 0, 1), '-Z': (0, 0, -1)}
PARTS = []

def _add(o, m):
    o.data.materials.append(M[m]()); PARTS.append(o); return o

def _trim(o, drop=None, smooth=False):
    """drop: delete the faces looking along that axis (hidden backs); smooth: round sides, flat caps"""
    if not (drop or smooth): return
    bm = bmesh.new(); bm.from_mesh(o.data); bm.normal_update()
    if drop:
        d = Vector(AXES[drop]); bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.dot(d) > .9], context='FACES')
    if smooth:
        for f in bm.faces: f.smooth = len(f.verts) <= 4
        for e in bm.edges: e.smooth = all(f.smooth for f in e.link_faces)
    bm.to_mesh(o.data); bm.free()

def box(sx, sy, sz, x=0, y=0, z=0, m='body', bevel=0, seg=1, drop=None):
    """a box standing on height z, centered on (x, y)"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2)); o = bpy.context.object
    o.scale = (sx, sy, sz); bpy.ops.object.transform_apply(location=True, scale=True)
    _trim(o, drop)
    if bevel > 0:
        bv = o.modifiers.new('bevel', 'BEVEL'); bv.width = min(bevel, sx / 3, sy / 3, sz / 3); bv.segments = seg; bv.limit_method = 'ANGLE'
    return _add(o, m)

CYL_ROT = {'Z': (0, 0, 0), 'Y': (math.pi / 2, 0, 0), '+Y': (-math.pi / 2, 0, 0), 'X': (0, math.pi / 2, 0), '-X': (0, -math.pi / 2, 0)}
def cyl(r, h, x=0, y=0, z=0, m='metal', axis='Z', verts=10, r2=None, drop=None):
    """a cylinder (or cone, radius r -> r2). axis 'Z': stands on height z. 'Y' points at the front (-Y), 'X' at +X: (x, y, z) is its center"""
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h); o = bpy.context.object
    o.rotation_euler = CYL_ROT[axis]; o.location = (x, y, z + (h / 2 if axis == 'Z' else 0))
    bpy.ops.object.transform_apply(location=True, rotation=True)
    _trim(o, drop, smooth=True)
    return _add(o, m)

def rod(p0, p1, r, m='metal', verts=6, r2=None, square=False):
    """a round rod (or a square bar) from p0 to p1"""
    p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
    if square: bpy.ops.mesh.primitive_cube_add(size=1); o = bpy.context.object; o.scale = (r * 2, r * 2, d.length)
    else: bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=d.length); o = bpy.context.object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler(); o.location = (p0 + p1) / 2
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if not square: _trim(o, smooth=True)
    return _add(o, m)

DECAL_ROT = {'-Y': (math.pi / 2, 0, 0), '+Y': (math.pi / 2, 0, math.pi), '+X': (math.pi / 2, 0, math.pi / 2), '-X': (math.pi / 2, 0, -math.pi / 2), '+Z': (0, 0, 0)}
def decal(w, h, x, y, z, m, face='-Y'):
    """one flat quad centered on (x, y, z), looking along `face`, with 0..1 UVs"""
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, z)); o = bpy.context.object
    o.scale = (w, h, 1); o.rotation_euler = DECAL_ROT[face]; bpy.ops.object.transform_apply(location=True, scale=True, rotation=True)
    return _add(o, m)

def screen(w, h, x, y, z):
    """a display: a flat front-facing quad with 0..1 UVs (the page puts a live image on material 'screen')"""
    return decal(w, h, x, y, z, 'screen')

SEG = {'0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg'}
def readout(text, cx, y, cz, h, m):
    """a 7-segment number (digits and '.'), h tall, centered on (cx, cz): one quad per lit segment"""
    w, t = h * .5, h * .14
    pitch = [h * .24 if c == '.' else h * .72 for c in text]
    x = cx - sum(pitch) / 2
    for c, p in zip(text, pitch):
        xc = x + p / 2; x += p
        if c == '.': decal(t, t, xc, y, cz - h / 2 + t / 2, m); continue
        for s in SEG[c]:
            if s in 'adg': decal(w - t * 1.3, t, xc, y, cz + {'a': 1, 'g': 0, 'd': -1}[s] * (h / 2 - t / 2), m)
            else: decal(t, h / 2 - t * 1.2, xc + (w / 2 - t / 2) * (1 if s in 'bc' else -1), y, cz + (h / 4 - t / 8) * (1 if s in 'bf' else -1), m)

def tilt(deg, y, z=0):
    """lean every part built so far about the left-right axis through (y, z); positive raises the front"""
    m = Matrix.Translation((0, y, z)) @ Matrix.Rotation(-math.radians(deg), 4, 'X') @ Matrix.Translation((0, -y, -z))
    for o in PARTS: o.data.transform(m)

def finish(name):
    """join the parts into one object and bake AO into a color attribute"""
    global PARTS
    for o in PARTS:
        bpy.context.view_layer.objects.active = o
        for md in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS: o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]; bpy.ops.object.join(); ob = bpy.context.object; ob.name = name
    bake_ao(ob)
    PARTS = []
    return ob

SEE_THROUGH = ('glass', 'podPlastic')   # these do not cast AO (the wafers inside the pod stay bright)
def bake_ao(ob, rays=40, dist=.3):
    """per face corner: share of a cosine-weighted hemisphere that sees open sky within dist (the ground counts as a blocker)"""
    me = ob.data; bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table(); bm.normal_update()
    clear = {i for i, m in enumerate(me.materials) if m.name in SEE_THROUGH}
    tree = BVHTree.FromPolygons([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces if f.material_index not in clear])
    if 'AO' in me.color_attributes: me.color_attributes.remove(me.color_attributes['AO'])
    ca = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    dirs = []
    for i in range(rays):  # fixed cosine-weighted hemisphere around +Z, rotated per face
        u, v = (i + .5) / rays, (i * .618034) % 1
        r = math.sqrt(u); t = 2 * math.pi * v; dirs.append(Vector((r * math.cos(t), r * math.sin(t), math.sqrt(max(0, 1 - u)))))
    vals = [0.0] * len(me.loops)
    for f in bm.faces:
        n = f.normal.normalized(); q = n.to_track_quat('Z', 'Y'); c = f.calc_center_median()
        for loop in f.loops:
            p = loop.vert.co * .985 + c * .015 + n * .002
            hit = 0
            for d in dirs:
                w = q @ d
                if w.z < 0 and p.z + w.z * dist < 0: hit += 1; continue  # the floor
                loc, _, _, _ = tree.ray_cast(p, w, dist)
                if loc is not None: hit += 1
            vals[loop.index] = 1 - .8 * hit / rays
    for v in bm.verts:  # smooth-shaded sides share one value per vertex, so the exporter can share the vertex too
        ls = [l.index for l in v.link_loops if l.face.smooth]
        if len(ls) > 1:
            a = sum(vals[i] for i in ls) / len(ls)
            for i in ls: vals[i] = a
    bm.free()
    for i, v in enumerate(vals):
        g = round(max(.25, v), 2); ca.data[i].color = (g, g, g, 1)
    me.color_attributes.active_color = ca

def export(ob, name):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    path = os.path.join(OUT, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True)
    for extra in (dict(export_vertex_color='MATERIAL'), dict(export_colors=True), {}):
        try: bpy.ops.export_scene.gltf(**kw, **extra); break
        except TypeError: continue
    return path

def glb_stats(path):
    """(vertices, triangles) as stored in the GLB"""
    with open(path, 'rb') as f:
        f.seek(12); n, _ = struct.unpack('<I4s', f.read(8)); g = json.loads(f.read(n))
    acc = g['accessors']; prims = [p for m in g['meshes'] for p in m['primitives']]
    return sum(acc[p['attributes']['POSITION']]['count'] for p in prims), sum(acc[p['indices']]['count'] for p in prims) // 3

# ---------- the props ----------
def oscilloscope():
    """bench oscilloscope: big display on the left with a column of soft keys, knob cluster on the right, BNC inputs along
    the bottom, carry handle; it stands tilted up on two chunky flip-down front feet"""
    W, D, H = .40, .35, .22
    yf = -.150                                                                            # front of the case
    for sx in (-1, 1):
        for i in range(4): decal(.15, .010, sx * (.198 + EPS), .03, .075 + i * .026, 'darkMetal', face='+X' if sx > 0 else '-X')  # side vents
        box(.022, .03, .016, sx * .12, .0125, .195, 'rubber')                             # handle posts
    box(.396, .325, .183, 0, yf + .1625, .012, 'body', bevel=.012, seg=2)                 # case
    box(.30, .034, .011, 0, .0125, .209, 'rubber', bevel=.004)                            # handle bar
    box(.386, .008, .169, 0, yf - .004, .019, 'bezel', bevel=.003, drop='+Y'); pf = yf - .008   # dark front panel
    decal(.222, .128, -.075, pf - EPS, .124, 'knob'); screen(.21, .116, -.075, pf - 2 * EPS, .124)   # display in a thin frame
    for i in range(5): decal(.015, .012, .042, pf - EPS, .080 + i * .022, 'body')         # soft keys beside it
    for i, m in enumerate(('ledAmber', 'led', 'accentBlue', 'ledRed')):                   # four channel inputs with their color tags
        x = -.16 + i * .06
        cyl(.013, .004, x, pf - .002, .038, 'darkMetal', 'Y', 8, drop='+Y'); cyl(.008, .014, x, pf - .007, .038, 'metal', 'Y', 8, drop='+Y')
        decal(.022, .005, x, pf - EPS, .057, m)
    box(.135, .004, .125, .122, pf - .002, .058, 'body', drop='+Y'); pc = pf - .004        # lighter control plate
    for x, z, r in ((.088, .153, .018), (.156, .153, .018), (.088, .108, .012), (.156, .108, .012)):
        cyl(r, .013, x, pc - .0065, z, 'knob', 'Y', 10, drop='+Y')                        # scale / position knobs
        decal(.004, r * .7, x, pc - .013 - EPS, z + r * .5, 'enamel')                     # pointer
        if r > .015: cyl(r + .005, .003, x, pc - .0015, z, 'rubber', 'Y', 10, drop='+Y')  # skirt
    decal(.12, .004, .122, pc - EPS, .088, 'accentBlue')
    for i, m in enumerate(('led', 'ledAmber', 'knob', 'knob')): box(.022, .004, .012, .076 + i * .031, pc - .002, .066, m, drop='+Y')  # run / single / menu keys
    cyl(.008, .014, .16, pf - .007, .038, 'metal', 'Y', 8, drop='+Y')                     # aux trigger input
    box(.024, .004, .014, .095, pf - .002, .031, 'enamel', drop='+Y')                     # power key
    tilt(6, .145)                                                                         # lean back on the rear feet ...
    for sx in (-1, 1):
        box(.05, .05, .018, sx * .15, .12, 0, 'rubber', drop='-Z')                        # rear feet, flat on the bench
        box(.05, .034, .044, sx * .15, -.10, 0, 'rubber', bevel=.005, drop='-Z')          # ... and on two flip-down front feet, inside the footprint
    return finish('oscilloscope')

def power_supply():
    """bench DC supply: volt and amp 7-segment readouts, two knobs, black / ground / red binding posts"""
    W, D, H = .26, .30, .14
    yf = -.132
    for sx in (-1, 1):
        for y in (-.09, .10): box(.035, .035, .01, sx * .09, y, 0, 'rubber')              # feet
        for i in range(4): decal(.11, .008, sx * (.13 + EPS), .05, .058 + i * .018, 'darkMetal', face='+X' if sx > 0 else '-X')   # side vents
    box(W, .282, .128, 0, yf + .141, .01, 'enamel', bevel=.01, seg=2)                     # case
    for i in range(6): decal(.014, .17, -.075 + i * .03, .02, .138 + EPS, 'darkMetal', face='+Z')   # top vents
    box(W - .014, .006, .114, 0, yf - .003, .017, 'bezel', bevel=.003, drop='+Y'); pf = yf - .006   # dark front panel
    for x, txt, m in ((-.058, '12.5', 'ledRed'), (.058, '1.50', 'led')):                  # volts (red) and amps (green)
        decal(.104, .038, x, pf - EPS, .104, 'rubber'); readout(txt, x, pf - 2 * EPS, .104, .026, m)
        cyl(.015, .012, x, pf - .006, .060, 'knob', 'Y', 10, drop='+Y'); cyl(.020, .003, x, pf - .0015, .060, 'rubber', 'Y', 10, drop='+Y')
        decal(.004, .012, x, pf - .012 - EPS, .068, 'enamel')                             # knob pointer
    decal(.010, .005, -.100, pf - EPS, .080, 'led'); decal(.010, .005, .016, pf - EPS, .080, 'ledAmber')   # CV / CC lamps
    for x, m in ((-.02, 'rubber'), (.02, 'metal'), (.06, 'ledRed')):                      # binding posts
        cyl(.011, .004, x, pf - .002, .030, 'metal', 'Y', 8, drop='+Y'); cyl(.0085, .012, x, pf - .006, .030, m, 'Y', 8, drop='+Y')
    box(.024, .004, .030, -.095, pf - .002, .020, 'rubber', drop='+Y'); decal(.012, .005, -.095, pf - .004 - EPS, .043, 'led')   # power rocker
    box(.022, .004, .012, .100, pf - .002, .024, 'body', drop='+Y'); decal(.010, .004, .100, pf - EPS, .042, 'led')   # output key and its lamp
    decal(.19, .09, 0, .150 + EPS, .075, 'bezel', face='+Y'); decal(.07, .07, -.05, .150 + 2 * EPS, .075, 'rubber', face='+Y')   # rear panel with a fan grille
    decal(.04, .03, .06, .150 + 2 * EPS, .06, 'rubber', face='+Y')                        # mains inlet
    return finish('powerSupply')

def chamber():
    """environmental test chamber: tall cabinet on a recessed plinth, insulated door with a lit square window (samples on
    two shelves) and a heavy latch, controller touchscreen and e-stop on the right column, machinery grille below,
    cable port on the right side, louvers on the left"""
    W, D, H = 1.0, 1.0, 1.8
    yb, cx = -.425, -.02                                                                  # cabinet front; the cabinet sits a bit left to leave room for the side port
    box(.88, .85, .05, cx, yb + .4615, 0, 'darkMetal', drop='-Z')                         # recessed plinth
    box(.96, .923, 1.72, cx, yb + .4615, .05, 'enamel', bevel=.02, seg=2)                 # cabinet
    box(.5, .4, .03, cx, .1, 1.77, 'darkMetal', bevel=.006)                               # exhaust hood on top
    for i in range(4): decal(.36, .03, cx, .01 + i * .06, 1.80 + EPS, 'rubber', face='+Z')
    for i in range(5): decal(.5, .02, cx - .48 - EPS, .1, .2 + i * .05, 'darkMetal', face='-X')   # left side louvers
    for i in range(5): decal(.6, .02, cx, .498 + EPS, .2 + i * .05, 'darkMetal', face='+Y')    # rear vents
    # machinery compartment grille
    box(.60, .006, .27, -.17, yb - .003, .11, 'bezel', drop='+Y')
    for i in range(5): box(.56, .008, .02, -.17, yb - .010, .135 + i * .05, 'body', drop='+Y')
    # door: gasket, slab, window, latch, hinges
    dx = -.16
    box(.64, .008, 1.26, dx, yb - .004, .45, 'rubber', drop='+Y')
    box(.62, .04, 1.24, dx, yb - .028, .46, 'enamel', bevel=.014, seg=2); yd = yb - .048
    box(.38, .01, .38, dx, yd - .005, 1.03, 'bezel', bevel=.004, drop='+Y'); yw = yd - .01
    decal(.31, .31, dx, yw - EPS, 1.22, 'darkMetal')                                      # the dark inside, with two shelves
    for z in (1.15, 1.27): decal(.31, .014, dx, yw - 2 * EPS, z, 'metal')
    decal(.27, .018, dx, yw - 2 * EPS, 1.352, 'ledAmber')                                 # chamber lamp
    decal(.11, .05, dx - .05, yw - 2 * EPS, 1.182, 'accentBlue'); decal(.05, .034, dx + .07, yw - 2 * EPS, 1.174, 'chuck')   # samples under test
    decal(.07, .04, dx + .02, yw - 2 * EPS, 1.297, 'body')
    decal(.31, .31, dx, yw - 3 * EPS, 1.22, 'glass')
    box(.07, .012, .24, .105, yd - .006, .96, 'darkMetal', bevel=.004, drop='+Y')         # latch plate
    box(.045, .014, .36, .105, yd - .019, .90, 'metal', bevel=.005, drop='+Y')            # latch lever
    for z in (.62, 1.42): cyl(.017, .13, -.484, yb - .028, z, 'metal', verts=8)           # hinges
    # controller column
    px = .305
    box(.24, .012, .50, px, yb - .006, 1.17, 'bezel', bevel=.004, drop='+Y'); yp = yb - .012
    screen(.19, .13, px, yp - EPS, 1.555)                                                 # touchscreen
    for i, m in enumerate(('led', 'ledAmber', 'led')): decal(.034, .016, px - .06 + i * .06, yp - EPS, 1.445, m)
    decal(.10, .10, px, yp - EPS, 1.32, 'ledAmber'); cyl(.032, .03, px, yp - .015, 1.32, 'ledRed', 'Y', 10, drop='+Y')   # e-stop
    decal(.24, .035, px, yb - EPS, 1.71, 'accentBlue')                                    # brand strip
    box(.12, .014, .17, px, yb - .007, .62, 'darkMetal', bevel=.004, drop='+Y')           # mains disconnect
    box(.032, .012, .10, px, yb - .020, .655, 'ledRed', drop='+Y')
    decal(.12, .06, px, yb - EPS, .95, 'metal')                                           # rating plate
    # cable port on the right side
    cyl(.07, .03, .475, -.05, 1.15, 'darkMetal', 'X', 12, drop='-X'); cyl(.05, .04, .48, -.05, 1.15, 'rubber', 'X', 12, drop='-X')
    return finish('testChamber')

def probe_station():
    """wafer probe station: vibration-isolation table, gold chuck holding a wafer, four probe positioners with needles
    on the wafer, a microscope on a bridge above it, a monitor on a pole, a joystick box and a stack light;
    the prober's controller and a vacuum pump sit on a shelf under the table"""
    W, D = 1.2, 1.0
    # isolation table: legs, air isolators, tie bars, slab with a steel top
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * .53, sy * .43
            box(.10, .10, .62, x, y, 0, 'darkMetal', drop='-Z'); box(.13, .13, .07, x, y, .62, 'accentBlue')
            box(.13, .13, .025, x, y, 0, 'rubber', drop='-Z')                             # leveling pads
        box(.05, .76, .05, sx * .53, 0, .14, 'darkMetal')
    box(.96, .05, .05, 0, .43, .14, 'darkMetal')
    box(1.01, .81, .02, 0, 0, .19, 'darkMetal'); S = .21                                  # shelf on the tie bars
    box(.46, .42, .24, -.20, .08, S, 'bezel', bevel=.012); yk = -.13                      # prober controller
    decal(.40, .05, -.20, yk - EPS, S + .17, 'rubber'); decal(.10, .028, -.33, yk - 2 * EPS, S + .17, 'accentBlue')
    for i, m in enumerate(('led', 'led', 'ledAmber')): decal(.022, .016, -.13 + i * .05, yk - 2 * EPS, S + .17, m)
    for i in range(3): decal(.40, .014, -.20, yk - EPS, S + .04 + i * .03, 'knob')
    cyl(.085, .26, .27, .10, S, 'enamel', verts=10, drop='-Z'); cyl(.045, .05, .27, .10, S + .26, 'accentBlue', verts=8, drop='-Z')   # vacuum pump
    box(W, D, .09, 0, 0, .69, 'darkMetal', bevel=.01)
    box(1.14, .94, .008, 0, 0, .78, 'metal', drop='-Z'); T = .788
    # prober: base, XY stage, chuck, wafer (with a patterned die area)
    yc = -.02
    box(.66, .58, .06, 0, .02, T, 'enamel', bevel=.012, seg=2); B = T + .06
    box(.36, .36, .035, 0, yc, B, 'darkMetal', bevel=.006)
    cyl(.16, .03, 0, yc, B + .035, 'chuck', verts=20, drop='-Z')
    cyl(.15, .004, 0, yc, B + .065, 'metal', verts=24, drop='-Z'); wz = B + .069
    for i, w in enumerate((.15, .23, .25, .23, .15)): decal(w, .03, 0, yc + (i - 2) * .036, wz + EPS, 'accentBlue', face='+Z')   # rows of dies
    # platen rails left and right of the chuck, two positioners on each: body, two micrometers, arm, needle
    for sx in (-1, 1):
        box(.13, .50, .09, sx * .265, yc, B, 'enamel', drop='-Z'); box(.15, .52, .012, sx * .265, yc, B + .09, 'metal'); P = B + .102
        for sy in (-1, 1):
            x, y = sx * .265, yc + sy * .15
            box(.09, .10, .06, x, y, P, 'bezel', drop='-Z'); box(.06, .07, .03, x, y, P + .06, 'darkMetal', drop='-Z')
            cyl(.013, .05, x + sx * .07, y, P + .03, 'metal', 'X' if sx > 0 else '-X', 6)
            cyl(.013, .05, x, y + sy * .075, P + .03, 'metal', '+Y' if sy > 0 else 'Y', 6)
            tip = (sx * .075, yc + sy * .05, wz + .03)
            rod((sx * .235, y, P + .075), tip, .007, 'metal', square=True)
            rod(tip, (sx * .03, yc + sy * .02, wz + .003), .005, 'darkMetal', verts=6, r2=.001)
    # microscope bridge: two columns and a beam behind the chuck, an arm reaching forward, the microscope on its end
    for sx in (-1, 1): box(.07, .07, .40, sx * .275, .27, B, 'enamel', drop='-Z')
    box(.62, .08, .08, 0, .27, B + .40, 'enamel', bevel=.01); A = B + .40
    box(.09, .28, .07, 0, .10, A, 'enamel', bevel=.008)
    cyl(.045, .15, 0, yc, A - .08, 'enamel', verts=10)                                    # zoom body
    cyl(.022, .09, 0, yc, A - .17, 'darkMetal', verts=10, r2=.036)                        # objective
    box(.10, .11, .07, 0, yc - .01, A + .07, 'enamel', bevel=.008)                        # head
    cyl(.03, .04, 0, yc, A + .14, 'bezel', verts=8)                                       # camera
    for sx in (-1, 1): rod((sx * .028, yc - .05, A + .12), (sx * .028, yc - .13, A + .17), .017, 'darkMetal', verts=8)   # eyepieces
    # monitor on a pole at the back right
    cyl(.05, .012, .46, .42, T, 'darkMetal', verts=8); cyl(.018, .50, .46, .42, T, 'darkMetal', verts=8)
    box(.28, .025, .19, .46, .385, 1.14, 'bezel', bevel=.006); screen(.25, .16, .46, .3725 - EPS, 1.235)
    # joystick box at the front right
    box(.13, .10, .035, .46, -.38, T, 'bezel', bevel=.006)
    cyl(.008, .05, .44, -.38, T + .035, 'metal', verts=6); cyl(.016, .022, .44, -.38, T + .08, 'knob', verts=8)
    decal(.022, .022, .495, -.38, T + .035 + EPS, 'led', face='+Z')
    # stack light at the back left
    cyl(.012, .30, -.52, .42, T, 'darkMetal', verts=6)
    for i, m in enumerate(('led', 'ledAmber', 'ledRed')): cyl(.026, .04, -.52, .42, T + .30 + i * .042, m, verts=8)
    return finish('probeStation')

def rack():
    """instrument / server rack: frame with front rails, a 40U stack of 1U / 2U / 4U units (UPS, PDU, storage, servers,
    switches, patch panel, signal analyzer with a display, DC supply, modular mainframe)"""
    W, D, H = .6, 1.0, 2.0
    U, z0, yu = .0445, .10, -.47                                                          # rack unit, bottom of the stack, unit fronts (inset from the frame)
    yd, yd2 = yu - EPS, yu - 2 * EPS
    box(W, D, .08, 0, 0, 0, 'darkMetal', bevel=.008)                                      # plinth
    box(W, D, .078, 0, 0, 1.92, 'darkMetal', bevel=.01)                                   # top cap
    decal(.36, .5, 0, .1, 1.998 + EPS, 'bezel', face='+Z')
    for y in (-.02, .22): decal(.2, .2, 0, y, 1.998 + 2 * EPS, 'rubber', face='+Z'); decal(.06, .06, 0, y, 1.998 + 3 * EPS, 'knob', face='+Z')   # roof fans
    decal(.11, .022, -.17, -.5 - EPS, 1.958, 'accentBlue'); decal(.034, .02, .2, -.5 - EPS, 1.958, 'led')   # badge and status lamp on the cap
    decal(.40, .028, 0, -.5 - EPS, .042, 'rubber')                                        # plinth vent
    for sx in (-1, 1):
        box(.03, D, 1.84, sx * .283, 0, .08, 'darkMetal')                                 # side panels
        box(.022, .006, 1.80, sx * .259, -.473, .10, 'metal', drop='+Y')                  # mounting rails
        for i in range(6): decal(.5, .014, sx * (.298 + EPS), 0, 1.50 + i * .05, 'rubber', face='+X' if sx > 0 else '-X')
        decal(.03, .10, sx * (.298 + EPS), -.44, 1.0, 'metal', face='+X' if sx > 0 else '-X')   # side panel latch
    box(.536, .02, 1.84, 0, .49, .08, 'darkMetal')                                        # back
    decal(.536, 1.84, 0, -.41, 1.0, 'rubber')                                             # the dark inside, seen through the gaps

    def face(k, n, m, ears=True):
        """the front plate of an n-U unit whose bottom sits k units up; returns (center height, height)"""
        h = n * U - .004; z = z0 + k * U
        box(.49, .05, h, 0, yu + .025, z, m, drop='+Y')
        if ears:
            for sx in (-1, 1): decal(.014, h - .012, sx * .234, yd, z + h / 2, 'metal')
        return z + h / 2, h
    def server(k):   # 2U: four drive bays with activity lamps, a vent and a power lamp
        zc, h = face(k, 2, 'bezel')
        for i in range(4):
            x = -.175 + i * .082
            decal(.074, .058, x, yd, zc, 'knob')
        for j in range(2): decal(.05, .013, -.134 + j * .164, yd2, zc - .018, 'ledAmber' if (j + k) % 5 == 0 else 'led')   # one activity bar per pair of bays
        decal(.07, .03, .165, yd, zc - .012, 'rubber'); decal(.026, .016, .187, yd, zc + .02, 'led')
    def switch(k):   # 1U: two port banks under a row of link lamps
        zc, h = face(k, 1, 'bezel')
        for j in range(2): decal(.15, .016, -.13 + j * .17, yd, zc - .007, 'knob')
        for i in range(3): decal(.07, .011, -.17 + i * .105, yd, zc + .011, 'ledAmber' if (i + k) % 3 == 0 else 'led')   # link lamps, as three bars
        decal(.05, .02, .175, yd, zc, 'accentBlue')
    def patch(k):    # 1U patch panel with a few plugs in
        zc, h = face(k, 1, 'metal', ears=False)
        decal(.42, .022, 0, yd, zc, 'rubber')
        for i in range(7): decal(.02, .016, -.18 + i * .06, yd2, zc, 'accentBlue' if i % 3 else 'enamel')
    def blank(k, n=1):   # vented blanking plate
        zc, h = face(k, n, 'knob')
        m = 2 if n == 1 else 5
        for i in range(m): decal(.36, .007, 0, yd, zc + (i - (m - 1) / 2) * .016, 'rubber')
    def ups(k):      # 4U: charge bars in a window, two keys, a vent grille
        zc, h = face(k, 4, 'bezel')
        decal(.13, .07, -.12, yd, zc + .03, 'rubber')
        for i in range(5): decal(.016, .04, -.164 + i * .022, yd2, zc + .03, 'led' if i < 4 else 'ledAmber')
        for i in range(2): decal(.03, .016, -.15 + i * .05, yd, zc - .035, 'knob')
        for i in range(6): decal(.17, .01, .11, yd, zc - .055 + i * .022, 'knob')
        decal(.13, .012, -.12, yd, zc - .068, 'accentBlue')
    def pdu(k):      # 2U power distribution: a row of lit breakers
        zc, h = face(k, 2, 'knob')
        for i in range(4):
            x = -.165 + i * .088
            decal(.066, .05, x, yd, zc - .002, 'rubber'); decal(.04, .014, x, yd2, zc + .01, 'ledRed')
        decal(.035, .05, .185, yd, zc, 'enamel')
    def storage(k):  # 4U disk shelf: 3 x 4 drive carriers
        zc, h = face(k, 4, 'bezel')
        for r in range(3):
            for c in range(4):
                x, z = -.158 + c * .105, zc + (r - 1) * .054
                decal(.097, .046, x, yd, z, 'knob')
            for j in range(2): decal(.06, .012, -.085 + j * .21, yd2, zc + (r - 1) * .054 - .013, 'ledAmber' if (r, j) == (1, 1) else 'led')   # one activity bar per pair of carriers
    def analyzer(k):  # 4U signal analyzer: display, tuning knob, keys, inputs
        zc, h = face(k, 4, 'body')
        decal(.20, .15, -.105, yd, zc, 'bezel'); screen(.18, .13, -.105, yd2, zc)
        cyl(.024, .012, .07, yu - .006, zc + .035, 'knob', 'Y', 10, drop='+Y')
        for x in (.14, .19): cyl(.012, .012, x, yu - .006, zc + .048, 'knob', 'Y', 8, drop='+Y')
        for i in range(3):
            for j in range(2): decal(.022, .012, .125 + i * .03, yd, zc + .012 - j * .024, 'knob')
            cyl(.009, .012, .05 + i * .06, yu - .006, zc - .06, 'metal', 'Y', 8, drop='+Y')
    def supply(k):   # 2U programmable DC supply: two readouts, two knobs, output posts
        zc, h = face(k, 2, 'enamel')
        for x, txt, m in ((-.15, '12.0', 'ledRed'), (-.035, '0.50', 'led')):
            decal(.10, .05, x, yd, zc, 'rubber'); readout(txt, x, yd2, zc, .032, m)
        for x in (.06, .105): cyl(.015, .012, x, yu - .006, zc, 'knob', 'Y', 8, drop='+Y')
        for x, m in ((.155, 'ledRed'), (.195, 'rubber')): cyl(.009, .012, x, yu - .006, zc - .01, m, 'Y', 8, drop='+Y')
    def mainframe(k):  # 4U modular mainframe: five plug-in cards with connectors
        zc, h = face(k, 4, 'body')
        for i in range(5):
            x = -.168 + i * .084
            decal(.074, .15, x, yd, zc, 'enamel'); decal(.074, .012, x, yd2, zc + .063, 'accentBlue')
            if i % 2 == 0: decal(.04, .014, x, yd2, zc + .04, 'led')
            for j in range(2): decal(.022, .022, x, yd2, zc - .005 - j * .04, 'metal')
    k = 0
    for fn, n in ((ups, 4), (pdu, 2), (storage, 4), (server, 2), (server, 2), (blank, 1), (switch, 1), (switch, 1), (patch, 1), (blank, 2),
                  (analyzer, 4), (supply, 2), (mainframe, 4), (server, 2), (server, 2), (blank, 1), (switch, 1), (server, 2), (blank, 2)):
        fn(k, n) if fn is blank else fn(k); k += n
    return finish('serverRack')

def wafer_pod():
    """a front-opening wafer pod (FOUP), the box chip fabs carry 300 mm wafers in: rounded translucent shell,
    front door set into it (three panels, one central latch dial), robot flange on top, side grips, a stack of wafers inside"""
    W, D, H = .39, .33, .33
    box(.38, .32, .025, 0, 0, 0, 'darkMetal', bevel=.006)                                 # kinematic base plate
    box(.37, .301, .26, 0, .0145, .025, 'podPlastic', bevel=.035, seg=2)                  # shell
    box(.35, .025, .24, 0, -.1485, .035, 'accentBlue', bevel=.008); yf = -.161            # door: set 1 cm in from the shell's outline, so the shell reads as one piece
    for sx in (-1, 1):
        decal(.006, .225, sx * .085, yf - EPS, .155, 'accentBlueDark')                    # the door's panel seams
        box(.012, .13, .035, sx * .189, .02, .14, 'accentBlue', bevel=.004)               # side grips
    cyl(.032, .006, 0, yf - .003, .155, 'darkMetal', 'Y', 12, drop='+Y')                  # one central latch dial with a grip bar
    box(.052, .008, .014, 0, yf - .010, .148, 'metal', drop='+Y')
    decal(.07, .028, -.135, yf - EPS, .243, 'enamel'); decal(.014, .014, .135, yf - EPS, .066, 'led')   # lot label, status lamp
    for i in range(9): cyl(.15, .006, 0, .018, .058 + i * .024, 'enamel', verts=14, drop='-Z')         # wafers: thick bright discs, so the stack shows through the shell
    box(.10, .10, .032, 0, .015, .283, 'darkMetal', drop='-Z'); box(.15, .15, .015, 0, .015, .315, 'accentBlue', bevel=.004)   # low top handling flange
    return finish('waferPod')

BUILD = [oscilloscope, power_supply, chamber, probe_station, rack, wafer_pod]
objs = {}
for fn in BUILD:
    ob = fn(); path = export(ob, ob.name); objs[ob.name] = ob
    nv, nt = glb_stats(path); d = ob.dimensions
    print('exported %-13s %4d faces %5d tris %5d verts %6.1f KB   %.3f x %.3f x %.3f m' % (ob.name, len(ob.data.polygons), nt, nv, os.path.getsize(path) / 1024, d.x, d.y, d.z))

# ---------- preview renders (Eevee on the GPU; nothing below is exported) ----------
sc = bpy.context.scene
def tryset(o, **kw):
    for k, v in kw.items():
        try: setattr(o, k, v)
        except Exception: pass
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try: sc.render.engine = eng; break
    except Exception: continue
tryset(sc.eevee, taa_render_samples=64, use_shadows=True, use_raytracing=True, use_gtao=True)
tryset(sc.view_settings, view_transform='Standard', look='None')

def plain(name, rgb, rough=.8):
    """a preview-only material (the prop materials need the AO attribute, which the floor does not have)"""
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; return m

# studio: a light neutral floor, a soft sky (brighter overhead), a soft-shadowed key from the front left, a shadowless fill from the right
bpy.ops.mesh.primitive_plane_add(size=80); floor = bpy.context.object; floor.data.materials.append(plain('floor', (.69, .68, .66), .9))
world = bpy.data.worlds.new('studio'); world.use_nodes = True; sc.world = world; wn = world.node_tree
bg = wn.nodes['Background']; bg.inputs['Strength'].default_value = .62
tc = wn.nodes.new('ShaderNodeTexCoord'); sep = wn.nodes.new('ShaderNodeSeparateXYZ'); rng = wn.nodes.new('ShaderNodeMapRange'); mix = wn.nodes.new('ShaderNodeMix')
mix.data_type = 'RGBA'; mix.inputs[6].default_value = (.60, .60, .62, 1); mix.inputs[7].default_value = (1, 1, 1, 1)
rng.inputs['From Min'].default_value = -.3; rng.inputs['From Max'].default_value = .5
wn.links.new(tc.outputs['Generated'], sep.inputs[0]); wn.links.new(sep.outputs['Z'], rng.inputs['Value']); wn.links.new(rng.outputs[0], mix.inputs[0]); wn.links.new(mix.outputs[2], bg.inputs['Color'])
def sun(direction, energy, shadow):
    bpy.ops.object.light_add(type='SUN'); s = bpy.context.object; s.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    s.data.energy = energy; s.data.angle = math.radians(14); tryset(s.data, use_shadow=shadow, use_shadow_jitter=True)
sun((.35, .6, -.72), 2.2, True); sun((-.7, .45, -.35), .5, False)
bpy.ops.object.camera_add(); cam = bpy.context.object; sc.camera = cam

def corners(obs):
    bpy.context.view_layer.update()
    return [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
def shoot(obs, offset, lens, size, path, back=1.07):
    """frame the objects from the direction `offset` (target -> camera), with a little air around them, and render"""
    sc.render.resolution_x, sc.render.resolution_y = size; cam.data.lens = lens
    look = -Vector(offset).normalized(); cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    pts = corners(obs)
    co, _ = cam.camera_fit_coords(bpy.context.evaluated_depsgraph_get(), [c for p in pts for c in p])
    cam.location = co - look * ((sum(pts, Vector()) / len(pts) - co).length * (back - 1))
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)

# 1) the product shot: the three machines in a row, the three bench-top props closer to the camera on a low stand
bpy.ops.mesh.primitive_cube_add(size=1, location=(-.1, -2.1, .14)); stand = bpy.context.object; stand.scale = (1.5, .55, .28)
stand.data.materials.append(plain('stand', (.85, .85, .83), .7))
for name, pos in dict(testChamber=(-1.55, 0, 0), serverRack=(-.5, 0, 0), probeStation=(.75, 0, 0),
                      waferPod=(-.58, -2.1, .28), oscilloscope=(-.08, -2.1, .28), powerSupply=(.37, -2.1, .28)).items(): objs[name].location = pos
shoot(list(objs.values()) + [stand], (.30, -1, .33), 55, (1800, 1000), os.path.join(PREV, 'props-preview.png'))
print('preview', sc.render.filepath)

# 2) closeups.png: each prop alone with its name on the floor, six tiles stitched into a 3 x 2 grid
TW, TH = 600, 500
tryset(sc.eevee, taa_render_samples=48)
stand.hide_render = True
for o in objs.values(): o.hide_render = True
view = Vector((.55, -1, .42)); ground = Vector((-view.x, -view.y, 0)).normalized()        # ground = the way the camera looks, flattened
ink = plain('ink', (.04, .05, .06))
sheet = array('f', [0.0]) * (TW * 3 * TH * 2 * 4)
for i, (name, ob) in enumerate(objs.items()):
    ob.hide_render = False; ob.location = (0, 0, 0); d = ob.dimensions
    size = .09 * max(d.x, d.z)
    reach = .5 * (d.x * abs(ground.x) + d.y * abs(ground.y)) + size * 1.1                 # the label lies just in front of the prop, facing the camera
    bpy.ops.object.text_add(location=(-ground.x * reach, -ground.y * reach, .002)); label = bpy.context.object
    label.data.body = name; label.data.size = size; label.data.align_x = 'CENTER'; label.rotation_euler.z = math.atan2(-ground.x, ground.y)
    label.data.materials.append(ink)
    tile = os.path.join(PREV, '_tile%d.png' % i)
    shoot([ob, label], view, 60, (TW, TH), tile, back=1.05)
    img = bpy.data.images.load(tile); px = array('f', [0.0]) * (TW * TH * 4); img.pixels.foreach_get(px)
    col, row = i % 3, i // 3
    for r in range(TH):                                                                    # image rows run bottom-up
        dst = (((1 - row) * TH + r) * TW * 3 + col * TW) * 4
        sheet[dst:dst + TW * 4] = px[r * TW * 4:(r + 1) * TW * 4]
    bpy.data.images.remove(img); os.remove(tile)
    bpy.data.objects.remove(label); ob.hide_render = True
out = bpy.data.images.new('closeups', TW * 3, TH * 2, alpha=False); out.pixels.foreach_set(sheet)
out.filepath_raw = os.path.join(PREV, 'props-closeups.png'); out.file_format = 'PNG'; out.save()
print('closeups', out.filepath_raw)
