/**
 * Combat heat (AUDIO-owned): one 0..1 number for "how hard is the player fighting right now", fed by each frame's
 * RunState and SimEvents. It drives the run music's calm → combat → horde layers (music.ts) and the crew barks.
 *
 * Ingredients (each 0..1, see `parts`):
 *   kills  kills near the player over the last KILL_WINDOW seconds, as kills per minute (30/min ≈ 0.78);
 *   near   threat-weighted enemies within NEAR_RANGE (a skiff 0.45, a frigate 1.7, elites ×2; falls off with distance);
 *   fire   the player's own guns: every weapon-fired shot adds to a leaky meter (auto-fire only runs with a target in range);
 *   hurt   hull taken recently (fraction of max hull, leaky);
 *   event  a dangerous set piece running near the player, elites close by, a hull below a third.
 * The strongest of kills/near/fire sets the base, the other two add a little, hurt and events add on top. The meter
 * rises fast (tau 0.8 s) and falls slowly (tau 4 s). It only moves while the run is 'running'.
 *
 * `lull` counts the seconds since any live enemy was within LULL_RANGE: the music only returns to calm after a real lull.
 */
import type { EnemyId } from '../game/ids';
import type { RunState, SimEvent } from '../game/types';
import { smoothstep } from './spatial';

/** Relative threat of each enemy class. */
export const THREAT: Record<EnemyId, number> = {
  skiff: 0.45, cutter: 0.75, brig: 1, fireship: 1.3, 'mortar-barge': 1.2, frigate: 1.7, 'man-o-war': 2.6,
  'corsair-brig': 1.1, 'corsair-galleon': 2.1, wraith: 1.4, wyrmling: 1, fort: 1.4,
  'signal-cutter': 0.9, ironclad: 1.8, harpooner: 1.2, 'bomb-ketch': 1.3, 'smoke-runner': 0.6, 'lantern-wisp': 0.7,
  'drowned-galleon': 2.2, 'kraken-arm': 1.6,
};

/** Set pieces that raise the heat while the player is near them (by DirectorEventId). */
const EVENT_HEAT: Readonly<Record<string, number>> = {
  'kraken-rising': 0.4, 'admiralty-blockade': 0.35, 'ghost-fleet': 0.35, 'volcanic-eruption': 0.3, maelstrom: 0.25,
  'rogue-wave': 0.2, 'bounty-contract': 0.2, 'treasure-convoy': 0.15, 'sunken-treasure': 0.05,
};

export const KILL_WINDOW = 20;
const KILL_RANGE = 460;
export const NEAR_RANGE = 320;
export const LULL_RANGE = 300;
const MAX_KILLS = 256;

export interface HeatParts { kills: number; near: number; fire: number; hurt: number; event: number; kpm: number; threat: number }

export class CombatHeat {
  /** Smoothed heat 0..1. */
  heat = 0;
  /** Unsmoothed heat of the last update. */
  raw = 0;
  /** Seconds since a live enemy was within LULL_RANGE of the player. */
  lull = 0;
  /** Seconds of running time since reset. */
  clock = 0;
  readonly parts: HeatParts = { kills: 0, near: 0, fire: 0, hurt: 0, event: 0, kpm: 0, threat: 0 };
  /** Ring buffer of kill times (clock seconds) and their weights. */
  private readonly killT = new Float64Array(MAX_KILLS);
  private readonly killW = new Float32Array(MAX_KILLS);
  private killHead = 0;
  private killN = 0;
  private fire = 0;
  private hurt = 0;

  reset(): void {
    this.heat = 0; this.raw = 0; this.lull = 0; this.clock = 0;
    this.killHead = 0; this.killN = 0; this.fire = 0; this.hurt = 0;
    const p = this.parts;
    p.kills = 0; p.near = 0; p.fire = 0; p.hurt = 0; p.event = 0; p.kpm = 0; p.threat = 0;
  }

