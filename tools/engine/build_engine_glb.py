"""
Builds the optimized GLB of the "TFSI engine" scan (SPLEEN VISION, Sketchfab, CC BY 4.0)
for the engine-identification demo, with its selection zones embedded as empty nodes.

  blender -b --factory-startup -P tools/engine/build_engine_glb.py -- <tfsi.obj> <texture.jpg> <out_dir> [target_tris] [cut_z]

What it does (Blender 4.x / 5.x):
  1. imports the OBJ (single mesh, single 8K texture) and binds the texture
     (the MTL references a file name that is not shipped);
  2. removes the underside of the scan (faces below cut_z: hanging noise);
  3. measures each selection zone: rectangles read on a top orthographic render
     (original OBJ frame, Blender Z-up, meters), heights measured by ray casts on the scan;
  4. adds one empty per zone ("zone__<id>", scale = full box size in meters);
  5. turns the scan so that the FRONT of the car faces Babylon +Z (the visitor),
     decimates it (collapse) and exports a GLB with a 4K JPEG texture.

Writes <out_dir>/audi_tfsi_engine.glb and <out_dir>/audi_tfsi_engine.zones.json (report).
"""
import bpy, bmesh, sys, os, json, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
OBJ, TEX, OUT = argv[0], argv[1], argv[2]
TARGET_TRIS = int(argv[3]) if len(argv) > 3 else 150_000
os.makedirs(OUT, exist_ok=True)
#: Faces entirely below this height (original frame, m) are removed (see "crop").
CUT_Z = float(argv[4]) if len(argv) > 4 else 0.18

# Zone rectangles in the ORIGINAL frame (Blender after OBJ import: +X = firewall side,
# -X = front of the car, +Y = car's right side, Z up). Read on the top ortho render.
# min_size: the box is grown to at least this size so that the laser hits it easily.
ZONES = {
    "oil_cap":       {"x": (-0.135, -0.062), "y": (0.336, 0.408), "min_size": 0.11, "max_depth": 0.06},
    "dipstick":      {"x": (-0.215, -0.178), "y": (0.196, 0.234), "min_size": 0.09, "max_depth": 0.06},
    "coolant_tank":  {"x": (-0.030, 0.145),  "y": (0.525, 0.720), "min_size": 0.10},
    "washer_cap":    {"x": (-0.148, -0.034), "y": (0.548, 0.632), "min_size": 0.09, "max_depth": 0.07},
    "engine_cover":  {"x": (-0.150, 0.000),  "y": (-0.080, 0.310), "min_size": 0.10},
    "air_filter":    {"x": (-0.314, -0.102), "y": (-0.684, -0.397), "min_size": 0.10},
    "intake_duct":   {"x": (-0.318, -0.182), "y": (-0.370, -0.125), "min_size": 0.10},
    "battery":       {"x": (-0.079, 0.295),  "y": (-0.617, -0.373), "min_size": 0.10},
    "brake_fluid":   {"x": (0.181, 0.291),   "y": (-0.361, -0.236), "min_size": 0.10, "max_depth": 0.12},
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=OBJ)
ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
ob.name = ob.data.name = "tfsi_engine_scan"
# The importer puts the Y-up → Z-up turn on the object: bake it into the mesh.
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# --- material: albedo texture only, rough non-metallic (photogrammetry: lighting is baked in)
img = bpy.data.images.load(TEX)
img.name = "tfsi_albedo"
mat = bpy.data.materials.new("tfsi_scan")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.8
bsdf.inputs["Metallic"].default_value = 0.0
ob.data.materials.clear()
ob.data.materials.append(mat)

# --- zone heights (ray casts from above on the full-resolution scan)
bm = bmesh.new()
bm.from_mesh(ob.data)
bm.transform(ob.matrix_world)
bvh = BVHTree.FromBMesh(bm)
report = {"source_triangles": len(ob.data.polygons), "zones": {}}
empties = []
for zid, z in ZONES.items():
    (x0, x1), (y0, y1) = z["x"], z["y"]
    hits = []
    n = 14
    for i in range(n + 1):
        for j in range(n + 1):
            p = Vector((x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * j / n, 3.0))
            loc, *_ = bvh.ray_cast(p, Vector((0, 0, -1)))
            if loc is not None:
                hits.append(loc.z)
    hits.sort()
    top = hits[int(len(hits) * 0.9) - 1]  # 90th percentile: a cable or a seal above the part does not count
    low = hits[max(0, int(len(hits) * 0.15) - 1)]  # ignore the deepest gaps between parts
    # A box never goes deeper than max_depth under the top of the part (gaps between parts).
    zmin, zmax = max(low - 0.015, top - z.get("max_depth", 0.14)), top + 0.02
    m = z["min_size"]
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (zmin + zmax) / 2
    sx, sy, sz = max(x1 - x0, m), max(y1 - y0, m), max(zmax - zmin, m)
    e = bpy.data.objects.new(f"zone__{zid}", None)
    e.empty_display_type = "CUBE"
    e.empty_display_size = 0.5  # cube of side 1 → scale = full box size
    e.location = (cx, cy, cz)
    e.scale = (sx, sy, sz)
    bpy.context.scene.collection.objects.link(e)
    empties.append(e)
    report["zones"][zid] = {
        "center_original": [round(cx, 3), round(cy, 3), round(cz, 3)],
        "size": [round(sx, 3), round(sy, 3), round(sz, 3)],
        "surface_top_z": round(top, 3),
        "hits": len(hits),
    }
bm.free()

# --- crop: the underside of the scan (hanging photogrammetry noise, never seen from above)
# goes; the demo shows the bay on a display plinth whose top is at this height.
bm = bmesh.new()
bm.from_mesh(ob.data)
under = [f for f in bm.faces if all(v.co.z < CUT_Z for v in f.verts)]
bmesh.ops.delete(bm, geom=under, context="FACES")
bm.to_mesh(ob.data)
bm.free()
report["cut_z"] = CUT_Z

# --- orientation: front of the car (-X) → -Y in Blender → +Z in glTF → +Z in Babylon
rot = Matrix.Rotation(math.radians(90), 4, "Z")
ob.data.transform(rot)
ob.data.update()
for e in empties:
    # +90° about Z: (x, y) → (-y, x); the box stays axis-aligned, its X/Y sizes swap.
    e.location = rot @ e.location
    e.scale = (e.scale.y, e.scale.x, e.scale.z)

# --- decimation
src = len(ob.data.polygons)
if src > TARGET_TRIS:
    bpy.context.view_layer.objects.active = ob
    mod = ob.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = TARGET_TRIS / src
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
report["glb_triangles"] = len(ob.data.polygons)

# Bounding box after rotation (Blender frame) — for the stand dimensions.
vs = [v.co for v in ob.data.vertices]
mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
report["bbox_blender_after_rotation"] = {"min": [round(c, 3) for c in mn], "max": [round(c, 3) for c in mx]}

# --- export
glb = os.path.join(OUT, "audi_tfsi_engine.glb")
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_yup=True,
    export_apply=True,
    export_normals=True,
    export_texcoords=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_extras=False,
)
report["glb_bytes"] = os.path.getsize(glb)
json.dump(report, open(os.path.join(OUT, "audi_tfsi_engine.zones.json"), "w"), indent=2)
print("REPORT", json.dumps(report))
