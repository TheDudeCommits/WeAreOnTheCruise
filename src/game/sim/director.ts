/**
 * Spawn director (META-owned).
 *
 * - Heat: difficulty × time curve (content/director.ts) → enemy HP/damage/speed.
 * - Budget: points/s (1 point = 1 xp of enemies) spent on groups drawn from the minute band for this sea's factions;
 *   a live-enemy floor keeps pressure up; soft cap SOFT_ENEMY_CAP. The next group is chosen first and then saved
 *   for, so big ships are not starved by cheap draws.
 * - Groups: skiff packs fan out (flank offsets), frigates sail line abreast behind a leader, one elite roll per group.
 * - Set pieces ('director-event'): Ambush Ring, Fire Ship Rush, Mortar Line, Treasure Convoy, Storm Front, Fog Bank.
 * - Bosses: 'boss-warning' 10 s ahead, spawn ahead of the player, HP scaled by sea difficulty (and endless loops).
 * - Forts on island shores, straggler recycling, far-coin merging, minute wages + survival bounty, victory lap.
 */
import { DESPAWN_RADIUS, SOFT_ENEMY_CAP, SPAWN_RING_MAX, SPAWN_RING_MIN } from '../constants';
import { DIRECTOR, DIRECTOR_EVENTS, EVENT_TUNING, SEA_EVENTS, type DirectorEventId } from '../content/director';
import { ENEMY_AI } from '../content/enemies';
import { BOUNTY, ECONOMY } from '../content/rewards';
import type { BossId, EnemyId } from '../ids';
import type { EnemyState, SeaDef } from '../types';
import type { SimContext } from './context';
import { SCRATCH, bandAt, eventKey, metaRuntime, type SeaBand } from './meta-runtime';
import { spawnScaled } from './meta-spawn';
import { TAU, fwdX, fwdZ, headingTo, openWaterNear, rand, randInt, sideX, sideZ } from './meta-steer';
import { doubloonMul } from './stats';
import { spawnRogueWave } from './weather';
import { startWorldEvent, updateWorldEvents } from './world-events';
import { captainBudgetMul } from './captains-runtime';

const SPAWN = { x: 0, z: 0, a: 0 };
const EVENT_W = [0, 0, 0, 0, 0, 0, 0, 0];

export function updateDirector(c: SimContext): void {
  const s = c.state;
  const d = s.director;
  const sea = c.content.seas[s.seaId];
  const minute = s.time / 60;
  d.minute = minute;
  d.heat = DIRECTOR.heat(minute, sea.difficulty);
  const sc = d.scratch;
  if ((sc[SCRATCH.victoryAt] ?? 0) > 0) {
    if (s.time >= sc[SCRATCH.victoryAt]!) { sc[SCRATCH.victoryAt] = 0; c.endRun('victory'); }
    return;
  }
  payWages(c);
  bossSchedule(c, sea);
  syncActiveBoss(c);
  if (d.event) { d.eventTime -= c.dt; if (d.eventTime <= 0) { d.event = null; d.eventTime = 0; } }
  runEvents(c, sea, minute);
  updateWorldEvents(c);
  spawnWaves(c, sea, minute);
  placeForts(c, sea, minute);
  if (s.tick % 30 === 0) recycle(c);
  mergeCoins(c);
}

// ───────────────────────── Economy ─────────────────────────

function payWages(c: SimContext): void {
  const s = c.state, sc = s.director.scratch;
  const minute = Math.floor(s.time / 60);
  if (minute > (sc[SCRATCH.lastWage] ?? 0)) {
    sc[SCRATCH.lastWage] = minute;
    s.stats.doubloons += Math.round(ECONOMY.minuteWage * doubloonMul(s.player.stats));
  }
  const second = Math.floor(s.time);
  const last = sc[SCRATCH.lastBountySecond] ?? 0;
  if (second > last) {
    sc[SCRATCH.lastBountySecond] = second;
    s.stats.bounty += Math.round(BOUNTY.perSecond * (second - last) * s.director.heat);
  }
}

// ───────────────────────── Bosses ─────────────────────────

