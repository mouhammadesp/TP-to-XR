/**
 * VR locomotion (pure math, unit-tested) — comfortable and safe:
 * - left stick: walk HORIZONTALLY in the direction the head faces (pitch ignored:
 *   looking down never moves you through the floor), with acceleration/deceleration
 *   instead of instant speed changes;
 * - right stick: snap turn by 30° (smooth rotation is a major cause of motion sickness);
 * - the walker stays inside the room and is pushed out of furniture (no walking through the bench).
 */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const WALK = {
  /** Comfortable indoor walking speed (m/s). */
  speed: 1.4,
  /** Acceleration / deceleration limit (m/s²): smooth start and stop. */
  accel: 5,
  /** Stick deadzone (drift of worn sticks). */
  deadzone: 0.15,
  /** Snap-turn angle (rad) and stick thresholds (hysteresis). */
  snapAngle: Math.PI / 6,
  snapOn: 0.7,
  snapOff: 0.3,
  /** Body radius kept away from furniture and walls (m). */
  radius: 0.25,
} as const;

/** Radial deadzone, rescaled so movement starts smoothly from 0 at the deadzone edge. */
export function applyDeadzone(x: number, y: number, dz: number = WALK.deadzone): Vec2 {
  const m = Math.hypot(x, y);
  if (m <= dz) return { x: 0, z: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, z: y * k };
}

/**
 * Desired horizontal velocity from the stick (x right, y forward-negative as in
 * the gamepad API) and the head yaw (forward vector projected on the floor).
 */
export function desiredVelocity(stick: Vec2, forward: Vec2, speed: number = WALK.speed): Vec2 {
  const len = Math.hypot(forward.x, forward.z) || 1;
  const fx = forward.x / len;
  const fz = forward.z / len;
  // Right vector on the floor (left-handed Y-up: right = (fz, -fx)).
  const rx = fz;
  const rz = -fx;
  const fwd = -stick.z; // pushing the stick forward gives y < 0
  return { x: (fx * fwd + rx * stick.x) * speed, z: (fz * fwd + rz * stick.x) * speed };
}

/** Moves `v` toward `target` with a bounded acceleration. */
export function approach(v: Vec2, target: Vec2, dt: number, accel: number = WALK.accel): Vec2 {
  const dx = target.x - v.x;
  const dz = target.z - v.z;
  const d = Math.hypot(dx, dz);
  const max = accel * dt;
  if (d <= max) return { ...target };
  return { x: v.x + (dx / d) * max, z: v.z + (dz / d) * max };
}

/** Keeps a point inside the room and outside the (inflated) furniture boxes. */
export function resolveCollisions(p: Vec2, room: Box2, obstacles: readonly Box2[], r: number = WALK.radius): Vec2 {
  let { x, z } = p;
  x = Math.max(room.minX + r, Math.min(room.maxX - r, x));
  z = Math.max(room.minZ + r, Math.min(room.maxZ - r, z));
  for (const b of obstacles) {
    const minX = b.minX - r, maxX = b.maxX + r, minZ = b.minZ - r, maxZ = b.maxZ + r;
    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
    // Inside: push out through the nearest side.
    const pushes = [
      { d: x - minX, x: minX, z },
      { d: maxX - x, x: maxX, z },
      { d: z - minZ, x, z: minZ },
      { d: maxZ - z, x, z: maxZ },
    ];
    const best = pushes.reduce((a, c) => (c.d < a.d ? c : a));
    x = best.x;
    z = best.z;
  }
  return { x, z };
}

/** Snap-turn trigger with hysteresis: returns -1 / +1 once per stick flick, else 0. */
export class SnapTurn {
  private armed = true;

  public update(stickX: number): -1 | 0 | 1 {
    const a = Math.abs(stickX);
    if (this.armed && a >= WALK.snapOn) {
      this.armed = false;
      return stickX > 0 ? 1 : -1;
    }
    if (!this.armed && a <= WALK.snapOff) this.armed = true;
    return 0;
  }
}
