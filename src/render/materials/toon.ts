/**
 * Toon material API (LOOK-owned; signatures are contract). Every mesh in the game — hero ships, enemies,
 * islands, props, crew — gets its material from here so the whole frame shares one shading model.
 *
 * Implementation: CelMaterial (./celMaterial.ts) — 2 hard bands + a soft core band with fwidth anti-aliasing, cool
 * blue-violet shadows, lit-side rim, HDR emissive, albedo maps, vertex colours, skinning, instancing (instanceColor
 * carries ShipTint on tintable materials), fog and shadow maps, lit by the shared atmosphere uniforms.
 *
 * Quick reference for other modules:
 *   createToonMaterial({ color, map, rim, tintable, emissive, emissiveIntensity })   → CelMaterial
 *   toonifyObject(gltf.scene, { keepMaps: true, ...HERO_TOON_PRESETS[key] })          → converts in place
 *   markInk(root) / markInk(root, { width: 1.3, crease: 0.5 })                        → screen-space ink outlines
 *   markNoInk(fxMesh)                                                                  → explicitly never inked
 *   setShipTint(root, { flash, glow, glowStrength, spectral })                         → per-object hit flash/glow
 *   ensureInstanceTint(instancedMesh); setInstanceTint(mesh, i, flash, glow, spectral) → per-instance ShipTint
 */
import * as THREE from 'three';
import type { HeroModelKey } from '../../game/ids';
import { CelMaterial, isCelMaterial } from './celMaterial';

export { CelMaterial, isCelMaterial } from './celMaterial';

export interface ToonOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  /** 0..1 rim light strength (characters ~0.6, ships ~0.35, terrain ~0.15). */
  rim?: number;
  /** Receive the ship hit-flash/damage uniforms (see ShipTint). */
  tintable?: boolean;
  name?: string;
  // ── Optional extras (LOOK additions; all backwards compatible) ──
  emissiveMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  /** Normal-map strength (capped at 0.3; the look wants ~0.15). */
  normalScale?: number;
  aoMap?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  alphaTest?: number;
  depthWrite?: boolean;
  flatShading?: boolean;
  /** 0..1 hard-edged highlight shapes (brass, wet wood). */
  specular?: number;
  /** 0..1 taming of lighting baked into `map` (see HERO_TOON_PRESETS). */
  delight?: number;
  saturation?: number;
  gain?: number;
}

export function createToonMaterial(opts: ToonOptions = {}): THREE.Material {
  const material = new CelMaterial({
    name: opts.name ?? 'toon',
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    emissiveMap: opts.emissiveMap ?? null,
    normalMap: opts.normalMap ?? null,
    aoMap: opts.aoMap ?? null,
    alphaMap: opts.alphaMap ?? null,
    alphaTest: opts.alphaTest ?? 0,
    vertexColors: opts.vertexColors ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    flatShading: opts.flatShading ?? false,
    rim: opts.rim ?? 0.3,
    specular: opts.specular ?? 0,
    tintable: opts.tintable ?? false,
    delight: opts.delight, saturation: opts.saturation, gain: opts.gain,
  });
  if (opts.depthWrite !== undefined) material.depthWrite = opts.depthWrite;
  if (opts.normalMap) {
    const s = Math.min(0.3, opts.normalScale ?? 0.15);
    material.normalScale.set(s, s);
  }
  return material;
}

export interface ToonifyOptions {
  /** Keep albedo maps from the source (true for downloaded models). */
  keepMaps?: boolean;
  /** Normal-map strength cap (0 drops normal maps). */
  normalScale?: number;
  rim?: number;
  tintable?: boolean;
  doubleSided?: boolean;
  // ── Optional extras (LOOK additions) ──
  /** 0..1 taming of lighting baked into albedo maps (default 0.3 when a map is kept). */
  delight?: number;
  /** Albedo saturation multiplier (default 1). */
  saturation?: number;
  /** Albedo gain (default 1). */
  gain?: number;
  /** Cap for source emissive intensity (default 1.2; lanterns that should bloom want ~3). */
  emissiveCap?: number;
  /** Hard highlight strength for metallic source materials (default 0.4; 0 disables). */
  metalSpecular?: number;
  /** Keep AO maps as crevice ink (default true). */
  keepAo?: boolean;
}

