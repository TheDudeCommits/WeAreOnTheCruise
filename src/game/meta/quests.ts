/**
 * Quests (REPLAY): 26 goals kept in MetaProfile.quests as { progress, done }. Voyage quests count the best single
 * voyage ("sink 3 bounty captains in one voyage"); ledger quests add up across voyages. Rewards are doubloons (banked
 * on completion) and things derived from the done flags, so the save only stores progress: captain titles (the
 * WANTED poster and the logbook), starting boons (an extra reroll or banish, a chosen weapon at level 2), pennant
 * colours, and the heat ladder itself.
 */
import { SHIP_IDS, type SeaId, type ShipId } from '../ids';
import type { MetaProfile, RunResult } from '../types';

export type BoonId = 'quartermaster' | 'black-spot' | 'armourer';
export type PennantId = 'crimson' | 'gold' | 'surf' | 'storm' | 'gloam' | 'ember' | 'ivory' | 'black';

export interface QuestReward {
  doubloons?: number;
  title?: string;
  boon?: BoonId;
  pennant?: PennantId;
  /** Opens the heat ladder (heat 1 on every sea). */
  heat?: true;
}

/** What a finished voyage contributes (built by RunTracker + the result). */
export interface RunRecord {
  result: RunResult;
  heat: number;
  daily?: string;
  /** Named bounty captains sunk. */
  bountyCaptains: number;
  /** Set pieces won (the tracker's 'success' verdicts). */
  eventsWon: number;
  /** Rogue waves ridden (a won Rogue Wave). */
  rogueRides: number;
  /** Kraken Risings the ship was still afloat for when they ended. */
  krakenSurvived: number;
  /** Bosses sunk without taking hull damage while they were afloat. */
  noHitBosses: number;
  /** Bosses sunk. */
  bossesSunk: number;
  /** Iron Wardens sunk within 60 s of arriving. */
  fastWardens: number;
  /** Weapons at OVERDRIVE ★ at the end. */
  overdrives: number;
  /** Volleys parried with a timed brace. */
  parries: number;
  /** Endless milestones reached. */
  milestones: number;
}

export interface QuestDef {
  id: string;
  name: string;
  text: string;
  /** 'voyage': best single voyage; 'ledger': summed across voyages (or read from the profile's own totals). */
  kind: 'voyage' | 'ledger';
  goal: number;
  reward: QuestReward;
  /** Value this voyage reaches (voyage quests) or adds (ledger quests). */
  measure(run: Readonly<RunRecord>): number;
  /** Backed by a profile total (kills, wins, voyages, longest voyage): progress is read from the profile. */
  total?(profile: Readonly<MetaProfile>): number;
}

const won = (r: Readonly<RunRecord>) => r.result.outcome === 'victory';
/** Longest voyage on any ship (s). */
export function longestVoyage(p: Readonly<MetaProfile>): number {
  let best = 0;
  for (const id of SHIP_IDS) best = Math.max(best, p.bestTime[id] ?? 0);
  return best;
}
const sea = (id: SeaId) => (r: Readonly<RunRecord>) => (won(r) && r.result.seaId === id ? 1 : 0);

