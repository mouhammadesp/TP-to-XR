/**
 * Scene manifest (GET /api/tp/:id) — fetch, validate, link assets to steps.
 *
 * Validation is per asset: one invalid asset (bad URL, missing field) is
 * logged and skipped instead of breaking the whole TP.
 */
import { z } from "zod";

const Vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const HexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Only our own model cache or HTTPS URLs may be loaded. */
const ModelUrlSchema = z
  .string()
  .refine(
    (u) =>
      /^\/assets\/models\/[a-f0-9]{32}\/[^?#]+$/.test(u) ||
      /^\/assets\/models\/converted\/[a-z0-9_]{1,48}\.glb$/.test(u) ||
      /^https:\/\/[^\s]+$/.test(u),
    { message: "model url must be /assets/models/<uid>/<file>, /assets/models/converted/<slug>.glb or https://…" }
  );

export const AttributionSchema = z.object({
  title: z.string(),
  author: z.string(),
  author_url: z.string().nullable(),
  license: z.string(),
  license_url: z.string(),
  source_url: z.string(),
});
export type Attribution = z.infer<typeof AttributionSchema>;

export const SceneAssetSchema = z.object({
  asset_id: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(["sketchfab", "placeholder", "builtin", "converted"]),
  builtin_model: z.string().max(40).optional(),
  fixed: z.boolean().optional(),
  clickable: z.boolean().optional(),
  url: ModelUrlSchema.nullable(),
  attribution: AttributionSchema.nullable(),
  zone: z.string(),
  slot: z.number().int().nullable(),
  position: Vec3Schema,
  rotation_y: z.number(),
  target_size_m: z.number().positive().max(5),
  /** Origin of the size: TP text, standard, typical range or AI estimate (backend config/realSizes.ts). */
  size_source: z.enum(["tp_text", "standard", "typical_range", "estimate"]).optional(),
  size_note: z.string().max(300).optional(),
  color_override: HexSchema.nullable(),
  first_step: z.number().int().positive().nullable(),
});
export type SceneAsset = z.infer<typeof SceneAssetSchema>;

export const StepSchema = z.object({
  order: z.number().int(),
  action: z.string(),
  safety: z.string().nullable(),
});
export type Step = z.infer<typeof StepSchema>;

const TargetSchema = z.object({
  id: z.string(),
  label: z.string(),
  position: Vec3Schema,
  radius: z.number().positive().max(2),
  accepts: z.array(z.string()),
  rotation_y: z.number().optional(),
  marker: z.enum(["disc", "ring_z", "none"]).optional(),
  /** Generated TPs: the target follows this object (top = on it, base = next to it). */
  anchor: z.object({ asset: z.string(), mode: z.enum(["top", "base"]) }).optional(),
});

const ConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("placed"), asset: z.string(), target: z.string(), label: z.string() }),
  z.object({ type: z.literal("held"), asset: z.string(), seconds: z.number().positive(), label: z.string() }),
  z.object({ type: z.literal("near"), asset: z.string(), target: z.string(), distance: z.number().positive(), label: z.string() }),
  z.object({ type: z.literal("state"), key: z.string(), label: z.string() }),
]);

/** Interactive TP description (demo TPs: authored behaviors; generated TPs: "generic" = conditions only). */
export const SimulationSchema = z.object({
  kind: z.enum(["circuit", "belt_drive", "engine_quiz", "generic"]),
  targets: z.array(TargetSchema),
  rules: z.array(z.array(ConditionSchema)),
  completion: z.string(),
});

const ManifestEnvelopeSchema = z.object({
  id: z.string().regex(/^tp_[a-z0-9_-]{1,64}$/),
  created_at: z.string(),
  template: z.object({ version: z.string(), url: z.string().startsWith("/") }),
  tp: z.object({
    title: z.string(),
    domain: z.string(),
    duration_minutes: z.number(),
    steps: z.array(StepSchema).min(1),
    safety_warnings: z.array(z.string()),
  }),
  color_scheme: z.object({ ambient: HexSchema, key_light: HexSchema, material_base: HexSchema }),
  assets: z.array(z.unknown()),
  safety_signs: z.array(z.object({ sign: z.string(), text: z.string(), position: Vec3Schema })),
  unplaced: z.array(z.object({ asset_id: z.string(), name: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
  reasoning: z.string(),
  simulation: SimulationSchema.optional(),
  /** Generated TPs: what each step's validation checks, and what it does not. */
  interactions: z
    .object({
      steps: z.array(
        z.object({
          step: z.number().int(),
          coverage: z.enum(["full", "partial", "none"]),
          verified: z.array(z.string()),
          unverified: z.array(z.string()),
        })
      ),
      issues: z.array(z.string()),
    })
    .optional(),
});

export type Manifest = Omit<z.infer<typeof ManifestEnvelopeSchema>, "assets"> & { assets: SceneAsset[] };

export interface ManifestResult {
  manifest: Manifest;
  /** Human-readable problems found while validating (assets skipped). */
  errors: string[];
}

/**
 * Validates raw JSON as a manifest. Throws if the envelope itself is invalid;
 * invalid assets are skipped and reported in `errors`.
 */
export function parseManifest(raw: unknown): ManifestResult {
  const env = ManifestEnvelopeSchema.safeParse(raw);
  if (!env.success) {
    throw new Error("Invalid manifest: " + env.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const errors: string[] = [];
  const assets: SceneAsset[] = [];
  env.data.assets.forEach((a, i) => {
    const r = SceneAssetSchema.safeParse(a);
    if (r.success) assets.push(r.data);
    else {
      const id = (a as { asset_id?: unknown })?.asset_id ?? `#${i}`;
      errors.push(`asset ${String(id)} skipped: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
    }
  });
  const steps = [...env.data.tp.steps].sort((a, b) => a.order - b.order);
  return { manifest: { ...env.data, tp: { ...env.data.tp, steps }, assets }, errors };
}

/**
 * Fetches and validates a manifest from the backend.
 */
export async function fetchManifest(tpId: string): Promise<ManifestResult> {
  const res = await fetch(`/api/tp/${encodeURIComponent(tpId)}`);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new Error(`TP ${tpId}: ${msg}`);
  }
  return parseManifest(body);
}

/** Lowercase + strip accents. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * For each step (by index), the asset ids the step is about: assets whose
 * name (any word ≥ 4 letters) appears in the step text, plus each asset's
 * `first_step`. Used to score whether the student handles the right objects.
 */
export function linkAssetsToSteps(steps: Step[], assets: SceneAsset[]): Set<string>[] {
  return steps.map((step) => {
    const text = fold(`${step.action} ${step.safety ?? ""}`);
    const ids = new Set<string>();
    for (const a of assets) {
      const words = fold(a.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
      if (a.first_step === step.order || words.some((w) => text.includes(w))) ids.add(a.asset_id);
    }
    return ids;
  });
}
