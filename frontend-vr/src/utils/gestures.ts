/**
 * Pinch detection with hysteresis + cooldown (pure logic, unit-tested).
 *
 * A pinch starts when two fingertips get closer than `startM` and ends when
 * they move apart beyond `endM`. The gap between both thresholds prevents
 * flickering from hand-tracking jitter; the cooldown prevents double triggers.
 */
export interface PinchOptions {
  startM: number;
  endM: number;
  cooldownMs: number;
}

export const DEFAULT_PINCH: PinchOptions = { startM: 0.018, endM: 0.035, cooldownMs: 600 };

export type PinchEvent = { type: "start" } | { type: "end"; durationMs: number } | null;

export class PinchDetector {
  private pinching = false;
  private startedAt = 0;
  private lastStart = -Infinity;

  constructor(private readonly opts: PinchOptions = DEFAULT_PINCH) {}

  /** True while a pinch is held. */
  public get active(): boolean {
    return this.pinching;
  }

  /**
   * Feeds one fingertip distance sample (meters) at time `now` (ms).
   * @returns "start" / "end" on transitions, null otherwise
   */
  public update(distanceM: number, now: number): PinchEvent {
    if (!Number.isFinite(distanceM)) return null;
    if (!this.pinching && distanceM < this.opts.startM && now - this.lastStart >= this.opts.cooldownMs) {
      this.pinching = true;
      this.startedAt = now;
      this.lastStart = now;
      return { type: "start" };
    }
    if (this.pinching && distanceM > this.opts.endM) {
      this.pinching = false;
      return { type: "end", durationMs: now - this.startedAt };
    }
    return null;
  }

  /** Forgets the current state (e.g. hand lost by the tracker). */
  public reset(): void {
    this.pinching = false;
  }
}
