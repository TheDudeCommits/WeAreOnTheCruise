/** Initial run state factory. CORE-owned. */
import { xpToNext } from '../constants';
import type { SeaId, ShipId, SkillSlot } from '../ids';
import type { ContentDb, MetaProfile, RunState, SkillState } from '../types';
import { emptyStats } from './stats';

const skill = (cooldownMax: number, charge = 1): SkillState => ({ cooldown: 0, cooldownMax, active: 0, charge });

export function createRunState(opts: { seed: string; shipId: ShipId; seaId: SeaId; content: ContentDb; meta: MetaProfile }): RunState {
  const ship = opts.content.ships[opts.shipId];
  const sea = opts.content.seas[opts.seaId];
  const skills: Record<SkillSlot, SkillState> = {
    broadside: skill(8),
    special: skill(18),
    ultimate: skill(0, 0),
    brace: skill(5),
    boost: skill(6),
  };
  return {
    seed: opts.seed,
    seaId: opts.seaId,
    shipId: opts.shipId,
    status: 'running',
    time: 0,
    tick: 0,
    timeScale: 1,
    player: {
      shipId: opts.shipId,
      alive: true,
      x: 0, z: 0, y: 0, heading: 0, speed: 0, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
      radius: ship.beam * 0.6, length: ship.length, beam: ship.beam,
      hp: ship.hp, maxHp: ship.hp, shield: 0,
      gear: 1, throttle: 0.2, rudder: 0,
      level: 1, xp: 0, xpToNext: xpToNext(1), tier: 0,
      weapons: [{ id: ship.startingWeapon, level: 1, overdrive: false, cooldown: 1, scratch: {} }],
      passives: [],
      stats: emptyStats(),
      skills,
      statuses: [],
      aimX: 0, aimZ: -100,
      airborne: 0, submerged: 0, invulnerable: 2,
      revivesLeft: 0,
      sinceHit: 99,
    },
    enemies: [],
    bosses: [],
    projectiles: [],
    hazards: [],
    pickups: [],
    telegraphs: [],
    sea: {
      weather: sea.weather[0]?.weather ?? 'clear', nextWeather: sea.weather[0]?.weather ?? 'clear', blend: 1,
      waveScale: 1, windDir: 0.6, windStrength: 0.6, timeOfDay: sea.startHour, fog: 0, rain: 0, lightningSerial: 0,
    },
    director: {
      minute: 0, heat: sea.difficulty, budget: 0, nextBossIndex: 0, bossWarning: null, bossWarningTime: 0,
      activeBoss: null, event: null, eventTime: 0, scratch: {},
    },
    offers: null,
    pendingLevelUps: 0,
    rerolls: opts.meta.upgrades.charts ?? 0,
    banishes: opts.meta.upgrades.banish ?? 0,
    banished: [],
    stats: {
      kills: 0, eliteKills: 0, damageDealt: 0, damageTaken: 0, bossesDefeated: [], doubloons: 0, xpCollected: 0,
      bounty: 0, killsByWeapon: {}, damageByWeapon: {},
    },
    endless: false,
  };
}
