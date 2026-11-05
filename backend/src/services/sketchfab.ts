/**
 * SketchfabService — search CC-licensed models and get download links.
 *
 * Verified against the live Data API v3:
 * - search is public (no token needed); `license` accepts ONE slug only,
 *   so CC0 + CC-BY are filtered client-side by license uid;
 * - GET /models/{uid}/download needs a token and returns JSON with
 *   temporary (≈300 s) links: `gltf` (ZIP: scene.gltf + bin + textures),
 *   sometimes `glb`, `usdz`. The links themselves need no auth.
 */
import { HttpError, errorMessage } from "../utils/http";

const API = "https://api.sketchfab.com/v3";
const SEARCH_TIMEOUT_MS = 15_000;

/** Allowed licenses (Sketchfab license uids). Both allow reuse; CC-BY requires attribution. */
export const ALLOWED_LICENSES: Record<string, { slug: string; label: string; url: string }> = {
  "7c23a1ba438d4306920229c12afcb5f9": {
    slug: "cc0",
    label: "CC0 Public Domain",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  "322a749bcfa841b29dff1e8a1bb74b0b": {
    slug: "by",
    label: "CC Attribution",
    url: "https://creativecommons.org/licenses/by/4.0/",
  },
};

/** Normalized search hit. */
export interface SketchfabModel {
  uid: string;
  name: string;
  author: string;
  author_url: string | null;
  license: { slug: string; label: string; url: string };
  viewer_url: string;
  thumbnail_url: string | null;
  face_count: number;
  /** Download size in bytes (glb if known, else gltf archive), null if unknown. */
  download_size: number | null;
  tags: string[];
}

export interface DownloadLinks {
  glb?: { url: string; size: number };
  gltf?: { url: string; size: number };
}

/** Subset of the raw search result we rely on. */
interface RawModel {
  uid: string;
  name: string;
  isDownloadable?: boolean;
  isAgeRestricted?: boolean;
  faceCount?: number;
  viewerUrl: string;
  /** Search results carry `uid`; the model detail endpoint only `uri` (…/licenses/<uid>). */
  license?: { uid?: string; uri?: string } | null;
  user?: { username?: string; profileUrl?: string } | null;
  thumbnails?: { images?: { url: string; width: number }[] } | null;
  tags?: { name: string }[] | null;
  archives?: Record<string, { size?: number } | null> | null;
}

interface RawDownload {
  glb?: { url: string; size: number };
  gltf?: { url: string; size: number };
}

export class SketchfabService {
  private readonly token: string | null;
  private readonly authScheme: string;
  public readonly maxFaces: number;
  public readonly maxBytes: number;

  /**
   * Reads configuration from the environment. The token is optional:
   * without it, search works but downloads are disabled.
   */
  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = env.SKETCHFAB_API_KEY?.trim();
    this.token = key && !key.startsWith("your_") ? key : null;
    this.authScheme = env.SKETCHFAB_AUTH_SCHEME?.trim() || "Token";
    this.maxFaces = Number(env.SKETCHFAB_MAX_FACES) || 100_000;
    this.maxBytes = (Number(env.SKETCHFAB_MAX_MB) || 15) * 1024 * 1024;
  }

  /** True if a token is configured (downloads possible). */
  public get canDownload(): boolean {
    return this.token !== null;
  }

  /**
   * Searches downloadable models and keeps only allowed licenses
   * and Quest-friendly sizes, in Sketchfab relevance order.
   */
  public async searchModels(query: string, limit = 5): Promise<SketchfabModel[]> {
    const url = new URL(`${API}/search`);
    url.searchParams.set("type", "models");
    url.searchParams.set("q", query);
    url.searchParams.set("downloadable", "true");
    url.searchParams.set("count", "24"); // over-fetch: many hits are filtered out below

    const data = await this.getJSON<{ results?: RawModel[] }>(url.toString(), false, SEARCH_TIMEOUT_MS);
    const models = (data.results ?? [])
      .filter((m) => this.isUsable(m))
      .slice(0, Math.max(1, Math.min(limit, 24)))
      .map(normalize);
    console.log(`🔎 Sketchfab "${query}": ${models.length} usable model(s)`);
    return models;
  }

  /**
   * Tries each query in order and returns the first usable AND relevant model:
   * its name or tags must share a meaningful word with the query (Sketchfab's
   * fuzzy search otherwise returns e.g. a bridge for "alligator clip cables").
   * Returns null when nothing relevant exists → the viewer shows a labeled placeholder.
   */
  public async findModel(queries: string[]): Promise<{ model: SketchfabModel; query: string } | null> {
    for (const query of queries) {
      try {
        const models = await this.searchModels(query, 8);
        const model = models.find((m) => isRelevant(query, m));
        if (model) return { model, query };
        if (models.length) console.log(`🚫 Sketchfab "${query}": ${models.length} result(s), none relevant (${models.slice(0, 3).map((m) => m.name).join(" | ")})`);
      } catch (err) {
        console.warn(`⚠️  Sketchfab search "${query}" failed: ${errorMessage(err)}`);
      }
    }
    return null;
  }

  /**
   * Fetches one model's public metadata and checks it is usable.
   * @throws HttpError 422 if not downloadable, not CC0/CC-BY or too heavy
   */
  public async getModel(uid: string): Promise<SketchfabModel> {
    if (!/^[a-f0-9]{32}$/.test(uid)) throw new HttpError(400, `Invalid Sketchfab uid: ${uid}`);
    const raw = await this.getJSON<RawModel>(`${API}/models/${uid}`, false, SEARCH_TIMEOUT_MS);
    if (!this.isUsable(raw)) {
      throw new HttpError(422, `Model ${uid} is not downloadable, not CC0/CC-BY, or exceeds size limits`);
    }
    return normalize(raw);
  }

  /**
   * Requests temporary download links for a model (token required).
   */
  public async getDownloadLinks(uid: string): Promise<DownloadLinks> {
    if (!this.token) throw new HttpError(503, "SKETCHFAB_API_KEY is not set in backend/.env");
    const data = await this.getJSON<RawDownload>(`${API}/models/${uid}/download`, true, SEARCH_TIMEOUT_MS);
    const links: DownloadLinks = {};
    if (data.glb?.url) links.glb = { url: data.glb.url, size: data.glb.size };
    if (data.gltf?.url) links.gltf = { url: data.gltf.url, size: data.gltf.size };
    if (!links.glb && !links.gltf) throw new HttpError(502, `No glTF/GLB download available for ${uid}`);
    return links;
  }

  /**
   * Filters out non-downloadable, restricted, non-CC0/CC-BY and too heavy models.
   */
  private isUsable(m: RawModel): boolean {
    if (!m.isDownloadable || m.isAgeRestricted) return false;
    if (!(licenseUid(m) in ALLOWED_LICENSES)) return false;
    if ((m.faceCount ?? 0) > this.maxFaces) return false;
    const size = downloadSize(m);
    return size === null || size <= this.maxBytes;
  }

  /**
   * GET + JSON with timeout; maps HTTP failures to HttpError.
   */
  private async getJSON<T>(url: string, auth: boolean, timeoutMs: number): Promise<T> {
    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        headers: auth && this.token ? { Authorization: `${this.authScheme} ${this.token}` } : {},
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new HttpError(502, `Sketchfab unreachable: ${errorMessage(err)}`);
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const status = res.status === 401 || res.status === 403 ? 503 : 502;
      throw new HttpError(status, `Sketchfab error ${res.status}`, body);
    }
    return (await res.json()) as T;
  }
}

