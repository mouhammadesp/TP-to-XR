/**
 * Placement resolver — turns the agent's (relative, unchecked) proposal into
 * a safe, absolute placement plan for scene assembly.
 *
 * Guarantees, whatever the LLM answered:
 * - every input asset is either placed exactly once or listed in `unplaced`;
 * - zone capacities are respected (shelves: 1 object per slot);
 * - objects stay inside their zone and do not overlap (circular footprints);
 * - `position` is ABSOLUTE and points to the object's BASE center, i.e. the
 *   supporting surface (workbench top, shelf board top, floor).
 */
import { SizeSource, resolveRealSize } from "../config/realSizes";
import { PANELS, PlacementZone, Vec3, ZONES } from "../config/workshopLayout";
import { AssetInput, ColorScheme, LLMPlacement, LLMPlacementResult } from "../schemas/tp";

/** Minimum gap between two objects on the same surface (meters). */
export const GAP = 0.05;
/** Grid step used to search a free spot on a surface (meters). */
const GRID_STEP = 0.1;
/** Max object size on a shelf (board depth / clearance to the next board). */
const SHELF_MAX_SIZE = 0.6;
/** Objects larger than this go to the floor first when re-assigned. */
const LARGE_OBJECT_M = 0.8;
/** Max characters per wall safety sign. */
const SIGN_MAX_CHARS = 40;

export interface ResolvedPlacement {
  asset_id: string;
  asset_name: string;
  glb_url?: string;
  zone: string;
  slot: number | null;
  /** Absolute base-center position (meters). */
  position: Vec3;
  rotation_y: number;
  /** Largest dimension the model must be scaled to (meters). */
  target_size_m: number;
  /** Where that size comes from (TP text, standard, AI estimate…) — see config/realSizes.ts. */
  size_source: SizeSource;
  size_note: string;
  color_override: string | null;
  /** Corrections applied by the resolver (empty if the agent's proposal was kept). */
  adjustments: string[];
}

export interface SafetySignContent {
  sign: string;
  text: string;
  position: Vec3;
}

export interface PlacementPlan {
  placements: ResolvedPlacement[];
  unplaced: { asset_id: string; reason: string }[];
  color_scheme: ColorScheme;
  safety_signs: SafetySignContent[];
  warnings: string[];
  reasoning: string;
}

/** Object already placed on a surface zone (for overlap checks). */
interface Footprint {
  x: number;
  z: number;
  r: number;
}

/** Mutable occupancy state of the workshop during resolution. */
class Occupancy {
  private readonly surfaces = new Map<string, Footprint[]>();
  private readonly slots = new Map<string, Set<number>>();

  /** Number of objects already in a zone. */
  count(zone: PlacementZone): number {
    return zone.slots ? this.slotsOf(zone).size : this.footprintsOf(zone).length;
  }

  /** Taken slot indices of a shelving zone. */
  slotsOf(zone: PlacementZone): Set<number> {
    let set = this.slots.get(zone.id);
    if (!set) this.slots.set(zone.id, (set = new Set()));
    return set;
  }

  /** Footprints already placed on a surface/floor zone. */
  footprintsOf(zone: PlacementZone): Footprint[] {
    let list = this.surfaces.get(zone.id);
    if (!list) this.surfaces.set(zone.id, (list = []));
    return list;
  }
}

/**
 * Validates and resolves the agent's proposal against the workshop layout.
 * @param proposal raw output of PROMPT #3 (already schema-validated)
 * @param assets   the assets that were sent to the agent
 */