function bossSchedule(c: SimContext, sea: SeaDef): void {
  const s = c.state, d = s.director, sc = d.scratch;
  const next = sea.bosses[d.nextBossIndex];
  if (next) {
    // A debug time jump far past a boss skips it (the final boss is never skipped).
    const isFinal = d.nextBossIndex === sea.bosses.length - 1;
    if (!isFinal && s.time > next.at + 30) { d.nextBossIndex++; d.bossWarning = null; return; }
    if (!d.bossWarning && s.time >= next.at - DIRECTOR.warningLead) {
      d.bossWarning = next.boss;
      d.bossWarningTime = next.at;
      c.emit({ type: 'boss-warning', boss: next.boss, eta: Math.max(0, next.at - s.time) });
    }
    if (s.time >= next.at) {
      spawnBossAhead(c, next.boss, 0);
      d.nextBossIndex++;
      d.bossWarning = null;
    }
    return;
  }
  if (!s.endless || sea.bosses.length === 0) return;
  // Endless: bosses keep coming, tougher each loop.
  if (!sc[SCRATCH.endlessNext]) sc[SCRATCH.endlessNext] = s.time + DIRECTOR.endlessBossGap;
  const count = sc[SCRATCH.endlessCount] ?? 0;
  const boss = sea.bosses[count % sea.bosses.length]!.boss;
  const at = sc[SCRATCH.endlessNext]!;
  if (!d.bossWarning && s.time >= at - DIRECTOR.warningLead) {
    d.bossWarning = boss;
    d.bossWarningTime = at;
    c.emit({ type: 'boss-warning', boss, eta: Math.max(0, at - s.time) });
  }
  if (s.time >= at) {
    spawnBossAhead(c, boss, 1 + Math.floor(count / sea.bosses.length));
    sc[SCRATCH.endlessCount] = count + 1;
    sc[SCRATCH.endlessNext] = s.time + DIRECTOR.endlessBossGap;
    d.bossWarning = null;
  }
}

/** Spawns a boss ~330 m ahead of the player's course in open water; HP scaled by sea difficulty and loop. */
export function spawnBossAhead(c: SimContext, id: BossId, loop: number): void {
  const s = c.state, p = s.player;
  const def = c.content.bosses[id];
  const sea = c.content.seas[s.seaId];
  const base = p.speed > 2 ? p.heading : c.random() * TAU;
  let x = p.x + fwdX(base) * 330, z = p.z + fwdZ(base) * 330;
  for (let tries = 0; tries < 12; tries++) {
    const a = base + (c.random() - 0.5) * 1.4 * (1 + tries * 0.35);
    const r = 330 + tries * 12;
    const px = p.x + fwdX(a) * r, pz = p.z + fwdZ(a) * r;
    if (c.world.isWater(px, pz, def.radius + 25)) { x = px; z = pz; break; }
  }
  const b = c.spawnBoss(id, x, z, headingTo(p.x - x, p.z - z));
  const hp = def.hp * DIRECTOR.bossHpScale(sea.difficulty, loop, id);
  b.hp = hp;
  b.maxHp = hp;
  s.director.activeBoss = id;
}

function syncActiveBoss(c: SimContext): void {
  const d = c.state.director;
  let active: BossId | null = null;
  for (const b of c.state.bosses) if (b.life === 'alive') { active = b.defId; break; }
  d.activeBoss = active;
}

/**
 * Called when the final boss sinks (not in endless): the enemy fleet strikes its colours, all loot flies to the
 * player, and the run ends with endRun('victory') after a short victory lap.
 */
export function beginVictoryLap(c: SimContext, delay = 3.5): void {
  const s = c.state;
  s.director.scratch[SCRATCH.victoryAt] = s.time + delay;
  s.player.invulnerable = Math.max(s.player.invulnerable, delay + 2);
  for (const e of s.enemies) if (e.life === 'alive') { e.hp = 0; e.life = 'sinking'; }
  for (const t of s.telegraphs) if (t.team === 'enemy') t.alive = false;
  for (const k of s.pickups) if (k.alive) k.magnet = true;
  c.emit({ type: 'director-event', name: 'Victory', text: 'The flagship is going down. The Brightwater is yours!' });
}

/**
 * Endless mode hook for the runtime (after the victory screen): keeps the director going with looping bosses.
 * The runtime must also resume the Sim (status 'running' and clear its ended result).
 */
