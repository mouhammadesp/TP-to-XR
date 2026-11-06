/**
 * End-of-TP performance report.
 *
 * Built from the stored session (events recorded by the student view — the
 * validation engine decided which steps were validated) and the TP manifest.
 *   - deterministic part: always available, derived only from recorded facts;
 *   - AI part (optional): pedagogical explanation of those same facts. The model
 *     never sees the student's identity, never decides a step's status, and its
 *     answer is rejected if it quotes a number absent from the facts or calls a
 *     step "validated" when there was no validation engine.
 */
import type { SessionRecord } from "../routes/analytics";
import type { PedagogicalFeedback } from "../schemas/tp";

type StepStatus = "validated" | "done" | "skipped" | "incomplete" | "not_reached";

export const STATUS_LABEL: Record<StepStatus, string> = {
  validated: "Validée",
  done: "Terminée (non vérifiée)",
  skipped: "Non validée (passée)",
  incomplete: "Non terminée",
  not_reached: "Non atteinte",
};

/** What the report needs from a manifest (generated, demo or preview TP). */
export interface ReportManifest {
  id: string;
  tp: { title: string; domain: string; steps: { order: number; action: string; safety: string | null }[] };
  /** Optional grading scale. No scale → no score (the report says so). */
  grading?: { per_validated_step: number; per_safety_fault: number; max: number };
  /** Interactive TPs: kind of simulation (an identification quiz counts answers, not manipulations). */
  simulation?: { kind: string };
  /** Generated TPs: what the engine checks in each step (services/interactions.ts). */
  interactions?: { steps: { step: number; coverage: "full" | "partial" | "none"; verified: string[]; unverified: string[] }[] };
}

export interface StepReport {
  n: number;
  action: string;
  safety: string | null;
  status: StepStatus;
  status_label: string;
  time_sec: number;
  manipulations: number;
  wrong_objects: number;
  safety_faults: string[];
  damages: string[];
  aids: number;
  /** Generated TPs: what the validation of this step checked ("full" / "partial" / "none"), null for authored TPs. */
  verification: "full" | "partial" | "none" | null;
  /** Parts of the step the engine does not check. */
  unverified: string[];
}

export interface AiPart {
  status: "ok" | "disabled" | "unavailable" | "rejected" | "error";
  note: string;
  feedback?: PedagogicalFeedback;
}

export interface Report {
  session_id: string;
  tp: { id: string; title: string; domain: string; steps_total: number };
  student: { first_name: string; last_name: string; matricule: string | null } | null;
  started_at: string;
  duration_sec: number;
  finished: boolean;
  interactive: boolean;
  steps: StepReport[];
  totals: Record<StepStatus, number> & { safety_faults: number; damages: number; wrong_objects: number; aids: number };
  score: { value: number; max: number; rule: string } | null;
  score_note: string;
  strengths: string[];
  difficulties: string[];
  recommendations: string[];
  ai: AiPart;
}

/** Per-step results: from steps_detail (sessions recorded since the report feature), else rebuilt from older fields. */
function stepRows(s: SessionRecord, m: ReportManifest): StepReport[] {
  const faults = (kind: "safety_violation" | "damage", n: number) =>
    s.interactions.flatMap((e) => (e.event === "sim_event" && e.kind === kind && e.step === n ? [e.detail] : []));
  return m.tp.steps.map((st, i) => {
    const d = s.steps_detail.find((x) => x.step === i + 1);
    const cov = m.interactions?.steps.find((x) => x.step === st.order);
    const status: StepStatus = d?.status ?? (i < s.steps_completed ? "done" : i === s.steps_completed && !s.finished ? "incomplete" : "not_reached");
    return {
      n: i + 1,
      action: st.action,
      safety: st.safety ?? null,
      status,
      status_label: STATUS_LABEL[status],
      time_sec: d?.time_sec ?? s.step_times_sec[i] ?? 0,
      manipulations: d?.manipulations ?? 0,
      wrong_objects: d?.wrong_objects ?? 0,
      safety_faults: faults("safety_violation", i + 1),
      damages: faults("damage", i + 1),
      aids: d?.aids ?? 0,
      verification: cov?.coverage ?? null,
      unverified: cov?.unverified ?? [],
    };
  });
}

