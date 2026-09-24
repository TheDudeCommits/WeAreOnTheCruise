/**
 * QA/automation bridge (lead-owned): window.__CRUISE__. Used by scripts/qa-*.mjs and agents' checks.
 * Capture helpers never change gameplay rules; they only drive the same app loop with fixed steps.
 */
import type * as THREE from 'three';
import { DIRECTOR_EVENTS, type DirectorEventId } from '../game/content/director';
import type { BossId, EnemyId, SeaId, ShipId, WeaponId } from '../game/ids';
import { startEvent } from '../game/sim/director';
import { forcePoi } from '../game/sim/events/poi';
import type { SimAction } from '../game/types';
import type { GameApp } from './GameApp';
import { hurtCaptain } from '../game/sim/captains-damage';
import { captainRuntime } from '../game/sim/captains-runtime';

export interface CruiseBridge {
  version: 2;
  readonly ready: boolean;
  screen(): string;
  goHarbor(): void;
  startRun(ship?: ShipId, sea?: SeaId): void;
  summary(): unknown;
  /** Nearest live enemies/bosses to the player (for QA bots). */
  nearest(count?: number): { id: number; defId: string; x: number; z: number; hp: number; boss: boolean }[];
  press(action: SimAction): void;
  steer(value: number): void;
  aim(x: number, z: number): void;
  chooseCard(index: number): void;
  pause(paused: boolean): void;
  /** Advances the whole app by `seconds` using fixed 1/60 frames (rendering each frame). */
  advance(seconds: number): void;
  metrics(): unknown;
  /** Visible meshes/triangles per top-level scene group (instancing counted; frustum culling not applied). */
  sceneStats(): Record<string, { meshes: number; tris: number; shadowTris: number }>;
  /** AI captains (CAPTAINS): state, the fleet's attention split, and the baked hull stats. */
  captains(): unknown;
  /** Per-frame CPU breakdown: enable, run frames, then read the report (mean/max per part and the slowest frames). */
  profiler: { enable(on: boolean): void; reset(): void; report(worst?: number): unknown };
  debug: {
    xp(amount: number): void;
    level(level: number): void;
    spawn(defId: EnemyId, count?: number, elite?: boolean): void;
    boss(defId: BossId): void;
    time(seconds: number): void;
    god(on: boolean): void;
    weapon(id: WeaponId, level?: number): void;
    killAll(): void;
    sinkBosses(): void;
    chargeUltimate(): void;
    /** Sinks an AI captain (id −1…−4; default the first afloat) — QA for sinking and respawn. */
    sinkCaptain(id?: number): void;
    /**
     * Forces a director set piece now (EVENTS QA): any DirectorEventId, or a point of interest in front of the ship
     * with 'poi:trade-wind' | 'poi:salvage' | 'poi:beacon'. False for an unknown id or no run.
     */
    event(id: string): boolean;
  };
}

declare global {
  interface Window { __CRUISE__?: CruiseBridge }
}

