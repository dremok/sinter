"""
Build the SINTER kitbash parts library.

Run headless:

    blender --background --factory-startup --python tools/blender/build_parts.py

Writes `assets/parts/parts.glb`, a single file containing every part as a named
mesh. The game loads it once and indexes by name, so the whole library costs one
request rather than one per part.

Why this exists, from docs/ASSET_PIPELINE.md: the catalog is closed under
merging, so the number of distinct items is unbounded. Authoring a mesh per item
is impossible in principle, not merely expensive. Instead a small library of
good parts is authored once, and every item, base or merged, is assembled from
it in code. That is also what lets a merge result visibly inherit parts from
both parents (DECISIONS D6).

Conventions, and they matter. Assemblies go subtly wrong forever if these drift:

  - Z up, metres, real-world-ish scale. A haft is about 0.7 long.
  - The object origin sits at the part's ATTACHMENT POINT, not its centroid.
    For a haft that is the butt end; for a blade it is where the haft meets it.
    This is what lets code place parts by socket without per-part fudge offsets.
  - Sockets are empties named `socket_tip` / `socket_mid`, in part-local space.
  - No materials. Material is chosen at assembly time from the item's recipe.
  - Everything is bevelled. Hard 90 degree edges read as untextured boxes under
    cel shading; a small bevel catches the light band and is most of why these
    look authored rather than primitive.

How the shapes are made, and why not primitives:

A deformed cube is not an axe. At the size these render, an item has to be
identifiable from its outline, so silhouette is the whole budget and it has to
be spent on real form: a bit that curves, a bucket that tapers over a rolled
rim, a haft that swells where a hand would go. So the builders below sit on four
generic modelling operators rather than on `primitive_cube_add`:

  - `bm_lathe`   revolve a (radius, height) profile. Vessels, hafts, plugs.
  - `bm_loft`    bridge a run of cross sections. Blades, bars, bales.
  - `bm_sweep`   run a cross section along a path frame. Hoops, rope, shoes.
  - `bm_box`     a box, for the handful of places a box is honestly right.

The two section generators, `blade_section` and `box_section`, are what carry
the secondary detail: per station thickness, so an axe is fat at the eye and
razor at the edge, and a chamfer, so every long edge has a facet to catch the
cel band.

Proportions are deliberately exaggerated. Heads are chunkier and tapers stronger
than a real object's, because accurate proportions read as generic at 30 pixels.
"""

import math
import os

import bpy
import bmesh
from mathutils import Vector

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "parts")
OUT_FILE = os.path.join(OUT_DIR, "parts.glb")


# --------------------------------------------------------------------- helpers

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def active(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)


