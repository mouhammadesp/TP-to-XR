/**
 * Instrument identification demo ("instrument_quiz") — five real Sketchfab
 * equipment models on the workbench. Each asset is fixed and selectable with
 * the controller laser or the mouse. New sessions draw five varied questions
 * from the manifest; legacy manifests retain their original ten-question path.
 *
 *   step 0       discovery — dwell on each instrument → "explored";
 *   steps 1…N    answer the exact question selected for this session.
 */
import { Mesh, PointerEventTypes, PointerInfo, Scene, Vector3 } from "@babylonjs/core";
import { PlacedAsset } from "../scenes/TPScene";
import type { Behavior } from "./behaviors";
import type { QuizQuestion } from "./conditions";
import type { Simulation } from "./Simulation";

export interface Instrument {
  id: string;
  name: string;
  role: string;
  example: string;
  hints: [string, string];
}

/** Electrical-instruments table of tp_demo_instruments; other demos (biology…) ship
 *  the same fields in their manifest (SceneAsset role/example/hints). This table is
 *  the fallback that keeps legacy electrical manifests and the existing tests exact. */
export const INSTRUMENTS: Instrument[] = [
  {
    id: "i_oscilloscope",
    name: "Oscilloscope portable",
    role: "Affiche la forme d'un signal électrique et son évolution dans le temps.",
    example: "Observer le signal d'un capteur ou d'un générateur de fonctions.",
    hints: [
      "C'est le boîtier avec un écran rectangulaire qui peut afficher une courbe, posé au centre de l'établi.",
      "C'est le seul appareil à montrer une forme d'onde qui varie avec le temps.",
    ],
  },
  {
    id: "i_alim_dc",
    name: "Alimentation stabilisée DC",
    role: "Fournit une tension continue réglable et stabilisée pour alimenter un circuit.",
    example: "Alimenter un montage électronique à 5 V ou 12 V.",
    hints: [
      "C'est le plus gros boîtier de l'établi, à gauche, avec des boutons et des bornes de sortie + et -.",
      "Il délivre du courant continu (DC), pas du secteur alternatif.",
    ],
  },
  {
    id: "i_station_soudage",
    name: "Station de soudage",
    role: "Réalise des connexions électroniques permanentes en faisant fondre de l'étain (brasage).",
    example: "Souder deux fils ou un composant sur un circuit imprimé.",
    hints: [
      "C'est le poste avec un fer à souder posé dans son support, à gauche de l'oscilloscope.",
      "Le fer chauffe pour fondre l'étain entre deux composants.",
    ],
  },
  {
    id: "i_multimetre_ana",
    name: "Multimètre analogique",
    role: "Affiche une mesure sur un cadran à aiguille avec une échelle graduée.",
    example: "Lire la résistance d'une résistance avec une aiguille qui se déplace.",
    hints: [
      "C'est l'appareil avec un cadran circulaire et une aiguille, posé à droite de l'oscilloscope.",
      "Pas d'écran numérique : une aiguille indique la valeur sur une échelle graduée.",
    ],
  },
  {
    id: "i_multimetre_num",
    name: "Multimètre numérique",
    role: "Mesure plusieurs grandeurs électriques : tension, courant et résistance, selon le mode sélectionné.",
    example: "Vérifier la tension aux bornes d'une pile de 9 V.",
    hints: [
      "C'est le boîtier rectangulaire avec un écran LCD et un sélecteur rotatif, posé tout à droite de l'établi.",
      "Il a deux fiches de mesure (rouge et noire) et un écran qui affiche la valeur en chiffres.",
    ],
  },
];

/** Legacy fixed phases, retained for old direct links and reports without a seed. */
export const QUIZ = ["i_oscilloscope", "i_alim_dc", "i_station_soudage", "i_multimetre_ana", "i_multimetre_num"] as const;
export const SITUATIONS = ["i_oscilloscope", "i_alim_dc", "i_multimetre_num", "i_station_soudage", "i_multimetre_ana"] as const;
const LEGACY_QUESTIONS: QuizQuestion[] = [
  ...QUIZ.map((answer) => ({ id: `legacy_found_${answer}`, answer, prompt: "", flag: `found_${answer.replace(/^i_/, "")}` })),
  ...SITUATIONS.map((answer) => ({ id: `legacy_solved_${answer}`, answer, prompt: "", flag: `solved_${answer.replace(/^i_/, "")}` })),
];

/** Generic legacy path (no quiz in the manifest) for demo benches other than the
 *  legacy electrical one: a found block then a solved block, in participants order. */
function legacyQuestionsFor(ids: string[]): QuizQuestion[] {
  const strip = (id: string): string => id.replace(/^i_/, "");
  return [
    ...ids.map((answer) => ({ id: `legacy_found_${answer}`, answer, prompt: "", flag: `found_${strip(answer)}` })),
    ...ids.map((answer) => ({ id: `legacy_solved_${answer}`, answer, prompt: "", flag: `solved_${strip(answer)}` })),
  ];
}

