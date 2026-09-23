/**
 * Effects (FX-owned; RenderSystem surface is contract): projectiles, pickups, hazards, telegraph decals,
 * explosions, muzzle flashes, splashes, smoke, fire, debris, lightning, damage numbers — everything driven by
 * RunState + SimEvents. Stub: instanced spheres for projectiles/pickups, rings for telegraphs, puffs for events.
 */
import * as THREE from 'three';
import type { PickupKind } from '../../game/ids';
import type { FrameContext, RenderHostHandles, RenderSystem } from '../frame';

const MAX_PROJECTILES = 1600;
const MAX_PICKUPS = 900;
const MAX_PUFFS = 256;
const MAX_RINGS = 96;

const PICKUP_COLORS: Record<PickupKind, number> = {
  'xp-copper': 0xd9844a, 'xp-silver': 0xdfe8ef, 'xp-gold': 0xffd24a, doubloon: 0xffc83a, repair: 0x62e38b,
  compass: 0x7fd6ff, 'powder-keg': 0x2b2b2b, chest: 0xb86b2a,
};

export class FxSystem implements RenderSystem {
  readonly name = 'fx';
  private scene!: THREE.Scene;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly projectiles: THREE.InstancedMesh;
  private readonly pickups: THREE.InstancedMesh;
  private readonly puffs: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly puffState: { x: number; y: number; z: number; age: number; life: number; size: number; color: number }[] = [];

  constructor() {
    this.projectiles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1b1b24 }), MAX_PROJECTILES);
    this.pickups = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1.4, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_PICKUPS);
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), MAX_PUFFS);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }), MAX_RINGS);
    for (const mesh of [this.projectiles, this.pickups, this.puffs, this.rings]) { mesh.count = 0; mesh.frustumCulled = false; }
  }

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.scene.add(this.projectiles, this.pickups, this.puffs, this.rings);
  }

  update(ctx: FrameContext): void {
    for (const e of ctx.events) {
      switch (e.type) {
        case 'weapon-fired': this.puff(e.x + e.dirX * 8, 4, e.z + e.dirZ * 8, 5, 0xf5f0e6, 0.6); break;
        case 'projectile-hit': this.puff(e.x, Math.max(1, e.y), e.z, e.target === 'water' ? 3 : 4, e.target === 'water' ? 0xe8fbff : 0xffb36b, 0.5); break;
        case 'explosion': this.puff(e.x, 2, e.z, e.radius * 0.8, 0xffa24a, 0.7); break;
        case 'enemy-killed': this.puff(e.x, 3, e.z, 14, 0x3a3a3a, 1.4); break;
        case 'player-hit': ctx.services.camera.shake(Math.min(1, e.amount / 30)); break;
        default: break;
      }
    }
    const run = ctx.run;
    let n = 0;
    if (run) for (const p of run.projectiles) {
      if (!p.alive || n >= MAX_PROJECTILES) continue;
      const s = p.kind.includes('mortar') || p.kind === 'boss-shell' ? 1.6 : 1;
      this.matrix.makeScale(s, s, s).setPosition(p.x, p.y, p.z);
      this.projectiles.setMatrixAt(n++, this.matrix);
    }
    this.projectiles.count = n; this.projectiles.instanceMatrix.needsUpdate = true;

    n = 0;
    if (run) for (const k of run.pickups) {
      if (!k.alive || n >= MAX_PICKUPS) continue;
      const bob = Math.sin(ctx.time * 3 + k.id) * 0.6;
      const s = k.kind === 'chest' ? 3 : k.kind === 'xp-gold' ? 1.6 : 1;
      this.matrix.makeRotationY(ctx.time * 2 + k.id).scale(new THREE.Vector3(s, s, s)).setPosition(k.x, 2.2 + bob, k.z);
      this.pickups.setMatrixAt(n, this.matrix);
      this.pickups.setColorAt(n++, this.color.setHex(PICKUP_COLORS[k.kind]));
    }
    this.pickups.count = n; this.pickups.instanceMatrix.needsUpdate = true;
    if (this.pickups.instanceColor) this.pickups.instanceColor.needsUpdate = true;

    n = 0;
    if (run) for (const t of run.telegraphs) {
      if (!t.alive || n >= MAX_RINGS) continue;
      const r = t.radius * (0.4 + 0.6 * Math.min(1, t.time / t.duration));
      this.matrix.makeScale(r, 1, r).setPosition(t.x, 0.6, t.z);
      this.rings.setMatrixAt(n++, this.matrix);
    }
    this.rings.count = n; this.rings.instanceMatrix.needsUpdate = true;

    n = 0;
    for (let i = this.puffState.length - 1; i >= 0; i--) {
      const puff = this.puffState[i]!;
      puff.age += ctx.dt;
      if (puff.age >= puff.life) { this.puffState.splice(i, 1); continue; }
    }
    for (const puff of this.puffState) {
      if (n >= MAX_PUFFS) break;
      const k = puff.age / puff.life;
      const s = puff.size * (0.5 + k);
      this.matrix.makeScale(s, s, s).setPosition(puff.x, puff.y + k * 4, puff.z);
      this.puffs.setMatrixAt(n, this.matrix);
      this.puffs.setColorAt(n++, this.color.setHex(puff.color));
    }
    this.puffs.count = n; this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
  }

  private puff(x: number, y: number, z: number, size: number, color: number, life: number): void {
    if (this.puffState.length >= MAX_PUFFS) this.puffState.shift();
    this.puffState.push({ x, y, z, age: 0, life, size, color });
  }

  dispose(): void {
    for (const mesh of [this.projectiles, this.pickups, this.puffs, this.rings]) {
      this.scene.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
    }
  }
}
