import type {
  AiCombatRole,
  CrewAllocation,
  CrewPreset,
  ShipKind,
  VoyageBuildId,
  AmmoKind,
  DebugScene,
  InputAction,
  ProjectileState,
  ShipDamage,
  ShipSide,
  ShipState,
  Vec3,
  WorldState,
} from '../core/contracts';
import { getScenarioPreset, getShipSpec, type ScenarioPreset, type ScenarioShip, type ShipSpec } from '../content';
import { CREW_PRESETS, HARBOR_REFITS, VOYAGE_BUILDS, VOYAGE_CONTRACTS, VOYAGE_LANDMARKS, VOYAGE_UPGRADES, createVoyageRoutes } from '../content/voyages';
import { cannonVolleyCount, cannonVolleyOffset, sampleCannonTrajectory } from './ballistics';
import { isNavalSave } from './saveValidation';
import { voyageSequence } from './voyageIdentity';
import { MOBY_PRESSURE_DURATION, MOBY_PRESSURE_RADIUS, polarDiveDepth, polarWeaponsLocked, pressureWaveRadius } from './specials';
import { LogicalWorld } from '../world/LogicalWorld';
import { FallbackWaveSampler } from './fallbackWaves';
import {
  areFactionsAllied,
  areFactionsHostile,
  defaultCombatRoleForShip,
  defaultFactionForShip,
} from './factions';
import type { ActionState, GameSimulationOptions, OceanSampler, SimulationEvent } from './types';

const TAU = Math.PI * 2;
const INPUT_ACTIONS: readonly InputAction[] = [
  'throttle-up', 'throttle-down', 'steer-left', 'steer-right', 'hard-turn',
  'fire-port', 'fire-starboard', 'fire-bow', 'cycle-ammo', 'brace', 'repair', 'special',
  'camera-left', 'camera-right', 'camera-reset', 'pause',
];
const AMMO_ORDER: readonly AmmoKind[] = ['round', 'chain', 'heavy', 'explosive'];

interface ShipRuntime {
  velocityX: number;
  velocityZ: number;
  yawVelocity: number;
  repairTimer: number;
  aiThinkTimer: number;
  aiMistakeTimer: number;
  aiMistake: number;
  desiredThrottle: number;
  desiredRudder: number;
  raceCheckpoint: number;
  raceLap: number;
  raceFinished: boolean;
  raceFinishTime: number;
  impactCooldown: number;
  disabledEventSent: boolean;
  previousWaterY: number;
  airtime: number;
  homeX: number;
  homeZ: number;
  aggroTimer: number;
  provokedBy?: string;
  targetLockTimer: number;
  lastAttackerId?: string;
  weakPointSide?: ShipSide;
  weakPointTimer: number;
  weakPointCooldown: number;
  hazardCooldown: number;
  rewardGranted: boolean;
  tacticalPhase: number;
}

interface ProjectileSlot {
  active: boolean;
  state: ProjectileState;
  pending?: { delay: number; side: 'port' | 'starboard' | 'bow'; lead: number; gunOffset: number; spread: number };
}

export interface NavalSave {
  version: 1;
  seed: string;
  state: WorldState;
  scenario: DebugScene;
  runtimes: [string, ShipRuntime][];
  projectiles: ProjectileSlot[];
  accumulator: number;
  directorTimer: number;
  reinforcementSerial: number;
  finishOrder: string[];
  raceCourse: readonly Vec3[];
  authoredIslands: WorldState['islands'];
}

interface BuoyancyPoint { x: number; z: number }
interface ProjectileImpactResult { weakPoint: boolean; combo?: number }
interface CombatReward { bountyReward: number; treasureReward: number }

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const damp = (current: number, target: number, smoothing: number, dt: number): number =>
  target + (current - target) * Math.exp(-smoothing * dt);
const angleDelta = (from: number, to: number): number => {
  let value = (to - from) % TAU;
  if (value > Math.PI) value -= TAU;
  if (value < -Math.PI) value += TAU;
  return value;
};
const distanceSquared = (a: Vec3, b: Vec3): number => {
  const x = a.x - b.x;
  const z = a.z - b.z;
  return x * x + z * z;
};
const cloneVec = (value: Vec3): Vec3 => ({ x: value.x, y: value.y, z: value.z });
const forwardX = (heading: number): number => -Math.sin(heading);
const forwardZ = (heading: number): number => -Math.cos(heading);
const starboardX = (heading: number): number => Math.cos(heading);
const starboardZ = (heading: number): number => -Math.sin(heading);

function seedHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function emptyDamage(): ShipDamage {
  return { hull: 0, sails: 0, weapons: 0, crew: 0, sections: { bow: 0, stern: 0, port: 0, starboard: 0 } };
}

function makeBuoyancyPoints(spec: ShipSpec): BuoyancyPoint[] {
  const halfLength = spec.length * 0.39;
  const halfBeam = spec.beam * 0.36;
  const points: BuoyancyPoint[] = [
    { x: 0, z: -halfLength },
    { x: 0, z: halfLength },
    { x: -halfBeam, z: 0 },
    { x: halfBeam, z: 0 },
    { x: 0, z: 0 },
  ];
  if (spec.buoyancySamples >= 6) points.push({ x: -halfBeam * 0.74, z: -halfLength * 0.55 });
  if (spec.buoyancySamples >= 7) points.push({ x: halfBeam * 0.74, z: -halfLength * 0.55 });
  if (spec.buoyancySamples >= 8) points.push({ x: 0, z: halfLength * 0.58 });
  return points;
}

function damageProfile(ammo: AmmoKind, distance: number): { hull: number; sails: number; weapons: number; crew: number } {
  switch (ammo) {
    case 'chain': return { hull: 3, sails: 30, weapons: 4, crew: 5 };
    case 'heavy': {
      const closeBonus = clamp(1.45 - distance / 170, 0.72, 1.25);
      return { hull: 38 * closeBonus, sails: 8, weapons: 17 * closeBonus, crew: 8 };
    }
    case 'explosive': return { hull: 24, sails: 16, weapons: 19, crew: 18 };
    default: return { hull: 18, sails: 7, weapons: 10, crew: 7 };
  }
}

export class GameSimulation {
  readonly fixedStep: number;

  private seed: string;
  private seedNumber: number;
  private readonly projectileSlots: ProjectileSlot[];
  private readonly actions = new Map<InputAction, boolean>();
  private readonly edgeLatch = new Map<InputAction, boolean>();
  /** Retain a fast tap until the next fixed step; never replay an old shot after a blocked state. */
  private readonly pendingPressed = new Map<InputAction, number>();
  private readonly runtimes = new Map<string, ShipRuntime>();
  private readonly tickStartPositions = new Map<string, { x: number; z: number }>();
  private readonly events: SimulationEvent[] = [];
  private accumulator = 0;
  private waveSampler: OceanSampler;
  private scenario: ScenarioPreset;
  private state: WorldState;
  private raceCourse: readonly Vec3[] = [];
  private finishOrder: string[] = [];
  private directorTimer = 0;
  private reinforcementSerial = 0;
  private logicalWorld: LogicalWorld;
  private authoredIslands: WorldState['islands'] = [];
  private aimSide?: 'port' | 'starboard';
  private aimAdjustment = 0;

  constructor(seed: string, options: GameSimulationOptions = {}) {
    this.seed = seed;
    this.seedNumber = seedHash(seed);
    this.logicalWorld = new LogicalWorld(this.seedNumber);
    this.fixedStep = options.fixedStep ?? 1 / 60;
    this.waveSampler = options.waveSampler ?? new FallbackWaveSampler();
    const capacity = Math.max(24, Math.floor(options.projectileCapacity ?? 160));
    this.projectileSlots = Array.from({ length: capacity }, (_, index) => ({
      active: false,
      state: {
        id: index + 1,
        ownerId: '',
        ammo: 'round' as AmmoKind,
        position: { x: 0, y: -1_000, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        life: 0,
      },
    }));
    for (const action of INPUT_ACTIONS) {
      this.actions.set(action, false);
      this.edgeLatch.set(action, false);
    }
    this.scenario = getScenarioPreset('calm-sailing');
    this.state = this.createWorldState(this.scenario);
    this.resetLogicalWorld(this.scenario.islands.map((island) => ({ ...island, discovered: island.discovered ?? false })));
    for (const ship of this.state.ships) this.runtimes.set(ship.id, this.createRuntime(ship));
  }

  loadScenario(scene: DebugScene, options: { preservePlayer?: boolean } = {}): WorldState {
    const previousPlayer = options.preservePlayer ? structuredClone(this.findShip(this.state.playerId)) : undefined;
    const progression = this.state.progression;
    this.scenario = getScenarioPreset(scene);
    this.state = this.createWorldState(this.scenario);
    if (progression) this.state.progression = progression;
    if (previousPlayer) {
      const spawn = this.state.ships[0]!;
      this.state.ships[0] = { ...previousPlayer, id: spawn.id, position: spawn.position, heading: spawn.heading, targetId: spawn.targetId, surrendered: false, finish: undefined };
      this.state.progression!.selectedShip = previousPlayer.kind;
    }
    this.resetLogicalWorld(this.scenario.islands.map((island) => ({ ...island, discovered: island.discovered ?? false })));
    this.clearActions();
    this.raceCourse = this.scenario.raceCourse ?? [];
    this.accumulator = 0;
    this.finishOrder = [];
    this.directorTimer = 0;
    this.reinforcementSerial = 0;
    this.events.length = 0;
    this.runtimes.clear();
    for (const ship of this.state.ships) this.runtimes.set(ship.id, this.createRuntime(ship));
    for (const slot of this.projectileSlots) {
      slot.active = false;
      slot.state.life = 0;
    }
    this.syncProjectileView();
    return this.state;
  }

  selectPlayerShip(kind: ShipKind): void {
    const previous = this.findShip(this.state.playerId);
    if (!previous) return;
    const replacement = this.createShip({ id: previous.id, kind, position: previous.position, heading: previous.heading }, true);
    Object.assign(replacement, { damage: previous.damage, crew: previous.crew, crewPreset: previous.crewPreset, special: previous.special, throttle: previous.throttle, weapons: previous.weapons });
    this.state.ships[this.state.ships.indexOf(previous)] = replacement;
    this.state.progression!.selectedShip = kind;
    this.runtimes.set(replacement.id, this.createRuntime(replacement));
  }

  setCrewPreset(preset: CrewPreset): boolean {
    if (!Object.hasOwn(CREW_PRESETS, preset)) return false;
    const player = this.findShip(this.state.playerId);
    if (!player || player.surrendered) return false;
    this.rescaleCrewReload(player, CREW_PRESETS[preset]);
    player.crew = { ...CREW_PRESETS[preset] };
    player.crewPreset = preset;
    return true;
  }

  setCrewAllocation(allocation: CrewAllocation): boolean {
    if (!allocation || typeof allocation !== 'object') return false;
    const values = [allocation.helm, allocation.guns, allocation.repair, allocation.special];
    if (values.some((value) => !Number.isInteger(value) || value < 1) || values.reduce((sum, value) => sum + value, 0) !== 10) return false;
    const player = this.findShip(this.state.playerId);
    if (!player || player.surrendered) return false;
    this.rescaleCrewReload(player, allocation);
    player.crew = { ...allocation };
    player.crewPreset = undefined;
    return true;
  }

  /** Preserve reload work when hands leave or return to the guns. */
  private rescaleCrewReload(ship: ShipState, next: CrewAllocation): void {
    const previousEfficiency = .55 + (ship.crew?.guns ?? 3) * .15;
    const nextEfficiency = .55 + next.guns * .15;
    const ratio = previousEfficiency / nextEfficiency;
    for (const key of ['portCooldown', 'starboardCooldown', 'bowCooldown'] as const) ship.weapons[key] *= ratio;
  }

  returnToHarbor(): boolean {
    const old = this.state.voyage;
    if (old && ['encounter', 'route', 'reward'].includes(old.phase)) return false;
    const kind = this.state.progression!.selectedShip;
    this.loadScenario('crew-closeup');
    this.selectPlayerShip(kind);
    this.state.ships[0]!.throttle = 0;
    this.state.voyage = { id: '', phase: 'harbor', contractId: '', buildId: 'precision', leg: 0, totalLegs: 3, routes: [], unbankedCoins: 0, earnedBounty: 0, upgrades: [], rewardChoices: [], extractionReady: false };
    this.state.objective = 'Dawn Harbor — choose a contract, fit your ship, and make sail';
    this.resetLogicalWorld(VOYAGE_LANDMARKS);
    return true;
  }

  startVoyage(contractId: string, buildId: VoyageBuildId): boolean {
    const contract = VOYAGE_CONTRACTS.find((entry) => entry.id === contractId);
    const build = VOYAGE_BUILDS.find((entry) => entry.id === buildId);
    if (!contract || !build || this.state.voyage && ['route', 'encounter', 'reward'].includes(this.state.voyage.phase)) return false;
    const progression = this.state.progression!;
    // Do not reuse an existing payout identity, even if an in-memory caller changed the counter.
    const sequence = progression.paidVoyageIds.reduce((latest, id) => Math.max(latest, voyageSequence(this.seed, id) ?? 0), progression.totalVoyages) + 1;
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 1e9) return false;
    const kind = this.state.progression!.selectedShip;
    this.loadScenario('crew-closeup');
    this.selectPlayerShip(kind);
    this.state.progression!.totalVoyages = sequence;
    const id = `${this.seed}:${sequence}`;
    this.state.voyage = {
      id, phase: 'route', contractId, buildId, leg: 1, totalLegs: contract.legs,
      routes: createVoyageRoutes(id, contractId, 1), unbankedCoins: 0, earnedBounty: 0,
      upgrades: [], rewardChoices: [], extractionReady: false,
    };
    this.state.objective = 'Choose your first route';
    this.state.paused = false;
    this.setCrewPreset(build.crew);
    this.resetLogicalWorld(VOYAGE_LANDMARKS);
    return true;
  }

