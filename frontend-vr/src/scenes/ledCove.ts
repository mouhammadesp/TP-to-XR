/**
 * LED cove above the wood wall — light simulated without any dynamic light or shadow:
 *   - the diffuser strip (emissive, from the template), slightly widened;
 *   - a soft halo: additive gradient quads just under the strip (on the wood) and on
 *     the ceiling edge — reads as the glow of the cove, hides thin-line aliasing;
 *   - the light falling on the slats: per-vertex warm gain on the wood albedo (the wall
 *     is cut in 10 cm rows), strong under the ceiling and fading smoothly downward.
 *     Because it multiplies the albedo, the black acoustic grooves stay black (relief);
 *   - a hue-preserving highlight roll-off (Khronos PBR Neutral tone mapping) on the
 *     wood material only: identity below ≈ 0.76, so the oak keeps its natural color
 *     and the brightest slats never clip to yellow.
 *
 * Variants for review: /vr/?led=A | B | B2 | C. Without the parameter, the current
 * (pre-review) lighting is kept unchanged.
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";

export interface LedVariant {
  label: string;
  /** Diffuser color (emissive). */
  strip: [number, number, number];
  /**
   * Wash on the wood: gain = base + tint × (peak·e^(−d/near) + tail·e^(−d/far)), d = distance
   * below the cove. base < 1 leaves the lower wall a little in the shade of the cove light
   * (contrast of a real wall-wash) instead of over-brightening the top.
   */
  base: number;
  peak: number;
  near: number;
  tail: number;
  far: number;
  tint: [number, number, number];
  /** Halo under the strip on the wood (alpha at the top, height in m) and on the ceiling edge. */
  halo: { alpha: number; height: number; ceilingAlpha: number; ceilingDepth: number; color: [number, number, number] } | null;
  /** Hue-preserving highlight roll-off on the wood. */
  toneMap: boolean;
}

export const LED_VARIANTS: Record<string, LedVariant> = {
  // Current lighting (before review) — default until a variant is validated.
  current: {
    label: "actuelle",
    strip: [1, 0.88, 0.74],
    base: 1, peak: 0.75, near: 0.45, tail: 0.18, far: 1.5,
    tint: [1, 0.83, 0.64],
    halo: null,
    toneMap: false,
  },
  // A — natural warm white (≈ 3500 K), discreet.
  A: {
    label: "A · blanc chaud naturel, discret",
    strip: [1, 0.94, 0.85],
    base: 0.93, peak: 0.38, near: 0.5, tail: 0.12, far: 1.5,
    tint: [1, 0.92, 0.82],
    halo: { alpha: 0.22, height: 0.1, ceilingAlpha: 0.1, ceilingDepth: 0.08, color: [1, 0.9, 0.78] },
    toneMap: true,
  },
  // B — bright warm white (≈ 3000–3200 K), premium architectural look.
  B: {
    label: "B · blanc chaud lumineux, premium",
    strip: [1, 0.95, 0.87],
    base: 0.8, peak: 0.75, near: 0.55, tail: 0.32, far: 1.4,
    tint: [1, 0.9, 0.78],
    halo: { alpha: 0.45, height: 0.2, ceilingAlpha: 0.2, ceilingDepth: 0.12, color: [1, 0.88, 0.74] },
    toneMap: true,
  },
  // B2 — B improved (candidate, to validate in the Pico): ≈ 3200 K, brighter diffuser,
  // light carried further down the slats; less yellow tint than B so the extra light
  // reads as white-warm, and the hue-preserving roll-off prevents any overexposure.
  B2: {
    label: "B2 · B améliorée (≈ 3200 K, plus éclatante)",
    strip: [1, 0.965, 0.9],
    base: 0.8, peak: 0.95, near: 0.6, tail: 0.42, far: 1.5,
    tint: [1, 0.92, 0.82],
    halo: { alpha: 0.55, height: 0.22, ceilingAlpha: 0.24, ceilingDepth: 0.13, color: [1, 0.91, 0.8] },
    toneMap: true,
  },
  // C — slightly golden warm white (≈ 2900–3000 K), more striking.
  C: {
    label: "C · blanc chaud doré, éclatant",
    strip: [1, 0.9, 0.72],
    base: 0.74, peak: 1.0, near: 0.6, tail: 0.4, far: 1.4,
    tint: [1, 0.86, 0.66],
    halo: { alpha: 0.6, height: 0.26, ceilingAlpha: 0.28, ceilingDepth: 0.16, color: [1, 0.84, 0.62] },
    toneMap: true,
  },
};

