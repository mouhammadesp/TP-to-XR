// E2E — palier P1: a NEW PDF (never authored as a demo) → automatic pipeline (real LLM + Sketchfab)
// → generated rules → manipulations in the room → validation by the engine → report.
//
// The script knows NOTHING about the TP: it reads the generated rules from the manifest and plays
// each expected action (drop on the target, hold in hand, bring close), plus negative checks.
//
//   node tools/e2e/e2e-p1.mjs <base-url> <out-dir> <pdf> [domain]
//   e.g. node tools/e2e/e2e-p1.mjs http://localhost:3000 docs/screenshots docs/tp-exemples/TP_aimant_boussole.pdf other
//
// Needs: backend running with TOGETHER_API_KEY (+ SKETCHFAB_API_KEY for real models), frontend built,
// Google Chrome. Drops go through Simulation.debugRelease() — the same code path as a real release
// (snap + rules); "inspect" uses real mouse events (press, hold 2.3 s, release).
import { spawn } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const [base, outDir, pdfPath, domain = "other"] = process.argv.slice(2);
if (!base || !outDir || !pdfPath) {
  console.error("usage: node e2e-p1.mjs <base-url> <out-dir> <pdf> [domain]");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
setTimeout(() => { console.log("❌ watchdog: test bloqué > 8 min"); process.exit(2); }, 480_000).unref();

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800",
  "--remote-debugging-port=9341", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "p1-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const errors = [];
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] ?? "eval error");
  return r.result.value;
};
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(200); } return false; };
const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: 1 });
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); console.log(`   📸 ${name}`); };
const T = "window.__tpxr";
const J = JSON.stringify;

/** Points the camera at a world point (from `from`, relative). */
const look = (p, from = { x: 0, y: 0.45, z: 0.75 }) =>
  ev(`(() => { const c = ${T}.scene.activeCamera; c.position.set(${p.x + from.x}, ${p.y + from.y}, ${p.z + from.z}); c.setTarget(new c.position.constructor(${p.x}, ${p.y}, ${p.z})); return true; })()`);
/** Student's view: the bench, the instruction board and the feedback card. */
const overview = () => look({ x: 0.25, y: 1.25, z: -0.9 }, { x: -0.1, y: 0.4, z: 2.45 });
const assetPos = (id) => ev(`(() => { const a = ${T}.assets.find(x => x.asset.asset_id === ${J(id)}); const p = a.handle.position; return { x: p.x, y: p.y, z: p.z }; })()`);
const targetPos = (id) => ev(`(() => { const t = ${T}.sim.target(${J(id)}); return { ...t.position, radius: t.radius }; })()`);
const release = (id, p) => ev(`${T}.sim.debugRelease(${J(id)}, ${p.x}, ${p.y}, ${p.z}), true`);
const stepNow = () => ev(`${T}.session.step`);
const statuses = () => ev(`${T}.session.stepsDetail().map(d => d.status)`);

/** Real mouse: press on the object, hold `ms`, release (desktop grab → "held" condition). */
async function holdWithMouse(id, ms) {
  const p = await assetPos(id);
  await look({ x: p.x, y: p.y + 0.05, z: p.z }, { x: 0, y: 0.25, z: 0.55 });
  await sleep(400);
  const s = await ev(`${T}.screenOf(${J(`grab_${id}`)})`);
  await mouse("mouseMoved", s.x, s.y); await sleep(150);
  await mouse("mousePressed", s.x, s.y, 1); await sleep(ms);
  await mouse("mouseReleased", s.x, s.y); await sleep(500);
}

/** Opens the TP in the student view and waits for the engine. */
async function open(tpId, student) {
  await send("Page.navigate", { url: `${base}/vr/?tp=${tpId}&debug=1&student=${student}&sound=0&cam=0,1.55,1.35,0,0.95,0` });
  await sleep(500);
  return waitFor(`!!${T}?.session && ${T}.assets?.every(a => a.loaded || a.error !== undefined)`, 90000);
}

