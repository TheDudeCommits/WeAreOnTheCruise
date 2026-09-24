/** Mock data for the UI lab: a believable mid-run RunState, profiles, settings, offers and results. */
import { CONTENT } from '../../game/content';
import { xpToNext } from '../../game/constants';
import type { EnemyId, Faction, SeaId, ShipId } from '../../game/ids';
import type { BossState, CaptainState, CardOffer, EnemyState, MetaProfile, PickupState, RunResult, RunState, Settings, WorldEventState } from '../../game/types';

export function mockProfile(kind: 'fresh' | 'rich' | 'mid' = 'mid'): MetaProfile {
  const base: MetaProfile = {
    version: 2, doubloons: 1340, upgrades: { hull: 3, powder: 2, sails: 1, fortune: 1, charts: 2, banish: 1, gunnery: 5 },
    unlockedShips: ['dawn-ram', 'sunlion', 'yellowfin'], unlockedSeas: ['sunward-shallows', 'stormwrack-reach'],
    achievements: ['survive-10'], bestTime: { sunlion: 742, 'dawn-ram': 388 }, bestBounty: { sunlion: 12450000, 'dawn-ram': 3200000 },
    totalKills: 2310, runs: 14, wins: 0, lastShip: 'sunlion', lastSea: 'sunward-shallows',
  };
  if (kind === 'fresh') return { ...base, doubloons: 0, upgrades: {}, unlockedShips: ['dawn-ram', 'sunlion'], unlockedSeas: ['sunward-shallows'], achievements: [], bestTime: {}, bestBounty: {}, totalKills: 0, runs: 0, lastShip: 'dawn-ram' };
  if (kind === 'rich') return { ...base, doubloons: 48210, unlockedShips: ['dawn-ram', 'sunlion', 'yellowfin', 'grand-galley', 'seawarden', 'white-leviathan'], unlockedSeas: ['sunward-shallows', 'stormwrack-reach', 'the-gloam'], wins: 3 };
  return base;
}

export function mockSettings(): Settings {
  const s: Settings & { reduceFlashing?: boolean } = { version: 2, masterVolume: 0.8, musicVolume: 0.7, sfxVolume: 0.85, muted: false, cameraShake: 1, damageNumbers: true, quality: 'auto', showFps: false, reduceFlashing: false };
  return s;
}

let rng = 1234567;
function rand(): number { rng = (rng * 16807) % 2147483647; return (rng - 1) / 2147483646; }

const FACTION_OF: Record<EnemyId, Faction> = Object.fromEntries(Object.values(CONTENT.enemies).map((e) => [e.id, e.faction])) as Record<EnemyId, Faction>;

function enemy(id: number, defId: EnemyId, x: number, z: number, elite = false): EnemyState {
  const def = CONTENT.enemies[defId];
  return {
    id, defId, faction: FACTION_OF[defId], life: 'alive', sink: 0, x, z, y: 0, heading: rand() * 6.28, speed: def.speed, vx: 0, vz: 0,
    yawRate: 0, roll: 0, pitch: 0, radius: def.radius, length: def.length, beam: def.radius * 2, hp: def.hp, maxHp: def.hp,
    armor: def.armor, elite, hitFlash: 0, hidden: 0, affixes: [], title: null, statuses: [], attackCooldown: 1, ai: { orbit: 0.02 + rand() * 0.06, r: Math.hypot(x, z), a: Math.atan2(x, z) }, spawnTime: 0,
  };
}

export function mockBoss(defId: BossState['defId'] = 'iron-warden', frac = 0.62): BossState {
  const def = CONTENT.bosses[defId];
  return {
    id: 9000, defId, life: 'alive', sink: 0, x: 240, z: -300, y: 0, heading: 0, speed: 6, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
    radius: def.radius, length: def.length, beam: def.radius * 2, hp: def.hp * frac, maxHp: def.hp, armor: def.armor, phase: frac <= 0.5 ? 1 : 0,
    hitFlash: 0, statuses: [], attack: 'broadside-volley', attackTime: 0, submerged: 0, ai: {}, spawnTime: 300,
  };
}

