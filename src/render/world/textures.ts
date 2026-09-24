/**
 * Procedural world textures (WORLD-owned), generated as DataTextures (no canvas, no files):
 *  - the Admiralty flag: white field, navy hoist, gold wave-crest medallion (original emblem);
 *  - waterfall streaks: soft-edged white/cyan falling strands with alpha, tiled vertically and scrolled.
 */
import * as THREE from 'three';
import { hash01, valueNoise } from '../../world/noise';

function toSrgbTexture(data: Uint8Array, w: number, h: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

let flag: THREE.DataTexture | null = null;

/** 128×80 Admiralty flag (u along the fly, v up). */
export function flagTexture(): THREE.DataTexture {
  if (flag) return flag;
  const w = 128, h = 80;
  const data = new Uint8Array(w * h * 4);
  const white = [246, 244, 236], navy = [30, 52, 104], gold = [226, 178, 74];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w;
    let c = white;
    if (u < 0.2) c = navy;
    else if (u > 0.2 && u < 0.24) c = gold;
    // Medallion centred at (0.6, 0.5) in pixel-aspect space.
    const px = (x - w * 0.6) / h, py = (y - h * 0.5) / h;
    const r = Math.hypot(px, py);
    if (r < 0.33) c = r > 0.27 ? gold : navy;
    if (r < 0.26) {
      // Stylised curling wave crest in gold.
      const wave = py - (-0.06 + 0.07 * Math.sin(px * 16 + 0.6));
      const curl = Math.hypot(px - 0.07, py - 0.03);
      if ((wave < 0 && wave > -0.07) || (curl < 0.09 && curl > 0.05 && px > 0.02)) c = gold;
      if (py < -0.13 && Math.abs(py + 0.17) < 0.025) c = gold;
    }
    const o = (y * w + x) * 4;
    data[o] = c[0]!; data[o + 1] = c[1]!; data[o + 2] = c[2]!; data[o + 3] = 255;
  }
  flag = toSrgbTexture(data, w, h);
  return flag;
}

/** Value noise periodic in y with `period` lattice cells (tileable textures). */
function periodicNoise(seed: number, x: number, y: number, period: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const y0 = ((yi % period) + period) % period, y1 = (y0 + 1) % period;
  const a = hash01(seed, xi, y0), b = hash01(seed, xi + 1, y0), c = hash01(seed, xi, y1), d = hash01(seed, xi + 1, y1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

let falls: THREE.DataTexture | null = null;

/** 64×256 waterfall strands (RGBA), tileable in V; scroll `offset.y` negative to fall. */
export function waterfallTexture(): THREE.DataTexture {
  if (falls) return falls;
  const w = 64, h = 256;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w;
    const edge = Math.min(1, Math.min(u, 1 - u) * 7);
    const strand = 0.5 + 0.5 * valueNoise(11, x * 0.35, 0.5);
    const streak = 0.5 + 0.5 * periodicNoise(29, x * 0.9, y / 32, h / 32);
    const gap = periodicNoise(37, x * 0.22, y / 64, h / 64) > 0.55 ? 0.55 : 1;
    const bright = 0.72 + 0.28 * streak;
    const o = (y * w + x) * 4;
    data[o] = Math.round(225 * bright + 30);
    data[o + 1] = Math.round(240 * bright + 15);
    data[o + 2] = 255;
    data[o + 3] = Math.round(255 * edge * (0.55 + 0.45 * strand) * gap);
  }
  falls = toSrgbTexture(data, w, h);
  falls.wrapS = THREE.ClampToEdgeWrapping;
  falls.wrapT = THREE.RepeatWrapping;
  return falls;
}
