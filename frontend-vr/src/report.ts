/**
 * Performance report page: /vr/report.html?tp=<tp_id>&session=<session_id>
 *
 * Shows the deterministic report at once (GET …?ai=0), then the AI feedback when
 * it arrives (GET … with AI, cached server-side). Print / "save as PDF" uses the
 * browser's print dialog (print stylesheet in report.html).
 */

interface StepReport {
  n: number;
  action: string;
  status: "validated" | "done" | "skipped" | "incomplete" | "not_reached";
  status_label: string;
  /** Generated TPs: what the engine checked in this step. */
  verification?: "full" | "partial" | "none" | null;
  unverified?: string[];
  time_sec: number;
  manipulations: number;
  wrong_objects: number;
  safety_faults: string[];
  damages: string[];
  aids: number;
}

interface Report {
  session_id: string;
  tp: { id: string; title: string; domain: string; steps_total: number };
  student: { first_name: string; last_name: string; matricule: string | null } | null;
  started_at: string;
  duration_sec: number;
  finished: boolean;
  interactive: boolean;
  steps: StepReport[];
  totals: Record<StepReport["status"], number> & { safety_faults: number; damages: number; wrong_objects: number; aids: number };
  score: { value: number; max: number; rule: string } | null;
  score_note: string;
  strengths: string[];
  difficulties: string[];
  recommendations: string[];
  ai: { status: string; note: string; feedback?: { summary: string; strengths: string[]; difficulties: string[]; advice: string[] } };
}

const DOMAIN: Record<string, string> = { mechanical: "Mécanique", electrical: "Électricité", chemical: "Chimie", biological: "Biologie", other: "Autre" };

const params = new URLSearchParams(location.search);
const tp = params.get("tp") ?? "";
const session = params.get("session") ?? "";
const app = document.getElementById("app") as HTMLElement;

