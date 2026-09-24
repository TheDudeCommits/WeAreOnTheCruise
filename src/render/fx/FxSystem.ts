/**
 * Effects (FX-owned; RenderSystem surface is contract): projectiles, pickups, hazards, telegraph decals,
 * explosions, muzzle flashes, splashes, smoke, fire, debris, lightning, damage numbers — everything driven by
 * RunState + SimEvents, in the Grand Line Cel "sakuga" language (see Sakuga.ts).
 *
 * Draw calls (all instanced, pooled buffers, no per-frame allocations):
 *   cel sprites · glow sprites · projectile heads · trails · beams · ropes · water decals · damage numbers ·
 *   wave walls · debris planks · 6 prop meshes (coins, bars, crates, chests, barrels, mines)  = 16
 *
 * The FX clock follows the sim: it runs with run.timeScale (slow-mo/hit-stop), freezes while paused or on the
 * level-up screen, and runs in real time after victory/defeat so finales play out.
 */
import * as THREE from 'three';
import type { RunState } from '../../game/types';
import type { FrameContext, QualityTier, RenderHostHandles, RenderSystem } from '../frame';
import { createSharedUniforms, type FxSharedUniforms } from './core/glsl';
import { WaterSampler } from './core/water';
import type { SpritePass } from './core/SpritePass';
import { EventFx } from './EventFx';
import { Flotsam } from './Flotsam';
import { Juice } from './Juice';
import type { FxKit } from './Kit';
import { BeamPass } from './passes/Beams';
import { createCelSprites } from './passes/CelSprites';
import { DamageNumbers } from './passes/DamageNumbers';
import { DebrisPass } from './passes/Debris';
import { DecalPass } from './passes/Decals';
import { createGlowSprites } from './passes/GlowSprites';
import { createHeads } from './passes/Heads';
import { PropPass } from './passes/Props';
import { RopePass } from './passes/Ropes';
import { TrailPass } from './passes/Trails';
import { WaveWallPass } from './passes/WaveWalls';
import { Sakuga } from './Sakuga';
import { StateFx } from './StateFx';
import { WorldEventFx } from './WorldEventFx';
import { FoeFx } from './FoeFx';

const QUALITY_SCALE: Record<QualityTier, number> = { low: 0.5, medium: 0.75, high: 1, ultra: 1.2 };

export interface FxStats {
  cel: number; glow: number; heads: number; trails: number; beams: number; decals: number; debris: number;
  numbers: number; clock: number; spawned: number;
  /** CPU time of the last update (ms) and an exponential average. */
  updateMs: number; updateAvgMs: number; updateMaxMs: number;
  /** Load-shedding multiplier (1 = full detail). */
  pressure: number;
}

export class FxSystem implements RenderSystem {
  readonly name = 'fx';
  readonly group = new THREE.Group();
  readonly shared: FxSharedUniforms = createSharedUniforms();
  readonly juice = new Juice();
  readonly kit: FxKit;
  readonly sakuga: Sakuga;
  readonly worldEvents: WorldEventFx;
  /** Round-1 foes (FOES): harpoon lines, kegs, smoke screens, wisps, flares, affix dressing. */
  readonly foes: FoeFx;
  readonly events: EventFx;
  readonly state: StateFx;
  private readonly passes: SpritePass[];
  private camera: THREE.PerspectiveCamera | null = null;
  private scene: THREE.Scene | null = null;
  private lastRun: Readonly<RunState> | null = null;
  private clock = 0;
  private readonly sunView = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly waterHeight = (x: number, z: number): number => this.kit.water.height(x, z);
  // Ring-pressure load shedding: when spawn rates would recycle live smoke before it finishes, scale counts down.
  private lastAllocCel = 0;
  private lastAllocGlow = 0;
  private rateCel = 0;
  private rateGlow = 0;
  private pressure = 1;
  readonly stats: FxStats = {
    cel: 0, glow: 0, heads: 0, trails: 0, beams: 0, decals: 0, debris: 0, numbers: 0, clock: 0, spawned: 0,
    updateMs: 0, updateAvgMs: 0, updateMaxMs: 0, pressure: 1,
  };

