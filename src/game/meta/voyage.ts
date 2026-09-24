/**
 * Voyage options (REPLAY): what the harbor chose for the next run beyond ship and sea — the heat level per sea, the
 * daily voyage, starting boons — and the one place a new Sim receives them (`startVoyage`), so the runtime, the
 * balance sim and tests all start runs the same way.
 *
 * The harbor's Voyage pane writes the choice here; GameApp.startRun reads it with `takeVoyage` (UiCallbacks.onStartRun
 * carries only ship and sea). Choices persist in localStorage `cruise.voyage.v2`; a daily voyage request is one-shot.
 */
import { HEAT } from '../content/director';
import { SEA_IDS, WEAPON_IDS, type SeaId, type ShipId, type WeaponId } from '../ids';
import type { MetaProfile, RunResult, RunState, SimEvent } from '../types';
import { applyEffect, applyHeat, baseRunMods, configureRunMods, type RunMods } from '../sim/run-mods';
import { configureCaptains } from '../sim/captains-runtime';
import { recomputeStats } from '../sim/progression';
import type { SimContext } from '../sim/context';
import { dailyVoyage } from './daily';
import { boonCount, earnedBoons } from './quests';
import { RunTracker } from './tracker';
import type { VoyageRecord } from './save';

export interface VoyageOptions {
  /** Heat 0–8 for this run. */
  heat: number;
  /** Daily voyage key 'YYYY-MM-DD' ('' or undefined = an ordinary voyage). */
  daily?: string;
}

/** The parts of the Sim a voyage configures (the Sim itself). */
export type VoyageSim = SimContext & { readonly debug: { giveWeapon(id: WeaponId, level?: number, branch?: 'A' | 'B'): void } };

export const clampHeat = (heat: unknown): number =>
  typeof heat === 'number' && Number.isFinite(heat) ? Math.max(0, Math.min(HEAT.max, Math.floor(heat))) : 0;

/** Run modifiers for a sea at a heat level, with a daily voyage's rules folded in. */
export function voyageMods(seaId: SeaId, heat: number, daily?: string): RunMods {
  const mods = applyHeat(baseRunMods(seaId), clampHeat(heat));
  if (daily) {
    mods.daily = daily;
    for (const rule of dailyVoyage(daily).rules) applyEffect(mods, rule.effect);
  }
  return mods;
}

/** The weapon Armourer's Gift starts with when the captain has not picked one. */
export const DEFAULT_BOON_WEAPON: WeaponId = 'bow-chaser';

/** One voyage in progress: its options, modifiers and quest tracker (GameApp keeps it next to the Sim). */
export class Voyage {
  readonly tracker: RunTracker;
  constructor(readonly options: Readonly<VoyageOptions>, readonly mods: Readonly<RunMods>, profile: Readonly<MetaProfile>) {
    this.tracker = new RunTracker(profile, options.heat, options.daily);
  }

  /** Folds a frame's SimEvents into the quest counters; returns banner events to show this frame. */
  observe(events: readonly SimEvent[], state: Readonly<RunState> | null): SimEvent[] { return this.tracker.observe(events, state); }

  /** The record applyRunResult banks (call once per banking; the endless stretch banks again later). */
  bank(result: RunResult): VoyageRecord {
    const { run, delta } = this.tracker.take(result);
    return { heat: this.options.heat, daily: this.options.daily, run, delta };
  }
}

/**
 * Configures a freshly constructed Sim for a voyage: run modifiers (sea balance, heat, daily rules), the daily's
 * captain count, and the profile's starting boons (not on a daily voyage). Call after configureCaptains.
 */
export function startVoyage(sim: VoyageSim, profile: Readonly<MetaProfile>, opts: Readonly<VoyageOptions>): Voyage {
  const options: VoyageOptions = { heat: opts.daily ? 0 : clampHeat(opts.heat), ...(opts.daily ? { daily: opts.daily } : {}) };
  const mods = voyageMods(sim.state.seaId, options.heat, options.daily);
  configureRunMods(sim.state, mods);
  // The constructor computed stats with the sea's defaults: fold the voyage's bonuses in and start at full hull.
  recomputeStats(sim);
  if (sim.state.time === 0) sim.state.player.hp = sim.state.player.maxHp;
  if (options.daily) {
    for (const rule of dailyVoyage(options.daily).rules) if (rule.captains !== undefined) configureCaptains(sim.state, rule.captains);
  } else {
    applyBoons(sim, profile);
  }
  return new Voyage(options, mods, profile);
}

