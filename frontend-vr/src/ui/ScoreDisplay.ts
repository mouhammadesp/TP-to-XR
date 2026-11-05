/**
 * ScoreDisplay — live timer + score.
 *   Desktop: HTML timer (top-right) and score card (bottom-left).
 *   VR: a small standing display at the back-right of the workbench,
 *       facing the student (HTML overlays are invisible in immersive mode).
 */
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { TPSession } from "../utils/analytics";
import { FONT, PaintedSurface, formatTime, paintMesh, roundRect } from "./textCanvas";

export class ScoreDisplay {
  private readonly board: PaintedSurface;
  private readonly timerEl = document.getElementById("timer");
  private readonly scoreEl = document.getElementById("score");
  private fps = 0;

  constructor(scene: Scene, private readonly session: TPSession) {
    const mesh = MeshBuilder.CreatePlane("scoreBoard", { width: 0.42, height: 0.24 }, scene);
    mesh.position = new Vector3(1.15, 1.12, -0.62);
    mesh.rotation = new Vector3(0.25, Math.PI, 0); // faces the student, tilted up toward eye level
    mesh.isPickable = false;
    this.board = paintMesh(scene, mesh as Mesh, 512, 292, (ctx, w, h) => this.draw(ctx, w, h));
    this.update();
  }

  /** Refreshes HTML + 3D displays (call once per second and after each event). */
  public update(fps?: number): void {
    if (fps !== undefined) this.fps = fps;
    const s = this.session;
    const acc = s.accuracy();
    if (this.timerEl) this.timerEl.textContent = `⏱ ${formatTime(s.elapsedSec())}`;
    if (this.scoreEl) {
      this.scoreEl.textContent =
        `Étapes ${s.stepsCompleted()}/${s.stepsTotal} · Précision ${acc === null ? "—" : acc + " %"}` +
        (this.fps ? ` · ${Math.round(this.fps)} FPS` : "") +
        (s.finished ? " · TP terminé ✓" : "");
    }
    this.board.redraw();
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const s = this.session;
    const acc = s.accuracy();
    ctx.fillStyle = "#101820";
    roundRect(ctx, 0, 0, w, h, 24);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#7FDBFF";
    ctx.font = `bold 72px ${FONT}`;
    ctx.fillText(`⏱ ${formatTime(s.elapsedSec())}`, 28, 92);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 40px ${FONT}`;
    ctx.fillText(`Étapes ${s.stepsCompleted()}/${s.stepsTotal}`, 28, 160);
    ctx.fillText(`Précision ${acc === null ? "—" : acc + " %"}`, 28, 214);
    ctx.font = `28px ${FONT}`;
    ctx.fillStyle = s.finished ? "#7CFC9A" : "#9AA";
    ctx.fillText(s.finished ? "TP terminé ✓" : this.fps ? `${Math.round(this.fps)} FPS` : "", 28, 262);
  }
}
