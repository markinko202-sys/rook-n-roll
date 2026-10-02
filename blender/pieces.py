# The 18 chess characters (6 per arena) → assets/pieces_<arena>.glb
#   blender -b --python blender/pieces.py -- [candy|spooky|galaxy|all] [render]
# Every piece: root → base (team puck) + body (empty at the top of the puck) → figure mesh,
# optional "brows" (dark team only) and "wingL"/"wingR" (flap in-game).
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Quaternion, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import (ball, rbox, cyl, torus, capsule, cone, lathe, prism, metaball, join, Face, uid, subdiv, bevel,
                 base_disc, crown, tiara, assemble, mat, puffy_star, apply_tf, origin_to, RAINBOW)

K = 1 / 0.575          # metaball radius → visible radius (stiffness 2, threshold 0.6)
def B(co, R, **kw): return {"co": co, "r": R * K, **kw}
def E(co, R, size, rot=None):
    e = {"co": co, "r": R * K, "type": "ELLIPSOID", "size": size}
    if rot is not None: e["rot"] = rot
    return e

def fib_dirs(n):
    out = []
    g = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        out.append(Vector((math.cos(g * i) * r, math.sin(g * i) * r, z)))
    return out

def ribbed_lathe(name, profile, ribs, amp, material, steps=96):
    """Lathe whose radius ripples with `ribs` folds (cupcake paper, pumpkin)."""
    bm = bmesh.new(); rings = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        k = 1 + amp * math.cos(ribs * a)
        rings.append([bm.verts.new((r * k * math.cos(a), r * k * math.sin(a), z)) for r, z in profile])
    for i in range(steps):
        r0, r1 = rings[i], rings[(i + 1) % steps]
        for j in range(len(profile) - 1): bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    if profile[0][0] > 1e-4: bm.faces.new([rings[i][0] for i in reversed(range(steps))])
    if profile[-1][0] > 1e-4: bm.faces.new([rings[i][-1] for i in range(steps)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return lib.mesh_from_bm(name, bm, material)

def twisted_cone(name, r, h, base, direction, material, turns=1.5, sides=6, rows=14):
    bm = bmesh.new(); rings = []
    for j in range(rows + 1):
        t = j / rows; rr = r * (1 - t) + 0.002
        rings.append([bm.verts.new((rr * math.cos(2 * math.pi * i / sides + turns * 2 * math.pi * t),
                                    rr * math.sin(2 * math.pi * i / sides + turns * 2 * math.pi * t), h * t)) for i in range(sides)])
    for j in range(rows):
        for i in range(sides):
            bm.faces.new((rings[j][i], rings[j][(i + 1) % sides], rings[j + 1][(i + 1) % sides], rings[j + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    o = lib.mesh_from_bm(name, bm, material)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector(direction).normalized().to_track_quat('Z', 'Y')
    o.location = base; apply_tf(o)
    return o

def tube(name, pts, radii, material, res=6):
    """Curve through pts with per-point radius (swirls, tails, stems)."""
    cu = bpy.data.curves.new(uid(name), 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for i, (p, r) in enumerate(zip(pts, radii)):
        sp.points[i].co = (*p, 1); sp.points[i].radius = r
    cu.bevel_depth = 1.0; cu.bevel_resolution = res; cu.use_fill_caps = True
    o = bpy.data.objects.new(uid(name), cu); lib.scn.collection.objects.link(o)
    lib.select_only(o); bpy.ops.object.convert(target='MESH')
    o = bpy.context.object
    return lib._finish(o, uid(name), None, material, True)

def sprinkles(target, centre, n, rng, zmin, zmax, length=0.03):
    """Little rainbow capsules stuck to a surface."""
    from mathutils.bvhtree import BVHTree
    bvh = BVHTree.FromObject(target, bpy.context.evaluated_depsgraph_get())
    out = []; mats = lib.rainbow_mats() + [lib._mats["white"]]
    tries = 0
    while len(out) < n and tries < n * 20:
        tries += 1
        a = rng.uniform(0, 2 * math.pi); z = rng.uniform(zmin, zmax)
        d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.3, 0.6))).normalized()
        origin = Vector((centre[0], centre[1], z)) + d * 1.0
        loc, nrm, _, _ = bvh.ray_cast(origin, -d, 2.0)
        if loc is None: continue
        t = nrm.cross(Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))).normalized() * length / 2
        out.append(capsule(uid("spr"), loc - t + nrm * 0.004, loc + t + nrm * 0.004, 0.009, rng.choice(mats), seg=8))
    return out

def back_cape(profile, material, cut=0.03):
    """Half shell behind the figure (capes, vampire collars). profile: (radius, z) bottom → top."""
    cape = lathe(uid("cape"), profile, material, steps=64)
    bm = bmesh.new(); bm.from_mesh(cape.data)
    bmesh.ops.delete(bm, geom=[f_ for f_ in bm.faces if f_.calc_center_median().y < cut], context='FACES')
    bm.to_mesh(cape.data); bm.free()
    m_ = cape.modifiers.new("sol", 'SOLIDIFY'); m_.thickness = 0.018
    lib.apply_mods(cape); subdiv(cape, 1)
    return cape

def gown(profile, material):
    g = lathe(uid("gown"), profile, material, steps=64)
    subdiv(g, 1)
    return g

def sphere_profile(R, Rz, cz, n=14):
    return [(max(0.0, R * math.cos(-math.pi / 2 + math.pi * i / n)), cz + Rz * math.sin(-math.pi / 2 + math.pi * i / n)) for i in range(n + 1)]

# =================================================================== PONY (knight of every arena)
def pony(T, M, style):
    look = Vector((0.6, -1, 0)).normalized()
    hc = Vector((0.15, -0.06, 0.72))
    side = Vector((0, 0, 1)).cross(look).normalized()     # the pony's lateral axis at the head
    el = []
    for x in (-0.1, 0.1):
        for y in (-0.072, 0.072):
            for z in (0.15, 0.2, 0.25, 0.3):
                el.append(B((x, y, z), 0.042))
    el += [B((-0.08, 0, 0.385), 0.12), B((0.05, 0, 0.39), 0.125), B((0.11, -0.01, 0.47), 0.085),
           B((0.135, -0.03, 0.56), 0.075), B((hc.x, hc.y, hc.z), 0.15),
           E(tuple(hc + look * 0.115 + Vector((0, 0, -0.06))), 0.085, (1.15, 1.0, 0.85),
             rot=look.to_track_quat('X', 'Z'))]
    figure = metaball("ponybody", el, T["main"], res=0.016)
    parts = [figure]
    # hooves
    for x in (-0.1, 0.1):
        for y in (-0.072, 0.072):
            parts.append(cyl(uid("hoof"), 0.05, 0.05, (x, y, 0.125), T["accent"], verts=28, round_edges=0.012))
    # face
    f = Face(figure, hc + look * 0.05, front=look)
    parts += f.eyes(0.062, 0.025, 0.034, 0.052, M)
    parts += f.blush(0.1, -0.025, 0.03, M)
    fs = Face(figure, hc + look * 0.1 + Vector((0, 0, -0.06)), front=look)
    parts += [fs.disc(-0.028, 0.0, 0.012, 0.008, 0.006, M["mouth"], "nostril"), fs.disc(0.028, 0.0, 0.012, 0.008, 0.006, M["mouth"], "nostril")]
    parts += fs.smile(-0.035, 0.03, 0.012, M, thick=0.008)
    brows = f.brows(0.062, 0.09, 0.04, 0.008, M)
    # ears
    for s in (-1, 1):
        p = hc + side * (0.075 * s) + Vector((0, 0, 0.11)) - look * 0.02
        d = (side * (0.3 * s) + Vector((0, 0, 1)) - look * 0.1)
        parts.append(cone(uid("ear"), 0.042, 0.1, p, d, T["main"], verts=20))
        parts.append(cone(uid("earin"), 0.022, 0.07, p + look * 0.016 + Vector((0, 0, 0.01)), d, M["blush"], verts=16))
    extras = [brows]
    mane_path = [hc + look * 0.11 + Vector((0, 0, 0.125)), hc + Vector((0, 0, 0.165)) - look * 0.03,
                 hc - look * 0.11 + Vector((0, 0, 0.12)), Vector((0.07, 0.02, 0.63)), Vector((0.03, 0.02, 0.54)),
                 Vector((-0.03, 0.02, 0.48))]
    tail_path = [Vector((-0.2, 0, 0.43)), Vector((-0.27, 0, 0.46)), Vector((-0.32, 0, 0.42)), Vector((-0.34, 0, 0.35)), Vector((-0.32, 0, 0.28))]
    def along(path, n):
        pts = []
        for i in range(n):
            t = i / (n - 1) * (len(path) - 1); k = min(int(t), len(path) - 2); u = t - k
            pts.append(path[k].lerp(path[k + 1], u))
        return pts
    if style == "rainbow":
        rb = lib.rainbow_mats()
        for i, p in enumerate(along(mane_path, 14)):
            parts.append(ball(uid("mane"), 0.068 - 0.0016 * i, p, rb[min(5, i * 6 // 14)], seg=24, rings=12))
        for i, p in enumerate(along(tail_path, 10)):
            parts.append(ball(uid("tail"), 0.06 - 0.003 * i, p, rb[min(5, i * 6 // 10)], seg=24, rings=12))
        parts.append(twisted_cone(uid("horn"), 0.032, 0.16, hc + look * 0.075 + Vector((0, 0, 0.115)), look * 0.45 + Vector((0, 0, 1)), M["gold"]))
    elif style == "flame":
        flame = [mat("flame1", "#B07CFF", emit=2.5, rough=0.3, coat=0.2), mat("flame2", "#5CFFB0", emit=2.5, rough=0.3, coat=0.2)]
        for i, p in enumerate(along(mane_path, 9)):
            d = (Vector((0, 0, 1)) - look * 0.6 + Vector((-0.4, 0, 0))).normalized()
            parts.append(cone(uid("fl"), 0.05 - 0.002 * i, 0.13 - 0.004 * i, p - d * 0.03, d, flame[i % 2], verts=16))
        for i, p in enumerate(along(tail_path, 6)):
            d = Vector((-1, 0, 0.5 - 0.2 * i)).normalized()
            parts.append(cone(uid("fl"), 0.05 - 0.004 * i, 0.12, p - d * 0.03, d, flame[i % 2], verts=16))
        # little bat wings
        for s, nm in ((1, "wingL"), (-1, "wingR")):
            w = bat_wing(nm, 0.3, T["accent"], M)
            w.rotation_euler = (0, math.radians(-18), math.radians(115 * s))
            pivot = Vector((-0.02, 0.1 * s, 0.47))
            w.location = pivot; apply_tf(w)
            origin_to(w, pivot)
            extras.append(w)
    elif style == "comet":
        comet = [mat(f"comet{i}", c, emit=2.2, rough=0.25, coat=0.3) for i, c in enumerate(["#4DE1FF", "#7C8CFF", "#C46BFF", "#FF4FD8"])]
        for i, p in enumerate(along(mane_path, 8)):
            d = (-look * 0.4 + Vector((-1, 0, 0.35))).normalized()
            q = d.to_track_quat('Z', 'Y')
            parts.append(ball(uid("cm"), 1, p + d * 0.04, comet[i * 4 // 8], scale=(0.05, 0.05, 0.11 - 0.004 * i), rot=q, seg=20, rings=12))
        for i, p in enumerate(along(tail_path, 6)):
            d = Vector((-1, 0, 0.2)).normalized(); q = d.to_track_quat('Z', 'Y')
            parts.append(ball(uid("cm"), 1, p + d * 0.03, comet[i * 4 // 6], scale=(0.05, 0.05, 0.1), rot=q, seg=20, rings=12))
        parts.append(puffy_star(uid("fstar"), 0.05, 0.022, 0.02, hc + look * 0.13 + Vector((0, 0, 0.085)), M["gold"], rot_y=0))
    return parts, extras

def bat_wing(name, span, material, M):
    """Scalloped bat wing in the X/Z plane (span along +X), thin along Y."""
    s = span
    pts = [(0, 0), (s * 0.25, s * 0.28), (s * 0.6, s * 0.42), (s, s * 0.38), (s * 0.82, s * 0.16),
           (s * 0.7, s * 0.2), (s * 0.55, s * 0.04), (s * 0.4, s * 0.12), (s * 0.25, -s * 0.04), (s * 0.12, s * 0.02)]
    o = prism(name, pts, 0.016, material)
    bevel(o, 0.006, 2)
    lib._finish(o, name, None, material, True)
    return o

# =================================================================== CANDY CLOUDS
def candy(rng):
    T = lib.team_mats("candy"); M = lib.common_mats()
    cream = mat("cream", "#FFE6D2", rough=0.45, coat=0.5)
    cake = mat("cake", "#E9A46A", rough=0.55, coat=0.3)
    cherry = mat("cherry", "#FF2E5B", rough=0.1, coat=1.0)
    stem = mat("stem", "#5BBF4A", rough=0.4)
    out = []

    # ---- pawn: Fluff the cloud lamb
    el = [B((0, 0, 0.36), 0.19)]
    for d in fib_dirs(22):
        if d.z < -0.55 or (d.y < -0.6 and abs(d.x) < 0.5 and d.z < 0.55): continue
        el.append(B(tuple(Vector((0, 0, 0.36)) + Vector((d.x * 1.0, d.y * 0.95, d.z * 1.05)) * 0.16), 0.075))
    fleece = metaball("fleece", el, T["main"], res=0.016)
    face = ball(uid("lambface"), 1, (0, -0.15, 0.335), cream, scale=(0.12, 0.09, 0.115))
    parts = [fleece, face]
    for s in (-1, 1):
        parts.append(ball(uid("ear"), 1, (0.16 * s, -0.08, 0.38), cream, scale=(0.075, 0.032, 0.04),
                          rot=Quaternion((0, 1, 0), math.radians(28 * s))))
        parts.append(capsule(uid("leg"), (0.07 * s, -0.08, 0.12), (0.07 * s, -0.08, 0.2), 0.04, cream))
        parts.append(cyl(uid("hoof"), 0.043, 0.035, (0.07 * s, -0.08, 0.118), T["accent"], verts=24, round_edges=0.01))
    f = Face(face, (0, -0.25, 0.34))
    parts += f.eyes(0.048, 0.012, 0.026, 0.04, M)
    parts += f.blush(0.078, -0.03, 0.026, M)
    parts += f.smile(-0.035, 0.025, 0.01, M, thick=0.008)
    out.append(assemble("candy_pawn", base_disc(T, M, 0.33), parts, [f.brows(0.048, 0.07, 0.034, 0.008, M)]))

    # ---- knight: rainbow unicorn pony
    parts, extras = pony(T, M, "rainbow")
    out.append(assemble("candy_knight", base_disc(T, M), parts, extras))

    # ---- bishop: cupcake wizard (swirled frosting = mitre)
    wrapper = ribbed_lathe(uid("wrapper"), [(0.0, 0.1), (0.14, 0.1), (0.15, 0.105), (0.2, 0.33), (0.0, 0.33)], 18, 0.05, T["accent"])
    dome = ball(uid("cakedome"), 0.205, (0, 0, 0.33), cake, scale=(1, 1, 0.42))
    n = 90; pts = []; radii = []
    for i in range(n):
        t = i / (n - 1); a = t * 3.4 * 2 * math.pi
        R = 0.13 * (1 - t) + 0.012
        pts.append((R * math.cos(a), R * math.sin(a), 0.4 + 0.27 * t)); radii.append(0.068 * (1 - t) + 0.026)
    swirl = tube("swirl", pts, radii, T["main"], res=8)
    tip = cone(uid("tip"), 0.03, 0.06, (pts[-1][0], pts[-1][1], 0.68), (0.4, 0, 1), T["main"], verts=20)
    parts = [wrapper, dome, swirl, tip]
    parts += sprinkles(swirl, (0, 0, 0), 16, rng, 0.42, 0.62)
    parts.append(ball(uid("cherry"), 0.045, (0.0, 0.0, 0.73), cherry, seg=28, rings=14))
    parts.append(tube("stem", [(0, 0, 0.765), (0.01, 0, 0.8), (0.035, 0, 0.82)], [0.007, 0.006, 0.005], stem))
    f = Face(wrapper, (0, -0.25, 0.23))
    parts += f.eyes(0.06, 0.0, 0.03, 0.046, M)
    parts += f.blush(0.1, -0.03, 0.028, M)
    parts += f.smile(-0.045, 0.028, 0.012, M)
    out.append(assemble("candy_bishop", base_disc(T, M), parts, [f.brows(0.06, 0.06, 0.04, 0.008, M)]))

    # ---- rook: two-tier cake castle with a birthday candle
    t1 = cyl(uid("tier1"), 0.26, 0.2, (0, 0, 0.2), T["main"], verts=64, round_edges=0.035)
    t2 = cyl(uid("tier2"), 0.2, 0.26, (0, 0, 0.43), T["main"], verts=64, round_edges=0.035)
    parts = [t1, t2]
    for z, R, n in ((0.3, 0.245, 12), (0.56, 0.185, 10)):
        parts.append(torus(uid("drip"), R, 0.026, (0, 0, z - 0.006), T["accent"], seg=64))
        for i in range(n):
            a = 2 * math.pi * (i + 0.5) / n
            L = 0.04 + 0.035 * ((i * 7) % 3) / 2
            parts.append(capsule(uid("drop"), (R * math.cos(a) * 1.04, R * math.sin(a) * 1.04, z - 0.01),
                                 (R * math.cos(a) * 1.06, R * math.sin(a) * 1.06, z - 0.01 - L), 0.02, T["accent"], seg=12))
    for i in range(6):
        a = 2 * math.pi * i / 6 + math.pi / 6
        parts.append(rbox(uid("crenel"), (0.085, 0.07, 0.08), (0.16 * math.cos(a), 0.16 * math.sin(a), 0.6), T["accent"],
                          radius=0.025, rot=(0, 0, a)))
    parts.append(cyl(uid("candle"), 0.025, 0.11, (0, 0, 0.62), M["white"], verts=24))
    for z in (0.59, 0.625, 0.66): parts.append(torus(uid("cstripe"), 0.026, 0.006, (0, 0, z), lib.rainbow_mats()[0], seg=24, mseg=6))
    parts.append(ball(uid("flame"), 0.024, (0, 0, 0.705), mat("candleflame", "#FFB938", emit=4.0, coat=0), scale=(1, 1, 1.7)))
    parts += sprinkles(t1, (0, 0, 0), 14, rng, 0.13, 0.26)
    f = Face(t2, (0, -0.25, 0.43))
    parts += f.eyes(0.066, 0.012, 0.032, 0.05, M)
    parts += f.blush(0.11, -0.025, 0.03, M)
    parts += f.smile(-0.045, 0.03, 0.013, M)
    out.append(assemble("candy_rook", base_disc(T, M), parts, [f.brows(0.066, 0.075, 0.042, 0.009, M)]))

    # ---- queen: bunny queen with a star wand
    gown = lathe(uid("gown"), [(0.0, 0.1), (0.27, 0.1), (0.275, 0.13), (0.22, 0.22), (0.15, 0.34), (0.11, 0.44), (0.1, 0.49), (0.0, 0.5)], T["accent"], steps=64)
    subdiv(gown, 1)
    parts = [gown, torus(uid("hem"), 0.262, 0.03, (0, 0, 0.13), M["white"], seg=64)]
    parts.append(ball(uid("torso"), 0.115, (0, 0, 0.52), T["accent"], scale=(1, 0.9, 1.0)))
    head = ball(uid("head"), 0.155, (0, 0, 0.7), T["main"])
    parts.append(head)
    for s in (-1, 1):
        q = Quaternion((0, 1, 0), math.radians(-14 * s))
        parts.append(ball(uid("ear"), 1, (0.075 * s, 0.01, 0.9), T["main"], scale=(0.045, 0.03, 0.15), rot=q))
        parts.append(ball(uid("earin"), 1, (0.077 * s, -0.012, 0.905), M["blush"], scale=(0.024, 0.014, 0.11), rot=q))
        parts.append(capsule(uid("arm"), (0.1 * s, 0, 0.55), (0.15 * s, -0.08, 0.45), 0.034, T["main"]))
    for i in range(14):
        a = 2 * math.pi * i / 14
        parts.append(ball(uid("pearl"), 0.016, (0.095 * math.cos(a), 0.085 * math.sin(a), 0.585), M["white"], seg=12, rings=6))
    parts.append(capsule(uid("wand"), (0.15, -0.08, 0.42), (0.17, -0.1, 0.66), 0.01, M["gold"], seg=10))
    parts.append(puffy_star(uid("wandstar"), 0.055, 0.025, 0.025, (0.172, -0.102, 0.69), M["gold"]))
    parts += tiara((0, 0, 0.835), 0.058, M, gem="ruby")
    f = Face(head, (0, -0.2, 0.69))
    parts += f.eyes(0.058, 0.02, 0.03, 0.046, M)
    parts += f.blush(0.095, -0.03, 0.028, M)
    parts.append(f.disc(0, -0.022, 0.016, 0.012, 0.012, M["tongue"], "nose", lift=0.006))
    parts += f.smile(-0.05, 0.024, 0.01, M, thick=0.008)
    out.append(assemble("candy_queen", base_disc(T, M), parts, [f.brows(0.058, 0.075, 0.036, 0.008, M)]))

    # ---- king: teddy king with crown and cape
    parts = [ball(uid("tbody"), 0.2, (0, 0, 0.36), T["main"], scale=(1, 0.92, 1.05))]
    belly = ball(uid("belly"), 1, (0, -0.125, 0.34), cream, scale=(0.13, 0.08, 0.14))
    parts.append(belly)
    for s in (-1, 1):
        parts.append(ball(uid("foot"), 0.07, (0.1 * s, -0.1, 0.15), T["main"], scale=(1, 1.25, 0.72)))
        parts.append(ball(uid("pad"), 1, (0.1 * s, -0.185, 0.155), cream, scale=(0.045, 0.012, 0.035)))
        parts.append(capsule(uid("arm"), (0.17 * s, 0, 0.46), (0.21 * s, -0.08, 0.33), 0.055, T["main"]))
        parts.append(ball(uid("ear"), 0.06, (0.13 * s, 0.0, 0.85), T["main"], scale=(1, 0.65, 1)))
        parts.append(ball(uid("earin"), 0.035, (0.13 * s, -0.03, 0.85), cream, scale=(1, 0.4, 1)))
    parts.append(back_cape([(0.225, 0.12), (0.225, 0.3), (0.19, 0.48), (0.16, 0.57)], T["accent"]))
    for i in range(16):
        a = 2 * math.pi * i / 16
        parts.append(ball(uid("fur"), 0.042, (0.165 * math.cos(a), 0.15 * math.sin(a), 0.56), M["white"], seg=16, rings=8))
        if i % 3 == 0: parts.append(ball(uid("dot"), 0.012, (0.2 * math.cos(a), 0.185 * math.sin(a), 0.56), M["eye"], seg=8, rings=4))
    head = ball(uid("head"), 0.18, (0, 0, 0.71), T["main"])
    muzzle = ball(uid("muzzle"), 1, (0, -0.145, 0.66), cream, scale=(0.085, 0.06, 0.065))
    parts += [head, muzzle]
    parts.append(ball(uid("nose"), 1, (0, -0.2, 0.68), M["eye"], scale=(0.032, 0.02, 0.022)))
    parts.append(ball(uid("nshine"), 0.008, (-0.01, -0.215, 0.69), M["shine"], seg=8, rings=4))
    f = Face(head, (0, -0.22, 0.73))
    parts += f.eyes(0.068, 0.025, 0.03, 0.045, M)
    parts += f.blush(0.11, -0.025, 0.03, M)
    fm = Face(muzzle, (0, -0.25, 0.65))
    parts += fm.smile(-0.012, 0.025, 0.01, M, thick=0.008)
    parts += crown((0, 0, 0.86), 0.1, 0.12, M)
    out.append(assemble("candy_king", base_disc(T, M), parts, [f.brows(0.068, 0.085, 0.04, 0.01, M)]))
    return out


# =================================================================== SPOOKY HOLLOW
def spooky(rng):
    T = lib.team_mats("spooky"); M = lib.common_mats()
    glow = mat("windowglow", "#FFD34D", emit=3.5, rough=0.3, coat=0.2)
    leaf = mat("leaf", "#5CC97A", rough=0.45)
    pumpkin = mat("pumpkin", "#FF8A1F", rough=0.4, coat=0.6)
    out = []

    # ---- pawn: little ghost (floats above its puck)
    el = [B((0, 0, 0.47), 0.165), B((0, 0, 0.37), 0.15), B((0, 0, 0.28), 0.14)]
    for i in range(7):
        a = 2 * math.pi * i / 7
        el.append(B((0.115 * math.cos(a), 0.115 * math.sin(a), 0.19), 0.048))
    for sx in (-1, 1): el.append(B((0.165 * sx, -0.03, 0.35), 0.045))
    ghost = metaball("ghost", el, T["main"], res=0.016)
    parts = [ghost]
    f = Face(ghost, (0, -0.25, 0.43))
    parts += f.eyes(0.06, 0.03, 0.03, 0.048, M)
    parts += f.blush(0.1, -0.02, 0.028, M)
    parts += f.open_mouth(-0.045, 0.03, 0.028, M)
    out.append(assemble("spooky_pawn", base_disc(T, M, 0.33), parts, [f.brows(0.06, 0.095, 0.036, 0.009, M)]))

    # ---- knight: nightmare pony with flame mane and bat wings
    parts, extras = pony(T, M, "flame")
    out.append(assemble("spooky_knight", base_disc(T, M), parts, extras))

    # ---- bishop: witch kitty (the pointy hat is the mitre)
    body = metaball("catbody", [B((0, 0.01, 0.27), 0.13), B((0, -0.02, 0.2), 0.125), B((0, 0, 0.36), 0.1)], T["main"], res=0.016)
    head = ball(uid("cathead"), 0.15, (0, -0.01, 0.5), T["main"], scale=(1.08, 1, 0.95))
    parts = [body, head]
    for sx in (-1, 1):
        parts.append(cone(uid("ear"), 0.05, 0.1, (0.1 * sx, -0.01, 0.57), (0.55 * sx, 0, 1), T["main"], verts=20))
        parts.append(cone(uid("earin"), 0.028, 0.07, (0.1 * sx, -0.03, 0.575), (0.55 * sx, 0, 1), M["blush"], verts=16))
        parts.append(ball(uid("paw"), 0.045, (0.06 * sx, -0.12, 0.13), M["white"], scale=(1, 1.2, 0.8)))
    parts.append(cyl(uid("brim"), 0.19, 0.022, (0, 0, 0.635), T["accent"], verts=48, round_edges=0.009))
    hat_pts = [(0, 0, 0.64), (0, 0.005, 0.74), (0, 0.02, 0.83), (0, 0.06, 0.9), (0, 0.12, 0.93), (0, 0.17, 0.915)]
    parts.append(tube("hat", hat_pts, [0.115, 0.085, 0.06, 0.038, 0.022, 0.01], T["accent"], res=8))
    parts.append(torus(uid("band"), 0.108, 0.02, (0, 0, 0.665), mat("hatband", "#7A3CFF", rough=0.35), seg=40))
    parts.append(rbox(uid("buckle"), (0.05, 0.015, 0.04), (0, -0.125, 0.665), M["gold"], radius=0.008))
    parts.append(tube("cattail", [(0.02, 0.12, 0.14), (0.07, 0.19, 0.2), (0.1, 0.22, 0.32), (0.08, 0.19, 0.43), (0.04, 0.15, 0.47)],
                      [0.03, 0.03, 0.028, 0.026, 0.022], T["main"], res=6))
    f = Face(head, (0, -0.22, 0.49))
    parts += f.eyes(0.058, 0.02, 0.032, 0.05, M)
    parts += f.blush(0.095, -0.03, 0.026, M)
    parts.append(f.disc(0, -0.025, 0.016, 0.011, 0.01, M["tongue"], "nose", lift=0.004))
    parts += [f.curve([(-0.03, -0.05), (-0.015, -0.06), (0, -0.05)], 0.007, M["mouth"]),
              f.curve([(0, -0.05), (0.015, -0.06), (0.03, -0.05)], 0.007, M["mouth"])]
    for sx in (-1, 1):
        for k in (-1, 0, 1):
            la, na = f.hit(0.08 * sx, -0.04 + k * 0.012)
            parts.append(capsule(uid("whisker"), la + na * 0.004, la + Vector((0.09 * sx, -0.02, k * 0.02)), 0.0035, M["eye"], seg=6))
    out.append(assemble("spooky_bishop", base_disc(T, M), parts, [f.brows(0.058, 0.09, 0.036, 0.009, M)]))

    # ---- rook: haunted tower with glowing window eyes
    tower = lathe(uid("tower"), [(0.0, 0.1), (0.24, 0.1), (0.235, 0.14), (0.215, 0.3), (0.2, 0.5), (0.0, 0.5)], T["main"], steps=64)
    parts = [tower, torus(uid("lip"), 0.205, 0.028, (0, 0, 0.51), T["accent"], seg=48)]
    for i in range(6):
        a = 2 * math.pi * i / 6 + math.pi / 6
        parts.append(rbox(uid("crenel"), (0.09, 0.07, 0.09), (0.165 * math.cos(a), 0.165 * math.sin(a), 0.57), T["main"], radius=0.022, rot=(0, 0, a)))
    for i in range(14):
        a = rng.uniform(0.6, 2 * math.pi - 0.6) - math.pi / 2   # keep the front clear for the face
        z = rng.uniform(0.15, 0.47); r = 0.235 - (z - 0.1) * 0.09
        parts.append(rbox(uid("brick"), (0.08, 0.03, 0.04), (r * math.cos(a), r * math.sin(a), z), T["main"], radius=0.012, rot=(0, 0, a + math.pi / 2)))
    vine = [(0.225 * math.cos(-0.55 + t * 4.2), 0.225 * math.sin(-0.55 + t * 4.2), 0.12 + t * 0.36) for t in [i / 30 for i in range(31)]]
    vine = [(x * (1.0 - 0.06 * (z - 0.1) / 0.4) + 0.0, y, z) for x, y, z in vine]
    parts.append(tube("vine", vine, [0.012] * len(vine), leaf, res=3))
    for i in range(0, 31, 5):
        x, y, z = vine[i]
        parts.append(ball(uid("leaf"), 1, (x * 1.05, y * 1.05, z), leaf, scale=(0.03, 0.012, 0.02), rot=Quaternion((0, 0, 1), math.atan2(y, x))))
    f = Face(tower, (0, -0.25, 0.36))
    for sx in (-1, 1):
        parts.append(f.disc(0.068 * sx, 0.03, 0.042, 0.06, 0.012, glow, "window", lift=0.0))
        parts += f.eye(0.068 * sx, 0.025, 0.022, 0.034, M, depth=0.03)
    parts += f.open_mouth(-0.075, 0.036, 0.03, M)
    parts.append(f.disc(0.11, -0.12, 0.02, 0.02, 0.01, M["blush"]))
    pk = ribbed_lathe(uid("minipk"), sphere_profile(0.05, 0.04, 0.0), 8, 0.08, pumpkin)
    pk.location = (0.17, -0.17, 0.14); apply_tf(pk)
    parts.append(pk)
    out.append(assemble("spooky_rook", base_disc(T, M), parts, [f.brows(0.068, 0.12, 0.046, 0.01, M)]))

    # ---- queen: bat queen with a vampire collar
    parts = [gown([(0.0, 0.1), (0.26, 0.1), (0.265, 0.13), (0.21, 0.22), (0.14, 0.34), (0.105, 0.44), (0.095, 0.49), (0.0, 0.5)], T["accent"])]
    parts.append(torus(uid("hem"), 0.252, 0.028, (0, 0, 0.13), T["main"], seg=48))
    parts.append(ball(uid("torso"), 0.11, (0, 0, 0.52), T["accent"], scale=(1, 0.9, 1)))
    head = ball(uid("head"), 0.16, (0, 0, 0.69), T["main"])
    parts.append(head)
    for sx in (-1, 1):
        parts.append(cone(uid("ear"), 0.06, 0.17, (0.09 * sx, 0, 0.78), (0.45 * sx, 0, 1), T["main"], verts=20))
        parts.append(cone(uid("earin"), 0.034, 0.12, (0.092 * sx, -0.025, 0.79), (0.45 * sx, 0, 1), M["blush"], verts=16))
    parts += tiara((0, 0, 0.835), 0.055, M, gem="emerald")
    f = Face(head, (0, -0.22, 0.68))
    parts += f.eyes(0.06, 0.02, 0.031, 0.048, M)
    parts += f.blush(0.1, -0.03, 0.028, M)
    parts += f.smile(-0.05, 0.03, 0.012, M)
    parts += f.fangs(-0.058, 0.016, 0.022, M)
    extras = [f.brows(0.06, 0.085, 0.038, 0.009, M)]
    for sx, nm in ((1, "wingL"), (-1, "wingR")):
        w = bat_wing(nm, 0.32, T["main"], M)
        w.rotation_euler = (0, math.radians(-14), math.radians(28 if sx > 0 else 152))
        pivot = Vector((0.06 * sx, 0.06, 0.47))
        w.location = pivot; apply_tf(w); origin_to(w, pivot)
        extras.append(w)
    out.append(assemble("spooky_queen", base_disc(T, M), parts, extras))

    # ---- king: pumpkin king
    parts = [gown([(0.0, 0.1), (0.25, 0.1), (0.255, 0.13), (0.2, 0.24), (0.14, 0.36), (0.12, 0.43), (0.0, 0.44)], T["accent"])]
    parts.append(back_cape([(0.2, 0.12), (0.2, 0.28), (0.17, 0.42), (0.15, 0.48)], mat("royal", "#6B3FD6", rough=0.4)))
    head = ribbed_lathe(uid("pumpkin"), sphere_profile(0.22, 0.18, 0.62, 16), 10, 0.07, T["main"])
    parts.append(head)
    parts.append(tube("pstem", [(0, 0, 0.78), (0, 0, 0.84), (0.02, 0, 0.89), (0.05, 0, 0.9)], [0.03, 0.026, 0.022, 0.018], leaf))
    parts.append(tube("curl", [(0.02 + 0.06 * math.cos(t * 9), 0.06 * math.sin(t * 9), 0.79 + t * 0.06) for t in [i / 16 for i in range(17)]], [0.007] * 17, leaf, res=3))
    f = Face(head, (0, -0.3, 0.62))
    for sx in (-1, 1):
        parts.append(f.disc(0.072 * sx, 0.035, 0.047, 0.06, 0.012, glow, "carve"))
        parts += f.eye(0.072 * sx, 0.03, 0.026, 0.04, M, depth=0.03)
    parts.append(f.curve([(0.075 * t, -0.045 - 0.03 * (1 - t * t)) for t in [-1 + 2 * i / 13 for i in range(14)]], 0.016, glow))
    parts += f.blush(0.13, -0.03, 0.03, M)
    parts += crown((0, 0, 0.775), 0.1, 0.12, M)
    out.append(assemble("spooky_king", base_disc(T, M), parts, [f.brows(0.072, 0.11, 0.05, 0.011, M)]))
    return out

# =================================================================== RAINBOW GALAXY
def galaxy(rng):
    T = lib.team_mats("galaxy"); M = lib.common_mats()
    rubber = mat("rubber", "#2B2B3A", rough=0.6, coat=0.2)
    screen = mat("screen", "#14122B", rough=0.1, coat=1.0)
    led = mat("led", "#4DE1FF", emit=3.0, rough=0.3, coat=0.2)
    glass = mat("glass", "#7FD4FF", rough=0.05, coat=1.0, emit=0.4)
    out = []

    # ---- pawn: little star kid
    star = puffy_star(uid("star"), 0.25, 0.125, 0.14, (0, 0, 0.345), T["glow"], puff=0.9)
    parts = [star]
    f = Face(star, (0, -0.25, 0.35))
    parts += f.eyes(0.05, 0.015, 0.028, 0.044, M)
    parts += f.blush(0.085, -0.025, 0.024, M)
    parts += f.smile(-0.035, 0.024, 0.01, M, thick=0.008)
    out.append(assemble("galaxy_pawn", base_disc(T, M, 0.33), parts, [f.brows(0.05, 0.072, 0.034, 0.008, M)]))

    # ---- knight: comet pony
    parts, extras = pony(T, M, "comet")
    out.append(assemble("galaxy_knight", base_disc(T, M), parts, extras))

    # ---- bishop: rocket buddy (nose cone = mitre)
    body = lathe(uid("fuselage"), [(0.0, 0.2), (0.11, 0.2), (0.145, 0.27), (0.16, 0.38), (0.155, 0.5), (0.13, 0.6), (0.11, 0.645), (0.0, 0.65)], T["main"], steps=64)
    subdiv(body, 1)
    nose = lathe(uid("nose"), [(0.0, 0.62), (0.118, 0.62), (0.112, 0.66), (0.09, 0.73), (0.055, 0.8), (0.02, 0.85), (0.0, 0.86)], T["accent"], steps=64)
    subdiv(nose, 1)
    parts = [body, nose, torus(uid("stripe"), 0.15, 0.016, (0, 0, 0.47), T["accent"], seg=48)]
    for i in range(3):
        a = math.pi / 2 + 2 * math.pi * i / 3      # one fin straight back, two at the front corners
        fin = prism(uid("fin"), [(0.0, 0.36), (0.09, 0.26), (0.135, 0.12), (0.135, 0.1), (0.06, 0.1), (0.0, 0.2)], 0.035, T["accent"])
        bevel(fin, 0.012, 3)
        fin.location = (0.12, 0, 0); apply_tf(fin)
        fin.rotation_euler = (0, 0, a); apply_tf(fin)
        parts.append(lib._finish(fin, fin.name, None, T["accent"], True))
    parts.append(cyl(uid("nozzle"), 0.085, 0.07, (0, 0, 0.17), M["silver"], r2=0.06, verts=32))
    parts.append(puffy_star(uid("decal"), 0.035, 0.016, 0.012, (0, -0.122, 0.565), T["glow"]))
    f = Face(body, (0, -0.25, 0.37))
    parts += f.eyes(0.058, 0.01, 0.03, 0.046, M)
    parts += f.blush(0.1, -0.03, 0.026, M)
    parts += f.smile(-0.045, 0.028, 0.012, M)
    out.append(assemble("galaxy_bishop", base_disc(T, M), parts, [f.brows(0.058, 0.07, 0.038, 0.009, M)]))

    # ---- rook: robo-rook with castle battlements on its head
    parts = []
    for sx in (-1, 1):
        parts.append(rbox(uid("tread"), (0.1, 0.32, 0.1), (0.13 * sx, 0, 0.15), rubber, radius=0.045))
        for y in (-0.1, 0, 0.1):
            parts.append(cyl(uid("hub"), 0.035, 0.02, (0.182 * sx, y, 0.15), M["silver"], rot=(0, math.pi / 2, 0), verts=20))
    torso = rbox(uid("torso"), (0.32, 0.26, 0.22), (0, 0, 0.31), T["main"], radius=0.06, segs=4)
    parts.append(torso)
    for i, c in enumerate(["#FF4F6D", "#FFD23F", "#5BE38A"]):
        parts.append(ball(uid("btn"), 0.016, (-0.05 + i * 0.05, -0.132, 0.3), mat(f"btn{i}", c, emit=2.0, rough=0.2), scale=(1, 0.5, 1)))
    head = rbox(uid("head"), (0.32, 0.26, 0.2), (0, 0, 0.53), T["main"], radius=0.06, segs=4)
    parts.append(head)
    scr = rbox(uid("screen"), (0.25, 0.03, 0.135), (0, -0.125, 0.53), screen, radius=0.03, segs=3)
    parts.append(scr)
    f = Face(scr, (0, -0.2, 0.53))
    for sx in (-1, 1): parts.append(f.disc(0.055 * sx, 0.012, 0.022, 0.034, 0.008, led, "led"))
    parts.append(f.curve([(0.04 * t, -0.03 - 0.018 * (1 - t * t)) for t in [-1 + 2 * i / 11 for i in range(12)]], 0.007, led))
    brows = f.brows(0.055, 0.055, 0.04, 0.008, {"eye": led})
    for x, y in ((-0.12, -0.09), (0.12, -0.09), (-0.12, 0.09), (0.12, 0.09), (0, -0.09), (0, 0.09), (-0.12, 0), (0.12, 0)):
        parts.append(rbox(uid("crenel"), (0.075, 0.075, 0.07), (x, y, 0.655), T["accent"], radius=0.02))
    parts.append(capsule(uid("antenna"), (0, 0, 0.63), (0, 0, 0.76), 0.008, M["silver"]))
    parts.append(ball(uid("antball"), 0.026, (0, 0, 0.77), T["glow"]))
    for sx in (-1, 1):
        parts.append(capsule(uid("arm"), (0.17 * sx, 0, 0.37), (0.22 * sx, -0.06, 0.26), 0.028, M["silver"]))
        parts.append(ball(uid("hand"), 0.04, (0.225 * sx, -0.065, 0.245), T["accent"]))
    out.append(assemble("galaxy_rook", base_disc(T, M), parts, [brows]))

    # ---- queen: Saturn queen with a glowing ring
    parts = [gown([(0.0, 0.1), (0.25, 0.1), (0.255, 0.13), (0.2, 0.22), (0.14, 0.33), (0.11, 0.42), (0.0, 0.44)], T["accent"])]
    head = ball(uid("planet"), 0.19, (0, 0, 0.62), T["main"])
    parts.append(head)
    hz = 0.14; parts.append(torus(uid("pband"), math.sqrt(0.19 ** 2 - hz ** 2) + 0.004, 0.012, (0, 0, 0.62 + hz), T["accent"], seg=40))
    ring = torus(uid("ring"), 0.29, 0.045, (0, 0, 0), T["ring"], seg=64, mseg=12)
    ring.scale = (1, 1, 0.12); apply_tf(ring)
    ring.rotation_euler = (math.radians(26), 0, math.radians(-12)); ring.location = (0, 0, 0.61); apply_tf(ring)
    parts.append(ring)
    parts += tiara((0, 0, 0.79), 0.06, M, gem="sapphire")
    for i in range(3):
        a = -math.pi / 2 + (i - 1) * 0.55
        parts.append(puffy_star(uid("tstar"), 0.028, 0.013, 0.012, (0.07 * math.cos(a), 0.07 * math.sin(a) - 0.005, 0.845 + (0.02 if i == 1 else 0)), M["gold"]))
    f = Face(head, (0, -0.22, 0.64))
    parts += f.eyes(0.06, 0.015, 0.031, 0.048, M)
    parts += f.blush(0.1, -0.03, 0.028, M)
    parts += f.smile(-0.045, 0.026, 0.011, M)
    out.append(assemble("galaxy_queen", base_disc(T, M), parts, [f.brows(0.06, 0.08, 0.038, 0.009, M)]))

    # ---- king: Sun king with a halo of rays and a crown
    parts = [gown([(0.0, 0.1), (0.25, 0.1), (0.255, 0.13), (0.2, 0.24), (0.14, 0.36), (0.12, 0.43), (0.0, 0.44)], T["accent"])]
    parts.append(back_cape([(0.2, 0.12), (0.2, 0.28), (0.17, 0.42), (0.15, 0.48)], mat("royal2", "#3D2BB8", rough=0.4)))
    head = ball(uid("sun"), 0.2, (0, 0, 0.64), T["glow"])
    parts.append(head)
    for i in range(16):
        a = 2 * math.pi * i / 16
        if math.sin(a) < -0.55 or (math.sin(a) > 0.9): continue      # robe below, crown on top
        L = 0.11 if i % 2 == 0 else 0.07
        d = Vector((math.cos(a), 0, math.sin(a)))
        parts.append(cone(uid("ray"), 0.045 if i % 2 == 0 else 0.032, L, Vector((0, 0.06, 0.64)) + d * 0.17, d, T["glow"], verts=16))
    f = Face(head, (0, -0.24, 0.64))
    parts += f.eyes(0.064, 0.02, 0.032, 0.048, M)
    parts += f.blush(0.11, -0.035, 0.03, M)
    parts += f.smile(-0.055, 0.04, 0.016, M, thick=0.012)
    parts += crown((0, 0, 0.8), 0.1, 0.12, M)
    out.append(assemble("galaxy_king", base_disc(T, M), parts, [f.brows(0.064, 0.09, 0.044, 0.01, M)]))
    return out

ARENAS = {"candy": candy, "spooky": spooky, "galaxy": galaxy}

def preview(arena, roots):
    cam = lib.studio(bg={"candy": "#ffd9ec", "spooky": "#2a2040", "galaxy": "#1a1a40"}[arena])
    order = ["pawn", "knight", "bishop", "rook", "queen", "king"]
    for i, k in enumerate(order):
        r = bpy.data.objects[f"{arena}_{k}"]
        r.location = (-2.1 + i * 0.84, 0, 0)
    brows = [o for o in bpy.data.objects if o.name.startswith("brows")]
    for b in brows: b.hide_render = True
    lib.shoot(cam, (0, -6.4, 2.3), (0, 0, 0.42), 50, f"{arena}_light.png")
    lib.recolor(arena, "dark")
    for b in brows: b.hide_render = False
    lib.shoot(cam, (0, -6.4, 2.3), (0, 0, 0.42), 50, f"{arena}_dark.png")
    for i, k in enumerate(order):
        bpy.data.objects[f"{arena}_{k}"].location = (-0.9 + (i % 3) * 0.9, (i // 3) * 0.9, 0)
    lib.recolor(arena, "light")
    for b in brows: b.hide_render = True
    lib.shoot(cam, (0.9, -3.6, 2.6), (0.0, 0.45, 0.4), 45, f"{arena}_close.png")

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    which = [a for a in argv if a in ARENAS or a == "all"] or ["all"]
    names = list(ARENAS) if "all" in which else which
    for name in names:
        lib.reset()
        rng = random.Random(7)
        roots = ARENAS[name](rng)
        for r in roots: print(f"  {r.name}: {lib.tris(r)} tris")
        lib.export(roots, f"pieces_{name}.glb")
        print("exported", name, os.path.getsize(os.path.join(lib.ASSETS, f"pieces_{name}.glb")) // 1024, "KB")
        if "render" in argv: preview(name, roots)
