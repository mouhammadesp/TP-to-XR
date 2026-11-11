/**
 * Demo TPs API (no API key needed).
 *
 *   GET /api/demo           → list of demo TPs (menu buttons)
 *   GET /api/demo/:domain   → demo manifest for a domain (mechanical | electrical)
 *
 * Demo manifests are also served by GET /api/tp/:id (ids tp_demo_*), so the
 * student view opens them like any generated TP: /vr/?tp=tp_demo_mechanical
 */
import { Router } from "express";
import { getDemo, getDemoByDomain, listDemos } from "../services/demoTps";
import { HttpError } from "../utils/http";

const router = Router();

/**
 * GET /api/demo — available demo TPs.
 */
router.get("/", (_req, res) => {
  res.json({ success: true, demos: listDemos() });
});

/**
 * GET /api/demo/:domain — demo manifest.
 */
router.get("/:domain", (req, res) => {
  const manifest = getDemoByDomain(req.params.domain);
  if (!manifest) {
    const available = listDemos().map((d) => d.domain).join(", ");
    throw new HttpError(404, `Pas de TP de démonstration pour « ${req.params.domain} » (disponibles : ${available})`);
  }
  // Quiz demos served directly (domain shorthand) must carry a seeded plan,
  // otherwise the viewer would fall back to its legacy fixed questions.
  const seeded = manifest.simulation?.quiz ? manifest : getDemo(manifest.id) ?? manifest;
  console.log(`🧪 Demo TP served: ${seeded.id}${seeded.simulation?.quiz ? ` (quiz seed ${seeded.simulation.quiz.seed})` : " (legacy)"}`);
  res.json(seeded);
});

export default router;
