/**
 * Workshop layout — single source of truth.
 *
 * Every dimension and coordinate used by the 3D template (services/workshop.ts)
 * and by the placement API (routes/workshop.ts) comes from here, so the scene
 * and the metadata can never drift apart.
 *
 * Conventions:
 * - Units are meters, Y is up (Babylon.js left-handed system).
 * - Room is centered on the origin: X ∈ [-10, 10], Z ∈ [-7.5, 7.5], Y ∈ [0, 5].
 * - Zone `position` is the CENTER of the invisible zone volume. An object's base
 *   should be placed at `position.y - size.height / 2` (the supporting surface).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Size3 {
  width: number; // along X
  height: number; // along Y
  depth: number; // along Z
}

export type ZoneType = "surface" | "shelving" | "floor";
export type ZoneCapacity = "main_objects" | "small_tools" | "large_objects";

export interface ZoneSlot {
  slot: number;
  meshName: string;
  position: Vec3;
  size: Size3;
}

export interface PlacementZone {
  id: string;
  name: string;
  type: ZoneType;
  capacity: ZoneCapacity;
  maxObjects: number;
  /** Center of the zone (for shelving: center of the top slot). */
  position: Vec3;
  /** Volume of the zone (for shelving: volume of one slot). */
  size: Size3;
  /** Discrete slots (shelving only). */
  slots?: ZoneSlot[];
}

/** Room envelope. */
export const ROOM = {
  length: 20, // X
  width: 15, // Z
  height: 3, // Y — suspended ceiling height of a modern lab
  wallThickness: 0.2,
} as const;

/** Main workbench (box resting on the floor, centered on origin). */
export const WORKBENCH = {
  position: { x: 0, z: 0 },
  size: { width: 3, height: 0.9, depth: 1.5 },
} as const;

export const BACK_WALL_INNER_Z = -ROOM.width / 2 + ROOM.wallThickness / 2;

/** Inner face of the −X side wall (the only side wall without windows). */
const LEFT_WALL_INNER_X = -ROOM.length / 2 + ROOM.wallThickness / 2;
/** Gap kept between furniture backs and the wall (clears the 1.5 cm baseboard). */
const WALL_GAP = 0.025;

/**
 * Two metal shelf racks side by side against the −X wall, facing the room, level
 * with the workbench (boards run along Z, parallel to the wall). Seen from the
 * room, "left" is the one toward +Z. 49 cm between the two racks.
 */
export const SHELVES = {
  left: { id: "shelf_left", x: LEFT_WALL_INNER_X + WALL_GAP + 0.175, z: 0.78 },
  right: { id: "shelf_right", x: LEFT_WALL_INNER_X + WALL_GAP + 0.175, z: -0.78 },
  boardCount: 3,
  topBoardY: 1.5,
  boardSpacing: 0.7, // boards at 1.5 / 0.8 / 0.1
  boardSize: { width: 0.35, height: 0.03, depth: 1.0 },
  /** Thin square corner posts (graphite steel). */
  postSize: { width: 0.035, height: 1.8 },
  slotHeight: 0.2,
} as const;

/**
 * Closed two-door storage cabinet in the back-left corner, its back against the
 * −X wall and doors facing the room (+X); 5 cm clear of the wood wall.
 * `size` is given in the cabinet's own frame (width = along the doors).
 */
export const CABINET = {
  position: { x: LEFT_WALL_INNER_X + WALL_GAP + 0.3, z: BACK_WALL_INNER_Z + 0.03 + 0.05 + 0.6 },
  size: { width: 1.2, height: 1.8, depth: 0.6 },
  rotationY: Math.PI / 2, // doors (local +Z) → +X
} as const;

