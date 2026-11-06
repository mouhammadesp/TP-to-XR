/**
 * Unit tests — engine-bay identification demo (tp_demo_engine): manifest rules and
 * the selection zones really present in the shipped GLB (run: npm test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import path from "path";
import { getDemo, getDemoByDomain, listDemos } from "../src/services/demoTps";

const GLB = path.join(__dirname, "..", "assets", "models", "converted", "audi_tfsi_engine.glb");
/** Asked components, in order (frontend-vr/src/sim/engineQuiz.ts: QUIZ). */
const QUIZ = ["oil_cap", "dipstick", "coolant_tank", "air_filter", "battery"];

/** Node names of a binary glTF (JSON chunk). */
function glbNodeNames(file: string): string[] {
  const buf = readFileSync(file);
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + len)) as { nodes: { name?: string }[] };
  return json.nodes.map((n) => n.name ?? "");
}

test("engine demo: discovery step, then one question per asked component", () => {
  const m = getDemo("tp_demo_engine");
  assert.ok(m?.simulation);
  assert.equal(m.simulation.kind, "engine_quiz");
  assert.equal(m.tp.steps.length, 1 + QUIZ.length);
  const keys = m.simulation.rules.map((r) => (r[0]?.type === "state" ? r[0].key : null));
  assert.deepEqual(keys, ["explored", ...QUIZ.map((id) => `found_${id}`)]);
});

test("engine demo: real-scale scan with its CC-BY attribution", () => {
  const engine = getDemo("tp_demo_engine")!.assets.find((a) => a.asset_id === "x_moteur")!;
  assert.equal(engine.source, "converted");
  assert.equal(engine.url, "/assets/models/converted/audi_tfsi_engine.glb");
  assert.equal(engine.fixed, true);
  assert.ok(Math.abs(engine.target_size_m - 1.798) < 0.01);
  assert.match(engine.attribution?.license ?? "", /CC Attribution/);
  assert.equal(engine.attribution?.author, "SPLEEN VISION");
});

test("engine demo: every asked component has its selection zone in the GLB", () => {
  const zones = glbNodeNames(GLB).filter((n) => n.startsWith("zone__")).map((n) => n.slice(6));
  for (const id of QUIZ) assert.ok(zones.includes(id), `zone__${id} missing`);
  assert.equal(zones.length, 9);
});

test("engine demo: existing demos unchanged (belt drive stays the mechanical demo by domain)", () => {
  assert.equal(getDemoByDomain("mechanical")?.id, "tp_demo_mechanical");
  assert.deepEqual(listDemos().map((d) => d.id), ["tp_demo_mechanical", "tp_demo_electrical", "tp_demo_engine", "tp_demo_instruments"]);
  assert.equal(listDemos().find((d) => d.id === "tp_demo_engine")?.label, "Démo moteur automobile");
});
