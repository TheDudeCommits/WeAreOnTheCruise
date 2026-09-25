/**
 * Ocean interaction render targets (OCEAN-owned) — the fix for "ships sit ON the water".
 *
 * Two top-down, world-anchored half-float targets cover `size` metres around the focus (origin snapped to whole
 * texels, so scrolling never resamples):
 *   - persistent (ping-pong): R = foam, G = aeration (turquoise churn), B = fresh foam (the same deposits, but
 *     decaying in under a second: night bioluminescence keys on it, so only just-stirred water glows). Each frame
 *     the previous target is shifted by the whole-texel scroll, lightly diffused and decayed (frame-rate
 *     independent), then new deposits are MAX-blended in. Wakes, splash foam, sinking whirls and shore-independent
 *     foam live here.
 *   - transient (cleared every frame): R = raise (m), G = lower (m), B = fresh foam, A = aeration. Everything that
 *     moves with its source (bow waves, hull troughs, Kelvin arm particles, ring waves, whirlpools) is redrawn
 *     from CPU state every frame, so it never smears.
 * The ocean vertex shader reads transient R-G as visual-only displacement; the fragment shader reads both.
 *
 * Foam coverage (round 2, "foam never carpets the sea"): after both passes a coverage pass averages the *visible*
 * foam fraction (the same expected-coverage curve the ocean shader converges to at distance) into a small mipmapped
 * target, one texel per 8×8 field texels: R = all foam (persistent + transient), G = persistent foam only,
 * B = all foam smoothed over time (EMA, ~0.35 s; ping-pong).
 * Next frame, persistent deposits are scaled down where the neighbourhood (mip 2, ~25-50 m) is already covered (G),
 * transient stamps other than hull contact where the smoothed total (B) is high, and crowded foam dissolves faster,
 * so a melee's pile-up converges to lace instead of a white slab. The ocean shader reads B to render saturated foam
 * as turquoise aeration + lace. `foamCoverage()` reads R/G back for QA only.
 */
import * as THREE from 'three';
import { StampBatch } from './StampBatch';

const FADE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FADE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uShift;
uniform vec2 uTexel;
uniform vec4 uMul;
uniform vec4 uSub;
uniform vec4 uDiffuse;
uniform sampler2D uCoverage;
uniform vec2 uCovShift;          // coverage uv of this texel = uv + uCovShift (coverage lags one frame)
uniform vec2 uCrowd;             // x = extra foam decay per second at full crowding (as a multiplier exponent), y = dt
void main() {
  vec2 uv = vUv + uShift;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec4 c = texture2D(uPrev, uv);
  vec4 n = texture2D(uPrev, uv + vec2(uTexel.x, 0.0)) + texture2D(uPrev, uv - vec2(uTexel.x, 0.0))
    + texture2D(uPrev, uv + vec2(0.0, uTexel.y)) + texture2D(uPrev, uv - vec2(0.0, uTexel.y));
  c = mix(c, n * 0.25, uDiffuse);
  c = max(c * uMul - uSub, vec4(0.0));
  // Crowded foam dissolves faster (neighbourhood coverage from last frame, ~25-50 m average): lace survives,
  // a white slab does not. Foam-free texels (most of the field) skip the fetch.
  if (c.r > 0.002) {
    float crowd = smoothstep(0.2, 0.55, textureLod(uCoverage, uv + uCovShift, 2.0).g);
    c.r *= exp(-uCrowd.x * uCrowd.y * crowd);
  }
  gl_FragColor = c;
}
`;

const COVERAGE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPersist;
uniform sampler2D uTransient;
uniform sampler2D uPrevCoverage;
uniform vec2 uPrevShift;         // previous coverage uv = vUv + uPrevShift (the field scrolled)
uniform float uBlend;            // EMA weight of this frame (frame-rate independent; 0 while paused)
uniform vec2 uStep;
// Expected visible fraction for a coverage value (the curve the ocean shader converges to at distance).
float vis(float c) { return clamp(c * 1.15 - 0.12, 0.0, 1.0); }
void main() {
  // 4x4 bilinear taps on texel corners = the mean of the 8x8 field texels under this coverage texel.
  float all = 0.0;
  float per = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 uv = vUv + (vec2(float(i), float(j)) - 1.5) * uStep;
      vec4 p = texture2D(uPersist, uv);
      vec4 t = texture2D(uTransient, uv);
      all += vis(max(p.r, t.b));
      per += vis(p.r);
    }
  }
  all /= 16.0;
  // B: the total, smoothed over ~a third of a second. The transient-stamp limiter and the pile-up look key on it, so
  // limiting this frame's foam never feeds back into next frame's limit as a flicker.
  vec2 prevUv = vUv + uPrevShift;
  float inside = step(0.0, prevUv.x) * step(0.0, prevUv.y) * step(prevUv.x, 1.0) * step(prevUv.y, 1.0);
  float smoothed = mix(texture2D(uPrevCoverage, prevUv).b * inside, all, uBlend);
  gl_FragColor = vec4(all, per / 16.0, smoothed, 1.0);
}
`;

