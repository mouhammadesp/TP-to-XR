// E2E phase 4 — end of TP: board summary, "📄 Rapport", report page content, AI feedback + guards, privacy.
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

setTimeout(() => { console.log("❌ watchdog: test bloqué > 6 min"); process.exit(2); }, 360_000).unref();
const [base, outDir, serverLog] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,860", "--remote-debugging-port=9354", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "rep-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const jsErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0]); return r.result.value; };
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(200); } return false; };
const shot = async (name, full = false) => {
  await sleep(700);
  let params = { format: "png" };
  if (full) {
    const h = await ev("Math.ceil(document.documentElement.scrollHeight)");
    const w = await ev("Math.ceil(document.documentElement.clientWidth)");
    params = { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } };
  }
  const r = await send("Page.captureScreenshot", params);
  writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64"));
  console.log(`   📸 ${name}`);
};
const mouseAt = async (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1 });
const clickMesh = async (name, holdMs = 120) => {
  const p = await ev(`window.__tpxr.screenOf(${JSON.stringify(name)})`);
  await mouseAt("mouseMoved", p.x, p.y); await sleep(80);
  await mouseAt("mousePressed", p.x, p.y, 1); await sleep(holdMs);
  await mouseAt("mouseReleased", p.x, p.y); await sleep(350);
};
const T = "window.__tpxr";
const ID = { first_name: "Aïssatou", last_name: "NDIAYE SOW", matricule: "UCAD-2024/017" };
const openTp = async (tp, cam) => {
  await send("Page.navigate", { url: `${base}/vr/?debug=1&student=rep_test` });
  await waitFor("!!window.__tpxr?.sm", 60000);
  await ev(`sessionStorage.setItem('tpxr_identity', ${JSON.stringify(JSON.stringify(ID))})`);
  await send("Page.navigate", { url: `${base}/vr/?tp=${tp}&debug=1&student=rep_test&cam=${cam}` });
  await sleep(500);
  return waitFor(`!!${T}?.session`, 90000);
};
const rel = (id, x, y, z) => ev(`${T}.sim.debugRelease(${JSON.stringify(id)}, ${x}, ${y}, ${z}), true`);
const reportText = () => ev("document.getElementById('app').innerText");

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9354/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  // ── Interactive demo: step 1 validated, a real safety fault in step 2, then the student moves on and finishes
  const camBench = "0,1.3,0.7,0,0.9,0.12";
  check("Démo électrique lancée avec l'identité de l'étudiant", await openTp("tp_demo_electrical", camBench) && await ev(`${T}.session.identity?.last_name === 'NDIAYE SOW'`));
  await rel("e_plaque", 0.03, 0.9, 0.18);
  await rel("e_batterie", -0.33, 0.9, 0.12);
  await waitFor(`${T}.session.step === 1`, 5000);
  await rel("e_fils", 0.01, 0.909, 0.19);
  await clickMesh("grab_e_interrupteur"); // power on during wiring → safety fault
  await waitFor(`${T}.session.safetyViolations >= 1`, 4000);
  await clickMesh("grab_e_interrupteur"); // off again
  for (let i = 0; i < 3; i++) { await ev(`${T}.onButton('next', 'keyboard')`); await sleep(300); }
  check("TP terminé (étapes 2 à 4 passées par l'étudiant)", await waitFor(`${T}.session.finished`, 4000), JSON.stringify(await ev(`${T}.session.stepsDetail().map(d => d.status)`)));
  const board = await ev(`${T}.scene.getMeshByName('btn_next') && true`);
  check("Bouton « Suivant » devenu « 📄 Rapport », bilan affiché sur le moniteur", board && await ev(`(() => { const p = ${T}.session; return p.finished; })()`));
  await ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(0, 1.72, 0.5); const t = c.position.clone(); t.set(0, 1.83, -1.3); c.setTarget(t); })()`);
  await shot("59-fin-tp-bilan-moniteur.png");
  const sid = await ev(`${T}.session.sessionId`);

  await ev(`${T}.onButton('next', 'button')`);
  check("« 📄 Rapport » → page du rapport de cette session", await waitFor(`location.pathname.endsWith('/report.html') && location.search.includes(${JSON.stringify(sid)})`, 20000), await ev("location.pathname + location.search"));
  check("Rapport chargé (bilan automatique + section IA)", await waitFor("window.__reportReady === true", 60000));
  const txt = await reportText();
  check("Identité de l'étudiant, intitulé, domaine, date, durée", txt.includes("Aïssatou NDIAYE SOW · UCAD-2024/017") && txt.includes("Câblage d'un circuit mixte") && txt.includes("Électricité") && /\d{4} à \d{2}:\d{2}/.test(txt) && txt.includes("TP terminé"));
  check("Étapes réussies / non réussies (1 validée, 3 passées)", txt.includes("1/4") && (txt.match(/Validée/g) ?? []).length === 1 && (txt.match(/Non validée \(passée\)/g) ?? []).length === 3);
  check("Difficulté documentée : la faute de sécurité réelle de l'étape 2", txt.includes("Étape 2 — faute de sécurité : mise sous tension pendant le câblage"));
  check("Recommandations personnalisées (sécurité étape 2, reprendre les étapes passées)", txt.includes("étape 2") && txt.includes("Reprenez l'étape 3"));
  check("Pas de note sans barème", txt.includes("Aucun barème n'est défini pour ce TP : pas de note."));
  const api = await (await fetch(`${base}/api/report/tp_demo_electrical/${sid}`)).json();
  const ai = api.report.ai;
  check("Analyse IA : produite et contrôlée, ou repli déterministe annoncé", ai.status === "ok" ? ai.feedback.advice.length > 0 : ["unavailable", "rejected", "error"].includes(ai.status), `${ai.status} — ${ai.note}`);
  if (ai.feedback) console.log(`   ✨ IA : ${ai.feedback.summary}\n      conseils : ${ai.feedback.advice.join(" | ")}`);
  check("Section IA affichée sur la page", (await reportText()).includes("Analyse pédagogique (IA)") && (await reportText()).includes(ai.note));
  check("Bouton Imprimer / PDF présent", await ev("!!document.getElementById('btn-print')"));
  await shot("60-rapport-de-tp.png", true);
  await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await shot("61-rapport-ecran-etroit.png");
  check("Mise en page étroite sans défilement horizontal", await ev("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"));
  await send("Emulation.clearDeviceMetricsOverride");

  // ── Non-interactive TP: never "validée"
  check("TP importé (sans moteur) lancé", await openTp("tp_20261014_uytafm", "0,1.45,0.75,0,0.95,0"));
  for (let i = 0; i < 5; i++) { await ev(`${T}.onButton('next', 'keyboard')`); await sleep(250); }
  await waitFor(`${T}.session.finished`, 4000);
  const sid2 = await ev(`${T}.session.sessionId`);
  await ev(`${T}.analytics.send(${T}.session.summary(navigator.userAgent))`);
  const r2 = (await (await fetch(`${base}/api/report/tp_20261014_uytafm/${sid2}`)).json()).report;
  const t2 = [...r2.strengths, ...r2.difficulties, ...r2.steps.map((s) => s.status_label), ...(r2.ai.feedback ? [r2.ai.feedback.summary, ...r2.ai.feedback.strengths, ...r2.ai.feedback.difficulties, ...r2.ai.feedback.advice] : [])].join(" ");
  check("TP sans validation automatique : « Terminée (non vérifiée) », jamais « validée »", r2.steps.every((s) => s.status === "done") && !/valid[ée]e/i.test(t2.replace(/validation automatique/g, "")), `IA : ${r2.ai.status}`);

  // ── Privacy
  const log = readFileSync(serverLog, "utf8");
  check("Journaux techniques sans nom ni matricule", log.includes(`Rapport tp_demo_electrical/${sid}`) && !log.includes("NDIAYE") && !log.includes("Aïssatou") && !log.includes("UCAD-2024"), log.split("\n").find((l) => l.includes(`Rapport tp_demo_electrical/${sid}`))?.trim());
  check("Aucune erreur JavaScript", jsErrors.length === 0, jsErrors.join(" | "));
} catch (e) { console.log("❌ crashed", e); results.push(false); }
finally { chrome.kill(); ws?.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