/** Instruction panel + safety signs, mounted on the back wall facing the room. */
export const PANELS = {
  instruction: {
    name: "instructionPanel",
    position: { x: 0, y: 1.95, z: BACK_WALL_INNER_Z + 0.04 },
    size: { width: 2, height: 1.5 },
  },
  safetySigns: [
    { name: "safety_sign_1", position: { x: 2.5, y: 1.6, z: BACK_WALL_INNER_Z + 0.04 } },
    { name: "safety_sign_2", position: { x: -2.5, y: 1.6, z: BACK_WALL_INNER_Z + 0.04 } },
  ],
  safetySignSize: { width: 0.5, height: 0.7 },
} as const;

/** Windows on the +X side wall (the student's left when facing the bench). */
export const WINDOWS = {
  centersZ: [-5, -2.2, 4.6],
  width: 2.0,
  sill: 0.9,
  height: 1.7,
} as const;

/** Where the user spawns (eye height 1.6 m), looking at the workbench. */
export const SPAWN = {
  position: { x: 0, y: 1.6, z: 4 },
  target: { x: 0, y: 1, z: 0 },
} as const;

/** Y of the board `index` (0 = top) of a shelf rack. */
export function shelfBoardY(index: number): number {
  return SHELVES.topBoardY - index * SHELVES.boardSpacing;
}

/** Builds the 3 slots of a shelf rack: each slot volume sits on top of its board. */
function buildShelfSlots(zoneId: string, x: number, z: number): ZoneSlot[] {
  const slots: ZoneSlot[] = [];
  for (let i = 0; i < SHELVES.boardCount; i++) {
    const boardTop = shelfBoardY(i) + SHELVES.boardSize.height / 2;
    slots.push({
      slot: i,
      meshName: `${zoneId}_${i}`,
      position: { x, y: round(boardTop + SHELVES.slotHeight / 2), z },
      size: {
        width: SHELVES.boardSize.width * 0.9,
        height: SHELVES.slotHeight,
        depth: SHELVES.boardSize.depth * 0.8,
      },
    });
  }
  return slots;
}

/** Rounds to millimeters to keep JSON output clean. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const leftSlots = buildShelfSlots("zone_shelf_left", SHELVES.left.x, SHELVES.left.z);
const rightSlots = buildShelfSlots("zone_shelf_right", SHELVES.right.x, SHELVES.right.z);

/** All asset placement zones (A: workbench, B/C: shelves, D: floor). */
export const ZONES: readonly PlacementZone[] = [
  {
    id: "zone_workbench",
    name: "Workbench Surface",
    type: "surface",
    capacity: "main_objects",
    maxObjects: 5,
    position: { x: 0, y: round(WORKBENCH.size.height + 0.05), z: 0 },
    size: { width: 2.8, height: 0.1, depth: 1.4 },
  },
  {
    id: "zone_shelf_left",
    name: "Left Shelf",
    type: "shelving",
    capacity: "small_tools",
    maxObjects: SHELVES.boardCount,
    position: leftSlots[0].position,
    size: leftSlots[0].size,
    slots: leftSlots,
  },
  {
    id: "zone_shelf_right",
    name: "Right Shelf",
    type: "shelving",
    capacity: "small_tools",
    maxObjects: SHELVES.boardCount,
    position: rightSlots[0].position,
    size: rightSlots[0].size,
    slots: rightSlots,
  },
  {
    id: "zone_floor",
    name: "Floor Space",
    type: "floor",
    capacity: "large_objects",
    maxObjects: 3,
    position: { x: 0, y: 0.05, z: 2.5 },
    size: { width: 2, height: 0.1, depth: 2 },
  },
];

/**
 * Compact zones map keyed by zone id — served by GET /api/workshop/zones
 * and injected into the placement agent prompt.
 */
export function zonesSummary(): Record<string, unknown> {
  return Object.fromEntries(
    ZONES.map((z) => [
      z.id,
      {
        type: z.type,
        capacity: z.capacity,
        maxObjects: z.maxObjects,
        position: z.position,
        size: z.size,
        ...(z.slots ? { slots: z.slots.map((s) => ({ slot: s.slot, position: s.position })) } : {}),
      },
    ])
  );
}
