"""Pack the furniture and lab models into src/js/kit-meshes.js (const KITMESH), so the page needs no model files.

usage: python -I src/tools/pack_kit.py

Sources (GLB, Y up, meters):
  src/assets/kenney/*.glb  Kenney Furniture Kit 2.1 (CC0, www.kenney.nl), the pieces the Studio style uses
  src/assets/lab/*.glb     lab props built in Blender from code (src/blender/props.py), with baked AO in COLOR_0
Each model is flattened (node transforms applied) and merged per material. Positions are int16 scaled per model,
normals int8, UVs uint16 (lab props only: their screens get a live image), AO uint8 (lab props only).
"""
import base64, json, math, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..'))
OUT = os.path.join(SRC, 'js', 'kit-meshes.js')
CT = {5120: 'b', 5121: 'B', 5122: 'h', 5123: 'H', 5125: 'I', 5126: 'f'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read(); off = 12; js = bins = None
    while off < len(b):
        n, kind = struct.unpack('<I4s', b[off:off + 8]); chunk = b[off + 8:off + 8 + n]; off += 8 + n
        if kind == b'JSON': js = json.loads(chunk)
        elif kind == b'BIN\x00': bins = chunk
    return js, bins


def accessor(g, bins, i):
    a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]; fmt = CT[a['componentType']]; nc = NC[a['type']]
    size = struct.calcsize(fmt); stride = bv.get('byteStride') or size * nc; base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    out = []
    for k in range(a['count']):
        o = base + k * stride; v = struct.unpack_from('<%d%s' % (nc, fmt), bins, o)
        if a.get('normalized'):
            m = {'B': 255, 'H': 65535, 'b': 127, 'h': 32767}[fmt]; v = tuple(max(-1, x / m) for x in v)
        out.append(v)
    return out


def mat4_mul(a, b):  # column-major 4x4
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]


def node_matrix(n):
    if 'matrix' in n: return list(n['matrix'])
    tx, ty, tz = n.get('translation', (0, 0, 0)); qx, qy, qz, qw = n.get('rotation', (0, 0, 0, 1)); sx, sy, sz = n.get('scale', (1, 1, 1))
    r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
         2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
         2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy)]
    return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1]


def xf_point(m, p): return tuple(m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] for r in range(3))
def xf_dir(m, d):
    v = tuple(m[r] * d[0] + m[4 + r] * d[1] + m[8 + r] * d[2] for r in range(3)); l = math.sqrt(sum(x * x for x in v)) or 1
    return tuple(x / l for x in v)  # (no non-uniform scale in these models)


def b64(fmt, vals): return base64.b64encode(struct.pack('<%d%s' % (len(vals), fmt), *vals)).decode()


