/**
 * Island visuals (WORLD-owned RenderSystem). Streams world features around the focus from the same IslandDefs the
 * simulation collides with, builds them incrementally (a per-frame time budget, nearest first) at three LODs, and
 * keeps materials shared so the whole archipelago compiles a handful of programs.
 */
import * as THREE from 'three';
import type { IslandDef, WorldQuery } from '../../game/types';
import type { WorldFeature } from '../../world/features';
import { harborSetFeatures, HARBOR_SET_RADIUS } from '../../world/harborSet';
import { paletteForSea, type PaletteId } from '../../world/seas';
import type { FrameContext, RenderHostHandles, RenderSystem } from '../frame';
import { buildFeatureLodSteps, type FeatureLod } from './featureMesh';
import { HorizonRing } from './horizon';
import { FlagInstancer, PropInstancer, propDetailDistance } from './instancing';
import { createWorldMaterials, ink, setEmissive, type WorldMaterials } from './materials';

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

interface ActiveJob { entry: Entry; lod: 0 | 1 | 2; steps: Generator<void, FeatureLod>; started: number }

export interface WorldStats { features: number; built: number; pending: number; triangles: number; buildMs: number; maxStepMs: number; props: number }

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
  private menu = false;
  private readonly menuList: WorldFeature[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;
  private buildMs = 0;
  private maxStepMs = 0;
  private active: ActiveJob | null = null;
  private props!: PropInstancer;
  private horizon!: HorizonRing;
  private flags!: FlagInstancer;
  private instancesDirty = false;
  private instanceTimer = 0;
  private propCount = 0;
  /** Focus at the last prop rebuild (PERF: tree detail tiers are re-split after the focus moves). */
  private propX = 0;
  private propZ = 0;
  private propDetail = 0;
  /** Per-frame build budget (ms); raised while nothing is on screen yet. */
  budgetMs = 3.5;
  /** Force a LOD for all features (lab); null = distance based. */
  forceLod: 0 | 1 | 2 | null = null;

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.group.name = 'world';
    this.scene.add(this.group);
    this.props = new PropInstancer(this.materials.foliage, (mesh) => ink(mesh));
    this.flags = new FlagInstancer(this.materials.flag);
    this.horizon = new HorizonRing();
    this.group.add(this.props.group, this.flags.mesh, this.horizon.mesh);
  }

  update(ctx: FrameContext): void {
    if (ctx.world !== this.world) this.setWorld(ctx.world);
    const menu = ctx.screen === 'title' || ctx.screen === 'harbor';
    if (menu !== this.menu) { this.menu = menu; this.refreshTimer = 0; }
    const fx = ctx.focus.x, fz = ctx.focus.z;
    this.refreshTimer -= ctx.dt;
    if (this.refreshTimer <= 0 || Math.hypot(fx - this.lastX, fz - this.lastZ) > 30) {
      this.refreshTimer = REFRESH_SECONDS;
      this.lastX = fx; this.lastZ = fz;
      this.refresh(fx, fz, ctx.run?.seaId ?? null);
    }
    this.processJobs();
    this.instanceTimer -= ctx.dt;
    const detail = propDetailDistance();
    if (Math.hypot(fx - this.propX, fz - this.propZ) > detail * 0.25 || detail !== this.propDetail) this.instancesDirty = true;
    if (this.instancesDirty && this.instanceTimer <= 0) this.rebuildInstances(fx, fz);
    this.animate(ctx);
  }

  /** Night glow, waterfall flow, flags, waterfall foam on the ocean. */
  private animate(ctx: FrameContext): void {
    const night = ctx.atmosphere.night;
    const dim = Math.max(night, ctx.atmosphere.storm * 0.6);
    setEmissive(this.materials.lamp, 0.12 + 2.9 * dim);
    setEmissive(this.materials.lava, 0.9 + 1.9 * night);
    const map = (this.materials.waterfall as THREE.Material & { map?: THREE.Texture | null }).map;
    if (map) map.offset.y = -ctx.time * 0.85;
    this.flags.update(ctx.time, ctx.sea.windDir);
    // Far silhouettes fade out in thick fog/storm where the horizon is gone anyway.
    this.horizon.update(ctx.focus.x, ctx.focus.z, ctx.atmosphere, ctx.sea.fog < 0.6 && ctx.atmosphere.storm < 0.7);
    for (const entry of this.entries.values()) {
      if (entry.shown < 0 || entry.distance > 700) continue;
      for (const f of entry.lods[entry.shown]!.falls) ctx.services.ocean.stampFoam(f.x, f.z, f.r * 1.4, 0.8);
    }
  }

  private rebuildInstances(fx: number, fz: number): void {
    this.instancesDirty = false;
    this.instanceTimer = 0.2;
    this.propX = fx; this.propZ = fz;
    this.propDetail = propDetailDistance();
    const props: FeatureLod['props'][] = [], flags: FeatureLod['flags'][] = [];
    for (const entry of this.entries.values()) {
      if (entry.shown < 0) continue;
      const lod = entry.lods[entry.shown]!;
      props.push(lod.props);
      flags.push(lod.flags);
    }
    this.propCount = this.props.rebuild(props, fx, fz);
    this.flags.rebuild(flags);
  }

  private setWorld(world: WorldQuery): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.queue.length = 0;
    this.active = null;
    this.world = world;
    this.source = adaptWorld(world);
    this.refreshTimer = 0;
  }

  private refresh(fx: number, fz: number, seaId: string | null): void {
    const source = this.source!;
    let features = source.featuresNear(fx, fz, STREAM_RADIUS, this.near);
    if (this.menu) {
      // Title/harbour: the hand-placed harbour set owns the origin; streamed islands only far behind it.
      const list = this.menuList;
      list.length = 0;
      for (const f of harborSetFeatures()) list.push(f);
      for (const f of features) if (!f.id.startsWith('menu:') && Math.hypot(f.x, f.z) - f.radius > HARBOR_SET_RADIUS) list.push(f);
      features = list;
    }
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
    for (const [id, entry] of this.entries) if (!keep.has(id)) { this.disposeEntry(entry); this.entries.delete(id); this.instancesDirty = true; }
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
    if (this.queue.length === 0 && !this.active) return;
    let nothingShown = true;
    for (const e of this.entries.values()) if (e.shown >= 0) { nothingShown = false; break; }
    const budget = nothingShown ? Math.max(this.budgetMs, 14) : this.budgetMs;
    const t0 = performance.now();
    while (performance.now() - t0 < budget) {
      if (!this.active) {
        const job = this.queue.shift();
        if (!job) break;
        if (job.entry.lods[job.lod] || !this.entries.has(job.entry.feature.id)) continue;
        this.active = { entry: job.entry, lod: job.lod, steps: buildFeatureLodSteps(job.entry.feature, job.lod, this.materials, job.entry.palette), started: performance.now() };
      }
      const job = this.active;
      if (!this.entries.has(job.entry.feature.id) || job.entry.lods[job.lod]) { this.active = null; continue; }
      const ts = performance.now();
      const r = job.steps.next();
      this.maxStepMs = Math.max(this.maxStepMs, performance.now() - ts);
      if (!r.done) continue;
      this.active = null;
      this.buildMs = performance.now() - job.started;
      const built = r.value;
      built.group.visible = false;
      ink(built.group);
      job.entry.lods[job.lod] = built;
      job.entry.root.add(built.group);
      this.showBest(job.entry);
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
    if (entry.shown !== best) this.instancesDirty = true;
    entry.shown = best;
    for (let l = 0; l < 3; l++) { const lod = entry.lods[l]; if (lod) lod.group.visible = l === best; }
  }

  private disposeEntry(entry: Entry): void {
    for (const lod of entry.lods) lod?.dispose();
    this.group.remove(entry.root);
  }

  /** Currently shown merged meshes per feature (labs/QA: collision overlays, slices). */
  debugShown(): { feature: WorldFeature; lod: number; group: THREE.Group }[] {
    const out: { feature: WorldFeature; lod: number; group: THREE.Group }[] = [];
    for (const e of this.entries.values()) if (e.shown >= 0) out.push({ feature: e.feature, lod: e.shown, group: e.lods[e.shown]!.group });
    return out;
  }

  /** Streaming state for labs/QA. */
  stats(): WorldStats {
    let built = 0, triangles = 0;
    for (const e of this.entries.values()) {
      if (e.shown >= 0) { built++; triangles += e.lods[e.shown]!.triangles; }
    }
    return { features: this.entries.size, built, pending: this.queue.length + (this.active ? 1 : 0), triangles, buildMs: this.buildMs, maxStepMs: this.maxStepMs, props: this.propCount };
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.scene.remove(this.group);
    this.props.dispose();
    this.flags.dispose();
    this.horizon.dispose();
    for (const m of this.materials.all) m.dispose();
  }
}
