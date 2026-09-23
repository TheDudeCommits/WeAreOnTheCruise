/**
 * Sea state over a run (META-owned): time of day, weather schedule and crossfades, plus the gameplay weather:
 * Storm Front (rogue 'wave-front' walls, raised seas) and ambient storm lightning (telegraphed CIRCLE, then a
 * 'lightning-strike' event + hazard that hurts the player AND enemy ships), and the Gloam's Fog Bank.
 */
import { EVENT_TUNING } from '../content/director';
import type { WeatherId } from '../ids';
import type { SimContext, Target } from './context';
import { SCRATCH, metaRuntime } from './meta-runtime';
import { bossDamage } from './meta-spawn';
import { TAU, fwdX, fwdZ, predictPlayer, rand, sideX, sideZ, wrap } from './meta-steer';
import { DIRECTOR } from '../content/director';

const WAVE_SCALE: Record<WeatherId, number> = { clear: 0.8, breezy: 1.1, storm: 1.7, fog: 0.7 };
const WIND: Record<WeatherId, number> = { clear: 0.45, breezy: 0.7, storm: 1, fog: 0.25 };

const STRIKE_TELEGRAPH = 1.3;
const STRIKE_RADIUS = 16;
const STRIKE_DAMAGE = 16;
const STRIKE_ENEMY_DAMAGE = 70;
const strikeScratch: Target[] = [];

export function updateSeaState(c: SimContext): void {
  const s = c.state;
  const sea = c.content.seas[s.seaId];
  const st = s.sea;
  const sc = s.director.scratch;
  st.timeOfDay = (sea.startHour + (s.time / sea.duration) * sea.hoursPerRun) % 24;
  let scheduled: WeatherId = st.weather;
  for (const w of sea.weather) if (s.time >= w.at) scheduled = w.weather;
  if (scheduled !== st.nextWeather) { st.nextWeather = scheduled; st.blend = 0; c.emit({ type: 'weather-changed', weather: scheduled }); }
  if (st.blend < 1) {
    st.blend = Math.min(1, st.blend + c.dt / 6);
    if (st.blend >= 1) st.weather = st.nextWeather;
  }
  const from = st.weather, to = st.nextWeather, k = st.blend;
  st.waveScale = WAVE_SCALE[from] * (1 - k) + WAVE_SCALE[to] * k;
  st.windStrength = WIND[from] * (1 - k) + WIND[to] * k;
  st.fog = (from === 'fog' ? 1 - k : 0) + (to === 'fog' ? k : 0);
  st.rain = (from === 'storm' ? 1 - k : 0) + (to === 'storm' ? k : 0);
  st.windDir = wrap(st.windDir + Math.sin(s.time * 0.013) * c.dt * 0.01);

  // Fog bank (Gloam set piece): fades in over 3 s, out over the last 4 s.
  const fog = sc[SCRATCH.fogBank] ?? 0;
  if (fog > 0) {
    const left = Math.max(0, fog - c.dt);
    sc[SCRATCH.fogBank] = left;
    const total = sc[SCRATCH.fogBankMax] || 30;
    const amount = Math.max(0, Math.min(1, (total - left) / 3, left / 4));
    st.fog = Math.max(st.fog, EVENT_TUNING.fogAmount * amount);
  }

  // Storm front (Stormwrack set piece): heavy seas and frequent lightning for its duration.
  const storm = sc[SCRATCH.stormFront] ?? 0;
  if (storm > 0) {
    sc[SCRATCH.stormFront] = Math.max(0, storm - c.dt);
    st.rain = Math.max(st.rain, 0.85);
    st.waveScale = Math.max(st.waveScale, 1.6);
    st.windStrength = Math.max(st.windStrength, 0.95);
  }

  // Lightning while it storms.
  if ((st.rain > 0.55 || storm > 0) && s.player.alive) {
    const next = sc[SCRATCH.nextStrike] ?? 0;
    if (s.time >= next) {
      sc[SCRATCH.nextStrike] = s.time + (storm > 0 ? rand(c, 1.4, 2.8) : rand(c, 3.5, 7));
      if (next > 0) strikeSomewhere(c);
    }
  }
  resolveStrikes(c);
}

