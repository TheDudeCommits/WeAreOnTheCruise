/**
 * AI captains' ships (CAPTAINS-owned): hero-class hulls for `run.captains` (negative ids), mounted by ShipSystem,
 * which routes transform()/anchor() for negative ids here.
 *
 *  - Hulls: the hero models baked into one vertex-coloured mesh each (captainHulls.ts: low-detail GLBs through the
 *    existing loader, ≤ 24k triangles, 1 draw call + ink + shadow per captain), toon-shaded and inked like the hero.
 *  - Identity: a waving pennant in the captain's slot colour on the main mast (all pennants share one cloth batch,
 *    one draw call).
 *  - Motion: buoyancy from four ocean samples, the sim's heel and pitch, a hit flash from `hitFlash`, a sinking
 *    animation (list, bow up, down in ~4.5 s) and a respawn fade-in (rises from the water through the spectral tint).
 */
import * as THREE from 'three';
import { SHIPS } from '../../../game/content';
import { CAPTAIN_COLORS } from '../../../game/content/captains';
import type { HeroModelKey } from '../../../game/ids';
import type { CaptainState } from '../../../game/types';
import type { OceanServices, ShipAnchor } from '../../frame';
import { isCelMaterial, type CelMaterial } from '../../materials/celMaterial';
import { createToonMaterial, markInk } from '../../materials/toon';
import { makeCanvas, paintPennant } from '../emblems';
import { ClothBatch, type ClothPatch } from '../hero/FlagCloth';
import { bakeCaptainHull, type CaptainHull } from './captainHulls';

const MAX = 4;
const SINK_TIME = 4.5;
const FADE_TIME = 1.4;

/** Session cache: a hull is baked once per model and length, whatever the run. */
const BAKES = new Map<string, Promise<CaptainHull | null>>();
const READY = new Map<string, CaptainHull | null>();

function requestHull(kind: HeroModelKey, length: number): CaptainHull | null | undefined {
  const key = `${kind}:${length}`;
  if (READY.has(key)) return READY.get(key);
  if (!BAKES.has(key)) {
    BAKES.set(key, bakeCaptainHull(kind, length).then((hull) => { READY.set(key, hull); return hull; }).catch((error: unknown) => {
      console.warn('[captains] hull bake failed', kind, error);
      READY.set(key, null);
      return null;
    }));
  }
  return undefined;
}

function hullMaterial(delight: number): THREE.Material {
  const m = createToonMaterial({ vertexColors: true, tintable: true, side: THREE.DoubleSide, rim: 0.35, name: 'captain-hull' });
  if (isCelMaterial(m)) m.setLevels(delight, 1.04, 1);
  return m;
}

interface Entry {
  id: number;
  kind: HeroModelKey | null;
  length: number;
  readonly root: THREE.Group;
  readonly body: THREE.Group;
  mesh: THREE.Mesh | null;
  material: THREE.Material | null;
  hull: CaptainHull | null;
  heave: number; pitch: number; roll: number;
  seen: boolean;
  primed: boolean;
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();

export class CaptainFleet {
  readonly group = new THREE.Group();
  private readonly entries = new Map<number, Entry>();
  private readonly cloth: ClothBatch;
  private readonly clothTexture: THREE.CanvasTexture;
  private readonly patches: ClothPatch[] = [];
  private readonly warm: THREE.Mesh[] = [];

