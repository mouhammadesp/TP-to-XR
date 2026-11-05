// tests/student.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/utils/identity.ts
var NAME_RE = /^[\p{L}][\p{L}\p{M} .'’-]{0,59}$/u;
var MATRICULE_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,29}$/;
var STORAGE_KEY = "tpxr_identity";
function clean(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
function validateIdentity(input) {
  const first = clean(input.first_name);
  const last = clean(input.last_name);
  const mat = clean(input.matricule).toUpperCase();
  const errors = {};
  if (!first) errors.first_name = "Indiquez votre pr\xE9nom.";
  else if (!NAME_RE.test(first)) errors.first_name = "Pr\xE9nom : lettres, espaces, tirets ou apostrophes (60 caract\xE8res max).";
  if (!last) errors.last_name = "Indiquez votre nom.";
  else if (!NAME_RE.test(last)) errors.last_name = "Nom : lettres, espaces, tirets ou apostrophes (60 caract\xE8res max).";
  if (mat && !MATRICULE_RE.test(mat)) errors.matricule = "Matricule : lettres, chiffres, - _ / . (30 caract\xE8res max).";
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, identity: { first_name: first, last_name: last.toUpperCase(), matricule: mat || null } };
}
function displayName(id, withMatricule = false) {
  const name = `${id.first_name} ${id.last_name}`;
  return withMatricule && id.matricule ? `${name} (${id.matricule})` : name;
}
function loadIdentity(storage = safeSession()) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = validateIdentity(JSON.parse(raw));
    return r.ok ? r.identity : null;
  } catch {
    return null;
  }
}
function saveIdentity(id, storage = safeSession()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(id));
  } catch {
  }
}
function safeSession() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

