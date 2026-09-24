/**
 * Readable, specific card/tooltip text built from the numbers in the content tables (META).
 * Keeping text generated means a re-tune can never leave a card promising the wrong amount.
 */
import type { StatKey } from '../ids';
import type { Stats } from '../types';

/** Rounds to at most `digits` decimals and drops trailing zeros. */
export function num(value: number, digits = 1): string {
  const f = 10 ** digits;
  return String(Math.round(value * f) / f);
}

/** 0.12 → "12%". */
export function pct(value: number): string {
  const v = Math.abs(value) * 100;
  return `${v >= 10 || Number.isInteger(Math.round(v * 10) / 10) ? Math.round(v) : num(v, 1)}%`;
}

/** Text for a stat bonus of `value` (semantics documented in content/passives.ts). */
export function statText(key: StatKey, value: number): string {
  switch (key) {
    case 'maxHp': return `+${pct(value)} max hull`;
    case 'armor': return `+${num(value)} armour`;
    case 'regen': return `repair ${num(value * 100, 2)}% hull per second`;
    case 'speed': return `+${pct(value)} top speed`;
    case 'turn': return `+${pct(value)} turning`;
    case 'damage': return `+${pct(value)} damage`;
    case 'cooldown': return `${pct(value)} faster reloads`;
    case 'area': return `+${pct(value)} area`;
    case 'range': return `+${pct(value)} range`;
    case 'projectileSpeed': return `+${pct(value)} shot speed`;
    case 'duration': return `+${pct(value)} duration`;
    case 'amount': return `+${num(value)} projectile${value === 1 ? '' : 's'}`;
    case 'crit': return `+${pct(value)} critical chance`;
    case 'critDamage': return `+${pct(value)} critical damage`;
    case 'pickupRadius': return `+${pct(value)} treasure pickup radius`;
    case 'xpGain': return `+${pct(value)} experience`;
    case 'luck': return `+${num(value)} luck`;
    case 'skillCooldown': return `${pct(value)} faster skill cooldowns`;
    case 'ramDamage': return `+${pct(value)} ram damage`;
    case 'doubloonGain': return `+${pct(value)} doubloons`;
    case 'revives': return `+${num(value)} revive${value === 1 ? '' : 's'} per run`;
    case 'accel': return `+${pct(value)} acceleration`;
    case 'fullSail': return `+${pct(value)} top speed at full sail`;
    case 'carve': return `${pct(value)} less speed lost in turns`;
    case 'helm': return `+${pct(value)} helm response`;
    case 'surge': return `sinkings surge your speed, up to +${pct(value)}`;
    case 'boostDuration': return `+${pct(value)} boost duration`;
    case 'boostCooldown': return `${pct(value)} faster boost recharge`;
    case 'boostCharges': return `+${num(value)} boost charge${value === 1 ? '' : 's'}`;
  }
}

/** "+12% max hull, +1 armour" for a partial stat block (multiplied by `times`). */
export function statsText(stats: Readonly<Partial<Stats>>, times = 1): string {
  const parts: string[] = [];
  for (const key of Object.keys(stats) as StatKey[]) {
    const value = stats[key];
    if (!value) continue;
    parts.push(statText(key, value * times));
  }
  return parts.join(', ');
}

/** Capitalises the first letter of a sentence fragment. */
export function sentence(text: string): string {
  if (!text) return text;
  const t = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