export function continueEndless(c: SimContext): void {
  const s = c.state, sc = s.director.scratch;
  s.endless = true;
  sc[SCRATCH.victoryAt] = 0;
  sc[SCRATCH.endlessNext] = s.time + DIRECTOR.endlessBossGap;
}

// ───────────────────────── Spawning ─────────────────────────

function countAlive(c: SimContext): { alive: number; elites: number } {
  let alive = 0, elites = 0;
  for (const e of c.state.enemies) {
    if (e.life !== 'alive' || e.ai.convoy === 1 || e.defId === 'fort') continue;
    alive++;
    if (e.elite) elites++;
  }
  COUNT.alive = alive; COUNT.elites = elites;
  return COUNT;
}
const COUNT = { alive: 0, elites: 0 };

function spawnWaves(c: SimContext, sea: SeaDef, minute: number): void {
  const s = c.state, d = s.director, sc = d.scratch;
  // CAPTAINS: the sea fills up for AI captains afloat (+CAPTAIN.budgetPerCaptain each).
  let rate = DIRECTOR.budgetRate(minute) * Math.pow(sea.difficulty, DIRECTOR.budgetDifficultyExp) * captainBudgetMul(s);
  let floor = DIRECTOR.minAlive(minute);
  if (d.activeBoss) {
    // Focus the boss fight, but only for a while: a boss the player cannot sink must not calm the sea forever.
    const k = Math.min(1, Math.max(0, (s.time - oldestBossSpawn(c) - DIRECTOR.bossCalm) / DIRECTOR.bossCalm));
    rate *= DIRECTOR.bossBudgetMul + (1 - DIRECTOR.bossBudgetMul) * k;
    floor *= DIRECTOR.bossFloorMul + (1 - DIRECTOR.bossFloorMul) * k;
  } else if (d.bossWarning) { rate *= DIRECTOR.warningBudgetMul; floor *= DIRECTOR.warningBudgetMul; }
  const bankMax = Math.max(DIRECTOR.bankMax, rate * 25);
  d.budget = Math.min(bankMax, d.budget + rate * c.dt);
  if (s.tick % 6 !== 0 || !s.player.alive) return;
  const { alive, elites } = countAlive(c);
  if (alive >= SOFT_ENEMY_CAP) return;

  const rt = metaRuntime(s, c.content);
  const band = bandAt(rt.bands, minute);
  let idx = sc[SCRATCH.nextEntry] ?? -1;
  if (idx < 0 || sc[SCRATCH.nextBand] !== band.from || idx >= band.entries.length) {
    idx = drawEntry(c, band, minute);
    if (idx < 0) return;
    const entry = band.entries[idx]!;
    sc[SCRATCH.nextEntry] = idx;
    sc[SCRATCH.nextBand] = band.from;
    sc[SCRATCH.nextSize] = randInt(c, entry.group[0], entry.group[1]);
  }
  const entry = band.entries[idx]!;
  const def = c.content.enemies[entry.enemy];
  const size = Math.max(1, Math.min(sc[SCRATCH.nextSize] ?? 1, SOFT_ENEMY_CAP - alive));
  const cost = def.xp * size;
  const underFloor = alive < floor;
  if (!underFloor && d.budget < cost) return;
  if (underFloor && d.budget - cost < -DIRECTOR.debt(minute)) return;
  d.budget -= cost;
  sc[SCRATCH.nextEntry] = -1;
  const elite = elites < DIRECTOR.maxElites && c.random() < DIRECTOR.eliteChance(minute);
  spawnGroup(c, entry.enemy, size, elite);
}

function oldestBossSpawn(c: SimContext): number {
  let t = c.state.time;
  for (const b of c.state.bosses) if (b.life === 'alive' && b.spawnTime < t) t = b.spawnTime;
  return t;
}

function drawEntry(c: SimContext, band: SeaBand, minute: number): number {
  let total = 0;
  for (const en of band.entries) if (c.content.enemies[en.enemy].firstMinute <= minute) total += en.weight;
  if (total <= 0) return -1;
  let r = c.random() * total;
  for (let i = 0; i < band.entries.length; i++) {
    const en = band.entries[i]!;
    if (c.content.enemies[en.enemy].firstMinute > minute) continue;
    r -= en.weight;
    if (r <= 0) return i;
  }
  return band.entries.length - 1;
}

