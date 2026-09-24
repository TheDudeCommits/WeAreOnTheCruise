/**
 * Shared tool loader for the ASSETS fleet pipeline (Node only).
 * The glTF tooling is NOT a project dependency (package.json stays untouched): install it once into a scratch dir
 *   mkdir -p /tmp/cruise-asset-tools && cd /tmp/cruise-asset-tools && npm init -y && \
 *   npm i @gltf-transform/core@4.5.0 @gltf-transform/functions@4.5.0 @gltf-transform/extensions@4.5.0 meshoptimizer sharp draco3dgltf
 * and point CRUISE_ASSET_TOOLS at it (default /tmp/cruise-asset-tools).
 */
import { createRequire } from 'node:module';
import path from 'node:path';

export const TOOLS_DIR = process.env.CRUISE_ASSET_TOOLS || '/tmp/cruise-asset-tools';
const req = createRequire(path.join(TOOLS_DIR, 'noop.js'));
export const core = req('@gltf-transform/core');
export const fn = req('@gltf-transform/functions');
export const ext = req('@gltf-transform/extensions');
export const mo = req('meshoptimizer');
export const sharp = req('sharp');
let draco = null;
try { draco = req('draco3dgltf'); } catch { /* optional */ }

export async function makeIO() {
  await mo.MeshoptDecoder.ready; await mo.MeshoptEncoder.ready;
  const deps = { 'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder };
  if (draco) { deps['draco3d.decoder'] = await draco.createDecoderModule(); deps['draco3d.encoder'] = await draco.createEncoderModule(); }
  return new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies(deps);
}

/** Triangle count of a document (all primitives, TRIANGLES mode). */
export function countTris(doc) {
  let t = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices(); const pos = p.getAttribute('POSITION'); if (!pos) continue;
    const mode = p.getMode(); const n = idx ? idx.getCount() : pos.getCount();
    t += mode === 4 ? n / 3 : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
  }
  return Math.round(t);
}

/** World-space bounds over every mesh node in the default scene. */
export function worldBounds(doc) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  return fn.getBounds ? fn.getBounds(scene) : core.getBounds(scene);
}
