"""
Visual check of the engine GLB: re-imports it and renders the selection zones as
colored boxes over the scan (top view + 3/4 view from the visitor's side).

  blender -b --factory-startup -P tools/engine/check_engine_glb.py -- <glb> <out_dir>
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
sc = bpy.context.scene
zones = [o for o in sc.objects if o.name.startswith("zone__")]
print("ZONES", len(zones), [z.name for z in zones])
for i, z in enumerate(zones):
    bpy.ops.mesh.primitive_cube_add(size=1)
    c = bpy.context.active_object
    c.matrix_world = z.matrix_world.copy()
    c.scale = z.matrix_world.to_scale()  # glTF empties: scale = full box size
    m = bpy.data.materials.new(f"zm{i}")
    m.use_nodes = True
    col = [(1, 0.2, 0.2), (0.2, 1, 0.2), (0.2, 0.5, 1), (1, 1, 0.2), (1, 0.3, 1), (0.2, 1, 1), (1, 0.6, 0.1), (0.6, 0.3, 1), (1, 1, 1)][i % 9]
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Alpha"].default_value = 0.45
    m.surface_render_method = "BLENDED" if hasattr(m, "surface_render_method") else None
    c.data.materials.append(m)
    c.name = "box_" + z.name

mesh = [o for o in sc.objects if o.type == "MESH" and not o.name.startswith("box_")][0]
bb = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
print("BBOX", tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx), "TRIS", len(mesh.data.polygons))
ctr = (mn + mx) / 2

sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 1600, 1100
sc.world = bpy.data.worlds.new("w")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.85, 0.85, 1)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam

def shot(name, loc, ortho=None):
    cam.location = loc
    cam.rotation_euler = (ctr - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam.data.ortho_scale = ortho
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)

# After import (glTF +Z = Babylon +Z = visitor side) the visitor is toward Blender -Y.
shot("check_top.png", (ctr.x, ctr.y, 3), ortho=2.0)
shot("check_visitor.png", (ctr.x, ctr.y - 1.6, ctr.z + 1.1))
for z in zones:
    z.hide_render = True
for o in sc.objects:
    if o.name.startswith("box_"):
        o.hide_render = True
shot("check_visitor_clean.png", (ctr.x, ctr.y - 1.6, ctr.z + 1.1))
shot("check_low.png", (ctr.x + 0.9, ctr.y - 1.9, ctr.z + 0.25))
print("DONE")
