/**
 * In-run HUD. Built once; update() only writes values that changed. Widgets: top bar (XP/level/timer/stats),
 * boss bar, banners (boss warning, director events, stamps, skill cut-ins, toasts), ship ring, skill bar,
 * loadout, minimap, offscreen markers and screen feedback.
 */
import { CONTENT } from '../../game/content';
import type { RunState, SimEvent } from '../../game/types';
import type { UiFrame } from '../contracts';
import { h, hex, TextCell } from '../core/dom';
import { ROMAN } from '../core/format';
import { PASSIVE_GLYPH, SPECIALS, ULTIMATES, WEAPON_GLYPH, WEATHER_LABEL } from '../core/names';
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

export class Hud {
  readonly el: HTMLElement;
  private readonly top = new TopBar();
  private readonly boss = new BossBar();
  readonly banners = new Banners();
  private readonly ring = new ShipRing();
  private readonly skills = new SkillBar();
  private readonly loadout = new Loadout();
  private readonly minimap = new Minimap();
  private readonly markers = new Markers();
  readonly feedback = new Feedback();
  private readonly basis = new ScreenBasis();
  private readonly fps: TextCell;
  private readonly fpsEl: HTMLElement;
  private readonly v = { x: 0, y: 0 };
  private lastFps = -1;
  private ended = false;
  private seed = '';
  width = 1600;
  height = 900;

  constructor() {
    const fps = h('span', 'cr-fps');
    this.fpsEl = fps;
    this.fps = new TextCell(fps);
    this.el = h('div', 'cr-hud',
      this.feedback.el,
      this.markers.el,
      this.top.el,
      this.boss.el,
      h('div', 'cr-hud__tr', this.minimap.el, fps),
      this.banners.el,
      this.ring.el,
      this.skills.el,
      this.loadout.el,
    );
    this.el.hidden = true;
  }

  show(): void { this.el.hidden = false; }
  hide(): void { this.el.hidden = true; }
  dispose(): void { this.minimap.dispose(); }

  /** Clears per-run caches (new run or leaving the run screen). */
  reset(): void {
    this.top.reset(); this.boss.reset(); this.banners.reset(); this.ring.reset(); this.skills.reset();
    this.loadout.reset(); this.minimap.reset(); this.markers.reset(); this.feedback.reset();
    this.ended = false;
  }

  resize(w: number, h: number): void { this.width = w; this.height = h; this.markers.width = w; this.markers.height = h; }

  update(f: UiFrame, run: Readonly<RunState>): void {
    if (run.seed !== this.seed) { this.seed = run.seed; this.reset(); this.el.style.setProperty('--accent', hex(CONTENT.ships[run.shipId].accent)); }
    const p = run.player;
    const ship = CONTENT.ships[run.shipId];
    this.banners.tick(f.time);
    this.basis.update(f, p.x, p.z);
    this.top.update(run, f.time);
    this.boss.update(run, f.dt);
    this.ring.update(p, ship);
    this.skills.update(p, ship);
    this.loadout.update(p);
    this.minimap.update(run, this.basis, f.dt);
    this.markers.update(f, run, this.basis);
    this.feedback.update(p);
    if (this.skills.ultJustReady) this.banners.toast(`${ULTIMATES[ship.ultimate].name} ready — press R`, ULTIMATES[ship.ultimate].glyph, 'gold');
    // FPS readout.
    this.fpsEl.hidden = !f.settings.showFps;
    if (f.settings.showFps) { const v = Math.round(f.fps); if (v !== this.lastFps) { this.lastFps = v; this.fps.set(`${v} FPS`); } }
    for (let i = 0; i < f.events.length; i++) this.onEvent(f.events[i]!, run, f);
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
        if (e.slot === 'ultimate') { const u = ULTIMATES[ship.ultimate]; this.banners.cutIn('Ultimate', u.name, u.glyph, hex(ship.accent), true); this.feedback.whiteFlash(0.35, 300); }
        else if (e.slot === 'special') { const s = SPECIALS[ship.special]; this.banners.cutIn('Special', s.name, s.glyph, hex(ship.accent), false); }
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
        this.banners.directorEvent(e.name, e.text);
        break;
      case 'tier-up':
        this.banners.showStamp(`Tier ${ROMAN[e.tier] ?? e.tier}`, 'Your ship grows!', 'gold', 2, 1500);
        break;
      case 'weapon-changed': {
        this.loadout.pop(e.weapon);
        const def = CONTENT.weapons[e.weapon];
        if (e.isNew) this.banners.toast(`New weapon · ${def.name}`, WEAPON_GLYPH[e.weapon], 'gold');
        else if (e.overdrive) this.banners.toast(`Overdrive · ${def.overdrive.name}`, 'star', 'gold');
        break;
      }
      case 'passive-changed':
        this.loadout.pop(e.passive);
        if (e.isNew) this.banners.toast(`New passive · ${CONTENT.passives[e.passive].name}`, PASSIVE_GLYPH[e.passive], 'white');
        break;
      case 'pickup-collected':
        if (e.kind === 'repair') this.banners.toast('Hull repaired +25%', 'plus', 'teal');
        else if (e.kind === 'compass') this.banners.toast('Compass! All treasure drawn in', 'compass', 'gold');
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
