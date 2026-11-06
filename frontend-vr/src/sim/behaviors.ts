/**
 * Simulated behaviors of the demo TPs.
 *
 * GenericBehavior   — generated TPs: conditions only (no physics).
 * CircuitBehavior   — battery, switch, resistors, LEDs, multimeter (Ohm's law, LED burn-out).
 * BeltDriveBehavior — lockout/tagout isolator, pulleys, V-belt mounting, tension,
 *                     bolt torque, test run with the speed ratio of the pulleys.
 * EngineQuizBehavior — engine-bay scan: find components with the laser (engineQuiz.ts).
 *
 * Asset ids are those of backend/src/services/demoTps.ts.
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, Vector3 } from "@babylonjs/core";
import { drawLcd } from "../models/builtin";
import { PlacedAsset } from "../scenes/TPScene";
import { SimTarget } from "./conditions";
import { computeCircuit, fr } from "./circuit";
import { EngineQuizBehavior } from "./engineQuiz";
import { InstrumentQuizBehavior } from "./instrumentQuiz";
import type { Simulation } from "./Simulation";

export interface Behavior {
  /** State flag → target to highlight while that flag is expected. */
  readonly stateTargets: Record<string, string>;
  update(dt: number): void;
  onRelease?(a: PlacedAsset, snappedOn: SimTarget | null): void;
  onGrabStart?(a: PlacedAsset): void;
  onClick?(a: PlacedAsset): void;
  /** Step changed (after the simulation's own reset). */
  onStepChanged?(): void;
  /** Message of the "step validated" card, instead of the generic checklist sentence. */
  validationMessage?(index: number): { title: string; text: string } | null;
  /** Lines of the final summary (board), instead of the generic step counts. */
  summary?(): string[];
  /** Opening toast, instead of the generic "follow the green markers". */
  readonly intro?: string;
  /** Where the notification card goes when the activity is far from the monitor. */
  readonly feedbackPose?: { position: Vector3; viewer: { x: number; z: number } };
}

/**
 * Generated TPs ("generic"): no simulated physics, no hidden logic — the step
 * conditions (placed / held / near) alone decide, from the student's actions.
 */
export class GenericBehavior implements Behavior {
  public readonly stateTargets: Record<string, string> = {};
  public update(): void {}
}

/** Behavior module for a simulation kind (demos: authored modules; generated TPs: generic). */
export function createBehavior(kind: "circuit" | "belt_drive" | "engine_quiz" | "instrument_quiz" | "generic", sim: Simulation): Behavior {
  switch (kind) {
    case "circuit":
      return new CircuitBehavior(sim);
    case "belt_drive":
      return new BeltDriveBehavior(sim);
    case "engine_quiz":
      return new EngineQuizBehavior(sim);
    case "instrument_quiz":
      return new InstrumentQuizBehavior(sim);
    case "generic":
      return new GenericBehavior();
  }
}

/** Fires once when an object stays within `radius` of a target for `seconds`. */
class Dwell {
  private t = 0;
  public fired = false;

  constructor(private readonly seconds: number) {}

  /** @returns true exactly once, when the dwell completes */
  public update(inside: boolean, dt: number): boolean {
    if (this.fired) return false;
    this.t = inside ? this.t + dt : 0;
    if (this.t >= this.seconds) {
      this.fired = true;
      return true;
    }
    return false;
  }

  public reset(): void {
    this.t = 0;
    this.fired = false;
  }
}

/* ================================================================== */
/* Electrical circuit                                                   */
/* ================================================================== */

export class CircuitBehavior implements Behavior {
  public readonly stateTargets = { measured: "point_mesure" };
  private switchOn = false;
  private burnt = false;
  private lcd = "";
  private readonly measureDwell = new Dwell(0.6);

  constructor(private readonly sim: Simulation) {
    this.setSwitchVisual();
  }

