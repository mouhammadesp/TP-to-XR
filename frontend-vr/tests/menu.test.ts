/**
 * Unit tests — menu state machine and pipeline client (no server needed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { StateManager } from "../src/utils/stateManager";
import { JobView, PipelineClient } from "../src/services/PipelineClient";

test("state machine: happy path home → domain → identity → upload → loading → vr", () => {
  const sm = new StateManager();
  const seen: string[] = [];
  sm.onChange((s, prev) => seen.push(`${prev}>${s}`));
  sm.go("domain");
  sm.go("identity", { domain: "electrical", pendingTp: null });
  sm.go("upload");
  sm.go("loading", { jobId: "tp_1", startedAt: 1 });
  sm.go("vr", { tpId: "tp_1" });
  assert.deepEqual(seen, ["home>domain", "domain>identity", "identity>upload", "upload>loading", "loading>vr"]);
  assert.equal(sm.context.domain, "electrical");
  assert.equal(sm.context.tpId, "tp_1");
});

test("state machine: the identity form comes before the PDF import and before demo / library TPs", () => {
  const sm = new StateManager();
  sm.go("domain");
  assert.equal(sm.can("upload"), false, "domain → upload must go through identity");
  const demo = new StateManager();
  demo.go("identity", { pendingTp: "tp_demo_electrical" });
  demo.go("vr", { tpId: "tp_demo_electrical" });
  const lib = new StateManager();
  lib.go("library");
  lib.go("identity", { pendingTp: "tp_x" });
  lib.go("library"); // ← Retour
  assert.equal(lib.state, "library");
});

test("state machine: back buttons allowed, illegal jumps rejected, vr is terminal", () => {
  const sm = new StateManager();
  assert.throws(() => sm.go("loading"), /Illegal transition home → loading/);
  sm.go("domain");
  sm.go("home");
  sm.go("library");
  sm.go("vr", { tpId: "tp_x" });
  const demo = new StateManager();
  demo.go("vr", { tpId: "tp_demo_mechanical" }); // home → demo TP directly
  assert.equal(demo.context.tpId, "tp_demo_mechanical");
  assert.equal(sm.can("home"), false);
  assert.throws(() => sm.go("home"));
});

/** Builds a fake fetch answering from a list of responses. */
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new TypeError("network down");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}

const job = (status: JobView["status"], step: string | null, progress: number, extra: Partial<JobView> = {}) => ({
  status: 200,
  body: { success: true, job: { id: "tp_1", status, steps: [], current_step: step, progress, warnings: [], ...extra } },
});

test("pipeline client: upload sends raw PDF with domain and returns jobId", async () => {
  const f = fakeFetch([{ status: 202, body: { success: true, jobId: "tp_42" } }]);
  const id = await new PipelineClient(f.fn).upload(new Blob(["%PDF-1.4"]), "chemical");
  assert.equal(id, "tp_42");
  assert.equal(f.calls[0].url, "/api/pipeline?domain=chemical");
  assert.equal((f.calls[0].init?.headers as Record<string, string>)["Content-Type"], "application/pdf");
});

test("pipeline client: network failure (USB / adb reverse lost) → explicit message", async () => {
  const down = async (): Promise<Response> => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(new PipelineClient(down).upload(new Blob(["%PDF-"]), "electrical"), /Connexion au serveur perdue/);
});

test("pipeline client: missing API key → actionable 503 message", async () => {
  const f = fakeFetch([{ status: 503, body: { success: false, error: "TOGETHER_API_KEY is not set in backend/.env" } }]);
  await assert.rejects(new PipelineClient(f.fn).upload(new Blob(["%PDF-"]), null), /Service indisponible : TOGETHER_API_KEY/);
});

test("pipeline client: polls until done, reports progress, tolerates a network blip", async () => {
  const f = fakeFetch([job("running", "extract", 7), job("running", "parse", 21), job("running", "search", 50)]);
  // Inject a network failure between answers, then the final answer.
  const responses = [job("done", null, 100, { result: { tp_id: "tp_1", title: "T", domain: "other", assets: 3, models: 2 } })];
  let n = 0;
  const flaky = async (url: string, init?: RequestInit) => {
    n++;
    if (n === 4) throw new TypeError("wifi blip");
    if (n <= 3) return f.fn(url, init);
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  const seen: number[] = [];
  const done = await new PipelineClient(flaky, "/api/pipeline", async () => {}).waitFor("tp_1", (j) => seen.push(j.progress));
  assert.deepEqual(seen, [7, 21, 50, 100]);
  assert.equal(done.result?.tp_id, "tp_1");
});

test("pipeline client: job error and timeout are surfaced", async () => {
  const err = fakeFetch([job("running", "parse", 21), job("error", null, 21, { error: "LLM returned invalid JSON" })]);
  await assert.rejects(new PipelineClient(err.fn, "/api/pipeline", async () => {}).waitFor("tp_1", () => {}), /LLM returned invalid JSON/);

  let t = 0;
  const slow = fakeFetch(Array.from({ length: 50 }, () => job("running", "search", 50)));
  const client = new PipelineClient(slow.fn, "/api/pipeline", async () => void (t += 10_000), () => t);
  await assert.rejects(client.waitFor("tp_1", () => {}, { timeoutMs: 60_000 }), /Délai dépassé/);
});

test("pipeline client: file validation (type, size, header)", async () => {
  const pdf = (bytes: string, name = "tp.pdf", type = "application/pdf") => Object.assign(new Blob([bytes], { type }), { name });
  assert.equal(await PipelineClient.validate(pdf("%PDF-1.7 ...")), null);
  assert.match((await PipelineClient.validate(pdf("hello", "notes.txt", "text/plain")))!, /pas un PDF/);
  assert.match((await PipelineClient.validate(pdf("<html>", "faux.pdf")))!, /PDF valide/);
  assert.match((await PipelineClient.validate(pdf("")))!, /vide/);
  const big = Object.assign(new Blob([new Uint8Array(21 * 1024 * 1024)], { type: "application/pdf" }), { name: "big.pdf" });
  assert.match((await PipelineClient.validate(big))!, /trop lourd/);
});
