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
import { FONT, PaintedSurface, paintMesh, roundRect, wrap } from "../ui/textCanvas";
import type { Behavior } from "./behaviors";
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
    hints: ["", ""],
  },
  {
    id: "intake_duct",
    name: "Conduit d'admission d'air",
    tag: "Conduit d'admission",
    system: "Admission d'air du moteur",
    role: "Ce tuyau annelé amène l'air filtré du boîtier de filtre vers le turbocompresseur, puis le moteur.",
    hints: ["", ""],
  },
  {
    id: "washer_cap",
    name: "Bouchon du réservoir de lave-glace",
    tag: "Bouchon de lave-glace",
    system: "Nettoyage du pare-brise (ne fait pas partie du moteur)",
    role: "On y verse le liquide qui nettoie le pare-brise. Son bouchon bleu porte le symbole d'un pare-brise.",
    hints: ["", ""],
  },
  {
    id: "brake_fluid",
    name: "Réservoir de liquide de frein",
    tag: "Liquide de frein",
    system: "Freinage (ne fait pas partie du moteur)",
    role: "Il contient le liquide qui transmet l'effort de la pédale de frein jusqu'aux freins des roues.",
    hints: ["", ""],
  },
];

/** Components asked, in step order (steps 2..6). Must match the rules of tp_demo_engine. */
export const QUIZ = ["oil_cap", "dipstick", "coolant_tank", "air_filter", "battery"] as const;

/** Different components to point at during the discovery step. */
export const EXPLORE_GOAL = 3;
/** Pointing time (s) for a component to count as explored. */
const EXPLORE_DWELL = 0.4;
/** Errors on a question after which the right component pulses. */
export const PULSE_AFTER_ERRORS = 3;

