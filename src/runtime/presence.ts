/**
 * Captain presence (CAPTAINS-owned): who else sails this sea. The game has no multiplayer backend, so the only
 * implementation today is AiPresence: nobody is ever online and AI captains (src/game/sim/captains.ts, count from
 * Settings.captains) fill the roster. The roster header reads the headline from here, so switching to a live service
 * later changes the HUD without touching it.
 *
 * What a real online mode needs (not built; out of scope for round 1):
 *  - A realtime server: WebSocket (or WebRTC via a relay) rooms per sea/seed; a matchmaker that fills a room with
 *    live captains and tops the rest up with AI captains (the AI's count = room size − online captains).
 *  - Authority: the enemy fleet, director and loot stay authoritative in ONE place (a server sim, or a host client
 *    running this deterministic Sim), otherwise two players' fleets diverge; clients predict their own ship.
 *  - A snapshot protocol: 10–20 Hz snapshots of every captain (id, name, ship, x/z/heading/speed, hp/maxHp, level,
 *    bounty, alive/respawn) and of enemies near each client (quantised positions, hp fraction, life, hidden), plus a
 *    reliable event stream (weapon-fired, damage, kills, sunk/respawn, pickups claimed) keyed by server tick;
 *    interpolation buffers (~100 ms) on clients, clock sync, input messages with sequence numbers for reconciliation.
 *  - Identity and safety: display names (moderated), reconnect tokens, rate limits, server-side validation of hits
 *    and pickups (never trust client damage).
 *  - Presence changes: `onChange` fires when captains join or leave, so the roster and the AI top-up update live.
 */
import { SETTINGS_KEY } from '../game/constants';

export type PresenceMode = 'ai' | 'online';

export interface PresenceService {
  readonly mode: PresenceMode;
  /** Live (human) captains in this sea right now. */
  onlineCaptains(): number;
  /** Subscribes to presence changes; returns the unsubscribe function. */
  onChange(listener: (service: PresenceService) => void): () => void;
}

/** Offline presence: nobody is ever online; AI captains sail with the player. */
export class AiPresence implements PresenceService {
  readonly mode = 'ai' as const;
  onlineCaptains(): number { return 0; }
  onChange(_listener: (service: PresenceService) => void): () => void { return () => undefined; }
}

/** The presence service the HUD reads (swap for a live implementation when online play exists). */
export const presence: PresenceService = new AiPresence();

/** Roster header subline for the current presence. */
export function presenceHeadline(service: PresenceService = presence, aiCaptains = 0): string {
  const online = service.onlineCaptains();
  if (service.mode === 'online' && online > 0) return `${online} live captain${online === 1 ? '' : 's'} online`;
  return aiCaptains > 0 ? 'No live captains online — AI captains sail with you' : 'No live captains online';
}

/**
 * Settings.captains as saved (0–4), or undefined. Shim: META's sanitizeSettings (src/game/meta/save.ts) drops keys it
 * does not know, so GameApp restores this one field from the raw save until sanitizeSettings keeps it.
 */
export function storedCaptainSetting(): number | undefined {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_KEY);
    if (!raw) return undefined;
    const v = (JSON.parse(raw) as { captains?: unknown }).captains;
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(4, Math.round(v))) : undefined;
  } catch {
    return undefined;
  }
}
