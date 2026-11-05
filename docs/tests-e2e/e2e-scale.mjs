// E2E phase 3 — real-world sizes (sources), proportions, positions, grab handles, close-up inspection.
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [base, outDir] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,860", "--remote-debugging-port=9352", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "scale-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const jsErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0]); return r.result.value; };
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(200); } return false; };
const shot = async (name) => { await sleep(900); const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); console.log(`   📸 ${name}`); };
const key = async (k, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  await sleep(300);
};
const T = "window.__tpxr";
const open = async (tp, cam) => {
  await send("Page.navigate", { url: `${base}/vr/?tp=${tp}&debug=1&student=scale_test&cam=${cam}` });
  await sleep(500);
  return waitFor(`!!${T}?.session`, 90000);
};
const measured = () => ev(`${T}.assets.map(a => { const vis = a.meshes.filter(m => m.getTotalVertices() > 0 && m.isVisible && m.isEnabled());
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9]; for (const m of vis) { m.computeWorldMatrix(true); const b = m.getBoundingInfo().boundingBox; mn = mn.map((v, i) => Math.min(v, [b.minimumWorld.x, b.minimumWorld.y, b.minimumWorld.z][i])); mx = mx.map((v, i) => Math.max(v, [b.maximumWorld.x, b.maximumWorld.y, b.maximumWorld.z][i])); }
  const h = a.handle.getBoundingInfo().boundingBox.extendSizeWorld;
  return { id: a.asset.asset_id, name: a.asset.name, target: a.asset.target_size_m, src: a.asset.size_source, largest: Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]), min: mn, max: mx, pos: [a.handle.position.x, a.handle.position.z], manifestPos: [a.asset.position.x, a.asset.position.z], handleMin: Math.min(h.x, h.y, h.z) * 2 }; })`);

