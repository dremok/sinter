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


# ------------------------------------------------ how these are meant to fit
#
# Recipes live in `src/items/catalog.ts` and this file cannot touch them, so the
# intended assemblies are recorded here instead. Every one below was rendered
# through `render/kitbash.ts` and checked at play size before being written down.
#
# This exists because the parts and the recipes are owned by different people
# and drifted apart: the library gained a real sword blade, a real key and real
# spectacles while the catalog was still composing those items out of a knife
# blade, a hoop and a bar. An item made of the wrong parts reads as a different
# object, and in a pack list where the player picks merge inputs and the merge
# is irreversible, two items that share a silhouette is a correctness bug rather
# than an art one. If a recipe below disagrees with the catalog, the catalog is
# out of date.
#
#   sword    pommel_round     [0, -0.40, 0]                        steel
#            grip_wrapped     [0, -0.40, 0]                        cloth
#            guard_cross      [0, -0.14, 0]                        steel
#            blade_sword      [0, -0.14, 0]                        steel
#
#   knife    grip_wrapped     [0, -0.30, 0]  scale 0.62            wood
#            blade_knife      [0,  0.10, 0]  rot [0, 0, 1.57]      steel
#
#   key      key_body         [0, -0.22, 0]                        gold
#
#   glasses  spectacles_frame [0, 0, 0]                            steel
#            lens_round       [-0.115, 0, 0]                       glass
#            lens_round       [ 0.115, 0, 0]                       glass
#
#   chili    chili_pod        [0,  0.14, 0]                        ember
#            stem_calyx       [0,  0.12, 0]                        leaf
#
#   rock     stone_lump       [0, -0.13, 0]  scale [1.25,1.1,1.2]  stone
#            stone_lump       [0.14, -0.02, -0.09] scale [.55,.5,.58]
#                                            rot [0.5, 1.0, 0.3]   stone
#
#   poison   phial_ribbed     [0, -0.15, 0]                        glass
#            stopper          [0,  0.11, 0]  scale [1, 0.9, 1]     wood
#
# Two anchors below are not base anchored and will sit wrong if placed like the
# rest: `pommel_round` and `chili_pod` are anchored at their TOP, because that
# is where each attaches, and both therefore hang downward from their offset.


# --------------------------------------------------------------------- helpers

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def active(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)


def bevel(obj, width=0.008, segments=1, angle=48):
    """
    A single chamfer segment by default, not two.

    Two segments rounds an edge; one puts a single flat facet on it. Under a cel
    ramp those are almost indistinguishable, because the ramp quantises the
    falloff either way and the difference lands inside one band. But two
    segments costs about twice the triangles, and the bevel is already 39
    percent of this file. One is the right default; the shape is what should be
    paid for.

    A width of zero skips it. That is for parts whose faces are ALREADY the
    detail, like the convex hull rocks, where softening every edge costs three
    times the part's own geometry and makes it less crisp rather than more.
    """
    if width <= 0.0:
        return
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


COST = {}


def finish(obj, name, anchor_mode="base", smooth=False, bevel_width=0.008, bevel_segments=1):
    obj.name = name
    obj.data.name = name
    anchor(obj, anchor_mode)
    # Recorded before and after, because the bevel roughly doubles a part and
    # that is the first number to look at when the file is over budget. The
    # split says whether the cost is the shape or the trim on it.
    before = tri_count(obj)
    bevel(obj, width=bevel_width, segments=bevel_segments)
    COST[name] = (before, tri_count(obj), bevel_segments)
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


def arc_frames_xz(radius, a0, a1, steps, centre=(0.0, 0.0, 0.0), closed=False):
    """Frames around a circular arc standing in the XZ plane, so a hoop faces
    along Y. Spectacle rims and a key's bow are both rings seen face on, and
    face on for those means facing the way the item is looked at."""
    out = []
    span = steps if closed else max(steps - 1, 1)
    cx, cy, cz = centre
    for i in range(steps):
        t = i / span
        a = a0 + (a1 - a0) * t
        c, s = math.cos(a), math.sin(a)
        out.append((Vector((cx + radius * c, cy, cz + radius * s)),
                    Vector((c, 0.0, s)), Vector((0.0, 1.0, 0.0)), t))
    return out


def bm_rot_x_up(bm):
    """Stand an X-aligned build upright: +X becomes +Z. A proper rotation about
    Y rather than an axis swap, so winding survives."""
    for v in bm.verts:
        v.co = Vector((-v.co.z, v.co.y, v.co.x))


def bm_rot_z_forward(bm):
    """Lay a Z-aligned build on its face: +Z becomes +Y."""
    for v in bm.verts:
        v.co = Vector((v.co.x, v.co.z, -v.co.y))


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


def emit(bm, name, anchor_mode="base", smooth=False, bevel_width=0.008, bevel_segments=1):
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


