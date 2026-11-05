/**
 * End-to-end pipeline: TP (PDF or text) → parsed TP → checkable actions →
 * Sketchfab models → placement → scene manifest (+ generic simulation when
 * some steps ask for actions the engine can check: see services/interactions.ts).
 *
 * Runs as a background job (a full run takes ~30-90 s): POST returns a job id
 * immediately, GET /api/pipeline/:id reports progress step by step.
 * Jobs live in memory; finished manifests are persisted by tpStore.
 */
import { PlacementPlan, resolvePlacement } from "./placement";
import { CompiledInteractions, ValidatedInteractions, applyStartConstraints, buildSimulation, validateInteractions } from "./interactions";
import { extractPdfText } from "./pdf";
import { CachedAsset, getAssetManager } from "./assetManager";
import { SketchfabModel, getSketchfab } from "./sketchfab";
import { LLMUsage, getLLM } from "./togetherAi";
import { SceneAsset, TEMPLATE_REF, TPSceneManifest, newTpId, saveManifest } from "./tpStore";
import { AssetInput, Domain, Material, TPParseResult } from "../schemas/tp";
import { errorMessage } from "../utils/http";

/** Max objects per TP (workshop capacity is 5 + 3 + 3 + 3 = 14). */
const MAX_ASSETS = 12;
/** Parallel Sketchfab searches / downloads. */
const CONCURRENCY = 3;
/** Finished jobs are forgotten after this delay (the manifest stays on disk). */
const JOB_TTL_MS = 60 * 60 * 1000;

export type PipelineInput = ({ kind: "text"; text: string } | { kind: "pdf"; data: Buffer }) & {
  /** Domain chosen by the teacher in the menu; overrides the LLM's guess. */
  domain?: Domain;
};

export type StepName = "extract" | "parse" | "interactions" | "queries" | "search" | "download" | "placement" | "manifest";

export interface JobStep {
  name: StepName;
  status: "pending" | "running" | "done" | "skipped" | "error";
  ms?: number;
  detail?: string;
}

export interface PipelineJob {
  id: string;
  status: "running" | "done" | "error";
  created_at: string;
  steps: JobStep[];
  usage: { inputTokens: number; outputTokens: number; estimatedCostUSD: number };
  warnings: string[];
  error?: string;
  /** Set when done. */
  result?: {
    tp_id: string;
    title: string;
    domain: Domain;
    manifest_url: string;
    viewer_url: string;
    assets: number;
    models: number;
    /** Steps whose actions the validation engine checks (0 = non-interactive TP). */
    checked_steps: number;
  };
}

/** One physical item of the TP (material or tool) that needs a 3D object. */
interface Item {
  asset_id: string;
  name: string;
  first_step: number | null;
  model: SketchfabModel | null;
  query: string | null;
  cached: CachedAsset | null;
}

const jobs = new Map<string, PipelineJob>();

/**
 * Creates a job and starts the pipeline in the background.
 */
export function startPipeline(input: PipelineInput): PipelineJob {
  getLLM(); // fail fast with 503 (before creating a job) if no Together key
  const id = newTpId();
  const job: PipelineJob = {
    id,
    status: "running",
    created_at: new Date().toISOString(),
    steps: (["extract", "parse", "interactions", "queries", "search", "download", "placement", "manifest"] as StepName[]).map(
      (name) => ({ name, status: "pending" })
    ),
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 },
    warnings: [],
  };
  jobs.set(id, job);
  console.log(`🚀 Pipeline ${id} started (${input.kind})`);

  runPipeline(job, input)
    .then(() => {
      job.status = "done";
      console.log(`🎉 Pipeline ${id} done: ${job.result?.models}/${job.result?.assets} real models`);
    })
    .catch((err: unknown) => {
      job.status = "error";
      job.error = errorMessage(err);
      const running = job.steps.find((s) => s.status === "running");
      if (running) running.status = "error";
      console.error(`❌ Pipeline ${id} failed: ${job.error}`);
    })
    .finally(() => setTimeout(() => jobs.delete(id), JOB_TTL_MS).unref());

  return job;
}

