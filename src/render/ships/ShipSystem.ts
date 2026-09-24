/**
 * Ships (SHIPS-owned; the RenderSystem + ShipServices surface is contract): the hero ship with visible growth, the
 * instanced enemy fleet, sea serpents, bosses, escort skiffs, crew, damage and sinking.
 *
 * Extra (non-contract) surface for other modules, documented in the SHIPS report:
 *   - `pendingGrowth()`: growth/phase events of this frame in world space (FX turns them into sparkles); the same
 *     events are also dispatched as `window` CustomEvent('cruise:ship-growth', { detail }).
 *   - `smokePoints(shipId, out)`: low-HP smoke emitter positions (measured deck points on the hero).
 */
import * as THREE from 'three';
import { SHIPS } from '../../game/content';
import type { HeroModelKey, ShipId } from '../../game/ids';
import type { BossState, CaptainState, EnemyState, HazardState, WeaponSlot } from '../../game/types';
import type { FrameContext, RenderHostHandles, RenderSystem, ShipAnchor, ShipServices } from '../frame';
import { FleetAssets } from '../loaders/FleetAssets';
import { SketchfabShipAssets } from '../loaders/SketchfabShipAssets';
import { Bosses } from './fleet/Bosses';
import { EnemyFleet } from './fleet/EnemyFleet';
import { EscortSkiffs } from './fleet/EscortSkiffs';
import { Serpents, type SerpentPose } from './fleet/Serpents';
import type { GrowthInput, ShipGrowthEvent } from './hero/HeroGrowth';
import { HeroShip, type HeroPose } from './hero/HeroShip';
import { CaptainFleet } from './fleet/Captains';

const NO_ENEMIES: readonly EnemyState[] = [];
const NO_BOSSES: readonly BossState[] = [];
const NO_CAPTAINS: readonly CaptainState[] = [];
const NO_HAZARDS: readonly HazardState[] = [];
const NO_WEAPONS: readonly WeaponSlot[] = [];
const CREW_KEYS = ['sailor-a', 'sailor-b', 'sailor-c'] as const;