  /** Advances the meter by one frame (call every frame; it idles unless the run is running). */
  update(run: Readonly<RunState>, events: readonly SimEvent[], dt: number, override: number | null = null): void {
    if (run.status !== 'running') return;
    this.clock += dt;
    const now = this.clock;
    const p = run.player;

    for (const ev of events) {
      switch (ev.type) {
        case 'enemy-killed':
          if (Math.hypot(ev.x - p.x, ev.z - p.z) < KILL_RANGE) this.pushKill(now, ev.elite ? 2 : 1);
          break;
        case 'weapon-fired':
          if (ev.owner === 0) this.fire += 0.03 * Math.min(4, Math.max(1, ev.count));
          break;
        case 'player-hit':
          if (!ev.parried) this.hurt += Math.min(1.2, (ev.amount / Math.max(1, p.maxHp)) * 8);
          break;
        case 'boss-attack':
        case 'telegraph':
          if ('team' in ev && ev.team === 'player') break;
          this.fire += 0.02;
          break;
        default:
          break;
      }
    }
    this.fire *= Math.exp(-dt / 3);
    this.hurt *= Math.exp(-dt / 5);

    // Kills per minute over the window.
    let kills = 0;
    for (let i = 0; i < this.killN; i++) {
      const k = (this.killHead - 1 - i + MAX_KILLS) % MAX_KILLS;
      if (now - this.killT[k]! > KILL_WINDOW) { this.killN = i; break; }
      kills += this.killW[k]!;
    }
    const kpm = (kills * 60) / Math.max(8, Math.min(KILL_WINDOW, now));

    // Threat nearby, elites, the lull clock.
    let threat = 0, elites = 0, any = false;
    for (const e of run.enemies) {
      if (e.life !== 'alive' || e.hidden >= 1) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < LULL_RANGE) any = true;
      if (d > NEAR_RANGE) continue;
      threat += (THREAT[e.defId] ?? 1) * (e.elite ? 2 : 1) * (1 - smoothstep(140, NEAR_RANGE, d));
      if (e.elite && d < 300) elites++;
    }
    for (const b of run.bosses) if (b.life === 'alive' && Math.hypot(b.x - p.x, b.z - p.z) < 600) { threat += 6; any = true; }
    this.lull = any ? 0 : this.lull + dt;

    let event = Math.min(0.3, elites * 0.15);
    const we = run.worldEvent;
    if (we) {
      const base = EVENT_HEAT[we.id] ?? 0.15;
      const far = we.x !== undefined && we.z !== undefined ? Math.hypot(we.x - p.x, we.z - p.z) - (we.radius ?? 0) : 0;
      event += base * (1 - smoothstep(250, 700, far));
    }
    if (p.hp < p.maxHp * 0.33 && threat > 0.5) event += 0.12;

    const kN = 1 - Math.exp(-kpm / 20);
    const nN = 1 - Math.exp(-threat / 4);
    const fN = 1 - Math.exp(-this.fire);
    const hN = 1 - Math.exp(-this.hurt);
    const peak = Math.max(kN, nN, fN);
    const rest = (kN + nN + fN - peak) / 2;
    const raw = Math.min(1, 0.62 * peak + 0.2 * rest + 0.25 * hN + event);
    this.raw = override ?? raw;
    const tau = this.raw > this.heat ? 0.8 : 4;
    this.heat += (this.raw - this.heat) * Math.min(1, dt / tau);

    const q = this.parts;
    q.kills = +kN.toFixed(3); q.near = +nN.toFixed(3); q.fire = +fN.toFixed(3); q.hurt = +hN.toFixed(3); q.event = +event.toFixed(3);
    q.kpm = +kpm.toFixed(1); q.threat = +threat.toFixed(2);
  }

  private pushKill(t: number, w: number): void {
    this.killT[this.killHead] = t;
    this.killW[this.killHead] = w;
    this.killHead = (this.killHead + 1) % MAX_KILLS;
    this.killN = Math.min(MAX_KILLS, this.killN + 1);
  }
}

export type RunLayer = 'calm' | 'combat' | 'horde';

/**
 * Layer choice with hysteresis: going up is quick (the fight is on), going down needs a real lull.
 *   calm → combat   heat ≥ 0.28 for 1.2 s
 *   combat → horde  heat ≥ 0.72 after 3:00 (≥ 0.86 any time) for 3 s, 10 s after the last change
 *   horde → combat  heat < 0.48 for 8 s, 20 s after the last change
 *   combat → calm   heat < 0.15 and no enemy within 300 m for 8 s, 12 s after the last change
 */
export class LayerSelector {
  layer: RunLayer = 'calm';
  /** Seconds since the last layer change. */
  dwell = 0;
  private candidate: RunLayer | null = null;
  private held = 0;

  reset(): void { this.layer = 'calm'; this.dwell = 0; this.candidate = null; this.held = 0; }

  update(h: CombatHeat, runTime: number, dt: number): RunLayer {
    this.dwell += dt;
    const i = h.heat;
    let next: RunLayer = this.layer, hold = 0, minDwell = 0;
    if (this.layer === 'calm') {
      if (i >= 0.28) { next = 'combat'; hold = 1.2; minDwell = 2; }
    } else if (this.layer === 'combat') {
      if (i >= 0.86 || (i >= 0.72 && runTime >= 180)) { next = 'horde'; hold = 3; minDwell = 10; }
      else if (i < 0.15 && h.lull >= 8) { next = 'calm'; hold = 0.5; minDwell = 12; }
    } else if (i < 0.48) { next = 'combat'; hold = 8; minDwell = 20; }
    if (next === this.layer) { this.candidate = null; this.held = 0; return this.layer; }
    if (this.candidate !== next) { this.candidate = next; this.held = 0; }
    this.held += dt;
    if (this.held >= hold && this.dwell >= minDwell) {
      this.layer = next; this.candidate = null; this.held = 0; this.dwell = 0;
    }
    return this.layer;
  }
}
