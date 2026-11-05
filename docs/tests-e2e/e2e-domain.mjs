// E2E — PDF → XR domain coherence (real pipeline: LLM + Sketchfab): biology PDF, electricity PDF,
// successive imports in the same page (reported bug), wrong file vs chosen domain.
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

setTimeout(() => { console.log("❌ watchdog: > 12 min"); process.exit(2); }, 720_000).unref();
const [base, outDir] = process.argv.slice(2);
const BIO = "TP_Biologie_Germination_Graines.pdf", ELEC = "TP_mesure_tension.pdf";
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=1280,860", "--remote-debugging-port=9356", `--user-data-dir=${mkdtempSync(path.join(tmpdir(), "dom-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const jsErrors = [];
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0]); return r.result.value; };
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
const waitFor = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await ev(expr)) return true; } catch {} await sleep(300); } return false; };
const shot = async (name) => { await sleep(1500); const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(path.join(outDir, name), Buffer.from(r.data, "base64")); console.log(`   📸 ${name}`); };
const clickSel = async (sel) => {
  const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const [type, buttons] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]]) {
    await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: 1 });
    await sleep(50);
  }
  await sleep(250);
};
const clickUntil = async (sel, cond, tries = 4) => { for (let i = 0; i < tries; i++) { await clickSel(sel); if (await waitFor(cond, 1500)) return true; } return false; };
const state = (s) => `window.__tpxr?.sm?.state === '${s}'`;
const rowSel = (name) => `#inbox-list .inbox-row[data-test='${name}']`;
const tagRows = () => ev(`document.querySelectorAll('#inbox-list .inbox-row').forEach(b => b.dataset.test = b.querySelector('span').textContent.replace('📄 ', ''))`);

