import * as THREE from 'three';
import type { AmmoKind, ShipState, Vec3, WorldState } from '../../core/contracts';
import { getShipSpec } from '../../content';
import type { OceanSampler, SimulationEvent } from '../../simulation';

interface Puff {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

interface WakeTrail {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  contactFoam: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  points: THREE.Vector3[];
  lastPosition: THREE.Vector3;
  width: number;
}

export interface NavalFxViewOptions {
  projectileCapacity?: number;
  puffCapacity?: number;
  wakeSegments?: number;
  waveSampler?: OceanSampler;
}

/** Pooled projectile, smoke, splash, and persistent wake renderer. */
export class NavalFxView {
  readonly root = new THREE.Group();

  private readonly projectileMesh: THREE.InstancedMesh;
  private readonly trailMesh: THREE.InstancedMesh;
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly projectileCapacity: number;
  private readonly puffs: Puff[];
  private readonly wakeSegments: number;
  private readonly wakes = new Map<string, WakeTrail>();
  private readonly dummy = new THREE.Object3D();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private readonly projectileColor = new THREE.Color();
  private readonly damageSpawnTime = new Map<string, number>();
  private waveSampler?: OceanSampler;
  private lastTime = 0;

  constructor(scene: THREE.Scene, options: NavalFxViewOptions = {}) {
    this.root.name = 'naval-fx';
    scene.add(this.root);
    this.projectileCapacity = Math.max(24, options.projectileCapacity ?? 180);
    this.wakeSegments = Math.max(12, options.wakeSegments ?? 42);
    this.waveSampler = options.waveSampler;

    const projectileGeometry = new THREE.IcosahedronGeometry(0.42, 1);
    const projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.projectileMesh = new THREE.InstancedMesh(projectileGeometry, projectileMaterial, this.projectileCapacity);
    this.projectileMesh.name = 'pooled-projectiles';
    this.projectileMesh.frustumCulled = false;
    this.projectileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.projectileMesh);

    const trailGeometry = new THREE.CylinderGeometry(0.1, 0.3, 2.8, 5, 1, true);
    const trailMaterial = new THREE.MeshBasicMaterial({ color: 0xf6d79a, transparent: true, opacity: 0.68, depthWrite: false });
    this.trailMesh = new THREE.InstancedMesh(trailGeometry, trailMaterial, this.projectileCapacity);
    this.trailMesh.name = 'pooled-projectile-trails';
    this.trailMesh.frustumCulled = false;
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.trailMesh);

