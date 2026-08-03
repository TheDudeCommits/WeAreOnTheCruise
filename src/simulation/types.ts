import type { AmmoKind, InputAction, ShipSide, Vec3 } from '../core/contracts';

export type ActionState = Partial<Record<InputAction, boolean>>;

export interface OceanSample {
  height: number;
  normal?: Vec3;
  velocity?: Vec3;
  crest?: number;
}

export interface OceanSampler {
  sample(x: number, z: number, time: number): OceanSample;
}

export type SimulationEvent =
  | { type: 'cannon-fired'; shipId: string; side: ShipSide; ammo: AmmoKind; position: Vec3; count: number }
  | { type: 'projectile-impact'; projectileId: number; shipId: string; ammo: AmmoKind; position: Vec3; side: ShipSide }
  | { type: 'water-impact'; projectileId: number; ammo: AmmoKind; position: Vec3 }
  | { type: 'ram'; attackerId: string; targetId: string; position: Vec3; force: number }
  | { type: 'special'; shipId: string; name: string; position: Vec3 }
  | { type: 'repair'; shipId: string; position: Vec3 }
  | { type: 'checkpoint'; shipId: string; checkpoint: number; lap: number }
  | { type: 'race-finished'; shipId: string; placement: number; elapsed: number }
  | { type: 'ship-disabled'; shipId: string; position: Vec3 };

export interface GameSimulationOptions {
  fixedStep?: number;
  projectileCapacity?: number;
  waveSampler?: OceanSampler;
}
