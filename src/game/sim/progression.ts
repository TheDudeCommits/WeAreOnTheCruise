/**
 * The survivor core (META-owned): XP and levels, the weighted luck-aware card pool (branch A/B pairs at level 3,
 * OVERDRIVE ★ gated on weapon level 5 + run level), rerolls and banishes, queued level-ups, tier-ups, stat chips,
 * chests (rewards applied on open, then revealed with status 'chest'), kill drops, bounty and boss rewards.
 *
 * Contract hooks called by CORE: initProgression, updateProgression, applyChosenCard, rerollOffers, banishCard,
 * onEnemyKilled, onBossKilled (Sim.ts) and onPickupCollected (pickups.ts).
 */
import { BRANCH_LEVEL, MAX_PASSIVE_SLOTS, MAX_WEAPON_LEVEL, MAX_WEAPON_SLOTS, tierForLevel, xpToNext } from '../constants';
import { DIRECTOR, EVENT_TUNING } from '../content/director';
import { ENEMY_AI } from '../content/enemies';
import {
  BASE_REGEN, BOUNTY, CARD_WEIGHTS, CHESTS, COIN_TIERS, DOUBLOON_CARD, ECONOMY, ENTRY_WEIGHTS, HEAL_CARD, LUCK_FOURTH_CARD,
  OVERDRIVE_MIN_LEVEL, PICKUP_EFFECTS, RARE_DROPS, type ChipDef,
} from '../content/rewards';
import { META_UPGRADE_IDS, PASSIVE_IDS, WEAPON_IDS, type PassiveId, type StatKey, type WeaponId } from '../ids';
import type { PickupKind } from '../ids';
import type { BossState, CardOffer, EnemyState, PickupState } from '../types';
import type { SimContext } from './context';
import { beginVictoryLap } from './director';
import {
  CHIPS, branchCard, chipCard, chipId, doubloonCard, healCard, newWeaponCard, overdriveCard, passiveCard, rollRarity, weaponLevelCard,
} from './meta-cards';
import { CHIP_PREFIX, SCRATCH } from './meta-runtime';
import { TAU } from './meta-steer';
import { STAT_KEYS, addStats, doubloonMul, emptyStats, xpMul } from './stats';
import { onAffixDeath } from './affixes';
import { gainMomentum } from './player';

const CHIP_KEY = Object.fromEntries(STAT_KEYS.map((k) => [k, `${CHIP_PREFIX}${k}`])) as Record<StatKey, string>;

// ───────────────────────── Stats ─────────────────────────

export function initProgression(c: SimContext): void {
  const p = c.state.player;
  p.revivesLeft = Math.max(0, Math.min(2, Math.floor(c.meta.upgrades['second-wind'] ?? 0)));
  recomputeStats(c);
  p.hp = p.maxHp;
}

/** Rebuilds player.stats from passives + harbor upgrades + this run's chips; extra max hull comes repaired. */
export function recomputeStats(c: SimContext): void {
  const p = c.state.player;
  const stats = emptyStats();
  for (const slot of p.passives) addStats(stats, c.content.passives[slot.id].perRank, slot.rank);
  for (const id of META_UPGRADE_IDS) {
    const rank = c.meta.upgrades[id];
    if (rank) addStats(stats, c.content.metaUpgrades[id].perRank, rank);
  }
  const sc = c.state.director.scratch;
  for (const key of STAT_KEYS) { const v = sc[CHIP_KEY[key]]; if (v) stats[key] += v; }
  stats.regen += BASE_REGEN;
  p.stats = stats;
  const oldMax = p.maxHp;
  p.maxHp = c.content.ships[p.shipId].hp * (1 + stats.maxHp);
  if (p.maxHp > oldMax && p.alive) p.hp += p.maxHp - oldMax;
  p.hp = Math.min(p.maxHp, Math.max(p.alive ? 1 : 0, p.hp));
}

/** Chip bonuses collected this run (for UI/tests). */
export function chipTotal(c: SimContext, stat: StatKey): number {
  return c.state.director.scratch[CHIP_KEY[stat]] ?? 0;
}

