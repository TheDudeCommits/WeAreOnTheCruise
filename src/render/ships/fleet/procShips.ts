/**
 * Procedural ships (SHIPS-owned): lofted toon hulls with painted bands, bulwarks, decks, castles, gunports, masts,
 * billowed sails (atlas liveries with original emblems), jibs, flags and class extras. Every class is built as a fore
 * and an aft half (split at `splitZ`) so big ships can break in two while sinking; intact halves meet seamlessly.
 * Output geometry is in metres, bow −Z, waterline y = 0, and uses the shared fleet atlas + vertex colours.
 */
import * as THREE from 'three';
import { atlasUV, type AtlasRegion } from '../atlas';
import { GeoBuilder, WHITE_UV } from '../geometry/GeoBuilder';
import { PALETTE } from '../geometry/parts';

export interface HullSpec {
  length: number; beam: number; freeboard: number; draft: number;
  bowRise: number; sternRise: number;
  /** How quickly the hull widens from the stem (0.2 sharp … 0.5 bluff). */
  bowFullness: number;
  /** Transom half-width as a fraction of the beam. */
  sternWidth: number;
  rail: number;
  /** Barges: boxy sections. */
  boxy?: boolean;
  /** Open boats: no deck plating, thin bulwark. */
  open?: boolean;
}

export interface Livery { hull: number; bottom: number; stripe: number; trim: number; deck: number; wale?: number }

export interface MastSpec {
  /** Position along the hull as a fraction (−0.5 bow … 0.5 stern). */
  z: number;
  height: number;
  tiers: number;
  width: number;
  rig: 'square' | 'gaff' | 'lateen';
  sail: AtlasRegion;
  plain: AtlasRegion;
  flag?: AtlasRegion;
  nest?: boolean;
}

export interface ShipSpec {
  hull: HullSpec;
  livery: Livery;
  masts: MastSpec[];
  /** Raised stern castle: fraction of the length it covers and its height. */
  castle?: { from: number; height: number; windows?: boolean; gold?: boolean };
  forecastle?: { to: number; height: number };
  gunports?: { rows: number; perSide: number; from: number; to: number; barrels: boolean };
  bowsprit?: number;
  jib?: AtlasRegion;
  /** Hull split point (metres from centre, + aft). */
  splitZ?: number;
  extras?: (fore: GeoBuilder, aft: GeoBuilder, glow: GeoBuilder, spec: ShipSpec, hull: HullShape) => void;
}

export interface BuiltShip {
  fore: THREE.BufferGeometry;
  aft: THREE.BufferGeometry;
  /** Emissive bits (lantern glass, stern windows, fire, spectral lights) — may be empty. */
  glow: THREE.BufferGeometry | null;
  length: number;
  deckY: number;
  mastTop: number;
  splitZ: number;
  /** Local anchor points (bow, stern, port gun line, starboard gun line, mast top, deck). */
  anchors: Record<'bow' | 'stern' | 'port' | 'starboard' | 'mast' | 'deck', THREE.Vector3>;
}

/** Evaluable hull shape (used by extras to place things on the hull). */
export class HullShape {
  constructor(readonly spec: HullSpec) {}
  /** t: 0 bow → 1 stern. */
  t(z: number): number { return THREE.MathUtils.clamp(z / this.spec.length + 0.5, 0, 1); }
  halfWidth(t: number): number {
    const h = this.spec;
    const bow = Math.pow(Math.sin(Math.min(1, t / h.bowFullness) * Math.PI / 2), h.boxy ? 0.35 : 0.8);
    const sternT = THREE.MathUtils.smoothstep(t, 0.72, 1);
    const stern = 1 - sternT * (1 - h.sternWidth);
    return (h.beam / 2) * bow * stern;
  }
  deckY(t: number): number {
    const h = this.spec;
    const bow = Math.pow(Math.max(0, 1 - t / 0.3), 2) * h.bowRise;
    const stern = Math.pow(Math.max(0, (t - 0.7) / 0.3), 2) * h.sternRise;
    return h.freeboard + bow + stern;
  }
  keelY(t: number): number {
    const h = this.spec;
    const k = Math.pow(Math.sin(THREE.MathUtils.clamp(t * 1.08 - 0.02, 0, 1) * Math.PI), h.boxy ? 0.15 : 0.4);
    return -h.draft * Math.max(0.25, k);
  }
  /** Hull half-width at height y for station t (0 at the keel). */
  xAt(t: number, y: number): number {
    const ky = this.keelY(t), dy = this.deckY(t);
    const u = THREE.MathUtils.clamp((y - ky) / Math.max(0.01, dy - ky), 0, 1);
    const shape = this.spec.boxy ? Math.min(1, u * 5) : Math.pow(Math.sin(u * Math.PI / 2), 0.55);
    const tumble = 1 - 0.07 * THREE.MathUtils.smoothstep(u, 0.78, 1);
    return this.halfWidth(t) * shape * tumble;
  }
}

/** Appends a coloured strip between two height functions along stations (both sides). */
function hullBand(b: GeoBuilder, hull: HullShape, t0: number, t1: number, y0: (t: number) => number, y1: (t: number) => number, color: number, stations: number, outset = 0): void {
  for (const side of [1, -1] as const) {
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= stations; i++) {
      const t = t0 + ((t1 - t0) * i) / stations;
      const z = (t - 0.5) * hull.spec.length;
      const ya = y0(t), yb = y1(t);
      pos.push(side * (hull.xAt(t, ya) + outset), ya, z, side * (hull.xAt(t, yb) + outset), yb, z);
    }
    for (let i = 0; i < stations; i++) {
      const a = i * 2, c = (i + 1) * 2;
      if (side > 0) idx.push(a, a + 1, c, a + 1, c + 1, c); else idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
    b.raw(pos, idx, color);
  }
}

