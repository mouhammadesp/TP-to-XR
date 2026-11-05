/**
 * Week 2 — TP understanding API.
 *
 *   POST /api/parse/pdf            raw PDF body → extracted text (+ parsed TP with ?parse=true)
 *   POST /api/parse/tp             { tpText }               → PROMPT #1 parsed TP
 *   POST /api/parse/asset-queries  { materials }            → PROMPT #2 Sketchfab queries
 *   POST /api/parse/placement      { assets, domain, steps } → PROMPT #3 + server validation
 */
import express, { Router } from "express";
import { z } from "zod";
import {
  AssetQueriesBodySchema,
  ParseTPBodySchema,
  PlacementBodySchema,
} from "../schemas/tp";
import { extractPdfText } from "../services/pdf";
import { resolvePlacement } from "../services/placement";
import { MAX_TP_CHARS, getLLM } from "../services/togetherAi";
import { HttpError, asyncHandler } from "../utils/http";

const router = Router();

/**
 * Validates a request body against a zod schema.
 * @throws HttpError 400 with the list of invalid fields
 */
function validateBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(
      400,
      "Invalid request body",
      result.error.issues.map((i) => `${i.path.join(".") || "(body)"}: ${i.message}`)
    );
  }
  return result.data;
}

/**
 * POST /api/parse/pdf[?parse=true]
 * Body: the PDF file itself (Content-Type: application/pdf).
 */
router.post(
  "/pdf",
  express.raw({ type: "application/pdf", limit: "20mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      throw new HttpError(415, "Send the PDF as the raw body with Content-Type: application/pdf");
    }
    const pdf = await extractPdfText(req.body);
    const truncated = pdf.chars > MAX_TP_CHARS;

    if (req.query.parse !== "true") {
      res.json({ success: true, data: { ...pdf, truncatedForLLM: truncated } });
      return;
    }
    const parsed = await getLLM().parseTP(pdf.text);
    res.json({
      success: true,
      data: { pdf: { pages: pdf.pages, chars: pdf.chars, truncatedForLLM: truncated }, tp: parsed.data },
      usage: parsed.usage,
    });
  })
);

/**
 * POST /api/parse/tp
 * Body: { tpText: string } — already-extracted TP text.
 */
router.post(
  "/tp",
  asyncHandler(async (req, res) => {
    const { tpText } = validateBody(ParseTPBodySchema, req.body);
    const parsed = await getLLM().parseTP(tpText);
    res.json({ success: true, data: parsed.data, usage: parsed.usage });
  })
);

/**
 * POST /api/parse/asset-queries
 * Body: { materials: [{ name, quantity?, unit? }] }
 */
router.post(
  "/asset-queries",
  asyncHandler(async (req, res) => {
    const { materials } = validateBody(AssetQueriesBodySchema, req.body);
    const queries = await getLLM().generateAssetSearchQueries(materials);
    res.json({ success: true, data: queries.data, usage: queries.usage });
  })
);

/**
 * POST /api/parse/placement
 * Body: { assets: [{ id, name, glb_url?, first_step?, approx_size_m? }], domain, steps? }
 * Workshop zones are taken from the server layout (no need to send them).
 */
router.post(
  "/placement",
  asyncHandler(async (req, res) => {
    const { assets, domain, steps, safety_warnings } = validateBody(PlacementBodySchema, req.body);
    const ids = new Set(assets.map((a) => a.id));
    if (ids.size !== assets.length) throw new HttpError(400, "Asset ids must be unique");

    const proposal = await getLLM().calculatePlacement(assets, domain, steps, safety_warnings);
    const plan = resolvePlacement(proposal.data, assets);
    res.json({ success: true, data: plan, usage: proposal.usage });
  })
);

export default router;
