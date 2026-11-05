/**
 * StepFeedback — notification card for the student's actions, beside the monitor
 * (to the student's left, turned toward the bench): it never covers the objects,
 * the instructions or the board.
 *
 *   success — "Étape validée !" + what was done. Only called when the validation
 *             engine has confirmed the step (Simulation → onStepValidated).
 *   error   — "Action incorrecte" + why (safety fault / damage detected by the engine).
 *   info    — neutral guidance ("La consigne mentionne : …"), never a penalty.
 *
 * Discreet animation (pop-in 250 ms, hold, fade-out 400 ms), optional sound and a
 * short controller vibration in VR. Mirrored in the desktop HUD status line.
 */
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { status } from "./hud";
import { Cue, Sounds } from "./sound";
import { FONT, PaintedSurface, paintMesh, roundRect, wrap } from "./textCanvas";

export type FeedbackKind = "success" | "error" | "info";

const STYLE: Record<FeedbackKind, { band: string; icon: string; title: string; holdMs: number }> = {
  success: { band: "#1B9E5A", icon: "✓", title: "#13693C", holdMs: 3200 },
  error: { band: "#C62828", icon: "!", title: "#9F1D1D", holdMs: 4500 },
  info: { band: "#1E6FD0", icon: "i", title: "#154F99", holdMs: 4500 },
};

/** Card pose: left of the 2 m monitor (which ends at x ≈ 1.01), facing the student at the bench. */
const POSE = { x: 1.52, y: 1.98, z: -1.27, width: 0.78, height: 0.3 };
const STUDENT = { x: 0, z: 0.9 };
const POP_MS = 250;
const FADE_MS = 400;

export interface FeedbackEntry {
  kind: FeedbackKind;
  title: string;
  text: string;
  at: number;
}

export class StepFeedback {
  /** Everything shown (tests, debug). */
  public readonly history: FeedbackEntry[] = [];
  private readonly mesh: Mesh;
  private readonly surface: PaintedSurface;
  private current: FeedbackEntry = { kind: "success", title: "", text: "", at: 0 };
  private shownAt = 0;
  private holdMs = 0;

  constructor(
    scene: Scene,
    private readonly sounds: Sounds,
    private readonly haptic: (pattern: "success" | "error") => void
  ) {
    this.mesh = MeshBuilder.CreatePlane("step_feedback", { width: POSE.width, height: POSE.height }, scene);
    this.mesh.position = new Vector3(POSE.x, POSE.y, POSE.z);
    this.mesh.rotation.y = Math.PI + Math.atan2(STUDENT.x - POSE.x, STUDENT.z - POSE.z);
    this.mesh.isPickable = false;
    this.surface = paintMesh(scene, this.mesh, 1040, 400, (ctx, w, h) => this.draw(ctx, w, h));
    this.surface.texture.hasAlpha = true;
    this.mesh.setEnabled(false);
    scene.onBeforeRenderObservable.add(() => this.animate());
  }

  /** Step confirmed by the validation engine. */
  public success(title: string, text: string, cue: Cue = "success"): void {
    this.show("success", title, text, cue);
  }

  /** Incorrect action detected by the engine (safety fault, damage). */
  public error(title: string, text: string): void {
    this.show("error", title, text, "error");
  }

  /** Neutral guidance (no sound, no vibration, no penalty). */
  public info(title: string, text: string): void {
    this.show("info", title, text, null);
  }

  public get last(): FeedbackEntry | null {
    return this.history[this.history.length - 1] ?? null;
  }

  private show(kind: FeedbackKind, title: string, text: string, cue: Cue | null): void {
    this.current = { kind, title, text, at: Date.now() };
    this.history.push(this.current);
    this.holdMs = STYLE[kind].holdMs;
    this.surface.redraw();
    this.shownAt = performance.now();
    this.mesh.setEnabled(true);
    status(`${title} ${text}`);
    if (cue) this.sounds.play(cue);
    if (kind !== "info") this.haptic(kind);
  }

  /** Pop-in (scale + fade), hold, fade-out. */
  private animate(): void {
    if (!this.mesh.isEnabled()) return;
    const t = performance.now() - this.shownAt;
    if (t < POP_MS) {
      const k = t / POP_MS;
      const ease = 1 - Math.pow(1 - k, 3);
      this.mesh.scaling.setAll(0.88 + 0.12 * ease);
      this.mesh.visibility = ease;
    } else if (t < POP_MS + this.holdMs) {
      this.mesh.scaling.setAll(1);
      this.mesh.visibility = 1;
    } else if (t < POP_MS + this.holdMs + FADE_MS) {
      this.mesh.visibility = 1 - (t - POP_MS - this.holdMs) / FADE_MS;
    } else {
      this.mesh.setEnabled(false);
    }
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const st = STYLE[this.current.kind];
    ctx.clearRect(0, 0, w, h);
    // Card with a soft shadow and a colored band on the left.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    roundRect(ctx, 10, 14, w - 16, h - 18, 34);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, 4, 4, w - 16, h - 18, 34);
    ctx.fill();
    ctx.save();
    roundRect(ctx, 4, 4, w - 16, h - 18, 34);
    ctx.clip();
    ctx.fillStyle = st.band;
    ctx.fillRect(4, 4, 18, h - 18);
    ctx.restore();
    // Icon
    const cx = 110;
    const cy = h / 2 - 6;
    ctx.fillStyle = st.band;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.font = `bold 72px ${FONT}`;
    ctx.fillText(st.icon, cx, cy + 26);
    // Title + sentence
    ctx.textAlign = "left";
    ctx.fillStyle = st.title;
    ctx.font = `bold 66px ${FONT}`;
    ctx.fillText(wrap(ctx, this.current.title, w - 250)[0], 200, 132);
    ctx.fillStyle = "#26323F";
    ctx.font = `40px ${FONT}`;
    wrap(ctx, this.current.text, w - 250)
      .slice(0, 3)
      .forEach((line, i) => ctx.fillText(line, 200, 200 + i * 50));
  }
}
