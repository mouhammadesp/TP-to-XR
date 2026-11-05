/**
 * InteractionHandler — every way the student acts on the scene.
 *
 * - Hover (mouse / controller ray / hand ray) → object glows; hovers ≥ 300 ms are logged as "point".
 * - Desktop: click-drag an object (SixDofDragBehavior).
 * - VR (see xrGrab.ts): trigger / pinch on an object pointed at with the ray → it flies
 *   into the hand ("distance grab"); grip button → near grab (object within 15 cm) or the
 *   object under the ray. While held it follows the hand 1:1 — no more reaching behind you.
 * - On release the object stays upright and drops onto the surface below it
 *   (workbench, shelf, floor), or snaps onto a target (interactive TPs).
 * - 3D buttons (◀ / ▶ / Crédits) on the workbench, keyboard N/P/C (desktop debug).
 * - Quest 3 hand tracking: thumb + MIDDLE finger pinch → right hand = next step,
 *   left hand = previous step (the index pinch stays the system "select").
 * - Controllers (Quest / Pico): A or X = next step, B or Y = previous step,
 *   left stick = walk (direction of gaze), right stick = turn. The student stays inside the room.
 */
import {
  AbstractMesh,
  Color3,
  Mesh,
  PointerEventTypes,
  PointerInfo,
  Quaternion,
  Ray,
  Scene,
  SixDofDragBehavior,
  Vector3,
  WebXRDefaultExperience,
  WebXRInputSource,
  WebXRFeatureName,
  WebXRHand,
  WebXRHandJoint,
  WebXRHandTracking,
  WebXRState,
} from "@babylonjs/core";
import { Gesture, Hand } from "../utils/analytics";
import { Box2, SnapTurn, Vec2, WALK, applyDeadzone, approach, desiredVelocity, resolveCollisions } from "./locomotion";
import { PinchDetector } from "../utils/gestures";
import { PlacedAsset } from "./TPScene";
import { GrabOptions, NEAR_GRAB_M, Pose, XRGrab, grabOptionsFromQuery } from "./xrGrab";
import { ButtonAction } from "../ui/StepPanel";

export interface InteractionCallbacks {
  onButton(action: ButtonAction, via: "button" | "keyboard"): void;
  onInteraction(e: { hand: Hand; gesture: Gesture; target: string | null; durationMs: number }): void;
  onGestureStep(direction: 1 | -1, hand: Hand): void;
  onObjectMoved(): void;
  /** An object was released (after settling): the simulation may snap it onto a target. */
  onObjectReleased(asset: PlacedAsset): void;
  /** A grab starts on an object (safety checks: e.g. touching the belt while energized). */
  onGrabStart(asset: PlacedAsset): void;
  /** Click / trigger / pinch on a clickable fixed object (switch, isolator). */
  onAssetClick(asset: PlacedAsset): void;
  onXRStateChange(inXR: boolean): void;
  /** A/X (+1) or B/Y (-1) pressed on a controller. */
  onControllerStep(direction: 1 | -1, hand: Hand): void;
  onHandTracking(): void;
  /** Object name tags shown (L): an aid, recorded in the session. */
  onLabelsShown?(): void;
  /** Close-up inspection asked (thumbstick press / I) for this object (held, aimed at, or last touched). */
  onInspect?(asset: PlacedAsset | null): void;
}

const HOVER_LOG_MS = 300;
const HIGHLIGHT = new Color3(0.25, 0.75, 1);
const ROOM_HALF = { x: 9.7, z: 7.2 };
/** Walkable room (inner walls). */
const ROOM: Box2 = { minX: -9.9, maxX: 9.9, minZ: -7.4, maxZ: 7.4 };

interface ActiveGrab {
  asset: PlacedAsset;
  start: number;
  hand: Hand;
  gesture: Gesture;
}

/** An object held in VR by one controller / hand. */
interface HeldObject {
  asset: PlacedAsset;
  controller: WebXRInputSource;
  grab: XRGrab;
  start: number;
  /** Object height (m): the hold keeps its base above the surface under its center. */
  height: number;
  /** Pointer id when started by trigger / pinch (released on pointer up), null for the grip button. */
  pointerId: number | null;
}

