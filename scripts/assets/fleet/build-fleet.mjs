#!/usr/bin/env node
/**
 * ASSETS fleet pipeline: source GLB/glTF → normalized, optimized public/assets/fleet/<key>.glb + manifest.json.
 *
 *   node scripts/assets/fleet/build-fleet.mjs [key ...]     build the given jobs (default: all)
 *   node scripts/assets/fleet/build-fleet.mjs --manifest    rewrite public/assets/fleet/manifest.json from jobs + build stats
 *
 * Sources are read from $CRUISE_ASSET_SRC (default /tmp/cruise-asset-work); they are third-party downloads or
 * generated files and are NOT committed. Each job in ./jobs.mjs records its provenance (see ASSET-LICENSES.md).
 *
 * Normalization contract (docs/overhaul-v2/DESIGN.md §9): +Y up, bow/forward toward −Z, origin at the waterline centre
 * for ships (keel at −draft) or ground centre for props/crew/nature, uniform scale to the job's length/height (metres).
 * Optimization: flatten + bake transforms, join, weld, meshopt simplify to the tri budget, albedo-only plain PBR
 * materials (metallic 0, roughness 1, no normal/ORM maps), BLEND → MASK, WebP textures ≤1024² (≤2048² bosses),
 * Meshopt compression + quantization (three.js GLTFLoader needs MeshoptDecoder).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { core, fn, mo, sharp, makeIO, countTris } from './tools.mjs';
import * as L from './lib.mjs';
import { JOBS, SRC } from './jobs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const OUT_DIR = path.join(repo, 'public', 'assets', 'fleet');
const STATS = path.join(here, 'build-stats.json');
const SHIP_ROLES = new Set(['enemy', 'boss']);

const args = process.argv.slice(2);
fs.mkdirSync(OUT_DIR, { recursive: true });
const stats = fs.existsSync(STATS) ? JSON.parse(fs.readFileSync(STATS, 'utf8')) : {};

if (args.includes('--manifest')) { writeManifest(); process.exit(0); }

const io = await makeIO();
const want = args.filter((a) => !a.startsWith('--'));
for (const job of JOBS.filter((j) => !want.length || want.includes(j.key))) {
  const t0 = Date.now();
  try {
    const st = await build(job);
    stats[job.key] = st;
    fs.writeFileSync(STATS, JSON.stringify(stats, null, 2) + '\n');
    console.log(`${job.key.padEnd(18)} ${String(st.tris).padStart(6)} tris  ${st.materials} mats  ${st.draws} draws  ${(st.bytes / 1024).toFixed(0)} KB  size ${st.size.join(' x ')}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    console.error(`${job.key}: FAILED ${e.stack || e}`);
    process.exitCode = 1;
  }
}

async function build(job) {
  const src = path.resolve(SRC, job.src);
  const doc = await io.read(src);
  const root = doc.getRoot();
  const skinned = root.listSkins().length > 0;

  // 1. drop unwanted parts
  if (job.exclude) {
    for (const node of root.listNodes()) {
      const names = [node.getName(), node.getMesh()?.getName() || ''];
      if (names.some((n) => job.exclude.test(n))) node.dispose();
    }
  }
  if (job.keepAnimations) {
    for (const a of root.listAnimations()) if (!job.keepAnimations.includes(a.getName())) a.dispose();
  }
  await doc.transform(fn.prune({ keepLeaves: false }));

  // 2. normalize
  const R = (job.rotate || []).reduce((m, [axis, deg]) => L.mul(axis === 'x' ? L.rotX(deg) : axis === 'z' ? L.rotZ(deg) : L.rotY(deg), m), L.rotY(job.yaw || 0));
  if (!skinned) await doc.transform(fn.flatten());
  const b = L.boundsWith(doc, R);
  const s = job.length ? job.length / b.size[2] : job.height ? job.height / b.size[1] : job.longest ? job.longest / Math.max(...b.size) : job.scale || 1;
  const isShip = SHIP_ROLES.has(job.role) && job.origin !== 'ground';
  const ty = isShip ? -(job.draft ?? 0) - b.min[1] * s : -(b.min[1] * s) + (job.lift || 0);
  const M = L.mul(L.translate(-b.center[0] * s, ty, -b.center[2] * s), L.mul(L.scale(s), R));
  if (!skinned) L.bakeTransforms(doc, M);
  else {
    const scene = root.getDefaultScene() || root.listScenes()[0];
    const wrapper = doc.createNode(`${job.key}-root`).setMatrix(M);
    for (const child of scene.listChildren()) { scene.removeChild(child); wrapper.addChild(child); }
    scene.addChild(wrapper);
  }

  // 3. recolour / split (positions are now world metres for static models)
  if (job.recolor) await job.recolor({ doc, L, core, fn, sharp, job });

  // 4. materials: plain albedo PBR
  for (const mat of root.listMaterials()) {
    mat.setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(1);
    if (!job.keepEmissive) mat.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
    if (mat.getAlphaMode() === 'BLEND' && !job.keepBlend) mat.setAlphaMode('MASK').setAlphaCutoff(0.5);
    for (const ext of mat.listExtensions()) mat.setExtension(ext.extensionName, null);
  }
  for (const ext of root.listExtensionsUsed()) if (/KHR_materials_(?!unlit)|KHR_texture_transform/.test(ext.extensionName) && !/emissive_strength/.test(ext.extensionName)) ext.dispose();

  // 5. geometry
  await doc.transform(fn.dedup(), fn.prune());
  if (!skinned) await doc.transform(fn.join({ keepNamed: false }));
  await doc.transform(fn.weld());
  let tris = countTris(doc);
  const target = job.tris;
  for (let pass = 0; target && tris > target && pass < 6; pass++) {
    const ratio = Math.max(0.02, (target / tris) * (pass ? 0.9 : 0.98));
    await doc.transform(fn.simplify({ simplifier: mo.MeshoptSimplifier, ratio, error: job.simplifyError ?? (0.004 * (pass + 1)), lockBorder: false }));
    const now = countTris(doc);
    if (now >= tris * 0.995 && job.sloppy !== false) await sloppy(doc, target / now);
    tris = countTris(doc);
  }
  await doc.transform(fn.dedup(), fn.prune(), fn.resample());

  // 6. textures
  await doc.transform(fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [job.tex || 1024, job.tex || 1024], quality: job.webpQuality || 86 }));

  // 7. compression
  await doc.transform(fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium' }));
  root.getAsset().generator = 'We Are On The Cruise fleet pipeline (glTF-Transform 4.5)';
  root.getAsset().copyright = job.source.license === 'CC0-1.0' ? `CC0 1.0 — ${job.source.author}` : job.source.kind === 'meshy' ? 'Owner-generated (Meshy)' : `${job.source.license} — ${job.source.author}`;

  const outFile = path.join(OUT_DIR, `${job.key}.glb`);
  await io.write(outFile, doc);
  const buf = fs.readFileSync(outFile);
  const check = await io.read(outFile);
  const fb = L.boundsWith(check);
  const texSizes = check.getRoot().listTextures().map((t) => t.getSize()).filter(Boolean);
  return {
    file: `/assets/fleet/${job.key}.glb`,
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex'),
    tris: countTris(check),
    materials: check.getRoot().listMaterials().length,
    draws: check.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
    textures: texSizes.length,
    maxTexture: texSizes.reduce((m, [w, h]) => Math.max(m, w, h), 0),
    size: fb.size.map((v) => +v.toFixed(2)),
    min: fb.min.map((v) => +v.toFixed(2)),
    max: fb.max.map((v) => +v.toFixed(2)),
    clips: check.getRoot().listAnimations().map((a) => a.getName()),
    built: new Date().toISOString().slice(0, 10),
  };
}

/** Last-resort topology-agnostic decimation (meshopt simplifySloppy) for meshes whose UV seams stall simplify. */
async function sloppy(doc, ratio) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices(); const pos = prim.getAttribute('POSITION'); if (!idx || !pos || prim.getMode() !== 4) continue;
    const indices = new Uint32Array(idx.getArray());
    const positions = pos.getArray() instanceof Float32Array ? pos.getArray() : new Float32Array(pos.getArray());
    const targetCount = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
    const [out] = mo.MeshoptSimplifier.simplifySloppy(indices, positions, 3, targetCount, 0.05);
    idx.setArray(pos.getCount() > 65535 ? out : new Uint16Array(out));
  }
}