  chooseRoute(routeId: string): boolean {
    const voyage = this.state.voyage;
    if (!voyage || voyage.phase !== 'route') return false;
    const route = createVoyageRoutes(voyage.id, voyage.contractId, voyage.leg).find((entry) => entry.id === routeId);
    const player = this.findShip(this.state.playerId);
    if (!route || !voyage.routes.some((entry) => entry.id === routeId) || !player) return false;
    this.clearActions();
    this.events.length = 0;
    this.state.ships = [player];
    player.position = { x: 0, y: 0, z: 100 };
    player.heading = 0;
    player.speed = 0;
    player.throttle = 0.35;
    player.targetId = undefined;
    this.runtimes.clear();
    this.runtimes.set(player.id, this.createRuntime(player));
    for (const slot of this.projectileSlots) slot.active = false;
    this.syncProjectileView();
    const targets: string[] = [];
    const hostileFaction = player.faction === 'marine' ? 'big-mom' : 'marine';
    const isCombat = route.kind === 'battle' || route.kind === 'boss' || route.kind === 'escort';
    const enemyCount = isCombat ? route.risk === 'dangerous' ? 2 : 1 : 0;
    const rival = this.state.progression!.rivals['sunwatch-captain'];
    for (let index = 0; index < enemyCount; index += 1) {
      const id = `${voyage.id}:leg-${voyage.leg}:enemy-${index}`;
      const boss = route.kind === 'boss' && index === 0;
      const kind: ShipKind = boss && (rival?.escapes ?? 0) > 0 ? 'navy-galleon' : index === 0 ? 'navy-galleon' : 'polar-tang';
      const enemy = this.createShip({ id, kind, name: boss ? 'Captain of Sunwatch' : index === 0 ? 'Dawn Patrol' : 'Reef Interceptor', position: { x: index === 0 ? -105 : 110, y: 0, z: index === 0 ? -65 : -140 }, heading: index === 0 ? 0.2 : -0.6, faction: hostileFaction, ai: boss ? 'tactical' : index === 0 ? 'tactical' : 'reckless', combatRole: boss && (rival?.escapes ?? 0) > 0 ? 'ranged' : index === 0 ? 'broadside' : 'flanker', damage: boss ? 0 : 0.2 }, false);
      enemy.targetId = player.id;
      enemy.special = boss ? 0.65 : 0.25;
      this.state.ships.push(enemy);
      this.runtimes.set(id, this.createRuntime(enemy));
      targets.push(id);
    }
    let escortId: string | undefined;
    if (route.kind === 'escort') {
      escortId = `${voyage.id}:merchant`;
      const merchant = this.createShip({ id: escortId, kind: 'baratie', name: 'Dawn Relief Ship', position: { x: 70, y: 0, z: 90 }, heading: 0, faction: player.faction, ai: 'tactical', combatRole: 'escort', damage: 0.38 }, false);
      this.state.ships.push(merchant);
      this.runtimes.set(escortId, this.createRuntime(merchant));
    }
    if (route.kind === 'boss') {
      this.state.progression!.rivals['sunwatch-captain'] ??= { encounters: 0, escapes: 0, defeated: 0 };
      this.state.progression!.rivals['sunwatch-captain']!.encounters += 1;
    }
    this.state.weather = route.weather;
    this.state.windStrength = route.weather === 'storm' ? 1.45 : 0.92;
    this.state.windDirection = route.weather === 'storm' ? 0.7 : 0.25;
    this.state.mode = isCombat ? 'combat' : 'explore';
    this.state.race.active = false;
    this.state.paused = false;
    const objective = route.kind === 'salvage' ? 'Reach the wreck marker; hold within 65 m for 12 seconds to recover cargo' : route.kind === 'storm' ? 'Sail through the central arch to the gate beyond it' : route.kind === 'escort' ? 'Protect the relief ship for 75 seconds; stay within 260 m' : route.kind === 'boss' ? 'Defeat the Captain of Sunwatch and claim the contract' : 'Disable the patrol — target sails, cross its stern, and finish with a broadside';
    voyage.encounter = { id: `${voyage.id}:leg-${voyage.leg}`, kind: route.kind, title: route.name, objective, targetIds: targets, waypoint: { x: 0, y: 0, z: route.kind === 'storm' ? -560 : -220 }, progress: 0, target: route.kind === 'salvage' ? 12 : route.kind === 'escort' ? 75 : route.kind === 'storm' ? 3 : targets.length, elapsed: 0, reward: route.reward, escortId, completed: false };
    if (route.kind === 'storm') {
      const arch = VOYAGE_LANDMARKS.find((landmark) => landmark.id === 'sky-arch')!;
      voyage.encounter.gates = ['approach', 'arch', 'exit'].map((id, index) => ({
        id, position: { x: arch.position.x, y: 0, z: arch.position.z + (1 - index) * 140 }, halfWidth: arch.radius * .5,
      }));
      voyage.encounter.nextGate = 0;
      voyage.encounter.previousPosition = cloneVec(player.position);
      voyage.encounter.waypoint = cloneVec(voyage.encounter.gates[0]!.position);
    }
    voyage.phase = 'encounter';
    voyage.routes = [];
    voyage.extractionReady = false;
    this.state.objective = objective;
    this.resetLogicalWorld(VOYAGE_LANDMARKS);
    return true;
  }

  chooseReward(upgradeId: string): boolean {
    const voyage = this.state.voyage;
    if (!voyage || voyage.phase !== 'reward' || !voyage.rewardChoices.includes(upgradeId) || !VOYAGE_UPGRADES.some((upgrade) => upgrade.id === upgradeId) || upgradeId !== 'supplies' && voyage.upgrades.includes(upgradeId)) return false;
    if (upgradeId === 'supplies') {
      const player = this.findShip(this.state.playerId)!;
      for (const key of ['hull', 'sails', 'weapons', 'crew'] as const) player.damage[key] = Math.max(0, player.damage[key] - 0.24);
      for (const side of ['port', 'starboard', 'bow', 'stern'] as const) player.damage.sections[side] = Math.max(0, player.damage.sections[side] - 0.24);
    } else voyage.upgrades.push(upgradeId);
    voyage.rewardChoices = [];
    if (voyage.leg >= voyage.totalLegs) return this.settleVoyage('completed');
    voyage.leg += 1;
    voyage.phase = 'route';
    voyage.routes = createVoyageRoutes(voyage.id, voyage.contractId, voyage.leg);
    voyage.extractionReady = true;
    this.state.objective = 'Choose a route, or extract and bank your spoils';
    return true;
  }

  extractVoyage(): boolean {
    const voyage = this.state.voyage;
    if (!voyage || !voyage.extractionReady || !['route', 'reward'].includes(voyage.phase)) return false;
    return this.settleVoyage('extracted');
  }

  buyRefit(refitId: string): boolean {
    if (this.state.voyage?.phase !== 'harbor') return false;
    const refit = HARBOR_REFITS.find((entry) => entry.id === refitId);
    const progression = this.state.progression!;
    if (!refit || progression.bankedCoins < refit.cost || (progression.refits[refitId] ?? 0) >= refit.maxLevel) return false;
    progression.bankedCoins -= refit.cost;
    progression.refits[refitId] = (progression.refits[refitId] ?? 0) + 1;
    return true;
  }

  resolveDisabledShip(shipId: string, choice: 'salvage' | 'spare' | 'sink'): boolean {
    if (!['salvage', 'spare', 'sink'].includes(choice)) return false;
    const ship = this.findShip(shipId);
    const player = this.findShip(this.state.playerId);
    if (!ship || !player || ship.isPlayer || ship.finish?.state !== 'available' || ship.finish.creditedTo !== player.id || distanceSquared(ship.position, player.position) > 240 ** 2) return false;
    ship.finish.state = choice === 'sink' ? 'sinking' : choice === 'salvage' ? 'salvaged' : 'spared';
    ship.finish.elapsed = 0;
    const coins = choice === 'salvage' ? 90 : choice === 'sink' ? 30 : 45;
    if (this.state.voyage && ['encounter', 'reward'].includes(this.state.voyage.phase)) this.state.voyage.unbankedCoins += coins;
    else this.state.treasure += Math.floor(coins / 30);
    if (choice === 'spare') player.special = clamp(player.special + 0.2, 0, 1);
    return true;
  }

  /** Save the simulation and its payout ledger together in one storage value. */
  exportSave(): NavalSave {
    return structuredClone({ version: 1, seed: this.seed, state: this.state, scenario: this.scenario.scene, runtimes: [...this.runtimes], projectiles: this.projectileSlots, accumulator: this.accumulator, directorTimer: this.directorTimer, reinforcementSerial: this.reinforcementSerial, finishOrder: this.finishOrder, raceCourse: this.raceCourse, authoredIslands: this.authoredIslands });
  }

  restoreSave(value: unknown): boolean {
    // Validate and hydrate without touching this instance. Failure is a no-op even if hydration throws.
    let hydrated: { save: NavalSave; seedNumber: number; scenario: ScenarioPreset; world: LogicalWorld; runtimes: Map<string, ShipRuntime> };
    try {
      if (!isNavalSave(value)) return false;
      const save = structuredClone(value);
      // Build 11 Moby saves already applied their instantaneous damage. Give an
      // in-flight legacy phase a visual front without applying those hits again.
      for (const ship of save.state.ships) {
        const phase = ship.specialPhase;
        if (ship.kind === 'moby-dick' && phase && phase.phase !== 'windup' && !phase.pressureWave) {
          const fraction = clamp(phase.elapsed / phase.duration, 0, 1);
          phase.name = 'tremor-broadside';
          phase.duration = phase.phase === 'active' ? MOBY_PRESSURE_DURATION : 1.25;
          phase.elapsed = fraction * phase.duration;
          phase.pressureWave = { origin: cloneVec(ship.position), radius: phase.phase === 'active' ? pressureWaveRadius(phase.elapsed) : MOBY_PRESSURE_RADIUS, hitIds: save.state.ships.filter((target) => target.id !== ship.id).map((target) => target.id) };
        }
      }
      const seedNumber = seedHash(save.seed);
      if (save.state.seedNumber !== seedNumber) return false;
      const scenario = getScenarioPreset(save.scenario);
      const world = new LogicalWorld(seedNumber);
      world.setAuthored(save.authoredIslands);
      const player = save.state.ships.find((ship) => ship.id === save.state.playerId)!;
      const logical = world.update(player.position, save.state.progression!.discoveredIds);
      if (logical) { save.state.islands = logical.islands; save.state.worldFeatures = logical.features; }
      save.state.projectiles = save.projectiles.filter((slot) => slot.active && !slot.pending).map((slot) => slot.state);
      hydrated = { save, seedNumber, scenario, world, runtimes: new Map(save.runtimes) };
    } catch { return false; }
    const { save } = hydrated;
    this.seed = save.seed;
    this.seedNumber = hydrated.seedNumber;
    this.scenario = hydrated.scenario;
    this.state = save.state;
    this.logicalWorld = hydrated.world;
    this.authoredIslands = save.authoredIslands;
    this.runtimes.clear();
    for (const [id, runtime] of hydrated.runtimes) this.runtimes.set(id, runtime);
    this.projectileSlots.splice(0, this.projectileSlots.length, ...save.projectiles);
    this.accumulator = save.accumulator;
    this.directorTimer = save.directorTimer;
    this.reinforcementSerial = save.reinforcementSerial;
    this.finishOrder = save.finishOrder;
    this.raceCourse = save.raceCourse;
    this.events.length = 0;
    this.clearActions();
    return true;
  }

  private settleVoyage(outcome: 'completed' | 'extracted' | 'lost'): boolean {
    const voyage = this.state.voyage;
    const progression = this.state.progression!;
    if (!voyage || !voyage.id || progression.paidVoyageIds.includes(voyage.id) || voyage.phase === 'complete' || voyage.phase === 'failed') return false;
    const contract = VOYAGE_CONTRACTS.find((entry) => entry.id === voyage.contractId)!;
    const coins = outcome === 'lost' ? 0 : voyage.unbankedCoins + (outcome === 'completed' ? contract.reward : 0);
    progression.paidVoyageIds.push(voyage.id);
    progression.bankedCoins += coins;
    if (outcome === 'completed') progression.completedVoyages += 1;
    if (voyage.encounter?.kind === 'boss') {
      const rival = progression.rivals['sunwatch-captain'];
      if (rival) { if (outcome === 'completed') rival.defeated += 1; else rival.escapes += 1; }
    }
    voyage.phase = outcome === 'lost' ? 'failed' : 'complete';
    voyage.result = { coins, bounty: voyage.earnedBounty, outcome };
    voyage.unbankedCoins = 0;
    voyage.extractionReady = false;
    voyage.routes = [];
    voyage.rewardChoices = [];
    this.state.objective = outcome === 'lost' ? 'Voyage lost — your banked treasure is safe at Dawn Harbor' : `Voyage ${outcome} — ${coins} coins banked at Dawn Harbor`;
    this.clearActions();
    return true;
  }