export function resolvePlacement(proposal: LLMPlacementResult, assets: AssetInput[], tpTexts: string[] = []): PlacementPlan {
  const occupancy = new Occupancy();
  const assetsById = new Map(assets.map((a) => [a.id, a]));
  const proposed = new Map<string, LLMPlacement>();
  const warnings: string[] = [];

  for (const p of proposal.placements) {
    if (!assetsById.has(p.asset_id)) {
      warnings.push(`Placement : objet inconnu « ${p.asset_id} » ignoré`);
    } else if (proposed.has(p.asset_id)) {
      warnings.push(`Placement : « ${p.asset_id} » placé deux fois (premier conservé)`);
    } else {
      proposed.set(p.asset_id, p);
    }
  }

  // Place the agent's choices first (in its order), then the forgotten assets.
  const ordered = [
    ...[...proposed.keys()].map((id) => assetsById.get(id) as AssetInput),
    ...assets.filter((a) => !proposed.has(a.id)),
  ];

  const placements: ResolvedPlacement[] = [];
  const unplaced: PlacementPlan["unplaced"] = [];

  for (const asset of ordered) {
    const p = proposed.get(asset.id);
    const adjustments: string[] = [];
    if (!p) adjustments.push("not placed by the agent → auto-placed");

    // Real size first (TP text / standard), the AI estimate only otherwise.
    const real = resolveRealSize(asset.name, p?.target_size_m ?? asset.approx_size_m ?? 0.3, tpTexts);
    const size = real.size_m;
    const requested = p ? ZONES.find((z) => z.id === p.zone) : undefined;
    if (p && !requested) adjustments.push(`unknown zone "${p.zone}"`);

    const candidates = candidateZones(requested, size);
    let placed: ResolvedPlacement | null = null;

    for (const zone of candidates) {
      const isRequested = zone === requested;
      const result = tryPlaceInZone(zone, occupancy, size, isRequested ? p : undefined);
      if (result) {
        if (requested && !isRequested) adjustments.push(`zone ${requested.id} full or unsuitable → ${zone.id}`);
        placed = {
          asset_id: asset.id,
          asset_name: asset.name,
          ...(asset.glb_url ? { glb_url: asset.glb_url } : {}),
          zone: zone.id,
          slot: result.slot,
          position: result.position,
          rotation_y: p?.rotation_y ?? 0,
          target_size_m: result.size,
          size_source: real.source,
          size_note: result.size === size ? real.note : `${real.note} ; réduit à ${result.size} m pour tenir dans ${zone.id}`,
          color_override: p?.color_override ?? null,
          adjustments: [...adjustments, ...result.adjustments],
        };
        break;
      }
    }

    if (placed) {
      placements.push(placed);
    } else {
      unplaced.push({ asset_id: asset.id, reason: "no free space left in any zone" });
    }
  }

  if (proposal.safety_warnings.length > PANELS.safetySigns.length) {
    warnings.push(
      `${proposal.safety_warnings.length} consignes proposées, seulement ${PANELS.safetySigns.length} panneaux`
    );
  }
  const safety_signs = PANELS.safetySigns.flatMap((sign, i) => {
    const text = proposal.safety_warnings[i]?.trim();
    return text
      ? [{ sign: sign.name, text: text.slice(0, SIGN_MAX_CHARS), position: { ...sign.position } }]
      : [];
  });

  const adjusted = placements.filter((p) => p.adjustments.length > 0).length;
  console.log(
    `📐 Placement resolved: ${placements.length} placed (${adjusted} adjusted), ${unplaced.length} unplaced`
  );

  return {
    placements,
    unplaced,
    color_scheme: proposal.color_scheme,
    safety_signs,
    warnings,
    reasoning: proposal.reasoning,
  };
}

/**
 * Zones to try, in order: the requested one first, then a size-based fallback order.
 */
function candidateZones(requested: PlacementZone | undefined, size: number): PlacementZone[] {
  const fallbackIds =
    size > LARGE_OBJECT_M
      ? ["zone_floor", "zone_workbench"]
      : ["zone_workbench", "zone_shelf_left", "zone_shelf_right", "zone_floor"];
  const fallback = fallbackIds
    .map((id) => ZONES.find((z) => z.id === id))
    .filter((z): z is PlacementZone => z !== undefined && z !== requested);
  return requested ? [requested, ...fallback] : fallback;
}

/**
 * Tries to put one object in a zone.
 * @returns the absolute position (and possibly reduced size), or null if it does not fit
 */
