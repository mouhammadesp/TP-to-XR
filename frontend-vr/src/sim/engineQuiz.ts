/**
 * Engine-bay identification demo ("engine_quiz") — real photogrammetry scan of an
 * Audi A3 (8P) engine bay with its TFSI engine (backend demoTps.ts: tp_demo_engine).
 *
 * The scan is ONE mesh: its parts cannot be moved or taken apart. The components are
 * selected through invisible boxes ("zones") placed on the parts really visible in the
 * scan; they ship inside the GLB as empty nodes "zone__<id>" (scale = box size), built
 * by tools/engine/build_engine_glb.py, so they follow the model whatever its transform.
 *
 *   step 1    discovery — pointing at a zone shows its name; 3 different zones → "explored"
 *   step 2..6 quiz      — the visitor selects the asked component (trigger / click):
 *                         right → flag found_<id> (the step validates: "Bonne réponse !" card,
 *                         sound, vibration, function of the part); wrong → kind hint, retry,
 *                         progressive hints, the answer only pulses after 3 errors.
 *
 * Answers are recorded as attempts of the step (TPSession.recordAnswer): the existing
 * accuracy, report and step details apply unchanged.
 */
import { Color3, Mesh, MeshBuilder, PointerEventTypes, PointerInfo, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { PlacedAsset } from "../scenes/TPScene";
import { FONT, PaintedSurface, paintMesh, roundRect } from "../ui/textCanvas";
import type { Behavior } from "./behaviors";
import type { QuizQuestion } from "./conditions";
import type { Simulation } from "./Simulation";

/** A component of the scan the visitor can point at. */
export interface EngineComponent {
  id: string;
  name: string;
  /** Shorter name for the tag above the part (default: name). */
  tag?: string;
  /** System it belongs to — says so when it is NOT part of the engine itself. */
  system: string;
  /** What it does, for a visitor without mechanical knowledge (shown once found). */
  role: string;
  /** Progressive hints (1st error, 2nd error and after). Never the answer itself. */
  hints: [string, string];
}

/** Every zone of the GLB (ids = "zone__<id>" nodes). Only parts clearly visible in the scan. */
export const COMPONENTS: EngineComponent[] = [
  {
    id: "oil_cap",
    name: "Bouchon de remplissage d'huile",
    tag: "Bouchon d'huile",
    system: "Lubrification du moteur",
    role: "C'est par ici qu'on ajoute l'huile moteur. L'huile lubrifie les pièces en mouvement pour limiter l'usure et l'échauffement.",
    hints: [
      "Il se trouve sur le dessus du moteur, tout près du cache noir qui porte les anneaux Audi.",
      "C'est un bouchon noir et rond, marqué du petit symbole d'une burette d'huile.",
    ],
  },
  {
    id: "dipstick",
    name: "Jauge à huile",
    system: "Lubrification du moteur",
    role: "Cette tige plonge dans le réservoir d'huile du moteur : on la retire pour lire le niveau entre les repères mini et maxi, moteur arrêté.",
    hints: [
      "Elle sort du moteur, du côté de l'avant de la voiture (le côté le plus proche de vous).",
      "Cherchez une petite poignée orange en forme d'anneau, juste devant le cache moteur.",
    ],
  },
  {
    id: "coolant_tank",
    name: "Vase d'expansion du liquide de refroidissement",
    tag: "Vase d'expansion",
    system: "Refroidissement du moteur",
    role: "Il contient la réserve de liquide de refroidissement, qui circule dans le moteur et le radiateur pour évacuer la chaleur. Ne jamais l'ouvrir moteur chaud : il est sous pression.",
    hints: [
      "C'est un réservoir en plastique translucide, sur le côté du compartiment opposé à la batterie.",
      "Il est blanchâtre, avec un gros bouchon bleu rond — ce n'est pas le petit bouchon bleu du lave-glace.",
    ],
  },
  {
    id: "air_filter",
    name: "Boîtier du filtre à air",
    tag: "Filtre à air",
    system: "Admission d'air du moteur",
    role: "Il contient le filtre qui arrête poussières et insectes : le moteur a besoin d'air propre pour brûler le carburant.",
    hints: [
      "Il se trouve à l'avant du compartiment, du même côté que la batterie.",
      "C'est un boîtier noir au couvercle nervuré, relié au moteur par un gros tuyau annelé.",
    ],
  },
  {
    id: "battery",
    name: "Batterie",
    system: "Circuit électrique du véhicule (ne fait pas partie du moteur)",
    role: "Elle fournit le courant qui fait tourner le démarreur pour lancer le moteur, et alimente l'électronique quand le moteur est arrêté.",
    hints: [
      "Elle est rangée sous un capot de protection noir, près du pare-brise.",
      "Son couvercle noir porte un petit symbole rectangulaire avec un « + » et un « − ».",
    ],
  },
  {
    id: "engine_cover",
    name: "Cache moteur",
    system: "Moteur",
    role: "Capot en plastique qui protège le dessus du moteur et atténue le bruit. TFSI : moteur essence à turbocompresseur et injection directe.",
    hints: [
      "Il occupe le centre du moteur, entre la jauge orange et le conduit d'admission.",
      "C'est le large cache noir marqué des quatre anneaux Audi et du sigle TFSI.",
    ],
  },
  {
    id: "intake_duct",
    name: "Conduit d'admission d'air",
    tag: "Conduit d'admission",
    system: "Admission d'air du moteur",
    role: "Ce tuyau annelé amène l'air filtré du boîtier de filtre vers le turbocompresseur, puis le moteur.",
    hints: [
      "Suivez le gros tuyau qui part du boîtier de filtre à air et rejoint le moteur.",
      "C'est le conduit noir annelé et coudé, à droite du cache moteur vu depuis l'avant.",
    ],
  },
  {
    id: "washer_cap",
    name: "Bouchon du réservoir de lave-glace",
    tag: "Bouchon de lave-glace",
    system: "Nettoyage du pare-brise (ne fait pas partie du moteur)",
    role: "On y verse le liquide qui nettoie le pare-brise. Son bouchon bleu porte le symbole d'un pare-brise.",
    hints: [
      "Cherchez près du vase d'expansion, à l'avant du compartiment, hors du moteur.",
      "C'est le petit bouchon bleu avec un symbole de pare-brise, en contrebas du gros bouchon du vase d'expansion.",
    ],
  },
  {
    id: "brake_fluid",
    name: "Réservoir de liquide de frein",
    tag: "Liquide de frein",
    system: "Freinage (ne fait pas partie du moteur)",
    role: "Il contient le liquide qui transmet l'effort de la pédale de frein jusqu'aux freins des roues.",
    hints: [
      "Il est fixé côté pare-brise, près du maître-cylindre, et ne fait pas partie du moteur.",
      "C'est le petit réservoir clair avec un bouchon noir, entre le cache moteur et le couvercle de batterie.",
    ],
  },
  {
    id: "radiator",
    name: "Radiateur du circuit de refroidissement",
    tag: "Radiateur",
    system: "Refroidissement du moteur",
    role: "Grand échangeur de chaleur : le liquide chaud du moteur y circule et l'air du déplacement le refroidit ; le motoventilateur fait tourner l'air à l'arrêt.",
    hints: [
      "C'est le grand panneau à nid d'abeille, sur toute la largeur, tout au fond du compartiment du côté avant de la voiture.",
      "Le petit réservoir translucide posé à côté lui fournit son liquide — la pièce demandée, elle, est pleine de fines ailettes.",
    ],
  },
];

/** Legacy fixed order, retained only for manifests and reports created before seeded sessions. */
export const QUIZ = ["oil_cap", "dipstick", "coolant_tank", "air_filter", "battery"] as const;
const LEGACY_QUESTIONS: QuizQuestion[] = QUIZ.map((answer) => ({
  id: `legacy_${answer}`,
  answer,
  prompt: "",
  flag: `found_${answer}`,
}));

/** Different components to point at during the discovery step. */
export const EXPLORE_GOAL = 3;
/** Pointing time (s) for a component to count as explored. */
const EXPLORE_DWELL = 0.4;
/** Errors on a question after which the right component pulses. */
export const PULSE_AFTER_ERRORS = 3;

const ENGINE_ASSET = "x_moteur";
/** Height of the name tag above the top of its part (m). */
const LABEL_RISE = 0.12;
const COLORS = {
  hover: new Color3(0.35, 0.8, 1),
  found: new Color3(0.25, 0.95, 0.5),
  hint: new Color3(1, 0.72, 0.15),
};

/** Hint to show after `errors` wrong answers on a question (pure, unit-tested). */
export function hintFor(c: EngineComponent, errors: number): string {
  if (errors <= 0) return "";
  const hint = c.hints[Math.min(errors, 2) - 1];
  return errors >= PULSE_AFTER_ERRORS ? `${hint} Le composant clignote en orange.` : hint;
}

/** Feedback of a wrong answer: names what was pointed at, never the expected part (pure, unit-tested). */
export function wrongAnswerText(picked: EngineComponent, asked: EngineComponent, errors: number): string {
  const not = picked.system.includes("ne fait pas partie") ? ` (${picked.system.replace(/^.*\(|\)$/g, "")})` : "";
  return `Ceci est : ${picked.name}${not}. ${hintFor(asked, errors)}`.trim();
}

interface Zone {
  component: EngineComponent;
  box: Mesh;
  mat: StandardMaterial;
  label: Mesh;
  labelSurface: PaintedSurface;
  /** Thin line from the tag down to the part (the tag floats above it). */
  leader: Mesh;
  /** Label state: hidden, name (discovery hover) or found. */
  labelMode: "off" | "name" | "found";
}

export class EngineQuizBehavior implements Behavior {
  public readonly stateTargets: Record<string, string> = {};
  private readonly scene: Scene;
  private readonly zones = new Map<string, Zone>();
  private readonly byBox = new Map<Mesh, Zone>();
  /** Zone under each pointer (mouse, left / right controller). */
  private readonly hoveredBy = new Map<number, Zone>();
  private readonly explored = new Set<string>();
  private readonly found = new Set<string>();
  private readonly questions: readonly QuizQuestion[];
  /** Per selected question: attempts and wrong answers. */
  private readonly attempts: number[];
  private readonly errors: number[];
  private dwell: { zone: Zone; t: number } | null = null;
  private justFound: { zone: Zone; t: number } | null = null;
  private time = 0;

  constructor(private readonly sim: Simulation) {
    this.questions = sim.spec.quiz?.questions ?? LEGACY_QUESTIONS;
    this.attempts = this.questions.map(() => 0);
    this.errors = this.questions.map(() => 0);
    const engine = sim.asset(ENGINE_ASSET);
    this.scene = (engine?.handle.getScene() ?? null) as Scene;
    if (!engine || !this.scene) {
      console.warn("⚠️ engine_quiz: engine asset missing");
      return;
    }
    this.buildZones(engine);
    this.scene.onPointerObservable.add((pi) => this.onPointer(pi));
    console.log(`🔧 engine_quiz: ${this.zones.size} zones, ${this.questions.length} questions (seed ${sim.spec.quiz?.seed ?? "legacy"})`);
  }

  /* ---------------------------------------------------------------- hooks */

  public get intro(): string {
    return `Démonstration : explorez le compartiment moteur, puis répondez à ${this.questions.length} questions avec le laser ou la souris.`;
  }

  public update(dt: number): void {
    this.time += dt;
    // Discovery: a component pointed at long enough counts as explored.
    if (this.dwell && this.step === 0) {
      this.dwell.t += dt;
      if (this.dwell.t >= EXPLORE_DWELL) this.explore(this.dwell.zone);
    }
    this.paintZones();
  }

  public onStepChanged(): void {
    this.dwell = null;
    for (const z of this.zones.values()) this.setLabel(z, this.found.has(z.component.id) ? "found" : "off");
  }

  public validationMessage(index: number): { title: string; text: string } | null {
    if (index === 0) return { title: "Découverte terminée !", text: `Le quiz commence : ${this.questions.length} composants à retrouver. Les noms ne s'affichent plus au survol.` };
    const question = this.questions[index - 1];
    const c = question ? this.component(question.answer) : undefined;
    return c ? { title: "Bonne réponse !", text: `${c.name} — ${c.role}` } : null;
  }

  public summary(): string[] {
    const tries = this.attempts.reduce((a, b) => a + b, 0);
    const errs = this.errors.reduce((a, b) => a + b, 0);
    return [
      `✓ ${this.foundAsked()}/${this.questions.length} composants identifiés`,
      `🎯 ${tries} tentative${tries > 1 ? "s" : ""} (${errs} erreur${errs > 1 ? "s" : ""})`,
    ];
  }

  /* ---------------------------------------------------------------- input */

  private get step(): number {
    return this.sim.step;
  }

  private onPointer(pi: PointerInfo): void {
    const ev = pi.event as PointerEvent | undefined;
    const id = ev?.pointerId ?? 0;
    const zone = pi.pickInfo?.hit && pi.pickInfo.pickedMesh ? this.byBox.get(pi.pickInfo.pickedMesh as Mesh) ?? null : null;
    const xr = String(ev?.pointerType ?? "").startsWith("xr");
    if (pi.type === PointerEventTypes.POINTERMOVE) this.setHover(id, zone);
    // Controllers select on trigger press; the mouse on a click (a drag only turns the view).
    const select = (xr && pi.type === PointerEventTypes.POINTERDOWN) || (!xr && pi.type === PointerEventTypes.POINTERTAP);
    if (select && zone) {
      this.setHover(id, zone);
      this.select(zone, xr ? { hand: "none", gesture: "grab" } : { hand: "none", gesture: "mouse" });
    }
  }

  private setHover(pointerId: number, zone: Zone | null): void {
    const before = this.hoveredBy.get(pointerId) ?? null;
    if (before === zone) return;
    if (zone) this.hoveredBy.set(pointerId, zone);
    else this.hoveredBy.delete(pointerId);
    this.dwell = zone ? { zone, t: 0 } : null;
    // Names on hover: discovery step, and freely once the demo is over.
    const naming = this.step === 0 || this.sim.session.finished;
    if (before && before.labelMode === "name" && ![...this.hoveredBy.values()].includes(before)) this.setLabel(before, "off");
    if (zone && naming && zone.labelMode === "off") this.setLabel(zone, "name");
  }

  private select(zone: Zone, src: { hand: "none"; gesture: "grab" | "mouse" }): void {
    const s = this.sim.session;
    if (s.finished) return;
    if (this.step === 0) {
      this.explore(zone);
      this.sim.notify("info", zone.component.name, `${zone.component.system}. ${zone.component.role}`);
      return;
    }
    const q = this.step - 1;
    const question = this.questions[q];
    const asked = question ? this.component(question.answer) : undefined;
    if (!question || !asked || this.sim.stepValidated) return; // already answered: the next question is coming
    const correct = zone.component.id === asked.id;
    this.attempts[q]++;
    s.recordAnswer({ ...src, target: zone.component.id, correct });
    if (correct) {
      this.found.add(asked.id);
      this.justFound = { zone, t: this.time };
      this.setLabel(zone, "found");
      // The flag belongs to this exact drawn question and matches its manifest rule.
      this.sim.setFlag(question.flag, true);
    } else {
      this.errors[q]++;
      this.sim.notify("info", "Pas tout à fait…", wrongAnswerText(zone.component, asked, this.errors[q]));
    }
  }

  private explore(zone: Zone): void {
    if (this.explored.has(zone.component.id)) return;
    this.explored.add(zone.component.id);
    if (this.explored.size >= EXPLORE_GOAL) this.sim.setFlag("explored", true);
  }

  /* ---------------------------------------------------------------- visuals */

  /** Hover (cyan), answer just found (green pulse, 2.5 s), hint after 3 errors (orange pulse). */
  private paintZones(): void {
    const hovered = new Set(this.hoveredBy.values());
    const q = this.step - 1;
    const pulseId = q >= 0 && q < this.questions.length && this.errors[q] >= PULSE_AFTER_ERRORS && !this.sim.stepValidated ? this.questions[q].answer : null;
    const wave = 0.5 + 0.5 * Math.sin(this.time * 5);
    for (const z of this.zones.values()) {
      let color: Color3 | null = null;
      let alpha = 0;
      if (this.justFound?.zone === z && this.time - this.justFound.t < 2.5) {
        color = COLORS.found;
        alpha = 0.12 + 0.16 * wave;
      } else if (z.component.id === pulseId) {
        color = COLORS.hint;
        alpha = 0.06 + 0.2 * wave;
      } else if (hovered.has(z)) {
        color = COLORS.hover;
        alpha = 0.2;
      }
      if (color) z.mat.emissiveColor.copyFrom(color);
      z.box.visibility = alpha;
    }
  }

  private setLabel(z: Zone, mode: Zone["labelMode"]): void {
    if (z.labelMode === mode) return;
    z.labelMode = mode;
    z.label.setEnabled(mode !== "off");
    z.leader.setEnabled(mode !== "off");
    if (mode !== "off") z.labelSurface.redraw();
  }

  /* ---------------------------------------------------------------- construction */

  private component(id: string): EngineComponent | undefined {
    return COMPONENTS.find((c) => c.id === id);
  }

  private foundAsked(): number {
    return this.questions.filter((q) => this.found.has(q.answer)).length;
  }

  /** One invisible, pickable box per "zone__<id>" node of the GLB, plus its name tag. */
  private buildZones(engine: PlacedAsset): void {
    const nodes = engine.handle.getChildTransformNodes(false).filter((n) => n.name.startsWith("zone__"));
    engine.handle.computeWorldMatrix(true);
    for (const node of nodes) {
      const c = this.component(node.name.slice("zone__".length));
      if (!c) continue;
      const box = MeshBuilder.CreateBox(`engine_zone_${c.id}`, { size: 1 }, this.scene);
      box.parent = node as TransformNode; // node scale = box size (m)
      const mat = new StandardMaterial(`engine_zone_mat_${c.id}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = COLORS.hover.clone();
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      box.material = mat;
      box.visibility = 0; // invisible but pickable
      box.isPickable = true;
      box.enablePointerMoveEvents = true;
      box.metadata = { role: "engine_zone", component: c.id };
      box.computeWorldMatrix(true);
      const bb = box.getBoundingInfo().boundingBox;
      const top = new Vector3(bb.centerWorld.x, bb.maximumWorld.y - 0.01, bb.centerWorld.z);
      const tagAt = top.add(new Vector3(0, LABEL_RISE, 0));
      const leader = MeshBuilder.CreateLines(`engine_leader_${c.id}`, { points: [top, tagAt.subtract(new Vector3(0, 0.028, 0))] }, this.scene);
      leader.color = new Color3(0.92, 0.95, 1);
      leader.isPickable = false;
      leader.setEnabled(false);
      // paintMesh draws at once: the tag reads the mode through `ref`, set right after.
      let ref: Zone | null = null;
      const zone: Zone = { component: c, box, mat, leader, labelMode: "off", ...this.makeLabel(c, tagAt, () => ref?.labelMode ?? "off") };
      ref = zone;
      this.zones.set(c.id, zone);
      this.byBox.set(box, zone);
    }
    const missing = COMPONENTS.filter((c) => !this.zones.has(c.id)).map((c) => c.id);
    if (missing.length) console.warn(`⚠️ engine_quiz: zones missing in the model: ${missing.join(", ")}`);
  }

  /** Name tag above a component: dark while discovering, green once found. */
  private makeLabel(c: EngineComponent, at: Vector3, mode: () => Zone["labelMode"]): { label: Mesh; labelSurface: PaintedSurface } {
    const label = MeshBuilder.CreatePlane(`engine_label_${c.id}`, { width: 0.3, height: 0.055 }, this.scene);
    label.billboardMode = Mesh.BILLBOARDMODE_ALL;
    label.position = at;
    label.isPickable = false;
    const labelSurface = paintMesh(this.scene, label, 600, 110, (ctx, w, h) => {
      const found = mode() === "found";
      ctx.fillStyle = found ? "rgba(19,105,60,0.92)" : "rgba(15,20,30,0.85)";
      roundRect(ctx, 2, 2, w - 4, h - 4, 22);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      let px = 44;
      const text = `${found ? "✓ " : ""}${c.tag ?? c.name}`;
      do ctx.font = `bold ${px}px ${FONT}`;
      while (ctx.measureText(text).width > w - 30 && --px > 24);
      ctx.fillText(text, w / 2, h / 2 + px * 0.36);
    });
    labelSurface.texture.hasAlpha = true;
    label.setEnabled(false);
    return { label, labelSurface };
  }

}