/** Field texels per coverage texel (per axis). */
const COVERAGE_DIV = 8;

export interface FoamCoverageStats {
  /** Mean visible foam fraction (persistent + transient) inside the disc. */
  total: number;
  /** Persistent foam only. */
  persistent: number;
  /** Fraction of the disc's coverage texels (≈6 m cells) that read as mostly foam (> 50%). */
  saturatedCells: number;
  radius: number;
}

export interface InteractionSettings {
  resolution: number;
  size: number;
}

/** Decay tuning (seconds / per-second rates). */
const FOAM_TAU = 4.0;
const FOAM_LINEAR = 0.05;
const AER_TAU = 2.6;
const AER_LINEAR = 0.035;
const FOAM_DIFFUSE = 1.2;
const AER_DIFFUSE = 4.0;
/** Fresh foam (channel B): the last ~second of deposits (night glow keys on it). */
const FRESH_TAU = 0.55;
const FRESH_LINEAR = 0.25;
/** Extra foam decay rate (1/s) where the neighbourhood is fully crowded. */
const CROWD_DECAY = 0.9;
/** Time constant of the smoothed total coverage (s). */
const COVERAGE_TAU = 0.35;

export class InteractionField {
  resolution: number;
  size: number;
  texel: number;
  /** World XZ of the targets' (0,0) corner (snapped to texels). */
  originX = 0;
  originZ = 0;
  readonly transientBatch = new StampBatch(6144, false);
  readonly persistentBatch = new StampBatch(3072, true);
  /** Vector4(originX, originZ, size, 1/size) for shaders. */
  readonly rect = new THREE.Vector4();

  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private transient: THREE.WebGLRenderTarget;
  private coverages: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private covIndex = 0;
  /** World XZ of the coverage target's (0,0) corner (the field origin when it was computed). */
  private coverageX = 0;
  private coverageZ = 0;
  private coverageValid = false;
  private readonly coverageScene = new THREE.Scene();
  private readonly coverageMaterial: THREE.ShaderMaterial;
  private coveragePixels: Uint8Array | null = null;
  /** Coverage uv offset for this frame's deposits: (origin − coverage origin) / size. Shared by the stamp shaders. */
  readonly coverageShift = new THREE.Vector2();
  private readIndex = 0;
  private initialized = false;
  private pendingShiftX = 0;
  private pendingShiftZ = 0;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fadeScene = new THREE.Scene();
  private readonly persistentScene = new THREE.Scene();
  private readonly transientScene = new THREE.Scene();
  private readonly fadeMaterial: THREE.ShaderMaterial;
  private readonly fadeGeometry: THREE.BufferGeometry;
  private readonly savedClear = new THREE.Color();

