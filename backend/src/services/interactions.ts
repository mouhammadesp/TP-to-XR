/**
 * Interaction compiler — palier P1 of the automatic PDF → interactive TP pipeline.
 *
 * Same principle as the placement: the AI PROPOSES (PROMPT #5), deterministic code
 * DECIDES. Three generic actions, reusable by any TP, are compiled into the
 * conditions of the existing validation engine (frontend-vr/src/sim/conditions.ts):
 *
 *   place    "Poser X sur l'établi" / "Poser X sur Y"  → target + `placed`
 *   approach "Approcher X de Y"                        → target + `near`
 *   inspect  "Inspecter X"                             → `held`
 *
 * Nothing is invented. An action is kept only if its evidence is really in the
 * step text and contains the action verb, the object and its support / target;
 * otherwise it is dropped and reported (`issues`). Every other part of a step
 * (measure, connect, write down…) is listed as "not checked" (`unverified`), so a
 * step is never reported as fully checked when it is not.
 *
 * 1. validateInteractions()  — text only, before placement;
 * 2. applyStartConstraints() — objects to put on the bench start on a shelf;
 * 3. buildSimulation()       — after placement: targets, rules, coverage report.
 */
import { normalizeName } from "../config/realSizes";
import { ZONES } from "../config/workshopLayout";
import { InteractionType, LLMInteractionsResult, LLMPlacementResult, Step } from "../schemas/tp";
import { GAP, ResolvedPlacement, nearestFreeSpot } from "./placement";
import { InteractionReport, SimCondition, SimTarget, SimulationSpec, StepVerification } from "./tpStore";

/** Parameters of the generic actions: documented defaults of the action library, not read from the TP. */
export const ACTION_PARAMS = {
  /** inspect: the object must be held at least this long (s). */
  inspectSeconds: 2,
  /** approach: max distance (m) between the object and the target's edge (half its size). */
  nearMargin: 0.15,
  nearMax: 0.5,
  /** place on the bench: the target spot is at least this far (m) from where the object starts. */
  minTravel: 0.3,
  /** place: capture radius (m) of a target. */
  radius: { min: 0.08, max: 0.25 },
} as const;

export const BENCH_SUPPORT = "workbench";

export interface InteractionItem {
  asset_id: string;
  name: string;
}

/** An action that passed every textual check. */
export interface CheckedAction {
  /** Step order (1-based). */
  step: number;
  type: InteractionType;
  object: string;
  /** place: BENCH_SUPPORT or an asset id. */
  support: string | null;
  /** approach: asset id. */
  target: string | null;
  evidence: string;
}

export interface ValidatedInteractions {
  actions: CheckedAction[];
  /** Step order → parts of the step that will not be checked (with the reason). */
  unverified: Map<number, string[]>;
  issues: string[];
}

export interface CompiledInteractions {
  /** null when no step has a checkable action (the TP stays non-interactive). */
  simulation: SimulationSpec | null;
  report: InteractionReport;
}

/* ------------------------------------------------------------------ */
/* Lexicon (folded: lowercase, no accents)                              */
/* ------------------------------------------------------------------ */

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const VERBS: Record<InteractionType, Set<string>> = {
  place: words(`poser posez pose posee posees poses posons posant placer placez place placee placees placons placant deposer deposez
    depose deposee deposant installer installez installe installee installons installant mettre mettez mets met mettant disposer disposez
    dispose disposee disposant positionner positionnez positionne positionnee positionnant put lay`),
  approach: words("approcher approchez approche approchee approchant rapprocher rapprochez rapproche rapprochant amener amenez amene amenant bring"),
  inspect: words(`inspecter inspectez inspecte inspectant examiner examinez examine examinant observer observez observe observant regarder
    regardez regardant inspect examine look`),
};

/** Words naming the workbench (support "workbench"). */
const BENCH_WORDS = words("etabli paillasse poste table travail workbench bench desk");

/**
 * Verbs of actions P1 cannot check. Used to make sure a step is never reported as
 * fully checked while it asks for something else (even if the AI forgot to say so).
 */
const UNSUPPORTED_VERBS = words(`mesurer mesurez relever relevez noter notez calculer calculez brancher branchez debrancher debranchez
  relier reliez connecter connectez raccorder raccordez regler reglez serrer serrez desserrer desserrez visser vissez devisser devissez
  verser versez chauffer chauffez attendre attendez allumer allumez eteindre eteignez tourner tournez ajouter ajoutez melanger melangez
  remplir remplissez arroser arrosez couper coupez expliquer expliquez comparer comparez peser pesez tester testez verifier verifiez
  controler controlez enregistrer enregistrez ranger rangez nettoyer nettoyez toucher touchez retirer retirez enlever enlevez remplacer
  remplacez monter montez demonter demontez tendre tendez agiter agitez diluer diluez filtrer filtrez lire lisez repeter repetez
  identifier identifiez reperer reperez deduire deduisez conclure concluez measure connect record write calculate adjust tighten pour`);

