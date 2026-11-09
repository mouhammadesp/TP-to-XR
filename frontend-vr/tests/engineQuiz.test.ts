/**
 * Unit tests — engine-bay identification demo: quiz content, progressive hints,
 * wrong-answer feedback (never gives the answer away).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder, NullEngine, PointerEventTypes, PointerInfo, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { COMPONENTS, EngineQuizBehavior, PULSE_AFTER_ERRORS, QUIZ, hintFor, wrongAnswerText } from "../src/sim/engineQuiz";
import type { EngineComponent } from "../src/sim/engineQuiz";
import type { PaintedSurface } from "../src/ui/textCanvas";
import { SimulationSpec } from "../src/sim/conditions";
import { Simulation } from "../src/sim/Simulation";
import type { PlacedAsset } from "../src/scenes/TPScene";
import { TPSession } from "../src/utils/analytics";
import type { SceneAsset } from "../src/utils/manifest";

const byId = (id: string) => COMPONENTS.find((c) => c.id === id)!;

test("engine quiz: every selectable component has a role and two progressive hints", () => {
  assert.equal(QUIZ.length, 5, "the legacy fallback remains available");
  assert.equal(COMPONENTS.length, 10);
  for (const c of COMPONENTS) {
    assert.ok(c.hints[0].length > 20 && c.hints[1].length > 20, `${c.id}: hints`);
    assert.notEqual(c.hints[0], c.hints[1]);
    assert.ok(c.role.length > 40, `${c.id}: role`);
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
  for (const asked of COMPONENTS) {
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

test("engine quiz: a seeded five-question session binds prompts, zones, hints, XR/mouse answers and summary", () => {
  const questions = [
    { id: "q_cover", answer: "engine_cover", prompt: "Repérez le cache TFSI.", flag: "found_engine_cover" },
    { id: "q_brake", answer: "brake_fluid", prompt: "Repérez le liquide de frein.", flag: "found_brake_fluid" },
    { id: "q_oil", answer: "oil_cap", prompt: "Repérez le bouchon d'huile.", flag: "found_oil_cap" },
    { id: "q_intake", answer: "intake_duct", prompt: "Repérez le conduit d'admission.", flag: "found_intake_duct" },
    { id: "q_dip", answer: "dipstick", prompt: "Repérez la jauge.", flag: "found_dipstick" },
  ];
  const stateRule = (key: string): SimulationSpec["rules"][number] => [{ type: "state", key, label: key }];
  const spec: SimulationSpec = {
    kind: "engine_quiz",
    quiz: { seed: "frontend_fixed_seed", questions },
    targets: [],
    rules: [stateRule("explored"), ...questions.map((q) => stateRule(q.flag))],
    completion: "Terminé",
  };
  // Text textures need OffscreenCanvas, absent from Node: substitute only label painting.
  const prototype = EngineQuizBehavior.prototype as unknown as Record<string, unknown>;
  const originalMakeLabel = prototype.makeLabel;
  prototype.makeLabel = (c: EngineComponent, at: Vector3) => {
    const label = MeshBuilder.CreatePlane(`engine_label_${c.id}`, { width: 0.3, height: 0.055 });
    label.position = at;
    label.setEnabled(false);
    return { label, labelSurface: { redraw: () => {}, texture: { hasAlpha: false } } as unknown as PaintedSurface };
  };
  const engine = new NullEngine();
  try {
    const scene = new Scene(engine);
    const handle = MeshBuilder.CreateBox("grab_x_moteur", { size: 1 }, scene);
    for (const c of COMPONENTS) {
      const node = new TransformNode(`zone__${c.id}`, scene);
      node.parent = handle;
      node.scaling.setAll(0.1);
    }
    const assets: PlacedAsset[] = [{
      asset: { asset_id: "x_moteur", name: "Compartiment Audi" } as SceneAsset,
      handle,
      meshes: [handle],
      label: MeshBuilder.CreatePlane("label_motor", {}, scene),
      loaded: true,
      error: null,
      builtin: null,
    }];
    const session = new TPSession("tp_demo_engine", "test", spec.rules.map(() => new Set<string>()));
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
      const pickedMesh = scene.getMeshByName(`engine_zone_${id}`);
      scene.onPointerObservable.notifyObservers({ type, pickInfo: { hit: true, pickedMesh }, event: { pointerId: 1, pointerType } } as unknown as PointerInfo);
    };
    assert.equal(scene.getMeshByName("engine_quiz_panel"), null, "no redundant floating question panel");
    for (const id of ["oil_cap", "dipstick", "coolant_tank"]) {
      point(id, PointerEventTypes.POINTERMOVE);
      sim.tick(0.5);
    }
    assert.deepEqual(validated, [0]);
    session.goTo(1, "auto");
    sim.onStepChanged();

    for (let i = 0; i < 3; i++) point("oil_cap", PointerEventTypes.POINTERTAP);
    assert.equal(sim.stepValidated, false);
    assert.match(notifications.at(-1)!, /TFSI.*clignote/);
    sim.tick(0.2);
    assert.ok(scene.getMeshByName("engine_zone_engine_cover")!.visibility > 0, "expected zone pulses after three errors");
    point("engine_cover", PointerEventTypes.POINTERDOWN, "xr-right");
    assert.equal(sim.stepValidated, true);
    assert.equal(scene.getMeshByName("engine_zone_engine_cover")!.metadata.component, questions[0].answer);
    assert.equal(scene.getMeshByName("engine_label_engine_cover")!.isEnabled(), true);

    questions.slice(1).forEach((q, offset) => {
      const step = offset + 2;
      session.goTo(step, "auto");
      sim.onStepChanged();
      point(q.answer, offset % 2 ? PointerEventTypes.POINTERTAP : PointerEventTypes.POINTERDOWN, offset % 2 ? "mouse" : "xr-left");
      assert.equal(sim.stepValidated, true, `${q.id} selects its own zone`);
      assert.equal(scene.getMeshByName(`engine_zone_${q.answer}`)!.metadata.component, q.answer);
    });
    assert.deepEqual(validated, [0, 1, 2, 3, 4, 5]);
    assert.equal(sim.completed, true);
    assert.match(sim.behavior.summary!()[0], /5\/5/);
    assert.match(sim.behavior.summary!()[1], /8 tentatives.*3 erreurs/);
    assert.equal(session.summary().quiz_seed, "frontend_fixed_seed");
    assert.equal(session.finish(), true);
  } finally {
    prototype.makeLabel = originalMakeLabel;
    engine.dispose();
  }
});
