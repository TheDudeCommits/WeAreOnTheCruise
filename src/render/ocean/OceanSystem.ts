/**
 * Ocean render system (OCEAN-owned; the RenderSystem + OceanServices surface is contract).
 *
 * Frame flow (GameApp calls update() after the sky wrote ctx.atmosphere):
 *   1. look      — palette/style from atmosphere + sea state (OceanLook)
 *   2. field     — snap the interaction targets to the focus, collect stamps from run state, sim events and
 *                  last frame's OceanServices calls (WakeSystem), then fade/scroll + stamp on the GPU
 *   3. shore     — refine the toroidal shore distance field near islands (budgeted)
 *   4. surface   — upload uniforms; the camera-projected grid is positioned in onBeforeRender
 *
 * heightAt/normalAt sample the same footprint-filtered Gerstner surface the vertex shader draws (visual only;
 * the interaction displacement is not included, so bow waves never lift the ship that makes them).
 * Stamp services are visual only and take effect from the next frame (see docs in the final report / README
 * comments on each method).
 */
import * as THREE from 'three';
import { SHIPS } from '../../game/content';
import type { ShipId } from '../../game/ids';
import { DEFAULT_GERSTNER_WAVES, sampleGerstnerHeight, sampleGerstnerNormal } from '../../core/waves';
import type { FrameContext, OceanServices, QualityTier, RenderHostHandles, RenderSystem } from '../frame';
import { GpuTimer } from './GpuTimer';
import { InteractionField, type FoamCoverageStats, type InteractionSettings } from './InteractionField';
import { OceanLook } from './OceanLook';
import { OceanSurface } from './OceanSurface';
import { createOceanTextures, type OceanTextureSet } from './OceanTextures';
import { ShoreField } from './ShoreField';
import { WakeSystem } from './WakeSystem';

const FIELD: Record<QualityTier, InteractionSettings> = {
  low: { resolution: 512, size: 640 },
  medium: { resolution: 768, size: 720 },
  high: { resolution: 1024, size: 768 },
  ultra: { resolution: 1024, size: 800 },
};

export interface OceanDebugStats {
  particles: number;
  effects: number;
  transientStamps: number;
  persistentStamps: number;
  shoreSettled: boolean;
  quality: QualityTier;
  /** GPU milliseconds (EMA) when timing is enabled: interaction passes and the surface draw. */
  gpu: Record<string, number>;
}

/** QA: what the ocean shader draws, classified per pixel (see screenStats). Fractions of water pixels. */
export interface OceanScreenStats {
  /** Water pixels in the stats view (the ocean alone, main camera, ~1/5 resolution). */
  waterPixels: number;
  /** Visible white foam (> 50%) over all water / inside the disc around the focus. */
  foam: number;
  foamInDisc: number;
  /** Mean foam amount (0..1) inside the disc (partial foam counts partially). */
  foamMeanInDisc: number;
  /** Crest foam (whitecaps / night crest strokes) over all water. */
  crest: number;
  /** Visible glow (≥ 25% of the rim reference) over all water, and its brightest pixel relative to the reference. */
  glow: number;
  glowPeak: number;
  /** Any of foam, crest or glow: the "pattern" share of the water. */
  pattern: number;
  /** Sun/moon highlights (glints + sheen ≥ 25% of the rim reference) and glints alone, over all water. */
  highlight: number;
  glints: number;
  /** Faint highlights (≥ 6% of the rim reference: still obvious on a dark night sea), over all water. */
  highlightFaint: number;
  radius: number;
}

export class OceanSystem implements RenderSystem, OceanServices {
  readonly name = 'ocean';
  private renderer: THREE.WebGLRenderer | null = null;
  private textures: OceanTextureSet | null = null;
  private field: InteractionField | null = null;
  private surface: OceanSurface | null = null;
  private wakes: WakeSystem | null = null;
  private readonly shore = new ShoreField();
  private readonly look = new OceanLook();
  private time = 0;
  private strength = 1;
  private quality: QualityTier = 'high';
  private lastRun: unknown = null;
  private timer: GpuTimer | null = null;
  private focusX = 0;
  private focusZ = 0;
  private statsTarget: THREE.WebGLRenderTarget | null = null;
  private statsPixels: Uint8Array | null = null;

  init(host: RenderHostHandles): void {
    this.renderer = host.renderer;
    this.textures = createOceanTextures(host.renderer);
    this.field = new InteractionField(FIELD[this.quality]);
    this.surface = new OceanSurface(this.textures, this.field, this.shore);
    this.surface.mainCamera = host.camera;
    this.wakes = new WakeSystem(this.field);
    host.scene.add(this.surface.mesh);
    // Warm up every program once (interaction passes now, the surface against the real scene/camera).
    this.field.beginFrame(0, 0);
    this.field.render(host.renderer, 0);
    host.renderer.compile(this.surface.mesh, host.camera, host.scene);
    if (typeof window !== 'undefined') (window as unknown as { __OCEAN__?: OceanSystem }).__OCEAN__ = this;
  }

