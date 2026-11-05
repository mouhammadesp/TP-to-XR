/**
 * VRScene — the immersive TP session, started in the already-loaded workshop:
 * loads the manifest and models, then wires session, UI, interactions, WebXR
 * (hand tracking optional) and analytics.
 */
import { Kakemono } from "./Kakemono";
import { Engine, Matrix, Mesh, Scene, UniversalCamera, Vector3 } from "@babylonjs/core";
import { InspectView } from "./InspectView";
import { InteractionHandler } from "./InteractionHandler";
import { TextureManager } from "./TextureManager";
import { PlacedAsset, placeAssets } from "./TPScene";
import { Simulation } from "../sim/Simulation";
import { CreditsPanel } from "../ui/CreditsPanel";
import { Toast } from "../ui/Toast";
import { hudWarn, status } from "../ui/hud";
import { ScoreDisplay } from "../ui/ScoreDisplay";
import { Sounds } from "../ui/sound";
import { StepFeedback } from "../ui/StepFeedback";
import { confirmationSentence } from "../ui/feedbackText";
import { ButtonAction, StepPanel } from "../ui/StepPanel";
import { AnalyticsClient, TPSession, resolveStudentId } from "../utils/analytics";
import { displayName, loadIdentity } from "../utils/identity";
import { Manifest, fetchManifest, linkAssetsToSteps } from "../utils/manifest";

const UPLOAD_EVERY_MS = 30_000;

/** What the boot sequence prepared (one engine, one scene for the whole app). */
export interface World {
  engine: Engine;
  scene: Scene;
  camera: UniversalCamera;
  textures: TextureManager;
  textureMs: number;
  /** Roll-up banner whose print follows the specialty. */
  kakemono: Kakemono;
}

/**
 * Loads TP `tpId` into the workshop and starts the student session.
 */
export async function startTP(world: World, tpId: string, params: URLSearchParams): Promise<void> {
  const { scene, textures } = world;
  applyDebugCamera(world.camera, params.get("cam"));

  status("chargement du TP…");
  const { manifest, errors } = await fetchManifest(tpId);
  errors.forEach((e) => {
    console.error("❌ manifest:", e);
    hudWarn(e);
  });
  [...manifest.unplaced.map((u) => `Non placé : ${u.name} (${u.reason})`), ...manifest.warnings].forEach(hudWarn);
  (document.getElementById("title") as HTMLElement).textContent = manifest.tp.title;
  document.title = `TP-to-xR — ${manifest.tp.title}`;
  textures.setupLighting();
  textures.setKeyLight(manifest.color_scheme.key_light);
  world.kakemono.setDomain(manifest.tp.domain);

  const assets = await placeAssets(scene, manifest, (done, total) => status(`objets ${done}/${total}…`));
  assets.filter((a) => a.error).forEach((a) => hudWarn(`${a.asset.name} : modèle non chargé (${a.error})`));
  textures.addShadowCasters(assets.flatMap((a) => a.meshes));

  startSession(world, manifest, assets, params);
}

/**
 * Wires session, UI, interactions, XR and analytics together.
 */
