// E2E phase 1 — student identity form + session tracking, privacy of the logs.
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";

setTimeout(() => { console.log("❌ watchdog: test bloqué > 4 min"); process.exit(2); }, 240_000).unref();
const [base, outDir, serverLog, analyticsDir] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,860", "--remote-debugging-port=9349", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "ident-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const jsErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0]); return r.result.value; };
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(250); } return false; };
const shot = async (name) => { await sleep(900); const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); console.log(`   📸 ${name}`); };
const clickSel = async (sel) => {
  const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const [type, buttons] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]]) {
    await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: 1 });
    await sleep(50);
  }
  await sleep(250);
};
/** Clicks until `cond` holds (the first click after a headless page load is sometimes lost). */
const clickUntil = async (sel, cond, tries = 4) => {
  for (let i = 0; i < tries; i++) {
    await clickSel(sel);
    if (await waitFor(cond, 1500)) return true;
  }
  return false;
};
const typeInto = async (sel, text) => {
  await clickSel(sel);
  await ev(`document.querySelector(${JSON.stringify(sel)}).select()`);
  await send("Input.insertText", { text });
};
const key = async (k, code, vk) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  await sleep(300);
};
const FIRST = "Aïssatou", LAST = "Ndiaye Sow", MAT = "ucad-2024/017";

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9349/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url: `${base}/vr/?debug=1&student=ident_test` });
  await waitFor("window.__tpxr?.sm?.state === 'home'", 60000);
  await sleep(600);

  // ── PDF path: domain → identity → upload
  await clickUntil("#btn-start", "window.__tpxr.sm.state === 'domain'");
  await sleep(300);
  await clickUntil(".domain-card[data-domain='electrical']", "window.__tpxr.sm.state === 'identity'");
  check("Domaine choisi → formulaire « Qui réalise ce TP ? »", await waitFor("window.__tpxr.sm.state === 'identity' && !document.getElementById('view-identity').hidden", 5000),
    await ev("window.__tpxr.sm.state + ' / domain view hidden=' + document.getElementById('view-domain').hidden + ' / cards=' + document.querySelectorAll('.domain-card').length + ' / at=' + (() => { const b = document.querySelector(\".domain-card[data-domain='electrical']\").getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return el?.className + '#' + el?.id; })()"));
  check("Seuls prénom, nom, matricule (facultatif) sont demandés", await ev("[...document.querySelectorAll('#identity-form input')].map(i => i.name).join(',')") === "first_name,last_name,matricule");
  await clickSel("#btn-identity");
  check("Envoi vide refusé, erreurs par champ, on reste sur le formulaire", await ev("window.__tpxr.sm.state === 'identity' && !document.getElementById('id-first-err').hidden && !document.getElementById('id-last-err').hidden && document.getElementById('id-matricule-err').hidden"),
    await ev("document.getElementById('id-first-err').textContent + ' | ' + document.getElementById('id-last-err').textContent"));
  await shot("52-identification-erreurs.png");
  await typeInto("#id-first", FIRST);
  await typeInto("#id-last", LAST);
  await typeInto("#id-matricule", MAT);
  await shot("53-identification.png");
  await clickSel("#btn-identity");
  check("Identité valide → écran d'import du PDF", await waitFor("window.__tpxr.sm.state === 'upload'", 5000));
  const saved = await ev("JSON.parse(sessionStorage.getItem('tpxr_identity'))");
  check("Identité normalisée, conservée pour l'onglet", saved?.first_name === FIRST && saved?.last_name === "NDIAYE SOW" && saved?.matricule === "UCAD-2024/017", JSON.stringify(saved));
  await clickSel("#view-upload [data-back]");
  check("← Retour depuis l'import → formulaire pré-rempli", await waitFor("window.__tpxr.sm.state === 'identity'", 3000) && await ev(`document.getElementById('id-first').value === ${JSON.stringify(FIRST)}`));
  await clickSel("#identity-back");
  check("← Retour depuis le formulaire → choix du domaine", await waitFor("window.__tpxr.sm.state === 'domain'", 3000));

  // ── Demo path: home → identity (pre-filled, TP title) → TP
  await clickSel("#view-domain [data-back]");
  await waitFor("window.__tpxr.sm.state === 'home'", 3000);
  await waitFor("document.querySelector(\".demo[data-tp='tp_demo_electrical']\")", 8000);
  await clickSel(".demo[data-tp='tp_demo_electrical']");
  check("Démo → formulaire avec l'intitulé du TP et « Commencer le TP »", await waitFor("window.__tpxr.sm.state === 'identity'", 3000) &&
    await ev("document.getElementById('identity-tp').textContent.startsWith('TP :') && document.getElementById('btn-identity').textContent.includes('Commencer')"),
    await ev("document.getElementById('identity-tp').textContent"));
  await clickSel("#btn-identity");
  check("TP lancé avec l'identité associée à la session", await waitFor("!!window.__tpxr?.session", 90000) && await ev(`window.__tpxr.session.identity?.last_name === "NDIAYE SOW"`));
  const sid = await ev("window.__tpxr.session.sessionId");
  // Board header shows the name (monitor close-up)
  await ev("(() => { const c = window.__tpxr.scene.activeCamera; c.position.set(0, 1.72, 0.5); const t = c.position.clone(); t.set(0, 1.83, -1.3); c.setTarget(t); })()");
  await shot("54-moniteur-nom-etudiant.png");

  // ── Tracking: aids (labels, review) + per-step detail
  await key("l", "KeyL", 76);
  await key("n", "KeyN", 78);
  await key("p", "KeyP", 80);
  const detail = await ev("window.__tpxr.session.stepsDetail()");
  check("Suivi : aides enregistrées (étiquettes, relecture d'une étape)", detail[0].aids >= 1 && detail[1].aids >= 1, JSON.stringify(detail.slice(0, 2).map((d) => ({ step: d.step, status: d.status, aids: d.aids }))));
  check("Suivi : étape quittée sans validation = « skipped » (TP interactif)", detail[0].status === "skipped", detail[0].status);

  // ── Upload + privacy
  const up = await ev("window.__tpxr.analytics.send(window.__tpxr.session.summary(navigator.userAgent))");
  check("Résultats envoyés et acceptés par le serveur", up?.score_saved === true, JSON.stringify(up));
  const file = path.join(analyticsDir, "tp_demo_electrical", `${sid}.json`);
  const stored = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  check("Session enregistrée avec l'identité et le détail par étape", stored?.student?.last_name === "NDIAYE SOW" && stored?.steps_detail?.length === 4 && stored?.interactive === true, stored ? `${stored.student?.first_name} ${stored.student?.last_name}, ${stored.steps_detail.length} étapes` : "absent");
  const agg = await (await fetch(`${base}/api/analytics/tp_demo_electrical`)).json();
  check("Agrégats du TP sans les noms", !JSON.stringify(agg).includes("NDIAYE") && !JSON.stringify(agg).includes(FIRST));
  const log = readFileSync(serverLog, "utf8");
  check("Journaux du serveur sans données personnelles", log.includes(sid) && !log.includes("NDIAYE") && !log.includes(FIRST) && !log.includes("UCAD-2024"), `ligne : ${log.split("\n").find((l) => l.includes(sid))?.trim()}`);
  check("Aucune erreur JavaScript", jsErrors.length === 0, jsErrors.join(" | "));
} catch (e) { console.log("❌ crashed", e); results.push(false); }
finally { chrome.kill(); ws?.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
