/**
 * Individual performance report.
 *
 *   GET /api/report/:tpId/:sessionId          → { success, report }   (with AI feedback)
 *   GET /api/report/:tpId/:sessionId?ai=0     → deterministic report only
 *
 * The AI feedback is cached next to the session (…/<session_id>.feedback.json) and
 * recomputed only if the session was uploaded again since. Logs never contain the
 * student's name.
 */
import { promises as fsp } from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { ANALYTICS_DIR, SessionRecord, SessionSchema } from "./analytics";
import { getDemo } from "../services/demoTps";
import { getPreview } from "../services/previewTps";
import { AiPart, ReportManifest, aiFacts, buildReport, checkAiFeedback } from "../services/report";
import { getLLM } from "../services/togetherAi";
import { assertTpId, loadManifest } from "../services/tpStore";
import { HttpError, asyncHandler, errorMessage } from "../utils/http";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** The AI has 30 s; the deterministic report never waits longer. */
const AI_TIMEOUT_MS = 30_000;

const router = Router();

router.get(
  "/:tpId/:sessionId",
  asyncHandler(async (req, res) => {
    assertTpId(req.params.tpId);
    const sessionId = Id.safeParse(req.params.sessionId);
    if (!sessionId.success) throw new HttpError(400, "Invalid session id");
    const dir = path.join(ANALYTICS_DIR, req.params.tpId);
    const file = path.join(dir, `${sessionId.data}.json`);

    let session: SessionRecord;
    try {
      const raw = JSON.parse(await fsp.readFile(file, "utf8")) as Record<string, unknown>;
      session = { ...SessionSchema.parse(raw), received_at: String(raw.received_at ?? "") };
    } catch {
      throw new HttpError(404, "Session not found");
    }
    const id = req.params.tpId;
    const manifest = (getDemo(id) ?? (await getPreview(id)) ?? (await loadManifest(id))) as unknown as ReportManifest;

    const report = buildReport(session, manifest);
    if (req.query.ai !== "0") report.ai = await aiPart(report, session, path.join(dir, `${sessionId.data}.feedback.json`));
    console.log(`📝 Rapport ${id}/${session.session_id} (${session.student_id}) — IA : ${report.ai.status}`);
    res.json({ success: true, report });
  })
);

/** AI feedback for this report: cached per session upload, guarded against invented facts. */
async function aiPart(report: ReturnType<typeof buildReport>, session: SessionRecord, cacheFile: string): Promise<AiPart> {
  try {
    const cached = JSON.parse(await fsp.readFile(cacheFile, "utf8")) as { timestamp: number; ai: AiPart };
    if (cached.timestamp === session.timestamp) return cached.ai;
  } catch {
    /* no cache yet */
  }
  let ai: AiPart;
  let llm;
  try {
    llm = getLLM();
  } catch {
    return { status: "unavailable", note: "Service IA non configuré : seul le bilan automatique est affiché." };
  }
  const facts = aiFacts(report);
  try {
    const r = await Promise.race([
      llm.pedagogicalFeedback(facts),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("délai dépassé")), AI_TIMEOUT_MS)),
    ]);
    const problem = checkAiFeedback(r.data, facts, report.interactive);
    ai = problem
      ? { status: "rejected", note: `Analyse IA écartée (${problem}) : seul le bilan automatique est affiché.` }
      : { status: "ok", note: "Analyse rédigée par l'IA à partir de vos résultats enregistrés.", feedback: r.data };
  } catch (err) {
    console.warn(`⚠️ Retour IA indisponible : ${errorMessage(err)}`);
    return { status: "error", note: "Analyse IA momentanément indisponible : seul le bilan automatique est affiché." };
  }
  await fsp.writeFile(cacheFile, JSON.stringify({ timestamp: session.timestamp, ai })).catch(() => undefined);
  return ai;
}

export default router;