try {
  // ── Server side: sizes resolved from reliable sources
  const api = await (await fetch(`${base}/api/tp/tp_20261014_uytafm`)).json();
  const m = api.manifest ?? api;
  const by = Object.fromEntries(m.assets.map((a) => [a.name, a]));
  check("Pile 9 V : format normalisé IEC (48,5 mm)", by["Pile 9 V"].target_size_m === 0.0485 && by["Pile 9 V"].size_source === "standard", by["Pile 9 V"].size_note);
  const bulb = by["Ampoule 6 V à culot E10"];
  check("Ampoule E10 : estimation aberrante (10 cm) ramenée dans la plage typique", bulb.target_size_m <= 0.045 && bulb.size_source === "typical_range", bulb.size_note);
  const meter = by["Multimètre numérique"];
  check("Multimètre : estimation plausible conservée (modèle exact inconnu, rien d'inventé)", meter.target_size_m === 0.2 && meter.size_source === "estimate", meter.size_note);
  const api2 = await (await fetch(`${base}/api/tp/tp_20261015_nbqp1y`)).json();
  const m2 = api2.manifest ?? api2;
  const marker = m2.assets.find((a) => a.name === "marqueur");
  check("Marqueur : 10 cm → 12 cm (plage typique d'un marqueur)", marker.target_size_m === 0.12, marker.size_note);
  check("Chaque taille porte sa source (traçabilité)", [...m.assets, ...m2.assets].every((a) => a.size_source && a.size_note));

  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9352/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (msg) => {
    const d = JSON.parse(msg.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  // ── Scene: real sizes applied, proportions, positions, handles
  check("TP « mesure de tension » chargé", await open("tp_20261014_uytafm", "0,1.3,0.75,0,0.92,0"));
  const rows = await measured();
  const models = rows.filter((r) => !r.id.includes("cordons"));
  check("Plus grande dimension visible = taille réelle (±2 %)", models.every((r) => Math.abs(r.largest - r.target) / r.target < 0.02), models.map((r) => `${r.name} ${(r.largest * 100).toFixed(1)} cm`).join(" · "));
  const pile = rows.find((r) => r.name === "Pile 9 V"), mm = rows.find((r) => r.name === "Multimètre numérique");
  check("Proportions entre composants respectées (multimètre / pile ≈ 4)", Math.abs(mm.largest / pile.largest - 0.2 / 0.0485) < 0.1, (mm.largest / pile.largest).toFixed(2));
  check("Positions de manipulation conservées", rows.every((r) => Math.abs(r.pos[0] - r.manifestPos[0]) < 1e-6 && Math.abs(r.pos[1] - r.manifestPos[1]) < 1e-6));
  check("Objets posés sur l'établi (ni enfoncés ni en l'air)", models.filter((r) => r.manifestPos && r.min[1] > 0.5).every((r) => Math.abs(r.min[1] - 0.9) < 0.01), models.map((r) => r.min[1].toFixed(3)).join(", "));
  const ov = [];
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) {
    const a = models[i], b = models[j];
    if (a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[2] < b.max[2] && a.max[2] > b.min[2] && a.min[1] < b.max[1] && a.max[1] > b.min[1]) ov.push(`${a.name}∩${b.name}`);
  }
  check("Aucune collision entre objets", ov.length === 0, ov.join(", ") || "ok");
  check("Petits objets toujours faciles à saisir (poignée ≥ 7 cm)", rows.every((r) => r.handleMin >= 0.0699), rows.map((r) => `${r.name} ${(r.handleMin * 100).toFixed(1)}`).join(" · "));
  await shot("57-echelle-reelle.png");

  // ── Close-up inspection (I key / thumbstick press)
  await ev(`${T}.assets.find(a => a.asset.name === 'Pile 9 V').handle.metadata && true`);
  const p = await ev(`window.__tpxr.screenOf('grab_' + ${T}.assets.find(a => a.asset.name === 'Pile 9 V').asset.asset_id)`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
  await sleep(400);
  await key("i", "KeyI", 73);
  const insp = await ev(`(() => { const v = ${T}.inspect; const a = ${T}.scene.getTransformNodeByName('inspect_anchor'); const c = ${T}.scene.activeCamera;
    const kids = a ? a.getChildMeshes().filter(m => m.name !== 'inspect_tag' && m.getTotalVertices() > 0) : [];
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9]; for (const m of kids) { m.computeWorldMatrix(true); const b = m.getBoundingInfo().boundingBox; mn = mn.map((x, i) => Math.min(x, [b.minimumWorld.x, b.minimumWorld.y, b.minimumWorld.z][i])); mx = mx.map((x, i) => Math.max(x, [b.maximumWorld.x, b.maximumWorld.y, b.maximumWorld.z][i])); }
    return { shown: v.shown?.asset.name ?? null, zoom: v.zoom, dist: a ? a.position.subtract(c.globalPosition).length() : null, size: Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]), copies: kids.length }; })()`);
  check("Loupe (touche I) : copie agrandie de la pile devant les yeux", insp.shown === "Pile 9 V" && insp.copies > 0 && Math.abs(insp.dist - 0.42) < 0.05, JSON.stringify(insp));
  check("Copie ≈ 22 cm apparents (zoom ×4,5), l'original garde sa taille réelle", Math.abs(insp.size - 0.22) < 0.02 && Math.abs((await measured()).find((r) => r.name === "Pile 9 V").largest - 0.0485) < 0.001, `zoom ×${insp.zoom.toFixed(2)}, copie ${(insp.size * 100).toFixed(1)} cm`);
  check("Utilisation de la loupe enregistrée comme aide", await ev(`${T}.session.stepsDetail()[0].aids >= 1`));
  await shot("58-loupe-petit-objet.png");
  await key("i", "KeyI", 73);
  check("Touche I à nouveau → loupe fermée", await ev(`${T}.inspect.shown === null && !${T}.scene.getTransformNodeByName('inspect_anchor')`));
  check("Aucune erreur JavaScript", jsErrors.length === 0, jsErrors.join(" | "));
} catch (e) { console.log("❌ crashed", e); results.push(false); }
finally { chrome.kill(); ws?.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