function writeManifest() {
  const models = {};
  const prev = fs.existsSync(path.join(OUT_DIR, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8')).models || {} : {};
  for (const job of JOBS) {
    const st = stats[job.key];
    if (!st || !fs.existsSync(path.join(OUT_DIR, `${job.key}.glb`))) { if (prev[job.key]) models[job.key] = prev[job.key]; continue; }
    models[job.key] = {
      file: st.file,
      length: job.role === 'crew' || job.role === 'prop' || job.role === 'nature' || job.role === 'pickup' ? +Math.max(st.size[0], st.size[2]).toFixed(2) : job.length,
      ...(job.role === 'crew' || job.role === 'prop' || job.role === 'nature' || job.role === 'pickup' ? { height: +st.size[1].toFixed(2) } : { draft: job.draft ?? 0, beam: +st.size[0].toFixed(2), height: +st.max[1].toFixed(2) }),
      tris: st.tris,
      materials: st.materials,
      role: job.role,
      source: job.source,
      ...(st.clips.length ? { clips: st.clips } : {}),
      bytes: st.bytes,
      sha256: st.sha256,
      sourceSha256: st.sourceSha256,
      notes: job.notes || '',
    };
  }
  const manifest = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    conventions: 'Y up, bow/forward toward -Z, metres. Ships: origin at the waterline centre, keel at -draft, `length` = bow-to-stern extent incl. bowsprit. Props/crew/nature: origin at ground centre, `height` in metres. Meshopt-compressed (EXT_meshopt_compression + KHR_mesh_quantization), WebP textures (EXT_texture_webp); plain PBR albedo materials for toonifyObject.',
    models,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('manifest:', Object.keys(models).length, 'models');
}
