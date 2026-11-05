/**
 * StepPanel — instruction whiteboard (current step, large and readable),
 * safety signs, and the 3D buttons on the workbench:
 *   [◀ Précédent] [Suivant ▶ / Terminer ✓] [Crédits]
 * Buttons are plain pickable planes: they work with the mouse, controller
 * rays and hand pinch (the interaction handler routes the clicks).
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { Manifest } from "../utils/manifest";
import { FONT, PaintedSurface, paintMesh, roundRect, wrap } from "./textCanvas";

export type ButtonAction = "prev" | "next" | "credits" | "menu";

export interface StepState {
  step: number;
  total: number;
  finished: boolean;
  /** Once finished: short results shown on the board (facts from the session). */
  summary?: string[];
  /** Interactive TPs: what remains to do for the current step. */
  checklist?: { label: string; done: boolean }[];
  /** Interactive TPs: the current step was validated by the student's actions. */
  validated?: boolean;
  /** Interactive TPs: false = the engine cannot check this step (nothing to validate, ▶ to go on). */
  checkable?: boolean;
  /** Generated TPs: parts of the step that are not checked (shown under the checklist). */
  unverified?: string[];
}

/**
 * Button console mounted just in front of the workbench front edge, on the student's
 * right (the student faces -Z, so their right is -X and their left is +X),
 * outside the placement zone. `tilt` leans the faces back (≈40°) toward the eyes:
 * a plane faces -Z, pitching by +tilt then yawing by π makes it face +Z and up.
 */
const CONSOLE = { x: -0.95, y: 0.93, z: 0.82, tilt: 0.7 };

/**
 * Large 16:9 display (≈ 90", 2.00 × 1.125 m of picture) behind the workbench, between
 * the objects on the bench (bottom ≈ 1.26 m) and the toast banner above (from 2.42 m).
 */
const MONITOR = { x: 0, y: 1.83, z: -1.3, width: 2.0, height: 1.125, bezel: 0.008, radius: 0.02, depth: 0.02 };
/** Board drawing size (logical px): 16:9, same height as the former 4:3 board so the layout keeps its vertical room. */
const BOARD = { width: 1365, height: 768, pixelRatio: 1.5 }; // texture 2048 × 1152

export class StepPanel {
  public readonly buttons: Mesh[] = [];
  private board: PaintedSurface | null = null;
  private nextButton: PaintedSurface | null = null;
  private menuButton: PaintedSurface | null = null;
  /** "⌂ Menu" was pressed once: waiting for the confirmation press. */
  private menuConfirm = false;
  private state: StepState;

  constructor(private readonly scene: Scene, private readonly manifest: Manifest, private readonly studentName: string | null = null) {
    this.state = { step: 0, total: manifest.tp.steps.length, finished: false };
    this.paintSafetySigns();
    this.createBoard();
    this.createMonitor();
    this.createButtons();
    this.createControlsPlate();
  }

  /** Redraws the board and the "next" button for a new state. */
  public update(state: StepState): void {
    this.state = state;
    this.board?.redraw();
    this.nextButton?.redraw();
  }

  /** Shows / clears the "Confirmer ?" state of the menu button. */
  public setMenuConfirm(on: boolean): void {
    this.menuConfirm = on;
    this.menuButton?.redraw();
  }

  /** Short visual feedback when a button is activated. */
  public press(mesh: Mesh): void {
    mesh.scaling.setAll(0.9);
    setTimeout(() => mesh.scaling.setAll(1), 140);
  }

