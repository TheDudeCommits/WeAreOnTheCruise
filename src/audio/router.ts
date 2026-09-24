/**
 * SimEvent → cue mapping (AUDIO-owned). Every event type in the contract is handled here (or deliberately
 * ignored with a comment). Tables are typed against CueId, so a cue removed from the recipe fails the build.
 */
import type { BossId, HazardKind, PickupKind, ProjectileKind, SpecialId, UltimateId, WeaponId } from '../game/ids';
import type { RunState, ShipRef, SimEvent } from '../game/types';
import type { AppScreen } from '../render/frame';
import type { CueId } from './generated/cueIds';
import type { ListenerFrame } from './spatial';
import type { DuckSpec, PlayOptions } from './types';

export interface RouterHooks {
  play(cue: CueId, opts?: PlayOptions): boolean;
  duck(spec: DuckSpec): void;
  /** Length in seconds of the cue's first variation (0 when not loaded). */
  cueLength(cue: CueId): number;
  /** Evidence log: every mapped request, played or not. */
  note(source: string, cue: CueId): void;
}

type Pos = { x: number; z: number };

const CANNON_FAR_DISTANCE = 230;

const PICKUP_CUE: Record<PickupKind, CueId> = {
  'xp-copper': 'coin-copper', 'xp-silver': 'coin-silver', 'xp-gold': 'coin-gold', doubloon: 'doubloon',
  repair: 'repair', compass: 'compass', 'powder-keg': 'explosion-powder', chest: 'chest-open',
};

const HAZARD_SPAWN_CUE: Partial<Record<HazardKind, CueId>> = {
  'fire-patch': 'fire-ignite', barrel: 'barrel-drop', 'powder-keg': 'barrel-drop', mine: 'mine-drop', whirlpool: 'whirlpool-cast',
  'storm-cloud': 'thunder-far', shockwave: 'shockwave', 'wave-front': 'wave-roar', 'lightning-strike': 'thunder-near',
  'burning-wreck': 'fire-ignite', 'escort-skiff': 'splash-small',
};

const HAZARD_TRIGGER_CUE: Partial<Record<HazardKind, CueId>> = {
  mine: 'explosion-water', 'powder-keg': 'explosion-powder', barrel: 'fire-burst', 'fire-patch': 'fire-ignite',
  'lightning-strike': 'thunder-near', shockwave: 'shockwave', 'wave-front': 'wave-roar', 'storm-cloud': 'thunder-near',
  'burning-wreck': 'fire-burst', 'escort-skiff': 'explosion-small',
};

/** Enemy projectile → firing cue. */
const ENEMY_FIRE_CUE: Record<ProjectileKind, CueId> = {
  'cannonball': 'cannon-near', 'chain-shot': 'cannon-near', 'heavy-shot': 'heavy-shot', 'chaser-shot': 'bow-chaser', lance: 'lance',
  'mortar-shell': 'mortar-launch', bomblet: 'mortar-launch', 'swivel-shot': 'swivel-shot', grapeshot: 'swivel-shot', harpoon: 'harpoon-throw',
  rocket: 'rocket-launch', torpedo: 'rocket-launch', 'skiff-shot': 'swivel-shot',
  'enemy-cannonball': 'cannon-near', 'enemy-chaser': 'bow-chaser', 'enemy-mortar': 'mortar-launch', 'water-bolt': 'water-bolt', 'boss-shell': 'heavy-shot',
  'enemy-harpoon': 'harpoon-throw', 'enemy-bomb': 'mortar-launch', 'enemy-flare': 'rocket-launch',
};

/** Ship hit by a projectile kind (non-boss targets). */
const HIT_CUE: Record<ProjectileKind, CueId> = {
  cannonball: 'hit-wood', 'chain-shot': 'hit-wood-light', 'heavy-shot': 'hit-wood-heavy', 'chaser-shot': 'hit-wood', lance: 'hit-wood-heavy',
  'mortar-shell': 'hit-wood-heavy', bomblet: 'hit-wood', 'swivel-shot': 'hit-wood-light', grapeshot: 'hit-wood-light', harpoon: 'harpoon-hit',
  rocket: 'explosion-small', torpedo: 'explosion-water', 'skiff-shot': 'hit-wood-light',
  'enemy-cannonball': 'hit-wood', 'enemy-chaser': 'hit-wood', 'enemy-mortar': 'hit-wood-heavy', 'water-bolt': 'splash-small', 'boss-shell': 'hit-wood-heavy',
  'enemy-harpoon': 'harpoon-hit', 'enemy-bomb': 'hit-wood-heavy', 'enemy-flare': 'hit-wood-light',
};

const BIG_SPLASH = new Set<ProjectileKind>(['heavy-shot', 'mortar-shell', 'enemy-mortar', 'boss-shell', 'torpedo', 'lance']);

export class EventRouter {
  private run: Readonly<RunState> | null = null;
  private listener: ListenerFrame | null = null;
  private now = 0;
  private coinStreak = 0;
  private lastCoin = -10;
  /** Last volley time per AI captain (ms), for the per-captain gunfire cap. */
  private readonly captainShot = new Map<number, number>();
  /** Router time of the last world-event outcome sting. */
  private outcomeAt = -10;
  private readonly killTimes: number[] = [];
  private lastCheer = -30;
  private prevScreen: AppScreen | null = null;
  private prevStatus: RunState['status'] | null = null;
  private prevRerolls = -1;

