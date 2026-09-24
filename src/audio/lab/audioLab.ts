/**
 * Audio lab (AUDIO-owned): lab/audio.html. Every cue with a spatial position pad, every SimEvent mapping,
 * music state switcher with an intensity override, ambience drivers, mix sliders, and a "battle storm"
 * stress test (50 cues/s) with live voice counts. Works without the game: a synthetic RunState stands in.
 */
import { defaultSettings } from '../../game/meta/save';
import type { BossId, EnemyId, SpecialId, UltimateId, WeaponId } from '../../game/ids';
import type { CardOffer, Settings, SimEvent } from '../../game/types';
import type { AppScreen } from '../../render/frame';
import { AudioEngine } from '../AudioEngine';
import { CATEGORY_IDS } from '../categories';
import type { CueId } from '../generated/cueIds';
import { MUSIC_STATES, type MusicState } from '../music';
import type { CategoryId } from '../types';
import { applyLabWorld, createLabRun, type LabWorld } from './fakeRun';

const engine = new AudioEngine();
const run = createLabRun();
const world: LabWorld = { speed: 14, wind: 0.5, rain: 0, waves: 1, boost: false, fires: 0, whirlpool: false, hour: 11, enemies: 0, hp: 1, paused: false };
let screen: AppScreen = 'run';
let settings: Settings = defaultSettings();
let pos = { x: 160, z: -120 };
let randomPos = false;
let pendingEvents: SimEvent[] = [];
let stormUntil = 0;
let stormRate = 50;
let stormAcc = 0;
let time = 0;
let last = performance.now();
let nextId = 20000;

// ───────────────────────── tiny DOM helpers ─────────────────────────

type Attrs = Record<string, string | number | boolean | ((ev: Event) => void)>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt = (v: number) => v.toFixed(2)): HTMLElement {
  const out = h('output', {}, fmt(value));
  const input = h('input', { type: 'range', min, max, step, value });
  input.addEventListener('input', () => { const v = Number(input.value); out.textContent = fmt(v); onInput(v); });
  return h('label', { class: 'row' }, label, input, out);
}

function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h('button', { class: cls, onclick: () => { onClick(); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 120); } }, text);
  return b;
}

function section(title: string, ...kids: (Node | string)[]): HTMLElement {
  return h('section', {}, h('h2', {}, title), ...kids);
}

// ───────────────────────── positions / events ─────────────────────────

