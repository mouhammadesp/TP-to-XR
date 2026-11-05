/**
 * TP-to-xR — single entry point.
 *
 *   /vr/                 menu: Démarrer → domaine → import PDF → traitement → TP immersif
 *   /vr/?tp=<id>         opens a TP directly (deep link, used after the pipeline too)
 *   &student=<pseudo>    pseudonymous student id for analytics
 *   debug: &cam=x,y,z,tx,ty,tz (camera pose), &debug=1 → window.__tpxr (E2E tests)
 *
 * One engine, one scene: the workshop is loaded once, shown behind the menus,
 * and the TP's objects are added to it when the session starts.
 */
import { Engine, UniversalCamera } from "@babylonjs/core";
import { Kakemono } from "./scenes/Kakemono";
import { MenuScene } from "./scenes/MenuScene";
import { TextureManager } from "./scenes/TextureManager";
import { loadTemplate } from "./scenes/TPScene";
import { World, makeScreenOf, startTP } from "./scenes/VRScene";
import { PipelineClient } from "./services/PipelineClient";
import { setMode, status } from "./ui/hud";
import { IdentityUI } from "./ui/IdentityUI";
import { MenuUI } from "./ui/MenuUI";
import { ProgressBar } from "./ui/ProgressBar";
import { UploadUI } from "./ui/UploadUI";
import { StateManager } from "./utils/stateManager";

const TEMPLATE_URL = "/api/workshop/scene.babylon";
/** Pause on the "Prêt" screen before entering the TP. */
const READY_PAUSE_MS = 900;

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const tpId = params.get("tp");
  setMode(tpId ? "vr" : "menu");

  const world = await boot();
  if (params.get("debug") === "1") {
    (window as unknown as { __tpxr: unknown }).__tpxr = { scene: world.scene, screenOf: makeScreenOf(world), kakemono: world.kakemono };
  }

  if (tpId) {
    await startTP(world, tpId, params);
    return;
  }
  runMenu(world, params);
}

/**
 * Loads the workshop and its realistic materials (shared by menu and TP).
 */
async function boot(): Promise<World> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }, true);
  status("chargement de l'atelier…");
  const scene = await loadTemplate(engine, TEMPLATE_URL);
  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  const camera = (scene.getCameraByName("spawnCamera") ?? scene.activeCamera) as UniversalCamera;
  camera.keysUp.push(87, 90); // W, Z
  camera.keysDown.push(83); // S
  camera.keysLeft.push(65, 81); // A, Q
  camera.keysRight.push(68); // D
  camera.attachControl(canvas, true);

  status("génération des textures…");
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  const textures = new TextureManager(scene);
  await textures.loadExternalTextures();
  const { ms } = textures.applyRealisticMaterials();
  textures.setupLighting();
  textures.finishRoom();
  // The instruction board is shown on the monitor only: no texts on the wood accent wall.
  const wallBoard = scene.getMeshByName("instructionPanel");
  if (wallBoard) wallBoard.isVisible = false;
  const kakemono = new Kakemono(scene);
  document.getElementById("boot")?.remove();
  return { engine, scene, camera, textures, textureMs: ms, kakemono };
}

/**
 * Menu flow: home → domain → upload → loading → TP (state machine driven).
 */
function runMenu(world: World, params: URLSearchParams): void {
  const sm = new StateManager("home");
  const background = new MenuScene(world.scene, world.camera, world.engine.getRenderingCanvas()!);
  const client = new PipelineClient();
  const progress = new ProgressBar();
  let abort: AbortController | null = null;

  const enterTP = (tpId: string) => {
    // Keep student/debug params, so the URL is a shareable deep link to this TP.
    const next = new URLSearchParams(params);
    next.set("tp", tpId);
    history.pushState({ tpId }, "", `?${next.toString()}`);
    sm.go("vr", { tpId });
  };

  // Every TP launched from the menu goes through the identity form first.
  let pendingTitle: string | null = null;
  let identityFrom: "home" | "library" = "home";
  const menu = new MenuUI(sm, (tpId, title) => {
    pendingTitle = title;
    sm.go("identity", { pendingTp: tpId });
  });
  const identity = new IdentityUI(() => {
    const tpId = sm.context.pendingTp;
    if (tpId) enterTP(tpId);
    else sm.go("upload");
  });
  const upload = new UploadUI(
    (file) => sm.go("loading", { file, inboxFile: null, startedAt: Date.now() }),
    (name) => sm.go("loading", { file: null, inboxFile: name, startedAt: Date.now() })
  );

  /** Uploads the PDF and follows the job until the scene is ready. */
  const runPipeline = async () => {
    const { file, inboxFile, domain, startedAt } = sm.context;
    if (!file && !inboxFile) return;
    abort = new AbortController();
    progress.start(startedAt ?? Date.now(), file ? file.name : `${inboxFile} (PC)`);
    try {
      const jobId = file ? await client.upload(file, domain) : await client.startFromInbox(inboxFile as string, domain);
      const job = await client.waitFor(jobId, (j) => progress.render(j), { signal: abort.signal });
      await new Promise((r) => setTimeout(r, READY_PAUSE_MS));
      if (sm.state === "loading" && job.result) enterTP(job.result.tp_id);
    } catch (err) {
      if (sm.state !== "loading") return; // cancelled by the user
      progress.showError(err instanceof Error ? err.message : String(err));
    }
  };

  document.getElementById("btn-cancel")?.addEventListener("click", () => {
    abort?.abort();
    progress.stopTimer();
    sm.go("upload");
  });
  document.getElementById("btn-retry")?.addEventListener("click", () => sm.go("upload"));

  sm.onChange((state, prev, ctx) => {
    if (state === "identity") {
      if (prev === "home" || prev === "library") identityFrom = prev;
      identity.prepare(ctx.pendingTp ? pendingTitle : null, () => sm.go(ctx.pendingTp ? identityFrom : "domain"));
    }
    menu.show(state);
    // Kakemono follows the specialty chosen in the menu (neutral on the home screen).
    if (state === "home") world.kakemono.setDomain(null);
    if (state === "domain" || state === "upload" || (state === "identity" && !ctx.pendingTp)) world.kakemono.setDomain(ctx.domain);
    if (state === "upload") {
      upload.setDomain(ctx.domain);
      upload.reset();
      void client.listInbox().then((files) => upload.renderInbox(files)).catch(() => undefined);
    }
    if (state === "loading") void runPipeline();
    if (state === "vr" && ctx.tpId) {
      background.stop();
      setMode("vr");
      void startTP(world, ctx.tpId, new URLSearchParams(location.search)).catch(fail);
    }
  });

  // Browser back from a TP → reload into the menu (frees models and XR resources).
  window.addEventListener("popstate", () => location.reload());

  background.start();
  menu.show("home");
  if (params.get("debug") === "1") {
    const w = window as unknown as { __tpxr: Record<string, unknown> };
    w.__tpxr = { ...w.__tpxr, sm };
  }
}

/** Shows a fatal error in the HUD. */
function fail(err: unknown): void {
  console.error("❌ App failed", err);
  document.getElementById("boot")?.remove();
  setMode("vr");
  status(`erreur : ${err instanceof Error ? err.message : String(err)}`);
}

main().catch(fail);
