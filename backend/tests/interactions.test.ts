/**
 * Backend tests — palier P1: checkable actions extracted from a TP and compiled
 * into the generic validation engine's rules (services/interactions.ts).
 *
 *   npm test   (node:test + ts-node, no network, no API key)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "fs";
import path from "path";
import { ACTION_PARAMS, applyStartConstraints, buildSimulation, validateInteractions } from "../src/services/interactions";
import { resolvePlacement } from "../src/services/placement";
import { LLMInteractionsResult, LLMPlacementResult, Step } from "../src/schemas/tp";

/* ------------------------------------------------------------------ */
/* Fixture: a TP never authored as a demo (magnetism)                    */
/* ------------------------------------------------------------------ */

const step = (order: number, action: string, key_points: string[] = []): Step => ({ order, action, duration_sec: 60, key_points, safety: null });

const STEPS: Step[] = [
  step(1, "Poser la feuille blanche A4 sur la table, puis poser la boussole au centre de la feuille blanche."),
  step(2, "Inspecter l'aimant droit et repérer ses pôles nord et sud."),
  step(3, "Approcher lentement le pôle nord de l'aimant droit de la boussole."),
  step(4, "Observer la déviation de l'aiguille de la boussole et noter son sens."),
  step(5, "Mesurer avec la règle graduée la distance entre l'aimant droit et la boussole."),
];
const ITEMS = [
  { asset_id: "a01_boussole", name: "Boussole" },
  { asset_id: "a02_aimant_droit", name: "Aimant droit" },
  { asset_id: "a03_regle_graduee", name: "Règle graduée" },
  { asset_id: "a04_feuille_blanche_a4", name: "Feuille blanche A4" },
];

/** What the extractor (LLM) proposes — including two wrong proposals that must be rejected. */
const PROPOSAL: LLMInteractionsResult = {
  steps: [
    {
      step: 1,
      actions: [
        { type: "place", object: "a04_feuille_blanche_a4", support: "workbench", target: null, evidence: "Poser la feuille blanche A4 sur la table" },
        { type: "place", object: "a01_boussole", support: "a04_feuille_blanche_a4", target: null, evidence: "poser la boussole au centre de la feuille blanche" },
      ],
      unsupported: [],
    },
    {
      step: 2,
      actions: [{ type: "inspect", object: "a02_aimant_droit", support: null, target: null, evidence: "Inspecter l'aimant droit" }],
      unsupported: [{ text: "repérer ses pôles nord et sud", reason: "identification non vérifiable" }],
    },
    {
      step: 3,
      actions: [{ type: "approach", object: "a02_aimant_droit", support: null, target: "a01_boussole", evidence: "Approcher lentement le pôle nord de l'aimant droit de la boussole" }],
      unsupported: [],
    },
    {
      step: 4,
      // Wrong: what is observed is the needle's deviation, not the compass itself.
      actions: [{ type: "inspect", object: "a01_boussole", support: null, target: null, evidence: "Observer la déviation de l'aiguille de la boussole" }],
      unsupported: [{ text: "noter son sens", reason: "prise de notes" }],
    },
    {
      step: 5,
      // Wrong: hallucinated evidence (not in the text).
      actions: [{ type: "place", object: "a03_regle_graduee", support: "workbench", target: null, evidence: "Poser la règle graduée sur la table" }],
      unsupported: [],
    },
  ],
};

/** Scene as the placement would resolve it (sheet starts on a shelf, the rest on the bench). */
function scene(proposalOverride?: LLMPlacementResult) {
  const checked = validateInteractions(STEPS, ITEMS, PROPOSAL);
  const llmPlacement: LLMPlacementResult = proposalOverride ?? {
    placements: ITEMS.map((i, k) => ({ asset_id: i.asset_id, zone: "zone_workbench", slot: null, offset: { x: -0.8 + 0.5 * k, z: -0.3 }, rotation_y: 0, target_size_m: 0.2, color_override: null })),
    color_scheme: { ambient: "#404040", key_light: "#FFFFFF", material_base: "#808080" },
    safety_warnings: [],
    reasoning: "",
  };
  const plan = resolvePlacement(applyStartConstraints(llmPlacement, checked.actions), ITEMS.map((i) => ({ id: i.asset_id, name: i.name })), STEPS.map((s) => s.action));
  return { checked, plan, compiled: buildSimulation(STEPS, ITEMS, checked, plan.placements) };
}

