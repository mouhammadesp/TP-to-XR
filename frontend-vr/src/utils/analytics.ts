/**
 * Learning analytics — session state, scoring and upload.
 *
 * `TPSession` is pure (no DOM, no Babylon) so it is unit-tested; `AnalyticsClient`
 * sends the session summary to POST /api/analytics.
 *
 * Scoring (documented in the report):
 * - steps_completed: steps the student validated (left with "next", or "finish" on the last one);
 * - accuracy_percent: among grabs made during a step that HAS linked objects,
 *   the share that targeted one of those objects. Grabs during steps without
 *   linked objects are not scored. null when nothing was scored yet.
 * - steps_detail: per step, built only from recorded events — status, time, object
 *   manipulations, wrong-object grabs, safety faults / damage, aids used.
 *   Interactive TPs: "validated" only when the validation engine confirmed the step
 *   (step_validated). Other TPs, and steps the engine cannot check: "done" = the
 *   student moved on (not verified).
 */
import type { StudentIdentity } from "./identity";

export type Hand = "left" | "right" | "none";
export type Gesture = "pinch" | "pinch_middle" | "grab" | "point" | "mouse";

export interface HandInteractionEvent {
  timestamp: number;
  event: "hand_interaction";
  hand: Hand;
  gesture: Gesture;
  target_object: string | null;
  duration_ms: number;
  step: number;
  /** For grabs only: did the object belong to the current step? null = not scored. */
  correct: boolean | null;
}

export interface StepChangeEvent {
  timestamp: number;
  event: "step_change";
  from_step: number;
  to_step: number;
  action_time_sec: number;
  via: "button" | "keyboard" | "gesture" | "auto";
}

export type SimEventKind = "step_validated" | "step_skipped" | "safety_violation" | "damage" | "snapped" | "toggle" | "measure" | "near";

export interface SimEvent {
  timestamp: number;
  event: "sim_event";
  kind: SimEventKind;
  detail: string;
  step: number;
}

export interface MarkerEvent {
  timestamp: number;
  event: "session_start" | "session_end" | "xr_enter" | "xr_exit" | "credits_open" | "credits_close";
}

/** Help the student used: object name tags, going back to re-read a step, close-up inspection. */
export type AidKind = "labels" | "review" | "inspect";

export interface AidEvent {
  timestamp: number;
  event: "aid_used";
  aid: AidKind;
  step: number;
}

export type AnalyticsEvent = HandInteractionEvent | StepChangeEvent | MarkerEvent | SimEvent | AidEvent;

/**
 * validated   — confirmed by the validation engine (interactive TPs)
 * done        — the student moved on / finished (no automatic check for this TP)
 * skipped     — interactive TP: left without the step being validated
 * incomplete  — reached but neither validated nor done
 * not_reached — never displayed
 */
export type StepStatus = "validated" | "done" | "skipped" | "incomplete" | "not_reached";

export interface StepDetail {
  step: number;
  status: StepStatus;
  time_sec: number;
  /** Object manipulations (grabs) during the step = attempts. */
  manipulations: number;
  /** Grabs of an object that does not belong to the step (only when the step has linked objects). */
  wrong_objects: number;
  safety_faults: number;
  damages: number;
  aids: number;
}

export interface SessionSummary {
  session_id: string;
  tp_id: string;
  /** Pseudonymous id (logs, aggregates). */
  student_id: string;
  /** Name entered by the student (report only), null when not identified. */
  student: StudentIdentity | null;
  /** The TP has a validation engine (interactive simulation). */
  interactive: boolean;
  started_at: number;
  duration_sec: number;
  accuracy_percent: number | null;
  steps_completed: number;
  steps_total: number;
  finished: boolean;
  /** Interactive TPs: steps validated by actions / safety faults. */
  steps_validated: number;
  safety_violations: number;
  step_times_sec: number[];
  steps_detail: StepDetail[];
  aids_used: number;
  fps: { avg: number; min: number; samples: number } | null;
  device: { xr: boolean; hand_tracking: boolean; user_agent: string };
  interactions: AnalyticsEvent[];
  timestamp: number;
}

/** Max events kept per session (keeps uploads small). */
export const MAX_EVENTS = 5000;

export class TPSession {
  public readonly sessionId: string;
  public readonly startedAt: number;
  private current = 0;
  private stepEnteredAt: number;
  private readonly stepTimes: number[];
  private readonly completed = new Set<number>();
  private readonly events: AnalyticsEvent[] = [];
  private scored = 0;
  private correct = 0;
  private finishedAt: number | null = null;
  private validatedCount = 0;
  private violationCount = 0;
  private fpsSum = 0;
  private fpsMin = Infinity;
  private fpsCount = 0;
  public xrUsed = false;
  public handTrackingUsed = false;
  /** Student identity entered before the TP (null: not identified). */
  public identity: StudentIdentity | null = null;
  /** Set when the TP has a validation engine: steps are then "validated", not just "done". */
  public interactive = false;
  /**
   * Interactive TPs: per step, does the engine check it? A step it cannot check
   * (generated TPs: no supported action) is "done" when left — never "validated" nor "skipped".
   */
  public verifiable: boolean[] | null = null;
  private readonly reached = new Set<number>([0]);
  private readonly validatedSteps = new Set<number>();
  private readonly skippedSteps = new Set<number>();
  private readonly perStep: { manipulations: number; wrong: number; faults: number; damages: number; aids: number }[];