const list = (ns: number[]) => (ns.length === 1 ? `l'étape ${ns[0]}` : `les étapes ${ns.slice(0, -1).join(", ")} et ${ns[ns.length - 1]}`);
const short = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Deterministic report (no AI): every sentence restates a recorded fact. */
export function buildReport(s: SessionRecord, m: ReportManifest): Report {
  const steps = stepRows(s, m);
  const count = (st: StepStatus) => steps.filter((x) => x.status === st).length;
  const totals = {
    validated: count("validated"),
    done: count("done"),
    skipped: count("skipped"),
    incomplete: count("incomplete"),
    not_reached: count("not_reached"),
    safety_faults: steps.reduce((n, x) => n + x.safety_faults.length, 0),
    damages: steps.reduce((n, x) => n + x.damages.length, 0),
    wrong_objects: steps.reduce((n, x) => n + x.wrong_objects, 0),
    aids: steps.reduce((n, x) => n + x.aids, 0),
  };
  const total = steps.length;

  const strengths: string[] = [];
  const difficulties: string[] = [];
  const recommendations: string[] = [];
  /** Identification quiz: a wrong "object" is a wrong answer (component selected with the laser). */
  const quiz = m.simulation?.kind === "engine_quiz" || m.simulation?.kind === "instrument_quiz";

  if (s.interactive) {
    const ok = steps.filter((x) => x.status === "validated").map((x) => x.n);
    if (ok.length) strengths.push(`${ok.length} étape${ok.length > 1 ? "s" : ""} sur ${total} validée${ok.length > 1 ? "s" : ""} par vos actions (${list(ok)}).`);
    if (ok.length === total) strengths.push("Toutes les étapes ont été validées par le moteur de simulation.");
    const unchecked = steps.filter((x) => x.status === "done").map((x) => x.n);
    if (unchecked.length)
      strengths.push(`${unchecked.length > 1 ? "Étapes" : "Étape"} sans vérification automatique, menée${unchecked.length > 1 ? "s" : ""} jusqu'au bout (non vérifiée${unchecked.length > 1 ? "s" : ""}) : ${unchecked.join(", ")}.`);
    const partial = steps.filter((x) => x.status === "validated" && x.verification === "partial").map((x) => x.n);
    if (partial.length)
      strengths.push(`Validation partielle pour ${list(partial)} : seules les manipulations vérifiables ont été contrôlées.`);
    if (totals.safety_faults + totals.damages === 0 && steps.some((x) => x.status !== "not_reached"))
      strengths.push("Aucune faute de sécurité ni aucun dommage détecté pendant la séance.");
  } else {
    const done = steps.filter((x) => x.status === "done").map((x) => x.n);
    if (done.length) strengths.push(`${done.length} étape${done.length > 1 ? "s" : ""} sur ${total} menée${done.length > 1 ? "s" : ""} jusqu'au bout (${list(done)}) — ce TP n'a pas de validation automatique.`);
  }
  if (s.finished) strengths.push("TP mené jusqu'à la dernière étape.");
  if (totals.aids === 0 && steps.some((x) => x.status !== "not_reached")) strengths.push("Séance réalisée sans recourir aux aides (étiquettes, loupe, retour en arrière).");

  for (const x of steps) {
    for (const f of x.safety_faults) {
      difficulties.push(`Étape ${x.n} — faute de sécurité : ${f}.`);
    }
    for (const d of x.damages) difficulties.push(`Étape ${x.n} — dommage : ${d}.`);
    if (x.status === "skipped") difficulties.push(`Étape ${x.n} quittée avant d'être validée (« ${short(x.action)} »).`);
    if (x.status === "incomplete") difficulties.push(`Étape ${x.n} non terminée (« ${short(x.action)} »).`);
    if (x.wrong_objects > 0 && quiz)
      difficulties.push(`Étape ${x.n} — ${x.wrong_objects} réponse${x.wrong_objects > 1 ? "s" : ""} incorrecte${x.wrong_objects > 1 ? "s" : ""} avant de trouver le composant.`);
    else if (x.wrong_objects > 0)
      difficulties.push(`Étape ${x.n} — ${x.wrong_objects} manipulation${x.wrong_objects > 1 ? "s" : ""} d'objets non cités par la consigne.`);
  }
  const notReached = steps.filter((x) => x.status === "not_reached").map((x) => x.n);
  if (notReached.length) difficulties.push(`${notReached.length > 1 ? "Étapes non atteintes" : "Étape non atteinte"} : ${notReached.join(", ")}.`);

  for (const x of steps) {
    for (const f of x.safety_faults) {
      // The TP's safety instruction that matches this fault (it may be written in another step).
      const rule = matchingSafety(f, steps) ?? x.safety;
      recommendations.push(
        rule
          ? `Étape ${x.n} (${f}) : appliquez la consigne de sécurité « ${short(rule, 120)} ».`
          : `Étape ${x.n} (${f}) : relisez les consignes de sécurité du TP avant d'agir.`
      );
    }
    if (x.damages.length) recommendations.push(`À l'étape ${x.n}, comparez votre montage à la consigne avant la mise en service.`);
    if (x.status === "skipped" || x.status === "incomplete") recommendations.push(`Reprenez l'étape ${x.n} : ${short(x.action, 120)}`);
    if (x.wrong_objects > 0)
      recommendations.push(
        quiz
          ? `À l'étape ${x.n}, observez la forme, la couleur et les symboles du composant (indices) avant de le sélectionner.`
          : `À l'étape ${x.n}, repérez d'abord les objets cités par la consigne avant de manipuler.`
      );
  }
  if (notReached.length) recommendations.push("Refaites le TP jusqu'à la dernière étape pour en voir l'ensemble de la démarche.");
  if (!recommendations.length) recommendations.push("Continuez ainsi : refaire le TP en autonomie vous aidera à consolider la démarche.");

  let score: Report["score"] = null;
  let score_note = "Aucun barème n'est défini pour ce TP : pas de note.";
  if (m.grading) {
    const g = m.grading;
    const v = Math.max(0, Math.min(g.max, totals.validated * g.per_validated_step - (totals.safety_faults + totals.damages) * g.per_safety_fault));
    score = { value: Math.round(v * 10) / 10, max: g.max, rule: `${g.per_validated_step} pt par étape validée, −${g.per_safety_fault} par faute` };
    score_note = `Barème du TP : ${score.rule}.`;
  }

  return {
    session_id: s.session_id,
    tp: { id: m.id, title: m.tp.title, domain: m.tp.domain, steps_total: total },
    student: s.student ?? null,
    started_at: new Date(s.started_at).toISOString(),
    duration_sec: s.duration_sec,
    finished: s.finished,
    interactive: s.interactive,
    steps,
    totals,
    score,
    score_note,
    strengths: dedupe(strengths),
    difficulties: dedupe(difficulties),
    recommendations: dedupe(recommendations).slice(0, 6),
    ai: { status: "disabled", note: "Analyse IA non demandée." },
  };
}

