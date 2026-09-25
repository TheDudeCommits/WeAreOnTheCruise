/**
 * Small HUD-only preferences that are not part of the Settings contract (FLOW): kept in localStorage under
 * `cruise.hud.v1` and never required — a blocked or corrupt store just means defaults.
 */

export interface HudPrefs {
  /** Captains roster: one line per captain, or only its header line (Tab toggles). */
  roster: 'compact' | 'collapsed';
}

const KEY = 'cruise.hud.v1';
const DEFAULTS: HudPrefs = { roster: 'compact' };
let cache: HudPrefs | null = null;

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function hudPrefs(): Readonly<HudPrefs> {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = JSON.parse(store()?.getItem(KEY) ?? 'null') as Partial<HudPrefs> | null;
    if (raw && (raw.roster === 'compact' || raw.roster === 'collapsed')) cache.roster = raw.roster;
  } catch { /* defaults */ }
  return cache;
}

export function saveHudPrefs(patch: Partial<HudPrefs>): void {
  cache = { ...hudPrefs(), ...patch };
  try { store()?.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable */ }
}