// ───────────────────────── XP and levels ─────────────────────────

export function grantXp(c: SimContext, amount: number): void {
  const p = c.state.player;
  const gained = amount * xpMul(p.stats);
  p.xp += gained;
  c.state.stats.xpCollected += gained;
}

export function updateProgression(c: SimContext): void {
  const s = c.state;
  const p = s.player;
  let guard = 0;
  while (p.xp >= p.xpToNext && guard++ < 60) {
    p.xp -= p.xpToNext;
    p.level++;
    p.xpToNext = xpToNext(p.level);
    s.pendingLevelUps++;
    c.emit({ type: 'level-up', level: p.level });
    const tier = tierForLevel(p.level);
    if (tier !== p.tier) { p.tier = tier; c.emit({ type: 'tier-up', tier }); }
  }
  if (s.pendingLevelUps > 0 && s.status === 'running' && !s.offers) {
    s.offers = createOffers(c);
    s.status = 'levelup';
  }
}

// ───────────────────────── Card pool ─────────────────────────

interface Entry { key: string; weight: number; cards: CardOffer[]; chip?: ChipDef }
interface Category { weight: number; entries: Entry[] }

/** Number of cards per level-up: 3, or 4 with enough luck. */
export function cardCount(c: SimContext): number {
  return 3 + (c.state.player.stats.luck >= LUCK_FOURTH_CARD ? 1 : 0);
}

/**
 * Builds a level-up offer. A category is drawn by weight (owned weapon upgrades > new weapons while slots are free
 * > passive ranks > new passives > stat chips; heal when hull is low), then an item inside it. Branch cards are an
 * A/B pair that takes two slots; OVERDRIVE needs the weapon at level 5 and the run at OVERDRIVE_MIN_LEVEL.
 * `avoid` (reroll) makes the previous cards unlikely without making the pool run dry.
 */
