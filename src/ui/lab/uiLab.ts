/**
 * UI lab (lab/ui.html): mounts the real Ui over a screenshot plate with mock state, a control panel (sliders,
 * event buttons) and URL presets for deterministic screenshots, e.g.
 *   /lab/ui.html?screen=run&bg=day&panel=0&modal=branch&boss=1&freeze=1
 * Params: screen, bg, panel, tab, ship, profile, modal, boss, hp, pad, outcome, fire, freeze, sea.
 */
import '../../styles/ui.css';
import * as THREE from 'three';
import { CONTENT } from '../../game/content';
import { SHIP_IDS, type SeaId, type ShipId } from '../../game/ids';
import { purchaseUpgrade, unlockShip } from '../../game/meta/save';
import type { RunResult, Settings, SimEvent } from '../../game/types';
import type { AppScreen } from '../../render/frame';
import type { ScreenPoint, UiCallbacks, UiFrame } from '../contracts';
import { Ui } from '../Ui';
import { mockBoss, mockProfile, mockResult, mockRun, mockSettings, OFFER_SETS } from './mock';

const params = new URLSearchParams(location.search);
const root = document.getElementById('game-root')!;
const bg = document.getElementById('lab-bg')!;
const panel = document.getElementById('lab-panel')!;

const BACKGROUNDS: Record<string, string> = {
  menu: '/ui/plates/menu.jpg',
  day: '/ui/plates/day.jpg',
  night: '/ui/plates/night.jpg',
  storm: '/ui/plates/storm.jpg',
  // Generated paint-over targets (dev server only; not engine frames): stress-tests over bright water / night.
  't-bright': '/docs/aaa-overhaul/targets/t1-hero-sailing.jpg',
  't-night': '/docs/aaa-overhaul/targets/t4-night.jpg',
  't-storm': '/docs/aaa-overhaul/targets/t5-storm.jpg',
  none: '',
};

const state = {
  screen: (params.get('screen') ?? 'title') as AppScreen,
  profile: mockProfile((params.get('profile') as 'fresh' | 'rich' | 'mid') ?? 'mid'),
  settings: mockSettings(),
  run: mockRun((params.get('ship') as ShipId) ?? 'sunlion', (params.get('sea') as SeaId) ?? 'sunward-shallows'),
  result: null as RunResult | null,
  selectedShip: (params.get('ship') as ShipId) ?? 'sunlion',
  freeze: params.get('freeze') === '1',
  events: [] as SimEvent[],
  time: 0,
  paused: false,
  camYaw: 0,
};
if (params.get('ship')) state.profile.lastShip = state.selectedShip;

function setBg(key: string): void {
  const url = BACKGROUNDS[key] ?? key;
  bg.style.backgroundImage = url ? `url('${url}')` : 'none';
  bg.dataset.key = key;
}
setBg(params.get('bg') ?? (state.screen === 'run' ? 'day' : 'menu'));

// ── Mock camera for project(): tactical 3/4 view behind the player, like the game camera. ──
const camera = new THREE.PerspectiveCamera(48, 16 / 9, 1, 6000);
const v3 = new THREE.Vector3();
function placeCamera(): void {
  const p = state.run.player;
  const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  camera.position.set(p.x + Math.sin(state.camYaw) * 120, 150, p.z + Math.cos(state.camYaw) * 120);
  camera.lookAt(p.x, 0, p.z);
  camera.updateMatrixWorld();
}
function project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
  const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
  v3.set(x, y, z).project(camera);
  out.x = (v3.x * 0.5 + 0.5) * w;
  out.y = (-v3.y * 0.5 + 0.5) * h;
  out.visible = v3.z < 1 && v3.x >= -1 && v3.x <= 1 && v3.y >= -1 && v3.y <= 1;
  return out;
}

const ui = new Ui();
const emit = (e: SimEvent) => state.events.push(e);

function setScreen(screen: AppScreen): void {
  state.screen = screen;
  ui.setScreen(screen);
  if (screen === 'run' && bg.dataset.key === 'menu') setBg('day');
  if ((screen === 'harbor' || screen === 'title') && bg.dataset.key !== 'menu' && !params.get('bg')) setBg('menu');
  syncPanel();
}

