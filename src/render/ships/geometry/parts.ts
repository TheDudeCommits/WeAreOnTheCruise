/**
 * Procedural attachment parts for ship growth (SHIPS-owned). Chunky, high-contrast shapes that read at the tactical
 * camera distance (~150 m): bronze deck guns, iron plating, lanterns, weapon mounts. Each builder returns geometry in
 * metres for a ~40 m ship (callers scale per ship), origin at the mounting point, +Y up.
 *
 * Orientation conventions: side guns/cannons point +X (outboard starboard; rotate π about Y for port);
 * bow weapons point −Z (forward); stern weapons face +Z unless stated.
 */
import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder';

export const PALETTE = {
  iron: 0x2b313b, ironLight: 0x56657a, ironBlue: 0x3a4d66,
  bronze: 0xc8883a, brass: 0xe5b24e, gold: 0xffc947,
  wood: 0x7a4a2a, woodDark: 0x4a2a16, woodLight: 0xb07c4c,
  red: 0xc7362f, redDark: 0x7d1f1b, cream: 0xf3e6c4, rope: 0xcaa46a, black: 0x16181d,
  coralPink: 0xff6f86, coralTeal: 0x2fc7b4, coralPurple: 0x8a5ad8,
  glowWarm: 0xffb040, glowCyan: 0x86ecff, glowGold: 0xffd35e, glowTeal: 0x6affd9, glowRed: 0xff5a36, glowWhite: 0xfff3d6,
} as const;

const P = PALETTE;

/** A cannon on a wheeled carriage, barrel along +X. Barrel length ≈ 2.9 m. */
export function deckCannon(barrel: number = P.bronze): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Carriage.
  b.box(1.6, 0.7, 1.25, { at: [-0.1, 0.55, 0], color: P.woodDark });
  b.box(1.1, 0.35, 1.3, { at: [-0.35, 1.0, 0], color: P.wood });
  for (const x of [-0.55, 0.45]) for (const z of [-0.62, 0.62]) b.cylinder(0.34, 0.34, 0.16, 10, { at: [x, 0.34, z], rot: [Math.PI / 2, 0, 0], color: P.woodDark });
  // Barrel: breech knob, body, reinforcing rings, muzzle swell.
  const rot: [number, number, number] = [0, 0, -Math.PI / 2];
  b.sphere(0.36, 10, 8, { at: [-0.95, 1.25, 0], color: barrel });
  b.cylinder(0.3, 0.42, 2.4, 12, { at: [0.3, 1.25, 0], rot, color: barrel });
  b.cylinder(0.46, 0.46, 0.22, 12, { at: [-0.55, 1.25, 0], rot, color: P.brass });
  b.cylinder(0.36, 0.36, 0.16, 12, { at: [0.55, 1.25, 0], rot, color: P.brass });
  b.cylinder(0.42, 0.34, 0.32, 12, { at: [1.55, 1.25, 0], rot, color: barrel });
  b.cylinder(0.2, 0.2, 0.06, 10, { at: [1.72, 1.25, 0], rot, color: P.black });
  return b.build();
}

/** A gun barrel poking out of a gunport (broadside battery), along +X from the hull surface. */
export function sideGun(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rot: [number, number, number] = [0, 0, -Math.PI / 2];
  b.box(0.35, 1.5, 1.5, { at: [-0.05, 0, 0], color: P.black }); // port opening
  b.box(0.12, 1.7, 1.7, { at: [0.08, 0, 0], color: P.redDark }); // lid frame
  b.cylinder(0.3, 0.38, 1.9, 12, { at: [0.9, 0, 0], rot, color: P.iron });
  b.cylinder(0.42, 0.42, 0.18, 12, { at: [0.35, 0, 0], rot, color: P.brass });
  b.cylinder(0.4, 0.32, 0.3, 12, { at: [1.8, 0, 0], rot, color: P.iron });
  return b.build();
}

