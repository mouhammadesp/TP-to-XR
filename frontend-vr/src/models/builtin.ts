/**
 * Builtin procedural models for the interactive demo TPs.
 *
 * Real-world sizes in meters, BASE at y = 0 and the authored origin kept as-is
 * (the demo targets in backend/src/services/demoTps.ts rely on it). The student
 * stands at +Z looking toward -Z: fronts, labels and displays face +Z.
 * Electronic parts (resistors, LEDs) are ≈ 1.6× real size so they stay
 * visible and grabbable in VR.
 *
 * Each builder returns named parts (animated or recolored by the simulation).
 */
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { FONT } from "../ui/textCanvas";

export interface BuiltinModel {
  root: TransformNode;
  parts: Record<string, TransformNode>;
  materials: Record<string, PBRMaterial>;
  textures: Record<string, DynamicTexture>;
}

type V3 = [number, number, number];

/** Small construction kit shared by the builders. */
class Kit {
  readonly root: TransformNode;
  readonly parts: Record<string, TransformNode> = {};
  readonly materials: Record<string, PBRMaterial> = {};
  readonly textures: Record<string, DynamicTexture> = {};
  private n = 0;

  constructor(readonly scene: Scene, readonly name: string) {
    this.root = new TransformNode(`bi_${name}`, scene);
  }

  /** PBR material (non-physical light falloff, like the room materials). */
  mat(key: string, hex: string, metal = 0, rough = 0.6, alpha = 1): PBRMaterial {
    const m = new PBRMaterial(`${this.name}_${key}`, this.scene);
    m.albedoColor = Color3.FromHexString(hex).toLinearSpace();
    m.metallic = metal;
    m.roughness = rough;
    m.usePhysicalLightFalloff = false;
    if (alpha < 1) {
      m.alpha = alpha;
      m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    }
    this.materials[key] = m;
    return m;
  }

  private place<T extends TransformNode>(m: T, pos: V3, rot: V3 = [0, 0, 0], parent?: TransformNode): T {
    m.parent = parent ?? this.root;
    m.position = new Vector3(...pos);
    m.rotation = new Vector3(...rot);
    return m;
  }

  box(w: number, h: number, d: number, pos: V3, mat: PBRMaterial | StandardMaterial, rot?: V3, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateBox(`${this.name}_b${this.n++}`, { width: w, height: h, depth: d }, this.scene);
    m.material = mat;
    return this.place(m, pos, rot, parent);
  }

  /** Cylinder along Y (use rot to orient). */
  cyl(diameter: number, height: number, pos: V3, mat: PBRMaterial, rot?: V3, parent?: TransformNode, tess = 20): Mesh {
    const m = MeshBuilder.CreateCylinder(`${this.name}_c${this.n++}`, { diameter, height, tessellation: tess }, this.scene);
    m.material = mat;
    return this.place(m, pos, rot, parent);
  }

  sphere(diameter: number, pos: V3, mat: PBRMaterial, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateSphere(`${this.name}_s${this.n++}`, { diameter, segments: 12 }, this.scene);
    m.material = mat;
    return this.place(m, pos, undefined, parent);
  }

  tube(points: V3[], radius: number, mat: PBRMaterial, parent?: TransformNode): Mesh {
    const m = MeshBuilder.CreateTube(
      `${this.name}_t${this.n++}`,
      { path: points.map((p) => new Vector3(...p)), radius, tessellation: 8, cap: Mesh.CAP_ALL },
      this.scene
    );
    m.material = mat;
    m.parent = parent ?? this.root;
    return m;
  }

  node(name: string, pos: V3, parent?: TransformNode): TransformNode {
    const t = new TransformNode(`${this.name}_${name}`, this.scene);
    this.parts[name] = t;
    return this.place(t, pos, undefined, parent);
  }

