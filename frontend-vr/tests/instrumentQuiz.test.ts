/**
 * Unit tests — instrument identification demo (tp_demo_instruments): quiz content,
 * progressive hints, wrong-answer feedback (never gives the answer away).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUMENTS, PULSE_AFTER_ERRORS, QUIZ, SITUATIONS, hintFor, wrongAnswerText } from "../src/sim/instrumentQuiz";

const byId = (id: string) => INSTRUMENTS.find((c) => c.id === id)!;

test("instrument quiz: every asked instrument exists and has two hints", () => {
  assert.equal(QUIZ.length, 5);
  assert.equal(SITUATIONS.length, 5);
  for (const id of [...QUIZ, ...SITUATIONS]) {
    const c = byId(id);
    assert.ok(c, id);
    assert.ok(c.hints[0].length > 20 && c.hints[1].length > 20, `${id}: hints`);
    assert.notEqual(c.hints[0], c.hints[1]);
    assert.ok(c.role.length > 40, `${id}: role`);
    assert.ok(c.example.length > 10, `${id}: example`);
  }
  assert.equal(new Set(INSTRUMENTS.map((c) => c.id)).size, INSTRUMENTS.length, "unique ids");
});

test("instrument quiz: hints get more precise with the errors", () => {
  const c = byId("i_oscilloscope");
  assert.equal(hintFor(c, 0), "");
  assert.equal(hintFor(c, 1), c.hints[0]);
  assert.equal(hintFor(c, 2), c.hints[1]);
  assert.match(hintFor(c, PULSE_AFTER_ERRORS), /mis en évidence/);
  assert.ok(hintFor(c, 7).startsWith(c.hints[1]));
});

test("instrument quiz: a wrong answer names what was pointed at, never the expected instrument", () => {
  const allIds = new Set([...QUIZ, ...SITUATIONS]);
  for (const askedId of allIds) {
    for (const pickedId of allIds) {
      if (pickedId === askedId) continue;
      for (let errors = 1; errors <= 4; errors++) {
        const text = wrongAnswerText(byId(pickedId), byId(askedId), errors);
        assert.ok(text.includes(byId(pickedId).name), text);
        assert.ok(!text.toLowerCase().includes(byId(askedId).name.toLowerCase()), `answer leaked: ${text}`);
      }
    }
  }
});