def sword_section(x, z0, z1, half_t, fuller=0.0, floor=0.0011):
    """
    Sixteen point section for a DOUBLE edged blade, in the YZ plane.

    `blade_section` will not do here. An axe has one edge at the far end and
    blunt rims top and bottom, so it wants a high fullness; a sword is sharp at
    z0 AND z1 and flat in between. So this comes to nothing at both ends, with
    the faces running parallel from a quarter of the way in, which is what a
    ground bevel actually looks like.

    `fuller` sinks a groove down the middle of each face. That groove is most of
    why a sword reads as a sword rather than as a very long knife: it splits
    each face into three bands under the cel ramp, and the bands run the whole
    length, so the eye gets a line to follow.
    """
    h = z1 - z0
    zm = 0.5 * (z0 + z1)
    fh = 0.21 * h
    t = max(half_t, floor)
    fd = max(t - fuller, floor * 0.6)
    e = floor
    return [
        (x, -e, z1),
        (x, -t * 0.5, z1 - h * 0.11),
        (x, -t, z1 - h * 0.26),
        (x, -fd, zm + fh),
        (x, -fd, zm - fh),
        (x, -t, z0 + h * 0.26),
        (x, -t * 0.5, z0 + h * 0.11),
        (x, -e, z0),
        (x, e, z0),
        (x, t * 0.5, z0 + h * 0.11),
        (x, t, z0 + h * 0.26),
        (x, fd, zm - fh),
        (x, fd, zm + fh),
        (x, t, z1 - h * 0.26),
        (x, t * 0.5, z1 - h * 0.11),
        (x, e, z1),
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

    The bit fans in BOTH directions out of a waisted neck. An earlier pass only
    dropped the beard and left the top nearly level, which gave the head a long
    unbroken upper curve and made it read as a boot. Waisting the neck top and
    bottom and then flaring the toe as hard as the heel is what makes the front
    of this a fan rather than a lump.

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
        (-0.004, -0.098, 0.080, 0.030, 0.74, 0.0),   # neck, waisted top and bottom
        (0.052, -0.142, 0.076, 0.022, 0.70, 0.0),    # the beard falls away
        (0.126, -0.198, 0.106, 0.016, 0.66, 0.008),  # cheek, and the toe starts up
        (0.198, -0.232, 0.150, 0.011, 0.62, 0.026),  # bit, fanned both ways
        (0.236, -0.224, 0.146, 0.0045, 0.70, 0.044),  # bevel behind the edge
        (0.250, -0.208, 0.138, 0.0016, 1.00, 0.050),  # the edge itself
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
    ], segments=12)

    # Ears for the bail. Two small lugs at the rim, on the axis the recipe
    # swings the handle around.
    for sx in (-1.0, 1.0):
        bm_box(bm, (sx * 0.142, -0.020, 0.226), (sx * 0.176, 0.020, 0.268))

    o = emit(bm, "bucket_body", "base", bevel_width=0.005)
    socket(o, "socket_tip", (0, 0, 0.288))
    socket(o, "socket_mid", (0, 0, 0.14))


