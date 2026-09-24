#!/usr/bin/env node
/**
 * Hero material atlas re-bake (PERF, round 2). Rebuilds a kept hero GLB with at most `--keep` + 1 materials (default
 * 6), so a model with dozens of materials draws in a handful of calls per pass (Sunlion: 36 → 6). It is a material
 * and texture bake only — the downloaded geometry, UV content and texels are preserved:
 *
 *  - The `--keep` materials whose repeating UVs would need the most splitting stay separate: original texture bytes,
 *    original UVs, REPEAT sampling — untouched.
 *  - Every other texture is copied texel for texel into ONE atlas, repeated Ku×Kv times inside its tile (K ≤
 *    `--block`, chosen per axis to cover ~97% of its triangles) and wrapped by a gutter holding the texels REPEAT would
 *    sample across the tile edge, so bilinear filtering at the former seams matches; tile origins sit on multiples of
 *    the gutter so mips 0–3 stay clean.
 *  - Each atlased triangle is shifted by whole tiles into the block; triangles still wider than the block are split
 *    along the block's UV grid lines (planar pieces with linearly interpolated attributes: the surface does not move).
 *  - The low-detail GLB (used only for the AI captains' vertex-colour hull bake, src/render/ships/fleet/captainHulls.ts)
 *    keeps its triangles: each vertex's UV is wrapped into its texture's atlas tile, which is exact for per-vertex
 *    sampling (not for textured rendering), and its images become 1×1 placeholders — the runtime loader
 *    (src/render/loaders/SketchfabShipAssets.ts) points its materials at the high model's textures by material name.
 *
 *   node scripts/assets/atlas-hero.mjs <kind> [--keep 5] [--block 3] [--quality 92] [--gutter 8] [--out <dir>] [--dry]
 *
 * Reads and (unless --dry) overwrites public/assets/sketchfab/<kind>.glb and <kind>-low.glb, then prints the new
 * sha256/bytes/triangles/draws for public/assets/sketchfab/manifest.json. Needs the asset tools (scripts/assets/fleet/tools.mjs).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { core, countTris, fn, makeIO, mo, sharp, ext } from './fleet/tools.mjs';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--dry') flags.dry = true; else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i]; else pos.push(a); }
const KIND = pos[0];
if (!KIND) { console.error('usage: node scripts/assets/atlas-hero.mjs <kind> [--quality 92] [--gutter 8] [--out dir] [--dry]'); process.exit(2); }
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC_DIR = path.join(repo, 'public/assets/sketchfab');
const OUT_DIR = flags.out ? path.resolve(flags.out) : SRC_DIR;
const QUALITY = Number(flags.quality ?? 92);
const GUTTER = Number(flags.gutter ?? 8);
const KEEP = Number(flags.keep ?? 5);
const BLOCK = Number(flags.block ?? 2);
/** Textures larger than this (texels) are never repeated inside the atlas (K = 1): repetition would cost too much space. */
const BLOCK_MAX_TEXELS = Number(flags['block-max-texels'] ?? 65536);
const MATERIAL = `${KIND}-atlas`;
const EPS = 1e-6;

const io = await makeIO();

// ───────────────────────── geometry ─────────────────────────

/** Every primitive of the default scene, baked to world space: { material, texture, pos, nrm, uv, idx }. */
function collect(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const out = [];
  scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== core.Primitive.Mode.TRIANGLES) throw new Error('only triangle primitives are supported');
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), T = prim.getAttribute('TEXCOORD_0');
      const I = prim.getIndices();
      const n = P.getCount();
      const pos = new Float64Array(n * 3), nrm = new Float64Array(n * 3), uv = new Float64Array(n * 2);
      const e = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        P.getElement(i, e);
        const x = e[0], y = e[1], z = e[2];
        pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (N) {
          N.getElement(i, e);
          const nx = m[0] * e[0] + m[4] * e[1] + m[8] * e[2], ny = m[1] * e[0] + m[5] * e[1] + m[9] * e[2], nz = m[2] * e[0] + m[6] * e[1] + m[10] * e[2];
          const l = Math.hypot(nx, ny, nz) || 1;
          nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l;
        }
        if (T) { T.getElement(i, e); uv[i * 2] = e[0]; uv[i * 2 + 1] = e[1]; }
      }
      const idx = I ? Uint32Array.from({ length: I.getCount() }, (_, k) => I.getScalar(k)) : Uint32Array.from({ length: n }, (_, k) => k);
      const material = prim.getMaterial();
      out.push({ material: material?.getName() ?? '', texture: material?.getBaseColorTexture() ?? null, pos, nrm, uv, idx, hasNormals: !!N });
    }
  });
  return out;
}

