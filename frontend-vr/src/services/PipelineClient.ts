/**
 * PipelineClient — uploads a TP PDF and follows the backend job until done.
 * Pure logic with an injectable fetch/clock (unit-tested without a server).
 *
 *   POST /api/pipeline?domain=…   (raw PDF body)  → { jobId }
 *   GET  /api/pipeline/:id                         → { job: { status, steps, current_step, progress, result, error } }
 */
import type { Domain } from "../utils/stateManager";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type StepName = "extract" | "parse" | "interactions" | "queries" | "search" | "download" | "placement" | "manifest";

export const STEP_LABELS: readonly { name: StepName; label: string }[] = [
  { name: "extract", label: "Extraction du texte du PDF" },
  { name: "parse", label: "Analyse du TP (IA)" },
  { name: "interactions", label: "Manipulations vérifiables (IA + contrôle)" },
  { name: "queries", label: "Requêtes de recherche 3D" },
  { name: "search", label: "Recherche des modèles Sketchfab" },
  { name: "download", label: "Téléchargement des modèles" },
  { name: "placement", label: "Placement dans l'atelier" },
  { name: "manifest", label: "Génération de la scène" },
];

export interface JobStepView {
  name: StepName;
  status: "pending" | "running" | "done" | "skipped" | "error";
  ms?: number;
  detail?: string;
}

export interface JobView {
  id: string;
  status: "running" | "done" | "error";
  steps: JobStepView[];
  current_step: StepName | null;
  progress: number;
  warnings: string[];
  error?: string;
  usage?: { estimatedCostUSD: number };
  result?: { tp_id: string; title: string; domain: Domain; assets: number; models: number };
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Consecutive network failures tolerated while polling (Wi-Fi blips). */
  maxNetworkErrors?: number;
  signal?: AbortSignal;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class PipelineClient {
  constructor(
    private readonly fetchFn: FetchFn = (i, init) => fetch(i, init),
    private readonly base = "/api/pipeline",
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Checks a file before upload: extension/type, size, and the %PDF- header.
   * @returns null if OK, otherwise a French error message for the UI
   */
  public static async validate(file: Blob & { name?: string; type: string }): Promise<string | null> {
    const name = file.name ?? "";
    if (file.type !== "application/pdf" && !name.toLowerCase().endsWith(".pdf")) {
      return "Ce fichier n'est pas un PDF.";
    }
    if (file.size === 0) return "Le fichier est vide.";
    if (file.size > MAX_PDF_BYTES) return `Fichier trop lourd (${(file.size / 1024 / 1024).toFixed(1)} Mo, max 20 Mo).`;
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== "%PDF-") return "Le fichier ne semble pas être un PDF valide.";
    return null;
  }

  /**
   * Sends the PDF and starts a pipeline job.
   * @returns the job id
   */
  public async upload(file: Blob, domain: Domain | null): Promise<string> {
    const url = domain ? `${this.base}?domain=${encodeURIComponent(domain)}` : this.base;
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
    } catch {
      // fetch() only throws on network failure: the request never reached the server.
      throw new Error(NETWORK_ERROR);
    }
    const body = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
    if (!res.ok || !body?.jobId) throw new Error(explain(res.status, body?.error));
    return body.jobId;
  }

  /** PDFs dropped on the PC (backend/data/pdf-inbox). */
  public async listInbox(): Promise<{ name: string; size: number; modified: string }[]> {
    const res = await this.fetchFn(`${this.base}/inbox`);
    const body = (await res.json().catch(() => null)) as { files?: { name: string; size: number; modified: string }[] } | null;
    return body?.files ?? [];
  }

  /** Starts the pipeline on a PDF of the PC inbox (no upload from the headset). */
  public async startFromInbox(file: string, domain: Domain | null): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, domain }),
      });
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    const body = (await res.json().catch(() => null)) as { jobId?: string; error?: string } | null;
    if (!res.ok || !body?.jobId) throw new Error(explain(res.status, body?.error));
    return body.jobId;
  }

  /** Fetches the current job state. */
  public async status(jobId: string): Promise<JobView> {
    const res = await this.fetchFn(`${this.base}/${encodeURIComponent(jobId)}`);
    const body = (await res.json().catch(() => null)) as { job?: JobView; error?: string } | null;
    if (!res.ok || !body?.job) throw new Error(explain(res.status, body?.error));
    return body.job;
  }

  /**
   * Polls until the job is done; calls `onUpdate` on every answer.
   * @throws on job error, timeout, abort, or too many consecutive network errors
   */
  public async waitFor(jobId: string, onUpdate: (job: JobView) => void, opts: WaitOptions = {}): Promise<JobView> {
    const { intervalMs = 1000, timeoutMs = 5 * 60_000, maxNetworkErrors = 5, signal } = opts;
    const deadline = this.now() + timeoutMs;
    let networkErrors = 0;
    for (;;) {
      if (signal?.aborted) throw new Error("Annulé");
      let job: JobView | null = null;
      try {
        job = await this.status(jobId);
        networkErrors = 0;
      } catch (err) {
        // A 404 means the job is gone (server restarted): no point retrying.
        if (err instanceof Error && err.message.startsWith("Introuvable")) throw err;
        if (++networkErrors > maxNetworkErrors) throw err;
      }
      if (job) {
        onUpdate(job);
        if (job.status === "done") return job;
        if (job.status === "error") throw new Error(job.error ?? "Échec du pipeline");
      }
      if (this.now() > deadline) throw new Error("Délai dépassé (5 min) — le serveur met trop de temps.");
      await this.sleep(intervalMs);
    }
  }
}

export const NETWORK_ERROR =
  "Connexion au serveur perdue : la requête n'est pas arrivée. Casque bien branché en USB ? Sur le PC, lancer « tools/quest.ps1 -Watch », puis réessayer.";

/** Turns an HTTP failure into a message a teacher can act on. */
function explain(status: number, serverMessage?: string): string {
  if (status === 404) return `Introuvable${serverMessage ? ` : ${serverMessage}` : ""}`;
  if (status === 503) {
    return `Service indisponible : ${serverMessage ?? "clé API manquante côté serveur"} (vérifier backend/.env).`;
  }
  if (status === 413) return "Fichier trop lourd pour le serveur (max 20 Mo).";
  if (status === 0 || Number.isNaN(status)) return "Serveur injoignable.";
  return serverMessage ?? `Erreur serveur (${status})`;
}
