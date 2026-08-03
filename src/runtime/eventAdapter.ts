import type { WorldState } from '../core/contracts';
import type { SimulationEvent } from '../simulation';
import type { PresentationEvent } from '../ui';

export function toPresentationEvents(event: SimulationEvent, state: WorldState): PresentationEvent[] {
  switch (event.type) {
    case 'cannon-fired': {
      const ship = state.ships.find((candidate) => candidate.id === event.shipId);
      return [{
        type: 'cannon-fired', shipId: event.shipId, shipKind: ship?.kind,
        side: event.side, ammo: event.ammo, weight: Math.min(1, event.count / 10 + 0.35),
      }];
    }
    case 'projectile-impact':
      return [
        { type: 'impact', targetId: event.shipId, section: event.side, severity: event.ammo === 'heavy' ? 0.88 : 0.58, material: 'hull' },
        { type: 'damage', targetId: event.shipId, section: event.side, severity: event.ammo === 'chain' ? 0.62 : 0.5 },
      ];
    case 'water-impact':
      return [{ type: 'impact', severity: 0.3, material: 'water' }];
    case 'ram':
      return [{ type: 'impact', targetId: event.targetId, severity: Math.min(1, event.force / 30), material: 'hull' }];
    case 'special': {
      const ship = state.ships.find((candidate) => candidate.id === event.shipId);
      return [{ type: 'special', shipId: event.shipId, shipKind: ship?.kind, phase: 'fire', name: event.name, power: 1 }];
    }
    case 'repair':
      return [{ type: 'repair', phase: 'tick' }];
    case 'checkpoint':
      return event.shipId === state.playerId
        ? [{ type: 'checkpoint', index: event.checkpoint + 1, total: Math.max(1, state.race.checkpoint + 1) }]
        : [];
    case 'race-finished':
      if (event.shipId !== state.playerId) return [];
      return event.placement === 1
        ? [{ type: 'victory', title: 'PIRATE CUP WON!', subtitle: `${event.elapsed.toFixed(2)} seconds · First across the line` }]
        : [{ type: 'defeat', title: `${event.placement} PLACE`, subtitle: 'Catch the next wind and challenge them again' }];
    case 'ship-disabled':
      return event.shipId === state.playerId
        ? [{ type: 'defeat', title: 'SHIP DISABLED', subtitle: 'Assign the crew, patch the hull, and return to the sea' }]
        : [{ type: 'victory', title: 'ENEMY DISABLED', subtitle: 'Their colors are coming down!' }];
  }
}
