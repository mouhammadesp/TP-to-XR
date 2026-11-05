/**
 * VR grab, like native Quest / Pico apps (replaces ray dragging in immersive mode):
 *
 * - The held object is carried slightly IN FRONT of the controller (hold offset,
 *   default 12 cm along the grip's forward axis, configurable): easier to see and
 *   to put down than an object stuck in the palm. Its orientation at the moment of
 *   the grab is kept (no flip), then it follows the wrist.
 * - NEAR grab (controller within 15 cm of the object): the object slides to the
 *   hold point in 0.12 s. With hold offset 0, it sticks exactly where it was taken.
 * - DISTANCE grab (pointing with the ray): the object flies to the hold point in
 *   0.2 s ("force grab").
 * - Tracking: adaptive low-pass ("One Euro" filter) — steady when the hand is
 *   still (no tremor), near-instant when it moves (no perceptible lag).
 *
 * All the math is done with world matrices (child = local × anchor, Babylon's
 * row-vector convention), so rotation orders cannot be mixed up.
 */
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Below this distance (m) between hand and object, the grab is "near". */
export const NEAR_GRAB_M = 0.15;
/** Duration of the flight into the hand (s), distance grab. */
export const ATTRACT_S = 0.2;
/** Duration of the slide to the hold point (s), near grab. */
export const SLIDE_S = 0.12;

/** Tunable after headset tests: ?grab_offset=0.12 (m, or cm if > 1), ?grab_smooth=0 to disable the filter. */
export interface GrabOptions {
  /** Distance (m) of the object's center in front of the grip, along its forward axis (local +Z). */
  holdOffsetM: number;
  /** Adaptive anti-tremor filter. */
  smoothing: boolean;
}

export const GRAB_DEFAULTS: GrabOptions = { holdOffsetM: 0.12, smoothing: true };
/** Allowed range of the hold offset (m). */
export const HOLD_OFFSET_RANGE = { min: 0, max: 0.3 };

/** Reads the grab options from the URL query (?grab_offset=…&grab_smooth=…). */
export function grabOptionsFromQuery(search: string): GrabOptions {
  const q = new URLSearchParams(search);
  const opts = { ...GRAB_DEFAULTS };
  const raw = Number(q.get("grab_offset")?.replace(",", "."));
  if (q.has("grab_offset") && Number.isFinite(raw)) {
    const m = raw > 1 ? raw / 100 : raw; // "12" = 12 cm
    opts.holdOffsetM = Math.min(HOLD_OFFSET_RANGE.max, Math.max(HOLD_OFFSET_RANGE.min, m));
  }
  if (q.get("grab_smooth") === "0") opts.smoothing = false;
  return opts;
}

export interface Pose {
  position: Vector3;
  rotation: Quaternion;
}

/** World matrix of a pose (no scale). */
export function poseMatrix(p: Pose): Matrix {
  return Matrix.Compose(new Vector3(1, 1, 1), p.rotation, p.position);
}

/** Smooth start and stop (ease in-out). */
export function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Adaptive low-pass on a pose (One Euro filter, Casiez et al. 2012): the cutoff
 * frequency rises with the speed, so slow / still hands are smoothed (no tremor)
 * and fast moves pass through with ≈ 10–20 ms of lag.
 */
export class PoseFilter {
  /** Cutoff at rest (Hz), speed coefficients (Hz per m/s, Hz per rad/s), speed-estimate cutoff (Hz). */
  static readonly MIN_CUTOFF = 4;
  static readonly BETA_POS = 6;
  static readonly BETA_ROT = 1.5;
  static readonly D_CUTOFF = 4;
  private p: Vector3 | null = null;
  private q: Quaternion | null = null;
  private speed = 0;
  private turn = 0;

  public apply(pose: Pose, dt: number): Pose {
    if (!this.p || !this.q || dt <= 0) {
      this.p = pose.position.clone();
      this.q = pose.rotation.clone();
      return { position: this.p.clone(), rotation: this.q.clone() };
    }
    const ad = alpha(PoseFilter.D_CUTOFF, dt);
    this.speed += ad * (Vector3.Distance(pose.position, this.p) / dt - this.speed);
    const dot = Math.min(1, Math.abs(Quaternion.Dot(pose.rotation, this.q)));
    this.turn += ad * ((2 * Math.acos(dot)) / dt - this.turn);
    const cutoff = PoseFilter.MIN_CUTOFF + Math.max(PoseFilter.BETA_POS * this.speed, PoseFilter.BETA_ROT * this.turn);
    const a = alpha(cutoff, dt);
    this.p = Vector3.Lerp(this.p, pose.position, a);
    this.q = Quaternion.Slerp(this.q, pose.rotation, a);
    return { position: this.p.clone(), rotation: this.q.clone() };
  }
}

