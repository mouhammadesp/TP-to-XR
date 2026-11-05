/**
 * WorkshopTemplate — builds the fixed, reusable 3D workshop ("the stage")
 * into which per-TP assets are placed.
 *
 * Runs server-side on a Babylon.js NullEngine (no GPU / no canvas), then
 * serializes the scene to the native `.babylon` JSON format that the
 * browser / Quest 3 WebXR viewer loads.
 *
 * Note: we use the UMD `babylonjs` package (same 7.x API as `@babylonjs/core`)
 * because `@babylonjs/core` is ESM-only and this backend is CommonJS.
 */
import * as BABYLON from "babylonjs";
import {
  CABINET,
  PANELS,
  PlacementZone,
  ROOM,
  SHELVES,
  SPAWN,
  WINDOWS,
  WORKBENCH,
  ZONES,
  shelfBoardY,
} from "../config/workshopLayout";

/** Template identifier, bumped whenever the fixed geometry changes. */
export const TEMPLATE_VERSION = "workshop_v3";

/** Metadata attached to every invisible placement-zone mesh. */
export interface ZoneMeshMetadata {
  role: "placement_zone";
  zoneId: string;
  slot?: number;
}

export class WorkshopTemplate {
  private readonly engine: BABYLON.AbstractEngine;
  private readonly scene: BABYLON.Scene;
  private readonly ownsEngine: boolean;
  private built = false;

  /**
   * Creates an empty workshop scene.
   * @param engine Optional engine (e.g. a WebGL Engine in the browser).
   *               Defaults to a headless NullEngine for server-side use.
   */
  constructor(engine?: BABYLON.AbstractEngine) {
    this.ownsEngine = engine === undefined;
    this.engine = engine ?? new BABYLON.NullEngine();
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new BABYLON.Vector3(0, -0.15, 0);
    this.scene.clearColor = new BABYLON.Color4(0.95, 0.95, 0.95, 1);
  }

  /**
   * Builds the complete workshop (idempotent: a second call is a no-op).
   * @returns the populated Babylon.js scene
   */
  public async build(): Promise<BABYLON.Scene> {
    if (this.built) return this.scene;
    console.log("🏗️  Building workshop template...");

    this.createBaseGeometry();
    this.createFurniture();
    this.createLighting();
    this.createInstructionPanels();
    this.createModernFitout();
    this.defineAssetZones();
    this.createSpawnCamera();

    this.built = true;
    console.log(
      `✅ Workshop template built (${this.scene.meshes.length} meshes, ${this.scene.lights.length} lights)`
    );
    return this.scene;
  }

  /**
   * Serializes the scene to the native `.babylon` format.
   * @returns the `.babylon` JSON document as a string
   */
  public async exportScene(): Promise<string> {
    await this.build();
    console.log("📦 Serializing workshop scene to .babylon...");
    const sceneData = BABYLON.SceneSerializer.Serialize(this.scene);
    const json = JSON.stringify(sceneData);
    console.log(`📦 Scene serialized (${(json.length / 1024).toFixed(1)} KB)`);
    return json;
  }

  /**
   * Returns the placement zones metadata (shared with the API).
   */
  public getZonesMetadata(): { template: string; zones: readonly PlacementZone[] } {
    return { template: TEMPLATE_VERSION, zones: ZONES };
  }

  /**
   * Releases the scene (and the engine if this instance created it).
   */
  public dispose(): void {
    this.scene.dispose();
    if (this.ownsEngine) this.engine.dispose();
  }

  /**
   * Creates the floor (20 m × 15 m) and the 4 walls (5 m high).
   */
  private createBaseGeometry(): void {
    const ground = BABYLON.MeshBuilder.CreateGround(
      "ground",
      { width: ROOM.length, height: ROOM.width, subdivisions: 4 },
      this.scene
    );
    const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.8, 0.8, 0.8); // polished concrete
    groundMat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
    ground.material = groundMat;
    ground.checkCollisions = true;
    ground.metadata = { role: "floor" };

    const wallMat = new BABYLON.StandardMaterial("wallMat", this.scene);
    wallMat.diffuseColor = new BABYLON.Color3(0.7, 0.7, 0.75); // concrete gray
    wallMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

