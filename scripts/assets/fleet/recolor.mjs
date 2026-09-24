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

/**
 * Paint a textured wooden hull in Admiralty colours: side-facing triangles below `deckY` get a white-painted copy of the
 * texture, the band below `navyTop` a navy copy. Deck (up-facing) and rigging keep the source wood.
 */
export async function paintHull(doc, { material, deckY, navyTop, minSide = 0.35, white = WHITE_RAMP, navy = NAVY_RAMP, filter = null }) {
  const src = doc.getRoot().listMaterials().find((m) => m.getName() === material);
  if (!src) throw new Error(`paintHull: no material ${material}`);
  const W = L.cloneMaterial(doc, src, `${material}-admiralty-white`), N = L.cloneMaterial(doc, src, `${material}-admiralty-navy`);
  await rampOne(W, white); await rampOne(N, navy);
  let moved = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of [...mesh.listPrimitives()]) {
    if (prim.getMaterial() !== src) continue;
    moved += L.splitPrimitive(doc, mesh, prim, (t) => t.centroid[1] < navyTop && Math.abs(t.normal[1]) < 0.9 && (!filter || filter(t)), N);
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of [...mesh.listPrimitives()]) {
    if (prim.getMaterial() !== src) continue;
    moved += L.splitPrimitive(doc, mesh, prim, (t) => t.centroid[1] < deckY && Math.hypot(t.normal[0], t.normal[2]) > minSide && (!filter || filter(t)), W);
  }
  return moved;
}
const WHITE_RAMP = [[0, '#8a857d'], [0.12, '#cfcabe'], [0.3, '#ece7dc'], [1, '#fdfaf2']];
const NAVY_RAMP = [[0, '#0b1127'], [0.35, '#1a2750'], [0.7, '#27396e'], [1, '#4a5f98']];
async function rampOne(mat, stops) { const t = mat.getBaseColorTexture(); const f = L.ramp(stops); if (t) await L.editTexture(t, (r, g, b, a) => [...f(L.lum(r, g, b)), a]); }

export const RECOLOR = {
  /** Greggory_Fisher "Low-Poly Pirate Ship" (flat colours) → Admiralty frigate: white upper hull, navy lower hull, gold trim. */
  async admiraltyFrigate({ doc }) {
    await L.sailify(doc, { name: 'admiralty-sail', svg: SVG('admiralty-sail'), select: (t, i) => /M_Sail_0[12]/.test(i.material) });
    await L.sailify(doc, { name: 'admiralty-flag', svg: SVG('admiralty-flag'), layout: 'full', texSize: [256, 256], select: (t, i) => i.material === 'M_Flag_02' });
    flatColors(doc, {
      M_Wood_Maroon: '#f2efe6', M_Wood_Dark: '#1d2b53', M_Wood_Light: '#8a6a48', M_Gold_Dark: '#e2b23a', M_Gold_Light: '#f0c85a',
      M_Metal_Dark: '#2e3036', M_Metal_Light: '#6d7079', M_Rope: '#8c7a5b', M_Window: '#2b3d63', M_Shadows: '#141414',
      MI_Base_Wood_Dark: '#4a3526', M_Barrel_Wood_1: '#7a5433', M_Barrel_Wood_2: '#5e3f26', M_Cannon_01: '#1e1f23', M_Cannon_02: '#2c2d33',
      M_Cannon_Wood_01: '#6b4a2e', M_Cannon_Wood_02: '#57391f',
    });
  },

  /** anagvf "Pirate Ship (Low Poly)" → Admiralty brig: white topsides, navy bottom band, wave-crest sails. */
  async admiraltyBrig({ doc }) {
    await L.sailify(doc, { name: 'admiralty-sail', svg: SVG('admiralty-sail'), select: (t, i) => i.texel && Math.min(...i.texel) > 150 && t.centroid[1] > 4 });
    await paintHull(doc, { material: 'Scene_-_Root', deckY: 7.5, navyTop: 0.6, filter: (t) => !(Math.abs(t.centroid[0]) < 1.3 && Math.abs(t.centroid[2]) < 11) });
  },

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
