import type { WeaponId } from '../ids';
import type { WeaponDef, WeaponLevelDef } from '../types';
import { num, pct } from './text';

/**
 * Weapon tables (META tunes the numbers; CORE implements the behaviours in src/game/sim/weapons*).
 * Level texts are GENERATED from the numbers below so card text always matches the table:
 * level 1 = a stat summary for the "new weapon" card, levels 2–6 = what that level adds.
 * Level 3 is the branch choice (the branch card shows the branch text + the level-3 stat gain);
 * level 6 is the OVERDRIVE ★ (overdrive text + the level-6 stat gain).
 */

type Numbers = Omit<WeaponLevelDef, 'text'>;

const N = (damage: number, cooldown: number, count: number, range: number, more: Partial<Numbers> = {}): Numbers =>
  ({ damage, cooldown, count, range, ...more });

interface TextSpec {
  /** Noun for `count` (singular / plural); empty = count is not shown. */
  one: string;
  many: string;
  /** What `damage` is ("per ball", "per tick"...). */
  hit: string;
  /** Word for the activation rate ("reload", "drops"...). */
  rate: string;
  area?: string;
  duration?: string;
  /** Show range changes (false for drops/contact weapons). */
  range: boolean;
}

const SPEC: Readonly<Record<WeaponId, TextSpec>> = {
  broadside: { one: 'gun per side', many: 'guns per side', hit: 'damage per ball', rate: 'reload', range: true },
  'bow-chaser': { one: 'shot', many: 'shots', hit: 'damage per shot', rate: 'reload', range: true },
  'stern-mortar': { one: 'shell', many: 'shells', hit: 'damage per shell', rate: 'reload', area: 'blast radius', range: true },
  'swivel-guns': { one: 'swivel', many: 'swivels', hit: 'damage per shot', rate: 'fire', range: true },
  'fire-barrels': { one: 'barrel', many: 'barrels', hit: 'burn damage per tick', rate: 'drops', area: 'fire radius', duration: 'burn time', range: false },
  harpoon: { one: 'harpoon', many: 'harpoons', hit: 'damage per harpoon', rate: 'reload', duration: 'slow', range: true },
  'rocket-rack': { one: 'rocket', many: 'rockets', hit: 'damage per rocket', rate: 'reload', area: 'blast radius', range: true },
  'storm-rod': { one: 'ship per strike', many: 'ships per strike', hit: 'damage per jump', rate: 'strikes', range: true },
  'tide-mines': { one: 'mine', many: 'mines', hit: 'damage per mine', rate: 'drops', area: 'blast radius', duration: 'mine life', range: false },
  'iron-ram': { one: '', many: '', hit: 'contact damage', rate: 'rams', range: false },
  'escort-skiffs': { one: 'skiff', many: 'skiffs', hit: 'damage per shot', rate: 'fire', range: true },
  'maelstrom-charm': { one: 'whirlpool', many: 'whirlpools', hit: 'grind damage per tick', rate: 'casts', area: 'whirlpool size', duration: 'duration', range: true },
};

function countText(spec: TextSpec, count: number): string {
  return `${count} ${count === 1 ? spec.one : spec.many}`;
}

/** Level-1 summary: "3 guns per side · 14 damage per ball · every 2.4 s · 150 m range". */
function summary(spec: TextSpec, n: Numbers): string {
  const parts: string[] = [];
  if (spec.one) parts.push(countText(spec, n.count));
  parts.push(`${num(n.damage)} ${spec.hit}`);
  if (n.extra?.ramMultiplier) parts.push(`rams hit ×${num(n.extra.ramMultiplier)}`);
  if (spec.area && n.area) parts.push(`${num(n.area)} m ${spec.area}`);
  if (spec.duration && n.duration) parts.push(`${num(n.duration)} s ${spec.duration}`);
  parts.push(`every ${num(n.cooldown, 2)} s`);
  if (spec.range && n.range > 0) parts.push(`${num(n.range)} m range`);
  return parts.join(' · ');
}