/** Builds one half (t0..t1) of the hull: bands, bulwark, deck, end caps. */
function buildHullHalf(b: GeoBuilder, spec: ShipSpec, hull: HullShape, t0: number, t1: number, isFore: boolean, isAft: boolean): void {
  const h = spec.hull, L = spec.livery;
  const n = Math.max(6, Math.round((t1 - t0) * 24));
  const wl = 0.0;
  const stripeLo = (t: number) => Math.max(wl + 0.6, hull.deckY(t) * 0.42);
  const stripeHi = (t: number) => Math.max(stripeLo(t) + 0.5, hull.deckY(t) * 0.7);
  const deck = (t: number) => hull.deckY(t);
  hullBand(b, hull, t0, t1, (t) => hull.keelY(t), () => -0.25, L.bottom, n);
  hullBand(b, hull, t0, t1, () => -0.25, () => wl + 0.25, L.wale ?? 0x1a1c22, n);
  hullBand(b, hull, t0, t1, () => wl + 0.25, stripeLo, L.hull, n);
  hullBand(b, hull, t0, t1, stripeLo, stripeHi, L.stripe, n);
  hullBand(b, hull, t0, t1, stripeHi, deck, L.hull, n);
  // Bulwark: outer face (hull colour), cap (trim colour), inner face (dark wood).
  const railT = h.open ? 0.12 : 0.28;
  for (const side of [1, -1] as const) {
    const ring: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const z = (t - 0.5) * h.length;
      const dy = deck(t), x = hull.xAt(t, dy);
      const xi = Math.max(0, x - railT);
      ring.push(side * x, dy, z, side * x * 0.995, dy + h.rail, z, side * xi, dy + h.rail, z, side * xi, dy, z);
    }
    const strip = (k: number, color: number) => {
      const pos: number[] = [], idx: number[] = [];
      for (let i = 0; i <= n; i++) pos.push(ring[i * 12 + k * 3]!, ring[i * 12 + k * 3 + 1]!, ring[i * 12 + k * 3 + 2]!, ring[i * 12 + (k + 1) * 3]!, ring[i * 12 + (k + 1) * 3 + 1]!, ring[i * 12 + (k + 1) * 3 + 2]!);
      for (let i = 0; i < n; i++) {
        const a = i * 2, c = (i + 1) * 2;
        if (side > 0) idx.push(a, a + 1, c, a + 1, c + 1, c); else idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
      b.raw(pos, idx, color);
    };
    strip(0, L.hull);
    strip(1, L.trim);
    strip(2, 0x6b4a30);
  }
  // Deck (planks texture).
  {
    const pos: number[] = [], idx: number[] = [], uvs: number[] = [];
    const [u0, v0, u1, v1] = atlasUV('planks');
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      const z = (t - 0.5) * h.length;
      const dy = deck(t) - (h.open ? h.freeboard * 0.55 : 0);
      const x = Math.max(0, hull.xAt(t, deck(t)) - railT);
      pos.push(-x, dy, z, x, dy, z);
      const v = v0 + (v1 - v0) * ((z / h.length + 0.5) % 1);
      uvs.push(u0, v, u1, v);
    }
    for (let i = 0; i < n; i++) { const a = i * 2, c = (i + 1) * 2; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    b.raw(pos, idx, L.deck, uvs, pos.map((_, k) => (k % 3 === 1 ? 1 : 0)));
  }
  // End caps: transom (aft end) and break faces.
  const capAt = (t: number, facing: 1 | -1, color: number, jagged: boolean) => {
    const z = (t - 0.5) * h.length;
    const ys = [hull.keelY(t), -0.25, 0.25, hull.deckY(t) * 0.42, hull.deckY(t) * 0.7, hull.deckY(t)];
    const pos: number[] = [0, (hull.keelY(t) + hull.deckY(t)) / 2, z];
    for (const y of ys) pos.push(hull.xAt(t, y), y, z);
    for (let k = ys.length - 1; k >= 0; k--) pos.push(-hull.xAt(t, ys[k]!), ys[k]!, z);
    if (jagged) for (let k = 1; k < pos.length / 3; k++) pos[k * 3 + 2]! += (k % 2 ? 0.6 : -0.4) * facing;
    const idx: number[] = [];
    const m = pos.length / 3 - 1;
    for (let k = 1; k <= m; k++) {
      const a = k, c = k === m ? 1 : k + 1;
      if (facing > 0) idx.push(0, a, c); else idx.push(0, c, a);
    }
    b.raw(pos, idx, color);
  };
  // Transom at the stern; splintered break faces where the hull splits (hidden while the halves touch).
  if (t1 >= 0.999) capAt(1, 1, L.hull, false); else capAt(t1, 1, 0x3a2414, true);
  if (t0 > 0.001) capAt(t0, -1, 0x3a2414, true);
  void isFore; void isAft;
}

