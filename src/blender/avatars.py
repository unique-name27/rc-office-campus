"""The RC car, dog and cat for the campus game, built in Blender from code (no hand modeling).

usage:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -t 4 --python src/blender/avatars.py -- [out_dir] [--no-render] [--only car|dog|cat]

Writes src/js/avatar-meshes.js (const AVMESH, read by the game's build) and, unless --no-render, preview renders:
out/avatars.png (the three side by side) and out/turnaround.png (each from four sides).

Coordinates are the game's, not Blender's usual ones: meters, +Y up, the avatar faces -Z, +X is its right, origin on the
ground under its center. (The preview turns the whole set upright for Blender's Z-up camera.)
Each avatar is a few parts, each with a pivot the game animates:
  car  body, wheelFL/FR/BL/BR (steer about Y on the front pair, spin about X), antenna (sways about its base)
  dog  body, head (bobs), legFL/FR/BL/BR (swing about X at the hip/shoulder), tail (wags about Y)
  cat  the same as the dog
Pivot positions match the code-built models the game had before, so physics, cameras and animation stay put.
Material names are the game's keys: the game turns each into one of its style roles (paint, fur, tire, glass ...), so
all five styles can still recolor and outline these models. Every corner carries baked ambient occlusion ("AO").
Light on the machine: one process, a few threads, Eevee for the previews, AO baked with Python ray casts.
"""
import bpy, bmesh, math, os, sys, json, base64, struct
from array import array
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
_pos = [a for i, a in enumerate(ARGS) if not a.startswith('--') and (i == 0 or ARGS[i - 1] != '--only')]
OUT = os.path.abspath(_pos[0] if _pos else os.path.join(HERE, 'out'))
JS = os.path.abspath(os.path.join(HERE, '..', 'js', 'avatar-meshes.js'))
RENDER = '--no-render' not in ARGS
ONLY = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else None
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
PI = math.pi

# ---------- materials (preview colors; the game recolors by name) ----------
def srgb(h):
    c = tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return tuple(((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in c)

MATS = {}
def material(key, color, rough=.6, metal=0.0, emit=0.0, alpha=1.0):
    """key: 'avatar:name'; the part after ':' is the name the game sees"""
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(key); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get('Principled BSDF'); lin = srgb(color)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*lin, 1); b.inputs['Emission Strength'].default_value = emit
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'AO'
    mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1.0
    mul.inputs[6].default_value = (*lin, 1)
    nt.links.new(attr.outputs['Color'], mul.inputs[7]); nt.links.new(mul.outputs[2], b.inputs['Base Color'])
    MATS[key] = m; return m

PALETTE = {
    'car': dict(paint=('#E4572E', .3), trim=('#1E2024', .5), glass=('#17222C', .06), tire=('#1A1B1D', .88), rim=('#CDD1D6', .28, .9),
                light=('#FFF3D2', .2, 0, 1.4), tail=('#FF2A2A', .3, 0, 2.5), white=('#F3F1EB', .4)),
    'dog': dict(fur=('#C8924E', .85), furLight=('#EAD3AE', .85), furDark=('#8E5B2A', .85), eye=('#121212', .12), shine=('#FFFFFF', .3, 0, 2.0),
                nose=('#1B1616', .25), pink=('#E07A86', .5), collar=('#E4572E', .45), tag=('#E8C25A', .3, .9)),
    'cat': dict(fur=('#E08A3C', .85), furLight=('#F6E7D2', .85), furStripe=('#A9561D', .85), furPoint=('#E08A3C', .85), eye=('#121212', .12),
                iris=('#9BD84A', .2), shine=('#FFFFFF', .3, 0, 2.0), pink=('#E58C9A', .5), whisker=('#F2F2F2', .5)),
}
AV = None  # the avatar being built
def M(name):
    spec = PALETTE[AV][name]
    return material(AV + ':' + name, *spec)

# ---------- building blocks, all in game coordinates (+Y up, front -Z) ----------
PIECES = {}  # part name -> [objects]
ANCH = {}    # named points the game attaches things to (game coordinates): cup (coffee run), flame (boost exhausts)
def _obj(bm, mat, part, angle=50, smooth=True):
    if smooth:
        for f in bm.faces: f.smooth = True
        a = math.radians(angle)
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > a: e.smooth = False
    me = bpy.data.meshes.new(part); bm.normal_update(); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(part, me); bpy.context.collection.objects.link(ob)
    me.materials.append(M(mat)); PIECES.setdefault(part, []).append(ob); return ob

def xf(c=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.Translation(Vector(c)) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))

Y_POLES = Matrix.Rotation(-PI / 2, 4, 'X')  # uv-sphere poles along Y instead of Z
def ell(part, mat, c, r, seg=16, rings=10, rot=(0, 0, 0), angle=70):
    """an ellipsoid with radii r = (rx, ry, rz), poles up and down"""
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1, matrix=xf(c, rot, r) @ Y_POLES)
    return _obj(bm, mat, part, angle)

def rbox(part, mat, c, size, r=.004, seg=2, rot=(0, 0, 0), angle=50):
    """a box with rounded edges"""
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Diagonal((*size, 1)))
    rr = min(r, min(size) * .45)
    if rr > 0: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=rr, segments=seg, profile=.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.transform(bm, matrix=xf(c, rot), verts=bm.verts)
    return _obj(bm, mat, part, angle)

