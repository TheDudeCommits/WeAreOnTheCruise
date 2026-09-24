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
/** Mast, yard and a gently bulging square sail for the rowboat skiffs; half = 'emblem' | 'plain' part of the sail canvas. */
async function addSkiffRig(doc, sailName, half) {
  const mats = doc.getRoot().listMaterials();
  const wood = mats.find((x) => x.getName() === 'Metal');
  const acc = { positions: [], indices: [], uvs: [] };
  L.pushBox(acc, [-0.13, 0.2, -1.73], [0.13, 7.6, -1.47]);
  L.pushBox(acc, [-2.7, 6.9, -1.72], [2.7, 7.1, -1.52]);
  L.addGeometry(doc, { ...acc, material: wood, name: 'skiff-rig' });
  const sailMat = await makeSailMaterial(doc, sailName);
  const S = { positions: [], indices: [], uvs: [] };
  const cols = 4, rows = 3, x0 = -2.5, x1 = 2.5, y0 = 2.3, y1 = 6.85, zc = -1.8, bulge = 0.45, u0 = half === 'plain' ? 0.51 : 0.01;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const u = c / cols, v = r / rows; const x = x0 + (x1 - x0) * u, y = y1 - (y1 - y0) * v;
    const z = zc - bulge * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.1));
    S.positions.push(x, y, z); S.uvs.push(u0 + u * 0.48, 0.01 + v * 0.98);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; S.indices.push(a, d, b, b, d, e, a, b, d, b, e, d); }
  L.addGeometry(doc, { ...S, material: sailMat, name: 'skiff-sail' });
}

async function makeSailMaterial(doc, name) {
  const { sharp } = await import('./tools.mjs');
  const png = await sharp(Buffer.from(SVG(name))).resize(1024, 512, { fit: 'fill' }).png().toBuffer();
  const tex = doc.createTexture(`${name}-albedo`).setImage(new Uint8Array(png)).setMimeType('image/png').setURI(`${name}-albedo.png`);
  return doc.createMaterial(name).setBaseColorTexture(tex).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1);
}
const WHITE_RAMP = [[0, '#8a857d'], [0.12, '#cfcabe'], [0.3, '#ece7dc'], [1, '#fdfaf2']];
const NAVY_RAMP = [[0, '#0b1127'], [0.35, '#1a2750'], [0.7, '#27396e'], [1, '#4a5f98']];
async function rampOne(mat, stops) { const t = mat.getBaseColorTexture(); const f = L.ramp(stops); if (t) await L.editTexture(t, (r, g, b, a) => [...f(L.lum(r, g, b)), a]); }

/** Per-pixel HSL remap of a material's albedo texture. f(h,s,l,r,g,b) → [h,s,l] | null. */
export async function hslMaterial(mat, f) {
  const t = mat.getBaseColorTexture(); if (!t) return;
  await L.editTexture(t, (r, g, b, a) => { const [h, s, l] = L.rgb2hsl(r, g, b); const o = f(h, s, l, r, g, b); return o ? [...L.hsl2rgb(...o), a] : null; });
}

/** Swap flat swatch colours in every albedo texture of the document (palette atlases such as Quaternius'). */
export async function swapColors(doc, pairs, tol = 6) {
  for (const t of doc.getRoot().listTextures()) await remapPalette(t, pairs, tol);
}

/** Procedural flag: a wooden pole with a gold finial and a waving cloth using an emblem texture (flag faces ±X, flies toward +Z). */
export async function buildFlag({ doc }, emblem) {
  const wood = doc.createMaterial('flag-pole').setBaseColorFactor([...L.hex('#6b4a2e').map((v) => Math.pow(v / 255, 2.2)), 1]).setMetallicFactor(0).setRoughnessFactor(1);
  const gold = doc.createMaterial('flag-finial').setBaseColorFactor([...L.hex('#e2b23a').map((v) => Math.pow(v / 255, 2.2)), 1]).setMetallicFactor(0).setRoughnessFactor(1);
  const pole = { positions: [], indices: [] }; L.pushBox(pole, [-0.06, 0, -0.06], [0.06, 4.2, 0.06]);
  L.addGeometry(doc, { ...pole, material: wood, name: 'flag' });
  const fin = { positions: [], indices: [] }; L.pushBox(fin, [-0.12, 4.2, -0.12], [0.12, 4.44, 0.12]);
  L.addGeometry(doc, { ...fin, material: gold });
  const mat = await makeTexturedMaterial(doc, emblem, [256, 256]);
  const S = { positions: [], indices: [], uvs: [] }; const cols = 6, rows = 3, w = 2.4, h = 1.6, top = 4.1;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const u = c / cols, v = r / rows;
    S.positions.push(0.12 * Math.sin(u * Math.PI * 2.2) * u, top - h * v, 0.06 + w * u); S.uvs.push(u, v);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; S.indices.push(a, d, b, b, d, e, a, b, d, b, e, d); }
  L.addGeometry(doc, { ...S, material: mat });
}
async function makeTexturedMaterial(doc, name, size) {
  const { sharp } = await import('./tools.mjs');
  const png = await sharp(Buffer.from(SVG(name))).resize(size[0], size[1], { fit: 'fill' }).png().toBuffer();
  const tex = doc.createTexture(`${name}-albedo`).setImage(new Uint8Array(png)).setMimeType('image/png').setURI(`${name}-albedo.png`);
  return doc.createMaterial(name).setBaseColorTexture(tex).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(1);
}

