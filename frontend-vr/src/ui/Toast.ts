/**
 * Toast — short feedback messages ("✓ Courroie montée", "⚠ Intervention sans
 * consignation") shown on a 3D banner above the monitor (visible in VR) and
 * mirrored in the desktop HUD status line.
 */
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import type { ToastKind } from "../sim/Simulation";
import { status } from "./hud";
import { FONT, PaintedSurface, paintMesh, roundRect, wrap } from "./textCanvas";

const COLORS: Record<ToastKind, string> = { ok: "#1B7F3B", info: "#0B5ED7", warn: "#B26A00", danger: "#B00020" };
const DURATION_MS = 4000;

export class Toast {
  private readonly mesh: Mesh;
  private readonly surface: PaintedSurface;
  private text = "";
  private kind: ToastKind = "info";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(scene: Scene) {
    this.mesh = MeshBuilder.CreatePlane("toast", { width: 1.6, height: 0.2 }, scene);
    this.mesh.position = new Vector3(0, 2.52, -1.27);
    this.mesh.rotation.y = Math.PI;
    this.mesh.isPickable = false;
    this.surface = paintMesh(scene, this.mesh, 1600, 200, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLORS[this.kind];
      roundRect(ctx, 4, 4, w - 8, h - 8, 36);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold 58px ${FONT}`;
      ctx.textAlign = "center";
      const lines = wrap(ctx, this.text, w - 80).slice(0, 2);
      lines.forEach((l, i) => ctx.fillText(l, w / 2, lines.length === 1 ? 122 : 86 + i * 66));
    });
    this.surface.texture.hasAlpha = true;
    this.mesh.setEnabled(false);
  }

  /** Shows a message for a few seconds (replaces the current one). */
  public show(text: string, kind: ToastKind): void {
    this.text = text;
    this.kind = kind;
    this.surface.redraw();
    this.mesh.setEnabled(true);
    status(text);
    console.log(`${kind === "danger" ? "⚠️" : "💬"} ${text}`);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.mesh.setEnabled(false), DURATION_MS);
  }
}
