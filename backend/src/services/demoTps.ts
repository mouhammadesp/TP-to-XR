/**
 * Demo TPs — built-in, fully interactive TPs (no API key, no PDF).
 *
 * Unlike generated TPs (one model per material, manual "next"), demo TPs are
 * authored: procedural real-size models ("builtin"), drop targets where the
 * objects snap, per-step validation rules, and a simulated behavior
 * (electrical circuit / belt drive) implemented by the viewer.
 *
 * Geometry contract with the viewer's builtin models (frontend-vr/src/models/builtin.ts):
 * - every model has its BASE at y = 0, centered on x/z;
 * - motor_bench: shafts at x = ±0.25, axis height 0.15, pulley seat at z = +0.15;
 * - pulley_small / pulley_large: radius 0.05 / 0.07, axis along Z, base = bottom of the rim;
 * - breadboard: 0.18 × 0.009 × 0.11 m (top at y = 0.009).
 */
import { Domain } from "../schemas/tp";
import { SceneAsset, SimulationSpec, TEMPLATE_REF, TPSceneManifest } from "./tpStore";
import { PANELS } from "../config/workshopLayout";

const BENCH_Y = 0.9;

interface DemoObject {
  id: string;
  name: string;
  model: string;
  /** Initial base position (absolute, m). */
  at: { x: number; z: number; y?: number };
  rotation_y?: number;
  size_m: number;
  first_step: number | null;
  fixed?: boolean;
  clickable?: boolean;
}

interface DemoDefinition {
  id: string;
  title: string;
  domain: Domain;
  duration_minutes: number;
  steps: { order: number; action: string; safety: string | null }[];
  safety_warnings: string[];
  signs: [string, string];
  key_light: string;
  objects: DemoObject[];
  simulation: SimulationSpec;
}

/* ------------------------------------------------------------------ */
/* Electrical: series-parallel circuit                                  */
/* ------------------------------------------------------------------ */
const BOARD = { x: 0, z: 0.15 };
const BOARD_TOP = BENCH_Y + 0.009;

