import { DEBUG_SCENES, type ShipState } from '../core/contracts';
import { SHIP_SPECS } from '../content/shipSpecs';
import { HARBOR_REFITS, VOYAGE_BUILDS, VOYAGE_CONTRACTS, VOYAGE_LANDMARKS, VOYAGE_UPGRADES, createVoyageRoutes } from '../content/voyages';
import type { NavalSave } from './GameSimulation';
import { voyageSequence } from './voyageIdentity';
import { MOBY_PRESSURE_RADIUS, pressureWaveRadius } from './specials';

type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const number = (v: unknown, min = -1e9, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v: unknown, min = 0, max = 1e9): v is number => number(v, min, max) && Number.isInteger(v);
const text = (v: unknown, min = 1, max = 512): v is string => typeof v === 'string' && v.length >= min && v.length <= max;
const bool = (v: unknown): v is boolean => typeof v === 'boolean';
const list = (v: unknown, max = 20000): v is unknown[] => Array.isArray(v) && v.length <= max;
const oneOf = (v: unknown, allowed: readonly string[]): v is string => typeof v === 'string' && allowed.includes(v);
const optional = (o: RecordValue, key: string, check: (v: unknown) => boolean): boolean => o[key] === undefined || check(o[key]);
const numbers = (o: RecordValue, keys: readonly string[], min = -1e9, max = 1e9): boolean => keys.every((key) => number(o[key], min, max));
const vector = (v: unknown): boolean => object(v) && numbers(v, ['x', 'y', 'z']);
const strings = (v: unknown, max = 20000): v is string[] => list(v, max) && v.every((entry) => text(entry)) && new Set(v).size === v.length;
const SHIPS = Object.keys(SHIP_SPECS);
const WEATHER = ['calm', 'swell', 'storm', 'fog', 'maelstrom', 'night'];
const SIDES = ['bow', 'stern', 'port', 'starboard'];
const AMMO = ['round', 'chain', 'heavy', 'explosive'];
const KINDS = ['battle', 'salvage', 'storm', 'escort', 'boss'];
const PRESETS = ['balanced', 'gunnery', 'sailing', 'repair', 'special'];