const ENGINE_ASSET = "x_moteur";
/** Height of the name tag above the top of its part (m). */
const LABEL_RISE = 0.12;
/** Question board: centered behind the plinth, below the eye line toward the monitor. */
const PANEL = { y: 1.36, back: 0.66, width: 1.1, height: 0.42 };
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
  public readonly feedbackPose?: { position: Vector3; viewer: { x: number; z: number } };
  private readonly scene: Scene;
  private readonly zones = new Map<string, Zone>();
  private readonly byBox = new Map<Mesh, Zone>();
  /** Zone under each pointer (mouse, left / right controller). */
  private readonly hoveredBy = new Map<number, Zone>();
  private readonly explored = new Set<string>();
  private readonly found = new Set<string>();
  /** Per question: attempts and wrong answers. */
  private readonly attempts = QUIZ.map(() => 0);
  private readonly errors = QUIZ.map(() => 0);
  private dwell: { zone: Zone; t: number } | null = null;
  private justFound: { zone: Zone; t: number } | null = null;
  private time = 0;
  private panel: PaintedSurface | null = null;
  private panelKey = "";

  constructor(private readonly sim: Simulation) {
    const engine = sim.asset(ENGINE_ASSET);
    this.scene = (engine?.handle.getScene() ?? null) as Scene;
    if (!engine || !this.scene) {
      console.warn("⚠️ engine_quiz: engine asset missing");
      return;
    }
    this.buildZones(engine);
    const at = engine.handle.position;
    // Notification card beside the question board, on the visitor's right (−X when facing −Z).
    this.feedbackPose = { position: new Vector3(at.x - (PANEL.width / 2 + 0.45), PANEL.y, at.z - PANEL.back + 0.06), viewer: { x: at.x, z: at.z + 1.4 } };
    this.buildPanel(engine);
    this.scene.onPointerObservable.add((pi) => this.onPointer(pi));
    console.log(`🔧 engine_quiz: ${this.zones.size} zones`);
  }

  /* ---------------------------------------------------------------- hooks */

  public get intro(): string {
    return "Démonstration : pointez les composants du moteur avec le laser (ou la souris) pour les découvrir.";
  }

  public update(dt: number): void {
    this.time += dt;
    // Discovery: a component pointed at long enough counts as explored.
    if (this.dwell && this.step === 0) {
      this.dwell.t += dt;
      if (this.dwell.t >= EXPLORE_DWELL) this.explore(this.dwell.zone);
    }
    this.paintZones();
    this.redrawPanel();
  }

  public onStepChanged(): void {
    this.dwell = null;
    for (const z of this.zones.values()) this.setLabel(z, this.found.has(z.component.id) ? "found" : "off");
  }

  public validationMessage(index: number): { title: string; text: string } | null {
    if (index === 0) return { title: "Découverte terminée !", text: `Le quiz commence : ${QUIZ.length} composants à retrouver. Les noms ne s'affichent plus au survol.` };
    const c = this.component(QUIZ[index - 1]);
    return c ? { title: "Bonne réponse !", text: `${c.name} — ${c.role}` } : null;
  }

  public summary(): string[] {
    const tries = this.attempts.reduce((a, b) => a + b, 0);
    const errs = this.errors.reduce((a, b) => a + b, 0);
    return [
      `✓ ${this.foundAsked()}/${QUIZ.length} composants identifiés`,
      `🎯 ${tries} tentative${tries > 1 ? "s" : ""} (${errs} erreur${errs > 1 ? "s" : ""})`,
    ];
  }

  /* ---------------------------------------------------------------- input */

  private get step(): number {
    return this.sim.step;
  }

  private onPointer(pi: PointerInfo): void {
    const ev = pi.event as PointerEvent;
    const id = ev.pointerId ?? 0;
    const zone = pi.pickInfo?.hit && pi.pickInfo.pickedMesh ? this.byBox.get(pi.pickInfo.pickedMesh as Mesh) ?? null : null;
    const xr = String(ev.pointerType ?? "").startsWith("xr");
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
    const asked = this.component(QUIZ[q]);
    if (!asked || this.sim.stepValidated) return; // already answered: the next question is coming
    const correct = zone.component.id === asked.id;
    this.attempts[q]++;
    s.recordAnswer({ ...src, target: zone.component.id, correct });
    if (correct) {
      this.found.add(asked.id);
      this.justFound = { zone, t: this.time };
      this.setLabel(zone, "found");
      // Validates the step: the session shows "Bonne réponse !" (validationMessage) with sound + vibration.
      this.sim.setFlag(`found_${asked.id}`, true);
    } else {
      this.errors[q]++;
      this.sim.notify("info", "Pas tout à fait…", wrongAnswerText(zone.component, asked, this.errors[q]));
    }
    this.panelKey = "";
  }

  private explore(zone: Zone): void {
    if (this.explored.has(zone.component.id)) return;
    this.explored.add(zone.component.id);
    this.panelKey = "";
    if (this.explored.size >= EXPLORE_GOAL) this.sim.setFlag("explored", true);
  }

  /* ---------------------------------------------------------------- visuals */

  /** Hover (cyan), answer just found (green pulse, 2.5 s), hint after 3 errors (orange pulse). */
  private paintZones(): void {
    const hovered = new Set(this.hoveredBy.values());
    const q = this.step - 1;
    const pulseId = q >= 0 && q < QUIZ.length && this.errors[q] >= PULSE_AFTER_ERRORS && !this.sim.stepValidated ? QUIZ[q] : null;
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
    return QUIZ.filter((id) => this.found.has(id)).length;
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

  /** Question board behind the plinth, facing the visitor (readable in the headset). */
  private buildPanel(engine: PlacedAsset): void {
    const at = engine.handle.position;
    const plane = MeshBuilder.CreatePlane("engine_quiz_panel", { width: PANEL.width, height: PANEL.height }, this.scene);
    plane.position = new Vector3(at.x, PANEL.y, at.z - PANEL.back);
    plane.rotation.y = Math.PI; // faces +Z (the visitor)
    plane.isPickable = false;
    this.panel = paintMesh(this.scene, plane, 1100, 420, (ctx, w, h) => this.drawPanel(ctx, w, h));
    this.panel.texture.hasAlpha = true;
  }

  private redrawPanel(): void {
    const s = this.sim.session;
    const q = this.step - 1;
    const key = [this.step, s.finished, this.explored.size, this.foundAsked(), q >= 0 ? this.errors[q] : 0, this.sim.stepValidated].join("|");
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel?.redraw();
  }

  private drawPanel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const s = this.sim.session;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(18,24,32,0.9)";
    roundRect(ctx, 4, 4, w - 8, h - 8, 28);
    ctx.fill();
    ctx.fillStyle = "#7B4FB0";
    ctx.fillRect(4, 26, 10, h - 52);
    const pad = 44;
    const head = (text: string, color = "#B9C4CF") => {
      ctx.fillStyle = color;
      ctx.font = `bold 30px ${FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(text, pad, 62);
    };
    const body = (text: string, y: number, px: number, color: string, max: number): number => {
      ctx.fillStyle = color;
      ctx.font = `${px === 44 ? "bold " : ""}${px}px ${FONT}`;
      const lines = wrap(ctx, text, w - 2 * pad).slice(0, max);
      lines.forEach((l, i) => ctx.fillText(l, pad, y + i * px * 1.22));
      return y + lines.length * px * 1.22;
    };

    if (s.finished) {
      const mins = Math.floor(s.elapsedSec() / 60);
      const secs = String(s.elapsedSec() % 60).padStart(2, "0");
      const tries = this.attempts.reduce((a, b) => a + b, 0);
      head("BILAN DE LA DÉMONSTRATION", "#7FE0A6");
      let y = body(`Bravo ! ${this.foundAsked()}/${QUIZ.length} composants identifiés en ${tries} tentative${tries > 1 ? "s" : ""} · ${mins} min ${secs} s`, 122, 40, "#FFFFFF", 2);
      y = body("Fonctions découvertes :", y + 14, 32, "#B9C4CF", 1);
      const systems = new Map<string, string[]>();
      for (const id of QUIZ) {
        const c = this.component(id)!;
        if (!this.found.has(id)) continue;
        const sys = c.system.replace(/ \(.*\)$/, "");
        systems.set(sys, [...(systems.get(sys) ?? []), (c.tag ?? c.name).toLowerCase()]);
      }
      for (const [sys, names] of systems) y = body(`• ${sys} : ${names.join(", ")}`, y + 4, 30, "#E3E8ED", 1);
      return;
    }
    if (this.step === 0) {
      head(`DÉCOUVERTE LIBRE · ${Math.min(this.explored.size, EXPLORE_GOAL)}/${EXPLORE_GOAL} composants pointés`);
      const y = body("Observez le moteur, approchez-vous et pointez les composants avec le laser (ou la souris) : leur nom s'affiche.", 122, 40, "#FFFFFF", 3);
      body("Gâchette / clic sur un composant : sa fonction.", y + 16, 30, "#9FB0C0", 1);
      return;
    }
    const q = this.step - 1;
    const asked = this.component(QUIZ[q]);
    if (!asked) return;
    head(`QUESTION ${q + 1}/${QUIZ.length} · ${this.foundAsked()} trouvé${this.foundAsked() > 1 ? "s" : ""}`);
    const question = this.sim.stepValidated ? `✓ ${asked.name}` : `Où se trouve : ${asked.name.toLowerCase().replace(/ \(.*\)$/, "")} ?`;
    let y = body(question, 128, 44, this.sim.stepValidated ? "#7FE0A6" : "#FFFFFF", 2);
    if (!this.sim.stepValidated) y = body("Pointez-le, puis gâchette (ou clic).", y + 6, 30, "#9FB0C0", 1);
    const hint = hintFor(asked, this.errors[q]);
    if (hint && !this.sim.stepValidated) body(`💡 ${hint}`, y + 18, 32, "#FFD27A", 3);
  }
}