/** A point on the spawn ring in open water, biased ahead of a moving player. */
function spawnPoint(c: SimContext, radius: number, minR = SPAWN_RING_MIN, maxR = SPAWN_RING_MAX): typeof SPAWN | null {
  const p = c.state.player;
  for (let tries = 0; tries < 8; tries++) {
    const a = p.speed > 4 && c.random() < 0.55 ? p.heading + (c.random() - 0.5) * 2.6 : c.random() * TAU;
    const r = minR + c.random() * (maxR - minR);
    const x = p.x + fwdX(a) * r, z = p.z + fwdZ(a) * r;
    if (c.world.isWater(x, z, radius + 18)) { SPAWN.x = x; SPAWN.z = z; SPAWN.a = a; return SPAWN; }
  }
  return null;
}

/** Spawns a group: frigates line abreast behind a leader, everything else as a loose pack with fanned flanks. */
function spawnGroup(c: SimContext, id: EnemyId, size: number, elite: boolean): void {
  const p = c.state.player;
  const def = c.content.enemies[id];
  const tune = ENEMY_AI[id];
  const spot = spawnPoint(c, def.radius);
  if (!spot) return;
  const x0 = spot.x, z0 = spot.z;
  const heading = headingTo(p.x - x0, p.z - z0);
  if (tune.formation > 0 && size > 1) {
    const leader = spawnScaled(c, id, x0, z0, { elite, heading });
    if (!leader) return;
    leader.ai.isLeader = 1;
    for (let k = 1; k < size; k++) {
      const slot = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
      const fx = x0 + sideX(heading, -1) * slot * tune.formation, fz = z0 + sideZ(heading, -1) * slot * tune.formation;
      const f = openWaterNear(c, fx, fz, def.radius + 6, 3);
      if (!f) continue;
      const e = spawnScaled(c, id, f.x, f.z, { heading });
      if (e) { e.ai.leader = leader.id; e.ai.fslot = slot; }
    }
    return;
  }
  for (let k = 0; k < size; k++) {
    const a = c.random() * TAU, r = k === 0 ? 0 : 10 + c.random() * 22;
    const pos = openWaterNear(c, x0 + Math.sin(a) * r, z0 + Math.cos(a) * r, def.radius + 4, 3);
    if (!pos) continue;
    const e = spawnScaled(c, id, pos.x, pos.z, { elite: elite && k === 0, heading });
    if (!e) continue;
    if (size > 1) e.ai.flank = (k / (size - 1) - 0.5) * 2.4;
    e.ai.t = 0.8 + k * 0.35 + c.random() * 0.8;
  }
}

// ───────────────────────── Events ─────────────────────────

function runEvents(c: SimContext, sea: SeaDef, minute: number): void {
  const s = c.state, d = s.director, sc = d.scratch;
  const plan = SEA_EVENTS[sea.id];
  if (!plan || plan.events.length === 0) return;
  if (sc[SCRATCH.nextEvent] === undefined) sc[SCRATCH.nextEvent] = plan.first;
  if (s.time < sc[SCRATCH.nextEvent]! || !s.player.alive) return;
  const nextBoss = sea.bosses[d.nextBossIndex];
  if (d.activeBoss || d.bossWarning || (nextBoss && nextBoss.at - s.time < 25)) { sc[SCRATCH.nextEvent] = s.time + 8; return; }
  let total = 0;
  const n = Math.min(plan.events.length, EVENT_W.length);
  for (let i = 0; i < n; i++) {
    const def = DIRECTOR_EVENTS[plan.events[i]!];
    let w = def.from <= minute && (sc[eventKey(def.id)] ?? 0) < def.maxPerRun ? def.weight : 0;
    if (def.id === 'storm-front' && s.sea.rain > 0.4) w *= 1.8;
    if (def.id === 'fog-bank' && s.sea.fog > 0.5) w *= 0.5;
    EVENT_W[i] = w;
    total += w;
  }
  sc[SCRATCH.nextEvent] = s.time + rand(c, plan.gap[0], plan.gap[1]);
  if (total <= 0) return;
  let r = c.random() * total;
  for (let i = 0; i < n; i++) {
    r -= EVENT_W[i]!;
    if (r <= 0) { startEvent(c, plan.events[i]!, minute); return; }
  }
}

