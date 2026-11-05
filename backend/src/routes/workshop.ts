/**
 * Workshop template API.
 *
 *   GET /api/workshop/template       → template metadata + placement zones
 *   GET /api/workshop/zones          → compact zones map (for placement logic)
 *   GET /api/workshop/scene.babylon  → serialized 3D scene (loaded by the viewer)
 */
import { Request, Response, Router } from "express";
import { ROOM, SPAWN, ZONES, zonesSummary } from "../config/workshopLayout";
import WorkshopTemplate, { TEMPLATE_VERSION } from "../services/workshop";

const router = Router();

/** The template is fixed, so the serialized scene is built once and cached. */
let cachedScene: Promise<string> | null = null;

/**
 * Returns the serialized `.babylon` scene, building it on first call.
 * A failed build is not cached, so the next request retries.
 */
function getSerializedScene(): Promise<string> {
  if (!cachedScene) {
    const template = new WorkshopTemplate();
    cachedScene = template
      .exportScene()
      .finally(() => template.dispose())
      .catch((err: unknown) => {
        cachedScene = null;
        throw err;
      });
  }
  return cachedScene;
}

/** Extracts a readable message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * GET /api/workshop/template
 * Returns workshop template metadata + asset placement zones.
 */
router.get("/template", async (_req: Request, res: Response) => {
  try {
    const scene = await getSerializedScene();
    console.log("📋 GET /api/workshop/template");
    res.json({
      success: true,
      template: TEMPLATE_VERSION,
      dimensions: { length: ROOM.length, width: ROOM.width, height: ROOM.height },
      spawn: SPAWN,
      zones: ZONES,
      scene: {
        url: "/api/workshop/scene.babylon",
        format: "babylon",
        sizeKB: Math.round(Buffer.byteLength(scene) / 1024),
      },
    });
  } catch (err) {
    console.error("❌ /template failed:", err);
    res.status(500).json({ success: false, error: errorMessage(err) });
  }
});

/**
 * GET /api/workshop/zones
 * Returns a compact zones map keyed by zone id (input for the placement agent).
 */
router.get("/zones", (_req: Request, res: Response) => {
  console.log("📍 GET /api/workshop/zones");
  res.json(zonesSummary());
});

/**
 * GET /api/workshop/scene.babylon
 * Streams the serialized workshop scene for Babylon's SceneLoader.
 */
router.get("/scene.babylon", async (_req: Request, res: Response) => {
  try {
    const scene = await getSerializedScene();
    console.log("🧊 GET /api/workshop/scene.babylon");
    res.type("application/json").send(scene);
  } catch (err) {
    console.error("❌ /scene.babylon failed:", err);
    res.status(500).json({ success: false, error: errorMessage(err) });
  }
});

export default router;