function at(): { x: number; z: number } {
  if (!randomPos) return pos;
  const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 560;
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

function emit(...events: SimEvent[]): void { pendingEvents.push(...events); }

function later(ms: number, ...events: SimEvent[]): void { setTimeout(() => emit(...events), ms); }

const offer = (rarity: CardOffer['rarity'], kind: CardOffer['kind'] = 'weapon-level'): CardOffer => ({ kind, id: 'broadside', title: 'Broadside', text: '', icon: '', rarity });

function weaponFired(weapon: WeaponId, count: number, side: 1 | -1 = 1): SimEvent {
  return { type: 'weapon-fired', weapon, owner: 0, x: 0, z: 0, dirX: side, dirZ: 0, side: side > 0 ? 'starboard' : 'port', count };
}

function bossPos(): { x: number; z: number } { const p = at(); return { x: p.x, z: p.z }; }

const EVENT_GROUPS: [string, [string, () => void][]][] = [
  ['Player weapons', [
    ['Broadside ×6 stbd', () => emit(weaponFired('broadside', 6, 1))],
    ['Broadside ×3 port', () => emit(weaponFired('broadside', 3, -1))],
    ['Heavy shot branch', () => { const s = run.player.weapons[0]!; s.branch = 'B'; emit(weaponFired('broadside', 4, 1)); later(50, { type: 'weapon-changed', weapon: 'broadside', level: 3, branch: 'B', overdrive: false, isNew: false }); setTimeout(() => { s.branch = undefined; }, 400); }],
    ['Chain shot branch', () => { const s = run.player.weapons[0]!; s.branch = 'A'; emit(weaponFired('broadside', 4, -1)); setTimeout(() => { s.branch = undefined; }, 400); }],
    ['Bow chaser ×2', () => emit(weaponFired('bow-chaser', 2))],
    ['Stern mortar ×3', () => emit(weaponFired('stern-mortar', 3))],
    ['Swivels ×4', () => emit(weaponFired('swivel-guns', 4))],
    ['Rockets ×5', () => emit(weaponFired('rocket-rack', 5))],
    ['Harpoon', () => { const p = at(); emit(weaponFired('harpoon', 1), { type: 'harpoon', from: 0, to: 1, x1: 0, z1: -20, x2: p.x, z2: p.z }); }],
    ['Storm rod chain', () => { const p = at(); emit({ type: 'lightning', team: 'player', points: [{ x: 0, z: -20 }, { x: p.x * 0.4, z: p.z * 0.4 }, { x: p.x * 0.7, z: p.z * 0.7 }, { x: p.x, z: p.z }] }); }],
    ['Tide mine drop', () => emit(weaponFired('tide-mines', 1))],
    ['Fire barrels', () => emit(weaponFired('fire-barrels', 1))],
    ['Maelstrom', () => emit(weaponFired('maelstrom-charm', 1))],
  ]],
  ['Enemies (pad position)', [
    ['Cutter chaser', () => { const p = at(); emit({ type: 'enemy-fired', source: 7, projectile: 'enemy-chaser', x: p.x, z: p.z, dirX: 0, dirZ: 1, count: 1 }); }],
    ['Brig volley ×3', () => { const p = at(); emit({ type: 'enemy-fired', source: 7, projectile: 'enemy-cannonball', x: p.x, z: p.z, dirX: 0, dirZ: 1, count: 3 }); }],
    ["Man-o'-war ×8", () => { const p = at(); emit({ type: 'enemy-fired', source: 7, projectile: 'enemy-cannonball', x: p.x, z: p.z, dirX: 0, dirZ: 1, count: 8 }); }],
    ['Mortar + whistle', () => { const p = at(); const id = nextId++; emit({ type: 'enemy-fired', source: 7, projectile: 'enemy-mortar', x: p.x * 2, z: p.z * 2, dirX: 0, dirZ: 1, count: 1 }, { type: 'telegraph', id, shape: 'circle', x: p.x, z: p.z, radius: 14, duration: 2.2 }); later(2200, { type: 'explosion', x: p.x, z: p.z, radius: 14, kind: 'mortar', team: 'enemy' }); }],
    ['Elite spawn', () => { const p = at(); emit({ type: 'enemy-spawned', id: nextId++, defId: 'frigate', x: p.x, z: p.z, elite: true }); }],
    ['Kill brig', () => { const p = at(); const id = nextId++; emit({ type: 'enemy-killed', id, defId: 'brig', x: p.x, z: p.z, elite: false }); later(3000, { type: 'enemy-sunk', id }); }],
    ['Kill elite', () => { const p = at(); emit({ type: 'enemy-killed', id: nextId++, defId: 'frigate', x: p.x, z: p.z, elite: true }); }],
    ['Ram crash', () => { const p = at(); emit({ type: 'ram', attacker: 0, target: 9, damage: 120, x: p.x * 0.1, z: p.z * 0.1 }); }],
    ['Island scrape', () => emit({ type: 'collision', a: 0, b: 'island', x: 0, z: -20, impulse: 9 })],
  ]],
  ['Hits and explosions (pad)', [
    ['Hit wood', () => { const p = at(); emit({ type: 'projectile-hit', projectile: 'cannonball', team: 'player', x: p.x, y: 3, z: p.z, target: 'ship', targetId: 7, damage: 20, crit: false }); }],
    ['Hit heavy + crit', () => { const p = at(); emit({ type: 'projectile-hit', projectile: 'heavy-shot', team: 'player', x: p.x, y: 3, z: p.z, target: 'ship', targetId: 7, damage: 60, crit: true }, { type: 'damage', target: 7, amount: 80, crit: true, x: p.x, y: 4, z: p.z }); }],
    ['Chain shot hit', () => { const p = at(); emit({ type: 'projectile-hit', projectile: 'chain-shot', team: 'player', x: p.x, y: 3, z: p.z, target: 'ship', targetId: 7, damage: 20, crit: false }); }],
    ['Splash (miss)', () => { const p = at(); emit({ type: 'projectile-hit', projectile: 'cannonball', team: 'player', x: p.x, y: 0, z: p.z, target: 'water', damage: 0, crit: false }); }],
    ['Island hit', () => { const p = at(); emit({ type: 'projectile-hit', projectile: 'cannonball', team: 'player', x: p.x, y: 0, z: p.z, target: 'island', damage: 0, crit: false }); }],
    ...(['small', 'medium', 'large', 'fire', 'powder', 'mine', 'mortar', 'lightning', 'water'] as const).map((k): [string, () => void] => [`Explosion ${k}`, () => { const p = at(); emit({ type: 'explosion', x: p.x, z: p.z, radius: k === 'large' || k === 'powder' ? 30 : 12, kind: k, team: 'player' }); }]),
    ['Lightning strike', () => { const p = at(); emit({ type: 'lightning-strike', x: p.x, z: p.z }); }],
  ]],
  ['Player', [
    ['Hull hit', () => emit({ type: 'player-hit', amount: 18, x: 5, z: 0, braced: false, parried: false })],
    ['Big hull hit', () => emit({ type: 'player-hit', amount: 45, x: 5, z: 0, braced: false, parried: false })],
    ['Braced hit', () => emit({ type: 'player-hit', amount: 6, x: 5, z: 0, braced: true, parried: false })],
    ['Parry', () => emit({ type: 'player-hit', amount: 3, x: 5, z: 0, braced: true, parried: true })],
    ['Brace', () => emit({ type: 'skill-used', slot: 'brace', skill: 'brace', x: 0, z: 0, aimX: 0, aimZ: -100 })],
    ['Boost', () => emit({ type: 'skill-used', slot: 'boost', skill: 'boost', x: 0, z: 0, aimX: 0, aimZ: -100 })],
    ...(['second-wind', 'lionburst', 'deep-dive', 'chefs-banquet', 'signal-flare', 'seaquake'] as SpecialId[]).map((s): [string, () => void] => [s, () => { const p = at(); emit({ type: 'skill-used', slot: 'special', skill: s, x: 0, z: 0, aimX: p.x, aimZ: p.z }); }]),
    ...(['ramming-speed', 'sunfire-barrage', 'torpedo-swarm', 'kitchen-inferno', 'admirals-judgment', 'tidal-colossus'] as UltimateId[]).map((s): [string, () => void] => [`★ ${s}`, () => { const p = at(); emit({ type: 'skill-used', slot: 'ultimate', skill: s, x: 0, z: 0, aimX: p.x, aimZ: p.z }); }]),
    ['Special ready', () => emit({ type: 'skill-ready', slot: 'special' })],
    ['Ultimate ready', () => emit({ type: 'skill-ready', slot: 'ultimate' })],
    ['Broadside reloaded', () => emit({ type: 'skill-ready', slot: 'broadside' })],
    ['Died (revive)', () => emit({ type: 'player-died', reviving: true }, { type: 'revived' })],
    ['Died', () => emit({ type: 'player-died', reviving: false })],
  ]],
  ['Loot and progression', [
    ['Coins ×14 streak', () => { for (let i = 0; i < 14; i++) later(i * 70, { type: 'pickup-collected', id: nextId++, kind: i % 5 === 4 ? 'xp-silver' : 'xp-copper', x: 0, z: 0, value: 1 }); }],
    ['Gold bar', () => emit({ type: 'pickup-collected', id: nextId++, kind: 'xp-gold', x: 0, z: 0, value: 25 })],
    ['Doubloon', () => emit({ type: 'pickup-collected', id: nextId++, kind: 'doubloon', x: 0, z: 0, value: 1 })],
    ['Repair crate', () => emit({ type: 'pickup-collected', id: nextId++, kind: 'repair', x: 0, z: 0, value: 1 })],
    ['Compass', () => emit({ type: 'pickup-collected', id: nextId++, kind: 'compass', x: 0, z: 0, value: 1 })],
    ['Powder keg', () => emit({ type: 'pickup-collected', id: nextId++, kind: 'powder-keg', x: 0, z: 0, value: 1 })],
    ['Chest drop', () => { const p = at(); emit({ type: 'pickup-spawned', id: nextId++, kind: 'chest', x: p.x, z: p.z, value: 1 }); }],
    ['Chest open', () => emit({ type: 'pickup-collected', id: nextId++, kind: 'chest', x: 0, z: 0, value: 1 })],
    ['Level up', () => emit({ type: 'level-up', level: 5 })],
    ['Card common', () => emit({ type: 'card-chosen', offer: offer('common') })],
    ['Card epic', () => emit({ type: 'card-chosen', offer: offer('epic') })],
    ['Reroll', () => { run.rerolls = Math.max(0, run.rerolls) + 1; setTimeout(() => { run.rerolls -= 1; }, 50); }],
    ['New weapon', () => emit({ type: 'weapon-changed', weapon: 'harpoon', level: 1, overdrive: false, isNew: true })],
    ['Weapon level', () => emit({ type: 'weapon-changed', weapon: 'broadside', level: 2, overdrive: false, isNew: false })],
    ['Overdrive ★', () => emit({ type: 'card-chosen', offer: offer('legendary', 'weapon-overdrive') }, { type: 'weapon-changed', weapon: 'broadside', level: 6, overdrive: true, isNew: false })],
    ['Passive rank', () => emit({ type: 'passive-changed', passive: 'master-gunner', rank: 2, isNew: false })],
    ['Tier up', () => emit({ type: 'tier-up', tier: 2 })],
  ]],
  ['Bosses, director, weather', [
    ...(['iron-warden', 'tidewyrm', 'sovereign'] as BossId[]).flatMap((b): [string, () => void][] => [
      [`${b} warning`, () => emit({ type: 'boss-warning', boss: b, eta: 10 })],
      [`${b} spawn`, () => { const p = bossPos(); emit({ type: 'boss-spawned', boss: b, id: 90, x: p.x, z: p.z }); }],
      [`${b} phase`, () => emit({ type: 'boss-phase', boss: b, id: 90, phase: 1 })],
      [`${b} defeated`, () => { const p = bossPos(); emit({ type: 'boss-defeated', boss: b, id: 90, x: p.x, z: p.z }); }],
    ]),
    ...['broadside-volley', 'mortar-barrage', 'summon-cutters', 'ram-charge', 'submerge-lunge', 'tail-slam', 'water-bolts', 'summon-wyrmlings', 'judgment-line', 'broadside-storm']
      .map((a): [string, () => void] => [`attack: ${a}`, () => { const p = bossPos(); emit({ type: 'boss-attack', boss: a.includes('wyrm') || a.includes('tail') || a.includes('water') || a.includes('lunge') ? 'tidewyrm' : 'iron-warden', id: 90, attack: a, x: p.x, z: p.z }); }]),
    ...['ambush', 'fire-ship-rush', 'mortar-line', 'treasure-convoy', 'storm-front', 'fog-bank'].map((n): [string, () => void] => [`event: ${n}`, () => emit({ type: 'director-event', name: n, text: n })]),
    ...(['storm', 'fog', 'clear'] as const).map((w): [string, () => void] => [`weather: ${w}`, () => emit({ type: 'weather-changed', weather: w })]),
  ]],
];

// ───────────────────────── storm ─────────────────────────

const STORM_EVENTS: (() => SimEvent)[] = [
  () => { const p = rnd(); return { type: 'enemy-fired', source: 7, projectile: 'enemy-cannonball', x: p.x, z: p.z, dirX: 0, dirZ: 1, count: 1 + Math.floor(Math.random() * 6) }; },
  () => { const p = rnd(); return { type: 'projectile-hit', projectile: 'cannonball', team: 'player', x: p.x, y: 3, z: p.z, target: 'ship', targetId: 7, damage: 20, crit: Math.random() < 0.2 }; },
  () => { const p = rnd(); return { type: 'projectile-hit', projectile: 'cannonball', team: 'enemy', x: p.x, y: 0, z: p.z, target: 'water', damage: 0, crit: false }; },
  () => { const p = rnd(); return { type: 'explosion', x: p.x, z: p.z, radius: 10 + Math.random() * 25, kind: Math.random() < 0.7 ? 'small' : 'large', team: 'player' }; },
  () => weaponFired('broadside', 2 + Math.floor(Math.random() * 5), Math.random() < 0.5 ? 1 : -1),
  () => ({ type: 'pickup-collected', id: nextId++, kind: 'xp-copper', x: 0, z: 0, value: 1 }),
  () => { const p = rnd(); return { type: 'enemy-killed', id: nextId++, defId: (['skiff', 'brig', 'cutter'] as EnemyId[])[Math.floor(Math.random() * 3)]!, x: p.x, z: p.z, elite: false }; },
  () => ({ type: 'damage', target: 7, amount: 50, crit: true, x: 60, y: 4, z: -40 }),
];

function rnd(): { x: number; z: number } { const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 520; return { x: Math.sin(a) * r, z: Math.cos(a) * r }; }

// ───────────────────────── layout ─────────────────────────

const status = h('span', { class: 'pill' }, 'locked');
const bankPill = h('span', { class: 'pill' }, 'bank —');
const meterBar = h('i', { style: 'width:0%' });
const meterText = h('span', { class: 'pill' }, '— dBFS');
const unlockBtn = button('Click to unlock audio', () => { void engine.unlock().then(() => engine.setSettings(settings)); }, 'primary');

const pad = h('div', { id: 'pad' });
const dot = h('div', { class: 'dot' });
const PAD_RANGE = 700;
for (const r of [100, 300, 600]) {
  const pct = (r / PAD_RANGE) * 50;
  pad.append(h('div', { class: 'ring', style: `left:${50 - pct}%;top:${50 - pct}%;width:${pct * 2}%;height:${pct * 2}%` }));
}
pad.append(h('div', { class: 'ship' }), dot);
const padLabel = h('div', {}, '');
function placeDot(): void {
  dot.style.left = `${50 + (pos.x / PAD_RANGE) * 50}%`;
  dot.style.top = `${50 + (pos.z / PAD_RANGE) * 50}%`;
  padLabel.textContent = `source x ${pos.x.toFixed(0)} m, z ${pos.z.toFixed(0)} m — distance ${Math.hypot(pos.x, pos.z).toFixed(0)} m (up = camera forward, right = screen right)`;
}
pad.addEventListener('pointerdown', (ev) => {
  const r = pad.getBoundingClientRect();
  pos = { x: ((ev.clientX - r.left) / r.width * 2 - 1) * PAD_RANGE, z: ((ev.clientY - r.top) / r.height * 2 - 1) * PAD_RANGE };
  placeDot();
});
placeDot();
const randomBox = h('input', { type: 'checkbox' });
randomBox.addEventListener('change', () => { randomPos = randomBox.checked; });

const musicInfo = h('pre', {}, '');
const voiceTable = h('table', {});
const logPre = h('pre', {}, '');
const statsPre = h('pre', {}, '');
const musicButtons: HTMLButtonElement[] = [];
const autoBtn = button('auto', () => { engine.music?.force(null); markMusic(null); }, 'active');
function markMusic(state: MusicState | null): void {
  autoBtn.classList.toggle('active', state === null);
  for (const b of musicButtons) b.classList.toggle('active', b.textContent === state);
}
for (const s of MUSIC_STATES) {
  const b = button(s, () => { engine.music?.force(s); markMusic(s); });
  musicButtons.push(b);
}
const overrideBox = h('input', { type: 'checkbox' });
let intensityValue = 0.2;
overrideBox.addEventListener('change', () => { if (engine.music) engine.music.intensityOverride = overrideBox.checked ? intensityValue : null; });

const screenButtons = (['title', 'harbor', 'run', 'results'] as AppScreen[]).map((s) => button(s, () => { screen = s; for (const b of screenButtons) b.classList.toggle('active', b.textContent === s); }, s === 'run' ? 'active' : ''));

const cueBox = h('div', {});
function buildCues(): void {
  const m = engine.getManifest();
  if (!m) { cueBox.textContent = 'manifest not loaded yet…'; setTimeout(buildCues, 300); return; }
  cueBox.replaceChildren();
  const byCat = new Map<CategoryId, string[]>();
  for (const [id, def] of Object.entries(m.cues)) { const list = byCat.get(def.category) ?? []; list.push(id); byCat.set(def.category, list); }
  for (const cat of CATEGORY_IDS) {
    const ids = byCat.get(cat);
    if (!ids) continue;
    cueBox.append(h('div', { class: 'cat' }, cat));
    const row = h('div', { class: 'cues' });
    for (const id of ids) {
      const def = m.cues[id]!;
      const b = button(id, () => { const p = at(); engine.playCue(id as CueId, cat === 'ambience' ? {} : { x: p.x, z: p.z, force: true }); });
      b.title = `${def.desc ?? ''}\n${def.files.length} variation(s), gain ${def.gain}`;
      b.append(h('small', {}, `×${def.files.length}`));
      row.append(b);
    }
    cueBox.append(row);
  }
}

const eventsBox = h('div', {});
for (const [title, list] of EVENT_GROUPS) {
  eventsBox.append(h('div', { class: 'cat' }, title));
  const row = h('div', { class: 'cues' });
  for (const [label, fn] of list) row.append(button(label, fn));
  eventsBox.append(row);
}

function setMix(patch: Partial<Settings>): void { settings = { ...settings, ...patch }; engine.setSettings(settings); }
const muteBox = h('input', { type: 'checkbox' });
muteBox.addEventListener('change', () => setMix({ muted: muteBox.checked }));

const stormBtn = button('Battle storm — 50 cues/s for 10 s', () => { stormRate = 50; stormUntil = performance.now() + 10000; });
const storm3Btn = button('Hurricane — 150 cues/s for 6 s', () => { stormRate = 150; stormUntil = performance.now() + 6000; });

const left = h('div', {},
  section('Mix',
    slider('Master', 0, 1, 0.01, settings.masterVolume, (v) => setMix({ masterVolume: v })),
    slider('Music', 0, 1, 0.01, settings.musicVolume, (v) => setMix({ musicVolume: v })),
    slider('SFX', 0, 1, 0.01, settings.sfxVolume, (v) => setMix({ sfxVolume: v })),
    h('label', {}, muteBox, ' mute'),
  ),
  section('Source position (click the pad)', pad, padLabel, h('label', {}, randomBox, ' random position per trigger')),
  section('Screen', h('div', { class: 'cues' }, ...screenButtons)),
  section('Music director',
    h('div', { class: 'cues' }, autoBtn, ...musicButtons),
    h('label', {}, overrideBox, ' override intensity'),
    slider('Intensity', 0, 1, 0.01, intensityValue, (v) => { intensityValue = v; if (engine.music && overrideBox.checked) engine.music.intensityOverride = v; }),
    musicInfo,
  ),
  section('Ambience drivers (synthetic RunState)',
    slider('Ship speed', 0, 38, 0.5, world.speed, (v) => { world.speed = v; }, (v) => `${v.toFixed(1)} m/s`),
    slider('Wind', 0, 1, 0.01, world.wind, (v) => { world.wind = v; }),
    slider('Rain', 0, 1, 0.01, world.rain, (v) => { world.rain = v; }),
    slider('Waves', 0.6, 1.8, 0.01, world.waves, (v) => { world.waves = v; }),
    slider('Hour', 0, 24, 0.25, world.hour, (v) => { world.hour = v; }, (v) => `${v.toFixed(1)} h`),
    slider('Burning ships', 0, 5, 1, world.fires, (v) => { world.fires = v; }, (v) => v.toFixed(0)),
    slider('Enemies near', 0, 40, 1, world.enemies, (v) => { world.enemies = v; }, (v) => v.toFixed(0)),
    slider('Hull', 0.05, 1, 0.01, world.hp, (v) => { world.hp = v; }),
    h('div', { class: 'cues' },
      button('boost', () => { world.boost = !world.boost; }),
      button('whirlpool', () => { world.whirlpool = !world.whirlpool; }),
      button('pause', () => { world.paused = !world.paused; }),
    ),
  ),
);

const right = h('div', {},
  section('Stress', h('div', { class: 'cues' }, stormBtn, storm3Btn), voiceTable),
  section('SimEvents → router (the real mapping)', eventsBox),
  section('Cues (direct)', cueBox),
  section('Trigger log (latest last)', logPre),
  section('Stats', statsPre),
);

document.getElementById('lab')!.append(
  h('header', {}, h('h1', {}, 'AUDIO LAB'), unlockBtn, status, bankPill, meterText, h('div', { class: 'bar', style: 'width:180px' }, meterBar)),
  h('main', {}, left, right),
);
buildCues();

// ───────────────────────── loop ─────────────────────────

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  applyLabWorld(run, world, time);
  if (now < stormUntil) {
    stormAcc += dt * stormRate;
    while (stormAcc >= 1) { stormAcc -= 1; pendingEvents.push(STORM_EVENTS[Math.floor(Math.random() * STORM_EVENTS.length)]!()); }
  }
  const events = pendingEvents;
  pendingEvents = [];
  engine.update({ screen, time, dt, run: screen === 'run' || screen === 'results' ? run : null, events, listener: { x: 0, y: 140, z: 110, forwardX: 0, forwardZ: -0.618 } });
  if (Math.floor(now / 100) !== Math.floor((now - dt * 1000) / 100)) refresh();
}

