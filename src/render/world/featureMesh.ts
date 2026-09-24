/**
 * Builds the render objects of one world feature at one LOD (WORLD-owned). A feature (island + satellites, a rock
 * cluster, an arch...) becomes one merged terrain+kit mesh plus optional glow meshes, so draw calls scale with
 * features, not islands or props.
 */
import * as THREE from 'three';
import type { WorldFeature } from '../../world/features';
import { buildRingModel, IslandSurface } from '../../world/surface';
import type { PaletteId } from '../../world/seas';
import { MeshBuilder } from './meshBuilder';
import { terrainPalette } from './palette';
import { appendTerrain } from './terrainGeometry';
import type { WorldMaterials } from './materials';

export interface FeatureLod {
  lod: number;
  group: THREE.Group;
  triangles: number;
  dispose(): void;
}

export function isTerrainIsland(landmark: string | undefined): boolean {
  return landmark !== 'pier' && landmark !== 'breakwater';
}

export function buildFeatureLod(feature: WorldFeature, lod: 0 | 1 | 2, mats: WorldMaterials, palette: PaletteId): FeatureLod {
  const group = new THREE.Group();
  group.name = `feature:${feature.id}:lod${lod}`;
  group.position.set(feature.x, 0, feature.z);
  const terrain = new MeshBuilder(8192);
  for (const island of feature.islands) {
    if (!isTerrainIsland(island.landmark)) continue;
    const surface = new IslandSurface(island);
    appendTerrain(terrain, buildRingModel(surface, lod), terrainPalette(palette, island.biome), feature.x, feature.z);
  }
  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0;
  if (!terrain.empty) {
    const geo = terrain.toGeometry();
    geometries.push(geo);
    triangles += terrain.iCount / 3;
    const mesh = new THREE.Mesh(geo, mats.terrain);
    mesh.name = 'terrain';
    mesh.castShadow = lod < 2;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  return {
    lod, group, triangles,
    dispose: () => { for (const g of geometries) g.dispose(); },
  };
}