/* ------------------------------------------------------------------ */

test("validation: keeps the actions the text really asks for (place ×2, inspect, approach)", () => {
  const { actions } = validateInteractions(STEPS, ITEMS, PROPOSAL);
  assert.deepEqual(
    actions.map((a) => `${a.step}:${a.type}:${a.object}:${a.support ?? a.target ?? "-"}`),
    ["1:place:a04_feuille_blanche_a4:workbench", "1:place:a01_boussole:a04_feuille_blanche_a4", "2:inspect:a02_aimant_droit:-", "3:approach:a02_aimant_droit:a01_boussole"]
  );
});

test("validation: rejects an observation of a phenomenon and a quote absent from the document", () => {
  const { actions, issues } = validateInteractions(STEPS, ITEMS, PROPOSAL);
  assert.ok(!actions.some((a) => a.step === 4 || a.step === 5));
  assert.ok(issues.some((i) => i.startsWith("Étape 4") && i.includes("n'est pas l'objet")), issues.join("\n"));
  assert.ok(issues.some((i) => i.startsWith("Étape 5") && i.includes("citation absente")), issues.join("\n"));
});

test("rules: generated targets and conditions for the existing engine (placed / held / near)", () => {
  const { compiled, plan } = scene();
  const sim = compiled.simulation!;
  assert.equal(sim.kind, "generic");
  assert.equal(sim.rules.length, STEPS.length);
  assert.deepEqual(sim.rules.map((r) => r.map((c) => c.type)), [["placed", "placed"], ["held"], ["near"], [], []]);

  // Sheet → a free spot on the bench, far from where it starts (a shelf).
  const sheetStart = plan.placements.find((p) => p.asset_id === "a04_feuille_blanche_a4")!;
  assert.ok(sheetStart.zone.startsWith("zone_shelf"), `la feuille doit partir d'une étagère (${sheetStart.zone})`);
  const benchRule = sim.rules[0][0] as { type: "placed"; target: string };
  const spot = sim.targets.find((t) => t.id === benchRule.target)!;
  assert.equal(spot.position.y, 0.9);
  assert.deepEqual(spot.accepts, ["a04_feuille_blanche_a4"]);
  assert.equal(spot.anchor, undefined);
  // The spot does not overlap any object already on the bench.
  for (const p of plan.placements.filter((x) => x.zone === "zone_workbench")) {
    assert.ok(Math.hypot(p.position.x - spot.position.x, p.position.z - spot.position.z) >= p.target_size_m / 2 + 0.1, p.asset_id);
  }

  // Compass → on top of the sheet (anchored: follows the sheet, height from the loaded model).
  const onSheet = sim.targets.find((t) => t.id === (sim.rules[0][1] as { target: string }).target)!;
  assert.deepEqual(onSheet.anchor, { asset: "a04_feuille_blanche_a4", mode: "top" });
  assert.deepEqual(onSheet.accepts, ["a01_boussole"]);

  // Inspect = held 2 s; approach = near the compass, distance from the action library.
  assert.deepEqual(sim.rules[1][0], { type: "held", asset: "a02_aimant_droit", seconds: ACTION_PARAMS.inspectSeconds, label: "Aimant droit examiné en main (2 s)" });
  const near = sim.rules[2][0] as { type: "near"; target: string; distance: number };
  assert.deepEqual(sim.targets.find((t) => t.id === near.target)!.anchor, { asset: "a01_boussole", mode: "base" });
  assert.ok(near.distance > ACTION_PARAMS.nearMargin && near.distance <= ACTION_PARAMS.nearMax);
});

