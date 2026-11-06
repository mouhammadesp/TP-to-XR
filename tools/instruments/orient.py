"""
Decides the orientation of each instrument WITHOUT looking at renders:
  dmm    roughness map sampled at the UVs of up/down faces (the display glass
         is smooth -> low roughness on the display side)
  scope  emission map sampled per face-normal direction (only the LCD and the
         LEDs emit -> the brightest direction is the front)
  dcps   ray-cast depth variance per direction (the front panel has knobs and
         dials at several depths; the back is a flat wall)
  solder position of the named Button/Socket parts vs the station center
  amm    position of the knob (pemutar) / needle (jarum) vs the dial (mm1skala)

  blender -b -P tools/instruments/orient.py -- <slug>
"""
import bpy, json, math, os, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
SLUG = argv[0]
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "sources")
PATHS = {
    "dmm": os.path.join(SRC, "multimeter-free", "source", "MutliMeter.obj"),
    "scope": os.path.join(SRC, "oscilloscope-u1602b", "source", "extracted", "U1602B", "model",
                          "\u043e\u0441\u0446\u0438\u043b\u043b\u043e\u0433\u0440\u0430\u0444_done .fbx"),
    "dcps": os.path.join(SRC, "dc-regulated-power-supply-unit", "source", "DC_Regulated_Power_Supply.fbx"),
    "solder": os.path.join(SRC, "cc0_generic_soldering_station.glb"),
    "amm": os.path.join(SRC, "analog-multimeter", "source", "analog_multimeter.blend"),
}

ext = os.path.splitext(PATHS[SLUG])[1].lower()
if ext == ".blend":
    bpy.ops.wm.open_mainfile(filepath=PATHS[SLUG])
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext == ".fbx":
        try:
            bpy.ops.wm.fbx_import(filepath=PATHS[SLUG])
        except AttributeError:
            bpy.ops.import_scene.fbx(filepath=PATHS[SLUG])
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=PATHS[SLUG])
    else:
        bpy.ops.import_scene.gltf(filepath=PATHS[SLUG])

for o in list(bpy.context.scene.objects):
    if o.type in {"LIGHT", "CAMERA"}:
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
out = {"slug": SLUG}


def load_pixels(path=None, image=None):
    import numpy as np
    img = image if image is not None else bpy.data.images.load(path)
    w, h = img.size
    arr = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    arr = arr.reshape(h, w, 4)
    return img, arr, w, h


def sample(arr, w, h, u, v):
    """Mean luminance of a 3x3 around the UV."""
    import numpy as np
    cx, cy = int(u * (w - 1)), int(v * (h - 1))
    x0, x1 = max(0, cx - 1), min(w - 1, cx + 1)
    y0, y1 = max(0, cy - 1), min(h - 1, cy + 1)
    patch = arr[y0:y1 + 1, x0:x1 + 1, :3]
    return float((patch[:, :, 0] * 0.2126 + patch[:, :, 1] * 0.7152 + patch[:, :, 2] * 0.0722).mean())


DIRS = {"+X": Vector((1, 0, 0)), "-X": Vector((-1, 0, 0)),
        "+Y": Vector((0, 1, 0)), "-Y": Vector((0, -1, 0)),
        "+Z": Vector((0, 0, 1)), "-Z": Vector((0, 0, -1))}

