/**
 * Toon material API (LOOK-owned; signatures are contract). Every mesh in the game — hero ships, enemies,
 * islands, props, crew — gets its material from here so the whole frame shares one shading model.
 * Stub implementation: MeshToonMaterial with a 3-band ramp. LOOK replaces the internals.
 */
import * as THREE from 'three';

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
}

let ramp: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export function createToonMaterial(opts: ToonOptions = {}): THREE.Material {
  return new THREE.MeshToonMaterial({
    name: opts.name ?? 'toon',
    color: opts.color ?? 0xffffff,
    map: opts.map ?? null,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    vertexColors: opts.vertexColors ?? false,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    gradientMap: toonRamp(),
  });
}

export interface ToonifyOptions {
  /** Keep albedo maps from the source (true for downloaded models). */
  keepMaps?: boolean;
  /** Normal-map strength cap (0 drops normal maps). */
  normalScale?: number;
  rim?: number;
  tintable?: boolean;
  doubleSided?: boolean;
}

/** Converts every material under `root` to the shared toon model in place (textures are reused, not copied). */
export function toonifyObject(root: THREE.Object3D, opts: ToonifyOptions = {}): void {
  const converted = new Map<THREE.Material, THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const convert = (material: THREE.Material): THREE.Material => {
      const cached = converted.get(material);
      if (cached) return cached;
      const source = material as THREE.MeshStandardMaterial;
      const toon = createToonMaterial({
        color: source.color ?? 0xffffff,
        map: opts.keepMaps === false ? null : source.map ?? null,
        emissive: source.emissive ?? 0x000000,
        emissiveIntensity: Math.min(1, source.emissiveIntensity ?? 0),
        vertexColors: source.vertexColors,
        transparent: source.transparent,
        opacity: source.opacity,
        side: opts.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
        rim: opts.rim, tintable: opts.tintable, name: `toon:${material.name}`,
      });
      converted.set(material, toon);
      return toon;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
}

/**
 * Marks an object as inked (outlined). The LOOK implementation decides the technique (screen-space ink via a
 * layer, or inverted hull). Call once after the object is built; safe to call on groups.
 */
export function markInk(root: THREE.Object3D, _opts: { width?: number; color?: THREE.ColorRepresentation } = {}): void {
  root.userData.ink = true;
}

/** Per-instance tint uniforms for hit flash / elite glow / wraith spectral look (LOOK implements in shader). */
export interface ShipTint { flash: number; glow: THREE.Color; glowStrength: number; spectral: number }
