/**
 * Fleet asset loader (SHIPS-owned): reads /assets/fleet/manifest.json (DESIGN §9) and loads GLBs by model key on
 * demand. Static models are flattened into "parts" (geometry baked into model space + one toon material each) for
 * instancing, and can be split into fore/aft index ranges (sharing the vertex buffers) so big ships break in two.
 * Skinned models (crew) keep their scene + clips for SkeletonUtils cloning. Missing manifest / keys → null, and the
 * caller renders a procedural fallback.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonifyObject } from '../materials/toon';

export interface FleetManifestEntry {
  file: string;
  length?: number;
  beam?: number;
  height?: number;
  draft?: number;
  tris?: number;
  materials?: number;
  role?: string;
  clips?: string[];
  notes?: string;
  source?: { kind?: string; author?: string; license?: string; title?: string; url?: string; uid?: string };
}

export interface FleetPart { geometry: THREE.BufferGeometry; material: THREE.Material }

export interface FleetModel {
  key: string;
  entry: FleetManifestEntry;
  /** Toonified scene in model space (bow −Z, waterline/ground y = 0). Clone before adding to a scene. */
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  skinned: boolean;
  /** Static parts in model space (for InstancedMesh). */
  parts: FleetPart[];
  box: THREE.Box3;
}

let meshoptWorkers = false;
/**
 * PERF: decode EXT_meshopt_compression buffers in two workers instead of on the main thread (GLTFLoader uses the
 * decoder's async path when workers exist). Idempotent; a no-op outside browsers.
 */
export function enableMeshoptWorkers(): void {
  if (meshoptWorkers || typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL?.createObjectURL !== 'function') return;
  meshoptWorkers = true;
  try { MeshoptDecoder.useWorkers(2); } catch { /* keep main-thread decoding */ }
}

export class FleetAssets {
  private readonly loader = (enableMeshoptWorkers(), new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
  private manifest: Record<string, FleetManifestEntry> = {};
  private readonly models = new Map<string, FleetModel>();
  private readonly pending = new Map<string, Promise<FleetModel | null>>();
  private readonly failed = new Set<string>();
  private readonly owned: { geometries: THREE.BufferGeometry[]; materials: THREE.Material[] } = { geometries: [], materials: [] };
  readonly ready: Promise<void>;
  loaded = false;

  constructor(url = '/assets/fleet/manifest.json') {
    this.ready = (typeof fetch === 'function' ? fetch(url) : Promise.reject(new Error('no fetch')))
      .then((r) => (r.ok ? r.json() : { models: {} }))
      .then((json: { models?: Record<string, FleetManifestEntry> }) => { this.manifest = json.models ?? {}; })
      .catch(() => { this.manifest = {}; })
      .finally(() => { this.loaded = true; });
  }

  has(key: string): boolean { return !!this.manifest[key] && !this.failed.has(key); }
  entry(key: string): FleetManifestEntry | undefined { return this.manifest[key]; }
  get(key: string): FleetModel | null { return this.models.get(key) ?? null; }
  keys(): string[] { return Object.keys(this.manifest); }

  /** Starts (or joins) loading a model; resolves null when the manifest lacks it or it fails. */
  request(key: string): Promise<FleetModel | null> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = this.ready.then(async () => {
      const entry = this.manifest[key];
      if (!entry) return null;
      try {
        const gltf = await this.loader.loadAsync(entry.file);
        const model = this.prepare(key, entry, gltf.scene, gltf.animations);
        this.models.set(key, model);
        return model;
      } catch (error) {
        console.warn(`[ships] fleet model ${key} failed to load; using the procedural fallback`, error);
        this.failed.add(key);
        return null;
      }
    });
    this.pending.set(key, promise);
    return promise;
  }

  private prepare(key: string, entry: FleetManifestEntry, scene: THREE.Group, animations: THREE.AnimationClip[]): FleetModel {
    scene.updateMatrixWorld(true);
    let skinned = false;
    const sources = new Set<THREE.Material>();
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
      if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) sources.add(m);
    });
    toonifyObject(scene, { keepMaps: true, normalScale: 0.15, rim: skinned ? 0.6 : 0.35, tintable: true, doubleSided: true });
    const used = new Set<THREE.Material>();
    scene.traverse((o) => { if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) used.add(m); });
    for (const m of sources) if (!used.has(m)) m.dispose();
    const parts: FleetPart[] = [];
    const box = new THREE.Box3();
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true; o.receiveShadow = true;
      o.userData.fleetKey = key;
      box.expandByObject(o);
      if (skinned) return;
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      const source = o.geometry as THREE.BufferGeometry;
      if (materials.length === 1 || !source.groups.length) {
        const g = bake(source, o.matrixWorld);
        parts.push({ geometry: g, material: materials[0]! });
        this.owned.geometries.push(g);
      } else {
        for (const group of source.groups) {
          const g = bake(source, o.matrixWorld, group.start, group.count);
          parts.push({ geometry: g, material: materials[group.materialIndex ?? 0]! });
          this.owned.geometries.push(g);
        }
      }
      for (const m of materials) this.owned.materials.push(m);
    });
    return { key, entry, scene, animations, skinned, parts, box };
  }

  dispose(): void {
    for (const g of this.owned.geometries) g.dispose();
    for (const m of new Set(this.owned.materials)) m.dispose();
    for (const model of this.models.values()) model.scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.models.clear(); this.pending.clear();
  }
}

/** Copies a geometry (optionally one index range) with the node transform baked in, de-quantized to floats. */
function bake(source: THREE.BufferGeometry, matrix: THREE.Matrix4, start = 0, count = Infinity): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos = source.attributes.position!;
  const nor = source.attributes.normal;
  const uv = source.attributes.uv;
  const color = source.attributes.color;
  const n = pos.count;
  const p = new Float32Array(n * 3), q = nor ? new Float32Array(n * 3) : null;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    if (nor && q) { v.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); q[i * 3] = v.x; q[i * 3 + 1] = v.y; q[i * 3 + 2] = v.z; }
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  if (q) g.setAttribute('normal', new THREE.BufferAttribute(q, 3)); else g.computeVertexNormals();
  if (uv) {
    const t = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { t[i * 2] = uv.getX(i); t[i * 2 + 1] = uv.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(t, 2));
  }
  if (color) {
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = color.getX(i); c[i * 3 + 1] = color.getY(i); c[i * 3 + 2] = color.getZ(i); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const index = source.index;
  const end = Math.min(index ? index.count : n, start + count);
  const idx: number[] = [];
  for (let i = start; i < end; i++) idx.push(index ? index.getX(i) : i);
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Splits a geometry into fore (triangle centroid z < splitZ) and aft index ranges sharing the same vertex buffers.
 * The halves render seamlessly together; when separated the break shows the model's own cut faces.
 */
export function splitByZ(geometry: THREE.BufferGeometry, splitZ: number): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const pos = geometry.attributes.position!;
  const index = geometry.index;
  const n = index ? index.count : pos.count;
  const fore: number[] = [], aft: number[] = [];
  for (let i = 0; i < n; i += 3) {
    const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
    const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    (z < splitZ ? fore : aft).push(a, b, c);
  }
  const make = (idx: number[]) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) g.setAttribute(name, attr);
    g.setIndex(pos.count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  };
  return [make(fore), make(aft)];
}