  /** Leave the navigable aftermath only when the captain explicitly collects the reward. */
  collectEncounterReward(): boolean {
    const voyage = this.state.voyage;
    const encounter = voyage?.encounter;
    const player = this.findShip(this.state.playerId);
    if (!voyage || voyage.phase !== 'encounter' || !encounter?.completed || !player) return false;
    if (player.surrendered || player.damage.hull >= .98) { this.settleVoyage('lost'); return false; }
    voyage.unbankedCoins += encounter.reward;
    voyage.phase = 'reward';
    voyage.extractionReady = true;
    const available = VOYAGE_UPGRADES.filter((upgrade) => !voyage.upgrades.includes(upgrade.id));
    const offset = seedHash(`${voyage.id}:${voyage.leg}`) % Math.max(1, available.length);
    voyage.rewardChoices = Array.from({ length: Math.min(3, available.length) }, (_, index) => available[(offset + index) % available.length]!.id);
    if (!voyage.rewardChoices.includes('supplies')) voyage.rewardChoices[voyage.rewardChoices.length - 1] = 'supplies';
    this.state.objective = 'Spoils collected — choose a refit or extract';
    this.clearActions();
    return true;
  }

  private updateVoyage(dt: number): void {
    const voyage = this.state.voyage;
    const encounter = voyage?.encounter;
    if (!voyage || voyage.phase !== 'encounter' || !encounter) return;
    const player = this.findShip(this.state.playerId)!;
    if (player.surrendered || player.damage.hull >= .98) { this.settleVoyage('lost'); return; }
    encounter.elapsed += dt;
    if (encounter.completed) return;
    if (encounter.kind === 'battle' || encounter.kind === 'boss') {
      encounter.progress = encounter.targetIds.filter((id) => this.findShip(id)?.surrendered).length;
    } else if (encounter.kind === 'salvage') {
      if (distanceSquared(player.position, encounter.waypoint) <= 65 ** 2) encounter.progress += dt;
    } else if (encounter.kind === 'storm') {
      const previous = encounter.previousPosition!;
      const gates = encounter.gates!;
      while ((encounter.nextGate ?? 0) < gates.length) {
        const gate = gates[encounter.nextGate ?? 0]!;
        if (previous.z <= gate.position.z || player.position.z > gate.position.z) break;
        const t = (previous.z - gate.position.z) / (previous.z - player.position.z);
        const crossingX = previous.x + (player.position.x - previous.x) * t;
        if (Math.abs(crossingX - gate.position.x) + getShipSpec(player.kind).beam * .5 > gate.halfWidth) break;
        encounter.nextGate = (encounter.nextGate ?? 0) + 1;
      }
      encounter.previousPosition = cloneVec(player.position);
      encounter.progress = encounter.nextGate ?? 0;
      const next = gates[Math.min(encounter.progress, gates.length - 1)]!;
      encounter.waypoint = cloneVec(next.position);
      this.state.objective = encounter.progress < gates.length ? `Storm gate ${encounter.progress + 1}/${gates.length} — cross ${next.id === 'arch' ? 'the central arch' : next.id} toward north` : 'Storm passage cleared';
    } else if (encounter.kind === 'escort') {
      const escort = this.findShip(encounter.escortId!);
      if (!escort || escort.surrendered) { this.settleVoyage('lost'); return; }
      if (distanceSquared(player.position, escort.position) <= 260 ** 2) encounter.progress += dt;
    }
    if (encounter.progress + 1e-6 < encounter.target) return;
    encounter.progress = encounter.target;
    encounter.completed = true;
    encounter.resolvedAt = encounter.elapsed;
    // Surviving escort attackers disengage. The captain may navigate, finish targets and watch them sink.
    for (const ship of this.state.ships) {
      if (ship.isPlayer || ship.surrendered) continue;
      ship.targetId = undefined;
      ship.specialPhase = undefined;
      const runtime = this.getRuntime(ship);
      runtime.desiredThrottle = .45;
      runtime.desiredRudder = .22;
    }
    for (const slot of this.projectileSlots) if (slot.pending && slot.state.ownerId !== player.id) { slot.active = false; slot.pending = undefined; }
    this.state.objective = encounter.kind === 'battle' || encounter.kind === 'boss' ? 'Patrol disabled — approach for salvage, mercy or scuttling; collect spoils when ready' : 'Objective secured — collect spoils when ready';
  }

  private shipModifiers(ship: ShipState): { speed: number; turning: number; reload: number; damage: number; repair: number; special: number; incoming: number } {
    const neutral = { speed: 1, turning: 1, reload: 1, damage: 1, repair: 1, special: 1, incoming: 1 };
    if (!ship.isPlayer || !this.state.voyage) return neutral;
    const build = VOYAGE_BUILDS.find((entry) => entry.id === this.state.voyage!.buildId)!;
    const result = { ...neutral, speed: build.speed, turning: build.turning, reload: build.reload, damage: build.damage, repair: build.repair, special: build.special, incoming: build.id === 'guardian' ? 0.82 : 1 };
    for (const upgrade of this.state.voyage.upgrades) {
      if (upgrade === 'powder') { result.reload *= 0.8; result.repair *= 0.85; }
      if (upgrade === 'hull') { result.incoming *= 0.8; result.speed *= 0.92; }
      if (upgrade === 'sails') { result.speed *= 1.15; result.special *= 1.15; result.damage *= 0.92; }
      if (upgrade === 'chain' && ship.weapons.ammo !== 'chain') result.reload *= 1.08;
      if (upgrade === 'medic') { result.repair *= 1.35; result.reload *= 1.1; }
    }
    const refits = this.state.progression!.refits;
    if (refits.rangefinder) { result.damage *= 1.08; result.reload *= 1.04; }
    if (refits['storm-rig']) { result.speed *= 1.08; result.repair *= 0.94; }
    if (refits['repair-locker']) { result.repair *= 1.15; result.speed *= 0.96; }
    return result;
  }

  private resetLogicalWorld(islands: readonly WorldState['islands'][number][]): void {
    this.authoredIslands = structuredClone([...islands]);
    this.logicalWorld.setAuthored(this.authoredIslands);
    this.syncLogicalWorld();
  }

  private syncLogicalWorld(): void {
    const player = this.findShip(this.state.playerId);
    if (!player) return;
    const update = this.logicalWorld.update(player.position, this.state.progression?.discoveredIds ?? []);
    if (update) { this.state.islands = update.islands; this.state.worldFeatures = update.features; }
  }

  private updateDamageAndSpecial(ship: ShipState, dt: number): void {
    this.checkDisabled(ship);
    const finish = ship.finish;
    if (finish) {
      finish.elapsed += dt;
      if (finish.state === 'salvaged' && finish.elapsed > 4) { finish.state = 'sinking'; finish.elapsed = 0; }
      if (finish.state === 'sinking') {
        ship.damageStage = 'sinking';
        if (finish.elapsed >= 12) { finish.state = 'sunk'; ship.damageStage = 'sunk'; }
      } else if (finish.state === 'sunk') { ship.position.y = -40; ship.damageStage = 'sunk'; }
      else ship.damageStage = 'disabled';
    } else ship.damageStage = ship.damage.hull >= 0.66 ? 'critical' : ship.damage.hull >= 0.28 ? 'scarred' : 'intact';
    const phase = ship.specialPhase;
    if (!phase) return;
    if (ship.surrendered) { ship.specialPhase = undefined; return; }
    phase.elapsed += dt;
    if (phase.elapsed < phase.duration) return;
    if (phase.phase === 'windup') {
      if (ship.surrendered) { ship.specialPhase = undefined; return; }
      this.fireSpecial(ship);
      phase.phase = 'active'; phase.elapsed = 0; phase.duration = ship.kind === 'polar-tang' ? 3.2 : ship.kind === 'moby-dick' ? MOBY_PRESSURE_DURATION : 1.2;
    } else if (phase.phase === 'active') { phase.phase = 'recovery'; phase.elapsed = 0; phase.duration = 1.25; }
    else if (ship.kind === 'polar-tang' && !this.polarMuzzlesClear(ship)) {
      // Timed recovery is a minimum. Keep the phase/HUD truthful while the
      // physical hull finishes rising; the clamped timer stays save-valid.
      phase.elapsed = phase.duration;
    }
    else ship.specialPhase = undefined;
  }

  setWaveSampler(sampler: OceanSampler | undefined): void {
    this.waveSampler = sampler ?? new FallbackWaveSampler();
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
    this.accumulator = 0;
    this.clearActions();
  }

  clearActions(): void {
    this.pendingPressed.clear();
    for (const action of INPUT_ACTIONS) { this.actions.set(action, false); this.edgeLatch.set(action, false); }
    this.aimSide = undefined;
    this.aimAdjustment = 0;
  }

  setAim(side?: 'port' | 'starboard', adjustment = 0): void {
    this.aimSide = side;
    this.aimAdjustment = clamp(Number.isFinite(adjustment) ? adjustment : 0, -0.28, 0.28);
  }

  setAction(action: InputAction, pressed = true): void {
    if (pressed && !this.isDown(action)) this.pendingPressed.set(action, this.state.elapsed);
    this.actions.set(action, pressed);
    if (!pressed) this.edgeLatch.set(action, false);
  }

  update(deltaSeconds: number, actionState?: ActionState): number {
    if (actionState) {
      for (const action of INPUT_ACTIONS) {
        const value = actionState[action];
        if (value !== undefined) this.setAction(action, value);
      }
    }
    if (this.justPressed('pause')) {
      this.setPaused(!this.state.paused);
      this.actions.set('pause', true); this.edgeLatch.set('pause', true);
    }
    if (this.state.paused || this.state.voyage && this.state.voyage.phase !== 'encounter') return 0;
    this.accumulator += clamp(deltaSeconds, 0, 0.25) * this.state.timeScale;
    let iterations = 0;
    while (this.accumulator + 1e-9 >= this.fixedStep && iterations < 15) {
      this.tick(this.fixedStep);
      // The epsilon can admit a frame just below one tick; do not save its tiny underflow.
      this.accumulator = Math.max(0, this.accumulator - this.fixedStep);
      iterations += 1;
    }
    if (iterations === 15) this.accumulator = Math.min(this.accumulator, this.fixedStep);
    return this.accumulator / this.fixedStep;
  }

  step(frames = 1, actionState?: ActionState): void {
    if (actionState) {
      for (const action of INPUT_ACTIONS) {
        const value = actionState[action];
        if (value !== undefined) this.setAction(action, value);
      }
    }
    const count = clamp(Math.floor(frames), 0, 600);
    for (let frame = 0; frame < count; frame += 1) this.tick(this.fixedStep);
  }

  getState(): WorldState {
    return this.state;
  }

  snapshot(): WorldState {
    return structuredClone(this.state);
  }

  getRaceCourse(): readonly Vec3[] {
    return this.raceCourse;
  }

  drainEvents(): SimulationEvent[] {
    return this.events.splice(0, this.events.length);
  }

  private createWorldState(preset: ScenarioPreset): WorldState {
    const ships = [preset.player, ...preset.rivals].map((source, index) => this.createShip(source, index === 0));
    const player = ships[0];
    if (player) {
      player.targetId = ships
        .filter((ship) => ship.id !== player.id && areFactionsHostile(player.faction, ship.faction))
        .sort((first, second) => distanceSquared(player.position, first.position) - distanceSquared(player.position, second.position))[0]?.id;
    }
    return {
      seed: this.seed,
      seedNumber: this.seedNumber,
      elapsed: 0,
      timeScale: 1,
      paused: false,
      mode: preset.mode,
      weather: preset.weather,
      windDirection: preset.windDirection,
      windStrength: preset.windStrength,
      currentDirection: preset.currentDirection,
      currentStrength: preset.currentStrength,
      playerId: preset.player.id,
      objective: preset.objective,
      bounty: preset.bounty ?? 30_000_000,
      treasure: 0,
      ships,
      projectiles: [],
      islands: preset.islands.map((island) => ({ ...island, position: cloneVec(island.position), discovered: island.discovered ?? false })),
      race: {
        active: preset.mode === 'race',
        countdown: preset.raceCountdown ?? 0,
        lap: 1,
        totalLaps: 3,
        checkpoint: 0,
        placement: 1,
        elapsed: 0,
        wrongWay: false,
      },
      progression: { version: 1, bankedCoins: 0, totalVoyages: 0, completedVoyages: 0, selectedShip: ships[0]!.kind, refits: {}, discoveredIds: [], paidVoyageIds: [], rivals: {} },
      combat: {
        combo: 0,
        comboTimer: 0,
        weakPointTimer: 0,
        defeated: 0,
        surrendered: 0,
        reinforcements: 0,
      },
    };
  }