const STOPWORDS = new Set(["model", "models", "3d", "low", "poly", "lowpoly", "free", "simple", "set", "kit", "the", "and", "for", "with", "high", "quality", "realistic", "game", "asset", "pbr", "scan", "object", "tool", "tools"]);

/** Lowercase word stems (≥ 3 letters, plural "s" removed, stopwords dropped). */
function stems(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

const sameStem = (q: string, h: string) => h === q || (q.length >= 4 && (h.startsWith(q) || (q.startsWith(h) && h.length >= 4)));

/** Number of query words found in the model's name or tags. */
export function relevance(query: string, m: { name: string; tags: string[] }): number {
  const have = stems(`${m.name} ${m.tags.join(" ")}`);
  return stems(query).filter((q) => have.some((h) => sameStem(q, h))).length;
}

/** Words of models that are never lab equipment (unless the query itself asks for them). */
const OFF_TOPIC = new Set(["toy", "soldier", "cavalry", "cartoon", "figurine", "anime", "alien", "monster", "zombie", "character", "fantasy", "victorian", "jelly", "candy", "alchemist"]);
/** Generic words of model titles that say nothing about the object. */
const GENERIC = new Set(["model", "free", "use", "low", "poly", "lowpoly", "scan", "realistic", "version", "final", "vfinal", "game", "ready", "asset", "pbr", "simple", "classic", "old", "new", "small", "big", "set", "pack", "obj", "fbx", "blend", "blender", "download"]);

/**
 * A search hit represents the object only if:
 *  - most of the query's words are found (all of them for a 1–2 word query, 2 of 3…),
 *  - at least one of them is in the model's NAME (tags alone are often spammy),
 *  - its name has no off-topic word (toy, cartoon, character…) the query did not ask for,
 *  - the query covers at least half of the meaningful words of the name, and the name's
 *    HEAD (its last two meaningful words before "with", "-", "(" …) is in the query: a
 *    title about something else is rejected ("label" ≠ "Classic wine bottle with label",
 *    "seed samples" ≠ "SEED Sample Holder Assembly").
 * Otherwise the object keeps a labeled placeholder rather than a wrong model
 * (e.g. "bean seeds" ≠ "Jelly Bean Kidneys", "alligator clip" ≠ "Cavalry soldier toy").
 */
export function isRelevant(query: string, m: { name: string; tags: string[] }): boolean {
  const q = stems(query);
  if (!q.length) return false;
  const name = stems(m.name);
  if (name.some((w) => OFF_TOPIC.has(w) && !q.includes(w))) return false;
  const needed = q.length <= 2 ? q.length : Math.ceil(q.length * 0.6);
  const meaningful = name.filter((w) => !GENERIC.has(w) && !/^\d/.test(w));
  const covered = meaningful.filter((h) => q.some((w) => sameStem(w, h))).length;
  // Head of the title: its last two meaningful words (compound nouns: "marker pens").
  const head = stems(m.name.split(/\s+(?:with|for|of|on|in|and)\s+|\s[-–|]\s|[(,:|]/i)[0])
    .filter((w) => !GENERIC.has(w) && !/^\d/.test(w))
    .slice(-2);
  const headOk = !head.length || q.some((w) => head.some((h) => sameStem(w, h)));
  return relevance(query, m) >= needed && covered > 0 && covered >= meaningful.length / 2 && headOk;
}

/** License uid from either result shape ("" if unknown). */
function licenseUid(m: RawModel): string {
  return m.license?.uid ?? m.license?.uri?.split("/").filter(Boolean).pop() ?? "";
}

/** Download size from search archives (glb preferred), null if unknown. */
function downloadSize(m: RawModel): number | null {
  return m.archives?.glb?.size ?? m.archives?.gltf?.size ?? null;
}

/** Maps a raw search hit to our normalized model. */
function normalize(m: RawModel): SketchfabModel {
  const images = [...(m.thumbnails?.images ?? [])].sort((a, b) => a.width - b.width);
  const thumb = images.find((i) => i.width >= 200) ?? images[images.length - 1];
  return {
    uid: m.uid,
    name: m.name,
    author: m.user?.username ?? "unknown",
    author_url: m.user?.profileUrl ?? null,
    license: ALLOWED_LICENSES[licenseUid(m)],
    // Search results return a broken slug ("…/3d-models/none-<uid>"); the bare uid URL always resolves.
    viewer_url: `https://sketchfab.com/3d-models/${m.uid}`,
    thumbnail_url: thumb?.url ?? null,
    face_count: m.faceCount ?? 0,
    download_size: downloadSize(m),
    tags: (m.tags ?? []).map((t) => t.name).slice(0, 20),
  };
}

let instance: SketchfabService | null = null;

/** Shared lazily-created service. */
export function getSketchfab(): SketchfabService {
  instance ??= new SketchfabService();
  return instance;
}

export default SketchfabService;
