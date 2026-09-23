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
export type ShipFaction =
  | 'straw-hat'
  | 'marine'
  | 'red-hair'
  | 'whitebeard'
  | 'heart'
  | 'big-mom'
  | 'roger'
  | 'merchant'
  | 'independent';
export type AiCombatRole = 'broadside' | 'ranged' | 'rammer' | 'flanker' | 'escort' | 'flee';

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
  faction?: ShipFaction;
  combatRole?: AiCombatRole;
  targetId?: string;
  crew?: CrewAllocation;
  crewPreset?: CrewPreset;
  damageStage?: 'intact' | 'scarred' | 'critical' | 'disabled' | 'sinking' | 'sunk';
  finish?: { state: 'available' | 'salvaged' | 'spared' | 'sinking' | 'sunk'; elapsed: number; creditedTo?: string };
  specialPhase?: {
    phase: 'windup' | 'active' | 'recovery'; elapsed: number; duration: number; name: string;
    pressureWave?: { origin: Vec3; radius: number; hitIds: string[] };
  };
}

export type CrewPreset = 'balanced' | 'gunnery' | 'sailing' | 'repair' | 'special';
export interface CrewAllocation { helm: number; guns: number; repair: number; special: number }
export type VoyageBuildId = 'precision' | 'interceptor' | 'guardian';
export type VoyagePhase = 'harbor' | 'route' | 'encounter' | 'reward' | 'complete' | 'failed';
export type VoyageEncounterKind = 'battle' | 'salvage' | 'storm' | 'escort' | 'boss';
export interface VoyageRoute {
  id: string;
  name: string;
  description: string;
  kind: VoyageEncounterKind;
  weather: WeatherKind;
  risk: 'measured' | 'dangerous';
  reward: number;
  landmarkId: string;
}
export interface VoyageEncounter {
  id: string;
  kind: VoyageEncounterKind;
  title: string;
  objective: string;
  targetIds: string[];
  waypoint: Vec3;
  progress: number;
  target: number;
  elapsed: number;
  reward: number;
  escortId?: string;
  completed: boolean;
  resolvedAt?: number;
  /** Ordered forward crossing gates, persisted so a save cannot skip the arch. */
  gates?: { id: string; position: Vec3; halfWidth: number }[];
  nextGate?: number;
  previousPosition?: Vec3;
}
export interface VoyageState {
  id: string;
  phase: VoyagePhase;
  contractId: string;
  buildId: VoyageBuildId;
  leg: number;
  totalLegs: number;
  routes: VoyageRoute[];
  encounter?: VoyageEncounter;
  unbankedCoins: number;
  earnedBounty: number;
  upgrades: string[];
  rewardChoices: string[];
  extractionReady: boolean;
  result?: { coins: number; bounty: number; outcome: 'completed' | 'extracted' | 'lost' };
}
export interface ProgressionState {
  version: 1;
  bankedCoins: number;
  totalVoyages: number;
  completedVoyages: number;
  selectedShip: ShipKind;
  refits: Record<string, number>;
  discoveredIds: string[];
  paidVoyageIds: string[];
  rivals: Record<string, { encounters: number; escapes: number; defeated: number }>;
}
export interface WorldCollisionFeature {
  id: string;
  x: number;
  z: number;
  radius: number;
  kind: 'shore' | 'stack' | 'reef';
}

export interface CombatState {
  combo: number;
  comboTimer: number;
  weakPointTargetId?: string;
  weakPointSide?: ShipSide;
  weakPointTimer: number;
  defeated: number;
  surrendered: number;
  reinforcements: number;
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
  name?: string;
  service?: 'harbor' | 'passage' | 'ambush' | 'fort';
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
  /** Optional for bootstrap compatibility; GameSimulation always supplies it. */
  combat?: CombatState;
  voyage?: VoyageState;
  progression?: ProgressionState;
  worldFeatures?: WorldCollisionFeature[];
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
  getAim?(): {side?: "port"|"starboard";adjustment:number;targetId?:string;markerTargetId?:string;impact?:Vec3;guideVisible:boolean};
  selectShip(kind: ShipKind): void | Promise<void>;
  readyAssets?(): Promise<void>;
  getAssets?(): unknown;
  action(action: InputAction, pressed?: boolean): void;
  setPaused(paused: boolean): void;
  step(frames?: number): void;
  setCamera(preset: 'chase' | 'broadside' | 'bow' | 'deck' | 'cinematic' | 'overhead'): void;
  exportSave?(): unknown;
  restoreSave?(value: unknown): boolean;
  voyage?(action: 'harbor' | 'start' | 'route' | 'reward' | 'collect' | 'extract' | 'refit' | 'crew' | 'resolve', id?: string, choice?: string): boolean | Promise<boolean>;
}

declare global {
  interface Window {
    __CRUISE_DEBUG__?: CruiseDebugBridge;
  }
}
