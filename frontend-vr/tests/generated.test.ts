/**
 * Unit tests — palier P1: generated TPs ("generic" simulation) run on the existing
 * validation engine. The last tests drive the REAL Simulation class on a Babylon
 * NullEngine (no GPU): release, snapping, anchored targets, "near", step validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { anchoredPosition, nearReached, SimulationSpec } from "../src/sim/conditions";
import { Simulation } from "../src/sim/Simulation";
import { TPSession } from "../src/utils/analytics";
import { parseManifest, SceneAsset } from "../src/utils/manifest";
import type { PlacedAsset } from "../src/scenes/TPScene";

/** Generic simulation as produced by backend/src/services/interactions.ts (magnetism TP). */
const SPEC: SimulationSpec = {
  kind: "generic",
  targets: [
    { id: "t_feuille_etabli", label: "", position: { x: 0, y: 0.9, z: 0.35 }, radius: 0.2, accepts: ["a04_feuille"], marker: "disc" },
    { id: "t_boussole_sur_feuille", label: "", position: { x: 0, y: 0.9, z: 0 }, radius: 0.18, accepts: ["a01_boussole"], marker: "disc", anchor: { asset: "a04_feuille", mode: "top" } },
    { id: "t_pres_boussole", label: "", position: { x: 0, y: 0.9, z: 0 }, radius: 0.1, accepts: [], marker: "disc", anchor: { asset: "a01_boussole", mode: "base" } },
  ],
  rules: [
    [
      { type: "placed", asset: "a04_feuille", target: "t_feuille_etabli", label: "Feuille sur l'établi" },
      { type: "placed", asset: "a01_boussole", target: "t_boussole_sur_feuille", label: "Boussole sur Feuille" },
    ],
    [{ type: "held", asset: "a02_aimant", seconds: 2, label: "Aimant examiné en main (2 s)" }],
    [{ type: "near", asset: "a02_aimant", target: "t_pres_boussole", distance: 0.19, label: "Aimant approché de Boussole" }],
    [],
  ],
  completion: "Toutes les manipulations vérifiables de ce TP ont été réalisées.",
};

test("near: needs a real move during the step AND the target distance", () => {
  const target = { x: 0, z: 0 };
  assert.equal(nearReached({ x: 0.1, z: 0 }, { x: 0.1, z: 0 }, target, 0.2), false, "already close at the start: not an action");
  assert.equal(nearReached({ x: 0.6, z: 0 }, { x: 1, z: 0 }, target, 0.2), false, "moved but still far");
  assert.equal(nearReached({ x: 0.15, z: 0 }, { x: 1, z: 0 }, target, 0.2), true);
});

test("anchored targets: on top of the object, or at its foot", () => {
  assert.deepEqual(anchoredPosition({ x: 0.2, y: 0.9, z: -0.1 }, 0.004, "top"), { x: 0.2, y: 0.904, z: -0.1 });
  assert.deepEqual(anchoredPosition({ x: 0.2, y: 0.9, z: -0.1 }, 0.05, "base"), { x: 0.2, y: 0.9, z: -0.1 });
});

test("manifest: a generated TP (generic simulation, anchors, coverage) is accepted; unknown kinds are not", () => {
  const raw = {
    id: "tp_20261019_abcdef",
    created_at: "2026-10-19T00:00:00Z",
    template: { version: "workshop_v3", url: "/api/workshop/scene.babylon" },
    tp: { title: "Aimant", domain: "other", duration_minutes: 20, steps: [1, 2, 3, 4].map((order) => ({ order, action: `Étape ${order}`, safety: null })), safety_warnings: [] },
    color_scheme: { ambient: "#404040", key_light: "#FFFFFF", material_base: "#808080" },
    assets: [],
    safety_signs: [],
    unplaced: [],
    warnings: [],
    reasoning: "",
    simulation: SPEC,
    interactions: { steps: [{ step: 4, coverage: "none", verified: [], unverified: ["« noter » — prise de notes"] }], issues: [] },
  };
  const { manifest } = parseManifest(raw);
  assert.equal(manifest.simulation?.kind, "generic");
  assert.deepEqual(manifest.simulation?.targets[1].anchor, { asset: "a04_feuille", mode: "top" });
  assert.equal(manifest.interactions?.steps[0].coverage, "none");
  assert.throws(() => parseManifest({ ...raw, simulation: { ...SPEC, kind: "chemistry" } }), /simulation/);
});

test("session: a step the engine cannot check is 'done' (non vérifiée), never 'validated' nor 'skipped'", () => {
  let t = 0;
  const s = new TPSession("tp_x", "anon", [new Set(), new Set(), new Set()], () => (t += 1000));
  s.interactive = true;
  s.verifiable = [true, false, true];
  s.recordSim("step_validated", "étape 1");
  s.next("auto");
  s.next("button"); // step 2: nothing to check → moved on
  s.recordSim("step_skipped", "étape 3");
  s.finish();
  assert.deepEqual(s.stepsDetail().map((d) => d.status), ["validated", "done", "skipped"]);
});

/* ------------------------------------------------------------------ */
/* The real engine on a NullEngine                                       */
/* ------------------------------------------------------------------ */

