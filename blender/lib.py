# Modelling helpers for the ROOK & ROLL asset scripts (Blender 5.x, run headless).
# Conventions: Blender is Z-up, one board square = 1.0, a character faces -Y (towards the viewer;
# glTF export turns that into +Z in Three.js). Materials whose name starts with "T_" are team
# slots: the game repaints them per team from assets/palettes.json.
import bpy, bmesh, math, os, json, random
from mathutils import Vector, Quaternion, Matrix
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
RENDERS = os.path.join(ROOT, "renders")
PALETTES = json.load(open(os.path.join(ASSETS, "palettes.json")))
scn = None
_uid = [0]

def uid(prefix):
    _uid[0] += 1
    return f"{prefix}_{_uid[0]}"

def reset():
    global scn
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    _mats.clear()
    return scn

def hexc(h):
    h = h.lstrip("#")
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))

_mats = {}
def mat(name, color, rough=0.42, metal=0.0, coat=0.6, emit=0.0, alpha=1.0, coat_rough=0.08, sheen=0.0):
    """Glossy vinyl-toy Principled material. `emit` > 0 glows in its own colour."""
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    c = hexc(color)
    b.inputs["Base Color"].default_value = (*c, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = coat_rough
    if sheen: b.inputs["Sheen Weight"].default_value = sheen
    if emit:
        b.inputs["Emission Color"].default_value = (*c, 1)
        b.inputs["Emission Strength"].default_value = emit
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    _mats[name] = m
    return m

def team_mats(arena, team="light"):
    """T_main / T_accent / T_base / T_glow / T_ring for an arena (colours of the given team)."""
    p = PALETTES[arena][team]
    return {
        "main": mat("T_main", p["T_main"], rough=0.38, coat=0.7),
        "accent": mat("T_accent", p["T_accent"], rough=0.36, coat=0.7),
        "base": mat("T_base", p["T_base"], rough=0.3, coat=0.9),
        "glow": mat("T_glow", p["T_glow"], rough=0.3, coat=0.5, emit=1.6),
        "ring": mat("T_ring", p["T_ring"], rough=0.25, coat=0.8, emit=0.6),
    }

def common_mats():
    return {
        "eye": mat("eye", "#1A1033", rough=0.12, coat=1.0, coat_rough=0.02),
        "shine": mat("shine", "#FFFFFF", rough=0.2, emit=2.0, coat=0),
        "mouth": mat("mouth", "#5A1A3A", rough=0.4, coat=0.4),
        "tongue": mat("tongue", "#FF7A9C", rough=0.4, coat=0.5),
        "blush": mat("blush", "#FF8FB1", rough=0.6, coat=0.1),
        "gold": mat("gold", "#FFC23D", rough=0.22, metal=1.0, coat=0.3),
        "silver": mat("silver", "#D9E2F2", rough=0.2, metal=1.0, coat=0.2),
        "white": mat("white", "#FFFFFF", rough=0.35, coat=0.6),
        "ruby": mat("ruby", "#FF3D6E", rough=0.08, coat=1.0, emit=0.3),
        "sapphire": mat("sapphire", "#3D8BFF", rough=0.08, coat=1.0, emit=0.3),
        "emerald": mat("emerald", "#2BD99F", rough=0.08, coat=1.0, emit=0.3),
    }

RAINBOW = ["#FF5A6E", "#FF9F43", "#FFE066", "#5BE38A", "#4DB5FF", "#A77BFF"]
def rainbow_mats():
    return [mat(f"rb{i}", c, rough=0.3, coat=0.8) for i, c in enumerate(RAINBOW)]

# ---------------------------------------------------------------- object helpers
def _finish(o, name, parent, material, smooth=True):
    o.name = name
    if o.type == 'MESH':
        if material is not None:
            o.data.materials.clear(); o.data.materials.append(material)
        if smooth is not None:
            for p in o.data.polygons: p.use_smooth = smooth
    if parent is not None:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o

def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o

def apply_mods(o):
    select_only(o)
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)

def apply_tf(o):
    select_only(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def subdiv(o, levels=2):
    m = o.modifiers.new("sub", 'SUBSURF'); m.levels = levels; m.render_levels = levels
    apply_mods(o)
    for p in o.data.polygons: p.use_smooth = True
    return o

def bevel(o, width, segs=3):
    m = o.modifiers.new("bev", 'BEVEL'); m.width = width; m.segments = segs; m.limit_method = 'ANGLE'
    apply_mods(o)
    return o

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None); scn.collection.objects.link(o)
    o.location = loc; o.empty_display_size = 0.1
    if parent is not None:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o

