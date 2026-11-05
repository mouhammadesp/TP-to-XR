/**
 * AssetManager — local cache of downloaded Sketchfab models.
 *
 * Layout (served statically at /assets/models):
 *   backend/assets/models/<uid>/model.glb             (when Sketchfab offers a GLB)
 *   backend/assets/models/<uid>/scene.gltf + bin + textures/   (glTF ZIP, extracted)
 *   backend/assets/models/<uid>/meta.json             (license, author, entry file)
 *
 * A model is written to a temp folder and renamed only once complete, so a
 * crash never leaves a half-downloaded model in the cache.
 */
import { promises as fsp } from "fs";
import path from "path";
import { unzipSync } from "fflate";
import { SketchfabModel, SketchfabService, getSketchfab } from "./sketchfab";
import { HttpError, errorMessage } from "../utils/http";

export const ASSETS_DIR = path.resolve(__dirname, "..", "..", "assets", "models");
export const ASSETS_URL_PREFIX = "/assets/models";

const UID_RE = /^[a-f0-9]{32}$/;
const DOWNLOAD_TIMEOUT_MS = 120_000;
/** Extracted archive may be at most this many times the download limit (zip bomb guard). */
const MAX_UNZIP_RATIO = 4;

export interface CachedAsset {
  uid: string;
  /** Entry file inside the model folder ("model.glb" or e.g. "scene.gltf"). */
  entry: string;
  /** Public URL of the entry file. */
  url: string;
  bytes: number;
  model: SketchfabModel;
  downloaded_at: string;
}

export class AssetManager {
  private readonly inFlight = new Map<string, Promise<CachedAsset>>();

  constructor(private readonly sketchfab: SketchfabService, private readonly root = ASSETS_DIR) {}

  /**
   * Returns the cached model, downloading it first if needed.
   * Concurrent calls for the same uid share one download.
   */
  public async ensureModel(model: SketchfabModel): Promise<CachedAsset> {
    assertUid(model.uid);
    const cached = await this.getCached(model.uid);
    if (cached) {
      console.log(`📦 Cache hit: ${model.uid} (${model.name})`);
      return cached;
    }
    let pending = this.inFlight.get(model.uid);
    if (!pending) {
      pending = this.download(model).finally(() => this.inFlight.delete(model.uid));
      this.inFlight.set(model.uid, pending);
    }
    return pending;
  }

  /**
   * Reads a cached model's metadata, or null if not cached.
   */
  public async getCached(uid: string): Promise<CachedAsset | null> {
    assertUid(uid);
    try {
      const raw = await fsp.readFile(path.join(this.root, uid, "meta.json"), "utf8");
      return JSON.parse(raw) as CachedAsset;
    } catch {
      return null;
    }
  }

  /**
   * Lists every cached model.
   */
  public async listCached(): Promise<CachedAsset[]> {
    let dirs: string[];
    try {
      dirs = await fsp.readdir(this.root);
    } catch {
      return [];
    }
    const assets = await Promise.all(dirs.filter((d) => UID_RE.test(d)).map((d) => this.getCached(d)));
    return assets.filter((a): a is CachedAsset => a !== null);
  }

  /**
   * Downloads (GLB preferred, else glTF ZIP), extracts and registers a model.
   */
  private async download(model: SketchfabModel): Promise<CachedAsset> {
    console.log(`⬇️  Downloading ${model.uid} "${model.name}" (${model.license.label}, ${model.author})...`);
    const links = await this.sketchfab.getDownloadLinks(model.uid);
    const tmpDir = path.join(this.root, `${model.uid}.tmp-${process.pid}-${Date.now()}`);
    const finalDir = path.join(this.root, model.uid);
    await fsp.mkdir(tmpDir, { recursive: true });

    try {
      let entry: string;
      let bytes: number;
      if (links.glb) {
        const data = await fetchLimited(links.glb.url, this.sketchfab.maxBytes);
        entry = "model.glb";
        bytes = data.length;
        await fsp.writeFile(path.join(tmpDir, entry), data);
      } else if (links.gltf) {
        const zip = await fetchLimited(links.gltf.url, this.sketchfab.maxBytes);
        ({ entry, bytes } = await extractGltfZip(zip, tmpDir, this.sketchfab.maxBytes * MAX_UNZIP_RATIO));
      } else {
        throw new HttpError(502, `No usable download for ${model.uid}`);
      }

      const asset: CachedAsset = {
        uid: model.uid,
        entry,
        url: `${ASSETS_URL_PREFIX}/${model.uid}/${entry}`,
        bytes,
        model,
        downloaded_at: new Date().toISOString(),
      };
      await fsp.writeFile(path.join(tmpDir, "meta.json"), JSON.stringify(asset, null, 2));
      await fsp.rm(finalDir, { recursive: true, force: true });
      await fsp.rename(tmpDir, finalDir);
      console.log(`✅ Cached ${model.uid} → ${entry} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
      return asset;
    } catch (err) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      throw err instanceof HttpError ? err : new HttpError(502, `Download of ${model.uid} failed: ${errorMessage(err)}`);
    }
  }
}

/** Rejects anything that is not a Sketchfab uid (also prevents path traversal). */
function assertUid(uid: string): void {
  if (!UID_RE.test(uid)) throw new HttpError(400, `Invalid Sketchfab uid: ${uid}`);
}

/**
 * Downloads a file into memory, refusing anything larger than maxBytes.
 */
async function fetchLimited(url: string, maxBytes: number): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`file too large (${declared} bytes > ${maxBytes})`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.length > maxBytes) throw new Error(`file too large (${data.length} bytes > ${maxBytes})`);
  return data;
}

/**
 * Extracts a Sketchfab glTF ZIP into `dir` and returns its .gltf entry.
 * Rejects absolute paths / ".." entries (zip slip) and oversized archives.
 */
async function extractGltfZip(
  zip: Uint8Array,
  dir: string,
  maxTotal: number
): Promise<{ entry: string; bytes: number }> {
  let total = 0;
  const files = unzipSync(zip, {
    filter: (f) => {
      total += f.originalSize;
      if (total > maxTotal) throw new Error(`archive too large once extracted (> ${maxTotal} bytes)`);
      return !f.name.endsWith("/");
    },
  });

  let entry: string | null = null;
  for (const [name, data] of Object.entries(files)) {
    const normalized = path.posix.normalize(name.replace(/\\/g, "/"));
    if (normalized.startsWith("../") || path.posix.isAbsolute(normalized) || normalized.includes("/../")) {
      throw new Error(`unsafe path in archive: ${name}`);
    }
    const target = path.join(dir, ...normalized.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, data);
    if (normalized.endsWith(".gltf") && (entry === null || normalized.length < entry.length)) {
      entry = normalized;
    }
  }
  if (!entry) throw new Error("no .gltf file in archive");
  return { entry, bytes: total };
}

let instance: AssetManager | null = null;

/** Shared instance (so concurrent requests share in-flight downloads). */
export function getAssetManager(): AssetManager {
  instance ??= new AssetManager(getSketchfab());
  return instance;
}

export default AssetManager;