export const QUESTS: readonly QuestDef[] = [
  // ── First steps ──
  // Backed by profile totals, so saves from before quests existed are credited at their next voyage.
  { id: 'weathered', name: 'Weathered Hull', text: 'Survive 10:00 in one voyage.', kind: 'voyage', goal: 600, reward: { doubloons: 100 }, measure: (r) => r.result.time, total: longestVoyage },
  { id: 'first-victory', name: 'Master of the Brightwater', text: 'Sink the Sovereign and win a voyage.', kind: 'voyage', goal: 1, reward: { doubloons: 150, heat: true, title: 'Captain' }, measure: (r) => (won(r) ? 1 : 0), total: (p) => p.wins },
  { id: 'voyages-10', name: 'Old Salt', text: 'Sail 10 voyages.', kind: 'ledger', goal: 10, reward: { doubloons: 150, boon: 'quartermaster' }, measure: () => 1, total: (p) => p.runs },
  // ── One-voyage feats ──
  { id: 'bounty-3', name: 'Bounty Hunter', text: 'Sink 3 bounty captains in one voyage.', kind: 'voyage', goal: 3, reward: { doubloons: 250, title: 'Bounty Hunter' }, measure: (r) => r.bountyCaptains },
  { id: 'kraken', name: 'Kraken Survivor', text: 'Still be afloat when a Kraken Rising ends.', kind: 'voyage', goal: 1, reward: { doubloons: 150 }, measure: (r) => r.krakenSurvived },
  { id: 'wave-rider', name: 'Wave Rider', text: 'Ride a rogue wave: boost through its crest.', kind: 'voyage', goal: 1, reward: { doubloons: 120, pennant: 'surf' }, measure: (r) => r.rogueRides },
  { id: 'untouchable', name: 'Untouchable', text: 'Sink a boss without taking hull damage while it is afloat.', kind: 'voyage', goal: 1, reward: { title: 'the Untouchable', pennant: 'ivory' }, measure: (r) => r.noHitBosses },
  { id: 'warden-60', name: 'Warden Breaker', text: 'Sink the Iron Warden within 60 s of its arrival.', kind: 'voyage', goal: 1, reward: { doubloons: 150 }, measure: (r) => r.fastWardens },
  { id: 'overdrive-3', name: 'Full Broadside', text: 'Reach OVERDRIVE ★ on 3 weapons in one voyage.', kind: 'voyage', goal: 3, reward: { boon: 'armourer' }, measure: (r) => r.overdrives },
  { id: 'elites-25', name: 'Elite Breaker', text: 'Sink 25 elites in one voyage.', kind: 'voyage', goal: 25, reward: { doubloons: 200 }, measure: (r) => r.result.stats.eliteKills },
  { id: 'events-4', name: 'Set-Piece Master', text: 'Win 4 set pieces in one voyage.', kind: 'voyage', goal: 4, reward: { boon: 'black-spot' }, measure: (r) => r.eventsWon },
  { id: 'level-30', name: 'Seasoned Captain', text: 'Reach level 30 in one voyage.', kind: 'voyage', goal: 30, reward: { doubloons: 200 }, measure: (r) => r.result.level },
  { id: 'parry-15', name: 'Iron Nerve', text: 'Parry 15 volleys with a timed brace in one voyage.', kind: 'voyage', goal: 15, reward: { doubloons: 150, pennant: 'crimson' }, measure: (r) => r.parries },
  { id: 'endless-2', name: 'Beyond the Horizon', text: 'Reach 2 endless milestones in one voyage.', kind: 'voyage', goal: 2, reward: { doubloons: 300, pennant: 'gold' }, measure: (r) => r.milestones },
  // ── Seas and heat ──
  { id: 'win-stormwrack', name: 'Storm Chaser', text: 'Win a voyage on Stormwrack Reach.', kind: 'voyage', goal: 1, reward: { doubloons: 300, title: 'Stormrider', pennant: 'storm' }, measure: sea('stormwrack-reach') },
  { id: 'win-gloam', name: 'Gloamwalker', text: 'Win a voyage in the Gloam.', kind: 'voyage', goal: 1, reward: { doubloons: 400, title: 'Gloamwalker', pennant: 'gloam' }, measure: sea('the-gloam') },
  { id: 'heat-2', name: 'Into the Heat', text: 'Win a voyage at heat 2 or higher.', kind: 'voyage', goal: 1, reward: { doubloons: 250, boon: 'quartermaster' }, measure: (r) => (won(r) && r.heat >= 2 ? 1 : 0) },
  { id: 'heat-4', name: 'Heatbearer', text: 'Win a voyage at heat 4 or higher.', kind: 'voyage', goal: 1, reward: { doubloons: 400, title: 'Heatbearer', pennant: 'ember' }, measure: (r) => (won(r) && r.heat >= 4 ? 1 : 0) },
  { id: 'heat-8', name: "Admiralty's Bane", text: 'Win a voyage at heat 8.', kind: 'voyage', goal: 1, reward: { title: 'Scourge of the Brightwater', pennant: 'black' }, measure: (r) => (won(r) && r.heat >= 8 ? 1 : 0) },
  { id: 'daily-win', name: 'Daily Duty', text: 'Win a daily voyage.', kind: 'voyage', goal: 1, reward: { doubloons: 200, title: "Harbor's Pick" }, measure: (r) => (won(r) && r.daily ? 1 : 0) },
  // ── The ledger ──
  { id: 'sink-5000', name: 'Scourge of the Seas', text: 'Sink 5,000 ships across all voyages.', kind: 'ledger', goal: 5000, reward: { doubloons: 300 }, measure: (r) => r.result.stats.kills, total: (p) => p.totalKills },
  { id: 'sink-25000', name: 'Terror of the Brightwater', text: 'Sink 25,000 ships across all voyages.', kind: 'ledger', goal: 25000, reward: { title: 'Terror of the Brightwater' }, measure: (r) => r.result.stats.kills, total: (p) => p.totalKills },
  { id: 'bounty-10', name: 'Letter of Marque', text: 'Sink 10 bounty captains across all voyages.', kind: 'ledger', goal: 10, reward: { doubloons: 300 }, measure: (r) => r.bountyCaptains },
  { id: 'bosses-30', name: 'Leviathan Hunter', text: 'Sink 30 bosses across all voyages.', kind: 'ledger', goal: 30, reward: { doubloons: 350 }, measure: (r) => r.bossesSunk },
  { id: 'events-25', name: 'Tall Tales', text: 'Win 25 set pieces across all voyages.', kind: 'ledger', goal: 25, reward: { doubloons: 250 }, measure: (r) => r.eventsWon },
  { id: 'wins-10', name: 'Admiral of the Brightwater', text: 'Win 10 voyages.', kind: 'ledger', goal: 10, reward: { doubloons: 400, title: 'Admiral of the Brightwater' }, measure: (r) => (won(r) ? 1 : 0), total: (p) => p.wins },
];