/** Facts sent to the AI: results only — no name, no matricule, no session/student id. */
export function aiFacts(r: Report): unknown {
  return {
    tp: { title: r.tp.title, domain: r.tp.domain, steps: r.steps.map((x) => ({ n: x.n, action: x.action, safety: x.safety })) },
    interactive: r.interactive,
    finished: r.finished,
    duration_sec: r.duration_sec,
    steps: r.steps.map((x) => ({
      n: x.n,
      status: x.status,
      time_sec: x.time_sec,
      manipulations: x.manipulations,
      wrong_objects: x.wrong_objects,
      safety_faults: x.safety_faults,
      damages: x.damages,
      aids: x.aids,
    })),
  };
}

/** Numbers written in a text (1,5 → 1.5). */
function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
}

/**
 * Checks the AI answer against the facts.
 * @returns null if acceptable, else the reason it is rejected
 */
export function checkAiFeedback(fb: PedagogicalFeedback, facts: unknown, interactive: boolean): string | null {
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  const text = [fb.summary, ...fb.strengths, ...fb.difficulties, ...fb.advice].join("\n");
  const invented = numbersIn(text).filter((n) => !allowed.has(n));
  if (invented.length) return `nombres absents des résultats : ${[...new Set(invented)].slice(0, 5).join(", ")}`;
  if (!interactive && /(?<!\p{L})(valid[ée]e?s?|r[ée]ussie?s?)(?!\p{L})/iu.test(text)) return "parle d'étapes validées alors que ce TP n'a pas de validation automatique";
  return null;
}

/** Lowercase words of ≥ 5 letters, accents removed (for matching a fault with a safety instruction). */
function keywords(t: string): Set<string> {
  return new Set(
    t
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5)
  );
}

/** Safety instruction of the TP sharing the most keywords with the fault text, if any. */
function matchingSafety(fault: string, steps: StepReport[]): string | null {
  const k = keywords(fault);
  let best: { text: string; score: number } | null = null;
  for (const st of steps) {
    if (!st.safety) continue;
    const score = [...keywords(st.safety)].filter((w) => k.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { text: st.safety, score };
  }
  return best?.text ?? null;
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}