def make_flask():
    """
    A flattened costrel: wide low belly, a hard shoulder, and a long narrow neck.

    Measured, not eyeballed. On the ground this is about 15 by 18 pixels, and at
    that size a bellied bottle with a short neck is a circle with a bump, which
    is the same glyph as an apple. Two changes fix it. The shoulder steps in
    sharply instead of curving, so the outline has a corner. And the neck runs
    long and thin, roughly a third of the total height at a quarter of the body
    width, which turns "blob" into "bulb on a stem" in about three pixels.

    The whole thing is then squashed across Y. A flask carried on a belt is
    flat, and the flattening also stops the silhouette being a circle from every
    direction the world happens to rotate it.
    """
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.066, 0.0),                # foot
        (0.076, 0.014),
        (0.066, 0.032),              # undercut above the foot
        (0.108, 0.070),
        (0.126, 0.118),              # widest point, low, so it looks heavy
        (0.122, 0.156),
        (0.106, 0.184),
        (0.070, 0.208),              # shoulder, stepped in hard
        (0.038, 0.228),
        (0.032, 0.248),              # neck root
        (0.031, 0.300),              # long thin neck
        (0.044, 0.312),              # lip
        (0.042, 0.324),
        (0.030, 0.326),
        (0.0, 0.318),
    ], segments=13)
    for v in bm.verts:
        v.co.y *= 0.66
    o = emit(bm, "flask_body", "base", smooth=True, bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.30))
    socket(o, "socket_mid", (0, 0, 0.12))


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
    ], segments=12)
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

    o = emit(bm, "crate_box", "base", bevel_width=0.004)
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
    emit(bm, "ring_band", "none", bevel_width=0.003)


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
    A FLAT SPIRAL with a long loose end, not a torus and not a tall helix.

    Two attempts got this wrong and both failures were instructive. A torus with
    a twisted lay on it was called a bread roll, correctly: one closed ring of
    even thickness has a single continuous outline, so at 25 pixels it fills in
    solid whatever the surface does. A tall stacked helix was worse, because
    `items/catalog.ts` places TWO of these overlapping, and two tall coils
    interleave into one lump with no gaps left anywhere.

    What survives is a flat spiral: the turns lie beside each other rather than
    on top, so the strand separations run across the face of the object where
    the camera can see them, and the middle stays open. The hole is 110mm across
    against a 60mm rope, which is wide enough that the second coil in the recipe
    cannot plug it.

    The long trailing end does the rest of the work. It is the one feature no
    other item in the catalog has, and unlike surface lay it is silhouette, so
    it is still there after the frame is downsampled.
    """
    bm = bmesh.new()
    lobes, sides = 3, 6

    def sec(i, t):
        pts = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            rr = 0.030 * (1.0 + 0.30 * math.cos(lobes * a + 11.0 * 2.0 * math.pi * t))
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        return pts

    turns = 2.15
    steps = 28
    coil = []
    for i in range(steps):
        t = i / (steps - 1)
        a = t * turns * 2.0 * math.pi
        r = 0.158 - 0.073 * t                 # winds inward, turns side by side
        c, s = math.cos(a), math.sin(a)
        coil.append((Vector((r * c, r * s, -0.014 + 0.030 * t)),
                     Vector((c, s, 0.0)), Vector((0.0, 0.0, 1.0)), t))
    bm_sweep(bm, coil, sec)

    # The loose end: leaves the outside of the coil and trails away.
    tail = []
    steps = 8
    for i in range(steps):
        t = i / (steps - 1)
        a = math.radians(-24.0) - t * math.radians(120.0)
        r = 0.158 + 0.150 * t * t
        c, s = math.cos(a), math.sin(a)
        tail.append((Vector((r * c, r * s, -0.014 - 0.016 * t)),
                     Vector((c, s, 0.0)), Vector((0.0, 0.0, 1.0)), t))

    def tail_sec(i, t):
        pts = []
        for k in range(sides):
            a = 2.0 * math.pi * k / sides
            rr = 0.029 * (1.0 - 0.46 * t) * (1.0 + 0.28 * math.cos(lobes * a + 5.0 * t))
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        return pts

    bm_sweep(bm, tail, tail_sec)
    emit(bm, "rope_coil", "none", bevel_width=0.0015)


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
    emit(bm, "stone_shard", "base", bevel_width=0.0)


def make_apple():
    """
    Apple: distinctly wider than it is tall, five lobes, a broad sunken crown
    and a calyx pucker underneath.

    The lobes are the fix for reading as an orange. A sphere is a sphere from
    every angle and no shading trick rescues it; five ridges give the silhouette
    a wobble and put five light bands down the side.

    The crown is wide rather than deep, and that is a play-size decision. This
    renders about 18 by 14 pixels. A narrow well two pixels across disappears
    entirely; a shallow dish a third of the fruit wide flattens the whole top of
    the outline, and a flat-topped shape with shoulders is not a circle. Depth
    buys nothing here, width buys everything.
    """
    bm = bmesh.new()
    lobe = 0.011
    bm_lathe(bm, [
        (0.0, 0.012),
        (0.032, 0.0),                # calyx, puckered in
        (0.074, 0.012, lobe),
        (0.112, 0.042, lobe),
        (0.132, 0.086, lobe),        # widest, below centre
        (0.128, 0.122, lobe),
        (0.108, 0.156, lobe),
        (0.078, 0.178, lobe),
        (0.058, 0.184),              # rim of the crown, wide and low
        (0.040, 0.170),
        (0.022, 0.164),              # and down into the dish
        (0.0, 0.162),
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
    o = emit(bm, "straw_bale", "base", bevel_width=0.005)
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
    Pitch soaked rag bound to the shaft: narrow where it grips, flaring out hard
    and up, torn off at the top, with two cords biting into it near the base.

    Sized by measurement rather than by eye. At play distance a whole torch is
    about 34 pixels tall, and the haft inside it is 3 of those across. A head
    that flares to 8 pixels reads as a pin; the shaft and the head are the same
    object. This flares to about 14, more than four times the haft radius, which
    is the point at which "stick" and "bundle tied to a stick" become different
    silhouettes. Three lobes and a torn top stop the bundle being a ball.
    """
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, -0.010),
        (0.028, -0.012),
        (0.032, 0.006),
        (0.028, 0.018),              # cord groove
        (0.043, 0.032),
        (0.037, 0.046),              # cord groove
        (0.072, 0.072, 0.008),
        (0.106, 0.110, 0.013),
        (0.128, 0.152, 0.016),
        (0.135, 0.188, 0.016),       # widest, high up, so it looks top heavy
        (0.121, 0.218, 0.014),
        (0.086, 0.240, 0.010),
        (0.044, 0.252),
        (0.0, 0.244),                # dished, as if burnt down
    ], segments=12, lobes=3)

    # The cords used to be two swept rings here. They were 160 triangles for
    # something under a pixel wide, and the lathe profile above already dips
    # twice at the same heights, so the grooves read without them.

    # Torn rag ends, splaying up and out of the crown.
    #
    # Widening the head was not enough on its own: a wide smooth dome on a stick
    # is still a lollipop, which is what the art director called it, and being
    # bigger only made it a bigger lollipop. The problem was never size, it was
    # that the outline had no corners. Four irregular tips break the top of the
    # silhouette into something spiky, and spiky is a shape nothing else in the
    # catalog has.
    # Five, at uneven lengths, leaning out rather than up. Four evenly spaced
    # tips pointing skyward gave the head two symmetric horns in profile and it
    # read as an animal's face. Torn cloth is not symmetric and does not stand
    # up straight: what works is a scatter where one flap is twice the length of
    # its neighbour and most of the reach is sideways.
    #
    # They start at radius 0.118, ON the shoulder, not at 0.070. At 0.070 they
    # were inside a head that is 0.135 wide there, so four fifths of each flap
    # was buried in the bundle and only the tips broke the outline. A protrusion
    # has to begin at the surface it protrudes from.
    rng = _Lcg(67)
    for k in range(5):
        yaw = 2.0 * math.pi * k / 5 + 0.85 * (rng.next() - 0.5)
        length = 0.045 + 0.070 * rng.next() ** 2
        rise = 0.020 + 0.055 * rng.next()
        z0 = 0.168 + 0.040 * rng.next()
        ca, sa = math.cos(yaw), math.sin(yaw)
        secs = []
        for (u, half) in ((0.0, 0.032), (0.45, 0.023), (0.80, 0.012), (1.0, 0.003)):
            d = 0.118 + length * u
            z = z0 + rise * u - 0.030 * u * u
            secs.append([(d * ca - half * sa * 0.5, d * sa + half * ca * 0.5, z + half * 0.8),
                         (d * ca + half * sa, d * sa - half * ca, z),
                         (d * ca + half * sa * 0.5, d * sa - half * ca * 0.5, z - half * 0.8),
                         (d * ca - half * sa, d * sa + half * ca, z)])
        bm_loft(bm, secs)

    o = emit(bm, "torch_head", "base", bevel_width=0.004)
    jitter(o, 0.010, 41)
    socket(o, "socket_tip", (0, 0, 0.26))