def bevel(obj, width=0.008, segments=2, angle=48):
    m = obj.modifiers.new(name="bevel", type="BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(angle)
    active(obj)
    bpy.ops.object.modifier_apply(modifier=m.name)


def tri_count(obj):
    return sum(max(len(p.vertices) - 2, 0) for p in obj.data.polygons)


def anchor(obj, mode="base"):
    """
    Move mesh data so the object origin lands on the attachment point.

    Blender primitives are centred on their origin, which would make every
    assembly need a per-part offset in game code. Doing it here once means the
    code can honestly say "put this part at this socket".
    """
    mesh = obj.data
    zs = [v.co.z for v in mesh.vertices]
    if not zs:
        return
    if mode == "base":
        shift = -min(zs)
    elif mode == "top":
        shift = -max(zs)
    else:
        shift = 0.0
    for v in mesh.vertices:
        v.co.z += shift


def socket(part, name, location):
    e = bpy.data.objects.new(f"{part.name}.{name}", None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.03
    e.parent = part
    e.location = Vector(location)
    bpy.context.collection.objects.link(e)


def finish(obj, name, anchor_mode="base", smooth=False, bevel_width=0.008, bevel_segments=2):
    obj.name = name
    obj.data.name = name
    anchor(obj, anchor_mode)
    bevel(obj, width=bevel_width, segments=bevel_segments)
    active(obj)
    if smooth:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_flat()
    return obj


def jitter(obj, amount, seed):
    """Push vertices around deterministically, for things that are not machined."""
    rng = _Lcg(seed)
    for v in obj.data.vertices:
        v.co.x += (rng.next() - 0.5) * amount
        v.co.y += (rng.next() - 0.5) * amount
        v.co.z += (rng.next() - 0.5) * amount


class _Lcg:
    """Tiny deterministic PRNG. Python's `random` would do, but this keeps the
    output byte-identical across Python versions, which matters for a committed
    binary asset."""

    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (1103515245 * self.s + 12345) & 0x7FFFFFFF
        return self.s / 0x7FFFFFFF


# ----------------------------------------------------------------- bmesh tools

def _face(bm, verts):
    """Add a face, dropping the degenerate ones a generated profile throws off.

    A lathe profile that touches the axis, or a blade section pinched to nothing
    at the cutting edge, both produce runs of coincident vertices. Filtering
    here is what lets the profile tables read as shapes rather than as a list of
    special cases.
    """
    uniq = []
    for v in verts:
        if not uniq or uniq[-1] is not v:
            uniq.append(v)
    if len(uniq) > 1 and uniq[0] is uniq[-1]:
        uniq.pop()
    if len(uniq) < 3:
        return None
    try:
        return bm.faces.new(uniq)
    except ValueError:
        return None


def bm_lathe(bm, profile, segments=12, phase=0.0, lobes=0):
    """
    Revolve a profile around Z.

    `profile` runs bottom to top as `(radius, z)` or `(radius, z, wobble)`.
    A radius of zero closes the surface with a fan, so a profile that starts and
    ends on the axis produces a solid. A vessel is written as one continuous
    profile that climbs the outside, rolls over the rim and comes back down the
    inside, which is what gives it a wall with real thickness rather than an
    open shell that shows its own backfaces.

    `wobble` breaks the circle. With `lobes` at zero it offsets alternating
    segments, which is a cooper's staves; with `lobes` set it becomes a cosine
    around the axis, which is the five soft ridges an apple has. Either way it
    costs nothing, and it is what stops every turned part reading as the same
    cylinder.
    """
    rings = []
    for entry in profile:
        r, z = entry[0], entry[1]
        wob = entry[2] if len(entry) > 2 else 0.0
        if r <= 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
            continue
        ring = []
        for i in range(segments):
            a = phase + 2.0 * math.pi * i / segments
            if lobes:
                rr = r + wob * math.cos(lobes * a)
            else:
                rr = r + (wob if i % 2 == 0 else -wob)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)

    for lo, hi in zip(rings, rings[1:]):
        if len(lo) == 1 and len(hi) == 1:
            continue
        if len(lo) == 1:
            for i in range(segments):
                _face(bm, [lo[0], hi[i], hi[(i + 1) % segments]])
        elif len(hi) == 1:
            for i in range(segments):
                _face(bm, [lo[i], lo[(i + 1) % segments], hi[0]])
        else:
            for i in range(segments):
                j = (i + 1) % segments
                _face(bm, [lo[i], lo[j], hi[j], hi[i]])
    return rings


def bm_loft(bm, sections, cap_start=True, cap_end=True, closed=False):
    """Bridge a run of equal-length cross sections. `sections` are lists of
    `(x, y, z)`, ordered the same way around each loop."""
    rings = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(rings[0])
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    for lo, hi in pairs:
        for i in range(n):
            j = (i + 1) % n
            _face(bm, [lo[i], lo[j], hi[j], hi[i]])
    if not closed:
        if cap_start:
            _face(bm, list(reversed(rings[0])))
        if cap_end:
            _face(bm, list(rings[-1]))
    return rings


def bm_sweep(bm, frames, section, closed=False):
    """Run a 2D section along a path. `frames` are `(origin, u, v, t)`; `section`
    is called per frame and returns points in that frame's `(u, v)` plane, so a
    hoop can taper or a rope can twist along its length."""
    secs = []
    for i, (o, u, v, t) in enumerate(frames):
        secs.append([tuple(o + u * su + v * sv) for (su, sv) in section(i, t)])
    return bm_loft(bm, secs, closed=closed)


def arc_frames(radius, a0, a1, steps, z=0.0, closed=False):
    """Frames around a circular arc in the XY plane, u pointing outward."""
    out = []
    span = steps if closed else max(steps - 1, 1)
    for i in range(steps):
        t = i / span
        a = a0 + (a1 - a0) * t
        c, s = math.cos(a), math.sin(a)
        out.append((Vector((radius * c, radius * s, z)),
                    Vector((c, s, 0.0)), Vector((0.0, 0.0, 1.0)), t))
    return out


def bm_box(bm, lo, hi):
    """An axis aligned box. Used where a box is honestly the right answer, which
    is mostly crate framing."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [bm.verts.new(p) for p in (
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    )]
    for q in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1),
              (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        _face(bm, [v[i] for i in q])


def emit(bm, name, anchor_mode="base", smooth=False, bevel_width=0.008, bevel_segments=2):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, anchor_mode, smooth, bevel_width, bevel_segments)


# -------------------------------------------------------------------- sections

def blade_section(x, z0, z1, half_t, fullness=0.0, bow=0.0, fullness_lo=None, floor=0.0016):
    """
    A ten point cross section for anything with an edge, in the YZ plane.

    `fullness` is the thickness at the top of the section as a fraction of
    `half_t`, and `fullness_lo` the same at the bottom, defaulting to match.
    That asymmetry is the difference between a knife, which is a plate with a
    full spine and nothing at all at the edge, and an axe head, whose top and
    bottom are both blunt rims because its edge is at the far end instead.

    Getting this wrong is worth spelling out, because the first pass did: a low
    fullness at BOTH ends makes a lens, and a lens has no flat side. An axe bit
    is a thin plate with rounded rims, so it wants a small `half_t` and a fairly
    high fullness. Give it a low one and it bulges in the middle, loses its
    flats, and renders as a soft blob no amount of bevelling recovers.

    `bow` pushes the middle of the section forward, so a run of sections can
    close on a convex cutting edge rather than a straight chisel.
    """
    if fullness_lo is None:
        fullness_lo = fullness
    h = z1 - z0
    zm = 0.5 * (z0 + z1)
    t_hi = max(half_t * fullness, floor)
    t_lo = max(half_t * fullness_lo, floor)
    q_hi = max(half_t * (0.30 + 0.70 * fullness), floor)
    q_lo = max(half_t * (0.30 + 0.70 * fullness_lo), floor)

    def bx(z):
        u = (z - zm) / (0.5 * h) if abs(h) > 1e-9 else 0.0
        return x + bow * max(0.0, 1.0 - u * u)

    zq_hi = z1 - h * 0.20
    zq_lo = z0 + h * 0.20
    return [
        (bx(z1), -t_hi, z1),
        (bx(zq_hi), -q_hi, zq_hi),
        (bx(zm), -half_t, zm),
        (bx(zq_lo), -q_lo, zq_lo),
        (bx(z0), -t_lo, z0),
        (bx(z0), t_lo, z0),
        (bx(zq_lo), q_lo, zq_lo),
        (bx(zm), half_t, zm),
        (bx(zq_hi), q_hi, zq_hi),
        (bx(z1), t_hi, z1),
    ]


def box_section(x, half_y, z0, z1, chamfer=0.28):
    """An eight point chamfered rectangle in the YZ plane. The chamfer is the
    point: a square section reads as an untextured box, a chamfered one has four
    extra facets that each take the light differently."""
    h = z1 - z0
    c = chamfer * min(2.0 * half_y, h) * 0.5
    return [
        (x, -half_y, z0 + c),
        (x, -half_y + c, z0),
        (x, half_y - c, z0),
        (x, half_y, z0 + c),
        (x, half_y, z1 - c),
        (x, half_y - c, z1),
        (x, -half_y + c, z1),
        (x, -half_y, z1 - c),
    ]


# ----------------------------------------------------------------------- parts

def haft(name, length, r_butt, r_grip, r_waist, r_top, segments=10):
    """
    A tool handle with a hand in mind.

    A cone reads as a stick. What makes a haft look like a haft is the swell:
    a flare at the butt so it cannot slip out of a grip, a fuller section where
    the hand sits, a waist above it, and a shoulder just under the head. Four
    radius changes over half a metre, and the outline stops being a taper.
    """
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (r_butt * 0.80, 0.0),
        (r_butt, length * 0.020),
        (r_butt * 0.86, length * 0.055),
        (r_grip, length * 0.150),
        (r_grip * 0.97, length * 0.300),
        (r_waist, length * 0.620),
        (r_waist * 1.02, length * 0.800),
        (r_top * 1.14, length * 0.930),
        (r_top, length * 0.985),
        (r_top * 0.72, length),
        (0.0, length),
    ], segments=segments)
    return emit(bm, name, "base", bevel_width=0.004)


def make_haft_short():
    o = haft("haft_short", 0.52, 0.038, 0.036, 0.030, 0.033)
    socket(o, "socket_tip", (0, 0, 0.52))
    socket(o, "socket_mid", (0, 0, 0.26))


def make_haft_long():
    o = haft("haft_long", 0.92, 0.038, 0.037, 0.029, 0.032)
    socket(o, "socket_tip", (0, 0, 0.92))
    socket(o, "socket_mid", (0, 0, 0.46))


def make_blade_axe():
    """
    A felling axe head: poll, eye, cheek, beard, and a bit that curves.

    Built as a run of cross sections from the poll forward. The eye stations are
    full and fat, the cheeks thin out, and the last two bow forward so the
    cutting edge is a convex arc with a toe and a heel rather than a straight
    chisel. The beard is the bottom edge dropping away and back under the eye,
    which is the single detail that stops an axe silhouette reading as a
    hatchet-shaped rectangle.

    The eye sits at x = -0.078 rather than at the origin because that is where
    the recipe in `items/catalog.ts` puts the haft. Move this and the axe head
    slides off its handle.
    """
    bm = bmesh.new()
    #        x,      z0,     z1,   half_t, full, bow
    stations = [
        (-0.182, -0.054, 0.054, 0.027, 0.82, 0.0),   # poll butt
        (-0.162, -0.076, 0.078, 0.040, 0.88, 0.0),   # poll face
        (-0.118, -0.088, 0.092, 0.047, 0.90, 0.0),   # eye, back lug
        (-0.038, -0.090, 0.094, 0.047, 0.90, 0.0),   # eye, front lug
        (-0.004, -0.096, 0.084, 0.030, 0.74, 0.0),   # neck, waisted hard
        (0.052, -0.140, 0.082, 0.022, 0.70, 0.0),    # the beard falls away
        (0.126, -0.196, 0.100, 0.016, 0.66, 0.008),  # cheek
        (0.198, -0.228, 0.118, 0.011, 0.62, 0.026),  # shoulder of the bit
        (0.236, -0.220, 0.115, 0.0045, 0.70, 0.044),  # bevel behind the edge
        (0.250, -0.204, 0.108, 0.0016, 1.00, 0.050),  # the edge itself
    ]
    bm_loft(bm, [blade_section(*s) for s in stations])
    o = emit(bm, "blade_axe", "none", bevel_width=0.004)
    socket(o, "socket_mid", (-0.078, 0, 0))


def make_blade_knife():
    """
    Tang, bolster, then a plate with a full spine and a bellied edge sweeping up
    to the point.

    The whole blade runs at a high `fullness` and a low `fullness_lo`, which is
    a flat sided plate that thins only along its bottom. That is a knife. The
    bolster is one fat station and it is what makes this read as a handle joined
    to a blade rather than as a single wedge.
    """
    bm = bmesh.new()
    #        x,      z0,     z1,   half_t, full, bow,  full_lo
    stations = [
        (-0.262, -0.024, 0.024, 0.011, 0.85, 0.0, 0.85),   # tang butt
        (-0.150, -0.028, 0.028, 0.013, 0.85, 0.0, 0.85),   # tang
        (-0.112, -0.032, 0.032, 0.014, 0.88, 0.0, 0.88),   # tang shoulder
        (-0.098, -0.050, 0.050, 0.025, 0.90, 0.0, 0.90),   # bolster
        (-0.080, -0.048, 0.048, 0.015, 0.82, 0.0, 0.34),   # ricasso
        (-0.030, -0.052, 0.048, 0.013, 0.86, 0.0, 0.10),
        (0.070, -0.056, 0.046, 0.012, 0.86, 0.0, 0.08),    # belly at its deepest
        (0.160, -0.048, 0.042, 0.010, 0.86, 0.003, 0.07),
        (0.226, -0.026, 0.034, 0.006, 0.80, 0.007, 0.10),  # edge sweeps up
        (0.258, 0.004, 0.021, 0.0016, 1.00, 0.009, 1.00),  # point
    ]
    bm_loft(bm, [blade_section(*s) for s in stations])
    o = emit(bm, "blade_knife", "none", bevel_width=0.003)
    socket(o, "socket_mid", (-0.10, 0, 0))


def make_head_hammer():
    """
    A blacksmith's hammer head: swollen eye in the middle, a face that is
    slightly domed and chamfered on one end, a tapered cross peen on the other.

    Straight box sections would give a brick. The eye station being taller and
    wider than its neighbours is what puts a waist either side of it, and the
    waist is the whole silhouette.
    """
    bm = bmesh.new()
    stations = [
        (-0.112, 0.014, -0.040, 0.040, 0.20),   # cross peen, a blunt wedge
        (-0.098, 0.024, -0.040, 0.040, 0.18),
        (-0.062, 0.036, -0.042, 0.042, 0.20),   # peen root
        (-0.030, 0.052, -0.054, 0.054, 0.22),   # eye, front lug
        (0.016, 0.054, -0.056, 0.056, 0.22),    # eye, back lug
        (0.032, 0.041, -0.043, 0.043, 0.24),    # waist, cut in hard
        (0.078, 0.046, -0.048, 0.048, 0.22),    # face flares back out
        (0.100, 0.045, -0.047, 0.047, 0.50),    # chamfer round the face
        (0.108, 0.039, -0.041, 0.041, 0.80),    # struck face
    ]
    bm_loft(bm, [box_section(*s) for s in stations])
    o = emit(bm, "head_hammer", "none", bevel_width=0.004)
    socket(o, "socket_mid", (-0.008, 0, 0))


def make_bucket():
    """
    A cooper's pail: staved body, two iron hoops, a rolled rim and a floor.

    The old one was a cone with its top faces deleted, which showed its own
    backfaces from a low camera and read as a paper cup. This is a single
    continuous lathe profile that goes up the outside, over the rim and back
    down the inside to a floor, so it is a real vessel with wall thickness. The
    hoops are two radius steps in that profile; the staves are the alternating
    offset on the body points. Both exist to break the taper into bands, since
    an unbroken taper is exactly what read as a cone.
    """
    bm = bmesh.new()
    st = 0.0045                      # stave offset, alternating segments
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.104, 0.0),                # outer floor
        (0.112, 0.014),
        (0.121, 0.052, st),
        (0.133, 0.070),              # lower hoop, proud of the staves
        (0.133, 0.092),
        (0.126, 0.104, st),
        (0.138, 0.170, st),
        (0.152, 0.188),              # upper hoop
        (0.152, 0.210),
        (0.145, 0.222, st),
        (0.153, 0.256, st),
        (0.166, 0.268),              # rim rolls out
        (0.168, 0.280),
        (0.157, 0.288),              # over the top
        (0.143, 0.279),
        (0.138, 0.256),              # and back down the inside
        (0.122, 0.100),
        (0.104, 0.044),
        (0.092, 0.034),
        (0.0, 0.032),                # inner floor
    ], segments=14)

    # Ears for the bail. Two small lugs at the rim, on the axis the recipe
    # swings the handle around.
    for sx in (-1.0, 1.0):
        bm_box(bm, (sx * 0.142, -0.020, 0.226), (sx * 0.176, 0.020, 0.268))

    o = emit(bm, "bucket_body", "base", bevel_width=0.005)
    socket(o, "socket_tip", (0, 0, 0.288))
    socket(o, "socket_mid", (0, 0, 0.14))


def make_flask():
    """A bellied flask with a real shoulder, a neck the stopper can seat in, and
    a footed base so it stands. The old sphere-with-a-pinch read as a bauble
    because there was no straight run anywhere on it for the light to sit."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.070, 0.0),                # foot
        (0.078, 0.012),
        (0.068, 0.030),              # undercut above the foot
        (0.104, 0.070),
        (0.124, 0.128),              # widest point, low, so it looks heavy
        (0.121, 0.170),
        (0.098, 0.216),              # shoulder
        (0.062, 0.250),
        (0.043, 0.266),              # neck root
        (0.041, 0.300),
        (0.048, 0.312),              # lip
        (0.046, 0.322),
        (0.034, 0.324),
        (0.0, 0.318),
    ], segments=16)
    o = emit(bm, "flask_body", "base", smooth=True, bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.30))
    socket(o, "socket_mid", (0, 0, 0.13))