function billowedSail(b: GeoBuilder, width: number, height: number, bulge: number, region: AtlasRegion, at: THREE.Vector3, yaw = 0, taper = 0.12): void {
  const sx = 6, sy = 4;
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  const [u0, v0, u1, v1] = atlasUV(region);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j <= sy; j++) {
    for (let i = 0; i <= sx; i++) {
      const u = i / sx, v = j / sy;
      const w = width * (1 - taper * v);
      const lx = (u - 0.5) * w;
      const ly = -v * height;
      const lz = -Math.sin(u * Math.PI) * Math.sin((v * 0.85 + 0.1) * Math.PI) * bulge;
      pos.push(at.x + lx * c + lz * s, at.y + ly, at.z - lx * s + lz * c);
      uvs.push(u0 + (u1 - u0) * u, v1 - (v1 - v0) * v);
    }
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, bb = a + 1, d = a + sx + 1, e = d + 1;
    idx.push(a, d, bb, bb, d, e);
  }
  b.raw(pos, idx, 0xffffff, uvs);
}

/** Fore-and-aft sail (gaff/lateen) in the YZ plane, billowed toward +X. */
function foreAftSail(b: GeoBuilder, pts: [number, number][], x: number, bulge: number, region: AtlasRegion): void {
  // pts: [z, y] for luff-bottom, luff-top, leech-top, leech-bottom (quad; last two may coincide for a triangle).
  const [u0, v0, u1, v1] = atlasUV(region);
  const sx = 4, sy = 4;
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  const [p0, p1, p2, p3] = pts as [[number, number], [number, number], [number, number], [number, number]];
  for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
    const u = i / sx, v = j / sy;
    const zb = p0[0] + (p3[0] - p0[0]) * u, yb = p0[1] + (p3[1] - p0[1]) * u;
    const zt = p1[0] + (p2[0] - p1[0]) * u, yt = p1[1] + (p2[1] - p1[1]) * u;
    const z = zb + (zt - zb) * v, y = yb + (yt - yb) * v;
    pos.push(x + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * bulge, y, z);
    uvs.push(u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
  }
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const a = j * (sx + 1) + i, bb = a + 1, d = a + sx + 1, e = d + 1;
    idx.push(a, bb, d, bb, e, d);
  }
  b.raw(pos, idx, 0xffffff, uvs);
}

