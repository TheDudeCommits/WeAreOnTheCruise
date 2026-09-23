/**
 * Stable identifiers shared by simulation, rendering, UI, audio and saves.
 * Contract file (owned by the lead): add ids here only through a contract change.
 */

export const SHIP_IDS = ['dawn-ram', 'sunlion', 'yellowfin', 'grand-galley', 'seawarden', 'white-leviathan'] as const;
export type ShipId = (typeof SHIP_IDS)[number];

/** Legacy file names of the downloaded hero models in /assets/sketchfab/<key>.glb (kept for now). */
export type HeroModelKey = 'going-merry' | 'thousand-sunny' | 'polar-tang' | 'baratie' | 'navy-galleon' | 'moby-dick';

export const WEAPON_IDS = [
  'broadside', 'bow-chaser', 'stern-mortar', 'swivel-guns', 'fire-barrels', 'harpoon',
  'rocket-rack', 'storm-rod', 'tide-mines', 'iron-ram', 'escort-skiffs', 'maelstrom-charm',
] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

export const PASSIVE_IDS = [
  'ironwood-hull', 'cloudsilk-sails', 'powder-monkeys', 'master-gunner', 'long-barrels', 'salvage-nets',
  'lucky-doubloon', 'shipwright', 'figurehead-fury', 'weather-eye', 'drill-master', 'deep-stores',
] as const;
export type PassiveId = (typeof PASSIVE_IDS)[number];

export const ENEMY_IDS = [
  'skiff', 'cutter', 'brig', 'fireship', 'mortar-barge', 'frigate', 'man-o-war',
  'corsair-brig', 'corsair-galleon', 'wraith', 'wyrmling', 'fort',
] as const;
export type EnemyId = (typeof ENEMY_IDS)[number];

export const BOSS_IDS = ['iron-warden', 'tidewyrm', 'sovereign'] as const;
export type BossId = (typeof BOSS_IDS)[number];

export const SEA_IDS = ['sunward-shallows', 'stormwrack-reach', 'the-gloam'] as const;
export type SeaId = (typeof SEA_IDS)[number];

export const SPECIAL_IDS = ['second-wind', 'lionburst', 'deep-dive', 'chefs-banquet', 'signal-flare', 'seaquake'] as const;
export type SpecialId = (typeof SPECIAL_IDS)[number];

export const ULTIMATE_IDS = ['ramming-speed', 'sunfire-barrage', 'torpedo-swarm', 'kitchen-inferno', 'admirals-judgment', 'tidal-colossus'] as const;
export type UltimateId = (typeof ULTIMATE_IDS)[number];

export const META_UPGRADE_IDS = ['hull', 'sails', 'powder', 'gunnery', 'salvage', 'fortune', 'wisdom', 'second-wind', 'charts', 'banish'] as const;
export type MetaUpgradeId = (typeof META_UPGRADE_IDS)[number];

export type Faction = 'player' | 'admiralty' | 'corsair' | 'wraith' | 'deep';
export type Team = 'player' | 'enemy';

export type WeatherId = 'clear' | 'breezy' | 'storm' | 'fog';

export type PickupKind = 'xp-copper' | 'xp-silver' | 'xp-gold' | 'doubloon' | 'repair' | 'compass' | 'powder-keg' | 'chest';

export type ProjectileKind =
  | 'cannonball' | 'chain-shot' | 'heavy-shot' | 'chaser-shot' | 'lance'
  | 'mortar-shell' | 'bomblet' | 'swivel-shot' | 'grapeshot' | 'harpoon'
  | 'rocket' | 'torpedo' | 'skiff-shot'
  | 'enemy-cannonball' | 'enemy-chaser' | 'enemy-mortar' | 'water-bolt' | 'boss-shell';

export type HazardKind =
  | 'fire-patch' | 'barrel' | 'powder-keg' | 'mine' | 'whirlpool' | 'storm-cloud'
  | 'shockwave' | 'wave-front' | 'lightning-strike' | 'burning-wreck'
  /** Player summons (Escort Skiffs weapon): positions are updated by the sim; SHIPS renders them as small boats. */
  | 'escort-skiff';

export type StatusKind = 'burning' | 'slowed' | 'stunned' | 'hooked' | 'submerged' | 'shielded' | 'invulnerable' | 'airborne' | 'frenzy';

export type SkillSlot = 'broadside' | 'special' | 'ultimate' | 'brace' | 'boost';

export type WeaponMount = 'broadside' | 'bow' | 'stern' | 'deck' | 'mast' | 'rails' | 'prow' | 'alongside';

export type StatKey =
  | 'maxHp' | 'armor' | 'regen' | 'speed' | 'turn' | 'damage' | 'cooldown' | 'area' | 'range'
  | 'projectileSpeed' | 'duration' | 'amount' | 'crit' | 'critDamage' | 'pickupRadius' | 'xpGain'
  | 'luck' | 'skillCooldown' | 'ramDamage' | 'doubloonGain' | 'revives';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
