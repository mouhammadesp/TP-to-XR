/**
 * End-to-end pipeline API.
 *
 *   POST /api/pipeline[?domain=…]  JSON { tpText, domain? } or raw PDF (Content-Type: application/pdf)
 *                                   → 202 { jobId, statusUrl }
 *   domain (mechanical|electrical|chemical|biological|other), chosen by the teacher, overrides the LLM.
 *   GET  /api/pipeline/:id    → job progress, then { result: { manifest_url, viewer_url } }
 *
 *   GET  /api/tp              → saved TP scenes
 *   GET  /api/tp/:id          → scene manifest (loaded by viewer.html?tp=<id>)
 */
import { promises as fsp } from "fs";
import path from "path";
import express, { Router } from "express";
import { DomainSchema, ParseTPBodySchema } from "../schemas/tp";
import { getDemo } from "../services/demoTps";
import { getPreview } from "../services/previewTps";
import { PipelineInput, getJob, jobProgress, startPipeline } from "../services/pipeline";
import { assertTpId, listManifests, loadManifest } from "../services/tpStore";
import { HttpError, asyncHandler } from "../utils/http";

export const pipelineRouter = Router();
export const tpRouter = Router();

/**
 * POST /api/pipeline — starts a pipeline job.
 */
pipelineRouter.post(
  "/",
  express.raw({ type: "application/pdf", limit: "20mb" }),
  (req, res) => {
    const rawDomain = req.query.domain ?? (req.body as { domain?: unknown } | undefined)?.domain;
    let domain: PipelineInput["domain"];
    if (rawDomain !== undefined) {
      const d = DomainSchema.safeParse(rawDomain);
      if (!d.success) throw new HttpError(400, "domain must be one of mechanical, electrical, chemical, biological, other");
      domain = d.data;
    }

    let input: PipelineInput;
    if (Buffer.isBuffer(req.body)) {
      // Reject non-PDFs now (clear 400) instead of failing later inside the job.
      if (req.body.subarray(0, 5).toString("latin1") !== "%PDF-") {
        throw new HttpError(400, "Le fichier n'est pas un PDF valide (en-tête %PDF- absent)");
      }
      input = { kind: "pdf", data: req.body, domain };
    } else {
      const parsed = ParseTPBodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, "Send { tpText } as JSON, or the PDF itself with Content-Type: application/pdf");
      }
      input = { kind: "text", text: parsed.data.tpText, domain };
    }
    const job = startPipeline(input);
    res.status(202).json({ success: true, jobId: job.id, statusUrl: `/api/pipeline/${job.id}` });
  }
);

/**
 * PDF inbox — PDFs dropped by the teacher in backend/data/pdf-inbox/ on the PC.
 * The headset lists them and starts the pipeline without any file picker
 * (file pickers are unreliable / clumsy in VR browsers).
 *   GET  /api/pipeline/inbox                 → [{ name, size, modified }]
 *   POST /api/pipeline/inbox { file, domain? } → 202 { jobId, statusUrl }
 */
export const PDF_INBOX_DIR = path.resolve(__dirname, "..", "..", "data", "pdf-inbox");

pipelineRouter.get(
  "/inbox",
  asyncHandler(async (_req, res) => {
    await fsp.mkdir(PDF_INBOX_DIR, { recursive: true });
    const names = (await fsp.readdir(PDF_INBOX_DIR)).filter((n) => /\.pdf$/i.test(n));
    const files = await Promise.all(
      names.map(async (name) => {
        const st = await fsp.stat(path.join(PDF_INBOX_DIR, name));
        return { name, size: st.size, modified: st.mtime.toISOString() };
      })
    );
    files.sort((a, b) => b.modified.localeCompare(a.modified));
    res.json({ success: true, files });
  })
);

pipelineRouter.post(
  "/inbox",
  asyncHandler(async (req, res) => {
    const { file, domain: rawDomain } = (req.body ?? {}) as { file?: unknown; domain?: unknown };
    if (typeof file !== "string" || file !== path.basename(file) || !/\.pdf$/i.test(file)) {
      throw new HttpError(400, "file must be the name of a PDF in the inbox");
    }
    let domain: PipelineInput["domain"];
    if (rawDomain !== undefined && rawDomain !== null) {
      const d = DomainSchema.safeParse(rawDomain);
      if (!d.success) throw new HttpError(400, "invalid domain");
      domain = d.data;
    }
    let data: Buffer;
    try {
      data = await fsp.readFile(path.join(PDF_INBOX_DIR, file));
    } catch {
      throw new HttpError(404, `PDF introuvable dans le dossier : ${file}`);
    }
    if (data.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "Le fichier n'est pas un PDF valide");
    console.log(`📥 Inbox PDF: ${file} (${(data.length / 1024).toFixed(0)} KB)`);
    const job = startPipeline({ kind: "pdf", data, domain });
    res.status(202).json({ success: true, jobId: job.id, statusUrl: `/api/pipeline/${job.id}` });
  })
);

/**
 * GET /api/pipeline/:id — job progress / result.
 */
pipelineRouter.get("/:id", (req, res) => {
  assertTpId(req.params.id);
  const job = getJob(req.params.id);
  if (!job) throw new HttpError(404, `Job ${req.params.id} not found (finished jobs expire after 1 h; see /api/tp)`);
  res.json({ success: true, job: { ...job, ...jobProgress(job) } });
});

/**
 * GET /api/tp — saved TP scenes, most recent first.
 */
tpRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ success: true, tps: await listManifests() });
  })
);

/**
 * GET /api/tp/:id — scene manifest.
 */
tpRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(getDemo(req.params.id) ?? (await getPreview(req.params.id)) ?? (await loadManifest(req.params.id)));
  })
);
