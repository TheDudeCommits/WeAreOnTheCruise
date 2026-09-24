/**
 * Shared handles every FX module uses: the passes, the juice aggregator and per-frame world context.
 */
import type { OceanServices, ShipServices } from '../frame';
import type { WaterSampler } from './core/water';
import type { SpritePass } from './core/SpritePass';
import type { BeamPass } from './passes/Beams';
import type { DamageNumbers } from './passes/DamageNumbers';
import type { DebrisPass } from './passes/Debris';
import type { DecalPass } from './passes/Decals';
import type { PropPass } from './passes/Props';
import type { RopePass } from './passes/Ropes';
import type { TrailPass } from './passes/Trails';
import type { WaveWallPass } from './passes/WaveWalls';
import type { Juice } from './Juice';

export interface FxKit {
  cel: SpritePass;
  glow: SpritePass;
  heads: SpritePass;
  trails: TrailPass;
  beams: BeamPass;
  ropes: RopePass;
  decals: DecalPass;
  debris: DebrisPass;
  props: PropPass;
  numbers: DamageNumbers;
  walls: WaveWallPass;
  juice: Juice;
  /** Allocation-free water height (shared Gerstner waves + per-frame offset vs OceanServices). */
  water: WaterSampler;
  /** Per-frame services (null outside a frame). */
  ocean: OceanServices | null;
  ships: ShipServices | null;
  /** Camera focus (player) for distance attenuation. */
  focusX: number;
  focusZ: number;
  /** Wind drift velocity (m/s) for smoke. */
  windX: number;
  windZ: number;
  /** FX clock (seconds; follows sim time scale, frozen while paused). */
  clock: number;
  /** Quality multiplier for particle counts (0.5 low … 1.25 ultra), reduced further under load. */
  q: number;
  /** Particles spawned this frame (for load shedding). */
  spawned: number;
}