if SLUG in {"dmm", "scope"}:
    if SLUG == "dmm":
        path = os.path.join(SRC, "multimeter-free", "textures", "MultiMeter_LP_1001_Roughness.jpg")
    else:
        path = os.path.join(SRC, "oscilloscope-u1602b", "textures",
                            "\u043e\u0441\u0446\u0438\u043b\u043b\u043e\u0433\u0440\u0430\u0444 _U1602B_Emission.png")
    img, arr, w, h = load_pixels(path)
    if SLUG == "scope":
        # Direct: find the bright LCD blob in the EMISSION map, then report the
        # world normals of the faces whose UVs fall inside it.
        import numpy as np
        lum = arr[:, :, 0] * 0.2126 + arr[:, :, 1] * 0.7152 + arr[:, :, 2] * 0.0722
        bright = lum > 0.45
        out["emission_bright_ratio"] = round(float(bright.mean()), 4)
        if bright.any():
            ys, xs = np.where(bright)
            # Biggest blob ≈ LCD: take the brightest 0.5% of pixels (buttons are tiny).
            thr = max(0.45, float(np.percentile(lum[bright], 50)) if bright.sum() > 100 else 0.45)
            core = lum > thr
            ys, xs = np.where(core)
            out["screen_uv_bbox"] = {
                "u": [round(float(xs.min()) / (w - 1), 3), round(float(xs.max()) / (w - 1), 3)],
                "v": [round(float(ys.min()) / (h - 1), 3), round(float(ys.max()) / (h - 1), 3)],
                "thr": round(thr, 3)}
            su = out["screen_uv_bbox"]
            per = {k: [0.0, 0.0, 0] for k in DIRS}  # [emission*area, area, faces]
            for o in meshes:
                me = o.data
                if not me.uv_layers:
                    continue
                uv = me.uv_layers.active.data
                mw = o.matrix_world
                for p in me.polygons:
                    u = v = 0.0
                    for li in p.loop_indices:
                        u += uv[li].uv.x
                        v += uv[li].uv.y
                    n = len(p.loop_indices)
                    u, v = u / n, v / n
                    if not (su["u"][0] <= u <= su["u"][1] and su["v"][0] <= v <= su["v"][1]):
                        continue
                    nrm = (mw.to_3x3() @ p.normal).normalized()
                    for k, d in DIRS.items():
                        if nrm.dot(d) > 0.5:
                            val = sample(arr, w, h, u, v)
                            per[k][0] += val * p.area
                            per[k][1] += p.area
                            per[k][2] += 1
            out["screen_faces"] = {k: {"mean": round(s / area, 3) if area > 1e-9 else None, "faces": c}
                                   for k, (s, area, c) in per.items()}
            best = max((k for k, (s, area, c) in per.items() if c > 0), key=lambda k: per[k][2])
            out["verdict"] = f"screen faces {best}"
            print("ORIENT " + json.dumps(out))
            raise SystemExit(0)
    per = {k: [0.0, 0.0, 0] for k in DIRS}  # [luminance*area, area, faces]
    for o in meshes:
        me = o.data
        if not me.uv_layers:
            continue
        uv = me.uv_layers.active.data
        mw = o.matrix_world
        for p in me.polygons:
            nrm = (mw.to_3x3() @ p.normal).normalized()
            for k, d in DIRS.items():
                if nrm.dot(d) > 0.8:
                    u = v = 0.0
                    for li in p.loop_indices:
                        u += uv[li].uv.x
                        v += uv[li].uv.y
                    n = len(p.loop_indices)
                    val = sample(px, w, h, u / n, v / n)
                    per[k][0] += val * p.area
                    per[k][1] += p.area
                    per[k][2] += 1
    # Weighted mean per direction (dmm: LOW roughness = display; scope: HIGH emission = front).
    out["directions"] = {k: {"mean": round(s / area, 3) if area > 1e-9 else None, "faces": c}
                         for k, (s, area, c) in per.items()}
    if SLUG == "dmm":
        up, down = out["directions"]["+Z"]["mean"], out["directions"]["-Z"]["mean"]
        out["verdict"] = "display=UP (+Z)" if (up is not None and down is not None and up < down) else \
                         "display=DOWN (-Z)" if (up is not None and down is not None) else "unknown"
    else:
        best = max((k for k in out["directions"] if out["directions"][k]["mean"] is not None),
                   key=lambda k: out["directions"][k]["mean"], default=None)
        out["verdict"] = f"screen faces {best}" if best else "unknown"


