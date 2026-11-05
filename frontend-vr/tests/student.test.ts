/**
 * Unit tests — student identity and per-step performance tracking (no DOM, no Babylon).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName, loadIdentity, saveIdentity, validateIdentity } from "../src/utils/identity";
import { TPSession } from "../src/utils/analytics";

test("identity: normalized, matricule optional", () => {
  const r = validateIdentity({ first_name: "  Awa ", last_name: "diop  ndiaye", matricule: "" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.identity, { first_name: "Awa", last_name: "DIOP NDIAYE", matricule: null });
  assert.equal(displayName(r.identity), "Awa DIOP NDIAYE");
  const m = validateIdentity({ first_name: "Jean-Noël", last_name: "N'Diaye", matricule: "ucad-2024/017" });
  assert.equal(m.ok && m.identity.matricule, "UCAD-2024/017");
  assert.equal(m.ok && displayName(m.identity, true), "Jean-Noël N'DIAYE (UCAD-2024/017)");
});

test("identity: missing or invalid fields are reported per field", () => {
  const r = validateIdentity({ first_name: "", last_name: "<script>", matricule: "a b c" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.first_name && r.errors.last_name && r.errors.matricule);
  assert.equal(validateIdentity({ first_name: "A".repeat(61), last_name: "B" }).ok, false);
});

test("identity: kept for the tab; tampered storage is ignored", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(loadIdentity(storage), null);
  saveIdentity({ first_name: "Awa", last_name: "DIOP", matricule: null }, storage);
  assert.deepEqual(loadIdentity(storage), { first_name: "Awa", last_name: "DIOP", matricule: null });
  store.set("tpxr_identity", JSON.stringify({ first_name: "<img>", last_name: "x" }));
  assert.equal(loadIdentity(storage), null);
  store.set("tpxr_identity", "{not json");
  assert.equal(loadIdentity(storage), null);
});

/** Session with a fake clock: steps 1 and 2 have linked objects, step 3 none. */
function makeSession(interactive: boolean) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (s: number) => (t += s * 1000) };
  const s = new TPSession("tp_x", "anon_1", [new Set(["motor"]), new Set(["belt"]), new Set()], clock.now, "s_1");
  s.interactive = interactive;
  s.identity = { first_name: "Awa", last_name: "DIOP", matricule: null };
  return { s, clock };
}

test("tracking (interactive TP): validated / skipped only from validation-engine events", () => {
  const { s, clock } = makeSession(true);
  s.recordInteraction({ hand: "right", gesture: "grab", target: "belt", durationMs: 500 }); // wrong object
  s.recordInteraction({ hand: "right", gesture: "grab", target: "motor", durationMs: 900 });
  s.recordSim("safety_violation", "touch belt energized");
  clock.advance(30);
  s.recordSim("step_validated", "étape 1");
  s.next("auto");
  s.recordAid("labels");
  clock.advance(12);
  s.recordSim("step_skipped", "étape 2");
  s.next("button");
  const d = s.stepsDetail();
  assert.deepEqual(d.map((x) => x.status), ["validated", "skipped", "incomplete"]);
  assert.deepEqual(
    { m: d[0].manipulations, w: d[0].wrong_objects, f: d[0].safety_faults, t: d[0].time_sec },
    { m: 2, w: 1, f: 1, t: 30 }
  );
  assert.equal(d[1].aids, 1);
  const sum = s.summary();
  assert.equal(sum.student?.last_name, "DIOP");
  assert.equal(sum.interactive, true);
  assert.equal(sum.aids_used, 1);
  assert.equal(sum.steps_detail.length, 3);
});

test("tracking (non-interactive TP): moving on is 'done', never 'validated'; unseen steps 'not_reached'", () => {
  const { s, clock } = makeSession(false);
  clock.advance(5);
  s.recordSim("step_validated", "should not happen without an engine");
  s.next("button");
  const d = s.stepsDetail();
  assert.deepEqual(d.map((x) => x.status), ["done", "incomplete", "not_reached"]);
});

test("tracking: going back to re-read a step is an aid, not an error", () => {
  const { s } = makeSession(true);
  s.next("button");
  s.recordAid("review");
  s.prev("button");
  const d = s.stepsDetail();
  assert.equal(d[1].aids, 1);
  assert.equal(d[1].wrong_objects + d[1].safety_faults + d[1].damages, 0);
});

import { confirmationSentence } from "../src/ui/feedbackText";

test("feedback: confirmation sentence built from the conditions the engine checked", () => {
  assert.equal(
    confirmationSentence(["Plaque d'essai sur le poste", "Batterie dans son logement"], { index: 0, total: 4 }),
    "Étape 1/4 : plaque d'essai sur le poste, batterie dans son logement."
  );
  assert.equal(confirmationSentence(["Courroie montée."]), "Courroie montée.");
  assert.equal(confirmationSentence([], { index: 2, total: 5 }), "Étape 3/5 : toutes les conditions de l'étape sont remplies.");
});
