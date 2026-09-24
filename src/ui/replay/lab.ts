/**
 * Replay lab (lab/replay.html): the three REPLAY harbor panes in a harbor-shaped frame with a simulated career, for
 * screenshots before FLOW's harbor tabs land. `?pane=voyage|quests|logbook&profile=fresh|mid|veteran`.
 */
import '../../styles/ui.css';
import '../../styles/replay.css';
import { dailyKey } from '../../game/meta/daily';
import { applyRunResult, bareRecord, defaultProfile } from '../../game/meta/save';
import { setChosenHeat } from '../../game/meta/voyage';
import type { MetaProfile, RunResult, RunStats, Settings } from '../../game/types';
import type { UiCallbacks, UiFrame } from '../contracts';
import { h } from '../core/dom';
import { LogbookPane, QuestsPane, VoyagePane } from './panes';

const params = new URLSearchParams(location.search);
const stats = (o: Partial<RunStats>): RunStats => ({
  kills: 0, eliteKills: 0, damageDealt: 0, damageTaken: 0, bossesDefeated: [], doubloons: 0, xpCollected: 0, bounty: 0,
  killsByWeapon: {}, damageByWeapon: {}, ...o,
});

/** A career sailed through the real banking code (so quests, heat, history and dailies are all genuine). */
function career(kind: string): MetaProfile {
  const p = defaultProfile();
  if (kind === 'fresh') return p;
  const t0 = Date.UTC(2026, 8, 20, 18);
  const voyages: [RunResult['outcome'], RunResult['shipId'], RunResult['seaId'], number, number, number][] = kind === 'veteran'
    ? [['defeat', 'sunlion', 'sunward-shallows', 0, 520, 900], ['victory', 'sunlion', 'sunward-shallows', 0, 915, 2900], ['victory', 'dawn-ram', 'sunward-shallows', 1, 912, 3100],
      ['defeat', 'sunlion', 'stormwrack-reach', 0, 640, 1500], ['victory', 'sunlion', 'stormwrack-reach', 0, 930, 3000], ['victory', 'white-leviathan', 'sunward-shallows', 2, 920, 3300],
      ['victory', 'sunlion', 'the-gloam', 0, 940, 2600], ['defeat', 'dawn-ram', 'the-gloam', 1, 700, 1800], ['victory', 'seawarden', 'sunward-shallows', 3, 925, 3400],
      ['victory', 'sunlion', 'stormwrack-reach', 1, 935, 3200], ['retired', 'dawn-ram', 'sunward-shallows', 0, 240, 400], ['victory', 'sunlion', 'sunward-shallows', 4, 930, 3600],
      ['defeat', 'sunlion', 'sunward-shallows', 5, 780, 2400], ['victory', 'white-leviathan', 'the-gloam', 1, 950, 2700]]
    : [['defeat', 'sunlion', 'sunward-shallows', 0, 410, 700], ['defeat', 'dawn-ram', 'sunward-shallows', 0, 655, 1500], ['victory', 'sunlion', 'sunward-shallows', 0, 918, 3000],
      ['defeat', 'sunlion', 'stormwrack-reach', 0, 700, 1700], ['victory', 'dawn-ram', 'sunward-shallows', 1, 925, 3100]];
  voyages.forEach(([outcome, shipId, seaId, heat, time, kills], i) => {
    const r: RunResult = {
      outcome, shipId, seaId, time, level: Math.round(8 + time / 45), newUnlocks: [],
      doubloonsEarned: Math.round((outcome === 'victory' ? 430 : 60 + time / 5) * (1 + 0.25 * heat)),
      stats: stats({ kills, eliteKills: Math.round(kills / 70), bounty: Math.round(kills * 900 * (1 + 0.25 * heat)), bossesDefeated: outcome === 'victory' ? ['iron-warden', 'tidewyrm', 'sovereign'] : time > 600 ? ['iron-warden', 'tidewyrm'] : time > 300 ? ['iron-warden'] : [] }),
    };
    if (!p.unlockedShips.includes(shipId)) p.unlockedShips.push(shipId);
    const rec = { ...bareRecord(r, heat), bountyCaptains: i % 3, eventsWon: 2 + (i % 3), rogueRides: i === 3 ? 1 : 0, bossesSunk: r.stats.bossesDefeated.length, krakenSurvived: i === 4 ? 1 : 0, overdrives: Math.min(3, i % 4) };
    applyRunResult(p, r, false, { heat, run: rec });
    const h0 = p.history?.[0];
    if (h0) h0.at = t0 + i * 3.1e6;
  });
  if (kind === 'veteran') {
    const day = (n: number) => dailyKey(new Date(Date.now() - n * 86400000));
    p.daily = { [day(1)]: 612000, [day(2)]: 455000, [day(3)]: 301000 };
  }
  return p;
}

const profile = career(params.get('profile') ?? 'veteran');
if (params.get('heat')) setChosenHeat(profile.lastSea, Number(params.get('heat')));
const panes = [new VoyagePane(), new QuestsPane(), new LogbookPane()];
const cb = new Proxy({}, { get: (_t, name) => (...a: unknown[]) => console.log(`[cb] ${String(name)}`, ...a) }) as unknown as UiCallbacks;
for (const pane of panes) pane.mount(cb);

const tabs = h('nav', 'cr-tabs');
const panel = h('div', 'cr-harbor__panel');
let active = params.get('pane') ?? 'voyage';
for (const pane of panes) {
  const b = h('button', 'cr-tab', h('span', 'cr-tab__label', pane.label));
  b.addEventListener('click', () => { active = pane.id; show(); });
  b.dataset.tab = pane.id;
  tabs.append(b);
  panel.append(pane.el);
}
const root = document.getElementById('game-root')!;
const ui = h('div', 'cr-ui');
ui.append(h('section', 'cr-screen cr-harbor', h('div', 'cr-harbor__shade'),
  h('header', 'cr-harbor__top', h('div', 'cr-harbor__title', h('span', 'cr-harbor__title-main', 'The Harbor'), h('span', 'cr-harbor__title-sub', 'Replay lab')), tabs),
  panel));
root.append(ui);

function frame(): UiFrame {
  return { screen: 'harbor', time: 0, dt: 0.016, run: null, events: [], profile, settings: {} as Settings, result: null, selectedShip: profile.lastShip, fps: 60, world: null, project: (_x, _y, _z, o) => o };
}
function show(): void {
  for (const pane of panes) { pane.el.hidden = pane.id !== active; tabs.querySelector(`[data-tab='${pane.id}']`)?.classList.toggle('is-active', pane.id === active); }
}
show();
const loop = () => { for (const pane of panes) pane.update(frame()); requestAnimationFrame(loop); };
loop();
(window as unknown as { __REPLAY_LAB__: unknown }).__REPLAY_LAB__ = { profile, panes, show: (id: string) => { active = id; show(); } };