const ELECTRICAL: DemoDefinition = {
  id: "tp_demo_electrical",
  title: "Câblage d'un circuit mixte série-parallèle",
  domain: "electrical",
  duration_minutes: 25,
  steps: [
    { order: 1, action: "Installer la plaque d'essai sur le poste et la batterie 12 V dans son logement.", safety: "Interrupteur ouvert (OFF) pendant tout le câblage" },
    { order: 2, action: "Câbler les 3 résistances de 150 Ω en série et poser les fils de liaison sur la plaque.", safety: "Vérifier l'absence de court-circuit entre les rangées" },
    { order: 3, action: "Placer les 2 LED rouges en parallèle, en sortie des résistances.", safety: "Patte longue de la LED (anode) côté + ; sans résistance, la LED grille" },
    { order: 4, action: "Fermer l'interrupteur (ON), puis mesurer le courant avec le multimètre posé près de la plaque.", safety: "Ampèremètre en série, calibre mA" },
  ],
  safety_warnings: ["Batterie 12 V : risque de court-circuit", "Câbler hors tension", "Vérifier la polarité des LED avant mise sous tension"],
  signs: ["Câbler hors tension", "Attention court-circuit"],
  key_light: "#F2F6FF",
  objects: [
    { id: "e_plaque", name: "Plaque d'essai", model: "breadboard", at: { x: 0.45, z: -0.35 }, size_m: 0.18, first_step: 1 },
    { id: "e_batterie", name: "Batterie 12 V", model: "battery_12v", at: { x: -0.7, z: -0.35 }, size_m: 0.15, first_step: 1 },
    { id: "e_interrupteur", name: "Interrupteur", model: "toggle_switch", at: { x: -0.17, z: 0.24 }, size_m: 0.08, first_step: 4, fixed: true, clickable: true },
    { id: "e_resistances", name: "Résistances 150 Ω", model: "resistors_150", at: { x: 0.75, z: -0.3 }, size_m: 0.07, first_step: 2 },
    { id: "e_fils", name: "Fils de liaison", model: "jumper_wires", at: { x: 1.0, z: -0.3 }, size_m: 0.1, first_step: 2 },
    { id: "e_leds", name: "LED rouges", model: "leds_red", at: { x: 0.75, z: 0.05 }, size_m: 0.03, first_step: 3 },
    { id: "e_multimetre", name: "Multimètre", model: "multimeter", at: { x: 1.0, z: 0.1 }, size_m: 0.19, first_step: 4 },
    { id: "e_pince", name: "Pince coupante", model: "cutting_pliers", at: { x: -1.15, z: -0.35 }, size_m: 0.16, first_step: null },
    { id: "e_tournevis", name: "Tournevis", model: "screwdriver", at: { x: -1.15, z: -0.05 }, size_m: 0.2, first_step: null },
  ],
  simulation: {
    kind: "circuit",
    targets: [
      { id: "poste", label: "Plaque d'essai ici", position: { x: BOARD.x, y: BENCH_Y, z: BOARD.z }, radius: 0.15, accepts: ["e_plaque"], marker: "disc" },
      { id: "logement_batterie", label: "Batterie ici", position: { x: -0.36, y: BENCH_Y, z: BOARD.z }, radius: 0.13, accepts: ["e_batterie"], marker: "disc" },
      { id: "plaque_resistances", label: "Résistances", position: { x: BOARD.x - 0.045, y: BOARD_TOP, z: BOARD.z - 0.025 }, radius: 0.06, accepts: ["e_resistances"], marker: "disc" },
      { id: "plaque_fils", label: "Fils", position: { x: BOARD.x, y: BOARD_TOP, z: BOARD.z + 0.035 }, radius: 0.06, accepts: ["e_fils"], marker: "disc" },
      { id: "plaque_leds", label: "LED", position: { x: BOARD.x + 0.055, y: BOARD_TOP, z: BOARD.z - 0.025 }, radius: 0.05, accepts: ["e_leds"], marker: "disc" },
      { id: "point_mesure", label: "Mesure ici", position: { x: BOARD.x + 0.16, y: BENCH_Y, z: BOARD.z + 0.02 }, radius: 0.18, accepts: [], marker: "disc" },
    ],
    rules: [
      [
        { type: "placed", asset: "e_plaque", target: "poste", label: "Plaque d'essai sur le poste" },
        { type: "placed", asset: "e_batterie", target: "logement_batterie", label: "Batterie dans son logement" },
      ],
      [
        { type: "placed", asset: "e_resistances", target: "plaque_resistances", label: "3 résistances en série sur la plaque" },
        { type: "placed", asset: "e_fils", target: "plaque_fils", label: "Fils de liaison posés" },
      ],
      [{ type: "placed", asset: "e_leds", target: "plaque_leds", label: "2 LED en parallèle sur la plaque" }],
      [
        { type: "state", key: "circuit_on", label: "Interrupteur fermé, LED allumées" },
        { type: "state", key: "measured", label: "Courant mesuré au multimètre" },
      ],
    ],
    completion: "Circuit validé : I = (12,6 − 2,0) V / 450 Ω ≈ 23,5 mA, soit ≈ 11,8 mA par LED.",
  },
};

/* ------------------------------------------------------------------ */
/* Mechanical: V-belt drive                                             */
/* ------------------------------------------------------------------ */
const BENCH_ORIGIN = { x: 0, z: -0.2 };
const SHAFT_Y = BENCH_Y + 0.15;
const PULLEY_Z = BENCH_ORIGIN.z + 0.15;

