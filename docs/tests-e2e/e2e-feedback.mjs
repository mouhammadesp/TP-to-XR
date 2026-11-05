// E2E phase 2 — step validation notification, error feedback, neutral guidance; never before engine confirmation.
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [base, outDir] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,860", "--remote-debugging-port=9351", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "fb-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const jsErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0]); return r.result.value; };
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(150); } return false; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); console.log(`   📸 ${name}`); };
const mouseAt = async (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1 });
const clickMesh = async (name, holdMs = 120) => {
  const p = await ev(`window.__tpxr.screenOf(${JSON.stringify(name)})`);
  await mouseAt("mouseMoved", p.x, p.y); await sleep(80);
  await mouseAt("mousePressed", p.x, p.y, 1); await sleep(holdMs);
  await mouseAt("mouseReleased", p.x, p.y); await sleep(350);
};
const key = async (k, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  await sleep(300);
};
const T = "window.__tpxr";
const open = async (tp, cam) => {
  await send("Page.navigate", { url: `${base}/vr/?tp=${tp}&debug=1&student=fb_test&cam=${cam}` });
  await sleep(500);
  return waitFor(`!!${T}?.session`, 90000);
};
const rel = (id, x, y, z) => ev(`${T}.sim.debugRelease(${JSON.stringify(id)}, ${x}, ${y}, ${z}), true`);
const hist = () => ev(`${T}.feedback.history.map(h => h.kind + '|' + h.title + '|' + h.text)`);
// Screen rectangle of a mesh (8 bbox corners projected) — Babylon classes taken from live objects.
const rectOf = (name) => ev(`(() => { const s = ${T}.scene, m = s.getMeshByName(${JSON.stringify(name)}); if (!m || !m.isEnabled()) return null; m.computeWorldMatrix(true);
  const V = m.position.constructor, M = m.getWorldMatrix().constructor, e = s.getEngine(), cam = s.activeCamera; const vp = cam.viewport.toGlobal(e.getRenderWidth(), e.getRenderHeight());
  const pts = m.getBoundingInfo().boundingBox.vectorsWorld.map(v => V.Project(v, M.Identity(), s.getTransformMatrix(), vp));
  return { x0: Math.min(...pts.map(p => p.x)), x1: Math.max(...pts.map(p => p.x)), y0: Math.min(...pts.map(p => p.y)), y1: Math.max(...pts.map(p => p.y)) }; })()`);
const inter = (a, b) => a && b && a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9351/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  // ── Interactive TP: success only after engine confirmation
  const camStudent = "0,1.6,0.9,0.55,1.72,-1.3";
  check("Démo électrique chargée", await open("tp_demo_electrical", camStudent));
  await rel("e_plaque", 0.03, 0.9, 0.18);
  await sleep(1200);
  check("Étape à moitié faite (plaque seule) → aucune notification de réussite", !(await hist()).some((h) => h.startsWith("success")) && await ev(`${T}.session.step === 0`));
  await rel("e_batterie", -0.33, 0.9, 0.12);
  check("Moteur de validation : étape 1 confirmée → « Étape validée ! »", await waitFor(`${T}.feedback.last?.kind === 'success'`, 4000), (await hist()).at(-1));
  const evts = await ev(`${T}.session.summary().interactions.filter(e => e.event === 'sim_event' && e.kind === 'step_validated').map(e => e.timestamp)`);
  const shownAt = await ev(`${T}.feedback.last.at`);
  check("Notification affichée après l'événement de validation (jamais avant)", evts.length === 1 && shownAt >= evts[0], `validation ${evts[0]} ≤ affichage ${shownAt}`);
  check("Phrase adaptée à l'action effectuée", (await ev(`${T}.feedback.last.text`)).includes("plaque d'essai") && (await ev(`${T}.feedback.last.text`)).includes("atterie"), await ev(`${T}.feedback.last.text`));
  await sleep(300);
  check("Carte visible, animée (fondu + échelle)", await ev(`${T}.scene.getMeshByName('step_feedback').isEnabled()`));
  const card = await rectOf("step_feedback"), screen = await rectOf("monitor_screen"), kak = await rectOf("kakemono_print");
  check("La carte ne masque ni le moniteur ni le kakémono (vue depuis la table)", !inter(card, screen) && !inter(card, kak), JSON.stringify({ card, screen }));
  await shot("55-etape-validee.png");
  check("Progression mise à jour (étape 2 affichée, 1 étape validée)", await waitFor(`${T}.session.step === 1`, 4000) && await ev(`${T}.session.stepsValidated === 1`));

  // ── Incorrect action (engine): power on during wiring → "Action incorrecte", recorded as a safety fault
  await rel("e_fils", 0.01, 0.909, 0.19);
  await rel("e_leds", 0.06, 0.909, 0.12);
  await ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(0, 1.3, 0.7); const t = c.position.clone(); t.set(0, 0.9, 0.12); c.setTarget(t); })()`);
  await sleep(400);
  await clickMesh("grab_e_interrupteur");
  await ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(0, 1.6, 0.9); const t = c.position.clone(); t.set(0.55, 1.72, -1.3); c.setTarget(t); })()`);
  check("Action incorrecte détectée par le moteur → carte d'erreur explicative", await waitFor(`${T}.feedback.last?.kind === 'error'`, 4000), (await hist()).at(-1));
  const faults = await ev(`${T}.session.safetyViolations`);
  check("Erreur enregistrée comme faute de sécurité (justifiée), pas de validation", faults >= 1 && await ev(`${T}.session.step === 1`), `fautes=${faults}`);
  await sleep(350);
  await shot("56-action-incorrecte.png");
  check("Haptique et son appelables hors casque sans erreur", await ev(`(() => { ${T}.sounds.play('success'); return true; })()`));
  await key("m", "KeyM", 77);
  check("Son facultatif : touche M", await ev(`${T}.sounds.enabled === false`));

  // ── Non-interactive TP (no engine): never "validée"; neutral guidance for an object not in the instruction
  check("TP importé (sans moteur) chargé", await open("tp_20261014_uytafm", "0,1.45,0.75,0,0.95,0"));
  const assets = await ev(`${T}.assets.filter(a => a.handle.isPickable && a.asset.zone === 'zone_workbench').map(a => a.asset.asset_id)`);
  for (const id of assets) {
    if (await ev(`${T}.feedback.history.some(h => h.kind === 'info')`)) break;
    await clickMesh(`grab_${id}`);
  }
  const info = await ev(`${T}.feedback.history.find(h => h.kind === 'info') ?? null`);
  check("Objet non mentionné par la consigne → conseil neutre (pas « incorrect »)", info && info.title === "Conseil" && info.text.startsWith("La consigne de cette étape mentionne"), info ? info.text : `aucun (${assets.join(", ")})`);
  await key("n", "KeyN", 78);
  await sleep(500);
  check("Passage à l'étape suivante sans moteur → jamais « Étape validée ! »", !(await hist()).some((h) => h.startsWith("success")) && await ev(`${T}.session.stepsDetail()[0].status === 'done'`));
  check("Aucune erreur JavaScript", jsErrors.length === 0, jsErrors.join(" | "));
} catch (e) { console.log("❌ crashed", e); results.push(false); }
finally { chrome.kill(); ws?.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