def pack(path, keep_uv_ao):
    g, bins = read_glb(path); groups = {}; mats = g.get('materials', [])
    def walk(ni, parent):
        n = g['nodes'][ni]; m = mat4_mul(parent, node_matrix(n))
        if 'mesh' in n:
            for prim in g['meshes'][n['mesh']]['primitives']:
                at = prim['attributes']; P = accessor(g, bins, at['POSITION']); N = accessor(g, bins, at['NORMAL'])
                mi = prim.get('material'); name = mats[mi].get('name', 'mat%d' % mi) if mi is not None else '_defaultMat'
                U = accessor(g, bins, at['TEXCOORD_0']) if keep_uv_ao and name == 'screen' and 'TEXCOORD_0' in at else None  # only screens use UVs
                C = accessor(g, bins, at['COLOR_0']) if keep_uv_ao and 'COLOR_0' in at else None
                I = [i[0] for i in accessor(g, bins, prim['indices'])] if 'indices' in prim else list(range(len(P)))
                gr = groups.setdefault(name, {'v': [], 'i': [], 'mat': mats[mi] if mi is not None else {}})
                base = len(gr['v'])
                for k in range(len(P)):
                    gr['v'].append((xf_point(m, P[k]), xf_dir(m, N[k]), U[k] if U else None, C[k][0] if C else None))
                gr['i'] += [base + i for i in I]
        for c in n.get('children', []): walk(c, m)
    I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for ni in g['scenes'][g.get('scene', 0)]['nodes']: walk(ni, I4)
    ext = max(abs(c) for gr in groups.values() for v in gr['v'] for c in v[0]) or 1
    q = 32767 / ext; parts = []; tris = 0
    for name, gr in groups.items():
        pm = gr['mat'].get('pbrMetallicRoughness', {}); bc = pm.get('baseColorFactor', [1, 1, 1, 1])
        rec = {'k': name, 'c': [round(x, 4) for x in bc[:3]], 'r': round(pm.get('roughnessFactor', 1), 3), 'm': round(pm.get('metallicFactor', 1 if 'metallicFactor' not in pm else pm['metallicFactor']), 3)}
        if 'metallicFactor' not in pm: rec['m'] = 1.0  # glTF default
        em = gr['mat'].get('emissiveFactor')
        if em and any(em): rec['e'] = [round(x, 4) for x in em]
        if bc[3] < 1 or gr['mat'].get('alphaMode') == 'BLEND': rec['o'] = round(bc[3], 3)
        # flat-shaded groups (every corner normal = its face normal, as in Kenney's models): keep shared positions only,
        # the page splits them per face and recomputes the normals
        GV, GI = gr['v'], gr['i']
        def flat_ok():
            if any(v[2] is not None or v[3] is not None for v in GV): return False
            for t in range(0, len(GI), 3):
                a, b, c = (GV[GI[t + k]][0] for k in range(3))
                u = [b[i] - a[i] for i in range(3)]; w = [c[i] - a[i] for i in range(3)]
                n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; l = math.sqrt(sum(x * x for x in n))
                if l < 1e-12: continue
                n = [x / l for x in n]
                if any(sum(n[i] * GV[GI[t + k]][1][i] for i in range(3)) < .995 for k in range(3)): return False
            return True
        if flat_ok():
            remap, idx = {}, []
            for v in GV:
                key = tuple(round(c * q) for c in v[0]); remap.setdefault(key, len(remap)); idx.append(remap[key])
            V = list(remap.keys()); I = [idx[i] for i in GI]
            rec['f'] = 1; rec['p'] = b64('h', [c for v in V for c in v]); rec['i'] = b64('H' if len(V) < 65536 else 'I', I); rec['w'] = 2 if len(V) < 65536 else 4
            parts.append(rec); tris += len(I) // 3; continue
        # quantize, then share identical vertices
        remap, V, idx = {}, [], []
        for v in gr['v']:
            key = (tuple(round(c * q) for c in v[0]), tuple(round(c * 127) for c in v[1]),
                   tuple(round(min(1, max(0, c)) * 65535) for c in v[2]) if v[2] is not None else None, round(min(1, max(0, v[3])) * 255) if v[3] is not None else None)
            remap.setdefault(key, len(remap)); idx.append(remap[key])
        V = list(remap.keys()); gr['i'] = [idx[i] for i in gr['i']]
        rec['p'] = b64('h', [c for v in V for c in v[0]])
        rec['n'] = b64('b', [c for v in V for c in v[1]])
        if V and V[0][2] is not None: rec['u'] = b64('H', [c for v in V for c in v[2]])
        if V and V[0][3] is not None: rec['a'] = b64('B', [v[3] for v in V])
        rec['i'] = b64('H' if len(V) < 65536 else 'I', gr['i']); rec['w'] = 2 if len(V) < 65536 else 4
        parts.append(rec); tris += len(gr['i']) // 3
    return {'q': round(q, 3), 'parts': parts}, tris


def main():
    out, total = {}, 0
    for sub, keep in (('kenney', False), ('lab', True)):
        d = os.path.join(SRC, 'assets', sub)
        for f in sorted(os.listdir(d)):
            if not f.endswith('.glb'): continue
            rec, tris = pack(os.path.join(d, f), keep); out[f[:-4]] = rec; total += tris
            print('%-26s %6d tris' % (f, tris))
    js = ('// generated by src/tools/pack_kit.py from src/assets (Kenney Furniture Kit, CC0, www.kenney.nl; lab props from src/blender/props.py)\n'
          '// do not edit by hand\nconst KITMESH=' + json.dumps(out, separators=(',', ':')) + ';\n')
    open(OUT, 'w', encoding='utf-8', newline='\n').write(js)
    print('wrote %s  %d models  %d tris  %.1f KB' % (OUT, len(out), total, len(js) / 1024))


main()
