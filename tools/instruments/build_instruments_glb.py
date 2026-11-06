"""
Builds the optimized GLB of one electrical instrument for the "instrument_quiz"
demo (tp_demo_instruments), at REAL scale, its FRONT facing Babylon +Z (the
visitor side), base at y = 0, textures <= 2048 px.

  blender -b -P tools/instruments/build_instruments_glb.py -- <slug> <stage>

    stage "preview" -> renders 5 orthographic views of the RAW import
                      (tools/instruments/previews/<slug>_raw_<view>.png)
    stage "build"   -> applies the orientation/scale of CONFIGS, renders the
                      final previews and exports
                      backend/assets/models/converted/<glb name>.glb

Sources (Sketchfab, see backend/src/services/demoTps.ts for attributions):
  dmm    multimeter-free.zip            MutliMeter.obj        (no MTL -> bind by hand)
  scope  oscilloscope-u1602b.zip        oscillograph_done.fbx (textures unbound)
  dcps   dc-regulated-power-supply.zip  DC_Regulated...fbx    (photogrammetry, 8K texture)
  solder cc0_generic_soldering_station.glb
  amm    analog-multimeter.zip          analog_multimeter.blend (modifiers to apply)
"""
import bpy, json, math, os, sys

argv = sys.argv[sys.argv.index("--") + 1:]
SLUG, STAGE = argv[0], (argv[1] if len(argv) > 1 else "build")
ROOT = os.path.dirname(os.path.abspath(__file__))  # tools/instruments
SRC = os.path.join(ROOT, "sources")
OUT = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "backend", "assets", "models", "converted")
PREVIEW = os.path.join(ROOT, "previews")
os.makedirs(PREVIEW, exist_ok=True)

CONFIGS = {
    "dmm": {
        "path": os.path.join(SRC, "multimeter-free", "source", "MutliMeter.obj"),
        "glb": "electrical_multimeter_digital.glb",
        # Real handheld DMM ~ 17.5 cm long (its largest dimension).
        "target_m": 0.175,
        # Orientation fix, decided on the raw previews (degrees, applied in order).
        "rotations": [("Z", 90)],
    },
    "scope": {
        "path": os.path.join(SRC, "oscilloscope-u1602b", "source", "extracted", "U1602B", "model",
                             "\u043e\u0441\u0446\u0438\u043b\u043b\u043e\u0433\u0440\u0430\u0444_done .fbx"),
        "glb": "electrical_oscilloscope_u1602b.glb",
        # Handheld scope Keysight U1602B ~ 27 cm wide.
        "target_m": 0.27,
        # The scan lies on its side (width along world Z, screen facing -Y):
        # -90 deg about Y brings the width horizontal, keeps the screen toward -Y.
        "rotations": [("Y", -90)],
    },
    "dcps": {
        "path": os.path.join(SRC, "dc-regulated-power-supply-unit", "source", "DC_Regulated_Power_Supply.fbx"),
        "glb": "electrical_dc_power_supply.glb",
        # Vintage bench PSU ~ 40 cm wide.
        "target_m": 0.40,
        # Front panel (round 10 cm dial, densest scan) faces +X: turn it toward -Y.
        "rotations": [("Z", -90)],
    },
    "solder": {
        "path": os.path.join(SRC, "cc0_generic_soldering_station.glb"),
        "glb": "electrical_soldering_station.glb",
        # Station + iron laid out ~ 22 cm.
        "target_m": 0.22,
        # Buttons + iron socket sit on the +X face: turn it toward -Y.
        "rotations": [("Z", -90)],
    },
    "amm": {
        "path": os.path.join(SRC, "analog-multimeter", "source", "analog_multimeter.blend"),
        "glb": "electrical_multimeter_analog.glb",
        # Standing analog multimeter ~ 19 cm.
        "target_m": 0.19,
        # Dial + needle + selector knob already face -Y (the visitor): nothing to do.
        "rotations": [],
    },
}
CFG = CONFIGS[SLUG]
MAX_TEX = 2048

# ---------------------------------------------------------------- import
ext = os.path.splitext(CFG["path"])[1].lower()
if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=CFG["path"])
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == ".fbx":
        try:
            bpy.ops.wm.fbx_import(filepath=CFG["path"])
        except AttributeError:
            bpy.ops.import_scene.fbx(filepath=CFG["path"])
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=CFG["path"])
    elif ext == ".glb":
        bpy.ops.import_scene.gltf(filepath=CFG["path"])
    else:
        raise SystemExit(f"unsupported format: {ext}")

# Drop lights, cameras: only the meshes travel.
for o in list(bpy.context.scene.objects):
    if o.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh objects")

# Sketchfab GLBs come with a hierarchy of empty nodes whose own transforms
# would skew any rotation applied to the child meshes: unparent everything
# (keeping world transforms) and drop the empties.
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
try:
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
except Exception as e:
    print("parent_clear:", e)