/** Three AI captains around the player (one sunk and respawning), for the roster and captain plates. */
export function mockCaptains(): CaptainState[] {
  const k = (id: number, name: string, shipId: ShipId, x: number, z: number, level: number, bounty: number, hp = 1): CaptainState => ({
    id, name, shipId, alive: hp > 0, x, z, y: 0, heading: 0.4, speed: 9, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
    radius: 9, length: 34, beam: 10, hp: 520 * hp, maxHp: 520, level, kills: 40, bounty, respawn: hp > 0 ? 0 : 7, hitFlash: 0, statuses: [], ai: { fade: 1, mode: 0 },
  });
  return [
    k(-1, 'Wren Calloway', 'grand-galley', 70, -40, 13, 9_800_000, 0.8),
    k(-2, 'Kade Harrow', 'yellowfin', -120, 60, 12, 14_200_000, 0.35),
    k(-3, 'Oriel Stroud', 'seawarden', 260, 180, 11, 4_100_000, 0),
  ];
}

/** A running set piece with a far-off anchor (sunken treasure dig site), for the tracker and its offscreen arrow. */
export function mockWorldEvent(): WorldEventState {
  return { id: 'sunken-treasure', name: 'Sunken Treasure', text: 'Hold the dig site to raise the chest', time: 12, duration: 75, progress: 4, goal: 14, x: -520, z: -420, radius: 45 };
}

/** Elites with affixes, a named bounty captain and a signal cutter marking the player (FOES), around the player. */
export function mockFoes(start: number): EnemyState[] {
  const out: EnemyState[] = [];
  const add = (defId: EnemyId, x: number, z: number, affixes: EnemyState['affixes'], title: string | null = null) => {
    const e = enemy(start + out.length, defId, x, z, true);
    e.affixes = affixes; e.title = title;
    out.push(e);
  };
  add('frigate', 150, -120, ['shielded', 'commander']);
  add('brig', -90, -150, ['swift']);
  add('corsair-galleon', 480, 260, ['burning', 'armored'], 'Briony of the Burning Keel');
  add('frigate', -470, 40, ['vampiric']);
  add('brig', -500, 120, ['volatile']);
  add('cutter', 90, 520, ['splitting']);
  const sig = enemy(start + out.length, 'signal-cutter', 200, 320);
  sig.ai.markT = 5; sig.ai.markRef = 0;
  out.push(sig);
  return out;
}

