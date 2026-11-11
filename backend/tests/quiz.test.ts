/** Seeded quiz draws and their manifest/report contract. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "fs";
import path from "path";
import { DEMO_QUESTION_COUNT, DEMO_QUESTION_COUNT_MAX, DEMO_QUESTION_COUNT_MIN, demoQuestionCount, drawQuiz } from "../src/services/quiz";
import { BIOLOGY_QUESTION_BANK, ENGINE_QUESTION_BANK, INSTRUMENT_QUESTION_BANK } from "../src/services/quizBank";
import { getDemo, getDemoByDomain, listDemos } from "../src/services/demoTps";

const signature = (bank: typeof ENGINE_QUESTION_BANK | typeof INSTRUMENT_QUESTION_BANK, seed: string) =>
  drawQuiz(bank, DEMO_QUESTION_COUNT, seed).questions.map((q) => `${q.id}:${q.answer}`).join("|");

const bioIds = new Set(BIOLOGY_QUESTION_BANK.map((t) => t.answer));

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
  assert.equal(ENGINE_QUESTION_BANK.length, 10);
  assert.ok(ENGINE_QUESTION_BANK.flatMap((t) => t.variants).length > DEMO_QUESTION_COUNT);
  assert.ok(INSTRUMENT_QUESTION_BANK.flatMap((t) => t.variants).length > DEMO_QUESTION_COUNT);
  const instrumentAssets = new Set(getDemo("tp_demo_instruments", "assets_seed")!.assets.map((a) => a.asset_id));
  for (const target of INSTRUMENT_QUESTION_BANK) assert.ok(instrumentAssets.has(target.answer), target.answer);
  assert.ok(!instrumentAssets.has("i_pince_amperemetrique"));
  assert.ok(!instrumentAssets.has("i_testeur_isolement"));
});

test("quiz draw rejects invalid counts, seeds and duplicate target ids", () => {
  assert.throws(() => drawQuiz(ENGINE_QUESTION_BANK, 0, "valid"), /count/);
  // The bank holds 20 questions: 10 targets × 2 formulations each.
  assert.throws(() => drawQuiz(ENGINE_QUESTION_BANK, 21, "valid"), /count/);
  // A session may draw more targets than the bank has, revisiting with
  // different formulations — but never more than the bank holds.
  assert.doesNotThrow(() => drawQuiz(ENGINE_QUESTION_BANK, 10, "valid"));
  assert.throws(() => drawQuiz(ENGINE_QUESTION_BANK, 5, "bad seed!"), /seed/);
  const duplicate = [ENGINE_QUESTION_BANK[0], ENGINE_QUESTION_BANK[0]];
  assert.throws(() => drawQuiz(duplicate, 1, "valid"), /Duplicate/);
});

test("quiz draw: session of 7 may revisit an instrument, never the same question", () => {
  const plan = drawQuiz(INSTRUMENT_QUESTION_BANK, 7, "revisit_seed");
  assert.equal(plan.questions.length, 7);
  assert.deepEqual(drawQuiz(INSTRUMENT_QUESTION_BANK, 7, "revisit_seed"), plan, "reproducible");
  assert.equal(new Set(plan.questions.map((q) => q.id)).size, 7, "no duplicate question");
  assert.equal(new Set(plan.questions.map((q) => q.flag)).size, 7, "unique validation flags");
  // five instruments, seven questions: exactly two instruments are asked twice
  const perTarget = new Map<string, number>();
  for (const q of plan.questions) perTarget.set(q.answer, (perTarget.get(q.answer) ?? 0) + 1);
  assert.equal(new Set(perTarget.keys()).size, 5, "all five instruments asked");
  assert.deepEqual([...perTarget.values()].sort(), [1, 1, 1, 2, 2], "two revisits with distinct formulations");
});

test("session length varies between 5 and 7 and is fixed per seed", () => {
  for (const seed of ["manifest_fixed_seed", "session_a", "session_b", "vary_seed"]) {
    const count = demoQuestionCount(seed);
    assert.ok(count >= 5 && count <= 7, `count for ${seed}`);
    assert.equal(count, demoQuestionCount(seed), "reproducible");
  }
  assert.ok(new Set(Array.from({ length: 12 }, (_, i) => demoQuestionCount(`count_seed_${String.fromCharCode(97 + i)}`))).size >= 2);
});

test("seeded manifests: displayed steps and validation rules describe the exact selected questions", () => {
  for (const id of ["tp_demo_engine", "tp_demo_instruments"]) {
    const m = getDemo(id, "manifest_fixed_seed")!;
    const quiz = m.simulation!.quiz!;
    assert.equal(m.tp.steps.length, 1 + demoQuestionCount("manifest_fixed_seed"));
    assert.ok(m.tp.steps.length >= 6 && m.tp.steps.length <= 8);
    assert.equal(m.simulation!.rules.length, 1 + demoQuestionCount("manifest_fixed_seed"));
    assert.deepEqual(getDemo(id, "manifest_fixed_seed"), m, "report reconstruction must be exact");
    quiz.questions.forEach((q, i) => {
      assert.ok(m.tp.steps[i + 1].action.startsWith(q.prompt));
      const rule = m.simulation!.rules[i + 1][0];
      assert.ok(rule.type === "state" && rule.key === q.flag);
    });
  }
});

test("home menu exposes exactly three demos; former simulations and legacy reports stay available", () => {
  assert.deepEqual(listDemos().map((d) => d.id), ["tp_demo_engine", "tp_demo_instruments", "tp_demo_biology"]);
  assert.deepEqual(listDemos().map((d) => d.label), [
    "Démo mécanique — Moteur automobile",
    "Démo génie électrique — Instruments de mesure",
    "Démo génie biologique — Matériel de laboratoire",
  ]);
  assert.ok(listDemos().every((d) => d.steps === DEMO_QUESTION_COUNT_MAX + 1));
  assert.equal(getDemoByDomain("mechanical")?.id, "tp_demo_mechanical");
  assert.equal(getDemoByDomain("electrical")?.id, "tp_demo_electrical");
  assert.equal(getDemoByDomain("biological")?.id, "tp_demo_biology");
  assert.equal(getDemo("tp_demo_engine", null)!.simulation!.quiz, undefined);
  assert.equal(getDemo("tp_demo_instruments", null)!.tp.steps.length, 11);
  assert.equal(getDemo("tp_demo_biology", null)!.tp.steps.length, 9);
  for (const id of ["tp_demo_mechanical", "tp_demo_electrical"]) assert.ok(getDemo(id), id);
});

test("biology questions refer only to the four supplied GLB models, with varied phrasings", () => {
  const bankCapacity = BIOLOGY_QUESTION_BANK.reduce((n, t) => n + t.variants.length, 0);
  assert.ok(bankCapacity > DEMO_QUESTION_COUNT_MAX, "la banque doit couvrir une séance de 7 questions");
  const counts = [DEMO_QUESTION_COUNT_MIN, Math.floor((DEMO_QUESTION_COUNT_MIN + DEMO_QUESTION_COUNT_MAX) / 2), DEMO_QUESTION_COUNT_MAX];
  for (const count of counts) {
    const seed = `bio_seed_${count}`;
    const m = getDemo("tp_demo_biology", seed)!;
    const quiz = m.simulation!.quiz!;
    assert.equal(quiz.questions.length, demoQuestionCount(seed), "tirage déterministe de 5 à 7 selon la graine");
    assert.equal(quiz.seed, seed);
    assert.equal(m.simulation!.rules.length, quiz.questions.length + 1, "une règle par question + la découverte");
    assert.deepEqual(m.simulation!.rules.slice(1).map((r) => (r[0] as { key: string }).key), quiz.questions.map((q) => q.flag), "règles dans l'ordre de la séance");
    for (const q of quiz.questions) assert.ok(bioIds.has(q.answer), `question sur un objet du banc : ${q.answer}`);
  }
  const m = getDemo("tp_demo_biology", "bio_seed_assets")!;
  assert.ok(m.assets.every((a) => a.role && a.hints?.length), `${m.assets.map((a) => a.asset_id)} : chaque objet embarque role/hints pour la découverte`);
  for (const asset of m.assets) {
    assert.ok(asset.url, asset.asset_id);
    assert.ok(existsSync(path.join(__dirname, "..", asset.url!.replace(/^\/assets\//, "assets/"))), asset.url!);
  }
});

test("instrument questions refer only to the five supplied GLB models", () => {
  const m = getDemo("tp_demo_instruments", "models_seed")!;
  for (const asset of m.assets) {
    assert.ok(asset.url);
    assert.ok(existsSync(path.join(__dirname, "..", asset.url!.replace(/^\/assets\//, "assets/"))), asset.url!);
  }
});
