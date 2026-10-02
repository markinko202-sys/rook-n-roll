# Arena dressing + shared props → assets/kit_<arena>.glb and assets/common.glb
#   blender -b --python blender/arenas.py -- [common|candy|spooky|galaxy|all] [render]
# Each prop is a root empty at the origin, standing on z = 0 (Blender Z-up, front = -Y).
import bpy, bmesh, sys, os, math, random
from mathutils import Vector, Quaternion, Matrix, noise
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import ball, rbox, cyl, torus, capsule, cone, lathe, prism, metaball, join, uid, subdiv, bevel, mat, puffy_star, apply_tf, origin_to
from pieces import B, E, tube, ribbed_lathe, sphere_profile, bat_wing, fib_dirs, sprinkles

def prop(name, parts, extras=None):
    root = lib.empty(name)
    mesh = join([p for p in parts if p is not None], name + "_mesh")
    mesh.parent = root
    for o in extras or []:
        o.parent = root
    return root

def slim_all(parts, budget=2400):
    for p in parts:
        if p is not None and p.type == 'MESH': lib.slim(p, budget)
    return parts

def cloud(name, rng, size=1.0, puffs=9, material=None):
    el = []
    for i in range(puffs):
        a = rng.uniform(0, 2 * math.pi); d = rng.uniform(0, 0.55) * size
        el.append(B((math.cos(a) * d * 1.4, math.sin(a) * d * 0.7, rng.uniform(0.0, 0.25) * size), rng.uniform(0.28, 0.42) * size))
    el.append(B((0, 0, 0.1 * size), 0.45 * size))
    return metaball(name, el, material, res=0.06 * size)

