/**
 * Smoke coverage governor (round 2 smoke rules). Every third frame it estimates how much of the screen live smoke
 * covers: it replays the cel ring's analytic motion on the CPU for smoke puffs only (inked puffs with a smoke palette
 * and cooling fireballs), projects each solid disc and rasterises it into a 96×54 grid. While the estimate, with the
 * current thinning applied, is above ~6% of the screen, `thin` rises; the cel shader turns it into extra erosion
 * (older and bigger puffs go first), so the fight stays readable through any amount of gunfire. It relaxes again
 * once smoke is back under ~4.5%.
 *
 * The erosion model mirrors CelSprites/SPRITE_VERTEX_GLSL: solid radius ≈ 0.45 × size, and a puff eroded by `e`
 * keeps about (1 − 2.4 e²) of its radius. Allocation-free; about 0.05 ms per run on a busy frame.
 */
import type * as THREE from 'three';
import type { InstancePool } from './core/InstancePool';
import { SPRITE_STRIDE } from './core/SpritePass';

const GW = 96;
const GH = 54;
/** Screen fraction smoke may cover before the governor thins it. */
export const SMOKE_COVERAGE_TARGET = 0.06;
/** Cel palettes treated as smoke: Gunsmoke 0, DarkSmoke 1, Dust 4, Steam 5, WreckSmoke 11. */
const SMOKE_PALS = (1 << 0) | (1 << 1) | (1 << 4) | (1 << 5) | (1 << 11);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class SmokeGovernor {
  /** Current thinning (0..1) fed to uSmokeThin. */
  thin = 0;
  /** Estimated screen fraction covered by smoke with the current thinning. */
  coverage = 0;
  /** The same estimate without thinning (what the rules saved). */
  coverageRaw = 0;
  /** Live smoke puffs in the last estimate. */
  live = 0;
  /** CPU time of the last estimate (ms). */
  ms = 0;
  private readonly grid = new Uint8Array(GW * GH);
  private readonly gridRaw = new Uint8Array(GW * GH);
  private acc = 0;
  private frame = 0;
  /** FX-clock time the last live smoke puff ends, and the ring allocation count at the last scan (skip idle scans). */
  private latestEnd = 0;
  private lastAlloc = -1;

  update(pool: InstancePool, clock: number, camera: THREE.PerspectiveCamera, realDt: number): void {
    this.acc += realDt;
    if (++this.frame % 3 !== 0) return;
    const dt = Math.min(0.25, this.acc);
    this.acc = 0;
    const t0 = performance.now();
    if (pool.allocated === this.lastAlloc && clock > this.latestEnd) {
      // nothing new was emitted and every smoke puff has ended: no scan
      this.coverage = 0; this.coverageRaw = 0; this.live = 0;
    } else {
      this.lastAlloc = pool.allocated;
      this.estimate(pool, clock, camera);
    }
    const over = this.coverage - SMOKE_COVERAGE_TARGET;
    if (over > 0) this.thin = Math.min(1, this.thin + dt * (0.8 + over * 14));
    else if (this.coverage < SMOKE_COVERAGE_TARGET * 0.75) this.thin = Math.max(0, this.thin - dt * 0.5);
    this.ms = performance.now() - t0;
  }

  reset(): void { this.thin = 0; this.coverage = 0; this.coverageRaw = 0; this.live = 0; this.latestEnd = 0; this.lastAlloc = -1; }

  private estimate(pool: InstancePool, clock: number, camera: THREE.PerspectiveCamera): void {
    const d = pool.data;
    const S = SPRITE_STRIDE;
    const grid = this.grid, raw = this.gridRaw;
    grid.fill(0); raw.fill(0);
    // view-projection (camera matrices from the last render; good enough for a coverage estimate)
    const p = camera.projectionMatrix.elements, v = camera.matrixWorldInverse.elements;
    const p00 = p[0]!, p11 = p[5]!, p20 = p[8]!, p21 = p[9]!;
    const thin = this.thin;
    let live = 0;
    let latestEnd = 0;
    for (let i = 0, n = pool.ringCap; i < n; i++) {
      const o = i * S;
      const life = d[o + 7]!;
      if (!(life > 0) || life >= 6) continue;
      const age = clock - d[o + 3]!;
      if (age >= life) continue;
      const shape = d[o + 16]!;
      if (shape !== 7 && !(shape === 0 && (SMOKE_PALS >> d[o + 17]!) & 1)) continue;
      const end = d[o + 3]! + life;
      if (end > latestEnd) latestEnd = end;
      if (age < 0) continue;
      const s1 = d[o + 13]!;
      if (s1 <= 0) continue;
      live++;
      const t = age / life;
      const k = d[o + 11]!;
      let x: number, y: number, z: number;
      if (k > 1e-4) {
        const f = (1 - Math.exp(-k * age)) / k;
        x = d[o]! + d[o + 8]! * age + (d[o + 4]! - d[o + 8]!) * f;
        y = d[o + 1]! + d[o + 9]! * age + (d[o + 5]! - d[o + 9]!) * f;
        z = d[o + 2]! + d[o + 10]! * age + (d[o + 6]! - d[o + 10]!) * f;
      } else {
        x = d[o]! + d[o + 4]! * age + 0.5 * d[o + 8]! * age * age;
        y = d[o + 1]! + d[o + 5]! * age + 0.5 * d[o + 9]! * age * age;
        z = d[o + 2]! + d[o + 6]! * age + 0.5 * d[o + 10]! * age * age;
      }
      // view space
      const vx = v[0]! * x + v[4]! * y + v[8]! * z + v[12]!;
      const vy = v[1]! * x + v[5]! * y + v[9]! * z + v[13]!;
      const vz = v[2]! * x + v[6]! * y + v[10]! * z + v[14]!;
      const w = -vz;
      if (w < 1) continue;
      const cx = (p00 * vx + p20 * vz) / w, cy = (p11 * vy + p21 * vz) / w;
      const grow = 1 - Math.pow(1 - t, Math.max(d[o + 22]!, 0.05));
      const size = d[o + 12]! + (s1 - d[o + 12]!) * grow;
      const ry = (0.45 * size * p11) / w, rx = (0.45 * size * p00) / w;
      if (cx + rx < -1 || cx - rx > 1 || cy + ry < -1 || cy - ry > 1) continue;
      const frac = 0.785 * rx * ry;
      const erode = d[o + 23]!;
      const ageE = Math.min(1, Math.max(0, (t - erode) / Math.max(1e-3, 1 - erode)));
      const cap = smooth(0.02, 0.06, frac) * 0.8;
      const eRaw = Math.max(ageE, cap);
      const eThin = Math.max(eRaw, thin * (0.3 + 0.7 * t) * (0.6 + 0.4 * smooth(0.004, 0.03, frac)));
      const kRaw = Math.max(0, 1 - 2.4 * eRaw * eRaw);
      const kThin = Math.max(0, 1 - 2.4 * eThin * eThin);
      if (kRaw > 0) fill(raw, cx, cy, rx * kRaw, ry * kRaw);
      if (kThin > 0) fill(grid, cx, cy, rx * kThin, ry * kThin);
    }
    let a = 0, b = 0;
    for (let i = 0; i < GW * GH; i++) { a += grid[i]!; b += raw[i]!; }
    this.coverage = a / (GW * GH);
    this.coverageRaw = b / (GW * GH);
    this.live = live;
    this.latestEnd = latestEnd;
  }
}

/** Marks the grid cells whose centres fall inside the NDC ellipse (cx, cy, rx, ry). */
function fill(g: Uint8Array, cx: number, cy: number, rx: number, ry: number): void {
  const gx = (cx * 0.5 + 0.5) * GW, gy = (cy * 0.5 + 0.5) * GH;
  const rgx = rx * 0.5 * GW, rgy = ry * 0.5 * GH;
  if (rgx < 0.25 || rgy < 0.25) return;
  const y0 = Math.max(0, Math.ceil(gy - rgy - 0.5)), y1 = Math.min(GH - 1, Math.floor(gy + rgy - 0.5));
  for (let yy = y0; yy <= y1; yy++) {
    const dy = (yy + 0.5 - gy) / rgy;
    const h = rgx * Math.sqrt(Math.max(0, 1 - dy * dy));
    const x0 = Math.max(0, Math.ceil(gx - h - 0.5)), x1 = Math.min(GW - 1, Math.floor(gx + h - 0.5));
    const row = yy * GW;
    for (let xx = x0; xx <= x1; xx++) g[row + xx] = 1;
  }
}
