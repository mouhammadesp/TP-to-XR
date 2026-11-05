# Workshop Template Specification (`workshop_v2`)

## Overview

The workshop is a fixed, reusable 3D environment, the "stage" into which per-TP assets are placed.
The server builds it once with Babylon.js (headless `NullEngine`), serializes it to the native
`.babylon` format, caches it, and serves it to the browser / Quest 3 WebXR viewer.

All dimensions and coordinates come from a single file:
[`backend/src/config/workshopLayout.ts`](../backend/src/config/workshopLayout.ts).
The 3D scene and the `/api/workshop/*` metadata are generated from this file and stay consistent.

| File | Role |
|---|---|
| `backend/src/config/workshopLayout.ts` | Layout: dimensions, furniture, zones, spawn |
| `backend/src/services/workshop.ts` | `WorkshopTemplate`: builds and serializes the scene |
| `backend/src/routes/workshop.ts` | REST API (`/template`, `/zones`, `/scene.babylon`) |
| `backend/public/viewer.html` | Desktop + WebXR test viewer |

## Coordinate conventions

- Units: **meters**, Y up (Babylon.js left-handed system).
- The room is centered on the origin: X ∈ [-10, 10], Z ∈ [-7.5, 7.5], Y ∈ [0, 5].
- The back wall is at Z = -7.5 (instruction panel). The user spawns at Z = +4 and looks toward it.
- A zone's `position` is the **center** of its invisible volume. The base of an object goes at
  `position.y - size.height / 2`, which is the supporting surface.

## Dimensions

- **Length (X):** 20 m · **Width (Z):** 15 m · **Height:** 5 m · walls 0.2 m thick
- **Floor:** light gray concrete

## Fixed furniture

| Element | Dimensions (W×H×D) | Position (center) | Material |
|---|---|---|---|
| Workbench | top 3 × 0.06 × 1.5 m on 4 steel legs, lower shelf at y = 0.18 | top surface at y = 0.9 (`workbench_top`) | Oak + steel |
| Left shelf rack | boards 0.35 × 0.05 × 1.0 m, 3 levels | x = -8.5, z = 0, boards at y = 1.5 / 0.8 / 0.1 | Gray metal |
| Right shelf rack | same | x = 8.5, z = 0 | Gray metal |
| Cabinet | 1.2 × 1.8 × 0.6 m | (8.5, 0.9, 2) | Dark metal |

The shelf racks are free-standing and their boards run along Z, parallel to the side walls.

**v2 additions:** ceiling (`ceiling`, y = 5), 6 ceiling LED panels (`led_panel_0..5`, emissive),
2 cabinet handles. Surfaces where objects can be put down carry `metadata.role = "surface"`
(workbench top and lower shelf, shelf boards) or `"floor"` (ground): the student app drops a
released object onto them.

**Realistic look:** the template keeps simple materials (it is built on the server, without a GPU).
The student app (`frontend-vr`) replaces them on load with procedural PBR materials (concrete,
polished floor, oak, brushed steel, painted metal, ceiling tiles). It also adds a room reflection
probe and a spot light over the workbench that casts shadows. See `frontend-vr/README.md`.

## Lighting

| Light | Type | Position | Intensity | Range |
|---|---|---|---|---|
| keyLight | Point | (2, 4, -3) | 1.2 | 30 |
| fillLight | Point | (-3, 3, 4) | 0.7 | 25 |
| ambientLight | Hemispheric (0,1,0) | — | 0.4 | — |
| backLight | Point | (0, 2, -7) | 0.5 | 20 |

## Asset placement zones

Each zone is an invisible box (`isVisible=false`, no collisions, not pickable) with
`metadata = { role: "placement_zone", zoneId, slot? }`.

| ID | Type | Center | Volume | Capacity |
|---|---|---|---|---|
| `zone_workbench` (A) | surface | (0, 0.95, 0) | 2.8 × 0.1 × 1.4 | 5 main objects |
| `zone_shelf_left` (B) | shelving | slots y = 1.625 / 0.925 / 0.225, x = -8.5 | 0.315 × 0.2 × 0.8 per slot | 1 small tool per slot |
| `zone_shelf_right` (C) | shelving | slots y = 1.625 / 0.925 / 0.225, x = 8.5 | same | 1 per slot |
| `zone_floor` (D) | floor | (0, 0.05, 2.5) | 2 × 0.1 × 2 | 3 large objects |

Shelf slot mesh names are `zone_shelf_left_0..2` and `zone_shelf_right_0..2`. Slot 0 is the top slot.

## Instruction panels

- **Main panel** `instructionPanel`: 2 × 1.5 m whiteboard at (0, 2.5, ≈-7.38), on the back wall,
  facing the room. Its per-TP text will be added as a dynamic texture.
- **Safety signs** `safety_sign_1/2`: 0.5 × 0.7 m yellow signs at (±2.5, 1.6, ≈-7.38).
  Their text depends on the TP's domain (e.g. "PORTER DES GANTS", "COUPER L'ALIMENTATION").

## Camera / spawn

`spawnCamera` (UniversalCamera) at (0, 1.6, 4) looks at (0, 1, 0). It uses collisions, gravity,
and a 0.3 × 0.8 × 0.3 ellipsoid, which keeps the eyes at 1.6 m. In VR, the floor (`ground`) is the
teleportation surface.

## API

| Endpoint | Returns |
|---|---|
| `GET /health` | `{ status, timestamp }` |
| `GET /api/workshop/template` | `{ success, template, dimensions, spawn, zones[], scene: { url, format, sizeKB } }` |
| `GET /api/workshop/zones` | Zones map keyed by `id` (input for the placement agent, Week 2) |
| `GET /api/workshop/scene.babylon` | Serialized `.babylon` scene (~64 KB) |
| `GET /viewer.html` | Test viewer (desktop + WebXR) |

## Technical specs (measured)

- **Format:** `.babylon` JSON, built on the server and cached in memory after the first request
- **Current size:** ~64 KB, from procedural geometry with no textures. The brief's ~20 MB budget
  assumed textured models, and the template will grow when PBR textures are added.
- **Content:** 28 meshes (including 8 invisible zones), 4 lights, 7 materials, 1 camera
- **Targets:** Quest 3 (90 FPS), desktop WebGL (60+ FPS)

## Asset integration flow (Weeks 2-3)

1. The instructor uploads the TP as a PDF
2. The LLM (Llama 3.3 70B via Together AI) extracts the materials and steps
3. A Sketchfab search finds 3D models (GLB)
4. The placement agent picks a zone and slot for each object (`/api/workshop/zones`)
5. The GLB files are loaded and positioned in the template
6. The combined scene is exported and deployed to S3
7. The student opens it through a WebXR link

## Per-TP customization

**Dynamic:** GLB models, positions, color overrides, safety sign text, instruction panel content, guided steps.
**Fixed (reused):** geometry, lighting, materials, collisions, spawn camera.

## Future enhancements

- [ ] Cabinet doors (animated open/close)
- [ ] Adjustable lighting
- [ ] PBR textures (concrete, wood, metal) + texture compression (KTX2)
- [ ] Gzip compression of `.babylon` (Express `compression` middleware)
- [ ] Measurement ruler (scale)
- [ ] Teleportation anchors