  constructor() {
    const s = this.shared;
    const cel = createCelSprites(s, 16384, 3072);
    const glow = createGlowSprites(s, 12288, 4096);
    const heads = createHeads(s, 2048);
    const trails = new TrailPass(s, 2560);
    const beams = new BeamPass(s, 2048, 256);
    const ropes = new RopePass(s, 96);
    const decals = new DecalPass(s, 768, 384);
    const debris = new DebrisPass(700, 160);
    const props = new PropPass({ 0: 1024, 1: 256, 2: 64, 3: 48, 4: 192, 5: 160 });
    const numbers = new DamageNumbers(s);
    const walls = new WaveWallPass(s, 8);
    this.passes = [cel, glow, heads];
    this.kit = {
      cel, glow, heads, trails, beams, ropes, decals, debris, props, numbers, walls, juice: this.juice, flotsam: new Flotsam(),
      water: new WaterSampler(), ocean: null, ships: null, camX: 0, camY: 100, camZ: 0, focusX: 0, focusZ: 0, windX: 0, windZ: 0, clock: 0, q: 1, spawned: 0,
    };
    this.sakuga = new Sakuga(this.kit);
    this.worldEvents = new WorldEventFx(this.kit, this.sakuga);
    this.foes = new FoeFx(this.kit, this.sakuga);
    this.events = new EventFx(this.kit, this.sakuga);
    this.state = new StateFx(this.kit, this.sakuga, this.events);
    debris.splash = (x, z, size) => this.sakuga.plop(x, z, size);
    this.group.name = 'fx';
    this.group.add(decals.mesh, cel.mesh, heads.mesh, trails.mesh, glow.mesh, beams.mesh, ropes.mesh, walls.mesh, debris.mesh, props.group, numbers.mesh, this.worldEvents.group);
  }

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.camera = host.camera;
    host.scene.add(this.group);
    // QA handle (dev builds only): FX counters and timings for scripts/perf probes.
    if (import.meta.env.DEV) (globalThis as { __CRUISE_FX__?: FxSystem }).__CRUISE_FX__ = this;
  }

  update(ctx: FrameContext): void {
    const t0 = performance.now();
    const run = ctx.run;
    const k = this.kit;
    if (run !== this.lastRun) {
      if (run && this.lastRun && run.seed !== this.lastRun.seed) this.reset();
      else if (run && !this.lastRun) this.reset();
      this.lastRun = run;
    }
    // Clock: sim-synced (slow-mo, pause), real-time for finales and menus.
    let scale = 1;
    if (run) {
      if (run.status === 'running') scale = run.timeScale;
      else if (run.status === 'victory' || run.status === 'dead') scale = 1;
      else scale = 0;
    }
    const dt = Math.min(0.1, ctx.dt) * scale;
    this.clock += dt;
    k.clock = this.clock;
    k.ocean = ctx.services.ocean;
    k.ships = ctx.services.ships;
    k.focusX = ctx.focus.x;
    k.focusZ = ctx.focus.z;
    if (this.camera) { k.camX = this.camera.position.x; k.camY = this.camera.position.y; k.camZ = this.camera.position.z; }
    k.water.sync(ctx.time, ctx.sea.waveScale, ctx.services.ocean, ctx.focus.x, ctx.focus.z);
    const wind = 2 + ctx.sea.windStrength * 5;
    k.windX = Math.sin(ctx.sea.windDir) * wind;
    k.windZ = Math.cos(ctx.sea.windDir) * wind;
    k.q = (QUALITY_SCALE[ctx.quality] ?? 1) * this.pressure;
    k.spawned = 0;
    this.updateUniforms(ctx);

    for (const p of this.passes) p.beginFrame(this.clock);
    k.trails.beginFrame();
    k.beams.beginFrame(this.clock);
    k.ropes.beginFrame();
    k.decals.beginFrame(this.clock);
    k.props.beginFrame();
    k.walls.beginFrame();
    k.debris.beginFrame();
    k.decals.setWaves(ctx.time, ctx.sea.waveScale);
    k.numbers.enabled = ctx.settings.damageNumbers;

    this.events.tick(dt);
    if (run) {
      this.events.process(ctx, run);
      this.state.render(ctx, run, dt);
      this.worldEvents.update(ctx, run, dt);
      this.foes.update(ctx, run, dt);
    }
    k.debris.update(dt, this.waterHeight, ctx.time);
    k.flotsam.update(dt, this.clock, k.water, k.props);
    const glyphPx = Math.max(22, Math.min(40, ctx.viewport.height * 0.03));
    k.numbers.update(dt, this.clock, glyphPx);

    for (const p of this.passes) p.endFrame();
    k.trails.endFrame();
    k.beams.endFrame();
    k.ropes.endFrame();
    k.decals.endFrame();
    k.props.endFrame();
    k.walls.endFrame();
    k.debris.endFrame();
    this.juice.flush(ctx.services, ctx.dt);
    this.updatePressure(ctx.dt);

    const st = this.stats;
    st.clock = this.clock; st.spawned = k.spawned;
    st.cel = k.cel.pool.immediateCount; st.glow = k.glow.pool.immediateCount; st.heads = k.heads.pool.immediateCount;
    st.trails = k.trails.pool.immediateCount; st.beams = k.beams.pool.immediateCount; st.decals = k.decals.pool.immediateCount;
    st.debris = k.debris.active; st.numbers = k.flotsam.active;
    const ms = performance.now() - t0;
    st.updateMs = ms;
    st.updateAvgMs += (ms - st.updateAvgMs) * 0.05;
    st.updateMaxMs = Math.max(st.updateMaxMs * 0.995, ms);
  }

  /** Keeps the average particle life (~2 s smoke) inside the ring capacity. */
  private updatePressure(realDt: number): void {
    const k = this.kit;
    const dCel = k.cel.pool.allocated - this.lastAllocCel;
    const dGlow = k.glow.pool.allocated - this.lastAllocGlow;
    this.lastAllocCel = k.cel.pool.allocated;
    this.lastAllocGlow = k.glow.pool.allocated;
    const dt = Math.max(1 / 240, realDt);
    const a = 1 - Math.exp(-dt * 3);
    this.rateCel += (dCel / dt - this.rateCel) * a;
    this.rateGlow += (dGlow / dt - this.rateGlow) * a;
    const celOk = k.cel.pool.ringCap / Math.max(1, this.rateCel * 2.2);
    const glowOk = k.glow.pool.ringCap / Math.max(1, this.rateGlow * 1.2);
    const target = Math.max(0.3, Math.min(1, celOk, glowOk));
    this.pressure += (target - this.pressure) * (target < this.pressure ? 0.5 : 0.05);
    this.stats.pressure = this.pressure;
  }

  private updateUniforms(ctx: FrameContext): void {
    const u = this.shared;
    const a = ctx.atmosphere;
    u.uTime.value = this.clock;
    u.uRealTime.value = ctx.time;
    u.uFogColor.value.copy(a.fogColor);
    u.uFogRange.value.set(a.fogNear, a.fogFar);
    u.uViewport.value.set(ctx.viewport.width, ctx.viewport.height);
    u.uFlash.value = a.flash;
    u.uFocus.value.set(ctx.focus.x, this.kit.water.height(ctx.focus.x, ctx.focus.z) + 5, ctx.focus.z);
    const cam = this.camera;
    if (cam) {
      u.uPixelWorld.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5)) / Math.max(1, ctx.viewport.height);
      this.sunView.copy(a.sunDirection).transformDirection(cam.matrixWorldInverse);
      u.uSunView.value.copy(this.sunView);
    }
    // Cel lighting tints: warm lit side, cool violet shadows; darker at night and in storms.
    const light = THREE.MathUtils.clamp(0.32 + (a.sunIntensity / 2.2) * 0.68, 0.3, 1.08) * (1 - a.storm * 0.25);
    const lit = u.uLitTint.value;
    lit.setRGB(1, 1, 1).lerp(this.tmpColor.copy(a.sunColor), 0.28).multiplyScalar(light);
    const shade = u.uShadeTint.value;
    shade.setRGB(0.86, 0.9, 1.08).lerp(this.tmpColor.copy(a.ambientColor), 0.18).multiplyScalar(Math.max(0.42, light * 0.95));
    if (a.night > 0) {
      lit.lerp(this.tmpColor.setRGB(0.45, 0.52, 0.78), a.night * 0.7);
      shade.lerp(this.tmpColor.setRGB(0.26, 0.3, 0.5), a.night * 0.7);
    }
  }

  /** Clears every live effect (new run, lab reset). */
  reset(): void {
    for (const p of this.passes) p.clear();
    this.kit.beams.clear();
    this.kit.decals.clear();
    this.kit.debris.clear();
    this.kit.flotsam.clear();
    this.kit.numbers.clear();
    this.events.reset();
    this.state.reset();
    this.worldEvents.reset();
    this.foes.reset();
  }

  dispose(): void {
    this.scene?.remove(this.group);
    for (const p of this.passes) p.dispose();
    this.worldEvents.dispose();
    const k = this.kit;
    k.trails.dispose(); k.beams.dispose(); k.ropes.dispose(); k.decals.dispose(); k.debris.dispose(); k.props.dispose();
    k.numbers.dispose(); k.walls.dispose();
  }
}