export function createOffers(c: SimContext, avoid?: ReadonlySet<string>): CardOffer[] {
  const s = c.state, p = s.player;
  const banned = new Set(s.banished);
  const luck = p.stats.luck;
  const count = cardCount(c);
  const soft = (key: string, w: number) => (avoid?.has(key) ? w * 0.12 : w);

  const weaponUp: Entry[] = [], newWeapons: Entry[] = [], passiveUp: Entry[] = [], newPassives: Entry[] = [], chips: Entry[] = [], heal: Entry[] = [];
  for (const slot of p.weapons) {
    if (banned.has(slot.id) || slot.level >= MAX_WEAPON_LEVEL) continue;
    const def = c.content.weapons[slot.id];
    const next = slot.level + 1;
    if (next === BRANCH_LEVEL && !slot.branch) {
      weaponUp.push({ key: slot.id, weight: soft(slot.id, ENTRY_WEIGHTS.branch), cards: [branchCard(def, def.branches[0]), branchCard(def, def.branches[1])] });
    } else if (next === MAX_WEAPON_LEVEL) {
      if (p.level >= OVERDRIVE_MIN_LEVEL) weaponUp.push({ key: slot.id, weight: soft(slot.id, ENTRY_WEIGHTS.overdrive * (1 + luck * 0.1)), cards: [overdriveCard(def)] });
    } else {
      weaponUp.push({ key: slot.id, weight: soft(slot.id, ENTRY_WEIGHTS.level), cards: [weaponLevelCard(def, next)] });
    }
  }
  if (p.weapons.length < MAX_WEAPON_SLOTS) {
    for (const id of WEAPON_IDS) {
      if (banned.has(id) || p.weapons.some((w) => w.id === id)) continue;
      newWeapons.push({ key: id, weight: soft(id, 1), cards: [newWeaponCard(c.content.weapons[id])] });
    }
  }
  for (const slot of p.passives) {
    const def = c.content.passives[slot.id];
    if (banned.has(slot.id) || slot.rank >= def.maxRank) continue;
    passiveUp.push({ key: slot.id, weight: soft(slot.id, 1), cards: [passiveCard(def, slot.rank + 1)] });
  }
  if (p.passives.length < MAX_PASSIVE_SLOTS) {
    for (const id of PASSIVE_IDS) {
      if (banned.has(id) || p.passives.some((x) => x.id === id)) continue;
      newPassives.push({ key: id, weight: soft(id, 1), cards: [passiveCard(c.content.passives[id], 1)] });
    }
  }
  for (const chip of CHIPS) {
    const id = chipId(chip.stat);
    if (banned.has(id)) continue;
    chips.push({ key: id, weight: soft(id, 1), cards: [], chip });
  }
  const hpFrac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  if (hpFrac < CARD_WEIGHTS.healBelow) heal.push({ key: 'heal', weight: 1, cards: [healCard(HEAL_CARD)] });

  const cats: Category[] = [
    { weight: CARD_WEIGHTS.weaponUpgrade, entries: weaponUp },
    { weight: CARD_WEIGHTS.newWeapon, entries: newWeapons },
    { weight: CARD_WEIGHTS.passiveUpgrade, entries: passiveUp },
    { weight: CARD_WEIGHTS.newPassive, entries: newPassives },
    { weight: CARD_WEIGHTS.chip, entries: chips },
    { weight: CARD_WEIGHTS.heal * (1 + (CARD_WEIGHTS.healBelow - hpFrac) / CARD_WEIGHTS.healBelow), entries: heal },
  ];

  const offers: CardOffer[] = [];
  while (offers.length < count) {
    const room = count - offers.length;
    let total = 0;
    for (const cat of cats) if (fits(cat, room)) total += cat.weight;
    if (total <= 0) break;
    let r = c.random() * total;
    let cat = cats[0]!;
    for (const candidate of cats) {
      if (!fits(candidate, room)) continue;
      cat = candidate;
      r -= candidate.weight;
      if (r <= 0) break;
    }
    const entry = drawEntry(c, cat, room);
    if (!entry) break;
    if (entry.chip) offers.push(chipCard(entry.chip, rollRarity(c.random, luck)));
    else offers.push(...entry.cards);
  }
  // Fallback when the pool is exhausted: repairs and doubloons.
  if (offers.length < count && !offers.some((o) => o.kind === 'heal')) offers.push(healCard(HEAL_CARD));
  if (offers.length < count) offers.push(doubloonCard(Math.round(DOUBLOON_CARD.base + DOUBLOON_CARD.perMinute * (s.time / 60))));
  return offers;
}

const size = (e: Entry) => (e.chip ? 1 : e.cards.length);
const fits = (cat: Category, room: number) => cat.weight > 0 && cat.entries.some((e) => e.weight > 0 && size(e) <= room);

function drawEntry(c: SimContext, cat: Category, room: number): Entry | null {
  let total = 0;
  for (const e of cat.entries) if (e.weight > 0 && size(e) <= room) total += e.weight;
  if (total <= 0) return null;
  let r = c.random() * total;
  for (let i = 0; i < cat.entries.length; i++) {
    const e = cat.entries[i]!;
    if (e.weight <= 0 || size(e) > room) continue;
    r -= e.weight;
    if (r <= 0) { cat.entries.splice(i, 1); return e; }
  }
  return null;
}

// ───────────────────────── Applying cards ─────────────────────────