/** Starts a set-piece event now (also used by tests and QA). */
export function startEvent(c: SimContext, id: DirectorEventId, minute = c.state.time / 60): void {
  const s = c.state, d = s.director, sc = d.scratch;
  const def = DIRECTOR_EVENTS[id];
  d.event = def.name;
  d.eventTime = def.duration;
  sc[eventKey(id)] = (sc[eventKey(id)] ?? 0) + 1;
  c.emit({ type: 'director-event', name: def.name, text: def.text });
  switch (id) {
    case 'ambush-ring': ambushRing(c, minute); break;
    case 'fire-ship-rush': fireShipRush(c, minute); break;
    case 'mortar-line': mortarLine(c, minute); break;
    case 'treasure-convoy': treasureConvoy(c); break;
    case 'storm-front': stormFront(c, def.duration); break;
    case 'fog-bank': fogBank(c, minute, def.duration); break;
    default: startWorldEvent(c, id, minute);
  }
}

const EVENT_CAP = SOFT_ENEMY_CAP + 18;

function eventSpawn(c: SimContext, id: EnemyId, x: number, z: number, heading?: number): EnemyState | null {
  if (c.state.enemies.length >= EVENT_CAP) return null;
  const def = c.content.enemies[id];
  const spot = openWaterNear(c, x, z, def.radius + 5, 4);
  if (!spot) return null;
  const p = c.state.player;
  return spawnScaled(c, id, spot.x, spot.z, { heading: heading ?? headingTo(p.x - spot.x, p.z - spot.z) });
}

function ambushRing(c: SimContext, minute: number): void {
  const p = c.state.player;
  const n = EVENT_TUNING.ambushSkiffs(minute);
  const R = EVENT_TUNING.ambushRadius;
  const offset = c.random() * TAU;
  for (let k = 0; k < n; k++) {
    const a = offset + (k / n) * TAU;
    const e = eventSpawn(c, 'skiff', p.x + fwdX(a) * R, p.z + fwdZ(a) * R);
    if (e) { e.ai.flank = 0; e.ai.t = rand(c, 0.3, 1.4); }
  }
}

function fireShipRush(c: SimContext, minute: number): void {
  const p = c.state.player;
  const n = EVENT_TUNING.fireShips(minute);
  const a = (p.speed > 3 ? p.heading : c.random() * TAU) + (c.random() < 0.5 ? 1 : -1) * rand(c, 0.3, 0.9);
  const cx = p.x + fwdX(a) * 320, cz = p.z + fwdZ(a) * 320;
  const heading = headingTo(p.x - cx, p.z - cz);
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * 34;
    const e = eventSpawn(c, 'fireship', cx + sideX(heading, 1) * off, cz + sideZ(heading, 1) * off, heading);
    if (e) e.ai.flank = (k / Math.max(1, n - 1) - 0.5) * 0.8;
  }
}

function mortarLine(c: SimContext, minute: number): void {
  const p = c.state.player;
  const n = EVENT_TUNING.mortarBarges(minute);
  const a = p.heading + (c.random() < 0.5 ? 1 : -1) * (Math.PI / 2) + rand(c, -0.4, 0.4);
  const cx = p.x + fwdX(a) * 250, cz = p.z + fwdZ(a) * 250;
  const heading = headingTo(p.x - cx, p.z - cz);
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * 60;
    eventSpawn(c, 'mortar-barge', cx + sideX(heading, 1) * off, cz + sideZ(heading, 1) * off, heading);
  }
  for (let k = 0; k < EVENT_TUNING.mortarEscorts; k++) {
    eventSpawn(c, 'cutter', cx + fwdX(heading) * 50 + sideX(heading, k % 2 ? 1 : -1) * 40, cz + fwdZ(heading) * 50 + sideZ(heading, k % 2 ? 1 : -1) * 40);
  }
}

