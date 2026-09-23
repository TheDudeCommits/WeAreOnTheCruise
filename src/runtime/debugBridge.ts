/**
 * QA/automation bridge (lead-owned): window.__CRUISE__. Used by scripts/qa-*.mjs and agents' checks.
 * Capture helpers never change gameplay rules; they only drive the same app loop with fixed steps.
 */
import type { BossId, EnemyId, SeaId, ShipId, WeaponId } from '../game/ids';
import type { SimAction } from '../game/types';
import type { GameApp } from './GameApp';

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
  debug: {
    xp(amount: number): void;
    level(level: number): void;
    spawn(defId: EnemyId, count?: number, elite?: boolean): void;
    boss(defId: BossId): void;
    time(seconds: number): void;
    god(on: boolean): void;
    weapon(id: WeaponId, level?: number): void;
    killAll(): void;
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
    steer: (value) => sim()?.setInput({ steer: value }),
    aim: (x, z) => sim()?.setInput({ aimX: x, aimZ: z }),
    chooseCard: (index) => { sim()?.chooseCard(index); },
    pause: (paused) => sim()?.setPaused(paused),
    advance: (seconds) => { const frames = Math.round(seconds * 60); for (let i = 0; i < frames; i++) app.tick(1 / 60); },
    metrics: () => app.host.getMetrics(),
    debug: {
      xp: (amount) => sim()?.debug.grantXp(amount),
      level: (level) => sim()?.debug.setLevel(level),
      spawn: (defId, count, elite) => sim()?.debug.spawnEnemy(defId, count, elite),
      boss: (defId) => sim()?.debug.spawnBoss(defId),
      time: (seconds) => sim()?.debug.setTime(seconds),
      god: (on) => sim()?.debug.god(on),
      weapon: (id, level) => sim()?.debug.giveWeapon(id, level),
      killAll: () => sim()?.debug.killAll(),
    },
  };
  window.__CRUISE__ = bridge;
}
