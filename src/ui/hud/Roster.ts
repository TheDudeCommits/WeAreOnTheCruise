/**
 * Captains roster (CAPTAINS built it; FLOW owns the HUD now): who is sailing this sea (you + AI captains) with name,
 * level, bounty rank, hull and a sunk/respawn countdown; a two-line kill feed; short radio callouts ("Mira: Covering
 * your stern!"); and nameplates (name, level, small hull bar) over the two nearest captain ships.
 *
 * Compact by default (one line per captain; the presence line — "No live captains online — AI captains sail with
 * you" — only shows for the first seconds of a voyage). Tab collapses it to a single header line (rank and count;
 * callouts still pop); the choice is remembered (hudPrefs).
 *
 * measure() runs in the HUD's read phase (every project() call happens there); update() in the write phase and only
 * touches the DOM when a value changes. Styles: src/styles/roster.css.
 */
import { CONTENT } from '../../game/content';
import { CAPTAIN_COLORS, CAPTAIN_LINES, personaByName } from '../../game/content/captains';
import { captainSetting } from '../../game/sim/captains-runtime';
import type { CaptainState, RunState, SimEvent } from '../../game/types';
import { presence, presenceHeadline } from '../../runtime/presence';
import type { ScreenPoint, UiFrame } from '../contracts';
import { ClassCell, h, hex, TextCell } from '../core/dom';
import { hudPrefs, saveHudPrefs } from '../core/hudPrefs';
import { keycap } from '../core/prompts';
import type { ScreenBasis } from './camera';
import type { SafeZone } from './SafeZone';

const MAX = 4;
const FEED = 2;
const FEED_LIFE = 8;
const CALL_LIFE = 3.4;
const CALL_GAP = 6;
/** Captain nameplates: at most this many, nearest first, within this range (m). */
const PLATES = 2;
const PLATE_RANGE = 520;
/** The presence line shows for the first seconds of a voyage only. */
const SUB_SECONDS = 14;

interface Row { el: HTMLElement; rank: TextCell; name: TextCell; lv: TextCell; state: TextCell; bar: HTMLElement; barW: number; sunk: boolean; color: string; on: boolean }
interface Plate { el: HTMLElement; name: TextCell; lv: TextCell; bar: HTMLElement; barW: number; on: boolean; x: number; y: number; k: number; sx: number; sy: number; color: string }

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
const ENEMY_NAME = (id: string): string => (CONTENT.enemies as Record<string, { name: string } | undefined>)[id]?.name ?? (CONTENT.bosses as Record<string, { name: string } | undefined>)[id]?.name ?? id;
const article = (name: string): string => (/^the\s/i.test(name) ? name : `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`);

export class Roster {
  readonly el: HTMLElement;
  private readonly sub: TextCell;
  private readonly subEl: HTMLElement;
  private readonly count: TextCell;
  private readonly rows: Row[] = [];
  private readonly feedEl: HTMLElement;
  private readonly feedLines: { el: HTMLElement; text: TextCell; t: number }[] = [];
  private feedHead = 0;
  private readonly callEl: HTMLElement;
  private readonly callWho: TextCell;
  private readonly callText: TextCell;
  private callT = -99;
  private lastCall = -99;
  private readonly plateLayer: HTMLElement;
  private readonly plates: Plate[] = [];
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly modes = new Int8Array(MAX).fill(-1);
  private readonly collapsedCell: ClassCell;
  private lastLowHp = -99;
  private visible = false;
  private time = 0;
  private plateCount = 0;
  /** Set when the roster changed shape (rows, collapse): the safe zone re-reads it. */
  changed = false;

