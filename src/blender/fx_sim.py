"""Pre-recorded physics moments for the game: simulated here (Bullet rigid bodies, a small particle system), played
back in the browser by src/js/game-2d-fx.js.

usage (no rendering, so no Cycles; one short simulation each, a few seconds of CPU on 4 threads):
  blender -b --factory-startup -t 4 --python src/blender/fx_sim.py -- <out dir> [--blend]
then: python -I src/tools/pack_fx.py <out dir>        (writes src/js/fx-data.js)

Moments (written to <out dir>/fx.json, in the game's axes: x = the way things fly, y up, meters, 30 fps)
  scatter  papers, a notebook, a mug, two pens, a block of sticky notes and two loose ones lie on a desk top (y = 0, the
           floor is .775 below) and get knocked off by a hard hit travelling along +x: a three-frame blast (a wind force field
           tilted upwards, plus turbulence) throws every piece, then Bullet does the rest (falls, bounces, slides).
           The desk collider is only the patch the things lie on (.78 x .78 m), so the clip works whichever way the
           desk is turned: a piece that passes the patch falls to the floor.
  splash   a burst of 48 droplets thrown up and towards +x from a point 0.995 m above the floor (a counter top),
           gravity, a floor they stick to. Newtonian particles with a collision plane.
Blender is Z-up, the game Y-up: game (x, y, z) = Blender (x, z, -y); quaternions are converted the same way.
"""
import bpy, sys, os, json, math, time, random
from mathutils import Vector, Euler

T0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
pos = [a for a in argv if not a.startswith('--')]
OUT = os.path.abspath(pos[0]) if pos else os.path.abspath('fx-out')
os.makedirs(OUT, exist_ok=True)
log = lambda *a: print('[fx %5.1fs]' % (time.time() - T0), *a, flush=True)
FPS = 30
DESK_TOP = .775
COUNTER_TOP = .995
BLAST = 1500.0         # strength of the hit
LIFT_DEG = 33        # how far the hit points upwards
MASS = {'paper': 1.0, 'note': .9, 'pen': 1.1, 'book': 1.6, 'mug': 1.5, 'stack': 1.5}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene; sc.render.fps = FPS; sc.frame_start = 1
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    return sc