function openOffers(set: string): void {
  const run = state.run;
  if (set === 'chest') { run.offers = structuredClone(OFFER_SETS.chest!); run.status = 'chest'; emit({ type: 'chest-opened', rewards: run.offers }); return; }
  run.offers = structuredClone(OFFER_SETS[set] ?? OFFER_SETS.basic!);
  run.pendingLevelUps = set === 'four' ? 2 : 1;
  run.status = 'levelup';
  emit({ type: 'level-up', level: run.player.level });
}

const callbacks: UiCallbacks = {
  onUserGesture: () => undefined,
  onGoToHarbor: () => setScreen('harbor'),
  onSelectShip: (id) => { state.selectedShip = id; state.profile.lastShip = id; },
  onStartRun: (ship, sea) => { state.run = mockRun(ship, sea); state.run.seed = `lab-${Date.now()}`; state.selectedShip = ship; setScreen('run'); },
  onChooseCard: (i) => {
    const run = state.run;
    const offer = run.offers?.[i];
    if (!offer) return;
    if (run.status === 'levelup') {
      emit({ type: 'card-chosen', offer });
      if (offer.kind === 'new-weapon' && run.player.weapons.length < 6) { run.player.weapons.push({ id: offer.id as never, level: 1, overdrive: false, cooldown: 0, scratch: {} }); emit({ type: 'weapon-changed', weapon: offer.id as never, level: 1, overdrive: false, isNew: true }); }
      if (offer.kind === 'weapon-level' || offer.kind === 'weapon-branch' || offer.kind === 'weapon-overdrive') {
        const w = run.player.weapons.find((x) => x.id === offer.id);
        if (w) { w.level = offer.level ?? w.level + 1; if (offer.branch) w.branch = offer.branch; w.overdrive = w.level >= 6; emit({ type: 'weapon-changed', weapon: w.id, level: w.level, branch: w.branch, overdrive: w.overdrive, isNew: false }); }
      }
      if (offer.kind === 'new-passive' && run.player.passives.length < 6) { run.player.passives.push({ id: offer.id as never, rank: 1 }); emit({ type: 'passive-changed', passive: offer.id as never, rank: 1, isNew: true }); }
      if (offer.kind === 'passive-rank') { const p = run.player.passives.find((x) => x.id === offer.id); if (p) { p.rank++; emit({ type: 'passive-changed', passive: p.id, rank: p.rank, isNew: false }); } }
      run.pendingLevelUps = Math.max(0, run.pendingLevelUps - 1);
      if (run.pendingLevelUps > 0) { run.offers = structuredClone(OFFER_SETS.basic!); }
      else { run.offers = null; run.status = 'running'; }
    } else if (run.status === 'chest') { run.offers = null; run.status = 'running'; }
  },
  onReroll: () => { const r = state.run; if (r.rerolls > 0 && r.offers) { r.rerolls--; r.offers = structuredClone(OFFER_SETS.four!).slice(0, r.offers.length); } },
  onBanish: (i) => { const r = state.run; if (r.banishes > 0 && r.offers?.[i]) { r.banishes--; r.banished.push(r.offers[i]!.id); r.offers = structuredClone(OFFER_SETS.basic!); } },
  onPause: (p) => { state.paused = p; const r = state.run; if (p && r.status === 'running') r.status = 'paused'; else if (!p && r.status === 'paused') r.status = 'running'; },
  onRetire: () => { emit({ type: 'run-ended', outcome: 'retired' }); state.run.status = 'dead'; window.setTimeout(() => showResults('retired'), 1200); },
  onReturnToHarbor: () => setScreen('harbor'),
  onPurchaseUpgrade: (id) => { purchaseUpgrade(state.profile, id); },
  onUnlockShip: (id) => { if (unlockShip(state.profile, id)) state.selectedShip = id; },
  onSettingsChange: (s: Settings) => { state.settings = s; },
};

function showResults(outcome: RunResult['outcome']): void {
  state.result = mockResult(outcome, state.run);
  const best = state.profile.bestBounty[state.result.shipId] ?? 0;
  state.profile.bestBounty[state.result.shipId] = Math.max(best, state.result.stats.bounty);
  setScreen('results');
}

ui.mount(root, callbacks);

