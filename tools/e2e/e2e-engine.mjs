// E2E — engine-bay identification demo (tp_demo_engine): real mouse hovers and clicks on the
// selection zones of the scan, discovery → 5 questions (with wrong answers and hints) → summary.
//   node tools/e2e/e2e-engine.mjs http://localhost:3000 <screenshots-dir>
import { spawn } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [base, outDir] = process.argv.slice(2);
const chrome = spawn(process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,800", "--remote-debugging-port=9338", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "eng-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? "eval error");
  return r.result.value;
};
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(200); } return false; };
const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1 });
const T = "window.__tpxr";
const zoneAt = (id) => ev(`${T}.screenOf("engine_zone_${id}")`);
/** Real mouse hover on a component (Babylon picks on pointer move). */
const hover = async (id, ms = 700) => { const p = await zoneAt(id); await mouse("mouseMoved", p.x - 3, p.y); await sleep(60); await mouse("mouseMoved", p.x, p.y); await sleep(ms); };
/** Real click (press + release on the spot = tap) on a component. */
const click = async (id) => { const p = await zoneAt(id); await mouse("mouseMoved", p.x, p.y); await sleep(120); await mouse("mousePressed", p.x, p.y, 1); await sleep(70); await mouse("mouseReleased", p.x, p.y); await sleep(350); };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); };
const step = () => ev(`${T}.session.step`);
const last = () => ev(`(() => { const l = ${T}.feedback.last; return l ? { kind: l.kind, title: l.title, text: l.text } : null; })()`);
const flags = () => ev(`[...${T}.sim.flags]`);

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9338/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  // Visitor in front of the car (front bumper side), eyes at 1.6 m, looking into the bay.
  const cam = "0,1.62,3.75,0,0.95,2.2";
  await send("Page.navigate", { url: `${base}/vr/?tp=tp_demo_engine&debug=1&student=sim_engine&cam=${cam}` });
  await sleep(500);
  const ready = await waitFor(`!!${T}?.sim && !!${T}?.session`, 90000);
  const engine = ready && (await ev(`(() => { const a = ${T}.assets.find(a => a.asset.asset_id === 'x_moteur'); return { loaded: a.loaded, err: a.error, tris: a.meshes.reduce((n, m) => n + (m.getTotalIndices?.() ?? 0) / 3, 0) }; })()`));
  check("Démo moteur chargée, scan GLB affiché", ready && engine.loaded, engine ? `${Math.round(engine.tris)} triangles ${engine.err ?? ""}` : "timeout");
  const zones = await ev(`${T}.scene.meshes.filter(m => m.metadata?.role === 'engine_zone').map(m => m.metadata.component).sort()`);
  check("9 zones de sélection issues du GLB", zones.length === 9, zones.join(", "));
  const plinth = await ev(`${T}.assets.find(a => a.asset.asset_id === 'x_socle')?.loaded`);
  check("Socle d'exposition construit", plinth);
  await sleep(2500);
  await shot("engine-01-vue-visiteur.png");

  // ---- Phase A: discovery
  await hover("oil_cap");
  check("Survol (découverte) → étiquette du composant affichée", await ev(`${T}.scene.getMeshByName('engine_label_oil_cap').isEnabled()`));
  await shot("engine-02-survol-decouverte.png");
  await hover("dipstick");
  await hover("coolant_tank");
  check("3 composants pointés → découverte validée", (await flags()).includes("explored"), (await flags()).join(","));
  check("Passage automatique à la question 1", await waitFor(`${T}.session.step === 1`, 5000));
  await mouse("mouseMoved", 20, 20); await sleep(300);
  await hover("oil_cap", 400);
  check("Pendant le quiz, le survol n'affiche plus le nom", !(await ev(`${T}.scene.getMeshByName('engine_label_oil_cap').isEnabled()`)));

  // ---- Phase B: quiz
  await click("washer_cap");
  let f = await last();
  check("Mauvaise réponse → notification bienveillante + 1er indice, pas de réponse donnée", f?.kind === "info" && /Pas tout à fait/.test(f.title) && /lave-glace/.test(f.text) && /cache noir/.test(f.text) && !/burette/.test(f.text), f?.text);
  check("La question reste posée (réessai possible)", (await step()) === 1);
  await shot("engine-03-mauvaise-reponse.png");
  await click("oil_cap");
  f = await last();
  check("Bonne réponse → « Bonne réponse ! » + fonction du composant", f?.kind === "success" && f.title === "Bonne réponse !" && /huile/.test(f.text), f?.text);
  check("Composant mis en évidence (vert) et étiqueté", await ev(`${T}.scene.getMeshByName('engine_zone_oil_cap').visibility > 0 && ${T}.scene.getMeshByName('engine_label_oil_cap').isEnabled()`));
  await shot("engine-04-bonne-reponse.png");
  check("Question suivante (jauge)", await waitFor(`${T}.session.step === 2`, 5000));

  await click("battery");
  await click("air_filter");
  f = await last();
  check("2e erreur → indice plus précis", /orange/.test(f?.text ?? ""), f?.text);
  await click("engine_cover");
  await sleep(400);
  let pulsed = false;
  for (let i = 0; i < 10 && !pulsed; i++) { pulsed = await ev(`${T}.scene.getMeshByName('engine_zone_dipstick').visibility > 0.05`); await sleep(90); }
  check("3e erreur → le bon composant clignote (aide, pas de réponse écrite)", pulsed);
  await shot("engine-05-indice-clignotant.png");
  await click("dipstick");
  check("Jauge trouvée → question 3", await waitFor(`${T}.session.step === 3`, 5000));
  await click("coolant_tank");
  check("Vase d'expansion trouvé → question 4", await waitFor(`${T}.session.step === 4`, 5000));
  await click("air_filter");
  check("Filtre à air trouvé → question 5", await waitFor(`${T}.session.step === 5`, 5000));
  await click("battery");
  check("Batterie trouvée → démonstration terminée", await waitFor(`${T}.session.finished`, 5000));

  // ---- Phase C: summary
  const s = await ev(`(() => { const s = ${T}.session.summary(); return { v: s.steps_validated, acc: s.accuracy_percent, tries: s.steps_detail.reduce((n, x) => n + x.manipulations, 0), wrong: s.steps_detail.reduce((n, x) => n + x.wrong_objects, 0) }; })()`);
  check("Suivi : 6 étapes validées, 9 tentatives dont 4 erreurs", s.v === 6 && s.tries === 9 && s.wrong === 4, `validées=${s.v} tentatives=${s.tries} erreurs=${s.wrong} précision=${s.acc} %`);
  const board = await ev(`${T}.sim.behavior.summary()`);
  check("Bilan : composants identifiés + tentatives", /5\/5/.test(board[0]) && /9 tentatives/.test(board[1]), board.join(" | "));
  await sleep(1200);
  await shot("engine-06-bilan.png");
  await send("Page.navigate", { url: `${base}/vr/?tp=tp_demo_engine&debug=1&student=sim_engine&cam=0,1.75,4.6,0,1.1,1.2` });
  await waitFor(`!!${T}?.sim`, 90000);
  await sleep(2500);
  await shot("engine-07-vue-salle.png");
  const perf = await ev("window.__tpxrPerf()");
  console.log(`   perf (SwiftShader, indicatif) : ${JSON.stringify(perf)}`);

  const relevant = errors.filter((e) => !/WebXR|logos\/|favicon/i.test(e ?? ""));
  check("Aucune erreur JavaScript", relevant.length === 0, relevant.slice(0, 3).join(" || "));
} catch (e) {
  console.log("❌ E2E crashed:", e);
  results.push(false);
} finally {
  chrome.kill();
  ws?.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
