/**
 * Simulation — runs an interactive TP (manifest.simulation):
 * - snaps released objects onto their targets,
 * - shows green markers where the current step expects something,
 * - tracks held / near / state conditions and auto-validates steps,
 * - delegates the physics to a behavior (electrical circuit, belt drive),
 * - reports validations, safety faults and damage to the session (analytics).
 */
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { PlacedAsset } from "../scenes/TPScene";
import { FONT, paintMesh } from "../ui/textCanvas";
import { Gesture, Hand, SimEventKind, TPSession } from "../utils/analytics";
import { ChecklistItem, SimTarget, SimulationSpec, WorldView, allDone, anchoredPosition, distXZ, evaluate, findSnapTarget, nearReached } from "./conditions";
import { Behavior, createBehavior } from "./behaviors";

export type ToastKind = "ok" | "info" | "warn" | "danger";

export interface SimHost {
  session: TPSession;
  /** The checklist of the current step changed (redraw the board). */
  onChecklistChanged(): void;
  /** All conditions of step `index` hold. */
  onStepValidated(index: number, isLast: boolean): void;
  toast(text: string, kind: ToastKind): void;
  refreshShadows(): void;
}

/** Max distance (m) between an object and its target to count as "placed". */
const PLACED_EPS = 0.02;

interface Marker {
  target: SimTarget;
  mesh: Mesh;
  label: Mesh | null;
  mat: StandardMaterial;
}