// ── Simulation-ish animation ──
let last = performance.now();
const frame: UiFrame = {
  screen: 'boot', time: 0, dt: 0, run: null, events: [], profile: state.profile, settings: state.settings, result: null,
  selectedShip: state.selectedShip, fps: 60, world: null, project,
};

function tick(now: number): void {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  state.time += dt;
  const run = state.run;
  if (state.screen === 'run' && run.status === 'running' && !state.freeze) {
    run.time += dt;
    const p = run.player;
    p.heading += dt * 0.05;
    state.camYaw += dt * 0.03;
    for (const e of run.enemies) {
      const r = e.ai.r ?? 200; e.ai.a = (e.ai.a ?? 0) + dt * (e.ai.orbit ?? 0.03);
      e.x = p.x + Math.sin(e.ai.a) * r; e.z = p.z + Math.cos(e.ai.a) * r;
    }
    const sk = p.skills;
    for (const key of ['broadside', 'special', 'brace', 'boost'] as const) {
      const s = sk[key];
      if (s.cooldown > 0) { s.cooldown = Math.max(0, s.cooldown - dt); if (s.cooldown === 0) emit({ type: 'skill-ready', slot: key }); }
      if (s.active > 0) s.active = Math.max(0, s.active - dt);
    }
    if (sk.ultimate.charge < 1) sk.ultimate.charge = Math.min(1, sk.ultimate.charge + dt * 0.01);
    if (sk.ultimate.active > 0) sk.ultimate.active = Math.max(0, sk.ultimate.active - dt);
    p.xp = Math.min(p.xpToNext - 0.01, p.xp + dt * 0.8);
    if (run.stats.kills < 99999 && Math.random() < dt * 2) { run.stats.kills++; run.stats.bounty += 4000; }
  }
  placeCamera();
  frame.screen = state.screen;
  frame.time = state.time;
  frame.dt = dt;
  frame.run = state.screen === 'run' || state.screen === 'results' ? run : null;
  frame.events = state.events.splice(0, state.events.length);
  frame.profile = state.profile;
  frame.settings = state.settings;
  frame.result = state.result;
  frame.selectedShip = state.selectedShip;
  frame.fps = 60 - Math.random() * 2;
  ui.update(frame);
}

// ── Event helpers (also on window.__UI_LAB__ for scripted captures) ──
function fire(name: string): void {
  const run = state.run;
  const p = run.player;
  const ship = CONTENT.ships[run.shipId];
  switch (name) {
    case 'boss-warning': emit({ type: 'boss-warning', boss: 'iron-warden', eta: 10 }); run.time = Math.max(run.time, 290); break;
    case 'boss': run.bosses = [mockBoss('iron-warden', 0.62)]; emit({ type: 'boss-spawned', boss: 'iron-warden', id: 9000, x: 240, z: -300 }); break;
    case 'boss-phase': if (run.bosses[0]) { run.bosses[0].phase = 1; run.bosses[0].hp = run.bosses[0].maxHp * 0.45; emit({ type: 'boss-phase', boss: run.bosses[0].defId, id: 9000, phase: 1 }); } break;
    case 'boss-hit': if (run.bosses[0]) run.bosses[0].hp = Math.max(0, run.bosses[0].hp - run.bosses[0].maxHp * 0.06); break;
    case 'boss-defeated': if (run.bosses[0]) { run.bosses[0].hp = 0; run.bosses[0].life = 'sinking'; emit({ type: 'boss-defeated', boss: run.bosses[0].defId, id: 9000, x: 0, z: 0 }); window.setTimeout(() => { run.bosses = []; }, 2500); } break;
    case 'boss-clear': run.bosses = []; break;
    case 'director-event': emit({ type: 'director-event', name: 'Ambush Ring', text: 'Raider skiffs close in from every side!' }); break;
    case 'level-up': openOffers('basic'); break;
    case 'branch': case 'overdrive': case 'four': case 'chest': openOffers(name); break;
    case 'q-ready': p.skills.broadside.cooldown = 0; emit({ type: 'skill-ready', slot: 'broadside' }); break;
    case 'e-ready': p.skills.special.cooldown = 0; emit({ type: 'skill-ready', slot: 'special' }); break;
    case 'special': p.skills.special.cooldown = p.skills.special.cooldownMax; p.skills.special.active = 1; emit({ type: 'skill-used', slot: 'special', skill: ship.special, x: 0, z: 0, aimX: 0, aimZ: 0 }); break;
    case 'ultimate': p.skills.ultimate.charge = 0; p.skills.ultimate.active = 6; emit({ type: 'skill-used', slot: 'ultimate', skill: ship.ultimate, x: 0, z: 0, aimX: 0, aimZ: 0 }); break;
    case 'ult-full': p.skills.ultimate.charge = 1; break;
    case 'hit': { const a = Math.random() * Math.PI * 2; p.hp = Math.max(1, p.hp - p.maxHp * 0.08); emit({ type: 'player-hit', amount: p.maxHp * 0.08, x: Math.sin(a) * 120, z: Math.cos(a) * 120, braced: false, parried: false }); break; }
    case 'parry': emit({ type: 'player-hit', amount: 2, x: 90, z: -60, braced: true, parried: true }); p.skills.brace.cooldown = p.skills.brace.cooldownMax; p.skills.brace.active = 1; break;
    case 'tier-up': p.tier = Math.min(4, p.tier + 1); emit({ type: 'tier-up', tier: p.tier }); break;
    case 'revive': emit({ type: 'player-died', reviving: true }); p.hp = p.maxHp * 0.5; break;
    case 'new-weapon': emit({ type: 'weapon-changed', weapon: 'harpoon', level: 1, overdrive: false, isNew: true }); break;
    case 'repair': emit({ type: 'pickup-collected', id: 1, kind: 'repair', x: 0, z: 0, value: 1 }); break;
    case 'weather': emit({ type: 'weather-changed', weather: 'storm' }); break;
    case 'victory': emit({ type: 'run-ended', outcome: 'victory' }); break;
    case 'defeat': emit({ type: 'run-ended', outcome: 'defeat' }); break;
    case 'results-victory': showResults('victory'); break;
    case 'results-defeat': showResults('defeat'); break;
    case 'results-retired': showResults('retired'); break;
    default: break;
  }
}

