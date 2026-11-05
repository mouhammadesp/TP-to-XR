/**
 * InspectView — close-up "magnifier" for small objects.
 *
 * Objects keep their real size on the bench (proportions are never altered); for a
 * closer look, a magnified copy (instances: no extra geometry or material) floats
 * ≈ 40 cm in front of the eyes, slowly turning, with a tag giving the zoom and the
 * real size. Toggled with the thumbstick press (VR) or the I key (desktop).
 */
import { AbstractMesh, Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { PlacedAsset } from "./TPScene";
import { FONT, paintMesh } from "../ui/textCanvas";

/** Apparent size of the magnified copy (m) and zoom bounds. */
const TARGET_M = 0.22;
const ZOOM = { min: 1, max: 6 };
const DISTANCE_M = 0.42;
const SPIN_RAD_S = 0.6;

export class InspectView {
  private anchor: TransformNode | null = null;
  private tag: Mesh | null = null;
  private asset: PlacedAsset | null = null;
  /** Zoom of the current copy (tests). */
  public zoom = 1;

  constructor(private readonly scene: Scene) {
    scene.onBeforeRenderObservable.add(() => this.follow());
  }

  public get shown(): PlacedAsset | null {
    return this.asset;
  }

  /** Shows `a` magnified, or hides the view if it is already shown (or `a` is null). @returns true if shown */
  public toggle(a: PlacedAsset | null): boolean {
    const same = a && a === this.asset;
    this.hide();
    if (!a || same || !a.meshes.length) return false;
    this.show(a);
    return true;
  }

  public hide(): void {
    this.anchor?.dispose(false, false);
    this.tag?.dispose(false, true);
    this.anchor = null;
    this.tag = null;
    this.asset = null;
  }

  private show(a: PlacedAsset): void {
    const pivot = a.handle.getChildren().find((n): n is TransformNode => n instanceof TransformNode);
    if (!pivot) return;
    // Real size of the object as placed (largest dimension of its visible geometry).
    const real = pivot.getHierarchyBoundingVectors(true, (m) => m instanceof AbstractMesh && m.isVisible && m.getTotalVertices() > 0);
    const ext = real.max.subtract(real.min);
    const largest = Math.max(ext.x, ext.y, ext.z) || 0.1;
    this.zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, TARGET_M / largest));

    const anchor = new TransformNode("inspect_anchor", this.scene);
    const spin = new TransformNode("inspect_spin", this.scene);
    spin.parent = anchor;
    const copy = pivot.instantiateHierarchy(spin, { doNotInstantiate: false });
    if (!copy) {
      anchor.dispose();
      return;
    }
    // Copy in the object's own orientation, centered on the anchor, magnified.
    copy.parent = spin;
    copy.position = pivot.position.clone();
    copy.rotationQuaternion = null;
    copy.rotation = pivot.rotation.clone();
    copy.scaling = pivot.scaling.clone();
    // Center of the object in the handle's frame (the handle may be turned).
    const centerLocal = Vector3.TransformCoordinates(real.min.add(real.max).scale(0.5), a.handle.computeWorldMatrix(true).clone().invert());
    copy.position.subtractInPlace(centerLocal);
    spin.scaling.setAll(this.zoom);
    for (const m of copy.getChildMeshes()) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true; // never culled while it moves with the head
    }

    const tag = MeshBuilder.CreatePlane("inspect_tag", { width: 0.2, height: 0.034 }, this.scene);
    tag.parent = anchor;
    tag.position.y = -(TARGET_M / 2 + 0.06);
    tag.billboardMode = Mesh.BILLBOARDMODE_ALL;
    tag.isPickable = false;
    tag.renderingGroupId = 1; // drawn over the turning copy: always readable
    const text = `🔍 ×${this.zoom.toFixed(1).replace(".", ",")} · ${a.asset.name} · ${fmt(largest)} réels`;
    const s = paintMesh(this.scene, tag, 640, 108, (ctx, w, h) => {
      ctx.fillStyle = "rgba(15,20,30,0.85)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#fff";
      ctx.font = `bold 40px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(text, w / 2, 68, w - 24);
    });
    s.texture.hasAlpha = true;

    this.anchor = anchor;
    this.tag = tag;
    this.asset = a;
    this.follow();
  }

  /** Keeps the copy in front of the eyes (desktop camera or headset), slowly turning. */
  private follow(): void {
    const cam = this.scene.activeCamera;
    if (!this.anchor || !cam) return;
    const fwd = cam.getDirection(Vector3.Forward());
    this.anchor.position = cam.globalPosition.add(fwd.scale(DISTANCE_M)).add(new Vector3(0, -0.03, 0));
    const spin = this.anchor.getChildren()[0] as TransformNode | undefined;
    if (spin) spin.rotation.y += (this.scene.getEngine().getDeltaTime() / 1000) * SPIN_RAD_S;
  }
}

function fmt(m: number): string {
  return m < 0.1 ? `${(m * 1000).toFixed(0)} mm` : `${(m * 100).toFixed(1).replace(".", ",")} cm`;
}