function refresh(): void {
  const s = engine.stats();
  status.textContent = s.unlocked ? `context ${s.contextState}` : 'locked — click unlock';
  status.classList.toggle('ok', s.unlocked);
  unlockBtn.style.display = s.unlocked ? 'none' : '';
  bankPill.textContent = `decoded ${s.bank.decoded}/${s.bank.total} · ${(s.bank.bytes / 1048576).toFixed(2)} MB`;
  const m = engine.meter();
  if (m) {
    meterText.textContent = `rms ${m.rmsDb} dBFS · peak ${m.peakDb}`;
    meterBar.style.width = `${Math.max(0, Math.min(100, (m.peakDb + 60) / 60 * 100))}%`;
  }
  const mi = s.music;
  musicInfo.textContent = mi ? `state ${mi.state}  (run: ${mi.runState})\ntrack ${mi.track ?? '—'} @ ${mi.position}s  level ${mi.level}\nintensity ${mi.intensity}  pending ${mi.pending ?? '—'}\nducks music ${s.ducks.music.toFixed(2)} sfx ${s.ducks.sfx.toFixed(2)}\n` +
    s.musicTransitions.slice(-5).map((t) => `  ${t.t}s ${t.from} → ${t.to}`).join('\n') : 'unlock to start the director';
  const rows = CATEGORY_IDS.filter((c) => c !== 'ambience').map((c) => h('tr', {}, h('td', {}, c), h('td', {}, String(s.voices[c] ?? 0)), h('td', {}, String(s.peakVoices[c] ?? 0))));
  voiceTable.replaceChildren(h('tr', {}, h('th', {}, 'category'), h('th', {}, 'voices'), h('th', {}, 'peak')), ...rows,
    h('tr', {}, h('th', {}, 'total'), h('th', {}, String(s.totalVoices)), h('th', {}, `steals ${s.steals}`)));
  logPre.textContent = engine.recentLog(22).map((e) => `${e.t.toFixed(2)} ${e.played ? '▶' : '·'} ${e.cue.padEnd(18)} ${e.src.padEnd(16)} ${e.played ? `g=${e.gain}` : e.reason}${e.d !== undefined ? ` d=${e.d}m` : ''}`).join('\n');
  statsPre.textContent = JSON.stringify({ dropped: s.dropped, loops: s.loops, bySource: s.bySource }, null, 1);
}

requestAnimationFrame(frame);
(window as unknown as { __AUDIO_LAB__?: unknown }).__AUDIO_LAB__ = { engine, run, world, emit, setScreen: (s: AppScreen) => { screen = s; }, storm: (rate = 50, ms = 10000) => { stormRate = rate; stormUntil = performance.now() + ms; } };
