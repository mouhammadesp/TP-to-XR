/**
 * Learning analytics API (data for the thesis study).
 *
 *   POST /api/analytics            session summary from the student view → { success, score_saved }
 *   GET  /api/analytics/:tpId      all sessions of a TP + aggregates (mean duration, accuracy, time per step)
 *
 * Storage: backend/data/analytics/<tp_id>/<session_id>.json — one file per
 * session, overwritten by later uploads of the same session (periodic + final).
 * Student ids are pseudonymous (?student=… or a random id kept on the device).
 * The name entered before the TP (`student`) is stored with the session for the
 * individual report only: it is never logged and not returned by the aggregates.
 */
import { promises as fsp } from "fs";
import path from "path";
import express, { Router } from "express";
import { z } from "zod";
import { assertTpId } from "../services/tpStore";
import { HttpError, asyncHandler } from "../utils/http";

export const ANALYTICS_DIR = path.resolve(__dirname, "..", "..", "data", "analytics");

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Ts = z.number().int().nonnegative();

const EventSchema = z.discriminatedUnion("event", [
  z.object({
    timestamp: Ts,
    event: z.literal("hand_interaction"),
    hand: z.enum(["left", "right", "none"]),
    gesture: z.enum(["pinch", "pinch_middle", "grab", "point", "mouse"]),
    target_object: z.string().max(100).nullable(),
    duration_ms: z.number().nonnegative(),
    step: z.number().int().positive(),
    correct: z.boolean().nullable(),
  }),
  z.object({
    timestamp: Ts,
    event: z.literal("step_change"),
    from_step: z.number().int().positive(),
    to_step: z.number().int().positive(),
    action_time_sec: z.number().nonnegative(),
    via: z.enum(["button", "keyboard", "gesture", "auto"]),
  }),
  z.object({
    timestamp: Ts,
    event: z.enum(["session_start", "session_end", "xr_enter", "xr_exit", "credits_open", "credits_close"]),
  }),
  z.object({
    timestamp: Ts,
    event: z.literal("aid_used"),
    aid: z.enum(["labels", "review", "inspect"]),
    step: z.number().int().positive(),
  }),
  z.object({
    timestamp: Ts,
    event: z.literal("sim_event"),
    kind: z.enum(["step_validated", "step_skipped", "safety_violation", "damage", "snapped", "toggle", "measure", "near"]),
    detail: z.string().max(200),
    step: z.number().int().positive(),
  }),
]);

/** Same rules as the form (frontend-vr/src/utils/identity.ts). */
const Name = z.string().regex(/^[\p{L}][\p{L}\p{M} .'’-]{0,59}$/u);
export const StudentSchema = z.object({
  first_name: Name,
  last_name: Name,
  matricule: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,29}$/).nullable(),
});

export const StepDetailSchema = z.object({
  step: z.number().int().positive(),
  status: z.enum(["validated", "done", "skipped", "incomplete", "not_reached"]),
  time_sec: z.number().nonnegative(),
  manipulations: z.number().int().nonnegative(),
  wrong_objects: z.number().int().nonnegative(),
  safety_faults: z.number().int().nonnegative(),
  damages: z.number().int().nonnegative(),
  aids: z.number().int().nonnegative(),
});

export const SessionSchema = z.object({
  session_id: Id,
  tp_id: z.string(),
  student_id: Id,
  student: StudentSchema.nullable().default(null),
  interactive: z.boolean().default(false),
  started_at: Ts,
  duration_sec: z.number().nonnegative(),
  accuracy_percent: z.number().min(0).max(100).nullable(),
  steps_completed: z.number().int().nonnegative(),
  steps_total: z.number().int().positive(),
  finished: z.boolean(),
  /** Interactive TPs: steps validated by the student's actions (not just "next"). */
  steps_validated: z.number().int().nonnegative().default(0),
  safety_violations: z.number().int().nonnegative().default(0),
  step_times_sec: z.array(z.number().nonnegative()).max(200),
  steps_detail: z.array(StepDetailSchema).max(200).default([]),
  aids_used: z.number().int().nonnegative().default(0),
  fps: z.object({ avg: z.number(), min: z.number(), samples: z.number().int() }).nullable(),
  device: z.object({ xr: z.boolean(), hand_tracking: z.boolean(), user_agent: z.string().max(300) }),
  interactions: z.array(EventSchema).max(5000),
  timestamp: Ts,
});
export type SessionRecord = z.infer<typeof SessionSchema> & { received_at: string };

