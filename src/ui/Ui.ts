/**
 * Game UI (UI-owned; the UiSystem surface is contract). DOM-only: title, harbor, in-run HUD, level-up cards and
 * chest reveal, pause/settings/controls, results. Reads frame state and reports intent through UiCallbacks.
 *
 * Performance: every screen is built once at mount. The HUD writes only values that changed (text nodes,
 * transforms, custom properties); the minimap canvas redraws at ~30 Hz.
 */
import type { AppScreen } from '../render/frame';
import type { RunState, Settings } from '../game/types';
import { SCRATCH } from '../game/sim/meta-runtime';
import type { UiCallbacks, UiFrame, UiSystem } from './contracts';
import { h } from './core/dom';
import { ensureGlyphSprite, prefetchIcons } from './core/icons';
import { iconPath } from './core/names';
import { PadReader, type PadIntent } from './core/nav';
import { Hud } from './hud/Hud';
import { CardsModal } from './modals/CardsModal';
import { PauseMenu } from './modals/PauseMenu';
import { SettingsPanel } from './modals/SettingsPanel';
import { HarborScreen } from './screens/HarborScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { TitleScreen } from './screens/TitleScreen';

const LEAVE_MS = 320;

/** The run has ended, or the final flagship is sinking (director victory lap: `scratch.victoryAt` is armed). */
export function runIsOver(run: Readonly<RunState>): boolean {
  return run.status === 'victory' || run.status === 'dead' || (run.director.scratch[SCRATCH.victoryAt] ?? 0) > 0;
}

export class Ui implements UiSystem {
  private root!: HTMLElement;
  private layer!: HTMLElement;
  private cb!: UiCallbacks;
  private screen: AppScreen = 'boot';
  private title!: TitleScreen;
  private harbor!: HarborScreen;
  private results!: ResultsScreen;
  private hud!: Hud;
  private cards!: CardsModal;
  private pause!: PauseMenu;
  private settings!: SettingsPanel;
  private readonly pad = new PadReader();
  private readonly intents: PadIntent[] = [];
  private frame: UiFrame | null = null;
  private run: Readonly<RunState> | null = null;
  private settingsValue: Readonly<Settings> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastGesture = -1;
  private readonly leaveTimers = new Map<HTMLElement, number>();
  private mounted = false;
  /** Rolling UI update cost (ms) for QA: window.__CRUISE_UI__.perf(). */
  private perfAvg = 0;
  private perfMax = 0;
  private readonly spikes: { ms: number; screen: string; status: string; events: string }[] = [];
  /** Seed of the run whose `run-ended` event has been seen (cleared when an endless voyage sails on). */
  private endedSeed = '';
  private lapPickAt = -1;

  get blockingInput(): boolean {
    return this.mounted && (this.pause.open || this.settings.open || this.cards.open);
  }