/** Converts every material under `root` to the shared toon model in place (textures are reused, not copied). */
export function toonifyObject(root: THREE.Object3D, opts: ToonifyOptions = {}): void {
  const converted = new Map<THREE.Material, THREE.Material>();
  const normalCap = opts.normalScale ?? 0.15;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (material: THREE.Material): THREE.Material => {
      const cached = converted.get(material);
      if (cached) return cached;
      let result: THREE.Material;
      if (isCelMaterial(material)) {
        if (opts.rim !== undefined) material.rim = opts.rim;
        if (opts.tintable !== undefined) material.tintable = opts.tintable;
        if (opts.delight !== undefined || opts.saturation !== undefined || opts.gain !== undefined) {
          material.setLevels(opts.delight ?? 0, opts.saturation ?? 1, opts.gain ?? 1);
        }
        result = material;
      } else {
        result = convertMaterial(material, opts, normalCap);
      }
      converted.set(material, result);
      return result;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
}

type AnySource = THREE.Material & Partial<{
  color: THREE.Color; map: THREE.Texture | null; emissive: THREE.Color; emissiveMap: THREE.Texture | null;
  emissiveIntensity: number; normalMap: THREE.Texture | null; normalScale: THREE.Vector2; aoMap: THREE.Texture | null;
  aoMapIntensity: number; alphaMap: THREE.Texture | null; metalness: number; flatShading: boolean; vertexColors: boolean;
}>;

function convertMaterial(material: THREE.Material, opts: ToonifyOptions, normalCap: number): CelMaterial {
  const source = material as AnySource;
  const keepMaps = opts.keepMaps !== false;
  const map = keepMaps ? source.map ?? null : null;
  const cel = new CelMaterial({
    name: `toon:${material.name}`,
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    map,
    vertexColors: source.vertexColors ?? false,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
    alphaMap: keepMaps ? source.alphaMap ?? null : null,
    depthWrite: source.depthWrite,
    side: opts.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
    flatShading: source.flatShading ?? false,
    rim: opts.rim ?? 0.35,
    tintable: opts.tintable ?? false,
    specular: (source.metalness ?? 0) > 0.5 ? opts.metalSpecular ?? 0.4 : 0,
  });
  const emissive = source.emissive;
  if (emissive && (emissive.r > 0 || emissive.g > 0 || emissive.b > 0)) {
    cel.emissive.copy(emissive);
    cel.emissiveIntensity = Math.min(opts.emissiveCap ?? 1.2, source.emissiveIntensity ?? 1);
    cel.emissiveMap = keepMaps ? source.emissiveMap ?? null : null;
  }
  if (keepMaps && normalCap > 0 && source.normalMap) {
    cel.normalMap = source.normalMap;
    const sx = source.normalScale?.x ?? 1, sy = source.normalScale?.y ?? 1;
    cel.normalScale.set(Math.sign(sx || 1) * Math.min(Math.abs(sx), normalCap), Math.sign(sy || 1) * Math.min(Math.abs(sy), normalCap));
  }
  if (keepMaps && opts.keepAo !== false && source.aoMap) {
    cel.aoMap = source.aoMap;
    cel.aoMapIntensity = Math.min(1, source.aoMapIntensity ?? 1);
  }
  const delight = opts.delight ?? (map ? 0.3 : 0);
  cel.setLevels(delight, opts.saturation ?? 1, opts.gain ?? 1);
  return cel;
}

/**
 * Per-hero toonify presets tuned in lab/look.html against the six downloaded models (their textures carry baked
 * light and very different value ranges). SHIPS: `toonifyObject(instance, { keepMaps: true, ...HERO_TOON_PRESETS[key] })`.
 */
export const HERO_TOON_PRESETS: Readonly<Record<HeroModelKey, ToonifyOptions>> = {
  'going-merry': { delight: 0.45, saturation: 1.08, gain: 1.02, rim: 0.35 },
  'thousand-sunny': { delight: 0.25, saturation: 1.05, gain: 1.0, rim: 0.35 },
  'polar-tang': { delight: 0.5, saturation: 1.0, gain: 0.94, rim: 0.3 },
  baratie: { delight: 0.2, saturation: 1.05, gain: 1.0, rim: 0.3 },
  'navy-galleon': { delight: 0.55, saturation: 1.05, gain: 1.04, rim: 0.3 },
  'moby-dick': { delight: 0.2, saturation: 1.05, gain: 1.0, rim: 0.3 },
};

export interface InkOptions {
  /** Line width multiplier (1 = default ~2 px at 1080p). */
  width?: number;
  /** Colour is global (navy, graded per time of day); kept for API compatibility. */
  color?: THREE.ColorRepresentation;
  /** 0..1 interior crease lines (0 = silhouettes only; islands with faceted geometry may want 0). */
  crease?: number;
}

/**
 * Marks an object as inked (outlined). The LOOK implementation decides the technique (screen-space ink via a
 * layer, or inverted hull). Call once after the object is built; safe to call on groups.
 * Technique: screen-space normal+depth ink (src/render/npr/ink.ts); children inherit the marker. Works for
 * InstancedMesh and SkinnedMesh. Opaque meshes that are not inked (the ocean) still hide ink behind them.
 */
export function markInk(root: THREE.Object3D, opts: InkOptions = {}): void {
  root.userData.ink = { width: opts.width ?? 1, crease: opts.crease ?? 1 };
  delete root.userData.noInk;
}

/** Explicitly excludes a subtree from ink (it still occludes if it is opaque). */
export function markNoInk(root: THREE.Object3D): void {
  root.userData.noInk = true;
  delete root.userData.ink;
}

/** Excludes a subtree from the ink prepass entirely (no ink, no occlusion) — e.g. huge helper volumes. */
export function markInkSkip(root: THREE.Object3D): void {
  root.userData.inkSkip = true;
}

/** Per-instance tint uniforms for hit flash / elite glow / wraith spectral look (LOOK implements in shader). */
export interface ShipTint { flash: number; glow: THREE.Color; glowStrength: number; spectral: number }

/**
 * Applies a ShipTint to every tintable CelMaterial under `root` (per material: toonify each ship instance separately
 * when ships must flash independently). Cheap: uniform writes only.
 */
export function setShipTint(root: THREE.Object3D, tint: Partial<ShipTint>): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (!isCelMaterial(m)) continue;
      const v = m.cel.uCelTint.value;
      v.set(tint.flash ?? v.x, tint.glowStrength ?? v.y, tint.spectral ?? v.z);
      if (tint.glow) m.cel.uCelGlowColor.value.copy(tint.glow);
    }
  });
}

/**
 * Prepares an InstancedMesh for per-instance ShipTint: creates `instanceColor` filled with zeros (three's own
 * setColorAt would fill it with ones = full flash). Call before the first render (it changes the shader variant).
 * The material must be tintable (createToonMaterial({ tintable: true })).
 */
export function ensureInstanceTint(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  if (!mesh.instanceColor) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  return mesh.instanceColor;
}

/** Writes one instance's tint: r = hit flash 0..1, g = glow strength 0..1 (material glow colour), b = spectral 0..1. */
export function setInstanceTint(mesh: THREE.InstancedMesh, index: number, flash: number, glowStrength = 0, spectral = 0): void {
  const attribute = ensureInstanceTint(mesh);
  const array = attribute.array as Float32Array;
  array[index * 3] = flash;
  array[index * 3 + 1] = glowStrength;
  array[index * 3 + 2] = spectral;
  attribute.needsUpdate = true;
}

/** Sets the glow colour used by instanced glow (elites) on every CelMaterial of `root`. */
export function setGlowColor(root: THREE.Object3D, color: THREE.ColorRepresentation): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) if (isCelMaterial(m)) m.cel.uCelGlowColor.value.set(color);
  });
}