  private createShip(source: ScenarioShip, isPlayer: boolean): ShipState {
    const spec = getShipSpec(source.kind);
    const damage = emptyDamage();
    if (source.damage) {
      damage.hull = clamp(source.damage, 0, 0.95);
      damage.sails = clamp(source.damage * 0.82, 0, 0.9);
      damage.weapons = clamp(source.damage * 0.58, 0, 0.8);
      damage.crew = clamp(source.damage * 0.45, 0, 0.75);
      damage.sections.port = clamp(source.damage * 1.08, 0, 1);
      damage.sections.bow = clamp(source.damage * 0.64, 0, 1);
      damage.sections.stern = clamp(source.damage * 0.78, 0, 1);
      damage.sections.starboard = clamp(source.damage * 0.48, 0, 1);
    }
    return {
      id: source.id,
      kind: source.kind,
      name: source.name ?? spec.displayName,
      isPlayer,
      position: cloneVec(source.position),
      heading: source.heading,
      speed: 0,
      verticalSpeed: 0,
      pitch: 0,
      roll: 0,
      throttle: this.scenario.mode === 'race' ? 0 : isPlayer ? 0.52 : 0.72,
      rudder: 0,
      maxSpeed: spec.maxSpeed,
      mass: spec.mass,
      damage,
      weapons: { portCooldown: 0, starboardCooldown: 0, bowCooldown: 0, ammo: 'round' },
      special: source.damage ? 0.35 : 1,
      brace: 0,
      repairing: false,
      surrendered: false,
      ai: source.ai,
      faction: source.faction ?? defaultFactionForShip(source.kind),
      combatRole: source.combatRole ?? defaultCombatRoleForShip(source.kind),
      targetId: undefined,
      crew: { ...CREW_PRESETS.balanced },
      crewPreset: 'balanced',
      damageStage: source.damage && source.damage > 0.66 ? 'critical' : source.damage && source.damage > 0.28 ? 'scarred' : 'intact',
    };
  }

  private createRuntime(ship: ShipState): ShipRuntime {
    return {
      velocityX: 0,
      velocityZ: 0,
      yawVelocity: 0,
      repairTimer: 0,
      aiThinkTimer: this.deterministicNoise(ship.id, 1) * 0.18,
      aiMistakeTimer: 2.4 + this.deterministicNoise(ship.id, 2) * 4,
      aiMistake: 0,
      desiredThrottle: ship.throttle,
      desiredRudder: 0,
      raceCheckpoint: 0,
      raceLap: 1,
      raceFinished: false,
      raceFinishTime: 0,
      impactCooldown: 0,
      disabledEventSent: false,
      previousWaterY: ship.position.y,
      airtime: 0,
      homeX: ship.position.x,
      homeZ: ship.position.z,
      aggroTimer: 0,
      targetLockTimer: 0,
      weakPointTimer: 0,
      weakPointCooldown: 0,
      hazardCooldown: 0,
      rewardGranted: false,
      tacticalPhase: this.deterministicNoise(ship.id, 31) * TAU,
    };
  }

  private tick(dt: number): void {
    if (this.state.voyage && this.state.voyage.phase !== 'encounter') return;
    this.syncLogicalWorld();
    this.state.elapsed += dt;
    this.updateCombatClock(dt);
    this.updateEncounterDirector(dt);
    this.updateRaceClock(dt);
    // Reuse bounded records and capture before integration or collision
    // separation. Post-collision velocity cannot reconstruct these positions.
    for (const id of this.tickStartPositions.keys()) if (!this.state.ships.some((ship) => ship.id === id)) this.tickStartPositions.delete(id);
    for (const ship of this.state.ships) {
      let point = this.tickStartPositions.get(ship.id);
      if (!point) { point = { x: 0, z: 0 }; this.tickStartPositions.set(ship.id, point); }
      point.x = ship.position.x; point.z = ship.position.z;
    }
    const player = this.findShip(this.state.playerId);
    if (player) {
      this.updatePlayerTarget(player);
      this.updatePlayerIntent(player, dt);
    }
    for (const ship of this.state.ships) {
      const runtime = this.getRuntime(ship);
      runtime.impactCooldown = Math.max(0, runtime.impactCooldown - dt);
      runtime.aggroTimer = Math.max(0, runtime.aggroTimer - dt);
      runtime.targetLockTimer = Math.max(0, runtime.targetLockTimer - dt);
      runtime.weakPointTimer = Math.max(0, runtime.weakPointTimer - dt);
      runtime.weakPointCooldown = Math.max(0, runtime.weakPointCooldown - dt);
      runtime.hazardCooldown = Math.max(0, runtime.hazardCooldown - dt);
      if (runtime.aggroTimer <= 0) runtime.provokedBy = undefined;
      if (!ship.isPlayer && !ship.surrendered && !this.state.voyage?.encounter?.completed) this.updateAiIntent(ship, runtime, dt);
      this.updateShip(ship, runtime, dt);
      this.updateEnvironmentalHazards(ship, runtime, dt);
      this.updateDamageAndSpecial(ship, dt);
    }
    this.resolveShipCollisions();
    for (const ship of this.state.ships) this.updatePressureWave(ship);
    this.updateProjectiles(dt);
    this.updateRaceProgress();
    this.updateDiscoveries();
    this.syncCombatTelemetry();
    this.syncProjectileView();
    this.updateVoyage(dt);
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
  }

  private updateCombatClock(dt: number): void {
    const combat = this.state.combat;
    if (!combat) return;
    combat.comboTimer = Math.max(0, combat.comboTimer - dt);
    if (combat.comboTimer <= 0) combat.combo = 0;
  }

  private updateEncounterDirector(dt: number): void {
    if (this.state.mode === 'race' || this.state.voyage) return;
    this.directorTimer -= dt;
    if (this.directorTimer > 0) return;
    this.directorTimer = 2;
    const player = this.findShip(this.state.playerId);
    if (!player) return;

    if (this.state.mode === 'explore' || this.state.mode === 'discovery') {
      for (const ship of this.state.ships) {
        if (ship.isPlayer || ship.surrendered) continue;
        const runtime = this.getRuntime(ship);
        const distance = Math.sqrt(distanceSquared(ship.position, player.position));
        if (distance > 680 && !ship.targetId) {
          const angle = this.deterministicNoise(ship.id, Math.floor(this.state.elapsed / 18) + 200) * TAU;
          runtime.homeX = player.position.x + Math.cos(angle) * 480;
          runtime.homeZ = player.position.z + Math.sin(angle) * 480;
        }
        if (distance > 1_450) {
          const angle = this.deterministicNoise(ship.id, Math.floor(this.state.elapsed / 25) + 400) * TAU;
          const radius = 560 + this.deterministicNoise(ship.id, 405) * 110;
          ship.position.x = player.position.x + Math.cos(angle) * radius;
          ship.position.z = player.position.z + Math.sin(angle) * radius;
          runtime.homeX = ship.position.x;
          runtime.homeZ = ship.position.z;
          runtime.velocityX = 0;
          runtime.velocityZ = 0;
          ship.targetId = undefined;
        }
      }
    }

    if (this.scenario.scene !== 'calm-sailing' || this.state.elapsed < 32 || this.reinforcementSerial >= 1 || this.state.ships.length >= 10) return;
    const nearbyHostiles = this.state.ships.filter((ship) =>
      !ship.surrendered && this.shipsHostile(player, ship) && distanceSquared(player.position, ship.position) < 720 * 720).length;
    if (nearbyHostiles >= 3) return;
    this.spawnMarineReinforcement(player);
  }

  private spawnMarineReinforcement(player: ShipState): void {
    this.reinforcementSerial += 1;
    const id = `marine-reinforcement-${this.reinforcementSerial}`;
    const angle = this.deterministicNoise(id, 501) * TAU;
    const radius = 480;
    const x = player.position.x + Math.cos(angle) * radius;
    const z = player.position.z + Math.sin(angle) * radius;
    const heading = Math.atan2(-(player.position.x - x), -(player.position.z - z));
    const ship = this.createShip({
      id,
      name: `Marine Hunter ${String(this.reinforcementSerial).padStart(2, '0')}`,
      kind: 'navy-galleon',
      position: { x, y: 0, z },
      heading,
      ai: 'tactical',
      faction: 'marine',
      combatRole: this.reinforcementSerial % 2 ? 'ranged' : 'flanker',
    }, false);
    ship.targetId = player.id;
    this.state.ships.push(ship);
    const runtime = this.createRuntime(ship);
    runtime.targetLockTimer = 7.5;
    this.runtimes.set(ship.id, runtime);
    if (this.state.combat) this.state.combat.reinforcements += 1;
  }

  private updatePlayerTarget(player: ShipState): void {
    const current = player.targetId ? this.findShip(player.targetId) : undefined;
    let best: ShipState | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of this.state.ships) {
      if (candidate.id === player.id || candidate.surrendered || !this.shipsHostile(player, candidate)) continue;
      const distance = Math.sqrt(distanceSquared(player.position, candidate.position));
      if (distance > 1_200) continue;
      let score = distance;
      if (candidate.targetId === player.id) score -= 180;
      if (candidate.id === current?.id) score -= 40;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    player.targetId = best?.id;
  }

  private syncCombatTelemetry(): void {
    const combat = this.state.combat;
    const player = this.findShip(this.state.playerId);
    if (!combat || !player?.targetId) {
      if (combat) {
        combat.weakPointTargetId = undefined;
        combat.weakPointSide = undefined;
        combat.weakPointTimer = 0;
      }
      return;
    }
    const target = this.findShip(player.targetId);
    const runtime = target ? this.runtimes.get(target.id) : undefined;
    if (!target || !runtime || runtime.weakPointTimer <= 0) {
      combat.weakPointTargetId = undefined;
      combat.weakPointSide = undefined;
      combat.weakPointTimer = 0;
      return;
    }
    combat.weakPointTargetId = target.id;
    combat.weakPointSide = runtime.weakPointSide;
    combat.weakPointTimer = runtime.weakPointTimer;
  }

  private updatePlayerIntent(ship: ShipState, dt: number): void {
    if (this.state.race.countdown > 0) {
      ship.throttle = 0;
    } else {
      const throttleDelta = (this.isDown('throttle-up') ? 1 : 0) - (this.isDown('throttle-down') ? 1 : 0);
      ship.throttle = clamp(ship.throttle + throttleDelta * dt * 0.68, -0.25, 1);
    }
    // With bow = -Z, Three.js positive Y rotation turns toward port. Player right is negative yaw.
    const rudderTarget = (this.isDown('steer-left') ? 1 : 0) - (this.isDown('steer-right') ? 1 : 0);
    ship.rudder = damp(ship.rudder, rudderTarget, rudderTarget === 0 ? 5.5 : 9, dt);
    ship.brace = damp(ship.brace, this.isDown('brace') ? 1 : 0, 6, dt);
    ship.repairing = (this.isDown('repair') || (ship.crew?.repair ?? 0) >= 4) && ship.brace < 0.5;

    if (this.justPressed('cycle-ammo')) {
      const index = AMMO_ORDER.indexOf(ship.weapons.ammo);
      ship.weapons.ammo = AMMO_ORDER[(index + 1) % AMMO_ORDER.length];
    }
    if (!this.isDown('repair') && ship.brace < 0.78) {
      if (this.justPressed('fire-port')) this.fire(ship, 'port');
      if (this.justPressed('fire-starboard')) this.fire(ship, 'starboard');
      if (this.justPressed('fire-bow')) this.fire(ship, 'bow');
    }
    if (this.justPressed('special')) this.activateSpecial(ship);
  }

  private updateAiIntent(ship: ShipState, runtime: ShipRuntime, dt: number): void {
    runtime.aiThinkTimer -= dt;
    runtime.aiMistakeTimer -= dt;
    if (runtime.aiMistakeTimer <= 0) {
      runtime.aiMistakeTimer = 3.5 + this.deterministicNoise(ship.id, Math.floor(this.state.elapsed * 0.2)) * 5;
      const chance = ship.ai === 'reckless' ? 0.42 : ship.ai === 'aggressive' ? 0.18 : 0.1;
      runtime.aiMistake = this.deterministicNoise(ship.id, Math.floor(this.state.elapsed)) < chance
        ? (this.deterministicNoise(ship.id, Math.floor(this.state.elapsed) + 91) - 0.5) * 1.4
        : 0;
    }
    if (runtime.aiThinkTimer > 0) return;
    runtime.aiThinkTimer = ship.ai === 'tactical' ? 0.17 : 0.12;

    if (this.state.mode === 'race' && this.raceCourse.length > 0) {
      this.updateRaceAi(ship, runtime);
      return;
    }
    const role = ship.combatRole ?? defaultCombatRoleForShip(ship.kind);
    if (this.shouldSurrender(ship, role)) {
      this.surrenderShip(ship, runtime.lastAttackerId);
      return;
    }
    if (role === 'flee') {
      this.updateFleeIntent(ship, runtime);
      return;
    }
    const target = this.selectAiTarget(ship, runtime);
    if (!target) {
      this.updatePatrolIntent(ship, runtime, role);
      return;
    }
    ship.targetId = target.id;
    let aimX = target.position.x;
    let aimZ = target.position.z;
    if (role === 'flanker') {
      const targetSpec = getShipSpec(target.kind);
      aimX -= forwardX(target.heading) * targetSpec.length * 0.58;
      aimZ -= forwardZ(target.heading) * targetSpec.length * 0.58;
    }
    const dx = aimX - ship.position.x;
    const dz = aimZ - ship.position.z;
    const distance = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);
    const personality = ship.ai ?? 'tactical';
    let desiredHeading = bearing;
    let desiredRange = 72;
    const orbitSign = this.deterministicNoise(ship.id, 8) > 0.5 ? 1 : -1;
    switch (role) {
      case 'rammer':
        desiredRange = 16;
        desiredHeading = bearing;
        runtime.desiredThrottle = distance < 14 ? 0.28 : 1;
        break;
      case 'ranged':
        desiredRange = 138;
        desiredHeading = bearing + orbitSign * (distance < 190 ? Math.PI * 0.47 : 0.22);
        runtime.desiredThrottle = distance < 95 ? -0.12 : distance > 175 ? 0.94 : 0.48;
        break;
      case 'flanker':
        desiredRange = 48;
        desiredHeading = bearing + orbitSign * (distance < 72 ? 0.34 : 0);
        runtime.desiredThrottle = distance < 28 ? 0.32 : 1;
        break;
      case 'escort':
        desiredRange = 66;
        desiredHeading = bearing + orbitSign * (distance < 115 ? Math.PI * 0.43 : 0.2);
        runtime.desiredThrottle = distance < 42 ? 0.32 : distance > 105 ? 0.92 : 0.6;
        break;
      case 'broadside':
      default:
        desiredRange = 76;
        desiredHeading = bearing + orbitSign * (distance < 128 ? Math.PI * 0.47 : 0.26);
        runtime.desiredThrottle = distance < 48 ? 0.25 : distance > 115 ? 0.92 : 0.58;
        break;
    }
    if (personality === 'aggressive') runtime.desiredThrottle = Math.max(runtime.desiredThrottle, distance > desiredRange * 0.55 ? 0.78 : 0.25);
    if (personality === 'reckless') desiredHeading += Math.sin(this.state.elapsed * 0.73 + runtime.tacticalPhase) * 0.34;
    desiredHeading += this.collisionAvoidanceHeading(ship) + runtime.aiMistake;
    runtime.desiredRudder = clamp(angleDelta(ship.heading, desiredHeading) * 1.65, -1, 1);

