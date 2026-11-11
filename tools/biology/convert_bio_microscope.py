"""
Builds the GLB of the binocular microscope for the upcoming biology demo
(tp_demo_biology), WITHOUT Blender: the Sketchfab download
("binocular-microscope.zip", original Unity2Skfb export) contains a
self-contained glTF scene (Unity2Skfb.gltf + Unity2Skfb.bin + textures), so a
plain GLB repack is enough.

  python3 tools/biology/convert_bio_microscope.py [stage]

  stage "report"  -> prints scene/mesh statistics only
  stage "build"   -> writes backend/assets/models/converted/bio_microscope.glb
                     + its sidecar bio_microscope.json (visual check happens in
                     the debug viewer / e2e screenshots, like tools/instruments)

Source: Sketchfab "Binocular Microscope" (attribution to confirm — see
docs/AUDIT_DEMO_BIOLOGIE.md §5). Real binocular microscope: ~45 cm tall, the
largest dimension used in demoTps.ts (size_m 0.45); the viewer normalizes the
largest dimension to target_size_m, so the original units do not matter.
"""
import datetime, io, json, os, struct, sys, zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "backend", "assets", "models", "converted")
SRC = os.path.join(ROOT, "sources", "binocular-microscope.zip")
GLB_NAME = "bio_microscope.glb"


def read_gltf_archive():
    """Returns (gltf dict, bin bytes, {img name: bytes}) from the nested Sketchfab zip."""
    with zipfile.ZipFile(SRC) as outer:
        inner_bytes = outer.read("source/Unity2Skfb.zip")
    with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
        gltf = json.loads(inner.read("Unity2Skfb.gltf"))
        bin_data = inner.read("Unity2Skfb.bin")
        images = {}
        for img in gltf.get("images", []):
            uri = img.get("uri")
            if uri:
                name = uri.lstrip("/")
                if name not in images:
                    images[name] = inner.read(name)
        return gltf, bin_data, images


def scene_stats(gltf):
    meshes = gltf.get("meshes", [])
    tris = 0
    for m in meshes:
        for p in m.get("primitives", []):
            idx = p.get("indices")
            if idx is not None:
                tris += gltf["accessors"][idx].get("count", 0) // 3
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for n in gltf.get("nodes", []):
        if "mesh" in n:
            for p in meshes[n["mesh"]].get("primitives", []):
                acc = gltf["accessors"][p["attributes"].get("POSITION")]
                for i in range(3):
                    mn[i] = min(mn[i], acc["min"][i])
                    mx[i] = max(mx[i], acc["max"][i])
    return {"meshes": len(meshes), "triangles": tris,
            "materials": len(gltf.get("materials", [])), "images": len(gltf.get("images", [])),
            "dims_scene_units": [round(mx[i] - mn[i], 3) for i in range(3)]}


def build_glb(gltf, bin_data, images):
    """Embeds the external buffer and every referenced image into one GLB (glTF 2.0 binary)."""
    views = gltf.get("bufferViews", [])
    chunks = [bin_data]
    offset = len(bin_data)
    view_cache = {}
    for img in gltf.get("images", []):
        uri = img.get("uri")
        if uri is None:
            continue  # already embedded
        name = uri.lstrip("/")
        data = images.get(name)
        if data is None:
            raise SystemExit(f"image introuvable dans l'archive : {uri!r}")
        uri_key = name
        if uri_key not in view_cache:
            pad = (-offset) % 4
            if pad:
                chunks.append(b"\0" * pad)
                offset += pad
            views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
            view_cache[uri_key] = len(views) - 1
            chunks.append(data)
            offset += len(data)
        ext = os.path.splitext(name)[1].lower()
        img.pop("uri", None)
        img["mimeType"] = "image/png" if ext == ".png" else "image/jpeg"
        img["bufferView"] = view_cache[uri_key]
    payload = b"".join(chunks)
    gltf["buffers"][0].pop("uri", None)
    gltf["buffers"][0]["byteLength"] = offset
    json_chunk = json.dumps(gltf, separators=(",", ":")).encode()
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    payload += b"\0" * ((-len(payload)) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(payload)
    return (struct.pack("<III", 0x46546C67, 2, total)
            + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk
            + struct.pack("<I4s", len(payload), b"BIN\x00") + payload)


def main():
    stage = sys.argv[1] if len(sys.argv) > 1 else "build"
    gltf, bin_data, images = read_gltf_archive()
    stats = scene_stats(gltf)
    stats["bin_bytes"] = len(bin_data)
    print(json.dumps(stats, indent=2))
    if stage == "report":
        return
    os.makedirs(OUT, exist_ok=True)
    glb = build_glb(gltf, bin_data, images)
    glb_path = os.path.join(OUT, GLB_NAME)
    with open(glb_path, "wb") as f:
        f.write(glb)
    largest = max(stats["dims_scene_units"])
    sidecar = {
        "slug": GLB_NAME.replace(".glb", ""),
        "url": f"/assets/models/converted/{GLB_NAME}",
        "bytes": len(glb),
        "triangles": stats["triangles"],
        "dimensions_m": {"x": stats["dims_scene_units"][0],
                         "y": stats["dims_scene_units"][1],
                         "z": stats["dims_scene_units"][2]},
        "largest_dim_scene_units": largest,
        "real_size_note": "real largest dimension ≈ 0.45 m; the viewer normalizes (target_size_m 0.45 in demoTps.ts)",
        "attribution": {"title": "Binocular Microscope", "author": "à confirmer",
                        "license": "à confirmer (règle CC-BY du dépôt)", "source_url": ""},
        "source_file": "binocular-microscope.zip (Sketchfab « original », Unity2Skfb) — tools/biology/convert_bio_microscope.py",
        "converted_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    with open(os.path.join(OUT, GLB_NAME.replace(".glb", ".json")), "w") as f:
        json.dump(sidecar, f, indent=2, ensure_ascii=False)
    print(f"/assets/models/converted/{GLB_NAME} écrite ({len(glb)} octets)")


if __name__ == "__main__":
    main()