def make_leaf_cluster():
    """
    Actual leaves in a rosette, rather than a noisy ball.

    Seven pointed blades, each a thin lofted section with a raised midrib,
    splayed out at uneven angles and drooping at the tips. This is the one part
    where the silhouette has to be spiky or it reads as a stone, and no amount
    of noise on a sphere gets there.

    Uneven is the whole job. Evenly spaced blades all pitched the same way make
    a lotus, which is what the first pass produced. The second overcorrected,
    splayed everything nearly flat and made a pressed maple leaf. What works is
    blades that stand up at scattered angles with only the tips falling away:
    the cluster keeps height in its silhouette and still reads soft.
    """
    bm = bmesh.new()
    rng = _Lcg(53)
    blades = 6
    for k in range(blades):
        yaw = 2.0 * math.pi * k / blades + 0.55 * (rng.next() - 0.5)
        pitch = 0.42 + 0.62 * rng.next()
        length = 0.100 + 0.070 * rng.next()
        droop = 0.16 + 0.30 * rng.next()
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
                pts.append((x * ca - across * sa, x * sa + across * ca, z + 0.014))
            secs.append(pts)
        bm_loft(bm, secs)

    # Anchored where the stems meet, not on the lowest leaf tip. Base anchoring
    # would push the whole cluster up by however far the outermost tip happened
    # to fall, which floats it clear of whatever it is growing out of. The
    # attachment point for a tuft is its root, and the convention says the
    # origin goes at the attachment point.
    emit(bm, "leaf_cluster", "none", bevel_width=0.002)


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


# ------------------------------------------------------------------ the hilt
#
# Everything from here down was authored for items the catalog was building out
# of whatever came closest: a sword made from a knife and a coin, spectacles
# made from two barrel hoops, a key made from a bar and a nail. The parts above
# are generic and get reused across bands; these are specific, because the
# things they are for are specific and were reading as the wrong object.
#
# The sword is authored along Z rather than X, unlike `blade_axe` and
# `blade_knife`. Those hang off a haft that crosses them, so their length is a
# reach outward; a sword IS its own vertical, and a hilt stacks along it. The
# loft is still built along X, because `sword_section` and the section machinery
# work in the YZ plane, and then stood upright by `bm_rot_x_up`.


def make_blade_sword():
    """
    A double edged blade with a fuller, a distal taper, and a point.

    Origin at the shoulder, where the blade leaves the guard, with the blade
    running up +Z. That is the attachment point, so a hilt assembles by stacking
    downward from zero and nothing needs a fudge offset.

    The distal taper matters as much as the profile taper. The blade narrows in
    width, but it also thins from 25mm to 6mm in thickness, and the two together
    are why the point looks like it was ground rather than snapped off.

    Width is 130mm at the shoulder, against `blade_knife` at 106. That gap is
    deliberate and it is the reason it exists: the inventory camera fits every
    item to its own tile, so a sword and a knife arrive at the same height on
    screen no matter that one is a third longer in metres. Relative SIZE cannot
    separate two items in that list. Only shape can, so the sword has to be
    broader in proportion as well as carrying a crossguard, or the pair are two
    grey slivers and picking the wrong one at the merge bench is permanent.
    """
    bm = bmesh.new()
    #      along,   z0,     z1,   half_t, fuller
    stations = [
        (0.000, -0.065, 0.065, 0.0126, 0.0050),   # shoulder
        (0.055, -0.064, 0.064, 0.0122, 0.0050),
        (0.250, -0.059, 0.059, 0.0110, 0.0046),
        (0.410, -0.053, 0.053, 0.0094, 0.0038),
        (0.520, -0.044, 0.044, 0.0079, 0.0023),
        (0.585, -0.031, 0.031, 0.0060, 0.0),      # the point begins
        (0.625, -0.013, 0.013, 0.0034, 0.0),
        (0.648, -0.002, 0.002, 0.0011, 0.0),      # point
    ]
    bm_loft(bm, [sword_section(*s) for s in stations])
    bm_rot_x_up(bm)
    o = emit(bm, "blade_sword", "none", bevel_width=0.003)
    socket(o, "socket_base", (0, 0, 0))
    socket(o, "socket_tip", (0, 0, 0.648))


def make_guard_cross():
    """
    A crossguard: a bar across the blade, swollen at the middle where the blade
    passes through and swept down toward the grip at the tips.

    The sweep is the whole point. A straight bar reads as the coin-on-a-stick it
    is replacing; tips that drop toward the hand make a shallow V, and a V is a
    shape nothing else in the catalog has.
    """
    bm = bmesh.new()
    stations = [
        (-0.118, 0.015, -0.034, 0.004, 0.55),
        (-0.100, 0.019, -0.030, 0.013, 0.42),
        (-0.054, 0.023, -0.021, 0.020, 0.30),
        (-0.021, 0.031, -0.027, 0.033, 0.28),     # boss round the blade
        (0.021, 0.031, -0.027, 0.033, 0.28),
        (0.054, 0.023, -0.021, 0.020, 0.30),
        (0.100, 0.019, -0.030, 0.013, 0.42),
        (0.118, 0.015, -0.034, 0.004, 0.55),
    ]
    bm_loft(bm, [box_section(*s) for s in stations])
    o = emit(bm, "guard_cross", "none", bevel_width=0.004)
    socket(o, "socket_tip", (0, 0, 0.033))


