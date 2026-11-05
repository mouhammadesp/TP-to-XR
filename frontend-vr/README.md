# frontend-vr — WebXR student view (Quest 3 + desktop)

A single application:
**Accueil → Domaine → Import du PDF → Traitement (7 étapes) → TP immersif**.
The workshop loads once and stays visible behind the menus (orbiting camera). When the pipeline
finishes, the TP objects are added to that same scene, with no reload.

| URL (served by the backend) | Purpose |
|---|---|
| `/vr/` | Menu: start a new TP, or "TPs déjà générés" |
| `/vr/?tp=<id>&student=<pseudonym>` | Opens a TP directly (link to share with students) |

Menu code: `src/utils/stateManager.ts` (allowed transitions), `src/services/PipelineClient.ts`
(validation, upload, polling), `src/ui/MenuUI.ts`, `src/ui/UploadUI.ts`, `src/ui/ProgressBar.ts`,
`src/scenes/MenuScene.ts` (3D background), `src/scenes/VRScene.ts` (TP session).

The menus are HTML on purpose. The PDF import happens in 2D mode: the Quest browser offers a file
picker, an immersive session does not. Once in the TP, the headset button switches to VR.
Logos: put `public/logos/ucad.png` and `public/logos/curi.png` (optional).
| `…&cam=x,y,z,tx,ty,tz` | Camera pose (debug, screenshots) |
| `…&debug=1` | Exposes `window.__tpxr` (end-to-end tests) |

## Build

```bash
cd frontend-vr
npm install
npm run build      # → dist/ (served by the backend at /vr/)
npm run watch      # rebuild on change
npm test           # unit tests (manifest, score, steps, gestures, textures)
npm run typecheck
```

The bundle is ~5.6 MB minified, **~1.3 MB gzipped** (the backend compresses it). It contains
Babylon.js 7.54.3 (same version as the backend serializer), the glTF loader and zod.

## Code layout

| File | Role |
|---|---|
| `src/main.ts` | Entry point: loading, session, XR, timers, analytics upload |
| `src/scenes/TPScene.ts` | Template + models (normalized to `target_size_m`, base on the surface, grab handle) |
| `src/scenes/TextureManager.ts` | Procedural PBR materials, box-projected UVs, reflection probe, shadows |
| `src/scenes/proceduralTextures.ts` | Tileable textures (albedo / normal / ORM), pure → tested |
| `src/scenes/InteractionHandler.ts` | Hover, grab and move, drop onto surfaces, buttons, keyboard, WebXR, hand tracking |
| `src/ui/StepPanel.ts` | Instruction board, safety signs, ◀ ▶ Crédits buttons |
| `src/ui/ScoreDisplay.ts` | Timer and score (HTML on desktop, 3D display on the workbench in VR) |
| `src/ui/CreditsPanel.ts` | CC-BY credits (3D board + HTML overlay with links) |
| `src/utils/manifest.ts` | zod validation (per asset), asset ↔ step links |
| `src/utils/analytics.ts` | `TPSession` (steps, timing, score, events) + upload |
| `src/utils/gestures.ts` | Pinch detection with hysteresis |

## Interactions

| Action | Desktop | Quest 3 (controllers) | Quest 3 (hands) |
|---|---|---|---|
| Point at / highlight an object | mouse | ray | hand ray |
| Grab and move | click-drag | trigger | thumb + index pinch |
| Next step | `N`, `→`, ▶ button | ▶ button | **right** thumb + middle finger pinch, or ▶ button |
| Previous step | `P`, `←`, ◀ button | ◀ button | **left** thumb + middle finger pinch |
| Credits | `C`, button | button | button |
| Move around | ZQSD/WASD + mouse | teleport (stick) | teleport |

When an object is released, it stays upright and drops onto the first surface below it
(workbench, shelf, floor).

## Scoring

- **Steps completed:** steps validated with ▶ (or "Terminer ✓" on the last step).
- **Accuracy:** share of grabs, made during a step, that targeted an object linked to that step.
  An object is linked to a step when its name appears in the step text, or when it is the
  object's `first_step`. Grabs during a step with no linked object are not scored, and hovers
  (`point`) never are.
- **Time per step**, **FPS** (average and minimum), and **XR / hand tracking used**.

## Deploying on Quest 3

WebXR requires **HTTPS or localhost**. On the same network, plain `http://<pc-ip>:3000` will
**not** offer the VR mode. The simplest options:

**A. USB (development):**
1. On the Quest, enable developer mode (Meta Horizon app → device → Developer mode).
2. Connect it over USB, accept the debugging prompt in the headset, then run `adb devices`.
3. Run `adb reverse tcp:3000 tcp:3000`.
4. In the Quest Browser, open `http://localhost:3000/vr/?tp=<id>&student=<pseudonym>`.
5. Press the headset button (bottom right). Hand tracking turns on when you put the controllers down.

**B. Wi-Fi (lab session):** expose the backend over HTTPS, for example with a tunnel
(`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`) or a reverse proxy with
a certificate. Then open `https://…/vr/?tp=…` on each headset.

**Performance (to measure on the headset):** the HUD and the score display show FPS, and every
session stores `fps.avg` and `fps.min`. You can also profile through `chrome://inspect` on the PC
with the Quest connected over USB. If it lags, the levers are:
- `SKETCHFAB_MAX_FACES` / `SKETCHFAB_MAX_MB` (backend `.env`);
- texture size (`DEFAULT_SIZE` in `proceduralTextures.ts`);
- shadow map size (1024 → 512 in `TextureManager.ts`);
- disabling the reflection probe.