export const EXPLORE_GOAL = 5;
const EXPLORE_DWELL = 0.4;
export const PULSE_AFTER_ERRORS = 3;

const COUNT_WORDS: Record<number, string> = { 2: "deux", 3: "trois", 4: "quatre", 5: "cinq", 6: "six", 7: "sept" };
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/** Per-id demo content (role/example/hints) for behaviors other than the legacy
 *  electrical table: the manifest ships nothing else, this keeps discovery and
 *  wrong answers working with sensible defaults. */
function resolveInstrument(id: string, asset: PlacedAsset | undefined): Instrument {
  const a = asset?.asset;
  if (a?.role) {
    const hints = (a.hints ?? []) as string[];
    return { id, name: a.name, role: a.role, example: a.example ?? "", hints: [hints[0] ?? "", hints[1] ?? ""] as [string, string] };
  }
  return INSTRUMENTS.find((c) => c.id === id) ?? {
    id,
    name: a?.name ?? id,
    role: "Équipement de la démonstration : il n'est pas interrogé par le quiz.",
    example: "",
    hints: ["", ""],
  };
}

export function hintFor(c: Instrument, errors: number): string {
  if (errors <= 0) return "";
  const hint = c.hints[Math.min(errors, 2) - 1];
  return errors >= PULSE_AFTER_ERRORS ? `${hint} L'appareil est mis en évidence.` : hint;
}

export function wrongAnswerText(picked: Instrument, asked: Instrument, errors: number): string {
  return `Ceci est : ${picked.name}. ${hintFor(asked, errors)}`.trim();
}

export class InstrumentQuizBehavior implements Behavior {
  public readonly stateTargets: Record<string, string> = {};
  private readonly scene: Scene;
  /** instrument_id → asset + every mesh that can be pointed at (handle + model meshes). */
  private readonly byId = new Map<string, {
    asset: PlacedAsset;
    pickable: Set<Mesh>;
  }>();
  /** Instrument currently pointed at (one pointer at a time in this demo). */
  private hovered: string | null = null;
  private readonly explored = new Set<string>();
  private readonly found = new Set<string>();
  private readonly solved = new Set<string>();
  private readonly questions: readonly QuizQuestion[];
  private readonly attempts: number[];
  private readonly errors: number[];
  private dwell: { id: string; t: number } | null = null;
  private time = 0;
  private readonly baseScales = new Map<string, Vector3>();
  /** Demo content per participant id (manifest role/example/hints or legacy table). */
  private readonly infoById = new Map<string, Instrument>();
  /** Discovery stops when so many participants were dwell-identified (min(5, bench size)). */
  private readonly exploreGoal = EXPLORE_GOAL;

  constructor(private readonly sim: Simulation) {
    // Participants = every asset of the demo bench (the behavior kind is demo-only).
    // Information comes from the manifest (role/example/hints — biology demo) with
    // the electrical legacy table as fallback (instruments demo).
    const ids = sim.ids().filter((id) => !!sim.asset(id));
    this.exploreGoal = Math.min(EXPLORE_GOAL, ids.length);
    const legacyTableIds = new Set(INSTRUMENTS.map((c) => c.id));
    const electricalLegacy = ids.every((id) => legacyTableIds.has(id));
    this.questions = sim.spec.quiz?.questions ?? (electricalLegacy ? LEGACY_QUESTIONS : legacyQuestionsFor(ids));
    this.infoById = new Map(ids.map((id) => [id, resolveInstrument(id, sim.asset(id))]));
    this.attempts = this.questions.map(() => 0);
    this.errors = this.questions.map(() => 0);
    let scene0: Scene | null = null;
    for (const id of ids) {
      const asset = sim.asset(id);
      if (!asset) {
        console.warn(`⚠️ instrument_quiz: asset missing ${id}`);
        continue;
      }
      if (!scene0) scene0 = asset.handle.getScene();
      this.baseScales.set(id, asset.handle.scaling.clone());
      const pickable = new Set<Mesh>([asset.handle]);
      for (const m of asset.meshes) if (m instanceof Mesh) pickable.add(m);
      this.byId.set(id, { asset, pickable });
    }
    this.scene = scene0 as Scene;
    if (!this.scene) return;
    // Discovery: count instruments pointed at (dwell) on step 0.
    this.scene.onPointerObservable.add((pi) => this.onPointer(pi));
    console.log(`🔧 instrument_quiz: ${this.byId.size} instruments, ${this.questions.length} questions (seed ${sim.spec.quiz?.seed ?? "legacy"})`);
  }

  public get intro(): string {
    return this.sim.spec.quiz
      ? `Démonstration : découvrez les ${countWord(this.byId.size)} équipements, puis répondez à ${this.questions.length} questions variées.`
      : "Démonstration : découvrez les cinq instruments de mesure sur l'établi, puis identifiez-les.";
  }

  public update(dt: number): void {
    this.time += dt;
    if (this.dwell && this.sim.step === 0) {
      this.dwell.t += dt;
      if (this.dwell.t >= EXPLORE_DWELL) this.explore(this.dwell.id);
    }
    this.paintHintPulse();
  }