/** What a level adds over the previous one: "+1 gun per side, +14% damage, 7% faster reload". */
function delta(spec: TextSpec, prev: Numbers, cur: Numbers): string {
  const parts: string[] = [];
  const dCount = cur.count - prev.count;
  if (spec.one && dCount > 0) parts.push(`+${dCount} ${dCount === 1 ? spec.one : spec.many}`);
  if (cur.damage > prev.damage * 1.005) parts.push(`+${pct(cur.damage / prev.damage - 1)} damage`);
  const pr = prev.extra?.ramMultiplier ?? 0, cr = cur.extra?.ramMultiplier ?? 0;
  if (cr > pr) parts.push(`rams hit ×${num(cr)}`);
  if (cur.cooldown < prev.cooldown * 0.995) parts.push(`${pct(1 - cur.cooldown / prev.cooldown)} faster ${spec.rate}`);
  if (spec.area && cur.area && prev.area && cur.area > prev.area * 1.005) parts.push(`+${pct(cur.area / prev.area - 1)} ${spec.area}`);
  if (spec.duration && cur.duration && prev.duration && cur.duration > prev.duration + 0.05) parts.push(`+${num(cur.duration - prev.duration)} s ${spec.duration}`);
  if ((cur.pierce ?? 0) > (prev.pierce ?? 0)) parts.push(`+${(cur.pierce ?? 0) - (prev.pierce ?? 0)} pierce`);
  if (spec.range && cur.range > prev.range * 1.025) parts.push(`+${pct(cur.range / prev.range - 1)} range`);
  const pk = prev.extra?.knockback ?? 0, ck = cur.extra?.knockback ?? 0;
  if (ck > pk) parts.push(`+${num(ck - pk)} m knockback`);
  return parts.length ? parts.join(', ') : 'a sturdier mount';
}

function levels(id: WeaponId, table: readonly Numbers[]): WeaponLevelDef[] {
  if (table.length !== 6) throw new Error(`weapon ${id} needs exactly 6 levels`);
  const spec = SPEC[id];
  return table.map((n, i) => ({ ...n, text: i === 0 ? summary(spec, n) : delta(spec, table[i - 1]!, n) }));
}