  constructor(private readonly h: RouterHooks) {}

  /** Handles one frame: screen/status diffs first, then every SimEvent in order. */
  route(now: number, screen: AppScreen, run: Readonly<RunState> | null, events: readonly SimEvent[], listener: ListenerFrame): void {
    this.now = now;
    this.run = run;
    this.listener = listener;
    this.diffs(screen, run, events);
    for (const e of events) this.handle(e);
  }

  /** Public for the lab: route a single synthetic event. */
  handle(e: SimEvent): void {
    switch (e.type) {
      case 'weapon-fired': return this.weaponFired(e);
      case 'enemy-fired': return this.enemyFired(e);
      case 'projectile-hit': return this.projectileHit(e);
      case 'explosion': return this.explosion(e);
      case 'damage':
        if (e.crit) this.p('damage', 'crit', { x: e.x, z: e.z, gain: Math.min(1.1, 0.55 + e.amount / 150) });
        return;
      case 'player-hit': return this.playerHit(e);
      case 'enemy-spawned':
        if (e.elite) this.p('enemy-spawned', 'elite-spawn', { x: e.x, z: e.z });
        return;
      case 'enemy-killed': return this.enemyKilled(e);
      case 'enemy-sunk':
        if (this.dist(e.x, e.z) < 260) this.p('enemy-sunk', 'splash-small', { x: e.x, z: e.z, pitch: -7, gain: 0.45 });
        return;
      case 'pickup-spawned':
        if (e.kind === 'chest') this.p('pickup-spawned', 'treasure-sparkle', { x: e.x, z: e.z, gain: 0.7 });
        return;
      case 'pickup-collected': return this.pickup(e);
      case 'level-up':
        this.p('level-up', 'level-up');
        this.h.duck({ target: 'music', depth: -9, hold: 1.6, attack: 0.08, release: 1.2 });
        return;
      case 'card-chosen': {
        const o = e.offer;
        if (o.kind === 'weapon-overdrive') this.p('card-chosen', 'overdrive');
        else this.p('card-chosen', 'card-select');
        if (o.rarity === 'epic' || o.rarity === 'legendary') this.p('card-chosen', 'treasure-sparkle', { delay: 0.08, gain: 0.7 });
        return;
      }
      case 'weapon-changed':
        if (e.overdrive) this.p('weapon-changed', 'overdrive', { delay: 0.1 });
        else this.p('weapon-changed', e.isNew ? 'weapon-new' : 'weapon-upgrade', { delay: 0.12 });
        return;
      case 'passive-changed':
        this.p('passive-changed', 'passive-upgrade', { delay: 0.12, pitch: Math.min(4, e.rank - 1) });
        return;
      case 'tier-up':
        this.p('tier-up', 'repair', {});
        this.p('tier-up', 'repair', { delay: 0.28, pitch: 1, force: true });
        this.p('tier-up', 'ship-bell', { delay: 0.55 });
        this.p('tier-up', 'crew-cheer', { delay: 0.8, force: true });
        this.h.duck({ target: 'music', depth: -6, hold: 1.4, release: 1 });
        return;
      case 'skill-used': return this.skillUsed(e);
      case 'skill-ready':
        if (e.slot === 'special') this.p('skill-ready', 'skill-ready');
        else if (e.slot === 'ultimate') this.p('skill-ready', 'ultimate-ready');
        else if (e.slot === 'broadside') this.p('skill-ready', 'reload', { gain: 0.7 });
        return; // brace/boost ready: silent (too frequent; the HUD ring covers it)
      case 'status-changed': return this.statusChanged(e);
      case 'lightning': {
        if (e.points.length === 0) return;
        const mid = e.points[Math.floor(e.points.length / 2)]!;
        this.p('lightning', 'lightning-zap', { x: mid.x, z: mid.z });
        if (e.team === 'enemy' || e.points.length >= 4) this.p('lightning', 'thunder-near', { x: mid.x, z: mid.z, delay: 0.04, gain: e.team === 'enemy' ? 0.85 : 0.45 });
        return;
      }
      case 'harpoon': {
        this.p('harpoon', 'harpoon-throw', { x: e.x1, z: e.z1 });
        const flight = Math.min(0.5, Math.max(0.08, Math.hypot(e.x2 - e.x1, e.z2 - e.z1) / 180));
        this.p('harpoon', 'harpoon-hit', { x: e.x2, z: e.z2, delay: flight });
        return;
      }
      case 'ram':
        this.p('ram', 'ram-crash', { x: e.x, z: e.z, gain: Math.min(1.3, 0.65 + e.damage / 220) });
        if (e.attacker === 0) this.p('ram', 'splinters', { x: e.x, z: e.z, delay: 0.05, gain: 0.8 });
        return;
      case 'collision':
        if (e.b === 'island') {
          this.p('collision', 'hit-rock', { x: e.x, z: e.z, gain: Math.min(1, 0.3 + e.impulse / 14) });
          this.p('collision', 'hull-creak', { gain: 0.5, pitch: -2 });
        } else this.p('collision', 'collide-ship', { x: e.x, z: e.z, gain: Math.min(1, 0.35 + e.impulse / 16) });
        return;
      case 'hazard-spawned': {
        const cue = HAZARD_SPAWN_CUE[e.kind];
        if (cue) this.p('hazard-spawned', cue, { x: e.x, z: e.z, gain: e.kind === 'escort-skiff' ? 0.5 : 1 });
        if (e.kind === 'powder-keg') this.p('hazard-spawned', 'fuse', { x: e.x, z: e.z, delay: 0.2 });
        if (e.kind === 'wave-front') this.h.duck({ target: 'sfx', depth: -3, hold: 0.6 });
        if (e.kind === 'lightning-strike') this.p('hazard-spawned', 'lightning-zap', { x: e.x, z: e.z, gain: 0.7 });
        return;
      }
      case 'hazard-triggered': {
        const cue = HAZARD_TRIGGER_CUE[e.kind];
        if (cue) this.p('hazard-triggered', cue, { x: e.x, z: e.z });
        if (e.kind === 'mine') this.p('hazard-triggered', 'splash-large', { x: e.x, z: e.z, delay: 0.1 });
        if (e.kind === 'powder-keg') this.h.duck({ target: 'sfx', depth: -5, hold: 0.3 });
        return;
      }
      case 'telegraph': return this.telegraph(e);
      case 'boss-warning':
        if (e.boss === 'tidewyrm') this.p('boss-warning', 'serpent-roar', { pitch: -4, gain: 0.9 });
        else this.p('boss-warning', 'boss-horn');
        this.h.duck({ target: 'music', depth: -8, hold: 2.4, release: 1.5 });
        return;
      case 'boss-spawned':
        if (e.boss === 'tidewyrm') {
          this.p('boss-spawned', 'serpent-roar', { x: e.x, z: e.z, gain: 1.2 });
          this.p('boss-spawned', 'splash-large', { x: e.x, z: e.z, pitch: -5, delay: 0.1 });
        } else {
          this.p('boss-spawned', 'war-horn', { x: e.x, z: e.z });
          this.p('boss-spawned', 'broadside-ripple', { x: e.x, z: e.z, delay: 1.3, pitch: -2 });
        }
        return;
      case 'boss-phase':
        if (e.boss === 'tidewyrm') {
          const pos = this.refPos(e.id) ?? {};
          this.p('boss-phase', 'serpent-roar', { ...pos, pitch: -2, gain: 1.25 });
          this.p('boss-phase', 'wave-roar', { ...pos, delay: 0.3, gain: 0.8 });
        } else {
          const pos = this.refPos(e.id) ?? {};
          this.p('boss-phase', 'metal-groan', { ...pos });
          this.p('boss-phase', 'explosion-large', { ...pos, delay: 0.15 });
          this.p('boss-phase', 'boss-horn', { delay: 0.9, gain: 0.7 });
        }
        this.h.duck({ target: 'music', depth: -6, hold: 1.2 });
        return;
      case 'boss-attack': return this.bossAttack(e);
      case 'boss-defeated': {
        const final = e.boss === 'sovereign';
        this.p('boss-defeated', 'explosion-large', { x: e.x, z: e.z, gain: 1.3 });
        this.p('boss-defeated', 'explosion-large', { x: e.x, z: e.z, delay: 0.55, pitch: -3, force: true });
        this.p('boss-defeated', 'ship-sink', { x: e.x, z: e.z, delay: 0.9, pitch: -5, gain: 1.4 });
        this.p('boss-defeated', 'crew-cheer', { delay: 1.3, force: true });
        if (!final) {
          this.p('boss-defeated', 'stinger-boss-defeated', { delay: 0.6 });
          this.h.duck({ target: 'music', depth: -12, hold: 3.2, release: 2 });
        }
        return;
      }
      case 'director-event': return this.directorEvent(e.name);
      case 'world-event':
        // 'start' is voiced by its director-event banner; outcomes get their own sting (and mute their banner).
        if (e.phase === 'success' || e.phase === 'fail') this.outcomeAt = this.now;
        if (e.phase === 'success') { this.p('world-event', 'crew-cheer', { gain: 0.9 }); this.p('world-event', 'treasure-sparkle', { delay: 0.25 }); }
        else if (e.phase === 'fail') this.p('world-event', 'boss-horn', { pitch: -4, gain: 0.45 });
        return;
      case 'captain-joined': this.p('captain-joined', 'ship-bell', { gain: 0.55 }); return;
      case 'captain-respawned': this.p('captain-respawned', 'ship-bell', { pitch: 2, gain: 0.45 }); return;
      case 'captain-sunk':
        if (this.dist(e.x, e.z) < 320) { this.p('captain-sunk', 'ship-break', { x: e.x, z: e.z, gain: 0.8 }); this.p('captain-sunk', 'hull-creak', { x: e.x, z: e.z, delay: 0.4, gain: 0.7 }); }
        return;
      case 'captain-kill': return; // Their sinkings already sound through enemy-killed.
      case 'weather-changed':
        if (e.weather === 'storm') this.p('weather-changed', 'thunder-far', { gain: 1.1 });
        else if (e.weather === 'fog') this.p('weather-changed', 'boss-horn', { pitch: 3, gain: 0.35 });
        else this.p('weather-changed', 'gull', { gain: 0.6 });
        return;
      case 'lightning-strike': {
        const d = this.dist(e.x, e.z);
        this.p('lightning-strike', 'thunder-near', { x: e.x, z: e.z, delay: Math.min(1.6, d / 340) });
        if (d < 220) this.p('lightning-strike', 'lightning-zap', { x: e.x, z: e.z, gain: 0.5 });
        return;
      }
      case 'chest-opened': {
        this.p('chest-opened', 'chest-open');
        if (e.rewards.some((r) => r.rarity === 'epic' || r.rarity === 'legendary')) this.p('chest-opened', 'treasure-sparkle', { delay: 0.4 });
        if (e.rewards.some((r) => r.kind === 'weapon-overdrive')) this.p('chest-opened', 'overdrive', { delay: 0.75 });
        return;
      }
      case 'player-died':
        if (e.reviving) {
          this.p('player-died', 'heal', { gain: 1.1 });
          this.p('player-died', 'ship-bell', { delay: 0.25 });
          this.h.duck({ target: 'music', depth: -8, hold: 1.5 });
        } else {
          this.p('player-died', 'explosion-large', { gain: 0.9 });
          this.p('player-died', 'ship-sink', { delay: 0.4, pitch: -4, gain: 1.3 });
          this.p('player-died', 'hull-creak', { delay: 0.9, pitch: -5, gain: 1, force: true });
        }
        return;
      case 'revived':
        this.p('revived', 'shield-up', { gain: 0.8 });
        return;
      case 'run-ended':
        if (e.outcome === 'retired') this.p('run-ended', 'ui-back');
        return; // victory/defeat stingers belong to the music director
    }
  }

