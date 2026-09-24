/**
 * AI captains (CAPTAINS-owned). Other captains sailing the same sea: they fill the roster while no live captains are
 * online, fight the fleet, draw part of its fire (see targeting.ts), sink and sail back in. `state.captains` holds
 * them; ids are negative ShipRefs. Contract stub: called once per tick after enemies and bosses.
 */
import type { SimContext } from './context';

export function updateCaptains(_c: SimContext): void {}