  public onClick(a: PlacedAsset): void {
    if (a.asset.asset_id !== "e_interrupteur") return;
    this.switchOn = !this.switchOn;
    this.setSwitchVisual();
    this.sim.record("toggle", `interrupteur ${this.switchOn ? "ON" : "OFF"}`);
    if (this.switchOn && this.sim.step < 3) {
      this.sim.violation("mise sous tension pendant le câblage", "Mise sous tension pendant le câblage ! Ouvrez l'interrupteur.");
    } else {
      this.sim.toast(this.switchOn ? "Interrupteur fermé (ON)" : "Interrupteur ouvert (OFF)", "info");
    }
  }

  public update(dt: number): void {
    const s = this.sim;
    const state = computeCircuit({
      boardPlaced: s.isPlaced("e_plaque", "poste"),
      batteryPlaced: s.isPlaced("e_batterie", "logement_batterie"),
      wiresPlaced: s.isPlaced("e_fils", "plaque_fils"),
      resistorsPlaced: s.isPlaced("e_resistances", "plaque_resistances"),
      ledsPlaced: s.isPlaced("e_leds", "plaque_leds"),
      switchOn: this.switchOn,
      ledsBurnt: this.burnt,
    });

    if (state.burnsLeds && !this.burnt) {
      this.burnt = true;
      this.sim.damage("LED grillées (pas de résistance)", "LED grillées : sans résistance, I ≈ 21 A ! Ouvrez l'interrupteur.");
    }
    this.paintLeds(state.ledBrightness);
    s.setFlag("circuit_on", state.closed);

    // Multimeter: reads the battery voltage or the circuit current depending on where it is.
    const onBoard = s.distanceTo("e_multimetre", "point_mesure") < 0.18;
    const onBattery = s.distanceTo("e_multimetre", "logement_batterie") < 0.16 || this.nearAsset("e_multimetre", "e_batterie", 0.16);
    let text: [string, string, boolean];
    if (onBoard) text = [fr(state.closed ? state.current_mA : 0, 1), "mA", false];
    else if (onBattery) text = [fr(state.batteryVoltage, 2), "V⎓", false];
    else text = ["0,00", "V⎓", true];
    this.setLcd(...text);

    if (this.measureDwell.update(onBoard && state.closed, dt)) {
      s.setFlag("measured", true);
      s.record("measure", `I = ${fr(state.current_mA, 1)} mA`);
      s.toast(`Mesure : I = ${fr(state.current_mA, 1)} mA (≈ ${fr(state.perLed_mA, 1)} mA par LED) ✓`, "ok");
    }
  }

  private nearAsset(a: string, b: string, d: number): boolean {
    const pa = this.sim.asset(a)?.handle.position;
    const pb = this.sim.asset(b)?.handle.position;
    return !!pa && !!pb && Math.hypot(pa.x - pb.x, pa.z - pb.z) < d;
  }

  private setLcd(value: string, unit: string, dim: boolean): void {
    const key = `${value}|${unit}|${dim}`;
    if (key === this.lcd) return;
    this.lcd = key;
    const tex = this.sim.asset("e_multimetre")?.builtin?.textures.screen;
    if (!tex) return;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    const size = tex.getSize();
    drawLcd(ctx, size.width, size.height, value, unit, dim);
    tex.update();
  }

  private paintLeds(brightness: number): void {
    const leds = this.sim.asset("e_leds")?.builtin;
    if (!leds) return;
    for (const key of ["led0", "led1"]) {
      const m = leds.materials[key];
      if (!m) continue;
      if (this.burnt) {
        m.albedoColor = new Color3(0.12, 0.08, 0.06);
        m.emissiveColor = Color3.Black();
      } else {
        m.emissiveColor = new Color3(1, 0.08, 0.05).scale(brightness * 1.6);
      }
    }
  }

  private setSwitchVisual(): void {
    const sw = this.sim.asset("e_interrupteur")?.builtin;
    if (!sw) return;
    sw.parts.lever.rotation.z = this.switchOn ? -0.5 : 0.5;
    const ind = sw.materials.indicator;
    if (ind) ind.emissiveColor = this.switchOn ? new Color3(0.1, 0.9, 0.2) : Color3.Black();
  }
}