export class InteractionHandler {
  private readonly byHandle = new Map<AbstractMesh, PlacedAsset>();
  private readonly grabs = new Map<number, ActiveGrab>();
  private hovered: PlacedAsset | null = null;
  /** Last object aimed at or held (target of the close-up inspection). */
  private lastTouched: PlacedAsset | null = null;
  /** Label state before the hover forced it visible. */
  private hoveredLabelWasOn = false;
  private hoverStart = 0;
  private xr: WebXRDefaultExperience | null = null;
  private readonly hands = new Map<WebXRHand, PinchDetector>();
  private readonly dragBehaviors = new Map<PlacedAsset, SixDofDragBehavior>();
  /** Objects held in VR, by controller id. */
  private readonly held = new Map<string, HeldObject>();
  /**
   * Hold offset / smoothing, from ?grab_offset=…&grab_smooth=… — also editable live
   * in the headset devtools (window.__tpxrGrab.holdOffsetM = 0.15): applies to the next grab.
   */
  private readonly grabOptions: GrabOptions = grabOptionsFromQuery(location.search);
  /** Bench / shelf boards / floor: a held object never goes through them. */
  private surfaces: AbstractMesh[] = [];

  constructor(
    private readonly scene: Scene,
    assets: PlacedAsset[],
    private readonly buttons: Mesh[],
    private readonly cb: InteractionCallbacks
  ) {
    for (const a of assets) {
      this.byHandle.set(a.handle, a);
      if (!a.asset.fixed) this.makeDraggable(a);
    }
    scene.onPointerObservable.add((pi) => this.onPointer(pi));
  }

