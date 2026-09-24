/**
 * Ocean lab: a fixed two-island world implementing the WorldQuery contract (uses the same polygon signed
 * distance as src/world/IslandField), plus simple island meshes for context.
 */
import * as THREE from 'three';
import type { CircleHit, IslandDef, Vec2, WorldQuery } from '../../../game/types';
import { signedDistance } from '../../../world/IslandField';

function makeIsland(id: string, x: number, z: number, radius: number, seed: number): IslandDef {
  const outline: Vec2[] = [];
  const points = 40;
  let maxR = 0;
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const r = radius * (1 + 0.16 * Math.sin(a * 2 + seed) + 0.08 * Math.sin(a * 5 + seed * 1.7) + 0.04 * Math.sin(a * 9 + seed * 2.3));
    maxR = Math.max(maxR, r);
    outline.push({ x: x + Math.sin(a) * r, z: z + Math.cos(a) * r });
  }
  return { id, x, z, radius: maxR, outline, height: 40, biome: 'tropical', seed };
}

export class LabWorld implements WorldQuery {
  readonly seed = 'ocean-lab';
  readonly islands: IslandDef[] = [makeIsland('lab-a', 420, -380, 95, 3), makeIsland('lab-b', -520, 420, 64, 7)];

  islandsNear(x: number, z: number, radius: number, out: IslandDef[] = []): IslandDef[] {
    out.length = 0;
    for (const island of this.islands) if (Math.hypot(island.x - x, island.z - z) <= island.radius + radius) out.push(island);
    return out;
  }

  collideCircle(x: number, z: number, radius: number): CircleHit {
    for (const island of this.islands) {
      const d = signedDistance(island.outline, x, z);
      if (d.distance < radius) return { hit: true, nx: d.nx, nz: d.nz, depth: radius - d.distance, islandId: island.id };
    }
    return { hit: false, nx: 0, nz: 0, depth: 0 };
  }

  isWater(x: number, z: number, margin: number): boolean {
    for (const island of this.islands) if (signedDistance(island.outline, x, z).distance < margin) return false;
    return true;
  }

  shoreDistance(x: number, z: number, max: number): number {
    let best = max;
    for (const island of this.islands) {
      if (Math.hypot(island.x - x, island.z - z) > island.radius + max) continue;
      best = Math.min(best, signedDistance(island.outline, x, z).distance);
    }
    return best;
  }
}

/** Beach ring + rocky extruded body + grass cap (context only). */
export function buildIslandMesh(island: IslandDef): THREE.Group {
  const group = new THREE.Group();
  const shape = (scale: number) => {
    const s = new THREE.Shape();
    island.outline.forEach((p, i) => {
      const x = island.x + (p.x - island.x) * scale;
      const z = island.z + (p.z - island.z) * scale;
      if (i === 0) s.moveTo(x, -z); else s.lineTo(x, -z);
    });
    return s;
  };
  const extrude = (scale: number, depth: number, y: number, color: number) => {
    const geometry = new THREE.ExtrudeGeometry(shape(scale), { depth, bevelEnabled: false, curveSegments: 1 });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, y, 0);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color }));
    group.add(mesh);
  };
  extrude(1.0, 4.5, -3, 0xf1dca2);
  extrude(0.82, island.height * 0.45, -2, 0xc9b48f);
  extrude(0.62, island.height * 0.62, -2, 0x5fa35a);
  return group;
}
