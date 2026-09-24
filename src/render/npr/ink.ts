/**
 * Screen-space ink (LOOK-owned).
 *
 * One line language for everything flagged with markInk — hero ships, instanced enemies, skinned crew, islands, props —
 * and never for the ocean. Technique (after the owner's immersive-worlds ink pipeline):
 *
 *   1. Prepass into a half-float normal+depth target, in two draws that share one depth buffer:
 *      a. every opaque, depth-writing mesh that is NOT inked (the ocean, opaque FX) is drawn with its own material and
 *         colour writes off — depth only — so it hides whatever is behind it (a hull's underwater half never inks
 *         over the sea) and leaves "background" where it is visible;
 *      b. every inked mesh is drawn with a prepass material (octahedral view normal in RG, ink code in B, linear depth
 *         in A). Skinning, instancing, batching and morphs come from three's chunks.
 *   2. An overlay quad inside the main colour pass (first transparent object, after all opaque geometry) runs a
 *      Roberts cross on that buffer and blends navy ink into the HDR frame. Transparent FX drawn after it therefore
 *      cover the ink correctly, and bloom/grading see the ink like any other paint.
 *
 * Line weight: `width` px at 1080p (scaled with the drawing buffer), thinned with distance; creases (normal breaks)
 * are lighter and fade sooner; everything fades into the fog with the scene's own fog curve.
 */
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from '../materials/atmosphere';

export interface InkMarker {
  /** Line width multiplier (1 = default). */
  width: number;
  /** 0..1 crease (interior fold) line strength; silhouettes are always drawn. */
  crease: number;
}

/** Reads the ink marker set by markInk (toon.ts). `true` (legacy) means defaults. */
export function readInkMarker(object: THREE.Object3D): InkMarker | null {
  const value = object.userData.ink as InkMarker | boolean | undefined;
  if (!value) return null;
  if (value === true) return DEFAULT_MARKER;
  return value;
}
const DEFAULT_MARKER: InkMarker = { width: 1, crease: 1 };

const PREPASS_VERTEX = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vInkNormal;
varying vec3 vInkViewPosition;
#ifdef INK_ALPHA
uniform mat3 uInkUvTransform;
varying vec2 vInkUv;
#endif
void main() {
	#ifdef INK_ALPHA
		vInkUv = ( uInkUvTransform * vec3( uv, 1.0 ) ).xy;
	#endif
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	vInkNormal = transformedNormal;
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	vInkViewPosition = mvPosition.xyz;
}
`;

const PREPASS_FRAGMENT = /* glsl */ `
uniform float uInvFar;
uniform float uInkCode;
varying vec3 vInkNormal;
varying vec3 vInkViewPosition;
#ifdef INK_ALPHA
uniform sampler2D uInkAlphaMap;
uniform float uInkAlphaTest;
varying vec2 vInkUv;
#endif
void main() {
	#ifdef INK_ALPHA
		if ( texture2D( uInkAlphaMap, vInkUv ).a < uInkAlphaTest ) discard;
	#endif
	#ifdef INK_FLAT
		vec3 n = normalize( cross( dFdx( vInkViewPosition ), dFdy( vInkViewPosition ) ) );
	#else
		vec3 n = dot( vInkNormal, vInkNormal ) > 1e-10 ? normalize( vInkNormal ) : vec3( 0.0, 0.0, 1.0 );
		#ifdef INK_DOUBLE
			n *= gl_FrontFacing ? 1.0 : -1.0;
		#endif
	#endif
	// Octahedral encoding keeps the negative lobe in a plain RG pair.
	n /= abs( n.x ) + abs( n.y ) + abs( n.z );
	vec2 e = n.xy;
	if ( n.z < 0.0 ) e = ( 1.0 - abs( e.yx ) ) * ( step( vec2( 0.0 ), e ) * 2.0 - 1.0 );
	gl_FragColor = vec4( e * 0.5 + 0.5, uInkCode, clamp( -vInkViewPosition.z * uInvFar, 0.0, 1.0 ) );
}
`;

const OVERLAY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = position.xy * 0.5 + 0.5;
	gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const OVERLAY_FRAGMENT = /* glsl */ `
