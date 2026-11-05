/**
 * TP scene manifests — the output of the pipeline, persisted as JSON files.
 *
 * A manifest does NOT contain 3D data: the browser loads the shared workshop
 * template once, then the per-TP models listed here, and applies the
 * placement itself (real WebGL engine → textures, text rendering, bounding boxes).
 *
 *   backend/data/tps/<id>.json   (served at GET /api/tp/:id)
 */
import { promises as fsp } from "fs";
import path from "path";
import { Vec3, ZONES } from "../config/workshopLayout";
import { SizeSource, resolveRealSize } from "../config/realSizes";
import { ColorScheme, Domain } from "../schemas/tp";
import { SafetySignContent } from "./placement";
import { TEMPLATE_VERSION } from "./workshop";
import { HttpError } from "../utils/http";

export const TP_DATA_DIR = path.resolve(__dirname, "..", "..", "data", "tps");
const ID_RE = /^tp_[a-z0-9_-]{1,64}$/;

/** Credit line required by CC-BY (also kept for CC0, as good practice). */
export interface Attribution {
  title: string;
  author: string;
  author_url: string | null;
  license: string;
  license_url: string;
  source_url: string;
}

export interface SceneAsset {
  asset_id: string;
  /** Material/tool name as written in the TP. */
  name: string;
  /**
   * "sketchfab" = real model at `url`; "placeholder" = labeled box drawn by the viewer;
   * "builtin" = procedural model of the viewer's library (`builtin_model`), real-world size;
   * "converted" = GLB produced by the STL converter (at `url`).
   */
  source: "sketchfab" | "placeholder" | "builtin" | "converted";
  builtin_model?: string;
  /** Not grabbable (e.g. motor bench). */
  fixed?: boolean;
  /** Reacts to a click / trigger (e.g. switch, isolator). */
  clickable?: boolean;
  url: string | null;
  attribution: Attribution | null;
  zone: string;
  slot: number | null;
  /** Absolute base-center position (object sits on this point). */
  position: Vec3;
  rotation_y: number;
  target_size_m: number;
  /** Origin of target_size_m (absent in TPs generated before the real-size rules). */
  size_source?: SizeSource;
  size_note?: string;
  color_override: string | null;
  first_step: number | null;
}

export interface TPSceneManifest {
  id: string;
  created_at: string;
  template: { version: string; url: string };
  tp: {
    title: string;
    domain: Domain;
    duration_minutes: number;
    steps: { order: number; action: string; safety: string | null }[];
    safety_warnings: string[];
  };
  color_scheme: ColorScheme;
  assets: SceneAsset[];
  safety_signs: SafetySignContent[];
  unplaced: { asset_id: string; name: string; reason: string }[];
  warnings: string[];
  reasoning: string;
  /** Interactive TP: drop targets, per-step validation rules, simulated behavior (demos: authored; generated TPs: kind "generic"). */
  simulation?: SimulationSpec;
  /** Generated TPs: what the interaction extractor could (not) turn into checkable actions, step by step. */
  interactions?: InteractionReport;
}

/** A place where an object can be put down (snaps) or a point a tool must be brought to. */
export interface SimTarget {
  id: string;
  label: string;
  /** Base point (snapped objects sit exactly here). */
  position: Vec3;
  /** Horizontal capture radius (m). */
  radius: number;
  /** Asset ids that snap onto this target (empty = "near" point only). */
  accepts: string[];
  rotation_y?: number;
  /** Visual hint shown while the current step needs it. */
  marker?: "disc" | "ring_z" | "none";
  /**
   * The target follows another object of the scene (generated TPs): "top" = on top of it
   * (place X on Y), "base" = at its base center (bring X close to Y). `position` is then
   * only the initial estimate; the viewer recomputes it from the loaded model.
   */
  anchor?: { asset: string; mode: "top" | "base" };
}

export type SimCondition =
  | { type: "placed"; asset: string; target: string; label: string }
  | { type: "held"; asset: string; seconds: number; label: string }
  | { type: "near"; asset: string; target: string; distance: number; label: string }
  | { type: "state"; key: string; label: string };

export interface SimulationSpec {
  /**
   * Behavior module of the viewer: electrical circuit, belt drive, engine-bay identification
   * quiz, or none ("generic": conditions only).
   */
  kind: "circuit" | "belt_drive" | "engine_quiz" | "generic";
  targets: SimTarget[];
  /** One list of conditions per step (all must hold to validate the step). */
  rules: SimCondition[][];
  /** Text shown once the last step is validated. */
  completion: string;
}