/** Heavy stern mortar on a turntable, barrel tilted up and aft. */
export function mortar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(1.75, 1.95, 0.5, 16, { at: [0, 0.25, 0], color: P.woodDark });
  b.cylinder(1.5, 1.6, 0.25, 16, { at: [0, 0.62, 0], color: P.brass });
  b.box(2.3, 1.2, 1.9, { at: [0, 1.25, 0], color: P.wood });
  const tilt: [number, number, number] = [-0.72, 0, 0];
  const g = new GeoBuilder();
  g.sphere(1.05, 14, 10, { at: [0, 0, 0], color: P.iron });
  g.cylinder(1.12, 1.0, 1.9, 14, { at: [0, 1.0, 0], color: P.iron });
  g.cylinder(1.25, 1.25, 0.28, 14, { at: [0, 0.35, 0], color: P.brass });
  g.cylinder(1.28, 1.2, 0.35, 14, { at: [0, 1.85, 0], color: P.iron });
  g.cylinder(0.78, 0.78, 0.08, 14, { at: [0, 2.03, 0], color: P.black });
  const barrel = g.build();
  b.add(barrel, { at: [0, 2.0, 0.2], rot: tilt });
  barrel.dispose();
  return b.build();
}

/** Rocket rack: a timber frame with `count` red rockets angled forward-up. */
export function rocketRack(count: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const n = Math.max(1, Math.min(8, count));
  const width = 0.95 * n + 0.6;
  b.box(width, 0.4, 2.4, { at: [0, 0.2, 0], color: P.woodDark });
  for (const x of [-width / 2 + 0.15, width / 2 - 0.15]) b.box(0.25, 2.3, 0.3, { at: [x, 1.35, 0.6], color: P.wood });
  b.box(width, 0.28, 0.3, { at: [0, 2.35, 0.6], color: P.wood });
  const tilt = -0.95;
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + 0.75 + i * 0.95;
    const r = new GeoBuilder();
    r.cylinder(0.26, 0.26, 2.6, 10, { at: [0, 0, 0], color: i % 2 ? P.red : 0xe8502f });
    r.cone(0.3, 0.8, 10, { at: [0, 1.7, 0], color: P.cream });
    r.cone(0.34, 0.5, 4, { at: [0, -1.4, 0], rot: [0, Math.PI / 4, 0], color: P.iron });
    r.cylinder(0.3, 0.3, 0.12, 10, { at: [0, 0.8, 0], color: P.gold });
    const g = r.build();
    b.add(g, { at: [x, 1.55, -0.1], rot: [tilt, 0, 0] });
    g.dispose();
  }
  return b.build();
}

/** Swivel gun on a rail post, barrel along +X. */
export function swivelGun(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.16, 0.2, 1.3, 8, { at: [0, 0.65, 0], color: P.woodDark });
  b.torus(0.32, 0.07, 6, 12, { at: [0, 1.38, 0], rot: [0, 0, Math.PI / 2], color: P.iron }, Math.PI);
  const rot: [number, number, number] = [0, 0, -Math.PI / 2];
  b.cylinder(0.16, 0.22, 1.5, 10, { at: [0.35, 1.45, 0], rot, color: P.brass });
  b.cylinder(0.24, 0.2, 0.2, 10, { at: [1.05, 1.45, 0], rot, color: P.brass });
  b.cylinder(0.05, 0.05, 0.7, 6, { at: [-0.6, 1.45, 0], rot, color: P.woodDark });
  return b.build();
}

/** Harpoon gun: a heavy crossbow-like mount at the bow pointing −Z with a barbed steel harpoon. */
export function harpoonGun(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.9, 1.1, 0.45, 12, { at: [0, 0.22, 0], color: P.iron });
  b.box(0.7, 1.3, 0.7, { at: [0, 1.0, 0], color: P.ironBlue });
  b.box(1.1, 0.7, 3.4, { at: [0, 1.75, -0.4], color: P.wood });
  // Bow arms.
  b.box(4.2, 0.3, 0.35, { at: [0, 1.95, -1.6], rot: [0, 0, 0], color: P.iron });
  b.box(0.3, 0.32, 0.9, { at: [2.0, 1.95, -1.25], rot: [0, -0.5, 0], color: P.iron });
  b.box(0.3, 0.32, 0.9, { at: [-2.0, 1.95, -1.25], rot: [0, 0.5, 0], color: P.iron });
  // Harpoon shaft + barbed head.
  b.cylinder(0.12, 0.12, 4.6, 8, { at: [0, 2.25, -1.5], rot: [Math.PI / 2, 0, 0], color: P.ironLight });
  b.cone(0.42, 1.1, 4, { at: [0, 2.25, -4.3], rot: [-Math.PI / 2, 0, 0], color: 0xdfe6ee });
  b.box(1.1, 0.08, 0.35, { at: [0, 2.25, -3.75], color: 0xdfe6ee });
  // Rope coil.
  b.torus(0.55, 0.16, 6, 14, { at: [0, 1.95, 1.0], rot: [Math.PI / 2, 0, 0], color: P.rope });
  b.torus(0.35, 0.14, 6, 12, { at: [0, 2.2, 1.0], rot: [Math.PI / 2, 0, 0], color: P.rope });
  return b.build();
}

