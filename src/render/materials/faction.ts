/**
 * Faction light (SEA & LIGHT, round 2): night/storm readability for instanced enemy fleets.
 *
 * Instanced enemy hulls share non-tintable toon materials (EnemyFleet's per-instance colour is a plain multiply), so
 * a per-instance faction cannot come from the material. Instead a small world-space map records, for every enemy,
 * its exact centre and faction; the cel vertex shader (celMaterial.ts, instanced variants only) looks up its own
 * instance origin there and, on an exact match, lights a faction rim and lifts the albedo (+0.3 EV at night).
 * Any mesh, LOD or material the fleet uses gets it, and nothing else can match by accident (positions must agree
 * to 0.3 m). The same colours drive the stern lanterns (ships/fleet/Lanterns.ts).
 *
 * Layout: N×N RGBA32F texels over a focus-centred window of N × CELL metres. Texel = (x − originX, z − originZ,
 * faction id + 1, strength 0..1); an occupied home cell spills into its 8 neighbours (the shader checks all 9).
 * The colours are normalised to one luminance so a red rim is as bright as a gold one (and always brighter than
 * the bioluminescent wake, whose peak stays near half of it: ocean/OceanLook.ts).
 */
import * as THREE from 'three';
import type { Faction } from '../../game/ids';

export const FACTION_MAP_SIZE = 64;
export const FACTION_CELL = 16;

/** Faction slots in the map / colour array. The player's faction has no slot. */
export const FACTION_SLOT: Readonly<Record<Faction, number>> = { player: -1, admiralty: 0, corsair: 1, wraith: 2, deep: 3 };

/** Luminance every faction colour is normalised to (linear HDR, before the night/storm strength). */
export const FACTION_LUMINANCE = 1;

function normalised(hex: number): THREE.Vector3 {
  const c = new THREE.Color(hex);
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  const k = FACTION_LUMINANCE / Math.max(l, 1e-4);
  return new THREE.Vector3(c.r * k, c.g * k, c.b * k);
}

/** Admiralty gold, Redtide red, Gloam teal, Deep green (linear, equal luminance). */
export const FACTION_COLORS: readonly THREE.Vector3[] = [
  normalised(0xffc23d),
  normalised(0xff4a36),
  normalised(0x33ffd8),
  normalised(0x86ff52),
];

/** Shared uniforms (added to atmosphereUniforms, so every cel material sees one map). */
export const factionUniforms = {
  uCruiseFactionMap: { value: null as THREE.DataTexture | null },
  /** origin.x, origin.z, 1 / cell, N. */
  uCruiseFactionRect: { value: new THREE.Vector4(0, 0, 1 / FACTION_CELL, FACTION_MAP_SIZE) },
  /** x: rim strength (0 by day, night/storm/fog), y: albedo exposure multiplier for matched enemies, z: rim edge. */
  uCruiseFactionRim: { value: new THREE.Vector4(0, 1, 0.6, 0) },
  uCruiseFactionColors: { value: FACTION_COLORS as THREE.Vector3[] },
};

/** Vertex-stage lookup (instanced cel variants). */
export const FACTION_VERTEX_GLSL = /* glsl */ `
#ifndef CRUISE_FACTION
#define CRUISE_FACTION
uniform highp sampler2D uCruiseFactionMap;
uniform vec4 uCruiseFactionRect;
uniform vec4 uCruiseFactionRim;
uniform vec3 uCruiseFactionColors[4];
const ivec2 CRUISE_FACTION_PROBE[9] = ivec2[9](
	ivec2( 0, 0 ), ivec2( 1, 0 ), ivec2( -1, 0 ), ivec2( 0, 1 ), ivec2( 0, -1 ),
	ivec2( 1, 1 ), ivec2( -1, 1 ), ivec2( 1, -1 ), ivec2( -1, -1 )
);
/** rgb = faction colour × strength, a = 1 on a match (0 otherwise). */
vec4 cruiseFactionAt( vec2 worldXZ ) {
	vec2 local = worldXZ - uCruiseFactionRect.xy;
	ivec2 home = ivec2( floor( local * uCruiseFactionRect.z ) );
	int n = int( uCruiseFactionRect.w );
	for ( int k = 0; k < 9; k ++ ) {
		ivec2 q = home + CRUISE_FACTION_PROBE[ k ];
		if ( q.x < 0 || q.y < 0 || q.x >= n || q.y >= n ) continue;
		vec4 t = texelFetch( uCruiseFactionMap, q, 0 );
		if ( t.z > 0.5 && abs( t.x - local.x ) < 0.3 && abs( t.y - local.y ) < 0.3 ) {
			int f = clamp( int( t.z + 0.5 ) - 1, 0, 3 );
			return vec4( uCruiseFactionColors[ f ] * t.w, 1.0 );
		}
	}
	return vec4( 0.0 );
}
#endif
`;