/** Returns a job by id, or undefined. */
export function getJob(id: string): PipelineJob | undefined {
  return jobs.get(id);
}

/**
 * Progress view of a job: the running step and a 0-100 percentage
 * (finished/skipped steps count fully, the running one counts half).
 */
export function jobProgress(job: PipelineJob): { current_step: StepName | null; progress: number } {
  const finished = job.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const running = job.steps.find((s) => s.status === "running");
  const progress = job.status === "done" ? 100 : Math.round(((finished + (running ? 0.5 : 0)) / job.steps.length) * 100);
  return { current_step: running?.name ?? null, progress };
}

/**
 * The pipeline itself. Each step updates the job so clients can follow progress.
 */
async function runPipeline(job: PipelineJob, input: PipelineInput): Promise<void> {
  const llm = getLLM();
  const sketchfab = getSketchfab();
  const assets = getAssetManager();

  // 1. Text extraction
  const text = await step(job, "extract", async () => {
    if (input.kind === "text") return { value: input.text, detail: "texte fourni" };
    const pdf = await extractPdfText(input.data);
    return { value: pdf.text, detail: `${pdf.pages} pages, ${pdf.chars} caractères` };
  });

  // 2. TP parsing (PROMPT #1)
  const tp = await step(job, "parse", async () => {
    const r = await llm.parseTP(text);
    addUsage(job, r.usage);
    const d = resolveDomain(r.data.domain, input.domain);
    r.data.domain = d.domain;
    if (d.warning) job.warnings.push(d.warning);
    return { value: r.data, detail: `"${r.data.title}" (${r.data.domain})` };
  });

  const items = buildItems(tp, job);

  // 3. Checkable actions (PROMPT #5 proposes, services/interactions.ts keeps only what the text supports)
  const interactions = await step(job, "interactions", async () => {
    const objects = items.map((i) => ({ asset_id: i.asset_id, name: i.name }));
    let checked: ValidatedInteractions;
    try {
      const r = await llm.extractInteractions(tp.steps, objects.map((o) => ({ id: o.asset_id, name: o.name })));
      addUsage(job, r.usage);
      checked = validateInteractions(tp.steps, objects, r.data);
    } catch (err) {
      checked = validateInteractions(tp.steps, objects, { steps: [] });
      checked.issues.unshift(`Analyse des manipulations indisponible (${errorMessage(err)}) : aucune étape vérifiable`);
    }
    const nSteps = new Set(checked.actions.map((a) => a.step)).size;
    return { value: checked, detail: `${checked.actions.length} action(s) vérifiable(s) sur ${nSteps} étape(s), ${checked.issues.length} signalement(s)` };
  });

  // 4. Search queries (PROMPT #2)
  const queries = await step(job, "queries", async () => {
    const materials: Material[] = items.map((i) => ({ name: i.name, quantity: 1, unit: "pieces" }));
    // The TP's domain and title steer the queries toward lab objects of that field.
    const r = await llm.generateAssetSearchQueries(materials, { domain: tp.domain, title: tp.title });
    addUsage(job, r.usage);
    return { value: matchQueries(items, r.data.queries), detail: `${items.length} objets` };
  });

  // 5. Sketchfab search
  await step(job, "search", async () => {
    await mapLimit(items, CONCURRENCY, async (item) => {
      const found = await sketchfab.findModel(queries.get(item.asset_id) ?? [item.name]);
      if (found) {
        item.model = found.model;
        item.query = found.query;
      } else {
        job.warnings.push(`Aucun modèle 3D adapté pour « ${item.name} » → boîte provisoire`);
      }
    });
    const found = items.filter((i) => i.model).length;
    return { value: undefined, detail: `${found}/${items.length} modèles trouvés` };
  });

  // 6. Downloads (only with a Sketchfab token)
  await step(job, "download", async () => {
    if (!sketchfab.canDownload) {
      job.warnings.push("Clé Sketchfab absente → modèles non téléchargés, boîtes provisoires");
      return { value: undefined, detail: "pas de clé Sketchfab → objets provisoires", skipped: true };
    }
    await mapLimit(items, CONCURRENCY, async (item) => {
      if (!item.model) return;
      try {
        item.cached = await assets.ensureModel(item.model);
      } catch (err) {
        job.warnings.push(`Téléchargement impossible pour « ${item.name} » (${item.model.uid}) : ${errorMessage(err)}`);
      }
    });
    return { value: undefined, detail: `${items.filter((i) => i.cached).length} modèles prêts` };
  });

  // 7. Placement (PROMPT #3 + server-side resolution; objects to install on the bench start on a shelf)
  const plan = await step(job, "placement", async () => {
    const inputs: AssetInput[] = items.map((i) => ({
      id: i.asset_id,
      name: i.name,
      ...(i.first_step ? { first_step: i.first_step } : {}),
    }));
    const r = await llm.calculatePlacement(inputs, tp.domain, tp.steps, tp.safety_warnings);
    addUsage(job, r.usage);
    const resolved = resolvePlacement(applyStartConstraints(r.data, interactions.actions), inputs, tp.steps.map((s) => s.action));
    job.warnings.push(...resolved.warnings);
    return { value: resolved, detail: `${resolved.placements.length} placés, ${resolved.unplaced.length} non placés` };
  });

  // 8. Manifest (+ the generic simulation compiled for this scene)
  await step(job, "manifest", async () => {
    const compiled = buildSimulation(tp.steps, items, interactions, plan.placements);
    job.warnings.push(...compiled.report.issues.map((i) => `Interactions — ${i}`));
    const manifest = buildManifest(job.id, tp, items, plan, job.warnings, compiled);
    await saveManifest(manifest);
    const models = manifest.assets.filter((a) => a.source === "sketchfab").length;
    job.result = {
      tp_id: job.id,
      title: tp.title,
      domain: tp.domain,
      manifest_url: `/api/tp/${job.id}`,
      viewer_url: `/vr/?tp=${job.id}`,
      assets: manifest.assets.length,
      models,
      checked_steps: compiled.report.steps.filter((s) => s.coverage !== "none").length,
    };
    return { value: undefined, detail: `${manifest.assets.length} objets (${models} modèles 3D), ${job.result.checked_steps}/${tp.steps.length} étapes vérifiables` };
  });
}

