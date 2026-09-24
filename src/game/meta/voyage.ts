/**
 * Voyage options (REPLAY): what the harbor chose for the next run beyond ship and sea — the heat level per sea and
 * the daily voyage — and the one place a new Sim receives them (`applyVoyage`), so the runtime, the balance sim and
 * tests all start runs the same way.
 *
 * The harbor's Voyage pane writes the choice here; GameApp.startRun reads it (UiCallbacks.onStartRun carries only
 * ship and sea). Heat choices persist in localStorage `cruise.voyage.v2`; a daily voyage request is one-shot.
 */
import { HEAT } from '../content/director';
import { SEA_IDS, WEAPON_IDS, type SeaId, type ShipId, type WeaponId } from '../ids';
import type { MetaProfile, RunState } from '../types';
import { applyHeat, baseRunMods, configureRunMods, type RunMods } from '../sim/run-mods';

export interface VoyageOptions {
  /** Heat 0–8 for this run. */
  heat: number;
  /** Daily voyage key 'YYYY-MM-DD' ('' or undefined = an ordinary voyage). */
  daily?: string;
}

/** Anything with a RunState and the debug hooks applyVoyage needs (the Sim). */
export interface VoyageSim {
  readonly state: RunState;
}

/** Builds the run modifiers for a sea at a heat level (daily rules are folded in by daily.ts). */
export function voyageMods(seaId: SeaId, heat: number): RunMods {
  return applyHeat(baseRunMods(seaId), heat);
}

/** Configures a freshly constructed Sim for this voyage: run modifiers (sea balance + heat). */
export function applyVoyage(sim: VoyageSim, opts: Readonly<VoyageOptions>): RunMods {
  const mods = voyageMods(sim.state.seaId, clampHeat(opts.heat));
  if (opts.daily) mods.daily = opts.daily;
  configureRunMods(sim.state, mods);
  return mods;
}

export const clampHeat = (heat: unknown): number =>
  typeof heat === 'number' && Number.isFinite(heat) ? Math.max(0, Math.min(HEAT.max, Math.floor(heat))) : 0;

// ───────────────────────── The harbor's choice (store) ─────────────────────────

const VOYAGE_KEY = 'cruise.voyage.v2';

interface VoyageChoice {
  /** Chosen heat per sea (clamped to what the profile has unlocked when read). */
  heat: Partial<Record<SeaId, number>>;
  /** Starting-boon weapon choice (Armourer's Gift), if any. */
  boonWeapon?: WeaponId;
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

/** Highest heat a profile may pick on a sea: the ladder opens with the first victory; heat N+1 after winning heat N. */
export function maxHeat(profile: Readonly<MetaProfile>, seaId: SeaId): number {
  if (!heatUnlocked(profile)) return 0;
  return Math.min(HEAT.max, Math.max(1, (profile.heat?.[seaId] ?? 0) + 1));
}

/** The heat ladder opens with the first victory (the 'win-run' achievement). */
export function heatUnlocked(profile: Readonly<MetaProfile>): boolean {
  return profile.achievements.includes('win-run');
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

/** Test hook: forget the cached choice (after localStorage changed underneath). */
export function resetVoyageStore(): void { choice = null; pendingDaily = null; }
