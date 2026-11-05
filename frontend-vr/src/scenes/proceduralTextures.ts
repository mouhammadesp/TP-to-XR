/**
 * Procedural PBR textures (pure TypeScript, no Babylon → unit-testable).
 *
 * Each material produces 3 seamless (tileable) RGBA maps:
 *   albedo  — sRGB base color
 *   normal  — tangent-space normal map derived from a height field (Sobel)
 *   orm     — R: ambient occlusion (255), G: roughness, B: metallic (glTF convention)
 *
 * Tileability: every noise octave uses an integer lattice period and wraps,
 * so the texture repeats without visible seams.
 */

export type MaterialKind =
  | "concrete"
  | "polishedConcrete"
  | "oak"
  | "brushedSteel"
  | "paintedMetal"
  | "ceilingTiles"
  // Modern workshop palette
  | "paintedWall"
  | "epoxyFloor"
  | "laminate"
  | "blackSteel"
  | "lightGrayMetal"
  | "woodSlats"
  | "curtainFabric"
  | "whiteAluminum"
  | "graphitePaint";

export interface TextureSet {
  size: number;
  albedo: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
}

interface Sample {
  r: number;
  g: number;
  b: number;
  /** Height for the normal map, 0..1. */
  h: number;
  rough: number;
  metal: number;
}