/** Smoothing factor of a first-order low-pass of cutoff `fc` (Hz) for a step `dt` (s). */
function alpha(fc: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * fc);
  return 1 / (1 + tau / dt);
}

export class XRGrab {
  /** Object pose relative to the hand (constant while held). */
  private readonly local: Matrix;
  private readonly start: Pose;
  private readonly duration: number;
  private readonly filter: PoseFilter | null;
  private t: number;
  public readonly near: boolean;

  /**
   * @param object  current world pose of the object (its base point)
   * @param anchor  current world pose of the hand / controller grip
   * @param objectHeight used to hold the object by its center
   * @param options hold offset and smoothing (defaults: GRAB_DEFAULTS)
   */
  constructor(object: Pose, anchor: Pose, objectHeight: number, options: Partial<GrabOptions> = {}) {
    const opts = { ...GRAB_DEFAULTS, ...options };
    const offset = Math.min(HOLD_OFFSET_RANGE.max, Math.max(HOLD_OFFSET_RANGE.min, opts.holdOffsetM));
    const anchorM = poseMatrix(anchor);
    const objectM = poseMatrix(object);
    this.near = Vector3.Distance(object.position.add(new Vector3(0, objectHeight / 2, 0)), anchor.position) <= NEAR_GRAB_M;
    this.filter = opts.smoothing ? new PoseFilter() : null;
    if (this.near && offset === 0) {
      // Legacy: keep the exact relative placement (local = object × anchor⁻¹).
      this.local = objectM.multiply(Matrix.Invert(anchorM));
      this.t = 1;
      this.duration = SLIDE_S;
    } else {
      // Keep the object's world orientation at the moment of the grab (relative to the
      // hand from now on) and carry its CENTER `offset` in front of the grip (local +Z);
      // base point = center − half height along the object's up axis.
      const rel = this.relativeRotation(object.rotation, anchor.rotation);
      const up = Vector3.TransformNormal(new Vector3(0, objectHeight / 2, 0), Matrix.Compose(new Vector3(1, 1, 1), rel, Vector3.Zero()));
      const forward = offset > 0 ? offset : 0.06; // distance grab with no offset: legacy 6 cm
      this.local = Matrix.Compose(new Vector3(1, 1, 1), rel, new Vector3(0, 0, forward).subtract(up));
      this.t = 0;
      this.duration = this.near ? SLIDE_S : ATTRACT_S;
    }
    this.start = { position: object.position.clone(), rotation: object.rotation.clone() };
  }

  /** True while the object is still moving to the hold point. */
  public get attracting(): boolean {
    return this.t < 1;
  }

  /**
   * New world pose of the object for the current hand pose.
   * @param dt frame time (s): advances the move to the hold point and the filter
   */
  public update(anchor: Pose, dt: number): Pose {
    const target = this.local.multiply(poseMatrix(anchor));
    const position = new Vector3();
    const rotation = new Quaternion();
    target.decompose(undefined, rotation, position);
    let pose: Pose = { position, rotation };
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration);
      const k = ease(this.t);
      pose = { position: Vector3.Lerp(this.start.position, position, k), rotation: Quaternion.Slerp(this.start.rotation, rotation, k) };
    }
    return this.filter ? this.filter.apply(pose, dt) : pose;
  }

  /** Local rotation r such that compose(r) × compose(anchor) has the object's world rotation. */
  private relativeRotation(objectRot: Quaternion, anchorRot: Quaternion): Quaternion {
    const m = poseMatrix({ position: Vector3.Zero(), rotation: objectRot }).multiply(
      Matrix.Invert(poseMatrix({ position: Vector3.Zero(), rotation: anchorRot }))
    );
    const r = new Quaternion();
    m.decompose(undefined, r, undefined);
    return r;
  }
}