  // ───────────────────────── handlers ─────────────────────────

  private weaponFired(e: Extract<SimEvent, { type: 'weapon-fired' }>): void {
    if (e.owner < 0) {
      // AI captains: one lighter, distant report per volley (rate-capped per captain) so they never mask your guns.
      const now = performance.now();
      if (now - (this.captainShot.get(e.owner) ?? -1e9) < 350) return;
      this.captainShot.set(e.owner, now);
      this.p('weapon-fired', 'cannon-far', { x: e.x, z: e.z, gain: 0.55 });
      return;
    }
    if (e.owner !== 0) {
      // Allied/enemy use of a player weapon: treat as generic gunfire.
      this.gun('weapon-fired', e.x, e.z, e.count, 'cannon-near');
      return;
    }
    const run = this.run;
    const p = run?.player;
    const slot = p?.weapons.find((w) => w.id === e.weapon);
    const fx = p ? -Math.sin(p.heading) : 0, fz = p ? -Math.cos(p.heading) : -1;
    const len = p?.length ?? 40, beam = p?.beam ?? 12;
    const w: WeaponId = e.weapon;
    switch (w) {
      case 'broadside': {
        const n = Math.max(1, Math.min(6, e.count));
        const heavy = slot?.branch === 'B';
        let t = 0;
        for (let i = 0; i < n; i++) {
          const along = n > 1 ? (i / (n - 1) - 0.5) * len * 0.6 : 0;
          const x = e.x + fx * along + e.dirX * beam * 0.5, z = e.z + fz * along + e.dirZ * beam * 0.5;
          this.p('weapon-fired', heavy && i % 2 === 0 ? 'heavy-shot' : 'cannon-near', { x, z, delay: t, force: i > 0 });
          t += 0.05 + Math.random() * 0.035;
        }
        if (e.count >= 5 || slot?.overdrive) this.p('weapon-fired', 'broadside-ripple', { x: e.x + e.dirX * beam, z: e.z + e.dirZ * beam, delay: 0.03, gain: 0.7 });
        if (slot?.branch === 'A') this.p('weapon-fired', 'chain-rattle', { x: e.x + e.dirX * beam, z: e.z + e.dirZ * beam, delay: 0.06, gain: 0.6 });
        return;
      }
      case 'bow-chaser': {
        const x = e.x + fx * len * 0.5, z = e.z + fz * len * 0.5;
        const shots = Math.min(3, Math.max(1, e.count));
        for (let i = 0; i < shots; i++) this.p('weapon-fired', slot?.overdrive ? 'lance' : 'bow-chaser', { x, z, delay: i * 0.09, force: i > 0 });
        return;
      }
      case 'stern-mortar': {
        const shots = Math.min(4, Math.max(1, e.count));
        for (let i = 0; i < shots; i++) this.p('weapon-fired', 'mortar-launch', { x: e.x - fx * len * 0.45, z: e.z - fz * len * 0.45, delay: i * 0.12, force: i > 0 });
        return;
      }
      case 'swivel-guns': {
        const shots = Math.min(4, Math.max(1, e.count));
        for (let i = 0; i < shots; i++) this.p('weapon-fired', 'swivel-shot', { x: e.x + e.dirX * beam * 0.5, z: e.z + e.dirZ * beam * 0.5, delay: i * 0.045 + Math.random() * 0.02, force: i > 0 });
        return;
      }
      case 'fire-barrels': this.p('weapon-fired', 'barrel-drop', { x: e.x - fx * len * 0.5, z: e.z - fz * len * 0.5 }); return;
      case 'harpoon': this.p('weapon-fired', 'harpoon-throw', { x: e.x + fx * len * 0.5, z: e.z + fz * len * 0.5 }); return;
      case 'rocket-rack': {
        const shots = Math.min(5, Math.max(1, e.count));
        for (let i = 0; i < shots; i++) this.p('weapon-fired', 'rocket-launch', { x: e.x, z: e.z, delay: i * 0.07 + Math.random() * 0.03, force: i > 0 });
        return;
      }
      case 'storm-rod': return; // the 'lightning' event carries the zap
      case 'tide-mines': this.p('weapon-fired', 'mine-drop', { x: e.x - fx * len * 0.5, z: e.z - fz * len * 0.5 }); return;
      case 'iron-ram': return; // 'ram' events carry the crunch
      case 'escort-skiffs': this.p('weapon-fired', 'swivel-shot', { x: e.x, z: e.z, gain: 0.6 }); return;
      case 'maelstrom-charm': this.p('weapon-fired', 'whirlpool-cast', { x: e.x + e.dirX * 60, z: e.z + e.dirZ * 60 }); return;
    }
  }

