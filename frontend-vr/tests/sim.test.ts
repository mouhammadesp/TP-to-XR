/**
 * Unit tests — interactive TP logic: step conditions, snapping, circuit physics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SimCondition, SimTarget, WorldView, allDone, evaluate, findSnapTarget } from "../src/sim/conditions";
import { CircuitInput, computeCircuit } from "../src/sim/circuit";

const world = (over: Partial<WorldView> & { placed?: string[] } = {}): WorldView => ({
  isPlaced: (a, t) => (over.placed ?? []).includes(`${a}@${t}`),
  heldSeconds: over.heldSeconds ?? new Map(),
  near: over.near ?? new Set(),
  flags: over.flags ?? new Set(),
});

test("conditions: a step validates only when ALL its conditions hold", () => {
  const rule: SimCondition[] = [
    { type: "state", key: "locked_out", label: "Consigné" },
    { type: "held", asset: "p1", seconds: 1.5, label: "Poulie 1 inspectée" },
    { type: "placed", asset: "p2", target: "arbre", label: "Poulie 2 montée" },
    { type: "near", asset: "cle", target: "tendeur", distance: 0.15, label: "Clé sur tendeur" },
  ];
  assert.equal(allDone(evaluate(rule, world())), false);
  const partial = evaluate(rule, world({ flags: new Set(["locked_out"]), heldSeconds: new Map([["p1", 1.0]]) }));
  assert.deepEqual(partial.map((i) => i.done), [true, false, false, false]); // 1.0 s < 1.5 s
  const full = world({
    flags: new Set(["locked_out"]),
    heldSeconds: new Map([["p1", 2]]),
    placed: ["p2@arbre"],
    near: new Set(["cle@tendeur"]),
  });
  assert.equal(allDone(evaluate(rule, full)), true);
  assert.equal(allDone(evaluate([], full)), false); // empty rule = manual step
});

test("snapping: closest accepting target within radius and plausible height", () => {
  const targets: SimTarget[] = [
    { id: "arbre_m", label: "", position: { x: -0.25, y: 1.0, z: -0.05 }, radius: 0.12, accepts: ["poulie_m"] },
    { id: "arbre_r", label: "", position: { x: 0.25, y: 0.98, z: -0.05 }, radius: 0.12, accepts: ["poulie_r"] },
  ];
  assert.equal(findSnapTarget("poulie_m", { x: -0.2, y: 0.95, z: 0 }, targets)?.id, "arbre_m");
  assert.equal(findSnapTarget("poulie_m", { x: 0.25, y: 0.98, z: -0.05 }, targets), null); // wrong shaft
  assert.equal(findSnapTarget("poulie_m", { x: -0.6, y: 1.0, z: 0 }, targets), null); // too far
  assert.equal(findSnapTarget("poulie_m", { x: -0.25, y: 0.0, z: -0.05 }, targets), null); // on the floor below
});

const ready: CircuitInput = {
  boardPlaced: true, batteryPlaced: true, wiresPlaced: true, resistorsPlaced: true, ledsPlaced: true, switchOn: true, ledsBurnt: false,
};

test("circuit: Ohm's law with 3 × 150 Ω and 2 LEDs in parallel", () => {
  const s = computeCircuit(ready);
  assert.equal(s.closed, true);
  assert.equal(s.current_mA, 23.5); // (12.6 − 2.0) / 450.5 Ω
  assert.equal(s.perLed_mA, 11.8); // below the 20 mA LED limit
  assert.ok(s.batteryVoltage < 12.6 && s.batteryVoltage > 12.5);
  assert.equal(s.burnsLeds, false);
});

test("circuit: open switch, missing wires or LEDs → no current", () => {
  assert.equal(computeCircuit({ ...ready, switchOn: false }).current_mA, 0);
  assert.equal(computeCircuit({ ...ready, wiresPlaced: false }).powered, false);
  assert.equal(computeCircuit({ ...ready, ledsPlaced: false }).closed, false);
  assert.equal(computeCircuit({ ...ready, switchOn: false }).batteryVoltage, 12.6); // open-circuit voltage
});

test("circuit: no current-limiting resistor → LEDs burn out (≈ 21 A)", () => {
  const s = computeCircuit({ ...ready, resistorsPlaced: false });
  assert.equal(s.burnsLeds, true);
  assert.equal(s.closed, false);
  assert.equal(computeCircuit({ ...ready, ledsBurnt: true }).current_mA, 0); // burnt LEDs stay open
});
