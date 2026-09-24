/**
 * Volcanic Eruption visuals (EVENTS): the vent and its bombs.
 *  - Vent (run.worldEvent x/z while 'volcanic-eruption' runs): on a volcanic island the plume stands on the peak
 *    (the island is looked up once per eruption); out at sea a vent boils on the surface. An inked smoke column
 *    leaning with the wind, a lava fountain, embers and a flickering under-glow; launch flashes as bombs leave.
 *  - Bombs ('lava-bomb' hazards, landing at `ttl`): a molten head arcing from the vent to its circle with a smoke
 *    trail (gold bombs: a golden head and sparkles). Lava landings hiss into steam; gold ones burst in glitter.
 */
import type { IslandDef, HazardState, RunState } from '../../../game/types';
import type { FrameContext } from '../../frame';
import { CelPal, GlowPal } from '../core/palette';
import { rand, range, spread } from '../core/rand';
import type { FxKit } from '../Kit';
import { Cel } from '../passes/CelSprites';
import { Decal } from '../passes/Decals';
import { Glow } from '../passes/GlowSprites';
import type { Sakuga } from '../Sakuga';

const BOMBS = 48;

export class EruptionFx {
  private readonly islands: IslandDef[] = [];
  private eventRef: object | null = null;
  private ventX = 0;
  private ventZ = 0;
  private ventY = 0;
  private island = false;
  private active = 0;
  private fountainT = 0;
  // Bomb tracking (landing / launch one-shots).
  private readonly bombId = new Int32Array(BOMBS).fill(-1);
  private readonly bombX = new Float32Array(BOMBS);
  private readonly bombZ = new Float32Array(BOMBS);
  private readonly bombGold = new Uint8Array(BOMBS);
  private readonly bombSeen = new Uint8Array(BOMBS);

  constructor(private readonly k: FxKit, private readonly fx: Sakuga) {}

  reset(): void { this.eventRef = null; this.active = 0; this.bombId.fill(-1); }

  beginFrame(): void { this.bombSeen.fill(0); }

  /** The vent: plume, fountain, glow. */
  vent(ctx: FrameContext, run: Readonly<RunState>, dt: number): void {
    const ev = run.worldEvent;
    const on = !!ev && ev.id === 'volcanic-eruption' && ev.x !== undefined;
    if (on && ev !== this.eventRef) {
      this.eventRef = ev;
      this.ventX = ev.x!; this.ventZ = ev.z!;
      this.island = false; this.ventY = 0;
      for (const isl of ctx.world.islandsNear(this.ventX, this.ventZ, 4, this.islands)) {
        if (isl.biome === 'volcanic' && Math.hypot(isl.x - this.ventX, isl.z - this.ventZ) < 2) { this.island = true; this.ventY = isl.height; }
      }
    }
    // Stays live a few seconds after the last bomb (the mountain settles).
    this.active += ((on && ev!.time < ev!.duration ? 1 : 0) - this.active) * Math.min(1, dt * (on ? 2 : 0.4));
    if (this.active < 0.02) return;
    const k = this.k, fx = this.fx, a = this.active;
    const x = this.ventX, z = this.ventZ;
    const wy = fx.wy(x, z);
    const y = this.island ? this.ventY - 2 : wy + 1;
    const smokeN = Math.round(dt * 16 * k.q * a + rand());
    for (let i = 0; i < smokeN; i++) {
      const c = k.cel.spec.reset();
      const s = this.island ? 1 : 0.7;
      c.at(x + spread(4), y + rand() * 4, z + spread(4)).vel(spread(4), range(16, 26) * s, spread(4))
        .dragTo(0.45, k.windX * 1.6, range(6, 11) * s, k.windZ * 1.6)
        .look(Cel.Puff, rand() < 0.35 ? CelPal.WreckSmoke : CelPal.DarkSmoke).sized(range(7, 11) * s, range(26, 40) * s, 2)
        .rotate(rand() * Math.PI * 2, spread(0.3)).lived(range(4.5, 6.5), 0.45);
      k.cel.emit();
    }
    k.spawned += smokeN;
    // Under-glow of the crater, lighting the smoke from below.
    const flick = 0.75 + 0.25 * Math.sin(k.clock * 13) * Math.sin(k.clock * 7.3);
    const gs = k.glow.spec.reset();
    gs.at(x, y + 6, z).look(Glow.Soft, GlowPal.Explosion).sized(34, 34).lived(10).bright(0.85 * a * flick);
    k.glow.imm(0.02);
    this.fountainT -= dt;
    if (this.fountainT <= 0) {
      this.fountainT = range(0.1, 0.22);
      fx.fireballs(x, y + 2, z, 2, 4.5, 2, 26 * a, 0.9, 0, CelPal.EnemyFire);
      fx.embers(x, y + 6, z, 3, 5);
    }
    if (!this.island) {
      // A sea vent: boiling dome, steam, foam.
      if (rand() < dt * 18 * a) fx.bubbles(x, z, 3, 16, 2.2);
      if (rand() < dt * 4 * a) fx.smoke(x + spread(10), wy + 1, z + spread(10), 1, 6, 18, CelPal.Steam, 2.4, 0, 6, 0, 2, 3, 5, 0, 0.4);
      k.decals.imm(Decal.Glow, x, z, 26, 26, 0, 9, 0, 0xff7a2a, 0, 0xff7a2a, 1.2 * a, 0.5, 0.5);
      k.decals.imm(Decal.Blot, x, z, 22, 22, 0, 0, 0, 0xfff1e0, 0.7 * a, 0xb86d3a, 0, 0.61);
      k.ocean?.stampDisplace(x, z, 16, 1.6 * a);
    }
  }