${ATMOSPHERE_GLSL}
uniform sampler2D tInk;
uniform vec2 uTexel;
uniform float uFar;
/** x: silhouette width (px), y: crease width (px), z: min width scale far away, w: strength. */
uniform vec4 uInkWidth;
/** x: thin start (m), y: thin end (m), z: depth threshold (relative), w: normal threshold. */
uniform vec4 uInkShape;
uniform float uCreaseStrength;
uniform vec3 uInkTint;
varying vec2 vUv;

vec3 inkDecode( vec2 f ) {
	f = f * 2.0 - 1.0;
	vec3 n = vec3( f, 1.0 - abs( f.x ) - abs( f.y ) );
	float t = clamp( -n.z, 0.0, 1.0 );
	n.xy += mix( vec2( t ), vec2( -t ), step( vec2( 0.0 ), n.xy ) );
	return normalize( n );
}

void main() {
	vec4 c = texture2D( tInk, vUv );
	// Find the nearest inked surface within the widest line reach, so pixels just outside a silhouette get the
	// outer half of its line at that surface's width.
	float reach = uInkWidth.x;
	vec4 best = c;
	vec2 o = uTexel * reach;
	vec4 t0 = texture2D( tInk, vUv + vec2( o.x, 0.0 ) );
	vec4 t1 = texture2D( tInk, vUv - vec2( o.x, 0.0 ) );
	vec4 t2 = texture2D( tInk, vUv + vec2( 0.0, o.y ) );
	vec4 t3 = texture2D( tInk, vUv - vec2( 0.0, o.y ) );
	if ( t0.b != 0.0 && ( best.b == 0.0 || t0.a < best.a ) ) best = t0;
	if ( t1.b != 0.0 && ( best.b == 0.0 || t1.a < best.a ) ) best = t1;
	if ( t2.b != 0.0 && ( best.b == 0.0 || t2.a < best.a ) ) best = t2;
	if ( t3.b != 0.0 && ( best.b == 0.0 || t3.a < best.a ) ) best = t3;
	if ( best.b == 0.0 ) discard;

	float code = abs( best.b );
	float creaseOn = best.b > 0.0 ? 1.0 : 0.0;
	float nearM = best.a * uFar;
	float thin = mix( 1.0, uInkWidth.z, smoothstep( uInkShape.x, uInkShape.y, nearM ) );
	float radius = clamp( uInkWidth.x * code * thin * 0.5, 0.5, uInkWidth.x );

	vec2 r = uTexel * radius;
	vec4 s0 = texture2D( tInk, vUv + vec2( -r.x, -r.y ) );
	vec4 s1 = texture2D( tInk, vUv + vec2(  r.x, -r.y ) );
	vec4 s2 = texture2D( tInk, vUv + vec2( -r.x,  r.y ) );
	vec4 s3 = texture2D( tInk, vUv + vec2(  r.x,  r.y ) );

	float nearest = min( min( s0.a, s1.a ), min( s2.a, s3.a ) );
	float depthDelta = abs( s0.a - s3.a ) + abs( s1.a - s2.a );
	vec3 nc = inkDecode( c.rg );
	float facing = c.b != 0.0 ? max( abs( nc.z ), 0.12 ) : 1.0;
	float thr = uInkShape.z * ( nearest + 0.002 ) / facing;
	float depthEdge = smoothstep( thr, thr * 2.2, depthDelta );

	float normalEdge = 0.0;
	if ( creaseOn > 0.5 && uCreaseStrength > 0.0 ) {
		vec3 n0 = inkDecode( s0.rg ), n1 = inkDecode( s1.rg ), n2 = inkDecode( s2.rg ), n3 = inkDecode( s3.rg );
		// Only between inked samples: background carries no normal.
		float valid = step( 1e-6, abs( s0.b ) ) * step( 1e-6, abs( s1.b ) ) * step( 1e-6, abs( s2.b ) ) * step( 1e-6, abs( s3.b ) );
		float nd = ( 1.0 - dot( n0, n3 ) ) + ( 1.0 - dot( n1, n2 ) );
		float creaseFade = 1.0 - smoothstep( uInkShape.x * 0.8, uInkShape.y * 0.9, nearM );
		normalEdge = smoothstep( uInkShape.w, uInkShape.w * 1.8, nd ) * valid * creaseFade * uCreaseStrength;
	}

	float ink = max( depthEdge, normalEdge );
	float fog = cruiseFogFactor( nearM );
	ink *= ( 1.0 - fog ) * uInkWidth.w;
	if ( ink < 0.004 ) discard;
	gl_FragColor = vec4( uCruiseInkColor * uInkTint, ink );
}
`;

export interface InkSettings {
  /** Silhouette width in px at 1080p. */
  width: number;
  /** Width multiplier far away (thinning). */
  farScale: number;
  thinStart: number;
  thinEnd: number;
  /** Relative depth jump that counts as a silhouette. */
  depthThreshold: number;
  /** Normal difference (Roberts sum of 1 - dot) that counts as a crease. */
  normalThreshold: number;
  creaseStrength: number;
  strength: number;
}

export const DEFAULT_INK: InkSettings = {
  width: 2.1, farScale: 0.55, thinStart: 140, thinEnd: 900,
  depthThreshold: 0.012, normalThreshold: 0.55, creaseStrength: 0.8, strength: 1,
};

interface Variant { material: THREE.ShaderMaterial; code: number }

/** Prepass clear: neutral +Z normal, no ink, far depth. Set in linear so the buffer receives exactly 0.5. */
const PREPASS_CLEAR = new THREE.Color().setRGB(0.5, 0.5, 0, THREE.LinearSRGBColorSpace);

export class InkPass {
  readonly target: THREE.WebGLRenderTarget;
  readonly overlay: THREE.Mesh;
  readonly overlayMaterial: THREE.ShaderMaterial;
  readonly settings: InkSettings = { ...DEFAULT_INK };
  enabled = true;
  private readonly variants = new Map<string, Variant>();
  private readonly inkMeshes: THREE.Mesh[] = [];
  private readonly inkMarkers: InkMarker[] = [];
  private readonly occluders: THREE.Mesh[] = [];
  private readonly hidden: THREE.Object3D[] = [];
  private readonly savedMaterials: (THREE.Material | THREE.Material[])[] = [];
  private readonly colorWriteOff: THREE.Material[] = [];
  private readonly savedOccluderMaterials: (THREE.Material | THREE.Material[])[] = [];
  private readonly occluderProxies = new Map<THREE.Material, THREE.ShaderMaterial>();
  private readonly clearColor = new THREE.Color();
  private scaleY = 1;
  /** Meshes drawn in the last prepass (diagnostics). */
  lastInked = 0;
  lastOccluders = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false, depthBuffer: true, stencilBuffer: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.target.texture.name = 'ink-normal-depth';
    this.overlayMaterial = new THREE.ShaderMaterial({
      name: 'ink-overlay',
      vertexShader: OVERLAY_VERTEX,
      fragmentShader: OVERLAY_FRAGMENT,
      uniforms: {
        ...atmosphereUniforms,
        tInk: { value: this.target.texture },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uFar: { value: 5000 },
        uInkWidth: { value: new THREE.Vector4(2, 1.4, 0.55, 1) },
        uInkShape: { value: new THREE.Vector4(140, 900, 0.012, 0.55) },
        uCreaseStrength: { value: 0.8 },
        uInkTint: { value: new THREE.Color(1, 1, 1) },
      },
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
      blending: THREE.NormalBlending,
    });
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.overlay = new THREE.Mesh(geometry, this.overlayMaterial);
    this.overlay.name = 'ink-overlay';
    this.overlay.frustumCulled = false;
    // First transparent draw: after every opaque surface, before any FX.
    this.overlay.renderOrder = -1e6;
    this.overlay.userData.inkSkip = true;
    this.overlay.userData.lookInternal = true;
    this.overlay.raycast = () => undefined;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    (this.overlayMaterial.uniforms.uTexel!.value as THREE.Vector2).set(1 / width, 1 / height);
    this.scaleY = height / 1080;
  }

  /** Prepass material for a mesh (cached per side/alpha/flat/marker). Null = leave the mesh out of the prepass. */
  variantFor(mesh: THREE.Mesh, marker: InkMarker): THREE.ShaderMaterial | null {
    const base = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
    if (!base || base.visible === false) return null;
    if (base.transparent && !(base.alphaTest > 0)) return null;
    const double = base.side === THREE.DoubleSide;
    const alphaMap = base.alphaTest > 0 ? (base.map ?? base.alphaMap ?? null) : null;
    const flat = base.flatShading === true;
    const code = Math.max(0.25, Math.min(3, marker.width)) * (marker.crease > 0.01 ? 1 : -1);
    const key = `${double ? 'd' : 'f'}${flat ? 'F' : ''}|${alphaMap ? alphaMap.uuid : '-'}|${code.toFixed(2)}`;
    let variant = this.variants.get(key);
    if (!variant) {
      const defines: Record<string, string> = {};
      if (double) defines.INK_DOUBLE = '';
      if (flat) defines.INK_FLAT = '';
      if (alphaMap) defines.INK_ALPHA = '';
      const material = new THREE.ShaderMaterial({
        name: `ink-prepass:${key}`,
        vertexShader: PREPASS_VERTEX,
        fragmentShader: PREPASS_FRAGMENT,
        defines,
        uniforms: {
          uInvFar: { value: 1 / 5000 },
          uInkCode: { value: code },
          uInkAlphaMap: { value: alphaMap },
          uInkAlphaTest: { value: base.alphaTest > 0 ? base.alphaTest : 0.5 },
          uInkUvTransform: { value: alphaMap ? alphaMap.matrix : new THREE.Matrix3() },
        },
        side: double ? THREE.DoubleSide : THREE.FrontSide,
        fog: false, lights: false,
      });
      variant = { material, code };
      this.variants.set(key, variant);
    }
    return variant.material;
  }

  private collect(object: THREE.Object3D, marker: InkMarker | null): void {
    if (!object.visible) return;
    const ud = object.userData;
    if (ud.inkSkip === true) { this.hide(object); return; }
    const own = readInkMarker(object);
    const current = ud.noInk === true ? null : own ?? marker;
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      if (current) {
        this.inkMeshes.push(mesh);
        this.inkMarkers.push(current);
      } else if (ud.inkOccluder !== false && isOpaqueDepthWriter(mesh.material)) {
        this.occluders.push(mesh);
      } else {
        this.hide(mesh);
      }
    } else if ((object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite) {
      this.hide(object);
    }
    const children = object.children;
    for (let i = 0; i < children.length; i++) this.collect(children[i]!, ud.noInk === true ? null : current);
  }

  private hide(object: THREE.Object3D): void {
    if (!object.visible) return;
    object.visible = false;
    this.hidden.push(object);
  }

  /** Renders the normal+depth prepass. Call before the main colour pass. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const s = this.settings;
    const u = this.overlayMaterial.uniforms;
    u.uFar!.value = camera.far;
    (u.uInkWidth!.value as THREE.Vector4).set(s.width * this.scaleY, s.width * 0.7 * this.scaleY, s.farScale, this.enabled ? s.strength : 0);
    (u.uInkShape!.value as THREE.Vector4).set(s.thinStart, s.thinEnd, s.depthThreshold, s.normalThreshold);
    u.uCreaseStrength!.value = s.creaseStrength;
    this.overlay.visible = this.enabled;
    if (!this.enabled) return;

    this.inkMeshes.length = 0; this.inkMarkers.length = 0; this.occluders.length = 0; this.hidden.length = 0;
    this.savedMaterials.length = 0; this.colorWriteOff.length = 0; this.savedOccluderMaterials.length = 0;
    this.collect(scene, null);
    this.lastInked = this.inkMeshes.length;
    this.lastOccluders = this.occluders.length;

    const invFar = 1 / camera.far;
    for (const variant of this.variants.values()) variant.material.uniforms.uInvFar!.value = invFar;

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    const previousAlpha = renderer.getClearAlpha();
    const previousBackground = scene.background;
    // A colour background would be cleared into the buffer; fog stays (it is part of the program key).
    scene.background = null;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(PREPASS_CLEAR, 1);
    renderer.autoClear = false;
    renderer.clear(true, true, false);

    try {
      // a. Depth-only occluders (ocean, opaque FX): hide inked meshes, colour writes off. ShaderMaterials (the ocean)
      //    draw through a proxy with their own vertex shader and live uniforms but an empty fragment shader.
      for (const mesh of this.inkMeshes) mesh.visible = false;
      for (const mesh of this.occluders) {
        const proxy = this.occluderMaterialFor(mesh);
        this.savedOccluderMaterials.push(mesh.material);
        if (proxy) { mesh.material = proxy; continue; }
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) if (m.colorWrite) { m.colorWrite = false; this.colorWriteOff.push(m); }
      }
      try {
        if (this.occluders.length) renderer.render(scene, camera);
      } finally {
        for (const m of this.colorWriteOff) m.colorWrite = true;
        for (let i = 0; i < this.occluders.length; i++) this.occluders[i]!.material = this.savedOccluderMaterials[i]!;
      }

      // b. Inked meshes with their prepass variant; occluders hidden (their depth stays in the buffer).
      for (const mesh of this.occluders) mesh.visible = false;
      let drawn = 0;
      for (let i = 0; i < this.inkMeshes.length; i++) {
        const mesh = this.inkMeshes[i]!;
        const variant = this.variantFor(mesh, this.inkMarkers[i]!);
        this.savedMaterials.push(mesh.material);
        if (variant) { mesh.material = variant; mesh.visible = true; drawn++; }
      }
      if (drawn) renderer.render(scene, camera);
    } finally {
      for (let i = 0; i < this.inkMeshes.length; i++) {
        const mesh = this.inkMeshes[i]!;
        const saved = this.savedMaterials[i];
        if (saved !== undefined) mesh.material = saved;
        mesh.visible = true;
      }
      for (const mesh of this.occluders) mesh.visible = true;
      for (const object of this.hidden) object.visible = true;
      scene.background = previousBackground;
      renderer.setClearColor(this.clearColor, previousAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
    }
  }

  /**
   * Depth-only material for a non-inked occluder: `userData.inkDepthMaterial` if the owner supplies one, else a proxy
   * for ShaderMaterials (same vertex shader, defines and live uniform objects; empty fragment), else null (the mesh's
   * own material is drawn with colour writes off).
   */
  occluderMaterialFor(mesh: THREE.Mesh): THREE.Material | null {
    const own = mesh.userData.inkDepthMaterial as THREE.Material | undefined;
    if (own) return own;
    const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const src = base as THREE.ShaderMaterial | undefined;
    if (!src || !src.isShaderMaterial || (src as unknown as THREE.RawShaderMaterial).isRawShaderMaterial || Array.isArray(mesh.material)) return null;
    let proxy = this.occluderProxies.get(src);
    if (!proxy) {
      const glsl3 = src.glslVersion === THREE.GLSL3;
      proxy = new THREE.ShaderMaterial({
        name: `ink-occluder:${src.name}`,
        vertexShader: src.vertexShader,
        fragmentShader: glsl3 ? 'out highp vec4 inkOccluderOut;\nvoid main() { inkOccluderOut = vec4( 0.0 ); }' : 'void main() { gl_FragColor = vec4( 0.0 ); }',
        uniforms: src.uniforms,
        defines: src.defines,
        glslVersion: src.glslVersion,
        side: src.side,
        fog: false, lights: false, colorWrite: false, depthWrite: true, depthTest: true,
      });
      proxy.onBeforeRender = src.onBeforeRender.bind(src);
      this.occluderProxies.set(src, proxy);
      src.addEventListener('dispose', () => { proxy?.dispose(); this.occluderProxies.delete(src); });
    }
    return proxy;
  }

  /** Every prepass material currently cached (for warm-up). */
  materials(): THREE.ShaderMaterial[] { return [...this.variants.values()].map((v) => v.material); }

  dispose(): void {
    this.target.dispose();
    this.overlayMaterial.dispose();
    this.overlay.geometry.dispose();
    for (const v of this.variants.values()) v.material.dispose();
    this.variants.clear();
    for (const p of this.occluderProxies.values()) p.dispose();
    this.occluderProxies.clear();
  }
}

function isOpaqueDepthWriter(material: THREE.Material | THREE.Material[]): boolean {
  const list = Array.isArray(material) ? material : [material];
  for (const m of list) if (m.visible !== false && !m.transparent && m.depthWrite && m.colorWrite) return true;
  return false;
}