# =================================================================== common
def common(rng):
    M = lib.common_mats()
    out = []
    # ---- item box: rounded cube with a "?" on every side (the game gives it an iridescent material)
    boxm = mat("itembox", "#B9A6FF", rough=0.1, coat=1.0, alpha=0.6)
    q = mat("qmark", "#FFFFFF", emit=2.5, rough=0.3, coat=0)
    parts = [rbox(uid("box"), (0.44, 0.44, 0.44), (0, 0, 0.22), boxm, radius=0.08, segs=4)]
    for i in range(4):
        a = i * math.pi / 2
        bpy.ops.object.text_add(location=(0, 0, 0))
        t = bpy.context.object; t.data.body = "?"; t.data.size = 0.3; t.data.extrude = 0.02
        t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
        try: t.data.font = bpy.data.fonts.load("/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf")
        except Exception: pass
        bpy.ops.object.convert(target='MESH'); t = bpy.context.object
        t.rotation_euler = (math.pi / 2, 0, a)
        t.location = (math.sin(a) * 0.205, -math.cos(a) * 0.205, 0.22)
        apply_tf(t); lib._finish(t, uid("q"), None, q, False)
        parts.append(t)
    out.append(prop("item_box", parts))

    # ---- kart (the driver is a pawn figure dropped into the seat in-game)
    body = mat("kartbody", "#FF4F6D", rough=0.25, coat=1.0)
    rubber = mat("tyre", "#26232F", rough=0.7, coat=0.1)
    seat = mat("seat", "#2B2B3A", rough=0.5)
    parts = []
    chassis = rbox(uid("chassis"), (0.9, 0.5, 0.14), (0, 0, 0.17), body, radius=0.06, segs=4)
    nose = ball(uid("knose"), 1, (0.38, 0, 0.2), body, scale=(0.22, 0.24, 0.1))
    parts += [chassis, nose, rbox(uid("bumper"), (0.08, 0.56, 0.07), (0.5, 0, 0.13), M["silver"], radius=0.03)]
    parts.append(rbox(uid("seat"), (0.2, 0.3, 0.06), (-0.1, 0, 0.27), seat, radius=0.03))
    parts.append(rbox(uid("seatback"), (0.06, 0.3, 0.22), (-0.22, 0, 0.36), seat, radius=0.03))
    parts.append(capsule(uid("column"), (0.22, 0, 0.26), (0.1, 0, 0.4), 0.015, M["silver"]))
    parts.append(torus(uid("wheel"), 0.07, 0.015, (0.1, 0, 0.4), rubber, rot=(0, math.radians(-60), 0), seg=24))
    for y in (-0.12, 0.12):
        parts.append(cyl(uid("pipe"), 0.035, 0.18, (-0.5, y, 0.25), M["silver"], rot=(0, math.radians(70), 0), verts=16))
    parts.append(rbox(uid("spoiler"), (0.1, 0.6, 0.03), (-0.44, 0, 0.46), body, radius=0.012))
    for y in (-0.2, 0.2): parts.append(rbox(uid("strut"), (0.03, 0.03, 0.16), (-0.42, y, 0.38), M["silver"], radius=0.01))
    for x, y in ((0.3, -0.29), (0.3, 0.29), (-0.3, -0.3), (-0.3, 0.3)):
        r = 0.13 if x < 0 else 0.11
        parts.append(cyl(uid("tyre"), r, 0.13 if x < 0 else 0.11, (x, y, r), rubber, rot=(math.pi / 2, 0, 0), verts=32, round_edges=0.035))
        parts.append(cyl(uid("rim"), r * 0.55, 0.02, (x, y + (0.065 if y > 0 else -0.065) * (1.2 if x < 0 else 1.0), r), M["gold"], rot=(math.pi / 2, 0, 0), verts=20))
    out.append(prop("kart", parts))

    # ---- bomb (thrown in-game)
    bombm = mat("bomb", "#2A2540", rough=0.2, coat=1.0)
    parts = [ball(uid("bomb"), 0.2, (0, 0, 0.2), bombm), cyl(uid("cap"), 0.07, 0.06, (0, 0, 0.41), M["silver"], verts=24)]
    parts.append(tube("fuse", [(0, 0, 0.44), (0.02, 0, 0.5), (0.06, 0, 0.54), (0.1, 0, 0.55)], [0.014] * 4, mat("fuse", "#C9A27A", rough=0.7)))
    parts.append(puffy_star(uid("spark"), 0.05, 0.022, 0.02, (0.11, -0.0, 0.56), mat("spark", "#FFC83D", emit=4, coat=0)))
    parts.append(puffy_star(uid("decal"), 0.06, 0.028, 0.02, (0, -0.19, 0.2), mat("decalstar", "#FFD23F", rough=0.3)))
    out.append(prop("bomb", parts))

    # ---- item icons (rendered to HUD thumbnails in-game)
    bubble = mat("bubble", "#8FE3FF", rough=0.05, coat=1.0, alpha=0.55, emit=0.2)
    parts = [ball(uid("bub"), 0.3, (0, 0, 0.3), bubble, seg=40, rings=20), ball(uid("shine"), 1, (-0.12, -0.2, 0.42), M["shine"], scale=(0.06, 0.03, 0.09))]
    parts.append(puffy_star(uid("bstar"), 0.1, 0.045, 0.05, (0, 0, 0.3), mat("bubstar", "#5BC0FF", rough=0.2, emit=0.5)))
    out.append(prop("icon_shield", parts))
    ice = mat("ice", "#BFF4FF", rough=0.05, coat=1.0, alpha=0.7, emit=0.3)
    parts = [rbox(uid("ice"), (0.5, 0.5, 0.5), (0, 0, 0.25), ice, radius=0.06)]
    flake = mat("flake", "#FFFFFF", emit=1.5, coat=0)
    for i in range(3):
        a = i * math.pi / 3
        parts.append(rbox(uid("arm"), (0.04, 0.02, 0.38), (0, -0.26, 0.25), flake, radius=0.01, rot=(0, a, 0)))
    out.append(prop("icon_freeze", parts))
    parts = [ball(uid("bomb"), 0.24, (0, 0, 0.24), bombm), cyl(uid("cap"), 0.08, 0.07, (0, 0, 0.49), M["silver"], verts=24),
             tube("fuse", [(0, 0, 0.52), (0.03, 0, 0.58), (0.08, 0, 0.62)], [0.016] * 3, mat("fuse", "#C9A27A")),
             puffy_star(uid("spark"), 0.07, 0.03, 0.03, (0.09, 0, 0.64), mat("spark", "#FFC83D", emit=4, coat=0))]
    out.append(prop("icon_bomb", parts))
    warpm = [mat("warp1", "#B07CFF", emit=1.5, rough=0.2), mat("warp2", "#4DE1FF", emit=1.5, rough=0.2)]
    parts = []
    for k in range(2):
        pts = [(0.3 * (1 - t) * math.cos(t * 12 + k * math.pi), 0.3 * (1 - t) * math.sin(t * 12 + k * math.pi), 0.25) for t in [i / 60 for i in range(61)]]
        tb = tube("swirl", pts, [0.035 * (1 - i / 70) for i in range(61)], warpm[k], res=4)
        tb.rotation_euler = (math.pi / 2, 0, 0); tb.location = (0, 0, 0.25); apply_tf(tb)
        parts.append(tb)
    out.append(prop("icon_warp", parts))
    bolt = [(-0.06, 0.5), (0.16, 0.5), (0.04, 0.3), (0.18, 0.3), (-0.12, 0.0), (0.0, 0.22), (-0.14, 0.22)]
    b = prism(uid("bolt"), bolt, 0.1, mat("bolt", "#FFD23F", emit=1.2, rough=0.2, coat=1.0))
    bevel(b, 0.03, 3)
    out.append(prop("icon_boost", [lib._finish(b, b.name, None, None, True)]))
    return out

