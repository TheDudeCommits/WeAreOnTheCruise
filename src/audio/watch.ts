/**
 * State-diff cues (AUDIO-owned): round-1 features that change RunState without a SimEvent of their own. Like the
 * router's reroll diff, each frame compares the documented AI scratch keys (ai-foes.ts, affixes.ts, events/kraken.ts)
 * and hazards with the previous frame and reports what changed. Allocation-free per frame except when a new ship or
 * hazard appears (one record each, dropped when it goes).
 *
 *   signal-cutter   flT ≥ 0 → −1           flare bursts over its target ('flare-pop' + 'flare-hang'); markRef 0 → "Marked!"
 *   ironclad        ic 0 → 1                wind-up before the charge ('steam-whistle')
 *   harpooner       tether 0 → 1 / 1 → 0    the line holds the player (rope loop) / snaps ('rope-snap')
 *   lantern-wisp    wl 0 → 1 (lref 0)       latches onto the player ('wisp-latch'; drain hum while latched)
 *   drowned-galleon dg 0 → 1 / 1 → 2        rising groan / breach ('galleon-rise' / 'galleon-breach')
 *   shielded elite  shield > 0 → 0          bubble shatters ('shield-shatter')
 *   vampiric elite  vampT jumps             siphons hull ('vamp-siphon')
 *   kraken arm      kGrab 0 → 1             grabs the player ('kraken-squeeze')
 *   rogue wave      front crosses the ship  crash ('wave-roar')
 *   trade wind      the ship enters a patch  gust ('wind-gust')
 */
import type { EnemyState, RunState } from '../game/types';
import type { CueId } from './generated/cueIds';
import type { PlayOptions } from './types';

export interface WatchHooks {
  play(source: string, cue: CueId, opts?: PlayOptions): void;
  /** A notable moment for the crew barks (barks.ts decides whether anyone shouts). */
  moment(kind: WatchMoment): void;
}

export type WatchMoment = 'marked' | 'tethered' | 'wisps' | 'kraken-grab' | 'galleon-rising' | 'rogue-wave-hit';

interface ShipRec {
  seen: number;
  flT: number;
  ic: number;
  tether: number;
  wl: number;
  dg: number;
  shield: number;
  vampT: number;
  kGrab: number;
}

const newRec = (): ShipRec => ({ seen: 0, flT: -1, ic: 0, tether: 0, wl: 0, dg: -1, shield: 0, vampT: 0, kGrab: 0 });

export class WorldWatch {
  /** 0..1 loop levels for the ambience controller: the harpoon line and the wisps draining the hull. */
  ropeLevel = 0;
  wispLevel = 0;
  private readonly ships = new Map<number, ShipRec>();
  private readonly waveSide = new Map<number, number>();
  private readonly windIn = new Set<number>();
  private frame = 0;
  private lastGust = -10;
  private lastSiphon = -10;
  private lastShatter = -10;
  private lastWhistle = -10;
  private lastMarked = -10;
  /** Positions of galleon breaches this frame: the router skips their generic water blast. */
  readonly breaches: { x: number; z: number }[] = [];

  constructor(private readonly h: WatchHooks) {}

  reset(): void {
    this.ships.clear(); this.waveSide.clear(); this.windIn.clear();
    this.ropeLevel = 0; this.wispLevel = 0; this.breaches.length = 0;
  }

