/**
 * TogetherAIService — Llama 3.3 70B client for the 3 Week-2 prompts.
 *
 * - OpenAI-compatible chat completions endpoint (native fetch, no axios).
 * - Every answer is extracted as JSON and validated with zod; on invalid
 *   output the model gets ONE corrective retry with the validation error.
 * - Token usage and an estimated cost are logged for each call.
 */
import { z } from "zod";
import {
  PROMPT_ASSET_SEARCH,
  PROMPT_INTERACTIONS,
  PROMPT_PEDAGOGICAL_FEEDBACK,
  PROMPT_PLACEMENT_AGENT,
  PROMPT_TP_PARSER,
  SYSTEM_JSON_ONLY,
  fillPrompt,
} from "../config/prompts";
import { zonesSummary } from "../config/workshopLayout";
import { stepText } from "./interactions";
import {
  AssetInput,
  AssetQueriesResult,
  AssetQueriesSchema,
  Domain,
  LLMInteractionsResult,
  LLMInteractionsResultSchema,
  LLMPlacementResult,
  LLMPlacementResultSchema,
  Material,
  PedagogicalFeedback,
  PedagogicalFeedbackSchema,
  Step,
  TPParseResult,
  TPParseSchema,
} from "../schemas/tp";
import { HttpError, errorMessage } from "../utils/http";

const API_URL = "https://api.together.xyz/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 2;
/** Attempts per HTTP call for transient errors (network, 429, 5xx). */
const HTTP_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 3000];

/** Above this size, TP text is truncated before being sent to the LLM. */
export const MAX_TP_CHARS = 40_000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  attempts: number;
}

export interface LLMResult<T> {
  data: T;
  usage: LLMUsage;
}