export const RECOLOR = {
  /** Quaternius Henry → Admiralty deckhand: navy bandana and trousers, white vest and sleeves, gold buckle kept. */
  async admiraltySailor({ doc }) {
    await swapColors(doc, [['#8c1e20', '#1d2b53'], ['#c8c8c8', '#f1eee6'], ['#45443b', '#f1eee6'], ['#84785e', '#e4e0d6'], ['#3b5d62', '#1d2b53'], ['#563c23', '#141d3b']], 2);
  },
  /** Quaternius Henry → second deckhand look: blue bandana, brown trousers. */
  async sailorC({ doc }) {
    await swapColors(doc, [['#8c1e20', '#2f6fb0'], ['#3b5d62', '#6b5a3a'], ['#45443b', '#7a2f2a']], 2);
  },

  /** Nik_kale "Stylized Pirate Ship" → Redtide fire ship: charred hull, ember-orange swirls, red sails. */
  async fireship({ doc }) {
    await L.sailify(doc, { name: 'redtide-sail', svg: SVG('redtide-sail'), select: (t, i) => i.texel && i.texel[0] > 150 && i.texel[2] > 130 && i.texel[1] < i.texel[0] - 12 && t.centroid[1] > 3 });
    await L.sailify(doc, { name: 'redtide-flag', svg: SVG('redtide-flag'), layout: 'full', texSize: [256, 256], select: (t, i) => t.centroid[1] > 18.2 && i.texel && Math.max(...i.texel) > 90 });
    const m = doc.getRoot().listMaterials().find((x) => x.getName() === 'material_0');
    await hslMaterial(m, (h, s, l) => {
      if (h > 190 && h < 260 && s > 0.25) return [26, 0.95, Math.min(0.62, l + 0.12)]; // blue swirls -> ember orange
      if (h > 280 || h < 12) return null; // pink/red bits stay
      return [18, s * 0.35, l * 0.42]; // wood -> charred
    });
  },

  /** local.yany "Boat" → player escort skiff: original blue/amber paint kept, mast and plain cream sail added. */
  async escortSkiff(ctx) { await addSkiffRig(ctx.doc, 'admiralty-sail', 'plain'); },
  /** anagvf brig → neutral trader for the Treasure convoy: natural wood hull, russet-striped sails with a coin mark. */
  async merchant({ doc }) {
    await L.sailify(doc, { name: 'merchant-sail', svg: SVG('merchant-sail'), select: (t, i) => i.texel && Math.min(...i.texel) > 150 && t.centroid[1] > 4 });
  },

  /** local.yany "Boat" → Redtide raider skiff: black-stained hull, red gunwale, plus a small mast and red square sail. */
  async raiderSkiff({ doc }) {
    const mats = doc.getRoot().listMaterials();
    await hslMaterial(mats.find((x) => x.getName() === 'Planks'), (h, s, l) => [230, 0.08, l * 0.32]);
    await hslMaterial(mats.find((x) => x.getName() === 'Wood'), (h, s, l) => [2, 0.72, l * 0.62]);
    await addSkiffRig(doc, 'redtide-sail', 'emblem');
  },

  /** Sololopenko "Ghost ship" → Gloam Wraith: spectral teal hull, torn pale-teal sails, teal lantern glow. */
  async wraith({ doc }) {
    await L.sailify(doc, { name: 'wraith-sail', svg: SVG('wraith-sail'), select: (t, i) => i.texel && i.texel[2] > 140 && i.texel[0] > 90 && i.texel[1] < 110 && i.texel[2] > i.texel[1] + 40 });
    const mats = doc.getRoot().listMaterials();
    const main = mats.find((x) => x.getName() === 'main'), light = mats.find((x) => x.getName() === 'light');
    if (light) {
      const glow = L.cloneMaterial(doc, light, 'wraith-light');
      for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMaterial() === light) p.setMaterial(glow);
      await hslMaterial(glow, (h, s, l) => [172, 0.75, Math.max(0.55, l)]);
      glow.setEmissiveTexture(glow.getBaseColorTexture()).setEmissiveFactor([0.6, 1, 0.9]);
    }
    await hslMaterial(main, (h, s, l) => [168 + (h > 180 && h < 260 ? 6 : 0), Math.min(0.55, s * 0.55 + 0.08), Math.min(0.85, l * 0.8 + 0.04)]);
  },

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
