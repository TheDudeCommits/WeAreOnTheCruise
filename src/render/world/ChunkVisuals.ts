import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { IslandState, Vec3 } from '../../core/contracts';
import { createSeededRandom, hashCoordinates, hashString } from '../../core/rng';
import {
  DEFAULT_CHUNK_RADIUS,
  ProceduralChunkGenerator,
  chunkKey,
  type GeneratedChunk,
  type GeneratedIsland,
} from '../../world/chunks';
import { createCelMaterial, type CelMaterial } from '../npr/celMaterial';
import { createOutlineMaterial } from '../npr/invertedHull';

const LAND_CAPACITY = 128;
const ISLAND_CAPACITY = 48;
const STACK_CAPACITY = 192;
const REEF_CAPACITY = 64;
const PALM_CAPACITY = 192;
const PROP_CAPACITY = 64;

const LAND_COLORS = [0x4e9b58, 0x5ea64d, 0x3f8c68, 0x789d42] as const;
const BEACH_COLORS = [0xf4ce72, 0xf2b965, 0xe8ce85, 0xe2b768] as const;
const ROCK_COLORS = [0x6d6470, 0x5b6571, 0x756052, 0x586a61] as const;
const REEF_COLORS = [0x6ee3bd, 0x4dd4c7, 0x81d9aa, 0x53c9d2] as const;

export class ChunkVisuals {
  readonly group = new Group();

  private readonly generator: ProceduralChunkGenerator;
  private readonly chunks = new Map<string, GeneratedChunk>();
  private readonly landGeometry = new CylinderGeometry(0.72, 1, 1, 9, 1);
  private readonly beachGeometry = new CylinderGeometry(0.86, 1, 0.055, 12, 1);
  private readonly stackGeometry = new ConeGeometry(1, 1, 7, 2);
  private readonly reefGeometry = new CircleGeometry(1, 14);
  private readonly trunkGeometry = new CylinderGeometry(0.42, 0.65, 1, 5);
  private readonly palmGeometry = new IcosahedronGeometry(1, 0);
  private readonly propGeometry = new BoxGeometry(1, 1, 1);
  private readonly landMaterial: CelMaterial;
  private readonly beachMaterial: CelMaterial;
  private readonly rockMaterial: CelMaterial;
  private readonly reefMaterial: CelMaterial;
  private readonly trunkMaterial: CelMaterial;
  private readonly palmMaterial: CelMaterial;
  private readonly propMaterial: CelMaterial;
  private readonly land: InstancedMesh;
  private readonly landOutline: InstancedMesh;
  private readonly beaches: InstancedMesh;
  private readonly stacks: InstancedMesh;
  private readonly stackOutline: InstancedMesh;
  private readonly reefs: InstancedMesh;
  private readonly trunks: InstancedMesh;
  private readonly palms: InstancedMesh;
  private readonly props: InstancedMesh;
  private scenarioIslands: IslandState[] = [];
  private centerX = Number.NaN;
  private centerZ = Number.NaN;

  constructor(seedNumber: number, chunkSize?: number) {
    this.generator = new ProceduralChunkGenerator(seedNumber, chunkSize);
    this.landMaterial = createCelMaterial({ color: 0xffffff, vertexColors: true, fogNear: 650, fogFar: 2_300, rimStrength: 0.2 });
    this.beachMaterial = createCelMaterial({ color: 0xffffff, vertexColors: true, fogNear: 650, fogFar: 2_300, rimStrength: 0.15 });
    this.rockMaterial = createCelMaterial({ color: 0xffffff, vertexColors: true, fogNear: 650, fogFar: 2_300, rimStrength: 0.18 });
    this.reefMaterial = createCelMaterial({ color: 0xffffff, vertexColors: true, opacity: 0.52, side: DoubleSide, fogNear: 520, fogFar: 1_900 });
    this.trunkMaterial = createCelMaterial({ color: 0x7a4b32, fogNear: 650, fogFar: 2_300 });
    this.palmMaterial = createCelMaterial({ color: 0x2e8d52, vertexColors: true, fogNear: 650, fogFar: 2_300 });
    this.propMaterial = createCelMaterial({ color: 0xe3ddd0, vertexColors: true, fogNear: 650, fogFar: 2_300 });

    this.land = makeBatch(this.landGeometry, this.landMaterial, LAND_CAPACITY);
    this.landOutline = makeBatch(this.landGeometry, createOutlineMaterial({ thicknessPixels: 2.5 }), LAND_CAPACITY);
    this.beaches = makeBatch(this.beachGeometry, this.beachMaterial, ISLAND_CAPACITY);
    this.stacks = makeBatch(this.stackGeometry, this.rockMaterial, STACK_CAPACITY);
    this.stackOutline = makeBatch(this.stackGeometry, createOutlineMaterial({ thicknessPixels: 2 }), STACK_CAPACITY);
    this.reefs = makeBatch(this.reefGeometry, this.reefMaterial, REEF_CAPACITY);
    this.trunks = makeBatch(this.trunkGeometry, this.trunkMaterial, PALM_CAPACITY);
    this.palms = makeBatch(this.palmGeometry, this.palmMaterial, PALM_CAPACITY);
    this.props = makeBatch(this.propGeometry, this.propMaterial, PROP_CAPACITY);
    this.group.name = 'StreamedWorldChunks';
    this.group.add(
      this.reefs,
      this.beaches,
      this.landOutline,
      this.land,
      this.stackOutline,
      this.stacks,
      this.trunks,
      this.palms,
      this.props,
    );
  }