# =================================================================== candy clouds
def candy(rng):
    M = lib.common_mats()
    out = []
    cloudm = mat("cloud", "#FFFFFF", rough=0.6, coat=0.1, sheen=0.6)
    for i in range(3):
        out.append(prop(f"cloud{i}", slim_all([cloud(uid("cl"), rng, 1.0 + 0.2 * i, 8 + i * 2, cloudm)], 3000)))
    # rainbow arch
    rb = lib.rainbow_mats()
    parts = []
    for i, m in enumerate(rb):
        t = torus(uid("arc"), 2.0 - i * 0.16, 0.085, (0, 0, 0), m, rot=(math.pi / 2, 0, 0), seg=72, mseg=12)
        bm = bmesh.new(); bm.from_mesh(t.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02], context='VERTS')
        bm.to_mesh(t.data); bm.free()
        parts.append(t)
    for sx in (-1, 1):
        parts.append(cloud(uid("arccloud"), rng, 0.85, 7, cloudm))
        parts[-1].location = (sx * 1.6, 0, -0.05); apply_tf(parts[-1])
    out.append(prop("rainbow", slim_all(parts, 3000)))
    # lollipop
    swirlA, swirlB = mat("lolA", "#FF6FB5", rough=0.15, coat=1.0), mat("lolB", "#FFFFFF", rough=0.15, coat=1.0)
    parts = [cyl(uid("stick"), 0.035, 1.2, (0, 0, 0.6), mat("stick", "#FFF4E0", rough=0.5), verts=16)]
    disc = cyl(uid("lolly"), 0.42, 0.14, (0, 0, 0), swirlB, rot=(math.pi / 2, 0, 0), verts=48, round_edges=0.05)
    disc.location = (0, 0, 1.45); apply_tf(disc); parts.append(disc)
    pts = [(0.4 * t * math.cos(t * 22), 0.0, 1.45 + 0.4 * t * math.sin(t * 22)) for t in [i / 120 for i in range(121)]]
    sp = tube("lolsw", [(x, -0.075, z) for x, _, z in pts], [0.05] * len(pts), swirlA, res=3)
    sp2 = tube("lolsw", [(x, 0.075, z) for x, _, z in pts], [0.05] * len(pts), swirlA, res=3)
    parts += [sp, sp2]
    out.append(prop("lollipop", slim_all(parts, 3000)))
    # cotton candy tree
    for i, col in enumerate(["#FFB3DA", "#B9E6FF", "#D8C2FF"]):
        cc = mat(f"cotton{i}", col, rough=0.7, coat=0.0, sheen=0.8)
        trunk = tube("trunk", [(0, 0, 0), (0.05, 0, 0.5), (-0.03, 0, 1.0), (0, 0, 1.3)], [0.09, 0.07, 0.06, 0.05], mat("trunkstripe", "#FFF4E0", rough=0.5))
        puff = cloud(uid("cotton"), rng, 0.9 + 0.15 * i, 9, cc)
        puff.location = (0, 0, 1.45); apply_tf(puff)
        out.append(prop(f"candytree{i}", slim_all([trunk, puff], 3000)))
    # candy cane
    cane_pts = [(0, 0, 0), (0, 0, 0.9)] + [(0.18 - 0.18 * math.cos(a), 0, 0.9 + 0.18 * math.sin(a)) for a in [math.pi * i / 10 for i in range(1, 11)]]
    red, white = mat("caneR", "#FF3D6E", rough=0.2, coat=1.0), mat("caneW", "#FFFFFF", rough=0.2, coat=1.0)
    cane = tube("cane", cane_pts, [0.07] * len(cane_pts), white, res=6)
    stripes = []
    for k in range(9):
        z = 0.05 + k * 0.1
        stripes.append(torus(uid("stripe"), 0.07, 0.018, (0, 0, z), red, rot=(math.radians(20), 0, 0), seg=24, mseg=6))
    out.append(prop("candycane", [cane] + stripes))
    # donut
    dough = mat("dough", "#E9A46A", rough=0.5)
    icing = mat("icing", "#FF7EB8", rough=0.2, coat=1.0)
    d1 = torus(uid("donut"), 0.32, 0.17, (0, 0, 0.17), dough, seg=48, mseg=20)
    d2 = torus(uid("icing"), 0.32, 0.165, (0, 0, 0.2), icing, seg=48, mseg=20)
    bm = bmesh.new(); bm.from_mesh(d2.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.2 + 0.03 * math.sin(math.atan2(v.co.y, v.co.x) * 7)], context='VERTS')
    bm.to_mesh(d2.data); bm.free()
    parts = [d1, d2] + sprinkles(d2, (0, 0, 0), 24, rng, 0.25, 0.4, 0.05)
    out.append(prop("donut", parts))
    # hot-air balloon
    stripes = [mat("balA", "#FF7EB8", rough=0.3, coat=0.8), mat("balB", "#FFE066", rough=0.3, coat=0.8)]
    env = ribbed_lathe(uid("envelope"), [(0.0, 0.0), (0.15, 0.05), (0.5, 0.45), (0.62, 0.9), (0.55, 1.25), (0.32, 1.48), (0.0, 1.55)], 8, 0.04, stripes[0])
    bm = bmesh.new(); bm.from_mesh(env.data)
    for f in bm.faces:
        c = f.calc_center_median(); f.material_index = int(((math.atan2(c.y, c.x) + math.pi) / (2 * math.pi)) * 8) % 2
    bm.to_mesh(env.data); bm.free()
    env.data.materials.append(stripes[1])
    env.location = (0, 0, 0.45); apply_tf(env)
    basket = rbox(uid("basket"), (0.3, 0.3, 0.22), (0, 0, 0.11), mat("basket", "#C98A4E", rough=0.7), radius=0.04)
    ropes = [capsule(uid("rope"), (sx * 0.13, sy * 0.13, 0.22), (sx * 0.2, sy * 0.2, 0.5), 0.008, mat("rope", "#8A6A4E")) for sx in (-1, 1) for sy in (-1, 1)]
    out.append(prop("balloon", [env, basket] + ropes))
    # gumdrops
    for i, col in enumerate(["#5BE38A", "#FFB020", "#A77BFF"]):
        g = lathe(uid("gum"), [(0.0, 0.0), (0.26, 0.0), (0.27, 0.05), (0.22, 0.2), (0.12, 0.3), (0.0, 0.33)], mat(f"gum{i}", col, rough=0.35, coat=0.8, sheen=0.5), steps=40)
        subdiv(g, 1)
        out.append(prop(f"gumdrop{i}", [g]))
    return out

