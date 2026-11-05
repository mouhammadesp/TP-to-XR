/**
 * TP-to-xR MVP — Express entry point.
 */
import "dotenv/config";
import path from "path";
import compression from "compression";
import cors from "cors";
import express, { ErrorRequestHandler } from "express";
import analyticsRoutes from "./routes/analytics";
import reportRoutes from "./routes/report";
import convertRoutes from "./routes/convert";
import demoRoutes from "./routes/demo";
import parsingRoutes from "./routes/parsing";
import { pipelineRouter, tpRouter } from "./routes/pipeline";
import sketchfabRoutes from "./routes/sketchfab";
import { ASSETS_DIR, ASSETS_URL_PREFIX } from "./services/assetManager";
import workshopRoutes from "./routes/workshop";
import { HttpError, errorMessage } from "./utils/http";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(compression()); // the VR bundle is 5.6 MB → ~1.3 MB over the wire
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/** Student WebXR app (built by frontend-vr: npm run build) → http://localhost:PORT/vr/?tp=<id> */
app.use("/vr", express.static(path.resolve(__dirname, "..", "..", "frontend-vr", "dist")));
/** Static WebXR test viewer → http://localhost:PORT/viewer.html */
app.use(express.static(path.join(__dirname, "..", "public")));
/** Same Babylon.js build as the backend, so viewer and serializer always match. */
app.use("/vendor/babylonjs", express.static(path.dirname(require.resolve("babylonjs"))));
app.use("/vendor/babylonjs-loaders", express.static(path.dirname(require.resolve("babylonjs-loaders"))));
/** Downloaded Sketchfab models (GLB / glTF folders), long-cached: content never changes per uid. */
app.use(ASSETS_URL_PREFIX, express.static(ASSETS_DIR, { maxAge: "7d", fallthrough: false }));

/**
 * GET /health — liveness probe.
 */
app.get("/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.use("/api/workshop", workshopRoutes);
app.use("/api/parse", parsingRoutes);
app.use("/api/sketchfab", sketchfabRoutes);
app.use("/api/pipeline", pipelineRouter);
app.use("/api/tp", tpRouter);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/report", reportRoutes);
app.use("/api/demo", demoRoutes);
app.use("/api/convert", convertRoutes);

/**
 * Last-resort error handler (must keep 4 params for Express to detect it).
 * HttpError and body-parser errors keep their status; anything else is a 500.
 */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const parserStatus = (err as { status?: unknown }).status;
  const status =
    err instanceof HttpError ? err.status : typeof parserStatus === "number" ? parserStatus : 500;
  if (status >= 500) console.error("❌ Error:", err);
  else console.warn(`⚠️  ${status}: ${errorMessage(err)}`);
  res.status(status).json({
    success: false,
    error: errorMessage(err),
    ...(err instanceof HttpError && err.details !== undefined ? { details: err.details } : {}),
  });
};
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📋 Workshop template API: http://localhost:${PORT}/api/workshop/template`);
  console.log(`🧠 TP parsing API:        http://localhost:${PORT}/api/parse/{pdf,tp,asset-queries,placement}`);
  console.log(`🔎 Sketchfab API:         http://localhost:${PORT}/api/sketchfab/search?q=motor`);
  console.log(`🏭 Pipeline API:          POST http://localhost:${PORT}/api/pipeline`);
  console.log(`🥽 Student VR app:        http://localhost:${PORT}/vr/?tp=<id>`);
  console.log(`🔧 Debug viewer:          http://localhost:${PORT}/viewer.html`);
  console.log(`📊 Analytics API:         http://localhost:${PORT}/api/analytics/<tp_id>`);
  if (!process.env.TOGETHER_API_KEY) console.warn("⚠️  TOGETHER_API_KEY not set — LLM routes and the pipeline will answer 503");
  if (!process.env.SKETCHFAB_API_KEY) console.warn("⚠️  SKETCHFAB_API_KEY not set — search works, models will be placeholders");
});

export default app;