  constructor() {
    this.group.name = 'captain-fleet';
    // Pennants: one strip per captain slot colour in a shared atlas, one cloth batch for every captain.
    const { canvas, ctx } = makeCanvas(1024, 512);
    ctx.clearRect(0, 0, 1024, 512);
    for (let i = 0; i < MAX; i++) paintPennant(ctx, 0, i * 128 + 10, 1024, 108, CAPTAIN_COLORS[i] ?? 0xffffff);
    this.clothTexture = new THREE.CanvasTexture(canvas);
    this.clothTexture.colorSpace = THREE.SRGBColorSpace;
    this.clothTexture.anisotropy = 4;
    for (let i = 0; i < MAX; i++) {
      const y0 = i * 128 + 10, y1 = y0 + 108;
      this.patches.push({ width: 14, height: 2.6, uv: [0, 1 - y1 / 512, 1, 1 - y0 / 512], anchor: new THREE.Matrix4(), phase: i * 1.9, flutter: 1.5, scale: 0, yaw: 0.6 });
    }
    this.cloth = new ClothBatch(this.clothTexture, this.patches);
    this.cloth.mesh.name = 'captain-pennants';
    markInk(this.cloth.mesh);
    this.group.add(this.cloth.mesh);
    // Shader warm-up: the hull material variants live in the scene from the start (far below the sea, culled at
    // render time) so GameApp's precompile builds their programs before the first captain sails in.
    for (const delight of [0.3, 0]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
      const mesh = new THREE.Mesh(g, hullMaterial(delight));
      mesh.position.y = -5000;
      mesh.name = 'captain-warmup';
      this.warm.push(mesh);
      this.group.add(mesh);
    }
  }

  update(dt: number, time: number, captains: readonly CaptainState[], ocean: OceanServices): void {
    for (const e of this.entries.values()) e.seen = false;
    let speed = 0;
    for (let i = 0; i < MAX; i++) this.patches[i]!.scale = 0;
    for (let i = 0; i < captains.length; i++) {
      const k = captains[i]!;
      const e = this.entry(k);
      e.seen = true;
      this.pose(e, k, dt, time, ocean);
      speed = Math.max(speed, Math.abs(k.speed));
      const slot = Math.min(MAX - 1, Math.max(0, -k.id - 1));
      const patch = this.patches[slot]!;
      const fade = k.ai.fade ?? 99, sinkT = k.ai.sinkT ?? 0;
      patch.scale = k.alive ? Math.min(1, fade / 0.8) : Math.max(0, 1 - sinkT / 1.5);
      if (patch.scale > 0) {
        const top = e.hull ? e.hull.mastTop : tmpV.set(0, k.length * 0.55, -k.length * 0.05);
        patch.anchor.copy(e.root.matrixWorld).multiply(tmpM.makeTranslation(top.x, top.y + 0.2, top.z));
        patch.yaw = 0.6 + 0.12 * Math.sin(time * 0.7 + slot * 1.3);
      }
    }
    for (const [id, e] of this.entries) if (!e.seen) this.remove(id, e);
    this.cloth.update(time, speed);
  }

  private entry(k: CaptainState): Entry {
    let e = this.entries.get(k.id);
    if (!e) {
      const root = new THREE.Group();
      root.name = `captain:${k.id}`;
      root.rotation.order = 'YXZ';
      const body = new THREE.Group();
      root.add(body);
      this.group.add(root);
      e = { id: k.id, kind: null, length: 0, root, body, mesh: null, material: null, hull: null, heave: 0, pitch: 0, roll: 0, seen: true, primed: false };
      this.entries.set(k.id, e);
    }
    const ship = SHIPS[k.shipId];
    if (e.kind !== ship.modelKey || e.length !== ship.length) {
      this.clearMesh(e);
      e.kind = ship.modelKey; e.length = ship.length; e.primed = false;
    }
    if (!e.mesh) {
      const hull = requestHull(ship.modelKey, ship.length);
      if (hull) {
        e.hull = hull;
        e.material = hullMaterial(hull.delight);
        e.mesh = new THREE.Mesh(hull.geometry, e.material);
        e.mesh.name = `captain-hull:${hull.kind}`;
        e.mesh.castShadow = true;
        e.mesh.receiveShadow = true;
        markInk(e.mesh);
        e.body.add(e.mesh);
      }
    }
    return e;
  }