def make_grip_wrapped():
    """
    A leather-over-cord grip: waisted, with five wrap ridges.

    Base anchored at the pommel end, so a hilt reads bottom up: pommel, grip,
    guard, blade. The ridges are under two pixels on the ground and exist for
    the inventory icon, which is where a player actually studies an item.
    """
    profile = [(0.0, 0.0), (0.0250, 0.004)]
    for i in range(5):
        z = 0.014 + i * 0.046
        profile += [(0.0242, z), (0.0288, z + 0.022), (0.0242, z + 0.042)]
    profile += [(0.0262, 0.250), (0.0224, 0.260), (0.0, 0.257)]

    bm = bmesh.new()
    bm_lathe(bm, profile, segments=9)
    o = emit(bm, "grip_wrapped", "base", bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.260))


def make_pommel_round():
    """A faceted pommel, anchored at its TOP because that is where it meets the
    grip. Small, but it stops the hilt ending in a flat cut."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, -0.054),
        (0.021, -0.051),
        (0.039, -0.038),
        (0.048, -0.018),
        (0.049, 0.002),
        (0.041, 0.020),
        (0.027, 0.032),
        (0.021, 0.038),              # collar under the grip
        (0.023, 0.046),
        (0.0, 0.048),
    ], segments=10)
    emit(bm, "pommel_round", "top", bevel_width=0.003)


# ------------------------------------------------------------- the small things

def make_spectacles_frame():
    """
    A whole wire frame: two rims, an arched bridge, two arms hooking down.

    Deliberately one part rather than five. Spectacles are about 24 pixels wide
    on the ground with a rim wire under two pixels thick, and at that size the
    thing that reads is the RELATIONSHIP between the parts, two circles a fixed
    distance apart joined across the top. Composing that from separate rims and
    a bar in a recipe means the relationship depends on offsets being right to
    the millimetre, and being wrong by a millimetre is the difference between
    spectacles and some wire.

    The lenses stay separate, because they are glass and the frame is steel and
    material is chosen per part at assembly. Rims are centred at x = ±0.115,
    which is where `lens_round` goes.

    Built in the XZ plane so the frame faces along Y, with the arms sweeping
    back in +Y.
    """
    bm = bmesh.new()
    RIM_X, RIM_R, WIRE = 0.115, 0.085, 0.016

    def wire_sec(i, t):
        return [(WIRE * math.cos(2.0 * math.pi * k / 5),
                 WIRE * math.sin(2.0 * math.pi * k / 5)) for k in range(5)]

    for sx in (-1.0, 1.0):
        bm_sweep(bm, arc_frames_xz(RIM_R, 0.0, 2.0 * math.pi, 10,
                                   centre=(sx * RIM_X, 0.0, 0.0), closed=True),
                 wire_sec, closed=True)

    # Bridge, arched so it is not simply a bar between two rings.
    bm_loft(bm, [box_section(*s) for s in (
        (-0.044, 0.013, 0.004, 0.028, 0.40),
        (-0.020, 0.013, 0.016, 0.040, 0.40),
        (0.020, 0.013, 0.016, 0.040, 0.40),
        (0.044, 0.013, 0.004, 0.028, 0.40),
    )])

    # Arms: back along +Y from the outer edge of each rim, then hooked down.
    for sx in (-1.0, 1.0):
        frames = []
        steps = 6
        for i in range(steps):
            t = i / (steps - 1)
            frames.append((Vector((sx * (RIM_X + RIM_R - 0.006 - 0.012 * t),
                                   0.20 * t,
                                   0.010 - 0.078 * t * t)),
                           Vector((1.0, 0.0, 0.0)), Vector((0.0, 0.0, 1.0)), t))
        bm_sweep(bm, frames, lambda i, t: [
            (0.011 * math.cos(2.0 * math.pi * k / 5),
             0.011 * math.sin(2.0 * math.pi * k / 5)) for k in range(5)])

    emit(bm, "spectacles_frame", "none", bevel_width=0.002)


def make_lens_round():
    """One spectacle lens. Faces along Y to match `spectacles_frame`, so the
    recipe drops a pair at x = ±0.115 and they seat in the rims."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, -0.005),
        (0.058, -0.006),
        (0.072, -0.002),
        (0.072, 0.002),
        (0.058, 0.006),
        (0.0, 0.005),
    ], segments=14)
    bm_rot_z_forward(bm)
    emit(bm, "lens_round", "none", smooth=True, bevel_width=0.001)


def make_key_body():
    """
    A whole key: bow, collar, shank, and a bit with two wards.

    One part, for the same reason as the spectacles and more so. This is the
    flagship `noMerge` item and the player will look at it, but on the ground it
    is about 28 pixels tall and 8 of those are the bow. A key is a glyph, and
    the glyph is loop-on-top, straight shank, blocky foot to one side. Assembled
    from three generic parts that glyph depends on three offsets agreeing; built
    as one part it cannot come apart.

    The wards are a slot cut between two teeth. At this size the slot is barely
    over a pixel, which is enough: what it buys is that the foot is not a solid
    rectangle, and a notched foot is the difference between a key and a hammer.
    """
    bm = bmesh.new()

    # Shank, with a collar under the bow.
    bm_lathe(bm, [
        (0.0, 0.004),
        (0.017, 0.0),
        (0.018, 0.020),
        (0.016, 0.120),
        (0.016, 0.250),
        (0.028, 0.262),              # collar
        (0.027, 0.276),
        (0.017, 0.286),
        (0.016, 0.312),
        (0.0, 0.316),
    ], segments=9)

    # Bit: a spine with two teeth, and the ward slot between them.
    bm_box(bm, (0.012, -0.014, 0.006), (0.042, 0.014, 0.094))
    bm_box(bm, (0.042, -0.013, 0.006), (0.108, 0.013, 0.034))
    bm_box(bm, (0.042, -0.013, 0.058), (0.092, 0.013, 0.094))

    # Bow: a ring standing in the XZ plane, so it reads as a loop face on.
    bm_sweep(bm, arc_frames_xz(0.058, 0.0, 2.0 * math.pi, 11,
                               centre=(0.0, 0.0, 0.372), closed=True),
             lambda i, t: [(0.018 * math.cos(2.0 * math.pi * k / 5),
                            0.018 * math.sin(2.0 * math.pi * k / 5)) for k in range(5)],
             closed=True)

    o = emit(bm, "key_body", "base", bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.448))