function world() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mk = (id: string, x: number, z: number, size: { w: number; h: number; d: number }): PlacedAsset => {
    const handle = MeshBuilder.CreateBox(`grab_${id}`, { width: size.w, height: size.h, depth: size.d }, scene);
    handle.position.y = size.h / 2;
    handle.bakeCurrentTransformIntoVertices(); // origin at the BASE center, like TPScene's grab handles
    const body = MeshBuilder.CreateBox(`body_${id}`, { width: size.w, height: size.h, depth: size.d }, scene);
    body.position.y = size.h / 2;
    body.parent = handle;
    handle.position = new Vector3(x, 0.9, z);
    const asset = { asset_id: id, name: id } as SceneAsset;
    return { asset, handle, meshes: [body], label: MeshBuilder.CreatePlane(`l_${id}`, {}, scene), loaded: true, error: null, builtin: null };
  };
  const assets = [
    mk("a04_feuille", -1.6, -0.7, { w: 0.297, h: 0.004, d: 0.21 }), // on a shelf in the real scene: far from its target
    mk("a01_boussole", 0.8, -0.3, { w: 0.08, h: 0.02, d: 0.08 }),
    mk("a02_aimant", -0.8, -0.3, { w: 0.1, h: 0.02, d: 0.02 }),
  ];
  const session = new TPSession("tp_gen", "anon", SPEC.rules.map(() => new Set<string>()));
  session.interactive = true;
  const validated: number[] = [];
  const spec: SimulationSpec = JSON.parse(JSON.stringify(SPEC));
  const sim = new Simulation(scene, spec, assets, {
    session,
    onChecklistChanged: () => {},
    onStepValidated: (i) => validated.push(i),
    toast: () => {},
    refreshShadows: () => {},
  });
  const byId = (id: string) => assets.find((a) => a.asset.asset_id === id)!;
  return { engine, scene, sim, session, validated, byId, spec };
}

test("engine: a wrong drop validates nothing; the expected drops snap and validate step 1", () => {
  const { sim, validated, spec, engine } = world();
  assert.equal(sim.hasRule(0), true);
  assert.equal(sim.hasRule(3), false);

  sim.debugRelease("a04_feuille", 1.2, 0.9, -0.5); // far from its spot: no snap, no validation
  assert.equal(sim.isPlaced("a04_feuille", "t_feuille_etabli"), false);
  assert.deepEqual(validated, []);
  assert.deepEqual(sim.checklist().map((c) => c.done), [false, false]);

  sim.debugRelease("a04_feuille", 0.08, 0.9, 0.3); // within the capture radius → snaps exactly on the spot
  assert.equal(sim.isPlaced("a04_feuille", "t_feuille_etabli"), true);
  assert.deepEqual(validated, [], "the compass is not on the sheet yet");

  sim.tick(0.016); // the anchored target follows the sheet (top of the sheet)
  const onSheet = spec.targets.find((t) => t.id === "t_boussole_sur_feuille")!;
  assert.ok(Math.abs(onSheet.position.z - 0.35) < 1e-6 && Math.abs(onSheet.position.y - 0.904) < 1e-3, JSON.stringify(onSheet.position));

  sim.debugRelease("a01_boussole", 0.02, 0.9, 0.37);
  assert.equal(sim.isPlaced("a01_boussole", "t_boussole_sur_feuille"), true);
  assert.deepEqual(validated, [0]);
  engine.dispose();
});

test("engine: inspect needs 2 s in hand; a short grab does not count", () => {
  const { sim, session, validated, engine } = world();
  session.goTo(1, "button");
  sim.onStepChanged();
  sim.onInteraction({ hand: "right", gesture: "grab", target: "a02_aimant", durationMs: 800 });
  assert.deepEqual(validated, []);
  sim.onInteraction({ hand: "right", gesture: "grab", target: "a02_aimant", durationMs: 2300 });
  assert.deepEqual(validated, [1]);
  engine.dispose();
});

test("engine: approach is validated when the magnet is brought near the compass, not before", () => {
  const { sim, session, validated, byId, engine } = world();
  session.goTo(2, "button");
  sim.onStepChanged();
  sim.tick(0.016);
  assert.deepEqual(validated, [], "nothing moved yet");
  const magnet = byId("a02_aimant").handle;
  magnet.position = new Vector3(0.3, 1.1, -0.3); // held, still 50 cm away
  sim.tick(0.016);
  assert.deepEqual(validated, []);
  magnet.position = new Vector3(0.68, 1.0, -0.3); // held 12 cm from the compass
  sim.tick(0.016);
  assert.deepEqual(validated, [2]);
  assert.ok(session.summary().interactions.some((e) => e.event === "sim_event" && e.kind === "near"));
  engine.dispose();
});

test("engine: 'Suivant' on a step without rule cannot validate it", () => {
  const { sim, session, validated, engine } = world();
  session.goTo(3, "button");
  sim.onStepChanged();
  sim.tick(0.3);
  assert.equal(sim.stepValidated, false);
  assert.deepEqual(validated, []);
  engine.dispose();
});