def make_jar():
    """Fired clay: a wide belly, a pinched neck, and a lip thick enough to see
    from across the room."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.088, 0.0),
        (0.096, 0.010),
        (0.120, 0.048),
        (0.132, 0.096),              # belly
        (0.124, 0.146),
        (0.100, 0.178),              # shoulder
        (0.086, 0.194),
        (0.100, 0.206),              # lip flares back out
        (0.098, 0.220),
        (0.082, 0.216),
        (0.076, 0.190),              # inside of the neck
        (0.090, 0.120),
        (0.070, 0.030),
        (0.0, 0.028),
    ], segments=14)
    o = emit(bm, "jar_body", "base", bevel_width=0.005)
    socket(o, "socket_tip", (0, 0, 0.22))
    socket(o, "socket_mid", (0, 0, 0.10))


def make_plank():
    """Sawn board. Chamfered along its length, slightly narrower at one end, and
    the ends left rough so it does not read as extruded plastic."""
    bm = bmesh.new()
    stations = [
        (-0.310, 0.058, -0.018, 0.016, 0.30),
        (-0.288, 0.064, -0.017, 0.017, 0.22),
        (-0.120, 0.065, -0.016, 0.016, 0.22),
        (0.110, 0.064, -0.016, 0.017, 0.22),
        (0.284, 0.062, -0.015, 0.018, 0.22),
        (0.310, 0.056, -0.013, 0.017, 0.34),
    ]
    bm_loft(bm, [box_section(*s) for s in stations])
    o = emit(bm, "plank_board", "none", bevel_width=0.004)
    socket(o, "socket_tip", (0.31, 0, 0))
    socket(o, "socket_mid", (0, 0, 0))


def make_crate():
    """
    A framed crate: thin panels set back behind corner posts and rails.

    A bevelled cube is a bevelled cube whatever you texture it with. Insetting
    the panel by twelve millimetres and running posts and rails proud of it
    gives twelve extra silhouette breaks and a shadow line all the way round,
    which is the entire difference between "crate" and "box".
    """
    bm = bmesh.new()
    h = 0.11        # half extent
    p = 0.028       # post section
    r = 0.030       # rail height

    bm_box(bm, (-h + 0.014, -h + 0.014, 0.012), (h - 0.014, h - 0.014, 0.208))

    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            bm_box(bm, (min(sx * h, sx * (h - p)), min(sy * h, sy * (h - p)), 0.0),
                   (max(sx * h, sx * (h - p)), max(sy * h, sy * (h - p)), 0.220))

    for z0 in (0.010, 0.180):
        for sy in (-1.0, 1.0):
            bm_box(bm, (-h, min(sy * h, sy * (h - 0.018)), z0),
                   (h, max(sy * h, sy * (h - 0.018)), z0 + r))
        for sx in (-1.0, 1.0):
            bm_box(bm, (min(sx * h, sx * (h - 0.018)), -h, z0),
                   (max(sx * h, sx * (h - 0.018)), h, z0 + r))

    o = emit(bm, "crate_box", "base", bevel_width=0.004, bevel_segments=1)
    socket(o, "socket_tip", (0, 0, 0.22))
    socket(o, "socket_mid", (0, 0, 0.11))


def make_ring():
    """Forged hoop, D section: flat on the inside where it would bear, rounded
    outside. Doubles as the bucket's bail and as twine round a bale, so it stays
    plain."""
    bm = bmesh.new()
    sec = [(0.026, 0.0), (0.020, 0.019), (-0.012, 0.024),
           (-0.021, 0.0), (-0.012, -0.024), (0.020, -0.019)]
    bm_sweep(bm, arc_frames(0.140, 0.0, 2.0 * math.pi, 16, closed=True),
             lambda i, t: sec, closed=True)
    emit(bm, "ring_band", "none", bevel_width=0.003, bevel_segments=1)


def make_horseshoe():
    """
    Shoe stock bent round a last: rectangular section, wide and thick at the
    toe, drawn down toward the heels, with a fuller groove on the upper face.

    The groove matters more than it sounds. A flat ring of metal viewed from
    above is a flat ring of metal; a groove running round it splits the top face
    into two bands and gives the cel shader something to do.

    The first pass bolted square calkins onto the heels and it was a mistake:
    at the size this renders they merged with the branches into a hook, and the
    whole thing read as a letter G. Taper alone carries the shape.
    """
    bm = bmesh.new()

    def sec(i, t):
        # t runs heel to toe to heel. Widest and thickest at the toe.
        k = 1.0 - abs(2.0 * t - 1.0)                  # 0 at the heels, 1 at toe
        w = 0.026 + 0.017 * k                         # radial half width
        hh = 0.014 + 0.006 * k                        # half thickness
        g = 0.010 + 0.005 * k                         # fuller half width
        c = 0.008
        return [
            (-w, -hh + c), (-w + c, -hh), (w - c, -hh), (w, -hh + c),
            (w, hh - c), (w - c * 0.8, hh),
            (g, hh), (0.0, hh - 0.008), (-g, hh),     # the fuller
            (-w + c * 0.8, hh), (-w, hh - c),
        ]

    frames = arc_frames(0.130, math.radians(-152.0), math.radians(152.0), 18)
    bm_sweep(bm, frames, sec)
    emit(bm, "horseshoe", "none", bevel_width=0.003)


def make_rope_coil():
    """
    A coil with a lay to it.

    A smooth torus is a doughnut. Rotating a lobed section as it travels round
    the loop gives the diagonal ridging that says rope at any size, and it costs
    the same triangles. Nine twists per turn closes exactly, so there is no seam
    where the sweep meets itself.
    """
    bm = bmesh.new()
    lobes, twists, sides = 3, 9, 7

    def sec(i, t):
        pts = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            rr = 0.037 * (1.0 + 0.34 * math.cos(lobes * a + twists * 2.0 * math.pi * t))
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        return pts

    bm_sweep(bm, arc_frames(0.148, 0.0, 2.0 * math.pi, 24, closed=True), sec, closed=True)
    emit(bm, "rope_coil", "none", bevel_width=0.0015, bevel_segments=1)


def make_stone_shard():
    """
    A struck flake, not a lumpy ball.

    Built as the convex hull of a deterministic point cloud squeezed into a
    wedge. A hull gives genuinely flat facets meeting at hard edges, which is
    what flint does and what a jittered sphere cannot fake: the sphere keeps its
    round silhouette no matter how much noise is added to it.
    """
    bm = bmesh.new()
    rng = _Lcg(11)
    for _ in range(18):
        u = rng.next() * 2.0 - 1.0
        v = rng.next() * 2.0 - 1.0
        w = rng.next() * 2.0 - 1.0
        # Squeeze toward +x so one end is a keen edge and the other a heavy
        # butt. The first pass tapered to 0.36 and the result was a flat sliver
        # that vanished on the ground; a flake needs bulk to throw a shadow.
        taper = 0.62 + 0.38 * (0.5 - 0.5 * u)
        bm.verts.new((u * 0.118, v * 0.100 * taper, w * 0.098 * taper))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    emit(bm, "stone_shard", "base", bevel_width=0.003)


def make_apple():
    """
    Apple: wider than it is tall, five soft lobes, a deep crown well and a calyx
    pucker underneath.

    The lobes are the fix for reading as an orange. A sphere is a sphere from
    every angle and no shading trick rescues it; five shallow ridges give the
    silhouette a wobble and put five light bands down the side. The crown well
    is deep because the recipe plants a stem in it, and a stem sitting on a
    smooth dome looks stuck on.
    """
    bm = bmesh.new()
    lobe = 0.0075
    bm_lathe(bm, [
        (0.0, 0.010),
        (0.030, 0.0),                # calyx, puckered in
        (0.070, 0.012, lobe),
        (0.108, 0.044, lobe),
        (0.126, 0.090, lobe),        # widest, below centre
        (0.122, 0.128, lobe),
        (0.100, 0.166, lobe),
        (0.062, 0.192),
        (0.030, 0.198),              # rim of the crown well
        (0.020, 0.172),              # and down into it
        (0.0, 0.168),
    ], segments=15, lobes=5)
    o = emit(bm, "apple_body", "base", smooth=True, bevel_width=0.002)
    socket(o, "socket_tip", (0, 0, 0.19))


def make_straw_bale():
    """
    A bound bale: long and low, bulged between the cords, cut square at the ends,
    with two twine bands biting deep into it.

    The cords are modelled in rather than left to the recipe, and they are cut
    deep on purpose. On the ground a bale is a tan rectangle about thirty pixels
    across, and a rectangle of one flat colour is unreadable whatever it is made
    of. The first attempt used shallow eighteen millimetre grooves and they
    vanished at that size, which is the whole lesson: detail that survives is
    detail cut deep enough to throw its own shadow. These are thirty two, and
    the bale reads from across the map.
    """
    bm = bmesh.new()

    def st(x, sy, sz, ch=0.30):
        return box_section(x, sy, -sz, sz, ch)

    stations = [
        st(-0.222, 0.124, 0.122, 0.55),
        st(-0.210, 0.148, 0.146, 0.34),
        st(-0.160, 0.152, 0.150),
        st(-0.130, 0.124, 0.122, 0.50),   # groove, cut deep
        st(-0.118, 0.140, 0.138, 0.40),   # twine cord
        st(-0.100, 0.140, 0.138, 0.40),
        st(-0.088, 0.124, 0.122, 0.50),   # groove
        st(-0.056, 0.154, 0.152),
        st(0.000, 0.160, 0.156),          # bulge
        st(0.056, 0.154, 0.152),
        st(0.088, 0.124, 0.122, 0.50),    # groove
        st(0.100, 0.140, 0.138, 0.40),    # twine cord
        st(0.118, 0.140, 0.138, 0.40),
        st(0.130, 0.124, 0.122, 0.50),    # groove
        st(0.160, 0.152, 0.150),
        st(0.210, 0.148, 0.146, 0.34),
        st(0.222, 0.124, 0.122, 0.55),
    ]
    bm_loft(bm, stations)
    o = emit(bm, "straw_bale", "base", bevel_width=0.005, bevel_segments=1)
    jitter(o, 0.012, 23)
    socket(o, "socket_tip", (0, 0, 0.31))


def make_rag_wrap():
    """A bundled cloth. Lobed rather than round, because a smooth squashed
    sphere is a pebble; the lobes are folds and they are what makes it soft."""
    bm = bmesh.new()
    f = 0.010
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.052, -0.004),
        (0.088, 0.010, f),
        (0.104, 0.038, f),
        (0.096, 0.066, f),
        (0.064, 0.086, f),
        (0.030, 0.094),
        (0.026, 0.108),              # a small knot on top
        (0.014, 0.114),
        (0.0, 0.110),
    ], segments=12)
    o = emit(bm, "rag_wrap", "none", smooth=False, bevel_width=0.004)
    jitter(o, 0.018, 31)


def make_torch_head():
    """
    Pitch soaked rag bound to the shaft: narrow where it grips, flaring out and
    up, torn off at the top, with two cords biting into it near the base.

    The old head was a cylinder the same width as the haft, which is why the
    torch read as a lollipop. Flaring to nearly three times the haft radius is
    what makes the silhouette read at icon size.
    """
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, -0.008),
        (0.030, -0.010),
        (0.033, 0.006),
        (0.030, 0.016),              # cord groove
        (0.040, 0.026),
        (0.036, 0.038),              # cord groove
        (0.056, 0.054),
        (0.074, 0.086),
        (0.081, 0.118),              # widest, high up, so it looks top heavy
        (0.072, 0.146),
        (0.048, 0.162),
        (0.022, 0.166),
        (0.0, 0.158),                # dished, as if burnt down
    ], segments=10)

    for z, rad in ((0.017, 0.036), (0.039, 0.042)):
        bm_sweep(bm, arc_frames(rad, 0.0, 2.0 * math.pi, 10, z=z, closed=True),
                 lambda i, t: [(0.006, 0.0), (0.0, 0.008), (-0.006, 0.0), (0.0, -0.008)],
                 closed=True)

    o = emit(bm, "torch_head", "base", bevel_width=0.004, bevel_segments=1)
    jitter(o, 0.009, 41)
    socket(o, "socket_tip", (0, 0, 0.17))


def make_leaf_cluster():
    """
    Actual leaves in a rosette, rather than a noisy ball.

    Seven pointed blades, each a thin lofted section with a raised midrib,
    splayed out at uneven angles and drooping at the tips. This is the one part
    where the silhouette has to be spiky or it reads as a stone, and no amount
    of noise on a sphere gets there.

    Uneven is the whole job. Evenly spaced blades all pitched the same way make
    a lotus, which is what the first pass produced. The yaw scatter and the
    per-blade droop are what turn a flower back into foliage.
    """
    bm = bmesh.new()
    rng = _Lcg(53)
    blades = 7
    for k in range(blades):
        yaw = 2.0 * math.pi * k / blades + 0.62 * (rng.next() - 0.5)
        pitch = 0.10 + 0.62 * rng.next()
        length = 0.100 + 0.070 * rng.next()
        droop = 0.30 + 0.55 * rng.next()
        ca, sa = math.cos(yaw), math.sin(yaw)
        cp, sp = math.cos(pitch), math.sin(pitch)

        # Blade outline as (along, across, rib height) at several stations.
        outline = [
            (0.00, 0.005, 0.004),
            (0.18, 0.026, 0.009),
            (0.42, 0.044, 0.010),
            (0.66, 0.038, 0.008),
            (0.86, 0.022, 0.005),
            (1.00, 0.003, 0.002),
        ]
        secs = []
        for (u, half, rib) in outline:
            d = u * length
            # A leaf falls away along its length rather than lying flat.
            fall = -droop * length * u * u
            pts = []
            for (across, up) in ((0.0, rib), (half, 0.0), (0.0, -rib * 0.5), (-half, 0.0)):
                x = d * cp - up * sp
                z = d * sp + up * cp + fall
                pts.append((x * ca - across * sa, x * sa + across * ca, z + 0.086))
            secs.append(pts)
        bm_loft(bm, secs)

    emit(bm, "leaf_cluster", "base", bevel_width=0.002, bevel_segments=1)


def make_stopper():
    """Cork: a long tapered plug with a narrow collar and a small domed top. The
    first pass gave it a wide flange and it read as a mushroom."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.024, 0.0),
        (0.028, 0.010),
        (0.033, 0.038),              # taper up to the collar
        (0.038, 0.050),
        (0.037, 0.060),              # collar
        (0.032, 0.066),
        (0.022, 0.071),
        (0.0, 0.069),
    ], segments=12)
    emit(bm, "stopper", "base", bevel_width=0.003)


