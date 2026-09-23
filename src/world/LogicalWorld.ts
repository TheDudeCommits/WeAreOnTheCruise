import type { IslandState, Vec3, WorldCollisionFeature } from '../core/contracts';
import { DEFAULT_CHUNK_RADIUS, ProceduralChunkGenerator, type GeneratedChunk } from './chunks';

/** Bounded deterministic world catalogue. Rendering and collision share the same records. */
export class LogicalWorld {
  private readonly generator: ProceduralChunkGenerator;
  private readonly chunks = new Map<string, GeneratedChunk>();
  private center = '';
  private authored: readonly IslandState[] = [];

  constructor(seed: number) { this.generator = new ProceduralChunkGenerator(seed); }

  setAuthored(islands: readonly IslandState[]): void { this.authored = structuredClone(islands); this.center = ''; }

  update(focus: Vec3, discovered: readonly string[]): { islands: IslandState[]; features: WorldCollisionFeature[] } | undefined {
    const x = this.generator.worldToChunk(focus.x);
    const z = this.generator.worldToChunk(focus.z);
    if (this.center === `${x}:${z}`) return undefined;
    this.center = `${x}:${z}`;
    const live = new Set<string>();
    const generated: IslandState[] = [];
    const features: WorldCollisionFeature[] = [];
    for (let dz = -DEFAULT_CHUNK_RADIUS; dz <= DEFAULT_CHUNK_RADIUS; dz += 1) {
      for (let dx = -DEFAULT_CHUNK_RADIUS; dx <= DEFAULT_CHUNK_RADIUS; dx += 1) {
        const key = `${x + dx}:${z + dz}`;
        live.add(key);
        let chunk = this.chunks.get(key);
        if (!chunk) { chunk = this.generator.generate(x + dx, z + dz); this.chunks.set(key, chunk); }
        for (const island of chunk.islands) {
          // Authored encounter water has a generous clear lane; generated islands remain outside it.
          if (this.authored.some((entry) => Math.hypot(entry.position.x - island.position.x, entry.position.z - island.position.z) < entry.radius + island.radius + 140)) continue;
          generated.push(island);
        }
        for (const stack of chunk.seaStacks) {
          if (!generated.some((island) => stack.id.startsWith(island.id)) && stack.id.startsWith('island:')) continue;
          features.push({ id: stack.id, x: stack.x, z: stack.z, radius: stack.radius, kind: 'stack' });
        }
        for (const reef of chunk.reefs) {
          if (!generated.some((island) => reef.id.startsWith(island.id))) continue;
          features.push({ id: reef.id, x: reef.x, z: reef.z, radius: Math.min(reef.radiusX, reef.radiusZ), kind: 'reef' });
        }
      }
    }
    for (const key of this.chunks.keys()) if (!live.has(key)) this.chunks.delete(key);
    const known = new Set(discovered);
    const islands = [...this.authored, ...generated].map((island) => ({ ...structuredClone(island), discovered: island.discovered || known.has(island.id) }));
    for (const island of islands) {
      if (island.landmark === 'arches') {
        for (const sign of [-1, 1]) features.push({ id: `${island.id}:pylon:${sign}`, x: island.position.x + island.radius * 0.76 * sign, z: island.position.z, radius: island.radius * 0.22, kind: 'shore' });
      } else features.push({ id: island.id, x: island.position.x, z: island.position.z, radius: island.radius, kind: island.landmark === 'needles' ? 'reef' : 'shore' });
    }
    return { islands, features };
  }
}
