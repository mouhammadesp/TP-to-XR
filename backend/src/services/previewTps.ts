/**
 * Preview TPs — try any converted model in the workshop: /vr/?tp=tp_preview_<slug>
 * The part is placed at the center of the workbench at its real size, grabbable,
 * with its attribution in the credits (required by CC-BY / CC-BY-SA).
 */
import { PANELS } from "../config/workshopLayout";
import { getConverted } from "./stlConverter";
import { TEMPLATE_REF, TPSceneManifest } from "./tpStore";

const PREFIX = "tp_preview_";

/** Builds the preview manifest of a converted model, or null if unknown. */
export async function getPreview(id: string): Promise<TPSceneManifest | null> {
  if (!id.startsWith(PREFIX)) return null;
  const m = await getConverted(id.slice(PREFIX.length));
  if (!m) return null;
  const title = m.attribution?.title ?? m.slug;
  const largest = Math.max(m.dimensions_m.x, m.dimensions_m.y, m.dimensions_m.z);
  const mm = (v: number) => (v * 1000).toFixed(1);
  return {
    id,
    created_at: m.converted_at,
    template: TEMPLATE_REF,
    tp: {
      title: `Aperçu : ${title}`,
      domain: "mechanical",
      duration_minutes: 5,
      steps: [
        {
          order: 1,
          action: `Observer la pièce (${mm(m.dimensions_m.x)} × ${mm(m.dimensions_m.y)} × ${mm(m.dimensions_m.z)} mm, ${m.triangles} triangles), la prendre en main et la retourner.`,
          safety: null,
        },
      ],
      safety_warnings: [],
    },
    color_scheme: { ambient: "#404040", key_light: "#FFFFFF", material_base: "#808080" },
    assets: [
      {
        asset_id: `p_${m.slug}`.slice(0, 60),
        name: title,
        source: "converted",
        url: m.url,
        attribution: m.attribution
          ? {
              title: m.attribution.title,
              author: m.attribution.author,
              author_url: null,
              license: m.attribution.license,
              license_url: licenseUrl(m.attribution.license),
              source_url: m.attribution.source_url ?? m.url,
            }
          : null,
        zone: "zone_workbench",
        slot: null,
        position: { x: 0, y: 0.9, z: 0.15 },
        rotation_y: 0,
        // Largest real dimension → the viewer keeps the real size (scale 1).
        target_size_m: Math.max(largest, 0.001),
        color_override: null,
        first_step: 1,
      },
    ],
    safety_signs: PANELS.safetySigns.map((s, i) => ({ sign: s.name, text: i === 0 ? "Aperçu de modèle" : "Converti depuis STL", position: { ...s.position } })),
    unplaced: [],
    warnings: [],
    reasoning: `Modèle converti depuis ${m.source_file}.`,
  };
}

/** Creative Commons license URL from a short label ("CC Attribution - Share Alike"). */
function licenseUrl(label: string): string {
  const l = label.toLowerCase();
  const parts = [l.includes("attribution") || /\bby\b/.test(l) ? "by" : "", l.includes("non") ? "nc" : "", l.includes("share") || l.includes("-sa") ? "sa" : "", l.includes("no deriv") ? "nd" : ""].filter(Boolean);
  if (l.includes("public domain") || l.includes("cc0")) return "https://creativecommons.org/publicdomain/zero/1.0/";
  return parts.length ? `https://creativecommons.org/licenses/${parts.join("-")}/4.0/` : "https://creativecommons.org/licenses/";
}
