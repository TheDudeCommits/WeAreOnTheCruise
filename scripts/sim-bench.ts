/**
 * Headless sim benchmark (CORE): ms per fixed tick with ~90 live enemies and all 12 weapons at level 6.
 *
 *   npx tsx scripts/sim-bench.ts            # both scenarios
 *   npx tsx scripts/sim-bench.ts --ticks 3600
 *
 * Scenarios
 *  - tanky:  90 enemies with huge HP stay alive, so every weapon fires and hits constantly (worst case for weapons,
 *            projectiles and hazards).
 *  - churn:  normal HP, topped back up to 90 every tick (kills, sinking, pickups, merges, level-ups all in play).
 * Branches alternate A/B across the 12 weapons, then flip, so both branch sets are measured.
 * GC activity during the measured window is reported (a proxy for per-tick allocation pressure).
 */
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { ENEMY_IDS, WEAPON_IDS, type EnemyId } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { Sim } from '../src/game/sim/Sim';
import { IslandField } from '../src/world/IslandField';

const args = process.argv.slice(2);
const ticksArg = args.indexOf('--ticks');
const MEASURE = ticksArg >= 0 ? Number(args[ticksArg + 1]) : 1800;
const WARMUP = 300;
const TARGET_ENEMIES = 90;
const MIX: EnemyId[] = ENEMY_IDS.filter((id) => id !== 'fort');

/** GC entries arrive asynchronously; keep them all and attribute them to measured windows by timestamp. */
const gcEntries: { start: number; duration: number }[] = [];
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) gcEntries.push({ start: e.startTime, duration: e.duration });
});
obs.observe({ entryTypes: ['gc'] });

function setup(seed: string, flip: boolean): Sim {
  const world = new IslandField(seed);
  const sim = new Sim({ seed, shipId: 'sunlion', seaId: 'sunward-shallows', meta: defaultProfile(), world });
  sim.debug.god(true);
  WEAPON_IDS.forEach((id, i) => sim.debug.giveWeapon(id, 6, (i % 2 === 0) !== flip ? 'A' : 'B'));
  sim.setInput({ steer: 0.25 });
  sim.press('gear-up');
  return sim;
}

function topUp(sim: Sim, tanky: boolean): void {
  const s = sim.state;
  let alive = 0;
  for (const e of s.enemies) if (e.life === 'alive') alive++;
  const p = s.player;
  let guard = 0;
  while (alive < TARGET_ENEMIES && guard++ < 40) {
    const a = sim.random() * Math.PI * 2, r = 60 + sim.random() * 200;
    const def = MIX[Math.floor(sim.random() * MIX.length)]!;
    const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
    if (!sim.world.isWater(x, z, 20)) continue;
    const e = sim.spawnEnemy(def, x, z);
    if (e && tanky) { e.hp = 1e9; e.maxHp = 1e9; }
    alive++;
  }
}

function step(sim: Sim, tanky: boolean): void {
  topUp(sim, tanky);
  sim.stepTicks(1);
  while (sim.state.status === 'levelup') sim.chooseCard(0);
  sim.drainEvents();
}

interface Result {
  name: string; mean: number; p50: number; p95: number; p99: number; max: number; proj: number; haz: number; enemies: number;
  pickups: number; gc: number; gcMs: number; kills: number; start: number; end: number;
}

function scenario(name: string, tanky: boolean, flip: boolean): Result {
  const sim = setup(`bench-${name}`, flip);
  for (let i = 0; i < WARMUP; i++) step(sim, tanky);
  const times = new Float64Array(MEASURE);
  let proj = 0, haz = 0, enemies = 0, pickups = 0;
  const kills0 = sim.state.stats.kills;
  const start = performance.now();
  for (let i = 0; i < MEASURE; i++) {
    topUp(sim, tanky);
    const t0 = performance.now();
    sim.stepTicks(1);
    times[i] = performance.now() - t0;
    while (sim.state.status === 'levelup') sim.chooseCard(0);
    sim.drainEvents();
    if (i % 30 === 0) {
      const s = sim.state;
      proj += s.projectiles.filter((x) => x.alive).length;
      haz += s.hazards.filter((x) => x.alive).length;
      enemies += s.enemies.filter((x) => x.life === 'alive').length;
      pickups += s.pickups.filter((x) => x.alive).length;
    }
  }
  const end = performance.now();
  const samples = Math.ceil(MEASURE / 30);
  const sorted = Array.from(times).sort((a, b) => a - b);
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return {
    name, mean, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1]!,
    proj: proj / samples, haz: haz / samples, enemies: enemies / samples, pickups: pickups / samples,
    gc: 0, gcMs: 0, kills: sim.state.stats.kills - kills0, start, end,
  };
}

const results: Result[] = [];
for (const [name, tanky, flip] of [
  ['tanky/A-B', true, false], ['tanky/B-A', true, true], ['churn/A-B', false, false], ['churn/B-A', false, true],
] as const) {
  results.push(scenario(name, tanky, flip));
}
// Let the observer flush, then attribute GC entries to each measured window.
await new Promise((r) => setTimeout(r, 100));
for (const r of results) {
  for (const g of gcEntries) if (g.start >= r.start && g.start <= r.end) { r.gc++; r.gcMs += g.duration; }
}

console.log(`Sim benchmark — ${MEASURE} measured ticks per scenario (after ${WARMUP} warm-up), 12 weapons at ★6, ~${TARGET_ENEMIES} enemies`);
console.log('scenario     mean ms   p50     p95     p99     max    | proj  haz  enemies pickups kills | GCs  GC ms');
for (const r of results) {
  console.log(
    `${r.name.padEnd(12)} ${r.mean.toFixed(3).padStart(7)} ${r.p50.toFixed(3).padStart(7)} ${r.p95.toFixed(3).padStart(7)} ${r.p99.toFixed(3).padStart(7)} ${r.max.toFixed(2).padStart(7)} | ` +
    `${r.proj.toFixed(0).padStart(4)} ${r.haz.toFixed(0).padStart(4)} ${r.enemies.toFixed(0).padStart(7)} ${r.pickups.toFixed(0).padStart(7)} ${String(r.kills).padStart(5)} | ${String(r.gc).padStart(4)} ${r.gcMs.toFixed(1).padStart(6)}`,
  );
}
const worst = Math.max(...results.map((r) => r.mean));
console.log(`worst mean ${worst.toFixed(3)} ms/tick — target < 2 ms: ${worst < 2 ? 'PASS' : 'FAIL'}`);
obs.disconnect();
