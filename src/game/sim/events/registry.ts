/** The set pieces EVENTS runs (the director's fallback for ids it does not handle itself). */
import type { DirectorEventId } from '../../content/director';
import { BLOCKADE } from './blockade';
import { BOUNTY } from './bounty';
import { ERUPTION } from './eruption';
import { GHOST_FLEET } from './ghost-fleet';
import { KRAKEN } from './kraken';
import { MAELSTROM } from './maelstrom';
import { ROGUE_WAVE } from './rogue-wave';
import type { WorldEventHandler } from './runtime';
import { SUNKEN_TREASURE } from './treasure';

export const HANDLERS: Readonly<Partial<Record<DirectorEventId, WorldEventHandler>>> = {
  'kraken-rising': KRAKEN,
  'rogue-wave': ROGUE_WAVE,
  maelstrom: MAELSTROM,
  'admiralty-blockade': BLOCKADE,
  'ghost-fleet': GHOST_FLEET,
  'volcanic-eruption': ERUPTION,
  'sunken-treasure': SUNKEN_TREASURE,
  'bounty-contract': BOUNTY,
};