/** Sutherland–Hodgman clip of a polygon (vertex = [px,py,pz,nx,ny,nz,u,v]) against coord[axis] ≥ k (sign 1) or ≤ k (sign -1). */
function clip(poly, axis, k, sign) {
  const out = [];
  const inside = (v) => sign * (v[6 + axis] - k) >= -EPS;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (k - a[6 + axis]) / (b[6 + axis] - a[6 + axis]);
      out.push(a.map((x, j) => x + (b[j] - x) * t));
    }
  }
  return out;
}

/** Whole tiles a triangle's UVs span per axis (after shifting its minimum into [0, 1)). */
function extents(item) {
  const { uv, idx } = item;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < 3; k++) { const i = idx[t + k]; u0 = Math.min(u0, uv[i * 2]); u1 = Math.max(u1, uv[i * 2]); v0 = Math.min(v0, uv[i * 2 + 1]); v1 = Math.max(v1, uv[i * 2 + 1]); }
    out.push([Math.ceil(u1 - EPS) - Math.floor(u0 + EPS), Math.ceil(v1 - EPS) - Math.floor(v0 + EPS)]);
  }
  return out;
}

/**
 * Shifts every triangle by whole tiles so its UVs start in [0, 1), then splits the ones still wider than the Ku×Kv
 * block along the block's grid lines. Returns flat triangles with UVs in [0, Ku] × [0, Kv].
 */
function splitByBlocks(item, Ku, Kv) {
  const { pos, nrm, uv, idx } = item;
  const tris = [];
  let split = 0;
  const vert = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]];
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [vert(idx[t]), vert(idx[t + 1]), vert(idx[t + 2])];
    const su = Math.floor(Math.min(tri[0][6], tri[1][6], tri[2][6]) + EPS), sv = Math.floor(Math.min(tri[0][7], tri[1][7], tri[2][7]) + EPS);
    for (const v of tri) { v[6] -= su; v[7] -= sv; }
    const u1 = Math.max(tri[0][6], tri[1][6], tri[2][6]), v1 = Math.max(tri[0][7], tri[1][7], tri[2][7]);
    const ni = Math.max(1, Math.ceil((u1 - EPS) / Ku)), nj = Math.max(1, Math.ceil((v1 - EPS) / Kv));
    if (ni === 1 && nj === 1) { tris.push({ v: tri }); continue; }
    split++;
    for (let i = 0; i < ni; i++) {
      const column = clip(clip(tri, 0, i * Ku, 1), 0, (i + 1) * Ku, -1);
      if (column.length < 3) continue;
      for (let j = 0; j < nj; j++) {
        const piece = clip(clip(column, 1, j * Kv, 1), 1, (j + 1) * Kv, -1);
        if (piece.length < 3) continue;
        const shifted = piece.map((v) => { const c = v.slice(); c[6] = Math.min(Ku, Math.max(0, c[6] - i * Ku)); c[7] = Math.min(Kv, Math.max(0, c[7] - j * Kv)); return c; });
        for (let k = 1; k + 1 < shifted.length; k++) {
          const a = shifted[0], b = shifted[k], c = shifted[k + 1];
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          // Copies: the fan shares vertex arrays and remap() writes UVs in place.
          if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-10) tris.push({ v: [a.slice(), b.slice(), c.slice()] });
        }
      }
    }
  }
  return { tris, split };
}

/** Smallest K ≤ cap covering `share` of the extents on one axis. */
function blockFor(ext, axis, cap, share = 0.97) {
  const sorted = ext.map((e) => e[axis]).sort((a, b) => a - b);
  const q = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 1;
  return Math.max(1, Math.min(cap, q));
}

// ───────────────────────── atlas ─────────────────────────