function treasureConvoy(c: SimContext): void {
  const s = c.state, p = s.player;
  const a = (p.speed > 3 ? p.heading : c.random() * TAU) + rand(c, -0.6, 0.6);
  const cx = p.x + fwdX(a) * 230, cz = p.z + fwdZ(a) * 230;
  for (let k = 0; k < EVENT_TUNING.convoyGalleons; k++) {
    const x = cx + fwdX(a) * k * 70 + sideX(a, 1) * (k % 2 ? 30 : -30);
    const z = cz + fwdZ(a) * k * 70 + sideZ(a, 1) * (k % 2 ? 30 : -30);
    if (s.enemies.length >= EVENT_CAP) break;
    const spot = openWaterNear(c, x, z, 22, 4);
    if (!spot) continue;
    const e = spawnScaled(c, 'corsair-galleon', spot.x, spot.z, { heading: a, hpMul: EVENT_TUNING.convoyHpMul });
    if (e) { e.ai.convoy = 1; e.ai.t = EVENT_TUNING.convoyEscape; }
  }
}

function stormFront(c: SimContext, duration: number): void {
  const s = c.state, sc = s.director.scratch;
  sc[SCRATCH.stormFront] = duration;
  sc[SCRATCH.nextStrike] = s.time + 1;
  const from = c.random() * TAU;
  for (let k = 0; k < EVENT_TUNING.stormWaves; k++) spawnRogueWave(c, from + rand(c, -0.3, 0.3), 260 + k * 150, EVENT_TUNING.stormWaveWidth);
}

function fogBank(c: SimContext, minute: number, duration: number): void {
  const s = c.state, sc = s.director.scratch, p = s.player;
  sc[SCRATCH.fogBank] = duration;
  sc[SCRATCH.fogBankMax] = duration;
  const sea = c.content.seas[s.seaId];
  const id: EnemyId = sea.enemyFactions.includes('wraith') ? 'wraith' : 'corsair-brig';
  const n = EVENT_TUNING.fogWraiths(minute);
  for (let k = 0; k < n; k++) {
    const a = c.random() * TAU, r = rand(c, 170, 220);
    const e = eventSpawn(c, id, p.x + fwdX(a) * r, p.z + fwdZ(a) * r);
    if (e) e.ai.t = rand(c, 1, 3);
  }
}

// ───────────────────────── Forts ─────────────────────────

/** Cliff Battery site on a fort island (WORLD's IslandField.batterySitesNear; not part of the WorldQuery contract). */
interface BatterySiteLike { islandId: string; x: number; y: number; z: number; facing: number }
type BatteryWorld = { batterySitesNear?: (x: number, z: number, radius: number, out?: BatterySiteLike[]) => BatterySiteLike[] };
const SITES: BatterySiteLike[] = [];