// src/utils/analytics.ts
var MAX_EVENTS = 5e3;
var TPSession = class {
  /**
   * @param stepAssets for each step index, the asset ids that belong to it
   * @param now clock (injectable for tests)
   */
  constructor(tpId, studentId, stepAssets, now = Date.now, sessionId) {
    this.tpId = tpId;
    this.studentId = studentId;
    this.stepAssets = stepAssets;
    this.now = now;
    this.current = 0;
    this.completed = /* @__PURE__ */ new Set();
    this.events = [];
    this.scored = 0;
    this.correct = 0;
    this.finishedAt = null;
    this.validatedCount = 0;
    this.violationCount = 0;
    this.fpsSum = 0;
    this.fpsMin = Infinity;
    this.fpsCount = 0;
    this.xrUsed = false;
    this.handTrackingUsed = false;
    /** Student identity entered before the TP (null: not identified). */
    this.identity = null;
    /** Set when the TP has a validation engine: steps are then "validated", not just "done". */
    this.interactive = false;
    /**
     * Interactive TPs: per step, does the engine check it? A step it cannot check
     * (generated TPs: no supported action) is "done" when left — never "validated" nor "skipped".
     */
    this.verifiable = null;
    this.reached = /* @__PURE__ */ new Set([0]);
    this.validatedSteps = /* @__PURE__ */ new Set();
    this.skippedSteps = /* @__PURE__ */ new Set();
    this.sessionId = sessionId ?? `s_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = now();
    this.stepEnteredAt = this.startedAt;
    this.stepTimes = stepAssets.map(() => 0);
    this.perStep = stepAssets.map(() => ({ manipulations: 0, wrong: 0, faults: 0, damages: 0, aids: 0 }));
    this.push({ timestamp: this.startedAt, event: "session_start" });
  }
  /** Current step index (0-based). */
  get step() {
    return this.current;
  }
  get stepsTotal() {
    return this.stepAssets.length;
  }
  get finished() {
    return this.finishedAt !== null;
  }
  /** Elapsed seconds (frozen once finished). */
  elapsedSec() {
    return Math.round(((this.finishedAt ?? this.now()) - this.startedAt) / 1e3);
  }
  /** Steps validated so far. */
  stepsCompleted() {
    return this.completed.size;
  }
  /** Accuracy in %, or null if no grab was scored. */
  accuracy() {
    return this.scored === 0 ? null : Math.round(this.correct / this.scored * 100);
  }
  /**
   * Moves to step `to` (clamped). Logs a step_change if it actually changes.
   * @returns true if the step changed
   */
  goTo(to, via) {
    if (this.finished) return false;
    const target = Math.max(0, Math.min(this.stepAssets.length - 1, to));
    if (target === this.current) return false;
    const t = this.now();
    const spent = (t - this.stepEnteredAt) / 1e3;
    this.stepTimes[this.current] += spent;
    if (target > this.current) this.completed.add(this.current);
    this.push({
      timestamp: t,
      event: "step_change",
      from_step: this.current + 1,
      to_step: target + 1,
      action_time_sec: Math.round(spent * 10) / 10,
      via
    });
    this.current = target;
    this.reached.add(target);
    this.stepEnteredAt = t;
    return true;
  }
  next(via) {
    return this.goTo(this.current + 1, via);
  }
  prev(via) {
    return this.goTo(this.current - 1, via);
  }
  /**
   * Validates the last step and ends the session.
   * @returns false if not on the last step or already finished
   */
  finish() {
    if (this.finished || this.current !== this.stepAssets.length - 1) return false;
    const t = this.now();
    this.stepTimes[this.current] += (t - this.stepEnteredAt) / 1e3;
    this.completed.add(this.current);
    this.finishedAt = t;
    this.push({ timestamp: t, event: "session_end" });
    return true;
  }
  /**
   * Records a hand/controller/mouse interaction. Grabs on an object are scored
   * against the current step's linked objects.
   */
  recordInteraction(e) {
    let correct = null;
    const isGrab = e.gesture !== "point" && e.gesture !== "pinch_middle" && e.target !== null;
    const expected = this.stepAssets[this.current];
    if (isGrab && !this.finished) this.perStep[this.current].manipulations++;
    if (isGrab && !this.finished && expected && expected.size > 0) {
      correct = expected.has(e.target);
      this.scored++;
      if (correct) this.correct++;
      else this.perStep[this.current].wrong++;
    }
    const event = {
      timestamp: this.now(),
      event: "hand_interaction",
      hand: e.hand,
      gesture: e.gesture,
      target_object: e.target,
      duration_ms: Math.round(e.durationMs),
      step: this.current + 1,
      correct
    };
    this.push(event);
    return event;
  }
  /**
   * Records an answer of an identification quiz (component selected with the laser / a click):
   * one attempt of the step, scored like a grab (accuracy, wrong objects of the step).
   */
  recordAnswer(e) {
    if (!this.finished) {
      const p = this.perStep[this.current];
      p.manipulations++;
      this.scored++;
      if (e.correct) this.correct++;
      else p.wrong++;
    }
    const event = {
      timestamp: this.now(),
      event: "hand_interaction",
      hand: e.hand,
      gesture: e.gesture,
      target_object: e.target,
      duration_ms: 0,
      step: this.current + 1,
      correct: e.correct
    };
    this.push(event);
    return event;
  }
  /** Records an interactive-TP event (validation, safety fault, snap, measure…). */
  recordSim(kind, detail) {
    if (kind === "step_validated") {
      this.validatedCount++;
      this.validatedSteps.add(this.current);
    }
    if (kind === "step_skipped") this.skippedSteps.add(this.current);
    if (kind === "safety_violation" || kind === "damage") this.violationCount++;
    if (kind === "safety_violation") this.perStep[this.current].faults++;
    if (kind === "damage") this.perStep[this.current].damages++;
    this.push({ timestamp: this.now(), event: "sim_event", kind, detail: detail.slice(0, 200), step: this.current + 1 });
  }
  /** Records the use of an aid on the current step. */
  recordAid(aid) {
    if (this.finished) return;
    this.perStep[this.current].aids++;
    this.push({ timestamp: this.now(), event: "aid_used", aid, step: this.current + 1 });
  }
  /** Per-step results, derived from the recorded events only. */
  stepsDetail() {
    const live = this.finished ? 0 : (this.now() - this.stepEnteredAt) / 1e3;
    return this.perStep.map((p, i) => {
      let status;
      const checked = this.interactive && this.verifiable?.[i] !== false;
      if (checked && this.validatedSteps.has(i)) status = "validated";
      else if (checked && this.skippedSteps.has(i)) status = "skipped";
      else if (!checked && this.completed.has(i)) status = "done";
      else status = this.reached.has(i) ? "incomplete" : "not_reached";
      return {
        step: i + 1,
        status,
        time_sec: Math.round((this.stepTimes[i] + (i === this.current ? live : 0)) * 10) / 10,
        manipulations: p.manipulations,
        wrong_objects: p.wrong,
        safety_faults: p.faults,
        damages: p.damages,
        aids: p.aids
      };
    });
  }
  get stepsValidated() {
    return this.validatedCount;
  }
  get safetyViolations() {
    return this.violationCount;
  }
  /** Records a marker event (XR enter/exit, credits…). */
  mark(event) {
    this.push({ timestamp: this.now(), event });
  }
  /** Adds one FPS sample (e.g. once per second). */
  addFps(fps) {
    if (!Number.isFinite(fps) || fps <= 0) return;
    this.fpsSum += fps;
    this.fpsCount++;
    this.fpsMin = Math.min(this.fpsMin, fps);
  }
  /** Snapshot sent to the backend. */
  summary(userAgent = "") {
    const live = this.finished ? 0 : (this.now() - this.stepEnteredAt) / 1e3;
    return {
      session_id: this.sessionId,
      tp_id: this.tpId,
      student_id: this.studentId,
      student: this.identity,
      interactive: this.interactive,
      started_at: this.startedAt,
      duration_sec: this.elapsedSec(),
      accuracy_percent: this.accuracy(),
      steps_completed: this.stepsCompleted(),
      steps_total: this.stepAssets.length,
      finished: this.finished,
      steps_validated: this.validatedCount,
      safety_violations: this.violationCount,
      step_times_sec: this.stepTimes.map((s, i) => Math.round((s + (i === this.current ? live : 0)) * 10) / 10),
      steps_detail: this.stepsDetail(),
      aids_used: this.perStep.reduce((n, p) => n + p.aids, 0),
      fps: this.fpsCount ? { avg: Math.round(this.fpsSum / this.fpsCount), min: Math.round(this.fpsMin), samples: this.fpsCount } : null,
      device: { xr: this.xrUsed, hand_tracking: this.handTrackingUsed, user_agent: userAgent.slice(0, 300) },
      interactions: [...this.events],
      timestamp: this.now()
    };
  }
  push(e) {
    if (this.events.length < MAX_EVENTS) this.events.push(e);
  }
};

// src/ui/feedbackText.ts
function confirmationSentence(labels, step) {
  const parts = labels.map((l) => l.trim().replace(/[.;]+$/, "")).filter(Boolean);
  const prefix = step ? `\xC9tape ${step.index + 1}/${step.total} : ` : "";
  if (!parts.length) return `${prefix}toutes les conditions de l'\xE9tape sont remplies.`;
  const text = parts.map((p, i) => i === 0 && !prefix ? p : p.charAt(0).toLowerCase() + p.slice(1)).join(", ");
  return `${prefix}${text}.`;
}

// tests/student.test.ts
test("identity: normalized, matricule optional", () => {
  const r = validateIdentity({ first_name: "  Awa ", last_name: "diop  ndiaye", matricule: "" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.identity, { first_name: "Awa", last_name: "DIOP NDIAYE", matricule: null });
  assert.equal(displayName(r.identity), "Awa DIOP NDIAYE");
  const m = validateIdentity({ first_name: "Jean-No\xEBl", last_name: "N'Diaye", matricule: "ucad-2024/017" });
  assert.equal(m.ok && m.identity.matricule, "UCAD-2024/017");
  assert.equal(m.ok && displayName(m.identity, true), "Jean-No\xEBl N'DIAYE (UCAD-2024/017)");
});
test("identity: missing or invalid fields are reported per field", () => {
  const r = validateIdentity({ first_name: "", last_name: "<script>", matricule: "a b c" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.ok(r.errors.first_name && r.errors.last_name && r.errors.matricule);
  assert.equal(validateIdentity({ first_name: "A".repeat(61), last_name: "B" }).ok, false);
});
test("identity: kept for the tab; tampered storage is ignored", () => {
  const store = /* @__PURE__ */ new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
  assert.equal(loadIdentity(storage), null);
  saveIdentity({ first_name: "Awa", last_name: "DIOP", matricule: null }, storage);
  assert.deepEqual(loadIdentity(storage), { first_name: "Awa", last_name: "DIOP", matricule: null });
  store.set("tpxr_identity", JSON.stringify({ first_name: "<img>", last_name: "x" }));
  assert.equal(loadIdentity(storage), null);
  store.set("tpxr_identity", "{not json");
  assert.equal(loadIdentity(storage), null);
});
function makeSession(interactive) {
  let t = 1e6;
  const clock = { now: () => t, advance: (s2) => t += s2 * 1e3 };
  const s = new TPSession("tp_x", "anon_1", [/* @__PURE__ */ new Set(["motor"]), /* @__PURE__ */ new Set(["belt"]), /* @__PURE__ */ new Set()], clock.now, "s_1");
  s.interactive = interactive;
  s.identity = { first_name: "Awa", last_name: "DIOP", matricule: null };
  return { s, clock };
}
test("tracking (interactive TP): validated / skipped only from validation-engine events", () => {
  const { s, clock } = makeSession(true);
  s.recordInteraction({ hand: "right", gesture: "grab", target: "belt", durationMs: 500 });
  s.recordInteraction({ hand: "right", gesture: "grab", target: "motor", durationMs: 900 });
  s.recordSim("safety_violation", "touch belt energized");
  clock.advance(30);
  s.recordSim("step_validated", "\xE9tape 1");
  s.next("auto");
  s.recordAid("labels");
  clock.advance(12);
  s.recordSim("step_skipped", "\xE9tape 2");
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
test("feedback: confirmation sentence built from the conditions the engine checked", () => {
  assert.equal(
    confirmationSentence(["Plaque d'essai sur le poste", "Batterie dans son logement"], { index: 0, total: 4 }),
    "\xC9tape 1/4 : plaque d'essai sur le poste, batterie dans son logement."
  );
  assert.equal(confirmationSentence(["Courroie mont\xE9e."]), "Courroie mont\xE9e.");
  assert.equal(confirmationSentence([], { index: 2, total: 5 }), "\xC9tape 3/5 : toutes les conditions de l'\xE9tape sont remplies.");
});
