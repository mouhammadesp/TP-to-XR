"""
Analyzes one instrument model (blend / fbx / obj / glb) and prints a JSON report:
objects, triangles, materials + textures, world bounding box (with unit scale).

  blender -b -P tools/instruments/analyze.py -- <source-file>
"""
import bpy, json, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
SRC = argv[0]
ext = os.path.splitext(SRC)[1].lower()

if ext == ".blend":
    # Opening the file replaces the whole scene: no factory reset needed.
    bpy.ops.wm.open_mainfile(filepath=SRC)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == ".fbx":
        try:
            bpy.ops.wm.fbx_import(filepath=SRC)  # Blender >= 4.2 core importer
        except AttributeError:
            bpy.ops.import_scene.fbx(filepath=SRC)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=SRC)
    elif ext == ".glb":
        bpy.ops.import_scene.gltf(filepath=SRC)
    else:
        raise SystemExit(f"unsupported format: {ext}")

unit = bpy.context.scene.unit_settings.scale_length
report = {"file": SRC, "blender_unit_scale": unit, "objects": [], "materials": {}}

for ob in bpy.context.scene.objects:
    if ob.type != "MESH":
        report["objects"].append({"name": ob.name, "type": ob.type})
        continue
    me = ob.data
    report["objects"].append(
        {"name": ob.name, "type": "MESH", "tris": len(me.polygons), "verts": len(me.vertices),
         "dims_local": [round(c, 4) for c in ob.dimensions[:]]}
    )
    for slot in ob.material_slots:
        if not slot.material:
            continue
        mat = slot.material
        images = []
        if mat.use_nodes:
            for n in mat.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image:
                    images.append({"image": os.path.basename(n.image.filepath or n.image.name),
                                   "size": list(n.image.size[:]), "colorspace": n.image.colorspace_settings.name})
        prev = report["materials"].get(mat.name, {"images": images, "users": 0})
        report["materials"][mat.name] = {"images": images, "users": prev["users"] + 1}

# World bounding box over all mesh objects.
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if meshes:
    pts = []
    for o in meshes:
        for v in o.data.vertices:
            pts.append(o.matrix_world @ v.co)
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    report["bbox_world"] = {"min": [round(c, 4) for c in mn], "max": [round(c, 4) for c in mx],
                            "dims": [round(mx[i] - mn[i], 4) for i in range(3)]}
    report["total_meshes"] = len(meshes)
    report["total_tris"] = sum(len(o.data.polygons) for o in meshes)
    report["total_verts"] = sum(len(o.data.vertices) for o in meshes)

print("ANALYSIS " + json.dumps(report))