function flagQuad(b: GeoBuilder, at: THREE.Vector3, w: number, h: number, region: AtlasRegion): void {
  const [u0, v0, u1, v1] = atlasUV(region);
  const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
  const sx = 4;
  for (let i = 0; i <= sx; i++) {
    const u = i / sx;
    const bend = Math.sin(u * Math.PI * 1.5) * w * 0.08;
    pos.push(at.x + bend, at.y, at.z + u * w, at.x + bend, at.y - h, at.z + u * w);
    uvs.push(u0 + (u1 - u0) * u, v1, u0 + (u1 - u0) * u, v0);
  }
  for (let i = 0; i < sx; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  b.raw(pos, idx, 0xffffff, uvs);
}

function buildMast(b: GeoBuilder, spec: ShipSpec, hull: HullShape, m: MastSpec): number {
  const L = spec.hull.length;
  const z = m.z * L;
  const t = hull.t(z);
  const base = hull.deckY(t);
  const top = base + m.height;
  const r = Math.max(0.18, L * 0.0075);
  b.cylinder(r * 0.65, r, m.height + 0.6, 8, { at: [0, base + m.height / 2 - 0.3, z], color: 0x6b4526 });
  if (m.nest) b.cylinder(r * 3.2, r * 2.6, 0.7, 10, { at: [0, base + m.height * 0.68, z], color: 0x5a3a20 });
  if (m.rig === 'square') {
    // Tier 0 is the course (lowest, widest, carries the emblem); upper tiers narrow toward the top.
    const bottom = base + 2.4, span = top - 1.0 - bottom;
    const tierH = span / m.tiers;
    for (let i = 0; i < m.tiers; i++) {
      const yardY = bottom + tierH * (i + 1);
      const w = m.width * (1 - 0.2 * i);
      b.cylinder(r * 0.45, r * 0.45, w * 1.08, 6, { at: [0, yardY, z], rot: [0, 0, Math.PI / 2], color: 0x5a3a20 });
      billowedSail(b, w, tierH * 0.93, w * 0.13, i === 0 ? m.sail : m.plain, new THREE.Vector3(0, yardY, z - r * 1.2));
    }
  } else if (m.rig === 'gaff') {
    const boomY = base + 1.8, gaffY = top - m.height * 0.12;
    const len = m.width;
    b.cylinder(r * 0.4, r * 0.4, len, 6, { at: [0, boomY, z + len / 2], rot: [Math.PI / 2, 0, 0], color: 0x5a3a20 });
    b.cylinder(r * 0.35, r * 0.35, len * 0.8, 6, { at: [0, gaffY + len * 0.15, z + len * 0.38], rot: [Math.PI / 2 - 0.35, 0, 0], color: 0x5a3a20 });
    foreAftSail(b, [[z + 0.3, boomY + 0.2], [z + 0.3, gaffY], [z + len * 0.78, gaffY + len * 0.28], [z + len, boomY + 0.2]], 0, len * 0.08, m.sail);
  } else {
    // Lateen: long slanted yard, triangular sail.
    const len = m.width;
    const y0 = base + 1.4, y1 = top;
    b.cylinder(r * 0.35, r * 0.35, len * 1.1, 6, { at: [0, (y0 + y1) / 2, z + len * 0.12], rot: [Math.PI / 2 - 0.95, 0, 0], color: 0x5a3a20 });
    foreAftSail(b, [[z - len * 0.25, y0], [z + len * 0.05, y1], [z + len * 0.05, y1], [z + len * 0.6, y0 + 0.4]], 0.2, len * 0.1, m.sail);
  }
  if (m.flag) flagQuad(b, new THREE.Vector3(0, top + 1.6, z), Math.max(1.8, L * 0.07), Math.max(1.1, L * 0.045), m.flag);
  b.cylinder(r * 0.3, r * 0.3, 1.8, 5, { at: [0, top + 0.9, z], color: 0x5a3a20 });
  return top + 1.6;
}

/** Builds a ship class. */
export function buildShip(spec: ShipSpec): BuiltShip {
  const hull = new HullShape(spec.hull);
  const L = spec.hull.length;
  const splitZ = spec.splitZ ?? 0;
  const splitT = hull.t(splitZ);
  const fore = new GeoBuilder(), aft = new GeoBuilder(), glow = new GeoBuilder();
  buildHullHalf(fore, spec, hull, 0, splitT, true, false);
  buildHullHalf(aft, spec, hull, splitT, 1, false, true);
  const pick = (z: number) => (z < splitZ ? fore : aft);

  // Castles.
  if (spec.castle) {
    const c = spec.castle;
    const t0 = c.from, zs = (t0 - 0.5) * L, ze = L / 2 - 0.4;
    const dy = hull.deckY(t0);
    const w = hull.xAt((t0 + 1) / 2, hull.deckY((t0 + 1) / 2)) * 2 - 0.5;
    const len = ze - zs;
    const b = pick(zs + len / 2);
    const rim = c.gold ? PALETTE.gold : spec.livery.trim;
    b.box(w, c.height, len, { at: [0, dy + c.height / 2, zs + len / 2], color: spec.livery.hull });
    b.box(w * 0.99, 0.12, len * 0.99, { at: [0, dy + c.height + 0.01, zs + len / 2], color: spec.livery.deck, uvRect: atlasUV('planks') });
    b.box(w + 0.3, 0.3, 0.3, { at: [0, dy + c.height, zs], color: rim });
    b.box(0.3, 0.3, len + 0.3, { at: [w / 2, dy + c.height, zs + len / 2], color: rim });
    b.box(0.3, 0.3, len + 0.3, { at: [-w / 2, dy + c.height, zs + len / 2], color: rim });
    // Taffrail posts around the castle top.
    for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) b.box(0.18, 0.9, len, { at: [x, dy + c.height + 0.55, zs + len / 2], color: spec.livery.hull });
    b.box(w, 0.9, 0.18, { at: [0, dy + c.height + 0.55, zs + len - 0.1], color: spec.livery.hull });
    b.box(w, 0.9, 0.18, { at: [0, dy + c.height + 0.55, zs + 0.1], color: spec.livery.hull });
    if (c.windows) {
      const [u0, v0, u1, v1] = atlasUV('windows');
      const y = dy + c.height * 0.55;
      glow.raw([-w * 0.42, y - c.height * 0.22, ze + 0.02, w * 0.42, y - c.height * 0.22, ze + 0.02, w * 0.42, y + c.height * 0.22, ze + 0.02, -w * 0.42, y + c.height * 0.22, ze + 0.02], [0, 1, 2, 0, 2, 3], 0xffc861, [u0, v0, u1, v0, u1, v1, u0, v1], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
      aft.box(w * 0.95, c.height * 0.6, 0.2, { at: [0, y, ze - 0.05], color: c.gold ? PALETTE.gold : spec.livery.trim });
    }
  }
  if (spec.forecastle) {
    const f = spec.forecastle;
    const t1 = f.to, ze = (t1 - 0.5) * L, zs = -L / 2 + L * 0.06;
    const w = hull.xAt((t1 + 0.06) / 2 + 0.03, hull.deckY(t1)) * 2 - 0.6;
    fore.box(Math.max(1, w), f.height, ze - zs, { at: [0, hull.deckY(t1) + f.height / 2, (zs + ze) / 2], color: spec.livery.hull });
    fore.box(Math.max(1, w) + 0.3, 0.3, ze - zs + 0.2, { at: [0, hull.deckY(t1) + f.height, (zs + ze) / 2], color: spec.livery.trim });
  }
  // Gunports.
  if (spec.gunports) {
    const g = spec.gunports;
    for (let row = 0; row < g.rows; row++) {
      for (let i = 0; i < g.perSide; i++) {
        const z = (g.from + ((g.to - g.from) * (i + 0.5)) / g.perSide - 0.5) * L;
        const t = hull.t(z);
        const y = hull.deckY(t) * (0.42 + 0.28 * 0.5) - row * Math.max(1.2, spec.hull.freeboard * 0.3);
        const b = pick(z);
        for (const side of [1, -1] as const) {
          const x = hull.xAt(t, y);
          const port = Math.max(0.55, L * 0.018);
          b.box(0.2, port * 1.35, port * 1.35, { at: [side * (x - 0.02), y, z], color: spec.livery.trim });
          b.box(0.25, port, port, { at: [side * (x + 0.04), y, z], color: 0x0b0d12 });
          if (g.barrels) b.cylinder(port * 0.26, port * 0.3, port * 1.4, 7, { at: [side * (x + port * 0.6), y, z], rot: [0, 0, side * Math.PI / 2], color: 0x2b2d33 });
        }
      }
    }
  }
  // Bowsprit + jib.
  let mastTop = 0;
  if (spec.bowsprit) {
    const t = 0.02, dy = hull.deckY(t);
    const len = spec.bowsprit;
    fore.cylinder(0.14 + L * 0.004, 0.2 + L * 0.005, len, 6, { at: [0, dy + len * 0.18, -L / 2 - len * 0.35], rot: [Math.PI / 2 - 0.35, 0, 0], color: 0x6b4526 });
    const fm = spec.masts[0];
    if (spec.jib && fm) {
      const mz = fm.z * L, mtop = hull.deckY(hull.t(mz)) + fm.height * 0.8;
      foreAftSail(fore, [[-L / 2 - len * 0.62, dy + len * 0.36], [mz - 0.4, mtop], [mz - 0.4, mtop], [mz - 0.6, hull.deckY(hull.t(mz)) + 1.6]], 0, len * 0.06, spec.jib);
    }
  }
  for (const m of spec.masts) mastTop = Math.max(mastTop, buildMast(pick(m.z * L), spec, hull, m));
  spec.extras?.(fore, aft, glow, spec, hull);

  const deckY = hull.deckY(0.5);
  const gunY = hull.deckY(0.5) * 0.56;
  const built: BuiltShip = {
    fore: fore.build(), aft: aft.build(), glow: glow.vertexCount ? glow.build() : null,
    length: L, deckY, mastTop, splitZ,
    anchors: {
      bow: new THREE.Vector3(0, hull.deckY(0.05) + 0.8, -L / 2 + 0.5),
      stern: new THREE.Vector3(0, hull.deckY(0.95) + 0.8, L / 2 - 0.5),
      port: new THREE.Vector3(-hull.xAt(0.5, gunY) - 0.6, gunY, 0),
      starboard: new THREE.Vector3(hull.xAt(0.5, gunY) + 0.6, gunY, 0),
      mast: new THREE.Vector3(0, mastTop, (spec.masts[0]?.z ?? 0) * L),
      deck: new THREE.Vector3(0, deckY + 1, 0),
    },
  };
  void WHITE_UV;
  return built;
}

// ───────────────────────── Class specs ─────────────────────────

const ADM: Livery = { hull: 0xeef1f4, bottom: 0x8c5334, stripe: 0x1f3566, trim: 0xd8a441, deck: 0xd9b88a, wale: 0x1a2440 };
const COR: Livery = { hull: 0x25201f, bottom: 0x5a1c16, stripe: 0xa3262a, trim: 0x7a2a1c, deck: 0xb58a5a, wale: 0x0f0d0d };
const WRA: Livery = { hull: 0x3f8f86, bottom: 0x1e4d4a, stripe: 0x7fe0cf, trim: 0x2a615c, deck: 0x4a8a80, wale: 0x173c3a };
const FIRE: Livery = { hull: 0x2a2220, bottom: 0x3a1a14, stripe: 0x6a1a14, trim: 0x3a2018, deck: 0x4a3326, wale: 0x100c0b };

export type ProcKey =
  | 'skiff' | 'sloop' | 'brig' | 'fireship' | 'mortar-barge' | 'frigate' | 'man-o-war' | 'corsair-brig' | 'corsair-galleon' | 'wraith' | 'fort'
  | 'dreadnought' | 'sovereign' | 'escort-skiff';

export function shipSpec(key: ProcKey, accent = 0xf5a524): ShipSpec | null {
  switch (key) {
    case 'skiff': return {
      hull: { length: 12, beam: 3.6, freeboard: 1.0, draft: 0.8, bowRise: 0.6, sternRise: 0.2, bowFullness: 0.32, sternWidth: 0.55, rail: 0.35, open: true },
      livery: COR, masts: [{ z: -0.08, height: 7, tiers: 1, width: 6.5, rig: 'lateen', sail: 'corsairSail', plain: 'corsairPlain', flag: 'corsairFlag' }],
      extras: (fore) => { fore.cylinder(0.16, 0.2, 1.3, 7, { at: [0, 1.5, -4.6], rot: [Math.PI / 2 - 0.2, 0, 0], color: PALETTE.brass }); },
    };
    case 'escort-skiff': return {
      hull: { length: 12, beam: 3.6, freeboard: 1.0, draft: 0.8, bowRise: 0.6, sternRise: 0.2, bowFullness: 0.32, sternWidth: 0.55, rail: 0.35, open: true },
      livery: { hull: 0x7b4a2a, bottom: 0x3a2414, stripe: accent, trim: 0xd8a441, deck: 0xc99a62, wale: 0x1b1410 },
      masts: [{ z: -0.08, height: 7, tiers: 1, width: 6.5, rig: 'lateen', sail: 'admiraltyPlain', plain: 'admiraltyPlain' }],
      extras: (fore) => { fore.cylinder(0.16, 0.2, 1.3, 7, { at: [0, 1.5, -4.6], rot: [Math.PI / 2 - 0.2, 0, 0], color: PALETTE.brass }); },
    };
    case 'sloop': return {
      hull: { length: 20, beam: 6, freeboard: 1.7, draft: 1.5, bowRise: 0.8, sternRise: 0.4, bowFullness: 0.3, sternWidth: 0.6, rail: 0.7 },
      livery: ADM, masts: [{ z: -0.1, height: 14, tiers: 1, width: 9, rig: 'gaff', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag' }],
      bowsprit: 5, jib: 'admiraltyPlain',
      gunports: { rows: 1, perSide: 2, from: 0.35, to: 0.75, barrels: true },
      extras: (fore) => { fore.cylinder(0.2, 0.26, 1.8, 8, { at: [0, 2.5, -7.4], rot: [Math.PI / 2, 0, 0], color: PALETTE.bronze }); },
    };
    case 'brig': return {
      hull: { length: 28, beam: 8.4, freeboard: 2.4, draft: 2.2, bowRise: 1.0, sternRise: 0.8, bowFullness: 0.32, sternWidth: 0.62, rail: 0.9 },
      livery: ADM,
      masts: [
        { z: -0.18, height: 19, tiers: 2, width: 11, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.14, height: 17, tiers: 2, width: 10, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag' },
      ],
      bowsprit: 7, jib: 'admiraltyPlain', castle: { from: 0.82, height: 1.4, windows: true },
      gunports: { rows: 1, perSide: 4, from: 0.18, to: 0.8, barrels: true }, splitZ: 0.5,
    };
    case 'corsair-brig': return {
      ...shipSpec('brig')!, livery: COR,
      masts: [
        { z: -0.18, height: 19, tiers: 2, width: 11.5, rig: 'square', sail: 'corsairSail', plain: 'corsairPlain', flag: 'corsairFlag', nest: true },
        { z: 0.14, height: 17, tiers: 2, width: 10, rig: 'square', sail: 'corsairSail', plain: 'corsairPlain', flag: 'corsairFlag' },
      ],
      jib: 'corsairPlain', castle: { from: 0.8, height: 1.6, windows: true },
    };
    case 'fireship': return {
      hull: { length: 22, beam: 6.6, freeboard: 2.0, draft: 1.8, bowRise: 0.8, sternRise: 0.5, bowFullness: 0.3, sternWidth: 0.6, rail: 0.7 },
      livery: FIRE,
      masts: [{ z: -0.05, height: 14, tiers: 2, width: 9, rig: 'square', sail: 'burntSail', plain: 'burntSail', flag: 'corsairFlag' }],
      bowsprit: 4,
      extras: (fore, aft, glow) => {
        // Powder kegs on deck and a nest of stylized flames (glow).
        for (const [x, z] of [[-1.4, -3], [1.3, -2.2], [0, 2.5], [-1.2, 4.5], [1.4, 5.2]] as const) {
          const b = z < 0 ? fore : aft;
          b.cylinder(0.55, 0.55, 1.2, 8, { at: [x, 2.6, z], color: 0x8a4a22 });
          b.cylinder(0.58, 0.58, 0.14, 8, { at: [x, 2.9, z], color: 0x2b2d33 });
        }
        for (const [x, z, s] of [[0, -4.5, 1.2], [-1.6, 0, 1.5], [1.5, 1.5, 1.3], [0, 5.5, 1.6], [0.4, -1.5, 1.0]] as const) {
          glow.cone(0.9 * s, 2.8 * s, 6, { at: [x, 3.2 + 1.2 * s, z], color: PALETTE.glowRed });
          glow.cone(0.55 * s, 2.0 * s, 6, { at: [x + 0.2, 3.4 + 1.0 * s, z + 0.2], color: PALETTE.glowWarm });
          glow.cone(0.3 * s, 1.2 * s, 5, { at: [x - 0.1, 3.5 + 0.8 * s, z - 0.1], color: 0xfff1a8 });
        }
      },
    };
    case 'mortar-barge': return {
      hull: { length: 24, beam: 11, freeboard: 1.5, draft: 1.4, bowRise: 0.3, sternRise: 0.2, bowFullness: 0.12, sternWidth: 0.95, rail: 0.6, boxy: true },
      livery: ADM,
      masts: [{ z: 0.3, height: 9, tiers: 1, width: 5, rig: 'square', sail: 'admiraltyPlain', plain: 'admiraltyPlain', flag: 'admiraltyFlag' }],
      extras: (fore, aft) => {
        // Turntable + giant mortar amidships (split between halves at z = 0 → put it in the fore half).
        fore.cylinder(3.4, 3.8, 0.8, 16, { at: [0, 1.9, -1.2], color: 0x5a3a20 });
        fore.cylinder(3.0, 3.1, 0.3, 16, { at: [0, 2.4, -1.2], color: PALETTE.brass });
        const g = new GeoBuilder();
        g.sphere(2.3, 14, 10, { color: PALETTE.iron });
        g.cylinder(2.5, 2.2, 3.6, 14, { at: [0, 1.8, 0], color: PALETTE.iron });
        g.cylinder(2.75, 2.75, 0.5, 14, { at: [0, 0.8, 0], color: PALETTE.brass });
        g.cylinder(2.8, 2.6, 0.6, 14, { at: [0, 3.5, 0], color: PALETTE.iron });
        g.cylinder(1.8, 1.8, 0.1, 14, { at: [0, 3.82, 0], color: 0x111111 });
        const geo = g.build();
        fore.add(geo, { at: [0, 4.3, -1.2], rot: [-0.55, 0, 0] });
        geo.dispose();
        aft.box(5, 2.4, 4, { at: [0, 2.6, 7.5], color: ADM.hull });
        aft.box(5.3, 0.3, 4.3, { at: [0, 3.9, 7.5], color: ADM.stripe });
        for (const x of [-4.5, 4.5]) for (const z of [-6, 2, 9]) (z < 0 ? fore : aft).cylinder(0.5, 0.5, 0.9, 8, { at: [x, 2.0, z], color: 0x8a4a22 });
      },
    };
    case 'frigate': return {
      hull: { length: 38, beam: 11.5, freeboard: 3.2, draft: 3.0, bowRise: 1.2, sternRise: 1.2, bowFullness: 0.34, sternWidth: 0.62, rail: 1.0 },
      livery: ADM,
      masts: [
        { z: -0.24, height: 25, tiers: 3, width: 14, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.0, height: 28, tiers: 3, width: 15.5, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.24, height: 22, tiers: 2, width: 12, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag' },
      ],
      bowsprit: 9, jib: 'admiraltyPlain', castle: { from: 0.82, height: 2.0, windows: true, gold: true }, forecastle: { to: 0.14, height: 1.3 },
      gunports: { rows: 1, perSide: 7, from: 0.14, to: 0.84, barrels: true }, splitZ: 1.5,
    };
    case 'man-o-war': return {
      hull: { length: 50, beam: 15, freeboard: 4.6, draft: 4.2, bowRise: 1.5, sternRise: 2.0, bowFullness: 0.36, sternWidth: 0.66, rail: 1.1 },
      livery: ADM,
      masts: [
        { z: -0.25, height: 33, tiers: 3, width: 19, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.0, height: 37, tiers: 3, width: 21, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.25, height: 29, tiers: 3, width: 16, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'commodoreFlag', nest: true },
      ],
      bowsprit: 12, jib: 'admiraltyPlain', castle: { from: 0.78, height: 3.2, windows: true, gold: true }, forecastle: { to: 0.15, height: 1.8 },
      gunports: { rows: 2, perSide: 9, from: 0.14, to: 0.84, barrels: true }, splitZ: 2,
    };
    case 'corsair-galleon': return {
      hull: { length: 44, beam: 13.5, freeboard: 3.8, draft: 3.6, bowRise: 1.4, sternRise: 2.2, bowFullness: 0.34, sternWidth: 0.66, rail: 1.1 },
      livery: COR,
      masts: [
        { z: -0.24, height: 28, tiers: 3, width: 16, rig: 'square', sail: 'corsairSail', plain: 'corsairPlain', flag: 'corsairFlag', nest: true },
        { z: 0.02, height: 31, tiers: 3, width: 18, rig: 'square', sail: 'corsairSail', plain: 'corsairPlain', flag: 'corsairFlag', nest: true },
        { z: 0.27, height: 22, tiers: 1, width: 14, rig: 'lateen', sail: 'corsairPlain', plain: 'corsairPlain', flag: 'corsairFlag' },
      ],
      bowsprit: 10, jib: 'corsairPlain', castle: { from: 0.76, height: 3.4, windows: true, gold: true }, forecastle: { to: 0.15, height: 1.6 },
      gunports: { rows: 1, perSide: 8, from: 0.14, to: 0.76, barrels: true }, splitZ: 1,
    };
    case 'wraith': return {
      hull: { length: 30, beam: 8.8, freeboard: 2.6, draft: 2.2, bowRise: 1.4, sternRise: 1.6, bowFullness: 0.3, sternWidth: 0.55, rail: 0.9 },
      livery: WRA,
      masts: [
        { z: -0.2, height: 20, tiers: 2, width: 12, rig: 'square', sail: 'wraithSail', plain: 'wraithSail', flag: 'wraithFlag', nest: true },
        { z: 0.15, height: 15, tiers: 2, width: 10, rig: 'square', sail: 'wraithSail', plain: 'wraithSail' },
      ],
      bowsprit: 6, castle: { from: 0.8, height: 1.8, windows: true },
      gunports: { rows: 1, perSide: 4, from: 0.2, to: 0.78, barrels: false }, splitZ: 0.5,
      extras: (_fore, _aft, glow) => {
        for (const z of [-11, -4, 3, 10]) for (const side of [1, -1]) glow.octa(0.45, { at: [side * 3.6, 3.9, z], color: PALETTE.glowTeal });
        glow.ico(0.9, 0, { at: [0, 21.5, -6], color: PALETTE.glowTeal });
      },
    };
    case 'fort': return null;
    case 'dreadnought': return {
      hull: { length: 90, beam: 30, freeboard: 7, draft: 6.5, bowRise: 1.5, sternRise: 3, bowFullness: 0.3, sternWidth: 0.7, rail: 1.4 },
      livery: { hull: 0xdfe4ea, bottom: 0x3a3f48, stripe: 0x2b3b5c, trim: 0xd8a441, deck: 0x9a8a78, wale: 0x1a1d24 },
      masts: [
        { z: -0.24, height: 44, tiers: 3, width: 32, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.02, height: 50, tiers: 3, width: 36, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'commodoreFlag', nest: true },
        { z: 0.26, height: 38, tiers: 3, width: 28, rig: 'square', sail: 'admiraltySail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
      ],
      bowsprit: 14, jib: 'admiraltyPlain', castle: { from: 0.78, height: 5, windows: true, gold: true }, forecastle: { to: 0.14, height: 3 },
      gunports: { rows: 3, perSide: 12, from: 0.14, to: 0.8, barrels: true }, splitZ: 3,
      extras: (fore, aft) => {
        // Smokestack and a ram bow.
        aft.cylinder(3.2, 3.6, 16, 14, { at: [0, 15, 12], color: 0x2b313b });
        aft.cylinder(3.5, 3.5, 1.2, 14, { at: [0, 22.5, 12], color: PALETTE.gold });
        const ram = new THREE.ConeGeometry(3, 10, 4, 1).rotateY(Math.PI / 4).rotateX(-Math.PI / 2);
        fore.add(ram, { at: [0, 1, -48], scale: [1, 0.8, 1], color: 0x2b313b, flat: true });
        ram.dispose();
      },
    };
    case 'sovereign': return {
      hull: { length: 120, beam: 38, freeboard: 9, draft: 8.5, bowRise: 2.5, sternRise: 5, bowFullness: 0.34, sternWidth: 0.7, rail: 1.8 },
      livery: { hull: 0xf5f3ec, bottom: 0x8c5334, stripe: 0x1f3566, trim: 0xe8b64c, deck: 0xd9b88a, wale: 0x1a2440 },
      masts: [
        { z: -0.3, height: 58, tiers: 3, width: 40, rig: 'square', sail: 'sovereignSail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: -0.08, height: 66, tiers: 4, width: 46, rig: 'square', sail: 'sovereignSail', plain: 'admiraltyPlain', flag: 'commodoreFlag', nest: true },
        { z: 0.14, height: 60, tiers: 3, width: 42, rig: 'square', sail: 'sovereignSail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
        { z: 0.33, height: 44, tiers: 2, width: 32, rig: 'square', sail: 'sovereignSail', plain: 'admiraltyPlain', flag: 'admiraltyFlag', nest: true },
      ],
      bowsprit: 20, jib: 'admiraltyPlain', castle: { from: 0.76, height: 9, windows: true, gold: true }, forecastle: { to: 0.14, height: 4 },
      gunports: { rows: 3, perSide: 16, from: 0.14, to: 0.76, barrels: true }, splitZ: 4,
    };
  }
  return null;
}

/** Cliff battery (fallback for the `fort` key): a stone bastion on a rock with cannons, a mortar and a flag. */
export function buildFort(): BuiltShip {
  const b = new GeoBuilder(), glow = new GeoBuilder();
  const stone = atlasUV('stone');
  // Rock base: a cluster of faceted boulders.
  for (const [x, y, z, r, sy] of [[0, -1.5, 0, 11, 0.55], [6, -1, 4, 6, 0.7], [-6, -1.2, -3, 7, 0.6], [3, -1.4, -7, 5.5, 0.6], [-5, -1, 6, 5, 0.7]] as const) {
    b.dodeca(r, { at: [x, y, z], scale: [1, sy, 1], color: 0x7d7468 });
  }
  b.dodeca(8, { at: [0, 1.6, 0], scale: [1.1, 0.35, 1.1], color: 0x8e8577 });
  // Round bastion with a stone texture.
  b.cylinder(7.2, 7.8, 7, 18, { at: [0, 6.2, 0], color: 0xffffff, uvRect: stone });
  b.cylinder(7.9, 7.9, 0.8, 18, { at: [0, 9.9, 0], color: 0xd8d2c4 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.box(1.6, 1.4, 1.2, { at: [Math.cos(a) * 7.4, 11, Math.sin(a) * 7.4], rot: [0, -a, 0], color: 0xc9c2b2 });
  }
  // Cannons through the embrasures and a big mortar on top.
  for (const a of [0.4, 1.4, 2.4, 3.6, 4.7, 5.7]) {
    b.cylinder(0.42, 0.55, 3.2, 8, { at: [Math.cos(a) * 8.3, 7.6, Math.sin(a) * 8.3], rot: [0, -a, Math.PI / 2], color: PALETTE.iron });
    b.box(1.8, 1.8, 0.3, { at: [Math.cos(a) * 7.8, 7.6, Math.sin(a) * 7.8], rot: [0, Math.PI / 2 - a, 0], color: 0x1b1d22 });
  }
  b.cylinder(2.4, 2.8, 0.8, 14, { at: [0, 10.7, 0], color: 0x5a3a20 });
  b.sphere(1.7, 12, 8, { at: [0, 12.2, 0], color: PALETTE.iron });
  b.cylinder(1.8, 1.6, 2.4, 12, { at: [0, 13.4, 0.6], rot: [-0.6, 0, 0], color: PALETTE.iron });
  // Flag pole.
  b.cylinder(0.18, 0.24, 9, 6, { at: [4.5, 15.5, -4.5], color: 0x5a3a20 });
  const fl = atlasUV('admiraltyFlag');
  b.raw([4.5, 19.8, -4.5, 4.5, 17.4, -4.5, 4.5, 17.4, -0.6, 4.5, 19.8, -0.6], [0, 1, 2, 0, 2, 3], 0xffffff, [fl[0], fl[3], fl[0], fl[1], fl[2], fl[1], fl[2], fl[3]]);
  glow.box(1.2, 1.2, 0.2, { at: [0, 8.8, 7.75], color: PALETTE.glowWarm });
  glow.box(1.2, 1.2, 0.2, { at: [0, 8.8, -7.75], color: PALETTE.glowWarm });
  const empty = new GeoBuilder();
  empty.box(0.01, 0.01, 0.01, { at: [0, -50, 0] });
  return {
    fore: b.build(), aft: empty.build(), glow: glow.build(), length: 20, deckY: 11, mastTop: 20, splitZ: 100,
    anchors: {
      bow: new THREE.Vector3(0, 8, -8.5), stern: new THREE.Vector3(0, 8, 8.5), port: new THREE.Vector3(-8.8, 7.6, 0),
      starboard: new THREE.Vector3(8.8, 7.6, 0), mast: new THREE.Vector3(0, 14.5, 0), deck: new THREE.Vector3(0, 11.5, 0),
    },
  };
}