  mount(root: HTMLElement, callbacks: UiCallbacks): void {
    this.root = root;
    this.cb = callbacks;
    ensureGlyphSprite();
    this.title = new TitleScreen(() => this.goHarbor());
    this.harbor = new HarborScreen({ cb: callbacks, openSettings: () => this.openSettings() });
    this.results = new ResultsScreen(callbacks);
    this.hud = new Hud();
    this.cards = new CardsModal({
      choose: (i) => this.cb.onChooseCard(i),
      reroll: () => this.cb.onReroll(),
      banish: (i) => this.cb.onBanish(i),
    });
    this.pause = new PauseMenu({
      resume: () => this.setPaused(false),
      openSettings: () => this.openSettings(),
      retire: () => { this.setPaused(false); this.cb.onRetire(); },
    });
    this.settings = new SettingsPanel((s) => { this.settingsValue = s; this.cb.onSettingsChange(s); });
    this.layer = h('div', 'cr-ui',
      this.hud.el,
      this.title.el,
      this.harbor.el,
      this.results.el,
      this.cards.el,
      this.pause.el,
      this.settings.el,
    );
    this.layer.dataset.screen = 'boot';
    root.append(this.layer);
    window.addEventListener('keydown', this.onKey, true);
    root.addEventListener('pointerdown', this.onPointer, true);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const e of entries) this.hud.resize(e.contentRect.width, e.contentRect.height);
      });
      this.resizeObserver.observe(root);
    }
    this.hud.resize(root.clientWidth || window.innerWidth, root.clientHeight || window.innerHeight);
    prefetchIcons(['doubloon', 'broadside', 'brace', 'boost', 'heal', 'bounty'].map(iconPath));
    (window as unknown as { __CRUISE_UI__?: unknown }).__CRUISE_UI__ = {
      perf: () => ({ avgMs: +this.perfAvg.toFixed(4), maxMs: +this.perfMax.toFixed(4) }),
      resetPerf: () => { this.perfAvg = 0; this.perfMax = 0; this.spikes.length = 0; },
      spikes: () => this.spikes.slice(),
      screen: () => this.screen,
      blocking: () => this.blockingInput,
    };
    this.mounted = true;
  }

  setScreen(screen: AppScreen): void {
    if (!this.mounted) return;
    const prev = this.screen;
    this.screen = screen;
    this.layer.dataset.screen = screen;
    this.root.classList.toggle('cr-in-run', screen === 'run');
    if (screen !== 'run') {
      if (this.pause.open) { this.pause.hide(); this.cb.onPause(false); }
      this.cards.reset();
      this.hud.hide();
      this.root.classList.remove('cr-modal-open');
    }
    if (this.settings.open && screen !== prev) this.settings.close();
    if (prev === 'title' && screen !== 'title') this.leave(this.title.el, () => this.title.hide());
    if (prev === 'harbor' && screen !== 'harbor') this.leave(this.harbor.el, () => this.harbor.hide());
    if (prev === 'results' && screen !== 'results') this.leave(this.results.el, () => this.results.hide());
    switch (screen) {
      case 'title': this.cancelLeave(this.title.el); this.title.show(); break;
      case 'harbor': this.cancelLeave(this.harbor.el); this.harbor.show(this.frame); break;
      case 'results': this.cancelLeave(this.results.el); this.results.show(); break;
      case 'run': this.hud.reset(); this.hud.show(); break;
      default: break;
    }
  }

  update(f: UiFrame): void {
    if (!this.mounted) return;
    const t0 = performance.now();
    this.frame = f;
    this.settingsValue = f.settings;
    const calm = !!(f.settings as { reduceFlashing?: boolean }).reduceFlashing;
    if (calm !== this.layer.classList.contains('is-calm')) this.layer.classList.toggle('is-calm', calm);
    this.pollPad(f.dt);
    switch (this.screen) {
      case 'harbor': this.harbor.update(f); break;
      case 'results': this.results.update(f); break;
      case 'run': this.updateRun(f); break;
      default: break;
    }
    const dt = performance.now() - t0;
    this.perfAvg += (dt - this.perfAvg) * 0.05;
    if (dt > this.perfMax) this.perfMax = dt;
    if (dt > 3 && this.spikes.length < 40) {
      const types = new Set<string>();
      for (const e of f.events) types.add(e.type);
      this.spikes.push({ ms: +dt.toFixed(2), screen: this.screen, status: f.run?.status ?? '-', events: [...types].join(',') });
    }
  }

  private updateRun(f: UiFrame): void {
    const run = f.run;
    this.run = run;
    if (!run) return;
    // Victory-lap guard: no card screen once the run is over or its final flagship is going down. A late offer
    // (XP gems magnet in during the lap) is resolved here with the first card, so the results are never held back.
    for (let i = 0; i < f.events.length; i++) if (f.events[i]!.type === 'run-ended') this.endedSeed = run.seed;
    if (this.endedSeed === run.seed && run.endless && run.status === 'running') this.endedSeed = '';
    const over = this.endedSeed === run.seed || runIsOver(run);
    const cardsUp = run.status === 'levelup' || run.status === 'chest';
    if (over && cardsUp && run.offers && f.time - this.lapPickAt > 0.05) { this.lapPickAt = f.time; this.cb.onChooseCard(0); }
    this.hud.setModal((cardsUp && !over) || this.pause.open);
    this.hud.over = over;
    this.hud.update(f, run);
    const prof = (window as unknown as { __CRUISE_UI_PROFILE__?: Record<string, number> }).__CRUISE_UI_PROFILE__;
    const c0 = prof ? performance.now() : 0;
    this.cards.update(f, over);
    if (prof) { const d = performance.now() - c0; prof.cards = (prof.cards ?? 0) + d; prof.cards_max = Math.max(prof.cards_max ?? 0, d); }
    // The app can pause on its own (tab hidden): surface the pause menu so the player can resume.
    if (run.status === 'paused' && !this.pause.open) this.setPaused(true);
    const modal = this.blockingInput;
    if (modal !== this.root.classList.contains('cr-modal-open')) this.root.classList.toggle('cr-modal-open', modal);
  }

  // ── Screens ──

  private goHarbor(): void {
    this.gesture();
    this.cb.onGoToHarbor();
  }

  private leave(el: HTMLElement, done: () => void): void {
    if (el.hidden) return;
    this.cancelLeave(el);
    el.classList.add('is-leaving');
    const id = window.setTimeout(() => { el.classList.remove('is-leaving'); this.leaveTimers.delete(el); done(); }, LEAVE_MS);
    this.leaveTimers.set(el, id);
  }

  private cancelLeave(el: HTMLElement): void {
    const id = this.leaveTimers.get(el);
    if (id !== undefined) { window.clearTimeout(id); this.leaveTimers.delete(el); }
    el.classList.remove('is-leaving');
  }

  private setPaused(on: boolean): void {
    if (on === this.pause.open) return;
    if (on) {
      if (this.screen !== 'run') return;
      this.pause.show(this.run);
      this.cb.onPause(true);
    } else {
      if (this.settings.open) this.settings.close();
      this.pause.hide();
      this.cb.onPause(false);
    }
  }

  private openSettings(): void {
    const s = this.settingsValue ?? this.frame?.settings;
    if (!s) return;
    this.settings.show(s, () => {
      if (this.screen === 'run' && this.pause.open) this.pause.refocus();
      else if (this.screen === 'harbor') this.harbor.refocus();
    });
  }

  // ── Input routing ──

  private gesture(): void {
    const now = performance.now();
    if (this.lastGesture >= 0 && now - this.lastGesture < 800) return;
    this.lastGesture = now;
    this.cb.onUserGesture();
  }

  private readonly onPointer = (): void => {
    this.layer.classList.remove('is-pad');
    if (this.screen !== 'run' || this.blockingInput || this.lastGesture < 0) this.gesture();
  };

  private readonly onPointerMove = (): void => {
    if (this.layer.classList.contains('is-pad')) this.layer.classList.remove('is-pad');
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.mounted) return;
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') return;
    this.layer.classList.remove('is-pad');
    if (this.screen !== 'run' || this.lastGesture < 0) this.gesture();
    let handled = false;
    if (this.settings.open) handled = this.settings.onKey(e);
    else if (this.screen === 'run') {
      if (this.pause.open) handled = this.pause.onKey(e);
      else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && this.canPause()) { this.setPaused(true); handled = true; }
      else if (this.cards.open) handled = this.cards.onKey(e);
    } else if (this.screen === 'title') handled = this.title.onKey(e);
    else if (this.screen === 'harbor') handled = this.harbor.onKey(e);
    else if (this.screen === 'results') handled = this.results.onKey(e);
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };

  private canPause(): boolean {
    return !!this.run && this.run.status !== 'dead' && this.run.status !== 'victory';
  }

  private pollPad(dt: number): void {
    this.pad.poll(dt, this.intents);
    if (this.pad.anyPressed) this.layer.classList.add('is-pad');
    for (const intent of this.intents) {
      if (this.settings.open) { this.settings.onPad(intent); continue; }
      switch (this.screen) {
        case 'title': this.goHarbor(); return;
        case 'harbor': this.harbor.onPad(intent); break;
        case 'results': this.results.onPad(intent); break;
        case 'run':
          if (this.pause.open) this.pause.onPad(intent);
          else if (intent === 'start' && this.canPause()) this.setPaused(true);
          else if (this.cards.open) this.cards.onPad(intent);
          break;
        default: break;
      }
    }
  }

  dispose(): void {
    if (!this.mounted) return;
    window.removeEventListener('keydown', this.onKey, true);
    this.root.removeEventListener('pointerdown', this.onPointer, true);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.resizeObserver?.disconnect();
    this.hud.dispose();
    for (const id of this.leaveTimers.values()) window.clearTimeout(id);
    this.layer.remove();
    this.root.classList.remove('cr-in-run', 'cr-modal-open');
    this.mounted = false;
  }
}