/** Deterministic integer hash → [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise; (u, v) in [0, 1), lattice periods px × py. */
export function vnoise(u: number, v: number, px: number, py: number, seed: number): number {
  const x = u * px;
  const y = v * py;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % px) + px) % px;
  const ya = ((y0 % py) + py) % py;
  const xb = (xa + 1) % px;
  const yb = (ya + 1) % py;
  const a = hash(xa, ya, seed);
  const b = hash(xb, ya, seed);
  const c = hash(xa, yb, seed);
  const d = hash(xb, yb, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Tileable fractal noise (octaves double the periods). */
export function fbm(u: number, v: number, px: number, py: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(u, v, px << i, py << i, seed + i * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const frac = (x: number) => x - Math.floor(x);

/** Pattern definitions — one function per material. */
const PATTERNS: Record<MaterialKind, { normalStrength: number; sample: (u: number, v: number) => Sample }> = {
  /** Raw wall concrete: mottled gray, stains, small pores, matte. */
  concrete: {
    normalStrength: 1.4,
    sample: (u, v) => {
      const n = fbm(u, v, 4, 4, 5, 1);
      const stains = fbm(u, v, 2, 2, 3, 7);
      // Pores: rare, soft and irregular (fbm, not a single lattice → no visible grid of dots).
      const poreField = fbm(u, v, 48, 48, 2, 3);
      const pores = Math.max(0, (poreField - 0.72) / 0.28);
      const base = 0.64 + (n - 0.5) * 0.22 + (stains - 0.5) * 0.14 - pores * 0.06;
      return { r: base, g: base * 0.99, b: base * 0.96, h: n * 0.85 - pores * 0.15, rough: 0.85 + (n - 0.5) * 0.1, metal: 0 };
    },
  },
  /** Polished floor concrete: light, low contrast, aggregate speckles, sweep marks, semi-glossy. */
  polishedConcrete: {
    normalStrength: 0.8,
    sample: (u, v) => {
      const n = fbm(u, v, 4, 4, 5, 11);
      const mottling = fbm(u, v, 2, 2, 3, 13);
      const sweep = vnoise(u, v, 2, 128, 17);
      const speck = vnoise(u, v, 160, 160, 19);
      const aggregate = speck > 0.86 ? 0.07 : speck < 0.1 ? -0.06 : 0;
      const base = 0.66 + (n - 0.5) * 0.1 + (mottling - 0.5) * 0.12 + aggregate;
      return {
        r: base,
        g: base,
        b: base * 0.98,
        h: n * 0.3 + sweep * 0.1,
        rough: 0.26 + mottling * 0.16 + sweep * 0.06,
        metal: 0,
      };
    },
  },
  /** Oak: growth rings distorted by noise + fine fibers along U. */
  oak: {
    normalStrength: 1.6,
    sample: (u, v) => {
      const fibers = vnoise(u, v, 4, 160, 23);
      const t = v * 10 + fbm(u, v, 3, 2, 3, 29) * 3;
      const ring = Math.pow(frac(t), 2.5);
      const knots = fbm(u, v, 2, 2, 2, 31);
      const dark = clamp01(ring * 0.65 + (fibers - 0.5) * 0.5 + (knots - 0.5) * 0.3);
      return {
        r: lerp(0.72, 0.45, dark),
        g: lerp(0.52, 0.29, dark),
        b: lerp(0.31, 0.15, dark),
        h: fibers * 0.6 + (1 - ring) * 0.4,
        rough: 0.55 + fibers * 0.12,
        metal: 0,
      };
    },
  },
  /** Brushed steel: fine directional streaks along U + rare scratches, very metallic. */
  brushedSteel: {
    normalStrength: 0.12,
    sample: (u, v) => {
      // Subtle: real brushing is barely visible in color, mostly in roughness/reflections.
      const streak = vnoise(u, v, 4, 192, 37) * 0.6 + vnoise(u, v, 2, 48, 41) * 0.4;
      const scratch = vnoise(u, v, 8, 384, 43) > 0.95 ? 1 : 0;
      const c = 0.62 + (streak - 0.5) * 0.03 + scratch * 0.03;
      return { r: c * 0.97, g: c * 0.99, b: c * 1.02, h: streak * 0.4 + scratch * 0.2, rough: 0.36 + (streak - 0.5) * 0.04, metal: 0.85 };
    },
  },
  /** Powder-coated cabinet: blue-gray, subtle orange peel. */
  paintedMetal: {
    normalStrength: 0.6,
    sample: (u, v) => {
      const n = fbm(u, v, 16, 16, 3, 47);
      const k = 0.95 + (n - 0.5) * 0.1;
      return { r: 0.24 * k, g: 0.3 * k, b: 0.37 * k, h: n * 0.4, rough: 0.45 + (n - 0.5) * 0.05, metal: 0.25 };
    },
  },
  /** Acoustic ceiling tiles: 4×4 tiles per texture, speckled. */
  /** Modern painted wall: off-white, very subtle roller texture, matte. */
  paintedWall: {
    normalStrength: 0.35,
    sample: (u, v) => {
      const n = fbm(u, v, 8, 8, 4, 61);
      const c = 0.86 + (n - 0.5) * 0.04;
      return { r: c, g: c * 1.0, b: c * 1.015, h: n, rough: 0.82, metal: 0 };
    },
  },
  /** Light-gray epoxy resin floor: glossy, fine colored flakes. */
  epoxyFloor: {
    normalStrength: 0.15,
    sample: (u, v) => {
      const n = fbm(u, v, 4, 4, 4, 67);
      const flake = vnoise(u, v, 192, 192, 71);
      const tint = vnoise(u, v, 192, 192, 73);
      let r = 0.62 + (n - 0.5) * 0.05;
      let g = r * 1.01;
      let b = r * 1.04;
      if (flake > 0.88) {
        const k = tint > 0.5 ? 0.12 : -0.12; // white / anthracite flakes
        r += k; g += k; b += k;
      }
      return { r, g, b, h: n * 0.2, rough: 0.16 + n * 0.08, metal: 0 };
    },
  },
  /** Light-gray high-pressure laminate worktop, fine speckle. */
  laminate: {
    normalStrength: 0.2,
    sample: (u, v) => {
      const speck = vnoise(u, v, 256, 256, 79);
      const n = fbm(u, v, 8, 8, 3, 83);
      const c = 0.79 + (n - 0.5) * 0.03 + (speck > 0.9 ? -0.05 : 0);
      return { r: c, g: c * 1.005, b: c * 1.02, h: speck * 0.3, rough: 0.42, metal: 0 };
    },
  },
  /** Black powder-coated steel (bench legs). */
  blackSteel: {
    normalStrength: 0.4,
    sample: (u, v) => {
      const n = fbm(u, v, 16, 16, 3, 89);
      const c = 0.07 + (n - 0.5) * 0.02;
      return { r: c, g: c, b: c * 1.05, h: n * 0.4, rough: 0.48, metal: 0.35 };
    },
  },
  /** Satin graphite paint on steel (storage cabinet); fine grain, no strong reflection. */
  graphitePaint: {
    normalStrength: 0.2, // satin paint: grain barely in relief
    sample: (u, v) => {
      const n = fbm(u, v, 24, 24, 3, 131);
      const c = 0.2 + (n - 0.5) * 0.03;
      return { r: c * 0.98, g: c, b: c * 1.04, h: n * 0.5, rough: 0.5, metal: 0.25 };
    },
  },
  /** Light-gray painted steel (RAL 7035 style): shelf boards. */
  lightGrayMetal: {
    normalStrength: 0.35,
    sample: (u, v) => {
      const n = fbm(u, v, 16, 16, 3, 97);
      const c = 0.78 + (n - 0.5) * 0.04;
      return { r: c * 0.99, g: c, b: c * 0.98, h: n * 0.4, rough: 0.4, metal: 0.15 };
    },
  },
  /** Acoustic wall: vertical oak slats (2.5 cm) on black felt (1 cm gaps). U = horizontal. */
  woodSlats: {
    normalStrength: 2.5,
    sample: (u, v) => {
      const slats = 34; // per texture (tile 1.2 m → 3.5 cm pitch)
      const t = frac(u * slats);
      const gap = t > 0.72;
      const grain = vnoise(u, v, slats * 2, 24, 101) * 0.6 + fbm(u, v, 4, 8, 3, 103) * 0.4;
      const shade = vnoise(u, v, slats, 1, 107); // each slat a slightly different tone
      if (gap) return { r: 0.05, g: 0.05, b: 0.055, h: 0, rough: 0.95, metal: 0 };
      const k = 0.85 + shade * 0.25 + (grain - 0.5) * 0.18;
      return { r: 0.64 * k, g: 0.46 * k, b: 0.3 * k, h: 1, rough: 0.55, metal: 0 };
    },
  },
  /** Linen-like curtain fabric: light warm gray weave. */
  curtainFabric: {
    normalStrength: 0.8,
    sample: (u, v) => {
      const warp = vnoise(u, v, 256, 4, 109);
      const weft = vnoise(u, v, 4, 256, 113);
      const slub = fbm(u, v, 16, 64, 2, 127);
      const c = 0.76 + (warp - 0.5) * 0.06 + (weft - 0.5) * 0.06 + (slub - 0.5) * 0.05;
      return { r: c * 1.0, g: c * 0.98, b: c * 0.94, h: (warp + weft) / 2, rough: 0.92, metal: 0 };
    },
  },
  /** Anodized aluminum (window frames, rails): very light, satin. */
  whiteAluminum: {
    normalStrength: 0.2,
    sample: (u, v) => {
      const n = fbm(u, v, 8, 64, 2, 131);
      const c = 0.88 + (n - 0.5) * 0.03;
      return { r: c, g: c, b: c * 1.01, h: n, rough: 0.35, metal: 0.6 };
    },
  },
  ceilingTiles: {
    normalStrength: 1.2,
    sample: (u, v) => {
      const gu = frac(u * 4);
      const gv = frac(v * 4);
      const joint = gu < 0.012 || gu > 0.988 || gv < 0.012 || gv > 0.988 ? 1 : 0;
      const speck = fbm(u, v, 64, 64, 2, 53);
      const c = joint ? 0.78 : 0.95 - speck * 0.05;
      return { r: c, g: c, b: c * 0.98, h: joint ? 0 : 0.6 + speck * 0.4, rough: 0.95, metal: 0 };
    },
  },
};

/** Default resolution per material (power of two, for mipmaps). */
export const DEFAULT_SIZE: Record<MaterialKind, number> = {
  concrete: 512,
  polishedConcrete: 512,
  oak: 512,
  brushedSteel: 512,
  paintedMetal: 256,
  ceilingTiles: 256,
  paintedWall: 256,
  epoxyFloor: 512,
  laminate: 512,
  blackSteel: 128,
  lightGrayMetal: 256,
  woodSlats: 512,
  curtainFabric: 512,
  whiteAluminum: 128,
  graphitePaint: 256,
};

/** Base surface parameters used when a texture comes from an image (albedo only). */
export const SURFACE: Record<MaterialKind, { rough: number; metal: number; normalStrength: number }> = Object.fromEntries(
  (Object.keys(DEFAULT_SIZE) as MaterialKind[]).map((k) => {
    const s = PATTERNS[k].sample(0.37, 0.61);
    return [k, { rough: s.rough, metal: s.metal, normalStrength: PATTERNS[k].normalStrength }];
  })
) as Record<MaterialKind, { rough: number; metal: number; normalStrength: number }>;

/**
 * Seam score of a square RGBA image: color jump across the wrap-around borders,
 * relative to the average jump between neighboring pixels. ≈ 1 for a seamless
 * texture, ≫ 1 when tiling would show visible lines.
 */
export function seamScore(px: Uint8Array | Uint8ClampedArray, size: number): number {
  const at = (x: number, y: number, c: number) => px[(y * size + x) * 4 + c];
  let border = 0;
  let inner = 0;
  for (let i = 0; i < size; i++) {
    for (let c = 0; c < 3; c++) {
      border += Math.abs(at(0, i, c) - at(size - 1, i, c)) + Math.abs(at(i, 0, c) - at(i, size - 1, c));
      inner += Math.abs(at(size / 2, i, c) - at(size / 2 - 1, i, c)) + Math.abs(at(i, size / 2, c) - at(i, size / 2 - 1, c));
    }
  }
  return border / Math.max(inner, 1);
}

/**
 * Makes an image tileable: blends it with a copy shifted by half its size
 * (continuous across the borders), the shifted copy dominating near the edges
 * and the original in the center. Small ghosting, no visible seam.
 */
/**
 * Removes the large-scale lighting baked into a material photo (e.g. a bright corner):
 * each pixel is divided by the local average luminance (16 × 16 grid, bilinear) and
 * scaled back to the image mean. Only the fine grain is kept: the gradient and the
 * cloudy patches disappear — otherwise they would repeat visibly on every tile and
 * show as squares where the seam blending cross-fades the image.
 */
export function flattenLighting(px: Uint8Array, size: number): Uint8Array {
  const G = 16;
  const cell = size / G;
  const avg = new Float32Array(G * G);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      avg[Math.floor(y / cell) * G + Math.floor(x / cell)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }
  }
  let mean = 0;
  for (let i = 0; i < avg.length; i++) mean += (avg[i] /= cell * cell) / avg.length;
  const at = (gx: number, gy: number) => avg[Math.min(G - 1, Math.max(0, gy)) * G + Math.min(G - 1, Math.max(0, gx))];
  const out = new Uint8Array(px.length);
  for (let y = 0; y < size; y++) {
    const fy = (y + 0.5) / cell - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) / cell - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const local =
        (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      const k = mean / Math.max(1, local);
      const o = (y * size + x) * 4;
      out[o] = Math.min(255, px[o] * k);
      out[o + 1] = Math.min(255, px[o + 1] * k);
      out[o + 2] = Math.min(255, px[o + 2] * k);
      out[o + 3] = 255;
    }
  }
  return out;
}

export function makeSeamless(px: Uint8Array | Uint8ClampedArray, size: number): Uint8Array {
  const out = new Uint8Array(px.length);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 0 in the center → 1 at the borders (smooth).
      const dx = Math.abs(x + 0.5 - half) / half;
      const dy = Math.abs(y + 0.5 - half) / half;
      const e = Math.max(dx, dy);
      const w = e < 0.6 ? 0 : Math.min(1, (e - 0.6) / 0.35);
      const o = (y * size + x) * 4;
      const so = (((y + half) % size) * size + ((x + half) % size)) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(px[o + c] * (1 - w) + px[so + c] * w);
    }
  }
  return out;
}