function crew(v: unknown): boolean {
  return object(v) && ['helm', 'guns', 'repair', 'special'].every((key) => integer(v[key], 1, 7))
    && (v.helm as number) + (v.guns as number) + (v.repair as number) + (v.special as number) === 10;
}
function ship(v: unknown): v is ShipState {
  if (!object(v) || !text(v.id) || !text(v.name) || !oneOf(v.kind, SHIPS) || !bool(v.isPlayer) || !vector(v.position)) return false;
  if (!numbers(v, ['heading', 'speed', 'verticalSpeed', 'pitch', 'roll']) || !numbers(v, ['maxSpeed', 'mass'], .001) || !numbers(v, ['throttle', 'rudder'], -1, 1) || !numbers(v, ['special', 'brace'], 0, 1)) return false;
  if (!bool(v.repairing) || !bool(v.surrendered) || !object(v.damage) || !numbers(v.damage, ['hull', 'sails', 'weapons', 'crew'], 0, 1) || !object(v.damage.sections) || !numbers(v.damage.sections, SIDES, 0, 1)) return false;
  if (!object(v.weapons) || !numbers(v.weapons, ['portCooldown', 'starboardCooldown', 'bowCooldown'], 0) || !oneOf(v.weapons.ammo, AMMO)) return false;
  if (!optional(v, 'crew', crew) || !optional(v, 'crewPreset', (x) => oneOf(x, PRESETS)) || !optional(v, 'targetId', text)) return false;
  if (!optional(v, 'ai', (x) => oneOf(x, ['aggressive', 'tactical', 'reckless', 'racer'])) || !optional(v, 'faction', (x) => oneOf(x, ['straw-hat', 'marine', 'red-hair', 'whitebeard', 'heart', 'big-mom', 'roger', 'merchant', 'independent'])) || !optional(v, 'combatRole', (x) => oneOf(x, ['broadside', 'ranged', 'rammer', 'flanker', 'escort', 'flee']))) return false;
  if (!optional(v, 'damageStage', (x) => oneOf(x, ['intact', 'scarred', 'critical', 'disabled', 'sinking', 'sunk']))) return false;
  if (!optional(v, 'finish', (x) => object(x) && oneOf(x.state, ['available', 'salvaged', 'spared', 'sinking', 'sunk']) && number(x.elapsed, 0) && optional(x, 'creditedTo', text))) return false;
  return optional(v, 'specialPhase', (x) => object(x) && oneOf(x.phase, ['windup', 'active', 'recovery']) && number(x.elapsed, 0) && number(x.duration, .001, 60) && x.elapsed <= x.duration && text(x.name)
    && optional(x, 'pressureWave', (wave) => v.kind === 'moby-dick' && x.name === 'tremor-broadside' && x.phase !== 'windup' && x.duration === (x.phase === 'active' ? 1.8 : 1.25) && object(wave) && vector(wave.origin) && number(wave.radius, 0, MOBY_PRESSURE_RADIUS) && strings(wave.hitIds, 20)
      && Math.abs(wave.radius - (x.phase === 'active' ? pressureWaveRadius(x.elapsed as number) : MOBY_PRESSURE_RADIUS)) < 1e-6));
}
function projectile(v: unknown): boolean {
  return object(v) && integer(v.id, 1, 100000) && text(v.ownerId, 0) && oneOf(v.ammo, AMMO) && vector(v.position) && vector(v.velocity) && number(v.life);
}
function slot(v: unknown): boolean {
  return object(v) && bool(v.active) && projectile(v.state) && optional(v, 'pending', (x) => object(x) && number(x.delay, 0, 60) && oneOf(x.side, ['port', 'starboard', 'bow']) && number(x.lead, -Math.PI, Math.PI) && number(x.gunOffset, -1, 1) && number(x.spread, 0, 10));
}
function island(v: unknown): boolean {
  return object(v) && text(v.id) && vector(v.position) && number(v.radius, .001, 100000) && number(v.height, .001, 100000) && integer(v.palette, 0, 1000) && bool(v.discovered) && oneOf(v.landmark, ['volcano', 'arches', 'palms', 'fort', 'needles']) && optional(v, 'name', text) && optional(v, 'service', (x) => oneOf(x, ['harbor', 'passage', 'ambush', 'fort']));
}
function runtime(v: unknown): boolean {
  if (!object(v) || !numbers(v, ['velocityX', 'velocityZ', 'yawVelocity', 'repairTimer', 'aiThinkTimer', 'aiMistakeTimer', 'aiMistake', 'desiredThrottle', 'desiredRudder', 'raceFinishTime', 'impactCooldown', 'previousWaterY', 'airtime', 'homeX', 'homeZ', 'aggroTimer', 'targetLockTimer', 'weakPointTimer', 'weakPointCooldown', 'hazardCooldown', 'tacticalPhase'])) return false;
  if (!integer(v.raceCheckpoint) || !integer(v.raceLap, 1) || !bool(v.raceFinished) || !bool(v.disabledEventSent) || !bool(v.rewardGranted)) return false;
  return optional(v, 'provokedBy', text) && optional(v, 'lastAttackerId', text) && optional(v, 'weakPointSide', (x) => oneOf(x, SIDES));
}
function progression(v: unknown): boolean {
  if (!object(v) || v.version !== 1 || !number(v.bankedCoins, 0) || !integer(v.totalVoyages) || !integer(v.completedVoyages) || v.completedVoyages > v.totalVoyages || !oneOf(v.selectedShip, SHIPS) || !strings(v.discoveredIds) || !strings(v.paidVoyageIds) || !object(v.refits) || !object(v.rivals)) return false;
  if (v.paidVoyageIds.length > v.totalVoyages || v.completedVoyages > v.paidVoyageIds.length) return false;
  if (!Object.entries(v.refits).every(([key, level]) => { const refit = HARBOR_REFITS.find((r) => r.id === key); return refit && integer(level, 0, refit.maxLevel); })) return false;
  return Object.entries(v.rivals).every(([key, rival]) => text(key) && object(rival) && integer(rival.encounters) && integer(rival.escapes) && integer(rival.defeated));
}
function route(v: unknown): boolean {
  return object(v) && text(v.id) && text(v.name) && text(v.description) && oneOf(v.kind, KINDS) && oneOf(v.weather, WEATHER) && oneOf(v.risk, ['measured', 'dangerous']) && number(v.reward, 0) && oneOf(v.landmarkId, VOYAGE_LANDMARKS.map((landmark) => landmark.id));
}
function encounter(v: unknown): boolean {
  if (!object(v) || !text(v.id) || !oneOf(v.kind, KINDS) || !text(v.title) || !text(v.objective) || !strings(v.targetIds, 20) || !vector(v.waypoint) || !numbers(v, ['progress', 'elapsed', 'reward'], 0) || !number(v.target, .001) || v.progress as number > (v.target as number) || !bool(v.completed) || !optional(v, 'resolvedAt', (x) => number(x, 0, v.elapsed as number)) || !optional(v, 'escortId', text)) return false;
  if (v.completed !== (v.progress === v.target) || (v.completed ? v.resolvedAt === undefined : v.resolvedAt !== undefined)) return false;
  if (v.kind === 'escort' && !text(v.escortId)) return false;
  if (v.kind === 'salvage' && v.target !== 12 || v.kind === 'escort' && v.target !== 75) return false;
  if ((v.kind === 'salvage' || v.kind === 'escort') && (v.progress as number) > (v.elapsed as number) + 1e-6) return false;
  if ((v.kind === 'battle' || v.kind === 'boss') && (!(v.targetIds as string[]).length || v.target !== (v.targetIds as string[]).length)) return false;
  if (v.kind === 'storm') {
    if (!list(v.gates, 3) || v.gates.length !== 3 || !integer(v.nextGate, 0, 3) || v.target !== 3 || v.progress !== v.nextGate || !vector(v.previousPosition)) return false;
    if (!v.gates.every((gate) => object(gate) && text(gate.id) && vector(gate.position) && number(gate.halfWidth, .01, 1000))) return false;
  }
  return true;
}
function voyage(v: unknown): boolean {
  if (!object(v) || !oneOf(v.phase, ['harbor', 'route', 'encounter', 'reward', 'complete', 'failed']) || !text(v.id, 0) || !text(v.contractId, 0) || !oneOf(v.buildId, VOYAGE_BUILDS.map((b) => b.id)) || !integer(v.leg, 0, 20) || !integer(v.totalLegs, 1, 20) || v.leg > v.totalLegs || !list(v.routes, 3) || !v.routes.every(route) || !numbers(v, ['unbankedCoins', 'earnedBounty'], 0) || !strings(v.upgrades, 20) || !strings(v.rewardChoices, 3) || !bool(v.extractionReady)) return false;
  if (![...v.upgrades, ...v.rewardChoices].every((id) => VOYAGE_UPGRADES.some((u) => u.id === id)) || v.upgrades.includes('supplies') || v.rewardChoices.some((id) => (v.upgrades as string[]).includes(id)) || !optional(v, 'encounter', encounter)) return false;
  if (v.phase === 'harbor') return v.id === '' && v.contractId === '' && v.leg === 0 && !v.routes.length && !v.rewardChoices.length && !v.encounter;
  const contract = VOYAGE_CONTRACTS.find((c) => c.id === v.contractId);
  if (!contract || !v.id || v.leg < 1 || v.totalLegs !== contract.legs) return false;
  if (v.phase === 'route') {
    const known = createVoyageRoutes(v.id, contract.id, v.leg);
    if (v.routes.length !== known.length || new Set(v.routes.map((r) => (r as RecordValue).id)).size !== v.routes.length || !v.routes.every((r) => object(r) && known.some((k) => Object.entries(k).every(([key, value]) => r[key] === value))) || v.rewardChoices.length) return false;
  } else if (v.routes.length) return false;
  if (v.phase === 'encounter' && (!v.encounter || v.rewardChoices.length || v.extractionReady)) return false;
  if (v.phase === 'reward' && (!object(v.encounter) || !v.encounter.completed || !v.rewardChoices.length || !v.extractionReady)) return false;
  if (!optional(v, 'result', (x) => object(x) && numbers(x, ['coins', 'bounty'], 0) && oneOf(x.outcome, ['completed', 'extracted', 'lost']))) return false;
  if (v.phase === 'complete' || v.phase === 'failed') {
    if (!object(v.result) || v.rewardChoices.length || v.extractionReady) return false;
    if (v.phase === 'failed' ? v.result.outcome !== 'lost' : v.result.outcome === 'lost') return false;
  } else if (v.result !== undefined) return false;
  return true;
}