    const puffCapacity = Math.max(48, options.puffCapacity ?? 240);
    const puffGeometry = new THREE.IcosahedronGeometry(1, 1);
    const puffMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false });
    this.puffMesh = new THREE.InstancedMesh(puffGeometry, puffMaterial, puffCapacity);
    this.puffMesh.name = 'pooled-smoke-and-spray';
    this.puffMesh.frustumCulled = false;
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs = Array.from({ length: puffCapacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      size: 1,
      color: new THREE.Color(),
    }));
    this.root.add(this.puffMesh);
  }

  setWaveSampler(sampler: OceanSampler | undefined): void {
    this.waveSampler = sampler;
  }

  sync(state: WorldState, time = state.elapsed): void {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.syncProjectiles(state);
    this.spawnDamageSmoke(state, time);
    this.updatePuffs(dt);
    this.syncWakes(state, time);
  }

  consume(events: readonly SimulationEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'cannon-fired':
          this.spawnBurst(event.position, Math.min(14, event.count + 7), 0x2b2935, 2.15, 1.65, event.shipId.length);
          this.spawnBurst(event.position, 4, 0xffd66b, 1.6, 0.38, event.count);
          break;
        case 'projectile-impact':
          this.spawnBurst(event.position, event.ammo === 'explosive' ? 16 : 8, event.ammo === 'explosive' ? 0xff693f : 0x302735, 2.25, 1.15, event.projectileId);
          break;
        case 'water-impact':
          this.spawnBurst(event.position, event.projectileId === 0 ? 15 : 7, 0xeafaff, event.projectileId === 0 ? 2.8 : 1.4, 0.85, event.projectileId + 17);
          break;
        case 'ram':
          this.spawnBurst(event.position, 18, 0xf1e3c1, Math.min(4, 1.5 + event.force * 0.15), 1.05, event.attackerId.length + event.targetId.length);
          break;
        case 'special':
          this.spawnBurst(event.position, 24, 0x58efff, 3.5, 1.1, event.name.length);
          break;
        case 'repair':
          this.spawnBurst(event.position, 4, 0xf6dc77, 0.8, 0.65, event.shipId.length);
          break;
        case 'ship-disabled':
          this.spawnBurst(event.position, 26, 0x211f2a, 3.4, 2.2, event.shipId.length * 3);
          break;
        case 'checkpoint':
        case 'race-finished':
          break;
      }
    }
  }

  dispose(): void {
    for (const wake of this.wakes.values()) {
      wake.mesh.geometry.dispose();
      wake.mesh.material.dispose();
      wake.contactFoam.geometry.dispose();
      wake.contactFoam.material.dispose();
    }
    this.wakes.clear();
    this.projectileMesh.geometry.dispose();
    (this.projectileMesh.material as THREE.Material).dispose();
    this.trailMesh.geometry.dispose();
    (this.trailMesh.material as THREE.Material).dispose();
    this.puffMesh.geometry.dispose();
    (this.puffMesh.material as THREE.Material).dispose();
    this.root.removeFromParent();
  }

  private syncProjectiles(state: WorldState): void {
    const count = Math.min(this.projectileCapacity, state.projectiles.length);
    for (let index = 0; index < count; index += 1) {
      const projectile = state.projectiles[index];
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
      const scale = projectile.ammo === 'heavy' ? 1.45 : projectile.ammo === 'explosive' ? 1.22 : projectile.ammo === 'chain' ? 0.82 : 1;
      this.dummy.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.quaternion.identity();
      this.dummy.updateMatrix();
      this.projectileMesh.setMatrixAt(index, this.dummy.matrix);
      this.projectileColor.setHex(ammoColor(projectile.ammo));
      this.projectileMesh.setColorAt(index, this.projectileColor);

      this.direction.set(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z).normalize();
      this.dummy.position.set(
        projectile.position.x - this.direction.x * 1.8,
        projectile.position.y - this.direction.y * 1.8,
        projectile.position.z - this.direction.z * 1.8,
      );
      this.dummy.quaternion.setFromUnitVectors(this.up, this.direction);
      this.dummy.scale.set(1, Math.min(2.4, speed / 34), 1);
      this.dummy.updateMatrix();
      this.trailMesh.setMatrixAt(index, this.dummy.matrix);
    }
    this.projectileMesh.count = count;
    this.trailMesh.count = count;
    this.projectileMesh.instanceMatrix.needsUpdate = true;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.projectileMesh.instanceColor) this.projectileMesh.instanceColor.needsUpdate = true;
  }

  private updatePuffs(dt: number): void {
    let rendered = 0;
    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.active = false;
        continue;
      }
      puff.position.addScaledVector(puff.velocity, dt);
      puff.velocity.y += dt * 0.38;
      puff.velocity.multiplyScalar(Math.exp(-dt * 0.7));
      const age = 1 - puff.life / puff.maxLife;
      const size = puff.size * (0.5 + age * 1.6) * Math.sin(Math.min(Math.PI * 0.5, (1 - age) * Math.PI));
      this.dummy.position.copy(puff.position);
      this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(Math.max(0.01, size));
      this.dummy.updateMatrix();
      this.puffMesh.setMatrixAt(rendered, this.dummy.matrix);
      this.puffMesh.setColorAt(rendered, puff.color);
      rendered += 1;
    }
    this.puffMesh.count = rendered;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  private syncWakes(state: WorldState, time: number): void {
    const active = new Set<string>();
    for (const ship of state.ships) {
      active.add(ship.id);
      let wake = this.wakes.get(ship.id);
      if (!wake) {
        wake = this.createWake(ship);
        this.wakes.set(ship.id, wake);
        this.root.add(wake.mesh, wake.contactFoam);
      }
      const stern = this.sternPosition(ship);
      if (wake.points.length === 0 || wake.lastPosition.distanceToSquared(stern) > 1.7 * 1.7) {
        wake.points.unshift(stern);
        wake.lastPosition.copy(stern);
        if (wake.points.length > this.wakeSegments) wake.points.length = this.wakeSegments;
      } else if (wake.points[0]) {
        wake.points[0].copy(stern);
      }
      this.updateWakeGeometry(wake, ship, time);
    }
    for (const [id, wake] of this.wakes) {
      if (active.has(id)) continue;
      wake.mesh.geometry.dispose();
      wake.mesh.material.dispose();
      wake.contactFoam.geometry.dispose();
      wake.contactFoam.material.dispose();
      wake.contactFoam.removeFromParent();
      wake.mesh.removeFromParent();
      this.wakes.delete(id);
    }
  }

  private createWake(ship: ShipState): WakeTrail {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.wakeSegments * 2 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let index = 0; index < this.wakeSegments - 1; index += 1) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
    }
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshBasicMaterial({
      color: ship.isPlayer ? 0xeafdf5 : 0xd5f7f1,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `wake:${ship.id}`;
    mesh.frustumCulled = false;
    const spec = getShipSpec(ship.kind);
    const contactFoam = new THREE.Mesh(
      new THREE.RingGeometry(0.76, 1, 48),
      new THREE.MeshBasicMaterial({
        color: ship.isPlayer ? 0xfff9dc : 0xe6fbf6,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    contactFoam.name = `hull-contact-foam:${ship.id}`;
    contactFoam.rotation.order = 'YXZ';
    contactFoam.rotation.x = -Math.PI * 0.5;
    contactFoam.renderOrder = -4;
    contactFoam.frustumCulled = false;
    contactFoam.scale.set(spec.beam * 0.63, spec.length * 0.49, 1);
    return {
      mesh,
      contactFoam,
      points: [],
      lastPosition: new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0),
      width: spec.beam * 0.42,
    };
  }

  private updateWakeGeometry(wake: WakeTrail, ship: ShipState, time: number): void {
    const contactY = this.waveSampler?.sample(ship.position.x, ship.position.z, time).height ?? ship.position.y;
    wake.contactFoam.position.set(ship.position.x, contactY + 0.16, ship.position.z);
    wake.contactFoam.rotation.y = ship.heading;
    wake.contactFoam.material.opacity = 0.42 + Math.min(0.26, Math.abs(ship.speed) / Math.max(1, ship.maxSpeed) * 0.28);
    const positions = wake.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = wake.points.length;
    for (let index = 0; index < count; index += 1) {
      const point = wake.points[index];
      const previous = wake.points[Math.max(0, index - 1)] ?? point;
      const next = wake.points[Math.min(count - 1, index + 1)] ?? point;
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;
      const spread = wake.width * (0.52 + index / Math.max(1, this.wakeSegments - 1) * 1.4);
      const fadeNarrow = 1 - Math.pow(index / Math.max(1, count), 2) * 0.45;
      const sideX = -dz / length * spread * fadeNarrow;
      const sideZ = dx / length * spread * fadeNarrow;
      const waveY = this.waveSampler?.sample(point.x, point.z, time).height ?? point.y;
      positions.setXYZ(index * 2, point.x + sideX, waveY + 0.12, point.z + sideZ);
      positions.setXYZ(index * 2 + 1, point.x - sideX, waveY + 0.12, point.z - sideZ);
    }
    positions.needsUpdate = true;
    wake.mesh.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    wake.mesh.material.opacity = 0.22 + Math.min(0.5, Math.abs(ship.speed) / Math.max(1, ship.maxSpeed) * 0.55);
    wake.mesh.visible = Math.abs(ship.speed) > 0.8 && count > 1;
  }

  private sternPosition(ship: ShipState): THREE.Vector3 {
    const spec = getShipSpec(ship.kind);
    return new THREE.Vector3(
      ship.position.x + Math.sin(ship.heading) * spec.length * 0.48,
      ship.position.y,
      ship.position.z + Math.cos(ship.heading) * spec.length * 0.48,
    );
  }

  private spawnDamageSmoke(state: WorldState, time: number): void {
    for (const ship of state.ships) {
      if (ship.damage.hull < 0.56) continue;
      const previous = this.damageSpawnTime.get(ship.id) ?? -10;
      const interval = 0.68 - Math.min(0.4, ship.damage.hull * 0.42);
      if (time - previous < interval) continue;
      this.damageSpawnTime.set(ship.id, time);
      const position = { x: ship.position.x, y: ship.position.y + getShipSpec(ship.kind).draft * 0.9 + 2, z: ship.position.z };
      const severe = ship.damage.hull > 0.82;
      const layers = severe ? 3 : 1;
      for (let layer = 0; layer < layers; layer += 1) {
        this.spawnBurst(
          { x: position.x + layer * 0.35, y: position.y + layer * 2.15, z: position.z - layer * 0.3 },
          severe ? (layer === 0 ? 3 : 2) : 2,
          severe ? (layer === 2 ? 0x4b4654 : 0x181722) : 0x484250,
          0.95 + layer * 0.18,
          2.8 + layer * 0.35,
          Math.floor(time * 10) + ship.id.length + layer * 19,
        );
      }
    }
  }

  private spawnBurst(position: Vec3, count: number, color: number, speed: number, life: number, seed: number): void {
    for (let index = 0; index < count; index += 1) {
      const puff = this.puffs.find((candidate) => !candidate.active);
      if (!puff) return;
      const angle = pseudo(seed + index * 17) * Math.PI * 2;
      const lift = 0.35 + pseudo(seed + index * 31) * 0.9;
      const magnitude = speed * (0.45 + pseudo(seed + index * 47) * 0.75);
      puff.active = true;
      puff.position.set(position.x, position.y, position.z);
      puff.velocity.set(Math.cos(angle) * magnitude, lift * magnitude, Math.sin(angle) * magnitude);
      puff.maxLife = life * (0.7 + pseudo(seed + index * 61) * 0.6);
      puff.life = puff.maxLife;
      puff.size = 0.65 + pseudo(seed + index * 79) * 1.15;
      puff.color.setHex(color);
    }
  }
}

function ammoColor(ammo: AmmoKind): number {
  if (ammo === 'chain') return 0x8feaff;
  if (ammo === 'heavy') return 0x332b32;
  if (ammo === 'explosive') return 0xff653f;
  return 0x292735;
}

function pseudo(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}