export const QUEST_IDS: readonly string[] = QUESTS.map((q) => q.id);
const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));
export const questDef = (id: string): QuestDef | undefined => BY_ID.get(id);

/** Titles in order of prestige (the highest earned one is shown by default). */
export const TITLES: readonly string[] = [
  'Deckhand', 'Captain', 'Bounty Hunter', 'Stormrider', "Harbor's Pick", 'the Untouchable', 'Gloamwalker', 'Heatbearer',
  'Admiral of the Brightwater', 'Terror of the Brightwater', 'Scourge of the Brightwater',
];

export const BOONS: Readonly<Record<BoonId, { name: string; text: string }>> = {
  quartermaster: { name: "Quartermaster's Favour", text: '+1 card reroll every voyage.' },
  'black-spot': { name: 'Marked Cards', text: '+1 card banish every voyage.' },
  armourer: { name: "Armourer's Gift", text: 'Start every voyage with a weapon of your choice at level 2.' },
};

export const PENNANTS: Readonly<Record<PennantId, { name: string; color: string }>> = {
  crimson: { name: 'Crimson', color: '#d8443a' },
  gold: { name: 'Gold', color: '#f2c14e' },
  surf: { name: 'Surf', color: '#5fd3e6' },
  storm: { name: 'Storm', color: '#7a8cff' },
  gloam: { name: 'Gloam', color: '#46e0b8' },
  ember: { name: 'Ember', color: '#ff8a3d' },
  ivory: { name: 'Ivory', color: '#f4efe2' },
  black: { name: 'Black Flag', color: '#1d1b22' },
};

// ───────────────────────── Progress ─────────────────────────

export interface QuestState { progress: number; done: boolean }

export function questState(profile: Readonly<MetaProfile>, id: string): QuestState {
  const def = BY_ID.get(id);
  const saved = profile.quests?.[id];
  const progress = def?.total ? def.total(profile) : saved?.progress ?? 0;
  return { progress: Math.min(def?.goal ?? progress, progress), done: saved?.done ?? false };
}

export const isDone = (profile: Readonly<MetaProfile>, id: string): boolean => profile.quests?.[id]?.done === true;

export function rewardText(r: Readonly<QuestReward>): string {
  const parts: string[] = [];
  if (r.doubloons) parts.push(`${r.doubloons} ◈`);
  if (r.heat) parts.push('the heat ladder');
  if (r.title) parts.push(`the title “${r.title}”`);
  if (r.boon) parts.push(BOONS[r.boon].name);
  if (r.pennant) parts.push(`the ${PENNANTS[r.pennant].name} pennant`);
  return parts.join(', ');
}

