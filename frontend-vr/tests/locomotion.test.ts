/**
 * Unit tests — VR locomotion (smooth, horizontal, collision-safe) and safety-sign classification.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SnapTurn, WALK, applyDeadzone, approach, desiredVelocity, resolveCollisions } from "../src/scenes/locomotion";
import { isMandatory } from "../src/ui/StepPanel";

test("deadzone: stick drift ignored, full push = 1, smooth ramp", () => {
  assert.deepEqual(applyDeadzone(0.1, -0.05), { x: 0, z: 0 });
  const full = applyDeadzone(0, -1);
  assert.ok(Math.abs(full.z + 1) < 1e-9);
  const half = applyDeadzone(0, -0.575);
  assert.ok(Math.abs(Math.hypot(half.x, half.z) - 0.5) < 1e-9); // (0.575 − 0.15) / 0.85 = 0.5
});

test("walk direction follows the head yaw only (never vertical)", () => {
  const fwd = desiredVelocity({ x: 0, z: -1 }, { x: 0, z: -1 }); // facing -Z, stick forward
  assert.ok(Math.abs(fwd.z + WALK.speed) < 1e-9 && Math.abs(fwd.x) < 1e-9);
  // Looking down steeply: the forward vector is tiny on the floor, but speed is unchanged.
  const down = desiredVelocity({ x: 0, z: -1 }, { x: 0, z: -0.05 });
  assert.ok(Math.abs(Math.hypot(down.x, down.z) - WALK.speed) < 1e-9);
  const strafe = desiredVelocity({ x: 1, z: 0 }, { x: 0, z: -1 }); // stick right while facing -Z
  assert.ok(Math.abs(Math.hypot(strafe.x, strafe.z) - WALK.speed) < 1e-9 && Math.abs(strafe.z) < 1e-9);
});

test("acceleration and deceleration are progressive (no jumps)", () => {
  let v = { x: 0, z: 0 };
  const target = { x: 0, z: -WALK.speed };
  const frame = 1 / 72;
  v = approach(v, target, frame);
  assert.ok(Math.abs(v.z) <= WALK.accel * frame + 1e-9); // first frame: small step
  for (let i = 0; i < 72; i++) v = approach(v, target, frame);
  assert.deepEqual(v, target); // full speed within ~0.3 s
  v = approach(v, { x: 0, z: 0 }, frame);
  assert.ok(v.z < 0 && v.z > -WALK.speed); // releasing the stick slows down, no instant stop
});

test("collisions: stays in the room, pushed out of the workbench", () => {
  const room = { minX: -10, maxX: 10, minZ: -7.5, maxZ: 7.5 };
  const bench = { minX: -1.5, maxX: 1.5, minZ: -0.75, maxZ: 0.75 };
  const wall = resolveCollisions({ x: 12, z: 0 }, room, []);
  assert.equal(wall.x, 10 - WALK.radius);
  const inBench = resolveCollisions({ x: 0.2, z: 0.9 }, room, [bench]); // front edge zone
  assert.equal(inBench.z, 0.75 + WALK.radius);
  assert.deepEqual(resolveCollisions({ x: 0, z: 2 }, room, [bench]), { x: 0, z: 2 }); // free space untouched
});

test("snap turn: one 30° turn per stick flick (hysteresis)", () => {
  const s = new SnapTurn();
  assert.equal(s.update(0.9), 1);
  assert.equal(s.update(0.95), 0); // held: no repeat
  assert.equal(s.update(0.5), 0); // still above release threshold
  assert.equal(s.update(0.1), 0); // released
  assert.equal(s.update(-0.8), -1);
});

test("safety signs: obligations are blue (ISO 7010 M), dangers yellow (W)", () => {
  for (const t of ["Porter des gants", "Consigner le moteur", "Câbler hors tension"]) assert.equal(isMandatory(t), true, t);
  for (const t of ["Attention court-circuit", "Risque électrique", "Aperçu de modèle"]) assert.equal(isMandatory(t), false, t);
});
