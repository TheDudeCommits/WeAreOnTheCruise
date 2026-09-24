#!/usr/bin/env node
/**
 * Validates public/assets/fleet/manifest.json against the DESIGN §9 contract: required keys present, files exist and
 * match their sha256, triangle budgets, role-specific fields, and icons for every id in src/game/ids.ts.
 *   node scripts/assets/validate-fleet.mjs        (exit code 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'public/assets/fleet/manifest.json'), 'utf8'));
const errors = [], warnings = [];
const REQUIRED = {
  enemy: ['skiff', 'sloop', 'brig', 'fireship', 'mortar-barge', 'frigate', 'man-o-war', 'corsair-brig', 'corsair-galleon', 'wraith', 'fort'],
  boss: ['dreadnought', 'sovereign'],
  prop: ['cannon', 'mortar', 'rocket-rack', 'swivel-gun', 'harpoon-gun', 'storm-rod', 'barrel', 'powder-keg', 'mine', 'chest', 'crate', 'lantern', 'flag', 'anchor'],
  crew: ['sailor-a', 'sailor-b', 'sailor-c', 'admiralty-sailor', 'corsair'],
  nature: ['palm-a', 'palm-b', 'rock-a', 'rock-b', 'bush', 'hut', 'dock', 'tower'],
};
const BUDGET = { enemy: 25000, boss: 60000, crew: 6000, prop: 3000, pickup: 3000, nature: 8000 };
const LICENSES = ['CC-BY-4.0', 'CC0-1.0', 'Meshy (owner-generated)', 'Project-original'];

for (const [role, keys] of Object.entries(REQUIRED)) for (const k of keys) {
  const m = manifest.models[k];
  if (!m) { errors.push(`missing ${role} model '${k}'`); continue; }
  if (m.role !== role) errors.push(`${k}: role ${m.role}, expected ${role}`);
}
for (const [k, m] of Object.entries(manifest.models)) {
  const file = path.join(repo, 'public', m.file);
  if (!fs.existsSync(file)) { errors.push(`${k}: missing file ${m.file}`); continue; }
  const buf = fs.readFileSync(file);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== m.sha256) errors.push(`${k}: sha256 mismatch (rebuild the manifest)`);
  if (buf.length !== m.bytes) errors.push(`${k}: byte size mismatch`);
  if (m.tris > (BUDGET[m.role] ?? Infinity)) errors.push(`${k}: ${m.tris} tris over the ${m.role} budget ${BUDGET[m.role]}`);
  if (!LICENSES.includes(m.source?.license)) errors.push(`${k}: licence '${m.source?.license}' not allowed`);
  if (!m.source?.author) errors.push(`${k}: no author`);
  if (m.source?.kind === 'sketchfab' && !/^https:\/\/sketchfab\.com\/3d-models\/[0-9a-f]{32}$/.test(m.source.url)) errors.push(`${k}: bad sketchfab url`);
  if (/[?&](Signature|X-Amz|Expires)=/i.test(JSON.stringify(m))) errors.push(`${k}: signed URL in manifest`);
  if (m.role === 'crew' && !(m.clips || []).includes('Idle')) errors.push(`${k}: crew without an Idle clip`);
  if (typeof m.length !== 'number' || !(m.length > 0)) errors.push(`${k}: bad length`);
  if (m.materials > 4) warnings.push(`${k}: ${m.materials} materials (draw calls per instanced class)`);
}
// icons
const ids = fs.readFileSync(path.join(repo, 'src/game/ids.ts'), 'utf8');
const list = (name) => (ids.match(new RegExp(`${name} = \\[([^\\]]*)\\]`)) || [, ''])[1].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) || [];
const pickups = (ids.match(/PickupKind =([^;]*);/) || [, ''])[1].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) || [];
const iconIds = new Set([...list('WEAPON_IDS'), ...list('PASSIVE_IDS'), ...list('SPECIAL_IDS'), ...list('ULTIMATE_IDS'), ...list('META_UPGRADE_IDS'), ...pickups, 'broadside', 'brace', 'boost', 'heal', 'doubloon', 'bounty']);
for (const id of iconIds) if (!fs.existsSync(path.join(repo, 'public/assets/icons', `${id}.png`))) errors.push(`icon missing: ${id}.png`);

console.log(`${Object.keys(manifest.models).length} models, ${iconIds.size} required icons`);
for (const w of warnings) console.log(`warn: ${w}`);
for (const e of errors) console.log(`FAIL: ${e}`);
if (errors.length) process.exit(1);
console.log('fleet manifest OK');