function startSession(world: World, manifest: Manifest, assets: PlacedAsset[], params: URLSearchParams): void {
  const { scene, engine, textures } = world;
  const stepAssets = linkAssetsToSteps(manifest.tp.steps, manifest.assets);
  const session = new TPSession(manifest.id, resolveStudentId(params.get("student")), stepAssets);
  // Identity entered in the menu for this TP (null for a deep link without the form).
  session.identity = loadIdentity();
  session.interactive = !!manifest.simulation;
  // Generated TPs: steps without any checkable action can only be "terminées (non vérifiées)".
  session.verifiable = manifest.simulation ? manifest.tp.steps.map((_, i) => (manifest.simulation!.rules[i]?.length ?? 0) > 0) : null;
  /** What each step's validation does NOT check (generated TPs), shown under the checklist. */
  const unverifiedOf = (i: number): string[] => manifest.interactions?.steps.find((s) => s.step === manifest.tp.steps[i]?.order)?.unverified ?? [];
  const analytics = new AnalyticsClient();
  const steps = new StepPanel(scene, manifest, session.identity ? displayName(session.identity) : null);
  const score = new ScoreDisplay(scene, session);
  const credits = new CreditsPanel(
    scene,
    assets.filter((a) => a.asset.attribution).map((a) => ({ name: a.asset.name, attribution: a.asset.attribution! }))
  );

  const toast = new Toast(scene);
  const inspect = new InspectView(scene);
  // Validation / error notifications (sound optional: ?sound=0, M key).
  const sounds = new Sounds(params.get("sound") !== "0");
  const feedback = new StepFeedback(scene, sounds, (pattern) => interactions.haptic(pattern));
  /** Guidance already given for (step, object): never repeated. */
  const hinted = new Set<string>();
  const assetName = new Map(manifest.assets.map((a) => [a.asset_id, a.name]));
  // Interactive TP: snapping, markers, auto-validated steps (+ simulated physics in the demos).
  let sim: Simulation | null = null;

  /** Board summary once the TP is finished (recorded facts only). */
  const finalSummary = (): string[] => {
    const d = session.stepsDetail();
    const faults = d.reduce((n, x) => n + x.safety_faults + x.damages, 0);
    const mins = Math.floor(session.elapsedSec() / 60);
    const secs = String(session.elapsedSec() % 60).padStart(2, "0");
    const unchecked = d.filter((x) => x.status === "done").length;
    // Demos with their own result (e.g. identification quiz: parts found, attempts).
    const own = sim?.behavior.summary?.();
    if (own) return [...own, `⏱ Durée : ${mins} min ${secs} s`];
    return [
      session.interactive
        ? `✓ ${d.filter((x) => x.status === "validated").length}/${d.length} étapes validées par vos actions`
        : `✓ ${unchecked}/${d.length} étapes terminées`,
      session.interactive && unchecked ? `○ ${unchecked} étape${unchecked > 1 ? "s" : ""} sans vérification automatique` : "",
      session.interactive ? (faults ? `⚠ ${faults} faute${faults > 1 ? "s" : ""} de sécurité / dommage${faults > 1 ? "s" : ""}` : "✓ Aucune faute de sécurité") : "",
      `⏱ Durée : ${mins} min ${secs} s`,
    ].filter(Boolean);
  };
  const refresh = () => {
    steps.update({
      step: session.step,
      total: session.stepsTotal,
      finished: session.finished,
      summary: session.finished ? finalSummary() : undefined,
      checklist: sim?.checklist(),
      validated: sim?.stepValidated,
      checkable: sim ? sim.hasRule() : undefined,
      unverified: sim ? unverifiedOf(session.step) : undefined,
    });
    score.update();
  };

  /** Moves to another step (or finishes) and keeps the simulation in sync. */
  const changeStep = (go: () => boolean | void) => {
    const before = session.step;
    go();
    if (session.step !== before) sim?.onStepChanged();
    refresh();
  };

  const onButton = (action: ButtonAction, via: "button" | "keyboard") => {
    const btn = steps.buttons.find((b) => b.metadata?.action === action);
    if (btn && via === "button") steps.press(btn);
    if (action === "credits") {
      session.mark(credits.toggle() ? "credits_open" : "credits_close");
      return;
    }
    if (action === "menu") {
      // Unfinished TP: a second press within 3.5 s confirms (no dialog boxes in immersive VR).
      if (!session.finished && !menuArmed) {
        menuArmed = true;
        steps.setMenuConfirm(true);
        toast.show("Appuyez encore sur « Confirmer ? » pour quitter — votre progression est enregistrée.", "warn");
        menuTimer = setTimeout(() => {
          menuArmed = false;
          steps.setMenuConfirm(false);
        }, 3500);
        return;
      }
      return quitToMenu();
    }
    // Once the TP is finished, the "next" button becomes "📄 Rapport".
    if (action === "next" && session.finished) return void openReport();
    if (action === "prev") {
      // Going back to re-read a previous step is an aid (recorded, not penalized).
      if (session.step > 0 && !session.finished) session.recordAid("review");
      return changeStep(() => session.prev(via));
    }
    // Moving on without having done the step (interactive TPs) is logged. A step the engine
    // cannot check is not "skipped": it becomes "terminée (non vérifiée)", never "validée".
    if (sim && sim.hasRule() && !sim.stepValidated) session.recordSim("step_skipped", `étape ${session.step + 1}`);
    if (session.step === session.stepsTotal - 1) {
      if (session.finish()) void finishUpload();
      refresh();
    } else changeStep(() => session.next(via));
  };

  let menuArmed = false;
  let menuTimer: ReturnType<typeof setTimeout> | null = null;
  /** Saves the session, leaves VR and goes back to the menu (keeping the student pseudonym). */
  const quitToMenu = () => {
    if (menuTimer) clearTimeout(menuTimer);
    analytics.beacon(session.summary(navigator.userAgent));
    const student = params.get("student");
    const url = student ? `./?student=${encodeURIComponent(student)}` : "./";
    void interactions.exitXR().finally(() => location.assign(url));
  };

  /** Individual report of this session (served by the backend from the uploaded results). */
  const studentParam = params.get("student");
  const reportUrl = `./report.html?tp=${encodeURIComponent(manifest.id)}&session=${encodeURIComponent(session.sessionId)}${studentParam ? `&student=${encodeURIComponent(studentParam)}` : ""}`;
  let reportOpening = false;
  const openReport = async () => {
    if (reportOpening) return;
    reportOpening = true;
    if (menuTimer) clearTimeout(menuTimer);
    // Final results must be on the server before the report is built.
    await analytics.send(session.summary(navigator.userAgent));
    await interactions.exitXR().catch(() => undefined);
    location.assign(reportUrl);
  };

  const finishUpload = async () => {
    const r = await analytics.send(session.summary(navigator.userAgent));
    status(r?.score_saved ? "TP terminé ✓ — résultats enregistrés" : "TP terminé ✓ — envoi des résultats échoué");
    // Desktop: link to the report in the HUD (in VR: the "📄 Rapport" button on the bench).
    if (r?.score_saved && !document.getElementById("report-link")) {
      const a = Object.assign(document.createElement("a"), { id: "report-link", href: reportUrl, textContent: "📄 Voir mon rapport de TP" });
      a.addEventListener("click", (e) => {
        e.preventDefault();
        void openReport();
      });
      document.getElementById("hud")?.append(document.createElement("br"), a);
    }
  };

  const interactions = new InteractionHandler(scene, assets, steps.buttons, {
    onButton,
    onInteraction: (e) => {
      const ev = session.recordInteraction(e);
      // TPs without a validation engine: neutral guidance when the grabbed object is
      // not one the instruction mentions (no penalty beyond the existing accuracy metric).
      const key = `${session.step}:${e.target}`;
      if (!sim && ev.correct === false && e.target && !hinted.has(key)) {
        hinted.add(key);
        const expected = [...stepAssets[session.step]].map((id) => assetName.get(id) ?? id);
        feedback.info("Conseil", `La consigne de cette étape mentionne : ${expected.join(", ")}.`);
      }
      sim?.onInteraction(e);
      score.update();
    },
    onObjectReleased: (a) => sim?.onRelease(a),
    onGrabStart: (a) => sim?.onGrabStart(a),
    onAssetClick: (a) => sim?.onClick(a),
    onGestureStep: (dir) => onButton(dir > 0 ? "next" : "prev", "button"),
    onControllerStep: (dir) => onButton(dir > 0 ? "next" : "prev", "button"),
    onObjectMoved: () => textures.refreshShadows(),
    onXRStateChange: (inXR) => {
      if (inXR) session.xrUsed = true;
      session.mark(inXR ? "xr_enter" : "xr_exit");
    },
    onHandTracking: () => (session.handTrackingUsed = true),
    onLabelsShown: () => session.recordAid("labels"),
    // Close-up "magnifier" for small objects (an aid, recorded; the object keeps its real size).
    onInspect: (a) => {
      if (inspect.toggle(a)) session.recordAid("inspect");
    },
  });
  interactions.enableKeyboard(assets.map((a) => a.label as Mesh));

  if (manifest.simulation) {
    sim = new Simulation(scene, manifest.simulation, assets, {
      session,
      onChecklistChanged: refresh,
      // Safety faults / damage detected by the engine → "Action incorrecte" card.
      toast: (text, kind) => (kind === "danger" ? feedback.error("Action incorrecte", text.replace(/^[⚠✖]\s*/u, "")) : toast.show(text, kind)),
      notify: (kind, title, text) => feedback[kind](title, text),
      refreshShadows: () => textures.refreshShadows(),
      // Called by the engine only once every condition of the step holds.
      onStepValidated: (index, isLast) => {
        const labels = sim?.checklist().filter((c) => c.done).map((c) => c.label) ?? [];
        // Behavior's own message (e.g. "Bonne réponse !" + what the part does), else the checklist.
        const own = sim?.behavior.validationMessage?.(index) ?? null;
        refresh();
        if (isLast) {
          const title = manifest.simulation!.kind === "generic" ? "Dernière étape validée !" : "TP réussi !";
          feedback.success(own?.title ?? title, `${own?.text ?? confirmationSentence(labels)} ${manifest.simulation!.completion}`, "finish");
          if (session.finish()) void finishUpload();
          refresh();
          return;
        }
        if (own) feedback.success(own.title, own.text);
        else feedback.success("Étape validée !", confirmationSentence(labels, { index, total: session.stepsTotal }));
        // Short pause to read the feedback, then move on (unless the student already did).
        setTimeout(() => {
          if (session.step === index && !session.finished) changeStep(() => session.next("auto"));
        }, 1500);
      },
    });
    let last = performance.now();
    scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      sim?.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    });
    const pose = sim.behavior.feedbackPose;
    if (pose) feedback.placeAt(pose.position, pose.viewer);
    toast.show(
      manifest.simulation.kind === "generic"
        ? `TP généré : ${session.verifiable?.filter(Boolean).length ?? 0}/${session.stepsTotal} étapes se valident par vos actions (repères verts).`
        : sim.behavior.intro ?? "TP interactif : suivez les repères verts, les étapes se valident par vos actions.",
      "info"
    );
  }
  refresh();

  const loaded = assets.filter((a) => a.loaded).length;
  const summary = `${loaded}/${assets.length} modèles 3D · textures ${world.textureMs} ms`;
  status(`${summary} · vérification WebXR…`);
  void interactions
    .enableXR(scene.getMeshByName("ground"))
    .then((xr) => status(`${summary} · ${xr ? "WebXR prêt (bouton casque)" : "WebXR indisponible (mode bureau)"}`))
    .catch((err) => {
      console.warn("⚠️ WebXR init failed", err);
      status(`${summary} · WebXR indisponible`);
    });

  // Timer / FPS once per second, periodic upload, final beacon on exit.
  setInterval(() => {
    const fps = engine.getFps();
    // Headset asleep / tab hidden → no frames: not a performance sample.
    if (!document.hidden) session.addFps(fps);
    score.update(fps);
  }, 1000);
  setInterval(() => void analytics.send(session.summary(navigator.userAgent)), UPLOAD_EVERY_MS);
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.target instanceof HTMLInputElement || e.key.toLowerCase() !== "m") return;
    sounds.enabled = !sounds.enabled;
    status(sounds.enabled ? "Sons de confirmation activés (M)" : "Sons de confirmation coupés (M)");
  });
  window.addEventListener("pagehide", () => analytics.beacon(session.summary(navigator.userAgent)));

  if (params.get("debug") === "1") {
    const w = window as unknown as { __tpxr?: Record<string, unknown> };
    w.__tpxr = { ...w.__tpxr, session, assets, onButton, analytics, sim, feedback, sounds, inspect };
  }
  // Performance probe, readable remotely in the headset (chrome://inspect): window.__tpxrPerf()
  (window as unknown as { __tpxrPerf: () => unknown }).__tpxrPerf = () => ({
    fps: Math.round(engine.getFps()),
    activeMeshes: scene.getActiveMeshes().length,
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    textures: scene.textures.length,
    vertices: scene.getTotalVertices(),
    drawCalls: (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? null,
    fpsSession: session.summary().fps,
  });
  console.log(`✅ Session ${session.sessionId} started (${manifest.tp.steps.length} steps, ${assets.length} assets)`);
}

/**
 * Debug helper: CSS-pixel screen position of a mesh's bounding-box center
 * (used by the end-to-end tests to click real meshes).
 */
export function makeScreenOf(world: World): (name: string) => { x: number; y: number } | null {
  const { scene, engine } = world;
  return (name) => {
    const mesh = scene.getMeshByName(name);
    const cam = scene.activeCamera;
    if (!mesh || !cam) return null;
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const p = Vector3.Project(mesh.getBoundingInfo().boundingBox.centerWorld, Matrix.Identity(), scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const k = engine.getRenderingCanvas()!.clientWidth / w;
    return { x: p.x * k, y: p.y * k };
  };
}

/** Debug: ?cam=x,y,z,tx,ty,tz overrides the spawn pose (used for screenshots). */
function applyDebugCamera(camera: UniversalCamera, value: string | null): void {
  const n = value?.split(",").map(Number);
  if (!n || n.length !== 6 || n.some((x) => !Number.isFinite(x))) return;
  camera.applyGravity = false;
  camera.position = new Vector3(n[0], n[1], n[2]);
  camera.setTarget(new Vector3(n[3], n[4], n[5]));
}