  /** The surface mesh (for labs/debug). */
  get mesh(): THREE.Mesh | null { return this.surface?.mesh ?? null; }

  update(ctx: FrameContext): void {
    const field = this.field;
    const surface = this.surface;
    const wakes = this.wakes;
    if (!field || !surface || !wakes || !this.renderer) return;
    this.time = ctx.time;
    this.strength = Math.max(0, ctx.sea.waveScale);
    if (ctx.quality !== this.quality) {
      this.quality = ctx.quality;
      surface.setQuality(ctx.quality);
      field.configure(FIELD[ctx.quality]);
    }

    const run = ctx.run;
    if (run !== this.lastRun) {
      // New run (or back to menus): wakes from the previous scene must not linger on the new sea.
      this.lastRun = run;
      wakes.clear();
    }
    const fieldDt = run ? (run.status === 'running' ? ctx.dt * (run.timeScale || 1) : 0) : ctx.dt;

    this.look.update(ctx.atmosphere, ctx.sea);
    this.focusX = ctx.focus.x;
    this.focusZ = ctx.focus.z;
    field.beginFrame(ctx.focus.x, ctx.focus.z);
    field.setHullHole(1.1 + 1.3 * this.strength);
    wakes.begin(fieldDt, ctx.time);
    if (run) {
      wakes.run(run, ctx.events);
    } else if (ctx.menuShip && ctx.menuShip in SHIPS) {
      const def = SHIPS[ctx.menuShip as ShipId];
      const src = wakes.scratch;
      src.key = 0;
      src.x = ctx.focus.x; src.z = ctx.focus.z; src.heading = ctx.focus.heading;
      src.speed = ctx.focus.speed; src.length = def.length; src.beam = def.beam;
      src.contact = 1; src.submerged = 0; src.airborne = 0; src.sink = 0; src.wake = 1; src.serpent = false;
      wakes.source(src);
    }
    wakes.finish();
    this.timer?.poll();
    this.timer?.begin('interaction');
    field.render(this.renderer, fieldDt);
    this.timer?.end('interaction');
    this.shore.update(ctx.world, ctx.focus.x, ctx.focus.z);
    surface.update(ctx.time, this.strength, this.look, field, this.shore, ctx.focus.x, ctx.focus.z);
  }

  // ───────────────────────────── OceanServices ─────────────────────────────

  heightAt(x: number, z: number): number {
    return sampleGerstnerHeight(x, z, this.time, DEFAULT_GERSTNER_WAVES, this.strength, this.surface?.footprintAt(x, z) ?? 0);
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    return sampleGerstnerNormal(x, z, this.time, out, DEFAULT_GERSTNER_WAVES, this.strength, this.surface?.footprintAt(x, z) ?? 0);
  }

  /** Deposits wake foam for a moving source this frame (call every frame while it moves). */
  stampWake(x: number, z: number, dirX: number, dirZ: number, width: number, strength: number): void {
    this.wakes?.wake(x, z, dirX, dirZ, width, strength);
  }

  /** One-shot expanding ring wave with a foam crest, growing to `radius` over ~1.5 s. */
  stampRing(x: number, z: number, radius: number, strength: number): void {
    this.wakes?.ring(x, z, radius, strength);
  }

  /** One-shot persistent foam patch that dissolves over several seconds. */
  stampFoam(x: number, z: number, radius: number, strength: number): void {
    this.wakes?.foam(x, z, radius, strength);
  }

  /** Visual bump (+) or dip (−) that relaxes over ~0.35 s; call every frame to hold it. */
  stampDisplace(x: number, z: number, radius: number, height: number): void {
    this.wakes?.displace(x, z, radius, height);
  }

  // ───────────────────────────── Debug ─────────────────────────────

  /**
   * 0 = off, 1 = transient target, 2 = persistent target (R foam, G aeration, B fresh), 3 = shore field,
   * 4 = foam shapes, 5 = glints/sheen, 6 = coverage sources, 7 = crowding (coverage, saturation, glow).
   */
  setDebugView(mode: number): void {
    if (this.surface) this.surface.uniforms.uDebug!.value = mode;
  }

  /**
   * QA (round 2 acceptance): visible foam coverage in a disc of `radius` metres around the focus (the player in a
   * run), from the field's coverage target: wakes, splashes, kills, FX stamps (not crest whitecaps or coastal surf).
   * Synchronous GPU readback; call it from tools, never per frame. Returns the mean visible fraction (0..1).
   */
  foamCoverage(radius = 150): number {
    return this.foamCoverageStats(radius).total;
  }

  foamCoverageStats(radius = 150): FoamCoverageStats {
    if (!this.field || !this.renderer) return { total: 0, persistent: 0, saturatedCells: 0, radius };
    return this.field.foamCoverage(this.renderer, this.focusX, this.focusZ, radius);
  }

