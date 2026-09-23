/**
 * Ships (SHIPS-owned; RenderSystem + ShipServices surface is contract): the hero ship, enemy fleets (instanced
 * per class in the real implementation), bosses, upgrade attachments, crew, damage and sinking.
 * Stub: hero GLB scaled to its gameplay length; enemies/bosses are pooled placeholder hulls.
 */
import * as THREE from 'three';
import { SHIPS } from '../../game/content';
import type { Faction, HeroModelKey } from '../../game/ids';
import type { BossState, EnemyState } from '../../game/types';
import type { FrameContext, RenderHostHandles, RenderSystem, ShipAnchor, ShipServices } from '../frame';
import { SketchfabShipAssets } from '../loaders/SketchfabShipAssets';
import { HeroShip } from './hero/HeroShip';
import { createToonMaterial, markInk } from '../materials/toon';

const FACTION_COLORS: Record<Faction, { hull: number; sail: number }> = {
  player: { hull: 0x7b4a2a, sail: 0xf2e6c8 },
  admiralty: { hull: 0xe9eef2, sail: 0xf7f8fb },
  corsair: { hull: 0x2b2021, sail: 0xb3262b },
  wraith: { hull: 0x1d3a3a, sail: 0x5ee6c8 },
  deep: { hull: 0x2f6f63, sail: 0x3aa58e },
};

interface Visual { root: THREE.Group; kind: string }

export class ShipSystem implements RenderSystem, ShipServices {
  readonly name = 'ships';
  private scene!: THREE.Scene;
  private readonly assets = new SketchfabShipAssets();
  private readonly heroShip = new HeroShip(this.assets);
  private readonly hero = this.heroShip.root;
  private heroLength = 34;
  private readonly visuals = new Map<number, Visual>();
  private readonly pool = new Map<string, THREE.Group[]>();
  private readonly materials = new Map<string, THREE.Material>();
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly sailGeo = new THREE.PlaneGeometry(1, 1);
  private readonly tmp = new THREE.Vector3();
  private readonly seen = new Set<number>();

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.hero.name = 'hero-ship';
    this.scene.add(this.hero);
  }

  async preload(key: HeroModelKey): Promise<void> { await this.assets.prepare(key); }

  private setHero(key: HeroModelKey, length: number, accent: number): void {
    this.heroLength = length;
    this.heroShip.setModel(key, length, accent);
  }

  update(ctx: FrameContext): void {
    const oceanY = (x: number, z: number) => ctx.services.ocean.heightAt(x, z);
    // Hero.
    const run = ctx.run;
    const shipId = run?.shipId ?? (ctx.menuShip as keyof typeof SHIPS | null) ?? 'dawn-ram';
    const def = SHIPS[shipId as keyof typeof SHIPS] ?? SHIPS['dawn-ram'];
    this.setHero(def.modelKey, def.length, def.accent);
    const p = run?.player;
    this.heroShip.update(ctx.dt, ctx.time, {
      x: p ? p.x : ctx.focus.x, z: p ? p.z : ctx.focus.z, heading: p ? p.heading : ctx.focus.heading, speed: p ? p.speed : 0,
      roll: p?.roll ?? 0, airborne: p?.airborne ?? 0, submerged: p?.submerged ?? 0, invulnerable: p?.invulnerable ?? 0,
      sinceHit: p?.sinceHit ?? 99, hpFraction: p ? p.hp / Math.max(1, p.maxHp) : 1, alive: p?.alive ?? true,
    }, p ? { tier: p.tier, weapons: p.weapons } : { tier: 0, weapons: [] }, ctx.atmosphere.night, ctx.services.ocean);

    // Enemies and bosses.
    this.seen.clear();
    if (run) {
      for (const e of run.enemies) this.place(e, 'enemy', oceanY);
      for (const b of run.bosses) this.place(b, 'boss', oceanY);
    }
    for (const [id, v] of this.visuals) if (!this.seen.has(id)) { this.release(v); this.visuals.delete(id); }
  }

  private place(s: EnemyState | BossState, kind: 'enemy' | 'boss', oceanY: (x: number, z: number) => number): void {
    this.seen.add(s.id);
    const faction: Faction = 'faction' in s ? s.faction : 'admiralty';
    const key = `${kind}:${faction}:${Math.round(s.length)}`;
    let v = this.visuals.get(s.id);
    if (!v) { v = { root: this.acquire(key, s.length, faction), kind: key }; this.visuals.set(s.id, v); }
    const sinkDepth = s.sink * s.length * 0.4;
    v.root.position.set(s.x, oceanY(s.x, s.z) - sinkDepth, s.z);
    v.root.rotation.set(s.sink * 0.5, s.heading, s.roll + s.sink * 0.3);
    const flash = s.hitFlash;
    v.root.scale.setScalar(1 + flash * 0.04);
  }

  private acquire(key: string, length: number, faction: Faction): THREE.Group {
    const list = this.pool.get(key);
    const reused = list?.pop();
    if (reused) { reused.visible = true; return reused; }
    const colors = FACTION_COLORS[faction];
    const hullMat = this.material(`hull:${faction}`, colors.hull);
    const sailMat = this.material(`sail:${faction}`, colors.sail, true);
    const root = new THREE.Group();
    const hull = new THREE.Mesh(this.box, hullMat);
    hull.scale.set(length * 0.28, length * 0.16, length);
    hull.position.y = length * 0.04;
    const mast = new THREE.Mesh(this.box, hullMat);
    mast.scale.set(0.8, length * 0.6, 0.8);
    mast.position.y = length * 0.34;
    const sail = new THREE.Mesh(this.sailGeo, sailMat);
    sail.scale.set(length * 0.4, length * 0.35, 1);
    sail.position.set(0, length * 0.38, -0.8);
    root.add(hull, mast, sail);
    root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
    markInk(root);
    root.userData.poolKey = key;
    this.scene.add(root);
    return root;
  }

  private release(v: Visual): void {
    v.root.visible = false;
    const list = this.pool.get(v.kind) ?? [];
    list.push(v.root);
    this.pool.set(v.kind, list);
  }

  private material(key: string, color: number, doubleSided = false): THREE.Material {
    let m = this.materials.get(key);
    if (!m) { m = createToonMaterial({ color, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide, name: key }); this.materials.set(key, m); }
    return m;
  }

  anchor(shipId: number, name: ShipAnchor, out: THREE.Vector3): boolean {
    const root = shipId === 0 ? this.hero : this.visuals.get(shipId)?.root;
    if (!root) return false;
    const len = shipId === 0 ? this.heroLength : 20;
    const local = name === 'bow' ? this.tmp.set(0, 3, -len * 0.5) : name === 'stern' ? this.tmp.set(0, 3, len * 0.5)
      : name === 'port' ? this.tmp.set(-len * 0.15, 3, 0) : name === 'starboard' ? this.tmp.set(len * 0.15, 3, 0)
      : name === 'mast' ? this.tmp.set(0, len * 0.6, 0) : this.tmp.set(0, 4, 0);
    out.copy(local).applyMatrix4(root.matrixWorld);
    return true;
  }

  transform(shipId: number, out: THREE.Matrix4): boolean {
    const root = shipId === 0 ? this.hero : this.visuals.get(shipId)?.root;
    if (!root) return false;
    out.copy(root.matrixWorld);
    return true;
  }

  dispose(): void {
    this.assets.dispose();
    this.box.dispose(); this.sailGeo.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.scene.remove(this.hero);
  }
}
