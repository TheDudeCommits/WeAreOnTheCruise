/**
 * Ocean interaction render targets (OCEAN-owned) — the fix for "ships sit ON the water".
 *
 * Two top-down, world-anchored half-float targets cover `size` metres around the focus (origin snapped to whole
 * texels, so scrolling never resamples):
 *   - persistent (ping-pong): R = foam, G = aeration (turquoise churn). Each frame the previous target is shifted
 *     by the whole-texel scroll, lightly diffused and decayed (frame-rate independent), then new deposits are
 *     MAX-blended in. Wakes, splash foam, sinking whirls and shore-independent foam live here.
 *   - transient (cleared every frame): R = raise (m), G = lower (m), B = fresh foam, A = aeration. Everything that
 *     moves with its source (bow waves, hull troughs, Kelvin arm particles, ring waves, whirlpools) is redrawn
 *     from CPU state every frame, so it never smears.
 * The ocean vertex shader reads transient R-G as visual-only displacement; the fragment shader reads both.
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
  gl_FragColor = max(c * uMul - uSub, vec4(0.0));
}
`;

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
      },
    });
    const fade = new THREE.Mesh(this.fadeGeometry, this.fadeMaterial);
    fade.frustumCulled = false;
    this.fadeScene.add(fade);
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

  /** Changes resolution/coverage (quality tier). Content is cleared. */
  configure(settings: InteractionSettings): void {
    if (settings.resolution === this.resolution && settings.size === this.size) return;
    this.resolution = settings.resolution;
    this.size = settings.size;
    this.texel = this.size / this.resolution;
    for (const t of this.targets) t.dispose();
    this.transient.dispose();
    this.targets = [this.makeTarget(), this.makeTarget()];
    this.transient = this.makeTarget();
    (this.fadeMaterial.uniforms.uTexel!.value as THREE.Vector2).set(1 / this.resolution, 1 / this.resolution);
    this.initialized = false;
    this.syncUniforms();
  }

  get persistentTexture(): THREE.Texture { return this.targets[this.readIndex]!.texture; }
  get transientTexture(): THREE.Texture { return this.transient.texture; }

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
    (u.uMul!.value as THREE.Vector4).set(Math.exp(-d / FOAM_TAU), Math.exp(-d / AER_TAU), 0, 0);
    (u.uSub!.value as THREE.Vector4).set(FOAM_LINEAR * d, AER_LINEAR * d, 0, 0);
    (u.uDiffuse!.value as THREE.Vector4).set(1 - Math.exp(-d * FOAM_DIFFUSE), 1 - Math.exp(-d * AER_DIFFUSE), 0, 0);
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

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(this.savedClear, previousAlpha);
    renderer.autoClear = previousAutoClear;
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.transient.dispose();
    this.transientBatch.dispose();
    this.persistentBatch.dispose();
    this.fadeMaterial.dispose();
    this.fadeGeometry.dispose();
  }
}
