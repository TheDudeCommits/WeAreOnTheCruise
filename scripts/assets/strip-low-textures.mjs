#!/usr/bin/env node
/**
 * Replaces every image embedded in the hero `-low.glb` files with a 1×1 placeholder (PERF, round 2).
 *
 * The low files are used only by the AI captains' hull bake (src/render/ships/fleet/captainHulls.ts). Their loader
 * never decodes their images: a GLTFLoader plugin hands every texture slot a placeholder and re-points it at the high
 * model's texture of the same material name (src/render/loaders/SketchfabShipAssets.ts). The embedded images were
 * pure download weight (about 3.5 MB across the six files). Geometry, UVs, materials and texture slots are kept.
 *
 *   node scripts/assets/strip-low-textures.mjs [kind ...] [--dry]
 *
 * Prints bytes/sha256 for public/assets/sketchfab/manifest.json and updates the manifest unless --dry.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIO, sharp } from './fleet/tools.mjs';

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(repo, 'public/assets/sketchfab');
const manifestFile = path.join(dir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const kinds = argv.filter((a) => !a.startsWith('--'));
const targets = kinds.length ? kinds : manifest.ships.map((s) => s.kind);
const io = await makeIO();
const placeholder = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#808080' } }).png().toBuffer();
const out = [];
for (const kind of targets) {
  const file = path.join(dir, `${kind}-low.glb`);
  if (!fs.existsSync(file)) continue;
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  let replaced = 0;
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image || image.byteLength <= placeholder.length) continue;
    texture.setImage(new Uint8Array(placeholder)).setMimeType('image/png');
    replaced++;
  }
  if (!replaced) { out.push({ kind, skipped: 'already placeholders' }); continue; }
  // No WebP images remain: the extension is no longer required.
  for (const extension of doc.getRoot().listExtensionsUsed()) if (extension.extensionName === 'EXT_texture_webp') extension.dispose();
  if (!dry) await io.write(file, doc);
  const buf = dry ? null : fs.readFileSync(file);
  const entry = { kind, replaced, beforeKB: Math.round(before / 1024), afterKB: buf ? Math.round(buf.length / 1024) : null, bytes: buf?.length ?? null, sha256: buf ? crypto.createHash('sha256').update(buf).digest('hex') : null };
  out.push(entry);
  if (!dry) {
    const ship = manifest.ships.find((s) => s.kind === kind);
    const variant = ship?.variants.find((v) => v.detail === 'low');
    if (variant) { variant.bytes = entry.bytes; variant.sha256 = entry.sha256; }
    if (ship && !/1×1 placeholder/.test(ship.changes)) ship.changes += ' 2026-09-25: the low file (captain hull bake only) keeps 1×1 placeholder images; the loader uses the high textures.';
  }
}
if (!dry) {
  const raw = fs.readFileSync(manifestFile, 'utf8');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, raw.startsWith('{\n  "') ? 2 : 1) + (raw.endsWith('\n') ? '\n' : ''));
}
console.table(out);
