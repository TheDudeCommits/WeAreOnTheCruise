#!/usr/bin/env node
/** Contact sheet of public/assets/icons/*.png on dark + checker backgrounds at 96 px and 48 px: node icon-sheet.mjs out.png [ids...] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharp } from '../fleet/tools.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '..', '..', '..', 'public', 'assets', 'icons');
const [out, ...want] = process.argv.slice(2);
const ids = want.length ? want : fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
const cols = 8, cw = 230, chh = 150;
const rows = Math.ceil(ids.length / cols);
const comps = [];
const checker = await sharp(Buffer.from(`<svg width="96" height="96"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#bbb"/><rect x="8" y="8" width="8" height="8" fill="#bbb"/><rect x="8" width="8" height="8" fill="#fff"/><rect y="8" width="8" height="8" fill="#fff"/></pattern></defs><rect width="96" height="96" fill="url(#p)"/></svg>`)).png().toBuffer();
for (let i = 0; i < ids.length; i++) {
  const x = (i % cols) * cw, y = Math.floor(i / cols) * chh;
  const src = path.join(dir, ids[i] + '.png');
  const i96 = await sharp(src).resize(96, 96).png().toBuffer();
  const i48 = await sharp(src).resize(48, 48).png().toBuffer();
  comps.push({ input: await sharp({ create: { width: 96, height: 96, channels: 4, background: '#1d2733' } }).png().toBuffer(), left: x + 4, top: y + 4 });
  comps.push({ input: i96, left: x + 4, top: y + 4 });
  comps.push({ input: checker, left: x + 104, top: y + 4 });
  comps.push({ input: i96, left: x + 104, top: y + 4 });
  comps.push({ input: i48, left: x + 204 - 24, top: y + 104 - 48 });
  comps.push({ input: Buffer.from(`<svg width="${cw}" height="30"><text x="4" y="20" font-family="Helvetica" font-size="15" fill="#fff">${ids[i]}</text></svg>`), left: x, top: y + 110 });
}
await sharp({ create: { width: cols * cw, height: rows * chh, channels: 4, background: '#0e141b' } }).composite(comps).png().toFile(out);
console.log('wrote', out, ids.length);
