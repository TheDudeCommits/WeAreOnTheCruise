#!/usr/bin/env node
/**
 * Slice generated 4×4 icon sheets (flat white background, thick dark outlines) into 256×256 transparent PNGs.
 *
 *   node scripts/assets/icons/slice-icons.mjs <sheet-dir> [--only id,id]
 *
 * <sheet-dir> holds icons-a.png … icons-d.png (the 2048² Higgsfield outputs; small JPG copies are kept in
 * assets/concepts/icon-sheet-*.jpg for reference). The cell → id mapping lives in ./icon-map.json.
 * Background removal: flood fill from the cell border through near-white / light-grey unsaturated pixels
 * (so white highlights inside the thick outline stay opaque), then remove large flat pure-white enclosed
 * holes (gaps between wheel spokes etc.), then un-premultiply the anti-aliased rim against white.
 * Needs sharp from CRUISE_ASSET_TOOLS (see scripts/assets/fleet/tools.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharp } from '../fleet/tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const [sheetDir, ...rest] = process.argv.slice(2);
const only = rest[0] === '--only' ? new Set(rest[1].split(',')) : null;
const map = JSON.parse(fs.readFileSync(path.join(here, 'icon-map.json'), 'utf8'));
const OUT = path.join(repo, 'public', 'assets', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const isBg = (r, g, b) => Math.min(r, g, b) >= 168 && Math.max(r, g, b) - Math.min(r, g, b) <= 22;
const isPureWhite = (r, g, b) => r >= 247 && g >= 247 && b >= 247;

for (const [sheet, ids] of Object.entries(map.sheets)) {
  const file = path.join(sheetDir, `${sheet}.png`);
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, cw = W / 4, ch = H / 4, inset = Math.round(cw * 0.03);
  for (let cell = 0; cell < 16; cell++) {
    const id = ids[cell];
    if (!id || (only && !only.has(id))) continue;
    const x0 = Math.round((cell % 4) * cw) + inset, y0 = Math.round(Math.floor(cell / 4) * ch) + inset;
    const w = Math.round(cw) - 2 * inset, h = Math.round(ch) - 2 * inset;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * W + (x0 + x)) * 3, d = (y * w + x) * 3;
      rgb[d] = data[s]; rgb[d + 1] = data[s + 1]; rgb[d + 2] = data[s + 2];
    }
    const bg = new Uint8Array(w * h); // 1 = background
    const stack = [];
    const push = (x, y) => { const i = y * w + x; if (bg[i]) return; const d = i * 3; if (!isBg(rgb[d], rgb[d + 1], rgb[d + 2])) return; bg[i] = 1; stack.push(i); };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) { const i = stack.pop(); const x = i % w, y = (i / w) | 0; if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1); }
    // enclosed flat pure-white holes (area >= 0.25% of the cell) are background too
    const seen = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (bg[i] || seen[i]) continue; const d = i * 3; if (!isPureWhite(rgb[d], rgb[d + 1], rgb[d + 2])) continue;
      const region = []; const st = [i]; seen[i] = 1;
      while (st.length) { const j = st.pop(); region.push(j); const x = j % w, y = (j / w) | 0; for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (seen[k] || bg[k]) continue; const e = k * 3; if (!isPureWhite(rgb[e], rgb[e + 1], rgb[e + 2])) continue; seen[k] = 1; st.push(k); } }
      if (region.length < w * h * 0.0025 || (map.keepHoles || []).indexOf(id) >= 0) continue;
      // a real hole (background seen through the object) is ringed by the dark outline; a white highlight is not
      const inRegion = new Uint8Array(w * h); for (const j of region) inRegion[j] = 1;
      let samples = 0, outlined = 0;
      for (const j of region) {
        const x = j % w, y = (j / w) | 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h || inRegion[ny * w + nx]) continue;
          samples++;
          for (let k = 1; k <= 6; k++) { const px = x + dx * k, py = y + dy * k; if (px < 0 || py < 0 || px >= w || py >= h) break; const e = (py * w + px) * 3; if (0.3 * rgb[e] + 0.59 * rgb[e + 1] + 0.11 * rgb[e + 2] < 95) { outlined++; break; } }
        }
      }
      if ((samples && outlined / samples > 0.72) || (map.forceHoles || []).includes(id)) for (const j of region) bg[j] = 1;
    }
    // distance-to-background (up to 3 px) for rim un-premultiply
    const rgba = new Uint8Array(w * h * 4);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, d = i * 3, o = i * 4;
      if (bg[i]) { rgba[o + 3] = 0; continue; }
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) { near = true; break; } }
      let r = rgb[d], g = rgb[d + 1], b = rgb[d + 2], a = 255;
      if (near) { // colour-to-alpha against white on the anti-aliased rim
        const al = Math.max(255 - r, 255 - g, 255 - b) / 255;
        const alpha = Math.min(1, al * 1.15);
        if (alpha < 0.04) { rgba[o + 3] = 0; continue; }
        r = Math.max(0, Math.min(255, Math.round((r - (1 - alpha) * 255) / alpha)));
        g = Math.max(0, Math.min(255, Math.round((g - (1 - alpha) * 255) / alpha)));
        b = Math.max(0, Math.min(255, Math.round((b - (1 - alpha) * 255) / alpha)));
        a = Math.round(alpha * 255);
      }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      if (a > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) { console.warn(`${id}: empty cell`); continue; }
    const bw = maxX - minX + 1, bh = maxY - minY + 1, side = Math.round(Math.max(bw, bh) * 1.1);
    const cropped = await sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: minX, top: minY, width: bw, height: bh }).png().toBuffer();
    const out = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cropped, left: Math.round((side - bw) / 2), top: Math.round((side - bh) / 2) }])
      .png().toBuffer();
    await sharp(out).resize(256, 256, { kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10, dither: 0.6 }).toFile(path.join(OUT, `${id}.png`));
    console.log(`${id}  <- ${sheet}[${cell}]  bbox ${bw}x${bh}`);
  }
}