/** Required schema first, then cross-record invariants. Never mutates or hydrates the supplied value. */
export function isNavalSave(value: unknown): value is NavalSave {
  try {
    if (!object(value) || value.version !== 1 || !text(value.seed, 0, 200) || !oneOf(value.scenario, DEBUG_SCENES) || !object(value.state)) return false;
    const s = value.state;
    // Version 1 has one normal simulation clock. Explicit pause is represented separately.
    if (!text(s.seed, 0, 200) || !integer(s.seedNumber, 0, 0xffffffff) || !number(s.elapsed, 0) || s.timeScale !== 1 || !bool(s.paused) || !oneOf(s.mode, ['explore', 'combat', 'race', 'discovery', 'boarding']) || !oneOf(s.weather, WEATHER) || !numbers(s, ['windDirection', 'currentDirection']) || !numbers(s, ['windStrength', 'currentStrength'], 0, 10) || !numbers(s, ['bounty', 'treasure'], 0, Number.MAX_SAFE_INTEGER) || !text(s.playerId) || !text(s.objective, 0, 4096)) return false;
    if (!list(s.ships, 20) || !s.ships.length || !s.ships.every(ship) || !list(s.projectiles, 256) || !s.projectiles.every(projectile) || !list(s.islands, 2000) || !s.islands.every(island) || !progression(s.progression)) return false;
    const race = s.race;
    if (!object(race) || !bool(race.active) || !bool(race.wrongWay) || !numbers(race, ['countdown', 'elapsed'], 0) || !['lap', 'totalLaps', 'placement'].every((k) => integer(race[k], 1, 1000)) || !integer(race.checkpoint)) return false;
    if (!optional(s, 'combat', (v) => object(v) && ['combo', 'defeated', 'surrendered', 'reinforcements'].every((k) => integer(v[k])) && numbers(v, ['comboTimer', 'weakPointTimer'], 0) && optional(v, 'weakPointTargetId', text) && optional(v, 'weakPointSide', (x) => oneOf(x, SIDES)))) return false;
    if (!optional(s, 'worldFeatures', (v) => list(v, 20000) && v.every((f) => object(f) && text(f.id) && numbers(f, ['x', 'z']) && number(f.radius, .001) && oneOf(f.kind, ['shore', 'stack', 'reef']))) || !optional(s, 'voyage', voyage)) return false;
    if (!list(value.runtimes, 20) || !value.runtimes.every((tuple) => list(tuple, 2) && tuple.length === 2 && text(tuple[0]) && runtime(tuple[1]))) return false;
    if (!list(value.projectiles, 256) || value.projectiles.length < 24 || !value.projectiles.every(slot) || !list(value.authoredIslands, 2000) || !value.authoredIslands.every(island) || !list(value.raceCourse, 1000) || !value.raceCourse.every(vector) || !strings(value.finishOrder, 20) || !number(value.accumulator, 0, 1) || !number(value.directorTimer) || !integer(value.reinforcementSerial)) return false;
    // Fail closed on unexpected non-JSON values and non-finite numbers, including optional/extension fields.
    const serializable = (item: unknown, depth = 0): boolean => depth <= 24 && (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'string' && item.length <= 20000 || typeof item === 'number' && Number.isFinite(item) || list(item) && item.every((entry) => serializable(entry, depth + 1)) || object(item) && Object.keys(item).length <= 2000 && Object.entries(item).every(([key, entry]) => !['__proto__', 'prototype', 'constructor'].includes(key) && serializable(entry, depth + 1)));
    if (!serializable(value)) return false;
    const save = value as unknown as NavalSave;
    const ids = new Set(save.state.ships.map((entry) => entry.id));
    const players = save.state.ships.filter((entry) => entry.isPlayer);
    if (ids.size !== save.state.ships.length || players.length !== 1 || players[0]!.id !== save.state.playerId || save.seed !== save.state.seed) return false;
    const runtimeIds = new Set(save.runtimes.map(([id]) => id));
    if (runtimeIds.size !== save.runtimes.length || runtimeIds.size !== ids.size || [...runtimeIds].some((id) => !ids.has(id))) return false;
    const raceState = save.state.race;
    if (raceState.active !== (save.state.mode === 'race') || raceState.lap > raceState.totalLaps || raceState.placement > ids.size) return false;
    if (raceState.active ? save.raceCourse.length < 2 : save.raceCourse.length !== 0) return false;
    const checkpointCount = Math.max(1, save.raceCourse.length);
    if (raceState.checkpoint >= checkpointCount || save.runtimes.some(([, runtime]) => runtime.raceCheckpoint >= checkpointCount || runtime.raceLap > raceState.totalLaps + 1 || runtime.raceFinished !== (runtime.raceLap === raceState.totalLaps + 1))) return false;
    for (const entry of save.state.ships) if (entry.targetId && (!ids.has(entry.targetId) || entry.targetId === entry.id) || entry.finish?.creditedTo && !ids.has(entry.finish.creditedTo)) return false;
    for (const entry of save.state.ships) if (entry.specialPhase?.pressureWave?.hitIds.some((id) => id === entry.id || !ids.has(id))) return false;
    for (const [, entry] of save.runtimes) if (entry.lastAttackerId && !ids.has(entry.lastAttackerId) || entry.provokedBy && !ids.has(entry.provokedBy)) return false;
    if (save.finishOrder.some((id) => !ids.has(id))) return false;
    if (new Set(save.projectiles.map((p) => p.state.id)).size !== save.projectiles.length || new Set(save.state.projectiles.map((p) => p.id)).size !== save.state.projectiles.length) return false;
    if (save.projectiles.some((p) => p.active && (!ids.has(p.state.ownerId) || p.state.life <= 0)) || save.state.projectiles.some((p) => !ids.has(p.ownerId))) return false;
    if (save.state.combat?.weakPointTargetId && !ids.has(save.state.combat.weakPointTargetId)) return false;
    const progressState = save.state.progression!;
    if (progressState.paidVoyageIds.some((id) => { const serial = voyageSequence(save.seed, id); return serial === undefined || serial > progressState.totalVoyages; })) return false;
    const v = save.state.voyage;
    if (v?.encounter) {
      // Contract opponents are explicitly hostile even for the otherwise neutral merchant player ship.
      const hostileFaction = players[0]!.faction === 'marine' ? 'big-mom' : 'marine';
      if (v.encounter.targetIds.some((id) => { const target = save.state.ships.find((ship) => ship.id === id); return !target || target.isPlayer || target.faction !== hostileFaction; })) return false;
      if (v.encounter.escortId) {
        const escort = save.state.ships.find((ship) => ship.id === v.encounter!.escortId);
        if (!escort || escort.isPlayer || escort.faction !== players[0]!.faction || v.encounter.targetIds.includes(escort.id)) return false;
      }
      if (v.encounter.kind === 'battle' || v.encounter.kind === 'boss') {
        const disabled = v.encounter.targetIds.filter((id) => save.state.ships.find((ship) => ship.id === id)!.surrendered).length;
        // A loss may occur before this tick updates objective progress; completed objectives never do.
        if (v.encounter.completed ? disabled !== v.encounter.target : v.phase !== 'failed' && v.encounter.progress !== disabled) return false;
      }
    }
    if (v && v.phase !== 'harbor') {
      if (voyageSequence(save.seed, v.id) !== progressState.totalVoyages) return false;
      const paid = save.state.progression!.paidVoyageIds.includes(v.id);
      if ((v.phase === 'complete' || v.phase === 'failed') !== paid) return false;
      if (v.encounter?.kind === 'storm') {
        const arch = VOYAGE_LANDMARKS.find((landmark) => landmark.id === 'sky-arch')!;
        if (!v.encounter.gates?.every((gate, index) => gate.id === ['approach', 'arch', 'exit'][index] && gate.position.y === 0 && gate.position.x === arch.position.x && gate.position.z === [arch.position.z + 140, arch.position.z, arch.position.z - 140][index] && gate.halfWidth === arch.radius * .5)) return false;
      }
    }
    return true;
  } catch { return false; }
}
