/**
 * Real-world size (largest dimension, meters) of the TP objects.
 *
 * The 3D models are normalized so that their largest dimension equals this size.
 * Sources, by reliability:
 *   1. "tp_text"   — a dimension written in the TP itself, in the object's name or
 *                    next to it in a step ("règle de 30 cm", "tube 16 x 160 mm");
 *   2. "standard"  — formats fixed by a standard, when the name identifies one
 *                    unambiguously (battery formats IEC 60086, A4 ISO 216, glassware
 *                    with its capacity: nominal ISO 3819 / 1773 / 4788 heights);
 *   3. "estimate"  — the AI's estimate, kept as is when plausible; when it falls
 *                    outside the typical range of a known object category it is
 *                    brought back to the nearest bound ("typical_range").
 * Nothing else is invented: an object of unknown model keeps the AI estimate.
 */

export type SizeSource = "tp_text" | "standard" | "typical_range" | "estimate";

export interface RealSize {
  size_m: number;
  source: SizeSource;
  /** Short French note shown in the report / logs (e.g. "pile 9 V (IEC 60086 : 48,5 mm)"). */
  note: string;
}

/** Lowercase, accents removed, spaces collapsed. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Formats with a standardized size (largest dimension). */
const STANDARDS: { re: RegExp; size: number; note: string }[] = [
  { re: /\b(pile|batterie)\b.*\b9 ?v\b|\b6lr61\b|\bpp3\b/, size: 0.0485, note: "pile 9 V (IEC 60086 6LR61 : 48,5 mm)" },
  { re: /\bpile\b.*\b(aaa|lr03)\b|\blr03\b/, size: 0.0445, note: "pile AAA (IEC 60086 LR03 : 44,5 mm)" },
  { re: /\bpile\b.*\b(aa|lr6)\b|\blr6\b/, size: 0.0505, note: "pile AA (IEC 60086 LR6 : 50,5 mm)" },
  { re: /\bpile\b.*\b(lr14)\b|\bpile c\b/, size: 0.05, note: "pile C (IEC 60086 LR14 : 50 mm)" },
  { re: /\bpile\b.*\b(lr20)\b|\bpile d\b/, size: 0.0615, note: "pile D (IEC 60086 LR20 : 61,5 mm)" },
  { re: /\bpile plate\b|\b3lr12\b|\bpile\b.*\b4[,.]5 ?v\b/, size: 0.067, note: "pile plate 4,5 V (IEC 60086 3LR12 : 67 mm)" },
  { re: /\b(feuille|papier)\b.*\ba4\b/, size: 0.297, note: "feuille A4 (ISO 216 : 297 mm)" },
];

/**
 * Laboratory glassware: nominal height (≈ largest dimension) by capacity (mL).
 * Low-form beakers ISO 3819, narrow-neck Erlenmeyer flasks ISO 1773, tall graduated
 * cylinders ISO 4788 (manufacturers' nominal values). Used only when the capacity is given.
 */
const GLASSWARE: { re: RegExp; label: string; heights: Record<number, number> }[] = [
  { re: /\bbecher\b/, label: "bécher (ISO 3819)", heights: { 25: 0.05, 50: 0.07, 100: 0.07, 150: 0.08, 250: 0.095, 400: 0.11, 600: 0.125, 1000: 0.145 } },
  { re: /\berlenmeyer\b|\bfiole conique\b/, label: "erlenmeyer (ISO 1773)", heights: { 25: 0.07, 50: 0.085, 100: 0.105, 250: 0.145, 500: 0.18, 1000: 0.22 } },
  { re: /\beprouvette graduee\b/, label: "éprouvette graduée (ISO 4788)", heights: { 10: 0.14, 25: 0.17, 50: 0.2, 100: 0.26, 250: 0.335, 500: 0.39, 1000: 0.47 } },
];

