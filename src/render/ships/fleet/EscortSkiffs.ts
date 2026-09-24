/**
 * Escort skiffs (SHIPS-owned): the Escort Skiffs weapon's boats, rendered from HazardState kind 'escort-skiff'
 * (positions come from the sim). Until the sim spawns them — or if it never does — a cosmetic formation orbits the
 * player with the count implied by the weapon level, so the weapon is always visible. Player livery (accent stripe,
 * white sail). One InstancedMesh per hull half → 2 draw calls.
 */
import * as THREE from 'three';
import type { HazardState, WeaponSlot } from '../../../game/types';
import type { OceanServices } from '../../frame';
import { markInk } from '../../materials/toon';
import { buildShip, shipSpec } from './procShips';

const CAP = 12;
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpM = new THREE.Matrix4();

interface SkiffState { heading: number; seen: number; age: number }

export class EscortSkiffs {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private accent = -1;
  private readonly states = new Map<number, SkiffState>();
  private frame = 0;
  private readonly cosmetic: SkiffState[] = [];

  constructor(private readonly material: THREE.Material) { this.group.name = 'escort-skiffs'; }

  private ensure(accent: number): void {
    if (accent === this.accent) return;
    this.accent = accent;
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); }
    const built = buildShip(shipSpec('escort-skiff', accent)!);
    this.meshes = [built.fore, built.aft].map((g) => {
      const m = new THREE.InstancedMesh(g, this.material, CAP);
      m.frustumCulled = false; m.count = 0; m.visible = false; m.receiveShadow = true;
      m.name = 'escort-skiff';
      markInk(m);
      this.group.add(m);
      return m;
    });
    built.glow?.dispose();
  }

  private n = 0;

  private write(x: number, z: number, heading: number, age: number, time: number, ocean: OceanServices): void {
    if (this.n >= CAP) return;
    const h = ocean.heightAt(x, z);
    const hb = ocean.heightAt(x - Math.sin(heading) * 4, z - Math.cos(heading) * 4);
    const rise = Math.min(1, age / 0.5);
    tmpQ.setFromEuler(tmpE.set(Math.atan2(hb - h, 4) * 0.8, heading, Math.sin(time * 1.7 + x * 0.1) * 0.05, 'YXZ'));
    const s = 0.4 + 0.6 * (1 - Math.pow(1 - rise, 3));
    tmpM.compose(tmpP.set(x, h - (1 - rise) * 2, z), tmpQ, tmpS.set(s, s, s));
    for (const m of this.meshes) m.setMatrixAt(this.n, tmpM);
    this.n++;
  }

  update(dt: number, time: number, hazards: readonly HazardState[], player: { x: number; z: number; heading: number; weapons: readonly WeaponSlot[] } | null, heroLength: number, accent: number, ocean: OceanServices): void {
    this.frame++;
    this.n = 0;
    let real = 0;
    for (const h of hazards) if (h.alive && h.kind === 'escort-skiff') real++;
    let slot: WeaponSlot | undefined;
    if (player) for (const w of player.weapons) if (w.id === 'escort-skiffs') slot = w;
    if (real || slot) this.ensure(accent);
    for (const h of hazards) {
      if (!h.alive || h.kind !== 'escort-skiff') continue;
      let st = this.states.get(h.id);
      if (!st) { st = { heading: player?.heading ?? 0, seen: 0, age: 0 }; this.states.set(h.id, st); }
      st.seen = this.frame; st.age += dt;
      if (Math.hypot(h.vx, h.vz) > 0.5) {
        const target = Math.atan2(-h.vx, -h.vz);
        let d = target - st.heading;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        st.heading += d * Math.min(1, dt * 6);
      }
      this.write(h.x, h.z, st.heading, st.age, time, ocean);
    }
    for (const [id, st] of this.states) if (st.seen !== this.frame) this.states.delete(id);
    // Cosmetic formation when the sim has no skiff hazards yet.
    if (!real && slot && player) {
      const count = slot.overdrive ? 8 : ([0, 2, 2, 3, 3, 4, 4][Math.min(6, slot.level)] ?? 2) + (slot.branch === 'A' ? 2 : 0);
      while (this.cosmetic.length < count) this.cosmetic.push({ heading: 0, seen: 0, age: 0 });
      const R = heroLength * 0.75 + 12;
      for (let i = 0; i < count; i++) {
        const st = this.cosmetic[i]!;
        st.age += dt;
        const a = time * 0.32 + (i / count) * Math.PI * 2;
        const x = player.x + Math.cos(a) * R, z = player.z + Math.sin(a) * R;
        this.write(x, z, Math.atan2(Math.sin(a), -Math.cos(a)), st.age, time, ocean);
      }
      for (let i = count; i < this.cosmetic.length; i++) this.cosmetic[i]!.age = 0;
    } else for (const st of this.cosmetic) st.age = 0;
    const n = this.n;
    for (const m of this.meshes) {
      m.count = n; m.visible = n > 0;
      if (n) m.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void { for (const m of this.meshes) m.geometry.dispose(); }
}
