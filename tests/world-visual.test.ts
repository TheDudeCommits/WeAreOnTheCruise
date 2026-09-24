import { describe, expect, it } from 'vitest';
import type { IslandDef } from '../src/game/types';
import { appendArchSpan } from '../src/render/world/landmarks';
import { buildShowcaseWorld } from '../src/render/world/lab/showcase';
import { MeshBuilder } from '../src/render/world/meshBuilder';
import { terrainPalette } from '../src/render/world/palette';
import { appendTerrain } from '../src/render/world/terrainGeometry';
import { CELL, IslandField, type WorldFeature } from '../src/world/IslandField';
import { harborSetFeatures } from '../src/world/harborSet';
import { planIsland, ROCK_EXTENT, surfaceOf } from '../src/world/plan';
import { pointInPolygon, signedDistanceValue } from '../src/world/polygon';
import { buildRingModel, OVERHANG } from '../src/world/surface';

const terrainIslands = (fs: readonly WorldFeature[]) => fs.flatMap((f) => f.islands.filter((i) => i.landmark !== 'pier'));

function sampleFeatures(): WorldFeature[] {
  const out: WorldFeature[] = [...buildShowcaseWorld().features.values(), ...harborSetFeatures()];
  for (const seed of ['vis-a', 'vis-b']) {
    const field = new IslandField(seed);
    for (let cx = -3; cx < 3; cx++) for (let cz = -3; cz < 3; cz++) { const f = field.cellFeature(cx, cz); if (f) out.push(f); }
  }
  return out;
}

/** Points where terrain triangles cross the plane y = h. */
function sliceAt(b: MeshBuilder, h: number): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  const p = b.pos;
  for (let t = 0; t < b.iCount; t += 3) {
    const ids = [b.idx[t]!, b.idx[t + 1]!, b.idx[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const a = ids[e]! * 3, c = ids[(e + 1) % 3]! * 3;
      const ya = p[a + 1]! - h, yc = p[c + 1]! - h;
      if ((ya < 0 && yc > 0) || (ya > 0 && yc < 0)) {
        const k = ya / (ya - yc);
        pts.push({ x: p[a]! + (p[c]! - p[a]!) * k, z: p[a + 2]! + (p[c + 2]! - p[a + 2]!) * k });
      } else if (ya === 0) pts.push({ x: p[a]!, z: p[a + 2]! });
    }
  }
  return pts;
}