/* ================================================================== */
/* Belt drive                                                           */
/* ================================================================== */

const R_MOTOR = 0.05;
const R_DRIVEN = 0.07;
/** Visual motor speed (rev/s). A real 1450 rpm motor (24 rev/s) would only look like a blur. */
const MOTOR_REV_S = 1.5;
const MOTOR_RPM = 1450;

export class BeltDriveBehavior implements Behavior {
  public readonly stateTargets = { tensioned: "tendeur", torqued: "fixations" };
  private energized = true;
  private beltMounted = false;
  private running = false;
  private belt: Mesh | null = null;
  private readonly warned = new Set<string>();
  private readonly tensionDwell = new Dwell(0.8);
  private readonly torqueDwell = new Dwell(0.8);

  constructor(private readonly sim: Simulation) {
    this.setIsolatorVisual();
  }

  public onClick(a: PlacedAsset): void {
    if (a.asset.asset_id !== "m_sectionneur") return;
    if (this.energized) {
      this.energized = false;
      this.running = false;
      this.sim.setFlag("locked_out", true);
      this.sim.record("toggle", "sectionneur consigné");
      this.sim.toast("Sectionneur sur 0 + cadenas : moteur consigné 🔒", "ok");
    } else {
      this.energized = true;
      this.sim.setFlag("locked_out", false);
      this.sim.record("toggle", "sectionneur remis sous tension");
      if (this.sim.completed) {
        this.running = true;
        const driven = Math.round((MOTOR_RPM * R_MOTOR) / R_DRIVEN);
        this.sim.toast(`Essai : moteur ${MOTOR_RPM} tr/min → poulie réceptrice ≈ ${driven} tr/min (rapport 10/14) ✓`, "ok");
      } else {
        this.sim.violation("remise sous tension pendant l'intervention", "Remise sous tension pendant l'intervention !");
      }
    }
    this.setIsolatorVisual();
  }

  public onGrabStart(a: PlacedAsset): void {
    const id = a.asset.asset_id;
    const parts = ["m_poulie_m", "m_poulie_r", "m_courroie", "m_boulons"];
    if (!parts.includes(id)) return;
    if (this.running) {
      this.warnOnce(`run_${id}`, "contact transmission en rotation", "Contact avec une transmission en rotation ! Consignez d'abord.");
    } else if (this.energized && this.sim.step > 0) {
      this.warnOnce(`energized_${id}`, "intervention sans consignation", "Intervention sans consignation : mettez le sectionneur sur 0 + cadenas.");
    }
  }

  public onRelease(a: PlacedAsset): void {
    if (a.asset.asset_id !== "m_courroie" || this.beltMounted) return;
    if (this.sim.distanceTo("m_courroie", "poulies") > 0.35) return;
    const bothPulleys = this.sim.isPlaced("m_poulie_m", "arbre_moteur") && this.sim.isPlaced("m_poulie_r", "arbre_recepteur");
    if (!bothPulleys) {
      this.sim.toast("Montez d'abord les deux poulies sur leurs arbres.", "info");
      return;
    }
    this.mountBelt();
  }

  public update(dt: number): void {
    const near = (target: string) => this.sim.distanceTo("m_cle", target) < 0.15;
    if (this.tensionDwell.update(near("tendeur"), dt)) {
      if (this.beltMounted) {
        this.drawBelt(0);
        this.sim.setFlag("tensioned", true);
        this.sim.toast("Tension réglée : flèche ≈ 15 mm au milieu du brin ✓", "ok");
      } else {
        this.sim.toast("Montez la courroie avant de régler la tension.", "info");
        this.tensionDwell.reset();
      }
    }
    if (this.torqueDwell.update(near("fixations"), dt)) {
      if (this.sim.isPlaced("m_boulons", "fixations")) {
        this.sim.setFlag("torqued", true);
        this.sim.toast("Boulons M8 serrés à 25 N·m ✓", "ok");
      } else {
        this.sim.toast("Posez d'abord les boulons M8 sur les pattes du moteur.", "info");
        this.torqueDwell.reset();
      }
    }
    if (this.running) {
      const w = MOTOR_REV_S * Math.PI * 2 * dt;
      const m = this.sim.asset("m_poulie_m")?.builtin?.parts.spinner;
      const r = this.sim.asset("m_poulie_r")?.builtin?.parts.spinner;
      if (m) m.rotation.z -= w;
      if (r) r.rotation.z -= w * (R_MOTOR / R_DRIVEN);
    }
  }

