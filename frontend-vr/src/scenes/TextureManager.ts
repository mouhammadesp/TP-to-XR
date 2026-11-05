/**
 * TextureManager — turns the flat-colored template into a realistic workshop.
 *
 * - Procedural PBR materials (concrete, polished floor, oak, brushed steel,
 *   painted metal, ceiling tiles) generated at load time: no texture download.
 * - Box-projected UVs so textures keep a real-world scale on every face.
 * - A reflection probe of the room (rendered once) as environment: metals and
 *   the polished floor reflect the actual workshop; Sketchfab PBR models too.
 * - One shadow-casting spot light above the workbench (shadow map refreshed
 *   only when an object moves — cheap on Quest 3).
 */
import {
  AbstractMesh,
  Color3,
  Constants,
  DynamicTexture,
  Light,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  RawTexture,
  ReflectionProbe,
  RenderTargetTexture,
  Scene,
  ShadowGenerator,
  SpotLight,
  StandardMaterial,
  Texture,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import { MaterialKind, TextureSet, flattenLighting, generateTextureSet, makeSeamless, seamScore, textureSetFromImage } from "./proceduralTextures";
import { applyLedCove, ledVariantFromUrl } from "./ledCove";
import { paintAirConditioner } from "./airConditioner";

/** Which template meshes get which material, and the real-world size of one texture tile (m). */
/** Modern workshop: off-white walls, light epoxy floor, light laminate top on black steel. */
const MATERIAL_RULES: { test: (name: string) => boolean; kind: MaterialKind; tileM: number }[] = [
  { test: (n) => n === "ground", kind: "epoxyFloor", tileM: 2.5 },
  { test: (n) => n.startsWith("wall_"), kind: "paintedWall", tileM: 3 },
  { test: (n) => n === "ceiling", kind: "ceilingTiles", tileM: 2.4 },
  { test: (n) => n === "workbench_top" || n === "workbench_shelf", kind: "laminate", tileM: 1.2 },
  { test: (n) => n.startsWith("workbench_leg_"), kind: "blackSteel", tileM: 1 },
  // Storage cabinet: graphite paint (carcass, doors); black handles, hinges, seam, plinth.
  { test: (n) => n === "cabinet" || n.startsWith("cabinet_door_"), kind: "graphitePaint", tileM: 0.8 },
  { test: (n) => n.startsWith("cabinet_"), kind: "blackSteel", tileM: 1 },
  // Shelf racks: graphite posts and rails, light-gray satin boards.
  { test: (n) => /^shelf_.*_post/.test(n), kind: "blackSteel", tileM: 1 },
  { test: (n) => n.startsWith("shelf_"), kind: "lightGrayMetal", tileM: 1.2 },
  { test: (n) => n === "accent_panel", kind: "woodSlats", tileM: 1.2 },
  { test: (n) => n.startsWith("curtain_") && !n.startsWith("curtain_track_"), kind: "curtainFabric", tileM: 1 },
  { test: (n) => n.startsWith("window_frame_") || n.startsWith("window_sill_") || n.startsWith("curtain_track_"), kind: "whiteAluminum", tileM: 1 },
  { test: (n) => n.startsWith("baseboard_"), kind: "blackSteel", tileM: 1 },
];

/**
 * Optional texture images (e.g. generated with ChatGPT) in frontend-vr/public/textures/,
 * served at /vr/textures/. When a file exists it replaces the procedural albedo of
 * that material; normal and roughness maps are derived from it in the browser.
 */
export const TEXTURE_SLOTS: Partial<Record<MaterialKind, TextureSlot>> = {
  // 3 × 3 floor tiles of 60 cm → one image = 1.8 m. Grid textures: no automatic seam blending (it would blur the joints).
  epoxyFloor: { file: "sol.jpg", tileM: 1.8, seamFix: false },
  paintedWall: { file: "mur.jpg", tileM: 2.5, seamFix: true },
  // ≈ 25 slats per image at ≈ 4.8 cm pitch.
  woodSlats: { file: "lames-bois.jpg", tileM: 1.2, seamFix: false },
  // 4 × 4 ceiling tiles of 60 cm.
  ceilingTiles: { file: "dalle-plafond.jpg", tileM: 2.4, seamFix: false },
  curtainFabric: { file: "rideau.jpg", tileM: 0.8, seamFix: true },
  laminate: { file: "plan-de-travail.jpg", tileM: 1.0, seamFix: true },
  // Satin graphite metal (cabinet). The photo has a bright corner: flattened before tiling.
  // Fine grain (≈ 0.8 mm/px); flattened first, so the repeats do not show.
  graphitePaint: { file: "armoir.png", tileM: 0.8, seamFix: true, flatten: true },
};

interface TextureSlot {
  file: string;
  /** Real-world size covered by one image (m). */
  tileM: number;
  /** Blend the borders if the image does not tile (off for grid patterns). */
  seamFix: boolean;
  /** Remove large-scale lighting baked into the photo (uniform material images only). */
  flatten?: boolean;
}
/** Outside view seen through the windows (not tiled). */
export const WINDOW_VIEW_FILE = "vue-fenetre.jpg";
const TEXTURE_BASE = "./textures/";
/** Max texture resolution from images (mobile VR GPU). */
const MAX_IMAGE_SIZE = 1024;

/** Static room meshes (never move): world matrices can be frozen. */
const STATIC_ROOM = /^(ground|wall_|ceiling|workbench_|shelf_|cabinet|led_|aircon_|floor_marking_|safety_sign_|window_|curtain_|accent_panel|baseboard_)/;

/** Room meshes rendered into the reflection probe. */
const PROBE_MESHES = /^(ground|wall_|ceiling|workbench_|shelf_|cabinet|led_panels|instructionPanel|safety_sign_|window_|curtain_|accent_panel)/;

export class TextureManager {
  private shadowGenerator: ShadowGenerator | null = null;
  private lightingReady = false;
  private readonly materials = new Map<MaterialKind, PBRMaterial>();
  /** Texture sets built from image files (see TEXTURE_SLOTS). */
  private readonly external = new Map<MaterialKind, TextureSet>();
  public readonly externalLoaded: string[] = [];

  /**
   * Loads the optional texture images (missing files are simply skipped).
   * Images are resized to ≤ 1024 px, made seamless if their borders don't tile,
   * and turned into albedo + normal + roughness maps.
   */
  public async loadExternalTextures(): Promise<void> {
    await Promise.all(
      (Object.entries(TEXTURE_SLOTS) as [MaterialKind, TextureSlot][]).map(async ([kind, slot]) => {
        const px = await loadImagePixels(TEXTURE_BASE + slot.file, MAX_IMAGE_SIZE);
        if (!px) return;
        let rgba = slot.flatten ? flattenLighting(px.data, px.size) : px.data;
        const fix = slot.seamFix && seamScore(rgba, px.size) > 2.5;
        if (fix) rgba = makeSeamless(rgba, px.size);
        this.external.set(kind, textureSetFromImage(kind, rgba, px.size));
        this.externalLoaded.push(`${slot.file} (${px.size}px${fix ? ", raccords corrigés" : ""})`);
      })
    );
    if (this.externalLoaded.length) console.log(`🖼️ Textures images: ${this.externalLoaded.join(", ")}`);
  }

  constructor(private readonly scene: Scene) {}

  /**
   * Replaces template materials with procedural PBR materials.
   * @returns generation time and number of meshes updated
   */
  public applyRealisticMaterials(): { ms: number; meshes: number } {
    const t0 = performance.now();
    let count = 0;
    for (const mesh of this.scene.meshes) {
      const rule = MATERIAL_RULES.find((r) => r.test(mesh.name));
      if (!rule || !(mesh instanceof Mesh)) continue;
      const slot = TEXTURE_SLOTS[rule.kind];
      boxProjectUVs(mesh, slot && this.external.has(rule.kind) ? slot.tileM : rule.tileM);
      mesh.material = this.getMaterial(rule.kind);
      count++;
    }
    this.applyWindowView();
    const ms = Math.round(performance.now() - t0);
    console.log(`🎨 Realistic materials applied to ${count} meshes in ${ms} ms`);
    return { ms, meshes: count };
  }

  /** Tints the key light with the TP's domain color (color_scheme.key_light). */
  public setKeyLight(hex: string): void {
    const key = this.scene.getLightByName("keyLight");
    if (key) key.diffuse = Color3.FromHexString(hex);
  }

  /**
   * Sets up lighting for PBR (once; later calls are no-ops): spot light with
   * shadows over the workbench and the room reflection probe.
   */
  public setupLighting(): void {
    if (this.lightingReady) return;
    this.lightingReady = true;
    const scene = this.scene;
    // 3 active lights (key, hemispheric, spot): each extra light costs every pixel, in stereo, on a mobile GPU.
    scene.getLightByName("backLight")?.setEnabled(false);
    scene.getLightByName("fillLight")?.setEnabled(false);
    const key = scene.getLightByName("keyLight");
    const amb = scene.getLightByName("ambientLight");
    if (amb) {
      amb.intensity = 0.75; // bright, even light of a modern LED-lit room
      (amb as unknown as { groundColor: Color3 }).groundColor = new Color3(0.45, 0.45, 0.47);
    }
    if (key) key.intensity = 0.8;

    // Just under the suspended ceiling (3 m), above the bench.
    const spot = new SpotLight("benchSpot", new Vector3(0, 2.92, 0.4), new Vector3(0, -1, -0.08), 1.45, 2, scene);
    spot.intensity = 1.25; // main light over the bench → its shadows read clearly
    spot.range = 12;
    spot.diffuse = new Color3(1, 0.98, 0.94);
    spot.falloffType = Light.FALLOFF_STANDARD;

    const sg = new ShadowGenerator(1024, spot);
    sg.usePercentageCloserFiltering = true;
    sg.filteringQuality = ShadowGenerator.QUALITY_LOW;
    sg.bias = 0.0008;
    sg.normalBias = 0.01;
    sg.darkness = 0.35; // 0 = black shadows, 1 = none
    const map = sg.getShadowMap();
    if (map) map.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    this.shadowGenerator = sg;

    for (const m of scene.meshes) {
      if (/^(ground|workbench_top|workbench_shelf|shelf_.*_shelf_)/.test(m.name)) m.receiveShadows = true;
      if (/^(workbench_|shelf_|cabinet)/.test(m.name)) sg.addShadowCaster(m, false);
    }

    // Reflection probe of the room, rendered once, then used as environment for all PBR materials.
    const probe = new ReflectionProbe("roomProbe", 256, scene, true);
    probe.position = new Vector3(0, 1.6, 2);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    for (const m of scene.meshes) if (PROBE_MESHES.test(m.name)) probe.renderList?.push(m);
    probe.cubeTexture.onAfterRenderObservable.addOnce(() => {
      scene.environmentTexture = probe.cubeTexture;
      scene.environmentIntensity = 0.9;
      console.log("🪞 Room reflection probe ready");
    });
  }

  /**
   * Yellow floor marking around the workstation (industrial safety convention)
   * and frozen world matrices for all static room meshes (less CPU per frame).
   */
  public finishRoom(): void {
    const scene = this.scene;
    const mat = new StandardMaterial("floorMarkingMat", scene);
    mat.diffuseColor = new Color3(0.95, 0.78, 0.05);
    mat.emissiveColor = new Color3(0.25, 0.2, 0);
    mat.specularColor = Color3.Black();
    const w = 0.06;
    const x0 = 2.2, z0 = -1.7, z1 = 1.4; // around the bench + monitor, open toward the student
    const lines: [number, number, number, number][] = [
      [0, z0, 2 * x0 + w, w], // back
      [-x0, (z0 + z1) / 2, w, z1 - z0], // right (student's)
      [x0, (z0 + z1) / 2, w, z1 - z0], // left
    ];
    lines.forEach(([x, z, sx, sz], i) => {
      const m = MeshBuilder.CreateGround(`floor_marking_${i}`, { width: sx, height: sz }, scene);
      m.position = new Vector3(x, 0.002, z);
      m.material = mat;
      m.isPickable = false;
      m.receiveShadows = true;
    });
    applyLedCove(scene, ledVariantFromUrl());
    paintAirConditioner(scene);
    let frozen = 0;
    for (const m of scene.meshes) {
      if (STATIC_ROOM.test(m.name)) {
        m.freezeWorldMatrix();
        m.doNotSyncBoundingInfo = true;
        frozen++;
      }
    }
    console.log(`🧊 ${frozen} static room meshes frozen`);
  }

  /** Adds asset meshes as shadow casters (and lets them receive shadows). */
  public addShadowCasters(meshes: AbstractMesh[]): void {
    if (!this.shadowGenerator) return;
    for (const m of meshes) {
      if (m.getTotalVertices() === 0) continue;
      this.shadowGenerator.addShadowCaster(m, false);
      m.receiveShadows = true;
    }
    this.refreshShadows();
  }

  /** Re-renders the shadow map once (call after an object moved). */
  public refreshShadows(): void {
    this.shadowGenerator?.getShadowMap()?.resetRefreshCounter();
  }

  /**
   * Window "view": the image vue-fenetre.jpg if provided, otherwise a bright
   * procedural daylight scene (sky, distant buildings, trees). Unlit (it is the outside light).
   */
  private applyWindowView(): void {
    const views = this.scene.meshes.filter((m) => m.name.startsWith("window_view_"));
    if (!views.length) return;
    // Window 2.0 × 1.7 m (aspect ≈ 1.18) showing a 16:9 photo: crop horizontally instead of
    // squashing, and pan the crop from one window to the next (each shows another part of the view).
    const crop = 1.18 / (16 / 9);
    const base = new Texture(TEXTURE_BASE + WINDOW_VIEW_FILE, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, null, () => {
      // No image provided: procedural daylight view.
      const fallback = proceduralWindowView(this.scene);
      for (const v of views) (v.material as StandardMaterial).emissiveTexture = fallback;
    });
    views.forEach((v, i) => {
      const mat = new StandardMaterial(`windowView_${i}`, this.scene);
      mat.disableLighting = true;
      const tex = i === 0 ? base : base.clone();
      tex.uScale = crop;
      tex.uOffset = ((1 - crop) * i) / Math.max(1, views.length - 1);
      mat.emissiveTexture = tex;
      v.material = mat;
    });
  }

  /** Lazily creates (and caches) one PBR material per kind. */
  private getMaterial(kind: MaterialKind): PBRMaterial {
    const cached = this.materials.get(kind);
    if (cached) return cached;
    const set = this.external.get(kind) ?? generateTextureSet(kind);
    const mat = new PBRMaterial(`pbr_${kind}`, this.scene);
    mat.albedoTexture = this.toTexture(`${kind}_albedo`, set, "albedo", true);
    mat.bumpTexture = this.toTexture(`${kind}_normal`, set, "normal", false);
    mat.metallicTexture = this.toTexture(`${kind}_orm`, set, "orm", false);
    mat.useAmbientOcclusionFromMetallicTextureRed = false;
    mat.useRoughnessFromMetallicTextureAlpha = false;
    mat.useRoughnessFromMetallicTextureGreen = true;
    mat.useMetallnessFromMetallicTextureBlue = true;
    mat.metallic = 1;
    mat.roughness = 1;
    // Keep the template's light ranges meaningful (non-physical falloff).
    mat.usePhysicalLightFalloff = false;
    mat.environmentIntensity = kind === "brushedSteel" || kind === "polishedConcrete" ? 0.9 : 0.5;
    this.materials.set(kind, mat);
    return mat;
  }

  /** Uploads one generated map as a mipmapped, repeating RGBA texture. */
  private toTexture(name: string, set: TextureSet, map: "albedo" | "normal" | "orm", srgb: boolean): Texture {
    const tex = new RawTexture(
      set[map],
      set.size,
      set.size,
      Constants.TEXTUREFORMAT_RGBA,
      this.scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE
    );
    tex.name = name;
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 8;
    tex.gammaSpace = srgb;
    return tex;
  }
}

/**
 * Rewrites a mesh's UVs by box projection of its local positions:
 * each face is mapped from the two axes orthogonal to its normal, divided by
 * the tile size → textures have the same real-world scale on every face.
 */
export function boxProjectUVs(mesh: Mesh, tileM: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
  const nor = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!pos || !nor) return;
  const count = pos.length / 3;
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const px = pos[i * 3];
    const py = pos[i * 3 + 1];
    const pz = pos[i * 3 + 2];
    const ax = Math.abs(nor[i * 3]);
    const ay = Math.abs(nor[i * 3 + 1]);
    const az = Math.abs(nor[i * 3 + 2]);
    let u: number;
    let v: number;
    if (ax >= ay && ax >= az) {
      u = pz;
      v = py;
    } else if (ay >= az) {
      u = px;
      v = pz;
    } else {
      u = px;
      v = py;
    }
    uvs[i * 2] = u / tileM;
    uvs[i * 2 + 1] = v / tileM;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs, false);
}

