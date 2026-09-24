/**
 * Shared world materials (WORLD-owned). Created once; every island reuses them so programs compile once and the
 * night glow is one uniform write per frame.
 */
import * as THREE from 'three';
import { createToonMaterial, markInk } from '../materials/toon';

export interface WorldMaterials {
  /** Vertex-coloured terrain + kit (stone, wood, plaster, roofs). */
  terrain: THREE.Material;
  /** Windows, lanterns, lighthouse lamps (warm emissive, scaled by night). */
  lamp: THREE.Material;
  /** Volcanic vents and lava cracks (red-orange emissive). */
  lava: THREE.Material;
  /** Instanced vegetation (palms, trees, bushes). */
  foliage: THREE.Material;
  /** Instanced rocks/boulders. */
  rock: THREE.Material;
  all: THREE.Material[];
}

export function createWorldMaterials(): WorldMaterials {
  const terrain = createToonMaterial({ vertexColors: true, rim: 0.12, name: 'world-terrain' });
  const lamp = createToonMaterial({ vertexColors: true, emissive: 0xffb45a, emissiveIntensity: 0.1, rim: 0, name: 'world-lamp' });
  const lava = createToonMaterial({ vertexColors: true, emissive: 0xff5a1f, emissiveIntensity: 0.8, rim: 0, name: 'world-lava' });
  const foliage = createToonMaterial({ vertexColors: true, rim: 0.2, name: 'world-foliage' });
  const rock = createToonMaterial({ vertexColors: true, rim: 0.12, name: 'world-rock' });
  return { terrain, lamp, lava, foliage, rock, all: [terrain, lamp, lava, foliage, rock] };
}

/** Ink every mesh we build (LOOK decides the technique). */
export function ink(object: THREE.Object3D): void { markInk(object); }