  constructor(settings: InteractionSettings) {
    this.resolution = settings.resolution;
    this.size = settings.size;
    this.texel = this.size / this.resolution;
    this.targets = [this.makeTarget(), this.makeTarget()];
    this.transient = this.makeTarget();
    this.coverages = [this.makeCoverageTarget(), this.makeCoverageTarget()];
    this.fadeGeometry = new THREE.BufferGeometry();
    this.fadeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.fadeGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.fadeMaterial = new THREE.ShaderMaterial({
      name: 'OceanInteractionFade',
      vertexShader: FADE_VERT,
      fragmentShader: FADE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: new THREE.Vector2(1 / this.resolution, 1 / this.resolution) },
        uMul: { value: new THREE.Vector4(1, 1, 1, 1) },
        uSub: { value: new THREE.Vector4() },
        uDiffuse: { value: new THREE.Vector4() },
        uCoverage: { value: this.coverages[0].texture },
        uCovShift: { value: new THREE.Vector2() },
        uCrowd: { value: new THREE.Vector2(CROWD_DECAY, 0) },
      },
    });
    const fade = new THREE.Mesh(this.fadeGeometry, this.fadeMaterial);
    fade.frustumCulled = false;
    this.fadeScene.add(fade);
    this.coverageMaterial = new THREE.ShaderMaterial({
      name: 'OceanFoamCoverage',
      vertexShader: FADE_VERT,
      fragmentShader: COVERAGE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      uniforms: {
        uPersist: { value: null },
        uTransient: { value: null },
        uPrevCoverage: { value: null },
        uPrevShift: { value: new THREE.Vector2() },
        uBlend: { value: 1 },
        uStep: { value: new THREE.Vector2(2 / this.resolution, 2 / this.resolution) },
      },
    });
    const cover = new THREE.Mesh(this.fadeGeometry, this.coverageMaterial);
    cover.frustumCulled = false;
    this.coverageScene.add(cover);
    for (const batch of [this.persistentBatch, this.transientBatch]) {
      batch.material.uniforms.uCoverage!.value = this.coverages[0].texture;
      batch.material.uniforms.uCovShift!.value = this.coverageShift;
    }
    this.persistentScene.add(this.persistentBatch.mesh);
    this.transientScene.add(this.transientBatch.mesh);
    this.syncUniforms();
  }

  private makeTarget(): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(this.resolution, this.resolution, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    return target;
  }

  private makeCoverageTarget(): THREE.WebGLRenderTarget {
    const n = Math.max(8, Math.round(this.resolution / COVERAGE_DIV));
    const target = new THREE.WebGLRenderTarget(n, n, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    return target;
  }

  /** Changes resolution/coverage (quality tier). Content is cleared. */
  configure(settings: InteractionSettings): void {
    if (settings.resolution === this.resolution && settings.size === this.size) return;
    this.resolution = settings.resolution;
    this.size = settings.size;
    this.texel = this.size / this.resolution;
    for (const t of this.targets) t.dispose();
    this.transient.dispose();
    for (const t of this.coverages) t.dispose();
    this.targets = [this.makeTarget(), this.makeTarget()];
    this.transient = this.makeTarget();
    this.coverages = [this.makeCoverageTarget(), this.makeCoverageTarget()];
    this.covIndex = 0;
    this.coverageValid = false;
    this.coveragePixels = null;
    (this.fadeMaterial.uniforms.uTexel!.value as THREE.Vector2).set(1 / this.resolution, 1 / this.resolution);
    (this.coverageMaterial.uniforms.uStep!.value as THREE.Vector2).set(2 / this.resolution, 2 / this.resolution);
    this.initialized = false;
    this.syncUniforms();
  }

  get persistentTexture(): THREE.Texture { return this.targets[this.readIndex]!.texture; }
  get transientTexture(): THREE.Texture { return this.transient.texture; }
  /** Visible-foam coverage (R = all, G = persistent, B = all smoothed), mipmapped, aligned with the last render. */
  get coverageTexture(): THREE.Texture { return this.coverages[this.covIndex]!.texture; }

  /** Snaps the window to the focus and resets the stamp batches. Call before pushing stamps. */
  beginFrame(focusX: number, focusZ: number): void {
    const texel = this.texel;
    const ox = Math.floor((focusX - this.size * 0.5) / texel) * texel;
    const oz = Math.floor((focusZ - this.size * 0.5) / texel) * texel;
    if (!this.initialized) {
      this.pendingShiftX = this.resolution * 2; // forces a clear on the first fade
      this.pendingShiftZ = 0;
    } else {
      this.pendingShiftX += Math.round((ox - this.originX) / texel);
      this.pendingShiftZ += Math.round((oz - this.originZ) / texel);
    }
    this.originX = ox;
    this.originZ = oz;
    this.transientBatch.reset();
    this.persistentBatch.reset();
    this.syncUniforms();
  }

  private syncUniforms(): void {
    this.rect.set(this.originX, this.originZ, this.size, 1 / this.size);
    // Last frame's coverage sits at its own origin: shift into this frame's field (and gate it off until valid).
    if (this.coverageValid) this.coverageShift.set((this.originX - this.coverageX) / this.size, (this.originZ - this.coverageZ) / this.size);
    else this.coverageShift.set(4, 4); // out of range → clamp-to-edge of an empty target reads 0
    const noiseX = this.originX - Math.floor(this.originX / 4096) * 4096;
    const noiseZ = this.originZ - Math.floor(this.originZ / 4096) * 4096;
    this.syncBatch(this.transientBatch, noiseX, noiseZ);
    this.syncBatch(this.persistentBatch, noiseX, noiseZ);
  }

  private syncBatch(batch: StampBatch, noiseX: number, noiseZ: number): void {
    batch.material.uniforms.uInvSize!.value = 1 / this.size;
    (batch.material.uniforms.uNoiseOrigin!.value as THREE.Vector2).set(noiseX, noiseZ);
  }

  setHullHole(depth: number): void {
    this.transientBatch.material.uniforms.uHullHole!.value = depth;
  }

  /** Relative coordinates helpers for stamp producers. */
  relX(x: number): number { return x - this.originX; }
  relZ(z: number): number { return z - this.originZ; }
  contains(x: number, z: number, margin: number): boolean {
    const rx = x - this.originX;
    const rz = z - this.originZ;
    return rx > -margin && rz > -margin && rx < this.size + margin && rz < this.size + margin;
  }

  /** Runs the fade/scroll pass and both stamp passes. `dt` is the interaction clock (0 while the run is paused). */
  render(renderer: THREE.WebGLRenderer, dt: number): void {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(this.savedClear);
    const previousAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;

    // Persistent: shift + diffuse + decay into the write target, then MAX-blend new deposits.
    const read = this.targets[this.readIndex]!;
    const write = this.targets[1 - this.readIndex]!;
    const u = this.fadeMaterial.uniforms;
    u.uPrev!.value = read.texture;
    (u.uShift!.value as THREE.Vector2).set(this.pendingShiftX / this.resolution, this.pendingShiftZ / this.resolution);
    const d = Math.max(0, dt);
    (u.uMul!.value as THREE.Vector4).set(Math.exp(-d / FOAM_TAU), Math.exp(-d / AER_TAU), Math.exp(-d / FRESH_TAU), 0);
    (u.uSub!.value as THREE.Vector4).set(FOAM_LINEAR * d, AER_LINEAR * d, FRESH_LINEAR * d, 0);
    const foamDiffuse = 1 - Math.exp(-d * FOAM_DIFFUSE);
    (u.uDiffuse!.value as THREE.Vector4).set(foamDiffuse, 1 - Math.exp(-d * AER_DIFFUSE), foamDiffuse, 0);
    // Last frame's coverage drives this frame's limits (fade decay, persistent and transient stamps).
    const lastCoverage = this.coverages[this.covIndex]!.texture;
    u.uCoverage!.value = lastCoverage;
    this.persistentBatch.material.uniforms.uCoverage!.value = lastCoverage;
    this.transientBatch.material.uniforms.uCoverage!.value = lastCoverage;
    // The fade samples last frame's coverage at this frame's scrolled uv: uv(prev) = vUv + shift.
    (u.uCovShift!.value as THREE.Vector2).set(
      this.coverageValid ? (this.originX - this.coverageX) / this.size - this.pendingShiftX / this.resolution : 4,
      this.coverageValid ? (this.originZ - this.coverageZ) / this.size - this.pendingShiftZ / this.resolution : 4,
    );
    (u.uCrowd!.value as THREE.Vector2).set(CROWD_DECAY, d);
    renderer.setRenderTarget(write);
    renderer.render(this.fadeScene, this.camera);
    this.persistentBatch.commit();
    if (this.persistentBatch.count > 0) renderer.render(this.persistentScene, this.camera);
    this.readIndex = 1 - this.readIndex;
    this.pendingShiftX = 0;
    this.pendingShiftZ = 0;
    this.initialized = true;

    // Transient: clear and redraw.
    renderer.setRenderTarget(this.transient);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    this.transientBatch.commit();
    if (this.transientBatch.count > 0) renderer.render(this.transientScene, this.camera);

    // Coverage, ping-pong (the EMA channel reads the previous one; mipmaps regenerate after the render).
    const cu = this.coverageMaterial.uniforms;
    const prev = this.coverages[this.covIndex]!;
    const next = this.coverages[1 - this.covIndex]!;
    cu.uPersist!.value = this.targets[this.readIndex]!.texture;
    cu.uTransient!.value = this.transient.texture;
    cu.uPrevCoverage!.value = prev.texture;
    (cu.uPrevShift!.value as THREE.Vector2).set(
      this.coverageValid ? (this.originX - this.coverageX) / this.size : 4,
      this.coverageValid ? (this.originZ - this.coverageZ) / this.size : 4,
    );
    cu.uBlend!.value = this.coverageValid ? 1 - Math.exp(-d / COVERAGE_TAU) : 1;
    renderer.setRenderTarget(next);
    renderer.render(this.coverageScene, this.camera);
    this.covIndex = 1 - this.covIndex;
    this.coverageX = this.originX;
    this.coverageZ = this.originZ;
    this.coverageValid = true;

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.savedClear, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }

  /**
   * QA only (synchronous GPU readback, stalls the pipeline): foam coverage inside a disc of `radius` metres around
   * (x, z), from the coverage target of the last render. Never call this per frame.
   */
  foamCoverage(renderer: THREE.WebGLRenderer, x: number, z: number, radius: number): FoamCoverageStats {
    const target = this.coverages[this.covIndex]!;
    const n = target.width;
    const out: FoamCoverageStats = { total: 0, persistent: 0, saturatedCells: 0, radius };
    if (!this.coverageValid) return out;
    const pixels = (this.coveragePixels ??= new Uint8Array(n * n * 4));
    renderer.readRenderTargetPixels(target, 0, 0, n, n, pixels);
    const cell = this.size / n;
    let count = 0;
    for (let j = 0; j < n; j++) {
      const wz = this.coverageZ + (j + 0.5) * cell;
      for (let i = 0; i < n; i++) {
        const wx = this.coverageX + (i + 0.5) * cell;
        if ((wx - x) * (wx - x) + (wz - z) * (wz - z) > radius * radius) continue;
        const o = (j * n + i) * 4;
        const all = pixels[o]! / 255;
        out.total += all;
        out.persistent += pixels[o + 1]! / 255;
        if (all > 0.5) out.saturatedCells++;
        count++;
      }
    }
    if (count > 0) { out.total /= count; out.persistent /= count; out.saturatedCells /= count; }
    return out;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.transient.dispose();
    for (const t of this.coverages) t.dispose();
    this.coverageMaterial.dispose();
    this.transientBatch.dispose();
    this.persistentBatch.dispose();
    this.fadeMaterial.dispose();
    this.fadeGeometry.dispose();
  }
}