test("coverage: full / partial / none, and unchecked parts are listed (never silently dropped)", () => {
  const { compiled } = scene();
  const cov = compiled.report.steps.map((s) => s.coverage);
  assert.deepEqual(cov, ["full", "partial", "full", "none", "none"]);
  const s2 = compiled.report.steps[1];
  assert.ok(s2.unverified.some((u) => u.includes("repérer ses pôles")));
  const s4 = compiled.report.steps[3];
  assert.ok(s4.unverified.some((u) => u.includes("noter son sens")));
  assert.ok(s4.unverified.some((u) => u.includes("Observer la déviation")), "the rejected proposal is reported as not checked");
  // Step 5: the AI forgot "Mesurer" → the deterministic safety net reports it anyway.
  assert.ok(compiled.report.steps[4].unverified.some((u) => u.startsWith("« Mesurer")), compiled.report.steps[4].unverified.join(" | "));
});

test("safety net: a step is never 'full' when it also asks for an action the AI did not report", () => {
  const steps = [step(1, "Poser le bécher sur la paillasse et mesurer sa température.")];
  const items = [{ asset_id: "a01_becher", name: "Bécher" }];
  const checked = validateInteractions(steps, items, {
    steps: [{ step: 1, actions: [{ type: "place", object: "a01_becher", support: "workbench", target: null, evidence: "Poser le bécher sur la paillasse" }], unsupported: [] }],
  });
  const plan = resolvePlacement(applyStartConstraints({ placements: [], color_scheme: { ambient: "#404040", key_light: "#FFFFFF", material_base: "#808080" }, safety_warnings: [], reasoning: "" }, checked.actions), [{ id: "a01_becher", name: "Bécher" }]);
  const { report } = buildSimulation(steps, items, checked, plan.placements);
  assert.equal(report.steps[0].coverage, "partial");
  assert.ok(report.steps[0].unverified.some((u) => u.includes("mesurer")));
});

test("insufficiently precise document: no support, unknown objects, vague steps → no rule, explicit ambiguities", () => {
  const steps = [
    step(1, "Poser le gobelet."),
    step(2, "Préparer le matériel nécessaire."),
    step(3, "Approcher la lampe."),
  ];
  const items = [
    { asset_id: "a01_gobelet", name: "Gobelet" },
    { asset_id: "a02_lampe", name: "Lampe de bureau" },
  ];
  const checked = validateInteractions(steps, items, {
    steps: [
      { step: 1, actions: [{ type: "place", object: "a01_gobelet", support: null, target: null, evidence: "Poser le gobelet" }], unsupported: [] },
      { step: 2, actions: [{ type: "inspect", object: "a09_materiel", support: null, target: null, evidence: "Préparer le matériel" }], unsupported: [] },
      { step: 3, actions: [{ type: "approach", object: "a02_lampe", support: null, target: "a01_gobelet", evidence: "Approcher la lampe" }], unsupported: [] },
    ],
  });
  assert.equal(checked.actions.length, 0);
  assert.ok(checked.issues.some((i) => i.startsWith("Étape 1") && i.includes("support non précisé")), checked.issues.join("\n"));
  assert.ok(checked.issues.some((i) => i.startsWith("Étape 2") && i.includes("absent du matériel")));
  assert.ok(checked.issues.some((i) => i.startsWith("Étape 3") && i.includes("n'est pas cité")));
  const { simulation, report } = buildSimulation(steps, items, checked, []);
  assert.equal(simulation, null, "nothing is invented: the TP stays non-interactive");
  assert.deepEqual(report.steps.map((s) => s.coverage), ["none", "none", "none"]);
  assert.ok(report.issues.some((i) => i.includes("Aucune manipulation vérifiable")));
});

test("ambiguity: two objects match the quote ('la pile' with a 9 V and a 4,5 V battery) → rejected", () => {
  const steps = [step(1, "Poser la pile sur la table.")];
  const items = [
    { asset_id: "a01_pile_9v", name: "Pile 9 V" },
    { asset_id: "a02_pile_plate", name: "Pile plate 4,5 V" },
  ];
  const checked = validateInteractions(steps, items, {
    steps: [{ step: 1, actions: [{ type: "place", object: "a01_pile_9v", support: "workbench", target: null, evidence: "Poser la pile sur la table" }], unsupported: [] }],
  });
  assert.equal(checked.actions.length, 0);
  assert.ok(checked.issues[0].includes("ambigu"), checked.issues.join("\n"));
});