  /**
   * Writes the safety texts on the wall signs, following ISO 7010 colors:
   * an OBLIGATION (wear gloves, lock out…) is a blue circle (M001), a DANGER
   * (short circuit…) a yellow triangle (W001).
   */
  private paintSafetySigns(): void {
    for (const s of this.manifest.safety_signs) {
      const mesh = this.scene.getMeshByName(s.sign);
      if (!(mesh instanceof Mesh)) continue;
      const mandatory = isMandatory(s.text);
      paintMesh(this.scene, mesh, 512, 716, (ctx, w, h) => {
        ctx.fillStyle = mandatory ? "#FFFFFF" : "#FFD400";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = mandatory ? "#005387" : "#111";
        ctx.lineWidth = 16;
        ctx.strokeRect(8, 8, w - 16, h - 16);
        const cx = w / 2;
        if (mandatory) {
          ctx.fillStyle = "#005387"; // ISO 7010 safety blue
          ctx.beginPath();
          ctx.arc(cx, 190, 140, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#FFFFFF";
        } else {
          ctx.fillStyle = "#111";
          ctx.beginPath();
          ctx.moveTo(cx, 50);
          ctx.lineTo(cx + 165, 330);
          ctx.lineTo(cx - 165, 330);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#FFD400";
          ctx.beginPath();
          ctx.moveTo(cx, 95);
          ctx.lineTo(cx + 125, 305);
          ctx.lineTo(cx - 125, 305);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#111";
        }
        ctx.textAlign = "center";
        ctx.font = `bold 170px ${FONT}`;
        ctx.fillText("!", cx, mandatory ? 250 : 290);
        ctx.fillStyle = "#111";
        ctx.font = `bold 54px ${FONT}`;
        wrap(ctx, s.text.toUpperCase(), w - 70)
          .slice(0, 5)
          .forEach((l, i) => ctx.fillText(l, cx, 420 + i * 64));
      });
    }
  }

  /**
   * Instruction board: header, current step (large), safety, checklist or next step,
   * progress bar. Text is drawn as large as the 16:9 screen allows: the body is laid
   * out at the largest scale (100 % → 75 %) whose height fits above the progress bar.
   */
  private createBoard(): void {
    const mesh = this.scene.getMeshByName("instructionPanel");
    if (!(mesh instanceof Mesh)) return;
    const { tp } = this.manifest;
    this.board = paintMesh(this.scene, mesh, BOARD.width, BOARD.height, (ctx, w, h) => {
      const { step, total, finished } = this.state;
      const s = tp.steps[step];
      const pad = 48;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = "left";
      ctx.fillStyle = "#567";
      ctx.font = `30px ${FONT}`;
      // Student's name on the right of the header (confirms who the session belongs to).
      let headerW = w - 2 * pad;
      if (this.studentName) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#0B3D91";
        const who = `👤 ${this.studentName}`;
        ctx.fillText(who, w - pad, 56);
        headerW -= ctx.measureText(who).width + 40;
        ctx.textAlign = "left";
        ctx.fillStyle = "#567";
      }
      ctx.fillText(wrap(ctx, `${tp.title} · ${tp.domain} · ${tp.duration_minutes} min`, headerW)[0], pad, 56);
      ctx.fillStyle = finished ? "#1B7F3B" : "#0B3D91";
      ctx.font = `bold 66px ${FONT}`;
      ctx.fillText(finished ? "TP terminé ✓" : `Étape ${step + 1}/${total}`, pad, 140);
      if (this.state.validated && !finished) {
        ctx.fillStyle = "#1B7F3B";
        ctx.font = `bold 46px ${FONT}`;
        ctx.textAlign = "right";
        ctx.fillText("✓ validée", w - pad, 136);
        ctx.textAlign = "left";
      }

      // Finished: short results + where to find the detailed report.
      if (finished && this.state.summary?.length) {
        let sy = 250;
        ctx.fillStyle = "#111";
        ctx.font = `bold 52px ${FONT}`;
        for (const line of this.state.summary.slice(0, 4)) {
          ctx.fillText(wrap(ctx, line, w - 2 * pad)[0], pad, sy);
          sy += 74;
        }
        ctx.fillStyle = "#0B3D91";
        ctx.font = `bold 42px ${FONT}`;
        ctx.fillText(wrap(ctx, "📄 Votre rapport détaillé : bouton « Rapport » sur l'établi.", w - 2 * pad)[0], pad, sy + 36);
        ctx.fillStyle = "#1B7F3B";
        roundRect(ctx, pad, h - 46, w - 2 * pad, 18, 9);
        ctx.fill();
        return;
      }

      // Generated TPs: what the engine does not check is said, never hidden.
      const notes =
        this.state.checkable === false
          ? ["ⓘ Étape non vérifiable automatiquement : faites-la, puis ▶ Suivant pour continuer"]
          : (this.state.unverified ?? []).length
            ? [`ⓘ Non vérifié automatiquement : ${(this.state.unverified ?? []).map((u) => u.split(" — ")[0]).join(", ")}`]
            : [];
      const checklist = [
        ...(this.state.checklist ?? []).slice(0, 4),
        ...notes.map((label) => ({ label, done: false, note: true })),
      ] as { label: string; done: boolean; note?: boolean }[];
      const next = tp.steps[step + 1];
      const top = 178;
      const bottom = h - 64; // progress bar
      // Measures the body at scale k: returns its height and wrapped lines.
      const layout = (k: number) => {
        const actionPx = Math.round(60 * k);
        const notePx = Math.round(40 * k);
        ctx.font = `bold ${actionPx}px ${FONT}`;
        const action = wrap(ctx, s.action, w - 2 * pad).slice(0, 5);
        ctx.font = `bold ${notePx}px ${FONT}`;
        const safety = s.safety ? wrap(ctx, `⚠ ${s.safety}`, w - 2 * pad - 40).slice(0, 2) : [];
        let height = action.length * actionPx * 1.22;
        if (safety.length) height += 16 + safety.length * notePx * 1.25 + 28;
        if (checklist.length) height += 18 + checklist.reduce((n, i) => n + (i.note ? 2 : 1), 0) * notePx * 1.3;
        else if (next) height += 24 + notePx;
        return { actionPx, notePx, action, safety, height };
      };
      let L = layout(1);
      for (const k of [0.92, 0.84, 0.75]) {
        if (top + L.height <= bottom) break;
        L = layout(k);
      }

      let y = top;
      ctx.fillStyle = "#111";
      ctx.font = `bold ${L.actionPx}px ${FONT}`;
      for (const line of L.action) {
        y += L.actionPx * 1.22;
        ctx.fillText(line, pad, y - L.actionPx * 0.22);
      }
      ctx.font = `bold ${L.notePx}px ${FONT}`;
      if (L.safety.length) {
        y += 16;
        const boxH = L.safety.length * L.notePx * 1.25 + 20;
        ctx.fillStyle = "#FDECEA";
        roundRect(ctx, pad - 12, y, w - 2 * pad + 24, boxH, 14);
        ctx.fill();
        ctx.fillStyle = "#B00020";
        L.safety.forEach((l, i) => ctx.fillText(l, pad + 10, y + 10 + (i + 0.85) * L.notePx * 1.25));
        y += boxH + 8;
      }
      if (checklist.length) {
        // Interactive TP: what remains to do (○) / what is done (✓).
        y += 18;
        for (const item of checklist) {
          ctx.fillStyle = item.note ? "#8A6D00" : item.done ? "#1B7F3B" : "#5A6470";
          const mark = item.note ? "" : item.done ? "✓  " : "○  ";
          // Notes (what is not checked) may take 2 lines; conditions stay on one.
          for (const line of wrap(ctx, `${mark}${item.label}`, w - 2 * pad - 20).slice(0, item.note ? 2 : 1)) {
            y += L.notePx * 1.3;
            if (y > bottom + 4) break;
            ctx.fillText(line, pad + 8, y - L.notePx * 0.3);
          }
        }
      } else if (next && y + 24 + L.notePx <= bottom) {
        ctx.fillStyle = "#789";
        ctx.font = `${L.notePx}px ${FONT}`;
        ctx.fillText(wrap(ctx, `Ensuite : ${next.action}`, w - 2 * pad)[0], pad, Math.max(y + 24 + L.notePx * 0.8, bottom - 20));
      }
      // Progress bar
      ctx.fillStyle = "#E3E8EF";
      roundRect(ctx, pad, h - 46, w - 2 * pad, 18, 9);
      ctx.fill();
      ctx.fillStyle = finished ? "#1B7F3B" : "#0B3D91";
      roundRect(ctx, pad, h - 46, ((w - 2 * pad) * (finished ? total : step + 1)) / total, 18, 9);
      ctx.fill();
    }, BOARD.pixelRatio);
  }