/** Albedo image → full texture set (normal from luminance, roughness/metal from the material). */
export function textureSetFromImage(kind: MaterialKind, rgba: Uint8Array, size: number): TextureSet {
  const base = SURFACE[kind];
  const height = new Float32Array(size * size);
  const orm = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const l = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
    height[i] = l;
    orm[i * 4] = 255;
    orm[i * 4 + 1] = clamp01(base.rough + (0.5 - l) * 0.12) * 255;
    orm[i * 4 + 2] = base.metal * 255;
    orm[i * 4 + 3] = 255;
  }
  const albedo = new Uint8Array(rgba.length);
  albedo.set(rgba);
  for (let i = 3; i < albedo.length; i += 4) albedo[i] = 255;
  return { size, albedo, normal: heightToNormal(height, size, base.normalStrength * 0.6), orm };
}

/**
 * Generates the 3 maps of a material.
 * @param size power of two (e.g. 256, 512)
 */
export function generateTextureSet(kind: MaterialKind, size = DEFAULT_SIZE[kind]): TextureSet {
  const pattern = PATTERNS[kind];
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const height = new Float32Array(n);

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const s = pattern.sample((x + 0.5) / size, v);
      const i = y * size + x;
      const o = i * 4;
      albedo[o] = clamp01(s.r) * 255;
      albedo[o + 1] = clamp01(s.g) * 255;
      albedo[o + 2] = clamp01(s.b) * 255;
      albedo[o + 3] = 255;
      orm[o] = 255;
      orm[o + 1] = clamp01(s.rough) * 255;
      orm[o + 2] = clamp01(s.metal) * 255;
      orm[o + 3] = 255;
      height[i] = s.h;
    }
  }

  return { size, albedo, normal: heightToNormal(height, size, pattern.normalStrength), orm };
}

/**
 * Converts a wrapping height field to a tangent-space normal map (Sobel).
 */
export function heightToNormal(height: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  // Sobel gradients are in "height per texel"; scale so strength ≈ bump depth in texels.
  const k = (strength * size) / 256;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * k;
      let ny = -dy * k;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const o = (y * size + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * 0.5 + 0.5) * 255;
      out[o + 2] = (nz * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}