describe('world: visuals agree with collision', () => {
  const features = sampleFeatures();
  const islands = terrainIslands(features);

  it('uses the collision polygon itself as the LOD0 waterline ring', () => {
    for (const island of islands) {
      const model = buildRingModel(surfaceOf(island), 0);
      const water = model.sections[0]!.rings.find((r) => r.role === 'water')!;
      expect(model.n).toBe(island.outline.length);
      for (let j = 0; j < model.n; j++) {
        const p = island.outline[model.index[j]!]!;
        const x = island.x + model.sin[j]! * water.r[j]!, z = island.z + model.cos[j]! * water.r[j]!;
        expect(Math.hypot(x - p.x, z - p.z)).toBeLessThan(1e-3);
        expect(water.y[j]).toBe(0);
      }
    }
  });

  it('meets the sea exactly at the coastline (terrain sliced at y = 0 lies on the polygon)', () => {
    let checked = 0;
    for (const island of islands) {
      const b = new MeshBuilder(4096);
      appendTerrain(b, buildRingModel(surfaceOf(island), 0), terrainPalette('sunward', island.biome), 0, 0);
      for (const q of sliceAt(b, 0)) {
        expect(Math.abs(signedDistanceValue(island.outline, q.x, q.z))).toBeLessThan(0.05);
        checked++;
      }
      // Just above the waterline the rock never sticks out past the coast (≤ 0.1 m through the wet band).
      for (const q of sliceAt(b, 1.2)) expect(signedDistanceValue(island.outline, q.x, q.z)).toBeLessThan(0.1);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('keeps overhangs within 1 m of the coast at any height', () => {
    for (const island of islands) {
      const b = new MeshBuilder(4096);
      appendTerrain(b, buildRingModel(surfaceOf(island), 0), terrainPalette('sunward', island.biome), 0, 0);
      let worst = -Infinity;
      for (let v = 0; v < b.vCount; v++) {
        if (b.pos[v * 3 + 1]! < 0.5) continue;
        worst = Math.max(worst, signedDistanceValue(island.outline, b.pos[v * 3]!, b.pos[v * 3 + 2]!));
      }
      expect(worst).toBeLessThanOrEqual(OVERHANG + 1e-3);
    }
  });

  it('plants props, kit and canopy on land; rocks and waterfalls hug the coast', () => {
    let props = 0, kit = 0;
    for (const f of features) {
      for (const island of f.islands) {
        if (island.landmark === 'pier') continue;
        const plan = planIsland(island, f.palette);
        for (const p of plan.props) { expect(signedDistanceValue(island.outline, p.x, p.z)).toBeLessThan(-0.5); props++; }
        for (const c of plan.canopy) expect(pointInPolygon(island.outline, c.x, c.z)).toBe(true);
        for (const k of plan.kit) {
          if (k.kind === 'wreck') continue; // rests across the reef edge by design
          expect(signedDistanceValue(island.outline, k.x, k.z)).toBeLessThan(0);
          kit++;
        }
        for (const r of plan.rocks) expect(signedDistanceValue(island.outline, r.x, r.z) + r.r * ROCK_EXTENT).toBeLessThanOrEqual(1.01);
        for (const w of plan.waterfalls) for (const q of w.points) expect(signedDistanceValue(island.outline, q.x, q.z)).toBeLessThanOrEqual(1.2);
      }
    }
    expect(props).toBeGreaterThan(300);
    expect(kit).toBeGreaterThan(50);
  });

  it('leaves sailable clearance under every arch', () => {
    const arches = features.filter((f) => f.arch);
    expect(arches.length).toBeGreaterThan(1);
    for (const f of arches) {
      const pillar = f.islands.find((i) => i.landmark === 'arch')!;
      const s = surfaceOf(pillar);
      const b = new MeshBuilder(4096);
      appendArchSpan(b, f.arch!, s.shape.spec.faceDistance!, s.shape, terrainPalette('sunward', pillar.biome), 0, 0, 0);
      const pillars = f.islands.filter((i) => i.landmark === 'arch');
      let lowest = Infinity;
      for (let v = 0; v < b.vCount; v++) {
        const x = b.pos[v * 3]!, y = b.pos[v * 3 + 1]!, z = b.pos[v * 3 + 2]!;
        // Only geometry hanging over open water between the pillars matters for ships.
        const overWater = pillars.every((p: IslandDef) => signedDistanceValue(p.outline, x, z) > 6);
        const ax = f.arch!.bx - f.arch!.ax, az = f.arch!.bz - f.arch!.az;
        const along = ((x - f.arch!.ax) * ax + (z - f.arch!.az) * az) / (ax * ax + az * az);
        const tFace = s.shape.spec.faceDistance! / Math.hypot(ax, az);
        // The sailing gap: between the two pillar faces.
        if (overWater && along > tFace && along < 1 - tFace) lowest = Math.min(lowest, y);
      }
      expect(lowest).toBeGreaterThan(f.arch!.clearance * 0.8);
    }
  });

  it('keeps the harbour set clear of the showcase ship and camera orbit', () => {
    for (const f of harborSetFeatures()) for (const i of f.islands) {
      expect(signedDistanceValue(i.outline, 0, 0)).toBeGreaterThan(140);
    }
    // And the menu field with the set still keeps generated features out of it.
    const field = new IslandField('menu', { menuHarbor: true });
    expect(field.isWater(0, 0, 130)).toBe(true);
    for (let cx = -2; cx < 2; cx++) for (let cz = -2; cz < 2; cz++) {
      const f = field.cellFeature(cx, cz);
      if (f) for (const set of harborSetFeatures()) expect(Math.hypot(set.x - f.x, set.z - f.z)).toBeGreaterThan(set.radius + f.radius + 59);
    }
    void CELL;
  });
});
