/**
 * Downloaded hero ship models (SHIPS-owned). Loads `/assets/sketchfab/<key>.glb`, converts every material to the
 * shared toon model with `toonifyObject`, and bakes the Baratie/Moby source paint into vertex colours so the look
 * never depends on shader injection.
 *
 * Texture budget: only the high-detail file is loaded for gameplay (the player ship is always close to the camera).
 * `detail: 'low'` is still supported for tools, and it never loads its own images: a GLTFLoader plugin hands every
 * texture slot a shared placeholder and the materials are then re-pointed at the already-loaded high textures,
 * so both detail levels share one copy of every image.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTFLoaderPlugin, type GLTFParser } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { HeroModelKey } from '../../game/ids';
import { toonifyObject } from '../materials/toon';

/** Provenance of the six downloaded hero models (kept for now; renamed in game). See ASSET-LICENSES.md. */
export const HERO_MODEL_SOURCES: Readonly<Record<HeroModelKey, { uid: string; author: string; license: string }>> = {
  'thousand-sunny': { uid: '99986d1c93654c9d8889017435b5fe06', author: 'Miraculousetabug', license: 'CC-BY-4.0' },
  'going-merry': { uid: '4b2cb678bf984c018dfa1936bd156c8d', author: 'Oliver Edwards', license: 'CC-BY-4.0' },
  'navy-galleon': { uid: '92898d5f63ad43589203d5a8dc14aa12', author: 'Ryanwill679 / TrashCG', license: 'CC-BY-4.0' },
  'moby-dick': { uid: 'd9be26addfec48019188dd615a930311', author: 'Tigerar1', license: 'CC-BY-SA-4.0' },
  'baratie': { uid: '015ebe70a76749eeb92f5f39693b8ea5', author: 'Chin Eeyang', license: 'CC-BY-4.0' },
  'polar-tang': { uid: 'a7feb48976ce484aa4537e4c7124a9c4', author: 'taem5070', license: 'CC-BY-4.0' },
};

/** Lengths the downloaded GLBs were normalized to during intake (metres, bow toward −Z, waterline at y = 0). */
export const HERO_SOURCE_LENGTH: Readonly<Record<HeroModelKey, number>> = {
  'going-merry': 34, 'thousand-sunny': 56, 'polar-tang': 52, baratie: 74, 'navy-galleon': 70, 'moby-dick': 122,
};

export type HeroDetail = 'high' | 'low';

/** A loaded, toonified hero model in its normalized source space (never added to a scene; clone it). */
export interface HeroTemplate {
  readonly kind: HeroModelKey;
  readonly detail: HeroDetail;
  readonly scene: THREE.Group;
  readonly materials: readonly THREE.Material[];
  readonly triangles: number;
}

const PLACEHOLDER = new THREE.Texture();

/**
 * GLTFLoader plugin: every texture slot resolves to one shared placeholder, so images are never fetched or decoded.
 * Texture extensions (EXT_texture_webp…) are stripped before the root loads, which routes every texture request to
 * the parser's own loadTexture, overridden here.
 */
const skipTextures = (parser: GLTFParser): GLTFLoaderPlugin => ({
  name: 'CRUISE_skip_textures',
  beforeRoot: () => {
    const json = parser.json as { textures?: { extensions?: unknown }[] };
    for (const texture of json.textures ?? []) delete texture.extensions;
    (parser as unknown as { loadTexture: () => Promise<THREE.Texture> }).loadTexture = () => Promise.resolve(PLACEHOLDER);
    return null;
  },
} as GLTFLoaderPlugin);

export class SketchfabShipAssets {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly lowLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(skipTextures);
  private readonly pending = new Map<string, Promise<HeroTemplate>>();
  private readonly templates = new Set<HeroTemplate>();
  private readonly textures = new Set<THREE.Texture>();
  private disposed = false;
  readonly status = new Map<HeroModelKey, 'loading' | 'ready' | 'error'>();

