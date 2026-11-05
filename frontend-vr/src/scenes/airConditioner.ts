/**
 * Wall-mounted split air conditioner (decoration, geometry from the template):
 * paints its intake grille (lit, so it follows the room light) and its small
 * display (emissive "24°" + standby LED). No interaction, no simulation.
 */
import { Color3, DynamicTexture, Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import { FONT, paintMesh, roundRect } from "../ui/textCanvas";

export function paintAirConditioner(scene: Scene): void {
  const grille = scene.getMeshByName("aircon_grille");
  if (grille instanceof Mesh) {
    // Plane: local X = depth (0.13 m), local Y = length along the wall (0.78 m).
    const tex = new DynamicTexture("airconGrilleTex", { width: 128, height: 768 }, scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "#EEF0F2";
    ctx.fillRect(0, 0, 128, 768);
    ctx.fillStyle = "#3A3F45";
    for (let y = 14; y < 760; y += 14) {
      roundRect(ctx, 12, y, 104, 6, 3);
      ctx.fill();
    }
    tex.update();
    tex.anisotropicFilteringLevel = 8;
    const mat = new StandardMaterial("airconGrilleMat", scene);
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    grille.material = mat;
  }
  const display = scene.getMeshByName("aircon_display");
  if (display instanceof Mesh) {
    paintMesh(scene, display, 240, 72, (ctx, w, h) => {
      ctx.fillStyle = "#0E1216";
      roundRect(ctx, 0, 0, w, h, 14);
      ctx.fill();
      ctx.fillStyle = "#9FE3FF";
      ctx.font = `bold 46px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText("24°", w / 2 - 14, 52);
      ctx.fillStyle = "#38D27A";
      ctx.beginPath();
      ctx.arc(w - 30, h / 2, 7, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
