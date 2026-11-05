/**
 * Unit tests — VR grab (near grab sticks 1:1, distance grab flies into the hand).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ATTRACT_S, GRAB_DEFAULTS, Pose, SLIDE_S, XRGrab, grabOptionsFromQuery } from "../src/scenes/xrGrab";

/** Legacy behavior (object stuck where taken, raw tracking) — still available with ?grab_offset=0&grab_smooth=0. */
const LEGACY = { holdOffsetM: 0, smoothing: false };

const pose = (x: number, y: number, z: number, yaw = 0, pitch = 0): Pose => ({
  position: new Vector3(x, y, z),
  rotation: Quaternion.FromEulerAngles(pitch, yaw, 0),
});
const close = (a: Vector3, b: Vector3, eps = 1e-4) => Vector3.Distance(a, b) < eps;
const angle = (a: Quaternion, b: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(a, b))));

test("legacy near grab (offset 0): object keeps its place relative to the hand and follows it 1:1", () => {
  const object = pose(0.05, 0.9, 0, 0.3);
  const hand = pose(0.05, 0.98, 0.05);
  const g = new XRGrab(object, hand, 0.06, LEGACY);
  assert.equal(g.near, true);
  // No movement → no jump.
  const same = g.update(hand, 1 / 72);
  assert.ok(close(same.position, object.position));
  assert.ok(angle(same.rotation, object.rotation) < 1e-3);
  // Hand moves 30 cm forward and up: the object moves exactly the same way.
  const moved = g.update(pose(0.05, 1.28, -0.25), 1 / 72);
  assert.ok(close(moved.position, new Vector3(0.05, 1.2, -0.3)));
});

test("legacy near grab: wrist rotation rotates the object around the hand, not around itself", () => {
  const hand = pose(0, 1, 0);
  const g = new XRGrab(pose(0.1, 0.97, 0), hand, 0.06, LEGACY); // object 10 cm to the right of the hand
  const turned = g.update(pose(0, 1, 0, Math.PI / 2), 1 / 72); // wrist yaw 90°
  assert.ok(Math.abs(Vector3.Distance(turned.position, new Vector3(0, 0.97, 0)) - 0.1) < 1e-4, "stays 10 cm from the hand");
  assert.ok(!close(turned.position, new Vector3(0.1, 0.97, 0)), "moved around the hand");
});

test("distance grab: the object flies into the hand in 0.2 s, then is held", () => {
  const object = pose(0, 0.9, -1.2); // on the bench, 1.2 m away
  const hand = pose(0.2, 1.1, 0.3);
  const g = new XRGrab(object, hand, 0.1, LEGACY);
  assert.equal(g.near, false);
  const first = g.update(hand, 1 / 72);
  assert.ok(g.attracting && Vector3.Distance(first.position, object.position) < 0.1, "starts from where it was (no teleport)");
  let p = first;
  for (let i = 0; i < Math.ceil(ATTRACT_S * 72); i++) p = g.update(hand, 1 / 72);
  assert.equal(g.attracting, false);
  // Object center ≈ 6 cm in front of the grip.
  const center = p.position.add(new Vector3(0, 0.05, 0));
  assert.ok(Vector3.Distance(center, hand.position) < 0.07, `center ${Vector3.Distance(center, hand.position).toFixed(3)} m from the hand`);
  // Then it follows the hand: hand moves 50 cm → object moves 50 cm.
  const after = g.update(pose(0.7, 1.1, 0.3), 1 / 72);
  assert.ok(Math.abs(after.position.x - p.position.x - 0.5) < 1e-4);
});

test("distance grab keeps the object's orientation at the moment it is grabbed", () => {
  const object = pose(0, 0.9, -1, 0.8); // object turned 0.8 rad on the bench
  const hand = pose(0, 1.1, 0.2, -0.4, 0.3); // hand pitched and yawed
  const g = new XRGrab(object, hand, 0.08, LEGACY);
  let p = g.update(hand, 1);
  p = g.update(hand, 1);
  assert.ok(angle(p.rotation, object.rotation) < 1e-3, "no sudden flip when it arrives in the hand");
});

