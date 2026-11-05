/**
 * App state machine (pure, unit-tested).
 *
 *   home ──► domain ──► identity ──► upload ──► loading ──► vr
 *    │  ◄──    │  ◄──       │  ◄──      │  ◄──      │
 *    ├──► library ──► identity ──────────────────────────► vr
 *    └──► identity ──► vr  (built-in demo TPs)
 *
 * "identity" (student's name) comes before every TP launched from the menu;
 * `pendingTp` is the TP to open once it is filled in (demo / library), otherwise
 * the student goes on to the PDF import. Deep links (?tp=…) still go home → vr.
 *
 * Only the transitions listed in TRANSITIONS are allowed; anything else throws,
 * which catches wiring mistakes early. "vr" is terminal: leaving a TP reloads
 * the page (simplest way to free every model, texture and XR resource).
 */

export type AppState = "home" | "domain" | "identity" | "upload" | "loading" | "library" | "vr";

export type Domain = "mechanical" | "electrical" | "chemical" | "biological" | "other";

/** Menu cards for the 5 domains. */
export const DOMAINS: readonly { value: Domain; label: string; icon: string; color: string }[] = [
  { value: "mechanical", label: "Mécanique", icon: "⚙️", color: "#7B4FB0" },
  { value: "electrical", label: "Électrique", icon: "⚡", color: "#1E78C8" },
  { value: "chemical", label: "Chimie", icon: "🧪", color: "#2E8B57" },
  { value: "biological", label: "Biologie", icon: "🧬", color: "#D9822B" },
  { value: "other", label: "Autre", icon: "❓", color: "#5F7380" },
];

export const TRANSITIONS: Record<AppState, readonly AppState[]> = {
  home: ["domain", "library", "identity", "vr"],
  domain: ["home", "identity"],
  identity: ["home", "domain", "library", "upload", "vr"],
  upload: ["identity", "domain", "loading"],
  loading: ["vr", "upload"],
  library: ["home", "identity", "vr"],
  vr: [],
};

export interface AppContext {
  domain: Domain | null;
  file: File | null;
  /** PDF chosen from the PC inbox instead of a local file. */
  inboxFile: string | null;
  jobId: string | null;
  tpId: string | null;
  /** TP to open after the identity form (demo / library); null → PDF import. */
  pendingTp: string | null;
  /** When the pipeline was started (ms), to show elapsed time. */
  startedAt: number | null;
}

type Listener = (state: AppState, previous: AppState, ctx: Readonly<AppContext>) => void;

export class StateManager {
  private current: AppState;
  private readonly ctx: AppContext = { domain: null, file: null, inboxFile: null, jobId: null, tpId: null, pendingTp: null, startedAt: null };
  private readonly listeners: Listener[] = [];

  constructor(initial: AppState = "home") {
    this.current = initial;
  }

  public get state(): AppState {
    return this.current;
  }

  public get context(): Readonly<AppContext> {
    return this.ctx;
  }

  /** True if `next` is reachable from the current state. */
  public can(next: AppState): boolean {
    return TRANSITIONS[this.current].includes(next);
  }

  /**
   * Moves to `next`, merging `patch` into the context first.
   * @throws if the transition is not allowed
   */
  public go(next: AppState, patch: Partial<AppContext> = {}): void {
    if (!this.can(next)) throw new Error(`Illegal transition ${this.current} → ${next}`);
    Object.assign(this.ctx, patch);
    const previous = this.current;
    this.current = next;
    console.log(`🧭 ${previous} → ${next}`);
    for (const l of this.listeners) l(next, previous, this.ctx);
  }

  /** Subscribes to state changes; returns an unsubscribe function. */
  public onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}
