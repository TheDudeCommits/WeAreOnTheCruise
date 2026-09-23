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
    case 'projectile-impact': {
      if (event.ownerId !== state.playerId && event.shipId !== state.playerId) return [];
      const incoming = event.shipId === state.playerId;
      const weakPoint = event.weakPoint ? `${event.side.toUpperCase()} RELOAD WINDOW` : undefined;
      return [
        {
          type: 'impact', targetId: event.shipId, sourceId: event.ownerId, section: event.side,
          severity: event.ammo === 'heavy' ? 0.88 : 0.58, material: 'hull', incoming,
          critical: event.weakPoint, weakPoint, combo: event.combo,
        },
        {
          type: 'damage', targetId: event.shipId, sourceId: event.ownerId, section: event.side,
          severity: event.ammo === 'chain' ? 0.62 : 0.5, incoming,
          critical: event.weakPoint, weakPoint, combo: event.combo,
        },
      ];
    }
    case 'water-impact':
      return [{ type: 'impact', severity: 0.3, material: 'water' }];
    case 'special-impact':
      return event.ownerId === state.playerId || event.shipId === state.playerId
        ? [{ type: 'impact', targetId: event.shipId, sourceId: event.ownerId, severity: .72, material: 'hull', incoming: event.shipId === state.playerId }]
        : [];
    case 'ram': {
      if (event.attackerId !== state.playerId && event.targetId !== state.playerId) return [];
      return [{
        type: 'impact', targetId: event.targetId, sourceId: event.attackerId,
        severity: Math.min(1, event.force / 30), material: 'hull', incoming: event.targetId === state.playerId,
      }];
    }
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
    case 'ship-disabled': {
      if (event.shipId === state.playerId) {
        return [{ type: 'defeat', title: 'SHIP DISABLED', subtitle: 'Assign the crew, patch the hull, and return to the sea' }];
      }
      const credited = (event.bountyReward ?? 0) > 0 || (event.treasureReward ?? 0) > 0;
      if (!credited) return [];
      return [{
        type: 'victory',
        title: event.surrendered ? 'ENEMY SURRENDERED' : 'ENEMY DISABLED',
        subtitle: event.surrendered ? 'Their colors are down!' : 'Their guns have gone silent!',
      }];
    }
  }
}
