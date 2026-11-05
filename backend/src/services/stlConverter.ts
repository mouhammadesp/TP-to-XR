/**
 * STL → GLB converter (pure Node, no dependency).
 *
 * - Reads binary and ASCII STL.
 * - Converts units to meters (STL from 3D-printing sites is almost always in mm)
 *   and Z-up → Y-up (glTF convention); the base sits at y = 0, centered on X/Z,
 *   so the part keeps its REAL size in the workshop.
 * - Flat normals computed per facet (the normals stored in STL files are often wrong or zero).
 * - Writes a valid glTF 2.0 binary (chunks padded to 4 bytes, accurate accessor min/max),
 *   with the attribution in `asset.copyright` and a sidecar JSON (license, source, size).
 */
import { promises as fsp } from "fs";
import path from "path";
import { ASSETS_DIR, ASSETS_URL_PREFIX } from "./assetManager";
import { HttpError } from "../utils/http";

export const CONVERTED_DIR = path.join(ASSETS_DIR, "converted");
export const CONVERTED_URL = `${ASSETS_URL_PREFIX}/converted`;
/** STL sources (not served publicly). */
export const SOURCE_DIR = path.resolve(ASSETS_DIR, "..", "source-models");

const MAX_TRIANGLES = 2_000_000;
const UNIT_TO_M = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254 } as const;
export type StlUnit = keyof typeof UNIT_TO_M;

export interface Attribution {
  title: string;
  author: string;
  license: string;
  source_url: string | null;
}

export interface ConvertOptions {
  unit?: StlUnit;
  /** Up axis of the STL ("z" for 3D-printing files). */
  up?: "z" | "y";
  /** Base color, #RRGGBB. */
  color?: string;
  attribution?: Attribution | null;
}

export interface ConvertedModel {
  slug: string;
  url: string;
  bytes: number;
  triangles: number;
  /** Real size in meters (x = width, y = height, z = depth) after conversion. */
  dimensions_m: { x: number; y: number; z: number };
  attribution: Attribution | null;
  source_file: string;
  converted_at: string;
}

/* ------------------------------------------------------------------ */
/* STL parsing                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parses an STL file into a flat triangle soup (9 floats per triangle).
 * Binary is detected by its exact size (84 + 50·n bytes); otherwise ASCII ("solid … facet … vertex").
 */
export function parseStl(buf: Buffer): Float32Array {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      if (n === 0 || n > MAX_TRIANGLES) throw new HttpError(422, `STL: invalid triangle count (${n})`);
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; // skip the stored normal
        for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(o + k * 4);
      }
      return out;
    }
  }
  const text = buf.toString("latin1");
  if (!/^\s*solid/i.test(text)) throw new HttpError(422, "Not an STL file (neither binary nor ASCII 'solid')");
  const coords: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) coords.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (coords.length === 0 || coords.length % 9 !== 0 || coords.some((c) => !Number.isFinite(c))) {
    throw new HttpError(422, "ASCII STL: malformed vertex list");
  }
  if (coords.length / 9 > MAX_TRIANGLES) throw new HttpError(422, "STL too large");
  return Float32Array.from(coords);
}

/* ------------------------------------------------------------------ */
/* Geometry transform                                                   */
/* ------------------------------------------------------------------ */

interface Geometry {
  positions: Float32Array;
  normals: Float32Array;
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * Units → meters, Z-up → Y-up ((x, y, z) → (x, z, −y), a rotation: winding and
 * handedness preserved), base at y = 0, centered on X/Z, flat normals.
 */
export function transformGeometry(tris: Float32Array, unit: StlUnit, up: "z" | "y"): Geometry {
  const s = UNIT_TO_M[unit];
  const p = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i] * s;
    const y = tris[i + 1] * s;
    const z = tris[i + 2] * s;
    if (up === "z") {
      p[i] = x;
      p[i + 1] = z;
      p[i + 2] = -y;
    } else {
      p[i] = x;
      p[i + 1] = y;
      p[i + 2] = z;
    }
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    const a = i % 3;
    if (p[i] < lo[a]) lo[a] = p[i];
    if (p[i] > hi[a]) hi[a] = p[i];
  }
  const shift = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  for (let i = 0; i < p.length; i++) p[i] -= shift[i % 3];

  const normals = new Float32Array(p.length);
  for (let t = 0; t < p.length; t += 9) {
    const ux = p[t + 3] - p[t], uy = p[t + 4] - p[t + 1], uz = p[t + 5] - p[t + 2];
    const vx = p[t + 6] - p[t], vy = p[t + 7] - p[t + 1], vz = p[t + 8] - p[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let v = 0; v < 3; v++) normals.set([nx, ny, nz], t + v * 3);
  }
  const min: [number, number, number] = [lo[0] - shift[0], 0, lo[2] - shift[2]];
  const max: [number, number, number] = [hi[0] - shift[0], hi[1] - lo[1], hi[2] - shift[2]];
  // Accessor min/max must match the float32 data exactly.
  const f = (n: number) => Math.fround(n);
  return { positions: p, normals, min: [f(min[0]), f(min[1]), f(min[2])], max: [f(max[0]), f(max[1]), f(max[2])] };
}