/** Runs `n` frames at 72 Hz with a fixed hand pose. */
function run(g: XRGrab, hand: Pose, n: number): Pose {
  let p = g.update(hand, 1 / 72);
  for (let i = 1; i < n; i++) p = g.update(hand, 1 / 72);
  return p;
}

test("hold offset (default 12 cm): the object's center is carried in front of the controller, along its forward axis", () => {
  assert.equal(GRAB_DEFAULTS.holdOffsetM, 0.12);
  const hand = pose(0, 1.1, 0.3, 0.6); // controller turned 0.6 rad
  const g = new XRGrab(pose(0.05, 1.02, 0.28), hand, 0.1); // near grab
  assert.equal(g.near, true);
  const p = run(g, hand, Math.ceil(SLIDE_S * 72) + 30);
  const center = p.position.add(new Vector3(0, 0.05, 0));
  const expected = hand.position.add(new Vector3(Math.sin(0.6), 0, Math.cos(0.6)).scale(0.12));
  assert.ok(Vector3.Distance(center, expected) < 0.003, `center ${Vector3.Distance(center, expected).toFixed(4)} m from the hold point`);
});

test("grab start: no jump, no sudden rotation (smooth slide, orientation kept)", () => {
  const object = pose(0.05, 1.02, 0.28, 0.9);
  const hand = pose(0, 1.1, 0.3, -0.3, 0.4);
  const g = new XRGrab(object, hand, 0.1);
  const first = g.update(hand, 1 / 72);
  assert.ok(Vector3.Distance(first.position, object.position) < 0.02, "first frame stays where the object was");
  assert.ok(angle(first.rotation, object.rotation) < 0.05, "no flip at the grab");
  const held = run(g, hand, 40);
  assert.ok(angle(held.rotation, object.rotation) < 1e-3, "orientation of the grab kept while the hand is still");
});

test("tracking: tremor smoothed, fast moves followed with low lag", () => {
  const hand = pose(0, 1.1, 0.3);
  const g = new XRGrab(pose(0, 1.02, 0.42), hand, 0.1);
  const rest = run(g, hand, 60);
  // ±2 mm tremor at 72 Hz → the object moves much less.
  let maxDev = 0;
  for (let i = 0; i < 72; i++) {
    const jitter = (i % 2 ? 1 : -1) * 0.002;
    const p = g.update(pose(jitter, 1.1, 0.3), 1 / 72);
    maxDev = Math.max(maxDev, Math.abs(p.position.x - rest.position.x));
  }
  assert.ok(maxDev < 0.0012, `tremor 2 mm → ${(maxDev * 1000).toFixed(2)} mm`);
  // Hand moving at 1 m/s: after 0.1 s the object lags by less than 3 cm (≈ 25 ms).
  let p = rest;
  for (let i = 1; i <= 7; i++) p = g.update(pose(i / 72, 1.1, 0.3), 1 / 72);
  const lag = 7 / 72 - (p.position.x - rest.position.x);
  assert.ok(lag < 0.03, `lag ${(lag * 100).toFixed(1)} cm at 1 m/s`);
});

test("options from the URL: offset in m or cm, clamped; smoothing can be disabled", () => {
  assert.deepEqual(grabOptionsFromQuery(""), GRAB_DEFAULTS);
  assert.equal(grabOptionsFromQuery("?grab_offset=0.15").holdOffsetM, 0.15);
  assert.equal(grabOptionsFromQuery("?grab_offset=10").holdOffsetM, 0.1);
  assert.equal(grabOptionsFromQuery("?grab_offset=80").holdOffsetM, 0.3);
  assert.equal(grabOptionsFromQuery("?grab_offset=0").holdOffsetM, 0);
  assert.equal(grabOptionsFromQuery("?grab_smooth=0").smoothing, false);
});
