/**
 * Island visuals (WORLD-owned RenderSystem). Streams world features around the focus from the same IslandDefs the
 * simulation collides with, builds them incrementally (a per-frame time budget, nearest first) at three LODs, and
 * keeps materials shared so the whole archipelago compiles a handful of programs.
 */
import * as THREE from 'three';
import type { IslandDef, WorldQuery } from '../../game/types';
import type { WorldFeature } from '../../world/features';
import { paletteForSea, type PaletteId } from '../../world/seas';
import type { FrameContext, RenderHostHandles, RenderSystem } from '../frame';
import { buildFeatureLod, type FeatureLod } from './featureMesh';
import { createWorldMaterials, ink, type WorldMaterials } from './materials';

/** Features are streamed inside this radius of the focus (fog hides the rest). */
export const STREAM_RADIUS = 2300;
const LOD0_DISTANCE = 460;
const LOD1_DISTANCE = 1150;
const HYSTERESIS = 60;
const REFRESH_SECONDS = 0.25;

interface FeatureSource {
  featuresNear(x: number, z: number, radius: number, out: WorldFeature[]): WorldFeature[];
}

interface Entry {
  feature: WorldFeature;
  root: THREE.Group;
  lods: (FeatureLod | null)[];
  wanted: 0 | 1 | 2;
  shown: number;
  distance: number;
  palette: PaletteId;
}

interface Job { entry: Entry; lod: 0 | 1 | 2; priority: number }

export interface WorldStats { features: number; built: number; pending: number; triangles: number; buildMs: number }

/** Adapter for WorldQuery implementations without features (one feature per island). */
function adaptWorld(world: WorldQuery): FeatureSource {
  const maybe = world as WorldQuery & Partial<FeatureSource>;
  if (typeof maybe.featuresNear === 'function') return maybe as FeatureSource;
  const islands: IslandDef[] = [];
  const cache = new Map<string, WorldFeature>();
  return {
    featuresNear(x, z, radius, out) {
      out.length = 0;
      for (const island of world.islandsNear(x, z, radius, islands)) {
        let f = cache.get(island.id);
        if (!f) {
          f = { id: island.id, kind: 'island', x: island.x, z: island.z, radius: island.radius, seed: island.seed, palette: 'sunward', islands: [island] };
          cache.set(island.id, f);
        }
        out.push(f);
      }
      return out;
    },
  };
}