export function mockRun(shipId: ShipId = 'sunlion', seaId: SeaId = 'sunward-shallows'): RunState {
  rng = 1234567;
  const ship = CONTENT.ships[shipId];
  const enemies: EnemyState[] = [];
  const pool: EnemyId[] = seaId === 'the-gloam' ? ['wraith', 'wraith', 'corsair-brig', 'skiff', 'cutter', 'wyrmling'] : ['skiff', 'skiff', 'skiff', 'cutter', 'brig', 'corsair-brig', 'fireship', 'mortar-barge', 'frigate', 'wyrmling'];
  let id = 1;
  for (let i = 0; i < 64; i++) {
    const a = rand() * Math.PI * 2, r = 70 + rand() * 380;
    const defId = pool[Math.floor(rand() * pool.length)]!;
    enemies.push(enemy(id++, defId, Math.sin(a) * r, Math.cos(a) * r, i % 23 === 7));
  }
  enemies.push(enemy(id++, 'man-o-war', -330, 160, true));
  const pickups: PickupState[] = [
    { id: 500, alive: true, kind: 'chest', x: 150, z: 90, value: 1, age: 0, magnet: false },
    { id: 501, alive: true, kind: 'chest', x: -420, z: -380, value: 1, age: 0, magnet: false },
  ];
  const level = 14;
  return {
    seed: 'lab', seaId, shipId, status: 'running', time: 272, tick: 0, timeScale: 1,
    player: {
      shipId, alive: true, x: 0, z: 0, y: 0, heading: 0.3, speed: 11.5, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
      radius: ship.beam * 0.6, length: ship.length, beam: ship.beam,
      hp: ship.hp * 0.78, maxHp: ship.hp, shield: ship.hp * 0.12, gear: 1, throttle: 0.55, rudder: 0,
      level, xp: 31, xpToNext: xpToNext(level), tier: 2,
      weapons: [
        { id: 'broadside', level: 6, branch: 'B', overdrive: true, cooldown: 0.5, scratch: {} },
        { id: 'bow-chaser', level: 4, branch: 'A', overdrive: false, cooldown: 0.5, scratch: {} },
        { id: 'stern-mortar', level: 3, branch: 'B', overdrive: false, cooldown: 0.5, scratch: {} },
        { id: 'storm-rod', level: 2, overdrive: false, cooldown: 0.5, scratch: {} },
        { id: 'harpoon', level: 1, overdrive: false, cooldown: 0.5, scratch: {} },
      ],
      passives: [
        { id: 'master-gunner', rank: 3 }, { id: 'ironwood-hull', rank: 2 }, { id: 'powder-monkeys', rank: 5 }, { id: 'weather-eye', rank: 1 },
      ],
      stats: { maxHp: 0, armor: 0, regen: 0, speed: 0, turn: 0, damage: 0, cooldown: 0, area: 0, range: 0, projectileSpeed: 0, duration: 0, amount: 0, crit: 0, critDamage: 0, pickupRadius: 0, xpGain: 0, luck: 0, skillCooldown: 0, ramDamage: 0, doubloonGain: 0, revives: 0, accel: 0, fullSail: 0, carve: 0, helm: 0, surge: 0, boostDuration: 0, boostCooldown: 0, boostCharges: 0 },
      skills: {
        broadside: { cooldown: 3.2, cooldownMax: 8, active: 0, charge: 1 },
        special: { cooldown: 0, cooldownMax: 18, active: 0, charge: 1 },
        ultimate: { cooldown: 0, cooldownMax: 0, active: 0, charge: 0.72 },
        brace: { cooldown: 2.1, cooldownMax: 5, active: 0, charge: 1 },
        boost: { cooldown: 0, cooldownMax: 6, active: 0, charge: 1 },
      },
      statuses: [{ kind: 'frenzy', time: 4, magnitude: 1 }],
      aimX: 0, aimZ: -100, airborne: 0, submerged: 0, invulnerable: 0, revivesLeft: 1, sinceHit: 3,
    },
    enemies,
    bosses: [],
    projectiles: [],
    hazards: [],
    pickups,
    telegraphs: [],
    sea: { weather: 'clear', nextWeather: 'clear', blend: 1, waveScale: 1, windDir: 0.6, windStrength: 0.6, timeOfDay: 11, fog: 0, rain: 0, lightningSerial: 0 },
    director: { minute: 4.5, heat: 1.45, budget: 0, nextBossIndex: 0, bossWarning: null, bossWarningTime: 0, activeBoss: null, event: null, eventTime: 0, scratch: {} },
    offers: null,
    pendingLevelUps: 0,
    rerolls: 2,
    banishes: 1,
    banished: [],
    stats: {
      kills: 842, eliteKills: 6, damageDealt: 412880, damageTaken: 3120, bossesDefeated: [], doubloons: 128, xpCollected: 2204, bounty: 12450000,
      killsByWeapon: { broadside: 402, 'bow-chaser': 188, 'stern-mortar': 141, 'storm-rod': 77, harpoon: 34 },
      damageByWeapon: { broadside: 188400, 'bow-chaser': 96120, 'stern-mortar': 71800, 'storm-rod': 40210, harpoon: 16350 },
    },
    endless: false,
    captains: [],
    worldEvent: null,
  };
}

const W = CONTENT.weapons;
const P = CONTENT.passives;
const icon = (id: string) => `/assets/icons/${id}.png`;