/**
 * Loads an image and returns its pixels as a square power-of-two RGBA buffer
 * (≤ maxSize), or null if the file does not exist / cannot be decoded.
 */
async function loadImagePixels(url: string, maxSize: number): Promise<{ data: Uint8Array; size: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const bmp = await createImageBitmap(await res.blob());
    const size = Math.min(maxSize, 2 ** Math.floor(Math.log2(Math.min(bmp.width, bmp.height))));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    // Center-crop to a square, then scale.
    const side = Math.min(bmp.width, bmp.height);
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    return { data: new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer), size };
  } catch {
    return null;
  }
}

/** Procedural daylight view: sky gradient, distant building silhouettes, tree line. */
function proceduralWindowView(scene: import("@babylonjs/core").Scene): DynamicTexture {
  const tex = new DynamicTexture("windowViewTex", { width: 1024, height: 870 }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const w = 1024, h = 870;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  sky.addColorStop(0, "#8EC5F0");
  sky.addColorStop(1, "#E4F1FB");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // Distant buildings (light, hazy).
  let x = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (x < w) {
    const bw = 60 + rnd() * 120;
    const bh = 120 + rnd() * 220;
    ctx.fillStyle = `rgb(${200 + rnd() * 25}, ${205 + rnd() * 20}, ${212 + rnd() * 18})`;
    ctx.fillRect(x, h * 0.72 - bh, bw, bh);
    x += bw + 8;
  }
  // Tree line and lawn.
  ctx.fillStyle = "#6F9A5B";
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(rnd() * w, h * 0.72 + rnd() * 20, 30 + rnd() * 50, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#8DB574";
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  tex.update();
  return tex;
}
