import type { ContentDb } from '../types';
import { BOSSES, BOSS_KITS } from './bosses';
import { DIRECTOR, DIRECTOR_EVENTS, EVENT_TUNING, SEA_EVENTS, SPAWN_BANDS } from './director';
import { ENEMIES, ENEMY_AI } from './enemies';
import { PASSIVES } from './passives';
import { SHIPS } from './ships';
import { WEAPONS } from './weapons';
import { META_UPGRADES, SEAS } from './world';

export { BOSSES, BOSS_KITS, DIRECTOR, DIRECTOR_EVENTS, ENEMIES, ENEMY_AI, EVENT_TUNING, META_UPGRADES, PASSIVES, SEA_EVENTS, SEAS, SHIPS, SPAWN_BANDS, WEAPONS };

export const CONTENT: ContentDb = {
  ships: SHIPS,
  weapons: WEAPONS,
  passives: PASSIVES,
  enemies: ENEMIES,
  bosses: BOSSES,
  seas: SEAS,
  metaUpgrades: META_UPGRADES,
};