  /**
   * @param stepAssets for each step index, the asset ids that belong to it
   * @param now clock (injectable for tests)
   */
  constructor(
    public readonly tpId: string,
    public readonly studentId: string,
    private readonly stepAssets: Set<string>[],
    private readonly now: () => number = Date.now,
    sessionId?: string
  ) {
    this.sessionId = sessionId ?? `s_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = now();
    this.stepEnteredAt = this.startedAt;
    this.stepTimes = stepAssets.map(() => 0);
    this.perStep = stepAssets.map(() => ({ manipulations: 0, wrong: 0, faults: 0, damages: 0, aids: 0 }));
    this.push({ timestamp: this.startedAt, event: "session_start" });
  }

  /** Current step index (0-based). */
  public get step(): number {
    return this.current;
  }

  public get stepsTotal(): number {
    return this.stepAssets.length;
  }

  public get finished(): boolean {
    return this.finishedAt !== null;
  }

  /** Elapsed seconds (frozen once finished). */
  public elapsedSec(): number {
    return Math.round(((this.finishedAt ?? this.now()) - this.startedAt) / 1000);
  }

  /** Steps validated so far. */
  public stepsCompleted(): number {
    return this.completed.size;
  }

  /** Accuracy in %, or null if no grab was scored. */
  public accuracy(): number | null {
    return this.scored === 0 ? null : Math.round((this.correct / this.scored) * 100);
  }

  /**
   * Moves to step `to` (clamped). Logs a step_change if it actually changes.
   * @returns true if the step changed
   */
  public goTo(to: number, via: StepChangeEvent["via"]): boolean {
    if (this.finished) return false;
    const target = Math.max(0, Math.min(this.stepAssets.length - 1, to));
    if (target === this.current) return false;
    const t = this.now();
    const spent = (t - this.stepEnteredAt) / 1000;
    this.stepTimes[this.current] += spent;
    if (target > this.current) this.completed.add(this.current);
    this.push({
      timestamp: t,
      event: "step_change",
      from_step: this.current + 1,
      to_step: target + 1,
      action_time_sec: Math.round(spent * 10) / 10,
      via,
    });
    this.current = target;
    this.reached.add(target);
    this.stepEnteredAt = t;
    return true;
  }

  public next(via: StepChangeEvent["via"]): boolean {
    return this.goTo(this.current + 1, via);
  }

  public prev(via: StepChangeEvent["via"]): boolean {
    return this.goTo(this.current - 1, via);
  }

  /**
   * Validates the last step and ends the session.
   * @returns false if not on the last step or already finished
   */
  public finish(): boolean {
    if (this.finished || this.current !== this.stepAssets.length - 1) return false;
    const t = this.now();
    this.stepTimes[this.current] += (t - this.stepEnteredAt) / 1000;
    this.completed.add(this.current);
    this.finishedAt = t;
    this.push({ timestamp: t, event: "session_end" });
    return true;
  }

  /**
   * Records a hand/controller/mouse interaction. Grabs on an object are scored
   * against the current step's linked objects.
   */
  public recordInteraction(e: { hand: Hand; gesture: Gesture; target: string | null; durationMs: number }): HandInteractionEvent {
    let correct: boolean | null = null;
    const isGrab = e.gesture !== "point" && e.gesture !== "pinch_middle" && e.target !== null;
    const expected = this.stepAssets[this.current];
    if (isGrab && !this.finished) this.perStep[this.current].manipulations++;
    if (isGrab && !this.finished && expected && expected.size > 0) {
      correct = expected.has(e.target as string);
      this.scored++;
      if (correct) this.correct++;
      else this.perStep[this.current].wrong++;
    }
    const event: HandInteractionEvent = {
      timestamp: this.now(),
      event: "hand_interaction",
      hand: e.hand,
      gesture: e.gesture,
      target_object: e.target,
      duration_ms: Math.round(e.durationMs),
      step: this.current + 1,
      correct,
    };
    this.push(event);
    return event;
  }

  /** Records an interactive-TP event (validation, safety fault, snap, measure…). */
  public recordSim(kind: SimEventKind, detail: string): void {
    if (kind === "step_validated") {
      this.validatedCount++;
      this.validatedSteps.add(this.current);
    }
    if (kind === "step_skipped") this.skippedSteps.add(this.current);
    if (kind === "safety_violation" || kind === "damage") this.violationCount++;
    if (kind === "safety_violation") this.perStep[this.current].faults++;
    if (kind === "damage") this.perStep[this.current].damages++;
    this.push({ timestamp: this.now(), event: "sim_event", kind, detail: detail.slice(0, 200), step: this.current + 1 });
  }

  /** Records the use of an aid on the current step. */
  public recordAid(aid: AidKind): void {
    if (this.finished) return;
    this.perStep[this.current].aids++;
    this.push({ timestamp: this.now(), event: "aid_used", aid, step: this.current + 1 });
  }

  /** Per-step results, derived from the recorded events only. */
  public stepsDetail(): StepDetail[] {
    const live = this.finished ? 0 : (this.now() - this.stepEnteredAt) / 1000;
    return this.perStep.map((p, i) => {
      let status: StepStatus;
      const checked = this.interactive && this.verifiable?.[i] !== false;
      if (checked && this.validatedSteps.has(i)) status = "validated";
      else if (checked && this.skippedSteps.has(i)) status = "skipped";
      else if (!checked && this.completed.has(i)) status = "done";
      else status = this.reached.has(i) ? "incomplete" : "not_reached";
      return {
        step: i + 1,
        status,
        time_sec: Math.round((this.stepTimes[i] + (i === this.current ? live : 0)) * 10) / 10,
        manipulations: p.manipulations,
        wrong_objects: p.wrong,
        safety_faults: p.faults,
        damages: p.damages,
        aids: p.aids,
      };
    });
  }

  public get stepsValidated(): number {
    return this.validatedCount;
  }

  public get safetyViolations(): number {
    return this.violationCount;
  }

  /** Records a marker event (XR enter/exit, credits…). */
  public mark(event: MarkerEvent["event"]): void {
    this.push({ timestamp: this.now(), event });
  }

  /** Adds one FPS sample (e.g. once per second). */
  public addFps(fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) return;
    this.fpsSum += fps;
    this.fpsCount++;
    this.fpsMin = Math.min(this.fpsMin, fps);
  }

  /** Snapshot sent to the backend. */
  public summary(userAgent = ""): SessionSummary {
    const live = this.finished ? 0 : (this.now() - this.stepEnteredAt) / 1000;
    return {
      session_id: this.sessionId,
      tp_id: this.tpId,
      student_id: this.studentId,
      student: this.identity,
      interactive: this.interactive,
      started_at: this.startedAt,
      duration_sec: this.elapsedSec(),
      accuracy_percent: this.accuracy(),
      steps_completed: this.stepsCompleted(),
      steps_total: this.stepAssets.length,
      finished: this.finished,
      steps_validated: this.validatedCount,
      safety_violations: this.violationCount,
      step_times_sec: this.stepTimes.map((s, i) => Math.round((s + (i === this.current ? live : 0)) * 10) / 10),
      steps_detail: this.stepsDetail(),
      aids_used: this.perStep.reduce((n, p) => n + p.aids, 0),
      fps: this.fpsCount
        ? { avg: Math.round(this.fpsSum / this.fpsCount), min: Math.round(this.fpsMin), samples: this.fpsCount }
        : null,
      device: { xr: this.xrUsed, hand_tracking: this.handTrackingUsed, user_agent: userAgent.slice(0, 300) },
      interactions: [...this.events],
      timestamp: this.now(),
    };
  }

  private push(e: AnalyticsEvent): void {
    if (this.events.length < MAX_EVENTS) this.events.push(e);
  }
}

/**
 * Uploads session summaries. The backend stores one file per session_id,
 * so repeated uploads (periodic, on exit, on finish) simply overwrite.
 */
export class AnalyticsClient {
  constructor(private readonly endpoint = "/api/analytics") {}

  /** Normal upload; resolves with the server answer (or null on network error). */
  public async send(summary: SessionSummary): Promise<{ success: boolean; score_saved?: boolean } | null> {
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summary),
        keepalive: true,
      });
      return (await res.json()) as { success: boolean; score_saved?: boolean };
    } catch (err) {
      console.warn("⚠️ analytics upload failed", err);
      return null;
    }
  }

  /** Best-effort upload while the page is closing. */
  public beacon(summary: SessionSummary): void {
    const blob = new Blob([JSON.stringify(summary)], { type: "application/json" });
    if (!navigator.sendBeacon?.(this.endpoint, blob)) void this.send(summary);
  }
}

/** Pseudonymous student id: ?student=… or a random id remembered on this device. */
export function resolveStudentId(param: string | null): string {
  if (param && /^[A-Za-z0-9_-]{1,64}$/.test(param)) return param;
  const key = "tpxr_student_id";
  try {
    const saved = localStorage.getItem(key);
    if (saved) return saved;
    const id = `anon_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `anon_${Math.random().toString(36).slice(2, 10)}`;
  }
}
