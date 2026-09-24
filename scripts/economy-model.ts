/**
 * Doubloon career model (REPLAY). `npx tsx scripts/economy-model.ts [--from balance.json]`
 *
 * How many runs does the harbor last? Expected-value careers (no dice): each run pays
 *   p × victory + (1 − p) × loss, × Fortune × (1 + 0.25 × heat)
 * with victory/loss purses and base win rates per sea measured by scripts/balance-sim.ts at heat 0 (3 AI captains,
 * no harbor upgrades; --from recomputes them from a balance-sim --json file). The win rate falls 7 points per heat
 * level and rises 1.2 points per harbor rank bought. The captain buys the cheapest thing on offer whenever
 * they can afford it and banks quest doubloons as quests complete (meta/quests.ts, in the order a career meets them).
 *
 * Careers:
 * - harbor sailor: heat 0 forever, rotating the seas it has unlocked;
 * - steady climber: one heat level up on a sea after two wins there, capped at 4;
 * - fast climber: one heat level up after every win, up to 8.
 */
import { readFileSync } from 'node:fs';
import { CONTENT } from '../src/game/content';
import { HEAT } from '../src/game/content/director';
import { META_UPGRADE_IDS, SEA_IDS, SHIP_IDS, type SeaId } from '../src/game/ids';
import { QUESTS } from '../src/game/meta/quests';

interface SeaEconomy { win: number; victory: number; loss: number }

/** Heat-0 measurements (balance-sim --seeds 12 --captains 3, REPLAY round 2 after the pass). */
const MEASURED: Record<SeaId, SeaEconomy> = {
  'sunward-shallows': { win: 17 / 24, victory: 426, loss: 149 },
  'stormwrack-reach': { win: 12 / 24, victory: 445, loss: 127 },
  'the-gloam': { win: 7 / 24, victory: 460, loss: 190 },
};

const args = process.argv.slice(2);
const from = args.indexOf('--from') >= 0 ? args[args.indexOf('--from') + 1] : undefined;
const seas: Record<SeaId, SeaEconomy> = { ...MEASURED };
if (from) {
  const runs = JSON.parse(readFileSync(from, 'utf8')) as { sea: SeaId; outcome: string; doubloons: number }[];
  for (const sea of SEA_IDS) {
    const rs = runs.filter((r) => r.sea === sea);
    if (!rs.length) continue;
    const wins = rs.filter((r) => r.outcome === 'victory');
    const lost = rs.filter((r) => r.outcome !== 'victory');
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    seas[sea] = { win: wins.length / rs.length, victory: avg(wins.map((r) => r.doubloons)), loss: avg(lost.map((r) => r.doubloons)) };
  }
}

interface Item { id: string; cost: number; fortune: boolean }
function shopping(): Item[] {
  const items: Item[] = [];
  for (const id of META_UPGRADE_IDS) {
    const def = CONTENT.metaUpgrades[id];
    for (const cost of def.costs) items.push({ id, cost, fortune: id === 'fortune' });
  }
  for (const id of SHIP_IDS) { const u = CONTENT.ships[id].unlock; if (u.kind === 'doubloons') items.push({ id, cost: u.cost, fortune: false }); }
  return items;
}

type Policy = 'harbor' | 'steady' | 'fast';

function career(policy: Policy): { runs: number; ships: number; total: number; questDoubloons: number } {
  const items = shopping();
  const total = items.reduce((a, b) => a + b.cost, 0);
  const bought = new Map<string, number>();
  const questPurse = QUESTS.filter((q) => q.reward.doubloons).map((q) => q.reward.doubloons!);
  let questIdx = 0, bank = 0, fortune = 0, ranks = 0, ships = 0, runs = 0, questDoubloons = 0;
  const heat: Record<SeaId, number> = { 'sunward-shallows': 0, 'stormwrack-reach': 0, 'the-gloam': 0 };
  const winsAt: Record<SeaId, number> = { 'sunward-shallows': 0, 'stormwrack-reach': 0, 'the-gloam': 0 };
  while (bought.size < items.length && runs < 400) {
    runs++;
    const unlocked: SeaId[] = runs <= 2 ? ['sunward-shallows'] : runs <= 4 ? ['sunward-shallows', 'stormwrack-reach'] : [...SEA_IDS];
    const sea = unlocked[runs % unlocked.length]!;
    const e = seas[sea];
    const h = heat[sea];
    const p = Math.min(0.95, Math.max(0.1, e.win - 0.07 * h + 0.012 * ranks));
    const mul = (1 + 0.08 * fortune) * (1 + HEAT.reward * h);
    bank += (p * e.victory + (1 - p) * e.loss) * mul;
    // Quests: roughly one completes every second run early, then every fourth (they get harder).
    if (questIdx < questPurse.length && runs % (runs < 20 ? 2 : 4) === 0) { bank += questPurse[questIdx]!; questDoubloons += questPurse[questIdx]!; questIdx++; }
    winsAt[sea] += p;
    if (policy === 'steady' && winsAt[sea] >= 2 * (h + 1)) heat[sea] = Math.min(4, h + 1);
    if (policy === 'fast' && winsAt[sea] >= h + 1) heat[sea] = Math.min(HEAT.max, h + 1);
    // Greedy: cheapest thing on offer first.
    for (;;) {
      let best: Item | null = null, bestIdx = -1;
      items.forEach((it, i) => { const key = `${it.id}:${i}`; if (!bought.has(key) && (!best || it.cost < best.cost)) { best = it; bestIdx = i; } });
      if (!best || bank < (best as Item).cost) break;
      const it = best as Item;
      bank -= it.cost;
      bought.set(`${it.id}:${bestIdx}`, it.cost);
      if (it.fortune) fortune++;
      if ((SHIP_IDS as readonly string[]).includes(it.id)) ships++; else ranks++;
    }
  }
  return { runs, ships, total, questDoubloons };
}

console.log('Heat-0 inputs per sea (win rate, victory ◈, loss ◈):');
for (const sea of SEA_IDS) console.log(`  ${sea}: ${(seas[sea].win * 100).toFixed(0)}% · ${Math.round(seas[sea].victory)} · ${Math.round(seas[sea].loss)}`);
for (const policy of ['harbor', 'steady', 'fast'] as Policy[]) {
  const r = career(policy);
  console.log(`${policy.padEnd(7)}: whole harbor (${r.total} ◈) in ${r.runs} runs (quests paid ${Math.round(r.questDoubloons)} ◈)`);
}
