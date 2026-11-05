/**
 * Unit tests — performance report (deterministic part, AI facts and guard).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionSchema } from "../src/routes/analytics";
import { ReportManifest, aiFacts, buildReport, checkAiFeedback } from "../src/services/report";

const manifest: ReportManifest = {
  id: "tp_demo_electrical",
  tp: {
    title: "Câblage d'un circuit",
    domain: "electrical",
    steps: [
      { order: 1, action: "Installer la plaque d'essai.", safety: "Interrupteur ouvert (OFF) pendant tout le câblage" },
      { order: 2, action: "Câbler les 3 résistances de 150 Ω.", safety: null },
      { order: 3, action: "Poser les LED.", safety: null },
    ],
  },
};

function session(over: Record<string, unknown> = {}) {
  return {
    ...SessionSchema.parse({
      session_id: "s_1",
      tp_id: "tp_demo_electrical",
      student_id: "anon_1",
      student: { first_name: "Awa", last_name: "DIOP", matricule: null },
      interactive: true,
      started_at: 1_792_000_000_000,
      duration_sec: 140,
      accuracy_percent: null,
      steps_completed: 1,
      steps_total: 3,
      finished: false,
      steps_validated: 1,
      safety_violations: 1,
      step_times_sec: [40, 100, 0],
      steps_detail: [
        { step: 1, status: "validated", time_sec: 40, manipulations: 2, wrong_objects: 0, safety_faults: 0, damages: 0, aids: 0 },
        { step: 2, status: "incomplete", time_sec: 100, manipulations: 4, wrong_objects: 1, safety_faults: 1, damages: 0, aids: 1 },
        { step: 3, status: "not_reached", time_sec: 0, manipulations: 0, wrong_objects: 0, safety_faults: 0, damages: 0, aids: 0 },
      ],
      aids_used: 1,
      fps: null,
      device: { xr: false, hand_tracking: false, user_agent: "" },
      interactions: [{ timestamp: 1_792_000_050_000, event: "sim_event", kind: "safety_violation", detail: "mise sous tension pendant le câblage", step: 2 }],
      timestamp: 1_792_000_140_000,
      ...over,
    }),
    received_at: "",
  };
}

test("report: statuses, documented faults and recommendations come from the recorded events", () => {
  const r = buildReport(session(), manifest);
  assert.deepEqual(r.steps.map((s) => s.status), ["validated", "incomplete", "not_reached"]);
  assert.equal(r.student?.last_name, "DIOP");
  assert.ok(r.strengths.some((s) => s.includes("1 étape sur 3 validée")));
  assert.ok(r.difficulties.some((d) => d === "Étape 2 — faute de sécurité : mise sous tension pendant le câblage."));
  assert.ok(r.difficulties.some((d) => d.startsWith("Étapes non atteintes") || d.startsWith("Étape non atteinte")));
  assert.ok(r.recommendations.some((x) => x.startsWith("Reprenez l'étape 2")));
  // The fault of step 2 is linked to the safety instruction that concerns it (written in step 1).
  assert.ok(
    r.recommendations.includes("Étape 2 (mise sous tension pendant le câblage) : appliquez la consigne de sécurité « Interrupteur ouvert (OFF) pendant tout le câblage »."),
    r.recommendations.join(" | ")
  );
  assert.equal(r.score, null);
  assert.match(r.score_note, /Aucun barème/);
});

test("report: score only when the TP defines a grading scale", () => {
  const r = buildReport(session(), { ...manifest, grading: { per_validated_step: 5, per_safety_fault: 2, max: 15 } });
  assert.deepEqual(r.score, { value: 3, max: 15, rule: "5 pt par étape validée, −2 par faute" });
});

test("report: no automatic check → never 'validée', no safety claims", () => {
  const r = buildReport(session({ interactive: false, steps_detail: [
    { step: 1, status: "done", time_sec: 40, manipulations: 0, wrong_objects: 0, safety_faults: 0, damages: 0, aids: 0 },
    { step: 2, status: "done", time_sec: 50, manipulations: 0, wrong_objects: 0, safety_faults: 0, damages: 0, aids: 0 },
    { step: 3, status: "incomplete", time_sec: 5, manipulations: 0, wrong_objects: 0, safety_faults: 0, damages: 0, aids: 0 },
  ], interactions: [] }), manifest);
  const text = [...r.strengths, ...r.difficulties].join(" ");
  assert.doesNotMatch(text, /validée|sécurité/);
  assert.match(text, /n'a pas de validation automatique/);
});

test("AI facts carry no personal data; AI answers quoting invented numbers are rejected", () => {
  const r = buildReport(session(), manifest);
  const facts = aiFacts(r);
  const json = JSON.stringify(facts);
  assert.doesNotMatch(json, /Awa|DIOP|anon_1|s_1/);
  const good = { summary: "Vous avez validé l'étape 1 en 40 s.", strengths: [], difficulties: ["À l'étape 2, mise sous tension pendant le câblage."], advice: ["Gardez l'interrupteur ouvert (OFF) pendant tout le câblage."] };
  assert.equal(checkAiFeedback(good, facts, true), null);
  const invented = { ...good, summary: "Vous avez mesuré 12,6 V en 35 s." };
  assert.match(checkAiFeedback(invented, facts, true) ?? "", /12.6, 35|12,6|nombres absents/);
  assert.match(checkAiFeedback(good, facts, false) ?? "", /validation automatique/);
});

test("identification quiz (engine demo): wrong answers are reported as answers, not manipulations", () => {
  const quiz: ReportManifest = { ...manifest, id: "tp_demo_engine", simulation: { kind: "engine_quiz" } };
  const r = buildReport(session(), quiz);
  assert.ok(r.difficulties.some((d) => /Étape 2 — 1 réponse incorrecte avant de trouver le composant/.test(d)), r.difficulties.join(" | "));
  assert.ok(!r.difficulties.some((d) => /manipulation/.test(d)));
  assert.ok(r.recommendations.some((x) => /indices/.test(x)));
  // Other TPs keep their wording.
  assert.ok(buildReport(session(), manifest).difficulties.some((d) => /manipulation d'objets non cités/.test(d)));
});