/** Applies a card's effect to the run (no status/offer bookkeeping). Emits loadout events. */
export function applyOffer(c: SimContext, offer: CardOffer): void {
  const s = c.state, p = s.player;
  switch (offer.kind) {
    case 'new-weapon': {
      const id = offer.id as WeaponId;
      if (p.weapons.some((w) => w.id === id) || p.weapons.length >= MAX_WEAPON_SLOTS) break;
      p.weapons.push({ id, level: 1, overdrive: false, cooldown: 0.5, scratch: {} });
      c.emit({ type: 'weapon-changed', weapon: id, level: 1, overdrive: false, isNew: true });
      break;
    }
    case 'weapon-level': case 'weapon-branch': case 'weapon-overdrive': {
      const slot = p.weapons.find((w) => w.id === offer.id);
      if (!slot) break;
      slot.level = Math.min(MAX_WEAPON_LEVEL, offer.level ?? slot.level + 1);
      if (offer.branch) slot.branch = offer.branch;
      if (slot.level >= MAX_WEAPON_LEVEL) slot.overdrive = true;
      c.emit({ type: 'weapon-changed', weapon: slot.id, level: slot.level, branch: slot.branch, overdrive: slot.overdrive, isNew: false });
      break;
    }
    case 'new-passive': {
      const id = offer.id as PassiveId;
      if (p.passives.some((x) => x.id === id) || p.passives.length >= MAX_PASSIVE_SLOTS) break;
      p.passives.push({ id, rank: 1 });
      c.emit({ type: 'passive-changed', passive: id, rank: 1, isNew: true });
      break;
    }
    case 'passive-rank': {
      const slot = p.passives.find((x) => x.id === offer.id);
      if (!slot) break;
      slot.rank = Math.min(c.content.passives[slot.id].maxRank, slot.rank + 1);
      c.emit({ type: 'passive-changed', passive: slot.id, rank: slot.rank, isNew: false });
      break;
    }
    case 'chip':
      if (offer.stat) s.director.scratch[CHIP_KEY[offer.stat]] = (s.director.scratch[CHIP_KEY[offer.stat]] ?? 0) + (offer.amount ?? 0);
      break;
    case 'heal': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * (offer.amount ?? HEAL_CARD)); break;
    case 'doubloons': s.stats.doubloons += Math.round(offer.amount ?? DOUBLOON_CARD.base); break;
  }
}

/**
 * chooseCard(i): during 'levelup' applies offer i (then the next queued level-up or back to running);
 * during 'chest' (rewards already applied) resumes the run.
 */
export function applyChosenCard(c: SimContext, index: number): boolean {
  const s = c.state;
  if (s.status === 'chest') {
    s.offers = null;
    s.status = 'running';
    openQueuedChest(c);
    return true;
  }
  if (s.status !== 'levelup' && !(s.status === 'running' && s.offers)) return false;
  const offer = s.offers?.[index];
  if (!offer) return false;
  applyOffer(c, offer);
  c.emit({ type: 'card-chosen', offer });
  recomputeStats(c);
  s.offers = null;
  s.pendingLevelUps = Math.max(0, s.pendingLevelUps - 1);
  if (s.pendingLevelUps > 0) { s.offers = createOffers(c); s.status = 'levelup'; }
  else { s.status = 'running'; openQueuedChest(c); }
  return true;
}

export function rerollOffers(c: SimContext): boolean {
  const s = c.state;
  if (s.status !== 'levelup' || !s.offers || s.rerolls <= 0) return false;
  s.rerolls--;
  const avoid = new Set(s.offers.map((o) => o.id));
  s.offers = createOffers(c, avoid);
  return true;
}

export function banishCard(c: SimContext, index: number): boolean {
  const s = c.state;
  const offer = s.offers?.[index];
  if (s.status !== 'levelup' || !offer || s.banishes <= 0 || offer.kind === 'heal' || offer.kind === 'doubloons') return false;
  s.banishes--;
  if (!s.banished.includes(offer.id)) s.banished.push(offer.id);
  s.offers = createOffers(c);
  return true;
}

// ───────────────────────── Chests ─────────────────────────

/** Opens a chest (tier 1 = elite, 2 = boss): rewards are applied now and revealed with status 'chest'. */
export function openChest(c: SimContext, tier: number): void {
  const s = c.state, sc = s.director.scratch;
  if (s.status !== 'running' || s.offers) {
    const key = tier >= 2 ? SCRATCH.chestBoss : SCRATCH.chestElite;
    sc[key] = (sc[key] ?? 0) + 1;
    return;
  }
  const rewards = rollChest(c, tier);
  s.offers = rewards;
  s.status = 'chest';
  c.emit({ type: 'chest-opened', rewards });
}

