/**
 * Round 1 class looks (FOES-owned): each new enemy class dresses a base hull (manifest GLB, procedural fallback) with a
 * class tint, manifest props (baked into instanced parts), procedural extras (plating, pennants, rope, weed) drawn with
 * the fleet atlas, and emissive bits. Coordinates are metres in the BASE model's space (bow −Z, waterline y = 0);
 * EnemyFleet scales the whole class to the enemy's length.
 */
import type { EnemyId } from '../../../game/ids';
import { atlasUV } from '../atlas';
import type { GeoBuilder } from '../geometry/GeoBuilder';
import { PALETTE } from '../geometry/parts';

export interface PropPlacement {
  /** Manifest prop key (cannon, harpoon-gun, powder-keg, flag, flag-redtide, lantern, iron-ram, mortar). */
  key: string;
  at: [number, number, number];
  /** Yaw (rad; 0 = prop's −Z toward the bow) and pitch. */
  yaw?: number;
  pitch?: number;
  /** Target size in metres along the prop's manifest length. */
  size: number;
}

export interface FoeLook {
  /** Base hull model key (manifest or procedural). */
  base: string;
  /** Class tint (multiplies the hull and props per instance). */
  tint: [number, number, number];
  /** Hull drawn with the spectral (Gloam) material. */
  spectral?: boolean;
  /** Fully procedural body (no base hull). */
  procedural?: 'wisp';
  /** Deck height of the base model (m), used by the extras. */
  deck: number;
  props: PropPlacement[];
  /** Procedural extras: `b` uses the fleet atlas material (vertex colours), `g` the emissive glow material. */
  extras?: (b: GeoBuilder, g: GeoBuilder, deck: number) => void;
}

const P = PALETTE;