/** Starting boons earned through quests: extra rerolls and banishes, a chosen weapon at level 2. */
export function applyBoons(sim: VoyageSim, profile: Readonly<MetaProfile>): void {
  const s = sim.state;
  s.rerolls += boonCount(profile, 'quartermaster');
  s.banishes += boonCount(profile, 'black-spot');
  if (earnedBoons(profile).includes('armourer')) {
    const id = chosenBoonWeapon() ?? DEFAULT_BOON_WEAPON;
    sim.debug.giveWeapon(id, 2);
  }
}

// ───────────────────────── The harbor's choice (store) ─────────────────────────

const VOYAGE_KEY = 'cruise.voyage.v2';

interface VoyageChoice {
  /** Chosen heat per sea (clamped to what the profile has unlocked when read). */
  heat: Partial<Record<SeaId, number>>;
  /** Armourer's Gift weapon. */
  boonWeapon?: WeaponId;
  /** Captain title shown on the poster and logbook (must be earned). */
  title?: string;
}

let choice: VoyageChoice | null = null;
let pendingDaily: { key: string; shipId: ShipId; seaId: SeaId } | null = null;

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function loadChoice(): VoyageChoice {
  if (choice) return choice;
  const out: VoyageChoice = { heat: {} };
  try {
    const raw = storage()?.getItem(VOYAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const heat = (parsed as { heat?: unknown }).heat;
      if (heat && typeof heat === 'object') for (const sea of SEA_IDS) { const v = clampHeat((heat as Record<string, unknown>)[sea]); if (v > 0) out.heat[sea] = v; }
      const w = (parsed as { boonWeapon?: unknown }).boonWeapon;
      if (typeof w === 'string' && (WEAPON_IDS as readonly string[]).includes(w)) out.boonWeapon = w as WeaponId;
      const t = (parsed as { title?: unknown }).title;
      if (typeof t === 'string' && t.length <= 48) out.title = t;
    }
  } catch { /* unreadable: defaults */ }
  choice = out;
  return out;
}

function saveChoice(): void {
  try { storage()?.setItem(VOYAGE_KEY, JSON.stringify(loadChoice())); } catch { /* storage unavailable */ }
}

/** The heat chosen for a sea, clamped to the highest heat the profile may sail there. */
export function chosenHeat(profile: Readonly<MetaProfile>, seaId: SeaId): number {
  return Math.min(loadChoice().heat[seaId] ?? 0, maxHeat(profile, seaId));
}

export function setChosenHeat(seaId: SeaId, heat: number): void {
  const c = loadChoice();
  const v = clampHeat(heat);
  if (v > 0) c.heat[seaId] = v; else delete c.heat[seaId];
  saveChoice();
}

export function chosenBoonWeapon(): WeaponId | undefined { return loadChoice().boonWeapon; }

export function setChosenBoonWeapon(id: WeaponId | undefined): void {
  const c = loadChoice();
  if (id) c.boonWeapon = id; else delete c.boonWeapon;
  saveChoice();
}

export function chosenTitle(): string | undefined { return loadChoice().title; }

export function setChosenTitle(title: string | undefined): void {
  const c = loadChoice();
  if (title) c.title = title; else delete c.title;
  saveChoice();
}

/** The heat ladder opens with the first victory. */
export function heatUnlocked(profile: Readonly<MetaProfile>): boolean {
  return profile.wins > 0 || profile.achievements.includes('win-run');
}

/** Highest heat a profile may pick on a sea: heat 1 opens with the first victory; heat N+1 after winning heat N there. */
export function maxHeat(profile: Readonly<MetaProfile>, seaId: SeaId): number {
  if (!heatUnlocked(profile)) return 0;
  return Math.min(HEAT.max, Math.max(1, (profile.heat?.[seaId] ?? 0) + 1));
}

/** Queues the daily voyage for the next startRun (one-shot). */
export function requestDaily(key: string, shipId: ShipId, seaId: SeaId): void { pendingDaily = { key, shipId, seaId }; }

/**
 * What GameApp.startRun should sail: the queued daily voyage when ship and sea match it (consumed), otherwise an
 * ordinary voyage at the chosen heat.
 */
export function takeVoyage(profile: Readonly<MetaProfile>, shipId: ShipId, seaId: SeaId): VoyageOptions {
  const daily = pendingDaily;
  pendingDaily = null;
  if (daily && daily.shipId === shipId && daily.seaId === seaId) return { heat: 0, daily: daily.key };
  return { heat: chosenHeat(profile, seaId) };
}

/** Test hook: forget the cached choice (after localStorage changed underneath) and any queued daily. */
export function resetVoyageStore(): void { choice = null; pendingDaily = null; }