  private enemyFired(e: Extract<SimEvent, { type: 'enemy-fired' }>): void {
    const cue = ENEMY_FIRE_CUE[e.projectile];
    if (cue === 'cannon-near') { this.gun('enemy-fired', e.x, e.z, e.count, cue); return; }
    this.p('enemy-fired', cue, { x: e.x, z: e.z, pitch: e.projectile === 'enemy-chaser' ? -1 : 0 });
    if (e.projectile === 'torpedo') this.p('enemy-fired', 'splash-small', { x: e.x, z: e.z, delay: 0.05 });
  }

  /** Cannon fire from a ship at (x,z): near or far variant by distance, a short ripple, a layered ripple for big volleys. */
  private gun(source: string, x: number, z: number, count: number, near: CueId): void {
    const d = this.dist(x, z);
    const far = d > CANNON_FAR_DISTANCE;
    const shots = Math.min(far ? 2 : 3, Math.max(1, count));
    for (let i = 0; i < shots; i++) this.p(source, far ? 'cannon-far' : near, { x, z, delay: i * (0.06 + Math.random() * 0.04), force: i > 0 });
    if (count >= 5) this.p(source, 'broadside-ripple', { x, z, delay: 0.04, gain: far ? 0.6 : 0.8, pitch: far ? -2 : 0 });
  }

