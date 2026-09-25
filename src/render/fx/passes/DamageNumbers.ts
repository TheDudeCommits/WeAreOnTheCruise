/**
 * Damage numbers in WebGL: a glyph atlas generated at load (bold italic digits with a navy ink stroke, fill in
 * R and stroke in G) drawn as screen-space instanced quads anchored to world points (one draw call).
 * Rapid hits on the same target merge into one rolling number; crits are bigger, golden and punch in.
 * Declutter (round 2): a number stays hidden while its (merged) total is under the caller's `minShow` (3% of the
 * target's hull) unless it is a crit or a killing blow, and ordinary hits within 12 m of a young number merge into it
 * (a skiff pack shows one rolling total, not a row of 8s).
 */
import * as THREE from 'three';
import { OUTPUT_GLSL, type FxSharedUniforms } from '../core/glsl';
import { InstancePool } from '../core/InstancePool';
import { hash01 } from '../core/rand';

const GLYPHS = '0123456789+!-';
const CELL_W = 64;
const CELL_H = 88;

function buildAtlas(): THREE.DataTexture {
  const width = CELL_W * GLYPHS.length;
  const height = CELL_H;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const g = c.getContext('2d')!;
    g.font = 'italic 900 64px "Arial Black", "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    return { c, g };
  };
  const fill = make();
  const stroke = make();
  for (let i = 0; i < GLYPHS.length; i++) {
    const x = i * CELL_W + CELL_W / 2;
    const y = CELL_H / 2 + 3;
    stroke.g.lineWidth = 13;
    stroke.g.strokeStyle = '#fff';
    stroke.g.strokeText(GLYPHS[i]!, x, y);
    stroke.g.fillStyle = '#fff';
    stroke.g.fillText(GLYPHS[i]!, x, y);
    fill.g.fillStyle = '#fff';
    fill.g.fillText(GLYPHS[i]!, x, y);
  }
  const a = fill.g.getImageData(0, 0, width, height).data;
  const b = stroke.g.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = ((height - 1 - y) * width + x) * 4; // flip Y for GL
      const dst = (y * width + x) * 4;
      data[dst] = a[src + 3]!;
      data[dst + 1] = b[src + 3]!;
      data[dst + 2] = 0;
      data[dst + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const vertexShader = /* glsl */ `
attribute vec2 corner;
attribute vec4 nA; // anchor.xyz, t0
attribute vec4 nB; // glyph, offset (glyph widths), scale, life
attribute vec4 nC; // color.rgb, crit
uniform float uTime;
uniform vec2 uViewport;
uniform float uGlyphPx;
varying vec2 vUv;
varying vec3 vColor;
varying float vCrit;
varying float vAlpha;
void main() {
  float age = uTime - nA.w;
  float t = age / max(nB.w, 1e-3);
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 clip = projectionMatrix * viewMatrix * vec4(nA.xyz, 1.0);
  if (clip.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float crit = nC.w;
  float pop = age < 0.07 ? mix(0.3, crit > 0.5 ? 1.75 : 1.4, age / 0.07) : age < 0.2 ? mix(crit > 0.5 ? 1.75 : 1.4, 1.0, (age - 0.07) / 0.13) : 1.0;
  float shrink = 1.0 - smoothstep(0.78, 1.0, t) * 0.6;
  float px = uGlyphPx * nB.z * pop * shrink;
  vec2 offPx = vec2(nB.y * 0.5 * px + corner.x * 0.5 * ${(CELL_W / CELL_H).toFixed(4)} * px, corner.y * 0.5 * px);
  offPx.y += 26.0 * (1.0 - pow(1.0 - min(t * 1.6, 1.0), 3.0)) + 8.0 * crit * sin(min(age * 20.0, 3.14159));
  clip.xy += offPx / (uViewport * 0.5) * clip.w;
  clip.z = -clip.w * 0.999; // drawn on top (depth test is off); never clipped by the far plane
  gl_Position = clip;
  vUv = vec2((nB.x + corner.x * 0.5 + 0.5) / ${GLYPHS.length}.0, corner.y * 0.5 + 0.5);
  vColor = nC.rgb;
  vCrit = crit;
  vAlpha = 1.0 - smoothstep(0.8, 1.0, t);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec3 vColor;
varying float vCrit;
varying float vAlpha;
const vec3 INK = vec3(0.0116, 0.0168, 0.0513);
void main() {
  vec4 s = texture2D(uAtlas, vUv);
  float fill = s.r;
  float stroke = s.g;
  float a = max(fill, stroke) * vAlpha;
  if (a < 0.02) discard;
  float y = fract(vUv.y);
  vec3 fillCol = vColor * mix(1.0, 1.45, smoothstep(0.35, 0.75, y) * (0.4 + vCrit));
  vec3 col = mix(INK, fillCol, fill);
  gl_FragColor = vec4(col, 1.0);
  ${OUTPUT_GLSL}
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}
`;

interface NumberRecord {
  target: number; value: number; crit: boolean; x: number; y: number; z: number; age: number; life: number; color: number; merged: number;
  /** Declutter: hidden until `value` reaches `minShow` (or a crit / kill joins). */
  hidden: boolean; minShow: number;
}

/** Ordinary hits this close (m) to a young number merge into it, whatever ship they hit. */
const AREA_MERGE = 12;

const MAX_RECORDS = 160;
const MAX_DIGITS = 7;

export class DamageNumbers {
  readonly mesh: THREE.Mesh;
  private readonly pool: InstancePool;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly records: NumberRecord[] = [];
  private readonly digits = new Int8Array(MAX_DIGITS);
  private readonly color = new THREE.Color();
  enabled = true;
  /** QA counters: numbers the pre-round-2 rule would have spawned (one per target per 0.32 s) vs numbers shown now. */
  readonly counts = { legacy: 0, shown: 0 };

  constructor(shared: FxSharedUniforms) {
    for (let i = 0; i < MAX_RECORDS; i++) this.records.push({ target: -1, value: 0, crit: false, x: 0, y: 0, z: 0, age: 1e9, life: 1, color: 0xffffff, merged: 0, hidden: false, minShow: 0 });
    this.pool = new InstancePool(12, 0, MAX_RECORDS * (MAX_DIGITS + 1));
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pool.attach(g, 'nA', 4, 0);
    this.pool.attach(g, 'nB', 4, 4);
    this.pool.attach(g, 'nC', 4, 8);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'fx-damage-numbers',
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uViewport: shared.uViewport,
        uGlyphPx: { value: 30 },
        uAtlas: { value: buildAtlas() },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'fx-damage-numbers';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 100;
  }

  /**
   * Adds damage to a target; merges with its live number while it is young (same target, or any ordinary hit within
   * 12 m). `minShow`: the number stays hidden until its total reaches it; `force` (crit, killing blow) shows it now.
   */
  add(target: number, amount: number, crit: boolean, x: number, y: number, z: number, hex: number, minShow = 0, force = false): void {
    if (!this.enabled || amount <= 0) return;
    let free: NumberRecord | null = null;
    let oldest: NumberRecord | null = null;
    let near: NumberRecord | null = null;
    let nearD = AREA_MERGE * AREA_MERGE;
    // the old rule: a new number unless this target has a young one (the merged area record counts as its own)
    let legacyMerge = false;
    for (const r of this.records) if (r.target === target && r.crit === crit && r.age < 0.32 && r.color === hex && target >= 0) legacyMerge = true;
    if (!legacyMerge) this.counts.legacy++;
    for (const r of this.records) {
      if (r.target === target && r.crit === crit && r.age < 0.32 && r.color === hex && target >= 0) {
        r.value += amount; r.age = Math.min(r.age, 0.05); r.merged++; r.x = x; r.y = y; r.z = z;
        if (r.hidden && (force || r.value >= r.minShow)) { r.hidden = false; this.counts.shown++; }
        return;
      }
      if (!crit && !r.crit && target >= 0 && r.target >= 0 && r.color === hex && r.age < 0.32) {
        const d = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z);
        if (d < nearD) { nearD = d; near = r; }
      }
      if (r.age >= r.life) { if (!free) free = r; }
      else if (!oldest || r.age > oldest.age) oldest = r;
    }
    if (near) {
      // area merge: the pack's number rolls up in place (its anchor stays put)
      near.value += amount; near.age = Math.min(near.age, 0.05); near.merged++;
      near.minShow = Math.min(near.minShow, minShow);
      if (near.hidden && (force || near.value >= near.minShow)) { near.hidden = false; this.counts.shown++; }
      return;
    }
    const r = free ?? oldest;
    if (!r) return;
    r.target = target; r.value = amount; r.crit = crit; r.x = x; r.y = y; r.z = z; r.age = 0;
    r.life = crit ? 1.15 : 0.85; r.color = hex; r.merged = 0;
    r.minShow = minShow; r.hidden = !force && !crit && amount < minShow;
    if (!r.hidden) this.counts.shown++;
  }

  update(dt: number, clock: number, glyphPx: number): void {
    this.material.uniforms.uTime!.value = clock;
    this.material.uniforms.uGlyphPx!.value = glyphPx;
    this.pool.beginFrame();
    const d = this.pool.data;
    for (const r of this.records) {
      if (r.age >= r.life) continue;
      r.age += dt;
      if (r.age >= r.life || r.hidden) continue;
      let v = Math.min(9999999, Math.max(1, Math.round(r.value)));
      let n = 0;
      while (v > 0 && n < MAX_DIGITS) { this.digits[n++] = v % 10; v = (v / 10) | 0; }
      const scale = (r.crit ? 1.45 : 1) * (1 + Math.min(0.5, Math.log10(Math.max(1, r.value)) * 0.12));
      this.color.setHex(r.color);
      const jitter = (hash01(r.target, 7) - 0.5) * 1.4;
      const total = n + (r.crit ? 1 : 0);
      for (let i = 0; i < total; i++) {
        const o = this.pool.allocImm();
        if (o < 0) break;
        const glyph = r.crit && i === total - 1 ? 11 : this.digits[n - 1 - i]!;
        d[o] = r.x; d[o + 1] = r.y; d[o + 2] = r.z; d[o + 3] = clock - r.age;
        d[o + 4] = glyph; d[o + 5] = i - (total - 1) * 0.5 + jitter; d[o + 6] = scale; d[o + 7] = r.life;
        d[o + 8] = this.color.r; d[o + 9] = this.color.g; d[o + 10] = this.color.b; d[o + 11] = r.crit ? 1 : 0;
      }
    }
    this.geometry.instanceCount = this.pool.flush();
  }

  clear(): void { for (const r of this.records) { r.age = 1e9; r.hidden = false; } }

  /** Numbers on screen now (visible records) — QA. */
  visibleCount(): number { let n = 0; for (const r of this.records) if (r.age < r.life && !r.hidden) n++; return n; }

  dispose(): void {
    this.geometry.dispose();
    (this.material.uniforms.uAtlas!.value as THREE.Texture).dispose();
    this.material.dispose();
  }
}
