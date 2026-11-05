/**
 * Short feedback sounds, synthesized with Web Audio (no audio file to download).
 * Optional: off with ?sound=0, toggled with the M key. Quiet by design.
 */
export type Cue = "success" | "finish" | "error";

/** Notes (Hz, start s, duration s) of each cue. */
const CUES: Record<Cue, [number, number, number][]> = {
  success: [[659.25, 0, 0.16], [987.77, 0.09, 0.22]], // E5 → B5: bright, short
  finish: [[523.25, 0, 0.18], [659.25, 0.1, 0.18], [783.99, 0.2, 0.32]], // C-E-G
  error: [[233.08, 0, 0.18], [196.0, 0.12, 0.24]], // soft low descending
};

export class Sounds {
  private ctx: AudioContext | null = null;

  constructor(public enabled = true) {
    // Browsers only allow audio after a user gesture: unlock on the first one.
    const unlock = () => {
      void this.context()?.resume();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  public play(cue: Cue): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime + 0.01;
    for (const [freq, start, dur] of CUES[cue]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = cue === "error" ? "triangle" : "sine";
      osc.frequency.value = freq;
      // Soft attack / exponential release: no clicks.
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.exponentialRampToValueAtTime(cue === "error" ? 0.06 : 0.08, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.02);
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.ctx = Ctor ? new Ctor() : null;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }
}
