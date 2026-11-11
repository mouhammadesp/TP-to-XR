/**
 * Unit tests — engine-bay identification demo (tp_demo_engine): seeded manifest
 * rules and selection zones really present in the shipped GLB.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import path from "path";
import { getDemo, getDemoByDomain, listDemos } from "../src/services/demoTps";
import { ENGINE_QUESTION_BANK } from "../src/services/quizBank";
import { demoQuestionCount } from "../src/services/quiz";

const GLB = path.join(__dirname, "..", "assets", "models", "converted", "audi_tfsi_engine.glb");

/** Node names of a binary glTF (JSON chunk). */
function glbNodeNames(file: string): string[] {
  const buf = readFileSync(file);
  assert.equal(buf.toString("ascii", 0, 4), "glTF");
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + len)) as { nodes: { name?: string }[] };
  return json.nodes.map((n) => n.name ?? "");
}

test("engine demo: discovery step, then the exact drawn questions of the seeded session", () => {
  const m = getDemo("tp_demo_engine", "engine_demo_test_seed")!;
  assert.ok(m.simulation);
  assert.equal(m.simulation.kind, "engine_quiz");
  const questions = m.simulation.quiz!.questions;
  assert.ok(questions.length >= 5 && questions.length <= 7);
  assert.equal(questions.length, demoQuestionCount("engine_demo_test_seed"));
  assert.equal(m.tp.steps.length, 1 + questions.length);
  const keys = m.simulation.rules.map((r) => (r[0]?.type === "state" ? r[0].key : null));
  assert.deepEqual(keys, ["explored", ...questions.map((q) => q.flag)]);
  assert.equal(new Set(questions.map((q) => q.answer)).size, questions.length, "no target asked twice: one exact zone per question");
});

test("engine demo: real-scale scan with its CC-BY attribution", () => {
  const engine = getDemo("tp_demo_engine", "engine_asset_seed")!.assets.find((a) => a.asset_id === "x_moteur")!;
  assert.equal(engine.source, "converted");
  assert.equal(engine.url, "/assets/models/converted/audi_tfsi_engine.glb");
  assert.equal(engine.fixed, true);
  assert.ok(Math.abs(engine.target_size_m - 1.798) < 0.01);
  assert.match(engine.attribution?.license ?? "", /CC Attribution/);
  assert.equal(engine.attribution?.author, "SPLEEN VISION");
});

test("engine demo: every possible answer has exactly one selection zone in the GLB", () => {
  const zones = glbNodeNames(GLB).filter((n) => n.startsWith("zone__")).map((n) => n.slice(6));
  for (const target of ENGINE_QUESTION_BANK) assert.ok(zones.includes(target.answer), `zone__${target.answer} missing`);
  assert.equal(zones.length, 10);
  assert.equal(new Set(zones).size, zones.length);
  assert.ok(!zones.includes("coolant_cap"), "no invented coolant-cap zone");
});

test("engine demo: hidden legacy demos remain available internally, not in the home menu", () => {
  assert.equal(getDemoByDomain("mechanical")?.id, "tp_demo_mechanical");
  assert.deepEqual(listDemos().map((d) => d.id), ["tp_demo_engine", "tp_demo_instruments", "tp_demo_biology"]);
  assert.equal(listDemos().find((d) => d.id === "tp_demo_engine")?.label, "Démo mécanique — Moteur automobile");
  assert.ok(getDemo("tp_demo_mechanical"));
  assert.ok(getDemo("tp_demo_electrical"));
});
