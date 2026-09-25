/**
 * Round-2 fields the profile / settings loaders may drop (FLOW workaround, see the round-2 report): `seenHints` in the
 * profile, and `coach`, `colorBlind`, `hudScale`, `cinematicCamera` in the settings. They are read from the raw
 * saves once, when the UI mounts (before anything re-saves), and handed back through the normal callbacks on the
 * first frame, so they survive a reload even while src/game/meta/save.ts does not sanitize them. A no-op once it does.
 */
import { META_SAVE_KEY, SETTINGS_KEY } from '../../game/constants';
import type { Settings } from '../../game/types';

export interface Restorable {
  hints: string[];
  settings: Partial<Pick<Settings, 'coach' | 'colorBlind' | 'hudScale' | 'cinematicCamera'>>;
}

const COLOR_BLIND = ['off', 'deutan', 'protan', 'tritan'] as const;

function raw(key: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

export function readRestorable(): Restorable {
  const out: Restorable = { hints: [], settings: {} };
  const profile = raw(META_SAVE_KEY);
  if (profile && Array.isArray(profile.seenHints)) {
    for (const id of profile.seenHints) if (typeof id === 'string' && id.length <= 40 && !out.hints.includes(id)) out.hints.push(id);
  }
  const s = raw(SETTINGS_KEY);
  if (s) {
    if (typeof s.coach === 'boolean') out.settings.coach = s.coach;
    if (typeof s.cinematicCamera === 'boolean') out.settings.cinematicCamera = s.cinematicCamera;
    if (typeof s.hudScale === 'number' && Number.isFinite(s.hudScale)) out.settings.hudScale = Math.min(1.2, Math.max(0.8, s.hudScale));
    if (typeof s.colorBlind === 'string' && (COLOR_BLIND as readonly string[]).includes(s.colorBlind)) out.settings.colorBlind = s.colorBlind as Settings['colorBlind'];
  }
  return out;
}

/** The settings with any restorable field the loader dropped put back, or null when nothing is missing. */
export function mergeRestored(current: Readonly<Settings>, r: Restorable): Settings | null {
  let next: Settings | null = null;
  for (const k of Object.keys(r.settings) as (keyof Restorable['settings'])[]) {
    if (current[k] !== undefined || r.settings[k] === undefined) continue;
    next ??= { ...current };
    (next as unknown as Record<string, unknown>)[k] = r.settings[k];
  }
  return next;
}