  update(focus: Vec3): void {
    const nextX = this.generator.worldToChunk(focus.x);
    const nextZ = this.generator.worldToChunk(focus.z);
    if (nextX === this.centerX && nextZ === this.centerZ) return;
    this.centerX = nextX;
    this.centerZ = nextZ;
    const needed = new Set<string>();
    for (let z = nextZ - DEFAULT_CHUNK_RADIUS; z <= nextZ + DEFAULT_CHUNK_RADIUS; z += 1) {
      for (let x = nextX - DEFAULT_CHUNK_RADIUS; x <= nextX + DEFAULT_CHUNK_RADIUS; x += 1) {
        const key = chunkKey(x, z);
        needed.add(key);
        if (!this.chunks.has(key)) this.chunks.set(key, this.generator.generate(x, z));
      }
    }
    for (const key of this.chunks.keys()) {
      if (!needed.has(key)) this.chunks.delete(key);
    }
    this.rebuildInstances();
  }

  setScenarioIslands(islands: readonly IslandState[]): void {
    this.scenarioIslands = islands.map(cloneIsland);
    this.rebuildInstances();
  }

  getChunkCount(): number {
    return this.chunks.size;
  }

  getIslands(): IslandState[] {
    const islands = [...this.chunks.values()].flatMap((chunk) => chunk.islands);
    const byId = new Map<string, IslandState>();
    for (const island of islands) byId.set(island.id, cloneIsland(island));
    for (const island of this.scenarioIslands) byId.set(island.id, cloneIsland(island));
    return [...byId.values()];
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of [this.landGeometry, this.beachGeometry, this.stackGeometry, this.reefGeometry, this.trunkGeometry, this.palmGeometry, this.propGeometry]) {
      geometry.dispose();
    }
    for (const material of [
      this.landMaterial,
      this.beachMaterial,
      this.rockMaterial,
      this.reefMaterial,
      this.trunkMaterial,
      this.palmMaterial,
      this.propMaterial,
    ]) {
      material.dispose();
    }
    disposeMaterial(this.landOutline.material);
    disposeMaterial(this.stackOutline.material);
  }

  private rebuildInstances(): void {
    let landCount = 0;
    let beachCount = 0;
    let stackCount = 0;
    let reefCount = 0;
    let palmCount = 0;
    let propCount = 0;
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    const color = new Color();
    const generatedIslands = [...this.chunks.values()].flatMap((chunk) => chunk.islands);
    const visualIslands: readonly (GeneratedIsland | IslandState)[] = [...generatedIslands, ...this.scenarioIslands];

    for (const island of visualIslands) {
      if (beachCount < ISLAND_CAPACITY) {
        matrix.compose(
          position.set(island.position.x, 0.15, island.position.z),
          quaternion.setFromAxisAngle(new Vector3(0, 1, 0), getRotation(island)),
          scale.set(island.radius * 1.12, 1, island.radius * 0.91),
        );
        this.beaches.setMatrixAt(beachCount, matrix);
        this.beaches.setColorAt(beachCount, color.set(BEACH_COLORS[island.palette % BEACH_COLORS.length]!));
        beachCount += 1;
      }

      const tiers = 'tierCount' in island ? island.tierCount : 3;
      for (let tier = 0; tier < tiers && landCount < LAND_CAPACITY; tier += 1) {
        const tierHeight = island.height / tiers * 1.38;
        const radiusScale = 1 - tier * 0.16;
        matrix.compose(
          position.set(island.position.x + Math.sin(tier * 1.7) * island.radius * 0.055, tierHeight * (tier + 0.42), island.position.z + Math.cos(tier * 2.1) * island.radius * 0.04),
          quaternion.setFromAxisAngle(new Vector3(0, 1, 0), getRotation(island) + tier * 0.31),
          scale.set(island.radius * radiusScale, tierHeight, island.radius * radiusScale * 0.78),
        );
        setMirroredInstance(this.land, this.landOutline, landCount, matrix);
        this.land.setColorAt(landCount, color.set(LAND_COLORS[island.palette % LAND_COLORS.length]!));
        landCount += 1;
      }

      const palms = 'palms' in island ? island.palms : island.landmark === 'palms' ? 9 : 2;
      const random = createSeededRandom(hashString(island.id));
      for (let index = 0; index < palms && palmCount < PALM_CAPACITY; index += 1) {
        const angle = random.range(0, Math.PI * 2);
        const radius = island.radius * random.range(0.14, 0.62);
        const trunkHeight = random.range(8, 15);
        const x = island.position.x + Math.sin(angle) * radius;
        const z = island.position.z + Math.cos(angle) * radius;
        const y = island.height * 0.72;
        matrix.compose(position.set(x, y + trunkHeight * 0.5, z), quaternion.identity(), scale.set(1.25, trunkHeight, 1.25));
        this.trunks.setMatrixAt(palmCount, matrix);
        matrix.compose(position.set(x, y + trunkHeight, z), quaternion.setFromAxisAngle(new Vector3(0, 1, 0), angle), scale.set(6.5, 2.1, 6.5));
        this.palms.setMatrixAt(palmCount, matrix);
        this.palms.setColorAt(palmCount, color.set(index % 2 ? 0x277f4b : 0x45a64f));
        palmCount += 1;
      }

      if ((island.landmark === 'fort' || island.landmark === 'volcano') && propCount < PROP_CAPACITY) {
        const propScale = island.landmark === 'fort'
          ? scale.set(island.radius * 0.34, island.height * 0.34, island.radius * 0.28)
          : scale.set(island.radius * 0.28, island.height * 0.46, island.radius * 0.28);
        matrix.compose(position.set(island.position.x, island.height * 0.94, island.position.z), quaternion.identity(), propScale);
        this.props.setMatrixAt(propCount, matrix);
        this.props.setColorAt(propCount, color.set(island.landmark === 'fort' ? 0xe3ddd0 : 0x5c4b4b));
        propCount += 1;
      }
    }

    for (const chunk of this.chunks.values()) {
      for (const stack of chunk.seaStacks) {
        if (stackCount >= STACK_CAPACITY) break;
        quaternion.setFromEuler(new Euler(stack.lean, hashCoordinates(hashString(stack.id), 0, 0) / 0xffffffff * Math.PI, stack.lean * -0.6, 'XYZ'));
        matrix.compose(position.set(stack.x, stack.height * 0.44, stack.z), quaternion, scale.set(stack.radius, stack.height, stack.radius * 0.8));
        setMirroredInstance(this.stacks, this.stackOutline, stackCount, matrix);
        this.stacks.setColorAt(stackCount, color.set(ROCK_COLORS[stack.palette % ROCK_COLORS.length]!));
        stackCount += 1;
      }
      for (const reef of chunk.reefs) {
        if (reefCount >= REEF_CAPACITY) break;
        quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI * 0.5).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), reef.rotation));
        matrix.compose(position.set(reef.x, -0.35, reef.z), quaternion, scale.set(reef.radiusX, reef.radiusZ, 1));
        this.reefs.setMatrixAt(reefCount, matrix);
        this.reefs.setColorAt(reefCount, color.set(REEF_COLORS[reef.palette % REEF_COLORS.length]!));
        reefCount += 1;
      }
    }

    finishBatch(this.land, landCount);
    finishBatch(this.landOutline, landCount);
    finishBatch(this.beaches, beachCount);
    finishBatch(this.stacks, stackCount);
    finishBatch(this.stackOutline, stackCount);
    finishBatch(this.reefs, reefCount);
    finishBatch(this.trunks, palmCount);
    finishBatch(this.palms, palmCount);
    finishBatch(this.props, propCount);
  }
}

function makeBatch(geometry: InstancedMesh['geometry'], material: InstancedMesh['material'], capacity: number): InstancedMesh {
  const batch = new InstancedMesh(geometry, material, capacity);
  batch.count = 0;
  batch.instanceMatrix.setUsage(DynamicDrawUsage);
  batch.frustumCulled = false;
  return batch;
}

function setMirroredInstance(base: InstancedMesh, outline: InstancedMesh, index: number, matrix: Matrix4): void {
  base.setMatrixAt(index, matrix);
  outline.setMatrixAt(index, matrix);
}

function finishBatch(batch: InstancedMesh, count: number): void {
  batch.count = count;
  batch.instanceMatrix.needsUpdate = true;
  if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
}

function disposeMaterial(material: InstancedMesh['material']): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

function getRotation(island: GeneratedIsland | IslandState): number {
  return 'rotation' in island ? island.rotation : hashString(island.id) / 0xffffffff * Math.PI * 2;
}

function cloneIsland(island: IslandState): IslandState {
  return {
    id: island.id,
    position: { ...island.position },
    radius: island.radius,
    height: island.height,
    palette: island.palette,
    discovered: island.discovered,
    landmark: island.landmark,
  };
}
