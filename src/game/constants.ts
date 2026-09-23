/** Shared tuning constants (contract; values may be tuned by META through content tables instead). */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;
/** Max fixed steps per rendered frame before dropping time (prevents spiral of death). */
export const MAX_STEPS_PER_FRAME = 8;

export const MAX_WEAPON_SLOTS = 6;
export const MAX_PASSIVE_SLOTS = 6;
export const MAX_WEAPON_LEVEL = 6;
export const BRANCH_LEVEL = 3;

/** Enemy spawn ring (metres from the player). */
export const SPAWN_RING_MIN = 260;
export const SPAWN_RING_MAX = 420;
/** Enemies further than this from the player are recycled/teleported closer by the director. */
export const DESPAWN_RADIUS = 700;

export const SOFT_ENEMY_CAP = 90;
export const PROJECTILE_POOL = 1600;
export const HAZARD_POOL = 256;
export const PICKUP_POOL = 900;
export const TELEGRAPH_POOL = 96;

/** XP required to go from `level` to `level + 1`. */
export const xpToNext = (level: number): number => 6 + 4 * (level - 1);

/** Visual growth tier for a level. */
export const tierForLevel = (level: number): number =>
  level >= 22 ? 4 : level >= 15 ? 3 : level >= 10 ? 2 : level >= 5 ? 1 : 0;

export const META_SAVE_KEY = 'cruise.meta.v2';
export const SETTINGS_KEY = 'cruise.settings.v2';
