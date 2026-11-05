// E2E — wall-mounted split air conditioner (decoration): placement, collisions, visibility, cost, screenshots.
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

setTimeout(() => { console.log("❌ watchdog"); process.exit(2); }, 300_000).unref();
const [base, outDir] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,860", "--remote-debugging-port=9355", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "ac-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const jsErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0]); return r.result.value; };
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(200); } return false; };
const shot = async (name) => { await sleep(1200); const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); console.log(`   📸 ${name}`); };
const T = "window.__tpxr";
const open = async (cam) => {
  await send("Page.navigate", { url: `${base}/vr/?tp=tp_demo_mechanical&debug=1&student=ac_test&cam=${cam}` });
  await sleep(500);
  return waitFor(`!!${T}?.session`, 90000);
};
const boxes = (re) => ev(`${T}.scene.meshes.filter(m => ${re}.test(m.name) && m.isEnabled() && m.isVisible).map(m => { m.computeWorldMatrix(true); const b = m.getBoundingInfo().boundingBox; return { name: m.name, min: { x: b.minimumWorld.x, y: b.minimumWorld.y, z: b.minimumWorld.z }, max: { x: b.maximumWorld.x, y: b.maximumWorld.y, z: b.maximumWorld.z } }; })`);
const overlap = (a, b) => a.min.x < b.max.x - 1e-4 && a.max.x > b.min.x + 1e-4 && a.min.y < b.max.y - 1e-4 && a.max.y > b.min.y + 1e-4 && a.min.z < b.max.z - 1e-4 && a.max.z > b.min.z + 1e-4;
const rectOf = (name) => ev(`(() => { const s = ${T}.scene, ms = s.meshes.filter(m => m.name.startsWith(${JSON.stringify(name)}) && m.isEnabled()); if (!ms.length) return null;
  const V = ms[0].position.constructor, M = ms[0].getWorldMatrix().constructor, e = s.getEngine(), cam = s.activeCamera; const vp = cam.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight());
  const pts = ms.flatMap(m => { m.computeWorldMatrix(true); return m.getBoundingInfo().boundingBox.vectorsWorld.map(v => V.Project(v, M.Identity(), s.getTransformMatrix(), vp)); }).filter(p => p.z > 0 && p.z < 1);
  if (!pts.length) return null; return { x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)) }; })()`);
const inter = (a, b) => a && b && a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9355/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
  });
  await send("Runtime.enable"); await send("Page.enable");

  check("Salle chargée", await open("0,1.6,4,0,1,0"));
  const ac = await boxes("/^aircon_/");
  check("Climatiseur présent : 4 maillages (corps, parties sombres, grille, afficheur)", ac.length === 4, ac.map((b) => b.name).join(", "));
  const info = await ev(`${T}.scene.meshes.filter(m => m.name.startsWith('aircon_')).map(m => ({ n: m.name, pick: m.isPickable, frozen: m.isWorldMatrixFrozen, v: m.getTotalVertices() }))`);
  check("Décoratif et léger : non sélectionnable, figé, peu de sommets", info.every((m) => !m.pick && m.frozen) && info.reduce((n, m) => n + m.v, 0) < 600, JSON.stringify(info));
  const U = { min: { x: Math.min(...ac.map((b) => b.min.x)), y: Math.min(...ac.map((b) => b.min.y)), z: Math.min(...ac.map((b) => b.min.z)) }, max: { x: Math.max(...ac.map((b) => b.max.x)), y: Math.max(...ac.map((b) => b.max.y)), z: Math.max(...ac.map((b) => b.max.z)) } };
  const unit = ac.find((b) => b.name === "aircon_body");
  check("Fixé en hauteur sur le mur sans fenêtres (−X), sous le plafond", U.min.x >= -9.9 && U.min.x < -9.88 && U.max.y <= 3.0 + 1e-6 && U.min.y > 2.3, `x ${U.min.x.toFixed(3)}…${U.max.x.toFixed(3)}, y ${U.min.y.toFixed(2)}…${U.max.y.toFixed(2)}`);
  check("Proportions d'un split mural (≈ 88 × 29 × 21 cm)", Math.abs(unit.max.z - unit.min.z - 0.88) < 0.01 && Math.abs(U.max.x - U.min.x - 0.215) < 0.01);
  const others = await boxes("/^(wall_|ceiling|accent_panel|window_|curtain_|cabinet|shelf_|workbench_|monitor_|kakemono_|led_|baseboard_|safety_sign_|step_feedback|toast)/");
  const hits = [];
  for (const a of ac) for (const o of others) if (overlap(a, o)) hits.push(`${a.name}∩${o.name}`);
  check("Aucune collision (murs, plafond, bois, fenêtres, rideaux, armoire, étagères, établi, moniteur, kakémono, LED)", hits.length === 0, hits.join(", ") || "ok");
  for (const [label, cam] of [["entrée", null], ["table", "0,1.6,0.9,0,1.6,-1.3"]]) {
    if (cam) await ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(0, 1.6, 0.9); const t = c.position.clone(); t.set(-0.6, 1.7, -1.3); c.setTarget(t); })()`);
    await sleep(300);
    const r = await rectOf("aircon_");
    const masked = ["monitor_screen", "kakemono_print"].filter(async () => false);
    const mon = await rectOf("monitor_screen"), kak = await rectOf("kakemono_print");
    check(`Vue depuis ${label} : ne masque ni le moniteur ni le kakémono`, !inter(r, mon) && !inter(r, kak), r ? "climatiseur à l'écran" : "hors champ");
  }
  await open("-7.2,2.05,-2.2,-9.85,2.5,-3.7");
  await shot("62-climatiseur-gros-plan.png");
  await open("3,1.75,4.5,-9.9,1.9,-3.2");
  await shot("63-climatiseur-vue-salle.png");
  check("Aucune erreur JavaScript", jsErrors.length === 0, jsErrors.join(" | "));
} catch (e) { console.log("❌ crashed", e); results.push(false); }
finally { chrome.kill(); ws?.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