const MECHANICAL: DemoDefinition = {
  id: "tp_demo_mechanical",
  title: "Montage d'une courroie trapézoïdale (V)",
  domain: "mechanical",
  duration_minutes: 30,
  steps: [
    { order: 1, action: "Consigner le moteur au sectionneur (OFF + cadenas), puis inspecter les deux poulies en les prenant en main.", safety: "Aucune intervention avant consignation" },
    { order: 2, action: "Monter la poulie motrice et la poulie réceptrice sur leurs arbres, puis vérifier l'alignement avec le niveau.", safety: null },
    { order: 3, action: "Enfiler la courroie trapézoïdale sur les deux poulies, sans la vriller.", safety: "Ne jamais forcer la courroie avec un tournevis" },
    { order: 4, action: "Régler la tension avec la clé sur la vis du tendeur : environ 15 mm de flèche au milieu du brin.", safety: null },
    { order: 5, action: "Poser les boulons M8 sur les pattes du moteur et les serrer à la clé plate 13 (25 N·m).", safety: "Porter les gants de protection" },
  ],
  safety_warnings: ["Aucun contact avec une courroie en rotation", "Consigner le moteur avant maintenance", "Porter des gants de protection"],
  signs: ["Consigner le moteur", "Porter des gants"],
  key_light: "#FFFFFF",
  objects: [
    { id: "m_banc", name: "Banc moteur", model: "motor_bench", at: { x: BENCH_ORIGIN.x, z: BENCH_ORIGIN.z }, size_m: 0.7, first_step: 1, fixed: true },
    { id: "m_sectionneur", name: "Sectionneur", model: "isolator", at: { x: 0.62, z: -0.5 }, size_m: 0.2, first_step: 1, fixed: true, clickable: true },
    { id: "m_poulie_m", name: "Poulie motrice", model: "pulley_small", at: { x: 0.45, z: 0.4 }, size_m: 0.1, first_step: 1 },
    { id: "m_poulie_r", name: "Poulie réceptrice", model: "pulley_large", at: { x: 0.75, z: 0.4 }, size_m: 0.14, first_step: 1 },
    { id: "m_courroie", name: "Courroie trapézoïdale", model: "v_belt", at: { x: -0.75, z: 0.3 }, size_m: 0.44, first_step: 3 },
    { id: "m_niveau", name: "Niveau à bulle", model: "spirit_level", at: { x: 1.05, z: 0.05 }, size_m: 0.3, first_step: 2 },
    { id: "m_boulons", name: "Boulons M8", model: "bolts_m8", at: { x: -1.15, z: -0.35 }, size_m: 0.08, first_step: 5 },
    { id: "m_cle", name: "Clé plate 13", model: "wrench_13", at: { x: -1.15, z: -0.05 }, size_m: 0.2, first_step: 4 },
    { id: "m_gants", name: "Gants de protection", model: "gloves", at: { x: -1.2, z: 0.35 }, size_m: 0.25, first_step: 5 },
  ],
  simulation: {
    kind: "belt_drive",
    targets: [
      { id: "arbre_moteur", label: "Poulie motrice", position: { x: BENCH_ORIGIN.x - 0.25, y: SHAFT_Y - 0.05, z: PULLEY_Z }, radius: 0.12, accepts: ["m_poulie_m"], marker: "ring_z" },
      { id: "arbre_recepteur", label: "Poulie réceptrice", position: { x: BENCH_ORIGIN.x + 0.25, y: SHAFT_Y - 0.07, z: PULLEY_Z }, radius: 0.12, accepts: ["m_poulie_r"], marker: "ring_z" },
      { id: "zone_niveau", label: "Niveau ici", position: { x: BENCH_ORIGIN.x, y: BENCH_Y, z: PULLEY_Z + 0.2 }, radius: 0.16, accepts: ["m_niveau"], marker: "disc" },
      { id: "poulies", label: "Courroie sur les poulies", position: { x: BENCH_ORIGIN.x, y: SHAFT_Y, z: PULLEY_Z }, radius: 0.35, accepts: [], marker: "none" },
      { id: "tendeur", label: "Vis du tendeur", position: { x: BENCH_ORIGIN.x - 0.42, y: BENCH_Y + 0.03, z: BENCH_ORIGIN.z }, radius: 0.15, accepts: [], marker: "disc" },
      { id: "fixations", label: "Boulons ici", position: { x: BENCH_ORIGIN.x - 0.25, y: BENCH_Y + 0.02, z: BENCH_ORIGIN.z + 0.07 }, radius: 0.1, accepts: ["m_boulons"], marker: "disc" },
    ],
    rules: [
      [
        { type: "state", key: "locked_out", label: "Sectionneur consigné (OFF + cadenas)" },
        { type: "held", asset: "m_poulie_m", seconds: 1.5, label: "Poulie motrice inspectée" },
        { type: "held", asset: "m_poulie_r", seconds: 1.5, label: "Poulie réceptrice inspectée" },
      ],
      [
        { type: "placed", asset: "m_poulie_m", target: "arbre_moteur", label: "Poulie motrice sur l'arbre moteur" },
        { type: "placed", asset: "m_poulie_r", target: "arbre_recepteur", label: "Poulie réceptrice sur l'arbre récepteur" },
        { type: "placed", asset: "m_niveau", target: "zone_niveau", label: "Alignement contrôlé au niveau" },
      ],
      [{ type: "state", key: "belt_mounted", label: "Courroie montée sur les deux poulies" }],
      [{ type: "state", key: "tensioned", label: "Tension réglée (flèche ≈ 15 mm)" }],
      [
        { type: "placed", asset: "m_boulons", target: "fixations", label: "Boulons M8 posés" },
        { type: "state", key: "torqued", label: "Boulons serrés à la clé (25 N·m)" },
      ],
    ],
    completion: "Transmission montée. Déconsignez le sectionneur (ON) pour l'essai : la poulie réceptrice tourne à 10/14 de la vitesse moteur.",
  },
};