/** Element helper (text only: no HTML injection from the data). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c !== null) e.append(c);
  return e;
}

const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s` : `${Math.round(s)} s`);

function items(title: string, cls: string, xs: string[], empty: string): HTMLElement {
  return el("section", { class: `card ${cls}` }, el("h2", {}, title), xs.length ? el("ul", { class: "items" }, ...xs.map((x) => el("li", {}, x))) : el("p", { class: "empty" }, empty));
}

function render(r: Report): void {
  const date = new Date(r.started_at);
  const t = r.totals;
  const reached = r.steps.length - t.not_reached;
  const menuUrl = `./${params.get("student") ? `?student=${encodeURIComponent(params.get("student") as string)}` : ""}`;

  const header = el(
    "section",
    { class: "card" },
    el("div", { class: "brand" }, "Rapport individuel de TP · TP-to-xR"),
    el("h1", {}, r.tp.title),
    el(
      "div",
      { class: "meta" },
      el("span", { class: "chip" }, DOMAIN[r.tp.domain] ?? r.tp.domain),
      el("span", {}, `📅 ${date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} à ${date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`),
      el("span", {}, `⏱ ${duration(r.duration_sec)}`),
      el("span", {}, r.finished ? "✔ TP terminé" : "◔ TP interrompu")
    ),
    el(
      "div",
      { class: "student" },
      r.student ? `👤 ${r.student.first_name} ${r.student.last_name}${r.student.matricule ? ` · ${r.student.matricule}` : ""}` : "👤 Étudiant non identifié"
    )
  );

  const tiles = el(
    "section",
    { class: "tiles", "aria-label": "Synthèse" },
    r.interactive
      ? el("div", { class: "tile ok" }, el("div", { class: "v" }, `${t.validated}/${r.steps.length}`), el("div", { class: "l" }, "étapes validées par vos actions"))
      : el("div", { class: "tile info" }, el("div", { class: "v" }, `${t.done}/${r.steps.length}`), el("div", { class: "l" }, "étapes terminées (sans vérification automatique)")),
    el("div", { class: `tile ${t.safety_faults + t.damages ? "bad" : "ok"}` }, el("div", { class: "v" }, String(t.safety_faults + t.damages)), el("div", { class: "l" }, r.interactive ? "fautes de sécurité / dommages" : "fautes détectées (pas de détection pour ce TP)")),
    el("div", { class: "tile" }, el("div", { class: "v" }, `${reached}/${r.steps.length}`), el("div", { class: "l" }, "étapes atteintes")),
    el("div", { class: "tile info" }, el("div", { class: "v" }, String(t.aids)), el("div", { class: "l" }, "aides utilisées"))
  );

  const rows = r.steps.map((s) =>
    el(
      "tr",
      {},
      el("td", { class: "num" }, String(s.n)),
      el(
        "td",
        {},
        s.action,
        ...[...s.safety_faults.map((f) => `⚠ ${f}`), ...s.damages.map((d) => `✖ ${d}`)].map((f) => el("div", { class: "faults" }, f)),
        ...(s.verification === "partial" || s.verification === "none"
          ? [el("div", { class: "unverified" }, `${s.verification === "none" ? "ⓘ Aucune vérification automatique" : "ⓘ Vérification partielle"}${s.unverified?.length ? ` — non vérifié : ${s.unverified.map((u) => u.split(" — ")[0]).join(", ")}` : ""}`)]
          : [])
      ),
      el("td", {}, el("span", { class: `pill s-${s.status}` }, s.status_label)),
      el("td", { class: "num" }, s.status === "not_reached" ? "—" : duration(s.time_sec)),
      el("td", { class: "num" }, s.status === "not_reached" ? "—" : `${s.manipulations}${s.wrong_objects ? ` (${s.wrong_objects} hors consigne)` : ""}`)
    )
  );
  const steps = el(
    "section",
    { class: "card" },
    el("h2", {}, "Étapes"),
    el(
      "div",
      { class: "table-wrap" },
      el("table", {}, el("thead", {}, el("tr", {}, ...["N°", "Étape", "Statut", "Temps", "Manipulations"].map((h) => el("th", { scope: "col" }, h)))), el("tbody", {}, ...rows))
    ),
    el("p", { class: "score" }, r.score ? `Note : ${r.score.value} / ${r.score.max} — ${r.score_note}` : r.score_note)
  );

  const bilan = el(
    "div",
    { class: "grid2" },
    items("Points forts", "strengths", r.strengths, "Aucun point fort enregistré pour cette séance."),
    items("Difficultés observées", "difficulties", r.difficulties, "Aucune difficulté enregistrée.")
  );
  const reco = items("Recommandations", "reco", r.recommendations, "—");
  const ai = el("section", { class: "card ai", id: "ai" }, el("h2", {}, "✨ Analyse pédagogique (IA)"), el("p", { class: "loading" }, "Analyse en cours de rédaction…"));

  const top = el(
    "div",
    { class: "topbar no-print" },
    el("a", { class: "btn", href: menuUrl }, "← Menu"),
    el("div", { class: "actions" }, Object.assign(el("button", { class: "btn primary", type: "button", id: "btn-print" }, "🖨 Imprimer / PDF"), { onclick: () => window.print() }))
  );
  const footer = el("footer", {}, `Rapport établi à partir des événements enregistrés pendant la séance (session ${r.session_id}). ${r.interactive ? "Les étapes « validées » l'ont été par le moteur de simulation." : "Ce TP ne comporte pas de validation automatique des étapes."}`);
  app.replaceChildren(top, header, tiles, steps, bilan, reco, ai, footer);
  document.title = `Rapport — ${r.tp.title}`;
}

function renderAi(r: Report): void {
  const box = document.getElementById("ai");
  if (!box) return;
  const f = r.ai.feedback;
  const parts: Node[] = [el("h2", {}, "✨ Analyse pédagogique (IA)")];
  if (f) {
    parts.push(el("p", {}, f.summary));
    const block = (title: string, xs: string[]) => (xs.length ? [el("h3", {}, title), el("ul", { class: "items" }, ...xs.map((x) => el("li", {}, x)))] : []);
    parts.push(...block("Réussites", f.strengths), ...block("Difficultés expliquées", f.difficulties), ...block("Conseils", f.advice));
  }
  parts.push(el("p", { class: "note" }, r.ai.note));
  box.replaceChildren(...parts);
}

async function fetchReport(ai: boolean): Promise<Report> {
  const res = await fetch(`/api/report/${encodeURIComponent(tp)}/${encodeURIComponent(session)}${ai ? "" : "?ai=0"}`);
  const body = (await res.json()) as { success: boolean; report?: Report; error?: string };
  if (!res.ok || !body.report) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body.report;
}

async function main(): Promise<void> {
  if (!tp || !session) throw new Error("Lien de rapport incomplet.");
  render(await fetchReport(false));
  try {
    renderAi(await fetchReport(true));
  } catch {
    renderAi({ ai: { status: "error", note: "Analyse IA indisponible : le bilan automatique ci-dessus reste complet." } } as Report);
  }
  (window as unknown as { __reportReady?: boolean }).__reportReady = true;
}

main().catch((err) => {
  app.replaceChildren(el("p", { class: "error" }, `Rapport indisponible : ${err instanceof Error ? err.message : String(err)}`), el("a", { class: "btn", href: "./" }, "← Menu"));
  (window as unknown as { __reportReady?: boolean }).__reportReady = true;
});