const router = Router();

/**
 * POST /api/analytics — stores (or updates) one session.
 * Accepts application/json and text/plain (navigator.sendBeacon fallbacks).
 */
router.post(
  "/",
  express.text({ type: "text/plain", limit: "2mb" }),
  asyncHandler(async (req, res) => {
    const body: unknown = typeof req.body === "string" ? safeJson(req.body) : req.body;
    const parsed = SessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "Invalid analytics payload",
        parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`)
      );
    }
    const s = parsed.data;
    assertTpId(s.tp_id);
    if (s.steps_completed > s.steps_total) throw new HttpError(400, "steps_completed > steps_total");

    const dir = path.join(ANALYTICS_DIR, s.tp_id);
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${s.session_id}.json`);
    const record: SessionRecord = { ...s, received_at: new Date().toISOString() };
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(record));
    await fsp.rename(`${file}.tmp`, file);

    console.log(
      `📊 Analytics ${s.tp_id}/${s.session_id} (${s.student_id}): ${s.steps_completed}/${s.steps_total} steps, ` +
        `${s.duration_sec}s, accuracy ${s.accuracy_percent ?? "—"}%, ${s.interactions.length} events${s.finished ? " ✅ finished" : ""}`
    );
    res.json({ success: true, score_saved: true, session_id: s.session_id });
  })
);

/**
 * GET /api/analytics/:tpId — sessions + aggregates for one TP.
 */
router.get(
  "/:tpId",
  asyncHandler(async (req, res) => {
    assertTpId(req.params.tpId);
    const dir = path.join(ANALYTICS_DIR, req.params.tpId);
    let files: string[] = [];
    try {
      // Session files only (not the cached AI feedback of the reports).
      files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json") && !f.endsWith(".feedback.json"));
    } catch {
      /* no session yet */
    }
    const sessions = (
      await Promise.all(files.map((f) => fsp.readFile(path.join(dir, f), "utf8").then(safeJson).catch(() => null)))
    ).filter((s): s is SessionRecord => s !== null);

    const finished = sessions.filter((s) => s.finished);
    const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const stepCount = Math.max(0, ...sessions.map((s) => s.step_times_sec.length));
    res.json({
      success: true,
      tp_id: req.params.tpId,
      sessions: sessions.length,
      finished: finished.length,
      mean_duration_sec: mean(finished.map((s) => s.duration_sec)),
      mean_accuracy_percent: mean(sessions.map((s) => s.accuracy_percent).filter((a): a is number => a !== null)),
      mean_time_per_step_sec: Array.from({ length: stepCount }, (_, i) =>
        mean(finished.map((s) => s.step_times_sec[i]).filter((t): t is number => t !== undefined))
      ),
      mean_fps: mean(sessions.map((s) => s.fps?.avg).filter((f): f is number => typeof f === "number")),
      min_fps: sessions.some((s) => s.fps) ? Math.min(...sessions.flatMap((s) => (s.fps ? [s.fps.min] : []))) : null,
      gestures: countGestures(sessions),
      // Names stay in the per-session report: aggregates only carry the pseudonymous id.
      data: sessions.map(({ interactions, student: _student, ...rest }) => ({ ...rest, events: interactions.length, gestures: countGestures([{ interactions }]) })),
    });
  })
);

/**
 * Counts interactions by "gesture:hand" (e.g. "pinch_middle:right": 9).
 * With a known protocol (e.g. "10 thumb+middle pinches per hand"), the
 * gesture recognition rate is count / expected — WebXR exposes no confidence.
 */
function countGestures(sessions: Pick<SessionRecord, "interactions">[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sessions) {
    for (const e of s.interactions) {
      if (e.event !== "hand_interaction") continue;
      const key = `${e.gesture}:${e.hand}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/** JSON.parse that returns null instead of throwing. */
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export default router;
