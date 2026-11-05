/**
 * Build script (esbuild).
 *   node build.mjs           → dist/ (minified bundle + index.html), served by the backend at /vr/
 *   node build.mjs --watch   → rebuild on change
 *   node build.mjs --tests   → dist-tests/ (unit tests bundled for `node --test`)
 */
import * as esbuild from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";

const args = new Set(process.argv.slice(2));

if (args.has("--tests")) {
  rmSync("dist-tests", { recursive: true, force: true });
  await esbuild.build({
    entryPoints: readdirSync("tests").filter((f) => f.endsWith(".test.ts")).map((f) => `tests/${f}`),
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: "dist-tests",
    outExtension: { ".js": ".mjs" },
    logLevel: "warning",
  });
  console.log("🧪 Tests bundled → dist-tests/");
  process.exit(0);
}

mkdirSync("dist", { recursive: true });
copyFileSync("index.html", "dist/index.html");
copyFileSync("report.html", "dist/report.html");
// Static files (e.g. public/logos/ucad.png, public/logos/curi.png) are copied as-is.
if (existsSync("public")) cpSync("public", "dist", { recursive: true });

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "esm",
  target: "es2020",
  outfile: "dist/main.js",
  minify: true,
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
};

if (args.has("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("👀 Watching src/ …");
} else {
  const result = await esbuild.build({ ...options, metafile: true });
  // Report page (separate small bundle: no Babylon).
  await esbuild.build({ ...options, entryPoints: ["src/report.ts"], outfile: "dist/report.js" });
  const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`✅ Built dist/ (${(bytes / 1024 / 1024).toFixed(2)} MB incl. sourcemap)`);
}