if SLUG == "dcps":
    # Depth profile per direction: the front panel (knobs, dials) is uneven,
    # the cabinet back is a flat sheet.
    o = meshes[0]
    me = o.data
    # Bake the importer's object rotation into the mesh (BVH is in local space).
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mw = o.matrix_world
    bvh = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())
    verts = [mw @ v.co for v in me.vertices]
    mn = Vector((min(p.x for p in verts), min(p.y for p in verts), min(p.z for p in verts)))
    mx = Vector((max(p.x for p in verts), max(p.y for p in verts), max(p.z for p in verts)))
    center = (mn + mx) / 2
    radius = max(mx - mn)
    for k, d in DIRS.items():
        depths = []
        # Grid across the face perpendicular to d.
        axes = [a for a in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
                if abs(a.dot(d)) < 0.5]
        ext = [(mx - mn).dot(a) for a in axes]
        n = 18
        origin = center + d * (radius * 1.5)
        for i in range(n + 1):
            for j in range(n + 1):
                grid = center + axes[0] * (i / n - 0.5) * ext[0] * 0.95 \
                              + axes[1] * (j / n - 0.5) * ext[1] * 0.95
                loc, normal, idx, dist = bvh.ray_cast(origin, (grid - origin).normalized())
                if loc is not None:
                    depths.append(dist)
        if depths:
            mean = sum(depths) / len(depths)
            var = sum((x - mean) ** 2 for x in depths) / len(depths)
            out.setdefault("depth_profile", {})[k] = {
                "hits": len(depths), "mean": round(mean, 3), "std": round(math.sqrt(var), 4)}
    prof = out.get("depth_profile", {})
    # The front = the vertical face (+/-Y) with the highest relief (std).
    cands = {k: v["std"] for k, v in prof.items() if k in ("+Y", "-Y")}
    out["verdict"] = f"front={max(cands, key=cands.get)}" if cands else "unknown"
    # Photogrammetry noise makes the whole-surface relief inconclusive; the real
    # discriminator is the KNOBS: faces pointing out of the panel plane well
    # beyond its 90th percentile depth (raw units: 0.03 u ~ 1 cm).
    out["verdict_relief"] = "inconclusive"
    out["knobs"] = {}
    for k in ("+X", "-X", "+Y", "-Y"):
        d = DIRS[k]
        faces_d = []
        for o in meshes:
            me = o.data
            mw = o.matrix_world
            for p in me.polygons:
                nrm = (mw.to_3x3() @ p.normal).normalized()
                if nrm.dot(d) > 0.7:
                    c = mw @ p.center
                    faces_d.append((c.dot(d), p.area))
        if faces_d:
            depths = sorted(x for x, _ in faces_d)
            base = depths[int(len(depths) * 0.9)]
            beyond = [(x, a) for x, a in faces_d if x > base + 0.02]
            out["knobs"][k] = {
                "faces": len(faces_d),
                "protruding_faces": len(beyond),
                "protruding_area": round(sum(a for _, a in beyond), 5)}
    if out["knobs"]:
        score = {k: v["protruding_area"] for k, v in out["knobs"].items()}
        out["verdict"] = f"front={max(score, key=score.get)} (knobs)"
    # Knobs are cylinders: their protruding cap faces form small round clusters.
    # A handle or a heat sink (back) is elongated instead.
    out["clusters"] = {}
    for k in ("+X", "-X", "+Y", "-Y"):
        d = DIRS[k]
        pts = []
        for o in meshes:
            me = o.data
            mw = o.matrix_world
            for p in me.polygons:
                nrm = (mw.to_3x3() @ p.normal).normalized()
                if nrm.dot(d) > 0.7:
                    c = mw @ p.center
                    if c.dot(d) > 0:  # signed depth; recompute below with p90
                        pass
                    pts.append((c, p.area, c.dot(d)))
        if not pts:
            continue
        depths = sorted(z for _, _, z in pts)
        base = depths[int(len(depths) * 0.9)]
        beyond = [(c, a) for c, a, z in pts if z > base + 0.02]
        if len(beyond) < 8:
            out["clusters"][k] = {"clusters": 0}
            continue
        # Grid clustering in the plane perpendicular to d.
        axes = [a for a in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
                if abs(a.dot(d)) < 0.5]
        cells = {}
        for c, _a in beyond:
            key = (round(c.dot(axes[0]) / 0.03), round(c.dot(axes[1]) / 0.03))
            cells.setdefault(key, []).append(c)
        # Merge neighbor cells (flood fill on the 8-neighbour grid).
        seen, clusters = set(), []
        for key in cells:
            if key in seen:
                continue
            stack, comp = [key], []
            seen.add(key)
            while stack:
                cur = stack.pop()
                comp.append(cur)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nk = (cur[0] + dx, cur[1] + dy)
                        if nk in cells and nk not in seen:
                            seen.add(nk)
                            stack.append(nk)
            clusters.append(comp)
        big = [c for c in clusters if len(c) >= 4]
        shapes = []
        for comp in big:
            cs = [cells[k][0] for k in comp]
            us = [c.dot(axes[0]) for c in cs]
            vs = [c.dot(axes[1]) for c in cs]
            w, hgt = max(us) - min(us), max(vs) - min(vs)
            shapes.append({"cells": len(comp), "w": round(w, 3), "h": round(hgt, 3),
                           "ratio": round(max(w, hgt) / max(min(w, hgt), 1e-4), 2)})
        out["clusters"][k] = {
            "clusters": len(big),
            "round": sum(1 for s in shapes if s["ratio"] < 1.6 and max(s["w"], s["h"]) < 0.12),
            "elongated": sum(1 for s in shapes if s["ratio"] >= 1.6),
            "shapes": sorted(shapes, key=lambda s: -s["cells"])[:6]}
    # Cross-check with the albedo texture: the front panel (dials, printed text,
    # colored terminals) is more contrasted than the case sides.
    img_node = None
    for o in meshes:
        for slot in o.material_slots:
            if slot.material and slot.material.use_nodes:
                for nd in slot.material.node_tree.nodes:
                    if nd.type == "TEX_IMAGE" and nd.image:
                        img_node = nd
    if img_node:
        img, arr, w, h = load_pixels(image=img_node.image)
        import numpy as np
        stats = {}
        for o in meshes:
            me = o.data
            if not me.uv_layers:
                continue
            uv = me.uv_layers.active.data
            mw = o.matrix_world
            for p in me.polygons:
                nrm = (mw.to_3x3() @ p.normal).normalized()
                u = v = 0.0
                for li in p.loop_indices:
                    u += uv[li].uv.x
                    v += uv[li].uv.y
                n = len(p.loop_indices)
                u, v = u / n, v / n
                for k in ("+X", "-X", "+Y", "-Y"):
                    if nrm.dot(DIRS[k]) > 0.7:
                        cx, cy = int(u * (w - 1)), int(v * (h - 1))
                        patch = arr[cy, cx, :3]
                        lum = float(patch[0]) * 0.2126 + float(patch[1]) * 0.7152 + float(patch[2]) * 0.0722
                        sat = float(max(patch[:3]) - min(patch[:3]))
                        stats.setdefault(k, []).append((lum, sat))
        agg = {k: {"faces": len(v),
                   "lum_std": round(float(np.std([x for x, _ in v])), 4),
                   "sat_mean": round(float(np.mean([y for _, y in v])), 4)}
               for k, v in stats.items()}
        out["albedo_stats"] = agg
        if agg:
            score = {k: s["lum_std"] + 2 * s["sat_mean"] for k, s in agg.items()}
            out["verdict_texture"] = f"front={max(score, key=score.get)}"
    # Extra evidence: face-depth percentiles per direction (where do reliefs live?).
    out["depth_percentiles"] = {}
    for k in ("+X", "-X", "+Y", "-Y", "+Z", "-Z"):
        d = DIRS[k]
        vals = []
        for o in meshes:
            me = o.data
            mw = o.matrix_world
            for p in me.polygons:
                nrm = (mw.to_3x3() @ p.normal).normalized()
                if nrm.dot(d) > 0.7:
                    vals.append((mw @ p.center).dot(d))
        if vals:
            vals.sort()
            n = len(vals)
            out["depth_percentiles"][k] = {
                "faces": n,
                "p90": round(vals[int(n * 0.9)], 4),
                "p99": round(vals[min(n - 1, int(n * 0.99))], 4),
                "max": round(vals[-1], 4),
                "tail": round(vals[-1] - vals[int(n * 0.9)], 4)}

if SLUG == "solder":
    # Named parts: the buttons and sockets sit on the front face.
    named = {(o.data.name if o.data and o.data.name != "Mesh" else o.name): o.matrix_world.translation
             for o in meshes}
    verts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    center = Vector((
        sum(p.x for p in verts) / len(verts), sum(p.y for p in verts) / len(verts),
        sum(p.z for p in verts) / len(verts)))
    out["center"] = [round(c, 3) for c in center]
    out["parts"] = {n: [round(c, 3) for c in p] for n, p in named.items()}

if SLUG == "amm":
    # pemutar = selector knob, jarum = needle, mm1kaca = glass, mm1skala = dial:
    # all on the front face of the meter.
    named = {o.name: (o.matrix_world.translation, len(o.data.vertices)) for o in meshes}
    verts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    center = Vector((
        sum(p.x for p in verts) / len(verts), sum(p.y for p in verts) / len(verts),
        sum(p.z for p in verts) / len(verts)))
    out["center"] = [round(c, 3) for c in center]
    out["parts"] = {n: [round(c, 3) for c in p] for n, (p, _) in named.items()}

print("ORIENT " + json.dumps(out))
