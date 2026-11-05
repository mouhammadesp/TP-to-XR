/**
 * Sketchfab API.
 *
 *   GET  /api/sketchfab/search?q=motor&limit=5  → usable models (CC0/CC-BY, Quest-sized)
 *   GET  /api/sketchfab/cache                   → models already downloaded
 *   POST /api/sketchfab/download/:uid           → download a model into the cache (token required)
 */
import { Router } from "express";
import { getAssetManager } from "../services/assetManager";
import { getSketchfab } from "../services/sketchfab";
import { HttpError, asyncHandler } from "../utils/http";

const router = Router();

/**
 * GET /api/sketchfab/search?q=...&limit=...
 */
router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q || q.length > 100) throw new HttpError(400, "Query 'q' is required (max 100 chars)");
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 24);

    const results = await getSketchfab().searchModels(q, limit);
    res.json({ success: true, query: q, count: results.length, results });
  })
);

/**
 * GET /api/sketchfab/cache
 */
router.get(
  "/cache",
  asyncHandler(async (_req, res) => {
    const assets = await getAssetManager().listCached();
    res.json({ success: true, count: assets.length, assets });
  })
);

/**
 * POST /api/sketchfab/download/:uid
 * Fetches the model's public metadata (license/size check), then downloads it.
 */
router.post(
  "/download/:uid",
  asyncHandler(async (req, res) => {
    const model = await getSketchfab().getModel(req.params.uid);
    const asset = await getAssetManager().ensureModel(model);
    res.json({ success: true, asset });
  })
);

export default router;
