// tests/sim.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/sim/conditions.ts
function evaluate(conditions, world2) {
  return conditions.map((c) => ({ label: c.label, done: holds(c, world2) }));
}
function allDone(items) {
  return items.length > 0 && items.every((i) => i.done);
}
function holds(c, w) {
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
function distXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function findSnapTarget(assetId, pos, targets) {
  let best = null;
  for (const t of targets) {
    if (!t.accepts.includes(assetId)) continue;
    const d = distXZ(pos, t.position);
    if (d > t.radius || Math.abs(pos.y - t.position.y) > 0.35) continue;
    if (!best || d < best.d) best = { t, d };
  }
  return best?.t ?? null;
}

// src/sim/circuit.ts
var EMF_V = 12.6;
var INTERNAL_R = 0.3;
var WIRING_R = 0.2;
var RESISTOR_OHMS = 150;
var RESISTOR_COUNT = 3;
var LED_VF = 2;
var LED_COUNT = 2;
var LED_MAX_MA = 20;
function computeCircuit(i) {
  const powered = i.switchOn && i.batteryPlaced && i.boardPlaced && i.wiresPlaced;
  const open = {
    powered,
    closed: false,
    current_mA: 0,
    perLed_mA: 0,
    batteryVoltage: EMF_V,
    ledBrightness: 0,
    burnsLeds: false
  };
  if (!powered || !i.ledsPlaced || i.ledsBurnt) return open;
  const seriesR = i.resistorsPlaced ? RESISTOR_COUNT * RESISTOR_OHMS : 0;
  const current = (EMF_V - LED_VF) / (seriesR + INTERNAL_R + WIRING_R);
  const perLed = current * 1e3 / LED_COUNT;
  if (perLed > LED_MAX_MA * 5) {
    return { ...open, burnsLeds: true };
  }
  return {
    powered,
    closed: true,
    current_mA: round1(current * 1e3),
    perLed_mA: round1(perLed),
    batteryVoltage: round2(EMF_V - current * INTERNAL_R),
    ledBrightness: Math.min(1, perLed / LED_MAX_MA + 0.25),
    burnsLeds: false
  };
}
var round1 = (n) => Math.round(n * 10) / 10;
var round2 = (n) => Math.round(n * 100) / 100;

// tests/sim.test.ts
var world = (over = {}) => ({
  isPlaced: (a, t) => (over.placed ?? []).includes(`${a}@${t}`),
  heldSeconds: over.heldSeconds ?? /* @__PURE__ */ new Map(),
  near: over.near ?? /* @__PURE__ */ new Set(),
  flags: over.flags ?? /* @__PURE__ */ new Set()
});
test("conditions: a step validates only when ALL its conditions hold", () => {
  const rule = [
    { type: "state", key: "locked_out", label: "Consign\xE9" },
    { type: "held", asset: "p1", seconds: 1.5, label: "Poulie 1 inspect\xE9e" },
    { type: "placed", asset: "p2", target: "arbre", label: "Poulie 2 mont\xE9e" },
    { type: "near", asset: "cle", target: "tendeur", distance: 0.15, label: "Cl\xE9 sur tendeur" }
  ];
  assert.equal(allDone(evaluate(rule, world())), false);
  const partial = evaluate(rule, world({ flags: /* @__PURE__ */ new Set(["locked_out"]), heldSeconds: /* @__PURE__ */ new Map([["p1", 1]]) }));
  assert.deepEqual(partial.map((i) => i.done), [true, false, false, false]);
  const full = world({
    flags: /* @__PURE__ */ new Set(["locked_out"]),
    heldSeconds: /* @__PURE__ */ new Map([["p1", 2]]),
    placed: ["p2@arbre"],
    near: /* @__PURE__ */ new Set(["cle@tendeur"])
  });
  assert.equal(allDone(evaluate(rule, full)), true);
  assert.equal(allDone(evaluate([], full)), false);
});
test("snapping: closest accepting target within radius and plausible height", () => {
  const targets = [
    { id: "arbre_m", label: "", position: { x: -0.25, y: 1, z: -0.05 }, radius: 0.12, accepts: ["poulie_m"] },
    { id: "arbre_r", label: "", position: { x: 0.25, y: 0.98, z: -0.05 }, radius: 0.12, accepts: ["poulie_r"] }
  ];
  assert.equal(findSnapTarget("poulie_m", { x: -0.2, y: 0.95, z: 0 }, targets)?.id, "arbre_m");
  assert.equal(findSnapTarget("poulie_m", { x: 0.25, y: 0.98, z: -0.05 }, targets), null);
  assert.equal(findSnapTarget("poulie_m", { x: -0.6, y: 1, z: 0 }, targets), null);
  assert.equal(findSnapTarget("poulie_m", { x: -0.25, y: 0, z: -0.05 }, targets), null);
});
var ready = {
  boardPlaced: true,
  batteryPlaced: true,
  wiresPlaced: true,
  resistorsPlaced: true,
  ledsPlaced: true,
  switchOn: true,
  ledsBurnt: false
};
test("circuit: Ohm's law with 3 \xD7 150 \u03A9 and 2 LEDs in parallel", () => {
  const s = computeCircuit(ready);
  assert.equal(s.closed, true);
  assert.equal(s.current_mA, 23.5);
  assert.equal(s.perLed_mA, 11.8);
  assert.ok(s.batteryVoltage < 12.6 && s.batteryVoltage > 12.5);
  assert.equal(s.burnsLeds, false);
});
test("circuit: open switch, missing wires or LEDs \u2192 no current", () => {
  assert.equal(computeCircuit({ ...ready, switchOn: false }).current_mA, 0);
  assert.equal(computeCircuit({ ...ready, wiresPlaced: false }).powered, false);
  assert.equal(computeCircuit({ ...ready, ledsPlaced: false }).closed, false);
  assert.equal(computeCircuit({ ...ready, switchOn: false }).batteryVoltage, 12.6);
});
test("circuit: no current-limiting resistor \u2192 LEDs burn out (\u2248 21 A)", () => {
  const s = computeCircuit({ ...ready, resistorsPlaced: false });
  assert.equal(s.burnsLeds, true);
  assert.equal(s.closed, false);
  assert.equal(computeCircuit({ ...ready, ledsBurnt: true }).current_mA, 0);
});
