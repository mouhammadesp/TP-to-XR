/** Seeded quiz draws and their manifest/report contract. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "fs";
import path from "path";
import { DEMO_QUESTION_COUNT, drawQuiz } from "../src/services/quiz";
import { ENGINE_QUESTION_BANK, INSTRUMENT_QUESTION_BANK } from "../src/services/quizBank";
import { getDemo, getDemoByDomain, listDemos } from "../src/services/demoTps";

const signature = (bank: typeof ENGINE_QUESTION_BANK | typeof INSTRUMENT_QUESTION_BANK, seed: string) =>
  drawQuiz(bank, DEMO_QUESTION_COUNT, seed).questions.map((q) => `${q.id}:${q.answer}`).join("|");

test("quiz draw: fixed seed is reproducible, with unique questions, targets and flags", () => {
  for (const bank of [ENGINE_QUESTION_BANK, INSTRUMENT_QUESTION_BANK]) {
    const a = drawQuiz(bank, DEMO_QUESTION_COUNT, "fixed_test_seed");
    const b = drawQuiz(bank, DEMO_QUESTION_COUNT, "fixed_test_seed");
    assert.deepEqual(a, b);
    assert.equal(a.questions.length, 5);
    assert.equal(new Set(a.questions.map((q) => q.id)).size, 5);
    assert.equal(new Set(a.questions.map((q) => q.answer)).size, 5);
    assert.equal(new Set(a.questions.map((q) => q.flag)).size, 5);
    for (const q of a.questions) {
      const target = bank.find((t) => t.answer === q.answer);
      const variant = target?.variants.find((v) => v.id === q.id);
      assert.ok(variant, `${q.id} must stay attached to ${q.answer}`);
      assert.equal(q.prompt, variant.prompt);
    }
  }
});

test("quiz draw: successive seeds vary selection, wording and order without session duplicates", () => {
  for (const bank of [ENGINE_QUESTION_BANK, INSTRUMENT_QUESTION_BANK]) {
    const plans = Array.from({ length: 12 }, (_, i) => drawQuiz(bank, 5, `session_${i}`));
    assert.ok(new Set(plans.map((p) => p.questions.map((q) => q.id).join("|"))).size > 1);
    for (const plan of plans) {
      assert.equal(new Set(plan.questions.map((q) => q.id)).size, 5);
      assert.equal(new Set(plan.questions.map((q) => q.answer)).size, 5);
    }
  }
  assert.notEqual(signature(ENGINE_QUESTION_BANK, "session_a"), signature(ENGINE_QUESTION_BANK, "session_b"));
  assert.notEqual(signature(INSTRUMENT_QUESTION_BANK, "session_a"), signature(INSTRUMENT_QUESTION_BANK, "session_b"));
});

test("quiz banks: more authored questions than displayed, all targets valid", () => {
  assert.equal(ENGINE_QUESTION_BANK.length, 9);
  assert.ok(ENGINE_QUESTION_BANK.flatMap((t) => t.variants).length > DEMO_QUESTION_COUNT);
  assert.ok(INSTRUMENT_QUESTION_BANK.flatMap((t) => t.variants).length > DEMO_QUESTION_COUNT);
  const instrumentAssets = new Set(getDemo("tp_demo_instruments", "assets_seed")!.assets.map((a) => a.asset_id));
  for (const target of INSTRUMENT_QUESTION_BANK) assert.ok(instrumentAssets.has(target.answer), target.answer);
  assert.ok(!instrumentAssets.has("i_pince_amperemetrique"));
  assert.ok(!instrumentAssets.has("i_testeur_isolement"));
});

test("quiz draw rejects invalid counts, seeds and duplicate target ids", () => {
  assert.throws(() => drawQuiz(ENGINE_QUESTION_BANK, 0, "valid"), /count/);
  assert.throws(() => drawQuiz(ENGINE_QUESTION_BANK, 10, "valid"), /count/);
  assert.throws(() => drawQuiz(ENGINE_QUESTION_BANK, 5, "bad seed!"), /seed/);
  const duplicate = [ENGINE_QUESTION_BANK[0], ENGINE_QUESTION_BANK[0]];
  assert.throws(() => drawQuiz(duplicate, 1, "valid"), /Duplicate/);
});

test("seeded manifests: displayed steps and validation rules describe the exact selected questions", () => {
  for (const id of ["tp_demo_engine", "tp_demo_instruments"]) {
    const m = getDemo(id, "manifest_fixed_seed")!;
    const quiz = m.simulation!.quiz!;
    assert.equal(m.tp.steps.length, 6);
    assert.equal(m.simulation!.rules.length, 6);
    assert.deepEqual(getDemo(id, "manifest_fixed_seed"), m, "report reconstruction must be exact");
    quiz.questions.forEach((q, i) => {
      assert.ok(m.tp.steps[i + 1].action.startsWith(q.prompt));
      const rule = m.simulation!.rules[i + 1][0];
      assert.ok(rule.type === "state" && rule.key === q.flag);
    });
  }
});

test("home menu exposes exactly two demos; former simulations and legacy reports stay available", () => {
  assert.deepEqual(listDemos().map((d) => d.id), ["tp_demo_engine", "tp_demo_instruments"]);
  assert.deepEqual(listDemos().map((d) => d.label), [
    "Démo mécanique — Moteur automobile",
    "Démo génie électrique — Instruments de mesure",
  ]);
  assert.ok(listDemos().every((d) => d.steps === 6));
  assert.equal(getDemoByDomain("mechanical")?.id, "tp_demo_mechanical");
  assert.equal(getDemoByDomain("electrical")?.id, "tp_demo_electrical");
  assert.equal(getDemo("tp_demo_engine", null)!.simulation!.quiz, undefined);
  assert.equal(getDemo("tp_demo_instruments", null)!.tp.steps.length, 11);
  for (const id of ["tp_demo_mechanical", "tp_demo_electrical"]) assert.ok(getDemo(id), id);
});

test("instrument questions refer only to the five supplied GLB models", () => {
  const m = getDemo("tp_demo_instruments", "models_seed")!;
  for (const asset of m.assets) {
    assert.ok(asset.url);
    assert.ok(existsSync(path.join(__dirname, "..", asset.url!.replace(/^\/assets\//, "assets/"))), asset.url!);
  }
});