/** Any action verb (checkable or not) — a step's verbs must all be checked or reported. */
const isActionVerb = (t: string) => UNSUPPORTED_VERBS.has(t) || VERBS.place.has(t) || VERBS.approach.has(t) || VERBS.inspect.has(t);

/** Max number of words between the verb and the object for "inspect" (the object must be what is inspected). */
const INSPECT_WINDOW = 4;

/* ------------------------------------------------------------------ */
/* Text helpers                                                         */
/* ------------------------------------------------------------------ */

function fold(s: string): string {
  return normalizeName(s.replace(/[’‘`´]/g, "'").replace(/œ/g, "oe").replace(/æ/g, "ae"));
}

/** Folded alphanumeric tokens. */
export function tokens(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Words that identify an object name ("Pile 9 V" → pile; "LED" → led). */
function nameWords(name: string): string[] {
  const t = tokens(name);
  const long = t.filter((w) => w.length >= 4);
  return long.length ? long : t.filter((w) => w.length >= 2 && !/^\d+$/.test(w));
}

const sameWord = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s` || a === `${b}x` || b === `${a}x`;

/** Index of the first token of `toks` that names `name`, or -1. */
function mentionIndex(toks: string[], name: string): number {
  const ws = nameWords(name);
  return toks.findIndex((t) => ws.some((w) => sameWord(t, w)));
}

/** Action type of a verb form ("posant" → place), or null. */
function verbType(t: string): InteractionType | null {
  for (const type of Object.keys(VERBS) as InteractionType[]) if (VERBS[type].has(t)) return type;
  return null;
}

/**
 * True if `needle` (tokens) appears contiguously in `hay` (tokens). Two forms of the
 * same action verb are the same word ("poser la feuille" is found in "en posant la
 * feuille"): the extractor often quotes the infinitive. Nothing else is tolerated.
 */
export function containsSeq(hay: string[], needle: string[]): boolean {
  return findSeq(hay, needle) >= 0;
}

/** Start index of `needle` in `hay` (same tolerance as containsSeq), or -1. */
function findSeq(hay: string[], needle: string[]): number {
  if (!needle.length || needle.length > hay.length) return -1;
  const same = (a: string, b: string) => a === b || (verbType(a) !== null && verbType(a) === verbType(b));
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, k) => same(hay[i + k], t))) return i;
  }
  return -1;
}

/**
 * Reference text of a step: its instruction, copied verbatim from the document by
 * PROMPT #1. The key points are NOT used: they are the parser's own summaries
 * ("préparation du poste"), not words of the document.
 */
export function stepText(s: Step): string {
  return s.action;
}

/** Short excerpt of `text` starting at the word that holds token #k of tokens(text) (≤ 6 words, stops at punctuation). */
function excerptAt(text: string, k: number): string {
  const ws = text.split(/\s+/);
  let j = -1;
  for (let i = 0, n = 0; i < ws.length; i++) {
    n += tokens(ws[i]).length;
    if (n > k) {
      j = i;
      break;
    }
  }
  if (j < 0) return tokens(text)[k] ?? "";
  const out: string[] = [];
  for (const w of ws.slice(j, j + 6)) {
    out.push(w);
    if (/[.;:!?,)]$/.test(w)) break;
  }
  return out.join(" ").replace(/[.;:!?,]+$/, "");
}

/* ------------------------------------------------------------------ */
/* 1. Textual validation                                                */
/* ------------------------------------------------------------------ */

/**
 * Keeps the proposed actions that the step text really asks for.
 * @param steps    parsed TP steps
 * @param items    the TP objects (ids used by the extractor)
 * @param proposal raw PROMPT #5 answer (schema-validated)
 */
