/**
 * AI captains' ships (CAPTAINS-owned): hero-class hulls for `run.captains` (negative ids), buoyant, tinted,
 * sinking and sailing back in. Contract stub, mounted by ShipSystem, which routes transform()/anchor() for
 * negative ids here.
 */
import * as THREE from 'three';
import type { CaptainState } from '../../../game/types';
import type { OceanServices, ShipAnchor } from '../../frame';

export class CaptainFleet {
  readonly group = new THREE.Group();
  constructor() { this.group.name = 'captain-fleet'; }
  update(_dt: number, _time: number, _captains: readonly CaptainState[], _ocean: OceanServices): void {}
  has(_id: number): boolean { return false; }
  transform(_id: number, _out: THREE.Matrix4): boolean { return false; }
  anchor(_id: number, _name: ShipAnchor, _out: THREE.Vector3): boolean { return false; }
  dispose(): void {}
}
