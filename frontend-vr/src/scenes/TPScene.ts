/**
 * TPScene — loads the shared workshop template and the TP's 3D assets.
 *
 * Each asset gets a grab "handle": an invisible box matching the model's
 * bounding box, with its origin at the BASE center (the manifest position).
 *   handle (pickable, draggable) → pivot (scale + recenter) → model meshes
 */
import {
  AbstractMesh,
  AbstractEngine,
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { BuiltinModel, buildBuiltin } from "../models/builtin";
import { Manifest, SceneAsset } from "../utils/manifest";
import { FONT, paintMesh, wrap } from "../ui/textCanvas";

export interface PlacedAsset {
  asset: SceneAsset;
  handle: Mesh;
  meshes: AbstractMesh[];
  label: Mesh;
  loaded: boolean;
  error: string | null;
  /** Procedural model and its animatable parts (source "builtin"). */
  builtin: BuiltinModel | null;
}

/**
 * Loads the serialized workshop template (.babylon) into a new scene.
 */
export async function loadTemplate(engine: AbstractEngine, url: string): Promise<Scene> {
  const cut = url.lastIndexOf("/") + 1;
  SceneLoader.ShowLoadingScreen = false; // parallel imports race on the overlay; the HUD shows progress
  const scene = await SceneLoader.LoadAsync(url.slice(0, cut), url.slice(cut), engine);
  console.log(`🏗️ Template loaded: ${scene.meshes.length} meshes`);
  return scene;
}

/**
 * Loads and places every asset of the manifest (in parallel).
 * A model that fails to load is replaced by a labeled placeholder box.
 */
export async function placeAssets(
  scene: Scene,
  manifest: Manifest,
  onProgress?: (done: number, total: number) => void
): Promise<PlacedAsset[]> {
  let done = 0;
  return Promise.all(
    manifest.assets.map(async (asset) => {
      const placed = await placeAsset(scene, asset, manifest.color_scheme.material_base);
      onProgress?.(++done, manifest.assets.length);
      return placed;
    })
  );
}

/**
 * Loads one asset, normalizes its largest dimension to target_size_m and
 * puts its base on the manifest position.
 */
async function placeAsset(scene: Scene, asset: SceneAsset, fallbackColor: string): Promise<PlacedAsset> {
  const pivot = new TransformNode(`pivot_${asset.asset_id}`, scene);
  let meshes: AbstractMesh[] = [];
  let loaded = false;
  let error: string | null = null;
  let builtin: BuiltinModel | null = null;

  if (asset.source === "builtin") {
    builtin = buildBuiltin(scene, asset.builtin_model ?? "", asset.asset_id);
    if (builtin) {
      builtin.root.parent = pivot;
      meshes = builtin.root.getChildMeshes();
      loaded = true;
    } else {
      error = `unknown builtin model "${asset.builtin_model}"`;
    }
  } else if (asset.url) {
    try {
      const cut = asset.url.lastIndexOf("/") + 1;
      const res = await SceneLoader.ImportMeshAsync("", asset.url.slice(0, cut), asset.url.slice(cut), scene);
      res.meshes.filter((m) => !m.parent).forEach((m) => (m.parent = pivot));
      res.transformNodes.filter((t) => !t.parent).forEach((t) => (t.parent = pivot));
      res.animationGroups.forEach((g) => g.stop());
      meshes = res.meshes;
      loaded = meshes.some((m) => m.getTotalVertices() > 0);
      if (!loaded) error = "model has no geometry";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ ${asset.name}: model failed (${error}) → placeholder`);
    }
  }
  if (!loaded) {
    const box = MeshBuilder.CreateBox(`placeholder_${asset.asset_id}`, { size: 1 }, scene);
    const mat = new StandardMaterial(`placeholderMat_${asset.asset_id}`, scene);
    mat.diffuseColor = Color3.FromHexString(asset.color_override ?? fallbackColor);
    mat.alpha = 0.85;
    box.material = mat;
    box.parent = pivot;
    meshes = [box];
  }
  for (const m of meshes) m.isPickable = false; // picking goes through the handle

  // Normalize (measured with the pivot at the origin), then build the handle around it.
  // Builtin models are authored at real size with a meaningful origin: no rescale, no recenter.
  // Only visible geometry counts: hidden helpers (collision boxes, backdrops, empty nodes
  // with transforms inherited from the file) must not shrink the real object.
  // (The predicate also receives plain transform nodes: only meshes with geometry count.)
  const visible = (m: AbstractMesh) => m instanceof AbstractMesh && m.getTotalVertices() > 0 && m.isVisible && m.isEnabled() && m.visibility > 0;
  const { min, max } = meshes.some(visible) ? pivot.getHierarchyBoundingVectors(true, visible) : pivot.getHierarchyBoundingVectors(true);
  const ext = max.subtract(min);
  if (!builtin) {
    const largest = Math.max(ext.x, ext.y, ext.z) || 1;
    const s = asset.target_size_m / largest;
    pivot.scaling = new Vector3(s, s, s);
    pivot.position = new Vector3((-(min.x + max.x) / 2) * s, -min.y * s, (-(min.z + max.z) / 2) * s);
  }
  pivot.computeWorldMatrix(true);
  const b = meshes.some(visible) ? pivot.getHierarchyBoundingVectors(true, visible) : pivot.getHierarchyBoundingVectors(true);
  // At least 7 cm: small parts (LED, resistors, bolts) must be easy to hit with a controller ray.
  const MIN_GRAB = 0.07;
  const size = {
    width: Math.max(b.max.x - b.min.x, MIN_GRAB),
    height: Math.max(b.max.y - b.min.y, MIN_GRAB),
    depth: Math.max(b.max.z - b.min.z, MIN_GRAB),
  };
  const handle = MeshBuilder.CreateBox(`grab_${asset.asset_id}`, size, scene);
  handle.position = new Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  handle.bakeCurrentTransformIntoVertices(); // origin stays at the model's base point
  handle.visibility = 0; // invisible but pickable
  // Fixed furniture (motor bench) must not intercept rays aimed at objects placed on it.
  handle.isPickable = !asset.fixed || !!asset.clickable;
  handle.enablePointerMoveEvents = true; // Babylon only picks on pointer MOVE for meshes that opt in (hover)
  handle.metadata = { role: "asset", assetId: asset.asset_id };
  pivot.parent = handle;
  handle.position = new Vector3(asset.position.x, asset.position.y, asset.position.z);
  handle.rotation.y = asset.rotation_y;

  const label = makeLabel(scene, asset, handle, b.max.y);
  return { asset, handle, meshes, label, loaded, error, builtin };
}

/**
 * Floating name tag above an asset (billboard, toggled with L).
 * Builtin and converted models are recognizable by their shape: their (smaller)
 * tag only appears on hover, so tags never hide the objects in close-up / VR.
 */
function makeLabel(scene: Scene, asset: SceneAsset, handle: Mesh, height: number): Mesh {
  // Real models (builtin, Sketchfab, converted STL) are recognizable: compact tag, shown on hover.
  // Only placeholder boxes keep a big, always-visible name.
  const small = asset.source !== "placeholder";
  const plane = MeshBuilder.CreatePlane(`label_${asset.asset_id}`, small ? { width: 0.2, height: 0.038 } : { width: 0.42, height: 0.08 }, scene);
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.parent = handle;
  plane.position.y = height + (small ? 0.05 : 0.08);
  plane.isPickable = false;
  const surface = paintMesh(scene, plane, 512, 98, (ctx, w, h) => {
    ctx.fillStyle = "rgba(15,20,30,0.82)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 40px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(wrap(ctx, asset.name, w - 24)[0], w / 2, 64);
  });
  surface.texture.hasAlpha = true;
  if (small) plane.setEnabled(false);
  return plane;
}
