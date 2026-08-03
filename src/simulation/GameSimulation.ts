import type {
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
import { FallbackWaveSampler } from './fallbackWaves';
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
}

interface ProjectileSlot {
  active: boolean;
  state: ProjectileState;
}

interface BuoyancyPoint { x: number; z: number }

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

  private readonly seed: string;
  private readonly seedNumber: number;
  private readonly projectileSlots: ProjectileSlot[];
  private readonly actions = new Map<InputAction, boolean>();
  private readonly edgeLatch = new Map<InputAction, boolean>();
  private readonly runtimes = new Map<string, ShipRuntime>();
  private readonly events: SimulationEvent[] = [];
  private accumulator = 0;
  private waveSampler: OceanSampler;
  private scenario: ScenarioPreset;
  private state: WorldState;
  private raceCourse: readonly Vec3[] = [];
  private finishOrder: string[] = [];

  constructor(seed: string, options: GameSimulationOptions = {}) {
    this.seed = seed;
    this.seedNumber = seedHash(seed);
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
  }

  loadScenario(scene: DebugScene): WorldState {
    this.scenario = getScenarioPreset(scene);
    this.state = this.createWorldState(this.scenario);
    this.raceCourse = this.scenario.raceCourse ?? [];
    this.accumulator = 0;
    this.finishOrder = [];
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

  setWaveSampler(sampler: OceanSampler | undefined): void {
    this.waveSampler = sampler ?? new FallbackWaveSampler();
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused;
  }

  setAction(action: InputAction, pressed = true): void {
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
    if (this.justPressed('pause')) this.state.paused = !this.state.paused;
    if (this.state.paused) return 0;
    this.accumulator += clamp(deltaSeconds, 0, 0.25) * this.state.timeScale;
    let iterations = 0;
    while (this.accumulator + 1e-9 >= this.fixedStep && iterations < 15) {
      this.tick(this.fixedStep);
      this.accumulator -= this.fixedStep;
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
    const firstRival = ships.find((ship) => !ship.isPlayer);
    if (ships[0]) ships[0].targetId = firstRival?.id;
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
      name: spec.displayName,
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
      targetId: isPlayer ? undefined : this.scenario.player.id,
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
    };
  }

  private tick(dt: number): void {
    this.state.elapsed += dt;
    this.updateRaceClock(dt);
    const player = this.findShip(this.state.playerId);
    if (player) this.updatePlayerIntent(player, dt);
    for (const ship of this.state.ships) {
      const runtime = this.getRuntime(ship);
      runtime.impactCooldown = Math.max(0, runtime.impactCooldown - dt);
      if (!ship.isPlayer && !ship.surrendered) this.updateAiIntent(ship, runtime, dt);
      this.updateShip(ship, runtime, dt);
    }
    this.resolveShipCollisions();
    this.updateProjectiles(dt);
    this.updateRaceProgress();
    this.updateDiscoveries();
    this.syncProjectileView();
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
  }

  private updatePlayerIntent(ship: ShipState, dt: number): void {
    if (this.state.race.countdown > 0) {
      ship.throttle = 0;
    } else {
      const throttleDelta = (this.isDown('throttle-up') ? 1 : 0) - (this.isDown('throttle-down') ? 1 : 0);
      ship.throttle = clamp(ship.throttle + throttleDelta * dt * 0.68, -0.25, 1);
    }
    const rudderTarget = (this.isDown('steer-right') ? 1 : 0) - (this.isDown('steer-left') ? 1 : 0);
    ship.rudder = damp(ship.rudder, rudderTarget, rudderTarget === 0 ? 5.5 : 9, dt);
    ship.brace = damp(ship.brace, this.isDown('brace') ? 1 : 0, 6, dt);
    ship.repairing = this.isDown('repair') && ship.brace < 0.5;

    if (this.justPressed('cycle-ammo')) {
      const index = AMMO_ORDER.indexOf(ship.weapons.ammo);
      ship.weapons.ammo = AMMO_ORDER[(index + 1) % AMMO_ORDER.length];
    }
    if (!ship.repairing && ship.brace < 0.78) {
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
    const target = this.findShip(ship.targetId ?? this.state.playerId);
    if (!target || target.surrendered) {
      runtime.desiredThrottle = 0.35;
      runtime.desiredRudder = runtime.aiMistake;
      return;
    }
    const dx = target.position.x - ship.position.x;
    const dz = target.position.z - ship.position.z;
    const distance = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);
    const personality = ship.ai ?? 'tactical';
    let desiredHeading = bearing;
    let desiredRange = 72;
    if (personality === 'aggressive') {
      desiredRange = 28;
      desiredHeading = bearing + (distance < 42 ? Math.sin(this.state.elapsed * 0.42) * 0.3 : 0);
      runtime.desiredThrottle = distance < 20 ? 0.3 : 1;
    } else if (personality === 'reckless') {
      desiredRange = 44;
      desiredHeading = bearing + Math.sin(this.state.elapsed * 0.73 + this.deterministicNoise(ship.id, 7) * TAU) * 0.8;
      runtime.desiredThrottle = 0.95;
    } else {
      const orbitSign = this.deterministicNoise(ship.id, 8) > 0.5 ? 1 : -1;
      desiredHeading = bearing + orbitSign * (distance < 115 ? Math.PI * 0.46 : 0.28);
      runtime.desiredThrottle = distance < desiredRange * 0.72 ? 0.28 : distance > desiredRange * 1.35 ? 0.95 : 0.62;
    }
    desiredHeading += this.collisionAvoidanceHeading(ship) + runtime.aiMistake;
    runtime.desiredRudder = clamp(angleDelta(ship.heading, desiredHeading) * 1.65, -1, 1);

    const localForward = dx * forwardX(ship.heading) + dz * forwardZ(ship.heading);
    const localStarboard = dx * starboardX(ship.heading) + dz * starboardZ(ship.heading);
    const broadsideWindow = Math.abs(localForward) < Math.abs(localStarboard) * 0.75;
    if (distance < 160 && broadsideWindow && ship.brace < 0.5) {
      this.fire(ship, localStarboard > 0 ? 'starboard' : 'port');
    } else if (distance < 135 && localForward > Math.abs(localStarboard) * 0.72) {
      this.fire(ship, 'bow');
    }
    const incomingDanger = this.state.projectiles.some((projectile) =>
      projectile.ownerId !== ship.id && distanceSquared(projectile.position, ship.position) < 65 * 65);
    ship.brace = damp(ship.brace, incomingDanger && personality === 'tactical' ? 1 : 0, 5, this.fixedStep * 8);
    ship.repairing = ship.damage.hull > 0.62 && distance > 145 && personality !== 'aggressive';
    if (ship.special >= 1 && (distance < desiredRange || ship.damage.hull > 0.7)) this.activateSpecial(ship);
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
    ship.special = clamp(ship.special + dt * (0.018 + Math.abs(ship.rudder) * 0.006), 0, 1);

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
    const repairDrag = ship.repairing ? 0.72 : 1;
    const desiredSpeed = ship.throttle >= 0
      ? spec.maxSpeed * ship.throttle * windDrive * sailEfficiency * braceDrag * repairDrag
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
    const yawTarget = ship.rudder * spec.turnRate * steeringAtSpeed * damageSteering * turnBoost * (forwardSpeed < 0 ? -0.55 : 1);
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
    const waterY = totalHeight / points.length;
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
    ship.roll = damp(ship.roll, waveRoll + heel, hardTurning ? 5.5 : 3.2, dt);

    const aboveWater = ship.position.y - waterY > 0.48 + spec.draft * 0.035;
    runtime.airtime = aboveWater ? runtime.airtime + dt : 0;
    if (!aboveWater && runtime.previousWaterY - waterY > 0.5 && ship.verticalSpeed < -1.8) {
      this.events.push({ type: 'water-impact', projectileId: 0, ammo: 'heavy', position: cloneVec(ship.position) });
    }
    runtime.previousWaterY = waterY;
  }

  private updateRepairs(ship: ShipState, runtime: ShipRuntime, spec: ShipSpec, dt: number): void {
    if (!ship.repairing || ship.surrendered) {
      runtime.repairTimer = 0;
      return;
    }
    runtime.repairTimer += dt;
    const crewEfficiency = clamp(1 - ship.damage.crew * 0.72, 0.2, 1) * (spec.crewStrength / 160);
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

  private fire(ship: ShipState, side: ShipSide): void {
    const spec = getShipSpec(ship.kind);
    const cooldownKey = side === 'port' ? 'portCooldown' : side === 'starboard' ? 'starboardCooldown' : 'bowCooldown';
    if (side === 'stern' || ship.weapons[cooldownKey] > 0 || ship.surrendered || ship.damage.weapons >= 0.92) return;
    const cannonCount = side === 'bow' ? spec.bowCannons : spec.broadsideCannons;
    if (cannonCount <= 0) return;
    const volleyCount = Math.min(side === 'bow' ? 3 : 6, Math.max(1, Math.ceil(cannonCount * (1 - ship.damage.weapons * 0.72))));
    const baseCooldown = spec.reloadTime * (1 + ship.damage.weapons * 0.9 + ship.damage.crew * 0.42);
    ship.weapons[cooldownKey] = baseCooldown;
    const sideSign = side === 'port' ? -1 : 1;
    const forward = { x: forwardX(ship.heading), z: forwardZ(ship.heading) };
    const starboard = { x: starboardX(ship.heading), z: starboardZ(ship.heading) };
    const ammo = ship.weapons.ammo;
    const velocityMultiplier = ammo === 'heavy' ? 0.8 : ammo === 'chain' ? 0.86 : 1;
    const launchSpeed = spec.projectileSpeed * velocityMultiplier;
    let spawned = 0;
    for (let index = 0; index < volleyCount; index += 1) {
      const normalized = volleyCount === 1 ? 0 : index / (volleyCount - 1) - 0.5;
      const directionX = side === 'bow'
        ? forward.x + starboard.x * normalized * 0.05
        : starboard.x * sideSign + forward.x * normalized * 0.11;
      const directionZ = side === 'bow'
        ? forward.z + starboard.z * normalized * 0.05
        : starboard.z * sideSign + forward.z * normalized * 0.11;
      const directionLength = Math.hypot(directionX, directionZ);
      const along = normalized * spec.length * 0.44;
      const lateral = side === 'bow' ? 0 : sideSign * spec.beam * 0.48;
      const slot = this.acquireProjectile();
      if (!slot) break;
      slot.active = true;
      slot.state.ownerId = ship.id;
      slot.state.ammo = ammo;
      slot.state.position.x = ship.position.x + forward.x * (side === 'bow' ? spec.length * 0.48 : along) + starboard.x * lateral;
      slot.state.position.y = ship.position.y + spec.draft * 0.46 + 1.2;
      slot.state.position.z = ship.position.z + forward.z * (side === 'bow' ? spec.length * 0.48 : along) + starboard.z * lateral;
      slot.state.velocity.x = directionX / directionLength * launchSpeed + forward.x * Math.max(0, ship.speed) * 0.65;
      slot.state.velocity.y = ammo === 'heavy' ? 6.8 : side === 'bow' ? 10.5 : 8.8;
      slot.state.velocity.z = directionZ / directionLength * launchSpeed + forward.z * Math.max(0, ship.speed) * 0.65;
      slot.state.life = 5.5;
      spawned += 1;
    }
    if (spawned > 0) {
      const eventPosition = cloneVec(ship.position);
      if (side === 'bow') {
        eventPosition.x += forward.x * spec.length * 0.48;
        eventPosition.z += forward.z * spec.length * 0.48;
      } else {
        eventPosition.x += starboard.x * sideSign * spec.beam * 0.52;
        eventPosition.z += starboard.z * sideSign * spec.beam * 0.52;
      }
      eventPosition.y += spec.draft * 0.46 + 1.2;
      this.events.push({ type: 'cannon-fired', shipId: ship.id, side, ammo, position: eventPosition, count: spawned });
    }
  }

  private activateSpecial(ship: ShipState): void {
    if (ship.special < 0.999 || ship.surrendered) return;
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
        this.applyAreaDamage(ship, 135, 34, 0.55);
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
      if (target.id === source.id || target.surrendered) continue;
      const distance = Math.sqrt(distanceSquared(source.position, target.position));
      if (distance > radius) continue;
      const falloff = 1 - distance / radius * 0.55;
      const spec = getShipSpec(target.kind);
      target.damage.hull = clamp(target.damage.hull + hullDamage * falloff / spec.hullStrength, 0, 1);
      target.damage.crew = clamp(target.damage.crew + hullDamage * crewMultiplier * falloff / spec.crewStrength, 0, 1);
      target.damage.sails = clamp(target.damage.sails + hullDamage * 0.65 * falloff / spec.sailStrength, 0, 1);
    }
  }

  private updateProjectiles(dt: number): void {
    for (const slot of this.projectileSlots) {
      if (!slot.active) continue;
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
        this.applyProjectileDamage(ship, side, projectile);
        this.events.push({
          type: 'projectile-impact', projectileId: projectile.id, shipId: ship.id, ammo: projectile.ammo,
          position: cloneVec(projectile.position), side,
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

  private applyProjectileDamage(ship: ShipState, side: ShipSide, projectile: ProjectileState): void {
    const attacker = this.findShip(projectile.ownerId);
    const distance = attacker ? Math.sqrt(distanceSquared(attacker.position, ship.position)) : 90;
    const profile = damageProfile(projectile.ammo, distance);
    const spec = getShipSpec(ship.kind);
    const braceReduction = 1 - ship.brace * 0.68;
    ship.damage.hull = clamp(ship.damage.hull + profile.hull / spec.hullStrength * braceReduction, 0, 1);
    ship.damage.sails = clamp(ship.damage.sails + profile.sails / spec.sailStrength * braceReduction, 0, 1);
    ship.damage.weapons = clamp(ship.damage.weapons + profile.weapons / spec.weaponStrength * braceReduction, 0, 1);
    ship.damage.crew = clamp(ship.damage.crew + profile.crew / spec.crewStrength * braceReduction, 0, 1);
    ship.damage.sections[side] = clamp(ship.damage.sections[side] + profile.hull / spec.hullStrength * 1.7 * braceReduction, 0, 1);
    ship.roll += (side === 'starboard' ? -1 : side === 'port' ? 1 : 0) * profile.hull / spec.mass * 0.8;
    if (ship.damage.hull >= 0.9 && ship.ai && ship.damage.crew > 0.58) ship.surrendered = true;
    this.checkDisabled(ship);
  }

  private resolveShipCollisions(): void {
    for (let i = 0; i < this.state.ships.length; i += 1) {
      const first = this.state.ships[i];
      const firstRuntime = this.getRuntime(first);
      const firstSpec = getShipSpec(first.kind);
      for (let j = i + 1; j < this.state.ships.length; j += 1) {
        const second = this.state.ships[j];
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
        const reduction = 1 - target.brace * 0.7;
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
        this.checkDisabled(target);
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
      this.state.treasure += 1;
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

  private checkDisabled(ship: ShipState): void {
    if (ship.damage.hull < 0.98) return;
    ship.surrendered = true;
    ship.throttle = 0;
    const runtime = this.getRuntime(ship);
    if (runtime.disabledEventSent) return;
    runtime.disabledEventSent = true;
    this.events.push({ type: 'ship-disabled', shipId: ship.id, position: cloneVec(ship.position) });
  }

  private acquireProjectile(): ProjectileSlot | undefined {
    return this.projectileSlots.find((slot) => !slot.active);
  }

  private syncProjectileView(): void {
    this.state.projectiles.length = 0;
    for (const slot of this.projectileSlots) if (slot.active) this.state.projectiles.push(slot.state);
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