for o in list(bpy.context.scene.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
report = {"slug": SLUG, "stage": STAGE}

print("LOADED", json.dumps({"objects": len(meshes), "tris": sum(len(o.data.polygons) for o in meshes)}))


# ---------------------------------------------------------------- textures
def bind(objs, mat_name, base=None, roughness=None, normal=None, emission=None,
         set_roughness=None, set_metallic=None):
    """Wires image files into one Principled BSDF material shared by `objs`."""
    mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    def tex(path, non_color=False):
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        return node

    if base:
        nt.links.new(tex(base).outputs["Color"], bsdf.inputs["Base Color"])
    if roughness:
        nt.links.new(tex(roughness, True).outputs["Color"], bsdf.inputs["Roughness"])
    if normal:
        n = tex(normal, True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emission:
        nt.links.new(tex(emission).outputs["Color"], bsdf.inputs["Emission Color"])
    if set_roughness is not None:
        bsdf.inputs["Roughness"].default_value = set_roughness
    if set_metallic is not None:
        bsdf.inputs["Metallic"].default_value = set_metallic
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    return mat


if SLUG == "dmm":
    bind(meshes, "dmm_skin",
         base=os.path.join(SRC, "multimeter-free", "textures", "MultiMeter_LP_1001_BaseColor.jpg"),
         roughness=os.path.join(SRC, "multimeter-free", "textures", "MultiMeter_LP_1001_Roughness.jpg"))
elif SLUG == "scope":
    # Albedo has alpha (screen glass); Emission lights the LCD; the Unity-style
    # MetallicSmoothness map is approximated by fixed plastic values.
    T = os.path.join(SRC, "oscilloscope-u1602b", "textures")
    mat = bind(meshes, "u1602b_skin",
               base=os.path.join(T, "\u043e\u0441\u0446\u0438\u043b\u043b\u043e\u0433\u0440\u0430\u0444 _U1602B_AlbedoTransparency.png"),
               normal=os.path.join(T, "\u043e\u0441\u0446\u0438\u043b\u043b\u043e\u0433\u0440\u0430\u0444 _U1602B_Normal.png"),
               emission=os.path.join(T, "\u043e\u0441\u0446\u0438\u043b\u043b\u043e\u0433\u0440\u0430\u0444 _U1602B_Emission.png"),
               set_roughness=0.55, set_metallic=0.0)
    mat.blend_method = "BLEND"  # keep the albedo alpha

# ---------------------------------------------------------------- clean & apply
if STAGE == "build":
    # Apply modifiers (the .blend ships subdivision surfaces) then bake transforms.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    for o in meshes:
        for m in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=m.name)
            except Exception as e:
                print(f"modifier {m.name} on {o.name}: {e}")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    for axis, deg in CFG["rotations"]:
        bpy.ops.object.select_all(action="DESELECT")
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.transform.rotate(value=math.radians(deg), orient_axis=axis)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---------------------------------------------------------------- measure & scale
def world_bbox(objs):
    pts = []
    for o in objs:
        for v in o.data.vertices:
            pts.append(o.matrix_world @ v.co)
    mn = [min(p[i] for p in pts) for i in range(3)]
    mx = [max(p[i] for p in pts) for i in range(3)]
    return mn, mx


mn, mx = world_bbox(meshes)
report["raw_bbox"] = {"min": [round(c, 4) for c in mn], "max": [round(c, 4) for c in mx]}

if STAGE == "build":
    largest = max(mx[i] - mn[i] for i in range(3)) or 1
    s = CFG["target_m"] / largest
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.transform.resize(value=(s, s, s))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Re-center on X/Z (bench axes) and put the BASE at z = 0.
    mn, mx = world_bbox(meshes)
    cx = (mn[0] + mx[0]) / 2
    for o in meshes:
        o.location = (o.location.x - cx, o.location.y, o.location.z - mn[2])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mn, mx = world_bbox(meshes)
    report["final_bbox_m"] = {
        "min": [round(c, 4) for c in mn], "max": [round(c, 4) for c in mx],
        # Babylon dims after the glTF Y-up turn: width X, height Z (up), depth Y.
        "dims_babylon": {"width": round(mx[0] - mn[0], 3), "height": round(mx[2] - mn[2], 3),
                         "depth": round(mx[1] - mn[1], 3)},
    }
    report["total_tris"] = sum(len(o.data.polygons) for o in meshes)


# ---------------------------------------------------------------- previews
def render_views(tag):
    import mathutils
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    try:
        scene.display.shading.color_type = "TEXTURE"
        scene.display.shading.light = "FLAT"
    except Exception:
        pass
    scene.render.resolution_x = 560
    scene.render.resolution_y = 560
    scene.render.image_settings.file_format = "PNG"
    cmn, cmx = world_bbox(meshes)
    center = mathutils.Vector(((cmn[i] + cmx[i]) / 2) for i in range(3))
    radius = max(cmx[i] - cmn[i] for i in range(3)) or 1
    views = {
        "front": (0, -1, 0.25),   # visitor side (Blender -Y -> Babylon +Z)
        "back": (0, 1, 0.25),
        "side": (1, 0, 0.25),
        "top": (0, 0, 1),
        "iso": (0.85, -0.85, 0.55),
    }
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, d in views.items():
        n = math.sqrt(sum(c * c for c in d))
        dist = radius * 2.2
        cam.location = (center[0] + d[0] / n * dist, center[1] + d[1] / n * dist,
                        center[2] + d[2] / n * dist)
        direction = center - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        cam_data.ortho_scale = radius * 1.6
        scene.render.filepath = os.path.join(PREVIEW, f"{SLUG}_{tag}_{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


if STAGE == "preview":
    render_views("raw")
    print("PREVIEW-DONE " + json.dumps(report))
    raise SystemExit(0)

render_views("final")

# ---------------------------------------------------------------- texture budget
for img in bpy.data.images:
    if img.size[0] > MAX_TEX or img.size[1] > MAX_TEX:
        img.scale(min(img.size[0], MAX_TEX), min(img.size[1], MAX_TEX))
        report.setdefault("resized", []).append(img.name)

# ---------------------------------------------------------------- export
glb_path = os.path.join(OUT, CFG["glb"])
bpy.ops.export_scene.gltf(
    filepath=glb_path,
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
report["glb"] = CFG["glb"]
report["glb_bytes"] = os.path.getsize(glb_path)
print("BUILD " + json.dumps(report))