export function installDebugBridge(app: GameApp): void {
  const sim = () => app.sim;
  const bridge: CruiseBridge = {
    version: 2,
    get ready() { return app.ready; },
    screen: () => app.screen,
    goHarbor: () => app.setScreen('harbor'),
    startRun: (ship = 'sunlion', sea = 'sunward-shallows') => {
      if (!app.profile.unlockedShips.includes(ship)) app.profile.unlockedShips.push(ship);
      app.startRun(ship, sea);
    },
    summary: () => {
      const s = sim()?.state;
      if (!s) return { screen: app.screen };
      const p = s.player;
      return {
        screen: app.screen, status: s.status, time: +s.time.toFixed(2), sea: s.seaId, ship: s.shipId,
        player: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), heading: +p.heading.toFixed(3), speed: +p.speed.toFixed(2), hp: +p.hp.toFixed(1), maxHp: +p.maxHp.toFixed(1), level: p.level, xp: +p.xp.toFixed(1), tier: p.tier, gear: p.gear },
        weapons: p.weapons.map((w) => `${w.id}:${w.level}${w.branch ?? ''}${w.overdrive ? '★' : ''}`),
        passives: p.passives.map((x) => `${x.id}:${x.rank}`),
        enemies: s.enemies.length, bosses: s.bosses.map((b) => `${b.defId}:${Math.round(b.hp)}/${Math.round(b.maxHp)}:p${b.phase}`),
        projectiles: s.projectiles.filter((x) => x.alive).length, pickups: s.pickups.filter((x) => x.alive).length,
        hazards: s.hazards.filter((x) => x.alive).reduce<Record<string, string>>((acc, x) => { acc[x.kind] = `${(Number(acc[x.kind]?.split('×')[0] ?? 0) + 1)}×r${Math.round(x.radius)}`; return acc; }, {}),
        offers: s.offers?.map((o) => o.title) ?? null, stats: { kills: s.stats.kills, bounty: s.stats.bounty, doubloons: s.stats.doubloons },
        weather: { weather: s.sea.weather, hour: +s.sea.timeOfDay.toFixed(2) },
      };
    },
    nearest: (count = 6) => {
      const s = sim()?.state;
      if (!s) return [];
      const p = s.player;
      const list = [
        ...s.enemies.filter((e) => e.life === 'alive').map((e) => ({ id: e.id, defId: e.defId as string, x: e.x, z: e.z, hp: e.hp, boss: false })),
        ...s.bosses.filter((b) => b.life === 'alive').map((b) => ({ id: b.id, defId: b.defId as string, x: b.x, z: b.z, hp: b.hp, boss: true })),
      ];
      list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return list.slice(0, count);
    },
    press: (action) => sim()?.press(action),
    // Overrides live input for 2 s of render time (call repeatedly to hold).
    steer: (value) => { app.inputOverride = { ...(app.inputOverride ?? {}), steer: value, until: app.renderClock() + 2 }; },
    aim: (x, z) => { app.inputOverride = { ...(app.inputOverride ?? {}), aimX: x, aimZ: z, until: app.renderClock() + 2 }; },
    chooseCard: (index) => { sim()?.chooseCard(index); },
    pause: (paused) => sim()?.setPaused(paused),
    advance: (seconds) => { const frames = Math.round(seconds * 60); for (let i = 0; i < frames; i++) app.tick(1 / 60); },
    metrics: () => app.host.getMetrics(),
    captains: () => {
      const s = sim()?.state;
      if (!s) return null;
      const rt = captainRuntime(s);
      return {
        configured: rt.count, attentionOnPlayer: rt.focusPlayer, liveEnemies: rt.aliveEnemies, sinkings: rt.sinkings,
        captains: s.captains.map((k) => ({
          id: k.id, name: k.name, ship: k.shipId, alive: k.alive, hp: Math.round(k.hp), maxHp: Math.round(k.maxHp), level: k.level,
          kills: k.kills, bounty: k.bounty, respawn: +k.respawn.toFixed(1), mode: k.ai.mode, attackers: k.ai.attackers,
          x: Math.round(k.x), z: Math.round(k.z), fromPlayer: Math.round(Math.hypot(k.x - s.player.x, k.z - s.player.z)),
        })),
        hulls: app.ships.captains.stats(),
      };
    },
    profiler: {
      enable: (on) => { app.profiler.enabled = on; },
      reset: () => app.profiler.reset(),
      report: (worst) => app.profiler.report(worst),
    },
    sceneStats: () => {
      const scene = app.host.scene;
      const groups: Record<string, { meshes: number; tris: number; shadowTris: number }> = {};
      scene.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        let top: THREE.Object3D = o;
        while (top.parent && top.parent !== scene) top = top.parent;
        const g = mesh.geometry;
        const count = Math.min(g.index ? g.index.count : (g.attributes.position?.count ?? 0), g.drawRange.count);
        const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
        const tris = Math.round((count / 3) * inst);
        const e = (groups[top.name || top.type] ??= { meshes: 0, tris: 0, shadowTris: 0 });
        e.meshes++; e.tris += tris; if (mesh.castShadow) e.shadowTris += tris;
      });
      return groups;
    },
    debug: {
      xp: (amount) => sim()?.debug.grantXp(amount),
      level: (level) => sim()?.debug.setLevel(level),
      spawn: (defId, count, elite) => sim()?.debug.spawnEnemy(defId, count, elite),
      boss: (defId) => sim()?.debug.spawnBoss(defId),
      time: (seconds) => sim()?.debug.setTime(seconds),
      god: (on) => sim()?.debug.god(on),
      weapon: (id, level) => sim()?.debug.giveWeapon(id, level),
      killAll: () => sim()?.debug.killAll(),
      sinkBosses: () => sim()?.debug.sinkBosses(),
      chargeUltimate: () => sim()?.debug.chargeUltimate(),
      sinkCaptain: (id) => {
        const s = sim();
        if (!s) return;
        const k = s.state.captains.find((x) => (id === undefined ? x.alive : x.id === id));
        if (k && k.alive) { k.ai.grace = 0; hurtCaptain(s, k, k.hp * 4 + 100); }
      },
      event: (id) => {
        const s = sim();
        if (s && id.startsWith('poi:')) return forcePoi(s, id.slice(4));
        if (!s || !(id in DIRECTOR_EVENTS)) return false;
        startEvent(s, id as DirectorEventId);
        return true;
      },
    },
  };
  window.__CRUISE__ = bridge;
}