    const halfL = ROOM.length / 2;
    const halfW = ROOM.width / 2;
    const y = ROOM.height / 2;
    this.createWall("wall_back", 0, y, -halfW, ROOM.length, 0, wallMat);
    this.createWall("wall_front", 0, y, halfW, ROOM.length, 0, wallMat);
    this.createWall("wall_left", -halfL, y, 0, ROOM.width, Math.PI / 2, wallMat);
    this.createWall("wall_right", halfL, y, 0, ROOM.width, Math.PI / 2, wallMat);

    const ceiling = BABYLON.MeshBuilder.CreateBox(
      "ceiling",
      { width: ROOM.length, height: 0.1, depth: ROOM.width },
      this.scene
    );
    ceiling.position = new BABYLON.Vector3(0, ROOM.height + 0.05, 0);
    const ceilingMat = new BABYLON.StandardMaterial("ceilingMat", this.scene);
    ceilingMat.diffuseColor = new BABYLON.Color3(0.92, 0.92, 0.9);
    ceiling.material = ceilingMat;
    ceiling.isPickable = false;
  }

  /**
   * Creates one wall as a thin box.
   * @param rotationY 0 for walls along X, π/2 for walls along Z
   */
  private createWall(
    name: string,
    posX: number,
    posY: number,
    posZ: number,
    width: number,
    rotationY: number,
    material: BABYLON.Material
  ): void {
    const wall = BABYLON.MeshBuilder.CreateBox(
      name,
      { width, height: ROOM.height, depth: ROOM.wallThickness },
      this.scene
    );
    wall.position = new BABYLON.Vector3(posX, posY, posZ);
    wall.rotation.y = rotationY;
    wall.material = material;
    wall.checkCollisions = true;
  }

  /**
   * Creates the fixed furniture: workbench, two shelf racks, cabinet.
   */
  private createFurniture(): void {
    const benchMat = new BABYLON.StandardMaterial("benchMat", this.scene);
    benchMat.diffuseColor = new BABYLON.Color3(0.6, 0.4, 0.2); // wood
    benchMat.specularColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    const steelMat = new BABYLON.StandardMaterial("steelMat", this.scene);
    steelMat.diffuseColor = new BABYLON.Color3(0.45, 0.47, 0.5); // steel frame
    this.createWorkbench(benchMat, steelMat);

    // Materials are named placeholders: the viewer replaces them by name (textured PBR).
    const shelfMat = new BABYLON.StandardMaterial("shelfMat", this.scene);
    shelfMat.diffuseColor = new BABYLON.Color3(0.78, 0.78, 0.77); // light-gray boards
    const frameMat = new BABYLON.StandardMaterial("furnitureFrameMat", this.scene);
    frameMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.13); // graphite posts, handles
    this.createShelfUnit(SHELVES.left.id, SHELVES.left.x, SHELVES.left.z, frameMat, shelfMat);
    this.createShelfUnit(SHELVES.right.id, SHELVES.right.x, SHELVES.right.z, frameMat, shelfMat);
    this.createCabinet(frameMat);
  }

  /**
   * Two-door metal storage cabinet: carcass, plinth recessed under it, two doors
   * with a thin central seam, black bar handles and discreet hinges. Built in the
   * cabinet's frame (doors toward local +Z), then turned by CABINET.rotationY.
   */
  private createCabinet(blackMat: BABYLON.Material): void {
    const { width: W, height: H, depth: D } = CABINET.size;
    const rot = CABINET.rotationY;
    const plinth = 0.07;
    const doorT = 0.02;
    const place = (mesh: BABYLON.Mesh, lx: number, ly: number, lz: number, mat: BABYLON.Material) => {
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      mesh.position = new BABYLON.Vector3(CABINET.position.x + lx * c + lz * sn, ly, CABINET.position.z - lx * sn + lz * c);
      mesh.rotation.y = rot;
      mesh.material = mat;
      mesh.isPickable = false;
      return mesh;
    };
    const paintMat = new BABYLON.StandardMaterial("cabinetMat", this.scene);
    paintMat.diffuseColor = new BABYLON.Color3(0.3, 0.31, 0.33); // graphite paint
    const bodyH = H - plinth;
    const midY = plinth + bodyH / 2;

    const carcass = place(BABYLON.MeshBuilder.CreateBox("cabinet", { width: W, height: bodyH, depth: D - doorT }, this.scene), 0, midY, -doorT / 2, paintMat);
    carcass.checkCollisions = true;
    place(BABYLON.MeshBuilder.CreateBox("cabinet_plinth", { width: W - 0.06, height: plinth, depth: D - doorT - 0.06 }, this.scene), 0, plinth / 2, -doorT / 2, blackMat);

    const front = D / 2 - doorT; // carcass front face (local z)
    const reveal = 0.004; // gap around and between the doors
    const doorW = W / 2 - 1.5 * reveal;
    const doorH = bodyH - 2 * reveal;
    for (const [side, sx] of [["l", -1], ["r", 1]] as const) {
      place(BABYLON.MeshBuilder.CreateBox(`cabinet_door_${side}`, { width: doorW, height: doorH, depth: doorT }, this.scene), sx * (W / 4 - reveal / 4), midY, front + doorT / 2, paintMat);
      // Hinges on the outer edges, handles next to the central seam.
      for (const hy of [plinth + 0.25, H - 0.25]) {
        const hinge = BABYLON.MeshBuilder.CreateCylinder(`cabinet_hinge_${side}_${hy < 1 ? "b" : "t"}`, { diameter: 0.014, height: 0.08, tessellation: 10 }, this.scene);
        place(hinge, sx * (W / 2 - 0.002), hy, front + doorT / 2, blackMat);
      }
    }
    place(BABYLON.MeshBuilder.CreateBox("cabinet_seam", { width: 2 * reveal, height: doorH, depth: 0.004 }, this.scene), 0, midY, front + 0.002, blackMat);
    for (const [i, sx] of [-1, 1].entries()) {
      place(BABYLON.MeshBuilder.CreateBox(`cabinet_handle_${i}`, { width: 0.016, height: 0.22, depth: 0.022 }, this.scene), sx * 0.055, 1.05, D / 2 + 0.011, blackMat);
    }
  }

  /**
   * Creates the workbench: wooden top + lower shelf on 4 steel legs.
   * The top surface stays at WORKBENCH.size.height (placement zone reference).
   */
  private createWorkbench(woodMat: BABYLON.Material, steelMat: BABYLON.Material): void {
    const { width, height, depth } = WORKBENCH.size;
    const { x, z } = WORKBENCH.position;
    const topThickness = 0.06;
    const leg = 0.06;

    const top = BABYLON.MeshBuilder.CreateBox(
      "workbench_top",
      { width, height: topThickness, depth },
      this.scene
    );
    top.position = new BABYLON.Vector3(x, height - topThickness / 2, z);
    top.material = woodMat;
    top.checkCollisions = true;
    top.metadata = { role: "surface" };

    const legHeight = height - topThickness;
    let i = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const l = BABYLON.MeshBuilder.CreateBox(
          `workbench_leg_${i++}`,
          { width: leg, height: legHeight, depth: leg },
          this.scene
        );
        l.position = new BABYLON.Vector3(
          x + sx * (width / 2 - leg),
          legHeight / 2,
          z + sz * (depth / 2 - leg)
        );
        l.material = steelMat;
        l.checkCollisions = true;
      }
    }

    const lower = BABYLON.MeshBuilder.CreateBox(
      "workbench_shelf",
      { width: width - 0.2, height: 0.03, depth: depth - 0.2 },
      this.scene
    );
    lower.position = new BABYLON.Vector3(x, 0.18, z);
    lower.material = woodMat;
    lower.metadata = { role: "surface" };
  }

  /**
   * Creates a modern metal shelf rack: 4 thin graphite corner posts tied by short
   * end rails at the top and bottom, and N light-gray boards (3 cm) along Z.
   * Board names / roles are the placement references (`<id>_shelf_<i>`, "surface").
   */
  private createShelfUnit(
    name: string,
    posX: number,
    posZ: number,
    frameMat: BABYLON.Material,
    boardMat: BABYLON.Material
  ): void {
    const { width: bw, depth: bd } = SHELVES.boardSize;
    const { width: post, height: postH } = SHELVES.postSize;
    const px = bw / 2 - post / 2;
    const pz = bd / 2 + post / 2;
    let k = 0;
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        const p = BABYLON.MeshBuilder.CreateBox(`${name}_post_${k++}`, { width: post, height: postH, depth: post }, this.scene);
        p.position = new BABYLON.Vector3(posX + sx * px, postH / 2, posZ + sz * pz);
        p.material = frameMat;
        p.checkCollisions = true;
      }
      // End rails (along X) joining the two posts of each end, near the floor and at the top.
      for (const [j, y] of [0.03, postH - 0.015].entries()) {
        const rail = BABYLON.MeshBuilder.CreateBox(`${name}_post_rail_${sz < 0 ? "a" : "b"}${j}`, { width: bw - 2 * post, height: 0.025, depth: 0.02 }, this.scene);
        rail.position = new BABYLON.Vector3(posX, y, posZ + sz * pz);
        rail.material = frameMat;
      }
    }

    for (let i = 0; i < SHELVES.boardCount; i++) {
      const board = BABYLON.MeshBuilder.CreateBox(
        `${name}_shelf_${i}`,
        SHELVES.boardSize,
        this.scene
      );
      board.position = new BABYLON.Vector3(posX, shelfBoardY(i), posZ);
      board.metadata = { role: "surface" };
      board.material = boardMat;
      board.checkCollisions = true;
    }
  }

  /**
   * Creates the lighting: key / fill / back point lights + hemispheric ambient.
   */
  private createLighting(): void {
    const keyLight = new BABYLON.PointLight("keyLight", new BABYLON.Vector3(2, 2.8, -3), this.scene);
    keyLight.intensity = 1.2;
    keyLight.range = 30;

    const fillLight = new BABYLON.PointLight("fillLight", new BABYLON.Vector3(-3, 2.8, 4), this.scene);
    fillLight.intensity = 0.7;
    fillLight.range = 25;

    const ambientLight = new BABYLON.HemisphericLight(
      "ambientLight",
      new BABYLON.Vector3(0, 1, 0),
      this.scene
    );
    ambientLight.intensity = 0.4;

    const backLight = new BABYLON.PointLight("backLight", new BABYLON.Vector3(0, 2, -7), this.scene);
    backLight.intensity = 0.5;
    backLight.range = 20;

    // Recessed 60 × 60 LED panels in the suspended ceiling, merged into ONE mesh (one draw call).
    const ledMat = new BABYLON.StandardMaterial("ledMat", this.scene);
    ledMat.emissiveColor = new BABYLON.Color3(1, 1, 0.97);
    ledMat.disableLighting = true;
    const panels: BABYLON.Mesh[] = [];
    for (const x of [-6, -3, 0, 3, 6]) {
      for (const z of [-4.5, -1.5, 1.5, 4.5]) {
        const led = BABYLON.MeshBuilder.CreateBox("led", { width: 0.58, height: 0.01, depth: 0.58 }, this.scene);
        led.position = new BABYLON.Vector3(x, ROOM.height - 0.004, z);
        panels.push(led);
      }
    }
    const leds = BABYLON.Mesh.MergeMeshes(panels, true);
    if (leds) {
      leds.name = "led_panels";
      leds.material = ledMat;
      leds.isPickable = false;
    }
  }

  /**
   * Modern fit-out: windows with frames, sills and open pleated curtains on rails,
   * a wooden acoustic wall with an LED cove above it, baseboards.
   * Materials are named placeholders: the viewer replaces them with textured PBR materials.
   */
  private createModernFitout(): void {
    const s = this.scene;
    const named = (name: string, hex: string) => {
      const m = new BABYLON.StandardMaterial(name, s);
      m.diffuseColor = BABYLON.Color3.FromHexString(hex);
      return m;
    };
    const frameMat = named("windowFrameMat", "#E8EAEC");
    const curtainMat = named("curtainMat", "#C9C6BF");
    const viewMat = named("windowViewMat", "#BFD9F2");
    const wallX = ROOM.length / 2 - ROOM.wallThickness / 2; // inner face of the +X wall
    const { width, sill, height } = WINDOWS;
    const midY = sill + height / 2;

    WINDOWS.centersZ.forEach((z, i) => {
      // Outside view (a picture, no real opening in the wall), facing the room (-X).
      const view = BABYLON.MeshBuilder.CreatePlane(`window_view_${i}`, { width, height }, s);
      view.position = new BABYLON.Vector3(wallX - 0.005, midY, z);
      view.rotation.y = Math.PI / 2;
      view.material = viewMat;
      view.isPickable = false;
      // Aluminum frame: top, bottom, two sides and a central mullion.
      const bar = (name: string, h: number, d: number, y: number, dz: number) => {
        const b = BABYLON.MeshBuilder.CreateBox(name, { width: 0.06, height: h, depth: d }, s);
        b.position = new BABYLON.Vector3(wallX - 0.03, y, z + dz);
        b.material = frameMat;
        b.isPickable = false;
      };
      bar(`window_frame_${i}_t`, 0.06, width + 0.12, sill + height + 0.03, 0);
      bar(`window_frame_${i}_b`, 0.06, width + 0.12, sill - 0.03, 0);
      bar(`window_frame_${i}_l`, height + 0.12, 0.06, midY, -width / 2 - 0.03);
      bar(`window_frame_${i}_r`, height + 0.12, 0.06, midY, width / 2 + 0.03);
      bar(`window_frame_${i}_m`, height, 0.04, midY, 0);
      const ledge = BABYLON.MeshBuilder.CreateBox(`window_sill_${i}`, { width: 0.22, height: 0.03, depth: width + 0.3 }, s);
      ledge.position = new BABYLON.Vector3(wallX - 0.11, sill - 0.075, z);
      ledge.material = frameMat;
      ledge.isPickable = false;
    });

    this.createCurtains(wallX, frameMat, curtainMat);

    // Wooden acoustic slats covering the whole back wall, floor to suspended ceiling
    // (side wall to side wall); the textures are world-scaled, so no stretching.
    // Only the visible face, 3 cm off the wall, cut in 10 cm rows: the viewer
    // shades it per vertex with the warm light falling from the LED cove above.
    const backZ = -ROOM.width / 2 + ROOM.wallThickness / 2;
    const accentW = ROOM.length - ROOM.wallThickness;
    const accent = BABYLON.MeshBuilder.CreateGround(
      "accent_panel",
      { width: accentW, height: ROOM.height, subdivisionsX: 1, subdivisionsY: Math.round(ROOM.height / 0.1) },
      s
    );
    accent.rotation.x = Math.PI / 2; // ground normal +Y → +Z (toward the room)
    accent.bakeCurrentTransformIntoVertices();
    accent.position = new BABYLON.Vector3(0, ROOM.height / 2, backZ + 0.03);
    accent.material = named("accentMat", "#B08155");
    accent.isPickable = false;

    // Architectural LED cove at the wood / ceiling junction: a slim aluminum profile
    // recessed under the ceiling along the whole wall, with a warm-white (≈ 3000 K)
    // diffuser facing down. Emissive only — the light it casts is simulated on the wood.
    const coveW = accentW - 0.004; // stops 2 mm short of each side wall
    const profile = BABYLON.MeshBuilder.CreateBox("led_profile", { width: coveW, height: 0.012, depth: 0.07 }, s);
    profile.position = new BABYLON.Vector3(0, ROOM.height - 0.006, backZ + 0.03 + 0.035);
    profile.material = frameMat;
    profile.isPickable = false;
    const strip = BABYLON.MeshBuilder.CreatePlane("led_strip", { width: coveW, height: 0.028 }, s);
    strip.rotation.x = -Math.PI / 2; // faces down
    strip.position = new BABYLON.Vector3(0, ROOM.height - 0.0125, backZ + 0.03 + 0.022);
    const stripMat = new BABYLON.StandardMaterial("ledStripMat", s);
    stripMat.emissiveColor = new BABYLON.Color3(1, 0.88, 0.74); // warm white, not yellow
    stripMat.disableLighting = true;
    strip.material = stripMat;
    strip.isPickable = false;

    // Baseboards along the four walls.
    const base = named("baseboardMat", "#2E3236");
    const halfL = ROOM.length / 2 - ROOM.wallThickness / 2;
    const halfW = ROOM.width / 2 - ROOM.wallThickness / 2;
    const boards: [string, number, number, number, number][] = [
      ["baseboard_back", 0, -halfW + 0.008, ROOM.length, 0.015],
      ["baseboard_front", 0, halfW - 0.008, ROOM.length, 0.015],
      ["baseboard_left", -halfL + 0.008, 0, 0.015, ROOM.width],
      ["baseboard_right", halfL - 0.008, 0, 0.015, ROOM.width],
    ];
    for (const [name, x, z, w, d] of boards) {
      const b = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: 0.08, depth: d }, s);
      b.position = new BABYLON.Vector3(x, 0.04, z);
      b.material = base;
      b.isPickable = false;
    }

    this.createAirConditioner();
  }

  /**
   * Wall-mounted split air conditioner (decoration only), high on the −X wall
   * (no windows), on the free stretch between the cabinet and the shelves.
   * ≈ 88 × 29 × 21 cm, 29 cm under the ceiling. Rounded side profile extruded along
   * the wall, dark air outlet with an angled flap, front panel line, white pipe
   * trunking up to the ceiling. Same-material parts merged: 4 draw calls.
   * The intake grille and the small display are painted by the viewer (named planes).
   */
  private createAirConditioner(): void {
    const s = this.scene;
    const wallX = -ROOM.length / 2 + ROOM.wallThickness / 2; // inner face of the −X wall
    const W = 0.88; // along the wall (Z)
    const H = 0.29;
    const D = 0.21; // depth into the room (+X)
    const x0 = wallX + 0.005; // mounting plate
    const y0 = ROOM.height - 0.29 - H; // bottom of the unit
    const zc = -3.7; // between the cabinet (z ≤ −6.1) and the shelves (z ≥ −1.3)

    const white = new BABYLON.StandardMaterial("airconWhiteMat", s);
    white.diffuseColor = new BABYLON.Color3(0.93, 0.94, 0.95);
    white.specularColor = new BABYLON.Color3(0.22, 0.22, 0.22);
    white.specularPower = 48;
    const dark = new BABYLON.StandardMaterial("airconDarkMat", s);
    dark.diffuseColor = new BABYLON.Color3(0.13, 0.14, 0.15);
    dark.specularColor = BABYLON.Color3.Black();

    // Side profile (x = depth, y = height), rounded at the front, extruded along Z.
    const profile = [
      [0, H], [0.17, H], [0.195, H - 0.007], [0.207, H - 0.025], [D, H - 0.05], [D, 0.1],
      [0.205, 0.07], [0.19, 0.045], [0.165, 0.025], [0.13, 0.012], [0, 0.012],
    ].map(([x, y]) => new BABYLON.Vector3(x, y, 0));
    const body = BABYLON.MeshBuilder.ExtrudeShape(
      "aircon_shell",
      {
        shape: profile,
        closeShape: true,
        path: [new BABYLON.Vector3(0, 0, -W / 2), new BABYLON.Vector3(0, 0, W / 2)],
        cap: BABYLON.Mesh.CAP_ALL,
        sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      },
      s
    );
    body.position = new BABYLON.Vector3(x0, y0, zc);
    // Air-outlet flap, tilted down toward the room.
    const flap = BABYLON.MeshBuilder.CreateBox("aircon_flap", { width: 0.065, height: 0.005, depth: W - 0.12 }, s);
    flap.position = new BABYLON.Vector3(x0 + 0.188, y0 + 0.02, zc);
    flap.rotation.z = -0.35;
    // Pipe / cable trunking from the unit up to the ceiling (pipes go through the ceiling void).
    const trunk = BABYLON.MeshBuilder.CreateBox("aircon_trunking", { width: 0.06, height: ROOM.height - (y0 + H), depth: 0.08 }, s);
    trunk.position = new BABYLON.Vector3(wallX + 0.03, (ROOM.height + y0 + H) / 2, zc + W / 2 - 0.08);
    const whiteParts = BABYLON.Mesh.MergeMeshes([body, flap, trunk], true, true);
    if (whiteParts) {
      whiteParts.name = "aircon_body";
      whiteParts.material = white;
      whiteParts.isPickable = false;
    }

    // Dark outlet slot under the curved front + hairline of the front panel.
    const outlet = BABYLON.MeshBuilder.CreateBox("aircon_outlet", { width: 0.075, height: 0.022, depth: W - 0.12 }, s);
    outlet.position = new BABYLON.Vector3(x0 + 0.15, y0 + 0.03, zc);
    const seam = BABYLON.MeshBuilder.CreateBox("aircon_seam", { width: 0.002, height: 0.003, depth: W - 0.02 }, s);
    seam.position = new BABYLON.Vector3(x0 + D + 0.0005, y0 + 0.235, zc);
    const darkParts = BABYLON.Mesh.MergeMeshes([outlet, seam], true, true);
    if (darkParts) {
      darkParts.name = "aircon_dark";
      darkParts.material = dark;
      darkParts.isPickable = false;
    }

    // Intake grille on top, small display on the front (textures painted by the viewer).
    const grille = BABYLON.MeshBuilder.CreatePlane("aircon_grille", { width: 0.13, height: W - 0.1 }, s);
    grille.rotation.x = Math.PI / 2; // faces up
    grille.position = new BABYLON.Vector3(x0 + 0.085, y0 + H + 0.0008, zc);
    grille.material = white;
    grille.isPickable = false;
    const display = BABYLON.MeshBuilder.CreatePlane("aircon_display", { width: 0.06, height: 0.018 }, s);
    display.rotation.y = -Math.PI / 2; // faces the room (+X)
    display.position = new BABYLON.Vector3(x0 + D + 0.001, y0 + 0.17, zc + W / 2 - 0.12);
    display.material = white;
    display.isPickable = false;
  }

  /**
   * Open curtains on the window wall: thin rails fixed just under the ceiling and
   * pleated linen panels gathered beside each window, glass left clear. Windows 0
   * and 1 share one rail; the panel between them is a single stack in the pier.
   */
  private createCurtains(wallX: number, railMat: BABYLON.Material, curtainMat: BABYLON.Material): void {
    const { centersZ, width } = WINDOWS;
    const clear = width / 2 + 0.06 + 0.04; // glass + frame + 4 cm: the curtain never covers the window
    const stack = 0.55; // gathered width of a side panel
    const x = wallX - 0.25; // in front of the window sills (they reach wallX - 0.22)
    const [z0, z1, z2] = centersZ;
    const pier = (z0 + clear + (z1 - clear)) / 2;
    const pierW = Math.min(0.62, z1 - z0 - 2 * clear - 0.04);
    const panels: [string, number, number, [number, number]][] = [
      ["curtain_0_l", z0 - clear - stack, z0 - clear, [0.06, 0]],
      ["curtain_01_pier", pier - pierW / 2, pier + pierW / 2, [0.015, 0.015]],
      ["curtain_1_r", z1 + clear, z1 + clear + stack, [0, 0.06]],
      ["curtain_2_l", z2 - clear - stack, z2 - clear, [0.06, 0]],
      ["curtain_2_r", z2 + clear, z2 + clear + stack, [0, 0.06]],
    ];
    for (const [name, a, b, flare] of panels) this.createCurtain(name, x, a, b, flare).material = curtainMat;
    const rails: [number, number][] = [
      [z0 - clear - stack - 0.08, z1 + clear + stack + 0.08],
      [z2 - clear - stack - 0.08, z2 + clear + stack + 0.08],
    ];
    rails.forEach(([a, b], i) => {
      const rail = BABYLON.MeshBuilder.CreateBox(`curtain_track_${i}`, { width: 0.03, height: 0.018, depth: b - a }, this.scene);
      rail.position = new BABYLON.Vector3(x - 0.04, ROOM.height - 0.009, (a + b) / 2);
      rail.material = railMat;
      rail.isPickable = false;
    });
  }

  /**
   * Pinch-pleated curtain panel gathered between z = `zA` and `zB` (Y–Z plane at
   * `x`, folds toward the room), from the rail to 2 cm above the floor. Soft
   * rounded wave folds every ≈ 11 cm, a little irregular, deeper under the heading
   * and flaring slightly toward the hem (`flare` = extra width at the bottom on
   * the zA / zB side). The fold recesses are darkened by vertex colors (baked
   * ambient occlusion). A ribbon of a few hundred vertices, no cloth simulation.
   */
  private createCurtain(name: string, x: number, zA: number, zB: number, flare: [number, number]): BABYLON.Mesh {
    const folds = Math.max(4, Math.round((zB - zA) / 0.11));
    const steps = folds * 10;
    const top = ROOM.height - 0.03;
    const hem = 0.02;
    // Rows: heading, under the heading, middle, hem — with fold depth per row.
    const rows: [number, number][] = [
      [top, 0.11],
      [top - 0.12, 0.105],
      [1.5, 0.095],
      [hem, 0.085],
    ];
    const seed = name.length * 1.7;
    const line = ([y, depth]: [number, number]) => {
      const t = (top - y) / (top - hem);
      const a = zA - flare[0] * t;
      const b = zB + flare[1] * t;
      return Array.from({ length: steps + 1 }, (_, k) => {
        const u = k / steps;
        const irregular = 0.85 + 0.15 * Math.sin(u * 9.1 + seed);
        const fold = 0.5 - 0.5 * Math.cos(u * folds * Math.PI * 2);
        return new BABYLON.Vector3(x - depth * irregular * fold, y, a + u * (b - a));
      });
    };
    const curtain = BABYLON.MeshBuilder.CreateRibbon(
      name,
      { pathArray: rows.map(line), sideOrientation: BABYLON.Mesh.DOUBLESIDE },
      this.scene
    );
    // Baked occlusion: recesses (back, toward the wall) darker than the crests.
    const pos = curtain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    if (pos) {
      const colors: number[] = [];
      for (let i = 0; i < pos.length; i += 3) {
        const c = 0.72 + 0.28 * Math.min(1, (x - pos[i]) / 0.09);
        colors.push(c, c, c, 1);
      }
      curtain.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors);
    }
    curtain.isPickable = false;
    return curtain;
  }

  /**
   * Creates the instruction whiteboard and the safety signs on the back wall.
   * Their content (text textures) is filled per TP at runtime.
   */
  private createInstructionPanels(): void {
    const { instruction } = PANELS;
    const panel = BABYLON.MeshBuilder.CreatePlane(instruction.name, instruction.size, this.scene);
    panel.position = new BABYLON.Vector3(
      instruction.position.x,
      instruction.position.y,
      instruction.position.z
    );
    panel.rotation.y = Math.PI; // plane front faces -Z by default → turn it toward the room
    panel.metadata = { role: "instruction_panel" };

    const panelMat = new BABYLON.StandardMaterial("panelMat", this.scene);
    panelMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
    panelMat.emissiveColor = new BABYLON.Color3(0.9, 0.9, 0.9); // readable whiteboard
    panel.material = panelMat;

    const signMat = new BABYLON.StandardMaterial("safetySignMat", this.scene);
    signMat.emissiveColor = new BABYLON.Color3(1, 0.8, 0); // warning yellow
    for (const sign of PANELS.safetySigns) {
      this.createSafetySign(sign.name, sign.position, signMat);
    }
  }

  /**
   * Creates one safety sign billboard facing the room.
   */
  private createSafetySign(
    name: string,
    position: { x: number; y: number; z: number },
    material: BABYLON.Material
  ): void {
    const sign = BABYLON.MeshBuilder.CreatePlane(name, PANELS.safetySignSize, this.scene);
    sign.position = new BABYLON.Vector3(position.x, position.y, position.z);
    sign.rotation.y = Math.PI;
    sign.material = material;
    sign.metadata = { role: "safety_sign" };
  }

  /**
   * Creates the invisible placement-zone volumes from the shared layout config.
   * Each mesh carries `ZoneMeshMetadata` so the runtime can find it by zoneId.
   */
  private defineAssetZones(): void {
    for (const zone of ZONES) {
      if (zone.slots) {
        for (const slot of zone.slots) {
          this.createZoneMesh(slot.meshName, slot.position, slot.size, {
            role: "placement_zone",
            zoneId: zone.id,
            slot: slot.slot,
          });
        }
      } else {
        this.createZoneMesh(zone.id, zone.position, zone.size, {
          role: "placement_zone",
          zoneId: zone.id,
        });
      }
    }
  }

  /**
   * Creates one invisible, non-colliding, non-pickable zone box.
   */
  private createZoneMesh(
    name: string,
    position: { x: number; y: number; z: number },
    size: { width: number; height: number; depth: number },
    metadata: ZoneMeshMetadata
  ): void {
    const mesh = BABYLON.MeshBuilder.CreateBox(name, size, this.scene);
    mesh.position = new BABYLON.Vector3(position.x, position.y, position.z);
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = metadata;
  }

  /**
   * Creates the default first-person camera at the spawn point
   * (eye height 1.6 m, with collisions and gravity for desktop walking).
   */
  private createSpawnCamera(): void {
    const camera = new BABYLON.UniversalCamera(
      "spawnCamera",
      new BABYLON.Vector3(SPAWN.position.x, SPAWN.position.y, SPAWN.position.z),
      this.scene
    );
    camera.setTarget(new BABYLON.Vector3(SPAWN.target.x, SPAWN.target.y, SPAWN.target.z));
    camera.minZ = 0.05;
    camera.speed = 0.15;
    camera.checkCollisions = true;
    camera.applyGravity = true;
    camera.ellipsoid = new BABYLON.Vector3(0.3, 0.8, 0.3);
    this.scene.activeCamera = camera;
  }
}

export default WorkshopTemplate;