def make_chili_pod():
    """
    A pod: fat at the shoulder, hooking hard away, kinked near the tip.

    Anchored at the TOP, where the stem joins, because that is the attachment
    point and it makes a calyx trivial to place: the recipe puts the calyx at
    the same height as the pod and they meet.

    The curve is what separates this from a stretched apple, which is what the
    catalog was using. The first attempt curved by twelve degrees over its
    length and was still a carrot: at play size a gentle curve is a straight
    line, and length plus a sharp point is the carrot glyph however you shade
    it. So this hooks properly, about forty degrees, and is short and fat at
    roughly three to one rather than six. Blunt at the tip, for the same reason.
    """
    bm = bmesh.new()
    radii = [0.032, 0.058, 0.065, 0.063, 0.057, 0.048, 0.036, 0.022, 0.009]
    steps = len(radii)

    frames = []
    for i in range(steps):
        t = i / (steps - 1)
        kink = 1.1 * max(0.0, t - 0.68) ** 2
        frames.append((Vector((0.132 * t * t + kink, 0.0, -0.258 * t)),
                       Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), t))

    def sec(i, t):
        r = radii[i]
        pts = []
        for k in range(8):
            a = 2.0 * math.pi * k / 8
            rr = r * (1.0 + 0.11 * math.cos(3.0 * a))
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        return pts

    bm_sweep(bm, frames, sec)
    o = emit(bm, "chili_pod", "top", bevel_width=0.003)
    socket(o, "socket_base", (0, 0, 0))


def make_stem_calyx():
    """
    The green top of a fruit: a five pointed calyx cap and a short stem.

    `leaf_cluster` was standing in for this and it is the wrong object. A
    cluster splays outward and reads as foliage; a calyx caps the shoulder of
    the fruit and the stem rises out of it, so the two together make a small
    vertical accent rather than a green splat sitting on top.

    Base anchored at the cap's underside, which is where it meets the fruit.

    Sized to CAP the fruit rather than perch on it. The first cut was 84mm
    across against a pod 130mm at the shoulder, which at play size is a four
    pixel dot on a seven pixel shoulder and reads as a pin stuck in the top.
    A calyx has to be at least as wide as what it is sitting on.
    """
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.010),
        (0.030, 0.0, 0.008),
        (0.062, 0.008, 0.020),       # star rim, five points, wide
        (0.046, 0.026, 0.012),
        (0.018, 0.036),
        (0.013, 0.044),              # stem
        (0.012, 0.086),
        (0.009, 0.102),
        (0.0, 0.108),
    ], segments=10, lobes=5)
    o = emit(bm, "stem_calyx", "base", bevel_width=0.002)
    socket(o, "socket_tip", (0, 0, 0.100))


def make_stalk_short():
    """
    A fruit stalk: woody, slightly curved, swollen where it left the branch.

    For the apple, which has been wearing a `nail_spike` as a stem. A nail is
    straight, perfectly round and has a flat struck head, and all three of those
    are wrong: a stalk bends, tapers unevenly, and ends in a knuckle. Twelve
    pixels of it show above the crown, which is enough for the bend to read.

    Not the same job as `stem_calyx`. That is a five pointed cap for a fruit
    that has one, a chili or a pepper; an apple has a bare stalk in a well and
    would look like a tomato with a calyx on it.
    """
    bm = bmesh.new()
    radii = [0.017, 0.013, 0.0105, 0.0095, 0.0105, 0.008]
    heights = [0.0, 0.022, 0.048, 0.076, 0.094, 0.106]
    bend = [0.0, 0.004, 0.012, 0.024, 0.033, 0.039]

    frames = []
    for i in range(len(radii)):
        t = i / (len(radii) - 1)
        frames.append((Vector((bend[i], 0.0, heights[i])),
                       Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), t))

    def sec(i, t):
        r = radii[i]
        return [(r * math.cos(2.0 * math.pi * k / 6),
                 r * math.sin(2.0 * math.pi * k / 6)) for k in range(6)]

    bm_sweep(bm, frames, sec)
    o = emit(bm, "stalk_short", "base", bevel_width=0.002)
    socket(o, "socket_tip", (0.039, 0, 0.106))


def make_stone_lump():
    """
    A boulder, as opposed to `stone_shard`, which is a struck flake.

    The catalog was building a rock out of two shards at different scales, so a
    rock and a flint were the same object twice. This is the opposite form on
    purpose: roughly equidimensional instead of wedged, many small facets
    instead of a few big ones, and flattened underneath so it sits on the ground
    rather than balancing on a corner.
    """
    bm = bmesh.new()
    rng = _Lcg(97)
    for _ in range(22):
        u = rng.next() * 2.0 - 1.0
        v = rng.next() * 2.0 - 1.0
        w = rng.next() * 2.0 - 1.0
        n = max(math.sqrt(u * u + v * v + w * w), 1e-4)
        # Push out to a shell so the hull gets facets all round rather than a
        # few big ones spanning an empty middle.
        k = (0.72 + 0.28 * rng.next()) / n
        bm.verts.new((u * k * 0.152, v * k * 0.136, max(w * k * 0.118, -0.060)))
    bmesh.ops.convex_hull(bm, input=bm.verts)
    emit(bm, "stone_lump", "base", bevel_width=0.0)


