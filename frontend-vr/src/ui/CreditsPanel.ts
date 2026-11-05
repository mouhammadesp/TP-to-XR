/**
 * CreditsPanel — CC-BY attribution for every Sketchfab model.
 *   VR: a board on the back wall, toggled by the "Crédits" button.
 *   Desktop: an HTML overlay with clickable links (links cannot be opened
 *   from inside an immersive session without leaving it, so in VR the URL
 *   is displayed as text).
 */
import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { Attribution } from "../utils/manifest";
import { FONT, paintMesh, wrap } from "./textCanvas";

export class CreditsPanel {
  private readonly board: Mesh;
  private readonly overlay = document.getElementById("credits");
  private visible = false;

  constructor(scene: Scene, private readonly credits: { name: string; attribution: Attribution }[]) {
    this.board = MeshBuilder.CreatePlane("creditsBoard", { width: 2.2, height: 1.4 }, scene);
    const panel = scene.getMeshByName("instructionPanel");
    this.board.position = new Vector3(4.2, 1.85, panel ? panel.position.z : -7.34);
    this.board.rotation.y = Math.PI;
    this.board.isPickable = false;
    paintMesh(scene, this.board, 1100, 700, (ctx, w, h) => this.draw(ctx, w, h), 1.5);
    this.board.setEnabled(false);
    this.buildOverlay();
  }

  public get isVisible(): boolean {
    return this.visible;
  }

  /** Shows/hides both the 3D board and the HTML overlay. */
  public toggle(force?: boolean): boolean {
    this.visible = force ?? !this.visible;
    this.board.setEnabled(this.visible);
    if (this.overlay) this.overlay.hidden = !this.visible;
    return this.visible;
  }

  private draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = "#F7F7F5";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#222";
    ctx.textAlign = "left";
    ctx.font = `bold 44px ${FONT}`;
    ctx.fillText("Crédits des modèles 3D", 36, 64);
    let y = 120;
    if (this.credits.length === 0) {
      ctx.font = `28px ${FONT}`;
      ctx.fillText("Aucun modèle Sketchfab dans ce TP (objets provisoires).", 36, y);
      return;
    }
    for (const { name, attribution: a } of this.credits) {
      if (y > h - 40) break;
      ctx.font = `bold 28px ${FONT}`;
      ctx.fillText(`${name} — « ${a.title} »`, 36, y);
      ctx.font = `24px ${FONT}`;
      for (const line of wrap(ctx, `${a.author} · ${a.license} · ${a.source_url}`, w - 90)) {
        y += 32;
        ctx.fillText(line, 56, y);
      }
      y += 48;
    }
  }

  /** HTML list with real links (desktop). */
  private buildOverlay(): void {
    const list = document.getElementById("credits-list");
    if (!list) return;
    list.replaceChildren();
    if (this.credits.length === 0) {
      list.append(Object.assign(document.createElement("li"), { textContent: "Aucun modèle Sketchfab dans ce TP." }));
    }
    for (const { name, attribution: a } of this.credits) {
      const li = document.createElement("li");
      li.append(`${name} — Modèle : « ${a.title} » · Auteur : ${a.author} · Licence : `);
      li.append(Object.assign(document.createElement("a"), { href: a.license_url, textContent: a.license, target: "_blank", rel: "noopener" }));
      li.append(" · ");
      li.append(Object.assign(document.createElement("a"), { href: a.source_url, textContent: "Voir sur Sketchfab", target: "_blank", rel: "noopener" }));
      list.append(li);
    }
    document.getElementById("credits-close")?.addEventListener("click", () => this.toggle(false));
  }
}