def ball(name, r, loc, material, scale=(1, 1, 1), seg=28, rings=14, rot=None, parent=None):
    # small things get fewer segments (they are a few pixels on screen)
    eff = r * max(scale)
    seg = max(12, min(seg, round(eff * 200)))
    rings = max(6, min(rings, seg // 2))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(0, 0, 0), segments=seg, ring_count=rings)
    o = bpy.context.object; o.scale = scale
    if rot is not None:
        o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = rot
    o.location = loc
    apply_tf(o)
    return _finish(o, name, parent, material, True)

def rbox(name, size, loc, material, radius=0.03, rot=(0, 0, 0), parent=None, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.scale = size
    apply_tf(o)
    if radius:
        bevel(o, radius, segs)
    return _finish(o, name, parent, material, True)

def cyl(name, r, depth, loc, material, r2=None, verts=40, rot=(0, 0, 0), parent=None, round_edges=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    apply_tf(o)
    if round_edges: bevel(o, round_edges, 3)
    _finish(o, name, parent, material, None)
    for p in o.data.polygons: p.use_smooth = abs(p.normal.z) < 0.9 or round_edges > 0
    return o

def torus(name, R, r, loc, material, rot=(0, 0, 0), seg=40, mseg=10, parent=None):
    bpy.ops.mesh.primitive_torus_add(location=loc, major_radius=R, minor_radius=r, rotation=rot,
                                     major_segments=seg, minor_segments=mseg)
    o = bpy.context.object; apply_tf(o)
    return _finish(o, name, parent, material, True)

def capsule(name, a, b, r, material, r2=None, parent=None, seg=20):
    """Rounded limb from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a; L = d.length
    r2 = r if r2 is None else r2
    seg = max(8, min(seg, round(max(r, r2) * 280)))
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=L, vertices=seg, location=(a + b) / 2)
    o = bpy.context.object
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    apply_tf(o)
    parts = [o]
    for p, rr in ((a, r), (b, r2)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=rr, location=p, segments=seg, ring_count=max(4, seg // 2))
        parts.append(bpy.context.object)
    o = join(parts, name)
    return _finish(o, name, parent, material, True)

def cone(name, r, h, base_loc, direction, material, r2=0.0, verts=24, parent=None):
    """Cone standing on base_loc pointing along direction."""
    d = Vector(direction).normalized()
    bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=h, vertices=verts, location=(0, 0, 0))
    o = bpy.context.object
    o.location = Vector(base_loc) + d * h / 2
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    apply_tf(o)
    _finish(o, name, parent, material, None)
    for p in o.data.polygons: p.use_smooth = True
    return o

def mesh_from_bm(name, bm, material, parent=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scn.collection.objects.link(o)
    return _finish(o, name, parent, material, smooth)

def lathe(name, profile, material, steps=48, parent=None, loc=(0, 0, 0), smooth=True):
    """Revolve a (radius, z) profile around Z. Profile goes bottom → top."""
    bm = bmesh.new()
    rings = []
    for i in range(steps):
        a = 2 * math.pi * i / steps
        rings.append([bm.verts.new((r * math.cos(a) + loc[0], r * math.sin(a) + loc[1], z + loc[2])) for r, z in profile])
    for i in range(steps):
        r0, r1 = rings[i], rings[(i + 1) % steps]
        for j in range(len(profile) - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    # caps
    if profile[0][0] > 1e-4: bm.faces.new([rings[i][0] for i in reversed(range(steps))])
    if profile[-1][0] > 1e-4: bm.faces.new([rings[i][-1] for i in range(steps)])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, material, parent, smooth)

def prism(name, pts, depth, material, parent=None, smooth=False):
    """Extrude a 2D outline (x, z) along Y by depth (centred on y=0)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, -depth / 2, z)) for x, z in pts]
    f = bm.faces.new(vs)
    ex = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ex["geom"] if isinstance(e, bmesh.types.BMVert)]: v.co.y += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bm(name, bm, material, parent, smooth)

def star_points(n, r_out, r_in, rot=math.pi / 2):
    pts = []
    for i in range(n * 2):
        a = rot + math.pi * i / n
        r = r_out if i % 2 == 0 else r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts

def puffy_star(name, r_out, r_in, depth, loc, material, puff=0.6, rot_y=0.0, parent=None):
    """Soft 5-point star: extruded outline, inflated with subdivision."""
    pts = star_points(5, r_out, r_in)
    o = prism(name, pts, depth, material)
    m = o.modifiers.new("bev", 'BEVEL'); m.width = depth * 0.45; m.segments = 3
    apply_mods(o)
    subdiv(o, 1)
    # puff the faces outward along Y a little so it reads as a cushion
    for v in o.data.vertices:
        rr = math.hypot(v.co.x, v.co.z) / r_out
        v.co.y *= 1 + puff * max(0.0, 1 - rr)
    o.rotation_euler = (0, rot_y, 0); o.location = loc
    apply_tf(o)
    return _finish(o, name, parent, material, True)

def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        select_only(o)
        for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    objs[0].name = name
    return objs[0]

def origin_to(o, point):
    saved = scn.cursor.location.copy()
    scn.cursor.location = point
    select_only(o)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    scn.cursor.location = saved

def metaball(name, elems, material, res=0.025, thresh=0.6, parent=None):
    """Blobby organic shape. elems: dicts {co, r, type?, size?, neg?, stiff?, rot?} → converted to a mesh."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res; mb.render_resolution = res; mb.threshold = thresh
    o = bpy.data.objects.new(uid("MB" + name), mb); scn.collection.objects.link(o)
    for e in elems:
        el = mb.elements.new(type=e.get("type", "BALL"))
        el.co = e["co"]; el.radius = e["r"]
        if "size" in e: el.size_x, el.size_y, el.size_z = e["size"]
        if e.get("neg"): el.use_negative = True
        el.stiffness = e.get("stiff", 2.0)
        if "rot" in e: el.rotation = e["rot"]
    select_only(o)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.object
    return _finish(o, name, parent, material, True)

# ---------------------------------------------------------------- faces (ray-cast onto any head shape)
class Face:
    """Projects features onto the surface of `target` from the front.
    centre: point in front of the face, front: direction the face looks."""
    def __init__(self, target, centre, front=(0, -1, 0), up=(0, 0, 1)):
        dg = bpy.context.evaluated_depsgraph_get()
        self.bvh = BVHTree.FromObject(target, dg)
        self.c = Vector(centre)
        self.f = Vector(front).normalized()
        u = Vector(up)
        self.r = u.cross(self.f).normalized()
        self.u = self.f.cross(self.r).normalized() * -1
        if self.u.z < 0: self.u = -self.u

    def hit(self, dx, dy):
        o = self.c + self.r * dx + self.u * dy + self.f * 1.5
        loc, nrm, idx, dist = self.bvh.ray_cast(o, -self.f, 5.0)
        if loc is None:
            return self.c + self.r * dx + self.u * dy, self.f.copy()
        return loc, nrm.normalized()

    def orient(self, n):
        # local Z along the normal, local Y as close to the face's up as possible
        z = n.normalized()
        x = self.u.cross(z).normalized()
        y = z.cross(x).normalized()
        return Matrix((x, y, z)).transposed().to_quaternion()

    def eye(self, dx, dy, w, h, M, name="eye", depth=None, shine=True, parent=None):
        loc, n = self.hit(dx, dy)
        d = depth or w * 0.5
        q = self.orient(n)
        parts = [ball(uid(name), 1, loc + n * (-d * 0.25), M["eye"], scale=(w, h, d), rot=q)]
        if shine:
            parts.append(ball(uid("sh"), w * 0.36, loc + n * (d * 0.62) + q @ Vector((-w * 0.32, h * 0.38, 0)), M["shine"], seg=16, rings=8))
            parts.append(ball(uid("sh"), w * 0.17, loc + n * (d * 0.55) + q @ Vector((w * 0.3, -h * 0.35, 0)), M["shine"], seg=12, rings=6))
        return parts

    def eyes(self, gap, dy, w, h, M, **kw):
        return self.eye(-gap, dy, w, h, M, **kw) + self.eye(gap, dy, w, h, M, **kw)

    def disc(self, dx, dy, w, h, d, material, name="disc", lift=0.0):
        loc, n = self.hit(dx, dy)
        return ball(uid(name), 1, loc + n * lift, material, scale=(w, h, d), rot=self.orient(n), seg=24, rings=12)

    def blush(self, gap, dy, w, M):
        return [self.disc(-gap, dy, w, w * 0.6, w * 0.25, M["blush"], "blush"),
                self.disc(gap, dy, w, w * 0.6, w * 0.25, M["blush"], "blush")]

    def curve(self, pts2d, thick, material, name="mouth", lift=0.0):
        cu = bpy.data.curves.new(uid(name), 'CURVE'); cu.dimensions = '3D'
        sp = cu.splines.new('POLY'); sp.points.add(len(pts2d) - 1)
        for i, (dx, dy) in enumerate(pts2d):
            loc, n = self.hit(dx, dy)
            p = loc + n * lift
            sp.points[i].co = (p.x, p.y, p.z, 1)
        cu.bevel_depth = thick; cu.bevel_resolution = 4; cu.use_fill_caps = True
        o = bpy.data.objects.new(uid(name), cu); scn.collection.objects.link(o)
        select_only(o); bpy.ops.object.convert(target='MESH')
        o = bpy.context.object
        return _finish(o, uid(name), None, material, True)

    def smile(self, dy, width, depth, M, thick=0.011, n=14):
        pts = [(width * t, dy - depth * (1 - t * t)) for t in [-1 + 2 * i / (n - 1) for i in range(n)]]
        return [self.curve(pts, thick, M["mouth"])]

    def open_mouth(self, dy, w, h, M, tongue=True):
        parts = [self.disc(0, dy, w, h, w * 0.35, M["mouth"], "mouth")]
        if tongue: parts.append(self.disc(0, dy - h * 0.38, w * 0.62, h * 0.42, w * 0.3, M["tongue"], "tongue", lift=0.006))
        return parts

    def fangs(self, dy, gap, size, M):
        out = []
        for s in (-1, 1):
            loc, n = self.hit(gap * s, dy)
            out.append(cone(uid("fang"), size * 0.55, size, loc + n * 0.003 + self.u * size * 0.25, -self.u + n * 0.25, M["white"], verts=12))
        return out

    def brows(self, gap, dy, w, tilt, M, thick=0.012):
        """Mischievous brows (only shown on the dark team in-game)."""
        parts = []
        for s in (-1, 1):
            a = (s * (gap - w * 0.5), dy - tilt)   # inner end lower
            b = (s * (gap + w * 0.5), dy + tilt)
            la, na = self.hit(*a); lb, nb = self.hit(*b)
            parts.append(capsule(uid("brow"), la + na * 0.008, lb + nb * 0.008, thick, M["eye"], seg=12))
        return join(parts, "brows")

# ---------------------------------------------------------------- shared props
def base_disc(T, M, r=0.36):
    """The toy stand every piece stands on: team-coloured puck with a glowing team ring."""
    b = cyl(uid("base"), r, 0.1, (0, 0, 0.05), T["base"], verts=48, round_edges=0.03)
    ring = torus(uid("ring"), r - 0.01, 0.017, (0, 0, 0.095), T["ring"], seg=48, mseg=8)
    return join([b, ring], "base")

def crown(c, r, h, M, spikes=5, gems=True, top_orb=True):
    """Gold crown sitting on centre c (bottom of the band)."""
    c = Vector(c)
    parts = [cyl(uid("crownband"), r, h * 0.45, c + Vector((0, 0, h * 0.22)), M["gold"], verts=40, round_edges=0.01)]
    for i in range(spikes):
        a = -math.pi / 2 + 2 * math.pi * i / spikes
        p = c + Vector((math.cos(a) * r * 0.92, math.sin(a) * r * 0.92, h * 0.4))
        parts.append(cone(uid("spike"), r * 0.32, h * 0.62, p, (math.cos(a) * 0.12, math.sin(a) * 0.12, 1), M["gold"], verts=4))
        parts.append(ball(uid("tip"), r * 0.13, p + Vector((math.cos(a) * 0.012, math.sin(a) * 0.012, h * 0.62)), M["gold"], seg=12, rings=8))
    out = [join(parts, "crown")]
    if gems:
        for i, g in enumerate(["ruby", "sapphire", "emerald", "sapphire", "ruby"][:spikes]):
            a = -math.pi / 2 + 2 * math.pi * i / spikes
            p = c + Vector((math.cos(a) * r * 1.0, math.sin(a) * r * 1.0, h * 0.22))
            out.append(ball(uid("gem"), r * 0.16, p, M[g], scale=(1, 1, 1.2), seg=16, rings=8))
    if top_orb:
        o = c + Vector((0, 0, h * 1.05))
        out.append(ball(uid("orb"), r * 0.22, o, M["gold"], seg=20, rings=10))
        out.append(rbox(uid("cross"), (r * 0.08, r * 0.08, r * 0.42), o + Vector((0, 0, r * 0.32)), M["gold"], radius=0.006))
        out.append(rbox(uid("cross"), (r * 0.3, r * 0.08, r * 0.08), o + Vector((0, 0, r * 0.38)), M["gold"], radius=0.006))
    return out

def tiara(c, r, M, gem="ruby", h=0.07):
    c = Vector(c)
    parts = [torus(uid("tiara"), r, 0.012, c, M["gold"], seg=40, mseg=8)]
    for i, k in enumerate((-2, -1, 0, 1, 2)):
        a = -math.pi / 2 + k * 0.42
        p = c + Vector((math.cos(a) * r, math.sin(a) * r, 0))
        hh = h * (1.0 if k == 0 else 0.62 if abs(k) == 1 else 0.4)
        parts.append(cone(uid("tpt"), 0.016, hh, p, (math.cos(a) * 0.15, math.sin(a) * 0.15, 1), M["gold"], verts=8))
        parts.append(ball(uid("tball"), 0.012, p + Vector((0, 0, hh)), M["gold"], seg=10, rings=6))
    out = [join(parts, "tiara")]
    out.append(ball(uid("tgem"), 0.026, c + Vector((0, -r - 0.006, h * 0.35)), M[gem], scale=(1, 0.6, 1.2), seg=16, rings=10))
    return out

# ---------------------------------------------------------------- assembly / export
def slim(o, budget=2600):
    """Collapse-decimate dense parts (metaballs, swirls) down to about `budget` triangles."""
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if n <= budget: return o
    m = o.modifiers.new("dec", 'DECIMATE'); m.ratio = max(0.3, budget / n)
    apply_mods(o)
    for p in o.data.polygons: p.use_smooth = True
    return o

def assemble(name, base, body_parts, extras=None):
    """root (name) → base, body (empty at the top of the base) → body mesh + named extras (brows, wings)."""
    root = empty(name)
    base.parent = root
    body = empty(name + "_body", (0, 0, 0.1), root)
    body.name = "body"
    stats = []
    for o in body_parts:
        if o is not None and o.type == 'MESH':
            slim(o)
            stats.append((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name))
    if os.environ.get("RNR_STATS"):
        stats.sort(reverse=True)
        print("   ", name, "top parts:", stats[:6], "count", len(stats), "sum", sum(s for s, _ in stats))
    mesh = join(body_parts, "figure")
    mesh.parent = body; mesh.matrix_parent_inverse = body.matrix_world.inverted()
    for o in (extras or []):
        o.parent = body; o.matrix_parent_inverse = body.matrix_world.inverted()
    return root

def export(roots, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for r in roots:
        r.select_set(True)
        for c in r.children_recursive: c.select_set(True)
    os.makedirs(ASSETS, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(ASSETS, filename), export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True,
                              export_extras=False, export_lights=False, export_cameras=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10)

def tris(o):
    n = 0
    for c in [o] + list(o.children_recursive):
        if c.type == 'MESH': n += sum(len(p.vertices) - 2 for p in c.data.polygons)
    return n

# ---------------------------------------------------------------- preview renders
def studio(res=(1600, 700), samples=48, bg="#20182e", strength=0.9, env_top="#bfd8ff"):
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = samples
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        scn.cycles.device = 'GPU'
    except Exception:
        scn.cycles.device = 'CPU'
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.view_settings.view_transform = 'AgX'
    try: scn.view_settings.look = 'AgX - Punchy'
    except Exception: pass
    w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (*hexc(bg), 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = strength
    def area(loc, energy, size, color=(1, 1, 1)):
        bpy.ops.object.light_add(type='AREA', location=loc)
        k = bpy.context.object; k.data.energy = energy; k.data.size = size; k.data.color = color
        k.rotation_euler = (Vector((0, 0, 0.5)) - k.location).to_track_quat('-Z', 'Y').to_euler()
    area((3, -5, 6), 1600, 5)
    area((-5, -3, 3), 500, 6, (0.85, 0.9, 1.0))
    area((0, 6, 4), 900, 4, (1.0, 0.85, 0.95))   # rim
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    fl = bpy.context.object; fl.data.materials.append(mat("floor", bg, rough=0.6, coat=0))
    bpy.ops.object.camera_add(); cam = bpy.context.object; scn.camera = cam
    return cam

def shoot(cam, loc, target, lens, filename):
    cam.location = loc; cam.data.lens = lens
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    os.makedirs(RENDERS, exist_ok=True)
    scn.render.filepath = os.path.join(RENDERS, filename)
    bpy.ops.render.render(write_still=True)

def recolor(arena, team):
    """Repaint the team slots (for preview renders of the other team)."""
    p = PALETTES[arena][team]
    for k, v in p.items():
        m = bpy.data.materials.get(k)
        if not m: continue
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*hexc(v), 1)
        if b.inputs["Emission Strength"].default_value > 0:
            b.inputs["Emission Color"].default_value = (*hexc(v), 1)