def make_phial_ribbed():
    """
    A ribbed hexagonal phial, for things that are not to be drunk.

    Poison bottles were made ribbed and angular by law so they could be told
    from medicine by touch in the dark. That is exactly the problem here, minus
    the dark: the item cannot carry a label at seventeen pixels, so the warning
    has to be in the shape. Set against the flask, which is a wide round bulb,
    this is a hard sided column with six deep ribs, a shoulder that turns a
    corner instead of curving, and a mean little neck.

    The ribs are 14mm rather than the 9mm they started at. Nine was invisible:
    a rib only counts if it breaks the OUTLINE, not just the shading, because
    at this size the shading inside a seven pixel wide object is two pixels of
    gradient and the eye reads none of it.
    """
    bm = bmesh.new()
    rib = 0.014
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.056, 0.0, rib),
        (0.065, 0.014, rib),
        (0.067, 0.140, rib),         # long straight ribbed body
        (0.064, 0.172, rib),
        (0.052, 0.190, rib * 0.55),  # shoulder turns a corner
        (0.034, 0.212),
        (0.026, 0.228),
        (0.025, 0.250),              # neck
        (0.033, 0.260),              # lip
        (0.031, 0.270),
        (0.020, 0.272),
        (0.0, 0.266),
    ], segments=12, lobes=6)
    o = emit(bm, "phial_ribbed", "base", bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.250))
    socket(o, "socket_mid", (0, 0, 0.10))


# ------------------------------------------------------------------- ahead of
#
# Nothing below is referenced by a recipe yet. They are here because the object
# list has more coming and a part that does not exist is the reason an item ends
# up made of barrel hoops. Each was checked in a plausible assembly at play size
# the same way the rest were, so they are ready rather than merely present.


def make_stock_crossbow():
    """
    A crossbow tiller: nose, a straight run for the bolt, and a butt that drops
    away for the shoulder.

    Authored along X with the origin at the PROD MOUNT rather than at the butt,
    because the prod is the part that has to line up and everything else on a
    crossbow hangs off where those two meet. The drop at the back is the whole
    silhouette: a straight bar of wood is a plank.
    """
    bm = bmesh.new()
    stations = [
        (0.042, 0.026, -0.022, 0.024, 0.55),    # nose
        (0.000, 0.036, -0.032, 0.032, 0.35),    # prod mount, swollen
        (-0.055, 0.030, -0.028, 0.034, 0.30),
        (-0.190, 0.026, -0.026, 0.036, 0.30),   # tiller
        (-0.300, 0.028, -0.030, 0.038, 0.30),
        (-0.360, 0.030, -0.046, 0.036, 0.32),   # butt begins to drop
        (-0.450, 0.031, -0.072, 0.030, 0.38),
        (-0.520, 0.028, -0.082, 0.020, 0.55),
    ]
    bm_loft(bm, [box_section(*s) for s in stations])
    o = emit(bm, "stock_crossbow", "none", bevel_width=0.004)
    socket(o, "socket_tip", (0, 0, 0))
    socket(o, "socket_base", (-0.52, 0, -0.03))


def make_prod_bow():
    """A bow limb: a lath spanning across Y, curving back in X, thick at the
    centre and drawn down to nothing at the tips. Serves a crossbow prod and a
    hand bow equally; the difference between them is scale and a recipe."""
    bm = bmesh.new()
    steps = 11
    frames = []
    for i in range(steps):
        t = i / (steps - 1)
        u = t * 2.0 - 1.0
        frames.append((Vector((-0.108 * u * u, 0.265 * u, 0.0)),
                       Vector((1.0, 0.0, 0.0)), Vector((0.0, 0.0, 1.0)), t))

    def sec(i, t):
        u = abs(t * 2.0 - 1.0)
        hx = 0.019 * (1.0 - 0.68 * u * u)        # thickness, front to back
        hz = 0.017 * (1.0 - 0.55 * u * u)        # height of the limb
        return [(hx, hz * 0.45), (hx * 0.5, hz), (-hx * 0.5, hz),
                (-hx, hz * 0.45), (-hx, -hz * 0.45), (-hx * 0.5, -hz),
                (hx * 0.5, -hz), (hx, -hz * 0.45)]

    bm_sweep(bm, frames, sec)
    o = emit(bm, "prod_bow", "none", bevel_width=0.003)
    socket(o, "socket_mid", (0, 0, 0))


def make_fork_sling():
    """A cut sapling fork: a handle and two prongs splaying up and apart. The
    band is a recipe's job; this is the Y, and the Y is the whole read."""
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.0),
        (0.024, 0.002),
        (0.026, 0.030),
        (0.022, 0.110),
        (0.026, 0.170),              # swells where it splits
        (0.030, 0.196),
        (0.020, 0.212),
    ], segments=9)

    for sx in (-1.0, 1.0):
        steps = 6
        frames = []
        for i in range(steps):
            t = i / (steps - 1)
            frames.append((Vector((sx * (0.012 + 0.086 * t * t), 0.0, 0.186 + 0.150 * t)),
                           Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)), t))

        def sec(i, t):
            r = 0.020 * (1.0 - 0.42 * t)
            return [(r * math.cos(2.0 * math.pi * k / 7),
                     r * math.sin(2.0 * math.pi * k / 7)) for k in range(7)]

        bm_sweep(bm, frames, sec)

    o = emit(bm, "fork_sling", "base", bevel_width=0.004)
    socket(o, "socket_tip", (0, 0, 0.336))