export function validateInteractions(steps: Step[], items: InteractionItem[], proposal: LLMInteractionsResult): ValidatedInteractions {
  const byId = new Map(items.map((i) => [i.asset_id, i]));
  const byOrder = new Map(steps.map((s) => [s.order, s]));
  const actions: CheckedAction[] = [];
  const unverified = new Map<number, string[]>(steps.map((s) => [s.order, []]));
  const issues: string[] = [];
  const seenSteps = new Set<number>();

  for (const ps of proposal.steps) {
    const step = byOrder.get(ps.step);
    if (!step) {
      issues.push(`Étape ${ps.step} inconnue dans la proposition d'interactions : ignorée`);
      continue;
    }
    seenSteps.add(step.order);
    const text = stepText(step);
    const stepToks = tokens(text);
    const kept: CheckedAction[] = [];
    const reject = (evidence: string, why: string) => {
      issues.push(`Étape ${step.order} — action non retenue (« ${evidence.slice(0, 80)} ») : ${why}`);
      unverified.get(step.order)!.push(`« ${evidence.slice(0, 100)} » — non vérifiable automatiquement (${why})`);
    };

    for (const a of ps.actions) {
      const ev = tokens(a.evidence);
      const obj = byId.get(a.object);
      if (!obj) {
        reject(a.evidence, `objet « ${a.object} » absent du matériel du TP`);
        continue;
      }
      if (!containsSeq(stepToks, ev)) {
        reject(a.evidence, "citation absente du texte de l'étape");
        continue;
      }
      const verbAt = ev.findIndex((t) => VERBS[a.type].has(t));
      if (verbAt < 0) {
        reject(a.evidence, `aucun verbe d'action « ${a.type === "place" ? "poser" : a.type === "approach" ? "approcher" : "inspecter"} » dans la citation`);
        continue;
      }
      const objAt = mentionIndex(ev, obj.name);
      if (objAt < 0) {
        reject(a.evidence, `l'objet « ${obj.name} » n'est pas cité`);
        continue;
      }
      const ambiguous = ambiguousWith(obj, items, ev, stepToks);
      if (ambiguous) {
        reject(a.evidence, `ambigu : « ${obj.name} » ou « ${ambiguous.name} »`);
        continue;
      }

      let support: string | null = null;
      let target: string | null = null;
      if (a.type === "place") {
        if (a.support === BENCH_SUPPORT) {
          if (!ev.some((t) => BENCH_WORDS.has(t))) {
            reject(a.evidence, "support (établi / poste / table) non cité");
            continue;
          }
          support = BENCH_SUPPORT;
        } else {
          const sup = a.support ? byId.get(a.support) : undefined;
          if (!sup || sup.asset_id === obj.asset_id) {
            reject(a.evidence, "support non précisé ou inconnu");
            continue;
          }
          if (mentionIndex(ev, sup.name) < 0) {
            reject(a.evidence, `le support « ${sup.name} » n'est pas cité`);
            continue;
          }
          support = sup.asset_id;
        }
      } else if (a.type === "approach") {
        const tgt = a.target ? byId.get(a.target) : undefined;
        if (!tgt || tgt.asset_id === obj.asset_id) {
          reject(a.evidence, "objet à approcher non précisé ou inconnu");
          continue;
        }
        if (mentionIndex(ev, tgt.name) < 0) {
          reject(a.evidence, `« ${tgt.name} » n'est pas cité`);
          continue;
        }
        target = tgt.asset_id;
      } else if (objAt < verbAt || objAt - verbAt > INSPECT_WINDOW) {
        // "Observer la déviation de l'aiguille de la boussole": what is observed is not the object.
        reject(a.evidence, `ce qui est examiné n'est pas l'objet « ${obj.name} » lui-même`);
        continue;
      }

      const dup = kept.find((k) => k.type === a.type && k.object === obj.asset_id);
      if (dup) {
        if (a.type === "place" && dup.support !== support) {
          kept.splice(kept.indexOf(dup), 1);
          reject(a.evidence, `ambigu : « ${obj.name} » à poser à deux endroits dans la même étape`);
        }
        continue;
      }
      kept.push({ step: step.order, type: a.type, object: obj.asset_id, support, target, evidence: a.evidence.trim() });
    }

    // Reported parts must be quotes of the step too: a paraphrase ("préparation du poste") is not
    // in the document and is dropped — the real verbs of the step are caught by the safety net below.
    const reported = ps.unsupported.filter((u) => containsSeq(stepToks, tokens(u.text)));
    for (const u of reported) {
      unverified.get(step.order)!.push(`« ${u.text.slice(0, 100)} » — ${u.reason || "action non prise en charge"}`);
    }
    // Safety net: every action verb OCCURRENCE of the step must lie inside a kept action's
    // evidence or a reported part; otherwise it is reported as not checked (even if the AI forgot it).
    const covered = new Set<number>();
    for (const quote of [...kept.map((k) => k.evidence), ...reported.map((u) => u.text)]) {
      const q = tokens(quote);
      const at = findSeq(stepToks, q);
      for (let k = 0; at >= 0 && k < q.length; k++) covered.add(at + k);
    }
    stepToks.forEach((t, k) => {
      if (isActionVerb(t) && !covered.has(k)) unverified.get(step.order)!.push(`« ${excerptAt(text, k)} » — action non prise en charge`);
    });
    actions.push(...kept);
  }

  for (const s of steps) {
    if (seenSteps.has(s.order)) continue;
    issues.push(`Étape ${s.order} absente de l'analyse des manipulations : non vérifiable`);
    unverified.get(s.order)!.push("Étape non analysée — non vérifiable automatiquement");
  }
  return { actions, unverified, issues };
}