function openQueuedChest(c: SimContext): void {
  const sc = c.state.director.scratch;
  if ((sc[SCRATCH.chestBoss] ?? 0) > 0) { sc[SCRATCH.chestBoss]!--; openChest(c, 2); }
  else if ((sc[SCRATCH.chestElite] ?? 0) > 0) { sc[SCRATCH.chestElite]!--; openChest(c, 1); }
}

function chestCount(c: SimContext, tier: number): number {
  if (tier >= 2) return CHESTS.bossCount;
  const luck = Math.max(0, c.state.player.stats.luck);
  const shift = luck * CHESTS.eliteLuckShift;
  const w = [Math.max(5, CHESTS.eliteCounts[0]! - shift), CHESTS.eliteCounts[1]! + shift * 0.6, CHESTS.eliteCounts[2]! + shift * 0.4];
  let r = c.random() * (w[0]! + w[1]! + w[2]!);
  for (let i = 0; i < 3; i++) { r -= w[i]!; if (r <= 0) return i + 1; }
  return 1;
}

function rollChest(c: SimContext, tier: number): CardOffer[] {
  const s = c.state, p = s.player;
  const n = chestCount(c, tier);
  const rewards: CardOffer[] = [];
  for (let i = 0; i < n; i++) {
    const card = chestReward(c, tier, i === 0 && tier >= 2);
    if (!card) continue;
    applyOffer(c, card);
    recomputeStats(c);
    rewards.push(card);
  }
  const amount = Math.round((tier >= 2 ? CHESTS.bossDoubloons : CHESTS.eliteDoubloons) * doubloonMul(p.stats));
  s.stats.doubloons += amount;
  rewards.push(doubloonCard(amount, true));
  return rewards;
}

/**
 * One chest reward: an OVERDRIVE (boss chests force one when a weapon is at level 5), a weapon level (never across
 * the branch choice — that stays the player's call), a passive rank, or a rare+ chip.
 */
function chestReward(c: SimContext, tier: number, forceOverdrive: boolean): CardOffer | null {
  const s = c.state, p = s.player;
  const banned = s.banished;
  const cards: CardOffer[] = [];
  const weights: number[] = [];
  for (const slot of p.weapons) {
    if (banned.includes(slot.id)) continue;
    const def = c.content.weapons[slot.id];
    if (slot.level === MAX_WEAPON_LEVEL - 1 && (p.level >= OVERDRIVE_MIN_LEVEL || tier >= 2)) {
      if (forceOverdrive) return overdriveCard(def);
      cards.push(overdriveCard(def)); weights.push(30);
    } else if (slot.level < MAX_WEAPON_LEVEL - 1 && slot.level + 1 !== BRANCH_LEVEL) {
      cards.push(weaponLevelCard(def, slot.level + 1)); weights.push(10);
    }
  }
  for (const slot of p.passives) {
    const def = c.content.passives[slot.id];
    if (banned.includes(slot.id) || slot.rank >= def.maxRank) continue;
    cards.push(passiveCard(def, slot.rank + 1)); weights.push(6);
  }
  const chipPool = CHIPS.filter((ch) => !banned.includes(chipId(ch.stat)));
  if (chipPool.length > 0) {
    const chip = chipPool[Math.floor(c.random() * chipPool.length)]!;
    cards.push(chipCard(chip, rollRarity(c.random, p.stats.luck, CHESTS.chipRarity))); weights.push(cards.length > 0 ? 3 : 1);
  }
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return null;
  let r = c.random() * total;
  for (let i = 0; i < cards.length; i++) { r -= weights[i]!; if (r <= 0) return cards[i]!; }
  return cards[cards.length - 1] ?? null;
}

// ───────────────────────── Drops, kills, bosses ─────────────────────────