/**
 * How much of each step the engine checks:
 *   full    — every action of the step is checked;
 *   partial — some actions are checked, others (listed in `unverified`) are not;
 *   none    — nothing checkable: the step can only be "terminée (non vérifiée)".
 */
export type StepCoverage = "full" | "partial" | "none";

export interface StepVerification {
  /** Step order (1-based). */
  step: number;
  coverage: StepCoverage;
  /** Labels of the checked actions (= conditions of the rule). */
  verified: string[];
  /** Parts of the step that are not checked, with the reason. */
  unverified: string[];
}

export interface InteractionReport {
  steps: StepVerification[];
  /** Ambiguities and rejected proposals, for the teacher (never shown as student errors). */
  issues: string[];
}

/** Generates a new TP id, e.g. "tp_20261012_ab12cd". */
export function newTpId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `tp_${date}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Validates an id coming from a URL (prevents path traversal). */
export function assertTpId(id: string): void {
  if (!ID_RE.test(id)) throw new HttpError(400, `Invalid TP id: ${id}`);
}

/**
 * Writes a manifest to disk (atomic: temp file + rename).
 */
export async function saveManifest(manifest: TPSceneManifest): Promise<void> {
  assertTpId(manifest.id);
  await fsp.mkdir(TP_DATA_DIR, { recursive: true });
  const file = path.join(TP_DATA_DIR, `${manifest.id}.json`);
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(manifest, null, 2));
  await fsp.rename(`${file}.tmp`, file);
  console.log(`💾 Saved scene manifest ${manifest.id}`);
}

/**
 * Loads a manifest.
 * @throws HttpError 404 if it does not exist
 */
export async function loadManifest(id: string): Promise<TPSceneManifest> {
  assertTpId(id);
  try {
    return applyRealSizes(relocateShelfAssets(JSON.parse(await fsp.readFile(path.join(TP_DATA_DIR, `${id}.json`), "utf8")) as TPSceneManifest));
  } catch {
    throw new HttpError(404, `TP ${id} not found`);
  }
}

/**
 * TPs generated before the real-size rules: their sizes (AI estimates) are
 * re-resolved from the object names and step texts (TP text / standards / typical
 * ranges — see config/realSizes.ts). Built-in models are authored at real size.
 */
function applyRealSizes(manifest: TPSceneManifest): TPSceneManifest {
  const texts = manifest.tp.steps.map((s) => s.action);
  for (const a of manifest.assets) {
    if (a.size_source || a.source === "builtin") continue;
    const real = resolveRealSize(a.name, a.target_size_m, texts);
    a.target_size_m = a.zone.startsWith("zone_shelf") ? Math.min(real.size_m, 0.6) : real.size_m;
    a.size_source = real.source;
    a.size_note = real.note;
  }
  return manifest;
}

/**
 * Objects stored on a shelf slot are re-anchored to that slot in the CURRENT room
 * layout (positions are saved absolute; the shelves may have moved since the TP
 * was generated). Same rule as the placement: base center on the slot's board.
 */
function relocateShelfAssets(manifest: TPSceneManifest): TPSceneManifest {
  for (const a of manifest.assets) {
    const slot = ZONES.find((z) => z.id === a.zone)?.slots?.find((s) => s.slot === a.slot);
    if (!slot) continue;
    a.position = {
      x: slot.position.x,
      y: Math.round((slot.position.y - slot.size.height / 2) * 1000) / 1000,
      z: slot.position.z,
    };
  }
  return manifest;
}

/**
 * Lists saved TPs (most recent first) with a short summary.
 */
export async function listManifests(): Promise<
  { id: string; title: string; domain: Domain; assets: number; created_at: string }[]
> {
  let files: string[];
  try {
    files = await fsp.readdir(TP_DATA_DIR);
  } catch {
    return [];
  }
  const ids = files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => ID_RE.test(id));
  const manifests = await Promise.all(ids.map((id) => loadManifest(id).catch(() => null)));
  return manifests
    .filter((m): m is TPSceneManifest => m !== null)
    .map((m) => ({ id: m.id, title: m.tp.title, domain: m.tp.domain, assets: m.assets.length, created_at: m.created_at }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Template reference embedded in every manifest. */
export const TEMPLATE_REF = { version: TEMPLATE_VERSION, url: "/api/workshop/scene.babylon" };
