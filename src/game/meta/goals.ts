/**
 * Goals and quests (REPLAY-owned). `nextGoals` lists what the harbor should point the captain at next — unlocks
 * within reach, the next heat level, the closest quests, today's daily voyage — ranked, three at most; FLOW renders
 * them (the Quests pane shows them too).
 */
import { CONTENT } from '../content';
import { HEAT } from '../content/director';
import { META_UPGRADE_IDS, SEA_IDS, SHIP_IDS, type SeaId } from '../ids';
import type { MetaProfile } from '../types';
import { dailyBest, dailyKey, dailyVoyage } from './daily';
import { QUESTS, isDone, questState, rewardText } from './quests';
import { upgradeCost } from './save';
import { heatUnlocked } from './voyage';

export interface Goal {
  id: string;
  title: string;
  detail: string;
  /** 0..1 progress. */
  progress: number;
  reward?: string;
}

interface Ranked extends Goal { score: number; kind: 'unlock' | 'heat' | 'quest' | 'daily' | 'harbor' }

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

export function nextGoals(profile: Readonly<MetaProfile>, today = dailyKey()): Goal[] {
  const out: Ranked[] = [];

  // Ships and seas that unlock by feats (the biggest news in the harbor), and doubloon ships within reach.
  for (const id of SHIP_IDS) {
    const ship = CONTENT.ships[id];
    if (profile.unlockedShips.includes(id)) continue;
    if (ship.unlock.kind === 'achievement') {
      out.push({ id: `ship:${id}`, kind: 'unlock', score: 100, title: `Unlock ${ship.name}`, detail: `${ship.unlock.text}.`, progress: 0, reward: `${ship.name}, ${ship.epithet}` });
    } else if (ship.unlock.kind === 'doubloons') {
      const p = Math.min(1, profile.doubloons / ship.unlock.cost);
      out.push({
        id: `ship:${id}`, kind: 'unlock', score: 60 + 40 * p, title: p >= 1 ? `Buy ${ship.name}` : `Save for ${ship.name}`,
        detail: p >= 1 ? `The shipwright will sell her for ${fmt(ship.unlock.cost)} ◈.` : `${fmt(profile.doubloons)} of ${fmt(ship.unlock.cost)} ◈.`,
        progress: p, reward: `${ship.name}, ${ship.epithet}`,
      });
    }
  }
  for (const id of SEA_IDS) {
    const sea = CONTENT.seas[id];
    if (profile.unlockedSeas.includes(id) || sea.unlock.kind !== 'achievement') continue;
    out.push({ id: `sea:${id}`, kind: 'unlock', score: 98, title: `Open ${sea.name}`, detail: `${sea.unlock.text}.`, progress: 0, reward: sea.name });
  }

  // The heat ladder on the sea sailed last.
  if (heatUnlocked(profile)) {
    const sea: SeaId = profile.unlockedSeas.includes(profile.lastSea) ? profile.lastSea : 'sunward-shallows';
    const cleared = profile.heat?.[sea] ?? 0;
    if (cleared < HEAT.max) {
      const next = cleared + 1;
      const rule = HEAT.rules.find((r) => r.level === next);
      out.push({
        id: `heat:${sea}`, kind: 'heat', score: 72, title: `Win ${CONTENT.seas[sea].name} at heat ${next}`,
        detail: `${rule ? `${rule.name}: ${rule.text} ` : ''}Pays ×${(1 + HEAT.reward * next).toFixed(2)} doubloons and bounty.`,
        progress: cleared / HEAT.max, reward: next < HEAT.max ? `Heat ${next + 1} on this sea` : 'The top of the ladder',
      });
    }
  }

  // Quests, closest first (the far end of the heat ladder waits until it is near).
  const topHeat = Math.max(0, ...SEA_IDS.map((s) => profile.heat?.[s] ?? 0));
  for (const q of QUESTS) {
    if (isDone(profile, q.id)) continue;
    if (q.id === 'heat-8' && topHeat < 6) continue;
    if ((q.id === 'heat-2' || q.id === 'heat-4') && !heatUnlocked(profile)) continue;
    if (q.id === 'endless-2' && profile.wins === 0) continue;
    const st = questState(profile, q.id);
    const ratio = q.goal > 0 ? Math.min(1, st.progress / q.goal) : 0;
    out.push({ id: `quest:${q.id}`, kind: 'quest', score: 45 + 45 * ratio, title: q.name, detail: q.text, progress: ratio, reward: rewardText(q.reward) });
  }

  // Today's daily voyage (after the first voyage).
  if (profile.runs > 0 && dailyBest(profile, today) === 0) {
    const d = dailyVoyage(today);
    out.push({
      id: `daily:${today}`, kind: 'daily', score: 66, title: 'Sail today’s daily voyage',
      detail: `${CONTENT.ships[d.shipId].name} in ${CONTENT.seas[d.seaId].name}: ${d.rules.map((r) => r.name).join(' + ')}.`, progress: 0,
    });
  }

  // A harbor refit the captain can already afford.
  let cheapest: { name: string; cost: number } | null = null;
  for (const id of META_UPGRADE_IDS) {
    const cost = upgradeCost(profile as MetaProfile, id);
    if (cost !== null && cost <= profile.doubloons && (!cheapest || cost < cheapest.cost)) cheapest = { name: CONTENT.metaUpgrades[id].name, cost };
  }
  if (cheapest) out.push({ id: 'harbor', kind: 'harbor', score: 58, title: `Refit: ${cheapest.name}`, detail: `${fmt(cheapest.cost)} ◈ at the shipwright.`, progress: 1 });

  out.sort((a, b) => b.score - a.score);
  const picked: Ranked[] = [];
  let quests = 0;
  for (const g of out) {
    if (g.kind === 'quest' && quests >= 2) continue;
    if (g.kind === 'quest') quests++;
    picked.push(g);
    if (picked.length >= 3) break;
  }
  return picked.map(({ id, title, detail, progress, reward }) => (reward ? { id, title, detail, progress, reward } : { id, title, detail, progress }));
}