  private projectileHit(e: Extract<SimEvent, { type: 'projectile-hit' }>): void {
    if (e.target === 'water') {
      this.p('projectile-hit', BIG_SPLASH.has(e.projectile) ? 'splash-large' : 'splash-small', { x: e.x, z: e.z, gain: e.team === 'enemy' ? 0.85 : 0.7 });
      return;
    }
    if (e.target === 'island') { this.p('projectile-hit', 'hit-rock', { x: e.x, z: e.z }); return; }
    if (e.targetId === 0) return; // the player's own hull: 'player-hit' plays the crunch
    const boss = e.targetId !== undefined ? this.run?.bosses.find((b) => b.id === e.targetId) : undefined;
    if (boss) {
      this.p('projectile-hit', boss.defId === 'tidewyrm' ? 'hit-flesh' : 'hit-metal', { x: e.x, z: e.z });
      return;
    }
    const cue = HIT_CUE[e.projectile];
    this.p('projectile-hit', cue, { x: e.x, z: e.z });
    if (e.projectile === 'heavy-shot' || e.projectile === 'lance') this.p('projectile-hit', 'splinters', { x: e.x, z: e.z, delay: 0.03, gain: 0.8 });
    if (e.projectile === 'chain-shot') this.p('projectile-hit', 'sail-rip', { x: e.x, z: e.z, delay: 0.02 });
  }

  private explosion(e: Extract<SimEvent, { type: 'explosion' }>): void {
    const pos = { x: e.x, z: e.z };
    const scale = Math.min(1.35, 0.7 + e.radius / 40);
    switch (e.kind) {
      case 'small': this.p('explosion', 'explosion-small', { ...pos, gain: scale }); return;
      case 'medium':
        this.p('explosion', 'explosion-small', { ...pos, gain: scale * 1.1, pitch: -2 });
        this.p('explosion', 'splinters', { ...pos, delay: 0.05, gain: 0.7 });
        return;
      case 'large':
        this.p('explosion', 'explosion-large', { ...pos, gain: scale });
        if (this.dist(e.x, e.z) < 260) this.h.duck({ target: 'sfx', depth: -4, hold: 0.25, attack: 0.02, release: 0.5 });
        return;
      case 'fire': this.p('explosion', 'fire-burst', { ...pos, gain: scale }); return;
      case 'powder':
        this.p('explosion', 'explosion-powder', { ...pos, gain: scale });
        this.p('explosion', 'shockwave', { ...pos, gain: 0.6, delay: 0.03 });
        if (this.dist(e.x, e.z) < 300) this.h.duck({ target: 'sfx', depth: -5, hold: 0.35, attack: 0.02, release: 0.6 });
        return;
      case 'mine':
        this.p('explosion', 'explosion-water', { ...pos, gain: scale, pitch: -2 });
        this.p('explosion', 'splash-large', { ...pos, delay: 0.12 });
        return;
      case 'mortar':
        this.p('explosion', 'explosion-small', { ...pos, gain: scale * 0.9, pitch: -1 });
        this.p('explosion', 'splash-large', { ...pos, delay: 0.02, gain: 0.7 });
        return;
      case 'lightning':
        this.p('explosion', 'thunder-near', { ...pos, gain: 0.8 });
        this.p('explosion', 'lightning-zap', pos);
        return;
      case 'water': this.p('explosion', 'explosion-water', { ...pos, gain: scale }); return;
    }
  }