  constructor() {
    const sub = h('span', 'cr-roster__sub');
    this.subEl = sub;
    this.sub = new TextCell(sub);
    const count = h('span', 'cr-roster__count');
    this.count = new TextCell(count);
    const list = h('div', 'cr-roster__rows');
    for (let i = 0; i <= MAX; i++) {
      const rank = h('span', 'cr-roster__rank'), name = h('span', 'cr-roster__name');
      const lv = h('span', 'cr-roster__lv'), state = h('span', 'cr-roster__state'), bar = h('span', 'cr-roster__bar');
      const el = h('div', 'cr-roster__row', rank, h('span', 'cr-roster__swatch'), name, lv, h('span', 'cr-roster__hull', bar, state));
      if (i === 0) el.classList.add('is-you');
      el.hidden = true;
      list.append(el);
      this.rows.push({ el, rank: new TextCell(rank), name: new TextCell(name), lv: new TextCell(lv), state: new TextCell(state), bar, barW: -1, sunk: false, color: '', on: false });
    }
    this.feedEl = h('div', 'cr-roster__feed');
    for (let i = 0; i < FEED; i++) {
      const text = h('span', 'cr-roster__line');
      const el = h('div', 'cr-roster__feedrow', text);
      el.hidden = true;
      this.feedEl.append(el);
      this.feedLines.push({ el, text: new TextCell(text), t: -99 });
    }
    const who = h('b', 'cr-roster__callwho'), text = h('span', 'cr-roster__calltext');
    this.callWho = new TextCell(who);
    this.callText = new TextCell(text);
    this.callEl = h('div', 'cr-roster__call', who, text);
    this.callEl.hidden = true;
    this.el = h('div', 'cr-roster',
      h('div', 'cr-roster__head', h('span', 'cr-roster__title', 'Captains'), count, h('span', 'cr-roster__key', keycap('TAB'))),
      sub, list, this.feedEl, this.callEl,
    );
    this.el.hidden = true;
    this.collapsedCell = new ClassCell(this.el, 'is-collapsed');
    this.collapsedCell.set(hudPrefs().roster === 'collapsed');
    this.plateLayer = h('div', 'cr-capplates');
    for (let i = 0; i < PLATES; i++) {
      const name = h('span', 'cr-capplate__name'), lv = h('span', 'cr-capplate__lv'), bar = h('span', 'cr-capplate__bar');
      const el = h('div', 'cr-capplate', h('span', 'cr-capplate__top', name, lv), h('span', 'cr-capplate__hull', bar));
      el.hidden = true;
      this.plateLayer.append(el);
      this.plates.push({ el, name: new TextCell(name), lv: new TextCell(lv), bar, barW: -1, on: false, x: -1e4, y: -1e4, k: -1, sx: 0, sy: 0, color: '' });
    }
  }

  get collapsed(): boolean { return hudPrefs().roster === 'collapsed'; }

  /** Tab: compact ⇄ collapsed (remembered). */
  toggle(): void {
    const next = this.collapsed ? 'compact' : 'collapsed';
    saveHudPrefs({ roster: next });
    this.collapsedCell.set(next === 'collapsed');
    this.changed = true;
  }

  reset(): void {
    for (const l of this.feedLines) { l.t = -99; l.el.hidden = true; }
    this.callT = -99; this.lastCall = -99; this.lastLowHp = -99;
    this.callEl.hidden = true;
    this.modes.fill(-1);
    for (const p of this.plates) { p.on = false; p.el.hidden = true; }
    this.plateCount = 0;
  }

  /** Read phase: nameplate screen positions (project() reads layout), clear of widgets, elite plates and your ship. */
  measure(f: UiFrame, run: Readonly<RunState>, zone: SafeZone, basis: ScreenBasis, taken: readonly { x: number; y: number }[], takenCount: number): void {
    const p = run.player;
    const u = zone.u;
    let n = 0;
    // Nearest first (at most MAX captains: a tiny selection pass, no allocation).
    let used = 0;
    while (n < PLATES) {
      let best = -1, bestD = PLATE_RANGE;
      for (let i = 0; i < run.captains.length && i < MAX; i++) {
        if (used & (1 << i)) continue;
        const k = run.captains[i]!;
        if (!k.alive || (k.ai.fade ?? 99) < 0.6) continue;
        const d = Math.hypot(k.x - p.x, k.z - p.z);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) break;
      used |= 1 << best;
      const k = run.captains[best]!;
      f.project(k.x, Math.max(14, k.length * 0.62) + 6, k.z, this.sp);
      if (!this.sp.visible) continue;
      const x = this.sp.x, y = this.sp.y;
      if (zone.hits(x, y - 12 * u, 60 * u, 18 * u)) continue;
      if (basis.ok && Math.abs(x - basis.sx) < 80 * u && y > basis.sy - 130 * u && y < basis.sy + 50 * u) continue;
      let clash = false;
      for (let j = 0; j < takenCount; j++) { const s = taken[j]!; if (Math.abs(s.x - x) < 150 * u && Math.abs(s.y - y) < 80 * u) { clash = true; break; } }
      if (clash) continue;
      const plate = this.plates[n++]!;
      plate.k = best; plate.sx = x; plate.sy = y;
    }
    this.plateCount = n;
  }

