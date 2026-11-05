/**
 * Helpers to draw text on meshes (DynamicTexture) — readable in VR.
 */
import { DynamicTexture, Mesh, Scene, StandardMaterial } from "@babylonjs/core";

export const FONT = "system-ui, 'Segoe UI', Arial, sans-serif";

type Ctx = CanvasRenderingContext2D;

/** Wraps text into lines fitting `maxWidth` with the context's current font. */
export function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A mesh painted with a redrawable canvas. */
export interface PaintedSurface {
  texture: DynamicTexture;
  redraw: () => void;
}

/**
 * Replaces a mesh material with an unlit DynamicTexture drawn by `draw`.
 * `draw` works in logical units (width × height); the texture itself is
 * `pixelRatio` times larger so text stays sharp in a VR headset.
 * Call `redraw()` after state changes.
 */
export function paintMesh(
  scene: Scene,
  mesh: Mesh,
  width: number,
  height: number,
  draw: (ctx: Ctx, w: number, h: number) => void,
  pixelRatio = 2
): PaintedSurface {
  const texture = new DynamicTexture(
    `${mesh.name}_tex`,
    { width: Math.round(width * pixelRatio), height: Math.round(height * pixelRatio) },
    scene,
    true
  );
  texture.anisotropicFilteringLevel = 16;
  const mat = new StandardMaterial(`${mesh.name}_textMat`, scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = texture;
  mat.disableLighting = true;
  mesh.material = mat;
  const redraw = () => {
    const ctx = texture.getContext() as unknown as Ctx;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
    texture.update();
  };
  redraw();
  return { texture, redraw };
}

/** Rounded rectangle path. */
export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** mm:ss */
export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
