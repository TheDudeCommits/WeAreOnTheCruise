/**
 * World-event effects (EVENTS-owned), mounted by FxSystem after the state pass and built on the shared Kit/Sakuga:
 *  - world-events/KrakenFx: the Kraken's arms (CPU-posed toon tentacles, world-events/Tentacles), their slams,
 *    grabs, eruptions, ink and the ring's foam whirl;
 *  - world-events/SeaFx: rogue-wave curls (WaveWalls pass) and the maelstrom spiral (decals + ocean stamps);
 *  - world-events/EruptionFx: the volcano/sea-vent plume and lava/gold bombs in flight;
 *  - world-events/MarksFx: the dig-site beacon, the blockade flagship marker, bounty marks, ghosts surfacing and
 *    the outcome bursts.
 * Draw calls: one tentacle mesh (+ its ink prepass) while arms are up; everything else rides the shared passes.
 */
import * as THREE from 'three';
import type { RunState } from '../../game/types';
import type { FrameContext } from '../frame';
import type { FxKit } from './Kit';
import type { Sakuga } from './Sakuga';
import { EruptionFx } from './world-events/EruptionFx';
import { KrakenFx } from './world-events/KrakenFx';
import { MarksFx } from './world-events/MarksFx';
import { SeaFx } from './world-events/SeaFx';
import { Tentacles } from './world-events/Tentacles';

export class WorldEventFx {
  readonly group = new THREE.Group();
  private readonly tentacles = new Tentacles(20);
  private readonly kraken: KrakenFx;
  private readonly sea: SeaFx;
  private readonly eruption: EruptionFx;
  private readonly marks: MarksFx;

  constructor(readonly kit: FxKit, readonly sakuga: Sakuga) {
    this.group.name = 'world-event-fx';
    this.kraken = new KrakenFx(kit, sakuga, this.tentacles);
    this.sea = new SeaFx(kit, sakuga);
    this.eruption = new EruptionFx(kit, sakuga);
    this.marks = new MarksFx(kit, sakuga);
    this.group.add(this.tentacles.mesh);
  }

  update(ctx: FrameContext, run: Readonly<RunState>, dt: number): void {
    this.tentacles.begin();
    this.sea.beginFrame(dt);
    this.eruption.beginFrame();
    this.kraken.update(run, dt);
    this.eruption.vent(ctx, run, dt);
    const hazards = run.hazards;
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i]!;
      if (!h.alive) continue;
      switch (h.kind) {
        case 'rogue-wave': this.sea.wave(h, dt); break;
        case 'maelstrom': this.sea.maelstrom(h, dt); break;
        case 'lava-bomb': this.eruption.bomb(h, dt); break;
        default: break;
      }
    }
    this.marks.update(run, dt);
    for (let i = 0; i < ctx.events.length; i++) this.marks.onEvent(ctx.events[i]!, run);
    this.sea.endFrame();
    this.eruption.endFrame();
    this.tentacles.end();
  }

  reset(): void {
    this.kraken.reset();
    this.sea.reset();
    this.eruption.reset();
    this.tentacles.begin();
    this.tentacles.end();
  }

  dispose(): void { this.tentacles.dispose(); }
}