function key(code: string): void { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); }
function click(sel: string): void { (document.querySelector(sel) as HTMLElement | null)?.click(); }

function openModal(name: string): void {
  if (['basic', 'levelup', 'branch', 'overdrive', 'four', 'chest'].includes(name)) { openOffers(name === 'levelup' ? 'basic' : name); return; }
  if (name === 'pause') key('Escape');
  if (name === 'settings') { if (state.screen === 'run') { key('Escape'); window.setTimeout(() => click('.cr-pause .cr-menuitem:nth-child(2)'), 50); } else key('Escape'); }
  if (name === 'controls') { key('Escape'); window.setTimeout(() => click('.cr-pause .cr-menuitem:nth-child(3)'), 50); }
  if (name === 'confirm') { key('Escape'); window.setTimeout(() => click('.cr-pause .cr-menuitem:nth-child(4)'), 50); }
}

(window as unknown as { __UI_LAB__: unknown }).__UI_LAB__ = { state, fire, setScreen, openModal, setBg, key };

// ── Control panel ──
function syncPanel(): void {
  panel.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach((b) => b.classList.toggle('on', b.dataset.screen === state.screen));
}

function buildPanel(): void {
  const sec = (title: string) => { const d = document.createElement('section'); d.innerHTML = `<h4>${title}</h4>`; panel.append(d); return d; };
  const btn = (host: HTMLElement, label: string, fn: () => void, data?: Record<string, string>) => {
    const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); if (data) Object.assign(b.dataset, data); host.append(b); return b;
  };
  const slider = (host: HTMLElement, label: string, get: () => number, set: (v: number) => void) => {
    const row = document.createElement('label'); row.textContent = label;
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'; input.value = String(get());
    input.addEventListener('input', () => set(Number(input.value))); row.append(input); host.append(row);
  };
  const head = document.createElement('header');
  head.innerHTML = '<b>UI LAB</b><span>We Are On The Cruise</span>';
  btn(head, '×', () => panel.classList.toggle('collapsed'));
  panel.append(head);
  const s1 = sec('Screen');
  for (const sc of ['title', 'harbor', 'run', 'results'] as AppScreen[]) btn(s1, sc, () => (sc === 'results' ? showResults('victory') : setScreen(sc)), { screen: sc });
  const s2 = sec('Background');
  for (const k of Object.keys(BACKGROUNDS)) btn(s2, k, () => setBg(k));
  const s3 = sec('Player');
  const p = () => state.run.player;
  slider(s3, 'Hull', () => p().hp / p().maxHp, (v) => { p().hp = Math.max(0, v * p().maxHp); });
  slider(s3, 'Shield', () => p().shield / p().maxHp, (v) => { p().shield = v * p().maxHp; });
  slider(s3, 'XP', () => p().xp / p().xpToNext, (v) => { p().xp = v * p().xpToNext; });
  slider(s3, 'Q cooldown', () => p().skills.broadside.cooldown / 8, (v) => { p().skills.broadside.cooldown = v * 8; });
  slider(s3, 'E cooldown', () => p().skills.special.cooldown / 18, (v) => { p().skills.special.cooldown = v * 18; });
  slider(s3, 'R charge', () => p().skills.ultimate.charge, (v) => { p().skills.ultimate.charge = v; });
  slider(s3, 'Brace cd', () => p().skills.brace.cooldown / 5, (v) => { p().skills.brace.cooldown = v * 5; });
  slider(s3, 'Boost cd', () => p().skills.boost.cooldown / 6, (v) => { p().skills.boost.cooldown = v * 6; });
  slider(s3, 'Gear', () => p().gear / 2, (v) => { p().gear = Math.round(v * 2) as 0 | 1 | 2; });
  slider(s3, 'Level', () => p().level / 40, (v) => { p().level = Math.max(1, Math.round(v * 40)); });
  slider(s3, 'Boss HP', () => state.run.bosses[0] ? state.run.bosses[0].hp / state.run.bosses[0].maxHp : 0.6, (v) => { const b = state.run.bosses[0]; if (b) b.hp = v * b.maxHp; });
  const s4 = sec('Events');
  for (const e of ['level-up', 'branch', 'overdrive', 'four', 'chest', 'boss-warning', 'boss', 'boss-hit', 'boss-phase', 'boss-defeated', 'director-event', 'q-ready', 'e-ready', 'special', 'ultimate', 'ult-full', 'hit', 'parry', 'tier-up', 'revive', 'new-weapon', 'repair', 'weather', 'victory', 'defeat']) btn(s4, e, () => fire(e));
  const s5 = sec('Modals / results');
  for (const m of ['pause', 'settings', 'controls', 'confirm']) btn(s5, m, () => openModal(m));
  for (const r of ['results-victory', 'results-defeat', 'results-retired']) btn(s5, r.replace('results-', ''), () => fire(r));
  const s6 = sec('Profile / input');
  btn(s6, 'fresh', () => { Object.assign(state.profile, mockProfile('fresh')); });
  btn(s6, 'mid', () => { Object.assign(state.profile, mockProfile('mid')); });
  btn(s6, 'rich', () => { Object.assign(state.profile, mockProfile('rich')); });
  btn(s6, 'pad prompts', () => document.querySelector('.cr-ui')?.classList.toggle('is-pad'));
  btn(s6, 'freeze', () => { state.freeze = !state.freeze; });
  btn(s6, 'fps', () => { state.settings = { ...state.settings, showFps: !state.settings.showFps }; });
  for (const id of SHIP_IDS) btn(s6, id, () => { state.selectedShip = id; state.run = mockRun(id, state.run.seaId); state.run.seed = `lab-${id}`; });
  syncPanel();
}

if (params.get('panel') === '0') panel.remove(); else buildPanel();

// ── Apply URL presets ──
setScreen(state.screen);
if (state.screen === 'results') showResults((params.get('outcome') as RunResult['outcome']) ?? 'victory');
if (params.get('boss') === '1') fire('boss');
const hp = params.get('hp');
if (hp) state.run.player.hp = Number(hp) * state.run.player.maxHp;
if (params.get('pad') === '1') document.querySelector('.cr-ui')?.classList.add('is-pad');
requestAnimationFrame(tick);
window.setTimeout(() => {
  const tab = params.get('tab');
  if (tab) (document.querySelector(`.cr-tab[data-tab="${tab}"]`) as HTMLElement | null)?.click();
  const modal = params.get('modal');
  if (modal) openModal(modal);
  for (const e of (params.get('fire') ?? '').split(',').filter(Boolean)) fire(e);
}, 350);

