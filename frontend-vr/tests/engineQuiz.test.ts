/**
 * Unit tests — engine-bay identification demo: quiz content, progressive hints,
 * wrong-answer feedback (never gives the answer away).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPONENTS, PULSE_AFTER_ERRORS, QUIZ, hintFor, wrongAnswerText } from "../src/sim/engineQuiz";

const byId = (id: string) => COMPONENTS.find((c) => c.id === id)!;

test("engine quiz: every asked component exists and has two hints", () => {
  assert.equal(QUIZ.length, 5);
  for (const id of QUIZ) {
    const c = byId(id);
    assert.ok(c, id);
    assert.ok(c.hints[0].length > 20 && c.hints[1].length > 20, `${id}: hints`);
    assert.notEqual(c.hints[0], c.hints[1]);
    assert.ok(c.role.length > 40, `${id}: role`);
  }
  assert.equal(new Set(COMPONENTS.map((c) => c.id)).size, COMPONENTS.length, "unique ids");
});

test("engine quiz: hints get more precise with the errors, the part pulses after 3", () => {
  const c = byId("dipstick");
  assert.equal(hintFor(c, 0), "");
  assert.equal(hintFor(c, 1), c.hints[0]);
  assert.equal(hintFor(c, 2), c.hints[1]);
  assert.match(hintFor(c, PULSE_AFTER_ERRORS), /clignote/);
  assert.ok(hintFor(c, 7).startsWith(c.hints[1]));
});

test("engine quiz: a wrong answer names what was pointed at, never the expected part", () => {
  for (const asked of QUIZ.map(byId)) {
    for (const picked of COMPONENTS.filter((c) => c.id !== asked.id)) {
      for (let errors = 1; errors <= 4; errors++) {
        const text = wrongAnswerText(picked, asked, errors);
        assert.ok(text.includes(picked.name), text);
        assert.ok(!text.toLowerCase().includes(asked.name.toLowerCase()), `answer leaked: ${text}`);
      }
    }
  }
});

test("engine quiz: parts outside the engine say so", () => {
  const text = wrongAnswerText(byId("washer_cap"), byId("oil_cap"), 1);
  assert.match(text, /ne fait pas partie du moteur/);
  assert.doesNotMatch(wrongAnswerText(byId("engine_cover"), byId("oil_cap"), 1), /ne fait pas partie/);
  for (const id of ["battery", "washer_cap", "brake_fluid"]) assert.match(byId(id).system, /ne fait pas partie du moteur/);
});