/** Spills `value` XP as coins: gold bars (25) and silver (5) first, copper for the rest; max `maxPieces` pieces. */
export function spillCoins(c: SimContext, x: number, z: number, value: number, spread: number, maxPieces = COIN_TIERS.maxPieces): void {
  let v = value, pieces = 0;
  while (v > 1e-6 && pieces < maxPieces) {
    let amount: number;
    if (pieces === maxPieces - 1) amount = v;
    else if (v >= COIN_TIERS.gold) amount = COIN_TIERS.gold;
    else if (v >= COIN_TIERS.silver) amount = COIN_TIERS.silver;
    else amount = Math.min(1, v);
    const kind: PickupKind = amount >= COIN_TIERS.gold ? 'xp-gold' : amount >= COIN_TIERS.silver ? 'xp-silver' : 'xp-copper';
    const a = c.random() * TAU, r = pieces === 0 ? 0 : spread * (0.4 + c.random() * 0.6);
    c.spawnPickup(kind, x + Math.sin(a) * r, z + Math.cos(a) * r, amount);
    v -= amount;
    pieces++;
  }
}

function scatter(c: SimContext, kind: PickupKind, x: number, z: number, value: number, spread: number): void {
  const a = c.random() * TAU, r = spread * (0.3 + c.random() * 0.7);
  c.spawnPickup(kind, x + Math.sin(a) * r, z + Math.cos(a) * r, value);
}

export function onEnemyKilled(c: SimContext, e: EnemyState): void {
  const s = c.state, p = s.player;
  const def = c.content.enemies[e.defId];
  const tune = ENEMY_AI[e.defId];
  s.stats.kills++;
  if (e.elite) s.stats.eliteKills++;
  if (e.lastHitBy) s.stats.killsByWeapon[e.lastHitBy] = (s.stats.killsByWeapon[e.lastHitBy] ?? 0) + 1;
  s.stats.bounty += Math.round(def.xp * BOUNTY.perXp * s.director.heat * (e.elite ? BOUNTY.eliteMul : 1));
  c.emit({ type: 'enemy-killed', id: e.id, defId: e.defId, x: e.x, z: e.z, elite: e.elite, weapon: e.lastHitBy });
  if (def.behavior === 'kamikaze') e.ai.detonate = 1;
  gainMomentum(c);
  if (e.affixes.length) onAffixDeath(c, e);
  if (e.ai.limbo === 1) { e.ai.limbo = 0; e.x = e.ai.hx ?? e.x; e.z = e.ai.hz ?? e.z; }

  const convoy = e.ai.convoy === 1;
  // Harder seas field more ships, not more experience: XP per ship falls with the sea's difficulty.
  const density = Math.pow(c.content.seas[s.seaId].difficulty, DIRECTOR.xpDifficultyExp);
  const xp = (def.xp * (e.elite ? DIRECTOR.eliteXp : 1) * (convoy ? 0.5 : 1)) / density;
  spillCoins(c, e.x, e.z, xp, e.radius);
  const luck = Math.max(0, p.stats.luck);
  const perShip = DIRECTOR.dropScale(s.time / 60);
  if (c.random() < def.doubloonChance * (1 + luck * 0.05) * perShip) scatter(c, 'doubloon', e.x, e.z, tune.doubloons, e.radius);
  if (convoy) for (let k = 0; k < 3; k++) scatter(c, 'doubloon', e.x, e.z, Math.round(EVENT_TUNING.convoyDoubloons / 3), e.radius * 1.2);
  if (e.elite) {
    c.spawnPickup('chest', e.x, e.z, 1);
    scatter(c, 'doubloon', e.x, e.z, ECONOMY.eliteKill, e.radius);
    if (c.random() < RARE_DROPS.eliteRepair) scatter(c, 'repair', e.x, e.z, 1, e.radius);
    return;
  }
  const scale = (1 + def.xp * RARE_DROPS.sizeScale) * (1 + luck * RARE_DROPS.luckScale) * perShip;
  const r = c.random();
  if (r < RARE_DROPS.repair * scale) scatter(c, 'repair', e.x, e.z, 1, e.radius);
  else if (r < (RARE_DROPS.repair + RARE_DROPS.compass) * scale) scatter(c, 'compass', e.x, e.z, 1, e.radius);
  else if (r < (RARE_DROPS.repair + RARE_DROPS.compass + RARE_DROPS.powderKeg) * scale) scatter(c, 'powder-keg', e.x, e.z, 1, e.radius);
}