def add_box(name, size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o

def add_cyl(name, r, h, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.active_object; o.name = name
    return o

def rigid(o, kind, shape, mass=1.0, friction=.6, bounce=.15, lin_damp=.04, ang_damp=.1):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.rigidbody.object_add(type=kind)
    rb = o.rigid_body; rb.collision_shape = shape; rb.mass = mass; rb.friction = friction; rb.restitution = bounce
    rb.use_margin = True; rb.collision_margin = .001; rb.linear_damping = lin_damp; rb.angular_damping = ang_damp
    return rb

def to_game(v): return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]
def quat_game(q): return [round(q.x, 5), round(q.z, 5), round(-q.y, 5), round(q.w, 5)]


# ---------------------------------------------------------------- desk scatter ---------------------------------------
def scatter():
    sc = reset(); N = 1 + int(1.8 * FPS)                 # frames recorded: 1.8 s
    sc.frame_end = N
    bpy.ops.rigidbody.world_add()
    rw = sc.rigidbody_world; rw.substeps_per_frame = 30; rw.solver_iterations = 30
    rw.point_cache.frame_start = 1; rw.point_cache.frame_end = N
    rigid(add_box('floor', (10, 10, .5), (0, 0, -DESK_TOP - .25)), 'PASSIVE', 'BOX', friction=.8, bounce=.1)
    rigid(add_box('desk', (.78, .78, .04), (0, 0, -.02)), 'PASSIVE', 'BOX', friction=.5, bounce=.1)
    pieces = []
    def piece(kind, color, shape, dims, loc, yaw, mass, lin_damp=.04, ang_damp=.1, lay=False):
        # dims: box (x, y, z) or cylinder (radius, height); lay: a cylinder lying on its side
        rot = (0, math.pi / 2 if lay else 0, yaw)
        if shape == 'box': o = add_box(kind, dims, loc, rot)
        else: o = add_cyl(kind, dims[0], dims[1], loc, rot)
        rigid(o, 'ACTIVE', 'BOX' if shape == 'box' else 'CYLINDER', mass, lin_damp=lin_damp, ang_damp=ang_damp)
        d = [dims[0], dims[2], dims[1]] if shape == 'box' else [dims[0], dims[1], dims[0]]      # game axes (cylinder: r, h, r)
        pieces.append({'o': o, 'kind': kind, 'c': color, 's': 'b' if shape == 'box' else 'c', 'd': [round(x, 4) for x in d], 'p': [], 'q': []})
    A4 = (.297, .21, .004)
    # a loose pile of paper, two more sheets, a notebook, a mug, two pens, sticky notes; everything within .33 m of the middle.
    # "mass" here only sets how hard the hit throws a piece (the blast below pushes every piece with the same force)
    piece('paper', 'paper', 'box', A4, (-.06, .07, .003), .1, MASS['paper'], .5, .5)
    piece('paper', 'paper', 'box', A4, (-.05, .08, .009), -.25, MASS['paper'] * .85, .5, .5)
    piece('paper', 'paper', 'box', A4, (-.07, .06, .015), .4, MASS['paper'] * 1.2, .5, .5)
    piece('paper', 'paper', 'box', A4, (.12, -.14, .003), 1.2, MASS['paper'] * .9, .5, .5)
    piece('paper', 'paper', 'box', A4, (.10, -.13, .009), 1.5, MASS['paper'] * 1.1, .5, .5)
    piece('notebook', 'book', 'box', (.21, .148, .016), (-.2, -.17, .009), -.3, MASS['book'])
    piece('mug', 'mug', 'cyl', (.041, .095), (.2, .2, .048), 0, MASS['mug'], ang_damp=.55)
    piece('pen', 'pen1', 'cyl', (.006, .14), (.0, -.27, .0065), .3, MASS['pen'], lay=True, ang_damp=.6)
    piece('pen', 'pen2', 'cyl', (.006, .14), (.06, -.3, .0065), -.5, MASS['pen'] * 1.2, lay=True, ang_damp=.6)
    piece('stickies', 'note', 'box', (.076, .076, .022), (-.23, .22, .012), .2, MASS['stack'])
    piece('sticky', 'note', 'box', (.076, .076, .004), (-.12, .25, .003), .5, MASS['note'], .6, .6)
    piece('sticky', 'note2', 'box', (.076, .076, .004), (.02, .26, .003), -.2, MASS['note'] * 1.15, .6, .6)
    # the hit: a three-frame blast of "wind" along +x, tilted up, plus a little turbulence so no two pieces leave alike
    bpy.ops.object.effector_add(type='WIND', location=(-2, 0, 0), rotation=(0, math.radians(90 - LIFT_DEG), 0))
    wind = bpy.context.active_object; wind.field.flow = 0; wind.field.noise = 0; wind.field.seed = 3
    bpy.ops.object.effector_add(type='TURBULENCE', location=(0, 0, 0))
    turb = bpy.context.active_object; turb.field.size = .25; turb.field.flow = 0; turb.field.seed = 9
    for fld, k in ((wind, BLAST), (turb, BLAST * 2.0)):
        fld.field.strength = k; fld.field.keyframe_insert('strength', frame=1); fld.field.keyframe_insert('strength', frame=3)
        fld.field.strength = 0; fld.field.keyframe_insert('strength', frame=4)
    last = None
    for f in range(1, N + 1):
        sc.frame_set(f)
        for p in pieces:
            m = p['o'].matrix_world; p['p'].append(to_game(m.translation)); p['q'].append(quat_game(m.to_quaternion()))
        if f == N - 1: last = [Vector(p['p'][-1]) for p in pieces]
        if f in (4, 5): log('frame', f, ' '.join('%s %.2f/%.2f' % (p['kind'][:3], (p['p'][-1][0] - p['p'][-2][0]) * FPS, (p['p'][-1][1] - p['p'][-2][1]) * FPS) for p in pieces))
    # report: where everything ended, how fast it still moves, how far past the desk patch it was when it dropped below the top
    for i, p in enumerate(pieces):
        end = Vector(p['p'][-1]); sp = (end - last[i]).length * FPS
        cross = next((q for q in p['p'] if q[1] < -.01), None)
        log('%-9s end (%.2f, %.2f, %.2f) speed %.2f m/s, left the top at x=%.2f z=%.2f' % (p['kind'], end.x, end.y, end.z, sp, cross[0] if cross else -9, cross[2] if cross else -9))
    if '--blend' in argv: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'scatter.blend'))
    return {'fps': FPS, 'frames': N, 'top': DESK_TOP, 'pieces': [{k: p[k] for k in ('kind', 'c', 's', 'd', 'p', 'q')} for p in pieces]}


