/**
 * Unit tests — instrument identification demo (tp_demo_instruments): quiz content,
 * progressive hints, wrong-answer feedback (never gives the answer away).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder, NullEngine, PointerEventTypes, PointerInfo, Scene } from "@babylonjs/core";
import { SimulationSpec } from "../src/sim/conditions";
import { Simulation } from "../src/sim/Simulation";
import { INSTRUMENTS, PULSE_AFTER_ERRORS, QUIZ, SITUATIONS, hintFor, wrongAnswerText } from "../src/sim/instrumentQuiz";
import type { PlacedAsset } from "../src/scenes/TPScene";
import { TPSession } from "../src/utils/analytics";
import type { SceneAsset } from "../src/utils/manifest";

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

test("instrument quiz: discovery and all ten answers validate the real simulation steps", () => {
  const stateRule = (key: string): SimulationSpec["rules"][number] => [{ type: "state", key, label: key }];
  // Same state keys as tp_demo_instruments in backend/src/services/demoTps.ts.
  const spec: SimulationSpec = {
    kind: "instrument_quiz",
    targets: [],
    rules: [
      stateRule("explored"),
      ...QUIZ.map((id) => stateRule(`found_${id.replace(/^i_/, "")}`)),
      ...SITUATIONS.map((id) => stateRule(`solved_${id.replace(/^i_/, "")}`)),
    ],
    completion: "Terminé",
  };
  const engine = new NullEngine();
  try {
    const scene = new Scene(engine);
    const assets: PlacedAsset[] = INSTRUMENTS.map(({ id, name }) => {
      const handle = MeshBuilder.CreateBox(`grab_${id}`, { size: 0.1 }, scene);
      return {
        asset: { asset_id: id, name } as SceneAsset,
        handle,
        meshes: [handle],
        label: MeshBuilder.CreatePlane(`label_${id}`, {}, scene),
        loaded: true,
        error: null,
        builtin: null,
      };
    });
    const session = new TPSession("tp_demo_instruments", "test", spec.rules.map(() => new Set<string>()));
    session.interactive = true;
    const validated: number[] = [];
    const sim = new Simulation(scene, spec, assets, {
      session,
      onChecklistChanged: () => {},
      onStepValidated: (index) => validated.push(index),
      toast: () => {},
      refreshShadows: () => {},
    });
    const point = (id: string, type: PointerEventTypes) => {
      const pickedMesh = assets.find((a) => a.asset.asset_id === id)!.handle;
      scene.onPointerObservable.notifyObservers({ type, pickInfo: { pickedMesh }, event: { pointerType: "mouse" } } as unknown as PointerInfo);
    };

    for (const instrument of INSTRUMENTS) {
      point(instrument.id, PointerEventTypes.POINTERMOVE);
      sim.tick(0.5);
    }
    assert.deepEqual(validated, [0], "la découverte des cinq instruments valide la première étape");
    session.goTo(1, "auto");
    sim.onStepChanged();

    const questions = [...QUIZ, ...SITUATIONS];
    questions.forEach((id, offset) => {
      const step = offset + 1;
      assert.equal(session.step, step);
      point(id, PointerEventTypes.POINTERTAP);
      assert.equal(sim.stepValidated, true, `bonne réponse à l'étape ${step + 1} (${id})`);
      if (step < questions.length) {
        session.goTo(step + 1, "auto");
        sim.onStepChanged();
      }
    });
    assert.deepEqual(validated, Array.from({ length: 11 }, (_, index) => index));
    assert.equal(sim.completed, true);
  } finally {
    engine.dispose();
  }
});


test("instrument quiz: seeded questions, progressive highlight and XR/mouse selections stay synchronized", () => {
  const questions = [
    { id: "q_digital", answer: "i_multimetre_num", prompt: "Mesurez numériquement une tension.", flag: "answered_q_digital" },
    { id: "q_scope", answer: "i_oscilloscope", prompt: "Observez une forme d'onde.", flag: "answered_q_scope" },
    { id: "q_supply", answer: "i_alim_dc", prompt: "Alimentez un circuit sous 5 V.", flag: "answered_q_supply" },
    { id: "q_solder", answer: "i_station_soudage", prompt: "Brasez un composant.", flag: "answered_q_solder" },
    { id: "q_analog", answer: "i_multimetre_ana", prompt: "Lisez un cadran à aiguille.", flag: "answered_q_analog" },
  ];
  const stateRule = (key: string): SimulationSpec["rules"][number] => [{ type: "state", key, label: key }];
  const spec: SimulationSpec = {
    kind: "instrument_quiz",
    quiz: { seed: "instrument_frontend_seed", questions },
    targets: [],
    rules: [stateRule("explored"), ...questions.map((q) => stateRule(q.flag))],
    completion: "Terminé",
  };
  assert.equal(new Set(questions.map((q) => q.id)).size, 5);
  assert.equal(new Set(questions.map((q) => q.answer)).size, 5);
  const engine = new NullEngine();
  try {
    const scene = new Scene(engine);
    const assets: PlacedAsset[] = INSTRUMENTS.map(({ id, name }) => {
      const handle = MeshBuilder.CreateBox(`grab_${id}`, { size: 0.1 }, scene);
      return {
        asset: { asset_id: id, name } as SceneAsset,
        handle,
        meshes: [handle],
        label: MeshBuilder.CreatePlane(`label_${id}`, {}, scene),
        loaded: true,
        error: null,
        builtin: null,
      };
    });
    const session = new TPSession("tp_demo_instruments", "test", spec.rules.map(() => new Set<string>()));
    session.interactive = true;
    session.quizSeed = spec.quiz!.seed;
    const validated: number[] = [];
    const notifications: string[] = [];
    const sim = new Simulation(scene, spec, assets, {
      session,
      onChecklistChanged: () => {},
      onStepValidated: (index) => validated.push(index),
      toast: () => {},
      notify: (_kind, title, text) => notifications.push(`${title} ${text}`),
      refreshShadows: () => {},
    });
    const point = (id: string, type: PointerEventTypes, pointerType = "mouse") => {
      const pickedMesh = assets.find((a) => a.asset.asset_id === id)!.handle;
      scene.onPointerObservable.notifyObservers({ type, pickInfo: { pickedMesh }, event: { pointerType } } as unknown as PointerInfo);
    };
    for (const instrument of INSTRUMENTS) {
      point(instrument.id, PointerEventTypes.POINTERMOVE);
      sim.tick(0.5);
    }
    assert.deepEqual(validated, [0]);
    session.goTo(1, "auto");
    sim.onStepChanged();

    // Mouse down alone does not answer; the completed click produces exactly one attempt.
    point("i_multimetre_ana", PointerEventTypes.POINTERDOWN);
    assert.equal(notifications.length, 0);
    for (let i = 0; i < 3; i++) {
      point("i_multimetre_ana", PointerEventTypes.POINTERDOWN);
      point("i_multimetre_ana", PointerEventTypes.POINTERTAP);
    }
    assert.equal(notifications.length, 3);
    assert.equal(sim.stepValidated, false);
    sim.tick(0.2);
    const digital = assets.find((a) => a.asset.asset_id === "i_multimetre_num")!.handle;
    const analog = assets.find((a) => a.asset.asset_id === "i_multimetre_ana")!.handle;
    assert.ok(digital.scaling.x > analog.scaling.x, "only the expected instrument pulses after three errors");
    point("i_multimetre_num", PointerEventTypes.POINTERDOWN, "xr-right");
    assert.equal(sim.stepValidated, true);
    const answers = session.summary().interactions.filter((e) => e.event === "hand_interaction");
    const lastAnswer = answers.at(-1);
    assert.ok(lastAnswer?.event === "hand_interaction");
    assert.equal(lastAnswer.gesture, "grab");

    questions.slice(1).forEach((q, offset) => {
      const step = offset + 2;
      session.goTo(step, "auto");
      sim.onStepChanged();
      point(q.answer, PointerEventTypes.POINTERTAP);
      assert.equal(sim.stepValidated, true, `${q.id} selects its own instrument`);
    });
    assert.deepEqual(validated, [0, 1, 2, 3, 4, 5]);
    assert.equal(sim.completed, true);
    assert.match(sim.behavior.summary!()[1], /5\/5 questions réussies/);
    assert.match(sim.behavior.summary!()[2], /8 tentatives.*3 erreurs/);
    assert.equal(session.summary().quiz_seed, "instrument_frontend_seed");
    assert.equal(session.finish(), true);
  } finally {
    engine.dispose();
  }
});
