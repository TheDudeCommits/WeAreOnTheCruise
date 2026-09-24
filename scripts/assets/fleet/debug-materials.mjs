#!/usr/bin/env node
/** Write a copy of a GLB where every material gets a distinct flat debug colour; prints the legend. node debug-materials.mjs in.glb out.glb */
import { makeIO, fn } from './tools.mjs';
const [inp, out] = process.argv.slice(2);
const io = await makeIO();
const doc = await io.read(inp);
const mats = doc.getRoot().listMaterials();
const hsl = (h) => { const f = (n) => { const k = (n + h / 30) % 12; return 0.5 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
mats.forEach((m, i) => {
  const c = hsl((i * 137.5) % 360);
  const lin = c.map((v) => Math.pow(v, 2.2));
  m.setBaseColorTexture(null).setBaseColorFactor([...lin, 1]).setEmissiveTexture(null).setAlphaMode('OPAQUE');
  console.log(`mat${i} ${m.getName()} -> rgb(${c.map((v) => Math.round(v * 255)).join(',')})`);
});
await io.write(out, doc);