  private pose(e: Entry, k: CaptainState, dt: number, time: number, ocean: OceanServices): void {
    const L = k.length;
    const half = L * 0.4, beam = Math.max(3, e.hull ? e.hull.gunX * 0.9 : k.beam * 0.4);
    const sin = Math.sin(k.heading), cos = Math.cos(k.heading);
    const fx = -sin, fz = -cos, sx = cos, sz = -sin;
    const hBow = ocean.heightAt(k.x + fx * half, k.z + fz * half);
    const hStern = ocean.heightAt(k.x - fx * half, k.z - fz * half);
    const hStar = ocean.heightAt(k.x + sx * beam, k.z + sz * beam);
    const hPort = ocean.heightAt(k.x - sx * beam, k.z - sz * beam);
    const hMid = ocean.heightAt(k.x, k.z);
    const targetHeave = (hBow + hStern + hStar + hPort + hMid * 2) / 6;
    const targetPitch = Math.atan2(hBow - hStern, 2 * half) * 0.85;
    const targetRoll = Math.atan2(hStar - hPort, 2 * beam) * 0.7 * THREE.MathUtils.clamp(40 / L, 0.45, 1);
    const s = e.primed ? 1 - Math.exp(-dt * 7) : 1;
    e.primed = true;
    e.heave += (targetHeave - e.heave) * s;
    e.pitch += (targetPitch - e.pitch) * s;
    e.roll += (targetRoll - e.roll) * s;
    const top = e.hull ? e.hull.mastTop.y : L * 0.5;
    const sinkT = k.alive ? 0 : k.ai.sinkT ?? 0;
    const sink = THREE.MathUtils.clamp(sinkT / SINK_TIME, 0, 1);
    const sinkDepth = sink * sink * (top * 0.9 + 4);
    const fade = k.alive ? THREE.MathUtils.clamp((k.ai.fade ?? 99) / FADE_TIME, 0, 1) : 1;
    const rise = (1 - fade) * (1 - fade) * 6;
    e.root.position.set(k.x, e.heave - sinkDepth - rise, k.z);
    e.root.rotation.set(e.pitch + k.pitch + sink * 0.28, k.heading, e.roll + k.roll + sink * 0.42 + Math.sin(time * 0.9 + k.id) * 0.004);
    e.root.visible = k.alive || sinkT < SINK_TIME + 1;
    e.root.updateMatrixWorld(true);
    const m = e.material;
    if (m && isCelMaterial(m)) (m as CelMaterial).setTint(Math.min(1, k.hitFlash) * 0.85, 0, (1 - fade) * 0.9);
  }

  has(id: number): boolean { return this.entries.has(id); }

  transform(id: number, out: THREE.Matrix4): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    out.copy(e.root.matrixWorld);
    return true;
  }

  anchor(id: number, name: ShipAnchor, out: THREE.Vector3): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    const h = e.hull, L = e.length || 30;
    const deck = h ? h.deckY : L * 0.12, gunY = h ? h.gunY : L * 0.08, gunX = h ? h.gunX : L * 0.15;
    switch (name) {
      case 'bow': out.set(0, deck + 1.2, (h ? h.bowZ : -L / 2) + 1.5); break;
      case 'stern': out.set(0, deck + 1.5, (h ? h.sternZ : L / 2) - 2); break;
      case 'port': out.set(-gunX - 1.2, gunY, 0); break;
      case 'starboard': out.set(gunX + 1.2, gunY, 0); break;
      case 'mast': if (h) out.copy(h.mastTop); else out.set(0, L * 0.5, 0); break;
      default: out.set(0, deck + 1, 0); break;
    }
    out.applyMatrix4(e.root.matrixWorld);
    return true;
  }

  /** QA: baked hull stats per captain (triangles, source triangles, bake ms). */
  stats(): { id: number; kind: string; triangles: number; source: number; bakeMs: number }[] {
    const out: { id: number; kind: string; triangles: number; source: number; bakeMs: number }[] = [];
    for (const e of this.entries.values()) if (e.hull) out.push({ id: e.id, kind: e.hull.kind, triangles: e.hull.triangles, source: e.hull.sourceTriangles, bakeMs: Math.round(e.hull.bakeMs) });
    return out;
  }

  private clearMesh(e: Entry): void {
    if (e.mesh) e.body.remove(e.mesh);
    e.material?.dispose();
    e.mesh = null; e.material = null; e.hull = null;
  }

  private remove(id: number, e: Entry): void {
    this.clearMesh(e);
    this.group.remove(e.root);
    this.entries.delete(id);
  }

  dispose(): void {
    for (const [id, e] of this.entries) this.remove(id, e);
    this.cloth.dispose();
    this.clothTexture.dispose();
    for (const w of this.warm) { w.geometry.dispose(); (w.material as THREE.Material).dispose(); }
  }
}