/**
 * Folds a finished voyage into the quest ledger. Completed quests pay their doubloons into the profile at once.
 * Returns the completed quests (results screen lines). Call after the profile's own totals (runs, wins, kills) have
 * been updated for this voyage. `run` holds whole-voyage values (voyage quests), `delta` what ledger quests should add
 * (the same record for an ordinary voyage; only the endless stretch when a won voyage is banked a second time).
 */
export function evaluateQuests(profile: MetaProfile, run: Readonly<RunRecord>, delta: Readonly<RunRecord> = run): QuestDef[] {
  const quests = (profile.quests ??= {});
  const completed: QuestDef[] = [];
  for (const def of QUESTS) {
    const prev = quests[def.id] ?? { progress: 0, done: false };
    if (prev.done) continue;
    let progress: number;
    if (def.total) progress = def.total(profile);
    else if (def.kind === 'voyage') progress = Math.max(prev.progress, def.measure(run));
    else progress = prev.progress + def.measure(delta);
    progress = Math.max(0, Math.min(def.goal, progress));
    const done = progress >= def.goal;
    if (progress <= 0 && !quests[def.id]) continue; // nothing to remember yet (keeps the save small)
    quests[def.id] = { progress, done };
    if (done) {
      completed.push(def);
      if (def.reward.doubloons) profile.doubloons += def.reward.doubloons;
    }
  }
  return completed;
}

/** Voyage quests that the run in progress has just met (for mid-run banners; banking still happens at the end). */
export function questsMetMidRun(profile: Readonly<MetaProfile>, run: Readonly<RunRecord>, announced: Set<string>): QuestDef[] {
  const out: QuestDef[] = [];
  for (const def of QUESTS) {
    if (def.kind !== 'voyage' || announced.has(def.id) || isDone(profile, def.id)) continue;
    if (def.id === 'first-victory' || def.id.startsWith('win-') || def.id.startsWith('heat-') || def.id === 'daily-win') continue;
    if (def.measure(run) >= def.goal) { announced.add(def.id); out.push(def); }
  }
  return out;
}

// ───────────────────────── Derived rewards ─────────────────────────

export function earnedTitles(profile: Readonly<MetaProfile>): string[] {
  const titles = new Set<string>(['Deckhand']);
  for (const def of QUESTS) if (def.reward.title && isDone(profile, def.id)) titles.add(def.reward.title);
  return TITLES.filter((t) => titles.has(t));
}

/** The captain's title: the chosen one if earned, else the most prestigious earned. */
export function captainTitle(profile: Readonly<MetaProfile>, chosen?: string): string {
  const titles = earnedTitles(profile);
  if (chosen && titles.includes(chosen)) return chosen;
  return titles[titles.length - 1] ?? 'Deckhand';
}

export function earnedBoons(profile: Readonly<MetaProfile>): BoonId[] {
  const out: BoonId[] = [];
  for (const def of QUESTS) if (def.reward.boon && isDone(profile, def.id) && !out.includes(def.reward.boon)) out.push(def.reward.boon);
  return out;
}

/** How many times a boon was earned (Quartermaster's Favour stacks: two quests grant it). */
export function boonCount(profile: Readonly<MetaProfile>, boon: BoonId): number {
  let n = 0;
  for (const def of QUESTS) if (def.reward.boon === boon && isDone(profile, def.id)) n++;
  return n;
}

export function earnedPennants(profile: Readonly<MetaProfile>): PennantId[] {
  const out: PennantId[] = [];
  for (const def of QUESTS) if (def.reward.pennant && isDone(profile, def.id)) out.push(def.reward.pennant);
  return out;
}

/** Ships a captain has won with (history + the win-with quests are per voyage; this reads the logbook). */
export function winningShips(profile: Readonly<MetaProfile>): ShipId[] {
  const out: ShipId[] = [];
  for (const h of profile.history ?? []) if (h.outcome === 'victory' && !out.includes(h.shipId)) out.push(h.shipId);
  return SHIP_IDS.filter((id) => out.includes(id));
}

