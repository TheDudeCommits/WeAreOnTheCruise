import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../src/core/rng';
import type { IslandDef } from '../src/game/types';
import { CELL, IslandField, START_CLEAR, type WorldFeature } from '../src/world/IslandField';
import { isSimplePolygon, pointInPolygon, shoelace, signedDistanceValue } from '../src/world/polygon';

function featuresIn(field: IslandField, half: number): WorldFeature[] {
  const out: WorldFeature[] = [];
  const n = Math.ceil(half / CELL);
  for (let cx = -n; cx < n; cx++) for (let cz = -n; cz < n; cz++) {
    const f = field.cellFeature(cx, cz);
    if (f) out.push(f);
  }
  return out;
}

const strip = (i: IslandDef) => ({ ...i, outline: i.outline.map((p) => [+p.x.toFixed(4), +p.z.toFixed(4)]) });

describe('world: island field generation', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = featuresIn(new IslandField('det'), 3000).flatMap((f) => f.islands.map(strip));
    const b = featuresIn(new IslandField('det'), 3000).flatMap((f) => f.islands.map(strip));
    const c = featuresIn(new IslandField('other'), 3000).flatMap((f) => f.islands.map(strip));
    expect(a.length).toBeGreaterThan(10);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('keeps the run start clear for many seeds', () => {
    for (let s = 0; s < 40; s++) {
      const field = new IslandField(`start-${s}`);
      expect(field.isWater(0, 0, START_CLEAR - 5)).toBe(true);
      expect(field.collideCircle(0, 0, 60).hit).toBe(false);
      for (const f of field.featuresNear(0, 0, 2000)) expect(Math.hypot(f.x, f.z) - f.radius).toBeGreaterThanOrEqual(START_CLEAR - 1e-6);
    }
  });

  it('produces valid outlines: contract winding, simple, centre on land, radius bounds the outline', () => {
    for (const seed of ['w1', 'w2', 'w3']) {
      for (const f of featuresIn(new IslandField(seed), 4200)) {
        for (const island of f.islands) {
          expect(shoelace(island.outline)).toBeLessThan(0);
          expect(isSimplePolygon(island.outline)).toBe(true);
          expect(pointInPolygon(island.outline, island.x, island.z)).toBe(true);
          let maxR = 0;
          for (const p of island.outline) maxR = Math.max(maxR, Math.hypot(p.x - island.x, p.z - island.z));
          expect(maxR).toBeLessThanOrEqual(island.radius + 1e-6);
          expect(Math.hypot(island.x - f.x, island.z - f.z) + island.radius).toBeLessThanOrEqual(f.radius + 1e-6);
        }
      }
    }
  });

  it('keeps features inside their cells with a navigable channel between neighbours', () => {
    const feats = featuresIn(new IslandField('gaps'), 6000);
    for (const f of feats) {
      const [, cx, cz] = f.id.split(':').map(Number) as [number, number, number];
      expect(f.x - f.radius).toBeGreaterThanOrEqual(cx * CELL + 44.9);
      expect(f.x + f.radius).toBeLessThanOrEqual((cx + 1) * CELL - 44.9);
      expect(f.z - f.radius).toBeGreaterThanOrEqual(cz * CELL + 44.9);
      expect(f.z + f.radius).toBeLessThanOrEqual((cz + 1) * CELL - 44.9);
    }
  });

  it('agrees between collideCircle, isWater and shoreDistance', () => {
    const field = new IslandField('agree');
    const rng = createSeededRandom(7);
    let hits = 0;
    for (let n = 0; n < 6000; n++) {
      // Sample near islands so the test exercises coastlines, not open water.
      const f = field.featuresNear(rng.range(-3000, 3000), rng.range(-3000, 3000), 400)[0];
      if (!f) continue;
      const island = f.islands[Math.floor(rng.next() * f.islands.length)]!;
      const x = island.x + rng.range(-1.3, 1.3) * island.radius, z = island.z + rng.range(-1.3, 1.3) * island.radius;
      const r = rng.range(0.5, 20);
      const d = field.shoreDistance(x, z, 500);
      const hit = field.collideCircle(x, z, r);
      expect(hit.hit).toBe(d < r);
      expect(field.isWater(x, z, r)).toBe(d >= r);
      if (hit.hit) {
        hits++;
        expect(hit.depth).toBeCloseTo(r - d, 5);
        // Pushing out along the normal (as the sim does each tick) resolves a single-island contact in a few steps.
        if (field.islandsNear(x, z, r + 30).length > 1) continue;
        let px = x, pz = z;
        for (let k = 0; k < 6; k++) {
          const h = field.collideCircle(px, pz, r);
          if (!h.hit) break;
          px += h.nx * h.depth; pz += h.nz * h.depth;
        }
        expect(field.shoreDistance(px, pz, 500)).toBeGreaterThan(r - 0.5);
      }
    }
    expect(hits).toBeGreaterThan(500);
  });

  it('leaves open water for battles but offers cover', () => {
    const field = new IslandField('density');
    const rng = createSeededRandom(11);
    let land = 0, samples = 0;
    for (let n = 0; n < 40000; n++) {
      const x = rng.range(-9000, 9000), z = rng.range(-9000, 9000);
      samples++;
      if (!field.isWater(x, z, 0)) land++;
    }
    const fraction = land / samples;
    expect(fraction).toBeGreaterThan(0.016);
    expect(fraction).toBeLessThan(0.12);
  });

  it('covers every biome and landmark kind, and seas bias the mix', () => {
    const count = (sea: string | null) => {
      const field = new IslandField('mix', { sea });
      const biomes: Record<string, number> = {}, landmarks: Record<string, number> = {}, kinds: Record<string, number> = {};
      for (const f of featuresIn(field, 15000)) {
        kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
        for (const i of f.islands) {
          biomes[i.biome] = (biomes[i.biome] ?? 0) + 1;
          if (i.landmark) landmarks[i.landmark] = (landmarks[i.landmark] ?? 0) + 1;
        }
      }
      return { biomes, landmarks, kinds };
    };
    const sun = count(null);
    for (const b of ['tropical', 'rocky', 'volcanic', 'fort', 'harbor', 'reef']) expect(sun.biomes[b] ?? 0).toBeGreaterThan(0);
    for (const l of ['arch', 'lighthouse', 'giant-tree', 'shipwreck', 'fort', 'harbor', 'pier', 'volcano', 'ruins']) expect(sun.landmarks[l] ?? 0).toBeGreaterThan(0);
    const storm = count('stormwrack-reach');
    expect((storm.biomes.rocky ?? 0) / (storm.biomes.tropical ?? 1)).toBeGreaterThan((sun.biomes.rocky ?? 0) / (sun.biomes.tropical ?? 1));
    const gloam = count('the-gloam');
    expect(gloam.landmarks.ruins ?? 0).toBeGreaterThan((sun.landmarks.ruins ?? 0) * 2);
    if (process.env.WORLD_STATS) writeFileSync('/tmp/world-stats.json', JSON.stringify({ sun, storm, gloam }, null, 1));
  });

  it('splits arches into pillars with a sailable gap', () => {
    let arches = 0;
    for (let s = 0; s < 6 && arches < 5; s++) {
      for (const f of featuresIn(new IslandField(`arch-${s}`), 12000)) {
        if (f.kind !== 'arch' || !f.arch) continue;
        arches++;
        const pillars = f.islands.filter((i) => i.landmark === 'arch');
        expect(pillars.length).toBe(2);
        const mx = (f.arch.ax + f.arch.bx) / 2, mz = (f.arch.az + f.arch.bz) / 2;
        // The middle of the arch is open water wide enough for a big ship.
        let gap = Infinity;
        for (const p of pillars) gap = Math.min(gap, signedDistanceValue(p.outline, mx, mz));
        expect(gap).toBeGreaterThan(25);
        expect(f.arch.clearance).toBeGreaterThanOrEqual(46);
      }
    }
    expect(arches).toBeGreaterThan(0);
  });

  it('answers hot-path queries quickly', () => {
    const field = new IslandField('perf');
    field.featuresNear(0, 0, 4000);
    const rng = createSeededRandom(3);
    const t0 = performance.now();
    let water = 0;
    for (let n = 0; n < 50000; n++) if (field.isWater(rng.range(-3000, 3000), rng.range(-3000, 3000), 0)) water++;
    const ms = performance.now() - t0;
    expect(water).toBeGreaterThan(40000);
    expect(ms).toBeLessThan(400);
  });
});