/**
 * Another object that the evidence could equally designate (e.g. two "pile …"),
 * when the chosen object's distinctive words are absent from the step.
 */
function ambiguousWith(obj: InteractionItem, items: InteractionItem[], ev: string[], stepToks: string[]): InteractionItem | null {
  const own = nameWords(obj.name);
  for (const other of items) {
    if (other.asset_id === obj.asset_id || mentionIndex(ev, other.name) < 0) continue;
    const otherWords = nameWords(other.name);
    const distinctive = own.filter((w) => !otherWords.some((o) => sameWord(o, w)));
    if (!distinctive.some((w) => stepToks.some((t) => sameWord(t, w)))) return other;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 2. Start positions                                                   */
/* ------------------------------------------------------------------ */

/**
 * Objects the student must put on the workbench start on a shelf (taken from the
 * storage, as in a real lab), so the action is never satisfied from the start.
 * The placement resolver still applies its capacity rules (shelf full → elsewhere).
 */
export function applyStartConstraints(proposal: LLMPlacementResult, actions: CheckedAction[]): LLMPlacementResult {
  const movers = new Set(actions.filter((a) => a.type === "place" && a.support === BENCH_SUPPORT).map((a) => a.object));
  if (!movers.size) return proposal;
  let n = 0;
  const shelf = () => (n++ % 2 === 0 ? "zone_shelf_left" : "zone_shelf_right");
  const placements = proposal.placements.map((p) =>
    movers.has(p.asset_id) && !p.zone.startsWith("zone_shelf") ? { ...p, zone: shelf(), slot: null, offset: { x: 0, z: 0 } } : p
  );
  for (const id of movers) {
    if (!placements.some((p) => p.asset_id === id)) {
      placements.push({ asset_id: id, zone: shelf(), slot: null, offset: { x: 0, z: 0 }, rotation_y: 0, target_size_m: 0.3, color_override: null });
    }
  }
  return { ...proposal, placements };
}

/* ------------------------------------------------------------------ */
/* 3. Targets, rules, coverage                                          */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const shortId = (s: string) => s.replace(/[^a-z0-9_]/gi, "").slice(0, 28);

/**
 * Compiles the checked actions into a SimulationSpec ("generic": conditions only)
 * for the resolved scene, plus the per-step coverage report.
 */
export function buildSimulation(
  steps: Step[],
  items: InteractionItem[],
  checked: ValidatedInteractions,
  placements: ResolvedPlacement[]
): CompiledInteractions {
  const placed = new Map(placements.map((p) => [p.asset_id, p]));
  const name = new Map(items.map((i) => [i.asset_id, i.name]));
  const issues = [...checked.issues];
  const unverified = new Map([...checked.unverified].map(([k, v]) => [k, [...v]]));
  const targets: SimTarget[] = [];
  const benchSpot = new Map<string, SimTarget>();

  const bench = ZONES.find((z) => z.id === "zone_workbench")!;
  const benchY = r3(bench.position.y - bench.size.height / 2);
  const occupied = placements
    .filter((p) => p.zone === bench.id)
    .map((p) => ({ x: p.position.x - bench.position.x, z: p.position.z - bench.position.z, r: p.target_size_m / 2 }));

  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const rules: SimCondition[][] = ordered.map(() => []);
  const verified = new Map<number, string[]>(ordered.map((s) => [s.order, []]));

  for (const a of checked.actions) {
    const idx = ordered.findIndex((s) => s.order === a.step);
    const obj = placed.get(a.object);
    const objName = name.get(a.object) ?? a.object;
    const drop = (why: string) => {
      issues.push(`Étape ${a.step} — « ${a.evidence.slice(0, 80)} » non vérifiable : ${why}`);
      unverified.get(a.step)?.push(`« ${a.evidence.slice(0, 100)} » — non vérifiable automatiquement (${why})`);
    };
    if (idx < 0) continue;
    if (!obj) {
      drop(`« ${objName} » n'a pas pu être placé dans la salle`);
      continue;
    }

    let cond: SimCondition;
    if (a.type === "inspect") {
      cond = { type: "held", asset: a.object, seconds: ACTION_PARAMS.inspectSeconds, label: `${objName} examiné en main (${ACTION_PARAMS.inspectSeconds} s)` };
    } else if (a.type === "place" && a.support === BENCH_SUPPORT) {
      let t = benchSpot.get(a.object);
      if (!t) {
        const size = obj.target_size_m;
        const r = size / 2;
        const halfW = Math.max(0, bench.size.width / 2 - r);
        const halfD = Math.max(0, bench.size.depth / 2 - r);
        const start = { x: obj.position.x - bench.position.x, z: obj.position.z - bench.position.z };
        const startOnBench = obj.zone === bench.id;
        const fits = (x: number, z: number) =>
          occupied.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r + GAP) &&
          (!startOnBench || Math.hypot(start.x - x, start.z - z) >= ACTION_PARAMS.minTravel);
        // Preferred spot: front center of the bench, in front of the student.
        const spot = nearestFreeSpot(0, Math.min(0.35, halfD), halfW, halfD, fits);
        if (!spot) {
          drop("plus de place libre sur l'établi");
          continue;
        }
        occupied.push({ x: spot.x, z: spot.z, r });
        t = {
          id: `t_${shortId(a.object)}_etabli`,
          label: `${objName} ici`,
          position: { x: r3(bench.position.x + spot.x), y: benchY, z: r3(bench.position.z + spot.z) },
          radius: r3(clamp(r + 0.05, ACTION_PARAMS.radius.min, ACTION_PARAMS.radius.max)),
          accepts: [a.object],
          marker: "disc",
        };
        benchSpot.set(a.object, t);
        targets.push(t);
      }
      cond = { type: "placed", asset: a.object, target: t.id, label: `${objName} sur l'établi` };
    } else if (a.type === "place") {
      const sup = placed.get(a.support as string);
      const supName = name.get(a.support as string) ?? String(a.support);
      if (!sup) {
        drop(`le support « ${supName} » n'a pas pu être placé dans la salle`);
        continue;
      }
      const id = `t_${shortId(a.object)}_sur_${shortId(a.support as string)}`;
      let t = targets.find((x) => x.id === id);
      if (!t) {
        t = {
          id,
          label: `${objName} ici`,
          position: { ...sup.position },
          radius: r3(clamp(sup.target_size_m / 2 + 0.03, ACTION_PARAMS.radius.min, ACTION_PARAMS.radius.max)),
          accepts: [a.object],
          marker: "disc",
          anchor: { asset: sup.asset_id, mode: "top" },
        };
        targets.push(t);
      }
      cond = { type: "placed", asset: a.object, target: t.id, label: `${objName} sur ${supName}` };
    } else {
      const tgt = placed.get(a.target as string);
      const tgtName = name.get(a.target as string) ?? String(a.target);
      if (!tgt) {
        drop(`« ${tgtName} » n'a pas pu être placé dans la salle`);
        continue;
      }
      const id = `t_pres_${shortId(a.target as string)}`;
      let t = targets.find((x) => x.id === id);
      if (!t) {
        t = { id, label: `Approcher ici`, position: { ...tgt.position }, radius: 0.1, accepts: [], marker: "disc", anchor: { asset: tgt.asset_id, mode: "base" } };
        targets.push(t);
      }
      const distance = r3(Math.min(ACTION_PARAMS.nearMax, ACTION_PARAMS.nearMargin + tgt.target_size_m / 2));
      cond = { type: "near", asset: a.object, target: t.id, distance, label: `${objName} approché de ${tgtName}` };
    }
    rules[idx].push(cond);
    verified.get(a.step)!.push(cond.label);
  }

  const report: InteractionReport = {
    steps: ordered.map((s): StepVerification => {
      const v = verified.get(s.order) ?? [];
      const u = [...new Set(unverified.get(s.order) ?? [])];
      return { step: s.order, coverage: v.length === 0 ? "none" : u.length ? "partial" : "full", verified: v, unverified: u };
    }),
    issues: [...new Set(issues)],
  };
  const checkable = rules.filter((r) => r.length).length;
  if (!checkable) {
    report.issues.push("Aucune manipulation vérifiable automatiquement (poser, approcher, inspecter) : TP non interactif");
    return { simulation: null, report };
  }
  return {
    simulation: {
      kind: "generic",
      targets,
      rules,
      completion: "Toutes les manipulations vérifiables de ce TP ont été réalisées.",
    },
    report,
  };
}
