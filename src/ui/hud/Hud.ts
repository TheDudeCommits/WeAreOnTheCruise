/**
 * In-run HUD. Built once; update() only writes values that changed. Widgets: top bar (XP/level/timer/stats), the
 * top-centre stack (boss ETA · boss bar · world-event tracker), banners (boss warning, director events, stamps, skill
 * cut-ins, toasts), ship ring, skill bar, loadout, minimap + captains roster, offscreen markers, nameplates and screen
 * feedback. Every world-anchored element (markers, nameplates) keeps out of the fixed widgets through SafeZone.
 * Settings.hudScale (0.8–1.2) scales the whole HUD through --hud-scale.
 */
import { CONTENT } from '../../game/content';
import type { RunState, SimEvent } from '../../game/types';
import type { UiFrame } from '../contracts';
import { h, hex, TextCell } from '../core/dom';
import { ROMAN } from '../core/format';
import { iconPath, PASSIVE_GLYPH, SPECIALS, ULTIMATES, WEAPON_GLYPH, WEATHER_LABEL } from '../core/names';
import { Banners } from './Banners';
import { BossBar } from './BossBar';
import { ScreenBasis } from './camera';
import { Feedback } from './Feedback';
import { Loadout } from './Loadout';
import { Markers } from './Markers';
import { Minimap } from './Minimap';
import { ShipRing } from './ShipRing';
import { SkillBar } from './SkillBar';
import { TopBar } from './TopBar';
import { EventTracker } from './EventTracker';
import { Roster } from './Roster';
import { SafeZone } from './SafeZone';

export class Hud {
  readonly el: HTMLElement;
  private readonly top = new TopBar();
  private readonly boss = new BossBar();
  readonly banners = new Banners();
  private readonly ring = new ShipRing();
  private readonly skills = new SkillBar();
  private readonly loadout = new Loadout();
  private readonly minimap = new Minimap();
  /** Where markers and nameplates may go (viewport minus the fixed widgets). */
  readonly zone = new SafeZone();
  private readonly markers = new Markers(this.zone);
  private readonly roster = new Roster();
  private readonly tracker = new EventTracker();
  readonly feedback = new Feedback();
  private readonly basis = new ScreenBasis();
  private readonly fps: TextCell;
  private readonly fpsEl: HTMLElement;
  private readonly v = { x: 0, y: 0 };
  private lastFps = -1;
  private ended = false;
  private seed = '';
  private scale = 1;
  width = 1600;
  height = 900;

  constructor() {
    const fps = h('span', 'cr-fps');
    this.fpsEl = fps;
    this.fps = new TextCell(fps);
    const stack = h('div', 'cr-hud__tc', this.top.eta, this.boss.el, this.tracker.el);
    const column = h('div', 'cr-hud__tr', this.minimap.el, fps, this.roster.el);
    this.el = h('div', 'cr-hud',
      this.feedback.el,
      this.markers.el,
      this.top.el,
      stack,
      column,
      this.banners.el,
      this.ring.el,
      this.skills.el,
      this.loadout.el,
    );
    this.zone.track(this.top.badge, this.top.plate, this.top.timerEl, stack, column, this.ring.el, this.ring.statusesEl, this.skills.el, this.loadout.el, this.banners.toastsEl);
    // Kept laid out (visibility) rather than display:none so the first sailing frame does not pay for the
    // HUD's first style/layout pass.
    this.el.classList.add('is-off');
  }

  show(): void { this.el.classList.remove('is-off'); }
  /** Tab: captains roster compact ⇄ collapsed. */
  toggleRoster(): void { this.roster.toggle(); }
  hide(): void { this.el.classList.add('is-off'); }
  dispose(): void { this.minimap.dispose(); }

  /** Clears per-run caches (new run or leaving the run screen). */
  reset(): void {
    this.top.reset(); this.boss.reset(); this.banners.reset(); this.ring.reset(); this.skills.reset();
    this.loadout.reset(); this.minimap.reset(); this.markers.reset(); this.feedback.reset();
    this.roster.reset(); this.tracker.reset();
    this.ended = false;
  }

  /** A modal (cards, chest, pause) covers the centre: hold stamps until it closes. */
  setModal(open: boolean): void { this.banners.setSuppressed(open); }

  /** The run is over / on its victory lap: cards picked by the guard stay quiet (no loadout toasts). */
  over = false;