export class WorldVisuals implements RenderSystem {
  readonly name = 'world';
  readonly materials: WorldMaterials = createWorldMaterials();
  private scene!: THREE.Scene;
  private readonly group = new THREE.Group();
  private readonly entries = new Map<string, Entry>();
  private readonly queue: Job[] = [];
  private readonly near: WorldFeature[] = [];
  private world: WorldQuery | null = null;
  private source: FeatureSource | null = null;
  private refreshTimer = 0;
  private lastX = Infinity;
  private lastZ = Infinity;
  private buildMs = 0;
  /** Per-frame build budget (ms); raised while nothing is on screen yet. */
  budgetMs = 3.5;
  /** Force a LOD for all features (lab); null = distance based. */
  forceLod: 0 | 1 | 2 | null = null;

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.group.name = 'world';
    this.scene.add(this.group);
  }

  update(ctx: FrameContext): void {
    if (ctx.world !== this.world) this.setWorld(ctx.world);
    const fx = ctx.focus.x, fz = ctx.focus.z;
    this.refreshTimer -= ctx.dt;
    if (this.refreshTimer <= 0 || Math.hypot(fx - this.lastX, fz - this.lastZ) > 30) {
      this.refreshTimer = REFRESH_SECONDS;
      this.lastX = fx; this.lastZ = fz;
      this.refresh(fx, fz, ctx.run?.seaId ?? null);
    }
    this.processJobs();
  }

  private setWorld(world: WorldQuery): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.queue.length = 0;
    this.world = world;
    this.source = adaptWorld(world);
    this.refreshTimer = 0;
  }

  private refresh(fx: number, fz: number, seaId: string | null): void {
    const source = this.source!;
    const features = source.featuresNear(fx, fz, STREAM_RADIUS, this.near);
    const keep = new Set<string>();
    for (const f of features) {
      keep.add(f.id);
      let entry = this.entries.get(f.id);
      if (!entry) {
        const root = new THREE.Group();
        root.name = `feature:${f.id}`;
        this.group.add(root);
        entry = { feature: f, root, lods: [null, null, null], wanted: 2, shown: -1, distance: 0, palette: seaId ? paletteForSea(seaId) : f.palette };
        this.entries.set(f.id, entry);
      }
      const d = Math.max(0, Math.hypot(f.x - fx, f.z - fz) - f.radius);
      entry.distance = d;
      entry.wanted = this.forceLod ?? this.lodFor(d, entry.wanted);
    }
    for (const [id, entry] of this.entries) if (!keep.has(id)) { this.disposeEntry(entry); this.entries.delete(id); }
    this.queue.length = 0;
    for (const entry of this.entries.values()) {
      // Always have a far silhouette first, then the wanted detail.
      if (!entry.lods[2] && entry.wanted !== 2) this.queue.push({ entry, lod: 2, priority: entry.distance * 0.25 });
      if (!entry.lods[entry.wanted]) this.queue.push({ entry, lod: entry.wanted, priority: entry.distance + entry.wanted * 40 });
      // Free full detail once far away.
      if (entry.wanted === 2 && entry.lods[0] && entry.distance > LOD1_DISTANCE + 300) { entry.lods[0].dispose(); entry.root.remove(entry.lods[0].group); entry.lods[0] = null; }
      this.showBest(entry);
    }
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  private lodFor(d: number, current: number): 0 | 1 | 2 {
    const h0 = current === 0 ? HYSTERESIS : 0, h1 = current <= 1 ? HYSTERESIS : 0;
    if (d < LOD0_DISTANCE + h0) return 0;
    if (d < LOD1_DISTANCE + h1) return 1;
    return 2;
  }

  private processJobs(): void {
    if (this.queue.length === 0) return;
    let nothingShown = true;
    for (const e of this.entries.values()) if (e.shown >= 0) { nothingShown = false; break; }
    const budget = nothingShown ? Math.max(this.budgetMs, 14) : this.budgetMs;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budget) {
      const job = this.queue.shift()!;
      const entry = job.entry;
      if (entry.lods[job.lod] || !this.entries.has(entry.feature.id)) continue;
      const tb = performance.now();
      const built = buildFeatureLod(entry.feature, job.lod, this.materials, entry.palette);
      this.buildMs = performance.now() - tb;
      built.group.visible = false;
      ink(built.group);
      entry.lods[job.lod] = built;
      entry.root.add(built.group);
      this.showBest(entry);
    }
  }

  private showBest(entry: Entry): void {
    let best = -1;
    if (entry.lods[entry.wanted]) best = entry.wanted;
    else {
      // Nearest available LOD to the wanted one.
      for (const d of [1, 2]) {
        if (entry.lods[entry.wanted + d]) { best = entry.wanted + d; break; }
        if (entry.wanted - d >= 0 && entry.lods[entry.wanted - d]) { best = entry.wanted - d; break; }
      }
    }
    entry.shown = best;
    for (let l = 0; l < 3; l++) { const lod = entry.lods[l]; if (lod) lod.group.visible = l === best; }
  }

  private disposeEntry(entry: Entry): void {
    for (const lod of entry.lods) lod?.dispose();
    this.group.remove(entry.root);
  }

  /** Streaming state for labs/QA. */
  stats(): WorldStats {
    let built = 0, triangles = 0;
    for (const e of this.entries.values()) {
      if (e.shown >= 0) { built++; triangles += e.lods[e.shown]!.triangles; }
    }
    return { features: this.entries.size, built, pending: this.queue.length, triangles, buildMs: this.buildMs };
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.scene.remove(this.group);
    for (const m of this.materials.all) m.dispose();
  }
}
