/**
 * Shared world materials (WORLD-owned). Created once; every island reuses them so programs compile once and the
 * night glow / waterfall flow is one uniform write per frame.
 */
import * as THREE from 'three';
import { createToonMaterial, markInk } from '../materials/toon';
import { flagTexture, waterfallTexture } from './textures';

export interface WorldMaterials {
  /** Vertex-coloured terrain + kit (stone, wood, plaster, roofs, canopy, rocks). */
  terrain: THREE.Material;
  /** Windows, lanterns, lighthouse lamps (warm emissive, scaled by night). */
  lamp: THREE.Material;
  /** Volcanic vents and crater lava (red-orange emissive). */
  lava: THREE.Material;
  /** Instanced vegetation (palms, trees, bushes). */
  foliage: THREE.Material;
  /** Waterfall ribbons (scrolling strands). */
  waterfall: THREE.Material;
  /** Admiralty flags (instanced, waving). */
  flag: THREE.Material;
  /** Lighthouse beams at night (additive, unlit). */
  beam: THREE.MeshBasicMaterial;
  all: THREE.Material[];
}

export function createWorldMaterials(): WorldMaterials {
  const terrain = createToonMaterial({ vertexColors: true, rim: 0.12, name: 'world-terrain' });
  const lamp = createToonMaterial({ vertexColors: true, emissive: 0xffb45a, emissiveIntensity: 0.1, rim: 0, name: 'world-lamp' });
  const lava = createToonMaterial({ vertexColors: true, emissive: 0xff5a1f, emissiveIntensity: 0.9, rim: 0, name: 'world-lava' });
  const foliage = createToonMaterial({ vertexColors: true, rim: 0.2, name: 'world-foliage' });
  const waterfall = createToonMaterial({
    map: waterfallTexture(), transparent: true, emissive: 0x8fd3ee, emissiveIntensity: 0.45, side: THREE.DoubleSide, rim: 0, name: 'world-waterfall',
  });
  waterfall.depthWrite = false;
  const flag = createToonMaterial({ map: flagTexture(), side: THREE.DoubleSide, rim: 0.1, name: 'world-flag' });
  const beam = new THREE.MeshBasicMaterial({
    color: 0xffe2a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true, name: 'world-beam',
  });
  return { terrain, lamp, lava, foliage, waterfall, flag, beam, all: [terrain, lamp, lava, foliage, waterfall, flag, beam] };
}

/** Ink every mesh we build (LOOK decides the technique). */
export function ink(object: THREE.Object3D): void { markInk(object); }

/** Sets the emissive strength on a toon/standard material if it has one. */
export function setEmissive(material: THREE.Material, intensity: number): void {
  const m = material as THREE.Material & { emissiveIntensity?: number };
  if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = intensity;
}