test("missing analysis (LLM unavailable): every step is reported as not checked", () => {
  const checked = validateInteractions(STEPS, ITEMS, { steps: [] });
  assert.equal(checked.actions.length, 0);
  assert.equal(checked.issues.filter((i) => i.includes("absente de l'analyse")).length, STEPS.length);
  assert.equal(buildSimulation(STEPS, ITEMS, checked, []).simulation, null);
});

test("an object that could not be placed in the room is not given a rule", () => {
  const checked = validateInteractions(STEPS, ITEMS, PROPOSAL);
  const { simulation, report } = buildSimulation(STEPS, ITEMS, checked, []);
  assert.equal(simulation, null);
  assert.ok(report.issues.some((i) => i.includes("n'a pas pu être placé")));
});

/* ------------------------------------------------------------------ */
/* Pipeline end to end (Together AI + Sketchfab mocked)                  */
/* ------------------------------------------------------------------ */

test("pipeline: a new TP text becomes a manifest with a generic simulation (no demo id)", async () => {
  process.env.TOGETHER_API_KEY = "test_key_not_used";
  process.env.SKETCHFAB_API_KEY = "";
  const realFetch = global.fetch;
  const llm = (o: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { headers: { "content-type": "application/json" } });
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("https://api.together.xyz")) {
      const prompt = JSON.parse(String(init?.body)).messages.at(-1).content as string;
      if (prompt.includes("technical document analyzer"))
        return llm({ title: "Champ magnétique d'un aimant droit", domain: "other", duration_minutes: 20, materials: ITEMS.map((i) => ({ name: i.name, quantity: 1, unit: "pieces" })), tools: [], steps: STEPS, safety_warnings: [] });
      if (prompt.includes("instructional designer")) {
        // Ids are the pipeline's own: map the fixture ids by name.
        const objects = JSON.parse(prompt.split("(use their \"id\"):\n")[1].split("\n\nSTEPS")[0]) as { id: string; name: string }[];
        const idOf = (fixtureId: string) => objects.find((o) => o.name === ITEMS.find((i) => i.asset_id === fixtureId)!.name)!.id;
        const map = (x: string | null) => (x && x !== "workbench" ? idOf(x) : x);
        return llm({ steps: PROPOSAL.steps.map((s) => ({ ...s, actions: s.actions.map((a) => ({ ...a, object: idOf(a.object), support: map(a.support), target: map(a.target) })) })) });
      }
      if (prompt.includes("3D asset search specialist")) return llm({ queries: Object.fromEntries(ITEMS.map((i) => [i.name, [i.name]])) });
      if (prompt.includes("VR scene designer")) {
        const assets = JSON.parse(prompt.split("TP ASSETS (objects to place):\n")[1].split("\n\nTP DOMAIN")[0]) as { id: string }[];
        return llm({ placements: assets.map((a, k) => ({ asset_id: a.id, zone: "zone_workbench", offset: { x: -0.9 + 0.6 * k, z: -0.3 }, target_size_m: 0.2 })), color_scheme: { ambient: "#404040", key_light: "#FFFFFF", material_base: "#808080" }, safety_warnings: [], reasoning: "mock" });
      }
      throw new Error("unexpected prompt");
    }
    if (u.startsWith("https://api.sketchfab.com/v3/search")) return new Response(JSON.stringify({ results: [] }), { headers: { "content-type": "application/json" } });
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;

  const { startPipeline, getJob } = await import("../src/services/pipeline");
  const { TP_DATA_DIR } = await import("../src/services/tpStore");
  try {
    const job = startPipeline({ kind: "text", text: STEPS.map((s) => s.action).join("\n") });
    for (let i = 0; i < 200 && getJob(job.id)?.status === "running"; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(job.status, "done", job.error);
    assert.equal(job.steps.find((s) => s.name === "interactions")?.status, "done");
    assert.equal(job.result?.checked_steps, 3);

    const manifest = JSON.parse(await fsp.readFile(path.join(TP_DATA_DIR, `${job.id}.json`), "utf8"));
    assert.equal(manifest.simulation.kind, "generic");
    assert.deepEqual(manifest.simulation.rules.map((r: unknown[]) => r.length), [2, 1, 1, 0, 0]);
    const ids = new Set(manifest.assets.map((a: { asset_id: string }) => a.asset_id));
    for (const r of manifest.simulation.rules.flat()) assert.ok(ids.has(r.asset), `rule on an asset of THIS TP (${r.asset})`);
    assert.ok(!JSON.stringify(manifest.simulation).match(/"(e|m)_[a-z]+"/), "no demo identifier");
    assert.deepEqual(manifest.interactions.steps.map((s: { coverage: string }) => s.coverage), ["full", "partial", "full", "none", "none"]);
    assert.ok(manifest.warnings.some((w: string) => w.startsWith("Interactions — Étape 4")));
    await fsp.rm(path.join(TP_DATA_DIR, `${job.id}.json`), { force: true });
  } finally {
    global.fetch = realFetch;
  }
});