/** home → domain → identity → upload (fresh state checks). */
async function toUpload(domain) {
  if (!(await ev(state("home")))) await ev("window.__tpxr.sm.go('home')").catch(() => undefined);
  await clickUntil("#btn-start", state("domain"));
  await clickUntil(`.domain-card[data-domain='${domain}']`, state("identity"));
  await ev("(() => { const f = document.getElementById('id-first'), l = document.getElementById('id-last'); if (!f.value) f.value = 'Test'; if (!l.value) l.value = 'Domaine'; })()");
  await clickUntil("#btn-identity", state("upload"));
  await waitFor("document.querySelectorAll('#inbox-list .inbox-row').length >= 2", 8000);
  await tagRows();
}
/** Selects a PC PDF, imports it, waits for the TP; returns its manifest. */
async function importPdf(name) {
  await clickSel(rowSel(name));
  await clickSel("#btn-upload");
  const sent = await waitFor(state("loading"), 5000);
  const progressName = await ev("document.getElementById('view-loading').innerText");
  const done = await waitFor("!!window.__tpxr?.session", 240000);
  const tpId = new URLSearchParams(await ev("location.search")).get("tp");
  const m = await (await fetch(`${base}/api/tp/${tpId}`)).json();
  return { sent, done, tpId, manifest: m.manifest ?? m, progressName };
}
const ELEC_WORDS = /battery|multimeter|bulb|lamp|wire|clip|voltmeter|resistor|pile|multim|ampoule|cordon/i;
const OFF_TOPIC = /\b(toy|soldier|cavalry|cartoon|figurine|alien|jelly|victorian|candy)\b/i;

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch("http://127.0.0.1:9356/json")).json()).find((t) => t.type === "page"); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") jsErrors.push(d.params.exceptionDetails.exception?.description?.split("\n")[0]);
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url: `${base}/vr/?debug=1&student=dom_test` });
  await waitFor(state("home"), 60000);
  await sleep(600);

  // ── 1. Reported bug, same page: electricity PDF selected, then back → Biologie
  console.log("— Scénario du bug : sélection électrique puis retour → Biologie (même page)");
  await toUpload("electrical");
  await clickSel(rowSel(ELEC));
  check("PDF électrique sélectionné (Importer actif)", await ev("!document.getElementById('btn-upload').disabled && document.getElementById('upload-hint').textContent.includes('TP_mesure_tension')"));
  await clickSel("#view-upload [data-back]");        // → identity
  await clickSel("#identity-back");                 // → domain
  await waitFor(state("domain"), 3000);
  await clickUntil(".domain-card[data-domain='biological']", state("identity"));
  await clickUntil("#btn-identity", state("upload"));
  await waitFor("document.querySelectorAll('#inbox-list .inbox-row').length >= 2", 8000);
  await tagRows();
  check("Retour sur l'import : aucune sélection héritée, « Importer » désactivé", await ev("document.getElementById('btn-upload').disabled && !document.querySelector('.inbox-row.selected') && !document.getElementById('upload-hint').textContent.includes('TP_mesure_tension')"),
    await ev("document.getElementById('upload-hint').textContent"));
  const bio = await importPdf(BIO);
  check("PDF de biologie envoyé (nom affiché pendant la préparation)", bio.sent && bio.progressName.includes(BIO));
  const bm = bio.manifest;
  check("TP biologie : domaine issu du document", bio.done && bm.tp.domain === "biological" && /germination|graine/i.test(bm.tp.title), `${bm.tp.domain} — ${bm.tp.title}`);
  const bioObjects = bm.assets.map((a) => `${a.name} → ${a.source === "sketchfab" ? a.attribution?.title : "boîte provisoire"}`);
  console.log(`   objets : ${bioObjects.join(" · ")}`);
  check("Aucun matériel électrique pour le TP de biologie", !bm.assets.some((a) => ELEC_WORDS.test(a.name) || ELEC_WORDS.test(a.attribution?.title ?? "")));
  check("Aucun modèle hors sujet (jouet, personnage, friandise…) — sinon boîte provisoire", !bm.assets.some((a) => OFF_TOPIC.test(a.attribution?.title ?? "")));
  check("Scène VR : kakémono Biologie, équipements du document", await waitFor("window.__tpxr.kakemono?.shownFile === 'Biologie.jpeg'", 15000),
    `kakémono=${await ev("(window.__tpxr.kakemono && window.__tpxr.kakemono.shownFile) || 'n/a'")}`);
  const sceneNames = await ev("window.__tpxr.assets.map(a => a.asset.name)");
  check("Objets chargés dans la scène = objets du manifeste (pas de reste d'un TP précédent)", JSON.stringify(sceneNames.sort()) === JSON.stringify(bm.assets.map((a) => a.name).sort()), sceneNames.join(", "));
  await ev("(() => { const c = window.__tpxr.scene.activeCamera; c.position.set(0, 1.5, 1.3); const t = c.position.clone(); t.set(0, 0.95, -0.2); c.setTarget(t); })()");
  await shot("64-tp-biologie-graines.png");

  // ── 2. Electricity PDF, successive TP in the same tab (menu reload like "⌂ Menu")
  console.log("— TP d'électricité après le TP de biologie");
  await send("Page.navigate", { url: `${base}/vr/?debug=1&student=dom_test` });
  await waitFor(state("home"), 60000);
  await sleep(600);
  await toUpload("electrical");
  const el = await importPdf(ELEC);
  const em = el.manifest;
  check("TP électricité : domaine électrique", el.done && em.tp.domain === "electrical" && /tension|électricité/i.test(em.tp.title), `${em.tp.domain} — ${em.tp.title}`);
  console.log(`   objets : ${em.assets.map((a) => `${a.name} → ${a.source === "sketchfab" ? a.attribution?.title : "boîte provisoire"}`).join(" · ")}`);
  check("Aucun objet du TP de biologie réutilisé", !em.assets.some((a) => /graine|haricot|coton|gobelet/i.test(a.name)));
  check("Aucun modèle hors sujet", !em.assets.some((a) => OFF_TOPIC.test(a.attribution?.title ?? "")));
  check("Scène VR : kakémono Électrique", await waitFor("window.__tpxr.kakemono?.shownFile === 'Electrique.jpeg'", 15000));

  // ── 3. Wrong file vs chosen domain: the document decides, with a visible warning
  console.log("— PDF électrique importé avec « Biologie » choisi dans le menu");
  const post = await (await fetch(`${base}/api/pipeline/inbox`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: ELEC, domain: "biological" }) })).json();
  let job = null;
  for (let i = 0; i < 160; i++) { await sleep(1500); job = await (await fetch(`${base}/api/pipeline/${post.jobId}`)).json(); if (job.status === "done" || job.status === "error" || job.job?.status === "done") break; }
  const j = job.job ?? job;
  const tpId = j.result?.tp_id;
  const wm = tpId ? await (await fetch(`${base}/api/tp/${tpId}`)).json() : null;
  check("Le document décide : TP électrique malgré le choix « Biologie »", (wm?.manifest ?? wm)?.tp.domain === "electrical", (wm?.manifest ?? wm)?.tp.domain);
  check("Avertissement clair pour l'enseignant", (j.warnings ?? []).some((w) => w.includes("TP de électricité") && w.includes("biologie")), (j.warnings ?? []).find((w) => w.includes("domaine")));
  check("Aucune erreur JavaScript", jsErrors.length === 0, jsErrors.join(" | "));
} catch (e) { console.log("❌ crashed", e); results.push(false); }
finally { chrome.kill(); ws?.close(); }
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
