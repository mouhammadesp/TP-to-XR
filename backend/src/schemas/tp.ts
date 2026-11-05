/**
 * Zod schemas for everything that crosses an untrusted boundary:
 * LLM outputs (prompts #1-#3) and API request bodies.
 *
 * LLM schemas are deliberately lenient on form (numbers given as strings,
 * missing optional arrays) and strict on substance (enums, required fields).
 */
import { z } from "zod";

export const DOMAINS = ["mechanical", "electrical", "chemical", "biological", "other"] as const;
export const DomainSchema = z.enum(DOMAINS);
export type Domain = z.infer<typeof DomainSchema>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #RRGGBB");

/* ------------------------------------------------------------------ */
/* PROMPT #1 — TP parser output                                        */
/* ------------------------------------------------------------------ */

export const MaterialSchema = z.object({
  name: z.string().min(1),
  quantity: z.coerce.number().positive().catch(1),
  unit: z.string().min(1).catch("pieces"),
});
export type Material = z.infer<typeof MaterialSchema>;

export const StepSchema = z.object({
  order: z.coerce.number().int().positive(),
  action: z.string().min(1),
  duration_sec: z.coerce.number().nonnegative().catch(60),
  key_points: z.array(z.string()).default([]),
  safety: z.string().nullish().transform((v) => (v && v.trim() ? v : null)),
});
export type Step = z.infer<typeof StepSchema>;

export const TPParseSchema = z.object({
  title: z.string().min(1),
  domain: DomainSchema,
  duration_minutes: z.coerce.number().nonnegative().catch(0),
  materials: z.array(MaterialSchema).default([]),
  tools: z.array(z.string()).default([]),
  steps: z.array(StepSchema).min(1),
  safety_warnings: z.array(z.string()).default([]),
});
export type TPParseResult = z.infer<typeof TPParseSchema>;

/* ------------------------------------------------------------------ */
/* PROMPT #2 — Sketchfab query generator output                        */
/* ------------------------------------------------------------------ */

export const AssetQueriesSchema = z.object({
  queries: z.record(z.array(z.string().min(1)).min(1)),
});
export type AssetQueriesResult = z.infer<typeof AssetQueriesSchema>;

/* ------------------------------------------------------------------ */
/* PROMPT #3 — Placement agent output (relative, validated server-side) */
/* ------------------------------------------------------------------ */

export const LLMPlacementSchema = z.object({
  asset_id: z.string().min(1),
  zone: z.string().min(1),
  slot: z.coerce.number().int().nonnegative().nullish(),
  offset: z
    .object({ x: z.coerce.number().catch(0), z: z.coerce.number().catch(0) })
    .default({ x: 0, z: 0 }),
  rotation_y: z.coerce.number().catch(0),
  target_size_m: z.coerce.number().positive().catch(0.3),
  color_override: HexColor.nullish().catch(null),
});
export type LLMPlacement = z.infer<typeof LLMPlacementSchema>;

export const ColorSchemeSchema = z.object({
  ambient: HexColor,
  key_light: HexColor,
  material_base: HexColor,
});
export type ColorScheme = z.infer<typeof ColorSchemeSchema>;

export const LLMPlacementResultSchema = z.object({
  placements: z.array(LLMPlacementSchema),
  color_scheme: ColorSchemeSchema,
  safety_warnings: z.array(z.string().min(1)).default([]),
  reasoning: z.string().default(""),
});
export type LLMPlacementResult = z.infer<typeof LLMPlacementResultSchema>;

/* ------------------------------------------------------------------ */
/* PROMPT #5 — interaction extractor output (checked by services/interactions.ts) */
/* ------------------------------------------------------------------ */

/** Generic actions the validation engine can check (palier P1). */
export const INTERACTION_TYPES = ["place", "approach", "inspect"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const LLMActionSchema = z.object({
  type: z.enum(INTERACTION_TYPES),
  /** Object id (as listed in the prompt). */
  object: z.string().min(1),
  /** place: "workbench" or the id of the object it goes on. */
  support: z.string().nullish().transform((v) => v ?? null),
  /** approach: id of the object to come close to. */
  target: z.string().nullish().transform((v) => v ?? null),
  /** Exact words of the step that ask for this action. */
  evidence: z.string().min(1),
});
export type LLMAction = z.infer<typeof LLMActionSchema>;

export const LLMStepInteractionsSchema = z.object({
  step: z.coerce.number().int().positive(),
  actions: z.array(LLMActionSchema).default([]),
  /** Parts of the step that are not one of the supported actions (measure, connect, write down…). */
  unsupported: z.array(z.object({ text: z.string().min(1), reason: z.string().default("") })).default([]),
});

export const LLMInteractionsResultSchema = z.object({
  steps: z.array(LLMStepInteractionsSchema).default([]),
});
export type LLMInteractionsResult = z.infer<typeof LLMInteractionsResultSchema>;

/* ------------------------------------------------------------------ */
/* API request bodies                                                  */
/* ------------------------------------------------------------------ */

export const ParseTPBodySchema = z.object({
  tpText: z.string().trim().min(20, "tpText must contain at least 20 characters"),
});

export const AssetQueriesBodySchema = z.object({
  materials: z.array(MaterialSchema.extend({ quantity: z.coerce.number().positive().default(1) })).min(1),
});

/** An asset to place (typically a Sketchfab model chosen for one material/tool). */
export const AssetInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  glb_url: z.string().optional(),
  /** Step where the asset is first used (helps the agent order the layout). */
  first_step: z.number().int().positive().optional(),
  /** Known real-world largest dimension in meters, if any. */
  approx_size_m: z.number().positive().optional(),
});
export type AssetInput = z.infer<typeof AssetInputSchema>;

export const PlacementBodySchema = z.object({
  assets: z.array(AssetInputSchema).min(1).max(20),
  domain: DomainSchema,
  steps: z.array(StepSchema).default([]),
  safety_warnings: z.array(z.string()).default([]),
});

/** PROMPT #4 output — pedagogical feedback (bounded lists, short items). */
const FeedbackItem = z.string().trim().min(1).max(260);
export const PedagogicalFeedbackSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  strengths: z.array(FeedbackItem).max(5).default([]),
  difficulties: z.array(FeedbackItem).max(5).default([]),
  advice: z.array(FeedbackItem).min(1).max(5),
});
export type PedagogicalFeedback = z.infer<typeof PedagogicalFeedbackSchema>;