def make_nail_spike():
    """Forged nail: flat struck head, a shank that tapers all the way, and a
    point. Also serves as an apple stem, where the head ends up buried."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.024, 0.0),
        (0.025, 0.008),
        (0.018, 0.015),              # under the head
        (0.016, 0.045),
        (0.013, 0.095),
        (0.008, 0.140),
        (0.003, 0.165),
        (0.0, 0.172),
    ], segments=8)
    emit(bm, "nail_spike", "base", bevel_width=0.0015)


def make_disc():
    """A shallow dish. Used as the water surface in a pail, so it is domed
    slightly and has a lip, which reads as a meniscus rather than as a lid."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, -0.010),
        (0.096, -0.011),
        (0.110, -0.004),
        (0.110, 0.004),
        (0.100, 0.010),
        (0.062, 0.013),
        (0.0, 0.014),
    ], segments=14)
    emit(bm, "disc_flat", "none", bevel_width=0.003)


def make_bar():
    """Forged bar stock: chamfered along its length, drawn down at both ends
    where a hammer would have left it, and slightly fuller in the middle."""
    bm = bmesh.new()
    stations = [
        (-0.150, 0.014, -0.014, 0.014, 0.60),
        (-0.136, 0.021, -0.021, 0.021, 0.34),
        (-0.060, 0.023, -0.023, 0.023, 0.30),
        (0.060, 0.023, -0.023, 0.023, 0.30),
        (0.136, 0.021, -0.021, 0.021, 0.34),
        (0.150, 0.014, -0.014, 0.014, 0.60),
    ]
    bm_loft(bm, [box_section(*s) for s in stations])
    o = emit(bm, "bar_stock", "none", bevel_width=0.004)
    socket(o, "socket_tip", (0.15, 0, 0))


