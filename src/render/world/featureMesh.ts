/**
 * Builds the render objects of one world feature at one LOD (WORLD-owned). A feature (island + satellites, a rock
 * cluster, an arch...) becomes ONE merged vertex-coloured mesh (terrain, canopy, rocks, vines, kit, piers, arch
 * bridge) plus small emissive meshes (windows/lanterns, lava) and a waterfall mesh when present. Trees, palms,
 * bushes and flags are returned as placements for the global instanced meshes.
 */
import * as THREE from 'three';
import type { IslandDef } from '../../game/types';
import type { WorldFeature } from '../../world/features';
import { planIsland, surfaceOf, type PropPlacement } from '../../world/plan';
import type { PaletteId } from '../../world/seas';
import { buildRingModel } from '../../world/surface';
import { appendKit, appendPier, type FlagInstance, type KitTargets } from './kit';
import { appendArchSpan, appendWaterfall, waterfallGeometry } from './landmarks';
import type { WorldMaterials } from './materials';
import { MeshBuilder } from './meshBuilder';
import { terrainPalette } from './palette';
import { appendTerrain } from './terrainGeometry';
import { appendCanopy, appendRocks, appendVines } from './vegetation';

export interface FeatureLod {
  lod: number;
  group: THREE.Group;
  triangles: number;
  /** Instanced props (world space) for this LOD. */
  props: PropPlacement[];
  flags: FlagInstance[];
  /** Waterfall bases (world XZ) for ocean foam stamps. */
  falls: { x: number; z: number; r: number }[];
  /** Lighthouse lamps (world) for night beams. */
  beacons: { x: number; y: number; z: number }[];
  dispose(): void;
}

export function isTerrainIsland(landmark: string | undefined): boolean {
  return landmark !== 'pier' && landmark !== 'breakwater';
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, name: string, shadows: boolean): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  m.matrixAutoUpdate = false;
  return m;
}

export function buildFeatureLod(feature: WorldFeature, lod: 0 | 1 | 2, mats: WorldMaterials, palette: PaletteId): FeatureLod {
  const group = new THREE.Group();
  group.name = `feature:${feature.id}:lod${lod}`;
  group.position.set(feature.x, 0, feature.z);
  const ox = feature.x, oz = feature.z;
  const solid = new MeshBuilder(16384);
  const t: KitTargets = { solid, lamp: new MeshBuilder(512), lava: new MeshBuilder(256), flags: [] };
  const water = new MeshBuilder(128);
  const props: PropPlacement[] = [];
  const falls: FeatureLod['falls'] = [];
  const beacons: FeatureLod['beacons'] = [];
  const land: IslandDef | undefined = feature.islands.find((i) => i.landmark === 'harbor') ?? feature.islands.find((i) => isTerrainIsland(i.landmark));

  for (const island of feature.islands) {
    if (!isTerrainIsland(island.landmark)) {
      appendPier(t, island, land?.x ?? island.x, land?.z ?? island.z, ox, oz, lod);
      continue;
    }
    const surface = surfaceOf(island);
    const pal = terrainPalette(palette, island.biome);
    appendTerrain(solid, buildRingModel(surface, lod), pal, ox, oz);
    const plan = planIsland(island, palette);
    appendCanopy(solid, plan.canopy, pal, ox, oz, lod);
    appendRocks(solid, plan.rocks, pal, ox, oz, lod);
    appendVines(solid, plan.vines, pal, ox, oz, lod);
    appendKit(t, plan.kit, ox, oz, lod, surface, pal);
    for (const fall of plan.waterfalls) {
      appendWaterfall(water, solid, fall, ox, oz, lod);
      const base = fall.points[fall.points.length - 1]!;
      falls.push({ x: base.x + fall.nx * 2, z: base.z + fall.nz * 2, r: fall.width });
    }
    for (const k of plan.kit) if (k.kind === 'lighthouse') beacons.push({ x: k.x, y: k.y + k.h + 2.3, z: k.z });
    if (lod < 2) {
      for (const p of plan.props) {
        // Mid distance: keep the silhouette makers, drop the small stuff.
        if (lod === 1 && (p.kind === 'bush' || p.scale < 0.95)) continue;
        props.push(p);
      }
    }
  }
  if (feature.arch) {
    const pillar = feature.islands.find((i) => i.landmark === 'arch');
    if (pillar) {
      const s = surfaceOf(pillar);
      appendArchSpan(solid, feature.arch, s.shape.spec.faceDistance ?? pillar.radius * 0.7, s.shape, terrainPalette(palette, pillar.biome), ox, oz, lod);
    }
  }

  const geometries: THREE.BufferGeometry[] = [];
  let triangles = 0;
  const shadows = lod < 2;
  if (!solid.empty) {
    const geo = solid.toGeometry();
    geometries.push(geo);
    triangles += solid.iCount / 3;
    group.add(mesh(geo, mats.terrain, 'terrain', shadows));
  }
  if (!t.lamp.empty) {
    const geo = t.lamp.toGeometry();
    geometries.push(geo);
    triangles += t.lamp.iCount / 3;
    group.add(mesh(geo, mats.lamp, 'lamps', false));
  }
  if (!t.lava.empty) {
    const geo = t.lava.toGeometry();
    geometries.push(geo);
    triangles += t.lava.iCount / 3;
    group.add(mesh(geo, mats.lava, 'lava', false));
  }
  if (!water.empty) {
    const geo = waterfallGeometry(water);
    geometries.push(geo);
    triangles += water.iCount / 3;
    const m = mesh(geo, mats.waterfall, 'waterfalls', false);
    m.renderOrder = 2;
    group.add(m);
  }
  for (const child of group.children) child.updateMatrix();
  group.updateMatrixWorld(true);
  return {
    lod, group, triangles, props, flags: t.flags.map((f) => ({ ...f, x: f.x + ox, z: f.z + oz })), falls, beacons,
    dispose: () => { for (const g of geometries) g.dispose(); },
  };
}
