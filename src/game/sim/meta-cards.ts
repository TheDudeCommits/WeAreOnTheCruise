/**
 * Card builders (META): every CardOffer the level-up screen, chests and tests show. Texts are specific and are
 * generated from the content tables ("+1 gun per side, +14% damage, 7% faster reload").
 */
import { BRANCH_LEVEL, MAX_WEAPON_LEVEL } from '../constants';
import type { Rarity, StatKey } from '../ids';
import type { CardOffer, PassiveDef, WeaponBranchDef, WeaponDef } from '../types';
import { CHIPS, RARITY_ORDER, RARITY_WEIGHTS, RARITY_LUCK_SCALE, type ChipDef } from '../content/rewards';
import { num, sentence, statText } from '../content/text';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const chipId = (stat: StatKey): string => `chip-${stat}`;

export function weaponLevelCard(def: WeaponDef, level: number): CardOffer {
  return {
    kind: 'weapon-level', id: def.id, title: `${def.name} Lv ${level}`, text: sentence(def.levels[level - 1]!.text),
    icon: def.icon, rarity: level >= 4 ? 'rare' : 'common', level,
  };
}

export function branchCard(def: WeaponDef, branch: WeaponBranchDef): CardOffer {
  return {
    kind: 'weapon-branch', id: def.id, title: `${def.name}: ${branch.name}`,
    text: `${sentence(branch.text)} Also ${def.levels[BRANCH_LEVEL - 1]!.text}.`,
    icon: def.icon, rarity: 'epic', level: BRANCH_LEVEL, branch: branch.id,
  };
}

export function overdriveCard(def: WeaponDef): CardOffer {
  return {
    kind: 'weapon-overdrive', id: def.id, title: `${def.overdrive.name} ★`,
    text: `OVERDRIVE ${def.name}: ${sentence(def.overdrive.text)} Also ${def.levels[MAX_WEAPON_LEVEL - 1]!.text}.`,
    icon: def.icon, rarity: 'legendary', level: MAX_WEAPON_LEVEL,
  };
}

export function newWeaponCard(def: WeaponDef): CardOffer {
  return {
    kind: 'new-weapon', id: def.id, title: def.name, text: `New weapon. ${sentence(def.description)} ${sentence(def.levels[0]!.text)}`,
    icon: def.icon, rarity: 'rare', level: 1,
  };
}

/** What a passive rank adds, with Deep Stores' half projectiles spelled out. */
export function passiveGainText(def: PassiveDef, rank: number): string {
  const parts: string[] = [];
  for (const key of Object.keys(def.perRank) as StatKey[]) {
    const v = def.perRank[key];
    if (!v) continue;
    if (key === 'amount' && v < 1) {
      const before = Math.floor((rank - 1) * v + 1e-6), after = Math.floor(rank * v + 1e-6);
      parts.push(after > before ? `+${after - before} projectile${after - before === 1 ? '' : 's'}` : `+1 projectile at rank ${rank + 1}`);
    } else parts.push(statText(key, v));
  }
  return parts.join(', ');
}

function passiveTotalText(def: PassiveDef, rank: number): string {
  const parts: string[] = [];
  for (const key of Object.keys(def.perRank) as StatKey[]) {
    const v = def.perRank[key];
    if (!v) continue;
    if (key === 'amount' && v < 1) {
      const total = Math.floor(rank * v + 1e-6);
      if (total > 0) parts.push(`+${total} projectile${total === 1 ? '' : 's'}`);
    } else parts.push(statText(key, v * rank));
  }
  return parts.join(', ');
}

export function passiveCard(def: PassiveDef, rank: number): CardOffer {
  const isNew = rank <= 1;
  const gain = sentence(passiveGainText(def, rank));
  const text = isNew ? `${gain} ${sentence(def.description)}` : `${gain} Rank ${rank}/${def.maxRank} total: ${passiveTotalText(def, rank)}.`;
  return {
    kind: isNew ? 'new-passive' : 'passive-rank', id: def.id, title: isNew ? def.name : `${def.name} ${ROMAN[rank] ?? rank}`,
    text, icon: def.icon, rarity: isNew ? 'common' : rank >= 4 ? 'rare' : 'common', level: rank,
  };
}

export function chipCard(chip: ChipDef, rarity: Rarity): CardOffer {
  const tier = Math.max(0, RARITY_ORDER.indexOf(rarity));
  const amount = chip.amounts[tier]!;
  return {
    kind: 'chip', id: chipId(chip.stat), title: chip.name, text: `${sentence(statText(chip.stat, amount))} Lasts the whole voyage.`,
    icon: `/assets/icons/${chipId(chip.stat)}.png`, rarity, stat: chip.stat, amount,
  };
}

export function healCard(fraction: number): CardOffer {
  return {
    kind: 'heal', id: 'heal', title: 'Fresh Timber', text: `Repair ${Math.round(fraction * 100)}% of your hull right now.`,
    icon: '/assets/icons/heal.png', rarity: 'common', amount: fraction,
  };
}

export function doubloonCard(amount: number, found = false): CardOffer {
  return {
    kind: 'doubloons', id: 'doubloons', title: found ? 'Doubloons' : 'Hidden Stash',
    text: found ? `+${num(amount, 0)} ◈ found in the chest.` : `+${num(amount, 0)} ◈ doubloons, banked when the voyage ends.`,
    icon: '/assets/icons/doubloon.png', rarity: 'common', amount,
  };
}

/** Rolls a rarity; luck multiplies the weights of rare+ tiers. `floor` = minimum tier index. */
export function rollRarity(random: () => number, luck: number, floor = 0): Rarity {
  let total = 0;
  const mul = 1 + Math.max(0, luck) * RARITY_LUCK_SCALE;
  for (let i = floor; i < RARITY_ORDER.length; i++) total += RARITY_WEIGHTS[RARITY_ORDER[i]!] * (i > 0 ? mul : 1);
  let r = random() * total;
  for (let i = floor; i < RARITY_ORDER.length; i++) {
    r -= RARITY_WEIGHTS[RARITY_ORDER[i]!] * (i > 0 ? mul : 1);
    if (r <= 0) return RARITY_ORDER[i]!;
  }
  return RARITY_ORDER[RARITY_ORDER.length - 1]!;
}

export { CHIPS };