BUILDERS = [
    make_haft_short, make_haft_long,
    make_blade_axe, make_blade_knife, make_head_hammer,
    make_bucket, make_flask, make_jar,
    make_plank, make_crate,
    make_ring, make_horseshoe, make_rope_coil,
    make_stone_shard, make_apple, make_straw_bale, make_rag_wrap,
    make_torch_head, make_leaf_cluster, make_stopper, make_nail_spike,
    make_disc, make_bar,
]


def main():
    reset_scene()

    for build in BUILDERS:
        build()

    os.makedirs(OUT_DIR, exist_ok=True)

    meshes = sorted((o.name, len(o.data.loop_triangles) or sum(
        max(len(p.vertices) - 2, 0) for p in o.data.polygons))
        for o in bpy.data.objects if o.type == "MESH")
    total = sum(t for _, t in meshes)
    print(f"[parts] built {len(meshes)} parts, {total} tris")
    for name, tris in meshes:
        print(f"[parts]   {name:<14} {tris:>5}")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT_FILE,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_materials="NONE",
        export_normals=True,
        export_yup=True,
    )
    size = os.path.getsize(OUT_FILE)
    print(f"[parts] wrote {OUT_FILE} ({size/1024:.1f} kB)")


if __name__ == "__main__":
    main()