/**
 * Runs one step, recording status, duration and a short detail.
 */
async function step<T>(
  job: PipelineJob,
  name: StepName,
  fn: () => Promise<{ value: T; detail?: string; skipped?: boolean }>
): Promise<T> {
  const s = job.steps.find((x) => x.name === name) as JobStep;
  s.status = "running";
  const started = Date.now();
  console.log(`▶️  [${job.id}] ${name}...`);
  const { value, detail, skipped } = await fn();
  s.status = skipped ? "skipped" : "done";
  s.ms = Date.now() - started;
  s.detail = detail;
  console.log(`✔️  [${job.id}] ${name} (${s.ms} ms) ${detail ?? ""}`);
  return value;
}

/**
 * Materials + tools → unique physical items (max MAX_ASSETS), with the first
 * step that mentions them.
 */
function buildItems(tp: TPParseResult, job: PipelineJob): Item[] {
  const names = [...tp.materials.map((m) => m.name), ...tp.tools];
  const seen = new Set<string>();
  const unique = names.filter((n) => {
    const key = n.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length > MAX_ASSETS) {
    job.warnings.push(`${unique.length} objets dans le TP : seuls les ${MAX_ASSETS} premiers sont représentés`);
  }
  return unique.slice(0, MAX_ASSETS).map((name, i) => ({
    asset_id: `a${String(i + 1).padStart(2, "0")}_${slugify(name)}`,
    name,
    first_step: firstStepMentioning(tp, name),
    model: null,
    query: null,
    cached: null,
  }));
}

/** Order of the first step whose text mentions the item (by its longest word), or null. */
function firstStepMentioning(tp: TPParseResult, name: string): number | null {
  const words = fold(name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (words.length === 0) return null;
  for (const s of tp.steps) {
    const text = fold(`${s.action} ${s.key_points.join(" ")}`);
    if (words.some((w) => text.includes(w))) return s.order;
  }
  return null;
}

/**
 * Maps the LLM's query lists back to items. Keys may differ slightly from the
 * names sent (case, accents), so matching is accent/case-insensitive.
 */
/**
 * The document decides the TP's domain. The domain chosen in the menu is only a hint,
 * applied when the document's own domain cannot be determined ("other").
 */
export function resolveDomain(fromDocument: Domain, chosen: Domain | undefined): { domain: Domain; warning: string | null } {
  if (!chosen || chosen === fromDocument) return { domain: fromDocument, warning: null };
  if (fromDocument === "other") {
    return { domain: chosen, warning: `Domaine non identifiable dans le document : domaine choisi (${DOMAIN_FR[chosen]}) appliqué` };
  }
  return {
    domain: fromDocument,
    warning: `Ce document est un TP de ${DOMAIN_FR[fromDocument]} : le domaine choisi dans le menu (${DOMAIN_FR[chosen]}) n'est pas appliqué`,
  };
}

/** Domain names shown to the teacher in the job warnings. */
const DOMAIN_FR: Record<Domain, string> = {
  mechanical: "mécanique",
  electrical: "électricité",
  chemical: "chimie",
  biological: "biologie",
  other: "autre domaine",
};

function matchQueries(items: Item[], queries: Record<string, string[]>): Map<string, string[]> {
  const byKey = new Map(Object.entries(queries).map(([k, v]) => [fold(k).trim(), v]));
  return new Map(
    items.map((i) => {
      const q = byKey.get(fold(i.name).trim()) ?? [];
      return [i.asset_id, q.length > 0 ? q : [i.name]];
    })
  );
}

/**
 * Merges items, cached models and resolved placement into the manifest.
 */
function buildManifest(
  id: string,
  tp: TPParseResult,
  items: Item[],
  plan: PlacementPlan,
  warnings: string[],
  compiled: CompiledInteractions
): TPSceneManifest {
  const byId = new Map(items.map((i) => [i.asset_id, i]));
  const assets: SceneAsset[] = plan.placements.map((p) => {
    const item = byId.get(p.asset_id) as Item;
    const m = item.cached?.model;
    return {
      asset_id: p.asset_id,
      name: item.name,
      source: item.cached ? "sketchfab" : "placeholder",
      url: item.cached?.url ?? null,
      attribution: m
        ? {
            title: m.name,
            author: m.author,
            author_url: m.author_url,
            license: m.license.label,
            license_url: m.license.url,
            source_url: m.viewer_url,
          }
        : null,
      zone: p.zone,
      slot: p.slot,
      position: p.position,
      rotation_y: p.rotation_y,
      target_size_m: p.target_size_m,
      size_source: p.size_source,
      size_note: p.size_note,
      color_override: p.color_override,
      first_step: item.first_step,
    };
  });

  return {
    id,
    created_at: new Date().toISOString(),
    template: TEMPLATE_REF,
    tp: {
      title: tp.title,
      domain: tp.domain,
      duration_minutes: tp.duration_minutes,
      steps: tp.steps.map((s) => ({ order: s.order, action: s.action, safety: s.safety })),
      safety_warnings: tp.safety_warnings,
    },
    color_scheme: plan.color_scheme,
    assets,
    safety_signs: plan.safety_signs,
    unplaced: plan.unplaced.map((u) => ({ ...u, name: byId.get(u.asset_id)?.name ?? u.asset_id })),
    warnings: [...new Set(warnings)],
    reasoning: plan.reasoning,
    ...(compiled.simulation ? { simulation: compiled.simulation } : {}),
    interactions: compiled.report,
  };
}

/** Adds one LLM call's usage to the job totals. */
function addUsage(job: PipelineJob, usage: LLMUsage): void {
  job.usage.inputTokens += usage.inputTokens;
  job.usage.outputTokens += usage.outputTokens;
  job.usage.estimatedCostUSD = Math.round((job.usage.estimatedCostUSD + usage.estimatedCostUSD) * 1e6) / 1e6;
}

/** Runs `fn` over `items` with at most `limit` concurrent calls. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

/** Lowercase + strip accents ("Clé à molette" → "cle a molette"). */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Short ASCII slug for asset ids. */
function slugify(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "item";
}