/* ------------------------------------------------------------------ */
/* GLB writing                                                          */
/* ------------------------------------------------------------------ */

/** Pads a buffer to a multiple of 4 bytes. */
function pad4(b: Buffer, fill: number): Buffer {
  const rest = (4 - (b.length % 4)) % 4;
  return rest ? Buffer.concat([b, Buffer.alloc(rest, fill)]) : b;
}

/** Builds a glTF 2.0 binary (one mesh, POSITION + NORMAL, one PBR material). */
export function buildGlb(g: Geometry, name: string, color: string, attribution: Attribution | null): Buffer {
  const count = g.positions.length / 3;
  const posBytes = Buffer.from(g.positions.buffer, g.positions.byteOffset, g.positions.byteLength);
  const norBytes = Buffer.from(g.normals.buffer, g.normals.byteOffset, g.normals.byteLength);
  const bin = pad4(Buffer.concat([posBytes, norBytes]), 0);
  const [r, gg, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  const gltf = {
    asset: {
      version: "2.0",
      generator: "TP-to-xR stlConverter",
      ...(attribution ? { copyright: `${attribution.title} by ${attribution.author} — ${attribution.license}${attribution.source_url ? ` — ${attribution.source_url}` : ""}` } : {}),
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }] }],
    materials: [
      {
        name: "printed_plastic",
        pbrMetallicRoughness: { baseColorFactor: [srgbToLinear(r), srgbToLinear(gg), srgbToLinear(b), 1], metallicFactor: 0, roughnessFactor: 0.55 },
        doubleSided: true, // STL meshes are frequently not watertight
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min: g.min, max: g.max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: norBytes.length, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const json = pad4(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(json.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4); // "JSON"
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4); // "BIN\0"
  return Buffer.concat([header, jsonHead, json, binHead, bin]);
}

/* ------------------------------------------------------------------ */
/* Attribution (Thingiverse export layout)                              */
/* ------------------------------------------------------------------ */

/**
 * Reads the attribution of a Thingiverse download folder:
 *   LICENSE.txt  "This thing was created by Thingiverse user X, and is licensed under Y"
 *   README.txt   "<Title> by X on Thingiverse: https://www.thingiverse.com/thing:N"
 */
export function parseThingiverseInfo(license: string, readme: string): Attribution | null {
  const lic = /created by Thingiverse user\s+(.+?),\s*and is licensed under\s+(.+?)\s*$/im.exec(license);
  if (!lic) return null;
  const head = /^(.+?)\s+by\s+\S+\s+on Thingiverse:\s*(https?:\/\/\S+)/im.exec(readme);
  return {
    title: head?.[1]?.trim() ?? "Modèle Thingiverse",
    author: lic[1].trim(),
    license: lic[2].trim().replace(/^Creative Commons\s*-\s*/i, "CC "),
    source_url: head?.[2] ?? null,
  };
}

/** URL-safe slug from a file name. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.stl$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48) || "model";
}

/* ------------------------------------------------------------------ */
/* Service                                                              */
/* ------------------------------------------------------------------ */

/**
 * Converts STL bytes and stores the GLB (+ sidecar JSON) in the converted cache.
 */
export async function convertStl(stl: Buffer, sourceName: string, opts: ConvertOptions = {}): Promise<ConvertedModel> {
  const t0 = Date.now();
  const unit = opts.unit ?? "mm";
  const color = /^#[0-9a-fA-F]{6}$/.test(opts.color ?? "") ? (opts.color as string) : "#0088FF";
  const slug = slugify(path.basename(sourceName));
  console.log(`🔄 [STL] ${sourceName}: ${(stl.length / 1024).toFixed(1)} KB, unit=${unit}, up=${opts.up ?? "z"}`);

  const tris = parseStl(stl);
  const geo = transformGeometry(tris, unit, opts.up ?? "z");
  const triangles = tris.length / 9;
  const dims = { x: round(geo.max[0] - geo.min[0]), y: round(geo.max[1] - geo.min[1]), z: round(geo.max[2] - geo.min[2]) };
  if (Math.max(dims.x, dims.y, dims.z) > 5) {
    console.warn(`⚠️  [STL] ${slug} is ${Math.max(dims.x, dims.y, dims.z)} m wide: wrong unit? (unit=${unit})`);
  }
  const glb = buildGlb(geo, slug, color, opts.attribution ?? null);

  await fsp.mkdir(CONVERTED_DIR, { recursive: true });
  const meta: ConvertedModel = {
    slug,
    url: `${CONVERTED_URL}/${slug}.glb`,
    bytes: glb.length,
    triangles,
    dimensions_m: dims,
    attribution: opts.attribution ?? null,
    source_file: path.basename(sourceName),
    converted_at: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(CONVERTED_DIR, `${slug}.glb`), glb);
  await fsp.writeFile(path.join(CONVERTED_DIR, `${slug}.json`), JSON.stringify(meta, null, 2));
  console.log(
    `✅ [STL] ${slug}.glb: ${triangles} triangles, ${(glb.length / 1024).toFixed(1)} KB, ` +
      `${(dims.x * 1000).toFixed(1)} × ${(dims.y * 1000).toFixed(1)} × ${(dims.z * 1000).toFixed(1)} mm (${Date.now() - t0} ms)`
  );
  return meta;
}

/**
 * Converts a file of SOURCE_DIR (basename only: no path traversal). Looks for a
 * Thingiverse LICENSE.txt / README.txt next to it (or one level up) for the attribution.
 */
export async function convertSourceFile(relPath: string, opts: ConvertOptions = {}): Promise<ConvertedModel> {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, "");
  const full = path.resolve(SOURCE_DIR, normalized);
  if (!full.startsWith(SOURCE_DIR + path.sep) || !/\.stl$/i.test(full)) {
    throw new HttpError(400, "File must be an .stl inside assets/source-models/");
  }
  let stl: Buffer;
  try {
    stl = await fsp.readFile(full);
  } catch {
    throw new HttpError(404, `STL not found: ${normalized}`);
  }
  let attribution = opts.attribution ?? null;
  if (!attribution) {
    for (const dir of [path.dirname(full), path.dirname(path.dirname(full))]) {
      if (!dir.startsWith(SOURCE_DIR)) break;
      const lic = await fsp.readFile(path.join(dir, "LICENSE.txt"), "utf8").catch(() => null);
      if (!lic) continue;
      const readme = await fsp.readFile(path.join(dir, "README.txt"), "utf8").catch(() => "");
      attribution = parseThingiverseInfo(lic, readme);
      break;
    }
  }
  return convertStl(stl, path.basename(full), { ...opts, attribution });
}

/** Lists converted models (from their sidecar JSON). */
export async function listConverted(): Promise<ConvertedModel[]> {
  const files = await fsp.readdir(CONVERTED_DIR).catch(() => [] as string[]);
  const metas = await Promise.all(
    files.filter((f) => f.endsWith(".json")).map((f) => fsp.readFile(path.join(CONVERTED_DIR, f), "utf8").then((t) => JSON.parse(t) as ConvertedModel).catch(() => null))
  );
  return metas.filter((m): m is ConvertedModel => m !== null);
}

/** Metadata of one converted model, or null. */
export async function getConverted(slug: string): Promise<ConvertedModel | null> {
  if (!/^[a-z0-9_]{1,48}$/.test(slug)) return null;
  return fsp.readFile(path.join(CONVERTED_DIR, `${slug}.json`), "utf8").then((t) => JSON.parse(t) as ConvertedModel).catch(() => null);
}

const round = (n: number) => Math.round(n * 10000) / 10000;
