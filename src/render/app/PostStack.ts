/**
 * Post-processing stack (LOOK-owned). Contract: `render(scene, camera)` draws the final frame and the
 * PostServices methods trigger screen effects.
 *
 * Frame:
 *   1. ink prepass            → half-float normal+depth (npr/ink.ts; ocean depth-only, inked meshes encoded)
 *   2. colour pass            → half-float HDR target with MSAA; the ink overlay blends in after opaque geometry,
 *                               before transparent FX; shadow maps update here and only here
 *   3. bloom                  → soft-knee prefilter + dual-filter down/up chain (half res and below)
 *   4. composite → canvas     → exposure, neutral tone map, grade (hour × weather), vignette, rain streaks,
 *                               flash, speed lines, impact frame, dither
 * Shaders are compiled with the real targets bound on the first frame (and on demand via `precompile`).
 */
import * as THREE from 'three';
import type { FrameContext, PostServices, QualityTier } from '../frame';
import { CelMaterial } from '../materials/celMaterial';
import { ensureInstanceTint } from '../materials/toon';
import { InkPass, readInkMarker, type InkMarker } from '../npr/ink';
import { GRADES, createGrade, gradeForHour, lerpGrade, type Grade } from './grading';
import { COMPOSITE_FRAGMENT, DOWNSAMPLE_FRAGMENT, FULLSCREEN_VERTEX, PREFILTER_FRAGMENT, UPSAMPLE_FRAGMENT } from './post/shaders';
import { qualityProfile, type QualityProfile } from './quality';
import { hostFor } from './RendererHost';

const stacks = new WeakMap<THREE.WebGLRenderer, PostStack>();
/** The post stack drawing with `renderer` (for precompile helpers). */
export function postStackFor(renderer: THREE.WebGLRenderer): PostStack | undefined { return stacks.get(renderer); }

function fullscreenTriangle(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  return geometry;
}

function passMaterial(name: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name, vertexShader: FULLSCREEN_VERTEX, fragmentShader, uniforms,
    depthTest: false, depthWrite: false, toneMapped: false, fog: false,
  });
}

function hdrTarget(name: string, samples = 0, depth = false): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    depthBuffer: depth, stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.name = name;
  return target;
}

interface Timed { strength: number; time: number; duration: number }

export class PostStack implements PostServices {
  readonly ink = new InkPass();
  /** Live grade (read-only outside; recomputed every update). */
  readonly grade: Grade = createGrade();
  /** Lab/QA overrides: set a key to pin it (e.g. { bloom: false }). */
  readonly overrides: { bloom?: boolean; ink?: boolean; grade?: boolean; exposure?: number } = {};
  private profile: QualityProfile = qualityProfile('high');
  private colorTarget: THREE.WebGLRenderTarget;
  private readonly bloomDown: THREE.WebGLRenderTarget[] = [];
  private readonly bloomUp: THREE.WebGLRenderTarget[] = [];
  private readonly black: THREE.DataTexture;
  private readonly quad: THREE.Mesh;
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private width = 0;
  private height = 0;
  private warmed = false;
  private rewarm = false;
  private lastScreen = '';
  private dummies: THREE.Group | null = null;
  private time = 0;
  private screenFx = 1;
  private readonly scratchGrade: Grade = createGrade();
  // Effects.
  private impactFrames = 0;
  private impactStrength = 0;
  private impactCooldown = 0;
  private impactSeed = 0;
  private readonly speed: Timed = { strength: 0, time: 0, duration: 0 };
  private readonly flashState: Timed & { color: THREE.Color } = { strength: 0, time: 0, duration: 0.15, color: new THREE.Color(1, 1, 1) };
  private readonly chroma: Timed = { strength: 0, time: 0, duration: 0.2 };
  private lightning = 0;
  private rain = 0;
  private windAngle = 0.3;