  private playerHit(e: Extract<SimEvent, { type: 'player-hit' }>): void {
    const p = this.run?.player;
    const frac = p ? e.amount / Math.max(1, p.maxHp) : 0.05;
    if (e.parried) {
      this.p('player-hit', 'parry');
      this.p('player-hit', 'shockwave', { gain: 0.5, delay: 0.02 });
      return;
    }
    if (e.braced) { this.p('player-hit', 'brace-hit', { gain: Math.min(1.1, 0.6 + frac * 4) }); return; }
    this.p('player-hit', 'player-hit', { gain: Math.min(1.25, 0.6 + frac * 5) });
    if (frac > 0.08) this.p('player-hit', 'splinters', { delay: 0.03, gain: 0.8 });
    if (p && p.hp < p.maxHp * 0.3) this.p('player-hit', 'hull-creak', { delay: 0.15, pitch: -3, gain: 0.8 });
  }

  private enemyKilled(e: Extract<SimEvent, { type: 'enemy-killed' }>): void {
    this.p('enemy-killed', 'ship-break', { x: e.x, z: e.z, gain: e.elite ? 1.2 : 1 });
    this.p('enemy-killed', 'ship-sink', { x: e.x, z: e.z, delay: 0.5, gain: 0.7 });
    const now = this.now;
    this.killTimes.push(now);
    while (this.killTimes.length && now - this.killTimes[0]! > 8) this.killTimes.shift();
    if (e.elite) {
      this.p('enemy-killed', 'explosion-large', { x: e.x, z: e.z, delay: 0.08 });
      if (now - this.lastCheer > 5) { this.lastCheer = now; this.p('enemy-killed', 'crew-cheer', { delay: 0.5 }); }
    } else if (this.killTimes.length >= 6 && now - this.lastCheer > 12) {
      this.lastCheer = now;
      this.p('enemy-killed', 'crew-cheer', { delay: 0.3, gain: 0.7 });
    }
  }

  private pickup(e: Extract<SimEvent, { type: 'pickup-collected' }>): void {
    const cue = PICKUP_CUE[e.kind];
    if (e.kind === 'xp-copper' || e.kind === 'xp-silver' || e.kind === 'xp-gold') {
      const now = this.now;
      this.coinStreak = now - this.lastCoin < 0.45 ? this.coinStreak + 1 : 0;
      this.lastCoin = now;
      this.p('pickup-collected', cue, { pitch: Math.min(7, this.coinStreak * 0.5) });
      return;
    }
    this.p('pickup-collected', cue);
    if (e.kind === 'repair') this.p('pickup-collected', 'heal', { delay: 0.15, gain: 0.6 });
    if (e.kind === 'powder-keg') {
      this.p('pickup-collected', 'shockwave', { delay: 0.05 });
      this.h.duck({ target: 'sfx', depth: -5, hold: 0.4, attack: 0.02 });
    }
    if (e.kind === 'chest') this.p('pickup-collected', 'treasure-sparkle', { delay: 0.35 });
  }