async function decode(texture) {
  const img = sharp(Buffer.from(texture.getImage())).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Shelf packing of padded tiles; returns { W, H, rects } with the smallest area among a few widths. */
function pack(tiles) {
  const order = [...tiles.keys()].sort((a, b) => tiles[b].ph - tiles[a].ph || tiles[b].pw - tiles[a].pw);
  let best = null;
  for (const W of [1024, 1536, 2048, 2560, 3072, 4096]) {
    if (Math.max(...tiles.map((t) => t.pw)) > W) continue;
    const rects = new Array(tiles.length);
    let x = 0, y = 0, shelf = 0;
    for (const i of order) {
      const t = tiles[i];
      if (x + t.pw > W) { x = 0; y += shelf; shelf = 0; }
      rects[i] = { x, y };
      x += t.pw; shelf = Math.max(shelf, t.ph);
    }
    const H = Math.ceil((y + shelf) / 64) * 64;
    if (H > 4096) continue;
    if (!best || W * H < best.W * best.H) best = { W, H, rects };
  }
  if (!best) throw new Error('atlas does not fit 4096²');
  return best;
}

/** `blocks`: Map<texture, [Ku, Kv]> — the texture is repeated Ku×Kv times inside its tile. */
async function buildAtlas(textures, blocks) {
  const tiles = [];
  for (const tex of textures) {
    const img = await decode(tex);
    const [Ku, Kv] = blocks.get(tex) ?? [1, 1];
    // Gutter aligned so every tile origin stays on a multiple of the gutter (clean mips 0..log2(gutter)).
    const pw = Math.ceil((img.w * Ku + 2 * GUTTER) / GUTTER) * GUTTER, ph = Math.ceil((img.h * Kv + 2 * GUTTER) / GUTTER) * GUTTER;
    tiles.push({ tex, img, pw, ph, Ku, Kv });
  }
  const { W, H, rects } = pack(tiles);
  const atlas = Buffer.alloc(W * H * 4);
  const map = new Map();
  tiles.forEach((t, i) => {
    const { x: ox, y: oy } = rects[i];
    const { data, w, h } = t.img;
    for (let y = 0; y < t.ph; y++) {
      const sy = (((y - GUTTER) % h) + h) % h;
      for (let x = 0; x < t.pw; x++) {
        const sx = (((x - GUTTER) % w) + w) % w;
        data.copy(atlas, ((oy + y) * W + ox + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
      }
    }
    // Normalised rect of one repetition of the texture (glTF UV: v grows downwards like image rows); UVs in
    // [0, Ku] × [0, Kv] land inside the tile's repeated block.
    map.set(t.tex, { x: (ox + GUTTER) / W, y: (oy + GUTTER) / H, w: w / W, h: h / H, Ku: t.Ku, Kv: t.Kv });
  });
  const used = tiles.reduce((a, t) => a + t.img.w * t.img.h * t.Ku * t.Kv, 0);
  return { W, H, atlas, map, fill: used / (W * H) };
}

// ───────────────────────── output ─────────────────────────

/** Welds identical vertices and returns typed arrays for one primitive. */
function weld(pieces) {
  const key = (v) => `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)},${v[3].toFixed(4)},${v[4].toFixed(4)},${v[5].toFixed(4)},${v[6].toFixed(7)},${v[7].toFixed(7)}`;
  const ids = new Map();
  const P = [], N = [], T = [], I = [];
  for (const { v } of pieces) for (const x of v) {
    const k = key(x);
    let id = ids.get(k);
    if (id === undefined) {
      id = P.length / 3; ids.set(k, id);
      const l = Math.hypot(x[3], x[4], x[5]) || 1;
      P.push(x[0], x[1], x[2]); N.push(x[3] / l, x[4] / l, x[5] / l); T.push(x[6], x[7]);
    }
    I.push(id);
  }
  return { P: Float32Array.from(P), N: Float32Array.from(N), T: Float32Array.from(T), I: Uint32Array.from(I) };
}

/**
 * Writes one mesh with one primitive per output material. `parts`: [{ name, geometry, image, mime, repeat }] — `repeat`
 * keeps REPEAT sampling (untouched materials), otherwise CLAMP_TO_EDGE (the atlas).
 */
async function writeModel(src, parts, file) {
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const asset = doc.getRoot().getAsset();
  const srcAsset = src.getRoot().getAsset();
  asset.generator = 'We Are On The Cruise hero atlas re-bake (glTF-Transform 4.5)';
  if (srcAsset.copyright) asset.copyright = srcAsset.copyright;
  if (srcAsset.extras) asset.extras = srcAsset.extras;
  const srcMaterial = src.getRoot().listMaterials()[0];
  const acc = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const mesh = doc.createMesh(`${KIND}-atlas`);
  let webp = false;
  for (const part of parts) {
    const texture = doc.createTexture(part.name).setImage(new Uint8Array(part.image)).setMimeType(part.mime);
    webp ||= part.mime === 'image/webp';
    const material = doc.createMaterial(part.name)
      .setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(texture)
      .setMetallicFactor(srcMaterial?.getMetallicFactor() ?? 0).setRoughnessFactor(srcMaterial?.getRoughnessFactor() ?? 1)
      .setDoubleSided(true).setAlphaMode('OPAQUE');
    const wrap = part.repeat ? core.TextureInfo.WrapMode.REPEAT : core.TextureInfo.WrapMode.CLAMP_TO_EDGE;
    material.getBaseColorTextureInfo().setWrapS(wrap).setWrapT(wrap)
      .setMinFilter(core.TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR).setMagFilter(core.TextureInfo.MagFilter.LINEAR);
    const g = part.geometry;
    mesh.addPrimitive(doc.createPrimitive()
      .setAttribute('POSITION', acc('VEC3', g.P)).setAttribute('NORMAL', acc('VEC3', g.N)).setAttribute('TEXCOORD_0', acc('VEC2', g.T))
      .setIndices(acc('SCALAR', g.I)).setMaterial(material));
  }
  const node = doc.createNode(`${KIND}-atlas`).setMesh(mesh);
  doc.createScene('Scene').addChild(node);
  doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
  if (webp) doc.createExtension(ext.EXTTextureWebP).setRequired(true);
  // Precision close to the source files' per-node quantization: 16-bit positions (< 1 mm on a 56 m hull), 8-bit normals
  // as before, and 16-bit atlas UVs (0.04 texel on a 2560 atlas; out-of-range UVs of untouched materials stay float).
  await doc.transform(fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 8, quantizeTexcoord: 16 }));
  if (!flags.dry) await io.write(file, doc);
  return doc;
}

/** Plain vertices of an untouched primitive (original UVs), for weld(). */
function untouched(item) {
  const { pos, nrm, uv, idx } = item;
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    tris.push({ v: [0, 1, 2].map((k) => { const i = idx[t + k]; return [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]]; }) });
  }
  return tris;
}