  /**
   * Ultra-thin 16:9 display right behind the workbench (≈ 2 m from the student →
   * readable in VR), showing the instruction board (shared texture, redrawn with it).
   * Graphite rounded frame with an 8 mm bezel, slim back housing, professional floor
   * stand (oval column with hidden cables, VESA bracket, low rounded base plate). Unlit picture: bright, no reflection.
   */
  private createMonitor(): void {
    const wall = this.scene.getMeshByName("instructionPanel");
    if (!wall?.material) return;
    const M = MONITOR;
    const graphite = new PBRMaterial("monitorFrameMat", this.scene);
    graphite.albedoColor = Color3.FromHexString("#2A2D31").toLinearSpace();
    graphite.metallic = 0.75;
    graphite.roughness = 0.45; // satin: only a faint, static reflection of the room probe
    graphite.usePhysicalLightFalloff = false;
    const anthracite = new PBRMaterial("monitorStandMat", this.scene);
    anthracite.albedoColor = Color3.FromHexString("#3A3E43").toLinearSpace();
    anthracite.metallic = 0.6;
    anthracite.roughness = 0.55;
    anthracite.usePhysicalLightFalloff = false;

    // Frame: rounded slab, front face at z + depth/2.
    const frame = roundedSlab("monitor_frame", M.width + 2 * M.bezel, M.height + 2 * M.bezel, M.radius, M.depth, this.scene);
    frame.position = new Vector3(M.x, M.y, M.z);

    const screen = MeshBuilder.CreatePlane("monitor_screen", { width: M.width, height: M.height }, this.scene);
    screen.position = new Vector3(M.x, M.y, M.z + M.depth / 2 + 0.001);
    screen.rotation.y = Math.PI;
    screen.material = wall.material; // same DynamicTexture → redrawn together

    // Back housing (electronics), hidden behind the panel.
    const backZ = M.z - M.depth / 2;
    const housing = MeshBuilder.CreateBox("monitor_housing", { width: 1.1, height: 0.55, depth: 0.035 }, this.scene);
    housing.position = new Vector3(M.x, M.y - 0.1, backZ - 0.0175);
    // Professional floor stand: oval column (cables run inside) on a heavy low rounded
    // base plate, with a VESA bracket holding the display. Nothing touches the wood wall.
    const columnZ = backZ - 0.035 - 0.03;
    const column = MeshBuilder.CreateCylinder("monitor_pole", { diameter: 0.11, height: M.y + 0.05, tessellation: 20 }, this.scene);
    column.scaling.z = 0.45; // 11 × 5 cm oval section
    column.position = new Vector3(M.x, (M.y + 0.05) / 2, columnZ);
    const bracket = MeshBuilder.CreateBox("monitor_bracket", { width: 0.42, height: 0.3, depth: 0.03 }, this.scene);
    bracket.position = new Vector3(M.x, M.y - 0.08, backZ - 0.035 - 0.012);
    const base = roundedSlab("monitor_base", 0.95, 0.52, 0.07, 0.022, this.scene);
    base.rotation.x = Math.PI / 2; // lying on the floor
    base.position = new Vector3(M.x, 0.011, columnZ);
    const foot = MeshBuilder.CreateCylinder("monitor_foot", { diameter: 0.2, height: 0.05, tessellation: 24 }, this.scene);
    foot.scaling.z = 0.6;
    foot.position = new Vector3(M.x, 0.022 + 0.025, columnZ);
    frame.material = graphite;
    for (const m of [housing, column, bracket, base, foot]) m.material = anthracite;
    for (const m of [frame, screen, housing, column, bracket, base, foot]) {
      m.isPickable = false;
      m.freezeWorldMatrix();
    }
  }