def make_scabbard_long():
    """
    A sword sheath: a flat tapering case with a collar at the throat and a chape
    at the tip.

    Anchored at the MOUTH, which is the attachment point, so a recipe can hang
    it off a belt or stand a sword in it without arithmetic. Slightly wider than
    `blade_sword` at every station, which is what a sheath is.
    """
    bm = bmesh.new()
    # Every station is wider than `blade_sword` at the same distance from the
    # mouth. It has to be, and the numbers moved when the blade was broadened
    # to separate it from the knife; a sheath narrower than its sword is the
    # kind of thing nobody notices until the two are placed together.
    stations = [
        (0.000, 0.026, -0.074, 0.074, 0.30),    # mouth
        (-0.028, 0.029, -0.078, 0.078, 0.28),   # throat collar
        (-0.062, 0.024, -0.071, 0.071, 0.30),
        (-0.380, 0.021, -0.061, 0.061, 0.30),
        (-0.580, 0.018, -0.049, 0.049, 0.32),
        (-0.628, 0.022, -0.048, 0.048, 0.34),   # chape
        (-0.672, 0.017, -0.033, 0.033, 0.55),
    ]
    bm_loft(bm, [box_section(*s) for s in stations])
    bm_rot_x_up(bm)
    o = emit(bm, "scabbard_long", "top", bevel_width=0.004)
    socket(o, "socket_base", (0, 0, -0.672))


def make_bottle_body():
    """
    A bottle, and deliberately not the flask.

    Three vessels now share a shelf and they have to be tellable apart at twenty
    pixels, so each gets one job. The flask is a wide flattened bulb. The phial
    is a short ribbed hexagon. This is the tall one: straight cylindrical sides,
    a high shoulder, and a long neck, with a punt pushed up into the base.
    """
    bm = bmesh.new()
    bm_lathe(bm, [
        (0.0, 0.016),                # punt, pushed up into the base
        (0.032, 0.006),
        (0.062, 0.0),
        (0.071, 0.012),
        (0.073, 0.150),              # straight sided body
        (0.070, 0.178),
        (0.052, 0.214),              # shoulder
        (0.033, 0.242),
        (0.026, 0.270),              # long neck
        (0.025, 0.332),
        (0.034, 0.346),              # lip
        (0.032, 0.358),
        (0.020, 0.360),
        (0.0, 0.354),
    ], segments=12)
    o = emit(bm, "bottle_body", "base", smooth=False, bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.336))
    socket(o, "socket_mid", (0, 0, 0.11))


def make_book_closed():
    """
    A closed book: two boards, a page block inset behind them, a rounded spine.

    The inset is the part that matters. Covers flush with the pages give a
    featureless slab; setting the page block back by eight millimetres on the
    three open sides puts a shadow line all the way round and makes the object
    read as something that opens.

    A tome rather than a paperback, deliberately. Lying on the ground a book is
    seen almost edge on, so its thickness IS its silhouette: at 64mm it was four
    pixels of nothing, and at 92mm it is eleven and reads as an object.
    """
    bm = bmesh.new()

    # Boards, top and bottom.
    for z0 in (0.0, 0.076):
        bm_box(bm, (-0.100, -0.072, z0), (0.106, 0.072, z0 + 0.016))

    # Page block, inset on the three edges that are not the spine.
    bm_box(bm, (-0.096, -0.064, 0.016), (0.098, 0.064, 0.076))

    # Spine, rounded over the back edge.
    bm_sweep(bm, [(Vector((-0.100, y, 0.046)), Vector((1.0, 0.0, 0.0)),
                   Vector((0.0, 0.0, 1.0)), 0.0) for y in (-0.072, 0.072)],
             lambda i, t: [(0.004, 0.046), (-0.012, 0.038), (-0.019, 0.014),
                           (-0.019, -0.014), (-0.012, -0.038), (0.004, -0.046)])

    o = emit(bm, "book_closed", "base", bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.064))


BUILDERS = [
    make_haft_short, make_haft_long,
    make_blade_axe, make_blade_knife, make_head_hammer,
    make_bucket, make_flask, make_jar,
    make_plank, make_crate,
    make_ring, make_horseshoe, make_rope_coil,
    make_stone_shard, make_apple, make_straw_bale, make_rag_wrap,
    make_torch_head, make_leaf_cluster, make_stopper, make_nail_spike,
    make_disc, make_bar,
    make_blade_sword, make_guard_cross, make_grip_wrapped, make_pommel_round,
    make_spectacles_frame, make_lens_round, make_key_body,
    make_chili_pod, make_stem_calyx, make_stalk_short, make_stone_lump, make_phial_ribbed,
    make_stock_crossbow, make_prod_bow, make_fork_sling,
    make_scabbard_long, make_bottle_body, make_book_closed,
]


def main():
    reset_scene()

    for build in BUILDERS:
        build()

    os.makedirs(OUT_DIR, exist_ok=True)

    rows = sorted(((tri_count(o), o.name) for o in bpy.data.objects if o.type == "MESH"),
                  reverse=True)
    total = sum(t for t, _ in rows)
    raw = sum(COST.get(n, (0, 0, 0))[0] for _, n in rows)
    print(f"[parts] built {len(rows)} parts, {total} tris "
          f"({raw} authored, {total - raw} added by bevel)")
    print(f"[parts] {'part':<18}{'tris':>6}{'shape':>7}{'bevel':>7}{'seg':>5}")
    for tris, name in rows:
        before, after, seg = COST.get(name, (0, tris, 0))
        print(f"[parts] {name:<18}{tris:>6}{before:>7}{after - before:>7}{seg:>5}")

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