export class TogetherAIService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly priceInPerM: number;
  private readonly priceOutPerM: number;

  /**
   * Reads configuration from the environment.
   * @throws HttpError 503 if TOGETHER_API_KEY is missing
   */
  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = env.TOGETHER_API_KEY?.trim();
    if (!key || key.startsWith("your_")) {
      throw new HttpError(503, "TOGETHER_API_KEY is not set in backend/.env");
    }
    this.apiKey = key;
    this.model = env.LLM_MODEL?.trim() || DEFAULT_MODEL;
    this.temperature = parseNumber(env.LLM_TEMPERATURE, 0.2);
    this.priceInPerM = parseNumber(env.LLM_PRICE_INPUT_PER_M, 1.04);
    this.priceOutPerM = parseNumber(env.LLM_PRICE_OUTPUT_PER_M, 1.04);
    console.log(`✅ TogetherAIService initialized (model: ${this.model})`);
  }

  /**
   * PROMPT #1 — parses TP text into structured materials / steps / safety.
   */
  public async parseTP(tpText: string): Promise<LLMResult<TPParseResult>> {
    console.log(`📄 Parsing TP document (${tpText.length} chars)...`);
    const text = tpText.length > MAX_TP_CHARS ? tpText.slice(0, MAX_TP_CHARS) : tpText;
    if (text !== tpText) console.warn(`⚠️  TP text truncated to ${MAX_TP_CHARS} chars`);

    const result = await this.completeJSON(
      "parseTP",
      fillPrompt(PROMPT_TP_PARSER, { TP_TEXT: text }),
      TPParseSchema,
      { maxTokens: 4096 }
    );
    result.data.steps.sort((a, b) => a.order - b.order);
    // Verbatim copies may start mid-sentence ("poser la feuille…"): capitalize for display only.
    for (const s of result.data.steps) s.action = s.action.charAt(0).toUpperCase() + s.action.slice(1);
    console.log(
      `✅ Parsed TP: "${result.data.title}" (${result.data.domain}, ${result.data.materials.length} materials, ${result.data.steps.length} steps)`
    );
    return result;
  }

  /**
   * PROMPT #2 — generates 3 English Sketchfab queries per material.
   */
  public async generateAssetSearchQueries(
    materials: Material[],
    context: { domain: Domain; title: string } = { domain: "other", title: "" }
  ): Promise<LLMResult<AssetQueriesResult>> {
    console.log(`🔍 Generating Sketchfab search queries for ${materials.length} materials (${context.domain})...`);
    const result = await this.completeJSON(
      "assetQueries",
      fillPrompt(PROMPT_ASSET_SEARCH, {
        MATERIALS_JSON: JSON.stringify(materials, null, 2),
        TP_DOMAIN: context.domain,
        TP_TITLE: context.title || "(sans titre)",
      }),
      AssetQueriesSchema,
      { maxTokens: 1500 }
    );
    console.log(`✅ Generated queries for ${Object.keys(result.data.queries).length} materials`);
    return result;
  }

  /**
   * PROMPT #3 — asks the agent for a raw placement plan.
   * The result is relative and unchecked: always pass it through
   * services/placement.ts `resolvePlacement()` before use.
   */
  public async calculatePlacement(
    assets: AssetInput[],
    domain: Domain,
    steps: Step[],
    safetyWarnings: string[] = []
  ): Promise<LLMResult<LLMPlacementResult>> {
    console.log(`🤖 Placement agent: ${assets.length} assets, domain "${domain}"...`);
    const prompt = fillPrompt(PROMPT_PLACEMENT_AGENT, {
      WORKSHOP_ZONES: JSON.stringify(zonesSummary(), null, 2),
      ASSETS_LIST: JSON.stringify(assets, null, 2),
      DOMAIN: domain,
      TP_STEPS: JSON.stringify(steps, null, 2),
      TP_SAFETY: safetyWarnings.length ? JSON.stringify(safetyWarnings, null, 2) : "(none)",
    });
    const result = await this.completeJSON("placement", prompt, LLMPlacementResultSchema, {
      maxTokens: 3000,
      temperature: Math.max(this.temperature, 0.3),
    });
    console.log(`✅ Agent proposed ${result.data.placements.length} placements`);
    console.log(`   💭 ${result.data.reasoning}`);
    return result;
  }

  /**
   * Estimated cost in USD for a token count (prices configurable via .env).
   */
  public getEstimatedCost(inputTokens: number, outputTokens: number): number {
    return (inputTokens * this.priceInPerM + outputTokens * this.priceOutPerM) / 1_000_000;
  }

  /**
   * PROMPT #4 — pedagogical feedback from the structured facts of one session
   * (no personal data in `facts`). Validated against PedagogicalFeedbackSchema.
   */
  public async pedagogicalFeedback(facts: unknown): Promise<LLMResult<PedagogicalFeedback>> {
    return this.completeJSON(
      "pedagogicalFeedback",
      fillPrompt(PROMPT_PEDAGOGICAL_FEEDBACK, { FACTS: JSON.stringify(facts, null, 1) }),
      PedagogicalFeedbackSchema,
      { maxTokens: 900, temperature: 0.2 }
    );
  }

  /**
   * PROMPT #5 — proposes the checkable actions (place / approach / inspect) of each step.
   * The result is a proposal: always pass it through services/interactions.ts
   * `validateInteractions()`, which keeps only actions backed by the step text.
   */
  public async extractInteractions(
    steps: Step[],
    objects: { id: string; name: string }[]
  ): Promise<LLMResult<LLMInteractionsResult>> {
    console.log(`🧩 Interaction extractor: ${steps.length} steps, ${objects.length} objects...`);
    const result = await this.completeJSON(
      "interactions",
      fillPrompt(PROMPT_INTERACTIONS, {
        OBJECTS: JSON.stringify(objects, null, 2),
        // Instruction text only (verbatim from the document): it is what services/interactions.ts checks the quotes against.
        STEPS: JSON.stringify(steps.map((s) => ({ order: s.order, text: stepText(s) })), null, 2),
      }),
      LLMInteractionsResultSchema,
      { maxTokens: 3000, temperature: 0 }
    );
    const n = result.data.steps.reduce((k, s) => k + s.actions.length, 0);
    console.log(`✅ Interaction extractor proposed ${n} action(s)`);
    return result;
  }

  /**
   * Sends a prompt, extracts the JSON answer and validates it against `schema`.
   * Retries once with the validation error fed back to the model.
   */
  private async completeJSON<S extends z.ZodTypeAny>(
    task: string,
    prompt: string,
    schema: S,
    opts: { maxTokens: number; temperature?: number }
  ): Promise<LLMResult<z.output<S>>> {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_JSON_ONLY },
      { role: "user", content: prompt },
    ];
    let inputTokens = 0;
    let outputTokens = 0;
    let lastError = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const started = Date.now();
      const response = await this.chat(messages, opts.maxTokens, opts.temperature ?? this.temperature);
      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;
      const content = response.choices?.[0]?.message?.content ?? "";
      console.log(`   ⏱️  ${task} attempt ${attempt}: ${Date.now() - started} ms`);

      try {
        const data: z.output<S> = schema.parse(extractJSON(content));
        const usage: LLMUsage = {
          inputTokens,
          outputTokens,
          estimatedCostUSD: round6(this.getEstimatedCost(inputTokens, outputTokens)),
          attempts: attempt,
        };
        console.log(
          `   💰 ${task}: ${inputTokens} in / ${outputTokens} out tokens ≈ $${usage.estimatedCostUSD}`
        );
        return { data, usage };
      } catch (err) {
        lastError = err instanceof z.ZodError ? formatZodError(err) : errorMessage(err);
        console.warn(`⚠️  ${task} attempt ${attempt} invalid: ${lastError}`);
        messages.push(
          { role: "assistant", content },
          {
            role: "user",
            content: `Your previous answer was invalid: ${lastError}\nReturn the corrected, complete JSON object only.`,
          }
        );
      }
    }
    throw new HttpError(502, `LLM returned invalid JSON for ${task} after ${MAX_ATTEMPTS} attempts`, lastError);
  }

  /**
   * Low-level call to the Together chat completions endpoint.
   */
  /**
   * Low-level call to the Together chat completions endpoint.
   * Transient failures (network, 429 rate limit, 5xx) are retried with backoff
   * (1 s, 3 s, honoring Retry-After); auth / bad-request errors fail immediately.
   */
  private async chat(
    messages: ChatMessage[],
    maxTokens: number,
    temperature: number
  ): Promise<ChatCompletionResponse> {
    let lastError: HttpError | null = null;
    for (let attempt = 1; attempt <= HTTP_ATTEMPTS; attempt++) {
      let res: globalThis.Response;
      try {
        res = await fetch(API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        lastError = new HttpError(502, `Together AI unreachable: ${errorMessage(err)}`);
        await this.backoff(attempt, null, lastError.message);
        continue;
      }
      if (res.ok) return (await res.json()) as ChatCompletionResponse;
      const body = (await res.text()).slice(0, 500);
      const status = res.status === 401 || res.status === 403 ? 503 : 502;
      lastError = new HttpError(status, `Together AI error ${res.status}`, body);
      if (!isTransient(res.status)) throw lastError;
      await this.backoff(attempt, res.headers.get("retry-after"), `HTTP ${res.status}`);
    }
    throw lastError ?? new HttpError(502, "Together AI: no response");
  }

  /** Waits before the next attempt (no wait after the last one). */
  private async backoff(attempt: number, retryAfter: string | null, why: string): Promise<void> {
    if (attempt >= HTTP_ATTEMPTS) return;
    const header = Number(retryAfter);
    const ms = Number.isFinite(header) && header > 0 ? Math.min(header * 1000, 15_000) : BACKOFF_MS[attempt - 1];
    console.warn(`⚠️  Together AI ${why} → retry ${attempt + 1}/${HTTP_ATTEMPTS} in ${ms} ms`);
    await new Promise((r) => setTimeout(r, ms));
  }
}

/** Rate limits and server-side errors are worth retrying. */
function isTransient(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let instance: TogetherAIService | null = null;

/**
 * Lazily creates the shared service, so the server still starts (and the
 * workshop API still works) when no API key is configured.
 */
export function getLLM(): TogetherAIService {
  instance ??= new TogetherAIService();
  return instance;
}

/**
 * Extracts the first JSON object from an LLM answer
 * (tolerates ```json fences and text around the object).
 */
export function extractJSON(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found in answer");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Formats a zod error as "path: message; ..." (kept short for the retry prompt). */
function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Parses a numeric env var with a fallback. */
function parseNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(n) ? n : fallback;
}

/** Rounds to 6 decimals (micro-dollars). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export default TogetherAIService;