test("verb forms: the extractor's infinitive quote matches the document's gerund ('poser' ↔ 'en posant')", () => {
  // Real case (Llama 3.3, 19/10/2026): step text and quote differ only by the verb form.
  const steps = [step(1, "Préparer le poste en posant la feuille blanche A4 sur la table, puis la boussole au centre.")];
  const checked = validateInteractions(steps, ITEMS, {
    steps: [
      {
        step: 1,
        actions: [
          { type: "place", object: "a04_feuille_blanche_a4", support: "workbench", target: null, evidence: "poser la feuille blanche A4 sur la table" },
          // "au centre" of what? Not stated → must stay rejected.
          { type: "place", object: "a01_boussole", support: "a04_feuille_blanche_a4", target: null, evidence: "la boussole au centre" },
        ],
        unsupported: [],
      },
    ],
  });
  assert.deepEqual(checked.actions.map((a) => a.object), ["a04_feuille_blanche_a4"]);
  assert.ok(checked.issues.some((i) => i.includes("la boussole au centre")));
  // Other words are never tolerated.
  const other = validateInteractions(steps, ITEMS, {
    steps: [{ step: 1, actions: [{ type: "place", object: "a04_feuille_blanche_a4", support: "workbench", target: null, evidence: "poser la feuille rouge A4 sur la table" }], unsupported: [] }],
  });
  assert.equal(other.actions.length, 0);
});

test("safety net counts verb OCCURRENCES: a second 'poser' forgotten by the AI is reported", () => {
  const steps = [step(1, "Poser la feuille blanche A4 sur la table puis poser la règle graduée sur la table.")];
  const checked = validateInteractions(steps, ITEMS, {
    steps: [{ step: 1, actions: [{ type: "place", object: "a04_feuille_blanche_a4", support: "workbench", target: null, evidence: "Poser la feuille blanche A4 sur la table" }], unsupported: [] }],
  });
  assert.equal(checked.actions.length, 1);
  assert.ok(checked.unverified.get(1)!.some((u) => u.includes("poser la règle")), checked.unverified.get(1)!.join(" | "));
});

test("reported parts must be quotes: an AI paraphrase does not make a fully checked step 'partial'", () => {
  // Real case (Llama 3.3, 19/10/2026): « approche de l'aimant » — tâche non technique.
  const checked = validateInteractions([STEPS[2]], ITEMS, {
    steps: [{ step: 3, actions: PROPOSAL.steps[2].actions, unsupported: [{ text: "approche de l'aimant", reason: "tâche non technique" }] }],
  });
  assert.deepEqual(checked.unverified.get(3), []);
});

test("the parser's key points (its own summaries) are not document text: never quoted, never 'unverified'", () => {
  // Real case: key_points = ["approche de l'aimant"] (a title written by the parser, not the document).
  const s3 = { ...STEPS[2], key_points: ["approche de l'aimant"] };
  const checked = validateInteractions([s3], ITEMS, {
    steps: [{ step: 3, actions: PROPOSAL.steps[2].actions, unsupported: [{ text: "approche de l'aimant", reason: "tâche non technique" }] }],
  });
  assert.equal(checked.actions.length, 1);
  assert.deepEqual(checked.unverified.get(3), []);
});
