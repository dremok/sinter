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
"""

import math
import os
import sys

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


def finish(obj, name, anchor_mode="base", smooth=False, bevel_width=0.008):
    obj.name = name
    obj.data.name = name
    anchor(obj, anchor_mode)
    bevel(obj, width=bevel_width)
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


# ----------------------------------------------------------------------- parts

def haft(name, length, r_top, r_bot, verts=10):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r_bot, radius2=r_top, depth=length)
    o = bpy.context.object
    return finish(o, name, "base", bevel_width=0.004)


def make_haft_short():
    o = haft("haft_short", 0.52, 0.021, 0.026)
    socket(o, "socket_tip", (0, 0, 0.52))
    socket(o, "socket_mid", (0, 0, 0.26))


def make_haft_long():
    o = haft("haft_long", 0.92, 0.019, 0.026)
    socket(o, "socket_tip", (0, 0, 0.92))
    socket(o, "socket_mid", (0, 0, 0.46))


def make_blade_axe():
    """A proper axe head: eye, cheek, and a flared bit with a curved edge."""
    bm = bmesh.new()
    # Slab, then shaped by moving the front face outward and tapering the edge.
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 0.30
        v.co.y *= 0.085
        v.co.z *= 0.20
    # Flare the cutting edge (+x) vertically and thin it.
    for v in bm.verts:
        if v.co.x > 0:
            v.co.z *= 1.75
            v.co.y *= 0.30
            v.co.x += 0.05
    mesh = bpy.data.meshes.new("blade_axe")
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new("blade_axe", mesh)
    bpy.context.collection.objects.link(o)
    finish(o, "blade_axe", "none", bevel_width=0.006)
    socket(o, "socket_mid", (0, 0, 0))


def make_blade_knife():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 0.26
        v.co.y *= 0.035
        v.co.z *= 0.07
    for v in bm.verts:
        if v.co.x > 0:
            v.co.y *= 0.25
            v.co.z *= 0.55
    mesh = bpy.data.meshes.new("blade_knife")
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new("blade_knife", mesh)
    bpy.context.collection.objects.link(o)
    finish(o, "blade_knife", "none", bevel_width=0.004)


def make_head_hammer():
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.x *= 0.20
        v.co.y *= 0.10
        v.co.z *= 0.10
    finish(o, "head_hammer", "none", bevel_width=0.012)


def make_bucket():
    """Staved pail: tapered body, open top, with a rim."""
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.15, radius2=0.19, depth=0.28)
    body = bpy.context.object
    body.name = "bucket_body"
    # Hollow it so the open top reads from an isometric angle.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    top_faces = [f for f in bm.faces if f.calc_center_median().z > 0.12]
    if top_faces:
        bmesh.ops.delete(bm, geom=top_faces, context="FACES")
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    finish(body, "bucket_body", "base", bevel_width=0.006)
    socket(body, "socket_tip", (0, 0, 0.28))


def make_flask():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8, radius=0.13)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.z *= 1.25
        # Pinch toward a neck at the top.
        if v.co.z > 0.06:
            f = 1.0 - (v.co.z - 0.06) * 3.4
            v.co.x *= max(f, 0.28)
            v.co.y *= max(f, 0.28)
    finish(o, "flask_body", "base", smooth=True, bevel_width=0.003)
    socket(o, "socket_tip", (0, 0, 0.30))


def make_jar():
    bpy.ops.mesh.primitive_cone_add(vertices=14, radius1=0.13, radius2=0.10, depth=0.22)
    o = bpy.context.object
    finish(o, "jar_body", "base", bevel_width=0.008)
    socket(o, "socket_tip", (0, 0, 0.22))


def make_plank():
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.x *= 0.62
        v.co.y *= 0.13
        v.co.z *= 0.032
    finish(o, "plank_board", "none", bevel_width=0.006)
    socket(o, "socket_tip", (0.62, 0, 0))


def make_crate():
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.x *= 0.22
        v.co.y *= 0.22
        v.co.z *= 0.22
    finish(o, "crate_box", "base", bevel_width=0.016)
    socket(o, "socket_tip", (0, 0, 0.44))


def make_ring():
    bpy.ops.mesh.primitive_torus_add(major_radius=0.14, minor_radius=0.028,
                                     major_segments=18, minor_segments=7)
    o = bpy.context.object
    finish(o, "ring_band", "none", smooth=False, bevel_width=0.003)


def make_horseshoe():
    """A torus with the heel opened up, which is what makes it read as a shoe
    rather than as a ring."""
    bpy.ops.mesh.primitive_torus_add(major_radius=0.14, minor_radius=0.032,
                                     major_segments=20, minor_segments=7)
    o = bpy.context.object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    gap = [f for f in bm.faces
           if f.calc_center_median().y < -0.075 and abs(f.calc_center_median().x) < 0.075]
    if gap:
        bmesh.ops.delete(bm, geom=gap, context="FACES")
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    # Flatten slightly: a shoe is not round stock.
    for v in o.data.vertices:
        v.co.z *= 0.6
    finish(o, "horseshoe", "none", bevel_width=0.004)


def make_rope_coil():
    bpy.ops.mesh.primitive_torus_add(major_radius=0.15, minor_radius=0.038,
                                     major_segments=16, minor_segments=7)
    o = bpy.context.object
    jitter(o, 0.012, 7)
    finish(o, "rope_coil", "none", smooth=True, bevel_width=0.003)


def make_stone_shard():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.12)
    o = bpy.context.object
    jitter(o, 0.055, 11)
    finish(o, "stone_shard", "base", bevel_width=0.004)


def make_apple():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=9, radius=0.115)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.z *= 0.92
        # Dimple the top and bottom, which is what makes it an apple.
        d = 1.0 - 0.35 * max(0.0, 1.0 - (v.co.x ** 2 + v.co.y ** 2) / 0.004)
        if abs(v.co.z) > 0.08:
            v.co.z *= d
    finish(o, "apple_body", "base", smooth=True, bevel_width=0.002)
    socket(o, "socket_tip", (0, 0, 0.21))


def make_straw_bale():
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.x *= 0.20
        v.co.y *= 0.15
        v.co.z *= 0.15
    jitter(o, 0.022, 23)
    finish(o, "straw_bale", "base", bevel_width=0.014)


def make_rag_wrap():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=7, radius=0.1)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.z *= 0.62
    jitter(o, 0.03, 31)
    finish(o, "rag_wrap", "none", smooth=True, bevel_width=0.003)


def make_torch_head():
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.062, radius2=0.05, depth=0.16)
    o = bpy.context.object
    jitter(o, 0.014, 41)
    finish(o, "torch_head", "base", bevel_width=0.005)
    socket(o, "socket_tip", (0, 0, 0.16))


def make_leaf_cluster():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.14)
    o = bpy.context.object
    jitter(o, 0.05, 53)
    finish(o, "leaf_cluster", "base", bevel_width=0.004)


def make_stopper():
    bpy.ops.mesh.primitive_cone_add(vertices=9, radius1=0.038, radius2=0.028, depth=0.07)
    o = bpy.context.object
    finish(o, "stopper", "base", bevel_width=0.004)


def make_nail_spike():
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=0.014, radius2=0.002, depth=0.17)
    o = bpy.context.object
    finish(o, "nail_spike", "base", bevel_width=0.002)


def make_disc():
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.11, depth=0.022)
    o = bpy.context.object
    finish(o, "disc_flat", "none", bevel_width=0.004)


def make_bar():
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    for v in o.data.vertices:
        v.co.x *= 0.30
        v.co.y *= 0.045
        v.co.z *= 0.045
    finish(o, "bar_stock", "none", bevel_width=0.006)


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

    meshes = sorted(o.name for o in bpy.data.objects if o.type == "MESH")
    print(f"[parts] built {len(meshes)} parts: {', '.join(meshes)}")

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
