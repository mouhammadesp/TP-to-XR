/**
 * ProgressBar — loading view: global bar + the 7 pipeline steps with their
 * status, duration and detail, elapsed time, warnings and errors.
 */
import { JobView, STEP_LABELS } from "../services/PipelineClient";

const ICON: Record<string, string> = { pending: "○", running: "◌", done: "✓", skipped: "–", error: "✕" };

export class ProgressBar {
  private readonly list = this.el("steps-list");
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Resets the view and starts the elapsed-time counter. */
  public start(startedAt: number, fileName: string): void {
    this.el("loading-title").textContent = "Préparation de l'atelier…";
    this.el("loading-file").textContent = fileName;
    this.el("loading-error").hidden = true;
    this.el("loading-actions-error").hidden = true;
    this.el("btn-cancel").hidden = false;
    this.el("loading-warnings").replaceChildren();
    this.setProgress(0);
    this.list.replaceChildren(
      ...STEP_LABELS.map((s) => {
        const li = document.createElement("li");
        li.dataset.step = s.name;
        li.className = "pending";
        li.append(
          Object.assign(document.createElement("span"), { className: "icon", textContent: ICON.pending }),
          Object.assign(document.createElement("span"), { className: "label", textContent: s.label }),
          Object.assign(document.createElement("span"), { className: "detail" })
        );
        return li;
      })
    );
    this.stopTimer();
    const tick = () => (this.el("loading-elapsed").textContent = `${Math.round((Date.now() - startedAt) / 1000)} s`);
    tick();
    this.timer = setInterval(tick, 1000);
  }

  /** Renders one job update. */
  public render(job: JobView): void {
    this.setProgress(job.progress);
    for (const s of job.steps) {
      const li = this.list.querySelector<HTMLLIElement>(`li[data-step="${s.name}"]`);
      if (!li) continue;
      li.className = s.status;
      (li.querySelector(".icon") as HTMLElement).textContent = ICON[s.status] ?? "○";
      const parts = [s.detail, s.ms !== undefined ? `${(s.ms / 1000).toFixed(1)} s` : ""].filter(Boolean);
      (li.querySelector(".detail") as HTMLElement).textContent = parts.join(" · ");
    }
    const warnings = this.el("loading-warnings");
    warnings.replaceChildren(...job.warnings.map((w) => Object.assign(document.createElement("li"), { textContent: w })));
    if (job.status === "done" && job.result) {
      this.el("loading-title").textContent = `Prêt : ${job.result.title}`;
      this.el("btn-cancel").hidden = true;
      this.stopTimer();
    }
  }

  /** Shows a failure with its message and the retry/back actions. */
  public showError(message: string): void {
    this.stopTimer();
    this.el("loading-title").textContent = "Le traitement a échoué";
    const box = this.el("loading-error");
    box.textContent = message;
    box.hidden = false;
    this.el("btn-cancel").hidden = true;
    this.el("loading-actions-error").hidden = false;
    this.list.querySelector("li.running")?.setAttribute("class", "error");
  }

  public stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private setProgress(pct: number): void {
    const bar = this.el("progress-fill");
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    this.el("progress").setAttribute("aria-valuenow", String(Math.round(pct)));
    this.el("progress-pct").textContent = `${Math.round(pct)} %`;
  }

  private el(id: string): HTMLElement {
    return document.getElementById(id) as HTMLElement;
  }
}