# =================================================================== spooky hollow
def spooky(rng):
    M = lib.common_mats()
    out = []
    bark = mat("bark", "#3B2B52", rough=0.6, coat=0.2)
    glow = mat("pglow", "#FFC23D", emit=5.0, rough=0.3, coat=0)
    pumpkin = mat("pumpkin", "#FF8A1F", rough=0.35, coat=0.7)
    stem = mat("pstem", "#5CC97A", rough=0.5)
    stone = mat("stone", "#8C83A8", rough=0.55, coat=0.2)
    # spooky trees
    for k in range(2):
        r = random.Random(11 + k)
        trunk = tube("trunk", [(0, 0, 0), (0.08, 0, 0.6), (-0.05, 0.03, 1.2), (0.1, 0, 1.7)], [0.22, 0.15, 0.11, 0.07], bark, res=5)
        parts = [trunk]
        for b in range(5):
            z = 0.8 + b * 0.22; a = r.uniform(0, 2 * math.pi); L = r.uniform(0.5, 0.8)
            p0 = Vector((0.0, 0.0, z)); d = Vector((math.cos(a), math.sin(a), 0.6)).normalized()
            pts = [p0, p0 + d * L * 0.5 + Vector((0, 0, 0.05)), p0 + d * L + Vector((0, 0, 0.2)), p0 + d * L * 1.1 + Vector((math.cos(a + 1) * 0.15, math.sin(a + 1) * 0.15, 0.35))]
            parts.append(tube("branch", [tuple(p) for p in pts], [0.06, 0.045, 0.03, 0.012], bark, res=3))
        for sx in (-1, 1):
            parts.append(capsule(uid("root"), (0, 0, 0.1), (sx * 0.35, r.uniform(-0.1, 0.1), -0.02), 0.06, bark, r2=0.03))
        out.append(prop(f"spookytree{k}", slim_all(parts)))
    # jack-o'-lanterns
    for k, (R, col) in enumerate(((0.3, pumpkin), (0.22, pumpkin), (0.26, mat("pumpkin2", "#FFB15C", rough=0.35, coat=0.7)))):
        head = ribbed_lathe(uid("pk"), sphere_profile(R, R * 0.82, R * 0.82, 16), 10, 0.07, col)
        parts = [head, tube("stem", [(0, 0, R * 1.55), (0, 0, R * 1.8), (0.03, 0, R * 1.95)], [0.035, 0.03, 0.022], stem)]
        f = lib.Face(head, (0, -R * 1.5, R * 0.85))
        if k != 2:
            for sx in (-1, 1):
                parts.append(f.disc(R * 0.3 * sx, R * 0.18, R * 0.16, R * 0.2, 0.01, glow, "carve"))
            parts.append(f.curve([(R * 0.38 * t, -R * 0.2 - R * 0.14 * (1 - t * t)) for t in [-1 + 2 * i / 13 for i in range(14)]], R * 0.07, glow))
        out.append(prop(f"pumpkin{k}", parts))
    # gravestones
    for k in range(2):
        slab = prism(uid("grave"), [(-0.28, 0), (0.28, 0), (0.28, 0.5)] + [(0.28 * math.cos(a), 0.5 + 0.28 * math.sin(a)) for a in [math.pi * i / 12 for i in range(1, 12)]] + [(-0.28, 0.5)], 0.12, stone)
        bevel(slab, 0.03, 3)
        parts = [lib._finish(slab, slab.name, None, stone, True)]
        if k == 0:
            parts.append(rbox(uid("cross"), (0.05, 0.02, 0.24), (0, -0.065, 0.48), mat("engrave", "#5B5278"), radius=0.008))
            parts.append(rbox(uid("cross"), (0.16, 0.02, 0.05), (0, -0.065, 0.53), mat("engrave", "#5B5278"), radius=0.008))
        else:
            for sx in (-1, 1): parts.append(ball(uid("geye"), 1, (sx * 0.08, -0.06, 0.5), M["eye"], scale=(0.03, 0.01, 0.045)))
            parts.append(ball(uid("gmouth"), 1, (0, -0.06, 0.38), M["mouth"], scale=(0.04, 0.01, 0.025)))
        parts.append(cloud(uid("moss"), rng, 0.35, 5, mat("moss", "#5CC97A", rough=0.7)))
        out.append(prop(f"grave{k}", slim_all(parts)))
    # floating lantern
    paper = mat("lantern", "#FF9F43", emit=2.5, rough=0.5, coat=0)
    l = ribbed_lathe(uid("lantern"), [(0.0, -0.22), (0.12, -0.2), (0.2, -0.08), (0.21, 0.05), (0.17, 0.17), (0.08, 0.22), (0.0, 0.22)], 10, 0.05, paper)
    caps = [cyl(uid("cap"), 0.09, 0.04, (0, 0, z), mat("lcap", "#3B2B52"), verts=20) for z in (-0.22, 0.22)]
    out.append(prop("lantern", [l] + caps))
    # candles
    wax = mat("wax", "#F3EEDF", rough=0.45, coat=0.3)
    flame = mat("cflame", "#FFB938", emit=6.0, coat=0)
    parts = []
    for x, y, h in ((0, 0, 0.32), (0.13, 0.05, 0.22), (-0.11, 0.07, 0.17)):
        parts += [cyl(uid("candle"), 0.055, h, (x, y, h / 2), wax, verts=20, round_edges=0.012),
                  ball(uid("flame"), 0.03, (x, y, h + 0.05), flame, scale=(1, 1, 1.7))]
    out.append(prop("candles", parts))
    # picket fence
    wood = mat("fence", "#4A3A63", rough=0.6)
    parts = [rbox(uid("rail"), (1.6, 0.05, 0.07), (0, 0, z), wood, radius=0.015) for z in (0.18, 0.42)]
    for i in range(7):
        x = -0.72 + i * 0.24; h = 0.55 + 0.08 * ((i * 5) % 3)
        parts.append(prism(uid("picket"), [(x - 0.06, 0), (x + 0.06, 0), (x + 0.06, h), (x, h + 0.1), (x - 0.06, h)], 0.04, wood))
    out.append(prop("fence", parts))
    # haunted castle (backdrop)
    wall = mat("castle", "#3A2E57", rough=0.6, coat=0.2)
    roof = mat("roof", "#6B3FD6", rough=0.4, coat=0.5)
    win = mat("cwin", "#FFD34D", emit=4.0, coat=0)
    parts = [rbox(uid("keep"), (1.6, 0.9, 1.4), (0, 0, 0.7), wall, radius=0.04)]
    for x, h in ((-0.95, 2.2), (0.95, 1.9), (0.0, 2.8)):
        parts.append(cyl(uid("tower"), 0.36, h, (x, 0.0, h / 2), wall, verts=24))
        parts.append(cyl(uid("roof"), 0.48, 0.9, (x, 0.0, h + 0.45), roof, r2=0.0, verts=24))
        for z in (h * 0.45, h * 0.75):
            parts.append(rbox(uid("win"), (0.12, 0.05, 0.2), (x, -0.35, z), win, radius=0.03))
    for x in (-0.45, 0.45): parts.append(rbox(uid("win"), (0.14, 0.05, 0.24), (x, -0.46, 0.9), win, radius=0.04))
    parts.append(ball(uid("door"), 1, (0, -0.45, 0.25), M["eye"], scale=(0.22, 0.04, 0.32)))
    out.append(prop("castle", parts))
    # bat (wings flap in-game)
    batm = mat("bat", "#2A2140", rough=0.3, coat=0.8)
    body = ball(uid("batbody"), 0.12, (0, 0, 0), batm)
    parts = [body]
    for sx in (-1, 1): parts.append(cone(uid("bear"), 0.04, 0.08, (sx * 0.05, 0, 0.09), (sx * 0.4, 0, 1), batm, verts=12))
    f = lib.Face(body, (0, -0.2, 0.01))
    parts += f.eyes(0.04, 0.02, 0.022, 0.032, M)
    parts += f.fangs(-0.035, 0.012, 0.016, M)
    wings = []
    for sx, nm in ((1, "wingL"), (-1, "wingR")):
        w = bat_wing(nm, 0.28, batm, M)
        w.rotation_euler = (0, 0, 0 if sx > 0 else math.pi)
        w.location = (sx * 0.06, 0, -0.03); apply_tf(w); origin_to(w, Vector((sx * 0.06, 0, 0)))
        wings.append(w)
    out.append(prop("bat", parts, wings))
    # glowing mushrooms
    cap = mat("shroom", "#B07CFF", emit=1.4, rough=0.3, coat=0.6)
    parts = []
    for x, y, s in ((0, 0, 1.0), (0.18, 0.08, 0.7), (-0.15, 0.1, 0.55)):
        parts.append(cyl(uid("stalk"), 0.04 * s, 0.22 * s, (x, y, 0.11 * s), mat("stalk", "#E9E1FF", rough=0.5), verts=16))
        parts.append(ball(uid("cap"), 0.13 * s, (x, y, 0.22 * s), cap, scale=(1, 1, 0.6)))
    out.append(prop("shrooms", parts))
    return out

