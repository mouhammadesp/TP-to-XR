/**
 * Patches the shipped engine GLB with ADDITIONAL selection zones — no Blender,
 * no geometry change: empty glTF nodes "zone__<id>" (translation + scale) are
 * appended to the JSON chunk, exactly like tools/engine/build_engine_glb.py does.
 *
 *   node tools/engine/add_zones.mjs probe [glb]                       → heights/density report
 *   node tools/engine/add_zones.mjs patch [glb] [--out <file>]        → writes the GLB (in place by default)
 *
 * Rectangles are in the ORIGINAL frame used by build_engine_glb.py:
 *   +X = firewall side, -X = front of the car, +Y = the car's right side, Z up.
 * Node mapping (validated against the 9 shipped zones):
 *   translation = (-yc, zc, -xc)   scale = (yw, zh, xw)
 * Box heights are measured from the shipped (cropped) scan itself, with the same
 * percentile rule as the Blender build: p90 = top of the part, p15 ≈ its base.
 */
import { readFileSync, writeFileSync } from "fs";

const [, , mode, glbArg = "backend/assets/models/converted/audi_tfsi_engine.glb"] = process.argv;
const outArg = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;

/**
 * New zones, visible and recognizable in the scan (nothing invented):
 * radiator: the honeycomb heat exchanger across the whole front edge of the bay,
 * seen face-on, from both sides and from above.
 */
const NEW_ZONES = {
  radiator: { "x": [-0.53, -0.40], "y": [-0.45, 0.50], "min_size": 0.10, "max_depth": 0.30 },
};

function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error(`${file}: not a GLB`);
  const jsonLen = buf.readUInt32LE(12);
  if (buf.toString("ascii", 16, 20) !== "JSON") throw new Error("first chunk is not JSON");
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  return { buf, json, jsonLen };
}

/** Vertex positions of the single scan mesh, in the glTF frame. */
function readPoints(json, buf, jsonLen) {
  const prim = json.meshes[0].primitives[0];
  const acc = json.accessors[prim.attributes.POSITION];
  const view = json.bufferViews[acc.bufferView];
  const stride = acc.byteStride ?? 12;
  const bin = 20 + Math.ceil(jsonLen / 4) * 4 + 8;
  const base = bin + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const p = new Float64Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    p[i * 3] = buf.readFloatLE(at);
    p[i * 3 + 1] = buf.readFloatLE(at + 4);
    p[i * 3 + 2] = buf.readFloatLE(at + 8);
  }
  return p;
}

const percentile = (sorted, q) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * q)))];

function measure(json, buf, jsonLen, rect) {
  const p = readPoints(json, buf, jsonLen);
  const [x0, x1] = rect.x, [y0, y1] = rect.y;
  const heights = [];
  for (let i = 0; i < p.length / 3; i++) {
    const xo = -p[i * 3 + 2], yo = -p[i * 3]; // glTF Z → −x_orig, glTF X → −y_orig
    if (xo >= x0 && xo <= x1 && yo >= y0 && yo <= y1) heights.push(p[i * 3 + 1]);
  }
  if (heights.length < 300) throw new Error(`too few scan vertices in ${JSON.stringify(rect)}: ${heights.length}`);
  heights.sort((a, b) => a - b);
  const top = percentile(heights, 0.9);
  const low = percentile(heights, 0.15);
  const zmin = Math.max(low - 0.015, top - (rect.max_depth ?? 0.14));
  const zmax = top + 0.02;
  return { hits: heights.length, top: +top.toFixed(3), low: +low.toFixed(3), zmin: +zmin.toFixed(3), zmax: +zmax.toFixed(3) };
}

const { buf, json, jsonLen } = readGlb(glbArg);
const stats = {};
for (const [id, rect] of Object.entries(NEW_ZONES)) stats[id] = measure(json, buf, jsonLen, rect);
console.log(JSON.stringify(stats, null, 2));

if (mode === "probe") process.exit(0);
if (mode !== "patch") throw new Error(`unknown mode ${mode}`);

const added = [];
for (const [id, rect] of Object.entries(NEW_ZONES)) {
  const node = `zone__${id}`;
  if (json.nodes.some((n) => n.name === node)) throw new Error(`${node} already in the GLB`);
  for (const [other, r] of Object.entries(NEW_ZONES)) {
    if (other === id) continue;
    const overlap = (a, b) => a[0] < b[1] && b[0] < a[1];
    if (overlap(rect.x, r.x) && overlap(rect.y, r.y)) throw new Error(`new zones ${id}/${other} overlap`);
  }
  const s = stats[id];
  const xc = (rect.x[0] + rect.x[1]) / 2, yc = (rect.y[0] + rect.y[1]) / 2, zc = (s.zmin + s.zmax) / 2;
  const m = rect.min_size ?? 0.1;
  const scale = [
    Math.max(rect.y[1] - rect.y[0], m),
    Math.max(s.zmax - s.zmin, m),
    Math.max(rect.x[1] - rect.x[0], m),
  ];
  const translation = [-yc, zc, -xc];
  json.nodes.push({ name: node, translation, scale });
  json.scenes[0].nodes.push(json.nodes.length - 1);
  added.push({ node, translation, scale, stats: s });
}

let padded = Buffer.from(JSON.stringify(json), "utf8");
// JSON chunks are padded with trailing spaces so every chunk stays 4-byte aligned.
if (padded.length % 4) padded = Buffer.concat([padded, Buffer.alloc(4 - (padded.length % 4), 0x20)]);
const bin = buf.subarray(20 + Math.ceil(jsonLen / 4) * 4); // [len]["BIN"][bin data…]
const total = 12 + 8 + padded.length + bin.length;
const header = Buffer.alloc(16);
header.write("glTF", 0, "ascii"); // magic 0x46546C67
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
header.writeUInt32LE(padded.length, 12);
const type = Buffer.alloc(4); type.write("JSON", 0, "ascii");
const out = Buffer.concat([header, type, padded, bin]);
const dest = outArg ?? glbArg;
writeFileSync(dest, out);
console.log(JSON.stringify(added, null, 2));
console.log(`✅ ${added.length} zone node(s) added → ${dest} (${total} bytes, was ${buf.length})`);
