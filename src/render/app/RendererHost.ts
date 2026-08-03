import * as THREE from 'three';
import type { GameMetrics } from '../../core/contracts';

export class RendererHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly resizeObserver: ResizeObserver;
  private pixelRatio = 1;
  private frameSamples: number[] = [];
  private lastFrameAt = performance.now();
  private lastRatioReviewAt = performance.now();
  private contextLost = false;

  constructor(private readonly container: HTMLElement, captureMode: boolean, performanceMode = false) {
    this.renderer = new THREE.WebGLRenderer({ antialias: !performanceMode, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    // The NPR pipeline renders normals, color/depth, and the full-screen edge pass.
    // Keep counters cumulative across those passes so the debug receipt describes
    // the complete frame instead of only the final screen quad.
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = !performanceMode;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x65cbea, 1);
    this.renderer.domElement.id = 'cruise-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Infinite anime ocean and sailing ships');
    this.renderer.domElement.tabIndex = 0;
    container.prepend(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(54, 1, 0.2, 5000);
    this.camera.position.set(0, 20, 36);
    this.pixelRatio = captureMode ? 2 : performanceMode ? 1 : Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(this.pixelRatio);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored, false);
  }

  render(renderScene?: () => void): void {
    if (this.contextLost) return;
    const now = performance.now();
    const frameMs = Math.min(100, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > 120) this.frameSamples.shift();
    this.renderer.info.reset();
    if (renderScene) renderScene();
    else this.renderer.render(this.scene, this.camera);

    if (now - this.lastRatioReviewAt > 2000) {
      this.reviewPixelRatio();
      this.lastRatioReviewAt = now;
    }
  }

  getMetrics(entityCount: number, chunkCount: number): GameMetrics {
    const sum = this.frameSamples.reduce((total, sample) => total + sample, 0);
    const frameMs = sum / Math.max(1, this.frameSamples.length);
    const info = this.renderer.info;
    return {
      fps: frameMs > 0 ? 1000 / frameMs : 0,
      frameMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      entities: entityCount,
      chunks: chunkCount,
    };
  }

  getViewport(): { width: number; height: number } {
    return {
      width: Math.max(1, this.container.clientWidth),
      height: Math.max(1, this.container.clientHeight),
    };
  }

  setAdaptiveQualityEnabled(enabled: boolean): void {
    if (!enabled) this.lastRatioReviewAt = Number.POSITIVE_INFINITY;
    else this.lastRatioReviewAt = performance.now();
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
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private reviewPixelRatio(): void {
    if (!Number.isFinite(this.lastRatioReviewAt) || this.frameSamples.length < 60) return;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 16.7;
    const limit = Math.min(window.devicePixelRatio, 2);
    let next = this.pixelRatio;
    if (p90 > 19 && this.pixelRatio > 1) next = Math.max(1, this.pixelRatio - 0.15);
    else if (p90 < 13.5 && this.pixelRatio < limit) next = Math.min(limit, this.pixelRatio + 0.1);
    if (Math.abs(next - this.pixelRatio) >= 0.05) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
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