  /** After three errors, gently pulse only the expected instrument; never alter the model itself. */
  private paintHintPulse(): void {
    const q = this.step - 1;
    const question = this.questions[q];
    const pulseId = question && this.errors[q] >= PULSE_AFTER_ERRORS && !this.sim.stepValidated ? question.answer : null;
    const scale = 1.025 + 0.025 * Math.sin(this.time * 5);
    for (const [id, { asset }] of this.byId) {
      const base = this.baseScales.get(id);
      if (base) asset.handle.scaling.copyFrom(base).scaleInPlace(id === pulseId ? scale : 1);
    }
  }

  public onStepChanged(): void {
    this.dwell = null;
  }

  public get step(): number {
    return this.sim.step;
  }

  public validationMessage(index: number): { title: string; text: string } | null {
    if (index === 0) {
      return {
        title: "Découverte terminée !",
        text: this.sim.spec.quiz
          ? `Les ${countWord(this.byId.size)} équipements sont repérés. Le quiz commence : ${this.questions.length} questions.`
          : "Les cinq instruments sont repérés. Le quiz commence : 5 identifications, puis 5 situations.",
      };
    }
    const question = this.questions[index - 1];
    if (!question) return null;
    const c = this.instrument(question.answer);
    return c ? { title: "Bonne réponse !", text: `${c.name} — ${c.role}` } : null;
  }

  public summary(): string[] {
    const tries = this.attempts.reduce((a, b) => a + b, 0);
    const errs = this.errors.reduce((a, b) => a + b, 0);
    const result = this.sim.spec.quiz
      ? `🎯 ${this.answeredAsked()}/${this.questions.length} questions réussies`
      : `🎯 ${this.foundAsked()}/${this.byId.size} identifiés · ${this.solvedAsked()}/${this.byId.size} situations résolues`;
    return [
      `✓ ${this.explored.size}/${this.byId.size} instruments découverts`,
      result,
      `✍ ${tries} tentative${tries > 1 ? "s" : ""} (${errs} erreur${errs > 1 ? "s" : ""})`,
    ];
  }
  private onPointer(pi: PointerInfo): void {
    const picked = pi.pickInfo?.pickedMesh as Mesh | null;
    const instrumentId = picked ? this.instrumentOfMesh(picked) : null;
    if (pi.type === PointerEventTypes.POINTERMOVE) this.setHover(instrumentId);
    const pointerType = String((pi.event as PointerEvent | undefined)?.pointerType ?? "");
    const xr = pointerType.startsWith("xr");
    // One selection per physical action: trigger down in XR, completed click with the mouse.
    const select = (xr && pi.type === PointerEventTypes.POINTERDOWN) || (!xr && pi.type === PointerEventTypes.POINTERTAP);
    if (select && instrumentId) {
      this.setHover(instrumentId);
      this.select(instrumentId, xr ? { hand: "none", gesture: "grab" } : { hand: "none", gesture: "mouse" });    }
  }

  private setHover(id: string | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.dwell = id ? { id, t: 0 } : null;
  }

  private select(id: string, src: { hand: "none"; gesture: "grab" | "mouse" }): void {
    const s = this.sim.session;
    if (s.finished) return;
    const step = this.step;
    if (step === 0) {
      this.explore(id);
      const c = this.instrument(id);
      if (c) this.sim.notify("info", c.name, `${c.role}. ${c.example}`);
      return;
    }
    const idx = step - 1;
    const question = this.questions[idx];
    if (!question || this.sim.stepValidated) return;
    const asked = question.answer;
    const correct = id === asked;
    this.attempts[idx]++;
    s.recordAnswer({ ...src, target: id, correct });
    if (correct) {
      if (this.sim.spec.quiz || question.flag.startsWith("found_")) this.found.add(asked);
      else this.solved.add(asked);
      this.sim.setFlag(question.flag, true);
    } else {
      this.errors[idx]++;
      const picked = this.instrument(id);
      const askedC = this.instrument(asked);
      if (picked && askedC) this.sim.notify("info", "Pas tout à fait…", wrongAnswerText(picked, askedC, this.errors[idx]));
    }
  }

  private explore(id: string): void {
    if (this.explored.has(id)) return;
    this.explored.add(id);
    if (this.explored.size >= this.exploreGoal) this.sim.setFlag("explored", true);
  }

  private instrument(id: string): Instrument | undefined {
    return this.infoById.get(id) ?? INSTRUMENTS.find((c) => c.id === id);
  }

  private instrumentOfMesh(mesh: Mesh): string | null {
    for (const [id, { pickable }] of this.byId) {
      if (pickable.has(mesh)) return id;
    }
    return null;
  }

  private foundAsked(): number {
    return this.found.size;
  }

  private answeredAsked(): number {
    return this.questions.filter((q) => this.found.has(q.answer)).length;
  }

  private solvedAsked(): number {
    return this.solved.size;
  }
}