/** A long bronze bow-chaser gun pointing −Z. */
export function bowChaser(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(1.3, 0.6, 2.4, { at: [0, 0.3, 0.4], color: P.woodDark });
  for (const x of [-0.55, 0.55]) for (const z of [-0.4, 1.2]) b.cylinder(0.3, 0.3, 0.14, 10, { at: [x, 0.3, z], rot: [0, 0, Math.PI / 2], color: P.woodDark });
  const rot: [number, number, number] = [Math.PI / 2, 0, 0];
  b.sphere(0.38, 10, 8, { at: [0, 1.05, 1.3], color: P.bronze });
  b.cylinder(0.26, 0.42, 3.9, 12, { at: [0, 1.05, -0.6], rot, color: P.bronze });
  for (const z of [0.8, -0.4, -1.8]) b.cylinder(0.45, 0.45, 0.16, 12, { at: [0, 1.05, z], rot, color: P.brass });
  b.cylinder(0.36, 0.3, 0.35, 12, { at: [0, 1.05, -2.6], rot, color: P.bronze });
  return b.build();
}

/** Storm rod: copper coil rod rising from a mast top (the glowing orb is a separate glow part). */
export function stormRod(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.55, 0.7, 0.5, 10, { at: [0, 0.25, 0], color: P.iron });
  b.cylinder(0.14, 0.2, 5.2, 8, { at: [0, 2.9, 0], color: 0xb8683a });
  for (let i = 0; i < 6; i++) b.torus(0.38 - i * 0.03, 0.07, 5, 12, { at: [0, 1.2 + i * 0.55, 0], rot: [Math.PI / 2, 0, 0], color: i % 2 ? P.brass : 0xb8683a });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    b.cylinder(0.05, 0.05, 1.4, 5, { at: [Math.cos(a) * 0.5, 5.3, Math.sin(a) * 0.5], rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], color: P.brass });
  }
  return b.build();
}

/** Storm rod orb (glow material). */
export function stormOrb(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(0.95, 1, { at: [0, 6.2, 0], color: PALETTE.glowCyan });
  b.octa(0.55, { at: [0, 7.6, 0], scale: [0.5, 1.6, 0.5], color: 0xffffff });
  return b.build();
}

/** Iron ram: a heavy spiked wedge for the prow, pointing −Z from the stem. */
export function ironRam(spiked: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const wedge = new THREE.ConeGeometry(1.8, 5.4, 4, 1);
  wedge.rotateY(Math.PI / 4);
  wedge.rotateX(-Math.PI / 2);
  b.add(wedge, { at: [0, 0, -2.2], scale: [1, 0.72, 1], color: P.iron, flat: true });
  wedge.dispose();
  b.box(3.2, 2.4, 1.4, { at: [0, 0.1, 0.4], color: P.ironBlue });
  for (const y of [-0.7, 0.9]) b.box(3.4, 0.28, 1.5, { at: [0, y, 0.45], color: P.gold });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.sphere(0.16, 6, 4, { at: [Math.cos(a) * 1.35, 0.1 + Math.sin(a) * 0.95, -0.35], color: P.gold });
  }
  if (spiked) {
    for (const [x, y] of [[1.2, 0.5], [-1.2, 0.5], [1.0, -0.6], [-1.0, -0.6], [0, 1.1]] as const) {
      b.cone(0.3, 1.5, 6, { at: [x, y, -0.8], rot: [-Math.PI / 2 - y * 0.2, 0, -x * 0.25], color: 0xd9e0e8 });
    }
  }
  return b.build();
}