  /** Write phase. */
  update(run: Readonly<RunState>, f: UiFrame): void {
    this.time = f.time;
    const enabled = captainSetting(f.settings) > 0 || run.captains.length > 0;
    if (enabled !== this.visible) { this.visible = enabled; this.el.hidden = !enabled; this.plateLayer.hidden = !enabled; this.changed = true; }
    if (!enabled) return;
    if (!this.plateLayer.isConnected) (this.el.closest('.cr-hud') ?? this.el).prepend(this.plateLayer);
    const early = run.time < SUB_SECONDS && !run.endless;
    if (this.subEl.hidden === early) { this.subEl.hidden = !early; this.changed = true; }
    if (early) this.sub.set(presenceHeadline(presence, Math.max(run.captains.length, captainSetting(f.settings))));
    for (let i = 0; i < f.events.length; i++) this.onEvent(f.events[i]!, run);
    this.watch(run);
    this.writeRows(run);
    this.writeFeed();
    this.writeCall();
    this.writePlates(run);
  }

  // ───────────── Rows ─────────────

  private writeRows(run: Readonly<RunState>): void {
    const p = run.player;
    const caps = run.captains;
    const n = 1 + Math.min(MAX, caps.length);
    let yourRank = 1;
    for (const o of caps) if (o.bounty > run.stats.bounty) yourRank++;
    this.count.set(`#${yourRank} of ${n}`);
    for (let i = 0; i <= MAX; i++) {
      const row = this.rows[i]!;
      const on = i < n;
      if (on !== row.on) { row.on = on; row.el.hidden = !on; this.changed = true; }
      if (!on) continue;
      const k = i === 0 ? null : caps[i - 1]!;
      const bounty = k ? k.bounty : run.stats.bounty;
      let rank = 1;
      if (bounty < run.stats.bounty && k) rank++;
      for (const o of caps) if (o !== k && o.bounty > bounty) rank++;
      row.rank.set(`#${rank}`);
      const color = k ? hex(CAPTAIN_COLORS[i - 1] ?? 0xffffff) : hex(CONTENT.ships[run.shipId].accent);
      if (color !== row.color) { row.color = color; row.el.style.setProperty('--cap', color); }
      row.name.set(k ? k.name : 'You');
      if (row.el.title !== CONTENT.ships[k ? k.shipId : run.shipId].name) row.el.title = CONTENT.ships[k ? k.shipId : run.shipId].name;
      row.lv.set(`Lv ${k ? k.level : p.level}`);
      const alive = k ? k.alive : p.alive;
      if (row.sunk !== !alive) { row.sunk = !alive; row.el.classList.toggle('is-sunk', !alive); }
      if (!alive && k) row.state.set(`Sunk · ${Math.ceil(k.respawn)}s`);
      else row.state.set('');
      const frac = alive ? Math.max(0, Math.min(1, (k ? k.hp / k.maxHp : p.hp / p.maxHp))) : 0;
      const w = Math.round(frac * 100);
      if (w !== row.barW) { row.barW = w; row.bar.style.width = `${w}%`; row.el.classList.toggle('is-low', frac < 0.3); }
    }
  }

  // ───────────── Feed + callouts ─────────────

  private feed(text: string): void {
    const line = this.feedLines[this.feedHead]!;
    this.feedHead = (this.feedHead + 1) % FEED;
    line.text.set(text);
    line.t = this.time;
    if (line.el.hidden) this.changed = true;
    line.el.hidden = false;
    // Newest last: re-append so the order reads top → bottom.
    this.feedEl.append(line.el);
    line.el.classList.remove('is-new');
    void line.el.offsetWidth;
    line.el.classList.add('is-new');
  }

  private writeFeed(): void {
    for (const l of this.feedLines) if (!l.el.hidden && this.time - l.t > FEED_LIFE) { l.el.hidden = true; this.changed = true; }
  }