/** A string of small pennants between two points (signal hoist). */
function pennants(b: GeoBuilder, a: [number, number, number], z: [number, number, number], n: number, size: number): void {
  const colors = [0xd8282a, 0xffd23a, 0x1f4aa6, 0xf4f1e6, 0x2b8a3e];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a[0] + (z[0] - a[0]) * t, y = a[1] + (z[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.6, zz = a[2] + (z[2] - a[2]) * t;
    const pos = [x, y, zz - size * 0.45, x, y, zz + size * 0.45, x, y - size * 1.1, zz];
    b.raw(pos, [0, 1, 2, 0, 2, 1], colors[i % colors.length]!);
  }
  // The line itself.
  const dx = z[0] - a[0], dy = z[1] - a[1], dz = z[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  b.cylinder(0.04, 0.04, len, 3, {
    at: [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2, (a[2] + z[2]) / 2],
    rot: [Math.atan2(Math.hypot(dx, dz), dy) * Math.sign(dz || 1), 0, 0], color: P.rope,
  });
}

/** A flag on a pole: atlas region quad. */
function flag(b: GeoBuilder, x: number, y: number, z: number, w: number, h: number, region: 'corsairFlag' | 'admiraltyFlag' | 'wraithFlag'): void {
  b.cylinder(0.08, 0.1, h + 1.6, 5, { at: [x, y + (h + 1.6) / 2, z], color: P.woodDark });
  const [u0, v0, u1, v1] = atlasUV(region);
  const top = y + h + 1.5, bot = top - h;
  // Double-sided quad flying aft from the pole.
  b.raw([x, top, z, x, bot, z, x, bot, z + w, x, top, z + w], [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2], 0xffffff, [u0, v1, u0, v0, u1, v0, u1, v1]);
}

/** Iron plates along both sides of a hull (atlas iron-plate texture). */
function plating(b: GeoBuilder, halfBeam: number, z0: number, z1: number, y0: number, y1: number, rows: number): void {
  const uv = atlasUV('ironPlates');
  const n = Math.max(2, Math.round((z1 - z0) / 3));
  for (const side of [1, -1] as const) {
    for (let i = 0; i < n; i++) {
      const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n;
      // Taper toward the bow so the plates hug the hull.
      const taper = (z: number) => Math.min(1, 0.55 + 0.45 * ((z - z0) / Math.max(1, (z1 - z0) * 0.35)));
      for (let r = 0; r < rows; r++) {
        const ya = y0 + ((y1 - y0) * r) / rows, yb = y0 + ((y1 - y0) * (r + 1)) / rows;
        const xa = side * halfBeam * taper(za), xb = side * halfBeam * taper(zb);
        b.box(0.28, (yb - ya) * 0.92, (zb - za) * 0.94, { at: [(xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2], color: 0xffffff, uvRect: uv });
        // Rivet line.
        b.box(0.06, 0.12, (zb - za) * 0.8, { at: [(xa + xb) / 2 + side * 0.16, yb - 0.12, (za + zb) / 2], color: P.ironLight });
      }
    }
  }
}

export const FOE_LOOKS: Partial<Record<EnemyId, FoeLook>> = {
  'signal-cutter': {
    base: 'sloop', tint: [1.04, 1.0, 0.96], deck: 1.6,
    props: [{ key: 'mortar', at: [0, 1.5, 5.8], yaw: Math.PI, size: 1.9 }],
    extras: (b, g) => {
      // Signal hoist: bowsprit → masthead → stern, and a red-white signal flag at the peak.
      pennants(b, [0, 2.6, -13.5], [0, 12.4, -2.2], 9, 0.9);
      pennants(b, [0, 12.4, -2.2], [0, 3.2, 9.4], 8, 0.9);
      b.box(0.08, 1.4, 2.2, { at: [0, 13.6, -1.2], color: 0xd8282a });
      b.box(0.1, 0.7, 1.1, { at: [0, 13.95, -1.75], color: 0xf4f1e6 });
      b.box(0.1, 0.7, 1.1, { at: [0, 13.25, -0.65], color: 0xf4f1e6 });
      // Masthead flare lantern (glow; FX pulses the burst).
      g.octa(0.55, { at: [0, 12.9, -2.2], color: P.glowRed });
      g.octa(0.35, { at: [0, 2.6, 6.2], color: P.glowRed });
    },
  },
  ironclad: {
    base: 'brig', tint: [0.42, 0.46, 0.54], deck: 2.3,
    props: [{ key: 'iron-ram', at: [0, 0.4, -14.6], size: 5.2 }],
    extras: (b, _g, deck) => {
      plating(b, 3.75, -12.5, 12.5, 0.1, deck + 0.3, 2);
      // Bow shield: heavy wedge of iron over the stem.
      b.box(0.5, deck + 0.4, 4.2, { at: [1.9, (deck + 0.4) / 2, -11.8], rot: [0, 0.38, 0], color: 0xffffff, uvRect: atlasUV('ironPlates') });
      b.box(0.5, deck + 0.4, 4.2, { at: [-1.9, (deck + 0.4) / 2, -11.8], rot: [0, -0.38, 0], color: 0xffffff, uvRect: atlasUV('ironPlates') });
      // Squat smokestack amidships (a steam-and-sail ironclad).
      b.cylinder(1.05, 1.2, 5.2, 12, { at: [0, deck + 2.6, 2.4], color: P.iron });
      b.cylinder(1.15, 1.15, 0.5, 12, { at: [0, deck + 4.9, 2.4], color: P.brass });
      b.cylinder(0.85, 0.85, 0.2, 10, { at: [0, deck + 5.25, 2.4], color: P.black });
    },
  },
  harpooner: {
    base: 'corsair-brig', tint: [0.95, 0.84, 0.78], deck: 2.3,
    props: [{ key: 'harpoon-gun', at: [0, 2.35, -11.6], size: 5.4 }],
    extras: (b, _g, deck) => {
      // Rope coils by the gun and a rack of spare barbed harpoons along the rail.
      for (const x of [-1.5, 1.5]) {
        b.torus(0.62, 0.2, 5, 14, { at: [x, deck + 0.25, -8.4], rot: [Math.PI / 2, 0, 0], color: P.rope });
        b.torus(0.46, 0.18, 5, 12, { at: [x, deck + 0.55, -8.4], rot: [Math.PI / 2, 0, 0], color: P.rope });
      }
      for (let i = 0; i < 5; i++) {
        const z = -5 + i * 1.1;
        for (const x of [-3.1, 3.1]) {
          b.cylinder(0.06, 0.06, 3.2, 4, { at: [x, deck + 1.4, z], rot: [0.35, 0, 0], color: P.woodDark });
          b.cone(0.18, 0.55, 4, { at: [x, deck + 3.0, z - 0.52], rot: [0.35, 0, 0], color: P.ironLight });
        }
      }
      flag(b, 0, deck + 13.2, 9.5, 2.6, 1.6, 'corsairFlag');
    },
  },
  'bomb-ketch': {
    base: 'mortar-barge', tint: [0.44, 0.17, 0.14], deck: 1.9,
    props: [
      { key: 'powder-keg', at: [-1.7, 1.9, 5.6], size: 1.15 },
      { key: 'powder-keg', at: [0, 1.9, 6.4], size: 1.15 },
      { key: 'powder-keg', at: [1.7, 1.9, 5.6], size: 1.15 },
      { key: 'powder-keg', at: [-0.85, 2.72, 6.0], size: 1.15 },
      { key: 'powder-keg', at: [0.85, 2.72, 6.0], size: 1.15 },
      { key: 'powder-keg', at: [3.6, 1.9, -5.5], size: 1.0 },
      { key: 'powder-keg', at: [-3.6, 1.9, -5.5], size: 1.0 },
    ],
    extras: (b, g, deck) => {
      flag(b, 0, deck + 8.2, 9.2, 2.4, 1.5, 'corsairFlag');
      // Lit fuses on the stacked kegs.
      g.octa(0.2, { at: [-0.85, 3.85, 6.0], color: P.glowWarm });
      g.octa(0.2, { at: [0.85, 3.85, 6.0], color: P.glowWarm });
    },
  },
  'smoke-runner': {
    base: 'skiff', tint: [0.4, 0.4, 0.47], deck: 0.8,
    props: [
      { key: 'powder-keg', at: [-0.9, 0.55, 3.9], size: 0.85 },
      { key: 'powder-keg', at: [0.9, 0.55, 3.9], size: 0.85 },
    ],
    extras: (b, g) => {
      // Smoke pots: two short black stacks at the stern with embers.
      for (const x of [-0.9, 0.9]) {
        b.cylinder(0.26, 0.32, 1.0, 8, { at: [x, 1.55, 3.9], color: P.black });
        g.octa(0.18, { at: [x, 2.1, 3.9], color: P.glowWarm });
      }
      b.box(2.4, 0.08, 1.5, { at: [0, 5.8, 0.4], rot: [0, 0, 0], color: 0x3a3a44 });
    },
  },
  'lantern-wisp': {
    base: 'wisp', procedural: 'wisp', tint: [1, 1, 1], deck: 0, props: [],
    extras: (b, g) => {
      // A drowned ship's lantern: iron cap, ring and bars around a spectral flame.
      b.cone(0.9, 0.7, 8, { at: [0, 2.35, 0], color: P.iron });
      b.torus(0.32, 0.08, 5, 10, { at: [0, 2.85, 0], rot: [0, 0, Math.PI / 2], color: P.iron });
      b.cylinder(0.72, 0.8, 0.22, 8, { at: [0, 0.05, 0], color: P.iron });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.box(0.08, 1.95, 0.08, { at: [Math.cos(a) * 0.72, 1.05, Math.sin(a) * 0.72], color: P.ironBlue });
      }
      g.cylinder(0.62, 0.68, 1.85, 6, { at: [0, 1.05, 0], color: P.glowTeal }, true);
      g.cone(0.34, 1.2, 6, { at: [0, 1.1, 0], color: P.glowWhite });
      g.octa(0.28, { at: [0, 0.45, 0], color: P.glowCyan });
    },
  },
  'drowned-galleon': {
    base: 'corsair-galleon', tint: [0.62, 1.0, 0.86], spectral: true, deck: 3.2,
    props: [],
    extras: (b, g, deck) => {
      // Weed hanging off the rails and barnacle clusters along the waterline.
      for (let i = 0; i < 18; i++) {
        const z = -17 + i * 2, side = i % 2 ? 1 : -1, x = side * (5.6 - Math.abs(z) * 0.07);
        const h = 1.6 + ((i * 7) % 5) * 0.35;
        b.raw([x, deck + 0.5, z - 0.35, x, deck + 0.5, z + 0.35, x + side * 0.1, deck + 0.5 - h, z + 0.1], [0, 1, 2, 0, 2, 1], 0x1f4a2e);
      }
      for (let i = 0; i < 26; i++) {
        const z = -18 + ((i * 13) % 36), side = i % 2 ? 1 : -1, x = side * (5.9 - Math.abs(z) * 0.08);
        b.ico(0.32 + (i % 3) * 0.12, 0, { at: [x, 0.25 + (i % 4) * 0.22, z], color: i % 3 ? 0x5f7d6a : 0x8aa08c });
      }
      // Drowned lanterns along the hull and a great stern light.
      for (const z of [-14, -6, 2, 10]) for (const side of [1, -1]) g.octa(0.5, { at: [side * 6.2, deck + 1.2, z], color: P.glowTeal });
      g.ico(1.0, 0, { at: [0, deck + 5.2, 19.5], color: P.glowTeal });
    },
  },
};

/** Model keys the looks need (bases and props), requested up front. */
export function foeLookKeys(): string[] {
  const keys = new Set<string>();
  for (const look of Object.values(FOE_LOOKS)) {
    if (!look) continue;
    if (!look.procedural) keys.add(look.base);
    for (const p of look.props) keys.add(p.key);
  }
  return [...keys];
}