export const OFFER_SETS: Record<string, CardOffer[]> = {
  basic: [
    { kind: 'new-weapon', id: 'rocket-rack', title: W['rocket-rack'].name, text: W['rocket-rack'].description, icon: icon('rocket-rack'), rarity: 'rare', level: 1 },
    { kind: 'weapon-level', id: 'bow-chaser', title: `${W['bow-chaser'].name} Lv 5`, text: W['bow-chaser'].levels[4]!.text, icon: icon('bow-chaser'), rarity: 'common', level: 5 },
    { kind: 'passive-rank', id: 'master-gunner', title: `${P['master-gunner'].name} 4`, text: P['master-gunner'].description, icon: icon('master-gunner'), rarity: 'common', level: 4 },
  ],
  branch: [
    { kind: 'weapon-branch', id: 'storm-rod', title: `${W['storm-rod'].name}: Forked`, text: W['storm-rod'].branches[0].text, icon: icon('storm-rod'), rarity: 'rare', level: 3, branch: 'A' },
    { kind: 'weapon-branch', id: 'storm-rod', title: `${W['storm-rod'].name}: Thunderclap`, text: W['storm-rod'].branches[1].text, icon: icon('storm-rod'), rarity: 'rare', level: 3, branch: 'B' },
    { kind: 'new-passive', id: 'lucky-doubloon', title: P['lucky-doubloon'].name, text: P['lucky-doubloon'].description, icon: icon('lucky-doubloon'), rarity: 'common', level: 1 },
  ],
  overdrive: [
    { kind: 'weapon-overdrive', id: 'bow-chaser', title: `${W['bow-chaser'].overdrive.name} ★`, text: W['bow-chaser'].overdrive.text, icon: icon('bow-chaser'), rarity: 'legendary', level: 6 },
    { kind: 'new-weapon', id: 'tide-mines', title: W['tide-mines'].name, text: W['tide-mines'].description, icon: icon('tide-mines'), rarity: 'rare', level: 1 },
    { kind: 'chip', id: 'damage', title: 'Sharpened Shot', text: 'A permanent edge for every gun aboard.', icon: icon('master-gunner'), rarity: 'epic', stat: 'damage', amount: 0.08 },
  ],
  four: [
    { kind: 'new-weapon', id: 'maelstrom-charm', title: W['maelstrom-charm'].name, text: W['maelstrom-charm'].description, icon: icon('maelstrom-charm'), rarity: 'rare', level: 1 },
    { kind: 'weapon-level', id: 'harpoon', title: `${W.harpoon.name} Lv 2`, text: W.harpoon.levels[1]!.text, icon: icon('harpoon'), rarity: 'common', level: 2 },
    { kind: 'new-passive', id: 'salvage-nets', title: P['salvage-nets'].name, text: P['salvage-nets'].description, icon: icon('salvage-nets'), rarity: 'common', level: 1 },
    { kind: 'chip', id: 'crit', title: 'Keen Eye', text: 'Your gunners find the weak planks.', icon: icon('lucky-doubloon'), rarity: 'epic', stat: 'crit', amount: 0.05 },
  ],
  chest: [
    { kind: 'weapon-level', id: 'stern-mortar', title: `${W['stern-mortar'].name} Lv 4`, text: W['stern-mortar'].levels[3]!.text, icon: icon('stern-mortar'), rarity: 'rare', level: 4 },
    { kind: 'passive-rank', id: 'master-gunner', title: `${P['master-gunner'].name} 4`, text: P['master-gunner'].description, icon: icon('master-gunner'), rarity: 'common', level: 4 },
    { kind: 'doubloons', id: 'doubloons', title: 'Doubloon Hoard', text: '+50 doubloons banked at the end of the voyage.', icon: icon('doubloon'), rarity: 'epic', amount: 50 },
  ],
};

export function mockResult(outcome: RunResult['outcome'], run: RunState): RunResult {
  const stats = structuredClone(run.stats);
  if (outcome === 'victory') stats.bossesDefeated = ['iron-warden', 'tidewyrm', 'sovereign'];
  else if (outcome === 'defeat') stats.bossesDefeated = ['iron-warden'];
  return {
    outcome, shipId: run.shipId, seaId: run.seaId, time: outcome === 'victory' ? 900 : 612, level: outcome === 'victory' ? 31 : 22, stats,
    doubloonsEarned: outcome === 'victory' ? 612 : 245,
    newUnlocks: outcome === 'victory' ? ['New ship: White Leviathan', 'New sea: The Gloam'] : outcome === 'defeat' ? ['New ship: Seawarden'] : [],
  };
}
