// tests/menu.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

// src/utils/stateManager.ts
var TRANSITIONS = {
  home: ["domain", "library", "identity", "vr"],
  domain: ["home", "identity"],
  identity: ["home", "domain", "library", "upload", "vr"],
  upload: ["identity", "domain", "loading"],
  loading: ["vr", "upload"],
  library: ["home", "identity", "vr"],
  vr: []
};
var StateManager = class {
  constructor(initial = "home") {
    this.ctx = { domain: null, file: null, inboxFile: null, jobId: null, tpId: null, pendingTp: null, startedAt: null };
    this.listeners = [];
    this.current = initial;
  }
  get state() {
    return this.current;
  }
  get context() {
    return this.ctx;
  }
  /** True if `next` is reachable from the current state. */
  can(next) {
    return TRANSITIONS[this.current].includes(next);
  }
  /**
   * Moves to `next`, merging `patch` into the context first.
   * @throws if the transition is not allowed
   */
  go(next, patch = {}) {
    if (!this.can(next)) throw new Error(`Illegal transition ${this.current} \u2192 ${next}`);
    Object.assign(this.ctx, patch);
    const previous = this.current;
    this.current = next;
    console.log(`\u{1F9ED} ${previous} \u2192 ${next}`);
    for (const l of this.listeners) l(next, previous, this.ctx);
  }
  /** Subscribes to state changes; returns an unsubscribe function. */
  onChange(listener) {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
};

// src/services/PipelineClient.ts
var MAX_PDF_BYTES = 20 * 1024 * 1024;
var PipelineClient = class {
  constructor(fetchFn = (i, init) => fetch(i, init), base = "/api/pipeline", sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now) {
    this.fetchFn = fetchFn;
    this.base = base;
    this.sleep = sleep;
    this.now = now;
  }
  /**
   * Checks a file before upload: extension/type, size, and the %PDF- header.
   * @returns null if OK, otherwise a French error message for the UI
   */
  static async validate(file) {
    const name = file.name ?? "";
    if (file.type !== "application/pdf" && !name.toLowerCase().endsWith(".pdf")) {
      return "Ce fichier n'est pas un PDF.";
    }
    if (file.size === 0) return "Le fichier est vide.";
    if (file.size > MAX_PDF_BYTES) return `Fichier trop lourd (${(file.size / 1024 / 1024).toFixed(1)} Mo, max 20 Mo).`;
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== "%PDF-") return "Le fichier ne semble pas \xEAtre un PDF valide.";
    return null;
  }
  /**
   * Sends the PDF and starts a pipeline job.
   * @returns the job id
   */
  async upload(file, domain) {
    const url = domain ? `${this.base}?domain=${encodeURIComponent(domain)}` : this.base;
    let res;
    try {
      res = await this.fetchFn(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.jobId) throw new Error(explain(res.status, body?.error));
    return body.jobId;
  }
  /** PDFs dropped on the PC (backend/data/pdf-inbox). */
  async listInbox() {
    const res = await this.fetchFn(`${this.base}/inbox`);
    const body = await res.json().catch(() => null);
    return body?.files ?? [];
  }
  /** Starts the pipeline on a PDF of the PC inbox (no upload from the headset). */
  async startFromInbox(file, domain) {
    let res;
    try {
      res = await this.fetchFn(`${this.base}/inbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, domain })
      });
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.jobId) throw new Error(explain(res.status, body?.error));
    return body.jobId;
  }
  /** Fetches the current job state. */
  async status(jobId) {
    const res = await this.fetchFn(`${this.base}/${encodeURIComponent(jobId)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.job) throw new Error(explain(res.status, body?.error));
    return body.job;
  }
  /**
   * Polls until the job is done; calls `onUpdate` on every answer.
   * @throws on job error, timeout, abort, or too many consecutive network errors
   */
  async waitFor(jobId, onUpdate, opts = {}) {
    const { intervalMs = 1e3, timeoutMs = 5 * 6e4, maxNetworkErrors = 5, signal } = opts;
    const deadline = this.now() + timeoutMs;
    let networkErrors = 0;
    for (; ; ) {
      if (signal?.aborted) throw new Error("Annul\xE9");
      let job2 = null;
      try {
        job2 = await this.status(jobId);
        networkErrors = 0;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Introuvable")) throw err;
        if (++networkErrors > maxNetworkErrors) throw err;
      }
      if (job2) {
        onUpdate(job2);
        if (job2.status === "done") return job2;
        if (job2.status === "error") throw new Error(job2.error ?? "\xC9chec du pipeline");
      }
      if (this.now() > deadline) throw new Error("D\xE9lai d\xE9pass\xE9 (5 min) \u2014 le serveur met trop de temps.");
      await this.sleep(intervalMs);
    }
  }
};
var NETWORK_ERROR = "Connexion au serveur perdue : la requ\xEAte n'est pas arriv\xE9e. Casque bien branch\xE9 en USB ? Sur le PC, lancer \xAB tools/quest.ps1 -Watch \xBB, puis r\xE9essayer.";
function explain(status, serverMessage) {
  if (status === 404) return `Introuvable${serverMessage ? ` : ${serverMessage}` : ""}`;
  if (status === 503) {
    return `Service indisponible : ${serverMessage ?? "cl\xE9 API manquante c\xF4t\xE9 serveur"} (v\xE9rifier backend/.env).`;
  }
  if (status === 413) return "Fichier trop lourd pour le serveur (max 20 Mo).";
  if (status === 0 || Number.isNaN(status)) return "Serveur injoignable.";
  return serverMessage ?? `Erreur serveur (${status})`;
}

// tests/menu.test.ts
test("state machine: happy path home \u2192 domain \u2192 identity \u2192 upload \u2192 loading \u2192 vr", () => {
  const sm = new StateManager();
  const seen = [];
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
  assert.equal(sm.can("upload"), false, "domain \u2192 upload must go through identity");
  const demo = new StateManager();
  demo.go("identity", { pendingTp: "tp_demo_electrical" });
  demo.go("vr", { tpId: "tp_demo_electrical" });
  const lib = new StateManager();
  lib.go("library");
  lib.go("identity", { pendingTp: "tp_x" });
  lib.go("library");
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
  demo.go("vr", { tpId: "tp_demo_mechanical" });
  assert.equal(demo.context.tpId, "tp_demo_mechanical");
  assert.equal(sm.can("home"), false);
  assert.throws(() => sm.go("home"));
});
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new TypeError("network down");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}
var job = (status, step, progress, extra = {}) => ({
  status: 200,
  body: { success: true, job: { id: "tp_1", status, steps: [], current_step: step, progress, warnings: [], ...extra } }
});
test("pipeline client: upload sends raw PDF with domain and returns jobId", async () => {
  const f = fakeFetch([{ status: 202, body: { success: true, jobId: "tp_42" } }]);
  const id = await new PipelineClient(f.fn).upload(new Blob(["%PDF-1.4"]), "chemical");
  assert.equal(id, "tp_42");
  assert.equal(f.calls[0].url, "/api/pipeline?domain=chemical");
  assert.equal((f.calls[0].init?.headers)["Content-Type"], "application/pdf");
});
test("pipeline client: network failure (USB / adb reverse lost) \u2192 explicit message", async () => {
  const down = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(new PipelineClient(down).upload(new Blob(["%PDF-"]), "electrical"), /Connexion au serveur perdue/);
});
test("pipeline client: missing API key \u2192 actionable 503 message", async () => {
  const f = fakeFetch([{ status: 503, body: { success: false, error: "TOGETHER_API_KEY is not set in backend/.env" } }]);
  await assert.rejects(new PipelineClient(f.fn).upload(new Blob(["%PDF-"]), null), /Service indisponible : TOGETHER_API_KEY/);
});
test("pipeline client: polls until done, reports progress, tolerates a network blip", async () => {
  const f = fakeFetch([job("running", "extract", 7), job("running", "parse", 21), job("running", "search", 50)]);
  const responses = [job("done", null, 100, { result: { tp_id: "tp_1", title: "T", domain: "other", assets: 3, models: 2 } })];
  let n = 0;
  const flaky = async (url, init) => {
    n++;
    if (n === 4) throw new TypeError("wifi blip");
    if (n <= 3) return f.fn(url, init);
    const r = responses.shift();
    return new Response(JSON.stringify(r.body), { status: r.status });
  };
  const seen = [];
  const done = await new PipelineClient(flaky, "/api/pipeline", async () => {
  }).waitFor("tp_1", (j) => seen.push(j.progress));
  assert.deepEqual(seen, [7, 21, 50, 100]);
  assert.equal(done.result?.tp_id, "tp_1");
});
test("pipeline client: job error and timeout are surfaced", async () => {
  const err = fakeFetch([job("running", "parse", 21), job("error", null, 21, { error: "LLM returned invalid JSON" })]);
  await assert.rejects(new PipelineClient(err.fn, "/api/pipeline", async () => {
  }).waitFor("tp_1", () => {
  }), /LLM returned invalid JSON/);
  let t = 0;
  const slow = fakeFetch(Array.from({ length: 50 }, () => job("running", "search", 50)));
  const client = new PipelineClient(slow.fn, "/api/pipeline", async () => void (t += 1e4), () => t);
  await assert.rejects(client.waitFor("tp_1", () => {
  }, { timeoutMs: 6e4 }), /Délai dépassé/);
});
test("pipeline client: file validation (type, size, header)", async () => {
  const pdf = (bytes, name = "tp.pdf", type = "application/pdf") => Object.assign(new Blob([bytes], { type }), { name });
  assert.equal(await PipelineClient.validate(pdf("%PDF-1.7 ...")), null);
  assert.match(await PipelineClient.validate(pdf("hello", "notes.txt", "text/plain")), /pas un PDF/);
  assert.match(await PipelineClient.validate(pdf("<html>", "faux.pdf")), /PDF valide/);
  assert.match(await PipelineClient.validate(pdf("")), /vide/);
  const big = Object.assign(new Blob([new Uint8Array(21 * 1024 * 1024)], { type: "application/pdf" }), { name: "big.pdf" });
  assert.match(await PipelineClient.validate(big), /trop lourd/);
});