export class ShipSystem implements RenderSystem, ShipServices {
  readonly name = 'ships';
  private scene!: THREE.Scene;
  private readonly assets = new SketchfabShipAssets();
  readonly fleetAssets = new FleetAssets();
  readonly heroShip = new HeroShip(this.assets, this.fleetAssets);
  readonly fleet = new EnemyFleet(this.fleetAssets);
  readonly serpents = new Serpents(24);
  readonly bosses = new Bosses(this.fleetAssets, this.fleet.fleetMaterial);
  readonly skiffs = new EscortSkiffs(this.fleet.fleetMaterial);
  readonly captains = new CaptainFleet();
  private readonly growthEvents: ShipGrowthEvent[] = [];
  private readonly wyrmPoses: SerpentPose[] = [];
  private readonly pose: HeroPose = { x: 0, z: 0, heading: 0, speed: 0, roll: 0, airborne: 0, submerged: 0, invulnerable: 0, sinceHit: 99, hpFraction: 1, alive: true };
  private readonly growthInput: GrowthInput = { tier: 0, weapons: NO_WEAPONS };
  private readonly wind = { dir: 0.6, strength: 0.5 };
  private readonly skiffPlayer = { x: 0, z: 0, heading: 0, weapons: NO_WEAPONS };
  /** QA: last update cost (ms) and the last frame context (for isolated allocation checks). */
  lastUpdateMs = 0;
  lastContext: FrameContext | null = null;

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.scene.add(this.heroShip.root, this.fleet.group, this.serpents.group, this.bosses.group, this.skiffs.group, this.captains.group);
    this.fleet.prebuild();
    this.bosses.preload();
    for (const key of CREW_KEYS) void this.fleetAssets.request(key);
    if (typeof window !== 'undefined') (window as unknown as { __SHIPS__?: ShipSystem }).__SHIPS__ = this;
  }

  /** Awaited by GameApp before the first frame: the selected hero model (+ crew models when the manifest has them). */
  async preload(key: HeroModelKey): Promise<void> {
    await Promise.all([this.assets.prepare(key), ...CREW_KEYS.map((k) => this.fleetAssets.request(k))]);
  }

  update(ctx: FrameContext): void {
    const started = performance.now();
    this.lastContext = ctx;
    this.growthEvents.length = 0;
    const run = ctx.run;
    const ocean = ctx.services.ocean;
    const shipId = (run?.shipId ?? (ctx.menuShip as ShipId | null) ?? 'dawn-ram') as ShipId;
    const def = SHIPS[shipId] ?? SHIPS['dawn-ram'];
    this.heroShip.setModel(def.modelKey, def.length, def.accent);

    // Hero.
    const p = run?.player;
    const pose = this.pose;
    pose.x = p ? p.x : ctx.focus.x; pose.z = p ? p.z : ctx.focus.z; pose.heading = p ? p.heading : ctx.focus.heading;
    pose.speed = p ? p.speed : 0; pose.roll = p?.roll ?? 0; pose.airborne = p?.airborne ?? 0; pose.submerged = p?.submerged ?? 0;
    pose.invulnerable = p?.invulnerable ?? 0; pose.sinceHit = p?.sinceHit ?? 99; pose.hpFraction = p ? p.hp / Math.max(1, p.maxHp) : 1;
    pose.alive = p?.alive ?? true;
    this.growthInput.tier = p?.tier ?? 0;
    this.growthInput.weapons = p?.weapons ?? NO_WEAPONS;
    this.wind.dir = ctx.sea.windDir; this.wind.strength = ctx.sea.windStrength;
    for (const e of ctx.events) if (e.type === 'player-hit') this.heroShip.hit(e.parried ? 'parried' : e.braced ? 'braced' : 'hit', e.amount);
    this.heroShip.update(ctx.dt, ctx.time, pose, this.growthInput, ctx.atmosphere.night, ocean, this.wind);
    this.heroShip.drainGrowthEvents(this.growthEvents);

    // Fleet and sea serpents.
    const enemies = run?.enemies ?? NO_ENEMIES;
    this.fleet.update(ctx.dt, ctx.time, enemies, ocean);
    let w = 0;
    for (const e of enemies) {
      if (e.defId !== 'wyrmling' || e.life === 'dead') continue;
      let sp = this.wyrmPoses[w];
      if (!sp) { sp = { id: 0, x: 0, z: 0, heading: 0, speed: 0, submerged: 0, rear: 0, sink: 0, flash: 0 }; this.wyrmPoses[w] = sp; }
      const dist = p ? Math.hypot(p.x - e.x, p.z - e.z) : 999;
      sp.id = e.id; sp.x = e.x; sp.z = e.z; sp.heading = e.heading; sp.speed = e.speed;
      sp.submerged = e.life === 'sinking' ? 0 : Math.max(e.hidden, THREE.MathUtils.clamp((dist - 60) / 220, 0.05, 0.45));
      sp.rear = e.life === 'sinking' ? 0 : THREE.MathUtils.clamp((75 - dist) / 45, 0, 1);
      sp.sink = e.life === 'sinking' ? e.sink : 0;
      sp.flash = e.hitFlash;
      w++;
    }
    this.serpents.updateWyrmlings(ctx.time, this.wyrmPoses, w, ocean);

    // Bosses and escorts.
    this.bosses.update(ctx.dt, ctx.time, run?.bosses ?? NO_BOSSES, ocean);
    this.captains.update(ctx.dt, ctx.time, run?.captains ?? NO_CAPTAINS, ocean);
    this.bosses.drainEvents(this.growthEvents);
    let skiffPlayer: typeof this.skiffPlayer | null = null;
    if (p) { skiffPlayer = this.skiffPlayer; skiffPlayer.x = p.x; skiffPlayer.z = p.z; skiffPlayer.heading = p.heading; skiffPlayer.weapons = p.weapons; }
    this.skiffs.update(ctx.dt, ctx.time, run?.hazards ?? NO_HAZARDS, skiffPlayer, def.length, def.accent, ocean);

    if (this.growthEvents.length && typeof window !== 'undefined') {
      for (const e of this.growthEvents) window.dispatchEvent(new CustomEvent('cruise:ship-growth', { detail: e }));
    }
    this.lastUpdateMs = performance.now() - started;
  }

  /** Growth / boss-phase events produced this frame (world space). */
  pendingGrowth(): readonly ShipGrowthEvent[] { return this.growthEvents; }

  /** Low-HP smoke emitters for a ship (hero: measured deck points; others: the deck anchor). Returns the count. */
  smokePoints(shipId: number, out: THREE.Vector3[]): number {
    if (shipId === 0) return this.heroShip.smokePoints(out);
    const first = out[0];
    return first && this.anchor(shipId, 'deck', first) ? 1 : 0;
  }

  anchor(shipId: number, name: ShipAnchor, out: THREE.Vector3): boolean {
    if (shipId === 0) return this.heroShip.anchor(name, out);
    if (shipId < 0) return this.captains.anchor(shipId, name, out);
    if (this.fleet.has(shipId)) return this.fleet.anchor(shipId, name, out);
    if (this.bosses.has(shipId)) return this.bosses.anchor(shipId, name, out);
    const head = this.serpents.headOf(shipId);
    if (head) { out.setFromMatrixPosition(head); return true; }
    return false;
  }

  transform(shipId: number, out: THREE.Matrix4): boolean {
    if (shipId === 0) return this.heroShip.transform(out);
    if (shipId < 0) return this.captains.transform(shipId, out);
    if (this.fleet.has(shipId)) return this.fleet.transform(shipId, out);
    if (this.bosses.has(shipId)) return this.bosses.transform(shipId, out);
    const head = this.serpents.headOf(shipId);
    if (head) { out.copy(head); return true; }
    return false;
  }

  /** QA: which source renders each enemy/boss key. */
  sources(): Record<string, string> { return { ...this.fleet.sources(), ...this.bosses.sources() }; }

  dispose(): void {
    this.scene.remove(this.heroShip.root, this.fleet.group, this.serpents.group, this.bosses.group, this.skiffs.group, this.captains.group);
    this.heroShip.dispose();
    this.captains.dispose();
    this.fleet.dispose();
    this.serpents.dispose();
    this.bosses.dispose();
    this.skiffs.dispose();
    this.assets.dispose();
    this.fleetAssets.dispose();
  }
}
