import type { IslandState } from '../core/contracts';
import { createSeededRandom, hashCoordinates } from '../core/rng';

export const DEFAULT_CHUNK_SIZE = 720;
export const DEFAULT_CHUNK_RADIUS = 2;

export interface ChunkCoordinate {
  x: number;
  z: number;
}

export interface SeaStack {
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
  lean: number;
  palette: number;
}

export interface ReefPatch {
  id: string;
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  rotation: number;
  palette: number;
}

export interface GeneratedIsland extends IslandState {
  name: string;
  rotation: number;
  tierCount: number;
  palms: number;
}

export type OceanRegion = 'sapphire-run' | 'jade-current' | 'sunset-sea' | 'storm-belt';

export interface GeneratedChunk {
  id: string;
  coordinate: ChunkCoordinate;
  centerX: number;
  centerZ: number;
  region: OceanRegion;
  currentDirection: number;
  currentStrength: number;
  islands: GeneratedIsland[];
  seaStacks: SeaStack[];
  reefs: ReefPatch[];
}

const LANDMARKS: readonly IslandState['landmark'][] = ['volcano', 'arches', 'palms', 'fort', 'needles'];
const REGION_NAMES: readonly OceanRegion[] = ['sapphire-run', 'jade-current', 'sunset-sea', 'storm-belt'];
const NAME_START = ['Amber', 'Laughing', 'Moon', 'Gull', 'Sun', 'Tempest', 'Crown', 'Whale', 'Turtle', 'Scarlet'] as const;
const NAME_END = ['Cay', 'Atoll', 'Reach', 'Rest', 'Spire', 'Haven', 'Key', 'Crown', 'Garden', 'Watch'] as const;

export class ProceduralChunkGenerator {
  readonly chunkSize: number;

  constructor(private readonly seed: number, chunkSize = DEFAULT_CHUNK_SIZE) {
    this.chunkSize = chunkSize;
  }

  worldToChunk(value: number): number {
    return Math.floor((value + this.chunkSize * 0.5) / this.chunkSize);
  }

  generate(x: number, z: number): GeneratedChunk {
    const chunkSeed = hashCoordinates(this.seed, x, z, 0x51ed270b);
    const random = createSeededRandom(chunkSeed);
    const centerX = x * this.chunkSize;
    const centerZ = z * this.chunkSize;
    const region = REGION_NAMES[hashCoordinates(this.seed, Math.floor(x / 3), Math.floor(z / 3), 0x7f4a7c15) % REGION_NAMES.length]!;
    const islands: GeneratedIsland[] = [];
    const seaStacks: SeaStack[] = [];
    const reefs: ReefPatch[] = [];

    const guaranteedFirstLandfall = x === 0 && z === 0;
    const islandCount = guaranteedFirstLandfall ? 1 : random.chance(0.38) ? (random.chance(0.12) ? 2 : 1) : 0;
    const usableHalfSize = this.chunkSize * 0.34;

    for (let index = 0; index < islandCount; index += 1) {
      const islandSeed = hashCoordinates(chunkSeed, index, 0, 0x1b873593);
      const islandRandom = createSeededRandom(islandSeed);
      const radius = guaranteedFirstLandfall
        ? 82
        : islandRandom.range(48, islandRandom.chance(0.16) ? 142 : 104);
      const height = islandRandom.range(radius * 0.35, radius * 0.82);
      const positionX = guaranteedFirstLandfall
        ? centerX + 155
        : centerX + islandRandom.range(-usableHalfSize, usableHalfSize);
      const positionZ = guaranteedFirstLandfall
        ? centerZ - 255
        : centerZ + islandRandom.range(-usableHalfSize, usableHalfSize);
      const landmark = guaranteedFirstLandfall ? 'palms' : islandRandom.pick(LANDMARKS);
      const palette = islandRandom.integer(0, 4);
      const islandId = `island:${x}:${z}:${index}`;
      const island: GeneratedIsland = {
        id: islandId,
        name: guaranteedFirstLandfall
          ? 'Dawn Gull Cay'
          : `${islandRandom.pick(NAME_START)} ${islandRandom.pick(NAME_END)}`,
        position: { x: positionX, y: 0, z: positionZ },
        radius,
        height,
        palette,
        discovered: false,
        landmark,
        rotation: islandRandom.range(-Math.PI, Math.PI),
        tierCount: islandRandom.integer(2, 5),
        palms: landmark === 'palms' ? islandRandom.integer(6, 13) : islandRandom.integer(0, 5),
      };
      islands.push(island);

      const satelliteCount = landmark === 'needles' ? islandRandom.integer(5, 9) : islandRandom.integer(1, 5);
      for (let stackIndex = 0; stackIndex < satelliteCount; stackIndex += 1) {
        const angle = islandRandom.range(0, Math.PI * 2);
        const distance = radius * islandRandom.range(1.15, 2.15);
        seaStacks.push({
          id: `${islandId}:stack:${stackIndex}`,
          x: positionX + Math.sin(angle) * distance,
          z: positionZ + Math.cos(angle) * distance,
          radius: islandRandom.range(5, landmark === 'needles' ? 14 : 10),
          height: islandRandom.range(18, landmark === 'needles' ? 72 : 46),
          lean: islandRandom.range(-0.18, 0.18),
          palette,
        });
      }

      if (islandRandom.chance(0.82)) {
        const reefAngle = islandRandom.range(0, Math.PI * 2);
        const reefDistance = radius * islandRandom.range(1.15, 1.7);
        reefs.push({
          id: `${islandId}:reef`,
          x: positionX + Math.sin(reefAngle) * reefDistance,
          z: positionZ + Math.cos(reefAngle) * reefDistance,
          radiusX: radius * islandRandom.range(0.7, 1.25),
          radiusZ: radius * islandRandom.range(0.25, 0.58),
          rotation: reefAngle + islandRandom.range(-0.35, 0.35),
          palette,
        });
      }
    }

    if (islandCount === 0 && random.chance(0.24)) {
      const featureCount = random.integer(2, 7);
      for (let index = 0; index < featureCount; index += 1) {
        seaStacks.push({
          id: `stack:${x}:${z}:${index}`,
          x: centerX + random.range(-usableHalfSize, usableHalfSize),
          z: centerZ + random.range(-usableHalfSize, usableHalfSize),
          radius: random.range(3.5, 9),
          height: random.range(12, 48),
          lean: random.range(-0.22, 0.22),
          palette: random.integer(0, 4),
        });
      }
    }

    return {
      id: `chunk:${x}:${z}`,
      coordinate: { x, z },
      centerX,
      centerZ,
      region,
      currentDirection: random.range(-Math.PI, Math.PI),
      currentStrength: random.range(0.08, region === 'jade-current' ? 0.78 : 0.48),
      islands,
      seaStacks,
      reefs,
    };
  }
}

export function chunkKey(x: number, z: number): string {
  return `${x}:${z}`;
}