/**
 * CPU writer for the map. Allocation-free: touched texels are remembered and cleared on the next begin().
 * One instance per renderer is enough; `factionMap()` returns the shared one.
 */
export class FactionMap {
  readonly texture: THREE.DataTexture;
  private readonly data: Float32Array;
  private readonly touched: Int32Array;
  private touchedCount = 0;
  private originX = 0;
  private originZ = 0;
  private dirty = true;
  /** Enemies written this frame (QA). */
  count = 0;
  /** Enemies that found no free cell (QA; should stay 0). */
  dropped = 0;

  constructor() {
    const n = FACTION_MAP_SIZE;
    this.data = new Float32Array(n * n * 4);
    this.touched = new Int32Array(n * n);
    this.texture = new THREE.DataTexture(this.data, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.name = 'cruise-faction-map';
    this.texture.needsUpdate = true;
  }

  /** Clears last frame's entries and re-centres the window on the focus (snapped to cells). */
  begin(focusX: number, focusZ: number): void {
    const d = this.data;
    for (let i = 0; i < this.touchedCount; i++) {
      const o = this.touched[i]! * 4;
      d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
    }
    if (this.touchedCount > 0) this.dirty = true;
    this.touchedCount = 0;
    this.count = 0;
    this.dropped = 0;
    const half = (FACTION_MAP_SIZE * FACTION_CELL) / 2;
    this.originX = Math.floor((focusX - half) / FACTION_CELL) * FACTION_CELL;
    this.originZ = Math.floor((focusZ - half) / FACTION_CELL) * FACTION_CELL;
  }

  /** Records one enemy centre (the exact x/z its instance matrix uses). Returns false when it has no free cell. */
  add(x: number, z: number, slot: number, strength: number): boolean {
    if (slot < 0 || strength <= 0.001) return false;
    const n = FACTION_MAP_SIZE;
    const lx = x - this.originX;
    const lz = z - this.originZ;
    const hi = Math.floor(lx / FACTION_CELL);
    const hj = Math.floor(lz / FACTION_CELL);
    const d = this.data;
    for (let k = 0; k < 9; k++) {
      const i = hi + PROBE_X[k]!;
      const j = hj + PROBE_Z[k]!;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const cell = j * n + i;
      const o = cell * 4;
      if (d[o + 2]! > 0.5) continue;
      d[o] = lx; d[o + 1] = lz; d[o + 2] = slot + 1; d[o + 3] = Math.min(1, strength);
      this.touched[this.touchedCount++] = cell;
      this.count++;
      this.dirty = true;
      return true;
    }
    this.dropped++;
    return false;
  }

  /** Publishes the window and uploads the texture when it changed. */
  commit(): void {
    factionUniforms.uCruiseFactionRect.value.set(this.originX, this.originZ, 1 / FACTION_CELL, FACTION_MAP_SIZE);
    if (this.dirty) { this.texture.needsUpdate = true; this.dirty = false; }
  }

  dispose(): void { this.texture.dispose(); }
}

/** Same probe order as CRUISE_FACTION_PROBE in the shader. */
const PROBE_X = [0, 1, -1, 0, 0, 1, -1, 1, -1];
const PROBE_Z = [0, 0, 0, 1, -1, 1, 1, -1, -1];

let shared: FactionMap | null = null;
/** The shared map (created on first use and bound to the faction uniforms). */
export function factionMap(): FactionMap {
  if (!shared) {
    shared = new FactionMap();
    factionUniforms.uCruiseFactionMap.value = shared.texture;
    // QA handle: window.__FACTION__.map.count (enemies written this frame), .uniforms (rim strength/exposure/edge).
    if (typeof window !== 'undefined') (window as unknown as { __FACTION__?: unknown }).__FACTION__ = { map: shared, uniforms: factionUniforms };
  }
  return shared;
}

/** Binds an empty map so shaders always have a valid texture (called by ensureAtmosphereResources). */
export function ensureFactionResources(): void { factionMap(); }