try {
  /* ============================ 1. Automatic generation ============================ */
  console.log(`\n— Génération automatique : ${path.basename(pdfPath)}`);
  const pdf = readFileSync(pdfPath);
  const started = Date.now();
  const up = await (await fetch(`${base}/api/pipeline?domain=${domain}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: pdf })).json();
  check("PDF accepté par le pipeline", up.success && up.jobId, up.jobId);
  let job;
  for (let i = 0; i < 150; i++) {
    const r = await (await fetch(`${base}/api/pipeline/${up.jobId}`)).json();
    job = r.job ?? r;
    if (job.status !== "running") break;
    await sleep(2000);
  }
  check("Pipeline terminé sans intervention", job.status === "done", `${Math.round((Date.now() - started) / 1000)} s · ${job.steps.map((s) => `${s.name}:${s.status}`).join(" ")}`);
  const ia = job.steps.find((s) => s.name === "interactions");
  check("Étape « interactions » exécutée (IA + contrôle déterministe)", ia?.status === "done", ia?.detail);
  check("Au moins une étape vérifiable générée", job.result?.checked_steps >= 1, `${job.result?.checked_steps}/${job.steps.length ? "" : ""}étapes vérifiables`);
  const tpId = job.result.tp_id;

  const manifest = await (await fetch(`${base}/api/tp/${tpId}`)).json();
  const sim = manifest.simulation;
  check("Manifeste : simulation « generic » (aucun module de démo)", sim?.kind === "generic");
  const ids = new Set(manifest.assets.map((a) => a.asset_id));
  const rules = sim.rules;
  check("Règles portant uniquement sur les objets de CE TP, sans identifiant de démo",
    rules.flat().every((c) => !c.asset || ids.has(c.asset)) && !/"(e|m)_[a-z_]+"/.test(J(sim)), [...ids].join(", "));
  const cov = manifest.interactions.steps;
  check("Couverture déclarée pour chaque étape (full / partial / none)", cov.length === manifest.tp.steps.length, cov.map((s) => `${s.step}:${s.coverage}`).join(" "));
  check("Étapes « none » sans règle, étapes vérifiables avec règle", cov.every((s, i) => (s.coverage === "none") === (rules[i].length === 0)));
  console.log("   Étapes et règles générées :");
  manifest.tp.steps.forEach((s, i) => {
    console.log(`   ${s.order}. ${s.action}`);
    rules[i].forEach((c) => console.log(`        ✓ ${c.type.padEnd(6)} ${c.label}`));
    cov[i].unverified.forEach((u) => console.log(`        ○ non vérifié : ${u}`));
  });
  if (manifest.interactions.issues.length) console.log(`   Signalements : \n     - ${manifest.interactions.issues.join("\n     - ")}`);
  writeFileSync(path.join(outDir, "p1-manifest.json"), J(manifest, null, 2));

  /* ============================ 2. Wrong actions / "Suivant" alone ============================ */
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9341/json")).json()).find((t) => t.type === "page"); } catch {} }
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

  console.log("\n— Actions incorrectes (nouvelle session)");
  check("TP généré chargé dans la salle, moteur de validation actif", await open(tpId, "p1_neg") && await waitFor(`!!${T}.sim`, 30000) && await ev(`${T}.sim.spec.kind === 'generic'`));
  const firstChecked = rules.findIndex((r) => r.length);
  await ev(`${T}.onButton && (() => { for (let k = 0; k < ${firstChecked}; k++) ${T}.onButton('next', 'button'); return true; })()`);
  await waitFor(`${T}.session.step === ${firstChecked}`, 5000);
  const c0 = rules[firstChecked][0];
  if (c0.type === "placed" || c0.type === "near") {
    const t = await targetPos(c0.target);
    await release(c0.asset, { x: t.x + 0.9, y: 0.9, z: t.z - 0.45 }); // far from the target
    await ev(`new Promise(r => setTimeout(r, 600))`);
    check(`Objet posé au mauvais endroit (${c0.asset}) → condition non remplie`, (await ev(`${T}.sim.checklist()[0].done`)) === false);
  } else {
    await holdWithMouse(c0.asset, 500);
    check("Saisie trop brève (0,5 s < 2 s) → inspection non validée", (await ev(`${T}.sim.checklist()[0].done`)) === false);
  }
  check("Étape non validée tant que l'action attendue n'est pas faite", (await ev(`${T}.sim.stepValidated`)) === false);
  await ev(`${T}.onButton('next', 'button'), true`);
  await sleep(300);
  check("« Suivant » sans action → étape « passée », jamais « validée »", (await statuses())[firstChecked] === "skipped", J(await statuses()));

  /* ============================ 3. The expected manipulations ============================ */
  console.log("\n— Manipulations attendues (nouvelle session)");
  await open(tpId, "p1_test");
  await waitFor(`!!${T}.sim`, 30000);
  await sleep(1200);
  let shotBefore = false;
  let shotNone = false;
  for (let i = 0; i < rules.length; i++) {
    await waitFor(`${T}.session.step === ${i}`, 6000);
    const rule = rules[i];
    if (!rule.length) {
      check(`Étape ${i + 1} : non vérifiable → aucune validation possible, « Suivant » pour continuer`, (await ev(`${T}.sim.hasRule()`)) === false);
      if (!shotNone) { await overview(); await sleep(500); await shot("64-p1-etape-non-verifiable.png"); shotNone = true; }
      if (i === rules.length - 1) break;
      await ev(`${T}.onButton('next', 'button'), true`);
      continue;
    }
    for (const c of rule) {
      if (c.type === "placed") {
        const start = await assetPos(c.asset);
        const t = await targetPos(c.target);
        if (!shotBefore) { await overview(); await sleep(500); await shot("62-p1-repere-vert-etape-generee.png"); shotBefore = true; }
        await look(t);
        await sleep(300);
        // Released a few cm off the target, inside its capture radius: the engine must snap it.
        await release(c.asset, { x: t.x + Math.min(0.04, t.radius / 2), y: t.y, z: t.z + 0.02 });
        await sleep(400);
        const p = await assetPos(c.asset);
        check(`Étape ${i + 1} — poser : ${c.label}`, await ev(`${T}.sim.isPlaced(${J(c.asset)}, ${J(c.target)})`),
          `départ (${start.x.toFixed(2)}, ${start.y.toFixed(2)}, ${start.z.toFixed(2)}) → (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      } else if (c.type === "held") {
        await holdWithMouse(c.asset, 2300);
        check(`Étape ${i + 1} — inspecter (souris réelle, 2,3 s) : ${c.label}`, await waitFor(`${T}.session.step !== ${i} || ${T}.sim.stepValidated`, 3000));
      } else if (c.type === "near") {
        const t = await targetPos(c.target);
        await look(t);
        const startD = await ev(`${T}.sim.distanceTo(${J(c.asset)}, ${J(c.target)})`);
        await release(c.asset, { x: t.x + c.distance * 0.6, y: 0.9, z: t.z });
        await sleep(400);
        check(`Étape ${i + 1} — approcher : ${c.label}`, await waitFor(`${T}.sim.near.has(${J(`${c.asset}@${c.target}`)}) || ${T}.session.step !== ${i}`, 3000),
          `${startD.toFixed(2)} m → ${(c.distance * 0.6).toFixed(2)} m (seuil ${c.distance} m)`);
      }
    }
    const ok = await waitFor(`${T}.session.stepsDetail()[${i}].status === 'validated' || ${T}.session.summary().interactions.some(e => e.kind === 'step_validated' && e.step === ${i + 1})`, 4000);
    check(`Étape ${i + 1} validée par le moteur (événement step_validated)`, ok);
    if (i === firstChecked) { await overview(); await sleep(450); await shot("63-p1-etape-generee-validee.png"); }
    if (i < rules.length - 1) await waitFor(`${T}.session.step === ${i + 1}`, 4000);
  }
  if (!(await ev(`${T}.session.finished`))) await ev(`${T}.onButton('next', 'button'), true`);
  await waitFor(`${T}.session.finished`, 5000);
  await overview();
  await sleep(600);
  await shot("65-p1-fin-tp-genere.png");
  const st = await statuses();
  check("Statuts finaux : étapes vérifiables « validated », non vérifiables « done » (jamais « validated »)",
    st.every((s, i) => (rules[i].length ? s === "validated" : s === "done")), J(st));

  /* ============================ 4. Report ============================ */
  console.log("\n— Rapport de performance");
  const sid = await ev(`${T}.session.sessionId`);
  await ev(`${T}.analytics.send(${T}.session.summary(navigator.userAgent)).then(() => true)`);
  const rep = (await (await fetch(`${base}/api/report/${tpId}/${sid}?ai=0`)).json()).report;
  check("Rapport : étapes validées / non vérifiées cohérentes", rep.interactive && rep.steps.every((s, i) => s.status === st[i]) && rep.totals.validated === st.filter((s) => s === "validated").length,
    `${rep.totals.validated} validées, ${rep.totals.done} non vérifiées`);
  check("Rapport : couverture de vérification par étape", rep.steps.every((s, i) => s.verification === cov[i].coverage));
  await send("Page.navigate", { url: `${base}/vr/report.html?tp=${tpId}&session=${sid}&student=p1_test&ai=0` });
  await waitFor(`document.querySelectorAll('tbody tr').length > 0`, 20000);
  await sleep(800);
  await shot("66-p1-rapport-tp-genere.png");

  check("Aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  check("crashed", false, err?.stack ?? String(err));
} finally {
  chrome.kill();
  ws?.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