/** Reinforced prow (tier 3): iron cheek plates and straps hugging the stem (no protrusion). */
export function prowPlates(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const side of [-1, 1]) {
    b.box(0.3, 3.0, 4.2, { at: [side * 1.1, 0, 1.4], rot: [0, side * 0.42, 0], color: P.ironBlue });
    for (const y of [-1.1, 0, 1.1]) b.box(0.36, 0.26, 4.3, { at: [side * 1.12, y, 1.4], rot: [0, side * 0.42, 0], color: P.gold });
  }
  b.box(0.9, 3.4, 0.9, { at: [0, 0, 0], rot: [0, Math.PI / 4, 0], color: P.iron });
  return b.build();
}

/** Maelstrom charm: a coral totem with a swirl (the pearl is a glow part). */
export function coralTotem(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(1.3, 1.6, 0.6, 9, { at: [0, 0.3, 0], color: 0x3a6f7a });
  // Branching coral trunk.
  b.cylinder(0.55, 0.85, 3.2, 8, { at: [0, 2.1, 0], color: P.coralPink });
  const branches: [number, number, number, number, number][] = [
    [0.8, 3.1, 0.2, 0.6, 1.8], [-0.7, 3.4, -0.3, -0.7, 1.6], [0.2, 3.7, 0.8, 0.3, 1.5], [-0.3, 2.6, -0.8, -0.5, 1.3], [0.5, 4.0, -0.6, 0.4, 1.2],
  ];
  for (const [x, y, z, lean, len] of branches) {
    b.cylinder(0.18, 0.32, len, 7, { at: [x, y + len * 0.35, z], rot: [z * 0.5, 0, -lean], color: P.coralPink });
    b.sphere(0.26, 7, 5, { at: [x * 1.5, y + len * 0.8, z * 1.5], color: 0xffa3b3 });
  }
  b.cylinder(0.3, 0.45, 1.6, 7, { at: [0.9, 1.1, 0.7], rot: [0.3, 0, -0.35], color: P.coralTeal });
  b.cylinder(0.25, 0.4, 1.4, 7, { at: [-0.9, 1.0, 0.6], rot: [0.3, 0, 0.4], color: P.coralPurple });
  b.torus(1.25, 0.14, 6, 18, { at: [0, 4.4, 0], rot: [Math.PI / 2, 0, 0], color: P.gold });
  return b.build();
}

/** Maelstrom pearl + swirl ring (glow material). */
export function coralPearl(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.ico(0.75, 1, { at: [0, 4.4, 0], color: PALETTE.glowTeal });
  return b.build();
}

/** Stacked powder barrels (fire barrels weapon), red bands. */
export function barrelStack(count: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const n = Math.max(1, Math.min(6, count));
  b.box(1.2 * Math.min(3, n) + 0.4, 0.3, 2.0, { at: [0, 0.15, 0], color: P.woodDark });
  for (let i = 0; i < n; i++) {
    const row = i < 3 ? 0 : 1;
    const col = row === 0 ? i : i - 3;
    const x = (col - (Math.min(3, row === 0 ? n : n - 3) - 1) / 2) * 1.2;
    const y = 0.3 + 0.75 + row * 1.35;
    b.cylinder(0.55, 0.55, 1.5, 10, { at: [x, y, 0], color: 0x9a5a2a });
    b.cylinder(0.58, 0.58, 0.16, 10, { at: [x, y + 0.45, 0], color: P.red });
    b.cylinder(0.58, 0.58, 0.16, 10, { at: [x, y - 0.45, 0], color: P.red });
    b.cylinder(0.5, 0.5, 0.04, 10, { at: [x, y + 0.76, 0], color: 0xffd35e });
  }
  return b.build();
}

