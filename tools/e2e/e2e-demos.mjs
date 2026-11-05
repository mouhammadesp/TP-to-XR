// E2E — plays both interactive demo TPs end to end (real clicks + the same release path as a real drop).
import { spawn } from "child_process";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [base, outDir] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,800", "--remote-debugging-port=9337", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "sim-"))}`, "about:blank"], { stdio: "ignore" });
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
const mouseAt = async (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1 });
const clickMesh = async (name, holdMs = 80) => {
  const p = await ev(`window.__tpxr.screenOf(${JSON.stringify(name)})`);
  await mouseAt("mouseMoved", p.x, p.y); await sleep(80);
  await mouseAt("mousePressed", p.x, p.y, 1); await sleep(holdMs);
  await mouseAt("mouseReleased", p.x, p.y); await sleep(300);
};
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); };
const open = async (tp, cam) => {
  await send("Page.navigate", { url: `${base}/vr/?tp=${tp}&debug=1&student=sim_test&cam=${cam}` });
  await sleep(500);
  return waitFor("!!window.__tpxr?.sim && !!window.__tpxr?.session", 60000);
};
const T = "window.__tpxr";
const step = () => ev(`${T}.session.step + 1`);
const rel = (id, x, y, z) => ev(`${T}.sim.debugRelease(${JSON.stringify(id)}, ${x}, ${y}, ${z}), true`);
const flags = () => ev(`[...${T}.sim.flags]`);
const sum = () => ev(`(() => { const s = ${T}.session.summary(); return { v: s.steps_validated, f: s.safety_violations, fin: s.finished, ev: s.interactions.filter(e => e.event === 'sim_event').map(e => e.kind + ':' + e.detail) }; })()`);

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9337/json")).json()).find((t) => t.type === "page"); } catch {} }
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

  /* ===================== ELECTRICAL — burn-out scenario ===================== */
  console.log("\n— Électrique : scénario d'erreur (sans résistances)");
  const camE = "0,1.3,0.7,0,0.9,0.12";
  check("Électrique chargé, objets générés (builtin)", await open("tp_demo_electrical", camE) && await ev(`${T}.assets.every(a => a.loaded && a.builtin)`), await ev(`${T}.assets.length + ' objets'`));
  check("Repère vert visible pour la plaque (étape 1)", await ev(`${T}.scene.getMeshByName('marker_poste').isEnabled()`));
  await rel("e_plaque", 0.03, 0.9, 0.18);
  await rel("e_batterie", -0.33, 0.9, 0.12);
  check("Plaque + batterie posées → étape 1 validée, passage auto à l'étape 2", await waitFor(`${T}.session.step === 1`, 5000), JSON.stringify((await sum()).ev.slice(0, 3)));
  await rel("e_fils", 0.01, 0.909, 0.19);
  await rel("e_leds", 0.06, 0.909, 0.12);
  await clickMesh("grab_e_interrupteur");
  await sleep(600);
  const burn = await sum();
  check("Mise sous tension pendant le câblage → faute de sécurité", burn.ev.some((e) => e.startsWith("safety_violation")), `fautes=${burn.f}`);
  check("LED sans résistances → LED grillées (dommage enregistré)", burn.ev.some((e) => e.startsWith("damage")) &&
    await ev(`${T}.assets.find(a => a.asset.asset_id === 'e_leds').builtin.materials.led0.albedoColor.r < 0.2`));
  await shot("18-demo-electrique-led-grillees.png");

  /* ===================== ELECTRICAL — success path ===================== */
  console.log("\n— Électrique : parcours réussi");
  await open("tp_demo_electrical", camE);
  await rel("e_plaque", 0.03, 0.9, 0.18);
  await rel("e_batterie", -0.33, 0.9, 0.12);
  await waitFor(`${T}.session.step === 1`, 5000);
  await rel("e_resistances", -0.04, 0.909, 0.12);
  await rel("e_fils", 0.01, 0.909, 0.19);
  check("Résistances + fils → étape 2 validée", await waitFor(`${T}.session.step === 2`, 5000));
  await rel("e_leds", 0.06, 0.909, 0.12);
  check("LED posées → étape 3 validée", await waitFor(`${T}.session.step === 3`, 5000));
  await rel("e_multimetre", -0.36, 0.9, 0.26);
  await sleep(500);
  const lcdBatt = await ev(`${T}.sim.behavior.lcd`);
  check("Multimètre sur la batterie → affiche ≈ 12,6 V", lcdBatt.startsWith("12,6") && lcdBatt.includes("V"), lcdBatt);
  await clickMesh("grab_e_interrupteur");
  check("Interrupteur ON à l'étape 4 → circuit fermé, sans faute", await waitFor(`${T}.sim.flags.has('circuit_on')`, 3000) && (await sum()).f === 0);
  check("LED allumées (émission rouge)", await ev(`${T}.assets.find(a => a.asset.asset_id === 'e_leds').builtin.materials.led0.emissiveColor.r > 0.5`));
  await rel("e_multimetre", 0.15, 0.9, 0.2);
  check("Multimètre près du circuit → I = 23,5 mA, étape 4 validée → TP réussi", await waitFor(`${T}.session.finished`, 5000), await ev(`${T}.sim.behavior.lcd`));
  const okE = await sum();
  check("Analytics : 4 étapes validées par l'action, 0 faute", okE.v === 4 && okE.f === 0 && okE.ev.some((e) => e.includes("23,5 mA")), JSON.stringify(okE.ev.filter((e) => e.startsWith("measure"))));
  await sleep(1200);
  await shot("19-demo-electrique-circuit-ok.png");

  /* ===================== MECHANICAL ===================== */
  console.log("\n— Mécanique : parcours complet");
  const camM = "0.05,1.4,0.85,0,1.0,-0.12";
  check("Mécanique chargé, objets générés", await open("tp_demo_mechanical", camM) && await ev(`${T}.assets.every(a => a.loaded && a.builtin)`));
  await clickMesh("grab_m_sectionneur");
  check("Clic sur le sectionneur → consigné (cadenas visible)", (await flags()).includes("locked_out") &&
    await ev(`${T}.assets.find(a => a.asset.asset_id === 'm_sectionneur').builtin.parts.padlock.isEnabled()`));
  // Look at the pulleys (they are outside the overview camera's field of view).
  await ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(0.6, 1.3, 1.05); const v = c.position.clone(); v.set(0.6, 0.92, 0.4); c.setTarget(v); })()`);
  await sleep(300);
  await clickMesh("grab_m_poulie_m", 1700);
  await clickMesh("grab_m_poulie_r", 1700);
  await ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(0.05, 1.4, 0.85); const v = c.position.clone(); v.set(0, 1.0, -0.12); c.setTarget(v); })()`);
  check("Poulies tenues 1,7 s chacune (inspection) → étape 1 validée", await waitFor(`${T}.session.step === 1`, 5000), JSON.stringify(await ev(`[...${T}.sim.heldSeconds]`)));
  await clickMesh("grab_m_sectionneur");
  const afterUnlock = await sum();
  check("Remise sous tension pendant l'intervention → faute", afterUnlock.f === 1, JSON.stringify(afterUnlock.ev.filter((e) => /violation|damage/.test(e))));
  await clickMesh("grab_m_sectionneur");
  await rel("m_poulie_m", -0.23, 0.95, -0.03);
  await rel("m_poulie_r", 0.27, 0.95, -0.06);
  await rel("m_niveau", 0.02, 0.9, 0.17);
  check("Poulies emboîtées sur les arbres + niveau → étape 2 validée", await waitFor(`${T}.session.step === 2`, 5000));
  await rel("m_courroie", 0.02, 1.0, -0.04);
  check("Courroie relâchée sur les poulies → montée (maillage créé), étape 3 validée",
    await waitFor(`${T}.session.step === 3`, 5000) && await ev(`!!${T}.scene.getMeshByName('mounted_belt')`));
  await rel("m_cle", -0.4, 0.9, -0.17);
  check("Clé sur le tendeur (0,8 s) → tension réglée, étape 4 validée", await waitFor(`${T}.session.step === 4`, 6000));
  await rel("m_boulons", -0.26, 0.92, -0.12);
  await rel("m_cle", -0.22, 0.9, -0.1);
  check("Boulons posés + clé → serrage 25 N·m, TP réussi", await waitFor(`${T}.session.finished`, 6000));
  await clickMesh("grab_m_sectionneur");
  await sleep(1500);
  const rot = await ev(`(() => { const p = id => ${T}.assets.find(a => a.asset.asset_id === id).builtin.parts.spinner.rotation.z; return { m: p('m_poulie_m'), r: p('m_poulie_r') }; })()`);
  check("Essai : déconsignation → les poulies tournent, rapport 10/14", rot.m < -0.5 && Math.abs(rot.r / rot.m - 0.714) < 0.01, `motrice ${rot.m.toFixed(2)} rad, réceptrice ${rot.r.toFixed(2)} rad, rapport ${(rot.r / rot.m).toFixed(3)}`);
  const okM = await sum();
  check("Analytics : 5 étapes validées, 1 faute de sécurité enregistrée", okM.v === 5 && okM.f === 1, `validées=${okM.v} fautes=${okM.f}`);
  await shot("20-demo-mecanique-transmission.png");

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