  /** Small reminder of the VR controls, next to the buttons. */
  private createControlsPlate(): void {
    const plate = MeshBuilder.CreatePlane("controls_plate", { width: 0.5, height: 0.11 }, this.scene);
    plate.position = new Vector3(CONSOLE.x + 0.62, CONSOLE.y, CONSOLE.z);
    plate.rotation = new Vector3(CONSOLE.tilt, Math.PI, 0);
    plate.isPickable = false;
    paintMesh(this.scene, plate, 1024, 226, (ctx, w, h) => {
      ctx.fillStyle = "#101820";
      roundRect(ctx, 4, 4, w - 8, h - 8, 24);
      ctx.fill();
      ctx.fillStyle = "#E6EDF3";
      ctx.font = `bold 40px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("Gâchette ou grip : prendre  ·  A / X : suivant  ·  B / Y : précédent", w / 2, 92);
      ctx.fillStyle = "#9FB3C8";
      ctx.font = `34px ${FONT}`;
      ctx.fillText("Stick gauche : marcher  ·  Stick droit : tourner  ·  Clic stick : loupe", w / 2, 164);
    });
  }

  /** The buttons, side by side on a small console at the front-right of the workbench. */
  private createButtons(): void {
    const defs: { action: ButtonAction; label: () => string; color: () => string }[] = [
      { action: "prev", label: () => "◀ Précédent", color: () => "#455A64" },
      {
        action: "next",
        label: () => (this.state.finished ? "📄 Rapport" : this.state.step === this.state.total - 1 ? "Terminer ✓" : "Suivant ▶"),
        color: () => (this.state.finished || this.state.step === this.state.total - 1 ? "#1B7F3B" : "#0B5ED7"),
      },
      { action: "credits", label: () => "Crédits", color: () => "#6D4C41" },
      { action: "menu", label: () => (this.menuConfirm ? "Confirmer ?" : "⌂ Menu"), color: () => (this.menuConfirm ? "#B00020" : "#37474F") },
    ];
    defs.forEach((def, i) => {
      const mesh = MeshBuilder.CreatePlane(`btn_${def.action}`, { width: 0.2, height: 0.075 }, this.scene);
      // Facing -Z, screen-left is +X: lay buttons out from +X to -X so they read ◀ ▶ Crédits.
      mesh.position = new Vector3(CONSOLE.x + 0.22 - i * 0.22, CONSOLE.y, CONSOLE.z);
      mesh.rotation = new Vector3(CONSOLE.tilt, Math.PI, 0);
      mesh.metadata = { role: "button", action: def.action };
      mesh.isPickable = true;
      mesh.enablePointerMoveEvents = true;
      const surface = paintMesh(this.scene, mesh, 512, 192, (ctx, w, h) => {
        ctx.fillStyle = def.color();
        roundRect(ctx, 4, 4, w - 8, h - 8, 28);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = `bold 64px ${FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(def.label(), w / 2, 120);
      });
      if (def.action === "next") this.nextButton = surface;
      if (def.action === "menu") this.menuButton = surface;
      this.buttons.push(mesh);
    });
  }
}