def cyl(part, mat, c, axis, r, h, seg=16, r2=None, angle=40, rot=None):
    """a cylinder (or cone r -> r2) centered on c along axis 'x', 'y' or 'z'"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    R = {'z': Matrix.Identity(4), 'y': Matrix.Rotation(-PI / 2, 4, 'X'), 'x': Matrix.Rotation(PI / 2, 4, 'Y')}[axis]
    if rot: R = Euler(rot, 'XYZ').to_matrix().to_4x4() @ R
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(c)) @ R, verts=bm.verts)
    return _obj(bm, mat, part, angle)

def _frames(pts, ref):
    """rotation-minimizing frames along a polyline: (tangent, normal, binormal) per point"""
    T = []
    for i in range(len(pts)):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        T.append((b - a).normalized())
    N = (Vector(ref) - T[0] * Vector(ref).dot(T[0])).normalized(); out = []
    for i, t in enumerate(T):
        if i:  # parallel transport
            N = (N - t * N.dot(t)).normalized()
        out.append((t, N, t.cross(N)))
    return out

def tube(part, mat, pts, radii, seg=12, ref=(0, 1, 0), cap0=True, cap1=True, angle=70, capn=3):
    """a smooth tube along pts; radii per point: r or (r_side, r_ref). Ends get rounded caps."""
    pts = [Vector(p) for p in pts]; rs = [(r, r) if isinstance(r, (int, float)) else r for r in radii]
    fr = _frames(pts, ref); bm = bmesh.new(); rings = []
    def ring(p, t, n, bn, rx, ry):
        return [bm.verts.new(p + bn * (rx * math.cos(2 * PI * k / seg)) + n * (ry * math.sin(2 * PI * k / seg))) for k in range(seg)]
    def cap(i, sgn):
        p, (t, n, bn), (rx, ry) = pts[i], fr[i], rs[i]
        out = []
        for s, k in ((.38, .93), (.71, .7), (.92, .38))[:capn]:
            out.append(ring(p + t * (sgn * s * min(rx, ry) * .9), t, n, bn, rx * k, ry * k))
        tip = bm.verts.new(p + t * (sgn * min(rx, ry) * .9))
        return out, tip
    if cap0:
        cs, tip0 = cap(0, -1); rings += list(reversed(cs))
    for p, (t, n, bn), (rx, ry) in zip(pts, fr, rs): rings.append(ring(p, t, n, bn, rx, ry))
    if cap1:
        cs, tip1 = cap(len(pts) - 1, 1); rings += cs
    for a, b in zip(rings, rings[1:]):
        for k in range(seg): bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if cap0:
        for k in range(seg): bm.faces.new((tip0, rings[0][(k + 1) % seg], rings[0][k]))
    else: bm.faces.new(list(reversed(rings[0])))
    if cap1:
        for k in range(seg): bm.faces.new((tip1, rings[-1][k], rings[-1][(k + 1) % seg]))
    else: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, mat, part, angle)

def loft(part, mat, rings_pts, angle=45):
    """skin closed rings (lists of Vector, same count) and close both ends"""
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in r] for r in rings_pts]; n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for k in range(n): bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, mat, part, angle)

def lathe(part, mat, c, profile, seg=24, side=1, angle=35, lug=0.0):
    """revolve (radius, offset along +X[, lugged]) points around the X axis through c; side=-1 mirrors.
    Radius 0 closes that end with a fan. Lugged points (third value 1 or 2 = which step) drop by `lug` at every third
    step: a knobby tread that is part of the outline and costs no extra triangles; two rings on different steps
    give slanted blocks. Faces come out band by band (seg per band), see paint()."""
    bm = bmesh.new(); rings = []; C = Vector(c)
    for p in profile:
        r, x = p[0], p[1]; ph = p[2] if len(p) > 2 else 0; lg = lug if ph else 0.0
        if r <= 0: rings.append([bm.verts.new(C + Vector((x * side, 0, 0)))]); continue
        ring = []
        for k in range(seg):
            rr = r - (lg if k % 3 == ph else 0.0); a = 2 * PI * k / seg
            ring.append(bm.verts.new(C + Vector((x * side, rr * math.cos(a), rr * math.sin(a)))))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            k2 = (k + 1) % seg
            if len(a) == 1: bm.faces.new((a[0], b[k2], b[k]))
            elif len(b) == 1: bm.faces.new((a[k], a[k2], b[0]))
            else: bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, mat, part, angle)

def superellipse(z, yb, yt, hw_b, hw_t=None, n=4.0, k=28, bottom=2.6):
    """a rounded section ring at depth z: half widths hw_b (bottom) .. hw_t (top), exponent n (higher = boxier)"""
    hw_t = hw_b if hw_t is None else hw_t; yc = (yb + yt) / 2; hh = (yt - yb) / 2; out = []
    for i in range(k):
        t = 2 * PI * (i + .5) / k; c, s = math.cos(t), math.sin(t)
        e = n if s >= 0 else bottom * n / 2.6
        y = yc + hh * math.copysign(abs(s) ** (2 / e), s)
        f = (y - yb) / max(1e-6, yt - yb); hw = hw_b + (hw_t - hw_b) * f
        out.append(Vector((hw * math.copysign(abs(c) ** (2 / n), c), y, z)))
    return out

def slot(me, mat):
    m = M(mat); names = [x.name for x in me.materials]
    if m.name in names: return names.index(m.name)
    me.materials.append(m); return len(names)

def paint(ob, faces, mat):
    """give some faces (by index, in the order they were built) another material"""
    s = slot(ob.data, mat)
    for i in faces: ob.data.polygons[i].material_index = s

def paint_path(ob, pts, mats):
    """repaint a tube by the stretch of its path each face is on: mats[j] for pts[j]..pts[j+1] (None keeps)"""
    mids = [(Vector(a) + Vector(b)) / 2 for a, b in zip(pts, pts[1:])]
    for f in ob.data.polygons:
        j = min(range(len(mids)), key=lambda i: (mids[i] - f.center).length_squared)
        if mats[j]: f.material_index = slot(ob.data, mats[j])

def decal(part, mat, pts, normal):
    """one flat polygon facing `normal` (lettering)"""
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new(Vector(p)) for p in pts]); bm.normal_update()
    if f.normal.dot(Vector(normal)) < 0: f.normal_flip()
    return _obj(bm, mat, part, smooth=False)

def strip(part, mat, rows, normal=(0, 1, 0)):
    """a ribbon of quads through pairs of points, facing `normal` (painted stripes)"""
    bm = bmesh.new(); vs = [[bm.verts.new(Vector(p)) for p in r] for r in rows]
    for a, b in zip(vs, vs[1:]): bm.faces.new((a[0], a[1], b[1], b[0]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.dot(Vector(normal)) < 0: f.normal_flip()
    return _obj(bm, mat, part, 80)

def ribbon(part, mat, pts, radii, ref, center):
    """a low ridge along pts lying on a surface (painted-on stripes): radii (height, half width) per point, the width
    runs along `ref`, the crest points away from `center`. Open underneath: only the side that shows is built."""
    pts = [Vector(p) for p in pts]; fr = _frames(pts, ref); bm = bmesh.new(); rows = []; outs = []
    for p, (t, n, bn), (rh, rw) in zip(pts, fr, radii):
        o = bn if bn.dot(p - Vector(center)) > 0 else -bn; outs.append(o)
        rows.append([bm.verts.new(p - n * rw), bm.verts.new(p + o * rh), bm.verts.new(p + n * rw)])
    for i in range(len(rows) - 1):
        a, b = rows[i], rows[i + 1]
        for j in (0, 1):
            f = bm.faces.new((a[j], a[j + 1], b[j + 1], b[j])); f.normal_update()
            if f.normal.dot(outs[i]) < 0: f.normal_flip()
    return _obj(bm, mat, part, 80)

def cone(part, mat, base, tip, u, w, seg=8, angle=80):
    """a soft cone from an ellipse (half-axis vectors u, w) around base up to tip"""
    bm = bmesh.new(); b = Vector(base); u = Vector(u); w = Vector(w); t = bm.verts.new(Vector(tip))
    ring = [bm.verts.new(b + u * math.cos(2 * PI * k / seg) + w * math.sin(2 * PI * k / seg)) for k in range(seg)]
    for k in range(seg): bm.faces.new((t, ring[k], ring[(k + 1) % seg]))
    bm.faces.new(list(reversed(ring)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, mat, part, angle)

def band(part, mat, c, axis, r_in, r_out, h, seg=16):
    """a strap around `axis` through c (a collar)"""
    q = Vector(axis).normalized().to_track_quat('Z', 'Y').to_matrix(); bm = bmesh.new(); secs = []
    for k in range(seg):
        a = 2 * PI * k / seg; d = Vector((math.cos(a), math.sin(a), 0))
        secs.append([bm.verts.new(Vector(c) + q @ (d * r + Vector((0, 0, z)))) for r, z in ((r_in, -h / 2), (r_out, -h / 2), (r_out, h / 2), (r_in, h / 2))])
    for k in range(seg):
        a, b = secs[k], secs[(k + 1) % seg]
        for j in range(4): bm.faces.new((a[j], a[(j + 1) % 4], b[(j + 1) % 4], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(bm, mat, part, 50)

def spline(ctrl, n):
    """n points along a smooth (Catmull-Rom) curve through the control points"""
    P = [Vector(c) for c in ctrl]; P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]; m = len(ctrl) - 1; out = []
    for i in range(n):
        u = i * m / (n - 1); j = min(int(u), m - 1); t = u - j; p0, p1, p2, p3 = P[j:j + 4]
        out.append(.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    return out

# ---------- the RC car ----------
CAR_WHEELS = {'wheelFL': (-.128, .055, -.145, .046), 'wheelFR': (.128, .055, -.145, .046),
              'wheelBL': (-.128, .055, .14, .054), 'wheelBR': (.128, .055, .14, .054)}  # pivot x, y, z, tire width
CAR_ANTENNA = (.08, .128, .17)
TIRE_R = .055  # the game spins the wheels at speed / .055

def wheel(part, c, w, side):
    """one closed turned shape: knobby tire, silver rim lip and barrel, dark dish; then a five-spoke star and a hub"""
    x, y, z = c; h = w / 2; SEG = 24
    prof = [(0, -h + .006), (.050, -h), (TIRE_R, -h + .010, 2), (TIRE_R, h - .010, 1), (.050, h), (.037, h + .001), (.032, h - .007), (0, h - .008)]
    ob = lathe(part, 'tire', c, prof, seg=SEG, side=side, angle=30, lug=.007)
    paint(ob, range(5 * SEG, 6 * SEG), 'rim'); paint(ob, range(6 * SEG, 7 * SEG), 'trim')
    out = []
    for k in range(5):
        a = 2 * PI * k / 5 + PI / 2
        out += [(.0335, a - .2), (.0335, a + .2), (.0125, a + PI / 5)]
    bm = bmesh.new(); lay = []
    for xo in (h - .0085, h - .0012):
        lay.append([bm.verts.new((x + side * xo, y + r * math.cos(a), z + r * math.sin(a))) for r, a in out])
    n = len(out); bm.faces.new(lay[1]); back = bm.faces.new(list(reversed(lay[0])))
    for i in range(n): bm.faces.new((lay[0][i], lay[0][(i + 1) % n], lay[1][(i + 1) % n], lay[1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bmesh.ops.delete(bm, geom=[back], context='FACES_ONLY')  # the back is never seen
    _obj(bm, 'rim', part, 40)
    cyl(part, 'rim', (x + side * (h - .0035), y, z), 'x', .0095, .009, seg=6, angle=50)

def build_car():
    P = 'body'
    # body shell: a loft of rounded sections from the nose (-Z) to the tail (+Z). It is waisted at both axles so the
    # wheels sit in real wells; the fenders below close the wells from above.
    S = [(-.250, .050, .086, .090, .086), (-.243, .042, .101, .104, .098), (-.228, .038, .107, .112, .106), (-.219, .038, .109, .113, .107),
         (-.210, .040, .111, .078, .096), (-.081, .040, .117, .078, .097), (-.072, .036, .118, .119, .113),
         (-.002, .036, .120, .121, .115), (.067, .036, .122, .121, .115), (.077, .040, .122, .094, .106), (.203, .040, .121, .094, .104),
         (.212, .039, .120, .115, .109), (.240, .044, .114, .108, .101), (.251, .054, .104, .092, .086)]
    loft(P, 'paint', [superellipse(z, yb, yt, hb, ht, n=3.6, k=20) for z, yb, yt, hb, ht in S], angle=40)
    # fenders: a rounded arch swept over each wheel, growing out of the hood and deck, with a thin black lip
    for n_, (x, y, z, w) in CAR_WHEELS.items():
        sx = math.copysign(1, x); xo = abs(x) + w / 2 - .002
        xi = .076 if z < 0 else .084  # the front pair steers (.42 rad): its wells are deeper
        sec = [(xi, .0515), (xo - .003, .062), (xo, .065), (xo, .069), (xo - .008, .074), (xo - .026, .077), (xi, .0535)]
        rings = [[Vector((sx * px, y + r * math.cos(a), z + r * math.sin(a))) for px, r in sec] for a in [math.radians(-108 + 21.6 * i) for i in range(11)]]
        fd = loft(P, 'paint', rings, angle=50)
        paint(fd, [i * len(sec) + 2 for i in range(len(rings) - 1)], 'trim')
    # glass cabin with painted roof and pillars
    C = [(-.072, .112, .118, .104, .100), (-.045, .112, .150, .104, .086), (-.015, .112, .170, .103, .078), (.03, .112, .176, .102, .076),
         (.085, .112, .172, .102, .078), (.118, .112, .152, .103, .088), (.140, .112, .124, .104, .100)]
    loft(P, 'glass', [superellipse(z, yb, yt, hb, ht, n=3.2, k=16) for z, yb, yt, hb, ht in C])
    rbox(P, 'paint', (0, .1765, .036), (.15, .009, .118), r=.0042, seg=1)
    for sx in (-1, 1):
        for a, b in [((.102, .114, -.071), (.078, .171, -.012)), ((.079, .174, .086), (.1, .118, .139)), ((.096, .114, .03), (.079, .176, .03))]:
            pa, pb = Vector((sx * a[0], a[1], a[2])), Vector((sx * b[0], b[1], b[2]))
            tube(P, 'paint', [pa, pb], [.0058, .0052], seg=6, ref=(0, 0, 1), cap0=False, cap1=False)
    # racing stripes over hood, roof and deck
    def top_y(z):
        for (z0, yb0, yt0, *_), (z1, yb1, yt1, *_) in zip(S, S[1:]):
            if z0 <= z <= z1: return yt0 + (yt1 - yt0) * (z - z0) / (z1 - z0)
        return S[-1][2]
    for sx in (-1, 1):
        for z0, z1 in ((-.238, -.074), (.142, .243)):
            zs = sorted({z0, z1} | {s[0] for s in S if z0 < s[0] < z1})
            strip(P, 'white', [[(sx * .011, top_y(z) + .003, z), (sx * .027, top_y(z) + .003, z)] for z in zs])
        strip(P, 'white', [[(sx * .011, .1832, z), (sx * .027, .1832, z)] for z in (-.018, .090)])
    # front: bumper, splitter, grille, round headlights in chrome bezels, two rally lamps on the hood
    rbox(P, 'trim', (0, .052, -.247), (.222, .03, .026), r=.011, seg=2)
    rbox(P, 'trim', (0, .039, -.252), (.228, .006, .024), r=.002, seg=1)
    rbox(P, 'trim', (0, .083, -.2465), (.086, .019, .012), r=.004, seg=1)
    for yy in (.0795, .0865): strip(P, 'rim', [[(-.037, yy + dy, -.2542), (.037, yy + dy, -.2542)] for dy in (-.0012, .0012)], (0, 0, -1))
    for sx in (-1, 1):
        cyl(P, 'rim', (sx * .072, .085, -.2435), 'z', .0165, .013, seg=12)
        cyl(P, 'light', (sx * .072, .085, -.2508), 'z', .0095, .003, seg=12, r2=.0128)
        tilt = (.15, 0, 0); d = Euler(tilt, 'XYZ').to_matrix() @ Vector((0, 0, 1)); c0 = Vector((sx * .042, .125, -.199))
        cyl(P, 'rim', c0 - d * .001, 'z', .0148, .016, seg=12, r2=.0095, rot=tilt)
        cyl(P, 'light', c0 - d * .0102, 'z', .0085, .0025, seg=10, r2=.0115, rot=tilt)
    # back: bumper, black tail panel with the lights, exhausts, wing
    rbox(P, 'trim', (0, .052, .247), (.218, .028, .026), r=.011, seg=2)
    rbox(P, 'trim', (0, .096, .2488), (.176, .021, .006), r=.002, seg=1)
    for sx in (-1, 1):
        rbox(P, 'tail', (sx * .064, .096, .2498), (.04, .014, .008), r=.0035, seg=1)
        cyl(P, 'rim', (sx * .05, .046, .262), 'z', .0095, .03, seg=10)
        cyl(P, 'trim', (sx * .05, .046, .2755), 'z', .0062, .004, seg=8)
        rbox(P, 'trim', (sx * .064, .136, .214), (.008, .03, .016), r=0, rot=(-.35, 0, 0))
        rbox(P, 'paint', (sx * .121, .152, .226), (.006, .03, .052), r=.0025, seg=1)
    rbox(P, 'paint', (0, .156, .228), (.244, .008, .05), r=.0035, seg=1, rot=(.12, 0, 0))
    # mirrors, door roundels with a 7 (one outline, laid out the right way round on each side), underbody
    SEVEN = [(-.0095, .0145), (-.0095, .0095), (.0035, .0095), (-.004, -.0145), (.002, -.0145), (.0105, .0105), (.0105, .0145)]
    for sx in (-1, 1):
        rbox(P, 'paint', (sx * .113, .1255, -.056), (.022, .013, .011), r=.004, seg=1)
        cyl(P, 'white', (sx * .1184, .076, -.002), 'x', .027, .003, seg=20, rot=(0, 0, sx * .07))
        decal(P, 'trim', [(sx * (.1220 - .07 * v), .076 + v, -.002 - sx * u) for u, v in SEVEN], (sx, 0, 0))
        rbox(P, 'trim', (sx * .113, .044, -.002), (.02, .014, .13), r=.003, seg=1)       # sill
    rbox(P, 'trim', (0, .028, 0), (.17, .012, .42), r=.004, seg=1)
    # antenna: base on the deck, a thin whip, a ball on top (sways about its base)
    ax, ay, az = CAR_ANTENNA
    cyl(P, 'trim', (ax, ay - .008, az), 'y', .0065, .014, seg=10)
    cyl('antenna', 'trim', (ax, ay + .07, az), 'y', .0024, .14, seg=5, r2=.0016)
    ell('antenna', 'paint', (ax, ay + .142, az), (.009, .009, .009), seg=8, rings=5)
    for n_, (x, y, z, w) in CAR_WHEELS.items(): wheel(n_, (x, y, z), w, 1 if x > 0 else -1)
    ANCH.update(cup=(0, .1815, .036), flame=[(-.05, .046, .278), (.05, .046, .278)])
    return {'body': (0, 0, 0), 'antenna': CAR_ANTENNA, **{n_: (x, y, z) for n_, (x, y, z, w) in CAR_WHEELS.items()}}

# ---------- the dog ----------
DOG = dict(head=(0, .42, -.27), tail=(0, .32, .2), legs={'legFL': (-.08, .205, -.15), 'legFR': (.08, .205, -.15), 'legBL': (-.08, .205, .15), 'legBR': (.08, .205, .15)})

def build_dog():
    P = 'body'
    # a plump bean of a torso: deep chest, round rump (no separate shoulder lumps: the legs carry their own)
    # (the spine and its radii are both smoothed, so the back and the rump have no corners)
    # the chest hangs low between the forelegs, the belly tucks up toward the hind legs, the rump rises a little
    spine = [(0, .282, -.165), (0, .268, -.10), (0, .274, -.02), (0, .285, .07), (0, .290, .135), (0, .288, .175)]
    girth = [(.090, .098), (.108, .118), (.103, .100), (.101, .087), (.104, .092), (.086, .082)]
    tube(P, 'fur', spline(spine, 9), [(r.x, r.y) for r in spline([(a, b, 0) for a, b in girth], 9)], seg=18, ref=(0, 1, 0))
    ell(P, 'furLight', (0, .238, -.211), (.058, .068, .05), seg=12, rings=8)           # fluffy chest
    tube(P, 'fur', [(0, .30, -.15), (0, .355, -.205), (0, .40, -.25)], [.078, .070, .066], seg=12, ref=(0, 0, -1), cap0=False, capn=2)
    # collar and tag
    band(P, 'collar', (0, .352, -.202), (0, 1, -1), .062, .079, .022, seg=14)
    cyl(P, 'tag', (0, .283, -.263), 'z', .014, .004, seg=10, rot=(-.3, 0, 0))
    # head: big and round, short light muzzle, long floppy ears
    H = 'head'; hx, hy, hz = DOG['head']
    def h(p): return (hx + p[0], hy + p[1], hz + p[2])
    ell(H, 'fur', h((0, .042, -.005)), (.11, .102, .104), seg=20, rings=12)
    ell(H, 'furLight', h((0, -.018, -.088)), (.058, .044, .058), seg=14, rings=10)      # muzzle
    ell(H, 'fur', h((0, .002, -.08)), (.042, .036, .054), seg=10, rings=6)             # bridge of the nose
    ell(H, 'nose', h((0, -.004, -.145)), (.0275, .0195, .017), seg=10, rings=6)         # (no catchlight: it read as a third eye)
    ell(H, 'pink', h((.004, -.058, -.118)), (.016, .008, .024), seg=8, rings=5, rot=(-.45, 0, 0))  # tongue
    tube(H, 'furDark', [h((-.026, -.04, -.131)), h((0, -.047, -.134)), h((.026, -.04, -.131))], [.003] * 3, seg=5, ref=(0, 0, -1), capn=1)  # smile
    for sx in (-1, 1):
        ell(H, 'eye', h((sx * .047, .052, -.094)), (.019, .023, .013), seg=10, rings=6)
        ell(H, 'shine', h((sx * .047 - .007, .062, -.105)), (.005, .005, .0028), seg=6, rings=4)
        ell(H, 'furDark', h((sx * .049, .087, -.086)), (.017, .0055, .008), seg=8, rings=4, rot=(0, 0, -sx * .18))
        ear = spline([h((sx * .072, .108, 0)), h((sx * .108, .09, .004)), h((sx * .123, .03, .004)), h((sx * .117, -.04, -.008)), h((sx * .104, -.082, -.016))], 8)
        tube(H, 'furDark', ear, [(.017, .027), (.015, .039), (.013, .046), (.011, .049), (.0095, .048), (.008, .043), (.007, .033), (.006, .018)],
             seg=10, ref=(0, 0, 1), capn=2, angle=180)  # thin leaves, cupped to the head, the bottom rounded off
    # legs: chunky and tapered with a soft knee; the hind pair has a broad thigh and a hock; big light paws
    for n_, (x, y, z) in DOG['legs'].items():
        if z < 0:
            tube(n_, 'fur', [(x, y + .03, z + .006), (x, y - .055, z + .009), (x, y - .13, z + .002), (x, y - .172, z - .002)],
                 [(.046, .054), (.037, .041), (.029, .030), (.026, .027)], seg=8, ref=(0, 0, -1), cap1=False)
            ell(n_, 'furLight', (x, .026, z - .019), (.04, .026, .044), seg=8, rings=5)
        else:
            tube(n_, 'fur', [(x, y + .034, z - .010), (x, y - .04, z - .022), (x, y - .10, z + .024), (x, y - .145, z + .017), (x, y - .172, z + .004)],
                 [(.047, .072), (.042, .054), (.030, .031), (.026, .027), (.026, .028)], seg=8, ref=(0, 0, -1), cap1=False)
            ell(n_, 'furLight', (x, .026, z - .005), (.04, .026, .044), seg=8, rings=5)
    # tail: a plume curving up over the back, tapering to a point; the light tip is the last fifth, with a ragged edge
    tail = spline([(0, .32, .19), (0, .34, .245), (0, .39, .285), (0, .45, .30), (0, .505, .287)], 10)
    tl = tube('tail', 'fur', tail, [.024, .028, .030, .030, .029, .027, .024, .020, .014, .007], seg=8, ref=(1, 0, 0), capn=2)
    paint_path(tl, tail, [None] * 7 + ['furLight'] * 2)
    t7 = (tail[8] - tail[6]).normalized()
    for k in range(8): tl.data.vertices[2 * 8 + 1 + 7 * 8 + k].co += t7 * (.011 if k % 2 else -.011)  # zig-zag the color edge (ring 7; the cap's 2 rings + tip come first)
    ANCH.update(cup=(0, .372, .03))
    return {'body': (0, 0, 0), 'head': DOG['head'], 'tail': DOG['tail'], **DOG['legs']}

# ---------- the cat ----------
CAT = dict(head=(0, .32, -.21), tail=(0, .2475, .16), legs={'legFL': (-.055, .165, -.12), 'legFR': (.055, .165, -.12), 'legBL': (-.055, .165, .12), 'legBR': (.055, .165, .12)})
CAT_TORSO = [(-.125, .224, .060, .066), (-.065, .214, .073, .081), (0, .213, .070, .077), (.07, .210, .071, .076), (.122, .220, .062, .066)]  # z, center y, half width, half height

def build_cat():
    P = 'body'; N = 16
    def ring(z, cy, w, hh): return [Vector((w * math.sin(2 * PI * k / N), cy + hh * math.cos(2 * PI * k / N), z)) for k in range(N)]
    def skin(z, a, lift=0.0):
        """a point on the torso: z along the body, a = angle from the spine toward +X"""
        for (z0, c0, w0, h0), (z1, c1, w1, h1) in zip(CAT_TORSO, CAT_TORSO[1:]):
            if z <= z1: break
        t = (z - z0) / (z1 - z0); cy = c0 + (c1 - c0) * t
        return Vector(((w0 + (w1 - w0) * t + lift) * math.sin(a), cy + (h0 + (h1 - h0) * t + lift) * math.cos(a), z))
    (z0, c0, w0, h0), (z1, c1, w1, h1) = CAT_TORSO[0], CAT_TORSO[-1]; dome = ((.97, .25), (.8, .6), (.45, .89))
    torso = loft(P, 'fur', [ring(z0 - .05 * s, c0, w0 * k, h0 * k) for s, k in dome] + [ring(*st) for st in CAT_TORSO]
                 + [ring(z1 + .05 * s, c1, w1 * k, h1 * k) for s, k in reversed(dome)], angle=75)
    paint(torso, [b * N + k for b in range(8) for k in ((6, 7, 8, 9) if b < 7 else (7, 8))], 'furLight')  # pale belly (seen in the flip)
    # tabby stripes: leaf-shaped ribbons laid into the skin over the back, on the torso's own vertex lines
    for zc in (-.088, -.044, 0, .044, .088):
        pts, rad = [], []
        for i in range(-3, 4):
            f = abs(i) / 3
            pts.append(skin(zc + .014 * f * f, i * 2 * PI / N, -.001)); rad.append((.003 - .0012 * f * f, .008 * (1 - f * f) ** .6 + .0018))
        ribbon(P, 'furStripe', pts, rad, (0, 0, 1), (0, .21, zc))
    ell(P, 'furLight', (0, .205, -.141), (.05, .056, .05), seg=14, rings=8)            # chest
    tube(P, 'fur', [(0, .235, -.115), (0, .275, -.158), (0, .31, -.195)], [.05, .046, .044], seg=10, ref=(0, 0, -1), cap0=False, capn=2)
    # head: wide and round with big eyes, soft pointed ears, a small snout (the Siamese mask)
    H = 'head'; hx, hy, hz = CAT['head']
    def h(p): return (hx + p[0], hy + p[1], hz + p[2])
    sk, sr = (0, .022, -.004), (.088, .072, .074)
    ell(H, 'fur', h(sk), sr, seg=20, rings=12)
    for x0 in (-.02, 0, .02):  # forehead stripes
        pts, rad = [], []
        for i in range(5):
            f = i / 4; ph = math.radians(42 + 66 * f); x = x0 * (1 + .2 * f); s = math.sqrt(1 - (x / sr[0]) ** 2); e = abs(2 * f - 1)
            pts.append(h((x, sk[1] + sr[1] * s * math.sin(ph), sk[2] - sr[2] * s * math.cos(ph)))); rad.append((.003 - .001 * e * e, .0055 * (1 - e * e) ** .6 + .0016))
        ribbon(H, 'furStripe', pts, rad, (1, 0, 0), h(sk))
    ell(H, 'furPoint', h((0, 0, -.03)), (.05, .04, .052), seg=12, rings=6)
    ell(H, 'pink', h((0, -.001, -.086)), (.01, .007, .006), seg=6, rings=4)
    for sx in (-1, 1):
        ell(H, 'furLight', h((sx * .014, -.012, -.074)), (.02, .015, .014), seg=8, rings=5)   # muzzle pads
        ey = -sx * .25; ef = Vector((sx * math.sin(.25), 0, -math.cos(.25))); ec = Vector((sx * .031, .024, -.0665))  # eyes turned to lie on the head's curve
        ell(H, 'iris', h(ec), (.021, .024, .011), seg=10, rings=6, rot=(0, ey, 0))
        ell(H, 'eye', h(ec + ef * .0065), (.0085, .018, .006), seg=8, rings=6, rot=(0, ey, 0))
        ell(H, 'shine', h(ec + ef * .0105 + Vector((-.007, .01, 0))), (.0055, .0055, .003), seg=6, rings=4)
        cone(H, 'furPoint', h((sx * .05, .055, .002)), h((sx * .074, .13, .004)), (sx * .0298, -.0163, 0), (0, 0, .02))
        cone(H, 'pink', h((sx * .052, .058, -.006)), h((sx * .071, .118, -.003)), (sx * .0202, -.011, 0), (0, 0, .012))
        ell(H, 'fur', h((sx * .061, -.021, -.016)), (.021, .017, .02), seg=8, rings=5, rot=(0, 0, sx * .5))  # cheek tuft: a soft bulge low on the cheek
        for k in range(3):  # whiskers
            a0 = h((sx * .028, -.012 + k * .005, -.08)); a1 = h((sx * .105, -.024 + k * .016, -.066))
            tube(H, 'whisker', [a0, a1], [.0012, .0008], seg=3, ref=(0, 1, 0), cap0=False, cap1=False, angle=180)
    # legs: slim, the hind pair with a thigh and a hock; small paws (dark on a Siamese)
    for n_, (x, y, z) in CAT['legs'].items():
        if z < 0:
            tube(n_, 'fur', [(x, y + .02, z + .006), (x, y - .05, z + .009), (x, y - .112, z + .001), (x, y - .142, z - .001)],
                 [(.030, .035), (.024, .026), (.0185, .019), (.0175, .0185)], seg=8, ref=(0, 0, -1), cap1=False)
            ell(n_, 'furPoint', (x, .018, z - .010), (.025, .018, .028), seg=8, rings=5)
        else:
            tube(n_, 'fur', [(x, y + .024, z - .006), (x, y - .034, z - .017), (x, y - .085, z + .019), (x, y - .122, z + .013), (x, y - .142, z + .003)],
                 [(.033, .050), (.029, .038), (.020, .021), (.0175, .0185), (.0175, .0185)], seg=8, ref=(0, 0, -1), cap1=False)
            ell(n_, 'furPoint', (x, .018, z - .003), (.025, .018, .028), seg=8, rings=5)
    # tail: a question-mark curl with tabby rings and a tip
    tx, ty, tz = CAT['tail']
    pts = spline([(tx, ty + dy, tz + dz) for dy, dz in ((-.006, -.024), (.012, .045), (.05, .096), (.11, .122), (.165, .114), (.2, .084), (.204, .052))], 13)
    tail = tube('tail', 'fur', pts, [.021 - .005 * i / 12 + (.008, .004, .0015)[i] if i < 3 else .021 - .005 * i / 12 for i in range(13)], seg=8, ref=(1, 0, 0), capn=2)
    paint_path(tail, pts, [None, None, None, 'furStripe', None, 'furStripe', None, 'furStripe', None, 'furStripe', 'furPoint', 'furPoint'])
    ANCH.update(cup=(0, .2805, .03))
    return {'body': (0, 0, 0), 'head': CAT['head'], 'tail': CAT['tail'], **CAT['legs']}

# ---------- joining, AO, export ----------
def join_parts(pivots):
    obs = {}
    for part, lst in PIECES.items():
        if part == 'cutter' or not lst: continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in lst: o.select_set(True)
        bpy.context.view_layer.objects.active = lst[0]
        if len(lst) > 1: bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active; ob.name = AV + '.' + part
        px = Vector(pivots[part]); ob.data.transform(Matrix.Translation(-px)); ob.location = px  # origin at the pivot
        obs[part] = ob
    PIECES.clear(); return obs

def bake_ao(obs, rays=36, dist=.11, floor=True):
    """per vertex: share of a cosine-weighted hemisphere that is open within dist (the ground counts as a blocker)"""
    verts, polys = [], []
    for ob in obs.values():
        mw = ob.matrix_world; base = len(verts)
        clear = {i for i, m in enumerate(ob.data.materials) if m.name.split(':')[-1] in ('glass', 'whisker', 'furStripe')}  # (stripes are paint: they must not shade the fur under them)
        verts += [mw @ v.co for v in ob.data.vertices]
        polys += [[base + i for i in p.vertices] for p in ob.data.polygons if p.material_index not in clear]
    tree = BVHTree.FromPolygons(verts, polys)
    dirs = []
    for i in range(rays):
        u, v = (i + .5) / rays, (i * .618034) % 1; r = math.sqrt(u); t = 2 * PI * v
        dirs.append(Vector((r * math.cos(t), r * math.sin(t), math.sqrt(max(0, 1 - u)))))
    for ob in obs.values():
        me = ob.data; mw = ob.matrix_world; nm = mw.to_3x3()
        if 'AO' in me.color_attributes: me.color_attributes.remove(me.color_attributes['AO'])
        ca = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER'); val = []
        for v in me.vertices:
            n = (nm @ v.normal).normalized(); q = n.to_track_quat('Z', 'Y'); p = mw @ v.co + n * .0015; hit = 0
            for d in dirs:
                w = q @ d
                if floor and w.y < 0 and p.y + w.y * dist < 0: hit += 1; continue
                if tree.ray_cast(p, w, dist)[0] is not None: hit += 1
            val.append(max(.3, 1 - .85 * hit / rays))
        for lp in me.loops:
            g = round(val[lp.vertex_index], 2); ca.data[lp.index].color = (g, g, g, 1)
        me.color_attributes.active_color = ca

Q = 20000  # positions are stored as int16 / Q meters
def b64(fmt, vals): return base64.b64encode(struct.pack('<%d%s' % (len(vals), fmt), *vals)).decode()

def pack(ob, pivot):
    me = ob.data; me.calc_loop_triangles(); cn = me.corner_normals; ao = me.color_attributes['AO'].data
    names = [m.name.split(':')[-1] for m in me.materials]; groups = {}
    for tri in me.loop_triangles:
        g = groups.setdefault(tri.material_index, {'map': {}, 'p': [], 'n': [], 'a': [], 'i': []})
        for li in tri.loops:
            co = me.vertices[me.loops[li].vertex_index].co; nv = cn[li].vector
            key = (round(co.x * Q), round(co.y * Q), round(co.z * Q), round(nv.x * 127), round(nv.y * 127), round(nv.z * 127), round(ao[li].color[0] * 255))
            idx = g['map'].get(key)
            if idx is None:
                idx = g['map'][key] = len(g['map']); g['p'] += key[:3]; g['n'] += key[3:6]; g['a'].append(key[6])
            g['i'].append(idx)
    mats = []
    for mi, g in sorted(groups.items()):
        assert len(g['map']) < 65536
        mats.append({'k': names[mi], 'p': b64('h', g['p']), 'n': b64('b', g['n']), 'a': b64('B', g['a']), 'i': b64('H', g['i'])})
    # crease lines for the line-art styles: sharp edges and open borders
    bm = bmesh.new(); bm.from_mesh(me); lines = []
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) == 1 or (len(lf) == 2 and e.calc_face_angle(0) > math.radians(55)):
            for v in e.verts: lines += [round(v.co.x * Q), round(v.co.y * Q), round(v.co.z * Q)]
    bm.free()
    tris = sum(len(g['i']) for g in groups.values()) // 3; nverts = sum(len(g['map']) for g in groups.values())
    return {'n': ob.name.split('.')[-1], 'o': [round(c, 4) for c in pivot], 'm': mats, 'l': b64('h', lines)}, tris, nverts, len(lines) // 6

BUILD = {'car': build_car, 'dog': build_dog, 'cat': build_cat}
SETS, DATA, STATS = {}, {}, {}
if os.path.exists(JS) and ONLY:  # rebuilding one: keep the others
    try: DATA = json.loads(open(JS, encoding='utf-8').read().split('=', 1)[1].rstrip().rstrip(';'))
    except Exception: DATA = {}
for av, fn in BUILD.items():
    if ONLY and av != ONLY: continue
    AV = av; ANCH.clear(); pivots = fn(); obs = join_parts(pivots); bake_ao(obs); SETS[av] = obs
    parts, T, V, L = [], 0, 0, 0
    for name, ob in obs.items():
        rec, t, v, l = pack(ob, pivots[name]); parts.append(rec); T += t; V += v; L += l
    rnd = lambda v: [rnd(x) for x in v] if isinstance(v, (list, tuple)) and v and isinstance(v[0], (list, tuple)) else [round(c, 4) for c in v]
    DATA[av] = {'parts': parts, 'at': {k: rnd(v) for k, v in ANCH.items()}}; STATS[av] = (T, V, L)
    print('built %-4s %d parts %6d tris %6d verts %5d lines' % (av, len(parts), T, V, L))
DATA['q'] = Q
js = '// generated by src/blender/avatars.py (Blender); do not edit by hand\nconst AVMESH=' + json.dumps(DATA, separators=(',', ':')) + ';\n'
open(JS, 'w', encoding='utf-8', newline='\n').write(js)
print('wrote', JS, '%.1f KB' % (len(js) / 1024))

if not RENDER: raise SystemExit

# ---------- preview renders (Eevee; nothing below is exported) ----------
sc = bpy.context.scene
def tryset(o, **kw):
    for k, v in kw.items():
        try: setattr(o, k, v)
        except Exception: pass
for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try: sc.render.engine = eng; break
    except Exception: continue
tryset(sc.eevee, taa_render_samples=48, use_shadows=True, use_raytracing=True, use_gtao=True)
tryset(sc.view_settings, view_transform='Standard', look='None')
def g2b(v): return Vector((v[0], -v[2], v[1]))  # game (Y up, front -Z) -> Blender (Z up)

def plain(name, rgb, rough=.8):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; return m
bpy.ops.mesh.primitive_plane_add(size=40); floor = bpy.context.object; floor.data.materials.append(plain('floor', (.62, .6, .57), .85))
world = bpy.data.worlds.new('studio'); world.use_nodes = True; sc.world = world; wn = world.node_tree
bg = wn.nodes['Background']; bg.inputs['Strength'].default_value = .65
tc = wn.nodes.new('ShaderNodeTexCoord'); sep = wn.nodes.new('ShaderNodeSeparateXYZ'); rng = wn.nodes.new('ShaderNodeMapRange'); mix = wn.nodes.new('ShaderNodeMix')
mix.data_type = 'RGBA'; mix.inputs[6].default_value = (.6, .6, .62, 1); mix.inputs[7].default_value = (1, 1, 1, 1)
rng.inputs['From Min'].default_value = -.3; rng.inputs['From Max'].default_value = .5
wn.links.new(tc.outputs['Generated'], sep.inputs[0]); wn.links.new(sep.outputs['Z'], rng.inputs['Value']); wn.links.new(rng.outputs[0], mix.inputs[0]); wn.links.new(mix.outputs[2], bg.inputs['Color'])
def sun(direction, energy, shadow):
    bpy.ops.object.light_add(type='SUN'); s = bpy.context.object; s.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    s.data.energy = energy; s.data.angle = math.radians(12); tryset(s.data, use_shadow=shadow, use_shadow_jitter=True)
sun((.35, .6, -.72), 2.4, True); sun((-.7, .45, -.35), .55, False)
bpy.ops.object.camera_add(); cam = bpy.context.object; sc.camera = cam

roots = {}
for av, obs in SETS.items():
    rt = bpy.data.objects.new(av + '.root', None); bpy.context.collection.objects.link(rt); rt.rotation_euler = (PI / 2, 0, 0)
    for ob in obs.values(): ob.parent = rt
    roots[av] = rt

def corners(obs):
    bpy.context.view_layer.update()
    return [o.matrix_world @ Vector(c) for o in obs for c in o.bound_box]
def shoot(obs, offset, lens, size, path, back=1.06):
    sc.render.resolution_x, sc.render.resolution_y = size; cam.data.lens = lens
    look = -Vector(offset).normalized(); cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    pts = corners(obs)
    co, _ = cam.camera_fit_coords(bpy.context.evaluated_depsgraph_get(), [c for p in pts for c in p])
    cam.location = co - look * ((sum(pts, Vector()) / len(pts) - co).length * (back - 1))
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)

# 1) the lineup, three-quarter front view
order = [a for a in ('car', 'dog', 'cat') if a in SETS]
for i, av in enumerate(order): roots[av].location = ((i - (len(order) - 1) / 2) * .62, 0, 0)
allobs = [o for av in order for o in SETS[av].values()]
shoot(allobs, g2b((-.55, .42, -1)), 60, (1800, 900), os.path.join(OUT, 'avatars.png'))
print('preview', os.path.join(OUT, 'avatars.png'))

# 2) turnaround: one row per avatar, four views each
TW, TH = 480, 360
views = [(-.6, .4, -1), (-1, .25, 0), (.7, .45, 1), (0, 1.6, -.25)]  # front left, side, back right, top-ish
tryset(sc.eevee, taa_render_samples=32)
sheet = array('f', [0.0]) * (TW * len(views) * TH * len(order) * 4)
for av in order:
    for o in SETS[av].values(): o.hide_render = True
for row, av in enumerate(order):
    roots[av].location = (0, 0, 0)
    for o in SETS[av].values(): o.hide_render = False
    for col, vw in enumerate(views):
        tile = os.path.join(OUT, '_tile.png'); shoot(list(SETS[av].values()), g2b(vw), 55, (TW, TH), tile, back=1.08)
        img = bpy.data.images.load(tile); px = array('f', [0.0]) * (TW * TH * 4); img.pixels.foreach_get(px)
        for r in range(TH):
            dst = (((len(order) - 1 - row) * TH + r) * TW * len(views) + col * TW) * 4
            sheet[dst:dst + TW * 4] = px[r * TW * 4:(r + 1) * TW * 4]
        bpy.data.images.remove(img); os.remove(tile)
    for o in SETS[av].values(): o.hide_render = True
out = bpy.data.images.new('turn', TW * len(views), TH * len(order), alpha=False); out.pixels.foreach_set(sheet)
out.filepath_raw = os.path.join(OUT, 'turnaround.png'); out.file_format = 'PNG'; out.save()
print('turnaround', out.filepath_raw)
