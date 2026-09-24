/**
 * UI-side display tables. Content owns names/descriptions of ships, weapons, passives, seas and upgrades;
 * specials and ultimates have no content table yet, so their display names live here (DESIGN.md §4).
 */
import type { BossId, Faction, MetaUpgradeId, PassiveId, PickupKind, SpecialId, StatKey, UltimateId, WeaponId } from '../../game/ids';
import type { GlyphId } from './icons';

export interface SkillInfo { name: string; text: string; glyph: GlyphId }

export const SPECIALS: Readonly<Record<SpecialId, SkillInfo>> = {
  'second-wind': { name: 'Second Wind', text: 'Repair 30% of your hull and raise a 3 s shield.', glyph: 'wind' },
  lionburst: { name: 'Lionburst', text: 'Leap ~180 m through the air, untouchable, and land in a burning ring.', glyph: 'burst' },
  'deep-dive': { name: 'Deep Dive', text: 'Dive for 3 s: untargetable and faster, then surface in a blast.', glyph: 'dive' },
  'chefs-banquet': { name: "Chef's Banquet", text: 'Repair 20% and send the crew into a 6 s frenzy (+50% fire rate).', glyph: 'pot' },
  'signal-flare': { name: 'Signal Flare', text: 'Call a 12-shell mortar barrage onto the cursor.', glyph: 'flare' },
  seaquake: { name: 'Seaquake', text: 'A 160 m shockwave that damages, knocks back and slows.', glyph: 'quake' },
};

export const ULTIMATES: Readonly<Record<UltimateId, SkillInfo>> = {
  'ramming-speed': { name: 'Ramming Speed', text: '6 s of +80% speed, rams deal ×5 and hurl ships aside.', glyph: 'ram' },
  'sunfire-barrage': { name: 'Sunfire Barrage', text: '8 s of both broadsides firing burning rounds.', glyph: 'sun' },
  'torpedo-swarm': { name: 'Torpedo Swarm', text: 'Twelve homing torpedoes seek the nearest ships.', glyph: 'torpedo' },
  'kitchen-inferno': { name: 'Kitchen Inferno', text: 'A ring of fire barrels and flaming broadsides.', glyph: 'flame' },
  'admirals-judgment': { name: "Admiral's Judgment", text: 'Carpet bombardment along your aim line.', glyph: 'rain' },
  'tidal-colossus': { name: 'Tidal Colossus', text: 'A colossal wave sweeps ~400 m ahead of your bow.', glyph: 'wave' },
};

export const WEAPON_GLYPH: Readonly<Record<WeaponId, GlyphId>> = {
  broadside: 'cannon', 'bow-chaser': 'scope', 'stern-mortar': 'mortar', 'swivel-guns': 'swivel', 'fire-barrels': 'barrel',
  harpoon: 'harpoon', 'rocket-rack': 'rocket', 'storm-rod': 'bolt', 'tide-mines': 'mine', 'iron-ram': 'ram',
  'escort-skiffs': 'skiff', 'maelstrom-charm': 'vortex',
};

export const PASSIVE_GLYPH: Readonly<Record<PassiveId, GlyphId>> = {
  'ironwood-hull': 'shield', 'cloudsilk-sails': 'sail', 'powder-monkeys': 'keg', 'master-gunner': 'crosshair',
  'long-barrels': 'scope', 'salvage-nets': 'magnet', 'lucky-doubloon': 'coin', shipwright: 'hammer',
  'figurehead-fury': 'flame', 'weather-eye': 'eye', 'drill-master': 'clock', 'deep-stores': 'crate',
  'clipper-rigging': 'sail', 'racing-keel': 'wheel', momentum: 'wind', 'trade-winds': 'wind',
};

export const META_GLYPH: Readonly<Record<MetaUpgradeId, GlyphId>> = {
  hull: 'shield', sails: 'sail', powder: 'keg', gunnery: 'clock', salvage: 'magnet', fortune: 'coin',
  wisdom: 'book', 'second-wind': 'wind', charts: 'map', banish: 'spot',
  'copper-sheathing': 'sail', 'storm-sails': 'wind', 'rudder-chains': 'wheel',
};

export const STAT_GLYPH: Readonly<Record<StatKey, GlyphId>> = {
  maxHp: 'shield', armor: 'shield', regen: 'hammer', speed: 'sail', turn: 'wheel', damage: 'crosshair', cooldown: 'clock',
  area: 'quake', range: 'scope', projectileSpeed: 'scope', duration: 'clock', amount: 'crate', crit: 'star',
  critDamage: 'flame', pickupRadius: 'magnet', xpGain: 'eye', luck: 'coin', skillCooldown: 'clock', ramDamage: 'ram',
  doubloonGain: 'coin', revives: 'wind',
};

export const PICKUP_GLYPH: Readonly<Record<PickupKind, GlyphId>> = {
  'xp-copper': 'coin', 'xp-silver': 'coin', 'xp-gold': 'coin', doubloon: 'coin', repair: 'plus', compass: 'compass',
  'powder-keg': 'keg', chest: 'chest',
};

export const STAT_LABEL: Readonly<Record<StatKey, string>> = {
  maxHp: 'Max hull', armor: 'Armour', regen: 'Repair', speed: 'Speed', turn: 'Turning', damage: 'Damage', cooldown: 'Reload',
  area: 'Area', range: 'Range', projectileSpeed: 'Shot speed', duration: 'Duration', amount: 'Projectiles', crit: 'Crit chance',
  critDamage: 'Crit damage', pickupRadius: 'Pickup radius', xpGain: 'Experience', luck: 'Luck', skillCooldown: 'Skill cooldown',
  ramDamage: 'Ram damage', doubloonGain: 'Doubloons', revives: 'Revives',
};

export const GEAR_NAMES = ['ANCHOR', 'HALF SAIL', 'FULL SAIL'] as const;

export const FACTION_COLOR: Readonly<Record<Faction, string>> = {
  player: '#ffcf33', admiralty: '#eef4ff', corsair: '#ff4a3d', wraith: '#3ff5d0', deep: '#c07bff',
};

export const FACTION_EDGE: Readonly<Record<Faction, string>> = {
  player: '#7a4a00', admiralty: '#1d3f8f', corsair: '#3b0808', wraith: '#06413a', deep: '#35105c',
};

export const BOSS_GLYPH: Readonly<Record<BossId, GlyphId>> = { 'iron-warden': 'skull', tidewyrm: 'wave', sovereign: 'crown' };

export const RARITY_LABEL = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' } as const;

export const WEATHER_LABEL: Readonly<Record<string, string>> = { clear: 'Clear', breezy: 'Breezy', storm: 'Storm', fog: 'Fog' };

/** Absolute icon path convention (DESIGN.md §9). */
export const iconPath = (id: string): string => `/assets/icons/${id}.png`;