const icon = (id: WeaponId) => `/assets/icons/${id}.png`;

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  broadside: {
    id: 'broadside', name: 'Broadside Battery', icon: icon('broadside'), mount: 'broadside', tags: ['projectile'],
    description: 'Your gun decks fire on their own whenever an enemy crosses either beam (±40°).',
    levels: levels('broadside', [
      N(14, 2.4, 3, 150, { speed: 95 }),
      N(16, 2.25, 4, 155, { speed: 98 }),
      N(19, 2.1, 4, 160, { speed: 100 }),
      N(22, 1.95, 5, 166, { speed: 102 }),
      N(26, 1.8, 6, 172, { speed: 106 }),
      N(31, 1.6, 7, 180, { speed: 110 }),
    ]),
    branches: [
      { id: 'A', name: 'Chain Shot', text: 'Chain shot: every hit slows the target by 40% for 2 s.' },
      { id: 'B', name: 'Heavy Shot', text: 'Heavy shot: balls pierce 1 extra ship and knock targets back.' },
    ],
    overdrive: { name: 'Rolling Thunder', text: 'Both batteries ripple-fire nonstop at anything abeam.' },
  },
  'bow-chaser': {
    id: 'bow-chaser', name: 'Bow Chaser', icon: icon('bow-chaser'), mount: 'bow', tags: ['projectile'],
    description: 'A long gun in the bow picks off enemies dead ahead (±25°).',
    levels: levels('bow-chaser', [
      N(34, 1.9, 1, 240, { speed: 150 }),
      N(40, 1.75, 1, 250, { speed: 155 }),
      N(45, 1.65, 1, 260, { speed: 160 }),
      N(52, 1.5, 2, 265, { speed: 165 }),
      N(60, 1.4, 2, 275, { speed: 170 }),
      N(72, 1.25, 2, 290, { speed: 180 }),
    ]),
    branches: [
      { id: 'A', name: 'Twin Chasers', text: 'Twin chasers: a second gun fires at a different target.' },
      { id: 'B', name: 'Longtom', text: 'Longtom: shots pierce every ship in their line.' },
    ],
    overdrive: { name: 'Lance of Dawn', text: 'Every volley becomes a searing lance that pierces everything in a line.' },
  },
  'stern-mortar': {
    id: 'stern-mortar', name: 'Stern Mortar', icon: icon('stern-mortar'), mount: 'stern', tags: ['projectile', 'area'],
    description: 'Lobs shells into the thickest knot of enemies 90–260 m away.',
    levels: levels('stern-mortar', [
      N(30, 3.2, 1, 250, { area: 16, speed: 60 }),
      N(34, 3.0, 1, 255, { area: 18, speed: 60 }),
      N(38, 2.9, 2, 260, { area: 18, speed: 62 }),
      N(44, 2.7, 2, 265, { area: 21, speed: 62 }),
      N(50, 2.5, 3, 270, { area: 22, speed: 64 }),
      N(58, 2.2, 3, 280, { area: 25, speed: 66 }),
    ]),
    branches: [
      { id: 'A', name: 'Cluster Shells', text: 'Cluster shells: each shell bursts into 3 bomblets.' },
      { id: 'B', name: 'Firepots', text: 'Firepots: shells leave burning patches on the water.' },
    ],
    overdrive: { name: 'Meteor Rain', text: 'A rain of shells falls all around your ship.' },
  },
  'swivel-guns': {
    id: 'swivel-guns', name: 'Swivel Guns', icon: icon('swivel-guns'), mount: 'rails', tags: ['projectile'],
    description: 'Rail-mounted swivels spray the nearest enemy within 90 m, in any direction.',
    levels: levels('swivel-guns', [
      N(5, 0.32, 1, 90, { speed: 120 }),
      N(6, 0.29, 1, 95, { speed: 124 }),
      N(7, 0.27, 2, 100, { speed: 128 }),
      N(8, 0.25, 2, 106, { speed: 130 }),
      N(9, 0.22, 3, 110, { speed: 134 }),
      N(11, 0.2, 3, 118, { speed: 140 }),
    ]),
    branches: [
      { id: 'A', name: 'Double Swivels', text: 'Double swivels: twice the swivels on your rails.' },
      { id: 'B', name: 'Grapeshot', text: 'Grapeshot: each shot becomes a short-range cone of shot.' },
    ],
    overdrive: { name: 'Hailstorm', text: 'Eight swivels fire in every direction at once.' },
  },
  'fire-barrels': {
    id: 'fire-barrels', name: 'Fire Barrels', icon: icon('fire-barrels'), mount: 'stern', tags: ['drop', 'fire', 'area'],
    description: 'Drops burning barrels in your wake. Pursuers sail into the fire.',
    levels: levels('fire-barrels', [
      N(8, 3.0, 1, 0, { area: 12, duration: 4 }),
      N(10, 2.8, 1, 0, { area: 13, duration: 4.5 }),
      N(11, 2.6, 2, 0, { area: 13, duration: 4.5 }),
      N(13, 2.4, 2, 0, { area: 15, duration: 5 }),
      N(15, 2.2, 3, 0, { area: 16, duration: 5.5 }),
      N(18, 2.0, 3, 0, { area: 18, duration: 6 }),
    ]),
    branches: [
      { id: 'A', name: 'Barrel Chains', text: 'Barrel chains: every drop is a chain of 3 barrels.' },
      { id: 'B', name: 'Powder Kegs', text: 'Powder kegs: barrels explode when an enemy touches them.' },
    ],
    overdrive: { name: 'Sea of Fire', text: 'Your whole wake burns.' },
  },
  harpoon: {
    id: 'harpoon', name: 'Harpoon Gun', icon: icon('harpoon'), mount: 'bow', tags: ['projectile'],
    description: 'Spears an enemy, hauls it toward you and slows it.',
    levels: levels('harpoon', [
      N(24, 2.6, 1, 140, { speed: 110, duration: 2 }),
      N(28, 2.4, 1, 145, { speed: 115, duration: 2.2 }),
      N(32, 2.3, 1, 150, { speed: 118, duration: 2.4 }),
      N(38, 2.1, 2, 155, { speed: 120, duration: 2.6 }),
      N(44, 1.95, 2, 160, { speed: 124, duration: 2.8 }),
      N(52, 1.8, 2, 170, { speed: 130, duration: 3 }),
    ]),
    branches: [
      { id: 'A', name: 'Chain Harpoon', text: 'Chain harpoon: the harpoon chains through 3 ships.' },
      { id: 'B', name: 'Tow Line', text: 'Tow line: hauled ships smash into their neighbours.' },
    ],
    overdrive: { name: 'Leviathan Hook', text: 'A giant hook drags whole groups together.' },
  },
  'rocket-rack': {
    id: 'rocket-rack', name: 'Rocket Rack', icon: icon('rocket-rack'), mount: 'deck', tags: ['projectile', 'area'],
    description: 'A rack of homing signal rockets that seek the nearest ships.',
    levels: levels('rocket-rack', [
      N(12, 3.4, 3, 200, { area: 8, speed: 70 }),
      N(14, 3.2, 4, 205, { area: 8, speed: 72 }),
      N(16, 3.0, 4, 210, { area: 9, speed: 74 }),
      N(18, 2.8, 5, 215, { area: 10, speed: 76 }),
      N(21, 2.6, 6, 220, { area: 10, speed: 78 }),
      N(25, 2.4, 7, 230, { area: 11, speed: 82 }),
    ]),
    branches: [
      { id: 'A', name: 'Swarm', text: 'Swarm: twice the rockets, smaller blasts.' },
      { id: 'B', name: 'Big Bertha', text: 'Big Bertha: fewer, huge rockets with wide blasts.' },
    ],
    overdrive: { name: 'Skyburst', text: 'Rockets burst into a carpet of burning sparks.' },
  },
  'storm-rod': {
    id: 'storm-rod', name: 'Storm Rod', icon: icon('storm-rod'), mount: 'mast', tags: ['lightning'],
    description: 'A copper rod on the mainmast calls lightning that jumps from ship to ship.',
    levels: levels('storm-rod', [
      N(18, 2.8, 3, 130),
      N(21, 2.6, 3, 135),
      N(24, 2.5, 4, 140),
      N(28, 2.3, 5, 145),
      N(32, 2.1, 6, 150),
      N(38, 1.9, 7, 160),
    ]),
    branches: [
      { id: 'A', name: 'Forked', text: 'Forked: every bolt splits into a second chain.' },
      { id: 'B', name: 'Thunderclap', text: 'Thunderclap: the first strike stuns everything around it.' },
    ],
    overdrive: { name: 'Thunderhead', text: 'A storm cloud follows your ship, raining bolts.' },
  },
  'tide-mines': {
    id: 'tide-mines', name: 'Tide Mines', icon: icon('tide-mines'), mount: 'stern', tags: ['drop', 'area'],
    description: 'Drops drifting mines that arm after a moment and burst when ships come near.',
    levels: levels('tide-mines', [
      N(40, 4.0, 1, 0, { area: 18, duration: 12 }),
      N(46, 3.8, 1, 0, { area: 19, duration: 12 }),
      N(50, 3.6, 2, 0, { area: 20, duration: 13 }),
      N(56, 3.4, 2, 0, { area: 23, duration: 13 }),
      N(62, 3.2, 3, 0, { area: 24, duration: 14 }),
      N(72, 3.0, 3, 0, { area: 26, duration: 15 }),
    ]),
    branches: [
      { id: 'A', name: 'Magnet Mines', text: 'Magnet mines: mines drift toward nearby ships.' },
      { id: 'B', name: 'Depth Charges', text: 'Depth charges: huge, slow blasts.' },
    ],
    overdrive: { name: 'Minefield', text: 'Mines seed themselves all around you.' },
  },
  'iron-ram': {
    id: 'iron-ram', name: 'Iron Ram', icon: icon('iron-ram'), mount: 'prow', tags: ['contact'],
    description: 'An iron prow. Ramming hurts them, not you.',
    levels: levels('iron-ram', [
      N(40, 0.6, 1, 0, { extra: { ramMultiplier: 2, knockback: 8 } }),
      N(48, 0.55, 1, 0, { extra: { ramMultiplier: 2.4, knockback: 9 } }),
      N(56, 0.5, 1, 0, { extra: { ramMultiplier: 2.8, knockback: 10 } }),
      N(66, 0.45, 1, 0, { extra: { ramMultiplier: 3.2, knockback: 12 } }),
      N(76, 0.4, 1, 0, { extra: { ramMultiplier: 3.6, knockback: 13 } }),
      N(90, 0.35, 1, 0, { extra: { ramMultiplier: 4.2, knockback: 15 } }),
    ]),
    branches: [
      { id: 'A', name: 'Spiked Hull', text: 'Spiked hull: any ship that touches your hull takes damage.' },
      { id: 'B', name: 'Shockwave Prow', text: 'Shockwave prow: every ram releases a shockwave.' },
    ],
    overdrive: { name: 'Iron Tusk', text: 'Rams heal you and grant a moment of invulnerability.' },
  },
  'escort-skiffs': {
    id: 'escort-skiffs', name: 'Escort Skiffs', icon: icon('escort-skiffs'), mount: 'alongside', tags: ['summon', 'projectile'],
    description: 'Loyal skiffs circle your ship and shoot anything close.',
    levels: levels('escort-skiffs', [
      N(8, 0.9, 2, 110, { speed: 110 }),
      N(10, 0.85, 2, 115, { speed: 112 }),
      N(11, 0.8, 3, 120, { speed: 114 }),
      N(13, 0.75, 3, 125, { speed: 116 }),
      N(15, 0.7, 4, 130, { speed: 118 }),
      N(18, 0.62, 4, 140, { speed: 122 }),
    ]),
    branches: [
      { id: 'A', name: '+2 Skiffs', text: 'Two more skiffs join the escort.' },
      { id: 'B', name: 'Fire Skiffs', text: 'Fire skiffs: skiffs ram enemies and explode, then rejoin.' },
    ],
    overdrive: { name: 'Armada', text: 'A ring of eight escorts sails with you.' },
  },
  'maelstrom-charm': {
    id: 'maelstrom-charm', name: 'Maelstrom Charm', icon: icon('maelstrom-charm'), mount: 'deck', tags: ['area'],
    description: 'A coral charm that opens whirlpools under enemy clusters; they pull ships in and grind them.',
    levels: levels('maelstrom-charm', [
      N(6, 6.0, 1, 200, { area: 28, duration: 4 }),
      N(7, 5.6, 1, 205, { area: 30, duration: 4.5 }),
      N(8, 5.3, 1, 210, { area: 32, duration: 5 }),
      N(9, 5.0, 2, 215, { area: 34, duration: 5 }),
      N(11, 4.6, 2, 220, { area: 37, duration: 5.5 }),
      N(13, 4.2, 2, 230, { area: 40, duration: 6 }),
    ]),
    branches: [
      { id: 'A', name: 'Twin Vortex', text: 'Twin vortex: two whirlpools open at once.' },
      { id: 'B', name: 'Riptide', text: 'Riptide: bigger, longer-lasting whirlpools.' },
    ],
    overdrive: { name: 'Maelstrom', text: 'A vast maelstrom follows your ship.' },
  },
};