  private call(name: string, lines: readonly string[], force = false): void {
    if (!force && this.time - this.lastCall < CALL_GAP) return;
    const persona = personaByName(name);
    this.callWho.set(`${persona?.short ?? name}:`);
    this.callText.set(pick(lines));
    this.callT = this.time;
    this.lastCall = this.time;
    if (this.callEl.hidden) this.changed = true;
    this.callEl.hidden = false;
    this.callEl.classList.remove('is-new');
    void this.callEl.offsetWidth;
    this.callEl.classList.add('is-new');
  }

  private writeCall(): void {
    if (!this.callEl.hidden && this.time - this.callT > CALL_LIFE) { this.callEl.hidden = true; this.changed = true; }
  }

  private anyCaptain(run: Readonly<RunState>): CaptainState | null {
    const alive = run.captains.filter((k) => k.alive);
    return alive.length ? pick(alive) : null;
  }

  private onEvent(e: SimEvent, run: Readonly<RunState>): void {
    switch (e.type) {
      case 'captain-joined':
        this.feed(`${e.name} joined · ${CONTENT.ships[e.shipId].name}`);
        if (e.id === -1) this.call(e.name, CAPTAIN_LINES.join, true);
        break;
      case 'captain-kill': {
        const victim = ENEMY_NAME(e.victim);
        this.feed(`${e.name} sank ${article(victim)}`);
        if (Math.random() < 0.3) this.call(e.name, CAPTAIN_LINES.kill);
        break;
      }
      case 'captain-sunk':
        this.feed(`${e.name} was sunk!`);
        this.call(e.name, CAPTAIN_LINES.sunk, true);
        break;
      case 'captain-respawned':
        this.feed(`${e.name} sails back in`);
        this.call(e.name, CAPTAIN_LINES.respawn);
        break;
      case 'boss-warning': {
        const k = this.anyCaptain(run);
        if (k) this.call(k.name, CAPTAIN_LINES.boss, true);
        break;
      }
      case 'enemy-spawned': {
        if (!e.elite) break;
        const k = this.anyCaptain(run);
        if (k && Math.hypot(e.x - run.player.x, e.z - run.player.z) < 360) this.call(k.name, CAPTAIN_LINES.elite);
        break;
      }
      default: break;
    }
  }

  /** State-driven callouts: a captain falling back, the player's hull running low. */
  private watch(run: Readonly<RunState>): void {
    for (const k of run.captains) {
      const slot = -k.id - 1;
      if (slot < 0 || slot >= MAX) continue;
      const mode = k.alive ? k.ai.mode ?? 0 : -1;
      if (mode === 2 && this.modes[slot] !== 2) this.call(k.name, CAPTAIN_LINES.retreat);
      this.modes[slot] = mode;
    }
    const p = run.player;
    if (p.alive && p.hp < p.maxHp * 0.3 && this.time - this.lastLowHp > 25) {
      const k = this.anyCaptain(run);
      if (k) { this.lastLowHp = this.time; this.call(k.name, CAPTAIN_LINES.playerLow); }
    }
  }

  // ───────────── Nameplates ─────────────

  private writePlates(run: Readonly<RunState>): void {
    for (let i = 0; i < PLATES; i++) {
      const plate = this.plates[i]!;
      const k = i < this.plateCount ? run.captains[plate.k] : undefined;
      const show = !!k;
      if (show !== plate.on) { plate.on = show; plate.el.hidden = !show; }
      if (!k) continue;
      const persona = personaByName(k.name);
      plate.name.set(persona?.title ? `${persona.title} ${k.name}` : k.name);
      plate.lv.set(`Lv ${k.level}`);
      const color = hex(CAPTAIN_COLORS[plate.k] ?? 0xffffff);
      if (color !== plate.color) { plate.color = color; plate.el.style.setProperty('--cap', color); }
      const w = Math.round(Math.max(0, Math.min(1, k.hp / k.maxHp)) * 100);
      if (w !== plate.barW) { plate.barW = w; plate.bar.style.width = `${w}%`; plate.el.classList.toggle('is-low', w < 30); }
      if (Math.abs(plate.sx - plate.x) >= 1 || Math.abs(plate.sy - plate.y) >= 1) {
        plate.x = plate.sx; plate.y = plate.sy;
        plate.el.style.transform = `translate3d(${plate.x.toFixed(0)}px,${plate.y.toFixed(0)}px,0)`;
      }
    }
  }
}