  private skillUsed(e: Extract<SimEvent, { type: 'skill-used' }>): void {
    const skill = e.skill;
    switch (skill) {
      case 'brace': this.p('skill-used', 'brace'); return;
      case 'boost': this.p('skill-used', 'boost'); return;
      case 'broadside': return; // the volley's 'weapon-fired' carries it
      case 'special': case 'ultimate': return; // slot names only; ids below
    }
    if (e.slot === 'ultimate') {
      this.p('skill-used', 'ultimate-sting');
      this.h.duck({ target: 'music', depth: -7, hold: 1.2, release: 1.2 });
    }
    const id = skill as SpecialId | UltimateId;
    const at = { x: e.aimX, z: e.aimZ };
    switch (id) {
      case 'second-wind': this.p('skill-used', 'heal'); this.p('skill-used', 'shield-up', { delay: 0.2 }); return;
      case 'lionburst': this.p('skill-used', 'dash-whoosh'); this.p('skill-used', 'shockwave', { delay: 1.0, force: true }); this.p('skill-used', 'splash-large', { delay: 1.02 }); return;
      case 'deep-dive': this.p('skill-used', 'dive'); this.p('skill-used', 'splash-large', { delay: 3.0, pitch: -3 }); this.p('skill-used', 'explosion-water', { delay: 3.05 }); return;
      case 'chefs-banquet': this.p('skill-used', 'ship-bell'); this.p('skill-used', 'heal', { delay: 0.2 }); this.p('skill-used', 'crew-cheer', { delay: 0.5 }); return;
      case 'signal-flare': this.p('skill-used', 'flare'); this.p('skill-used', 'mortar-whistle', { ...at, delay: 0.6 }); return;
      case 'seaquake': this.p('skill-used', 'shockwave', { gain: 1.3, pitch: -3 }); this.p('skill-used', 'wave-roar', { delay: 0.1, gain: 0.8 }); this.h.duck({ target: 'sfx', depth: -4, hold: 0.4 }); return;
      case 'ramming-speed': this.p('skill-used', 'war-horn'); this.p('skill-used', 'boost', { delay: 0.2, pitch: -2 }); return;
      case 'sunfire-barrage': this.p('skill-used', 'fire-burst', { gain: 1.1 }); this.p('skill-used', 'war-horn', { delay: 0.25, gain: 0.7 }); return;
      case 'torpedo-swarm': for (let i = 0; i < 6; i++) this.p('skill-used', 'rocket-launch', { pitch: -5, delay: i * 0.09, force: true }); return;
      case 'kitchen-inferno': this.p('skill-used', 'fire-burst', { gain: 1.2 }); this.p('skill-used', 'fire-ignite', { delay: 0.3 }); return;
      case 'admirals-judgment': this.p('skill-used', 'flare'); this.p('skill-used', 'mortar-whistle', { ...at, delay: 0.5 }); this.p('skill-used', 'mortar-whistle', { ...at, delay: 0.8, force: true }); return;
      case 'tidal-colossus': this.p('skill-used', 'wave-roar', { gain: 1.3 }); this.p('skill-used', 'shockwave', { delay: 0.2 }); return;
    }
  }

  private statusChanged(e: Extract<SimEvent, { type: 'status-changed' }>): void {
    if (!e.on) return;
    const pos = e.target === 0 ? null : this.refPos(e.target);
    switch (e.status) {
      case 'burning': if (pos || e.target === 0) this.p('status-changed', 'fire-ignite', { ...(pos ?? {}), gain: e.target === 0 ? 0.8 : 0.7 }); return;
      case 'stunned': if (pos) this.p('status-changed', 'lightning-zap', { ...pos, gain: 0.5, pitch: 3 }); return;
      case 'shielded': if (e.target === 0) this.p('status-changed', 'shield-up', { gain: 0.8 }); return;
      default: return; // slowed/hooked/submerged/airborne/invulnerable/frenzy: carried by their skill or weapon cues
    }
  }

  private telegraph(e: Extract<SimEvent, { type: 'telegraph' }>): void {
    const friendly = e.team === 'player';
    if (e.shape === 'circle') {
      const len = this.h.cueLength('mortar-whistle') || 1.6;
      this.p('telegraph', 'mortar-whistle', { x: e.x, z: e.z, delay: Math.max(0, e.duration - len), gain: friendly ? 0.5 : 0.9 });
    } else if (!friendly) {
      this.p('telegraph', 'warning', { x: e.x, z: e.z, gain: 0.8 });
    }
  }

  private bossAttack(e: Extract<SimEvent, { type: 'boss-attack' }>): void {
    const pos = { x: e.x, z: e.z };
    const boss: BossId = e.boss;
    switch (e.attack) {
      case 'broadside-volley':
      case 'broadside-storm':
        this.p('boss-attack', 'broadside-ripple', { ...pos, pitch: -2, gain: 1.15 });
        this.p('boss-attack', 'cannon-far', { ...pos, delay: 0.15, force: true });
        this.p('boss-attack', 'cannon-near', { ...pos, delay: 0.3, pitch: -3, force: true });
        return;
      case 'mortar-barrage':
        for (let i = 0; i < 3; i++) this.p('boss-attack', 'mortar-launch', { ...pos, delay: i * 0.18, pitch: -2, force: true });
        return;
      case 'summon-cutters':
      case 'summon-man-o-war':
        this.p('boss-attack', 'ship-bell', pos);
        this.p('boss-attack', 'war-horn', { ...pos, delay: 0.3, gain: 0.6 });
        return;
      case 'ram-charge':
        this.p('boss-attack', 'war-horn', pos);
        this.p('boss-attack', 'hull-creak', { ...pos, pitch: -4, delay: 0.2 });
        return;
      case 'submerge-lunge':
        this.p('boss-attack', 'splash-large', { ...pos, pitch: -4, gain: 1.2 });
        this.p('boss-attack', 'serpent-roar', { ...pos, delay: 0.3, gain: 0.75 });
        return;
      case 'tail-slam':
        this.p('boss-attack', 'splash-large', { ...pos, gain: 1.2 });
        this.p('boss-attack', 'shockwave', { ...pos, delay: 0.05 });
        this.p('boss-attack', 'wave-roar', { ...pos, delay: 0.2, gain: 0.6 });
        return;
      case 'water-bolts':
        for (let i = 0; i < 3; i++) this.p('boss-attack', 'water-bolt', { ...pos, delay: i * 0.1, force: true });
        return;
      case 'summon-wyrmlings':
        this.p('boss-attack', 'serpent-roar', { ...pos, pitch: 3 });
        return;
      case 'judgment-line':
        this.p('boss-attack', 'flare', pos);
        this.p('boss-attack', 'mortar-whistle', { ...pos, delay: 0.4 });
        return;
      case 'arrive':
        return;
      default:
        this.p('boss-attack', boss === 'tidewyrm' ? 'water-bolt' : 'cannon-far', pos);
    }
  }

