/**
 * Renderer host (LOOK-owned): the WebGL2 renderer, scene and camera, quality tiers, GPU timing and adaptive DPR.
 *
 * The canvas itself only ever receives the post stack's final full-screen composite (MSAA happens on the HDR target
 * inside PostStack), so the context is created without antialiasing. Shadow maps are updated only by the post stack's
 * colour pass (autoUpdate off), never by the ink prepass or other agents' utility renders.
 *
 * Adaptive DPR steps both ways from frame intervals alone: it steps down when the display misses frames, and after a
 * stable stretch it probes one step up and reverts (with doubling back-off) if frames start missing — the only way to
 * find headroom on a 60 Hz display where intervals never drop below 16.7 ms. EXT_disjoint_timer_query_webgl2 is read
 * for diagnostics only: on Chrome/ANGLE-Metal its TIME_ELAPSED results include scheduling gaps and cannot drive DPR.
 */
import * as THREE from 'three';
import type { QualityTier } from '../frame';
import { qualityProfile, type QualityProfile } from './quality';

export interface RenderMetrics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  dpr: number;
  /**
   * Diagnostic GPU frame time (ms, p50) from EXT_disjoint_timer_query_webgl2, else null. Approximate on
   * ANGLE/Metal (includes scheduling gaps); use benchmark() for headroom.
   */
  gpuMs: number | null;
  /** Share of recent frames that missed a display refresh (the adaptive DPR signal). */
  missRate: number;
  /** p90 frame interval (ms). */
  frameP90: number;
  tier: QualityTier;
  dprRange: [number, number];
  width: number;
  height: number;
}

const hosts = new WeakMap<THREE.WebGLRenderer, RendererHost>();
/** The host that owns a renderer (PostStack uses this to apply quality tiers). */
export function hostFor(renderer: THREE.WebGLRenderer): RendererHost | undefined { return hosts.get(renderer); }

/**
 * PERF: shadow-only proxies. An object on this layer (and only this layer) is skipped by every camera pass — the ink
 * prepass and the colour pass — but drawn into the shadow map, because the host enables the layer on the view camera
 * only while three renders the shadow map (after the colour pass has built its render list). Cheap caster stand-ins
 * (a clustered hero hull, low-poly tree crowns) use it while the detailed meshes stop casting.
 */
export const SHADOW_PROXY_LAYER = 1;

/** Turns `object` into a shadow-only caster (no colour, no ink, no occlusion). Children are not changed. */
export function makeShadowProxy(object: THREE.Object3D): void {
  object.layers.set(SHADOW_PROXY_LAYER);
  object.castShadow = true;
  object.receiveShadow = false;
  object.userData.inkSkip = true;
  object.userData.shadowProxy = true;
}

/**
 * GPU frame timing with sequential (never nested) TIME_ELAPSED queries: one per labelled pass, summed per frame.
 * `samples` holds per-frame totals (ms); `passes` holds a smoothed time per label.
 */
class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: { query: WebGLQuery; label: string; frame: number }[] = [];
  private active: { query: WebGLQuery; label: string } | null = null;
  private frame = 0;
  private sumFrame = -1;
  private sum = 0;
  private skipFrame = false;
  readonly samples: number[] = [];
  readonly passes = new Map<string, number>();

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext'];
  }

  get available(): boolean { return this.ext !== null; }

  /** Starts timing a pass (ends the previous one). */
  mark(label: string): void {
    if (!this.ext || this.skipFrame) return;
    this.stop();
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { query, label };
  }

  beginFrame(): void {
    // Back-pressure: never let unresolved queries pile up (the frame is simply not timed).
    this.skipFrame = this.pending.length > 24;
    this.mark('scene');
  }

  endFrame(): void {
    this.stop();
    this.frame++;
    this.poll();
  }

  private stop(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push({ query: this.active.query, label: this.active.label, frame: this.frame });
    this.active = null;
  }

  private poll(): void {
    const gl = this.gl;
    while (this.pending.length) {
      const entry = this.pending[0]!;
      if (!gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
      if (entry.frame !== this.sumFrame) {
        if (this.sumFrame >= 0 && this.sum > 0) {
          this.samples.push(this.sum);
          if (this.samples.length > 90) this.samples.shift();
        }
        this.sumFrame = entry.frame;
        this.sum = 0;
      }
      if (!disjoint) {
        const ms = (gl.getQueryParameter(entry.query, gl.QUERY_RESULT) as number) / 1e6;
        this.sum += ms;
        const previous = this.passes.get(entry.label);
        this.passes.set(entry.label, previous === undefined ? ms : previous + (ms - previous) * 0.1);
      }
      gl.deleteQuery(entry.query);
      this.pending.shift();
    }
  }
}