/** Picks a strike point: usually across the player's course (dodgeable), sometimes on an enemy ship. */
function strikeSomewhere(c: SimContext): void {
  const s = c.state;
  if (c.random() < 0.55 || s.enemies.length === 0) {
    const pred = predictPlayer(c, STRIKE_TELEGRAPH, 0.8);
    const a = c.random() * TAU, r = c.random() * 30;
    scheduleStrike(c, pred.x + Math.sin(a) * r, pred.z + Math.cos(a) * r);
    return;
  }
  const e = s.enemies[Math.floor(c.random() * s.enemies.length)]!;
  if (e.life !== 'alive' || e.ai.limbo === 1) return;
  scheduleStrike(c, e.x + rand(c, -8, 8), e.z + rand(c, -8, 8));
}

/** Queues a lightning strike with a CIRCLE telegraph. Returns false when the pool is full. */
export function scheduleStrike(c: SimContext, x: number, z: number, delay = STRIKE_TELEGRAPH, radius = STRIKE_RADIUS): boolean {
  const rt = metaRuntime(c.state, c.content);
  for (const st of rt.strikes) {
    if (st.active) continue;
    st.active = true; st.x = x; st.z = z; st.t = delay; st.radius = radius;
    st.damage = bossDamage(c, STRIKE_DAMAGE);
    st.enemyDamage = STRIKE_ENEMY_DAMAGE * DIRECTOR.hpScale(c.state.director.heat);
    c.addTelegraph({ shape: 'circle', team: 'enemy', x, z, radius, duration: delay });
    return true;
  }
  return false;
}

function resolveStrikes(c: SimContext): void {
  const rt = metaRuntime(c.state, c.content);
  const p = c.state.player;
  for (const st of rt.strikes) {
    if (!st.active) continue;
    st.t -= c.dt;
    if (st.t > 0) continue;
    st.active = false;
    c.state.sea.lightningSerial++;
    c.emit({ type: 'lightning-strike', x: st.x, z: st.z });
    c.emit({ type: 'explosion', x: st.x, z: st.z, radius: st.radius, kind: 'lightning', team: 'enemy' });
    c.spawnHazard({ kind: 'lightning-strike', team: 'enemy', x: st.x, z: st.z, radius: st.radius, ttl: 0.35, damage: 0 });
    if (p.alive && Math.hypot(p.x - st.x, p.z - st.z) <= st.radius + p.radius * 0.5) {
      c.damagePlayer(st.damage, { x: st.x, z: st.z, kind: 'hazard' });
    }
    const near = c.targetsNear(st.x, st.z, st.radius, strikeScratch);
    for (let i = 0; i < near.length; i++) {
      const t = near[i]!;
      if (t.life === 'alive') c.damageTarget(t, 'phase' in t ? st.enemyDamage * 0.5 : st.enemyDamage, { status: { kind: 'stunned', time: 0.6 } });
    }
  }
}

/**
 * A rogue wave: a wall of 'wave-front' hazards `distance` m from the player on heading `from`, sweeping across the
 * player's position at 24 m/s. `width` hazards spaced 30 m apart.
 */
export function spawnRogueWave(c: SimContext, from: number, distance: number, width: number): void {
  const p = c.state.player;
  const cx = p.x + fwdX(from) * distance, cz = p.z + fwdZ(from) * distance;
  const dirX = -fwdX(from), dirZ = -fwdZ(from);
  const speed = 24;
  const ttl = (distance * 2) / speed;
  const damage = bossDamage(c, 12);
  for (let k = 0; k < width; k++) {
    const off = (k - (width - 1) / 2) * 30;
    c.spawnHazard({
      kind: 'wave-front', team: 'enemy', x: cx + sideX(from, 1) * off, z: cz + sideZ(from, 1) * off, radius: 16, ttl,
      damage, tick: 0.8, vx: dirX * speed, vz: dirZ * speed,
    });
  }
}
