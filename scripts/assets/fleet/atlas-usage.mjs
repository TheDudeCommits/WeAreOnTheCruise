#!/usr/bin/env node
/** For palette-atlas models (Quaternius), list which atlas colours each mesh uses with vertex count and mean height. */
import { makeIO } from './tools.mjs';
import * as L from './lib.mjs';
const io = await makeIO();
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  console.log(`== ${file.split('/').pop()}`);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) {
      const tex = prim.getMaterial()?.getBaseColorTexture(); if (!tex) continue;
      const img = await L.decode(tex);
      const uv = prim.getAttribute('TEXCOORD_0'), pos = prim.getAttribute('POSITION');
      const stats = new Map(); const u = [0, 0], p = [0, 0, 0];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, u); pos.getElement(i, p);
        const x = Math.min(img.w - 1, Math.floor(u[0] * img.w)), y = Math.min(img.h - 1, Math.floor(u[1] * img.h)); const o = (y * img.w + x) * 4;
        const hex = '#' + [img.px[o], img.px[o + 1], img.px[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        const s = stats.get(hex) || { n: 0, y: 0, ymin: 1e9, ymax: -1e9 }; s.n++; s.y += p[1]; s.ymin = Math.min(s.ymin, p[1]); s.ymax = Math.max(s.ymax, p[1]); stats.set(hex, s);
      }
      console.log(`  ${node.getName()}${node.getSkin() ? ' (skinned)' : ''}`);
      for (const [hex, s] of [...stats.entries()].sort((a, b) => b[1].y / b[1].n - a[1].y / a[1].n)) console.log(`    ${hex}  n=${String(s.n).padStart(5)}  y=${(s.y / s.n).toFixed(2)} [${s.ymin.toFixed(2)}..${s.ymax.toFixed(2)}]`);
    }
  }
}