const DEMOS: DemoDefinition[] = [MECHANICAL, ELECTRICAL];

/** Builds the manifest of one demo. */
function buildDemo(def: DemoDefinition): TPSceneManifest {
  const assets: SceneAsset[] = def.objects.map((o) => ({
    asset_id: o.id,
    name: o.name,
    source: "builtin",
    builtin_model: o.model,
    ...(o.fixed ? { fixed: true } : {}),
    ...(o.clickable ? { clickable: true } : {}),
    url: null,
    attribution: null,
    zone: "zone_workbench",
    slot: null,
    position: { x: o.at.x, y: o.at.y ?? BENCH_Y, z: o.at.z },
    rotation_y: o.rotation_y ?? 0,
    target_size_m: o.size_m,
    color_override: null,
    first_step: o.first_step,
  }));
  return {
    id: def.id,
    created_at: "2026-10-13T00:00:00.000Z",
    template: TEMPLATE_REF,
    tp: {
      title: def.title,
      domain: def.domain,
      duration_minutes: def.duration_minutes,
      steps: def.steps,
      safety_warnings: def.safety_warnings,
    },
    color_scheme: { ambient: "#404040", key_light: def.key_light, material_base: "#808080" },
    assets,
    safety_signs: PANELS.safetySigns.map((s, i) => ({ sign: s.name, text: def.signs[i], position: { ...s.position } })),
    unplaced: [],
    warnings: [],
    reasoning: "TP de démonstration interactif (objets générés, étapes validées par l'action, simulation).",
    simulation: def.simulation,
  };
}

let cache: Map<string, TPSceneManifest> | null = null;

function demos(): Map<string, TPSceneManifest> {
  cache ??= new Map(DEMOS.map((d) => [d.id, buildDemo(d)]));
  return cache;
}

/** Demo manifest by id (e.g. "tp_demo_mechanical"), or undefined. */
export function getDemo(id: string): TPSceneManifest | undefined {
  return demos().get(id);
}

/** Demo manifest by domain (e.g. "electrical"), or undefined. */
export function getDemoByDomain(domain: string): TPSceneManifest | undefined {
  return [...demos().values()].find((m) => m.tp.domain === domain);
}

/** Short list for the menu. */
export function listDemos(): { id: string; title: string; domain: Domain; assets: number; steps: number }[] {
  return [...demos().values()].map((m) => ({
    id: m.id,
    title: m.tp.title,
    domain: m.tp.domain,
    assets: m.assets.length,
    steps: m.tp.steps.length,
  }));
}