export class Simulation implements WorldView {
  public readonly flags = new Set<string>();
  public readonly heldSeconds = new Map<string, number>();
  public readonly near = new Set<string>();
  private readonly byId = new Map<string, PlacedAsset>();
  private readonly targets = new Map<string, SimTarget>();
  private readonly markers: Marker[] = [];
  private readonly behavior: Behavior;
  /** Anchored targets (generated TPs): anchor object and its height above its base point. */
  private readonly anchors: { target: SimTarget; asset: PlacedAsset; height: number; mode: "top" | "base" }[] = [];
  /** Where the objects of the current step's "near" conditions were when the step started. */
  private readonly nearStart = new Map<string, { x: number; z: number }>();
  private validatedStep = -1;
  private lastChecklistKey = "";
  private evalTimer = 0;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    public readonly spec: SimulationSpec,
    assets: PlacedAsset[],
    private readonly host: SimHost
  ) {
    for (const a of assets) this.byId.set(a.asset.asset_id, a);
    for (const t of spec.targets) this.targets.set(t.id, t);
    this.behavior = createBehavior(spec.kind, this);
    this.initAnchors();
    this.createMarkers();
    this.recordNearStarts();
    this.updateMarkers();
  }

  /* ---------------------------------------------------------------- queries */

  public get session(): TPSession {
    return this.host.session;
  }

  public get step(): number {
    return this.host.session.step;
  }

  public asset(id: string): PlacedAsset | undefined {
    return this.byId.get(id);
  }

  public target(id: string): SimTarget | undefined {
    return this.targets.get(id);
  }

  /** True once the last step has been validated. */
  public get completed(): boolean {
    return this.validatedStep === this.spec.rules.length - 1;
  }

  /** Is the current step validated? */
  public get stepValidated(): boolean {
    return this.validatedStep === this.step;
  }

  /** Does step `index` have conditions? (false = nothing the engine can check: "non vérifiée") */
  public hasRule(index = this.step): boolean {
    return (this.spec.rules[index]?.length ?? 0) > 0;
  }

  public isPlaced(assetId: string, targetId: string): boolean {
    const a = this.byId.get(assetId);
    const t = this.targets.get(targetId);
    if (!a || !t || !a.handle.isEnabled()) return false;
    const p = a.handle.position;
    return distXZ(p, t.position) < PLACED_EPS && Math.abs(p.y - t.position.y) < PLACED_EPS;
  }

  /** Horizontal distance between an asset and a target point. */
  public distanceTo(assetId: string, targetId: string): number {
    const a = this.byId.get(assetId);
    const t = this.targets.get(targetId);
    return a && t ? distXZ(a.handle.position, t.position) : Infinity;
  }

  /** Checklist of the current step. */
  public checklist(): ChecklistItem[] {
    const rule = this.spec.rules[this.step] ?? [];
    return evaluate(rule, this);
  }

  /* ---------------------------------------------------------------- events */

  /** Object released: snap onto an accepting target, then let the behavior react. */
  public onRelease(a: PlacedAsset): void {
    const t = findSnapTarget(a.asset.asset_id, a.handle.position, this.spec.targets);
    if (t) {
      a.handle.position = new Vector3(t.position.x, t.position.y, t.position.z);
      a.handle.rotationQuaternion = null;
      a.handle.rotation.set(0, t.rotation_y ?? 0, 0);
      this.record("snapped", `${a.asset.asset_id} → ${t.id}`);
      this.host.refreshShadows();
    }
    this.behavior.onRelease?.(a, t);
    this.evaluateNow();
  }

  public onGrabStart(a: PlacedAsset): void {
    this.behavior.onGrabStart?.(a);
  }

  public onClick(a: PlacedAsset): void {
    this.behavior.onClick?.(a);
    this.evaluateNow();
  }

  /** Grab durations feed the "held" (inspection) conditions. */
  public onInteraction(e: { hand: Hand; gesture: Gesture; target: string | null; durationMs: number }): void {
    if (!e.target || e.gesture === "point" || e.gesture === "pinch_middle") return;
    const s = e.durationMs / 1000;
    this.heldSeconds.set(e.target, Math.max(this.heldSeconds.get(e.target) ?? 0, s));
    this.evaluateNow();
  }

  /** The current step changed: per-step latches reset, markers follow. */
  public onStepChanged(): void {
    this.heldSeconds.clear();
    this.near.clear();
    this.recordNearStarts();
    this.lastChecklistKey = "";
    this.updateMarkers();
    this.evaluateNow();
  }

  /* ---------------------------------------------------------------- behavior API */

  public setFlag(key: string, on: boolean): void {
    if (on === this.flags.has(key)) return;
    if (on) this.flags.add(key);
    else this.flags.delete(key);
    this.evaluateNow();
  }

  public latchNear(assetId: string, targetId: string): void {
    this.near.add(`${assetId}@${targetId}`);
  }

  public toast(text: string, kind: ToastKind): void {
    this.host.toast(text, kind);
  }

  public record(kind: SimEventKind, detail: string): void {
    this.host.session.recordSim(kind, detail);
  }

  /** Safety fault: logged (analytics) and shown in red. */
  public violation(detail: string, text: string): void {
    this.record("safety_violation", detail);
    this.toast(`⚠ ${text}`, "danger");
  }

  public damage(detail: string, text: string): void {
    this.record("damage", detail);
    this.toast(`✖ ${text}`, "danger");
  }

  public refreshShadows(): void {
    this.host.refreshShadows();
  }

  /** Per-frame update (behavior physics, marker pulse, periodic evaluation). */
  public tick(dt: number): void {
    this.time += dt;
    this.updateAnchors();
    this.checkNear();
    this.behavior.update(dt);
    const pulse = 0.3 + 0.2 * Math.sin(this.time * 4);
    for (const m of this.markers) m.mat.alpha = pulse;
    this.evalTimer += dt;
    if (this.evalTimer > 0.25) {
      this.evalTimer = 0;
      this.evaluateNow();
    }
  }

  /** Debug / tests: puts an asset somewhere and releases it (same path as a real drop). */
  public debugRelease(assetId: string, x: number, y: number, z: number): void {
    const a = this.byId.get(assetId);
    if (!a) throw new Error(`unknown asset ${assetId}`);
    a.handle.position = new Vector3(x, y, z);
    this.onRelease(a);
  }

  /* ---------------------------------------------------------------- internals */

  /** Anchored targets: the height of each anchor object is measured once on its loaded model. */
  private initAnchors(): void {
    for (const t of this.spec.targets) {
      const asset = t.anchor ? this.byId.get(t.anchor.asset) : undefined;
      if (!t.anchor || !asset) continue;
      let top = -Infinity;
      for (const m of asset.meshes) {
        m.computeWorldMatrix(true);
        top = Math.max(top, m.getBoundingInfo().boundingBox.maximumWorld.y);
      }
      const height = Number.isFinite(top) ? Math.max(0, top - asset.handle.position.y) : 0;
      this.anchors.push({ target: t, asset, height, mode: t.anchor.mode });
    }
    this.updateAnchors();
  }

  /** Anchored targets (and their markers) follow their object when it is moved. */
  private updateAnchors(): void {
    for (const a of this.anchors) {
      const p = anchoredPosition(a.asset.handle.position, a.height, a.mode);
      const t = a.target;
      if (Math.abs(p.x - t.position.x) + Math.abs(p.y - t.position.y) + Math.abs(p.z - t.position.z) < 1e-4) continue;
      t.position = p;
      const m = this.markers.find((x) => x.target === t);
      if (m) {
        m.mesh.position.set(p.x, p.y + 0.003, p.z);
        m.label?.position.set(p.x, p.y + 0.07, p.z);
      }
    }
  }

  private recordNearStarts(): void {
    this.nearStart.clear();
    for (const c of this.spec.rules[this.step] ?? []) {
      if (c.type !== "near") continue;
      const a = this.byId.get(c.asset);
      if (a) this.nearStart.set(c.asset, { x: a.handle.position.x, z: a.handle.position.z });
    }
  }

  /** Generic "near": the object was brought (held or dropped) close enough to its target during the step. */
  private checkNear(): void {
    for (const c of this.spec.rules[this.step] ?? []) {
      if (c.type !== "near" || this.near.has(`${c.asset}@${c.target}`)) continue;
      const a = this.byId.get(c.asset);
      const t = this.targets.get(c.target);
      const start = this.nearStart.get(c.asset);
      if (!a || !t || !start || !a.handle.isEnabled()) continue;
      if (nearReached(a.handle.position, start, t.position, c.distance)) {
        this.latchNear(c.asset, c.target);
        this.record("near", `${c.asset} → ${c.target}`);
        this.evaluateNow();
      }
    }
  }

  private evaluateNow(): void {
    const items = this.checklist();
    const key = items.map((i) => (i.done ? "1" : "0")).join("");
    if (key !== this.lastChecklistKey) {
      this.lastChecklistKey = key;
      this.updateMarkers();
      this.host.onChecklistChanged();
    }
    if (allDone(items) && this.validatedStep !== this.step && !this.host.session.finished) {
      this.validatedStep = this.step;
      this.record("step_validated", `étape ${this.step + 1}`);
      this.host.onStepValidated(this.step, this.step === this.spec.rules.length - 1);
    }
  }

  private createMarkers(): void {
    for (const t of this.spec.targets) {
      if (t.marker === "none") continue;
      const mat = new StandardMaterial(`marker_${t.id}`, this.scene);
      mat.emissiveColor = new Color3(0.2, 0.95, 0.45);
      mat.disableLighting = true;
      mat.alpha = 0.4;
      mat.backFaceCulling = false;
      let mesh: Mesh;
      if (t.marker === "ring_z") {
        mesh = MeshBuilder.CreateTorus(`marker_${t.id}`, { diameter: 0.13, thickness: 0.008, tessellation: 32 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position = new Vector3(t.position.x, t.position.y + 0.06, t.position.z + 0.02);
      } else {
        const r = Math.max(0.025, Math.min(t.radius * 0.7, 0.1));
        mesh = MeshBuilder.CreateDisc(`marker_${t.id}`, { radius: r, tessellation: 32 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position = new Vector3(t.position.x, t.position.y + 0.003, t.position.z);
      }
      mesh.material = mat;
      mesh.isPickable = false;
      let label: Mesh | null = null;
      if (t.label) {
        label = MeshBuilder.CreatePlane(`marker_label_${t.id}`, { width: 0.26, height: 0.045 }, this.scene);
        label.billboardMode = Mesh.BILLBOARDMODE_ALL;
        label.position = new Vector3(t.position.x, t.position.y + (t.marker === "ring_z" ? 0.16 : 0.07), t.position.z);
        label.isPickable = false;
        const s = paintMesh(this.scene, label, 512, 88, (ctx, w, h) => {
          ctx.fillStyle = "rgba(20,110,60,0.88)";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#fff";
          ctx.font = `bold 38px ${FONT}`;
          ctx.textAlign = "center";
          ctx.fillText(`▼ ${t.label}`, w / 2, 58);
        });
        s.texture.hasAlpha = true;
      }
      this.markers.push({ target: t, mesh, label, mat });
    }
  }

  /** A marker is visible while the current step still needs its target. */
  private updateMarkers(): void {
    const rule = this.spec.rules[this.step] ?? [];
    const items = evaluate(rule, this);
    const pending = new Set<string>();
    rule.forEach((c, i) => {
      if (items[i].done) return;
      if (c.type === "placed" || c.type === "near") pending.add(c.target);
      if (c.type === "state") {
        const t = this.behavior.stateTargets[c.key];
        if (t) pending.add(t);
      }
    });
    for (const m of this.markers) {
      const show = pending.has(m.target.id) && !this.host.session.finished;
      m.mesh.setEnabled(show);
      m.label?.setEnabled(show);
    }
  }
}
