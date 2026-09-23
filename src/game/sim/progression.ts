/**
 * XP, levels, cards, loadout, stats, kill drops (META-owned). Skeleton covers the full loop simply.
 * TODO(META): weighted/luck-aware card pool, branch + overdrive cards, chests, chips, banish, drop tables.
 */
import { BRANCH_LEVEL, MAX_PASSIVE_SLOTS, MAX_WEAPON_LEVEL, MAX_WEAPON_SLOTS, tierForLevel, xpToNext } from '../constants';
import { PASSIVE_IDS, WEAPON_IDS } from '../ids';
import type { BossState, CardOffer, EnemyState, PickupState } from '../types';
import type { SimContext } from './context';
import { addStats, doubloonMul, emptyStats, xpMul } from './stats';

export function initProgression(c: SimContext): void {
  const p = c.state.player;
  p.revivesLeft = c.meta.upgrades['second-wind'] ?? 0;
  recomputeStats(c);
  p.hp = p.maxHp;
}

/** Recomputes player.stats and maxHp from passives + meta upgrades. */
export function recomputeStats(c: SimContext): void {
  const p = c.state.player;
  const stats = emptyStats();
  for (const slot of p.passives) addStats(stats, c.content.passives[slot.id].perRank, slot.rank);
  for (const [id, rank] of Object.entries(c.meta.upgrades)) {
    const def = c.content.metaUpgrades[id as keyof typeof c.content.metaUpgrades];
    if (def && rank) addStats(stats, def.perRank, rank);
  }
  p.stats = stats;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  p.maxHp = c.content.ships[p.shipId].hp * (1 + stats.maxHp);
  p.hp = Math.min(p.maxHp, Math.max(1, ratio * p.maxHp));
}

export function onEnemyKilled(c: SimContext, e: EnemyState): void {
  const s = c.state;
  const def = c.content.enemies[e.defId];
  s.stats.kills++;
  if (e.elite) s.stats.eliteKills++;
  if (e.lastHitBy) s.stats.killsByWeapon[e.lastHitBy] = (s.stats.killsByWeapon[e.lastHitBy] ?? 0) + 1;
  s.stats.bounty += Math.round(def.xp * 1000 * (e.elite ? 4 : 1) * s.director.heat);
  c.emit({ type: 'enemy-killed', id: e.id, defId: e.defId, x: e.x, z: e.z, elite: e.elite, weapon: e.lastHitBy });
  const xp = def.xp * (e.elite ? 5 : 1);
  const kind = xp >= 20 ? 'xp-gold' : xp >= 4 ? 'xp-silver' : 'xp-copper';
  c.spawnPickup(kind, e.x, e.z, xp);
  if (c.random() < def.doubloonChance) c.spawnPickup('doubloon', e.x + 3, e.z + 3, 1);
  if (e.elite) c.spawnPickup('chest', e.x - 3, e.z - 3, 1);
  if (c.random() < 0.006) c.spawnPickup('repair', e.x, e.z - 4, 1);
}

export function onBossKilled(c: SimContext, b: BossState): void {
  const s = c.state;
  const def = c.content.bosses[b.defId];
  s.stats.kills++;
  s.stats.bossesDefeated.push(b.defId);
  s.stats.bounty += def.xp * 5000;
  s.director.activeBoss = null;
  c.emit({ type: 'boss-defeated', boss: b.defId, id: b.id, x: b.x, z: b.z });
  for (let i = 0; i < 8; i++) c.spawnPickup('xp-gold', b.x + Math.sin(i) * 12, b.z + Math.cos(i) * 12, def.xp / 8);
  c.spawnPickup('chest', b.x, b.z, 2);
  for (let i = 0; i < 6; i++) c.spawnPickup('doubloon', b.x + Math.sin(i * 2) * 18, b.z + Math.cos(i * 2) * 18, Math.round(def.doubloons / 6));
  const sea = c.content.seas[s.seaId];
  if (b.defId === sea.bosses[sea.bosses.length - 1]?.boss && !s.endless) {
    c.endRun('victory');
  }
}

export function onPickupCollected(c: SimContext, k: PickupState): void {
  const s = c.state;
  const p = s.player;
  switch (k.kind) {
    case 'xp-copper': case 'xp-silver': case 'xp-gold': grantXp(c, k.value); break;
    case 'doubloon': s.stats.doubloons += Math.max(1, Math.round(k.value * doubloonMul(p.stats))); break;
    case 'repair': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.25); break;
    case 'compass': for (const other of s.pickups) if (other.alive) other.magnet = true; break;
    case 'powder-keg': for (const e of s.enemies) if (e.life === 'alive' && Math.hypot(e.x - p.x, e.z - p.z) < 260) c.damageTarget(e, 400, { pierceArmor: true }); break;
    case 'chest': grantXp(c, p.xpToNext); break; // TODO(META): real chest rewards (1–3 upgrades, chest-opened event).
  }
}

export function grantXp(c: SimContext, amount: number): void {
  const p = c.state.player;
  const gained = amount * xpMul(p.stats);
  p.xp += gained;
  c.state.stats.xpCollected += gained;
}

