/**
 * World events (EVENTS-owned): set pieces beyond META's first six, `state.worldEvent` for the HUD tracker, and
 * points of interest. Contract stub. startWorldEvent is the director's fallback for event ids it does not know
 * (return true when handled); updateWorldEvents runs every director tick.
 */
import type { DirectorEventId } from '../content/director';
import type { SimContext } from './context';

export function startWorldEvent(_c: SimContext, _id: DirectorEventId, _minute: number): boolean { return false; }
export function updateWorldEvents(_c: SimContext): void {}
