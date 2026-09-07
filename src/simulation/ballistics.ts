import type { AmmoKind, ShipKind, ShipSide, ShipState, Vec3 } from '../core/contracts';
import { getShipSpec } from '../content/shipSpecs';

/** The visible cannon barrels and projectile launch share the same local waterline height. */
export function cannonMuzzleHeight(kind: ShipKind, side: Exclude<ShipSide, 'stern'>): number {
  const spec = getShipSpec(kind);
  return kind === 'polar-tang' ? spec.draft * 0.46 + 1.2 : spec.draft * (side === 'bow' ? 0.63 : 0.61) + 1.65;
}

/** Launch scheduling and water clearance use the same damage-adjusted battery. */
export function cannonVolleyCount(ship: Pick<ShipState, 'kind' | 'damage'>, side: Exclude<ShipSide, 'stern'>): number {
  const spec = getShipSpec(ship.kind);
  const cannons = side === 'bow' ? spec.bowCannons : spec.broadsideCannons;
  return cannons <= 0 ? 0 : Math.min(side === 'bow' ? 3 : 6, Math.max(1, Math.ceil(cannons * (1 - ship.damage.weapons * .72))));
}

export function cannonVolleyOffset(index: number, count: number): number {
  return count <= 1 ? 0 : index / (count - 1) - .5;
}

/** One source for projectile launch and the approximate still-water aiming guide. */
export function sampleCannonTrajectory(ship: ShipState, side: Exclude<ShipSide, 'stern'>, lead = 0, gunOffset = 0, spread = 1, ammo: AmmoKind = ship.weapons.ammo): { position: Vec3; velocity: Vec3; gravity: number; flightTime: number; impact: Vec3 } {
  const spec = getShipSpec(ship.kind);
  const forward = { x: -Math.sin(ship.heading), z: -Math.cos(ship.heading) };
  const starboard = { x: Math.cos(ship.heading), z: -Math.sin(ship.heading) };
  const sideSign = side === 'port' ? -1 : 1;
  const directionX = side === 'bow' ? forward.x + starboard.x * gunOffset * 0.05 : starboard.x * sideSign + forward.x * (gunOffset * 0.11 * spread + Math.tan(Math.max(-0.28, Math.min(0.28, lead))));
  const directionZ = side === 'bow' ? forward.z + starboard.z * gunOffset * 0.05 : starboard.z * sideSign + forward.z * (gunOffset * 0.11 * spread + Math.tan(Math.max(-0.28, Math.min(0.28, lead))));
  const length = Math.hypot(directionX, directionZ);
  const along = side === 'bow' ? spec.length * 0.48 : gunOffset * spec.length * 0.44;
  const lateral = side === 'bow' ? 0 : sideSign * spec.beam * 0.48;
  const launchSpeed = spec.projectileSpeed * (ammo === 'heavy' ? 0.8 : ammo === 'chain' ? 0.86 : 1);
  const muzzleHeight = cannonMuzzleHeight(ship.kind, side);
  const position = { x: ship.position.x + forward.x * along + starboard.x * lateral, y: ship.position.y + muzzleHeight, z: ship.position.z + forward.z * along + starboard.z * lateral };
  const velocity = { x: directionX / length * launchSpeed + forward.x * Math.max(0, ship.speed) * 0.65, y: ammo === 'heavy' ? 6.8 : side === 'bow' ? 10.5 : 8.8, z: directionZ / length * launchSpeed + forward.z * Math.max(0, ship.speed) * 0.65 };
  const gravity = ammo === 'heavy' ? 15 : 12.2;
  const flightTime = (velocity.y + Math.sqrt(velocity.y ** 2 + 2 * gravity * Math.max(0, position.y))) / gravity;
  return { position, velocity, gravity, flightTime, impact: { x: position.x + velocity.x * flightTime, y: 0, z: position.z + velocity.z * flightTime } };
}
