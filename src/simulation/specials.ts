import type { ShipState } from '../core/contracts';

export const MOBY_PRESSURE_RADIUS = 135;
export const MOBY_PRESSURE_DURATION = 1.8;
export const POLAR_DIVE_DEPTH = 17;

export function pressureWaveRadius(elapsed: number): number {
  return MOBY_PRESSURE_RADIUS * Math.max(0, Math.min(1, elapsed / MOBY_PRESSURE_DURATION));
}

/** A physical buoyancy target, also consumed by surface-effect presentation. */
export function polarDiveDepth(ship: ShipState): number {
  if (ship.kind !== 'polar-tang' || !ship.specialPhase || ship.surrendered) return 0;
  const phase = ship.specialPhase;
  const smooth = (x: number) => { const p = Math.max(0, Math.min(1, x)); return p * p * (3 - 2 * p); };
  if (phase.phase === 'active') return POLAR_DIVE_DEPTH * smooth(phase.elapsed / .45);
  if (phase.phase === 'recovery') return POLAR_DIVE_DEPTH * (1 - smooth(phase.elapsed / phase.duration));
  return 0;
}

export function polarWeaponsLocked(ship: ShipState): boolean {
  const phase = ship.specialPhase;
  return ship.kind === 'polar-tang' && Boolean(phase && (phase.phase === 'active' || phase.phase === 'recovery'));
}

/** Outside crew shelters before the dive and returns after physical recovery. */
export function polarCrewSheltered(ship: ShipState): boolean {
  const phase = ship.specialPhase;
  return ship.kind === 'polar-tang' && Boolean(phase
    && (phase.phase !== 'windup' || phase.elapsed > phase.duration * .5));
}
