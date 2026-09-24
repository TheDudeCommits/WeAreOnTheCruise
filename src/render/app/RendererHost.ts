/**
 * Renderer host (LOOK-owned): the WebGL2 renderer, scene and camera, quality tiers, GPU timing and adaptive DPR.
 *
 * The canvas itself only ever receives the post stack's final full-screen composite (MSAA happens on the HDR target
 * inside PostStack), so the context is created without antialiasing. Shadow maps are updated only by the post stack's
 * colour pass (autoUpdate off), never by the ink prepass or other agents' utility renders.
 *
 * Adaptive DPR steps both ways: with EXT_disjoint_timer_query_webgl2 it reads real GPU frame time; without it, it
 * probes one step up after a stable stretch and reverts (with back-off) if the display starts missing frames — the
 * only way to find headroom on a 60 Hz display where frame intervals never drop below 16.7 ms.
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
  /** GPU frame time (ms, p50 of recent frames) when EXT_disjoint_timer_query_webgl2 is available, else null. */
  gpuMs: number | null;
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

class GpuTimer {
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  readonly samples: number[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext'];
  }

  get available(): boolean { return this.ext !== null; }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    this.poll();
  }

  private poll(): void {
    const gl = this.gl;
    while (this.pending.length) {
      const query = this.pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) {
        const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
        this.samples.push(ns / 1e6);
        if (this.samples.length > 90) this.samples.shift();
      }
      gl.deleteQuery(query);
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
  private contextLost = false;

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

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
    this.camera.position.set(0, 90, 120);
    this.profile = qualityProfile(performanceMode ? 'low' : 'high');
    this.pixelRatio = captureMode ? 2 : this.maxDpr();
    this.adaptive = !captureMode;
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

  /** Applies a quality tier's DPR range (called by PostStack when ctx.quality changes). */
  setQualityTier(tier: QualityTier): void {
    if (tier === this.profile.tier) return;
    this.profile = qualityProfile(tier);
    if (this.captureMode) return;
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
    this.gpu.begin();
    if (renderScene) renderScene();
    else this.renderer.render(this.scene, this.camera);
    this.gpu.end();

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
      tier: this.profile.tier,
      dprRange: [this.minDpr(), this.maxDpr()],
      width: size.x, height: size.y,
    };
  }

  getViewport(): { width: number; height: number } {
    return {
      width: Math.max(1, this.container.clientWidth),
      height: Math.max(1, this.container.clientHeight),
    };
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private reviewPixelRatio(now: number): void {
    if (!this.adaptive || this.frameSamples.length < 45 || document.hidden) return;
    const p90 = percentile(this.frameSamples, 0.9, this.scratch);
    const median = percentile(this.frameSamples, 0.5, this.scratch);
    // Refresh interval: 60 Hz → 16.7 ms, 120 Hz → 8.3 ms. The budget follows the display.
    const interval = median < 11 ? 8.33 : 16.67;
    const min = this.minDpr(), max = this.maxDpr();
    const sinceChange = now - this.lastChangeAt;

    // A probe that made the display miss frames is undone at once, with a longer wait before the next one.
    if (this.probe) {
      if (now - this.probe.at > 2500) {
        if (p90 > interval * 1.12) {
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

    const gpuSamples = this.gpu.samples;
    if (this.gpu.available && gpuSamples.length >= 30) {
      const gpu = percentile(gpuSamples, 0.75, this.scratch);
      if ((gpu > interval * 0.9 || p90 > interval * 1.25) && this.pixelRatio > min) {
        this.setPixelRatio(Math.max(min, this.pixelRatio - 0.1));
      } else if (gpu < interval * 0.62 && p90 < interval * 1.08 && this.pixelRatio < max && sinceChange > 3000) {
        this.setPixelRatio(Math.min(max, this.pixelRatio + 0.1));
      }
      return;
    }

    if (p90 > interval * 1.18 && this.pixelRatio > min) {
      this.setPixelRatio(Math.max(min, this.pixelRatio - 0.1));
    } else if (p90 < interval * 1.06 && this.pixelRatio < max && sinceChange > 6000 && now > this.probeCooldownUntil) {
      const from = this.pixelRatio;
      this.setPixelRatio(Math.min(max, this.pixelRatio + 0.1));
      this.probe = { from, at: now };
    }
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