function percentile(values: readonly number[], p: number, scratch: number[]): number {
  if (!values.length) return 0;
  scratch.length = 0;
  for (const v of values) scratch.push(v);
  scratch.sort((a, b) => a - b);
  return scratch[Math.min(scratch.length - 1, Math.floor(scratch.length * p))]!;
}

export class RendererHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly resizeObserver: ResizeObserver;
  private readonly gpu: GpuTimer;
  private pixelRatio = 1;
  private viewport = { width: 1, height: 1 };
  private profile: QualityProfile;
  private readonly frameSamples: number[] = [];
  private readonly scratch: number[] = [];
  private lastFrameAt = performance.now();
  private lastReviewAt = performance.now();
  private lastChangeAt = performance.now();
  private adaptive = true;
  private probe: { from: number; at: number } | null = null;
  private probeCooldownUntil = 0;
  private probeBackoff = 8000;
  private readonly pinnedDpr: number | null;
  /** Consecutive reviews with missed presentations (a single hitch burst never costs resolution). */
  private strikes = 0;
  private contextLost = false;
  /** Triangles/draw calls of the last shadow-map render (diagnostics). */
  readonly shadowStats = { triangles: 0, calls: 0 };
  /** Objects drawn into the next shadow-map render only (warm-up of depth program variants), then released. */
  private shadowWarm: { group: THREE.Object3D; resolve: () => void }[] = [];

  /** LOOK owns this class: post stack, quality tiers, precompile and adaptive resolution live here. */
  constructor(private readonly container: HTMLElement, private readonly captureMode: boolean, performanceMode = false) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance',
      preserveDrawingBuffer: captureMode,
    });
    hosts.set(this.renderer, this);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    // Metrics stay cumulative across the prepass, colour pass and post passes of one frame.
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x65cbea, 1);
    this.renderer.domElement.id = 'cruise-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Infinite anime ocean and sailing ships');
    this.renderer.domElement.tabIndex = 0;
    container.prepend(this.renderer.domElement);
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.installShadowHook();

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
    this.camera.position.set(0, 90, 120);
    this.profile = qualityProfile(performanceMode ? 'low' : 'high');
    // QA pin: `?dpr=1.5` fixes the pixel ratio and turns adaptive resolution off (performance evidence).
    const pinned = Number(new URLSearchParams(window.location.search).get('dpr'));
    this.pinnedDpr = Number.isFinite(pinned) && pinned >= 0.5 && pinned <= 3 ? pinned : null;
    this.pixelRatio = captureMode ? 2 : this.pinnedDpr ?? this.maxDpr();
    this.adaptive = !captureMode && this.pinnedDpr === null;
    this.renderer.setPixelRatio(this.pixelRatio);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  get tier(): QualityTier { return this.profile.tier; }
  get quality(): QualityProfile { return this.profile; }
  get gpuTimerAvailable(): boolean { return this.gpu.available; }
  /**
   * Per-pass GPU timer sections (prepass, shadow, colour, bloom, composite). Off by default (each section is one
   * TIME_ELAPSED query); `?gpupasses` or the PERF bridge turns it on for scripts/perf/gpu-timing.mjs.
   */
  gpuPassTiming = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gpupasses');
  /** Smoothed GPU time per labelled pass (ms), when EXT_disjoint_timer_query_webgl2 is available (diagnostics). */
  gpuPasses(): Record<string, number> { return Object.fromEntries([...this.gpu.passes].map(([k, v]) => [k, +v.toFixed(3)])); }
  /** Recent per-frame GPU totals (ms) from the timer queries (diagnostics). */
  gpuSamples(): number[] { return [...this.gpu.samples]; }
  /** Starts a labelled GPU timer section (ends the previous one); no-op unless per-pass timing is on. */
  markGpu(label: string): void { if (this.gpuPassTiming) this.gpu.mark(label); }

  /**
   * PERF: wraps three's shadow-map render, which runs inside the colour pass after its render list is built:
   *  - enables SHADOW_PROXY_LAYER on the view camera for that render only, so shadow-only proxies cast;
   *  - adds queued warm-up casters for that one render (compiles depth-program variants before a run needs them);
   *  - records the pass's triangles and draw calls.
   * Renders that do not update shadows (the ink prepass, utility renders) pass straight through.
   */
  private installShadowHook(): void {
    const shadowMap = this.renderer.shadowMap;
    const base = shadowMap.render.bind(shadowMap);
    const info = this.renderer.info.render;
    shadowMap.render = (lights: THREE.Light[], scene: THREE.Scene, camera: THREE.Camera) => {
      if (!shadowMap.enabled || (!shadowMap.autoUpdate && !shadowMap.needsUpdate)) {
        base(lights, scene, camera);
        return;
      }
      if (lights.length === 0) {
        // No shadow-casting light (low tier): nothing to warm, nothing to proxy.
        for (const w of this.shadowWarm.splice(0)) w.resolve();
        this.shadowStats.triangles = 0; this.shadowStats.calls = 0;
        base(lights, scene, camera);
        return;
      }
      const t0 = info.triangles, c0 = info.calls;
      const hadLayer = camera.layers.isEnabled(SHADOW_PROXY_LAYER);
      camera.layers.enable(SHADOW_PROXY_LAYER);
      const warm = this.shadowWarm;
      this.shadowWarm = [];
      for (const w of warm) { scene.add(w.group); w.group.updateMatrixWorld(true); }
      this.markGpu('shadow');
      try {
        base(lights, scene, camera);
      } finally {
        for (const w of warm) { scene.remove(w.group); w.resolve(); }
        if (!hadLayer) camera.layers.disable(SHADOW_PROXY_LAYER);
        this.markGpu('colour');
      }
      this.shadowStats.triangles = info.triangles - t0;
      this.shadowStats.calls = info.calls - c0;
    };
  }

  /**
   * Draws `group` into the next shadow-map update only (never into the colour or ink passes) so three builds the
   * depth programs its casters need. Meshes should be tiny, `frustumCulled = false` and far below the sea.
   */
  warmShadows(group: THREE.Object3D): Promise<void> {
    return new Promise((resolve) => { this.shadowWarm.push({ group, resolve }); });
  }

  /** Applies a quality tier's DPR range (called by PostStack when ctx.quality changes). */
  setQualityTier(tier: QualityTier): void {
    if (tier === this.profile.tier) return;
    this.profile = qualityProfile(tier);
    if (this.captureMode || this.pinnedDpr !== null) return;
    this.setPixelRatio(this.maxDpr());
    this.probe = null;
    this.probeBackoff = 8000;
  }

  render(renderScene?: () => void): void {
    if (this.contextLost) return;
    const now = performance.now();
    const frameMs = Math.min(100, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > 120) this.frameSamples.shift();
    this.renderer.info.reset();
    this.gpu.beginFrame();
    if (renderScene) renderScene();
    else this.renderer.render(this.scene, this.camera);
    this.gpu.endFrame();

    if (now - this.lastReviewAt > 1000) {
      this.reviewPixelRatio(now);
      this.lastReviewAt = now;
    }
  }

  getMetrics(): RenderMetrics {
    let sum = 0;
    for (const s of this.frameSamples) sum += s;
    const frameMs = sum / Math.max(1, this.frameSamples.length);
    const info = this.renderer.info;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      dpr: this.pixelRatio,
      gpuMs: this.gpu.available && this.gpu.samples.length ? percentile(this.gpu.samples, 0.5, this.scratch) : null,
      frameP90: percentile(this.frameSamples, 0.9, this.scratch),
      missRate: this.missRate(),
      tier: this.profile.tier,
      dprRange: [this.minDpr(), this.maxDpr()],
      width: size.x, height: size.y,
    };
  }

  /** CSS size of the game root, cached on resize so per-frame projections never force a layout read. */
  getViewport(): { width: number; height: number } {
    return this.viewport;
  }

  setAdaptiveQualityEnabled(enabled: boolean): void {
    this.adaptive = enabled && !this.captureMode;
    this.lastReviewAt = performance.now();
  }

  /** Forces a DPR (clamped to the tier range unless `force`); used by the lab and QA. */
  setPixelRatio(ratio: number, force = false): void {
    const next = force ? ratio : THREE.MathUtils.clamp(ratio, this.minDpr(), this.maxDpr());
    if (Math.abs(next - this.pixelRatio) < 0.01) return;
    this.pixelRatio = next;
    // Three's setPixelRatio resizes the drawing buffer itself.
    this.renderer.setPixelRatio(next);
    this.frameSamples.length = 0;
    this.gpu.samples.length = 0;
    this.lastChangeAt = performance.now();
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    hosts.delete(this.renderer);
  }

  private maxDpr(): number {
    const display = Math.max(1, window.devicePixelRatio || 1);
    return Math.max(this.profile.dprMin, Math.min(this.profile.dprMax, display));
  }

  private minDpr(): number { return Math.min(this.profile.dprMin, this.maxDpr()); }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.viewport = { width, height };
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /** Share of the recent frames whose interval exceeded 1.5 refresh periods (a missed presentation). */
  private missRate(): number {
    if (!this.frameSamples.length) return 0;
    const median = percentile(this.frameSamples, 0.5, this.scratch);
    // Refresh interval: 60 Hz → 16.7 ms, 120 Hz → 8.3 ms. The budget follows the display.
    const interval = median < 11 ? 8.33 : 16.67;
    let missed = 0;
    for (const s of this.frameSamples) if (s > interval * 1.5) missed++;
    return missed / this.frameSamples.length;
  }

  private reviewPixelRatio(now: number): void {
    if (!this.adaptive || this.frameSamples.length < 45 || document.hidden) return;
    // Missed presentations, not jitter: rAF intervals wander ±2 ms on a healthy 60 Hz frame loop.
    const missRate = this.missRate();
    const min = this.minDpr(), max = this.maxDpr();
    const sinceChange = now - this.lastChangeAt;

    // A probe that made the display miss frames is undone at once, with a longer wait before the next one.
    if (this.probe) {
      if (now - this.probe.at > 2500) {
        if (missRate > 0.04) {
          const from = this.probe.from;
          this.probe = null;
          this.probeCooldownUntil = now + this.probeBackoff;
          this.probeBackoff = Math.min(120000, this.probeBackoff * 2);
          this.setPixelRatio(from);
          return;
        }
        this.probe = null;
        this.probeBackoff = 8000;
      }
      return;
    }

    this.strikes = missRate > 0.08 ? this.strikes + 1 : 0;
    if ((this.strikes >= 2 || missRate > 0.3) && this.pixelRatio > min) {
      this.strikes = 0;
      this.setPixelRatio(Math.max(min, this.pixelRatio - 0.1));
    } else if (missRate < 0.01 && this.pixelRatio < max && sinceChange > 5000 && now > this.probeCooldownUntil) {
      const from = this.pixelRatio;
      this.setPixelRatio(Math.min(max, this.pixelRatio + 0.1));
      this.probe = { from, at: now };
    }
  }

  /**
   * Throughput benchmark: renders `frames` frames back to back through `renderFrame` and waits for the GPU, returning
   * ms per frame (CPU + GPU serialised, no vsync). A GPU-bound frame loop runs at this cost; 16.7 ms is the 60 Hz budget.
   */
  benchmark(frames: number, renderFrame: () => void): number {
    const gl = this.renderer.getContext();
    const pixel = new Uint8Array(4);
    renderFrame();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) renderFrame();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return (performance.now() - t0) / frames;
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.container.dataset.context = 'lost';
  };

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.container.dataset.context = 'ready';
  };
}