/** Typical largest dimension of common TP objects (only used to correct aberrant estimates). */
const TYPICAL: { re: RegExp; min: number; max: number; label: string }[] = [
  { re: /\bmultimetre\b/, min: 0.13, max: 0.2, label: "multimètre portable" },
  { re: /\bampoule\b.*\be1[04]\b|\bampoule (a incandescence )?miniature\b/, min: 0.02, max: 0.045, label: "ampoule miniature à culot E10/E14" },
  { re: /\bampoule\b/, min: 0.02, max: 0.15, label: "ampoule" },
  { re: /\b(marqueur|feutre|stylo|crayon)\b/, min: 0.12, max: 0.17, label: "marqueur / stylo" },
  { re: /\bregle\b/, min: 0.15, max: 0.5, label: "règle" },
  { re: /\btube a essai\b/, min: 0.1, max: 0.2, label: "tube à essai" },
  { re: /\bbecher\b/, min: 0.05, max: 0.2, label: "bécher" },
  { re: /\berlenmeyer\b/, min: 0.07, max: 0.3, label: "erlenmeyer" },
  { re: /\bpipette\b/, min: 0.15, max: 0.45, label: "pipette" },
  { re: /\bburette\b/, min: 0.4, max: 0.9, label: "burette" },
  { re: /\bthermometre\b/, min: 0.12, max: 0.35, label: "thermomètre" },
  { re: /\bgobelets?\b/, min: 0.07, max: 0.15, label: "gobelet" },
  { re: /\bbo[i]?te de petri\b/, min: 0.035, max: 0.15, label: "boîte de Petri" },
  { re: /\btournevis\b/, min: 0.12, max: 0.3, label: "tournevis" },
  { re: /\bcle (plate|a molette|mixte)\b/, min: 0.1, max: 0.35, label: "clé" },
  { re: /\bplaque d'essai\b|\bbreadboard\b/, min: 0.08, max: 0.2, label: "plaque d'essai" },
  { re: /\bresistance(s)?\b/, min: 0.006, max: 0.04, label: "résistance (composant)" },
  { re: /\b(led|del)\b/, min: 0.005, max: 0.035, label: "LED" },
  { re: /\boscilloscope\b/, min: 0.25, max: 0.45, label: "oscilloscope" },
  { re: /\b(alimentation|generateur)\b/, min: 0.15, max: 0.4, label: "alimentation de laboratoire" },
];

/** Absolute bounds for any estimate (a 1 cm or a 2.5 m object are already exceptional on a bench). */
const ESTIMATE_BOUNDS = { min: 0.01, max: 2.5 };

const LENGTH_RE = /(\d+(?:[.,]\d+)?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)\b/;

function toMeters(value: string, unit: string): number {
  const v = Number(value.replace(",", "."));
  return unit === "mm" ? v / 1000 : unit === "cm" ? v / 100 : v;
}

/** "16 x 160 mm" → 0.16; "30 cm" → 0.3 (largest of the numbers). */
function lengthIn(text: string): number | null {
  const m = LENGTH_RE.exec(text);
  if (!m) return null;
  const a = toMeters(m[1], m[3]);
  const b = m[2] ? toMeters(m[2], m[3]) : 0;
  const v = Math.max(a, b);
  return v >= 0.003 && v <= 3 ? v : null;
}

/**
 * Dimension written next to the object in the TP texts: the object's main word
 * followed directly by a length ("règle de 30 cm", "règle graduée 20 cm").
 * Distances like "à 2 cm du bord" do not match (the length must follow the noun).
 */
function lengthNear(nameNorm: string, texts: string[]): number | null {
  const head = nameNorm.split(" ").find((w) => w.length >= 4);
  if (!head) return null;
  const re = new RegExp(`\\b${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?: (?!(?:sur|sous|pour|avec|dans|vers|pres|environ|entre)\b)[a-z]{3,})? (?:de |d'environ )?(\\d+(?:[.,]\\d+)?(?:\\s*[x×]\\s*\\d+(?:[.,]\\d+)?)?\\s*(?:mm|cm|m))\\b`);
  for (const t of texts) {
    const m = re.exec(normalizeName(t));
    if (m) {
      const v = lengthIn(m[1]);
      if (v) return v;
    }
  }
  return null;
}

/**
 * Real size of an object from its name, the TP texts and the AI's estimate.
 * @param name object name as written in the TP
 * @param estimate AI estimate (m)
 * @param texts TP texts that may give its dimensions (step actions, materials)
 */
export function resolveRealSize(name: string, estimate: number, texts: string[] = []): RealSize {
  const n = normalizeName(name);
  const explicit = lengthIn(n) ?? lengthNear(n, texts);
  if (explicit) return { size_m: round(explicit), source: "tp_text", note: `dimension indiquée dans le TP (${fmt(explicit)})` };

  for (const s of STANDARDS) if (s.re.test(n)) return { size_m: s.size, source: "standard", note: s.note };

  const cap = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/.exec(n);
  if (cap) {
    const ml = Number(cap[1].replace(",", ".")) * (cap[2] === "l" ? 1000 : cap[2] === "cl" ? 10 : 1);
    for (const g of GLASSWARE) {
      const h = g.re.test(n) ? g.heights[ml] : undefined;
      if (h) return { size_m: h, source: "standard", note: `${g.label} ${ml} mL : hauteur nominale ${fmt(h)}` };
    }
  }

  const est = Number.isFinite(estimate) && estimate > 0 ? estimate : 0.3;
  const range = TYPICAL.find((t) => t.re.test(n));
  if (range && (est < range.min || est > range.max)) {
    const v = est < range.min ? range.min : range.max;
    return { size_m: v, source: "typical_range", note: `estimation ${fmt(est)} hors plage typique d'un(e) ${range.label} (${fmt(range.min)}–${fmt(range.max)}) → ${fmt(v)}` };
  }
  const v = Math.min(ESTIMATE_BOUNDS.max, Math.max(ESTIMATE_BOUNDS.min, est));
  return { size_m: round(v), source: "estimate", note: range ? `estimation (${range.label}, plage typique respectée)` : "estimation (modèle exact inconnu)" };
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function fmt(m: number): string {
  return m < 0.1 ? `${(m * 1000).toFixed(m < 0.01 ? 1 : 0).replace(".", ",")} mm` : `${(m * 100).toFixed(1).replace(".0", "").replace(".", ",")} cm`;
}