  resize(w: number, h: number): void { this.width = w; this.height = h; this.zone.resize(w, h, this.scale); }

  /** Settings.hudScale, clamped to 0.8–1.2. */
  private setScale(v: number | undefined): void {
    const s = Math.max(0.8, Math.min(1.2, Number.isFinite(v) ? v! : 1));
    if (Math.abs(s - this.scale) < 1e-3) return;
    this.scale = s;
    this.el.style.setProperty('--hud-scale', s.toFixed(3));
    this.zone.resize(this.width, this.height, s);
  }

  update(f: UiFrame, run: Readonly<RunState>): void {
    if (run.seed !== this.seed) { this.seed = run.seed; this.reset(); this.el.style.setProperty('--accent', hex(CONTENT.ships[run.shipId].accent)); }
    this.setScale(f.settings.hudScale);
    const p = run.player;
    const ship = CONTENT.ships[run.shipId];
    const prof = (window as unknown as { __CRUISE_UI_PROFILE__?: Record<string, number> }).__CRUISE_UI_PROFILE__;
    let t = prof ? performance.now() : 0;
    const mark = prof ? (k: string) => { const n = performance.now(); prof[k] = (prof[k] ?? 0) + n - t; prof[`${k}_max`] = Math.max(prof[`${k}_max`] ?? 0, n - t); t = n; } : null;
    // Read phase first: project() reads layout (RendererHost.getViewport), so no DOM writes before it.
    this.basis.update(f, p.x, p.z);
    if (this.roster.changed) { this.roster.changed = false; this.zone.invalidate(); }
    this.zone.measure(this.el);
    this.markers.measure(f, run, this.basis);
    this.roster.measure(f, run, this.zone, this.basis, this.markers.plateSpots, this.markers.plateSpotCount); mark?.('measure');
    // Write phase.
    this.banners.tick(f.time);
    this.top.update(run, f.time); mark?.('top');
    this.boss.update(run, f.dt); mark?.('boss');
    this.ring.update(p, ship); mark?.('ring');
    this.skills.update(p, ship); mark?.('skills');
    this.loadout.update(p); mark?.('loadout');
    this.minimap.update(run, this.basis, f.dt, f.world); mark?.('minimap');
    this.markers.apply(); mark?.('markers');
    this.feedback.update(p); mark?.('feedback');
    this.roster.update(run, f); this.tracker.update(run, f); mark?.('roster');
    if (this.skills.ultJustReady) this.banners.toast(`${ULTIMATES[ship.ultimate].name} ready — press R`, ULTIMATES[ship.ultimate].glyph, 'gold', iconPath(ship.ultimate), 'ult-ready', 60);
    this.feedback.reduce = !!(f.settings as { reduceFlashing?: boolean }).reduceFlashing;
    // FPS readout.
    this.fpsEl.hidden = !f.settings.showFps;
    if (f.settings.showFps) { const v = Math.round(f.fps); if (v !== this.lastFps) { this.lastFps = v; this.fps.set(`${v} FPS`); } }
    for (let i = 0; i < f.events.length; i++) this.onEvent(f.events[i]!, run, f);
    mark?.('events');
    if (prof) prof.frames = (prof.frames ?? 0) + 1;
  }

