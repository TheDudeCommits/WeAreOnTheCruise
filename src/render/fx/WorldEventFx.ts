/**
 * World-event effects (EVENTS-owned): the Kraken's arms breaking the surface, rogue waves, maelstroms, eruptions,
 * points of interest. Contract stub, mounted by FxSystem after the state pass. Build with the shared Kit/Sakuga.
 */
import * as THREE from 'three';
import type { RunState } from '../../game/types';
import type { FrameContext } from '../frame';
import type { FxKit } from './Kit';
import type { Sakuga } from './Sakuga';

export class WorldEventFx {
  readonly group = new THREE.Group();
  constructor(readonly kit: FxKit, readonly sakuga: Sakuga) { this.group.name = 'world-event-fx'; }
  update(_ctx: FrameContext, _run: Readonly<RunState>, _dt: number): void {}
  reset(): void {}
  dispose(): void {}
}
