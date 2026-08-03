export type Vec3 = { x: number; y: number; z: number };

export type ShipKind =
  | 'thousand-sunny'
  | 'going-merry'
  | 'moby-dick'
  | 'red-force'
  | 'oro-jackson'
  | 'polar-tang'
  | 'queen-mama-chanter'
  | 'baratie'
  | 'navy-galleon';

export type WeatherKind = 'calm' | 'swell' | 'storm' | 'fog' | 'maelstrom' | 'night';
export type GameMode = 'explore' | 'combat' | 'race' | 'discovery' | 'boarding';
export type AmmoKind = 'round' | 'chain' | 'heavy' | 'explosive';
export type ShipSide = 'bow' | 'stern' | 'port' | 'starboard';
export type AiPersonality = 'aggressive' | 'tactical' | 'reckless' | 'racer';

export interface ShipDamage {
  hull: number;
  sails: number;
  weapons: number;
  crew: number;
  sections: Record<ShipSide, number>;
}

export interface WeaponState {
  portCooldown: number;
  starboardCooldown: number;
  bowCooldown: number;
  ammo: AmmoKind;
}

export interface ShipState {
  id: string;
  kind: ShipKind;
  name: string;
  isPlayer: boolean;
  position: Vec3;
  heading: number;
  speed: number;
  verticalSpeed: number;
  pitch: number;
  roll: number;
  throttle: number;
  rudder: number;
  maxSpeed: number;
  mass: number;
  damage: ShipDamage;
  weapons: WeaponState;
  special: number;
  brace: number;
  repairing: boolean;
  surrendered: boolean;
  ai?: AiPersonality;
  targetId?: string;
}

export interface ProjectileState {
  id: number;
  ownerId: string;
  ammo: AmmoKind;
  position: Vec3;
  velocity: Vec3;
  life: number;
}

export interface IslandState {
  id: string;
  position: Vec3;
  radius: number;
  height: number;
  palette: number;
  discovered: boolean;
  landmark: 'volcano' | 'arches' | 'palms' | 'fort' | 'needles';
}

export interface RaceState {
  active: boolean;
  countdown: number;
  lap: number;
  totalLaps: number;
  checkpoint: number;
  placement: number;
  elapsed: number;
  wrongWay: boolean;
}

export interface WorldState {
  seed: string;
  seedNumber: number;
  elapsed: number;
  timeScale: number;
  paused: boolean;
  mode: GameMode;
  weather: WeatherKind;
  windDirection: number;
  windStrength: number;
  currentDirection: number;
  currentStrength: number;
  playerId: string;
  objective: string;
  bounty: number;
  treasure: number;
  ships: ShipState[];
  projectiles: ProjectileState[];
  islands: IslandState[];
  race: RaceState;
}

export type InputAction =
  | 'throttle-up'
  | 'throttle-down'
  | 'steer-left'
  | 'steer-right'
  | 'hard-turn'
  | 'fire-port'
  | 'fire-starboard'
  | 'fire-bow'
  | 'cycle-ammo'
  | 'brace'
  | 'repair'
  | 'special'
  | 'camera-left'
  | 'camera-right'
  | 'camera-reset'
  | 'pause';

export interface GameMetrics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  entities: number;
  chunks: number;
}

export const DEBUG_SCENES = [
  'calm-sailing',
  'storm-sailing',
  'sunny-broadside',
  'moby-scale',
  'fleet-battle',
  'damaged-ship',
  'island-discovery',
  'race-start',
  'race-rough',
  'crew-closeup',
  'night-encounter',
  'perf-fleet',
] as const;

export type DebugScene = (typeof DEBUG_SCENES)[number];

export interface CruiseDebugBridge {
  version: 1;
  ready: boolean;
  setScene(scene: DebugScene): Promise<void>;
  getScene(): DebugScene;
  getState(): WorldState;
  getMetrics(): GameMetrics;
  selectShip(kind: ShipKind): void;
  action(action: InputAction, pressed?: boolean): void;
  setPaused(paused: boolean): void;
  step(frames?: number): void;
  setCamera(preset: 'chase' | 'broadside' | 'bow' | 'deck' | 'cinematic' | 'overhead'): void;
}

declare global {
  interface Window {
    __CRUISE_DEBUG__?: CruiseDebugBridge;
  }
}