    const targetDx = target.position.x - ship.position.x;
    const targetDz = target.position.z - ship.position.z;
    const targetDistance = Math.hypot(targetDx, targetDz);
    const localForward = targetDx * forwardX(ship.heading) + targetDz * forwardZ(ship.heading);
    const localStarboard = targetDx * starboardX(ship.heading) + targetDz * starboardZ(ship.heading);
    const broadsideWindow = Math.abs(localForward) < Math.abs(localStarboard) * 0.75;
    ship.weapons.ammo = this.chooseAiAmmo(role, target, targetDistance);
    if (role !== 'rammer' && targetDistance < (role === 'ranged' ? 205 : 165) && broadsideWindow && ship.brace < 0.5 && !ship.repairing) {
      this.fire(ship, localStarboard > 0 ? 'starboard' : 'port');
    } else if (targetDistance < 138 && localForward > Math.abs(localStarboard) * 0.72 && !ship.repairing) {
      this.fire(ship, 'bow');
    }
    const incomingDanger = this.state.projectiles.some((projectile) =>
      projectile.ownerId !== ship.id
      && distanceSquared(projectile.position, ship.position) < 78 * 78
      && this.projectileThreatensShip(projectile.ownerId, ship));
    const ramBrace = role === 'rammer' && targetDistance < 42 && localForward > 0;
    const braceDecision = incomingDanger && (personality === 'tactical' || ship.damage.hull > 0.42) || ramBrace;
    ship.brace = damp(ship.brace, braceDecision ? 1 : 0, 5, this.fixedStep * 8);
    const damagePressure = ship.damage.hull + ship.damage.sails * 0.45 + ship.damage.weapons * 0.35;
    const repairDistance = role === 'ranged' ? 125 : 175;
    ship.repairing = damagePressure > 0.62 && targetDistance > repairDistance && personality !== 'aggressive' && !incomingDanger;
    if (ship.special >= 1 && (targetDistance < desiredRange || ship.damage.hull > 0.7)) this.activateSpecial(ship);
  }

  private shouldSurrender(ship: ShipState, role: AiCombatRole): boolean {
    const hullThreshold = role === 'flee' ? 0.56 : role === 'escort' ? 0.76 : role === 'rammer' ? 0.93 : 0.86;
    const crewThreshold = role === 'flee' ? 0.48 : 0.68;
    return ship.damage.hull >= hullThreshold && (ship.damage.crew >= crewThreshold || ship.damage.weapons >= 0.88)
      || ship.damage.hull >= Math.min(0.97, hullThreshold + 0.09);
  }

  private selectAiTarget(ship: ShipState, runtime: ShipRuntime): ShipState | undefined {
    const current = ship.targetId ? this.findShip(ship.targetId) : undefined;
    const leash = this.state.mode === 'combat' ? 1_050 : 780;
    if (current && !current.surrendered && this.shipsHostile(ship, current)
      && distanceSquared(ship.position, current.position) <= leash * leash && runtime.targetLockTimer > 0) {
      return current;
    }
    const role = ship.combatRole ?? defaultCombatRoleForShip(ship.kind);
    const aggroRange = this.state.mode === 'combat' ? 900 : role === 'ranged' ? 520 : role === 'escort' ? 440 : 390;
    const escort = role === 'escort' ? this.findEscortAnchor(ship) : undefined;
    let best: ShipState | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of this.state.ships) {
      if (candidate.id === ship.id || candidate.surrendered || !this.shipsHostile(ship, candidate)) continue;
      const distance = Math.sqrt(distanceSquared(ship.position, candidate.position));
      const urgent = candidate.targetId === ship.id || escort && candidate.targetId === escort.id || runtime.provokedBy === candidate.id;
      if (!urgent && distance > aggroRange) continue;
      let score = distance;
      if (candidate.targetId === ship.id) score -= 145;
      if (escort && candidate.targetId === escort.id) score -= 190;
      if (runtime.provokedBy === candidate.id) score -= 240;
      if (candidate.isPlayer && ship.faction === 'marine') {
        // Marine captains treat the player's opening bounty as a standing warrant,
        // strong enough to beat incidental escort aggro in the open world.
        score -= Math.min(360, 160 + this.state.bounty / 250_000);
      }
      if (candidate.id === current?.id) score -= 35;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    ship.targetId = best?.id;
    runtime.targetLockTimer = best ? 2.4 : 0;
    return best;
  }

  private updatePatrolIntent(ship: ShipState, runtime: ShipRuntime, role: AiCombatRole): void {
    ship.targetId = undefined;
    ship.brace = damp(ship.brace, 0, 3.5, this.fixedStep * 8);
    ship.repairing = ship.damage.hull + ship.damage.sails * 0.5 > 0.32;
    ship.weapons.ammo = 'round';
    let targetX = runtime.homeX + Math.cos(this.state.elapsed * 0.035 + runtime.tacticalPhase) * 95;
    let targetZ = runtime.homeZ + Math.sin(this.state.elapsed * 0.035 + runtime.tacticalPhase) * 95;
    if (role === 'escort') {
      const anchor = this.findEscortAnchor(ship);
      if (anchor) {
        const spacing = getShipSpec(anchor.kind).beam + getShipSpec(ship.kind).beam + 18;
        const side = this.deterministicNoise(ship.id, 44) > 0.5 ? 1 : -1;
        targetX = anchor.position.x + starboardX(anchor.heading) * spacing * side - forwardX(anchor.heading) * spacing * 0.45;
        targetZ = anchor.position.z + starboardZ(anchor.heading) * spacing * side - forwardZ(anchor.heading) * spacing * 0.45;
      }
    }
    const dx = targetX - ship.position.x;
    const dz = targetZ - ship.position.z;
    const desired = Math.atan2(-dx, -dz) + this.collisionAvoidanceHeading(ship);
    runtime.desiredRudder = clamp(angleDelta(ship.heading, desired) * 1.45 + runtime.aiMistake * 0.25, -1, 1);
    runtime.desiredThrottle = Math.hypot(dx, dz) > 70 ? 0.64 : 0.38;
  }

  private updateFleeIntent(ship: ShipState, runtime: ShipRuntime): void {
    let threat = runtime.provokedBy ? this.findShip(runtime.provokedBy) : undefined;
    let nearestDistance = threat ? Math.sqrt(distanceSquared(ship.position, threat.position)) : Number.POSITIVE_INFINITY;
    for (const candidate of this.state.ships) {
      if (candidate.id === ship.id || candidate.surrendered || areFactionsAllied(ship.faction, candidate.faction)) continue;
      const distance = Math.sqrt(distanceSquared(ship.position, candidate.position));
      const combatNearby = candidate.targetId === ship.id || candidate.targetId !== undefined && distance < 230;
      if (combatNearby && distance < nearestDistance) {
        threat = candidate;
        nearestDistance = distance;
      }
    }
    if (!threat || nearestDistance > 420) {
      this.updatePatrolIntent(ship, runtime, 'flee');
      return;
    }
    // Merchants may flee any nearby battle without treating neutral ships as
    // an offensive target. Retaliation still promotes an aggressor to hostile.
    ship.targetId = this.shipsHostile(ship, threat) ? threat.id : undefined;
    const away = Math.atan2(-(threat.position.x - ship.position.x), -(threat.position.z - ship.position.z)) + Math.PI;
    runtime.desiredRudder = clamp(angleDelta(ship.heading, away + this.collisionAvoidanceHeading(ship)) * 1.8, -1, 1);
    runtime.desiredThrottle = 1;
    ship.brace = damp(ship.brace, nearestDistance < 105 ? 1 : 0, 5, this.fixedStep * 8);
    ship.repairing = nearestDistance > 175 && ship.damage.hull + ship.damage.sails > 0.28;
  }

  private chooseAiAmmo(role: AiCombatRole, target: ShipState, distance: number): AmmoKind {
    const targetRuntime = this.getRuntime(target);
    if (targetRuntime.weakPointTimer > 0 && distance < 125) return 'heavy';
    if (role === 'flanker' && target.damage.sails < 0.68) return 'chain';
    if (role === 'ranged') return target.damage.weapons < 0.62 ? 'explosive' : 'round';
    if (role === 'rammer') return 'heavy';
    if (role === 'escort' && target.damage.sails < 0.48) return 'chain';
    return distance < 58 ? 'heavy' : 'round';
  }

  private projectileThreatensShip(ownerId: string, ship: ShipState): boolean {
    const owner = this.findShip(ownerId);
    return Boolean(owner && this.shipsHostile(owner, ship));
  }

  private shipsHostile(attacker: ShipState, target: ShipState): boolean {
    const runtime = this.runtimes.get(attacker.id);
    if (runtime?.aggroTimer && runtime.provokedBy === target.id && !areFactionsAllied(attacker.faction, target.faction)) return true;
    if (target.targetId === attacker.id && !areFactionsAllied(attacker.faction, target.faction)) return true;
    return areFactionsHostile(attacker.faction, target.faction);
  }

  private findEscortAnchor(ship: ShipState): ShipState | undefined {
    const player = this.findShip(this.state.playerId);
    if (player && player.id !== ship.id && areFactionsAllied(ship.faction, player.faction)) return player;
    let anchor: ShipState | undefined;
    for (const candidate of this.state.ships) {
      if (candidate.id === ship.id || candidate.surrendered || !areFactionsAllied(ship.faction, candidate.faction)) continue;
      if (!anchor || candidate.mass > anchor.mass) anchor = candidate;
    }
    return anchor;
  }

  private updateRaceAi(ship: ShipState, runtime: ShipRuntime): void {
    const target = this.raceCourse[runtime.raceCheckpoint % this.raceCourse.length];
    const next = this.raceCourse[(runtime.raceCheckpoint + 1) % this.raceCourse.length];
    const lookAhead = ship.ai === 'reckless' ? 0.18 : ship.ai === 'tactical' ? 0.42 : 0.3;
    const targetX = target.x + (next.x - target.x) * lookAhead;
    const targetZ = target.z + (next.z - target.z) * lookAhead;
    const desired = Math.atan2(-(targetX - ship.position.x), -(targetZ - ship.position.z));
    runtime.desiredRudder = clamp(angleDelta(ship.heading, desired + this.collisionAvoidanceHeading(ship) * 0.75 + runtime.aiMistake * 0.35) * 1.8, -1, 1);
    const playerRuntime = this.runtimes.get(this.state.playerId);
    const playerProgress = playerRuntime ? (playerRuntime.raceLap - 1) * this.raceCourse.length + playerRuntime.raceCheckpoint : 0;
    const aiProgress = (runtime.raceLap - 1) * this.raceCourse.length + runtime.raceCheckpoint;
    const rubberBand = clamp(1 + (playerProgress - aiProgress) * 0.014, 0.94, 1.06);
    runtime.desiredThrottle = this.state.race.countdown > 0 ? 0 : rubberBand;
  }

  private updateShip(ship: ShipState, runtime: ShipRuntime, dt: number): void {
    const spec = getShipSpec(ship.kind);
    ship.weapons.portCooldown = Math.max(0, ship.weapons.portCooldown - dt);
    ship.weapons.starboardCooldown = Math.max(0, ship.weapons.starboardCooldown - dt);
    ship.weapons.bowCooldown = Math.max(0, ship.weapons.bowCooldown - dt);
    ship.special = clamp(ship.special + dt * (0.018 + Math.abs(ship.rudder) * 0.006) * this.shipModifiers(ship).special * (0.4 + (ship.crew?.special ?? 2) * 0.3), 0, 1);

    if (!ship.isPlayer) {
      ship.throttle = damp(ship.throttle, runtime.desiredThrottle, 2.3, dt);
      ship.rudder = damp(ship.rudder, runtime.desiredRudder, 5.2, dt);
    }
    if (ship.surrendered) {
      ship.throttle = damp(ship.throttle, 0, 3, dt);
      ship.rudder = damp(ship.rudder, 0, 4, dt);
    }

    this.updateRepairs(ship, runtime, spec, dt);
    const forward = { x: forwardX(ship.heading), z: forwardZ(ship.heading) };
    const windX = -Math.sin(this.state.windDirection);
    const windZ = -Math.cos(this.state.windDirection);
    const windFollowing = clamp((forward.x * windX + forward.z * windZ + 1) * 0.5, 0, 1);
    const windDrive = 0.68 + windFollowing * 0.34 * this.state.windStrength;
    const sailEfficiency = clamp(1 - ship.damage.sails * 0.78, 0.16, 1);
    const hullDrag = 1 + ship.damage.hull * 0.65;
    const braceDrag = 1 - ship.brace * 0.28;
    const repairDrag = ship.repairing ? 0.86 : 1;
    const modifiers = this.shipModifiers(ship);
    const helmEfficiency = 0.79 + (ship.crew?.helm ?? 3) * 0.07;
    const desiredSpeed = ship.throttle >= 0
      ? spec.maxSpeed * ship.throttle * windDrive * sailEfficiency * braceDrag * repairDrag * modifiers.speed * helmEfficiency
      : spec.reverseSpeed * ship.throttle;
    const currentX = -Math.sin(this.state.currentDirection) * this.state.currentStrength * 2.2;
    const currentZ = -Math.cos(this.state.currentDirection) * this.state.currentStrength * 2.2;
    const hardTurning = ship.isPlayer && this.isDown('hard-turn') && Math.abs(ship.rudder) > 0.25 && ship.speed > spec.maxSpeed * 0.28;
    const accel = spec.acceleration * (desiredSpeed >= ship.speed ? 1 : 1.65) / hullDrag;
    const speedTargetX = forward.x * desiredSpeed + currentX;
    const speedTargetZ = forward.z * desiredSpeed + currentZ;
    runtime.velocityX = damp(runtime.velocityX, speedTargetX, accel / Math.max(5, spec.maxSpeed), dt);
    runtime.velocityZ = damp(runtime.velocityZ, speedTargetZ, accel / Math.max(5, spec.maxSpeed), dt);
    if (hardTurning) {
      runtime.velocityX *= Math.exp(-dt * (0.34 + spec.hardTurnGrip * 0.2));
      runtime.velocityZ *= Math.exp(-dt * (0.34 + spec.hardTurnGrip * 0.2));
      ship.special = clamp(ship.special + dt * 0.055, 0, 1);
    }
    const forwardSpeed = runtime.velocityX * forward.x + runtime.velocityZ * forward.z;
    ship.speed = forwardSpeed;
    const speedRatio = clamp(Math.abs(forwardSpeed) / Math.max(1, spec.maxSpeed), 0.08, 1.1);
    const steeringAtSpeed = 0.3 + Math.pow(speedRatio, 0.64) * 0.82;
    const damageSteering = clamp(1 - ship.damage.sails * 0.42 - ship.damage.sections.stern * 0.35, 0.28, 1);
    const turnBoost = hardTurning ? 1.85 * spec.hardTurnGrip : 1;
    const yawTarget = ship.rudder * spec.turnRate * steeringAtSpeed * damageSteering * turnBoost * modifiers.turning * helmEfficiency * (forwardSpeed < 0 ? -0.55 : 1);
    runtime.yawVelocity = damp(runtime.yawVelocity, yawTarget, hardTurning ? 7 : 4, dt);
    ship.heading = (ship.heading + runtime.yawVelocity * dt + TAU) % TAU;
    ship.position.x += runtime.velocityX * dt;
    ship.position.z += runtime.velocityZ * dt;
    this.updateBuoyancy(ship, runtime, spec, hardTurning, dt);
  }

  private updateBuoyancy(ship: ShipState, runtime: ShipRuntime, spec: ShipSpec, hardTurning: boolean, dt: number): void {
    const points = makeBuoyancyPoints(spec);
    let totalHeight = 0;
    let bowHeight = 0;
    let sternHeight = 0;
    let portHeight = 0;
    let starboardHeight = 0;
    let bowCount = 0;
    let sternCount = 0;
    let portCount = 0;
    let starboardCount = 0;
    const cos = Math.cos(ship.heading);
    const sin = Math.sin(ship.heading);
    for (const point of points) {
      const worldX = ship.position.x + point.x * cos + point.z * sin;
      const worldZ = ship.position.z - point.x * sin + point.z * cos;
      const sample = this.waveSampler.sample(worldX, worldZ, this.state.elapsed);
      const height = Number.isFinite(sample.height) ? sample.height : 0;
      totalHeight += height;
      if (point.z < -spec.length * 0.12) { bowHeight += height; bowCount += 1; }
      if (point.z > spec.length * 0.12) { sternHeight += height; sternCount += 1; }
      if (point.x < -spec.beam * 0.12) { portHeight += height; portCount += 1; }
      if (point.x > spec.beam * 0.12) { starboardHeight += height; starboardCount += 1; }
    }
    const dive = polarDiveDepth(ship);
    const sink = ship.finish?.state === 'sinking' ? Math.min(35, ship.finish.elapsed * 2.9) : ship.finish?.state === 'sunk' ? 40 : 0;
    const waterY = totalHeight / points.length - dive - sink;
    const buoyancyFrequency = clamp(4.8 - Math.log10(spec.mass) * 0.55, 2.4, 4.2);
    const verticalAcceleration = (waterY - ship.position.y) * buoyancyFrequency * buoyancyFrequency
      - ship.verticalSpeed * buoyancyFrequency * 1.7;
    ship.verticalSpeed += verticalAcceleration * dt;
    ship.position.y += ship.verticalSpeed * dt;
    const pitchTarget = Math.atan2(
      (bowCount ? bowHeight / bowCount : waterY) - (sternCount ? sternHeight / sternCount : waterY),
      spec.length * 0.72,
    );
    const waveRoll = Math.atan2(
      (starboardCount ? starboardHeight / starboardCount : waterY) - (portCount ? portHeight / portCount : waterY),
      spec.beam * 0.72,
    );
    const heel = -ship.rudder * Math.pow(clamp(Math.abs(ship.speed) / spec.maxSpeed, 0, 1), 1.4)
      * (hardTurning ? 0.27 : 0.14) * (0.75 + spec.mass / 5_000);
    ship.pitch = damp(ship.pitch, pitchTarget, 3.5, dt);
    const floodList = (ship.damage.sections.port - ship.damage.sections.starboard) * ship.damage.hull * 0.16;
    const sinkingList = ship.finish?.state === 'sinking' ? Math.min(0.9, ship.finish.elapsed * 0.075) : 0;
    ship.roll = damp(ship.roll, waveRoll + heel + floodList + sinkingList, hardTurning ? 5.5 : 3.2, dt);

    const aboveWater = ship.position.y - waterY > 0.48 + spec.draft * 0.035;
    runtime.airtime = aboveWater ? runtime.airtime + dt : 0;
    if (!aboveWater && runtime.previousWaterY - waterY > 0.5 && ship.verticalSpeed < -1.8) {
      this.events.push({ type: 'water-impact', projectileId: 0, ammo: 'heavy', position: cloneVec(ship.position) });
    }
    runtime.previousWaterY = waterY;
  }

  private updateEnvironmentalHazards(ship: ShipState, runtime: ShipRuntime, dt: number): void {
    if (ship.surrendered) return;
    const hullRadius = Math.max(4, getShipSpec(ship.kind).beam * 0.43);
    for (const feature of this.state.worldFeatures ?? []) {
      const dx = ship.position.x - feature.x;
      const dz = ship.position.z - feature.z;
      const distance = Math.hypot(dx, dz);
      const contactRadius = feature.radius + hullRadius;
      if (distance >= contactRadius) continue;
      const normalX = distance > 0.001 ? dx / distance : 1;
      const normalZ = distance > 0.001 ? dz / distance : 0;
      const approach = Math.max(0, -(runtime.velocityX * normalX + runtime.velocityZ * normalZ));
      if (feature.kind !== 'reef') {
        ship.position.x = feature.x + normalX * (contactRadius + 0.05);
        ship.position.z = feature.z + normalZ * (contactRadius + 0.05);
        runtime.velocityX += normalX * approach * 1.22;
        runtime.velocityZ += normalZ * approach * 1.22;
      } else {
        runtime.velocityX *= Math.exp(-dt * 1.8);
        runtime.velocityZ *= Math.exp(-dt * 1.8);
        ship.damage.hull = clamp(ship.damage.hull + dt * 0.008 * this.shipModifiers(ship).incoming, 0, 1);
      }
      if (runtime.hazardCooldown <= 0) {
        runtime.hazardCooldown = 1.35;
        const severity = feature.kind === 'reef' ? 0.012 : 0.005 + Math.min(0.07, approach * 0.003);
        ship.damage.hull = clamp(ship.damage.hull + severity * this.shipModifiers(ship).incoming, 0, 1);
        ship.damage.sections.bow = clamp(ship.damage.sections.bow + severity * 1.4, 0, 1);
        this.events.push({ type: 'ram', attackerId: `${feature.kind}:${feature.id}`, targetId: ship.id, position: cloneVec(ship.position), force: 3 + approach });
      }
      this.checkDisabled(ship);
    }
  }

  private updateRepairs(ship: ShipState, runtime: ShipRuntime, spec: ShipSpec, dt: number): void {
    if (!ship.repairing || ship.surrendered) {
      runtime.repairTimer = 0;
      return;
    }
    runtime.repairTimer += dt;
    const crewEfficiency = clamp(1 - ship.damage.crew * 0.72, 0.2, 1) * (spec.crewStrength / 160) * ((ship.crew?.repair ?? 2) / 2) * this.shipModifiers(ship).repair;
    ship.damage.hull = clamp(ship.damage.hull - dt * 0.012 * crewEfficiency, 0, 1);
    ship.damage.sails = clamp(ship.damage.sails - dt * 0.018 * crewEfficiency, 0, 1);
    ship.damage.weapons = clamp(ship.damage.weapons - dt * 0.013 * crewEfficiency, 0, 1);
    for (const side of ['bow', 'stern', 'port', 'starboard'] as const) {
      ship.damage.sections[side] = clamp(ship.damage.sections[side] - dt * 0.009 * crewEfficiency, 0, 1);
    }
    if (runtime.repairTimer >= 1.25) {
      runtime.repairTimer = 0;
      this.events.push({ type: 'repair', shipId: ship.id, position: cloneVec(ship.position) });
    }
  }

  private polarMuzzlesClear(ship: ShipState): boolean {
    return (['port', 'starboard', 'bow'] as const).every((side) => this.polarBatteryMuzzlesClear(ship, side));
  }

  private polarBatteryMuzzlesClear(ship: ShipState, side: 'port' | 'starboard' | 'bow'): boolean {
    const count = cannonVolleyCount(ship, side);
    for (let index = 0; index < count; index++) {
      const muzzle = sampleCannonTrajectory(ship, side, 0, cannonVolleyOffset(index, count)).position;
      const water = this.waveSampler.sample(muzzle.x, muzzle.z, this.state.elapsed).height;
      if (!Number.isFinite(water) || !Number.isFinite(muzzle.y) || muzzle.y <= water + .1) return false;
    }
    return true;
  }

  private fire(ship: ShipState, side: ShipSide): void {
    if (!ship.isPlayer && this.state.voyage?.encounter?.completed) return;
    if (polarWeaponsLocked(ship)) return;
    if (ship.kind === 'polar-tang' && side !== 'stern' && !this.polarBatteryMuzzlesClear(ship, side)) return;
    const spec = getShipSpec(ship.kind);
    const cooldownKey = side === 'port' ? 'portCooldown' : side === 'starboard' ? 'starboardCooldown' : 'bowCooldown';
    if (side === 'stern' || ship.weapons[cooldownKey] > 0 || ship.surrendered || ship.damage.weapons >= 0.92) return;
    const volleyCount = cannonVolleyCount(ship, side);
    if (volleyCount <= 0) return;
    const gunsEfficiency = 0.55 + (ship.crew?.guns ?? 3) * 0.15;
    const baseCooldown = spec.reloadTime * (1 + ship.damage.weapons * 0.9 + ship.damage.crew * 0.42) * this.shipModifiers(ship).reload / gunsEfficiency;
    ship.weapons[cooldownKey] = baseCooldown;
    const ammo = ship.weapons.ammo;
    const lead = ship.isPlayer && side === this.aimSide ? this.aimAdjustment : 0;
    const spread = ship.isPlayer && this.state.voyage?.buildId === 'precision' ? 0.55 : 1;
    let spawned = 0;
    for (let index = 0; index < volleyCount; index += 1) {
      const slot = this.acquireProjectile();
      if (!slot) break;
      slot.active = true;
      slot.state.ownerId = ship.id;
      slot.state.ammo = ammo;
      slot.state.life = 5.5;
      slot.pending = { delay: index * 0.075, side, lead, gunOffset: cannonVolleyOffset(index, volleyCount), spread };
      spawned += 1;
    }
    if (spawned > 0) {
      const runtime = this.getRuntime(ship);
      if (runtime.weakPointCooldown <= 0) {
        runtime.weakPointSide = side;
        runtime.weakPointTimer = side === 'bow' ? 1.65 : 2.35;
        runtime.weakPointCooldown = 0.8;
      }

    }
  }

  private activateSpecial(ship: ShipState): void {
    if (ship.special < 0.999 || ship.surrendered || ship.specialPhase) return;
    ship.special = 0;
    ship.specialPhase = { phase: 'windup', elapsed: 0, duration: ship.kind === 'moby-dick' ? 1.05 : 0.65, name: getShipSpec(ship.kind).special };
  }

  private fireSpecial(ship: ShipState): void {
    const spec = getShipSpec(ship.kind);
    const runtime = this.getRuntime(ship);
    const forward = { x: forwardX(ship.heading), z: forwardZ(ship.heading) };
    ship.special = 0;
    switch (spec.special) {
      case 'coup-de-burst':
        runtime.velocityX += forward.x * 26;
        runtime.velocityZ += forward.z * 26;
        ship.verticalSpeed += 3.8;
        break;
      case 'merry-heart':
        ship.damage.crew *= 0.25;
        ship.damage.sails *= 0.66;
        runtime.velocityX += forward.x * 11;
        runtime.velocityZ += forward.z * 11;
        break;
      case 'tremor-broadside':
        ship.specialPhase!.pressureWave = { origin: cloneVec(ship.position), radius: 0, hitIds: [] };
        ship.weapons.portCooldown = 0;
        ship.weapons.starboardCooldown = 0;
        break;
      case 'conquerors-feint':
        this.applyAreaDamage(ship, 95, 8, 1.6);
        break;
      case 'roger-volley': {
        ship.weapons.portCooldown = 0;
        ship.weapons.starboardCooldown = 0;
        ship.weapons.bowCooldown = 0;
        const originalAmmo = ship.weapons.ammo;
        ship.weapons.ammo = 'explosive';
        this.fire(ship, 'port');
        this.fire(ship, 'starboard');
        this.fire(ship, 'bow');
        ship.weapons.ammo = originalAmmo;
        break;
      }
      case 'submerge-dash':
        runtime.velocityX += forward.x * 22;
        runtime.velocityZ += forward.z * 22;
        ship.brace = 1;
        break;
      case 'soul-cannon':
        this.applyAreaDamage(ship, 175, 27, 0.9);
        break;
      case 'banquet-repair':
        ship.damage.hull *= 0.7;
        ship.damage.sails *= 0.45;
        ship.damage.weapons *= 0.62;
        ship.damage.crew *= 0.3;
        break;
      case 'justice-salvo': {
        ship.weapons.portCooldown = 0;
        ship.weapons.starboardCooldown = 0;
        const originalAmmo = ship.weapons.ammo;
        ship.weapons.ammo = 'heavy';
        this.fire(ship, 'port');
        this.fire(ship, 'starboard');
        ship.weapons.ammo = originalAmmo;
        break;
      }
    }
    this.events.push({ type: 'special', shipId: ship.id, name: spec.special, position: cloneVec(ship.position) });
  }

  private applyAreaDamage(source: ShipState, radius: number, hullDamage: number, crewMultiplier: number): void {
    for (const target of this.state.ships) {
      if (target.id === source.id || target.surrendered || !this.shipsHostile(source, target)) continue;
      const distance = Math.sqrt(distanceSquared(source.position, target.position));
      if (distance > radius) continue;
      const falloff = (1 - distance / radius * 0.55) * this.shipModifiers(target).incoming;
      const spec = getShipSpec(target.kind);
      target.damage.hull = clamp(target.damage.hull + hullDamage * falloff / spec.hullStrength, 0, 1);
      target.damage.crew = clamp(target.damage.crew + hullDamage * crewMultiplier * falloff / spec.crewStrength, 0, 1);
      target.damage.sails = clamp(target.damage.sails + hullDamage * 0.65 * falloff / spec.sailStrength, 0, 1);
      const runtime = this.getRuntime(target);
      runtime.lastAttackerId = source.id;
      runtime.provokedBy = source.id;
      runtime.aggroTimer = 42;
      this.checkDisabled(target, source.id);
    }
  }

  /** Damage crosses the same expanding front exposed in snapshots and rendered by FX. */
  private updatePressureWave(source: ShipState): void {
    const phase = source.specialPhase, wave = phase?.pressureWave;
    if (source.surrendered || !phase || !wave || phase.phase === 'windup') return;
    const previousRadius = wave.radius;
    const radius = phase.phase === 'active' ? pressureWaveRadius(phase.elapsed) : MOBY_PRESSURE_RADIUS;
    if (radius <= previousRadius) return;
    wave.radius = radius;
    for (const target of this.state.ships) {
      if (target.id === source.id || target.surrendered || wave.hitIds.includes(target.id) || !this.shipsHostile(source, target)) continue;
      const distance = Math.sqrt(distanceSquared(wave.origin, target.position));
      const runtime = this.getRuntime(target);
      const previous = this.tickStartPositions.get(target.id) ?? target.position;
      const previousDistance = Math.hypot(previous.x - wave.origin.x, previous.z - wave.origin.z);
      // Swept relative crossing lets a moving hull meet the front, while a ship
      // entering water behind an already-passed wave is not struck retroactively.
      if (distance > radius || previousDistance < previousRadius - 1e-6) continue;
      wave.hitIds.push(target.id);
      const falloff = (1 - distance / MOBY_PRESSURE_RADIUS * .55) * this.shipModifiers(target).incoming * (1 - target.brace * .68);
      const spec = getShipSpec(target.kind);
      target.damage.hull = clamp(target.damage.hull + 34 * falloff / spec.hullStrength, 0, 1);
      target.damage.crew = clamp(target.damage.crew + 34 * .55 * falloff / spec.crewStrength, 0, 1);
      target.damage.sails = clamp(target.damage.sails + 34 * .65 * falloff / spec.sailStrength, 0, 1);
      runtime.lastAttackerId = source.id; runtime.provokedBy = source.id; runtime.aggroTimer = 42;
      this.events.push({ type: 'special-impact', ownerId: source.id, shipId: target.id, name: 'tremor-broadside', position: cloneVec(target.position), radius });
      this.checkDisabled(target, source.id);
    }
  }

  private updateProjectiles(dt: number): void {
    for (const slot of this.projectileSlots) {
      if (!slot.active) continue;
      if (slot.pending) {
        slot.pending.delay -= dt;
        if (slot.pending.delay > 1e-6) continue;
        const owner = this.findShip(slot.state.ownerId);
        if (!owner || owner.surrendered) { slot.active = false; slot.pending = undefined; continue; }
        // A volley queued just before diving is cancelled, never deferred to
        // erupt underwater or unexpectedly fire again after resurfacing.
        if (polarWeaponsLocked(owner)) { slot.active = false; slot.pending = undefined; continue; }
        const pending = slot.pending;
        const launch = sampleCannonTrajectory(owner, pending.side, pending.lead, pending.gunOffset, pending.spread, slot.state.ammo);
        if (owner.kind === 'polar-tang' && launch.position.y <= this.waveSampler.sample(launch.position.x, launch.position.z, this.state.elapsed).height + .1) { slot.active = false; slot.pending = undefined; continue; }
        slot.state.position = launch.position;
        slot.state.velocity = launch.velocity;
        this.events.push({ type: 'cannon-fired', shipId: owner.id, side: pending.side, ammo: slot.state.ammo, position: cloneVec(launch.position), count: 1 });
        slot.pending = undefined;
      }
      const projectile = slot.state;
      projectile.life -= dt;
      projectile.velocity.y -= (projectile.ammo === 'heavy' ? 15 : 12.2) * dt;
      projectile.position.x += projectile.velocity.x * dt;
      projectile.position.y += projectile.velocity.y * dt;
      projectile.position.z += projectile.velocity.z * dt;
      let hit = false;
      for (const ship of this.state.ships) {
        if (ship.id === projectile.ownerId || ship.surrendered) continue;
        const spec = getShipSpec(ship.kind);
        const dx = projectile.position.x - ship.position.x;
        const dz = projectile.position.z - ship.position.z;
        const localForward = dx * forwardX(ship.heading) + dz * forwardZ(ship.heading);
        const localSide = dx * starboardX(ship.heading) + dz * starboardZ(ship.heading);
        const withinHull = Math.abs(localForward) < spec.length * 0.5
          && Math.abs(localSide) < spec.beam * 0.58
          && projectile.position.y > ship.position.y - spec.draft * 0.75
          && projectile.position.y < ship.position.y + spec.draft * 1.9;
        if (!withinHull) continue;
        const side = this.impactSide(localForward, localSide, spec);
        const impact = this.applyProjectileDamage(ship, side, projectile);
        this.events.push({
          type: 'projectile-impact', projectileId: projectile.id, ownerId: projectile.ownerId, shipId: ship.id, ammo: projectile.ammo,
          position: cloneVec(projectile.position), side, weakPoint: impact.weakPoint, combo: impact.combo,
        });
        slot.active = false;
        hit = true;
        break;
      }
      if (hit) continue;
      const water = this.waveSampler.sample(projectile.position.x, projectile.position.z, this.state.elapsed).height;
      if (projectile.life <= 0 || projectile.position.y <= water) {
        if (projectile.life > 0) {
          const position = cloneVec(projectile.position);
          position.y = water;
          this.events.push({ type: 'water-impact', projectileId: projectile.id, ammo: projectile.ammo, position });
        }
        slot.active = false;
      }
    }
  }

  private applyProjectileDamage(ship: ShipState, side: ShipSide, projectile: ProjectileState): ProjectileImpactResult {
    const attacker = this.findShip(projectile.ownerId);
    const wasHostile = attacker ? this.shipsHostile(attacker, ship) : false;
    const distance = attacker ? Math.sqrt(distanceSquared(attacker.position, ship.position)) : 90;
    const profile = damageProfile(projectile.ammo, distance);
    const spec = getShipSpec(ship.kind);
    const runtime = this.getRuntime(ship);
    const weakPoint = runtime.weakPointTimer > 0 && runtime.weakPointSide === side;
    const weakPointMultiplier = weakPoint ? projectile.ammo === 'heavy' ? 1.82 : 1.52 : 1;
    const attack = attacker ? this.shipModifiers(attacker) : { damage: 1 };
    profile.hull *= attack.damage;
    if (attacker?.isPlayer && projectile.ammo === 'chain' && this.state.voyage?.upgrades.includes('chain')) profile.sails *= 1.45;
    const braceReduction = (1 - ship.brace * 0.68) * this.shipModifiers(ship).incoming;
    ship.damage.hull = clamp(ship.damage.hull + profile.hull / spec.hullStrength * braceReduction * weakPointMultiplier, 0, 1);
    ship.damage.sails = clamp(ship.damage.sails + profile.sails / spec.sailStrength * braceReduction * weakPointMultiplier, 0, 1);
    ship.damage.weapons = clamp(ship.damage.weapons + profile.weapons / spec.weaponStrength * braceReduction * weakPointMultiplier, 0, 1);
    ship.damage.crew = clamp(ship.damage.crew + profile.crew / spec.crewStrength * braceReduction, 0, 1);
    ship.damage.sections[side] = clamp(ship.damage.sections[side] + profile.hull / spec.hullStrength * 1.7 * braceReduction * weakPointMultiplier, 0, 1);
    ship.roll += (side === 'starboard' ? -1 : side === 'port' ? 1 : 0) * profile.hull / spec.mass * 0.8;
    if (weakPoint) {
      runtime.weakPointTimer = 0;
      runtime.weakPointSide = undefined;
      runtime.weakPointCooldown = 1.8;
    }
    let combo: number | undefined;
    if (attacker) {
      runtime.lastAttackerId = attacker.id;
      runtime.provokedBy = attacker.id;
      runtime.aggroTimer = 42;
      if (!ship.isPlayer) ship.targetId = attacker.id;
      if (attacker.isPlayer && wasHostile) combo = this.registerPlayerHit(attacker, weakPoint);
    }
    this.checkDisabled(ship, attacker?.id);
    return { weakPoint, combo };
  }

  private resolveShipCollisions(): void {
    for (let i = 0; i < this.state.ships.length; i += 1) {
      const first = this.state.ships[i];
      if (first.damageStage === 'sunk') continue;
      const firstRuntime = this.getRuntime(first);
      const firstSpec = getShipSpec(first.kind);
      for (let j = i + 1; j < this.state.ships.length; j += 1) {
        const second = this.state.ships[j];
        if (second.damageStage === 'sunk') continue;
        const secondRuntime = this.getRuntime(second);
        const secondSpec = getShipSpec(second.kind);
        const dx = second.position.x - first.position.x;
        const dz = second.position.z - first.position.z;
        const distance = Math.hypot(dx, dz);
        const collisionRadius = (Math.max(firstSpec.beam, firstSpec.length * 0.28) + Math.max(secondSpec.beam, secondSpec.length * 0.28)) * 0.45;
        if (distance >= collisionRadius || distance < 0.001) continue;
        const normalX = dx / distance;
        const normalZ = dz / distance;
        const overlap = collisionRadius - distance;
        const totalMass = first.mass + second.mass;
        first.position.x -= normalX * overlap * second.mass / totalMass;
        first.position.z -= normalZ * overlap * second.mass / totalMass;
        second.position.x += normalX * overlap * first.mass / totalMass;
        second.position.z += normalZ * overlap * first.mass / totalMass;
        const relativeVelocity = (firstRuntime.velocityX - secondRuntime.velocityX) * normalX
          + (firstRuntime.velocityZ - secondRuntime.velocityZ) * normalZ;
        if (Math.abs(relativeVelocity) < 2 || firstRuntime.impactCooldown > 0 || secondRuntime.impactCooldown > 0) continue;
        const firstBowAlignment = Math.max(0, forwardX(first.heading) * normalX + forwardZ(first.heading) * normalZ);
        const secondBowAlignment = Math.max(0, -forwardX(second.heading) * normalX - forwardZ(second.heading) * normalZ);
        const attacker = firstBowAlignment >= secondBowAlignment ? first : second;
        const target = attacker === first ? second : first;
        const force = Math.abs(relativeVelocity) * attacker.mass / Math.max(350, target.mass) * (0.6 + Math.max(firstBowAlignment, secondBowAlignment));
        const targetSpec = getShipSpec(target.kind);
        const reduction = (1 - target.brace * 0.7) * this.shipModifiers(target).incoming * (attacker.isPlayer && this.state.voyage?.buildId === 'interceptor' ? 1.3 : 1);
        target.damage.hull = clamp(target.damage.hull + force * 0.022 / (targetSpec.hullStrength / 100) * reduction, 0, 1);
        target.damage.sections.bow = clamp(target.damage.sections.bow + force * 0.028 * reduction, 0, 1);
        firstRuntime.velocityX *= 0.62;
        firstRuntime.velocityZ *= 0.62;
        secondRuntime.velocityX *= 0.62;
        secondRuntime.velocityZ *= 0.62;
        firstRuntime.impactCooldown = 0.8;
        secondRuntime.impactCooldown = 0.8;
        const position = { x: (first.position.x + second.position.x) * 0.5, y: (first.position.y + second.position.y) * 0.5, z: (first.position.z + second.position.z) * 0.5 };
        this.events.push({ type: 'ram', attackerId: attacker.id, targetId: target.id, position, force });
        const targetRuntime = this.getRuntime(target);
        targetRuntime.lastAttackerId = attacker.id;
        targetRuntime.provokedBy = attacker.id;
        targetRuntime.aggroTimer = 38;
        if (!target.isPlayer) target.targetId = attacker.id;
        this.checkDisabled(target, attacker.id);
      }
    }
  }

  private updateRaceClock(dt: number): void {
    if (!this.state.race.active) return;
    if (this.state.race.countdown > 0) {
      this.state.race.countdown = Math.max(0, this.state.race.countdown - dt);
      return;
    }
    if (this.finishOrder.includes(this.state.playerId)) return;
    this.state.race.elapsed += dt;
  }

  private updateRaceProgress(): void {
    if (!this.state.race.active || this.state.race.countdown > 0 || this.raceCourse.length < 2) return;
    for (const ship of this.state.ships) {
      const runtime = this.getRuntime(ship);
      if (runtime.raceFinished) continue;
      const checkpoint = this.raceCourse[runtime.raceCheckpoint];
      // The ceremonial start gate spans the whole four-ship grid; subsequent
      // checkpoints return to the tighter racing line.
      const checkpointRadius = runtime.raceCheckpoint === 0 ? 140 : 38;
      if (distanceSquared(ship.position, checkpoint) > checkpointRadius * checkpointRadius) continue;
      runtime.raceCheckpoint += 1;
      if (runtime.raceCheckpoint >= this.raceCourse.length) {
        runtime.raceCheckpoint = 0;
        runtime.raceLap += 1;
        if (runtime.raceLap > this.state.race.totalLaps) {
          runtime.raceFinished = true;
          runtime.raceFinishTime = this.state.race.elapsed;
          this.finishOrder.push(ship.id);
          this.events.push({ type: 'race-finished', shipId: ship.id, placement: this.finishOrder.length, elapsed: runtime.raceFinishTime });
        }
      }
      this.events.push({ type: 'checkpoint', shipId: ship.id, checkpoint: runtime.raceCheckpoint, lap: runtime.raceLap });
    }
    const player = this.findShip(this.state.playerId);
    const playerRuntime = player ? this.getRuntime(player) : undefined;
    if (player && playerRuntime) {
      this.state.race.checkpoint = playerRuntime.raceCheckpoint;
      this.state.race.lap = Math.min(this.state.race.totalLaps, playerRuntime.raceLap);
      const next = this.raceCourse[playerRuntime.raceCheckpoint];
      const previousIndex = (playerRuntime.raceCheckpoint - 1 + this.raceCourse.length) % this.raceCourse.length;
      const previous = this.raceCourse[previousIndex];
      const courseX = next.x - previous.x;
      const courseZ = next.z - previous.z;
      const courseLength = Math.hypot(courseX, courseZ) || 1;
      const velocity = this.getRuntime(player);
      this.state.race.wrongWay = player.speed > 3
        && (velocity.velocityX * courseX + velocity.velocityZ * courseZ) / (Math.hypot(velocity.velocityX, velocity.velocityZ) * courseLength || 1) < -0.35;
      const progress = this.raceProgress(playerRuntime, player);
      this.state.race.placement = 1 + this.state.ships.filter((ship) => {
        if (ship.id === player.id) return false;
        return this.raceProgress(this.getRuntime(ship), ship) > progress;
      }).length;
    }
  }

  private raceProgress(runtime: ShipRuntime, ship: ShipState): number {
    if (runtime.raceFinished) return 1_000_000 - runtime.raceFinishTime;
    const checkpoint = this.raceCourse[runtime.raceCheckpoint];
    const distanceBonus = checkpoint ? clamp(1 - Math.sqrt(distanceSquared(ship.position, checkpoint)) / 500, 0, 0.99) : 0;
    return (runtime.raceLap - 1) * this.raceCourse.length + runtime.raceCheckpoint + distanceBonus;
  }

  private updateDiscoveries(): void {
    const player = this.findShip(this.state.playerId);
    if (!player) return;
    for (const island of this.state.islands) {
      if (island.discovered || distanceSquared(player.position, island.position) > Math.pow(island.radius + 140, 2)) continue;
      island.discovered = true;
      const discoveries = this.state.progression!.discoveredIds;
      if (!discoveries.includes(island.id)) { discoveries.push(island.id); this.state.treasure += 1; }
      if (this.state.mode === 'discovery') this.state.objective = `Discovered ${island.id.replaceAll('-', ' ')}`;
    }
  }

  private collisionAvoidanceHeading(ship: ShipState): number {
    let correction = 0;
    for (const other of this.state.ships) {
      if (other.id === ship.id) continue;
      const dx = other.position.x - ship.position.x;
      const dz = other.position.z - ship.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 75 || distance < 0.001) continue;
      const bearing = Math.atan2(-dx, -dz);
      const relative = angleDelta(ship.heading, bearing);
      if (Math.abs(relative) < 1.15) correction -= Math.sign(relative || 1) * (1 - distance / 75) * 0.85;
    }
    for (const island of this.state.islands) {
      const dx = island.position.x - ship.position.x;
      const dz = island.position.z - ship.position.z;
      const distance = Math.hypot(dx, dz) - island.radius;
      if (distance > 125) continue;
      const bearing = Math.atan2(-dx, -dz);
      const relative = angleDelta(ship.heading, bearing);
      if (Math.abs(relative) < 1.35) correction -= Math.sign(relative || 1) * (1 - clamp(distance / 125, 0, 1)) * 1.25;
    }
    return correction;
  }

  private impactSide(localForward: number, localSide: number, spec: ShipSpec): ShipSide {
    if (localForward > spec.length * 0.24) return 'bow';
    if (localForward < -spec.length * 0.24) return 'stern';
    return localSide > 0 ? 'starboard' : 'port';
  }

  private registerPlayerHit(player: ShipState, weakPoint: boolean): number {
    const combat = this.state.combat;
    if (!combat) return 0;
    combat.combo = combat.comboTimer > 0 ? combat.combo + 1 : 1;
    combat.comboTimer = 4.25;
    const comboGain = Math.min(0.1, combat.combo * 0.009);
    player.special = clamp(player.special + 0.035 + comboGain + (weakPoint ? 0.14 : 0), 0, 1);
    return combat.combo;
  }

  private surrenderShip(ship: ShipState, attackerId?: string): void {
    if (ship.surrendered) return;
    ship.surrendered = true;
    ship.throttle = 0;
    ship.targetId = undefined;
    const runtime = this.getRuntime(ship);
    if (runtime.disabledEventSent) return;
    runtime.disabledEventSent = true;
    if (this.state.combat && !ship.isPlayer) this.state.combat.surrendered += 1;
    const creditedAttackerId = attackerId ?? runtime.lastAttackerId;
    ship.finish = { state: 'available', elapsed: 0, creditedTo: creditedAttackerId };
    ship.damageStage = 'disabled';
    const reward = this.grantCombatReward(ship, creditedAttackerId, 0.62);
    this.events.push({
      type: 'ship-disabled',
      shipId: ship.id,
      attackerId: creditedAttackerId,
      position: cloneVec(ship.position),
      surrendered: true,
      ...reward,
    });
  }

  private checkDisabled(ship: ShipState, attackerId?: string): void {
    if (ship.damage.hull < 0.98) return;
    ship.surrendered = true;
    ship.throttle = 0;
    ship.targetId = undefined;
    const runtime = this.getRuntime(ship);
    if (runtime.disabledEventSent) return;
    runtime.disabledEventSent = true;
    if (this.state.combat && !ship.isPlayer) this.state.combat.defeated += 1;
    const creditedAttackerId = attackerId ?? runtime.lastAttackerId;
    ship.finish = { state: 'available', elapsed: 0, creditedTo: creditedAttackerId };
    ship.damageStage = 'disabled';
    const reward = this.grantCombatReward(ship, creditedAttackerId, 1);
    this.events.push({ type: 'ship-disabled', shipId: ship.id, attackerId: creditedAttackerId, position: cloneVec(ship.position), ...reward });
  }

  private grantCombatReward(ship: ShipState, attackerId: string | undefined, scale: number): CombatReward {
    const runtime = this.getRuntime(ship);
    if (runtime.rewardGranted || ship.isPlayer || !attackerId) return { bountyReward: 0, treasureReward: 0 };
    const attacker = this.findShip(attackerId);
    const player = this.findShip(this.state.playerId);
    if (!attacker || !player) return { bountyReward: 0, treasureReward: 0 };
    if (areFactionsAllied(ship.faction, player.faction)) return { bountyReward: 0, treasureReward: 0 };
    const contribution = attacker.id === player.id ? 1 : areFactionsAllied(attacker.faction, player.faction) ? 0.32 : 0;
    if (contribution <= 0) return { bountyReward: 0, treasureReward: 0 };
    runtime.rewardGranted = true;
    const spec = getShipSpec(ship.kind);
    const bountyReward = Math.round(spec.hullStrength * 32_000 * scale * contribution / 10_000) * 10_000;
    const treasureReward = attacker.id === player.id ? Math.max(1, Math.round(Math.ceil(spec.hullStrength / 190) * scale)) : 0;
    this.state.bounty += bountyReward;
    this.state.treasure += treasureReward;
    if (this.state.voyage?.phase === 'encounter') {
      this.state.voyage.unbankedCoins += treasureReward * 35;
      this.state.voyage.earnedBounty += bountyReward;
    }
    player.special = clamp(player.special + 0.22 * scale * contribution, 0, 1);
    return { bountyReward, treasureReward };
  }

  private acquireProjectile(): ProjectileSlot | undefined {
    return this.projectileSlots.find((slot) => !slot.active);
  }

  private syncProjectileView(): void {
    this.state.projectiles.length = 0;
    for (const slot of this.projectileSlots) if (slot.active && !slot.pending) this.state.projectiles.push(slot.state);
  }

  private findShip(id: string): ShipState | undefined {
    return this.state.ships.find((ship) => ship.id === id);
  }

  private getRuntime(ship: ShipState): ShipRuntime {
    let runtime = this.runtimes.get(ship.id);
    if (!runtime) {
      runtime = this.createRuntime(ship);
      this.runtimes.set(ship.id, runtime);
    }
    return runtime;
  }

  private isDown(action: InputAction): boolean {
    return this.actions.get(action) === true;
  }

  private justPressed(action: InputAction): boolean {
    const pressedAt = this.pendingPressed.get(action);
    this.pendingPressed.delete(action);
    if (pressedAt !== undefined && this.state.elapsed - pressedAt <= this.fixedStep * 1.5) {
      this.edgeLatch.set(action, this.isDown(action));
      return true;
    }
    if (!this.isDown(action)) {
      this.edgeLatch.set(action, false);
      return false;
    }
    if (this.edgeLatch.get(action)) return false;
    this.edgeLatch.set(action, true);
    return true;
  }

  private deterministicNoise(id: string, salt: number): number {
    let value = (this.seedNumber ^ seedHash(id) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x1_0000_0000;
  }
}
