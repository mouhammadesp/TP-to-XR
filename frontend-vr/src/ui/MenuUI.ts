/**
 * MenuUI — home, domain choice and library of generated TPs (HTML overlay
 * over the 3D workshop). One <section id="view-…"> per state; the state
 * machine decides which one is visible.
 */
import { AppState, DOMAINS, StateManager } from "../utils/stateManager";

const VIEWS: Partial<Record<AppState, string>> = {
  home: "view-home",
  domain: "view-domain",
  identity: "view-identity",
  upload: "view-upload",
  loading: "view-loading",
  library: "view-library",
};

const DOMAIN_LABEL: Record<string, string> = Object.fromEntries(DOMAINS.map((d) => [d.value, `${d.icon} ${d.label}`]));

export class MenuUI {
  constructor(private readonly sm: StateManager, private readonly onOpenTp: (tpId: string, title: string) => void) {
    this.byId("btn-start").addEventListener("click", () => sm.go("domain"));
    this.byId("btn-library").addEventListener("click", () => sm.go("library"));
    // "← Retour" buttons carry their target state in data-back.
    document.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((b) =>
      b.addEventListener("click", () => {
        const target = b.dataset.back as AppState;
        if (sm.can(target)) sm.go(target);
      })
    );
    // Optional institution logos: hidden if the files are not provided.
    document.querySelectorAll<HTMLImageElement>(".brand img").forEach((img) => {
      img.addEventListener("error", () => img.remove());
      if (img.complete && img.naturalWidth === 0) img.remove();
    });
    this.renderDomains();
    void this.renderDemos();
  }

  /** "Démo mécanique / électrique" buttons, from GET /api/demo (no API key needed). */
  private async renderDemos(): Promise<void> {
    try {
      const { demos } = (await (await fetch("/api/demo")).json()) as { demos: { id: string; title: string; domain: string; steps: number }[] };
      const box = this.byId("demo-buttons");
      box.replaceChildren();
      for (const d of demos) {
        const meta = DOMAINS.find((x) => x.value === d.domain);
        const btn = document.createElement("button");
        btn.className = "demo";
        btn.dataset.tp = d.id;
        btn.style.setProperty("--accent", meta?.color ?? "#5F7380");
        btn.title = `${d.title} (${d.steps} étapes)`;
        btn.textContent = `${meta?.icon ?? "🧪"} Démo ${meta?.label.toLowerCase() ?? d.domain}`;
        btn.addEventListener("click", () => this.onOpenTp(d.id, d.title));
        box.append(btn);
      }
      this.byId("demo-block").hidden = demos.length === 0;
    } catch {
      /* demos are optional */
    }
  }

  /** Shows the section of `state` (hides the whole overlay in "vr"). */
  public show(state: AppState): void {
    const menu = this.byId("menu");
    menu.hidden = state === "vr";
    for (const [s, id] of Object.entries(VIEWS)) this.byId(id).hidden = s !== state;
    const focusable = menu.querySelector<HTMLElement>(`#${VIEWS[state] ?? "x"} [data-autofocus]`);
    focusable?.focus();
    if (state === "library") void this.renderLibrary();
  }

  /** The 5 domain cards. */
  private renderDomains(): void {
    const grid = this.byId("domain-grid");
    grid.replaceChildren();
    for (const d of DOMAINS) {
      const btn = document.createElement("button");
      btn.className = "domain-card";
      btn.style.setProperty("--accent", d.color);
      btn.dataset.domain = d.value;
      btn.append(
        Object.assign(document.createElement("span"), { className: "icon", textContent: d.icon }),
        Object.assign(document.createElement("span"), { className: "name", textContent: d.label })
      );
      btn.addEventListener("click", () => this.sm.go("identity", { domain: d.value, pendingTp: null }));
      grid.append(btn);
    }
  }

  /** Lists TPs already generated on the server (newest first). */
  private async renderLibrary(): Promise<void> {
    const list = this.byId("library-list");
    list.replaceChildren(Object.assign(document.createElement("li"), { className: "muted", textContent: "Chargement…" }));
    try {
      const res = await fetch("/api/tp");
      const { tps } = (await res.json()) as { tps: { id: string; title: string; domain: string; assets: number; created_at: string }[] };
      list.replaceChildren();
      if (!tps.length) {
        list.append(Object.assign(document.createElement("li"), { className: "muted", textContent: "Aucun TP généré pour l'instant." }));
        return;
      }
      for (const t of tps) {
        const btn = document.createElement("button");
        btn.className = "tp-row";
        btn.append(
          Object.assign(document.createElement("strong"), { textContent: t.title }),
          Object.assign(document.createElement("span"), {
            className: "muted",
            textContent: `${DOMAIN_LABEL[t.domain] ?? t.domain} · ${t.assets} objets · ${new Date(t.created_at).toLocaleString("fr-FR")}`,
          })
        );
        btn.addEventListener("click", () => this.onOpenTp(t.id, t.title));
        const li = document.createElement("li");
        li.append(btn);
        list.append(li);
      }
    } catch {
      list.replaceChildren(Object.assign(document.createElement("li"), { className: "error", textContent: "Serveur injoignable." }));
    }
  }

  private byId(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }
}

export { DOMAIN_LABEL };