  constructor(protected readonly renderer: THREE.WebGLRenderer) {
    stacks.set(renderer, this);
    this.colorTarget = hdrTarget('hdr-colour', this.profile.msaa, true);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.quad = new THREE.Mesh(fullscreenTriangle());
    this.quad.frustumCulled = false;
    this.prefilter = passMaterial('bloom-prefilter', PREFILTER_FRAGMENT, {
      tSource: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: new THREE.Vector3(1, 0.5, 24) },
    });
    this.down = passMaterial('bloom-down', DOWNSAMPLE_FRAGMENT, { tSource: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = passMaterial('bloom-up', UPSAMPLE_FRAGMENT, {
      tSource: { value: null }, tDetail: { value: null }, uTexel: { value: new THREE.Vector2() }, uScatter: { value: 0.85 },
    });
    this.composite = passMaterial('composite', COMPOSITE_FRAGMENT, {
      tColor: { value: null }, tBloom: { value: this.black }, uResolution: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
      uBloomStrength: { value: 0.6 }, uExposure: { value: 1 },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSaturation: { value: 1 }, uContrast: { value: 1 },
      uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighlightTint: { value: new THREE.Vector3(1, 1, 1) }, uSplit: { value: 0 },
      uVignette: { value: new THREE.Vector4(0, 0, 0, 0) }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
      uChromatic: { value: 0 }, uSpeed: { value: new THREE.Vector4(0, 0, 0.5, 0.5) },
      uImpact: { value: new THREE.Vector4(0, 0, 0.5, 0) },
      uImpactInk: { value: new THREE.Vector3(0.07, 0.09, 0.16) }, uImpactPaper: { value: new THREE.Vector3(0.98, 0.96, 0.9) },
      uRain: { value: new THREE.Vector4(0, 0.3, 1.6, 0) }, uDither: { value: 1 / 255 },
    });
    this.rebuildBloomTargets();
  }

  get tier(): QualityTier { return this.profile.tier; }
  get colorTexture(): THREE.Texture { return this.colorTarget.texture; }

  setQuality(tier: QualityTier): void {
    if (tier === this.profile.tier) return;
    const previous = this.profile;
    this.profile = qualityProfile(tier);
    hostFor(this.renderer)?.setQualityTier(tier);
    if (previous.msaa !== this.profile.msaa) {
      this.colorTarget.dispose();
      this.colorTarget = hdrTarget('hdr-colour', this.profile.msaa, true);
      this.width = this.height = 0;
    }
    if (previous.bloomLevels !== this.profile.bloomLevels) this.rebuildBloomTargets();
  }

  setSize(width: number, height: number, dpr: number): void { this.resize(Math.floor(width * dpr), Math.floor(height * dpr)); }

  /** Called once per frame before render with the frame context (grading reads atmosphere/sea). */
  update(ctx: FrameContext): void {
    if (ctx.quality !== this.profile.tier) this.setQuality(ctx.quality);
    const dt = Math.min(0.1, Math.max(0, ctx.dt));
    this.time += dt;
    this.screenFx = ctx.settings.reduceFlashing ? 0 : 1;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.speed.time = Math.max(0, this.speed.time - dt);
    this.flashState.time = Math.max(0, this.flashState.time - dt);
    this.chroma.time = Math.max(0, this.chroma.time - dt);
    // A new screen (entering a run, the harbor) brings new pools and ships: compile them on its first frame, not
    // piecemeal on first sight mid-fight.
    if (ctx.screen !== this.lastScreen) { this.lastScreen = ctx.screen; this.rewarm = this.warmed; }

    // Grade: hour, then weather on top, then lightning.
    const a = ctx.atmosphere;
    const g = gradeForHour(this.grade, ctx.sea.timeOfDay);
    const storm = THREE.MathUtils.clamp(a.storm, 0, 1);
    const fog = THREE.MathUtils.clamp(ctx.sea.fog, 0, 1);
    if (storm > 0) {
      // A night storm keeps its indigo; the storm grade takes over by day.
      const stormAmount = storm * (1 - a.night * 0.45);
      lerpGrade(g, GRADES.storm, stormAmount);
    }
    if (fog > 0) lerpGrade(g, GRADES.fog, fog * (1 - a.night * 0.5));
    if (ctx.screen === 'title' || ctx.screen === 'harbor') g.vignette = Math.max(g.vignette, 0.34);
    this.lightning = a.flash;
    this.rain = ctx.sea.rain;
    this.windAngle = 0.18 + 0.22 * Math.sin(ctx.sea.windDir);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this.size);
    if (this.size.x !== this.width || this.size.y !== this.height) this.resize(this.size.x, this.size.y);
    const perspective = camera as THREE.PerspectiveCamera;
    if (this.ink.overlay.parent !== scene) scene.add(this.ink.overlay);
    if (!this.warmed) { this.warmed = true; this.warmupScene(scene, perspective); }
    else if (this.rewarm) { this.rewarm = false; this.compileInto(scene, perspective, scene); }

    // 1. Ink prepass.
    this.ink.enabled = (this.overrides.ink ?? this.profile.ink) === true;
    this.ink.render(renderer, scene, perspective);

    // 2. Colour pass (HDR, MSAA). Shadow maps refresh here only.
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(this.colorTarget);
    renderer.render(scene, camera);
    renderer.shadowMap.needsUpdate = false;

    // 3. Bloom.
    const bloomOn = (this.overrides.bloom ?? true) && this.profile.bloomLevels > 0 && this.bloomDown.length > 0;
    const bloomTexture = bloomOn ? this.renderBloom() : this.black;

    // 4. Composite to the canvas.
    this.applyComposite(bloomTexture);
    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.quadCamera);