  private directorEvent(name: string): void {
    // An outcome banner ("Kraken Repelled!") follows its 'world-event' outcome in the same tick: that sting covers it.
    if (this.now - this.outcomeAt < 0.25) return;
    const n = name.toLowerCase();
    // Round-1 set pieces and bounty captains (matched by name so new events stay data-driven).
    if (n.includes('kraken')) { this.p('director-event', 'serpent-roar', { pitch: -5, gain: 1.1 }); this.p('director-event', 'wave-roar', { delay: 0.5 }); return; }
    if (n.includes('rogue') || n.includes('wave')) { this.p('director-event', 'wave-roar', { gain: 1.2 }); this.p('director-event', 'alarm-bell', { delay: 0.2, gain: 0.6 }); return; }
    if (n.includes('maelstrom') || n.includes('whirl')) { this.p('director-event', 'whirlpool-cast', { gain: 1.1 }); this.p('director-event', 'wave-roar', { delay: 0.4, gain: 0.7 }); return; }
    if (n.includes('blockade') || n.includes('armada')) { this.p('director-event', 'war-horn'); this.p('director-event', 'alarm-bell', { delay: 0.5, gain: 0.7 }); return; }
    if (n.includes('ghost') || n.includes('drowned')) { this.p('director-event', 'boss-horn', { pitch: 4, gain: 0.55 }); this.p('director-event', 'hull-creak', { delay: 0.6 }); return; }
    if (n.includes('erupt') || n.includes('volcan')) { this.p('director-event', 'explosion-large', { gain: 0.9 }); this.p('director-event', 'thunder-far', { delay: 0.3 }); return; }
    if (n.includes('claimed') || n.includes('complete')) { this.p('director-event', 'doubloon'); this.p('director-event', 'ship-bell', { delay: 0.2 }); return; }
    if (n.includes('bounty') || n.includes('contract') || n.includes('wanted')) { this.p('director-event', 'war-horn', { pitch: 2, gain: 0.7 }); this.p('director-event', 'elite-spawn', { delay: 0.3 }); return; }
    if (n.includes('sunken') || n.includes('dig')) { this.p('director-event', 'compass'); this.p('director-event', 'treasure-sparkle', { delay: 0.3 }); return; }
    if (n.includes('treasure') || n.includes('convoy')) { this.p('director-event', 'ship-bell'); this.p('director-event', 'treasure-sparkle', { delay: 0.3 }); return; }
    if (n.includes('storm')) { this.p('director-event', 'thunder-far', { gain: 1.1 }); return; }
    if (n.includes('fog')) { this.p('director-event', 'boss-horn', { pitch: 3, gain: 0.4 }); return; }
    if (n.includes('mortar')) { this.p('director-event', 'war-horn', { gain: 0.7 }); return; }
    this.p('director-event', 'alarm-bell', { gain: n.includes('ambush') || n.includes('fire') ? 1 : 0.7 });
  }

  /** Screen/status changes that have no SimEvent. */
  private diffs(screen: AppScreen, run: Readonly<RunState> | null, events: readonly SimEvent[]): void {
    const prev = this.prevScreen;
    if (prev !== null && prev !== screen) {
      if (screen === 'run') this.p('screen', 'set-sail');
      else if ((prev === 'title' && screen === 'harbor') || (prev === 'results' && screen === 'harbor')) this.p('screen', 'ui-transition');
    }
    this.prevScreen = screen;
    if (!run || screen !== 'run') { this.prevStatus = null; this.prevRerolls = -1; return; }
    const st = run.status;
    if (this.prevStatus !== null && st !== this.prevStatus) {
      if (st === 'paused') this.p('status', 'ui-open');
      else if (this.prevStatus === 'paused' && st === 'running') this.p('status', 'ui-close');
      else if (st === 'chest' && !events.some((e) => e.type === 'chest-opened' || (e.type === 'pickup-collected' && e.kind === 'chest'))) this.p('status', 'chest-open');
    }
    if (this.prevRerolls >= 0 && run.rerolls < this.prevRerolls) this.p('status', 'reroll');
    this.prevStatus = st;
    this.prevRerolls = run.rerolls;
  }

  // ───────────────────────── helpers ─────────────────────────

  private p(source: string, cue: CueId, opts?: PlayOptions): void {
    this.h.note(source, cue);
    this.h.play(cue, opts);
  }

  private dist(x: number, z: number): number {
    const l = this.listener;
    return l ? Math.hypot(x - l.x, z - l.z) : 0;
  }

  private refPos(id: ShipRef): Pos | null {
    const run = this.run;
    if (!run) return null;
    if (id === 0) return { x: run.player.x, z: run.player.z };
    const e = run.enemies.find((q) => q.id === id) ?? run.bosses.find((q) => q.id === id);
    return e ? { x: e.x, z: e.z } : null;
  }
}