  /** Flat label/screen with a canvas texture; faces +Z (or up if `up`). */
  label(key: string, w: number, h: number, pos: V3, px: [number, number], draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, up = false, parent?: TransformNode): Mesh {
    const plane = MeshBuilder.CreatePlane(`${this.name}_${key}`, { width: w, height: h }, this.scene);
    const tex = new DynamicTexture(`${this.name}_${key}_tex`, { width: px[0], height: px[1] }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    draw(ctx, px[0], px[1]);
    tex.update();
    const m = new StandardMaterial(`${this.name}_${key}_mat`, this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.disableLighting = true;
    plane.material = m;
    this.textures[key] = tex;
    this.parts[key] = plane;
    // Facing +Z: yaw π. Facing up and readable from +Z: pitch π/2 then yaw π.
    return this.place(plane, pos, up ? [Math.PI / 2, Math.PI, 0] : [0, Math.PI, 0], parent);
  }

  done(): BuiltinModel {
    return { root: this.root, parts: this.parts, materials: this.materials, textures: this.textures };
  }
}

/* ================================================================== */
/* Electrical                                                          */
/* ================================================================== */

function breadboard(k: Kit): void {
  const W = 0.18, H = 0.009, D = 0.11;
  k.box(W, H, D, [0, H / 2, 0], k.mat("body", "#F2F0E8", 0, 0.7));
  k.label("top", W, D, [0, H + 0.0005, 0], [720, 440], (ctx, w, h) => {
    ctx.fillStyle = "#F2F0E8";
    ctx.fillRect(0, 0, w, h);
    for (const [y, c] of [[22, "#D32F2F"], [44, "#1565C0"], [h - 44, "#D32F2F"], [h - 22, "#1565C0"]] as [number, string][]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(w - 20, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#4A4A4A";
    for (let x = 30; x < w - 20; x += 16) {
      for (const y of [32, 54, h - 54, h - 32]) ctx.fillRect(x, y - 3, 6, 6);
      for (let y = 80; y < h - 80; y += 16) if (Math.abs(y - h / 2) > 10) ctx.fillRect(x, y - 3, 6, 6);
    }
    ctx.fillStyle = "#D8D4C8";
    ctx.fillRect(16, h / 2 - 5, w - 32, 10);
  }, true);
}

function battery12v(k: Kit): void {
  const W = 0.15, H = 0.095, D = 0.065;
  k.box(W, H, D, [0, H / 2, 0], k.mat("case", "#2B2F33", 0, 0.55));
  k.box(W + 0.002, 0.008, D + 0.002, [0, H - 0.004, 0], k.mat("lid", "#3A3F44", 0, 0.5));
  k.label("label", W * 0.86, H * 0.62, [0, H * 0.48, D / 2 + 0.001], [600, 248], (ctx, w, h) => {
    ctx.fillStyle = "#1E5631";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = `bold 96px ${FONT}`;
    ctx.fillText("12 V", w / 2, 108);
    ctx.font = `40px ${FONT}`;
    ctx.fillText("7 Ah · plomb étanche", w / 2, 176);
    ctx.font = `bold 44px ${FONT}`;
    ctx.fillText("−                         +", w / 2, 232);
  });
  k.box(0.014, 0.012, 0.012, [0.05, H + 0.006, 0], k.mat("plus", "#C62828", 0.3, 0.4));
  k.box(0.014, 0.012, 0.012, [-0.05, H + 0.006, 0], k.mat("minus", "#111111", 0.3, 0.4));
}

function toggleSwitch(k: Kit): void {
  k.box(0.08, 0.025, 0.05, [0, 0.0125, 0], k.mat("base", "#263238", 0, 0.5));
  k.label("face", 0.07, 0.04, [0, 0.0255, 0], [280, 160], (ctx, w, h) => {
    ctx.fillStyle = "#37474F";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = `bold 40px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("OFF", 52, 92);
    ctx.fillText("ON", w - 52, 92);
  }, true);
  const lever = k.node("lever", [0, 0.026, 0]);
  k.cyl(0.006, 0.03, [0, 0.015, 0], k.mat("lever", "#CFD8DC", 0.9, 0.3), undefined, lever);
  lever.rotation.z = 0.5; // OFF side
  k.parts.indicator = k.sphere(0.008, [0.03, 0.028, 0.018], k.mat("indicator", "#3E2723", 0, 0.4));
}

/** Resistor along X, centered on (x, y, z): body + 4 color bands + leads. */
function resistor(k: Kit, x: number, y: number, z: number): void {
  const len = 0.011;
  k.cyl(0.0042, len, [x, y, z], k.materials.body ?? k.mat("body", "#D9C9A3", 0, 0.6), [0, 0, Math.PI / 2]);
  const bands: [number, string][] = [[-0.0035, "#6D4C41"], [-0.0012, "#2E7D32"], [0.0011, "#6D4C41"], [0.0038, "#C9A227"]];
  for (const [dx, c] of bands) k.cyl(0.0045, 0.0009, [x + dx, y, z], k.materials[c] ?? k.mat(c, c, c === "#C9A227" ? 0.8 : 0, 0.5), [0, 0, Math.PI / 2]);
}

function resistors150(k: Kit): void {
  k.box(0.07, 0.003, 0.022, [0, 0.0015, 0], k.mat("strip", "#B0BEC5", 0, 0.8, 0.6));
  const lead = k.mat("lead", "#C0C4C8", 1, 0.3);
  const y = 0.0055;
  for (const x of [-0.022, 0, 0.022]) resistor(k, x, y, 0);
  k.tube([[-0.034, y, 0], [0.034, y, 0]], 0.0005, lead);
}

function ledsRed(k: Kit): void {
  k.box(0.034, 0.003, 0.02, [0, 0.0015, 0], k.mat("strip", "#B0BEC5", 0, 0.8, 0.6));
  const lead = k.mat("lead", "#C0C4C8", 1, 0.3);
  [-0.008, 0.008].forEach((x, i) => {
    const led = k.mat(`led${i}`, "#D32F2F", 0, 0.15, 0.85);
    led.emissiveColor = new Color3(0, 0, 0);
    const g = k.node(`led${i}`, [x, 0.003, 0]);
    k.cyl(0.008, 0.008, [0, 0.009, 0], led, undefined, g);
    k.sphere(0.008, [0, 0.013, 0], led, g);
    k.cyl(0.0093, 0.0012, [0, 0.0052, 0], led, undefined, g);
    k.tube([[-0.0015, 0.005, 0], [-0.0015, 0, 0]], 0.0004, lead, g);
    k.tube([[0.0015, 0.005, 0], [0.0015, -0.002, 0]], 0.0004, lead, g); // longer leg = anode
  });
}

function jumperWires(k: Kit): void {
  const colors = ["#D32F2F", "#212121", "#F9A825"];
  colors.forEach((c, i) => {
    const z = (i - 1) * 0.012;
    const m = k.mat(`w${i}`, c, 0, 0.5);
    k.tube([[-0.045, 0.003, z], [-0.02, 0.012, z + 0.004], [0.02, 0.012, z - 0.004], [0.045, 0.003, z]], 0.0013, m);
    for (const x of [-0.045, 0.045]) k.cyl(0.0025, 0.006, [x, 0.003, z], k.materials.pin ?? k.mat("pin", "#9E9E9E", 1, 0.3), [0, 0, Math.PI / 2]);
  });
}

function multimeter(k: Kit): void {
  const W = 0.09, H = 0.032, D = 0.18;
  k.box(W, H, D, [0, H / 2, 0], k.mat("rubber", "#F4C20D", 0, 0.75));
  k.box(W - 0.012, 0.004, D - 0.014, [0, H + 0.001, 0], k.mat("face", "#2B2B2B", 0, 0.5));
  k.label("screen", 0.064, 0.034, [0, H + 0.0035, -0.052], [512, 272], (ctx, w, h) => drawLcd(ctx, w, h, "0,00", "V⎓"), true);
  const dial = k.node("dial", [0, H + 0.003, 0.012]);
  k.cyl(0.042, 0.006, [0, 0.003, 0], k.mat("dial", "#424242", 0, 0.5), undefined, dial, 28);
  k.box(0.004, 0.003, 0.018, [0, 0.0075, 0.008], k.mat("pointer", "#FAFAFA", 0, 0.4), undefined, dial);
  k.label("modes", 0.07, 0.016, [0, H + 0.0035, 0.045], [440, 100], (ctx, w, h) => {
    ctx.fillStyle = "#2B2B2B";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#EEE";
    ctx.font = `bold 40px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("V⎓   mA   Ω   ♪", w / 2, 66);
  }, true);
  const sockets: [number, string][] = [[-0.022, "#111"], [0, "#C62828"], [0.022, "#C62828"]];
  for (const [x, c] of sockets) k.cyl(0.008, 0.004, [x, H + 0.003, 0.072], k.materials[c] ?? k.mat(c, c, 0, 0.4), undefined, undefined, 12);
  // Probes lying next to the meter, cables to the sockets.
  for (const [dx, c] of [[0.065, "#C62828"], [0.082, "#212121"]] as [number, string][]) {
    const m = k.materials[`probe${c}`] ?? k.mat(`probe${c}`, c, 0, 0.5);
    k.cyl(0.009, 0.11, [dx, 0.0045, 0.02], m, [Math.PI / 2, 0, 0]);
    k.cyl(0.002, 0.03, [dx, 0.0045, -0.05], k.mat(`tip${c}`, "#BDBDBD", 1, 0.25), [Math.PI / 2, 0, 0]);
    k.tube([[dx, 0.0045, 0.075], [dx - 0.02, 0.01, 0.1], [dx - 0.06, H + 0.004, 0.085]], 0.0016, m);
  }
}

/** Draws the multimeter LCD. */
export function drawLcd(ctx: CanvasRenderingContext2D, w: number, h: number, value: string, unit: string, dim = false): void {
  ctx.fillStyle = dim ? "#8A9A84" : "#B8CDA8";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1B1F1A";
  ctx.textAlign = "right";
  ctx.font = `bold 150px "Consolas", monospace`;
  ctx.fillText(value, w - 120, 190);
  ctx.font = `bold 64px ${FONT}`;
  ctx.fillText(unit, w - 14, 190);
}

function cuttingPliers(k: Kit): void {
  const red = k.mat("grip", "#C62828", 0, 0.6);
  const steel = k.mat("steel", "#9EA4AA", 1, 0.3);
  k.box(0.1, 0.012, 0.014, [-0.035, 0.007, 0.012], red, [0, 0.14, 0]);
  k.box(0.1, 0.012, 0.014, [-0.035, 0.007, -0.012], red, [0, -0.14, 0]);
  k.cyl(0.014, 0.012, [0.022, 0.007, 0], steel);
  k.box(0.04, 0.009, 0.016, [0.045, 0.007, 0], steel);
}

function screwdriver(k: Kit): void {
  k.cyl(0.026, 0.1, [-0.05, 0.013, 0], k.mat("grip", "#F9A825", 0, 0.55), [0, 0, Math.PI / 2]);
  k.cyl(0.006, 0.1, [0.05, 0.013, 0], k.mat("steel", "#B0B6BC", 1, 0.3), [0, 0, Math.PI / 2]);
}

/* ================================================================== */
/* Mechanical                                                          */
/* ================================================================== */

/** Motor + driven bearing on a base plate. Shafts at x = ±0.25, axis height 0.15. */
function motorBench(k: Kit): void {
  const steel = k.mat("steel", "#8D949B", 0.9, 0.35);
  const paint = k.mat("motor", "#2F5D8A", 0.2, 0.45);
  const dark = k.mat("dark", "#2A2D30", 0.3, 0.5);
  k.box(0.7, 0.02, 0.3, [0, 0.01, 0], k.mat("plate", "#5F666D", 0.8, 0.4));
  // Motor (axis along Z) on its feet + slide rails (tensioner)
  for (const z of [-0.08, 0.08]) k.box(0.3, 0.012, 0.02, [-0.25, 0.026, z], steel);
  k.box(0.18, 0.06, 0.15, [-0.25, 0.062, 0], paint);
  k.cyl(0.16, 0.2, [-0.25, 0.15, -0.01], paint, [Math.PI / 2, 0, 0], undefined, 32);
  for (let z = -0.09; z <= 0.07; z += 0.025) k.cyl(0.168, 0.006, [-0.25, 0.15, z], paint, [Math.PI / 2, 0, 0], undefined, 32);
  k.cyl(0.12, 0.02, [-0.25, 0.15, -0.12], dark, [Math.PI / 2, 0, 0], undefined, 24);
  k.box(0.07, 0.05, 0.07, [-0.25, 0.25, -0.02], paint);
  k.cyl(0.019, 0.1, [-0.25, 0.15, 0.14], steel, [Math.PI / 2, 0, 0]);
  // Driven shaft on a bearing pedestal
  k.box(0.09, 0.1, 0.07, [0.25, 0.07, -0.02], dark);
  k.cyl(0.07, 0.07, [0.25, 0.15, -0.02], dark, [Math.PI / 2, 0, 0], undefined, 24);
  k.cyl(0.019, 0.22, [0.25, 0.15, 0.06], steel, [Math.PI / 2, 0, 0]);
  // Tensioner screw (target "tendeur": local x = -0.42, z = 0)
  k.box(0.02, 0.03, 0.04, [-0.42, 0.035, 0], dark);
  k.cyl(0.01, 0.06, [-0.39, 0.035, 0], steel, [0, 0, Math.PI / 2]);
  k.cyl(0.018, 0.008, [-0.43, 0.035, 0], steel, [0, 0, Math.PI / 2], undefined, 6);
  // Bolt holes on the front motor feet (target "fixations": local x = -0.25, z = 0.07)
  for (const x of [-0.31, -0.19]) k.cyl(0.012, 0.002, [x, 0.0335, 0.07], k.mat("hole", "#111111", 0, 0.9));
}

/** V-groove pulley, axis along Z, base = bottom of the rim; part "spinner" rotates. */
function pulley(k: Kit, r: number): void {
  const w = 0.03;
  const bore = 0.0095;
  const shape = [
    [bore, -w / 2], [r, -w / 2], [r, -0.007], [r - 0.01, 0], [r, 0.007], [r, w / 2], [bore, w / 2], [bore, -w / 2],
  ].map(([x, y]) => new Vector3(x, y, 0));
  const spinner = k.node("spinner", [0, r, 0]);
  const lathe = MeshBuilder.CreateLathe(`${k.name}_lathe`, { shape, tessellation: 40, sideOrientation: Mesh.DOUBLESIDE }, k.scene);
  lathe.material = k.mat("iron", "#7A8088", 0.85, 0.4);
  lathe.parent = spinner;
  lathe.rotation.x = Math.PI / 2;
  // Lightening holes make the rotation visible.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    k.cyl(r * 0.28, w + 0.002, [Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0], k.materials.hole ?? k.mat("hole", "#2A2D30", 0.3, 0.6), [Math.PI / 2, 0, 0], spinner, 14);
  }
  k.box(0.004, 0.004, w + 0.003, [0, bore + 0.002, 0], k.mat("key", "#C9A227", 0.9, 0.3), undefined, spinner);
}

function vBelt(k: Kit): void {
  const t = MeshBuilder.CreateTorus(`${k.name}_torus`, { diameter: 0.43, thickness: 0.013, tessellation: 48 }, k.scene);
  t.material = k.mat("rubber", "#1C1C1C", 0, 0.85);
  t.parent = k.root;
  t.scaling.y = 0.7;
  t.position.y = 0.0046;
}

function spiritLevel(k: Kit): void {
  k.box(0.3, 0.03, 0.025, [0, 0.015, 0], k.mat("alu", "#C9CDD2", 0.9, 0.35));
  for (const x of [-0.145, 0.145]) k.box(0.012, 0.032, 0.027, [x, 0.016, 0], k.mat("cap", "#C62828", 0, 0.5));
  k.cyl(0.012, 0.05, [0, 0.022, 0.0128], k.mat("vial", "#9CCC65", 0, 0.1, 0.55), [0, 0, Math.PI / 2]);
  k.parts.bubble = k.sphere(0.006, [0, 0.0245, 0.0135], k.mat("bubble", "#F1F8E9", 0, 0.1));
}

function boltsM8(k: Kit): void {
  k.box(0.08, 0.01, 0.05, [0, 0.005, 0], k.mat("tray", "#37474F", 0, 0.6));
  const steel = k.mat("zinc", "#B7BCC2", 0.95, 0.35);
  [-0.027, -0.009, 0.009, 0.027].forEach((x) => {
    k.cyl(0.013, 0.0055, [x, 0.0105, -0.012], steel, [Math.PI / 2, 0, 0], undefined, 6);
    k.cyl(0.008, 0.035, [x, 0.0105, 0.008], steel, [Math.PI / 2, 0, 0], undefined, 12);
  });
}

function wrench13(k: Kit): void {
  const chrome = k.mat("chrome", "#D5D9DE", 1, 0.2);
  k.box(0.15, 0.006, 0.017, [0, 0.003, 0], chrome);
  for (const [x, open] of [[0.088, 0.013], [-0.088, 0.01]] as [number, number][]) {
    const s = Math.sign(x);
    k.box(0.016, 0.006, 0.008, [x, 0.003, open / 2 + 0.004], chrome);
    k.box(0.016, 0.006, 0.008, [x, 0.003, -(open / 2 + 0.004)], chrome);
    k.box(0.006, 0.006, open + 0.016, [x - s * 0.008, 0.003, 0], chrome);
  }
}

function gloves(k: Kit): void {
  const palm = k.mat("palm", "#E67E22", 0, 0.8);
  const cuff = k.mat("cuff", "#455A64", 0, 0.8);
  for (const gx of [-0.055, 0.055]) {
    k.box(0.08, 0.02, 0.09, [gx, 0.01, 0], palm);
    k.box(0.085, 0.022, 0.05, [gx, 0.011, 0.07], cuff);
    for (let i = 0; i < 4; i++) {
      const fx = gx - 0.03 + i * 0.02;
      k.cyl(0.017, 0.07 - Math.abs(i - 1.5) * 0.01, [fx, 0.009, -0.075], palm, [Math.PI / 2, 0, 0], undefined, 10);
    }
    k.cyl(0.018, 0.05, [gx + Math.sign(gx) * 0.045, 0.009, -0.01], palm, [Math.PI / 2, 0.7 * Math.sign(gx), 0], undefined, 10);
  }
}

/** Isolator switch with rotary handle and padlock (parts "handle", "padlock"). */
function isolator(k: Kit): void {
  k.box(0.12, 0.18, 0.09, [0, 0.09, 0], k.mat("case", "#9AA3AB", 0.3, 0.5));
  k.label("plate", 0.1, 0.1, [0, 0.1, 0.0455], [400, 400], (ctx, w, h) => {
    ctx.fillStyle = "#F9C80E";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.font = `bold 70px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("I", w / 2, 82);
    ctx.fillText("0", 62, h / 2 + 24);
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillText("SECTIONNEUR", w / 2, h - 18);
  });
  const handle = k.node("handle", [0, 0.1, 0.05]);
  k.cyl(0.03, 0.012, [0, 0, 0.006], k.mat("knob", "#C62828", 0, 0.45), [Math.PI / 2, 0, 0], handle);
  k.box(0.016, 0.075, 0.014, [0, 0, 0.012], k.materials.knob, undefined, handle);
  const padlock = k.node("padlock", [-0.032, 0.05, 0.06]);
  k.box(0.028, 0.026, 0.012, [0, 0, 0], k.mat("lock", "#D84315", 0, 0.5), undefined, padlock);
  const shackle = MeshBuilder.CreateTorus(`${k.name}_shackle`, { diameter: 0.02, thickness: 0.004, tessellation: 16 }, k.scene);
  shackle.material = k.mat("shackle", "#C0C4C8", 1, 0.3);
  shackle.parent = padlock;
  shackle.position.y = 0.015;
  shackle.rotation.x = Math.PI / 2;
  padlock.setEnabled(false);
}

/* ================================================================== */
/* Engine demo                                                          */
/* ================================================================== */

/** Top of the plinth (m) = base of the engine-bay scan (backend demoTps.ts: PLINTH_TOP). */
const PLINTH = { width: 1.9, depth: 1.16, top: 0.68, rim: 0.2, wall: 0.03 };

/**
 * Display plinth of the engine-bay scan: anthracite pedestal with a brushed-aluminium
 * rim that hides the cut underside of the scan, and an identification plate (front, +Z).
 */
function enginePlinth(k: Kit): void {
  const { width: W, depth: D, top: T, rim: R, wall: t } = PLINTH;
  const body = k.mat("body", "#2B2F33", 0.25, 0.55);
  k.box(W - 0.06, 0.06, D - 0.06, [0, 0.03, 0], k.mat("kick", "#141618", 0, 0.8));
  k.box(W, T - 0.06, D, [0, 0.06 + (T - 0.06) / 2, 0], body);
  const rim = k.mat("rim", "#B9BEC3", 0.9, 0.35);
  k.box(W, R, t, [0, T + R / 2, D / 2 - t / 2], rim);
  k.box(W, R, t, [0, T + R / 2, -D / 2 + t / 2], rim);
  k.box(t, R, D - 2 * t, [W / 2 - t / 2, T + R / 2, 0], rim);
  k.box(t, R, D - 2 * t, [-W / 2 + t / 2, T + R / 2, 0], rim);
  k.label("plate", 0.62, 0.13, [0, T - 0.12, D / 2 + 0.002], [1240, 260], (ctx, w, h) => {
    ctx.fillStyle = "#1C1F22";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#B9BEC3";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = "#F2F4F6";
    ctx.textAlign = "center";
    ctx.font = `bold 64px ${FONT}`;
    ctx.fillText("COMPARTIMENT MOTEUR — AUDI A3 TFSI", w / 2, 110);
    ctx.fillStyle = "#AEB6BE";
    ctx.font = `38px ${FONT}`;
    ctx.fillText("Scan 3D d'un véhicule réel · échelle 1", w / 2, 190);
  });
}

const BUILDERS: Record<string, (k: Kit) => void> = {
  engine_plinth: enginePlinth,
  breadboard,
  battery_12v: battery12v,
  toggle_switch: toggleSwitch,
  resistors_150: resistors150,
  leds_red: ledsRed,
  jumper_wires: jumperWires,
  multimeter,
  cutting_pliers: cuttingPliers,
  screwdriver,
  motor_bench: motorBench,
  pulley_small: (k) => pulley(k, 0.05),
  pulley_large: (k) => pulley(k, 0.07),
  v_belt: vBelt,
  spirit_level: spiritLevel,
  bolts_m8: boltsM8,
  wrench_13: wrench13,
  gloves,
  isolator,
};

/** Builds a builtin model, or null if `kind` is unknown. */
export function buildBuiltin(scene: Scene, kind: string, name: string): BuiltinModel | null {
  const builder = BUILDERS[kind];
  if (!builder) return null;
  const k = new Kit(scene, name);
  builder(k);
  return k.done();
}
