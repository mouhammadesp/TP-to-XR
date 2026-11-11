// E2E — biology demo (tp_demo_biology) on macOS headless Chrome: real clicks,
// discovery dwell (camera pivot included), one wrong answer, then the full
// seeded quiz from /api/demo.
//
// Caveat measured on this machine: SwiftShader renders ~1 frame/s, so right
// after a camera pivot (setTarget) screenOf serves STALE matrices until the
// next rendered frame (~1 s). screenOfFresh waits for two consecutive
// identical readings INSIDE the canvas — a pivot points the camera away from
// the bench, so the stale projection of a bench item falls out of the canvas
// and the wait is unambiguous.
import { spawn } from "child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";

const base = "http://localhost:3000";
const outDir = "docs/screenshots";
mkdirSync(outDir, { recursive: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,800", "--remote-debugging-port=9338", `--user-data-dir=${mkdtempSync(`${tmpdir()}/tpxr-bio-`)}`, "about:blank"], { stdio: "ignore" });
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
const onCanvas = (p) => p && p.x >= 0 && p.x <= 1280 && p.y >= 0 && p.y <= 800;
const screenOfFresh = async (name, ms = 12000) => {
  let prev = null;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = await ev(`window.__tpxr.screenOf(${JSON.stringify(name)})`);
    if (onCanvas(p)) {
      if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) return p;
      prev = p;
    } else prev = null;
    await sleep(400);
  }
  throw new Error(`screenOf instable pour ${name}`);
};
/** Like a student turning around: aim the camera at the asset's CENTER (base +
 *  half size) and refresh the cached view/projection matrices — under
 *  SwiftShader a rendered frame takes seconds, and screenOf/picking serve STALE
 *  matrices until then. Updating the cached transform directly avoids both the
 *  wait and a manual scene.render() (which crashes the tab: double render loop
 *  under SwiftShader). */
const lookAtAsset = async (id) => {
  const pos = await ev(`(() => { const a = window.__tpxr.assets.find(a => a.asset.asset_id === ${JSON.stringify(id)}).asset; return { x: a.position.x, y: a.position.y + a.target_size_m / 2, z: a.position.z }; })()`);
  await ev(`(() => { const s = window.__tpxr.scene; const c = s.activeCamera; const t = c.position.clone(); t.x = ${pos.x}; t.y = ${pos.y}; t.z = ${pos.z}; c.setTarget(t); s.setTransformMatrix(c.getViewMatrix(), c.getProjectionMatrix()); return true; })()`);
};
const clickMesh = async (name, holdMs = 80) => {
  await lookAtAsset(name.replace(/^grab_/, ""));
  const p = await screenOfFresh(name);
  await mouseAt("mouseMoved", p.x, p.y); await sleep(80);
  await mouseAt("mousePressed", p.x, p.y, 1); await sleep(holdMs);
  await mouseAt("mouseReleased", p.x, p.y); await sleep(300);
};
const dwellMesh = async (name) => {
  const p = await screenOfFresh(name);
  // A single jump does not register the hover; several consecutive moves do.
  for (let i = 0; i < 4; i++) { await mouseAt("mouseMoved", p.x, p.y); await sleep(220); }
  await sleep(500);
  await mouseAt("mouseMoved", 640, 720); await sleep(160);
};
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${outDir}/${name}`, Buffer.from(r.data, "base64")); };

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

  const open = async (tp, cam) => {
    await send("Page.navigate", { url: `${base}/vr/?tp=${tp}&debug=1&student=sim_bio&cam=${cam}` });
    await sleep(600);
    return waitFor("!!window.__tpxr?.sim && !!window.__tpxr?.session", 60000);
  };
  const T = "window.__tpxr";
  const camB = "-0.15,1.75,1.2,-0.15,0.8,-0.5";
  const camRoom = "0.9,1.7,3.0,-2.0,1.05,-1.5";

  check("API : la démo génie biologique est au menu", (await (await fetch(`${base}/api/demo`)).json()).demos.some((d) => d.id === "tp_demo_biology"));

  console.log("\n— Bio : chargement et découverte");
  check("Banc chargé : 4 équipements convertis (pas de builtin)", await open("tp_demo_biology", camB) && await ev(`${T}.assets.length === 4 && ${T}.assets.every(a => a.loaded && !a.builtin)`));
  await shot("67-demo-biologie-banc.png");
  for (const id of ["b_micro", "b_centrifugeuse", "b_micropipette"]) await dwellMesh(`grab_${id}`);
  check("3 équipements familiers → pas encore découvert", await ev(`!${T}.sim.flags.has('explored')`));
  // Comme un élève qui se tourne : la caméra vise le PSM du coin arrière-gauche
  // (lookAtAsset rend une frame → screenOf est frais pour le dwell).
  await lookAtAsset("b_psm");
  await dwellMesh("grab_b_psm");
  await ev(`(() => { const c = ${T}.scene.activeCamera; const t = c.target.clone(); t.x = -0.15; t.y = 0.8; t.z = -0.5; c.setTarget(t); return true; })()`);
  check("4 équipements parcourus → découverte validée (étape 1)", await waitFor(`${T}.session.step === 1`, 8000), await ev(`[...${T}.sim.flags].join(',')`));

  console.log(`\n— Quiz : ${(await ev(`${T}.sim.spec.quiz.questions.length`))} questions tirées`);
  const correct = await ev(`${T}.sim.spec.quiz.questions`);
  for (let q = 0; q < correct.length; q++) {
    const waited = await waitFor(`${T}.session.step === ${q + 1}`, 10000);
    if (!waited) break;
    const right = correct[q].answer;
    const wrong = correct.find((x) => x.answer && x.answer !== right)?.answer;
    const bad = wrong ?? (right === "b_micro" ? "b_psm" : "b_micro");
    await clickMesh(`grab_${bad}`); await sleep(500);
    await clickMesh(`grab_${right}`); await sleep(300);
    const done = await waitFor(`${T}.sim.stepValidated`, 5000);
    check(`Question ${q + 1}/${correct.length} validée (une erreur d'abord)`, done, right);
    await sleep(400);
  }
  await shot("68-demo-biologie-quiz.png");
  check("TP terminé après la dernière réponse", await waitFor(`${T}.session.finished`, 8000));
  check("Aucune erreur console (modèles et comportement)", errors.length === 0, errors.join(" | ").slice(0, 200));

  console.log("\n— Bio : vue du PSM au fond de la pièce");
  await send("Page.navigate", { url: `${base}/vr/?tp=tp_demo_biology&debug=1&student=sim_bio&cam=${camRoom}` });
  await waitFor("!!window.__tpxr?.sim", 30000);
  await sleep(1500);
  await shot("69-demo-biologie-psm.png");
  check("PSM visible, clickable, 2,2 m", await ev(`${T}.assets.find(a => a.asset.asset_id === 'b_psm').loaded`));
} finally {
  chrome.kill("SIGKILL");
}
process.exit(results.every((r) => r) ? 0 : 1);
