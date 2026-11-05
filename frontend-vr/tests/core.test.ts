/**
 * Unit tests for the pure modules (run: npm test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TPSession } from "../src/utils/analytics";
import { PinchDetector } from "../src/utils/gestures";
import { linkAssetsToSteps, parseManifest } from "../src/utils/manifest";
import { fbm, generateTextureSet, vnoise } from "../src/scenes/proceduralTextures";

/** Fake clock advanced manually. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (sec: number) => (t += sec * 1000) };
}

const asset = (id: string, name: string, first_step: number | null = null, url: string | null = null) => ({
  asset_id: id, name, source: url ? "sketchfab" : "placeholder", url, attribution: null, zone: "zone_workbench",
  slot: null, position: { x: 0, y: 0.9, z: 0 }, rotation_y: 0, target_size_m: 0.3, color_override: null, first_step,
});

const manifest = (assets: unknown[]) => ({
  id: "tp_test_1", created_at: "2026-10-13T00:00:00Z",
  template: { version: "workshop_v2", url: "/api/workshop/scene.babylon" },
  tp: {
    title: "T", domain: "mechanical", duration_minutes: 10, safety_warnings: [],
    steps: [
      { order: 2, action: "Retirer la courroie avec la clé plate", safety: null },
      { order: 1, action: "Couper le moteur électrique", safety: "Vérifier l'absence de tension" },
      { order: 3, action: "Nettoyer le poste", safety: null },
    ],
  },
  color_scheme: { ambient: "#404040", key_light: "#FFFFFF", material_base: "#808080" },
  assets, safety_signs: [], unplaced: [], warnings: [], reasoning: "",
});

test("Test 1 — manifest: valid assets kept, invalid URLs skipped with an error, steps sorted", () => {
  const { manifest: m, errors } = parseManifest(manifest([
    asset("a1", "moteur électrique", 1, "/assets/models/66b2ea9eb6e5468d91d814395036a537/model.glb"),
    asset("a2", "courroie", 2),
    asset("bad1", "x", null, "javascript:alert(1)"),
    asset("bad2", "y", null, "/etc/passwd"),
    { asset_id: "bad3" },
  ]));
  assert.deepEqual(m.assets.map((a) => a.asset_id), ["a1", "a2"]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /bad1.*url/);
  assert.deepEqual(m.tp.steps.map((s) => s.order), [1, 2, 3]);
  assert.throws(() => parseManifest({ id: "nope" }), /Invalid manifest/);
});

test("manifest: assets linked to the steps that mention them", () => {
  const { manifest: m } = parseManifest(manifest([asset("a1", "moteur électrique", 1), asset("a2", "courroie trapézoïdale"), asset("a3", "clé plate 13")]));
  const links = linkAssetsToSteps(m.tp.steps, m.assets);
  assert.deepEqual([...links[0]].sort(), ["a1"]);
  assert.deepEqual([...links[1]].sort(), ["a2", "a3"]);
  assert.equal(links[2].size, 0);
});

test("Test 5 — step progression: clamped at both ends, every change logged", () => {
  const c = clock();
  const s = new TPSession("tp_x", "st", [new Set(), new Set(), new Set(), new Set(), new Set()], c.now);
  for (let i = 0; i < 5; i++) { c.advance(10); s.next("keyboard"); }
  assert.equal(s.step + 1, 5); // N ×5 → stays at 5/5
  for (let i = 0; i < 3; i++) { c.advance(5); s.prev("keyboard"); }
  assert.equal(s.step + 1, 2); // P ×3 → 2/5
  assert.equal(s.goTo(-4, "button"), true);
  assert.equal(s.prev("button"), false); // no underflow
  const changes = s.summary().interactions.filter((e) => e.event === "step_change");
  assert.equal(changes.length, 4 + 3 + 1); // 4 real "next" (5th is clamped) + 3 prev + goTo
  assert.deepEqual(changes[0], { timestamp: 1_010_000, event: "step_change", from_step: 1, to_step: 2, action_time_sec: 10, via: "keyboard" });
});

test("Test 6 — score: 3 min 45 s, 100 % accuracy, 5/5 steps", () => {
  const c = clock();
  const steps = [new Set(["a1"]), new Set(["a2"]), new Set<string>(), new Set(["a3"]), new Set(["a1"])];
  const s = new TPSession("tp_x", "student_42", steps, c.now, "s_test");
  const grab = (target: string) => s.recordInteraction({ hand: "right", gesture: "pinch", target, durationMs: 800 });
  grab("a1"); c.advance(45); s.next("gesture");
  grab("a2"); c.advance(45); s.next("button");
  grab("a9"); c.advance(45); s.next("button"); // step without linked objects → not scored
  grab("a3"); c.advance(45); s.next("button");
  grab("a1"); c.advance(45);
  assert.equal(s.finish(), true);
  const sum = s.summary();
  assert.equal(sum.duration_sec, 225);
  assert.equal(sum.accuracy_percent, 100);
  assert.equal(sum.steps_completed, 5);
  assert.equal(sum.finished, true);
  assert.deepEqual(sum.step_times_sec, [45, 45, 45, 45, 45]);
  assert.equal(s.next("button"), false); // frozen after finish
});

test("score: wrong objects lower accuracy; finish only on last step", () => {
  const c = clock();
  const s = new TPSession("tp_x", "st", [new Set(["a1"]), new Set(["a2"])], c.now);
  s.recordInteraction({ hand: "left", gesture: "pinch", target: "a1", durationMs: 100 });
  s.recordInteraction({ hand: "left", gesture: "pinch", target: "a2", durationMs: 100 });
  s.recordInteraction({ hand: "left", gesture: "point", target: "a2", durationMs: 400 }); // hover: not scored
  assert.equal(s.accuracy(), 50);
  assert.equal(s.finish(), false);
  s.next("keyboard");
  assert.equal(s.finish(), true);
});

test("gesture: pinch hysteresis + cooldown", () => {
  const p = new PinchDetector({ startM: 0.018, endM: 0.035, cooldownMs: 600 });
  assert.equal(p.update(0.05, 0), null);
  assert.deepEqual(p.update(0.015, 100), { type: "start" });
  assert.equal(p.update(0.025, 150), null); // jitter inside the hysteresis band
  assert.equal(p.update(0.012, 200), null); // still pinching, no double start
  assert.deepEqual(p.update(0.04, 400), { type: "end", durationMs: 300 });
  assert.equal(p.update(0.01, 500), null); // cooldown (600 ms since last start)
  assert.equal(p.update(0.05, 650), null);
  assert.deepEqual(p.update(0.01, 800), { type: "start" });
});

test("Test 2 — procedural textures: seamless, in range, distinct materials, fast enough", () => {
  // Seamless: noise at u=0 equals noise at u=1 (wrap)
  for (const v of [0.1, 0.37, 0.8]) {
    assert.ok(Math.abs(vnoise(0, v, 8, 4, 3) - vnoise(1 - 1e-9, v, 8, 4, 3)) < 1e-6);
    assert.ok(Math.abs(fbm(v, 0, 4, 4, 5, 1) - fbm(v, 1 - 1e-9, 4, 4, 5, 1)) < 1e-5);
  }
  const t0 = performance.now();
  const sets = (["concrete", "polishedConcrete", "oak", "brushedSteel", "paintedMetal", "ceilingTiles"] as const).map((k) => [k, generateTextureSet(k)] as const);
  const ms = performance.now() - t0;
  console.log(`   textures generated in ${ms.toFixed(0)} ms (desktop Node)`);
  const mean = (a: Uint8Array, ch: number) => { let s = 0; for (let i = ch; i < a.length; i += 4) s += a[i]; return s / (a.length / 4); };
  const byKind = Object.fromEntries(sets);
  // Physical sanity: steel metallic, wood/concrete not; floor glossier than walls
  assert.ok(mean(byKind.brushedSteel.orm, 2) > 200);
  assert.ok(mean(byKind.oak.orm, 2) < 5 && mean(byKind.concrete.orm, 2) < 5);
  assert.ok(mean(byKind.polishedConcrete.orm, 1) < mean(byKind.concrete.orm, 1) - 60);
  // Wood is warm (R > B), concrete is neutral
  assert.ok(mean(byKind.oak.albedo, 0) - mean(byKind.oak.albedo, 2) > 60);
  assert.ok(Math.abs(mean(byKind.concrete.albedo, 0) - mean(byKind.concrete.albedo, 2)) < 15);
  // Normal maps point mostly "up" (z) but are not flat
  const nz = mean(byKind.concrete.normal, 2);
  assert.ok(nz > 200 && nz < 255);
  assert.ok(ms < 5000);
});

test("image textures: seam detection and seamless fix", async () => {
  const { seamScore, makeSeamless, textureSetFromImage, generateTextureSet } = await import("../src/scenes/proceduralTextures");
  const size = 64;
  // A horizontal gradient tiles badly (dark left edge next to bright right edge).
  const grad = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4; grad[o] = grad[o + 1] = grad[o + 2] = Math.round((x / (size - 1)) * 255); grad[o + 3] = 255;
  }
  assert.ok(seamScore(grad, size) > 10, "gradient must be detected as non-tileable");
  assert.ok(seamScore(makeSeamless(grad, size), size) < seamScore(grad, size) / 5, "fix must remove most of the seam");
  // A procedural (tileable) texture is recognized as seamless.
  const tileable = generateTextureSet("paintedWall", 64).albedo;
  assert.ok(seamScore(tileable, 64) < 2.5);
  // Image → albedo + normal + ORM, opaque, roughness from the material.
  const set = textureSetFromImage("curtainFabric", grad, size);
  assert.equal(set.normal.length, size * size * 4);
  assert.ok(set.orm[1] > 180); // fabric is rough
});
