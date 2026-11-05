/**
 * Step validation rules of interactive TPs (pure, unit-tested).
 *
 * A step is validated when ALL its conditions hold:
 *   placed — the object sits on its target (live: removing it un-validates)
 *   held   — the object was held at least N seconds (inspection) during the step
 *   near   — a tool was released close to a point (e.g. wrench on the tensioner)
 *   state  — a flag set by the simulated behavior (e.g. "circuit_on")
 */

export type SimCondition =
  | { type: "placed"; asset: string; target: string; label: string }
  | { type: "held"; asset: string; seconds: number; label: string }
  | { type: "near"; asset: string; target: string; distance: number; label: string }
  | { type: "state"; key: string; label: string };

export interface SimTarget {
  id: string;
  label: string;
  position: { x: number; y: number; z: number };
  radius: number;
  accepts: string[];
  rotation_y?: number;
  marker?: "disc" | "ring_z" | "none";
  /** Generated TPs: the target follows this object — "top" = on it (place X on Y), "base" = at its foot (bring X close to Y). */
  anchor?: { asset: string; mode: "top" | "base" };
}

export interface SimulationSpec {
  /** "generic": no behavior module, the conditions alone decide (generated TPs). */
  kind: "circuit" | "belt_drive" | "engine_quiz" | "generic";
  targets: SimTarget[];
  rules: SimCondition[][];
  completion: string;
}

/** What the world currently looks like, from the simulation's point of view. */
export interface WorldView {
  /** Is `asset` sitting on `target` right now? */
  isPlaced(asset: string, target: string): boolean;
  /** Assets held long enough during the current step: "asset" → seconds held (max). */
  heldSeconds: ReadonlyMap<string, number>;
  /** "asset@target" pairs reached during the current step. */
  near: ReadonlySet<string>;
  flags: ReadonlySet<string>;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
}

/** Evaluates each condition of a step. */
export function evaluate(conditions: readonly SimCondition[], world: WorldView): ChecklistItem[] {
  return conditions.map((c) => ({ label: c.label, done: holds(c, world) }));
}

/** True if every condition holds (an empty rule = manual step, never auto-validated). */
export function allDone(items: readonly ChecklistItem[]): boolean {
  return items.length > 0 && items.every((i) => i.done);
}

function holds(c: SimCondition, w: WorldView): boolean {
  switch (c.type) {
    case "placed":
      return w.isPlaced(c.asset, c.target);
    case "held":
      return (w.heldSeconds.get(c.asset) ?? 0) >= c.seconds;
    case "near":
      return w.near.has(`${c.asset}@${c.target}`);
    case "state":
      return w.flags.has(c.key);
  }
}

/** Horizontal (x/z) distance between two points. */
export function distXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Finds the target an object snaps onto when released at `pos`:
 * a target accepting it, within its capture radius (horizontal), and not
 * vertically absurd (within 0.35 m). Returns the closest one, or null.
 */
export function findSnapTarget(
  assetId: string,
  pos: { x: number; y: number; z: number },
  targets: readonly SimTarget[]
): SimTarget | null {
  let best: { t: SimTarget; d: number } | null = null;
  for (const t of targets) {
    if (!t.accepts.includes(assetId)) continue;
    const d = distXZ(pos, t.position);
    if (d > t.radius || Math.abs(pos.y - t.position.y) > 0.35) continue;
    if (!best || d < best.d) best = { t, d };
  }
  return best?.t ?? null;
}

/** An object must have moved at least this much (m) during the step for "near" to count. */
export const NEAR_MIN_MOVE = 0.05;

/**
 * "near" (bring X close to Y): reached when the object is within `distance`
 * (horizontally) of the target AND was really moved during the step — an object
 * that merely starts close to the target does not validate anything.
 */
export function nearReached(
  pos: { x: number; z: number },
  stepStart: { x: number; z: number },
  target: { x: number; z: number },
  distance: number
): boolean {
  return distXZ(pos, stepStart) >= NEAR_MIN_MOVE && distXZ(pos, target) <= distance;
}

/**
 * Current position of an anchored target, from the anchor object's base point and
 * its height (measured on the loaded model): on top of it, or at its foot.
 */
export function anchoredPosition(
  base: { x: number; y: number; z: number },
  height: number,
  mode: "top" | "base"
): { x: number; y: number; z: number } {
  return { x: base.x, y: mode === "top" ? base.y + height : base.y, z: base.z };
}
