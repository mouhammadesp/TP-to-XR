/**
 * Instrument identification demo ("instrument_quiz") — five real Sketchfab
 * instruments on the workbench. Each asset is fixed + clickable
 * (manifest `clickable: true`); the controller trigger / a click routes to
 * Behavior.onClick.
 *
 *   step 0   discovery — dwell on each instrument → "explored" when all 5 seen;
 *   steps 1-5 identification — pick the asked instrument (found_<id>);
 *   steps 6-10 situations    — pick the instrument for a real task (solved_<id>).
 */
import { Mesh, PointerEventTypes, PointerInfo, Scene } from "@babylonjs/core";
import { PlacedAsset } from "../scenes/TPScene";
import type { Behavior } from "./behaviors";
import type { Simulation } from "./Simulation";

export interface Instrument {
  id: string;
  name: string;
  role: string;
  example: string;
  hints: [string, string];
}

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

export const QUIZ = ["i_oscilloscope", "i_alim_dc", "i_station_soudage", "i_multimetre_ana", "i_multimetre_num"] as const;
export const SITUATIONS = ["i_oscilloscope", "i_alim_dc", "i_multimetre_num", "i_station_soudage", "i_multimetre_ana"] as const;

export const EXPLORE_GOAL = 5;
const EXPLORE_DWELL = 0.4;
export const PULSE_AFTER_ERRORS = 3;

export function hintFor(c: Instrument, errors: number): string {
  if (errors <= 0) return "";
  const hint = c.hints[Math.min(errors, 2) - 1];
  return errors >= PULSE_AFTER_ERRORS ? `${hint} L'appareil est mis en évidence.` : hint;
}

export function wrongAnswerText(picked: Instrument, asked: Instrument, errors: number): string {
  return `Ceci est : ${picked.name}. ${hintFor(asked, errors)}`.trim();
}

const TOTAL_QUESTIONS = QUIZ.length + SITUATIONS.length;

function askedFor(step: number): string | null {
  if (step <= QUIZ.length) return QUIZ[step - 1];
  if (step <= TOTAL_QUESTIONS) return SITUATIONS[step - QUIZ.length - 1];
  return null;
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
  private readonly attempts = Array(TOTAL_QUESTIONS).fill(0);
  private readonly errors = Array(TOTAL_QUESTIONS).fill(0);
  private dwell: { id: string; t: number } | null = null;
  private time = 0;

  constructor(private readonly sim: Simulation) {
    let scene0: Scene | null = null;
    for (const id of [...QUIZ, ...SITUATIONS]) {
      const asset = sim.asset(id);
      if (!asset) {
        console.warn(`⚠️ instrument_quiz: asset missing ${id}`);
        continue;
      }
      if (!scene0) scene0 = asset.handle.getScene();
      const pickable = new Set<Mesh>([asset.handle]);
      for (const m of asset.meshes) if (m instanceof Mesh) pickable.add(m);
      this.byId.set(id, { asset, pickable });
    }
    this.scene = scene0 as Scene;
    // Discovery: count instruments pointed at (dwell) on step 0.
    this.scene.onPointerObservable.add((pi) => this.onPointer(pi));
    console.log(`🔧 instrument_quiz: ${this.byId.size} instruments`);
  }

  public get intro(): string {
    return "Démonstration : découvrez les cinq instruments de mesure sur l'établi, puis identifiez-les.";
  }

  public update(dt: number): void {
    if (this.dwell && this.sim.step === 0) {
      this.dwell.t += dt;
      if (this.dwell.t >= EXPLORE_DWELL) this.explore(this.dwell.id);
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
        text: "Les cinq instruments sont repérés. Le quiz commence : 5 identifications, puis 5 situations.",
      };
    }
    const asked = askedFor(index);
    if (!asked) return null;
    const c = this.instrument(asked);
    return c ? { title: "Bonne réponse !", text: `${c.name} — ${c.role}` } : null;
  }

  public summary(): string[] {
    const tries = this.attempts.reduce((a, b) => a + b, 0);
    const errs = this.errors.reduce((a, b) => a + b, 0);
    return [
      `✓ ${this.explored.size}/${INSTRUMENTS.length} instruments découverts`,
      `🎯 ${this.foundAsked()}/${QUIZ.length} identifiés · ${this.solvedAsked()}/${SITUATIONS.length} situations résolues`,
      `✍ ${tries} tentative${tries > 1 ? "s" : ""} (${errs} erreur${errs > 1 ? "s" : ""})`,
    ];
  }

  private onPointer(pi: PointerInfo): void {
    const picked = pi.pickInfo?.pickedMesh as Mesh | null;
    const instrumentId = picked ? this.instrumentOfMesh(picked) : null;
    if (pi.type === PointerEventTypes.POINTERMOVE) this.setHover(instrumentId);
    const select = pi.type === PointerEventTypes.POINTERDOWN || pi.type === PointerEventTypes.POINTERTAP;
    if (select && instrumentId) {
      this.setHover(instrumentId);
      this.select(instrumentId);
    }
  }

  private setHover(id: string | null): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.dwell = id ? { id, t: 0 } : null;
  }

  private select(id: string): void {
    const s = this.sim.session;
    if (s.finished) return;
    const step = this.step;
    if (step === 0) {
      this.explore(id);
      const c = this.instrument(id);
      if (c) this.sim.notify("info", c.name, `${c.role}. ${c.example}`);
      return;
    }
    if (step < 1 || step > TOTAL_QUESTIONS || this.sim.stepValidated) return;
    const asked = askedFor(step);
    if (!asked) return;
    const correct = id === asked;
    const idx = step - 1;
    this.attempts[idx]++;
    s.recordAnswer({ hand: "none", gesture: "mouse", target: id, correct });
    if (correct) {
      if (step <= QUIZ.length) this.found.add(asked);
      else this.solved.add(asked);
      this.sim.setFlag(step <= QUIZ.length ? `found_${asked}` : `solved_${asked}`, true);
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
    if (this.explored.size >= EXPLORE_GOAL) this.sim.setFlag("explored", true);
  }

  private instrument(id: string): Instrument | undefined {
    return INSTRUMENTS.find((c) => c.id === id);
  }

  private instrumentOfMesh(mesh: Mesh): string | null {
    for (const [id, { pickable }] of this.byId) {
      if (pickable.has(mesh)) return id;
    }
    return null;
  }

  private foundAsked(): number {
    return QUIZ.filter((id) => this.found.has(id)).length;
  }

  private solvedAsked(): number {
    return SITUATIONS.filter((id) => this.solved.has(id)).length;
  }
}