/** Mine rack: spiked black mines on a sloped rack at the stern. */
export function mineRack(count: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const n = Math.max(1, Math.min(4, count + 1));
  b.box(1.4 * n + 0.3, 0.35, 2.2, { at: [0, 0.18, 0], color: P.iron });
  b.box(1.4 * n + 0.3, 0.2, 0.25, { at: [0, 0.55, -0.9], color: P.brass });
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 1.4;
    b.sphere(0.6, 10, 8, { at: [x, 1.0, 0], color: P.black });
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0]] as const) {
      b.cone(0.1, 0.4, 5, { at: [x + dx * 0.68, 1.0 + dy * 0.68, dz * 0.68], rot: [dz * Math.PI / 2, 0, -dx * Math.PI / 2], color: P.brass });
    }
  }
  return b.build();
}

/** Lantern on a post (body; the glass is a glow part from lanternGlass()). Height ≈ 2.4 m. */
export function lanternBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.09, 0.12, 1.4, 6, { at: [0, 0.7, 0], color: P.woodDark });
  b.box(0.75, 0.12, 0.75, { at: [0, 1.45, 0], color: P.iron });
  b.cone(0.55, 0.45, 4, { at: [0, 2.35, 0], rot: [0, Math.PI / 4, 0], color: P.iron });
  for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]] as const) b.box(0.07, 0.75, 0.07, { at: [x, 1.85, z], color: P.iron });
  b.torus(0.12, 0.035, 4, 8, { at: [0, 2.65, 0], color: P.iron });
  return b.build();
}

export function lanternGlass(scale = 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.52 * scale, 0.72 * scale, 0.52 * scale, { at: [0, 1.85, 0], color: PALETTE.glowWarm });
  return b.build();
}

/** Big ornate stern lantern (body). */
export function sternLanternBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.14, 0.18, 1.6, 8, { at: [0, 0.8, 0], color: P.gold });
  b.cylinder(0.7, 0.55, 0.25, 8, { at: [0, 1.7, 0], color: P.gold });
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.box(0.08, 1.3, 0.08, { at: [Math.cos(a) * 0.55, 2.45, Math.sin(a) * 0.55], color: P.gold }); }
  b.cone(0.85, 0.9, 8, { at: [0, 3.55, 0], color: P.gold });
  b.sphere(0.2, 8, 6, { at: [0, 4.1, 0], color: P.gold });
  return b.build();
}

export function sternLanternGlass(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.5, 0.5, 1.25, 8, { at: [0, 2.45, 0], color: PALETTE.glowWarm });
  return b.build();
}

/** Flagstaff (the cloth is a separate animated mesh). Height ≈ 7 m, tilted aft. */
export function flagstaff(height: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.14, 0.2, height, 8, { at: [0, height / 2, 0], color: P.woodDark });
  b.sphere(0.32, 8, 6, { at: [0, height + 0.2, 0], color: P.gold });
  b.cylinder(0.35, 0.45, 0.4, 8, { at: [0, 0.2, 0], color: P.iron });
  return b.build();
}

/** Figurehead halo (glow): a sun ring + spikes that frames the figurehead. */
export function figureheadHalo(radius: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.torus(radius, radius * 0.08, 6, 28, { rot: [0, 0, 0], color: PALETTE.glowGold });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.cone(radius * 0.13, radius * 0.45, 4, { at: [Math.cos(a) * radius * 1.22, Math.sin(a) * radius * 1.22, 0], rot: [0, 0, a - Math.PI / 2], color: PALETTE.glowGold });
  }
  return b.build();
}

/** Ember speck (glow). */
export function ember(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.octa(0.35, { color: PALETTE.glowWarm });
  return b.build();
}

/** Unit glow strip (box 1 m long along Z) scaled per instance for rail trim. */
export function glowStrip(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.22, 0.22, 1, { color: PALETTE.glowGold });
  return b.build();
}

/** Unit gold trim bar (opaque) scaled per instance. */
export function trimBar(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.box(0.3, 0.3, 1, { color: P.gold });
  return b.build();
}

/** Crew pennant pole with a streamer (opaque parts); used on mast tops at tier 3+. */
export function mastCap(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.cylinder(0.25, 0.35, 0.6, 8, { at: [0, 0.3, 0], color: P.gold });
  b.sphere(0.4, 8, 6, { at: [0, 0.8, 0], color: P.gold });
  return b.build();
}