/** Obligation (blue sign) vs danger (yellow sign), from the sign text. */
export function isMandatory(text: string): boolean {
  return /^(porter|consigner|c[âa]bler hors|couper|v[ée]rifier|utiliser|mettre|lire|respecter|ventiler|attacher)/i.test(text.trim());
}

/**
 * Rounded-rectangle slab (width × height in XY, `depth` along Z, centered): a convex
 * outline extruded and capped by fans — a few dozen triangles.
 */
function roundedSlab(name: string, width: number, height: number, radius: number, depth: number, scene: Scene): Mesh {
  const outline: Vector3[] = [];
  const corners: [number, number, number][] = [
    [width / 2 - radius, height / 2 - radius, 0],
    [-width / 2 + radius, height / 2 - radius, Math.PI / 2],
    [-width / 2 + radius, -height / 2 + radius, Math.PI],
    [width / 2 - radius, -height / 2 + radius, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      outline.push(new Vector3(cx + radius * Math.cos(a), cy + radius * Math.sin(a), 0));
    }
  }
  return MeshBuilder.ExtrudeShape(
    name,
    {
      shape: outline,
      closeShape: true,
      path: [new Vector3(0, 0, -depth / 2), new Vector3(0, 0, depth / 2)],
      cap: Mesh.CAP_ALL,
      sideOrientation: Mesh.DOUBLESIDE,
    },
    scene
  );
}