# =================================================================== rainbow galaxy
def galaxy(rng):
    M = lib.common_mats()
    out = []
    # planets
    p1 = mat("planet1", "#FF8FC7", rough=0.45, coat=0.5)
    ringm = mat("pring", "#FFE38A", rough=0.3, coat=0.8, emit=0.4)
    planet = ball(uid("planet"), 1.0, (0, 0, 0), p1, seg=48, rings=24)
    bands = [torus(uid("band"), math.sqrt(1 - z * z) * 1.0 + 0.005, 0.04, (0, 0, z), mat("pband", "#FFC2E2", rough=0.4), seg=48) for z in (-0.5, 0.15, 0.6)]
    ring = torus(uid("ring"), 1.7, 0.3, (0, 0, 0), ringm, seg=72, mseg=12)
    ring.scale = (1, 1, 0.06); apply_tf(ring)
    ring.rotation_euler = (math.radians(18), math.radians(-10), 0); apply_tf(ring)
    out.append(prop("planet_ringed", [planet] + bands + [ring]))
    p2 = mat("planet2", "#5BC0FF", rough=0.4, coat=0.5)
    pl = ball(uid("planet2"), 1.0, (0, 0, 0), p2, seg=48, rings=24)
    craters = []
    for d in fib_dirs(14):
        craters.append(ball(uid("crater"), 1, tuple(d * 0.97), mat("crater", "#3D8BFF", rough=0.6), scale=(0.18, 0.18, 0.05), rot=d.to_track_quat('Z', 'Y')))
    out.append(prop("planet_moon", [pl] + craters))
    p3 = [mat("gas1", "#A77BFF", rough=0.35, coat=0.6), mat("gas2", "#FFB020", rough=0.35, coat=0.6)]
    gp = lathe(uid("gas"), sphere_profile(1.0, 1.0, 0.0, 24), p3[0], steps=48)
    gp.data.materials.append(p3[1])
    for f in gp.data.polygons: f.material_index = int((f.center.z + 1) * 4) % 2
    out.append(prop("planet_gas", [gp]))
    # asteroids
    rock = mat("rock", "#6E64A6", rough=0.7, coat=0.1)
    for k in range(3):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.3 + 0.1 * k)
        a = bpy.context.object
        off = Vector((k * 3.1, k * 1.7, 0.5))
        for v in a.data.vertices:
            v.co *= 1 + 0.28 * noise.noise(v.co * 3 + off) + 0.08 * noise.noise(v.co * 9 + off)
        lib._finish(a, uid("rock"), None, rock, True)
        out.append(prop(f"asteroid{k}", [a]))
    # crystals
    cr = [mat("crys1", "#4DE1FF", rough=0.05, coat=1.0, emit=1.2), mat("crys2", "#FF4FD8", rough=0.05, coat=1.0, emit=1.2)]
    for k in range(2):
        parts = []
        for i in range(5):
            a = i * 1.3 + k; tilt = 0.25 + 0.1 * (i % 3)
            d = Vector((math.cos(a) * tilt, math.sin(a) * tilt, 1)).normalized()
            h = 0.5 + 0.25 * ((i * 7) % 4) / 3
            c = cyl(uid("cr"), 0.09, h, (0, 0, 0), cr[k], r2=0.0, verts=6)
            c.rotation_mode = 'QUATERNION'; c.rotation_quaternion = d.to_track_quat('Z', 'Y'); c.location = d * h * 0.45
            apply_tf(c); parts.append(c)
        out.append(prop(f"crystal{k}", parts))
    # UFO
    hull = mat("ufo", "#D9E2F2", rough=0.2, metal=0.6, coat=0.8)
    dome = mat("dome", "#8FE3FF", rough=0.05, coat=1.0, alpha=0.6, emit=0.3)
    parts = [lathe(uid("saucer"), [(0.0, -0.08), (0.25, -0.08), (0.55, 0.0), (0.25, 0.09), (0.0, 0.1)], hull, steps=48)]
    subdiv(parts[0], 1)
    parts.append(ball(uid("dome"), 0.22, (0, 0, 0.1), dome, scale=(1, 1, 0.8)))
    for i in range(8):
        a = 2 * math.pi * i / 8
        parts.append(ball(uid("ufolight"), 0.035, (0.42 * math.cos(a), 0.42 * math.sin(a), 0.01), lib.rainbow_mats()[i % 6]))
    alien = ball(uid("alien"), 0.1, (0, 0, 0.13), mat("alien", "#7CF29A", rough=0.3, coat=0.8))
    parts.append(alien)
    f = lib.Face(alien, (0, -0.2, 0.14))
    parts += f.eyes(0.035, 0.01, 0.02, 0.03, M)
    out.append(prop("ufo", parts))
    # floating star
    out.append(prop("star", [puffy_star(uid("bigstar"), 0.4, 0.18, 0.18, (0, 0, 0), mat("starprop", "#FFD23F", emit=1.5, rough=0.3), puff=0.9)]))
    # satellite
    panel = mat("panel", "#3D5BFF", rough=0.15, metal=0.4, coat=1.0)
    parts = [rbox(uid("sat"), (0.3, 0.3, 0.3), (0, 0, 0), mat("satbody", "#FFC23D", rough=0.25, metal=0.8), radius=0.04)]
    for sx in (-1, 1):
        parts.append(rbox(uid("panel"), (0.55, 0.02, 0.28), (sx * 0.5, 0, 0), panel, radius=0.01))
        parts.append(capsule(uid("strut"), (sx * 0.15, 0, 0), (sx * 0.24, 0, 0), 0.015, M["silver"]))
    parts.append(cone(uid("dish"), 0.16, 0.08, (0, 0, 0.15), (0, 0, 1), M["silver"], r2=0.02, verts=24))
    out.append(prop("satellite", parts))
    return out

