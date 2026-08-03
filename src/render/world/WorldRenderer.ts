import { Group, type Camera, type Scene } from 'three';
import type { IslandState, Vec3, WeatherKind } from '../../core/contracts';
import type { WaveSample } from '../../core/waves';
import { InfiniteOcean } from '../ocean/InfiniteOcean';
import { setOutlineViewport } from '../npr/invertedHull';
import { ChunkVisuals } from './ChunkVisuals';
import { ProceduralSky } from './ProceduralSky';

export interface WorldRendererOptions {
  seedNumber?: number;
  chunkSize?: number;
}

export interface WorldRendererFrame {
  time: number;
  focus: Vec3;
  camera?: Camera;
  weather?: WeatherKind;
  windDirection?: number;
  windStrength?: number;
  currentDirection?: number;
  currentStrength?: number;
  /** Deterministic debug/scenario islands supplied by simulation state. */
  islands?: readonly IslandState[];
}

/** Cohesive view adapter for ocean, atmosphere and the 5x5 streamed world. */
export class WorldRenderer {
  readonly group = new Group();
  readonly ocean: InfiniteOcean;
  readonly sky: ProceduralSky;
  readonly chunks: ChunkVisuals;

  private scenarioIslandsReference: readonly IslandState[] | undefined;

  constructor(scene: Scene, options: WorldRendererOptions = {}) {
    const seedNumber = options.seedNumber ?? 1;
    this.ocean = new InfiniteOcean();
    this.sky = new ProceduralSky(seedNumber);
    this.chunks = new ChunkVisuals(seedNumber, options.chunkSize);
    this.group.name = 'CruiseProceduralWorld';
    this.group.add(this.sky.group, this.ocean.group, this.chunks.group);
    scene.add(this.group);
  }

  update(frame: WorldRendererFrame): void {
    if (frame.islands !== undefined && frame.islands !== this.scenarioIslandsReference) {
      this.scenarioIslandsReference = frame.islands;
      this.chunks.setScenarioIslands(frame.islands);
    }
    this.ocean.update({
      time: frame.time,
      focus: frame.focus,
      weather: frame.weather,
      windDirection: frame.windDirection,
      windStrength: frame.windStrength,
      currentDirection: frame.currentDirection,
      currentStrength: frame.currentStrength,
    });
    this.sky.update(frame.time, frame.focus, frame.weather ?? 'calm');
    this.chunks.update(frame.focus);
  }

  setScenarioIslands(islands: readonly IslandState[]): void {
    this.scenarioIslandsReference = islands;
    this.chunks.setScenarioIslands(islands);
  }

  setViewport(width: number, height: number): void {
    setOutlineViewport(this.group, width, height);
  }

  sampleOcean(x: number, z: number, time: number): WaveSample {
    return this.ocean.sample(x, z, time);
  }

  getChunkCount(): number {
    return this.chunks.getChunkCount();
  }

  getGeneratedIslands(): IslandState[] {
    return this.chunks.getIslands();
  }

  dispose(): void {
    this.chunks.dispose();
    this.ocean.dispose();
    this.sky.dispose();
    this.group.removeFromParent();
  }
}
