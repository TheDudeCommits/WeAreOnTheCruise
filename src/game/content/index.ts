import type { ContentDb } from '../types';
import { BOSSES, ENEMIES } from './enemies';
import { PASSIVES } from './passives';
import { SHIPS } from './ships';
import { WEAPONS } from './weapons';
import { META_UPGRADES, SEAS } from './world';

export { BOSSES, ENEMIES, META_UPGRADES, PASSIVES, SEAS, SHIPS, WEAPONS };

export const CONTENT: ContentDb = {
  ships: SHIPS,
  weapons: WEAPONS,
  passives: PASSIVES,
  enemies: ENEMIES,
  bosses: BOSSES,
  seas: SEAS,
  metaUpgrades: META_UPGRADES,
};