function remap(items, rects) {
  const pieces = [];
  let split = 0, source = 0;
  for (const item of items) {
    const r = rects(item);
    if (!r) throw new Error(`no atlas tile for material "${item.material}"`);
    source += item.idx.length / 3;
    const s = splitByBlocks(item, r.Ku, r.Kv);
    split += s.split;
    for (const p of s.tris) {
      for (const v of p.v) { v[6] = r.x + v[6] * r.w; v[7] = r.y + v[7] * r.h; }
      pieces.push(p);
    }
  }
  return { pieces, split, source };
}

// ───────────────────────── main ─────────────────────────

const highFile = path.join(SRC_DIR, `${KIND}.glb`), lowFile = path.join(SRC_DIR, `${KIND}-low.glb`);
const high = await io.read(highFile);
const highItems = collect(high);
if (highItems.some((i) => !i.texture)) throw new Error('every primitive needs a base colour texture');

// Rank materials by the splitting a 1×1 tile would need; the worst KEEP stay untouched.
const byMaterial = new Map();
for (const item of highItems) {
  const e = byMaterial.get(item.material) ?? { items: [], texture: item.texture, cost: 0, ext: [] };
  const ext = extents(item);
  e.items.push(item); e.ext.push(...ext);
  e.cost += ext.reduce((a, [u, v]) => a + (u * v > 1 ? u * v * 1.6 - 1 : 0), 0);
  byMaterial.set(item.material, e);
}
const ranked = [...byMaterial.entries()].sort((a, b) => b[1].cost - a[1].cost);
const kept = new Set(ranked.slice(0, KEEP).map(([name]) => name));
const atlased = ranked.filter(([name]) => !kept.has(name));
const blocks = new Map();
for (const [, e] of atlased) {
  const [w, h] = e.texture.getSize() ?? [0, 0];
  const cap = w * h <= BLOCK_MAX_TEXELS ? BLOCK : 1;
  blocks.set(e.texture, [blockFor(e.ext, 0, cap), blockFor(e.ext, 1, cap)]);
}
const textures = [...new Set(atlased.map(([, e]) => e.texture))];
const { W, H, atlas, map, fill } = await buildAtlas(textures, blocks);
const hi = remap(atlased.flatMap(([, e]) => e.items), (item) => map.get(item.texture));
const webp = await sharp(atlas, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().webp({ quality: QUALITY, effort: 6, smartSubsample: true }).toBuffer();
fs.mkdirSync(OUT_DIR, { recursive: true });
const outHigh = path.join(OUT_DIR, `${KIND}.glb`), outLow = path.join(OUT_DIR, `${KIND}-low.glb`);
if (flags.dry) await sharp(atlas, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(OUT_DIR, `${KIND}-atlas.png`));
const highParts = [{ name: MATERIAL, geometry: weld(hi.pieces), image: webp, mime: 'image/webp', repeat: false }];
for (const name of kept) {
  const e = byMaterial.get(name);
  // Untouched: the original (already WebP) image bytes and UVs.
  highParts.push({ name, geometry: weld(e.items.flatMap(untouched)), image: Buffer.from(e.texture.getImage()), mime: e.texture.getMimeType(), repeat: true });
}
const hiDoc = await writeModel(high, highParts, outHigh);
const atlasRect = new Map(atlased.map(([name, e]) => [name, map.get(e.texture)]));

const low = fs.existsSync(lowFile) ? await io.read(lowFile) : null;
let loDoc = null, lo = null;
if (low) {
  const lowItems = collect(low);
  // 1×1 placeholders: the runtime loader skips images of low files and points each material at the high texture of
  // the same name (the atlas, or the untouched originals).
  const placeholder = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } }).png().toBuffer();
  // Per-vertex wrap into the tile: exact for the per-vertex colour bake, no triangle splits.
  const pieces = [];
  let source = 0;
  for (const item of lowItems.filter((i) => !kept.has(i.material))) {
    const r = atlasRect.get(item.material);
    if (!r) continue;
    source += item.idx.length / 3;
    for (const p of untouched(item)) {
      for (const v of p.v) { v[6] = r.x + (v[6] - Math.floor(v[6])) * r.w; v[7] = r.y + (v[7] - Math.floor(v[7])) * r.h; }
      pieces.push(p);
    }
  }
  lo = { pieces, split: 0, source };
  const lowParts = [{ name: MATERIAL, geometry: weld(lo.pieces), image: placeholder, mime: 'image/png', repeat: false }];
  for (const name of kept) {
    const items = lowItems.filter((i) => i.material === name);
    if (items.length) lowParts.push({ name, geometry: weld(items.flatMap(untouched)), image: placeholder, mime: 'image/png', repeat: true });
  }
  for (const i of lowItems) if (!kept.has(i.material) && !atlasRect.has(i.material)) throw new Error(`low material "${i.material}" has no high counterpart`);
  loDoc = await writeModel(low, lowParts, outLow);
}

const report = (file, doc, extra) => {
  const buf = flags.dry ? null : fs.readFileSync(file);
  return {
    file: path.relative(repo, file), bytes: buf?.length ?? null, sha256: buf ? crypto.createHash('sha256').update(buf).digest('hex') : null,
    triangles: countTris(doc), draws: doc.getRoot().listMaterials().length, ...extra,
  };
};
console.log(JSON.stringify({
  kind: KIND, kept: [...kept], blocks: Object.fromEntries(atlased.map(([name, e]) => [name, blocks.get(e.texture)])),
  atlas: { width: W, height: H, fill: +fill.toFixed(3), webpKB: Math.round(webp.length / 1024), textures: textures.length, gutter: GUTTER, quality: QUALITY, block: BLOCK, blockMaxTexels: BLOCK_MAX_TEXELS },
  high: report(outHigh, hiDoc, { sourceTriangles: countTris(high), splitTriangles: hi.split }),
  low: loDoc ? report(outLow, loDoc, { sourceTriangles: lo.source, splitTriangles: lo.split }) : null,
}, null, 1));
