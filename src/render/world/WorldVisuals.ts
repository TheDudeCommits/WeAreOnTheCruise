/**
 * Island visuals (WORLD-owned). Streams meshes for islands near the focus from the shared IslandDef outlines.
 * Stub: extruded coastline with a toon material and a beach ring.
 */
import * as THREE from 'three';
import type { IslandDef } from '../../game/types';
import type { FrameContext, RenderHostHandles, RenderSystem } from '../frame';
import { createToonMaterial, markInk } from '../materials/toon';

const VIEW_RADIUS = 1400;

export class WorldVisuals implements RenderSystem {
  readonly name = 'world';
  private scene!: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly rock = createToonMaterial({ color: 0xc9b48f, name: 'island-rock' });
  private readonly grass = createToonMaterial({ color: 0x5fa35a, name: 'island-grass' });
  private readonly sand = createToonMaterial({ color: 0xf1dca2, name: 'island-sand' });
  private readonly near: IslandDef[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;

  init(host: RenderHostHandles): void { this.scene = host.scene; this.group.name = 'islands'; this.scene.add(this.group); }

  update(ctx: FrameContext): void {
    if (Math.hypot(ctx.focus.x - this.lastX, ctx.focus.z - this.lastZ) < 60) return;
    this.lastX = ctx.focus.x; this.lastZ = ctx.focus.z;
    ctx.world.islandsNear(ctx.focus.x, ctx.focus.z, VIEW_RADIUS, this.near);
    const keep = new Set(this.near.map((i) => i.id));
    for (const [id, mesh] of this.meshes) if (!keep.has(id)) { this.group.remove(mesh); dispose(mesh); this.meshes.delete(id); }
    for (const island of this.near) if (!this.meshes.has(island.id)) {
      const mesh = this.build(island);
      this.meshes.set(island.id, mesh);
      this.group.add(mesh);
    }
  }

  private build(island: IslandDef): THREE.Object3D {
    const root = new THREE.Group();
    const shape = new THREE.Shape(island.outline.map((p) => new THREE.Vector2(p.x - island.x, -(p.z - island.z))));
    const cliff = new THREE.ExtrudeGeometry(shape, { depth: island.height, bevelEnabled: true, bevelSize: 6, bevelThickness: 8, bevelSegments: 2, steps: 1 });
    cliff.rotateX(-Math.PI / 2);
    const cliffMesh = new THREE.Mesh(cliff, this.rock);
    cliffMesh.position.y = -4;
    const topShape = new THREE.ShapeGeometry(shape);
    topShape.rotateX(-Math.PI / 2);
    const top = new THREE.Mesh(topShape, this.grass);
    top.position.y = island.height + 4.2;
    top.scale.setScalar(0.92);
    const beachGeo = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: true, bevelSize: 14, bevelThickness: 2, bevelSegments: 1 });
    beachGeo.rotateX(-Math.PI / 2);
    const beach = new THREE.Mesh(beachGeo, this.sand);
    beach.position.y = -1.5;
    root.add(beach, cliffMesh, top);
    root.position.set(island.x, 0, island.z);
    root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    markInk(root);
    return root;
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) dispose(mesh);
    this.scene.remove(this.group);
    this.rock.dispose(); this.grass.dispose(); this.sand.dispose();
  }
}

function dispose(root: THREE.Object3D): void {
  root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}