function placeForts(c: SimContext, sea: SeaDef, minute: number): void {
  const s = c.state, sc = s.director.scratch, p = s.player;
  const fortDef = c.content.enemies.fort;
  if (minute < fortDef.firstMinute || !sea.enemyFactions.includes(fortDef.faction) || s.director.activeBoss) return;
  if (s.time < (sc[SCRATCH.nextFort] ?? 0)) return;
  sc[SCRATCH.nextFort] = s.time + DIRECTOR.fortInterval;
  let forts = 0;
  for (const e of s.enemies) if (e.defId === 'fort' && e.life === 'alive') forts++;
  if (forts >= DIRECTOR.fortMax) return;
  const rt = metaRuntime(s, c.content);
  const world = c.world as typeof c.world & BatteryWorld;
  if (typeof world.batterySitesNear === 'function') {
    // Real Admiralty forts: man the tower tops of fort islands (two batteries per island at most).
    const sites = world.batterySitesNear(p.x, p.z, DIRECTOR.fortSearchMax, SITES);
    for (const site of sites) {
      if (forts >= DIRECTOR.fortMax) break;
      const key = `${site.islandId}:${Math.round(site.x)}:${Math.round(site.z)}`;
      const islandKey = `isl:${site.islandId}`;
      if (rt.fortIslands.has(key) || (rt.fortCount.get(islandKey) ?? 0) >= 2) continue;
      if (Math.hypot(site.x - p.x, site.z - p.z) < DIRECTOR.fortSearchMin) continue;
      const e = spawnScaled(c, 'fort', site.x, site.z, { heading: site.facing });
      if (!e) break;
      e.y = site.y;
      // Flat shots stop at the coastline: reach the hit circle a little past the shore so broadsides can hit.
      const inland = Math.max(0, -c.world.shoreDistance(site.x, site.z, 120));
      e.radius = Math.max(e.radius, inland + 9);
      e.attackCooldown = 2.5;
      rt.fortIslands.add(key);
      rt.fortCount.set(islandKey, (rt.fortCount.get(islandKey) ?? 0) + 1);
      forts++;
    }
    return;
  }
  // Fallback worlds without battery sites: a battery hugging the shore of the island nearest the player.
  const islands = c.world.islandsNear(p.x, p.z, DIRECTOR.fortSearchMax, rt.islands);
  for (const island of islands) {
    if (rt.fortIslands.has(island.id)) continue;
    const d = Math.hypot(island.x - p.x, island.z - p.z);
    if (d - island.radius < DIRECTOR.fortSearchMin * 0.6 || d > DIRECTOR.fortSearchMax + island.radius) continue;
    let best = island.outline[0]!, bestD = Infinity;
    for (const v of island.outline) {
      const vd = (v.x - p.x) * (v.x - p.x) + (v.z - p.z) * (v.z - p.z);
      if (vd < bestD) { bestD = vd; best = v; }
    }
    const nx = best.x - island.x, nz = best.z - island.z, nl = Math.hypot(nx, nz) || 1;
    let fx = best.x, fz = best.z, ok = false;
    for (let step = 0; step < 12; step++) {
      if (c.world.isWater(fx, fz, fortDef.radius + 1)) { ok = true; break; }
      fx += (nx / nl) * 3; fz += (nz / nl) * 3;
    }
    if (!ok) continue;
    const fdist = Math.hypot(fx - p.x, fz - p.z);
    if (fdist < DIRECTOR.fortSearchMin || fdist > DIRECTOR.fortSearchMax) continue;
    const e = spawnScaled(c, 'fort', fx, fz, { heading: headingTo(p.x - fx, p.z - fz) });
    if (e) { rt.fortIslands.add(island.id); e.attackCooldown = 2.5; }
    return;
  }
}

// ───────────────────────── Housekeeping ─────────────────────────

/** Recycles stragglers left far behind to the spawn ring ahead; forts far astern are quietly removed. */
function recycle(c: SimContext): void {
  const s = c.state, p = s.player;
  const r2 = DESPAWN_RADIUS * DESPAWN_RADIUS;
  for (const e of s.enemies) {
    if (e.life !== 'alive' || e.ai.limbo === 1 || e.ai.convoy === 1) continue;
    const dx = e.x - p.x, dz = e.z - p.z, d2 = dx * dx + dz * dz;
    if (e.defId === 'fort') { if (d2 > 900 * 900) e.life = 'dead'; continue; }
    if (d2 < r2) continue;
    const spot = spawnPoint(c, e.radius);
    if (!spot) continue;
    e.x = spot.x; e.z = spot.z; e.vx = 0; e.vz = 0;
    e.heading = headingTo(p.x - e.x, p.z - e.z);
    e.ai.mode = 0; e.ai.leader = 0; e.ai.windup = 0;
  }
}

/** Merges far-away uncollected treasure into gold bars when the pickup pool gets crowded. */
function mergeCoins(c: SimContext): void {
  const s = c.state, sc = s.director.scratch;
  const t = (sc[SCRATCH.mergeTimer] ?? 2) - c.dt;
  sc[SCRATCH.mergeTimer] = t;
  if (t > 0) return;
  sc[SCRATCH.mergeTimer] = 2;
  let alive = 0;
  for (const k of s.pickups) if (k.alive) alive++;
  if (alive < 480) return;
  const p = s.player;
  let target: (typeof s.pickups)[number] | null = null;
  let total = 0, merged = 0;
  for (const k of s.pickups) {
    if (!k.alive || k.magnet || (k.kind !== 'xp-copper' && k.kind !== 'xp-silver' && k.kind !== 'xp-gold')) continue;
    if ((k.x - p.x) * (k.x - p.x) + (k.z - p.z) * (k.z - p.z) < 180 * 180) continue;
    total += k.value;
    if (!target) target = k; else k.alive = false;
    if (++merged >= 250) break;
  }
  if (target && merged > 1) { target.value = total; target.kind = 'xp-gold'; target.age = 0; }
}
