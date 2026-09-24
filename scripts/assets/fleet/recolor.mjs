/**
 * Faction recolour recipes (ASSETS). Each recipe runs after normalization (positions in metres, bow −Z, waterline y = 0).
 * Admiralty: white hulls, navy trim, white sails with the gold wave-crest. Redtide Corsairs: black hulls, red sails with
 * the black cutlass-and-sun. Gloam Wraiths: spectral teal, torn sails. Emblem artwork: ./emblems/*.svg (original).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SVG = (name) => fs.readFileSync(path.join(here, 'emblems', `${name}.svg`), 'utf8');

export const PALETTE = {
  navy: '#1d2b53', navyDeep: '#141d3b', white: '#f2efe6', gold: '#e2b23a', goldDeep: '#b8862a',
  red: '#b3201e', redDeep: '#6e1110', black: '#16171b', charcoal: '#2a2b30', teal: '#5fb3a8', tealDeep: '#1d4a47',
};

/** Recolour a whole material texture through a luminance ramp (keeps painted detail, swaps the hue family). */
export async function rampMaterial(doc, matName, stops, { mix = 1 } = {}) {
  const mats = doc.getRoot().listMaterials().filter((m) => (matName instanceof RegExp ? matName.test(m.getName()) : m.getName() === matName));
  const f = L.ramp(stops);
  for (const m of mats) {
    const t = m.getBaseColorTexture();
    if (!t) { const c = m.getBaseColorFactor(); const lin2s = (v) => Math.round(255 * Math.pow(v, 1 / 2.2)); const out = f(L.lum(lin2s(c[0]), lin2s(c[1]), lin2s(c[2]))); m.setBaseColorFactor([...out.map((v) => Math.pow(v / 255, 2.2)), c[3]]); continue; }
    await L.editTexture(t, (r, g, b, a) => { const o = f(L.lum(r, g, b)); return mix >= 1 ? [...o, a] : [r + (o[0] - r) * mix, g + (o[1] - g) * mix, b + (o[2] - b) * mix, a].map(Math.round); });
  }
  return mats.length;
}

/** Set flat base colours (sRGB hex) on materials by name → colour map; drops their textures. */
export function flatColors(doc, map) {
  for (const m of doc.getRoot().listMaterials()) {
    const hexc = map[m.getName()]; if (!hexc) continue;
    const [r, g, b] = L.hex(hexc).map((v) => Math.pow(v / 255, 2.2));
    m.setBaseColorTexture(null).setBaseColorFactor([r, g, b, m.getBaseColorFactor()[3]]);
  }
}

/** Exact palette swaps on a (small) palette texture: pairs of sRGB hex, nearest match within `tol`. */
export async function remapPalette(tex, pairs, tol = 10) {
  const P = pairs.map(([a, b]) => [L.hex(a), L.hex(b)]);
  await L.editTexture(tex, (r, g, b, a) => {
    for (const [f, t] of P) if (Math.abs(r - f[0]) <= tol && Math.abs(g - f[1]) <= tol && Math.abs(b - f[2]) <= tol) return [...t, a];
    return null;
  });
}

export const RECOLOR = {
  /** Razer820 "Low Poly Sloop" → Admiralty cutter: white topsides, navy bottom, gold stripe, wave-crest sails. */
  async admiraltyCutter({ doc }) {
    const hull = doc.getRoot().listMaterials().find((m) => m.getName() === 'Boat_sketch_mat');
    await remapPalette(hull.getBaseColorTexture(), [
      ['#21a139', '#f2efe6'], ['#03640c', '#d6d1c4'], // green topsides -> white
      ['#fafa57', '#e8bd48'], ['#d5d513', '#b8862a'], // yellow stripe -> gold
      ['#9f6718', '#23346a'], ['#744808', '#1d2b53'], // brown bottom -> navy
      ['#e6be65', '#c29a68'], ['#ca9924', '#9c7548'], ['#f1ac35', '#b98d5a'], ['#bf7f0a', '#8a6540'], // yellow deck -> planking
    ]);
    await L.sailify(doc, { name: 'admiralty-sail', svg: SVG('admiralty-sail'), emblemMinShare: 0.6, select: (t, i) => i.material === 'Sail_main_sketch' });
  },

  /** olemuzyka "Pirate Ship" (flat colours) → Redtide galleon: black hull, red trim, red cutlass-and-sun sails. */
  async corsairGalleon({ doc }) {
    await L.sailify(doc, { name: 'redtide-sail', svg: SVG('redtide-sail'), select: (t, i) => i.material === 'Sail' });
    flatColors(doc, {
      Main: '#1e1f24', 'Mat.1_1': '#141417', 'Mat.1': '#7a5534', 'Mat.3': '#8e1b19', 'Mat.7': '#f0a040', material_0: '#6b5a44',
      Polygon_Reduction_1__0: '#131316', 'Mat.2': '#131316', 'Mat.5': '#3a3a3f', 'Mat.6': '#23304f', material: '#3b2a1a',
    });
  },

  /** c3posw01 "Stylized Pirate Ship" → Redtide brig: black hull, dark rails, red cutlass-and-sun sails and black flags. */
  async corsairBrig({ doc }) {
    await L.sailify(doc, { name: 'redtide-sail', svg: SVG('redtide-sail'), select: (t, i) => /Sail(Back|Mid|Front)/.test(i.mesh) });
    await L.sailify(doc, { name: 'redtide-flag', svg: SVG('redtide-flag'), layout: 'full', texSize: [256, 256], select: (t, i) => /Flag/.test(i.mesh) });
    await rampMaterial(doc, 'Mat_StylShip_ShipHull', [[0, '#0b0c0f'], [0.3, '#1b1d22'], [0.65, '#34373e'], [1, '#686c75']]);
    await rampMaterial(doc, 'Mat_StylShip_Elements', [[0, '#120e0d'], [0.45, '#3a2721'], [0.8, '#7b3a2c'], [1, '#b0725a']]);
  },
};