  /** One bomb in flight (landing circle = the hazard). */
  bomb(h: Readonly<HazardState>, dt: number): void {
    const k = this.k, fx = this.fx;
    const gold = h.team === 'player';
    this.track(h, gold);
    const s = Math.min(1, h.age / Math.max(0.05, h.ttl));
    const ox = this.ventX, oz = this.ventZ;
    const oy = this.island ? this.ventY + 4 : fx.wy(ox, oz) + 3;
    const ty = fx.wy(h.x, h.z);
    const dist = Math.hypot(h.x - ox, h.z - oz);
    const arc = 30 + dist * 0.28;
    const x = ox + (h.x - ox) * s, z = oz + (h.z - oz) * s;
    const y = oy + (ty - oy) * s + arc * 4 * s * (1 - s);
    // Molten head + glow.
    const c = k.cel.spec.reset();
    c.at(x, y, z).look(Cel.Fireball, gold ? CelPal.GoldFire : CelPal.EnemyFire).sized(3.4, 3.4).rotate(k.clock * 6 + h.id).lived(10, 0.2);
    k.cel.imm(0.3);
    const g = k.glow.spec.reset();
    g.at(x, y, z).look(Glow.Soft, gold ? GlowPal.Gold : GlowPal.Explosion).sized(9, 9).lived(10).bright(gold ? 0.9 : 0.75);
    k.glow.imm(0.02);
    // Trail.
    if (rand() < dt * 18 * k.q) {
      if (gold) fx.sparkles(x, y, z, 1, 3, GlowPal.Gold, 0.8);
      else fx.smoke(x, y, z, 1, 1.2, 3.4, CelPal.WreckSmoke, 1.1, 0, 1, 0, 1, 1.5, 0.4, 0, 0.5);
    }
  }

  private track(h: Readonly<HazardState>, gold: boolean): void {
    let slot = -1;
    for (let i = 0; i < BOMBS; i++) if (this.bombId[i] === h.id) { slot = i; break; }
    if (slot < 0) {
      for (let i = 0; i < BOMBS; i++) if (this.bombId[i] === -1) { slot = i; break; }
      if (slot < 0) return;
      this.bombId[slot] = h.id;
      // Launch flash at the vent.
      const oy = this.island ? this.ventY + 2 : this.fx.wy(this.ventX, this.ventZ) + 2;
      this.fx.burst(this.ventX, oy, this.ventZ, gold ? 10 : 8, gold ? GlowPal.Gold : GlowPal.Explosion, 0.08);
    }
    this.bombSeen[slot] = 1;
    this.bombX[slot] = h.x; this.bombZ[slot] = h.z; this.bombGold[slot] = gold ? 1 : 0;
  }

  /** Landings: bombs gone since last frame. */
  endFrame(): void {
    const fx = this.fx;
    for (let i = 0; i < BOMBS; i++) {
      if (this.bombId[i] === -1 || this.bombSeen[i]) continue;
      this.bombId[i] = -1;
      const x = this.bombX[i]!, z = this.bombZ[i]!;
      const wy = fx.wy(x, z);
      if (this.bombGold[i]) {
        fx.sparkles(x, wy + 3, z, 16, 12, GlowPal.Gold, 1.2);
        fx.burst(x, wy + 2, z, 10, GlowPal.Gold, 0.1);
      } else {
        fx.smoke(x, wy + 1, z, 4, 4, 12, CelPal.Steam, 1.8, 0, 6, 0, 3, 2.5, 4, 0.08, 0.35);
      }
    }
  }
}