    if (this.impactFrames > 0) this.impactFrames--;
  }

  // ───────────── PostServices ─────────────

  impactFrame(strength = 1): void {
    if (this.impactCooldown > 0 || strength <= 0) return;
    this.impactStrength = THREE.MathUtils.clamp(strength, 0, 1) * (this.screenFx > 0.05 ? 1 : 0.4);
    this.impactFrames = strength >= 0.75 ? 2 : 1;
    this.impactCooldown = 0.45;
    this.impactSeed = (this.impactSeed + 17.31) % 1000;
  }

  speedLines(strength: number, duration: number): void {
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    if (s <= 0 || duration <= 0) return;
    if (this.speed.time <= 0 || s >= this.currentSpeed()) {
      this.speed.strength = s; this.speed.duration = duration; this.speed.time = duration;
    } else {
      this.speed.time = Math.max(this.speed.time, duration);
    }
  }

  flash(color: number, strength: number, duration = 0.15): void {
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    if (s <= 0) return;
    if (s >= this.currentFlash()) {
      this.flashState.color.setHex(color, THREE.LinearSRGBColorSpace);
      this.flashState.strength = s; this.flashState.duration = Math.max(0.02, duration); this.flashState.time = this.flashState.duration;
    }
  }

  chromatic(strength: number, duration = 0.2): void {
    const s = THREE.MathUtils.clamp(strength, 0, 1);
    if (s <= 0) return;
    if (s >= this.currentChroma()) { this.chroma.strength = s; this.chroma.duration = Math.max(0.02, duration); this.chroma.time = this.chroma.duration; }
  }

  // ───────────── Warm-up ─────────────

  /**
   * Compiles `root` (default: the whole scene) for the colour pass and the ink prepass with the real targets bound,
   * so the first visible frame finds its programs linked. Returns when every program reports ready
   * (KHR_parallel_shader_compile), without blocking the frame loop.
   */
  async precompile(scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D = scene): Promise<void> {
    const materials = this.compileInto(scene, camera, root);
    await this.whenLinked(materials);
  }

  private warmupScene(scene: THREE.Scene, camera: THREE.Camera): void {
    // The dummies stay alive (never disposed): disposing them would delete programs that are still linking in
    // parallel (Chrome then polls deleted programs) and would throw the warm-up away before real meshes use it.
    this.dummies ??= this.variantDummies();
    scene.add(this.dummies);
    try {
      this.compileInto(scene, camera, scene);
    } finally {
      scene.remove(this.dummies);
    }
    // Post materials.
    const previous = this.renderer.getRenderTarget();
    for (const material of [this.prefilter, this.down, this.up, this.composite]) {
      this.quad.material = material;
      this.renderer.setRenderTarget(this.bloomDown[0] ?? null);
      this.renderer.compile(this.quad, this.quadCamera);
    }
    this.renderer.setRenderTarget(previous);
  }

  private compileInto(scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D): Set<THREE.Material> {
    const renderer = this.renderer;
    const previous = renderer.getRenderTarget();
    const all = new Set<THREE.Material>();
    try {
      renderer.setRenderTarget(this.colorTarget);
      for (const m of renderer.compile(root, camera, scene) as Set<THREE.Material>) all.add(m);
      // Prepass variants: swap, compile, restore before anything else runs.
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
      const visit = (object: THREE.Object3D, inherited: InkMarker | null) => {
        if (object.userData.inkSkip === true) return;
        const marker = object.userData.noInk === true ? null : readInkMarker(object) ?? inherited;
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          const variant = marker ? this.ink.variantFor(mesh, marker) : this.ink.occluderMaterialFor(mesh);
          if (variant) { swapped.push([mesh, mesh.material]); mesh.material = variant; }
        }
        for (const child of object.children) visit(child, marker);
      };
      visit(root, null);
      if (swapped.length) {
        renderer.setRenderTarget(this.ink.target);
        try {
          for (const m of renderer.compile(root, camera, scene) as Set<THREE.Material>) all.add(m);
        } finally {
          for (const [mesh, material] of swapped) mesh.material = material;
        }
      }
    } finally {
      renderer.setRenderTarget(previous);
    }
    return all;
  }

  private whenLinked(materials: Set<THREE.Material>): Promise<void> {
    const properties = (this.renderer as unknown as { properties: { get(m: THREE.Material): { currentProgram?: { isReady(): boolean } } } }).properties;
    return new Promise((resolve) => {
      const poll = () => {
        for (const m of materials) {
          const program = properties.get(m).currentProgram;
          if (!program || program.isReady()) materials.delete(m);
        }
        if (materials.size === 0) resolve();
        else setTimeout(poll, 10);
      };
      poll();
    });
  }

  /** Small set of meshes covering the common CelMaterial and prepass program variants (compiled once at start). */
  private variantDummies(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'look-warmup';
    const box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    const tex = this.black;
    const add = (mesh: THREE.Mesh, ink = true) => {
      mesh.position.set(0, -1000, 0);
      mesh.castShadow = true; mesh.receiveShadow = true;
      if (ink) mesh.userData.ink = { width: 1, crease: 1 };
      group.add(mesh);
    };
    add(new THREE.Mesh(box, new CelMaterial({ color: 0xffffff })));
    add(new THREE.Mesh(box, new CelMaterial({ color: 0xffffff, side: THREE.DoubleSide })));
    add(new THREE.Mesh(box, new CelMaterial({ map: tex })));
    add(new THREE.Mesh(box, new CelMaterial({ map: tex, side: THREE.DoubleSide, delight: 0.3 })));
    add(new THREE.Mesh(box, new CelMaterial({ vertexColors: true })));
    const instanced = new THREE.InstancedMesh(box, new CelMaterial({ color: 0xffffff }), 2);
    add(instanced);
    const tinted = new THREE.InstancedMesh(box, new CelMaterial({ color: 0xffffff, tintable: true }), 2);
    ensureInstanceTint(tinted);
    add(tinted);
    const tintedMap = new THREE.InstancedMesh(box, new CelMaterial({ map: tex, tintable: true, side: THREE.DoubleSide, delight: 0.3 }), 2);
    ensureInstanceTint(tintedMap);
    add(tintedMap);
    return group;
  }

  // ───────────── Internals ─────────────

  private resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.colorTarget.setSize(this.width, this.height);
    this.ink.setSize(this.width, this.height);
    let w = this.width, h = this.height;
    for (let i = 0; i < this.bloomDown.length; i++) {
      w = Math.max(1, Math.floor(w / 2)); h = Math.max(1, Math.floor(h / 2));
      this.bloomDown[i]!.setSize(w, h);
      if (i < this.bloomUp.length) this.bloomUp[i]!.setSize(w, h);
    }
    (this.composite.uniforms.uResolution!.value as THREE.Vector2).set(this.width, this.height);
  }

  private rebuildBloomTargets(): void {
    for (const t of this.bloomDown) t.dispose();
    for (const t of this.bloomUp) t.dispose();
    this.bloomDown.length = 0; this.bloomUp.length = 0;
    const levels = this.profile.bloomLevels;
    for (let i = 0; i < levels; i++) this.bloomDown.push(hdrTarget(`bloom-down-${i}`));
    for (let i = 0; i < levels - 1; i++) this.bloomUp.push(hdrTarget(`bloom-up-${i}`));
    if (this.width) this.resize(this.width, this.height);
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.quadCamera);
  }

  private renderBloom(): THREE.Texture {
    const g = this.grade;
    const levels = this.bloomDown.length;
    const pre = this.prefilter.uniforms;
    pre.tSource!.value = this.colorTarget.texture;
    (pre.uTexel!.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    (pre.uThreshold!.value as THREE.Vector3).set(g.bloomThreshold, Math.max(0.05, g.bloomThreshold * 0.5), 24);
    this.pass(this.prefilter, this.bloomDown[0]!);
    for (let i = 1; i < levels; i++) {
      const src = this.bloomDown[i - 1]!;
      this.down.uniforms.tSource!.value = src.texture;
      (this.down.uniforms.uTexel!.value as THREE.Vector2).set(0.5 / src.width, 0.5 / src.height);
      this.pass(this.down, this.bloomDown[i]!);
    }
    let source = this.bloomDown[levels - 1]!;
    for (let i = levels - 2; i >= 0; i--) {
      const u = this.up.uniforms;
      u.tSource!.value = source.texture;
      u.tDetail!.value = this.bloomDown[i]!.texture;
      (u.uTexel!.value as THREE.Vector2).set(0.5 / source.width, 0.5 / source.height);
      this.pass(this.up, this.bloomUp[i]!);
      source = this.bloomUp[i]!;
    }
    return source.texture;
  }

  private currentSpeed(): number {
    const s = this.speed;
    if (s.time <= 0) return 0;
    const elapsed = s.duration - s.time;
    const fadeIn = Math.min(1, elapsed / 0.08);
    const fadeOut = Math.min(1, s.time / Math.max(0.05, s.duration * 0.35));
    return s.strength * fadeIn * fadeOut;
  }

  private currentFlash(): number {
    const f = this.flashState;
    if (f.time <= 0) return 0;
    return f.strength * Math.pow(f.time / f.duration, 1.6);
  }

  private currentChroma(): number {
    const c = this.chroma;
    if (c.time <= 0) return 0;
    return c.strength * (c.time / c.duration);
  }

  private applyComposite(bloom: THREE.Texture): void {
    const u = this.composite.uniforms;
    const g = this.overrides.grade === false ? this.neutralGrade() : this.grade;
    u.tColor!.value = this.colorTarget.texture;
    u.tBloom!.value = bloom;
    u.uTime!.value = this.time;
    const levels = Math.max(1, this.bloomDown.length);
    u.uBloomStrength!.value = bloom === this.black ? 0 : g.bloomStrength * (2.2 / levels);
    const lightning = this.lightning;
    u.uExposure!.value = (this.overrides.exposure ?? g.exposure) * (1 + lightning * 0.55);
    (u.uLift!.value as THREE.Vector3).set(g.lift.r, g.lift.g, g.lift.b);
    (u.uGamma!.value as THREE.Vector3).copy(g.gamma);
    (u.uGain!.value as THREE.Vector3).set(g.gain.r, g.gain.g, g.gain.b);
    u.uSaturation!.value = g.saturation * (1 - lightning * 0.35);
    u.uContrast!.value = g.contrast;
    (u.uShadowTint!.value as THREE.Vector3).set(g.shadowTint.r, g.shadowTint.g, g.shadowTint.b);
    (u.uHighlightTint!.value as THREE.Vector3).set(g.highlightTint.r, g.highlightTint.g, g.highlightTint.b);
    u.uSplit!.value = g.split;
    (u.uVignette!.value as THREE.Vector4).set(g.vignetteColor.r, g.vignetteColor.g, g.vignetteColor.b, g.vignette);

    // Flash: explicit flashes plus lightning (cool white).
    const flash = this.currentFlash();
    const fc = this.flashState.color;
    const lf = lightning * 0.32;
    const total = Math.max(flash, lf);
    if (flash >= lf) (u.uFlash!.value as THREE.Vector4).set(fc.r, fc.g, fc.b, flash);
    else (u.uFlash!.value as THREE.Vector4).set(0.86, 0.92, 1.0, total);

    u.uChromatic!.value = this.currentChroma() * 0.012 * Math.max(0.3, this.screenFx);
    const speed = this.currentSpeed() * Math.max(0.35, this.screenFx);
    (u.uSpeed!.value as THREE.Vector4).set(speed, Math.floor(this.time * 30), 0.5, 0.5);
    if (this.impactFrames > 0) {
      const invert = this.impactFrames === 2 || (this.impactFrames === 1 && this.impactStrength < 0.75) ? 1 : 0;
      (u.uImpact!.value as THREE.Vector4).set(this.impactStrength, invert, 0.46, this.impactSeed);
    } else {
      (u.uImpact!.value as THREE.Vector4).set(0, 0, 0.46, 0);
    }
    (u.uRain!.value as THREE.Vector4).set(this.rain, this.windAngle, 1.7, 0);
  }

  private neutralGrade(): Grade {
    const g = this.scratchGrade;
    g.exposure = 1; g.lift.setRGB(0, 0, 0); g.gamma.set(1, 1, 1); g.gain.setRGB(1, 1, 1); g.saturation = 1; g.contrast = 1;
    g.shadowTint.setRGB(1, 1, 1); g.highlightTint.setRGB(1, 1, 1); g.split = 0; g.vignette = 0;
    g.bloomStrength = this.grade.bloomStrength; g.bloomThreshold = this.grade.bloomThreshold;
    return g;
  }

  dispose(): void {
    this.ink.overlay.removeFromParent();
    this.ink.dispose();
    this.colorTarget.dispose();
    for (const t of this.bloomDown) t.dispose();
    for (const t of this.bloomUp) t.dispose();
    for (const m of [this.prefilter, this.down, this.up, this.composite]) m.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
    this.dummies?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { (mesh.material as THREE.Material).dispose(); mesh.geometry.dispose(); }
    });
    stacks.delete(this.renderer);
  }
}