export function updateProgression(c: SimContext): void {
  const s = c.state;
  const p = s.player;
  while (p.xp >= p.xpToNext) {
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

export function createOffers(c: SimContext): CardOffer[] {
  const p = c.state.player;
  const pool: CardOffer[] = [];
  for (const slot of p.weapons) {
    const def = c.content.weapons[slot.id];
    if (slot.level < MAX_WEAPON_LEVEL) {
      const next = slot.level + 1;
      if (next === BRANCH_LEVEL && !slot.branch) {
        for (const br of def.branches) pool.push({ kind: 'weapon-branch', id: slot.id, title: `${def.name}: ${br.name}`, text: br.text, icon: def.icon, rarity: 'rare', level: next, branch: br.id });
      } else if (next === MAX_WEAPON_LEVEL) {
        pool.push({ kind: 'weapon-overdrive', id: slot.id, title: `${def.overdrive.name} ★`, text: def.overdrive.text, icon: def.icon, rarity: 'legendary', level: next });
      } else {
        pool.push({ kind: 'weapon-level', id: slot.id, title: `${def.name} Lv ${next}`, text: def.levels[next - 1]!.text, icon: def.icon, rarity: 'common', level: next });
      }
    }
  }
  if (p.weapons.length < MAX_WEAPON_SLOTS) {
    for (const id of WEAPON_IDS) {
      if (p.weapons.some((w) => w.id === id) || c.state.banished.includes(id)) continue;
      const def = c.content.weapons[id];
      pool.push({ kind: 'new-weapon', id, title: def.name, text: def.description, icon: def.icon, rarity: 'rare', level: 1 });
    }
  }
  for (const slot of p.passives) {
    const def = c.content.passives[slot.id];
    if (slot.rank < def.maxRank) pool.push({ kind: 'passive-rank', id: slot.id, title: `${def.name} ${slot.rank + 1}`, text: def.description, icon: def.icon, rarity: 'common', level: slot.rank + 1 });
  }
  if (p.passives.length < MAX_PASSIVE_SLOTS) {
    for (const id of PASSIVE_IDS) {
      if (p.passives.some((x) => x.id === id) || c.state.banished.includes(id)) continue;
      const def = c.content.passives[id];
      pool.push({ kind: 'new-passive', id, title: def.name, text: def.description, icon: def.icon, rarity: 'common', level: 1 });
    }
  }
  const offers: CardOffer[] = [];
  const count = 3 + (p.stats.luck >= 3 ? 1 : 0);
  while (offers.length < count && pool.length > 0) {
    const index = Math.floor(c.random() * pool.length);
    const card = pool.splice(index, 1)[0]!;
    // Keep branch pairs together when one branch is drawn.
    if (card.kind === 'weapon-branch') {
      const pair = pool.findIndex((o) => o.kind === 'weapon-branch' && o.id === card.id);
      if (pair >= 0 && offers.length + 2 <= count) offers.push(pool.splice(pair, 1)[0]!);
    }
    offers.push(card);
  }
  if (offers.length === 0) offers.push({ kind: 'heal', id: 'heal', title: 'Fresh Timber', text: 'Repair 30% of your hull.', icon: '/assets/icons/heal.png', rarity: 'common' });
  return offers;
}

export function applyChosenCard(c: SimContext, index: number): boolean {
  const s = c.state;
  const offer = s.offers?.[index];
  if (!offer) return false;
  const p = s.player;
  switch (offer.kind) {
    case 'new-weapon': p.weapons.push({ id: offer.id as never, level: 1, overdrive: false, cooldown: 0.5, scratch: {} }); break;
    case 'weapon-level': case 'weapon-branch': case 'weapon-overdrive': {
      const slot = p.weapons.find((w) => w.id === offer.id);
      if (slot) { slot.level = offer.level ?? slot.level + 1; if (offer.branch) slot.branch = offer.branch; if (slot.level >= MAX_WEAPON_LEVEL) slot.overdrive = true; }
      break;
    }
    case 'new-passive': p.passives.push({ id: offer.id as never, rank: 1 }); break;
    case 'passive-rank': { const slot = p.passives.find((x) => x.id === offer.id); if (slot) slot.rank++; break; }
    case 'heal': p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.3); break;
    case 'doubloons': s.stats.doubloons += offer.amount ?? 25; break;
    case 'chip': if (offer.stat) p.stats[offer.stat] += offer.amount ?? 0; break;
  }
  if (offer.kind.includes('weapon')) {
    const slot = p.weapons.find((w) => w.id === offer.id)!;
    c.emit({ type: 'weapon-changed', weapon: slot.id, level: slot.level, branch: slot.branch, overdrive: slot.overdrive, isNew: offer.kind === 'new-weapon' });
  }
  if (offer.kind.includes('passive')) {
    const slot = p.passives.find((x) => x.id === offer.id)!;
    c.emit({ type: 'passive-changed', passive: slot.id, rank: slot.rank, isNew: offer.kind === 'new-passive' });
  }
  c.emit({ type: 'card-chosen', offer });
  recomputeStats(c);
  s.offers = null;
  s.pendingLevelUps = Math.max(0, s.pendingLevelUps - 1);
  if (s.pendingLevelUps > 0) s.offers = createOffers(c);
  else s.status = 'running';
  return true;
}

export function rerollOffers(c: SimContext): boolean {
  const s = c.state;
  if (!s.offers || s.rerolls <= 0) return false;
  s.rerolls--;
  s.offers = createOffers(c);
  return true;
}

export function banishCard(c: SimContext, index: number): boolean {
  const s = c.state;
  const offer = s.offers?.[index];
  if (!offer || s.banishes <= 0) return false;
  s.banishes--;
  s.banished.push(offer.id);
  s.offers = createOffers(c);
  return true;
}