function tryPlaceInZone(
  zone: PlacementZone,
  occupancy: Occupancy,
  size: number,
  proposal: LLMPlacement | undefined
): { position: Vec3; slot: number | null; size: number; adjustments: string[] } | null {
  const adjustments: string[] = [];
  if (occupancy.count(zone) >= zone.maxObjects) return null;

  // Shelving: one object per slot, size limited by the board.
  if (zone.slots) {
    if (size > LARGE_OBJECT_M) return null;
    const taken = occupancy.slotsOf(zone);
    const wanted = proposal?.slot ?? undefined;
    let slot = zone.slots.find((s) => s.slot === wanted && !taken.has(s.slot));
    if (!slot) {
      slot = zone.slots.find((s) => !taken.has(s.slot));
      if (!slot) return null;
      if (wanted !== undefined) adjustments.push(`slot ${wanted} unavailable → slot ${slot.slot}`);
    }
    taken.add(slot.slot);
    let finalSize = size;
    if (size > SHELF_MAX_SIZE) {
      finalSize = SHELF_MAX_SIZE;
      adjustments.push(`size ${size} m reduced to ${SHELF_MAX_SIZE} m for shelf`);
    }
    return {
      slot: slot.slot,
      size: finalSize,
      adjustments,
      position: {
        x: slot.position.x,
        y: round(slot.position.y - slot.size.height / 2),
        z: slot.position.z,
      },
    };
  }

  // Surface / floor: keep the footprint inside the zone and away from other objects.
  const maxSize = Math.min(zone.size.width, zone.size.depth);
  let finalSize = size;
  if (size > maxSize) {
    finalSize = maxSize;
    adjustments.push(`size ${size} m reduced to ${maxSize} m to fit ${zone.id}`);
  }
  const r = finalSize / 2;
  const halfW = Math.max(0, zone.size.width / 2 - r);
  const halfD = Math.max(0, zone.size.depth / 2 - r);

  const wantX = clamp(proposal?.offset.x ?? 0, -halfW, halfW);
  const wantZ = clamp(proposal?.offset.z ?? 0, -halfD, halfD);
  if (proposal && (wantX !== proposal.offset.x || wantZ !== proposal.offset.z)) {
    adjustments.push("offset clamped inside zone");
  }

  const others = occupancy.footprintsOf(zone);
  const fits = (x: number, z: number) => others.every((o) => Math.hypot(o.x - x, o.z - z) >= o.r + r + GAP);

  let spot: { x: number; z: number } | null = fits(wantX, wantZ) ? { x: wantX, z: wantZ } : null;
  if (!spot) {
    spot = nearestFreeSpot(wantX, wantZ, halfW, halfD, fits);
    if (!spot) return null;
    adjustments.push("moved to avoid overlap");
  }
  others.push({ x: spot.x, z: spot.z, r });

  return {
    slot: null,
    size: finalSize,
    adjustments,
    position: {
      x: round(zone.position.x + spot.x),
      y: round(zone.position.y - zone.size.height / 2),
      z: round(zone.position.z + spot.z),
    },
  };
}

/**
 * Scans a grid over the allowed area and returns the free spot closest to (x, z).
 */
export function nearestFreeSpot(
  x: number,
  z: number,
  halfW: number,
  halfD: number,
  fits: (x: number, z: number) => boolean
): { x: number; z: number } | null {
  let best: { x: number; z: number; d: number } | null = null;
  for (let gx = -halfW; gx <= halfW + 1e-9; gx += GRID_STEP) {
    for (let gz = -halfD; gz <= halfD + 1e-9; gz += GRID_STEP) {
      if (!fits(gx, gz)) continue;
      const d = Math.hypot(gx - x, gz - z);
      if (!best || d < best.d) best = { x: round(gx), z: round(gz), d };
    }
  }
  return best ? { x: best.x, z: best.z } : null;
}

/** Clamps a value to [min, max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Rounds to millimeters. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
