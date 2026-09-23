#!/usr/bin/env node
/** Print materials, textures and meshes of GLB/glTF files: node scripts/assets/fleet/inspect.mjs file.glb ... */
import { makeIO, countTris, core } from './tools.mjs';
const io = await makeIO();
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  console.log(`\n== ${file}  tris ${countTris(doc)}  meshes ${root.listMeshes().length}  nodes ${root.listNodes().length}  mats ${root.listMaterials().length}  tex ${root.listTextures().length}  anims ${root.listAnimations().length}  skins ${root.listSkins().length}`);
  root.listTextures().forEach((t, i) => { const s = t.getSize(); console.log(`  tex${i} ${t.getName() || t.getURI()} ${t.getMimeType()} ${s ? s.join('x') : '?'} ${(t.getImage()?.byteLength / 1024 | 0)}KB`); });
  root.listMaterials().forEach((m, i) => {
    const bc = m.getBaseColorFactor().map((v) => +v.toFixed(2)).join(',');
    const slots = ['BaseColor', 'Emissive', 'Normal', 'MetallicRoughness', 'Occlusion'].filter((s) => m[`get${s}Texture`]()).map((s) => s + ':' + root.listTextures().indexOf(m[`get${s}Texture`]()));
    console.log(`  mat${i} "${m.getName()}" base(${bc}) emis(${m.getEmissiveFactor().map((v) => +v.toFixed(2))}) alpha ${m.getAlphaMode()} ${m.getDoubleSided() ? '2side' : ''} ${slots.join(' ')}`);
  });
  const matIdx = new Map(root.listMaterials().map((m, i) => [m, i]));
  for (const mesh of root.listMeshes()) {
    const parts = mesh.listPrimitives().map((p) => { const i = p.getIndices(); const n = i ? i.getCount() : p.getAttribute('POSITION').getCount(); return `m${matIdx.get(p.getMaterial())}:${n / 3 | 0}`; });
    console.log(`  mesh "${mesh.getName()}" ${parts.join(' ')}`);
  }
}