  /** Loads (once) and returns the toonified template for a hero model. */
  load(kind: HeroModelKey, detail: HeroDetail = 'high'): Promise<HeroTemplate> {
    const key = `${kind}:${detail}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (detail === 'high') this.status.set(kind, 'loading');
    const promise = (detail === 'high' ? this.loadHigh(kind) : this.loadLow(kind)).then((template) => {
      if (this.disposed) { this.release(template); return template; }
      this.templates.add(template);
      if (detail === 'high') this.status.set(kind, 'ready');
      return template;
    }).catch((error: unknown) => {
      this.pending.delete(key);
      if (detail === 'high') this.status.set(kind, 'error');
      throw new Error(`The downloaded ${kind} model could not load.`, { cause: error });
    });
    this.pending.set(key, promise);
    return promise;
  }

  /** Game preload: the player ship only ever needs the high-detail file. */
  async prepare(kind: HeroModelKey): Promise<void> { await this.load(kind, 'high'); }

  async ready(): Promise<void> { await Promise.all(this.pending.values()); }

  /** A new instance of the model sharing geometry and textures with the template (materials are per instance). */
  instantiate(template: HeroTemplate): { root: THREE.Group; materials: THREE.Material[] } {
    const root = template.scene.clone(true);
    root.name = `hero-model:${template.kind}`;
    root.userData.source = HERO_MODEL_SOURCES[template.kind];
    // Per-instance materials (the hit flash writes emissive); textures and shader programs stay shared.
    const copies = new Map<THREE.Material, THREE.Material>();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const copy = (m: THREE.Material) => { let c = copies.get(m); if (!c) { c = m.clone(); copies.set(m, c); } return c; };
      object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material);
    });
    return { root, materials: [...copies.values()] };
  }

  private async loadHigh(kind: HeroModelKey): Promise<HeroTemplate> {
    const gltf = await this.loader.loadAsync(`/assets/sketchfab/${kind}.glb`);
    return this.finish(kind, 'high', gltf.scene);
  }

  private async loadLow(kind: HeroModelKey): Promise<HeroTemplate> {
    const [high, gltf] = await Promise.all([this.load(kind, 'high'), this.lowLoader.loadAsync(`/assets/sketchfab/${kind}-low.glb`)]);
    // Re-point placeholder texture slots at the high-detail toon materials' textures (by source material name).
    const highByName = new Map<string, THREE.MeshStandardMaterial>();
    const highList: THREE.MeshStandardMaterial[] = [];
    for (const m of high.materials) {
      const name = (m.userData.sourceName as string | undefined) ?? m.name;
      if (!highByName.has(name)) { highByName.set(name, m as THREE.MeshStandardMaterial); highList.push(m as THREE.MeshStandardMaterial); }
    }
    let index = 0;
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const std = m as THREE.MeshStandardMaterial;
        const match = highByName.get(m.name) ?? highList[index % Math.max(1, highList.length)];
        index++;
        for (const slot of ['map', 'normalMap', 'aoMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap'] as const) {
          if (std[slot] === PLACEHOLDER) std[slot] = ((match as unknown as Record<string, THREE.Texture | null | undefined>)?.[slot]) ?? null;
        }
      }
    });
    return this.finish(kind, 'low', gltf.scene);
  }

  private finish(kind: HeroModelKey, detail: HeroDetail, scene: THREE.Group): HeroTemplate {
    scene.updateMatrixWorld(true);
    if (kind === 'baratie' || kind === 'moby-dick') bakeSourcePaint(scene, kind);
    let triangles = 0;
    const sources = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry as THREE.BufferGeometry;
      triangles += (geometry.index ? geometry.index.count : geometry.attributes.position!.count) / 3;
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        sources.add(m);
        for (const value of Object.values(m)) if (value instanceof THREE.Texture && value !== PLACEHOLDER) this.textures.add(value);
      }
    });
    toonifyObject(scene, { keepMaps: true, normalScale: 0.15, rim: 0.35, tintable: true, doubleSided: true });
    const materials = new Set<THREE.Material>();
    const names = new Map<THREE.Material, string>();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.userData.assetSource = HERO_MODEL_SOURCES[kind].uid;
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(m);
        if (!names.has(m)) names.set(m, m.name.replace(/^toon:/, ''));
      }
    });
    for (const [m, name] of names) m.userData.sourceName = name;
    // Source materials are replaced; their textures live on in the toon materials.
    for (const m of sources) if (!materials.has(m)) m.dispose();
    return { kind, detail, scene, materials: [...materials], triangles: Math.round(triangles) };
  }

  private release(template: HeroTemplate): void {
    template.scene.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    for (const m of template.materials) m.dispose();
  }

  dispose(): void {
    this.disposed = true;
    for (const template of this.templates) this.release(template);
    for (const texture of this.textures) texture.dispose();
    this.templates.clear(); this.textures.clear(); this.pending.clear();
  }
}

// ───────────────────────── Source paint (Baratie / Moby) ─────────────────────────

const paintColor = new THREE.Color();

/**
 * The Baratie and Moby files ship a 32×4 palette strip instead of real UV artwork. The previous renderer painted
 * them in a fragment shader from hull-local position; the same rules are baked into vertex colours here (hull-local =
 * normalized model space) and the palette map is dropped, so the toon material shades the paint directly.
 */
function bakeSourcePaint(scene: THREE.Group, kind: 'baratie' | 'moby-dick'): void {
  const palette = kind === 'moby-dick' ? readPalette(scene) : null;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const normal = geometry.attributes.normal as THREE.BufferAttribute | undefined;
    const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
    normalMatrix.getNormalMatrix(object.matrixWorld);
    const colors = new Uint8Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (normal) n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize(); else n.set(0, 1, 0);
      if (kind === 'baratie') baratiePaint(p, n, paintColor);
      else {
        if (palette && uv) palette.sample(uv.getX(i), uv.getY(i), paintColor); else paintColor.setRGB(0.85, 0.87, 0.88);
        if (p.z < -27 && p.y > -7 && p.y < 24) paintColor.setRGB(0.72, 0.78, 0.8);
      }
      // Vertex colours are linear (normalized 8-bit is plenty for these flat paint fields).
      colors[i * 3] = Math.round(THREE.MathUtils.clamp(paintColor.r, 0, 1) * 255);
      colors[i * 3 + 1] = Math.round(THREE.MathUtils.clamp(paintColor.g, 0, 1) * 255);
      colors[i * 3 + 2] = Math.round(THREE.MathUtils.clamp(paintColor.b, 0, 1) * 255);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
    for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
      const std = m as THREE.MeshStandardMaterial;
      std.vertexColors = true;
      std.map = null;
      std.color?.setRGB(1, 1, 1);
    }
  });
}

/** The previous shader's Baratie rules, evaluated per vertex (linear colours, as in the old shader). */
function baratiePaint(p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color): void {
  const floorFace = Math.abs(n.y) > 0.65;
  out.setRGB(0.68, 0.43, 0.19);
  if (p.y < 10) out.setRGB(0.025, 0.16, 0.09);
  else if (Math.abs(p.x) > 20) { if (floorFace) out.setRGB(0.3, 0.13, 0.045); else out.setRGB(0.87, 0.77, 0.55); }
  else if (p.y < 32) {
    if (floorFace) { if (p.y > 26) out.setRGB(0.39, 0.045, 0.035); else out.setRGB(0.3, 0.13, 0.045); }
    else out.setRGB(0.68, 0.43, 0.19);
  } else if (Math.abs(n.z) > 0.62) out.setRGB(0.88, 0.78, 0.59);
  else out.setRGB(0.12, 0.042, 0.02);
  if (p.z < -23 && p.y > 10 && p.y < 24 && Math.abs(p.x) < 13) out.setRGB(0.73, 0.2, 0.27);
}

interface PaletteSampler { sample(u: number, v: number, out: THREE.Color): void }

/** Reads the palette strip of a single-material model into a CPU sampler (sRGB → linear). */
function readPalette(scene: THREE.Group): PaletteSampler | null {
  let map: THREE.Texture | null = null;
  scene.traverse((o) => {
    if (map || !(o instanceof THREE.Mesh)) return;
    const m = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
    map = m.map ?? null;
  });
  const texture = map as THREE.Texture | null;
  const image = texture?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!texture || !image || !image.width || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const flipY = texture.flipY;
  return {
    sample(u, v, out) {
      const x = THREE.MathUtils.clamp(Math.floor((u - Math.floor(u)) * canvas.width), 0, canvas.width - 1);
      const vv = v - Math.floor(v);
      const y = THREE.MathUtils.clamp(Math.floor((flipY ? 1 - vv : vv) * canvas.height), 0, canvas.height - 1);
      const k = (y * canvas.width + x) * 4;
      out.setRGB(data[k]! / 255, data[k + 1]! / 255, data[k + 2]! / 255, THREE.SRGBColorSpace);
    },
  };
}
