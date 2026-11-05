/**
 * STL → GLB conversion API.
 *
 *   GET  /api/convert/status
 *   GET  /api/convert/models                    → converted models (url, size, triangles, attribution)
 *   POST /api/convert/source   { file, unit?, up?, color? }
 *        file = path inside backend/assets/source-models/ (e.g. "thing_746258/files/StepperHolder_V2.STL")
 *   POST /api/convert/stl?name=part.stl&unit=mm&up=z&color=%230088FF[&title&author&license&source_url]
 *        raw STL body (application/octet-stream or model/stl)
 *
 * Every converted model can be tried in the workshop: /vr/?tp=tp_preview_<slug>
 */
import express, { Router } from "express";
import { z } from "zod";
import { ConvertOptions, convertSourceFile, convertStl, listConverted } from "../services/stlConverter";
import { HttpError, asyncHandler } from "../utils/http";

const router = Router();

const OptionsSchema = z.object({
  unit: z.enum(["mm", "cm", "m", "in"]).optional(),
  up: z.enum(["z", "y"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

/** Adds the preview link to a conversion result. */
const withPreview = <T extends { slug: string }>(m: T) => ({ ...m, preview_url: `/vr/?tp=tp_preview_${m.slug}` });

router.get("/status", (_req, res) => {
  res.json({ service: "STL → GLB converter", status: "ready", formats: ["stl (binary)", "stl (ascii)"] });
});

router.get(
  "/models",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, models: (await listConverted()).map(withPreview) });
  })
);

router.post(
  "/source",
  asyncHandler(async (req, res) => {
    const body = OptionsSchema.extend({ file: z.string().min(5).max(300) }).safeParse(req.body);
    if (!body.success) throw new HttpError(400, "Body: { file: \"<path in assets/source-models>.stl\", unit?, up?, color? }");
    const { file, ...opts } = body.data;
    res.json({ success: true, model: withPreview(await convertSourceFile(file, opts)) });
  })
);

router.post(
  "/stl",
  express.raw({ type: ["application/octet-stream", "model/stl", "application/sla"], limit: "50mb" }),
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(415, "Send the STL as the raw body (Content-Type: application/octet-stream)");
    }
    const q = req.query as Record<string, string | undefined>;
    const opts = OptionsSchema.safeParse({ unit: q.unit, up: q.up, color: q.color });
    if (!opts.success) throw new HttpError(400, "unit ∈ mm|cm|m|in, up ∈ z|y, color = #RRGGBB");
    const name = (q.name ?? "model.stl").slice(0, 100);
    const options: ConvertOptions = { ...opts.data };
    if (q.author && q.license) {
      options.attribution = { title: q.title ?? name, author: q.author, license: q.license, source_url: q.source_url ?? null };
    }
    res.json({ success: true, model: withPreview(await convertStl(req.body, name, options)) });
  })
);

export default router;
