/**
 * Ship materials (SHIPS-owned). Everything comes from the shared toon API (createToonMaterial); SHIPS only chains
 * small, optional shader patches on top (the previous onBeforeCompile always runs first). If a patch's injection
 * point is missing — e.g. LOOK rewrites the toon shader — the patch silently does nothing and the material still
 * renders with its plain toon look.
 */
import * as THREE from 'three';
import { createToonMaterial, type ToonOptions } from '../materials/toon';

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

/** Chains a shader patch after any existing onBeforeCompile and extends the program cache key. */
export function chainShader(material: THREE.Material, key: string, patch: (shader: Shader) => void): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patch(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${key}`;
}

/**
 * Clones a material WITH its shader hooks (Material.clone() drops onBeforeCompile/customProgramCacheKey, which would
 * silently strip LOOK's toon patch and SHIPS' glow patch from the copy).
 */
export function cloneMaterial<T extends THREE.Material>(material: T): T {
  const copy = material.clone() as T;
  copy.onBeforeCompile = material.onBeforeCompile;
  copy.customProgramCacheKey = material.customProgramCacheKey;
  return copy;
}

/** Vertex-coloured toon material for procedural parts and fleets. */
export function partMaterial(name: string, opts: ToonOptions = {}): THREE.Material {
  return createToonMaterial({ vertexColors: true, rim: 0.35, tintable: true, name, ...opts });
}

/**
 * Glow parts (lantern glass, storm orb, figurehead halo, embers): emissive = vertex colour × per-instance colour.
 * Without the patch (unknown shader) the emissive falls back to the material's warm emissive colour.
 */
export function glowMaterial(name: string, intensity = 1): THREE.Material {
  const material = createToonMaterial({ vertexColors: true, emissive: 0xffffff, emissiveIntensity: intensity, name, rim: 0 });
  chainShader(material, 'ships-glow-v1', (shader) => {
    if (!shader.fragmentShader.includes('#include <emissivemap_fragment>')) {
      const m = material as THREE.MeshToonMaterial;
      if (m.emissive) m.emissive.setHex(0xffb35a);
      return;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n totalEmissiveRadiance *= vColor.rgb;\n#endif');
  });
  return material;
}

const flashScratch = new THREE.Color();

/** Hit flash through the standard emissive term (works on any material with an `emissive` colour). */
export class FlashDriver {
  private readonly entries: { material: THREE.Material & { emissive?: THREE.Color }; base: THREE.Color }[] = [];
  private last = -1;

  constructor(materials: Iterable<THREE.Material>) {
    for (const material of materials) {
      const m = material as THREE.Material & { emissive?: THREE.Color };
      if (m.emissive instanceof THREE.Color) this.entries.push({ material: m, base: m.emissive.clone() });
    }
  }

  add(material: THREE.Material): void {
    const m = material as THREE.Material & { emissive?: THREE.Color };
    if (m.emissive instanceof THREE.Color) this.entries.push({ material: m, base: m.emissive.clone() });
  }

  /** amount 0..1; color is the flash tint (white for hits, red for heavy damage). */
  set(amount: number, color: THREE.ColorRepresentation = 0xffffff): void {
    const a = Math.round(THREE.MathUtils.clamp(amount, 0, 1) * 64) / 64;
    if (a === this.last) return;
    this.last = a;
    flashScratch.set(color).multiplyScalar(a * 0.62);
    for (const e of this.entries) e.material.emissive!.copy(e.base).add(flashScratch);
  }
}