  private onEvent(e: SimEvent, run: Readonly<RunState>, f: UiFrame): void {
    switch (e.type) {
      case 'level-up':
        this.top.levelUp();
        this.feedback.levelFlash();
        break;
      case 'skill-ready':
        if (e.slot === 'boost' || e.slot === 'brace') this.ring.ready(e.slot);
        else this.skills.ready(e.slot);
        break;
      case 'skill-used': {
        if (e.slot === 'broadside' || e.slot === 'special' || e.slot === 'ultimate') this.skills.used(e.slot);
        const ship = CONTENT.ships[run.shipId];
        if (e.slot === 'ultimate') { const u = ULTIMATES[ship.ultimate]; this.banners.cutIn('Ultimate', u.name, iconPath(ship.ultimate), u.glyph, hex(ship.accent), true); this.feedback.whiteFlash(0.35, 300); }
        else if (e.slot === 'special') { const s = SPECIALS[ship.special]; this.banners.cutIn('Special', s.name, iconPath(ship.special), s.glyph, hex(ship.accent), false); }
        break;
      }
      case 'player-hit': {
        const p = run.player;
        let sx = e.x, sz = e.z;
        if (e.source !== undefined && e.source > 0) {
          const src = run.enemies.find((x) => x.id === e.source) ?? run.bosses.find((x) => x.id === e.source);
          if (src) { sx = src.x; sz = src.z; }
        }
        const dx = sx - p.x, dz = sz - p.z;
        let angle: number | null = null;
        if (this.basis.ok && Math.hypot(dx, dz) > 4) { this.basis.dir(dx, dz, this.v); angle = Math.atan2(this.v.x, -this.v.y); }
        this.feedback.hit(e.amount / Math.max(1, p.maxHp) * 6, angle, this.basis.sx, this.basis.sy, e.braced);
        if (e.amount > 0) this.ring.hit();
        if (e.parried) this.banners.showStamp('Parry!', 'Shockwave reflected', 'cyan', 2, 900);
        break;
      }
      case 'boss-warning': {
        const def = CONTENT.bosses[e.boss];
        this.banners.bossWarning(def.name, def.title, e.eta);
        break;
      }
      case 'boss-phase': {
        const def = CONTENT.bosses[e.boss];
        this.boss.phaseFlash();
        this.banners.showStamp(`Phase ${ROMAN[e.phase + 1] ?? e.phase + 1}`, def.phases[e.phase]?.name ?? '', 'red', 3, 1500);
        break;
      }
      case 'boss-defeated': {
        const def = CONTENT.bosses[e.boss];
        this.banners.showStamp('Boss sunk!', def.name, 'gold', 4, 2200);
        this.feedback.whiteFlash(0.5, 600);
        break;
      }
      case 'director-event':
        // A world event's opening banner repeats what its tracker already shows: the tracker announces it.
        if (run.worldEvent && run.worldEvent.name === e.name) { this.zone.invalidate(); break; }
        this.banners.directorEvent(e.name, e.text);
        break;
      case 'tier-up':
        if (!this.over) this.banners.showStamp(`Tier ${ROMAN[e.tier] ?? e.tier}`, 'Your ship grows!', 'gold', 2, 1500);
        break;
      case 'weapon-changed': {
        this.loadout.pop(e.weapon);
        const def = CONTENT.weapons[e.weapon];
        if (this.over) break;
        if (e.isNew) this.banners.toast(`New weapon · ${def.name}`, WEAPON_GLYPH[e.weapon], 'gold', iconPath(e.weapon));
        else if (e.overdrive) this.banners.toast(`Overdrive · ${def.overdrive.name}`, 'star', 'gold', iconPath(e.weapon));
        break;
      }
      case 'passive-changed':
        this.loadout.pop(e.passive);
        if (e.isNew && !this.over) this.banners.toast(`New passive · ${CONTENT.passives[e.passive].name}`, PASSIVE_GLYPH[e.passive], 'white', iconPath(e.passive));
        break;
      case 'pickup-collected':
        if (e.kind === 'repair') this.banners.toast('Hull repaired +25%', 'plus', 'teal', iconPath('repair'));
        else if (e.kind === 'compass') this.banners.toast('Compass! All treasure drawn in', 'compass', 'gold', iconPath('compass'));
        else if (e.kind === 'powder-keg') { this.banners.showStamp('Kaboom!', 'Powder keg', 'red', 1, 1000); this.feedback.whiteFlash(0.45, 350); }
        break;
      case 'player-died':
        if (e.reviving) { this.banners.showStamp('Second Wind!', 'Back from the brink', 'teal', 5, 1800); this.feedback.whiteFlash(0.7, 700); }
        break;
      case 'weather-changed':
        this.banners.toast(`Weather · ${WEATHER_LABEL[e.weather] ?? e.weather}`, e.weather === 'storm' ? 'bolt' : e.weather === 'fog' ? 'eye' : 'wind', 'white');
        break;
      case 'run-ended':
        if (this.ended) break;
        this.ended = true;
        if (e.outcome === 'victory') this.banners.showStamp('Victory!', 'The Brightwater is yours', 'gold', 9, 2600);
        else if (e.outcome === 'defeat') this.banners.showStamp('Sunk!', 'Abandon ship!', 'red', 9, 2600);
        else this.banners.showStamp('Retired', 'Colours struck', 'white', 9, 2000);
        break;
      default:
        break;
    }
    void f;
  }
}