  update(run: Readonly<RunState>, now: number): void {
    this.breaches.length = 0;
    if (run.status !== 'running') return;
    const frame = ++this.frame;
    const p = run.player;
    let rope = 0, wisps = 0;
    for (const e of run.enemies) {
      let rec = this.ships.get(e.id);
      const fresh = !rec;
      if (!rec) { rec = newRec(); this.ships.set(e.id, rec); }
      rec.seen = frame;
      if (fresh) { this.prime(rec, e); continue; }
      const ai = e.ai;
      const alive = e.life === 'alive';
      switch (e.defId) {
        case 'signal-cutter': {
          const flT = ai.flT ?? -1;
          if (rec.flT >= 0 && flT < 0) {
            const at = { x: ai.flX ?? e.x, z: ai.flZ ?? e.z };
            this.h.play('watch', 'flare-pop', at);
            this.h.play('watch', 'flare-hang', { ...at, delay: 0.12 });
            if ((ai.markT ?? 0) > 0 && (ai.markRef ?? 0) === 0 && now - this.lastMarked > 3) {
              this.lastMarked = now;
              this.h.play('watch', 'marked', { x: p.x, z: p.z });
              this.h.moment('marked');
            }
          }
          rec.flT = flT;
          break;
        }
        case 'ironclad': {
          const ic = ai.ic ?? 0;
          if (alive && rec.ic === 0 && ic === 1 && now - this.lastWhistle > 1.5) { this.lastWhistle = now; this.h.play('watch', 'steam-whistle', { x: e.x, z: e.z }); }
          rec.ic = ic;
          break;
        }
        case 'harpooner': {
          const t = ai.tether === 1 && (ai.tetherRef ?? 0) === 0 ? 1 : 0;
          if (rec.tether === 0 && t === 1) this.h.moment('tethered');
          if (rec.tether === 1 && t === 0 && p.alive) this.h.play('watch', 'rope-snap', { x: (p.x + e.x) / 2, z: (p.z + e.z) / 2 });
          rec.tether = t;
          if (t && alive) rope = 1;
          break;
        }
        case 'lantern-wisp': {
          const wl = ai.wl === 1 && (ai.lref ?? 0) === 0 ? 1 : 0;
          if (alive && rec.wl === 0 && wl === 1) { this.h.play('watch', 'wisp-latch', { x: e.x, z: e.z }); this.h.moment('wisps'); }
          rec.wl = wl;
          if (wl && alive) wisps++;
          break;
        }
        case 'drowned-galleon': {
          const dg = ai.dg ?? -1;
          if (rec.dg === 0 && dg === 1) { this.h.play('watch', 'galleon-rise', { x: ai.hx ?? e.x, z: ai.hz ?? e.z }); this.h.moment('galleon-rising'); }
          else if (rec.dg === 1 && dg === 2) { this.h.play('watch', 'galleon-breach', { x: e.x, z: e.z }); this.breaches.push({ x: e.x, z: e.z }); }
          rec.dg = dg;
          break;
        }
        case 'kraken-arm': {
          const g = ai.kGrab === 1 ? 1 : 0;
          if (alive && rec.kGrab === 0 && g === 1) { this.h.play('watch', 'kraken-squeeze', {}); this.h.moment('kraken-grab'); }
          rec.kGrab = g;
          break;
        }
        default:
          break;
      }
      if (e.affixes.length) {
        const shield = ai.shield ?? 0;
        if (alive && rec.shield > 0.5 && shield <= 0 && now - this.lastShatter > 0.25) { this.lastShatter = now; this.h.play('watch', 'shield-shatter', { x: e.x, z: e.z }); }
        rec.shield = shield;
        const vampT = ai.vampT ?? 0;
        if (alive && vampT > rec.vampT + 0.3 && now - this.lastSiphon > 0.8) { this.lastSiphon = now; this.h.play('watch', 'vamp-siphon', { x: e.x, z: e.z }); }
        rec.vampT = vampT;
      }
    }
    for (const [id, rec] of this.ships) if (rec.seen !== frame) this.ships.delete(id);

    // Hazards: the rogue wave's face reaching the ship, the ship sailing into a trade-wind lane.
    let inWind = false;
    for (const hz of run.hazards) {
      if (!hz.alive) continue;
      if (hz.kind === 'rogue-wave') {
        const sp = Math.hypot(hz.vx, hz.vz) || 1;
        const along = ((p.x - hz.x) * hz.vx + (p.z - hz.z) * hz.vz) / sp;
        const lat = Math.abs(((p.x - hz.x) * hz.vz - (p.z - hz.z) * hz.vx) / sp);
        const side = along > 0 ? 1 : -1;
        const prev = this.waveSide.get(hz.id);
        if (prev !== undefined && prev > 0 && side < 0 && lat < hz.radius + 20 && p.alive) {
          this.h.play('watch', 'wave-roar', { gain: 1.2 });
          this.h.moment('rogue-wave-hit');
        }
        this.waveSide.set(hz.id, side);
      } else if (hz.kind === 'trade-wind' && p.alive) {
        const inside = Math.hypot(p.x - hz.x, p.z - hz.z) < hz.radius;
        if (inside) {
          inWind = true;
          if (!this.windIn.has(hz.id) && this.windIn.size === 0 && now - this.lastGust > 6) { this.lastGust = now; this.h.play('watch', 'wind-gust', {}); }
          this.windIn.add(hz.id);
        } else this.windIn.delete(hz.id);
      }
    }
    if (!inWind) this.windIn.clear();
    if (this.waveSide.size > 8) this.waveSide.clear();
    this.ropeLevel = rope;
    this.wispLevel = Math.min(1, wisps * 0.45);
  }

  /** A ship seen for the first time: remember its state without firing cues. */
  private prime(rec: ShipRec, e: EnemyState): void {
    const ai = e.ai;
    rec.flT = ai.flT ?? -1; rec.ic = ai.ic ?? 0; rec.dg = ai.dg ?? -1;
    rec.tether = ai.tether === 1 && (ai.tetherRef ?? 0) === 0 ? 1 : 0;
    rec.wl = ai.wl === 1 && (ai.lref ?? 0) === 0 ? 1 : 0;
    rec.shield = ai.shield ?? 0; rec.vampT = ai.vampT ?? 0; rec.kGrab = ai.kGrab === 1 ? 1 : 0;
  }
}