/** Variant chosen in the URL (?led=A|B|B2|C), else the current lighting. */
export function ledVariantFromUrl(): LedVariant {
  const key = new URLSearchParams(location.search).get("led")?.toUpperCase() ?? "";
  return LED_VARIANTS[key] ?? LED_VARIANTS.current;
}

export function applyLedCove(scene: Scene, v: LedVariant): void {
  const wall = scene.getMeshByName("accent_panel");
  const pos = wall?.getVerticesData(VertexBuffer.PositionKind);
  if (!wall || !pos) return;
  const top = wall.position.y + Math.max(...pos.filter((_, i) => i % 3 === 1));
  const front = wall.getBoundingInfo().boundingBox.maximumWorld.z;

  // Light on the slats.
  const colors = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length / 3; i++) {
    const d = top - (wall.position.y + pos[i * 3 + 1]);
    const g = v.peak * Math.exp(-d / v.near) + v.tail * Math.exp(-d / v.far);
    colors.set([v.base + g * v.tint[0], v.base + g * v.tint[1], v.base + g * v.tint[2], 1], i * 4);
  }
  wall.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
  const mat = wall.material;
  // 3 m of wall for a 1.2 m texture: mirror the vertical repeat so the tile seams vanish.
  for (const t of mat?.getActiveTextures() ?? []) {
    if (t instanceof Texture) t.wrapV = Texture.MIRROR_ADDRESSMODE;
  }
  if (v.toneMap && mat instanceof PBRMaterial) {
    const ip = new ImageProcessingConfiguration();
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    mat.imageProcessingConfiguration = ip;
  }

  // Diffuser strip: brighter, a little wider (4 cm) for a clean continuous line.
  const strip = scene.getMeshByName("led_strip");
  if (strip?.material instanceof StandardMaterial) {
    strip.material.emissiveColor = new Color3(...v.strip);
    if (v.halo) strip.scaling.y = 0.04 / 0.028;
  }

  if (v.halo) {
    const width = (wall.getBoundingInfo().boundingBox.extendSizeWorld.x * 2) - 0.004;
    const color = new Color3(...v.halo.color);
    // On the wood, right under the cove (2 mm in front of the slats).
    const onWood = haloQuad(scene, "led_halo_wall", width, v.halo.height, v.halo.alpha, color);
    onWood.rotation.y = Math.PI; // planes face −Z → face the room
    onWood.position = new Vector3(0, top - 0.013 - v.halo.height / 2, front + 0.002);
    // On the ceiling edge, in front of the profile (light spill), facing down.
    const onCeiling = haloQuad(scene, "led_halo_ceiling", width, v.halo.ceilingDepth, v.halo.ceilingAlpha, color);
    onCeiling.rotation.x = -Math.PI / 2; // faces down; its top edge (brightest) against the wall
    onCeiling.position = new Vector3(0, top - 0.001, front + 0.07 + v.halo.ceilingDepth / 2);
    for (const m of [onWood, onCeiling]) m.freezeWorldMatrix();
  }
  console.log(`💡 Bandeau LED : variante ${v.label}`);
}

/** Additive unlit quad whose glow fades from `alpha` (top edge) to 0 (bottom edge). */
function haloQuad(scene: Scene, name: string, width: number, height: number, alpha: number, color: Color3): Mesh {
  const quad = MeshBuilder.CreatePlane(name, { width, height }, scene);
  const tex = new DynamicTexture(`${name}_tex`, { width: 4, height: 128 }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(4, 128);
  for (let y = 0; y < 128; y++) {
    // DynamicTexture rows are flipped on upload (invertY): the last row is the quad's top edge.
    const t = y / 127;
    const a = Math.round(255 * Math.pow(t, 2.2)); // soft falloff, no visible edge
    for (let x = 0; x < 4; x++) img.data.set([255, 255, 255, a], (y * 4 + x) * 4);
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.hasAlpha = true;
  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.disableLighting = true;
  mat.emissiveColor = color.scale(alpha);
  mat.opacityTexture = tex;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  quad.material = mat;
  quad.isPickable = false;
  return quad;
}