  /**
   * QA: renders the ocean alone from the main camera into a small target with the stats view (surfaceShaders:
   * uDebug 8) and counts pixels: white foam, crest foam and glow as fractions of the water pixels. Measures what the
   * water shader draws (no occlusion by ships, no bloom). `rimReference` is the luminance glow is compared with.
   * Synchronous readback; tools only.
   */
  screenStats(radius = 150, rimReference = 1): OceanScreenStats {
    const out: OceanScreenStats = { waterPixels: 0, foam: 0, foamInDisc: 0, foamMeanInDisc: 0, crest: 0, glow: 0, glowPeak: 0, pattern: 0, highlight: 0, glints: 0, highlightFaint: 0, radius };
    const renderer = this.renderer;
    const surface = this.surface;
    const camera = surface?.mainCamera;
    if (!renderer || !surface || !camera) return out;
    const w = 400, h = 225;
    const target = (this.statsTarget ??= new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false }));
    target.texture.colorSpace = THREE.NoColorSpace;
    const u = surface.uniforms;
    const previousDebug = u.uDebug!.value as number;
    const previousTarget = renderer.getRenderTarget();
    const clear = new THREE.Color();
    renderer.getClearColor(clear);
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    u.uDebug!.value = 8;
    (u.uStats!.value as THREE.Vector4).set(this.focusX, this.focusZ, radius, rimReference);
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(surface.mesh, camera);
      const pixels = (this.statsPixels ??= new Uint8Array(w * h * 4));
      renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
      let water = 0, foam = 0, disc = 0, foamDisc = 0, foamMean = 0, crest = 0, glow = 0, peak = 0, pattern = 0;
      for (let i = 0; i < w * h; i++) {
        const a = pixels[i * 4 + 3]!;
        if (a < 64) continue;
        water++;
        const f = pixels[i * 4]! / 255, c = pixels[i * 4 + 1]! / 255, g = pixels[i * 4 + 2]! / 255;
        const isFoam = f > 0.5, isCrest = c > 0.5, isGlow = g > 0.25;
        if (isFoam) foam++;
        if (isCrest) crest++;
        if (isGlow) glow++;
        if (isFoam || isCrest || isGlow) pattern++;
        if (g > peak) peak = g;
        if (a > 192) { disc++; foamMean += f; if (isFoam) foamDisc++; }
      }
      out.waterPixels = water;
      if (water) { out.foam = foam / water; out.crest = crest / water; out.glow = glow / water; out.pattern = pattern / water; }
      if (disc) { out.foamInDisc = foamDisc / disc; out.foamMeanInDisc = foamMean / disc; }
      out.glowPeak = peak;
      // Second view: highlights.
      u.uDebug!.value = 9;
      renderer.clear(true, true, false);
      renderer.render(surface.mesh, camera);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
      let hl = 0, gl = 0, faint = 0;
      for (let i = 0; i < w * h; i++) {
        if (pixels[i * 4 + 3]! < 64) continue;
        if (pixels[i * 4]! > 64) hl++;
        if (pixels[i * 4]! > 15) faint++;
        if (pixels[i * 4 + 1]! > 64) gl++;
      }
      if (water) { out.highlight = hl / water; out.glints = gl / water; out.highlightFaint = faint / water; }
    } finally {
      u.uDebug!.value = previousDebug;
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clear, clearAlpha);
      renderer.autoClear = autoClear;
    }
    return out;
  }

  /** Debug: measures GPU time of the interaction passes and the surface draw (EXT_disjoint_timer_query_webgl2). */
  enableGpuTiming(on: boolean): boolean {
    const mesh = this.surface?.mesh;
    if (!this.renderer || !mesh) return false;
    if (on && !this.timer) {
      this.timer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
      const timer = this.timer;
      const sync = mesh.onBeforeRender;
      mesh.onBeforeRender = (...args) => { timer.begin('surface'); sync.apply(mesh, args); };
      mesh.onAfterRender = () => { timer.end('surface'); };
    } else if (!on && this.timer) {
      this.timer.dispose();
      this.timer = null;
      mesh.onAfterRender = () => {};
      const surface = this.surface!;
      mesh.onBeforeRender = (_r, _s, camera) => surface.syncCameraPublic(camera);
    }
    return this.timer?.available ?? false;
  }

  resetGpuTiming(): void { this.timer?.reset(); }

  /** Debug: shader cost profiling variants (see OceanSurface.setProfile). */
  setProfile(mode: number): void { this.surface?.setProfile(mode); }

  stats(): OceanDebugStats {
    return {
      gpu: { ...(this.timer?.ms ?? {}) },
      particles: this.wakes?.particleCount ?? 0,
      effects: this.wakes?.effectCount ?? 0,
      transientStamps: this.field?.transientBatch.count ?? 0,
      persistentStamps: this.field?.persistentBatch.count ?? 0,
      shoreSettled: this.shore.settled,
      quality: this.quality,
    };
  }

  dispose(): void {
    this.statsTarget?.dispose();
    this.surface?.mesh.removeFromParent();
    this.surface?.dispose();
    this.field?.dispose();
    this.textures?.dispose();
    this.shore.dispose();
    if (typeof window !== 'undefined') delete (window as unknown as { __OCEAN__?: OceanSystem }).__OCEAN__;
  }
}