  private mountBelt(): void {
    this.beltMounted = true;
    const loose = this.sim.asset("m_courroie");
    loose?.handle.setEnabled(false);
    // Once the belt is on, the pulleys stay on their shafts.
    for (const id of ["m_poulie_m", "m_poulie_r"]) {
      const p = this.sim.asset(id);
      if (p) p.handle.isPickable = false;
    }
    this.drawBelt(0.025);
    this.sim.setFlag("belt_mounted", true);
    this.sim.record("snapped", "courroie montée");
    this.sim.toast("Courroie montée sur les deux poulies ✓ (encore détendue)", "ok");
  }

  /** Belt around both pulleys, with a sag of the lower strand (m) until tensioned. */
  private drawBelt(sag: number): void {
    const tm = this.sim.target("arbre_moteur");
    const tr = this.sim.target("arbre_recepteur");
    if (!tm || !tr) return;
    const c1 = new Vector3(tm.position.x, tm.position.y + R_MOTOR, tm.position.z);
    const c2 = new Vector3(tr.position.x, tr.position.y + R_DRIVEN, tr.position.z);
    const path = beltPath(c1, R_MOTOR - 0.004, c2, R_DRIVEN - 0.004, sag);
    this.belt?.dispose();
    this.belt = MeshBuilder.CreateTube("mounted_belt", { path, radius: 0.0055, tessellation: 10 }, this.sim.asset("m_banc")!.handle.getScene());
    const mat = new PBRMaterial("mounted_belt_mat", this.belt.getScene());
    mat.albedoColor = new Color3(0.06, 0.06, 0.06);
    mat.metallic = 0;
    mat.roughness = 0.85;
    mat.usePhysicalLightFalloff = false;
    this.belt.material = mat;
    this.belt.isPickable = false;
    this.sim.refreshShadows();
  }

  private setIsolatorVisual(): void {
    const iso = this.sim.asset("m_sectionneur")?.builtin;
    if (!iso) return;
    iso.parts.handle.rotation.z = this.energized ? 0 : -Math.PI / 2;
    iso.parts.padlock.setEnabled(!this.energized);
  }

  private warnOnce(key: string, detail: string, text: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.sim.violation(detail, text);
  }
}

/**
 * Closed path of a belt around two pulleys in the X-Y plane (external tangents),
 * with an optional sag of the lower strand.
 */
export function beltPath(c1: Vector3, ra: number, c2: Vector3, rb: number, sag: number): Vector3[] {
  const d = c2.x - c1.x;
  const alpha = Math.acos((ra - rb) / d); // tangent angle from +X
  const pts: Vector3[] = [];
  const at = (c: Vector3, r: number, a: number) => new Vector3(c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z);
  // Arc around the driven pulley (right side): from +alpha down to -alpha.
  for (let i = 0; i <= 16; i++) pts.push(at(c2, rb, alpha - (2 * alpha * i) / 16));
  // Lower strand (sagging) from driven to motor pulley.
  const p2 = at(c2, rb, -alpha);
  const p1 = at(c1, ra, -alpha);
  for (let i = 1; i < 10; i++) {
    const t = i / 10;
    const p = Vector3.Lerp(p2, p1, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  // Arc around the motor pulley (left side): from -alpha down to alpha - 2π.
  const span = 2 * Math.PI - 2 * alpha;
  for (let i = 0; i <= 20; i++) pts.push(at(c1, ra, -alpha - (span * i) / 20));
  pts.push(pts[0].clone());
  return pts;
}

