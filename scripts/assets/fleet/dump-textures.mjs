#!/usr/bin/env node
/** Dump every texture of a GLB to <outdir>/<index>.<ext>: node dump-textures.mjs file.glb outdir */
import fs from 'node:fs';
import path from 'node:path';
import { makeIO } from './tools.mjs';
const [file, out] = process.argv.slice(2);
const io = await makeIO();
const doc = await io.read(file);
fs.mkdirSync(out, { recursive: true });
doc.getRoot().listTextures().forEach((t, i) => {
  const e = (t.getMimeType() || 'image/png').split('/')[1];
  fs.writeFileSync(path.join(out, `${i}.${e === 'jpeg' ? 'jpg' : e}`), t.getImage());
});
console.log('dumped', doc.getRoot().listTextures().length);