KITS = {"common": common, "candy": candy, "spooky": spooky, "galaxy": galaxy}

def preview(name, roots):
    cam = lib.studio(bg={"common": "#30264a", "candy": "#ffd9ec", "spooky": "#2a2040", "galaxy": "#1a1a40"}[name], res=(1600, 800))
    x = 0.0; placed = []
    for r in roots:
        dims = max([max(c.dimensions) for c in r.children_recursive if c.type == 'MESH'] or [1.0])
        s = 1.0 if dims < 1.6 else 1.6 / dims
        r.scale = (s, s, s)
        w = min(dims, 1.6)
        r.location = (x + w / 2, 0, 0 if name != "galaxy" else w / 2)
        x += w + 0.25
    for r in roots: r.location.x -= x / 2
    lib.shoot(cam, (0, -x * 0.95, x * 0.32), (0, 0, 0.6), 50, f"kit_{name}.png")

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    which = [a for a in argv if a in KITS] or list(KITS)
    for name in which:
        lib.reset()
        roots = KITS[name](random.Random(5))
        lib.export(roots, f"{'common' if name == 'common' else 'kit_' + name}.glb")
        f = os.path.join(lib.ASSETS, f"{'common' if name == 'common' else 'kit_' + name}.glb")
        print("exported", name, len(roots), "props", os.path.getsize(f) // 1024, "KB", sum(lib.tris(r) for r in roots), "tris")
        if "render" in argv: preview(name, roots)