  /**
   * Enables desktop keyboard shortcuts: N / → next, P / ← previous, C credits,
   * L labels, V placement zones (debug).
   */
  public enableKeyboard(labels: Mesh[]): void {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === "n" || e.key === "ArrowRight") this.cb.onButton("next", "keyboard");
      else if (k === "p" || e.key === "ArrowLeft") this.cb.onButton("prev", "keyboard");
      else if (k === "c") this.cb.onButton("credits", "keyboard");
      else if (k === "i") this.cb.onInspect?.(this.hovered ?? this.lastTouched);
      else if (k === "l") {
        const show = !labels.some((m) => m.isEnabled());
        labels.forEach((m) => m.setEnabled(show));
        if (show) this.cb.onLabelsShown?.();
      }
      else if (k === "v") {
        for (const m of this.scene.meshes) {
          if (m.metadata?.role === "placement_zone") m.isVisible = !m.isVisible;
        }
      }
    });
  }

  /**
   * Starts WebXR (immersive-vr) with teleportation on the floor and optional
   * hand tracking. Returns null if WebXR is unavailable.
   */
  public async enableXR(floor: AbstractMesh | null): Promise<WebXRDefaultExperience | null> {
    if (!navigator.xr) return null;
    const supported = await Promise.race([
      navigator.xr.isSessionSupported("immersive-vr").catch(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
    ]);
    if (!supported) return null;

    const xr = await this.scene.createDefaultXRExperienceAsync({
      floorMeshes: floor ? [floor] : [],
      // The thumbsticks are used for smooth locomotion (below), which conflicts with teleportation.
      disableTeleportation: true,
    });
    this.xr = xr;
    this.enableLocomotion(xr);
    this.enableControllerButtons(xr);
    this.enableXRGrab(xr);
    xr.baseExperience.onStateChangedObservable.add((state) => {
      // Ray dragging is for the mouse only: in VR objects are held in the hand.
      for (const [a, drag] of this.dragBehaviors) {
        if (state === WebXRState.IN_XR) a.handle.removeBehavior(drag);
        if (state === WebXRState.NOT_IN_XR && !a.handle.behaviors.includes(drag)) a.handle.addBehavior(drag);
      }
      if (state === WebXRState.NOT_IN_XR) for (const id of [...this.held.keys()]) this.release(id);
      if (state === WebXRState.IN_XR) {
        const layer = xr.baseExperience.sessionManager.session?.renderState.baseLayer as (XRWebGLLayer & { fixedFoveation?: number }) | undefined;
        if (layer && "fixedFoveation" in layer) {
          layer.fixedFoveation = 0.5;
          console.log("👁️ Fixed foveated rendering: 0.5");
        }
        this.cb.onXRStateChange(true);
      }
      if (state === WebXRState.NOT_IN_XR) this.cb.onXRStateChange(false);
    });

    try {
      // required = false: the session still starts on devices without hand tracking.
      const ht = xr.baseExperience.featuresManager.enableFeature(
        WebXRFeatureName.HAND_TRACKING,
        "latest",
        { xrInput: xr.input },
        true,
        false
      ) as WebXRHandTracking;
      ht.onHandAddedObservable.add((hand) => {
        this.hands.set(hand, new PinchDetector());
        this.cb.onHandTracking();
      });
      ht.onHandRemovedObservable.add((hand) => this.hands.delete(hand));
      this.scene.onBeforeRenderObservable.add(() => this.checkMiddlePinch());
      console.log("🖐️ Hand tracking enabled");
    } catch (err) {
      console.warn("⚠️ Hand tracking unavailable", err);
    }
    return xr;
  }

  /**
   * Short controller vibration in VR (when the controller supports it): one light
   * pulse for a validated step, two firmer ones for an incorrect action.
   */
  public haptic(pattern: "success" | "error"): void {
    const xr = this.xr;
    if (xr?.baseExperience.state !== WebXRState.IN_XR) return;
    const pulses: [number, number][] = pattern === "success" ? [[0.35, 70]] : [[0.6, 90], [0.6, 90]];
    pulses.forEach(([value, ms], i) =>
      setTimeout(() => {
        for (const c of xr.input.controllers) {
          if (c.inputSource.hand) continue;
          void c.motionController?.pulse(value, ms).catch(() => false);
        }
      }, i * 170)
    );
  }

  /** Leaves immersive mode (before navigating back to the menu). */
  public async exitXR(): Promise<void> {
    if (this.xr?.baseExperience.state === WebXRState.IN_XR) await this.xr.baseExperience.exitXRAsync();
  }

  /**
   * Locomotion (see locomotion.ts): left stick walks horizontally with smooth
   * acceleration, right stick snap-turns 30°, the student cannot leave the room
   * nor walk through the furniture. Replaces Babylon's MOVEMENT feature, which
   * follows the head pitch (looking down + stick = sinking through the floor).
   */
  private enableLocomotion(xr: WebXRDefaultExperience): void {
    let velocity: Vec2 = { x: 0, z: 0 };
    const snap = new SnapTurn();
    const obstacles = this.furnitureBoxes();
    this.scene.onBeforeRenderObservable.add(() => {
      if (xr.baseExperience.state !== WebXRState.IN_XR) {
        velocity = { x: 0, z: 0 };
        return;
      }
      const cam = xr.baseExperience.camera;
      const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
      let move: Vec2 = { x: 0, z: 0 };
      let turn = 0;
      for (const ctrl of xr.input.controllers) {
        const pad = ctrl.inputSource.gamepad;
        if (!pad || ctrl.inputSource.hand) continue;
        // xr-standard mapping: thumbstick on axes 2/3 (touchpad, if any, on 0/1).
        const ax = pad.axes.length >= 4 ? pad.axes[2] : pad.axes[0] ?? 0;
        const ay = pad.axes.length >= 4 ? pad.axes[3] : pad.axes[1] ?? 0;
        if (ctrl.inputSource.handedness === "left") move = applyDeadzone(ax, ay);
        if (ctrl.inputSource.handedness === "right") turn = snap.update(ax);
      }
      const dir = cam.getDirection(Vector3.Forward());
      velocity = approach(velocity, desiredVelocity(move, { x: dir.x, z: dir.z }), dt);
      if (velocity.x !== 0 || velocity.z !== 0 || turn !== 0) {
        const next = resolveCollisions({ x: cam.position.x + velocity.x * dt, z: cam.position.z + velocity.z * dt }, ROOM, obstacles);
        cam.position.x = next.x;
        cam.position.z = next.z; // Y is never touched: head tracking keeps the real height
        if (turn !== 0) {
          const q = Quaternion.FromEulerAngles(0, turn * WALK.snapAngle, 0);
          cam.rotationQuaternion = q.multiply(cam.rotationQuaternion ?? Quaternion.Identity());
        }
      }
    });
  }

  /** Footprints of the fixed furniture (from the template meshes), for collisions. */
  private furnitureBoxes(): Box2[] {
    const boxes: Box2[] = [];
    for (const name of ["workbench_top", "cabinet", "shelf_left_shelf_0", "shelf_right_shelf_0", "monitor_frame", "kakemono_base"]) {
      const m = this.scene.getMeshByName(name);
      if (!m) continue;
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      boxes.push({ minX: b.minimumWorld.x, maxX: b.maximumWorld.x, minZ: b.minimumWorld.z, maxZ: b.maximumWorld.z });
    }
    return boxes;
  }

  /**
   * A/X → next step, B/Y → previous step. Read from the standard gamepad
   * mapping (buttons[4] = A/X, buttons[5] = B/Y), which works for Quest and
   * Pico controllers even when Babylon has no specific profile for them.
   */
  private enableControllerButtons(xr: WebXRDefaultExperience): void {
    const previous = new Map<string, boolean[]>();
    this.scene.onBeforeRenderObservable.add(() => {
      if (xr.baseExperience.state !== WebXRState.IN_XR) return;
      for (const ctrl of xr.input.controllers) {
        const pad = ctrl.inputSource.gamepad;
        if (!pad || ctrl.inputSource.hand) continue;
        // 4 = A/X, 5 = B/Y, 3 = thumbstick press (close-up inspection).
        const now = [4, 5, 3].map((i) => !!pad.buttons[i]?.pressed);
        const before = previous.get(ctrl.uniqueId) ?? [false, false, false];
        previous.set(ctrl.uniqueId, now);
        const hand = toHand(ctrl.inputSource.handedness);
        if (now[0] && !before[0]) this.cb.onControllerStep(1, hand);
        if (now[1] && !before[1]) this.cb.onControllerStep(-1, hand);
        if (now[2] && !before[2]) this.cb.onInspect?.(this.held.get(ctrl.uniqueId)?.asset ?? this.hovered ?? this.lastTouched);
      }
    });
  }

  /**
   * VR grab: objects follow the hand (see xrGrab.ts). Trigger / pinch starts a grab
   * through pointer events (onPointer); the GRIP button is polled here.
   */
  private enableXRGrab(xr: WebXRDefaultExperience): void {
    const gripWas = new Map<string, boolean>();
    this.surfaces = this.scene.meshes.filter((m) => m.metadata?.role === "surface" || m.metadata?.role === "floor");
    (window as unknown as { __tpxrGrab?: GrabOptions }).__tpxrGrab = this.grabOptions;
    this.scene.onBeforeRenderObservable.add(() => {
      if (xr.baseExperience.state !== WebXRState.IN_XR) return;
      const dt = Math.min(0.05, this.scene.getEngine().getDeltaTime() / 1000);
      // Grip button (controllers only): press = grab, release = drop.
      for (const ctrl of xr.input.controllers) {
        const pad = ctrl.inputSource.gamepad;
        if (!pad || ctrl.inputSource.hand) continue;
        const pressed = !!pad.buttons[1]?.pressed;
        const was = gripWas.get(ctrl.uniqueId) ?? false;
        gripWas.set(ctrl.uniqueId, pressed);
        if (pressed && !was && !this.held.has(ctrl.uniqueId)) {
          const target = this.objectForGrip(ctrl);
          if (target) {
            this.cb.onGrabStart(target);
            this.startHold(target, ctrl, null);
          }
        }
        if (!pressed && was) {
          const h = this.held.get(ctrl.uniqueId);
          if (h && h.pointerId === null) {
            this.cb.onInteraction({ hand: toHand(ctrl.inputSource.handedness), gesture: "grab", target: h.asset.asset.asset_id, durationMs: performance.now() - h.start });
            this.release(ctrl.uniqueId);
          }
        }
      }
      // Held objects follow their hand.
      for (const h of this.held.values()) {
        const p = h.grab.update(anchorPose(h.controller), dt);
        this.keepAboveSurface(p.position, h.height);
        h.asset.handle.position.copyFrom(p.position);
        h.asset.handle.rotationQuaternion = p.rotation;
      }
      if (this.held.size) this.cb.onObjectMoved();
    });
  }

  /** Object for a grip press: the nearest one within reach, else the one under the ray. */
  private objectForGrip(ctrl: WebXRInputSource): PlacedAsset | null {
    const hand = anchorPose(ctrl).position;
    let best: { a: PlacedAsset; d: number } | null = null;
    for (const a of this.byHandle.values()) {
      if (a.asset.fixed || !a.handle.isPickable || !a.handle.isEnabled()) continue;
      const d = Vector3.Distance(a.handle.getBoundingInfo().boundingBox.centerWorld, hand);
      if (d <= NEAR_GRAB_M && (!best || d < best.d)) best = { a, d };
    }
    if (best) return best.a;
    const ray = new Ray(Vector3.Zero(), Vector3.Forward(), 20);
    ctrl.getWorldPointerRayToRef(ray);
    const hit = this.scene.pickWithRay(ray, (m) => {
      const a = this.byHandle.get(m);
      return !!a && !a.asset.fixed && m.isPickable && m.isEnabled();
    });
    return hit?.pickedMesh ? this.byHandle.get(hit.pickedMesh) ?? null : null;
  }

  /** Starts holding `a` in the hand of `ctrl` (taking it from the other hand if needed). */
  private startHold(a: PlacedAsset, ctrl: WebXRInputSource, pointerId: number | null): void {
    for (const [id, h] of this.held) if (h.asset === a) this.held.delete(id);
    this.lastTouched = a;
    const handle = a.handle;
    const rotation = handle.rotationQuaternion?.clone() ?? Quaternion.FromEulerAngles(handle.rotation.x, handle.rotation.y, handle.rotation.z);
    const height = handle.getBoundingInfo().boundingBox.extendSize.y * 2;
    const grab = new XRGrab({ position: handle.position.clone(), rotation }, anchorPose(ctrl), height, this.grabOptions);
    this.held.set(ctrl.uniqueId, { asset: a, controller: ctrl, grab, start: performance.now(), height, pointerId });
  }

  /**
   * While held, the object's base does not sink into the bench / shelf / floor under
   * it: the ray starts at the object's CENTER, so an object carried under a shelf
   * board is not pushed on top of it, and one pushed deep on purpose can go under.
   */
  private keepAboveSurface(base: Vector3, height: number): void {
    const ray = new Ray(base.add(new Vector3(0, Math.max(height / 2, 0.03), 0)), Vector3.Down(), 1);
    let top = -Infinity;
    for (const m of this.surfaces) {
      if (!m.isEnabled()) continue;
      const hit = ray.intersectsMesh(m as Mesh);
      if (hit.hit && hit.pickedPoint) top = Math.max(top, hit.pickedPoint.y);
    }
    if (base.y < top) base.y = top;
  }

  /** Drops what controller `id` holds: upright, onto the surface below (or a snap target). */
  private release(id: string): void {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    this.settle(h.asset.handle);
    this.cb.onObjectReleased(h.asset);
    this.cb.onObjectMoved();
  }

  /** Thumb + middle finger pinch → step navigation (right = next, left = previous). */
  private checkMiddlePinch(): void {
    const now = performance.now();
    for (const [hand, detector] of this.hands) {
      const thumb = hand.getJointMesh(WebXRHandJoint.THUMB_TIP);
      const middle = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_TIP);
      if (!thumb || !middle) continue;
      const d = Vector3.Distance(thumb.getAbsolutePosition(), middle.getAbsolutePosition());
      const ev = detector.update(d, now);
      if (ev?.type !== "start") continue;
      const side = toHand(hand.xrController.inputSource.handedness);
      this.cb.onInteraction({ hand: side, gesture: "pinch_middle", target: null, durationMs: 0 });
      this.cb.onGestureStep(side === "left" ? -1 : 1, side);
    }
  }

  /** Attaches a 6-DoF drag behavior (works with mouse, controllers and hands). */
  private makeDraggable(a: PlacedAsset): void {
    const drag = new SixDofDragBehavior();
    drag.rotateDraggedObject = true;
    drag.dragDeltaRatio = 1;
    a.handle.addBehavior(drag);
    this.dragBehaviors.set(a, drag);
    drag.onDragObservable.add(() => this.cb.onObjectMoved());
    drag.onDragEndObservable.add(() => {
      this.settle(a.handle);
      this.cb.onObjectReleased(a);
      this.cb.onObjectMoved();
    });
  }

  /**
   * Keeps the object upright (yaw only), inside the room, and drops it onto
   * the first surface below its base.
   */
  private settle(handle: Mesh): void {
    const yaw = handle.rotationQuaternion ? handle.rotationQuaternion.toEulerAngles().y : handle.rotation.y;
    handle.rotationQuaternion = Quaternion.FromEulerAngles(0, yaw, 0);
    handle.position.x = Math.max(-ROOM_HALF.x, Math.min(ROOM_HALF.x, handle.position.x));
    handle.position.z = Math.max(-ROOM_HALF.z, Math.min(ROOM_HALF.z, handle.position.z));
    // Start 25 cm above the base: an object released slightly INSIDE a slab (6 cm top)
    // must land on its top face, not on its underside. Less than the 70 cm between stacked surfaces.
    const origin = handle.position.add(new Vector3(0, 0.25, 0));
    const hit = this.scene.pickWithRay(new Ray(origin, Vector3.Down(), 10), (m) => {
      const role = m.metadata?.role;
      return (role === "surface" || role === "floor") && m.isEnabled();
    });
    handle.position.y = hit?.pickedPoint ? hit.pickedPoint.y : 0;
  }

  /** Pointer routing: hover highlight, button clicks, grab logging. */
  private onPointer(pi: PointerInfo): void {
    const pointerId = (pi.event as PointerEvent).pointerId ?? 0;
    const picked = pi.pickInfo?.hit ? pi.pickInfo.pickedMesh : null;

    switch (pi.type) {
      case PointerEventTypes.POINTERMOVE: {
        this.setHover(picked ? this.byHandle.get(picked) ?? null : null);
        break;
      }
      case PointerEventTypes.POINTERDOWN: {
        if (picked && this.buttons.includes(picked as Mesh)) {
          this.cb.onButton((picked.metadata as { action: ButtonAction }).action, "button");
          break;
        }
        const asset = picked ? this.byHandle.get(picked) : undefined;
        if (asset?.asset.clickable) {
          this.cb.onAssetClick(asset);
          break;
        }
        if (asset) {
          this.cb.onGrabStart(asset);
          const src = this.describePointer(pointerId);
          this.grabs.set(pointerId, { asset, start: performance.now(), ...src });
          this.setHover(asset);
          const ctrl = this.xrController(pointerId);
          if (ctrl && !asset.asset.fixed) this.startHold(asset, ctrl, pointerId);
        }
        break;
      }
      case PointerEventTypes.POINTERUP: {
        for (const [id, h] of this.held) if (h.pointerId === pointerId) this.release(id);
        const g = this.grabs.get(pointerId);
        if (g) {
          this.grabs.delete(pointerId);
          this.cb.onInteraction({
            hand: g.hand,
            gesture: g.gesture,
            target: g.asset.asset.asset_id,
            durationMs: performance.now() - g.start,
          });
        }
        break;
      }
    }
  }

  /** Highlights the hovered asset; logs the previous hover if it was long enough. */
  private setHover(asset: PlacedAsset | null): void {
    if (asset === this.hovered) return;
    const now = performance.now();
    if (this.hovered) {
      for (const m of this.hovered.meshes) m.renderOverlay = false;
      this.hovered.label.setEnabled(this.hoveredLabelWasOn);
      if (now - this.hoverStart >= HOVER_LOG_MS) {
        this.cb.onInteraction({
          hand: this.xr?.baseExperience.state === WebXRState.IN_XR ? "right" : "none",
          gesture: "point",
          target: this.hovered.asset.asset_id,
          durationMs: now - this.hoverStart,
        });
      }
    }
    this.hovered = asset;
    if (asset) this.lastTouched = asset;
    this.hoverStart = now;
    if (asset) {
      this.hoveredLabelWasOn = asset.label.isEnabled();
      asset.label.setEnabled(true); // name shown while pointed at
      for (const m of asset.meshes) {
        m.overlayColor = HIGHLIGHT;
        m.overlayAlpha = 0.3;
        m.renderOverlay = true;
      }
    }
  }

  /** XR controller (or hand) behind a pointer event, when in immersive mode. */
  private xrController(pointerId: number): WebXRInputSource | null {
    if (this.xr?.baseExperience.state !== WebXRState.IN_XR) return null;
    return this.xr.pointerSelection.getXRControllerByPointerId(pointerId) ?? null;
  }

  /** Which hand / input produced a pointer event. */
  private describePointer(pointerId: number): { hand: Hand; gesture: Gesture } {
    const inXR = this.xr?.baseExperience.state === WebXRState.IN_XR;
    if (!inXR) return { hand: "none", gesture: "mouse" };
    const controller = this.xr?.pointerSelection.getXRControllerByPointerId(pointerId);
    if (!controller) return { hand: "none", gesture: "grab" }; // e.g. near-interaction pointer
    const src = controller.inputSource;
    return { hand: toHand(src.handedness), gesture: src.hand ? "pinch" : "grab" };
  }
}

/** World pose of the hand: grip space if available (held objects sit in the palm), else the pointer. */
function anchorPose(ctrl: WebXRInputSource): Pose {
  const node = ctrl.grip ?? ctrl.pointer;
  node.computeWorldMatrix(true);
  return { position: node.absolutePosition.clone(), rotation: node.absoluteRotationQuaternion.clone() };
}

function toHand(h: XRHandedness): Hand {
  return h === "left" ? "left" : h === "right" ? "right" : "none";
}
