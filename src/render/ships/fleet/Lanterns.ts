/**
 * Stern lanterns and the faction map (SEA & LIGHT, round 2): enemy readability at night, in storms and in fog.
 *
 * Every frame, for each live enemy:
 *   - the faction map (materials/faction.ts) gets its exact centre and faction, so the instanced cel shader lights a
 *     faction rim on that instance and lifts its albedo (+0.3 EV at night);
 *   - one instanced lantern glow sits on its stern anchor (ShipServices.anchor), in its faction colour: Admiralty
 *     gold, Redtide red, Gloam teal, Deep green. One draw call for the whole horde; camera-facing, HDR (blooms),
 *     never smaller than a few pixels, fogged only partly (a lantern is what you see through fog). Unlit by day.
 * Wisps are lanterns already and kraken arms have no stern: both only go into the faction map.
 * It also applies the boss looks (ships/materials.ts BOSS_LOOKS: the Sovereign's contrast) once per new boss root.
 *
 * Mount (ShipSystem.update, after the fleet): `lanternsFor(this).update(ctx);` — one line. The lanterns live under
 * the fleet group and dispose themselves when that group is cleared. No per-frame allocations.
 */
import * as THREE from 'three';
import type { EnemyState } from '../../../game/types';
import type { FrameContext } from '../../frame';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from '../../materials/atmosphere';
import { FACTION_COLORS, FACTION_SLOT, factionMap } from '../../materials/faction';
import { markInkSkip } from '../../materials/toon';
import { applyBossLook } from '../materials';

const CAPACITY = 160;
/** Lantern height above the stern anchor (m) and glow radius (m). */
const LIFT = 1.6;
const RADIUS = 2.4;

const VERTEX = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform float uViewportH;
uniform float uMinPx;
varying vec2 vUv;
varying vec3 vGlow;
varying float vFog;
void main() {
	vec4 centre = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 mv = viewMatrix * centre;
	float dist = max( -mv.z, 1.0 );
	// World radius, but never under uMinPx pixels on screen (distant lanterns stay countable dots).
	float pxPerMetre = projectionMatrix[ 1 ][ 1 ] * uViewportH * 0.5 / dist;
	float r = max( length( instanceMatrix[ 0 ].xyz ), uMinPx / pxPerMetre );
	// Pull the card toward the camera so the hull it hangs from never clips it.
	mv.xyz += normalize( -mv.xyz ) * min( r * 1.5, 4.0 );
	mv.xy += position.xy * r * 2.0;
	vUv = position.xy * 2.0;
	vGlow = instanceColor;
	// Lanterns cut through fog: only part of the aerial perspective applies.
	vFog = cruiseFogFactor( dist ) * 0.55;
	gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying vec3 vGlow;
varying float vFog;
void main() {
	float d = length( vUv );
	if ( d > 1.0 ) discard;
	float halo = pow( 1.0 - d, 2.4 );
	float core = 1.0 - smoothstep( 0.1, 0.24, d );
	vec3 col = vGlow * ( halo * 0.7 + core * 2.4 ) * ( 1.0 - vFog );
	gl_FragColor = vec4( col, 1.0 );
}
`;

const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

export class Lanterns {
  readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly colors: Float32Array;
  private disposed = false;
  private readonly styled = new WeakSet<THREE.Object3D>();
  /** Lanterns drawn last frame (QA). */
  count = 0;

  constructor(parent: THREE.Object3D, private readonly bosses: THREE.Object3D | null = null) {
    this.material = new THREE.ShaderMaterial({
      name: 'ships:stern-lanterns',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { ...atmosphereUniforms, uViewportH: { value: 900 }, uMinPx: { value: 4.5 } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geometry, this.material, CAPACITY);
    this.mesh.name = 'enemy-lanterns';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 6;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.colors = new Float32Array(CAPACITY * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markInkSkip(this.mesh);
    parent.add(this.mesh);
    // The fleet group is cleared on dispose: take the GPU resources with it.
    this.mesh.addEventListener('removed', () => this.dispose());
  }

  update(ctx: FrameContext): void {
    if (this.disposed) return;
    const roots = this.bosses?.children;
    if (roots) for (let i = 0; i < roots.length; i++) {
      const root = roots[i]!;
      if (!this.styled.has(root)) { this.styled.add(root); applyBossLook(root); }
    }
    const map = factionMap();
    map.begin(ctx.focus.x, ctx.focus.z);
    const enemies: readonly EnemyState[] = ctx.run?.enemies ?? NONE;
    // Lanterns are lit at night, in storms and in fog: the same strength as the faction rim (SkySystem).
    const lit = atmosphereUniforms.uCruiseFactionRim.value.x;
    const ships = ctx.services.ships;
    let n = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      if (e.life === 'dead') continue;
      const slot = FACTION_SLOT[e.faction] ?? -1;
      if (slot < 0) continue;
      const smoked = e.ai.smoke === 1 && e.life === 'alive';
      const hidden = smoked ? Math.max(e.ai.fade ?? 0, e.ai.sub ?? 0) : e.hidden;
      const sinking = e.life === 'sinking' ? Math.min(1, e.sink * 1.6) : 0;
      const strength = (1 - Math.min(1, hidden)) * (1 - sinking) * (smoked ? 0.4 : 1);
      if (strength <= 0.01) continue;
      map.add(e.x, e.z, slot, strength);
      if (lit <= 0.02 || n >= CAPACITY || e.defId === 'lantern-wisp' || e.defId === 'kraken-arm') continue;
      if (!ships.anchor(e.id, 'stern', tmpV)) continue;
      const r = RADIUS * (0.8 + 0.2 * Math.min(1, e.length / 30));
      tmpM.makeScale(r, r, r).setPosition(tmpV.x, tmpV.y + LIFT, tmpV.z);
      this.mesh.setMatrixAt(n, tmpM);
      const c = FACTION_COLORS[slot]!;
      const k = lit * strength;
      tmpC.setRGB(c.x * k, c.y * k, c.z * k);
      this.mesh.setColorAt(n, tmpC);
      n++;
    }
    map.commit();
    this.count = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
      this.material.uniforms.uViewportH!.value = Math.max(1, ctx.viewport.height * ctx.viewport.dpr);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const NONE: readonly EnemyState[] = [];
const byOwner = new WeakMap<object, Lanterns>();

/** The lanterns of a ship system (created on first use under its fleet group). */
export function lanternsFor(ships: { readonly fleet: { readonly group: THREE.Object3D }; readonly bosses?: { readonly group: THREE.Object3D } }): Lanterns {
  let lanterns = byOwner.get(ships);
  if (!lanterns) {
    lanterns = new Lanterns(ships.fleet.group, ships.bosses?.group ?? null);
    byOwner.set(ships, lanterns);
  }
  return lanterns;
}