export function onBossKilled(c: SimContext, b: BossState): void {
  const s = c.state, d = s.director, p = s.player;
  const def = c.content.bosses[b.defId];
  const sea = c.content.seas[s.seaId];
  s.stats.kills++;
  s.stats.bossesDefeated.push(b.defId);
  s.stats.bounty += Math.round(BOUNTY.boss * d.heat);
  b.submerged = 0;
  c.emit({ type: 'boss-defeated', boss: b.defId, id: b.id, x: b.x, z: b.z });
  c.requestTimeScale(0.2, 1.2);
  let others = false;
  for (const o of s.bosses) if (o !== b && o.life === 'alive') { others = true; d.activeBoss = o.defId; break; }
  if (!others) d.activeBoss = null;

  const finalBoss = sea.bosses[sea.bosses.length - 1]?.boss;
  const isFinal = !s.endless && b.defId === finalBoss && d.nextBossIndex >= sea.bosses.length && !others;
  if (isFinal) {
    // The run ends shortly: bank everything directly instead of dropping it on the water.
    s.stats.doubloons += Math.round((def.doubloons + ECONOMY.victoryBonus) * doubloonMul(p.stats));
    s.stats.bounty += BOUNTY.victory;
    grantXp(c, def.xp);
    beginVictoryLap(c);
    return;
  }
  spillCoins(c, b.x, b.z, def.xp, b.radius * 1.3, 12);
  c.spawnPickup('chest', b.x, b.z, 2);
  const pieces = 6;
  for (let k = 0; k < pieces; k++) scatter(c, 'doubloon', b.x, b.z, Math.max(1, Math.round(def.doubloons / pieces)), b.radius * 1.4);
  if (c.random() < 0.5) scatter(c, 'repair', b.x, b.z, 1, b.radius);
}

// ───────────────────────── Pickups ─────────────────────────

export function onPickupCollected(c: SimContext, k: PickupState): void {
  const s = c.state, p = s.player;
  switch (k.kind) {
    case 'xp-copper': case 'xp-silver': case 'xp-gold': grantXp(c, k.value); break;
    case 'doubloon': s.stats.doubloons += Math.max(1, Math.round(k.value * doubloonMul(p.stats))); break;
    case 'repair': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * PICKUP_EFFECTS.repair); break;
    case 'compass': for (const other of s.pickups) if (other.alive) other.magnet = true; break;
    case 'powder-keg': powderKeg(c); break;
    case 'chest': openChest(c, k.value >= 2 ? 2 : 1); break;
  }
}

/** Powder keg: a screen-clearing blast around the player (most of a normal ship's hull, a sliver of a boss's). */
function powderKeg(c: SimContext): void {
  const s = c.state, p = s.player;
  const r = PICKUP_EFFECTS.kegRadius, r2 = r * r;
  c.emit({ type: 'explosion', x: p.x, z: p.z, radius: r, kind: 'powder', team: 'player' });
  c.requestTimeScale(0.4, 0.25);
  for (const e of s.enemies) {
    if (e.life !== 'alive') continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    if (dx * dx + dz * dz > r2) continue;
    c.damageTarget(e, e.maxHp * PICKUP_EFFECTS.kegFraction + PICKUP_EFFECTS.kegFlat, { pierceArmor: true, knockback: 10, fromX: p.x, fromZ: p.z });
  }
  for (const b of s.bosses) {
    if (b.life !== 'alive') continue;
    const dx = b.x - p.x, dz = b.z - p.z;
    if (dx * dx + dz * dz > r2) continue;
    c.damageTarget(b, b.maxHp * PICKUP_EFFECTS.kegBossFraction, { pierceArmor: true });
  }
}
