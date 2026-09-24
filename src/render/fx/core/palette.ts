/**
 * FX colour script. Authored in sRGB hex (Grand Line Cel: cool violet shadows, navy ink, warm lights),
 * converted once to linear floats for the shaders. HDR multipliers are applied in the shaders so
 * flash cores exceed 1.0 and bloom when the post stack is HDR.
 */
import * as THREE from 'three';

/** Cel palettes: [light, mid, shadow, ink] (fire: [core, inner, outer, rim]). */
export const CelPal = {
  Gunsmoke: 0, DarkSmoke: 1, Fire: 2, Water: 3, Dust: 4, Steam: 5, StormCloud: 6, TealFire: 7, Heal: 8, Foam: 9,
  FlareSmoke: 10, WreckSmoke: 11, EnemyFire: 12, GoldFire: 13, Rock: 14,
} as const;

const CEL_HEX: readonly (readonly [number, number, number, number])[] = [
  [0xfff7e6, 0xe7d8bb, 0x9993ab, 0x252a4a], // Gunsmoke (cream, cool violet shadow, navy ink)
  [0x86818c, 0x55505e, 0x2e2b37, 0x10111e], // DarkSmoke
  [0xfffbe0, 0xffd54a, 0xff7a1c, 0xc2301a], // Fire
  [0xffffff, 0xd4f3fc, 0x78c2e8, 0x2a6aa6], // Water
  [0xf5e3bc, 0xd9ba8a, 0x9d7e60, 0x4a392d], // Dust
  [0xffffff, 0xe9eef4, 0xb0bdd0, 0x56688a], // Steam
  [0x6d728c, 0x464b63, 0x262a3c, 0x0d0f1f], // StormCloud
  [0xeafffb, 0x8ff6e0, 0x2ccfae, 0x0f6a63], // TealFire (wraith)
  [0xf0fff4, 0xa4f7c4, 0x47c68d, 0x1b5a43], // Heal
  [0xffffff, 0xe8f8fc, 0xa2d2e3, 0x3a7ea8], // Foam / bubbles
  [0xffe1d8, 0xff9f8c, 0xc85c5e, 0x5a1d2c], // FlareSmoke
  [0x5c5862, 0x38353f, 0x1d1b24, 0x09090f], // WreckSmoke
  [0xfff0e0, 0xffa25a, 0xff3d2a, 0x8f1420], // EnemyFire (hotter red)
  [0xfffbe6, 0xffe27a, 0xffb52a, 0xb86a12], // GoldFire (sun / level-up)
  [0xd9d2c7, 0xa89d8f, 0x6f6660, 0x322c2c], // Rock chips / stone dust
];

/** Additive palettes: [core, mid, outer]. */
export const GlowPal = {
  Muzzle: 0, Explosion: 1, Spark: 2, Enemy: 3, Lightning: 4, WaterBolt: 5, Gold: 6, Heal: 7, Teal: 8, Glint: 9,
  Shield: 10, FlareRed: 11, Frenzy: 12, Magic: 13, Ember: 14,
} as const;

const GLOW_HEX: readonly (readonly [number, number, number])[] = [
  [0xffffff, 0xffe066, 0xff8a1a], // Muzzle
  [0xfffbe8, 0xffc53a, 0xff5a14], // Explosion
  [0xffffff, 0xffe9a0, 0xffa63a], // Spark
  [0xfff0e8, 0xff8a5a, 0xff2a2a], // Enemy
  [0xffffff, 0xc4ecff, 0x4fb4ff], // Lightning
  [0xffffff, 0xa0f4ff, 0x1fb4ff], // WaterBolt
  [0xfffbe0, 0xffd84a, 0xff9f1a], // Gold
  [0xf4fff6, 0x8dffb8, 0x22c47a], // Heal
  [0xf0fffc, 0x7ff5dc, 0x1fbfa4], // Teal
  [0xffffff, 0xfff6d8, 0xffe0a0], // Glint
  [0xffffff, 0xaee6ff, 0x3f9dff], // Shield
  [0xfff0f0, 0xff6a6a, 0xd11a2a], // FlareRed
  [0xfff4e0, 0xffb05a, 0xff5a2a], // Frenzy
  [0xf8f0ff, 0xc9a0ff, 0x7a4cff], // Magic
  [0xffe6b0, 0xff9a3a, 0xd9401a], // Ember
];

const tmp = new THREE.Color();

function toLinear(hexes: readonly (readonly number[])[]): Float32Array {
  const per = hexes[0]!.length;
  const out = new Float32Array(hexes.length * per * 3);
  let o = 0;
  for (const row of hexes) for (const hex of row) { tmp.setHex(hex); out[o++] = tmp.r; out[o++] = tmp.g; out[o++] = tmp.b; }
  return out;
}

export const CEL_PALETTE_LINEAR = toLinear(CEL_HEX);
export const GLOW_PALETTE_LINEAR = toLinear(GLOW_HEX);
export const CEL_PALETTE_COUNT = CEL_HEX.length;
export const GLOW_PALETTE_COUNT = GLOW_HEX.length;

/** Writes the linear RGB of an sRGB hex into out[o..o+2]. */
export function hexToLinear(hex: number, out: Float32Array, o: number): void {
  tmp.setHex(hex); out[o] = tmp.r; out[o + 1] = tmp.g; out[o + 2] = tmp.b;
}

/** Scratch linear colour holder for spawn calls (no allocation). */
export class Lin {
  r = 1; g = 1; b = 1;
  hex(h: number): this { tmp.setHex(h); this.r = tmp.r; this.g = tmp.g; this.b = tmp.b; return this; }
  set(r: number, g: number, b: number): this { this.r = r; this.g = g; this.b = b; return this; }
}

/** Frequently used linear colours. */
export const INK_HEX = 0x1b2340;
export const DANGER_HEX = 0xff3b30;
export const DANGER_DEEP_HEX = 0x7a0f14;
export const PLAYER_MARK_HEX = 0xffd76a;