# ---------------------------------------------------------------- splash ----------------------------------------------
def splash():
    sc = reset(); N = 1 + int(1.1 * FPS); COUNT = 48
    sc.frame_end = N
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -COUNTER_TOP))
    floor = bpy.context.active_object; floor.modifiers.new('collision', 'COLLISION')
    floor.collision.damping_factor = .9; floor.collision.damping_random = .1; floor.collision.friction_factor = .9; floor.collision.friction_random = .1
    bpy.ops.mesh.primitive_plane_add(size=.07, location=(.02, 0, .03))
    em = bpy.context.active_object
    em.modifiers.new('drops', 'PARTICLE_SYSTEM'); ps = em.particle_systems[0]; st = ps.settings
    ps.seed = 5
    st.count = COUNT; st.frame_start = 1; st.frame_end = 1; st.lifetime = 500; st.emit_from = 'FACE'; st.use_emit_random = True
    st.physics_type = 'NEWTON'; st.normal_factor = 0; st.object_align_factor = (.8, 0, 2.0); st.factor_random = 1.4
    st.drag_factor = .03; st.mass = 1; st.particle_size = .012; st.subframes = 6; st.use_die_on_collision = False
    st.render_type = 'NONE'; st.effector_weights.gravity = 1
    ps.point_cache.frame_start = 1; ps.point_cache.frame_end = N
    tracks = [[] for _ in range(COUNT)]
    for f in range(1, N + 1):
        sc.frame_set(f)
        pe = em.evaluated_get(bpy.context.evaluated_depsgraph_get()).particle_systems[0]
        for i, p in enumerate(pe.particles): tracks[i].append(to_game(p.location))
    floor_y = -COUNTER_TOP
    drops = []
    for t in tracks:
        if min(q[0] for q in t) < -.03:                 # everything flies to +x: mirror the few that went the other way
            t = [[-q[0], q[1], q[2]] for q in t]
        t = [[q[0], max(q[1], floor_y), q[2]] for q in t]
        land = next((i for i, q in enumerate(t) if i > 2 and q[1] < floor_y + .012), len(t) - 1)
        for i in range(land + 1, len(t)): t[i] = [t[land][0], floor_y, t[land][2]]      # it stays where it lands
        drops.append({'p': t, 'land': land})
    log('splash: %d drops, landing frames %d..%d, reach x %.2f..%.2f, z +-%.2f, top y %.2f' % (
        COUNT, min(d['land'] for d in drops), max(d['land'] for d in drops), min(d['p'][-1][0] for d in drops), max(d['p'][-1][0] for d in drops),
        max(abs(d['p'][-1][2]) for d in drops), max(q[1] for d in drops for q in d['p'])))
    if '--blend' in argv: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'splash.blend'))
    return {'fps': FPS, 'frames': N, 'h': COUNTER_TOP, 'drops': drops}


def main():
    a = scatter(); log('scatter simulated: %d pieces, %d frames' % (len(a['pieces']), a['frames']))
    b = splash(); log('splash simulated')
    json.dump({'scatter': a, 'splash': b}, open(os.path.join(OUT, 'fx.json'), 'w'), separators=(',', ':'))
    log('done')

main()
