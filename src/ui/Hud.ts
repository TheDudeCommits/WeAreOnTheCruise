import type {
  DebugScene,
  InputAction,
  ShipKind,
  ShipSide,
  ShipState,
  WorldState,
} from '../core/contracts';
import type { PresentationEvent } from './presentation';

export type { PresentationEvent } from './presentation';

export interface HudOptions {
  /** Bypasses the launch poster for deterministic capture and test harnesses. */
  captureMode?: boolean;
  /** Alias for captureMode when an embedding runtime already owns ship selection. */
  skipIntro?: boolean;
  initialShip?: ShipKind;
  onLaunch?: (ship: ShipKind) => void | Promise<void>;
  onAction?: (action: InputAction, pressed?: boolean) => void;
  onPauseChange?: (paused: boolean) => void;
  onMuteToggle?: () => void;
  onSceneChange?: (scene: DebugScene) => void | Promise<void>;
  /** Call AudioDirector.unlock here; this callback runs inside the user gesture. */
  onUserGesture?: () => void | Promise<void>;
}

interface ShipChoice {
  kind: ShipKind;
  name: string;
  epithet: string;
  role: string;
  special: string;
  speed: number;
  power: number;
  turn: number;
  hull: number;
}

interface HudSnapshot {
  mode: WorldState['mode'];
  weather: WorldState['weather'];
  objective: string;
  hull: number;
  targetId?: string;
  repairing: boolean;
  countdown: number;
  raceActive: boolean;
}

interface Callout {
  speaker: string;
  message: string;
  tone: 'info' | 'danger' | 'success' | 'race';
}

interface VoyageChapter {
  scene: DebugScene;
  label: string;
  note: string;
}

const VOYAGE_CHAPTERS: readonly VoyageChapter[] = [
  { scene: 'calm-sailing', label: 'Open Sea', note: 'Free sail' },
  { scene: 'sunny-broadside', label: 'Naval Clash', note: 'Broadside battle' },
  { scene: 'race-start', label: 'Pirate Cup', note: 'Three-lap race' },
  { scene: 'storm-sailing', label: 'Squall', note: 'Storm run' },
  { scene: 'island-discovery', label: 'Land Ho', note: 'Island voyage' },
  { scene: 'night-encounter', label: 'Night Hunt', note: 'Dark-water duel' },
] as const;

const SHIPS: readonly ShipChoice[] = [
  {
    kind: 'thousand-sunny', name: 'Thousand Sunny', epithet: 'The Sun Lion', role: 'All-round adventure ship',
    special: 'Coup de Burst', speed: 92, power: 84, turn: 78, hull: 74,
  },
  {
    kind: 'going-merry', name: 'Going Merry', epithet: 'The Brave Little Ram', role: 'Agile morale runner',
    special: 'Miracle Tack', speed: 76, power: 48, turn: 96, hull: 46,
  },
  {
    kind: 'moby-dick', name: 'Moby Dick', epithet: 'The White Colossus', role: 'Heavy broadside fortress',
    special: 'Seaquake Salvo', speed: 42, power: 100, turn: 34, hull: 100,
  },
  {
    kind: 'red-force', name: 'Red Force', epithet: 'The Scarlet Dragon', role: 'Precision interceptor',
    special: "Emperor's Glare", speed: 82, power: 88, turn: 76, hull: 80,
  },
  {
    kind: 'oro-jackson', name: 'Oro Jackson', epithet: 'The Golden Legend', role: 'Elite treasure hunter',
    special: 'Conqueror Wake', speed: 86, power: 92, turn: 72, hull: 88,
  },
  {
    kind: 'polar-tang', name: 'Polar Tang', epithet: 'The Yellow Submersible', role: 'Technical ambusher',
    special: 'Room Dive', speed: 88, power: 70, turn: 90, hull: 66,
  },
  {
    kind: 'queen-mama-chanter', name: 'Queen Mama Chanter', epithet: 'The Singing Dreadnought', role: 'Area-control flagship',
    special: 'Soul Storm', speed: 46, power: 96, turn: 38, hull: 98,
  },
  {
    kind: 'baratie', name: 'Baratie', epithet: 'The Fighting Restaurant', role: 'Resilient support vessel',
    special: 'Banquet Barrage', speed: 52, power: 72, turn: 54, hull: 92,
  },
  {
    kind: 'navy-galleon', name: 'Navy Galleon', epithet: 'The Iron Pursuer', role: 'Disciplined gun platform',
    special: 'Justice Volley', speed: 64, power: 82, turn: 58, hull: 86,
  },
] as const;

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const KNOTS_PER_METRE_PER_SECOND = 1.94384;

export class Hud {
  readonly element: HTMLDivElement;

  private selectedIndex: number;
  private introOpen: boolean;
  private readonly captureMode: boolean;
  private drawerOpen = false;
  private snapshot?: HudSnapshot;
  private calloutQueue: Callout[] = [];
  private calloutTimer?: number;
  private countdownTimer?: number;
  private readonly els: Record<string, HTMLElement>;
  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);
  private readonly onPointerDown = (): void => { void this.options.onUserGesture?.(); };

  constructor(
    private readonly host: HTMLElement,
    private readonly options: HudOptions = {},
  ) {
    this.selectedIndex = Math.max(0, SHIPS.findIndex((ship) => ship.kind === (options.initialShip ?? 'thousand-sunny')));
    this.captureMode = options.captureMode === true || options.skipIntro === true || Hud.isCaptureMode();
    this.introOpen = !this.captureMode;
    this.element = document.createElement('div');
    this.element.className = 'cruise-ui';
    this.element.dataset.capture = String(this.captureMode);
    this.element.setAttribute('aria-live', 'polite');
    this.element.innerHTML = this.template();
    this.host.append(this.element);

    this.els = this.collectElements();
    this.bindControls();
    this.selectShip(this.selectedIndex, false);
    this.setIntroOpen(this.introOpen);
    window.addEventListener('keydown', this.onKeyDown);
    this.element.addEventListener('pointerdown', this.onPointerDown, { passive: true });
  }

  static isCaptureMode(search = window.location.search): boolean {
    const params = new URLSearchParams(search);
    return params.get('capture') === '1'
      || params.get('capture') === 'true'
      || params.get('ui') === 'capture'
      || document.documentElement.dataset.capture === 'true';
  }

  get selectedShip(): ShipKind {
    return SHIPS[this.selectedIndex].kind;
  }

  get isIntroOpen(): boolean {
    return this.introOpen;
  }

  update(state: WorldState, _deltaSeconds = 0): void {
    this.updateWeather(state);
    const player = state.ships.find((ship) => ship.id === state.playerId);
    if (!player) {
      this.els.shipName.textContent = 'Awaiting crew…';
      this.els.hud.setAttribute('data-active', 'false');
      this.updateRace(state);
      return;
    }

    this.els.hud.setAttribute('data-active', 'true');
    this.updateNavigation(state, player);
    this.updateShipStatus(state, player);
    this.updateWeapons(player);
    this.updateTarget(state, player);
    this.updateRace(state);
    this.updateRadar(state, player);
    this.observeState(state, player);
  }

  push(event: PresentationEvent): void {
    switch (event.type) {
      case 'damage':
      case 'impact':
        this.flashDamage(event.severity ?? 0.5, event.section);
        break;
      case 'victory':
        this.flashBanner(event.title ?? 'VICTORY!', event.subtitle ?? 'The sea remembers your name', 'victory');
        this.callout('CREW', 'We did it! Raise the colors!', 'success');
        break;
      case 'defeat':
        this.flashBanner(event.title ?? 'SHIP DISABLED', event.subtitle ?? 'The voyage is not over', 'defeat');
        break;
      case 'discovery':
        this.flashBanner('LAND HO!', event.title, 'discovery');
        this.callout('LOOKOUT', event.subtitle ?? `${event.title}, dead ahead!`, 'success');
        break;
      case 'crew-callout':
        this.callout(event.speaker ?? 'CREW', event.message, event.tone ?? 'info');
        break;
      case 'race-countdown':
        this.showCountdown(event.count > 0 ? String(event.count) : 'GO!');
        break;
      case 'race-start':
        this.showCountdown('GO!');
        this.callout('HELMSMAN', 'Full sail—leave them in our wake!', 'race');
        break;
      case 'checkpoint':
        this.flashBanner('CHECKPOINT', event.total ? `${event.index ?? 0} / ${event.total}` : 'Clean line!', 'checkpoint');
        break;
      case 'target-acquired':
        this.callout('LOOKOUT', `${event.name ?? 'Hostile ship'} sighted!`, 'danger');
        break;
      case 'repair':
        if (event.phase === 'start') this.callout('SHIPWRIGHT', 'Damage crew, move!', 'info');
        if (event.phase === 'complete') this.callout('SHIPWRIGHT', 'She’ll hold! Back to stations!', 'success');
        break;
      case 'special':
        if (event.phase === 'ready') this.callout('CAPTAIN', `${event.name ?? 'Special'} is ready!`, 'success');
        if (event.phase === 'charge') this.flashBanner('SPECIAL', event.name ?? 'Charging!', 'special');
        break;
      case 'cannon-fired':
      case 'thunder':
        break;
    }
  }

  callout(
    speaker: string,
    message: string,
    tone: Callout['tone'] = 'info',
  ): void {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    const last = this.calloutQueue.at(-1);
    if (last?.message === cleanMessage) return;
    this.calloutQueue.push({ speaker: speaker.toUpperCase(), message: cleanMessage, tone });
    if (!this.calloutTimer) this.presentNextCallout();
  }

  showShipSelect(): void {
    this.setIntroOpen(true);
  }

  hideShipSelect(): void {
    this.setIntroOpen(false);
  }

  setPaused(paused: boolean, openDrawer = false): void {
    this.els.pauseStamp.hidden = !paused || this.introOpen || this.captureMode;
    this.els.menuButton.setAttribute('aria-label', paused ? 'Resume voyage' : 'Pause and open help');
    if (openDrawer) this.setDrawerOpen(paused);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    if (this.calloutTimer) window.clearTimeout(this.calloutTimer);
    if (this.countdownTimer) window.clearTimeout(this.countdownTimer);
    this.element.remove();
  }

  private template(): string {
    const shipCards = SHIPS.map((ship, index) => this.shipCard(ship, index)).join('');
    return `
      <section class="launch-poster" data-ui="intro" aria-label="Choose your ship">
        <div class="launch-sun" aria-hidden="true"></div>
        <div class="launch-copy">
          <p class="eyebrow">A GRAND LINE ADVENTURE</p>
          <h1><span>WE ARE ON</span><strong>THE CRUISE</strong></h1>
          <p class="launch-deck">Choose your legend. Chase the horizon. Make the sea remember your name.</p>
        </div>
        <div class="ship-selector">
          <div class="selector-heading">
            <span class="poster-number">SHIP No. <b data-ui="ship-number">01</b></span>
            <h2>Pick your vessel</h2>
            <span class="selector-hint">← → to inspect</span>
          </div>
          <button class="selector-arrow selector-arrow--prev" type="button" data-action="previous-ship" aria-label="Previous ship">‹</button>
          <div class="ship-card-track" data-ui="ship-track">${shipCards}</div>
          <button class="selector-arrow selector-arrow--next" type="button" data-action="next-ship" aria-label="Next ship">›</button>
          <div class="selected-ship-copy">
            <div>
              <span class="eyebrow" data-ui="ship-epithet"></span>
              <strong data-ui="selected-ship-name"></strong>
              <small data-ui="ship-role"></small>
            </div>
            <div class="ship-special"><span>CREW SPECIAL</span><b data-ui="ship-special"></b></div>
          </div>
          <div class="ship-stats" aria-label="Ship ratings">
            ${this.statRow('Speed', 'speed')}
            ${this.statRow('Power', 'power')}
            ${this.statRow('Turn', 'turn')}
            ${this.statRow('Hull', 'hull')}
          </div>
          <button class="launch-button" type="button" data-action="launch">
            <span>SET SAIL</span><small>Enter</small>
          </button>
          <p class="launch-status" data-ui="launch-status" role="status">Ready when you are, Captain.</p>
        </div>
      </section>

      <div class="hud-layer" data-ui="hud" data-active="false">
        <div class="weather-layer" data-ui="weather-layer" data-weather="none" aria-hidden="true" hidden>
          <i class="weather-bank weather-bank--near"></i>
          <i class="weather-bank weather-bank--middle"></i>
          <i class="weather-bank weather-bank--far"></i>
        </div>
        <div class="hud-top-left">
          <section class="objective-slip ink-panel" aria-label="Current objective">
            <div class="objective-kicker"><span data-ui="mode">EXPLORE</span><i></i><span data-ui="weather">CALM SEA</span></div>
            <strong data-ui="objective">Chart the horizon</strong>
          </section>
          <section class="race-card" data-ui="race" aria-label="Race status" hidden>
            <div class="race-place"><strong data-ui="race-place">1ST</strong><span>OF 4</span></div>
            <div class="race-progress"><b data-ui="race-lap">LAP 1 / 3</b><span data-ui="race-checkpoint">GATE 1</span></div>
            <time data-ui="race-time">00:00.00</time>
          </section>
        </div>

        <section class="compass-ribbon" aria-label="Compass">
          <span class="compass-wind" data-ui="wind-arrow" aria-label="Wind direction">➤</span>
          <div><small data-ui="compass-left">NW</small><b data-ui="compass-main">N</b><small data-ui="compass-right">NE</small></div>
          <output data-ui="heading">000°</output>
        </section>

        <div class="hud-top-right">
          <section class="wanted-tab" aria-label="Bounty and treasure">
            <div><small>WANTED</small><strong data-ui="bounty">฿ 0</strong></div>
            <span><i aria-hidden="true">◆</i><b data-ui="treasure">0</b></span>
          </section>
          <button class="menu-button" data-ui="menu-button" data-action="menu" type="button" aria-label="Pause and open help"><i></i><i></i><i></i></button>
        </div>

        <section class="target-tag" data-ui="target" aria-label="Enemy target" hidden>
          <span class="target-eye" aria-hidden="true"></span>
          <div><small>TARGET · <b data-ui="target-distance">0 m</b></small><strong data-ui="target-name">Enemy ship</strong></div>
          <div class="target-hull"><i data-ui="target-hull"></i></div>
          <em data-ui="target-intent">MANEUVERING</em>
        </section>

        <section class="ship-vitals ink-panel" aria-label="Ship condition">
          <div class="ship-identity">
            <span class="ship-wheel" aria-hidden="true"></span>
            <div><small>YOUR SHIP</small><strong data-ui="ship-name">At the helm</strong></div>
          </div>
          ${this.meter('HULL', 'hull', '100')}
          ${this.meter('SAILS', 'sails', '100')}
          ${this.meter('CREW', 'crew', '100')}
          <div class="brace-repair">
            <span data-ui="brace">BRACE READY</span><b data-ui="repair">CREW ON DECK</b>
          </div>
        </section>

        <section class="sailing-gauge" aria-label="Sailing speed">
          <div class="speed-readout"><strong data-ui="speed">00</strong><span>kn</span></div>
          <div class="throttle-track"><i data-ui="throttle"></i><span data-ui="sail-state">FULL SAIL</span></div>
          <small>WIND <b data-ui="wind-strength">0%</b></small>
        </section>

        <section class="sea-chart" aria-label="Nearby ships and islands">
          <svg viewBox="-50 -50 100 100" role="img" aria-label="Local sea chart">
            <circle class="chart-ring" cx="0" cy="0" r="43" />
            <path class="chart-cross" d="M-44 0H44M0-44V44" />
            <g data-ui="radar-islands"></g>
            <g data-ui="radar-ships"></g>
            <path class="chart-player" data-ui="radar-player" d="M0-8L6 7L0 4L-6 7Z" />
          </svg>
          <span>LOCAL SEA · <b data-ui="radar-range">2 km</b></span>
        </section>

        <section class="weapons-cluster" aria-label="Weapons and special ability">
          <div class="ammo-strip"><span>SHOT</span><strong data-ui="ammo">ROUND</strong><kbd>X</kbd></div>
          <div class="weapon-row">
            ${this.weaponBox('PORT', 'port', 'Q')}
            ${this.weaponBox('BOW', 'bow', 'F')}
            ${this.weaponBox('STARBOARD', 'starboard', 'E')}
          </div>
          <div class="special-meter">
            <div><small>SPECIAL</small><strong data-ui="special-label">CHARGING</strong><kbd>C</kbd></div>
            <span><i data-ui="special"></i></span>
          </div>
        </section>

        <div class="wrong-way" data-ui="wrong-way" hidden><small>TURN AROUND</small><strong>WRONG WAY!</strong></div>
        <div class="countdown-burst" data-ui="countdown" hidden>3</div>
        <div class="pause-stamp" data-ui="pause-stamp" hidden>VOYAGE PAUSED</div>

        <aside class="crew-callout" data-ui="callout" data-tone="info" aria-live="assertive" hidden>
          <div class="crew-portrait" aria-hidden="true"><i></i></div>
          <div><small data-ui="callout-speaker">LOOKOUT</small><strong data-ui="callout-message">Sails on the horizon!</strong></div>
        </aside>

        <div class="damage-flash" data-ui="damage-flash" aria-hidden="true"></div>
        <div class="event-banner" data-ui="event-banner" data-tone="victory" hidden>
          <span data-ui="event-title">VICTORY!</span><small data-ui="event-subtitle">The sea remembers your name</small>
        </div>
      </div>

      <div class="drawer-scrim" data-ui="drawer-scrim" hidden></div>
      <aside class="voyage-drawer" data-ui="drawer" aria-label="Pause and controls" aria-hidden="true">
        <button class="drawer-close" data-action="close-drawer" type="button" aria-label="Close controls">×</button>
        <p class="eyebrow">CAPTAIN'S LOG</p>
        <h2>Keep her moving.</h2>
        <p class="drawer-lede">Wind, waves, and firing angles win battles. Keep the enemy off your damaged side.</p>
        <section class="chapter-launcher" aria-label="Voyage chapters">
          <div class="chapter-heading"><b>VOYAGE CHAPTERS</b><span>Choose your next horizon</span></div>
          <div class="chapter-grid">${this.chapterButtons()}</div>
        </section>
        <div class="control-map">
          ${this.controlRow('W / S', 'Raise / lower sail')}
          ${this.controlRow('A / D', 'Steer port / starboard')}
          ${this.controlRow('Shift', 'Hard turn')}
          ${this.controlRow('Q / E', 'Fire port / starboard')}
          ${this.controlRow('F', 'Fire bow weapon')}
          ${this.controlRow('X', 'Cycle ammunition')}
          ${this.controlRow('Space', 'Brace for impact')}
          ${this.controlRow('R', 'Assign repair crew')}
          ${this.controlRow('C', 'Crew special')}
          ${this.controlRow('1—6', 'Camera views')}
          ${this.controlRow('M', 'Mute / unmute')}
        </div>
        <div class="drawer-tip"><b>SEA DOG'S TIP</b><span>Chain shot tears sails. Heavy shot loves a close broadside.</span></div>
        <button class="resume-button" data-action="resume" type="button">RETURN TO THE HELM</button>
        <small class="drawer-footer">H or Esc · Open / close this log</small>
      </aside>
    `;
  }

  private shipCard(ship: ShipChoice, index: number): string {
    return `
      <button class="ship-card" type="button" data-ship="${ship.kind}" data-index="${index}" aria-label="Select ${ship.name}" aria-pressed="false">
        <span class="ship-card-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="ship-silhouette ship-silhouette--${ship.kind}" aria-hidden="true">
          ${this.shipGlyph(ship.kind)}
        </span>
        <strong>${ship.name}</strong><small>${ship.epithet}</small>
      </button>
    `;
  }

  private shipGlyph(kind: ShipKind): string {
    const accents: Record<ShipKind, string> = {
      'thousand-sunny': '<circle cx="34" cy="44" r="10"/><path d="M34 34V14M27 20h14M45 54l7-16 5 16"/>',
      'going-merry': '<path d="M24 48q-8-12 2-20 12 2 9 15M29 28l-6-7M35 46V16M35 19l16 12H35"/>',
      'moby-dick': '<path d="M16 47q10-23 29-12 8 4 15-3-4 15-20 18M35 36V13M35 16l20 16H35"/>',
      'red-force': '<path d="M22 47l10-18 9 16 8-8 9 13M39 40V14M39 18l16 15H39"/>',
      'oro-jackson': '<path d="M17 47l8-18 9 14 10-18 12 23M38 38V12M38 16l18 14H38"/>',
      'polar-tang': '<path d="M16 45q22-18 45 0l-4 8H20ZM38 35V22h9l6 13M21 45l-7-7"/>',
      'queen-mama-chanter': '<path d="M17 49l7-22 11 16 9-22 14 29M39 41V11M39 15l20 15H39M23 28l7-10"/>',
      'baratie': '<path d="M14 48h50l-7 7H21ZM24 46V24h27v22M29 24v-9h17v9M55 45l9-14"/>',
      'navy-galleon': '<path d="M15 48h49l-8 7H23ZM38 44V11M38 16l18 14H38M38 20L23 32h15"/>',
    };
    return `<svg viewBox="0 0 80 62" focusable="false"><path class="glyph-hull" d="M8 48Q38 58 72 46L64 58H18Z"/>${accents[kind]}</svg>`;
  }

  private statRow(label: string, key: string): string {
    return `<div><span>${label}</span><i><b data-ui="stat-${key}"></b></i><output data-ui="stat-${key}-value">00</output></div>`;
  }

  private meter(label: string, key: string, value: string): string {
    return `<div class="vital-row" data-condition="good"><span>${label}</span><i><b data-ui="${key}-bar"></b></i><output data-ui="${key}-value">${value}</output></div>`;
  }

  private weaponBox(label: string, key: string, shortcut: string): string {
    return `<div class="weapon-box" data-ui="weapon-${key}" data-ready="true"><small>${label}</small><strong data-ui="weapon-${key}-state">READY</strong><i><b data-ui="weapon-${key}-bar"></b></i><kbd>${shortcut}</kbd></div>`;
  }

  private controlRow(key: string, action: string): string {
    return `<div><kbd>${key}</kbd><span>${action}</span></div>`;
  }

  private chapterButtons(): string {
    return VOYAGE_CHAPTERS.map((chapter, index) => `
      <button type="button" data-chapter="${chapter.scene}" aria-label="Start ${chapter.label}">
        <b>${String(index + 1).padStart(2, '0')}</b>
        <span><strong>${chapter.label}</strong><small>${chapter.note}</small></span>
      </button>
    `).join('');
  }

  private collectElements(): Record<string, HTMLElement> {
    const result: Record<string, HTMLElement> = {};
    this.element.querySelectorAll<HTMLElement>('[data-ui]').forEach((element) => {
      const key = element.dataset.ui;
      if (key) result[this.camelCase(key)] = element;
    });
    return result;
  }

  private camelCase(value: string): string {
    return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  }

  private bindControls(): void {
    this.element.querySelector('[data-action="previous-ship"]')?.addEventListener('click', () => this.selectShip(this.selectedIndex - 1));
    this.element.querySelector('[data-action="next-ship"]')?.addEventListener('click', () => this.selectShip(this.selectedIndex + 1));
    this.element.querySelector('[data-action="launch"]')?.addEventListener('click', () => { void this.launch(); });
    this.element.querySelector('[data-action="menu"]')?.addEventListener('click', () => this.toggleDrawer(true));
    this.element.querySelector('[data-action="close-drawer"]')?.addEventListener('click', () => this.setDrawerOpen(false));
    this.element.querySelector('[data-action="resume"]')?.addEventListener('click', () => this.resume());
    this.els.drawerScrim.addEventListener('click', () => this.setDrawerOpen(false));
    this.element.querySelectorAll<HTMLButtonElement>('[data-chapter]').forEach((button) => {
      button.addEventListener('click', () => {
        const scene = button.dataset.chapter as DebugScene;
        void this.launchChapter(scene);
      });
    });
    this.element.querySelectorAll<HTMLElement>('[data-ship]').forEach((card) => {
      card.addEventListener('click', () => this.selectShip(Number(card.dataset.index)));
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || this.isTypingTarget(event.target)) return;
    if (this.introOpen) {
      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        this.selectShip(this.selectedIndex - 1);
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        this.selectShip(this.selectedIndex + 1);
      } else if (event.code === 'Enter') {
        event.preventDefault();
        void this.launch();
      }
      return;
    }

    if (event.repeat) return;
    if (event.code === 'KeyH') {
      event.preventDefault();
      this.toggleDrawer(false);
    } else if (event.code === 'Escape') {
      event.preventDefault();
      if (this.drawerOpen) this.setDrawerOpen(false);
      else this.toggleDrawer(true);
    } else if (event.code === 'KeyM') {
      event.preventDefault();
      this.options.onMuteToggle?.();
      this.callout('SYSTEM', 'Audio toggled', 'info');
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable);
  }

  private selectShip(index: number, announce = true): void {
    const length = SHIPS.length;
    this.selectedIndex = ((index % length) + length) % length;
    const selected = SHIPS[this.selectedIndex];
    this.els.shipNumber.textContent = String(this.selectedIndex + 1).padStart(2, '0');
    this.els.selectedShipName.textContent = selected.name;
    this.els.shipEpithet.textContent = selected.epithet;
    this.els.shipRole.textContent = selected.role;
    this.els.shipSpecial.textContent = selected.special;
    (['speed', 'power', 'turn', 'hull'] as const).forEach((stat) => {
      const value = selected[stat];
      this.els[`stat${this.capitalize(stat)}`].style.width = `${value}%`;
      this.els[`stat${this.capitalize(stat)}Value`].textContent = String(value);
    });

    const cards = [...this.element.querySelectorAll<HTMLElement>('.ship-card')];
    cards.forEach((card, cardIndex) => {
      const active = cardIndex === this.selectedIndex;
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-pressed', String(active));
      card.tabIndex = active ? 0 : -1;
    });
    const selectedCard = cards[this.selectedIndex];
    const cardWidth = selectedCard?.getBoundingClientRect().width || 190;
    const gap = 16;
    this.els.shipTrack.style.setProperty('--ship-index', String(this.selectedIndex));
    this.els.shipTrack.style.setProperty('--ship-step', `${cardWidth + gap}px`);
    if (announce) this.els.launchStatus.textContent = `${selected.name}: ${selected.special}. Ready to launch.`;
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private async launch(): Promise<void> {
    if (!this.introOpen) return;
    const button = this.element.querySelector<HTMLButtonElement>('[data-action="launch"]');
    if (button?.disabled) return;
    void this.options.onUserGesture?.();
    if (button) button.disabled = true;
    this.els.launchStatus.textContent = 'Cast off! The horizon is ours.';
    this.element.classList.add('is-launching');
    try {
      await this.options.onLaunch?.(this.selectedShip);
      window.setTimeout(() => this.setIntroOpen(false), 240);
    } catch (error) {
      this.element.classList.remove('is-launching');
      this.els.launchStatus.textContent = error instanceof Error ? error.message : 'The tide pushed us back. Try again.';
      if (button) button.disabled = false;
    }
  }

  private setIntroOpen(open: boolean): void {
    this.introOpen = open;
    this.element.classList.toggle('has-intro', open);
    this.els.intro.hidden = !open;
    this.els.hud.setAttribute('aria-hidden', String(open));
    if (!open) {
      this.element.classList.remove('is-launching');
      if (!this.captureMode) this.callout('LOOKOUT', 'Clear water ahead, Captain!', 'info');
    }
  }

  private toggleDrawer(pause: boolean): void {
    const next = !this.drawerOpen;
    this.setDrawerOpen(next);
    if (pause) this.requestPause(next);
  }

  private setDrawerOpen(open: boolean): void {
    this.drawerOpen = open;
    this.els.drawer.classList.toggle('is-open', open);
    this.els.drawer.setAttribute('aria-hidden', String(!open));
    this.els.drawerScrim.hidden = !open;
    this.element.classList.toggle('has-drawer', open);
    if (open) window.setTimeout(() => this.element.querySelector<HTMLButtonElement>('.drawer-close')?.focus(), 0);
  }

  private requestPause(paused: boolean): void {
    this.options.onPauseChange?.(paused);
    this.options.onAction?.('pause', paused);
    this.setPaused(paused);
  }

  private resume(): void {
    this.setDrawerOpen(false);
    this.requestPause(false);
  }

  private async launchChapter(scene: DebugScene): Promise<void> {
    this.setDrawerOpen(false);
    this.requestPause(false);
    try {
      await this.options.onSceneChange?.(scene);
    } catch {
      this.callout('NAVIGATOR', 'That route is not charted yet.', 'danger');
    }
  }

  private updateWeather(state: WorldState): void {
    const weather = state.weather === 'storm' || state.weather === 'maelstrom'
      ? 'storm'
      : state.weather === 'fog' || state.weather === 'night'
        ? state.weather
        : 'none';
    this.els.weatherLayer.dataset.weather = weather;
    this.els.weatherLayer.hidden = weather === 'none';
  }

  private updateNavigation(state: WorldState, player: ShipState): void {
    const heading = this.normalizedDegrees(player.heading);
    const cardinalIndex = Math.round(heading / 45) % 8;
    this.els.compassMain.textContent = CARDINALS[cardinalIndex];
    this.els.compassLeft.textContent = CARDINALS[(cardinalIndex + 7) % 8];
    this.els.compassRight.textContent = CARDINALS[(cardinalIndex + 1) % 8];
    this.els.heading.textContent = `${String(Math.round(heading)).padStart(3, '0')}°`;
    this.els.windArrow.style.transform = `rotate(${this.normalizedDegrees(state.windDirection) - heading}deg)`;
    const objective = state.objective || 'Follow the horizon';
    this.els.objective.textContent = objective;
    this.els.objective.title = objective;
    this.els.mode.textContent = state.mode.toUpperCase();
    this.els.weather.textContent = state.weather.replace('-', ' ').toUpperCase();
    this.els.bounty.textContent = `฿ ${this.compactNumber(state.bounty)}`;
    this.els.treasure.textContent = this.compactNumber(state.treasure);
  }

  private updateShipStatus(state: WorldState, player: ShipState): void {
    const hull = this.integrity(player.damage.hull);
    const sails = this.integrity(player.damage.sails);
    const crew = this.integrity(player.damage.crew);
    this.els.shipName.textContent = player.name;
    this.setMeter('hull', hull);
    this.setMeter('sails', sails);
    this.setMeter('crew', crew);

    const speed = Math.max(0, player.speed * KNOTS_PER_METRE_PER_SECOND);
    this.els.speed.textContent = String(Math.round(speed)).padStart(2, '0');
    const throttle = this.normalizedLevel(player.throttle);
    this.els.throttle.style.height = `${Math.max(4, throttle)}%`;
    this.els.sailState.textContent = throttle > 88 ? 'FULL SAIL' : throttle > 45 ? 'HALF SAIL' : throttle > 5 ? 'EASY SAIL' : 'SAILS FURLED';
    this.els.windStrength.textContent = `${Math.round(this.normalizedLevel(state.windStrength))}%`;

    const brace = this.normalizedLevel(player.brace);
    this.els.brace.textContent = brace > 4 ? `BRACED ${Math.round(brace)}%` : 'BRACE READY';
    this.els.brace.classList.toggle('is-active', brace > 4);
    this.els.repair.textContent = player.repairing ? 'REPAIRS UNDERWAY' : 'CREW ON DECK';
    this.els.repair.classList.toggle('is-active', player.repairing);
    this.setPaused(state.paused);
  }

  private updateWeapons(player: ShipState): void {
    this.els.ammo.textContent = player.weapons.ammo.toUpperCase();
    this.setWeapon('port', player.weapons.portCooldown);
    this.setWeapon('starboard', player.weapons.starboardCooldown);
    this.setWeapon('bow', player.weapons.bowCooldown);
    const special = this.normalizedLevel(player.special);
    this.els.special.style.width = `${special}%`;
    this.els.specialLabel.textContent = special >= 99.5 ? 'READY!' : `${Math.round(special)}%`;
    this.els.special.closest('.special-meter')?.classList.toggle('is-ready', special >= 99.5);
  }

  private updateTarget(state: WorldState, player: ShipState): void {
    const explicit = player.targetId ? state.ships.find((ship) => ship.id === player.targetId) : undefined;
    const target = explicit ?? (state.mode === 'combat' ? this.nearestOpponent(state, player) : undefined);
    this.els.target.hidden = !target;
    if (!target) return;

    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    const hull = this.integrity(target.damage.hull);
    this.els.targetName.textContent = target.name;
    this.els.targetDistance.textContent = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`;
    this.els.targetHull.style.width = `${hull}%`;
    this.els.targetIntent.textContent = target.surrendered ? 'SURRENDERING' : target.ai ? target.ai.toUpperCase() : 'MANEUVERING';
    this.els.target.dataset.condition = hull < 30 ? 'critical' : hull < 60 ? 'damaged' : 'strong';
  }

  private updateRace(state: WorldState): void {
    const visible = state.race.active || state.mode === 'race';
    this.els.race.hidden = !visible;
    this.els.wrongWay.hidden = !visible || !state.race.wrongWay;
    if (!visible) return;
    this.els.racePlace.textContent = this.ordinal(state.race.placement);
    this.els.raceLap.textContent = `LAP ${state.race.lap} / ${state.race.totalLaps}`;
    this.els.raceCheckpoint.textContent = `GATE ${state.race.checkpoint + 1}`;
    this.els.raceTime.textContent = this.formatTime(state.race.elapsed);
    const count = Math.ceil(state.race.countdown);
    if (count > 0 && this.snapshot?.countdown !== count) this.showCountdown(String(count));
  }

  private updateRadar(state: WorldState, player: ShipState): void {
    const ranges = [800, 2000, 5000];
    const furthestEntity = Math.max(
      0,
      ...state.ships.filter((ship) => ship.id !== player.id).map((ship) => Math.hypot(ship.position.x - player.position.x, ship.position.z - player.position.z)),
      ...state.islands.map((island) => Math.hypot(island.position.x - player.position.x, island.position.z - player.position.z)),
    );
    const range = ranges.find((candidate) => furthestEntity <= candidate) ?? 5000;
    this.els.radarRange.textContent = range >= 1000 ? `${range / 1000} km` : `${range} m`;
    const scale = 42 / range;

    const islandMarkup = state.islands.slice(0, 12).map((island) => {
      const x = (island.position.x - player.position.x) * scale;
      const y = (island.position.z - player.position.z) * scale;
      if (Math.hypot(x, y) > 44) return '';
      const radius = Math.min(8, Math.max(2, island.radius * scale));
      return `<circle class="chart-island${island.discovered ? ' is-known' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}"/>`;
    }).join('');
    const shipMarkup = state.ships.filter((ship) => ship.id !== player.id).slice(0, 8).map((ship) => {
      const x = (ship.position.x - player.position.x) * scale;
      const y = (ship.position.z - player.position.z) * scale;
      if (Math.hypot(x, y) > 44) return '';
      const relation = ship.surrendered ? 'neutral' : ship.targetId === player.id || state.mode === 'combat' ? 'hostile' : 'unknown';
      return `<path class="chart-ship chart-ship--${relation}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${this.normalizedDegrees(ship.heading).toFixed(1)})" d="M0-4L3 3L0 2L-3 3Z"/>`;
    }).join('');
    this.els.radarIslands.innerHTML = islandMarkup;
    this.els.radarShips.innerHTML = shipMarkup;
    this.els.radarPlayer.style.transform = `rotate(${this.normalizedDegrees(player.heading)}deg)`;
  }

  private observeState(state: WorldState, player: ShipState): void {
    const hull = this.integrity(player.damage.hull);
    const next: HudSnapshot = {
      mode: state.mode,
      weather: state.weather,
      objective: state.objective,
      hull,
      targetId: player.targetId,
      repairing: player.repairing,
      countdown: Math.ceil(state.race.countdown),
      raceActive: state.race.active,
    };
    const previous = this.snapshot;
    this.snapshot = next;
    if (!previous) return;

    if (next.weather === 'storm' && previous.weather !== 'storm') this.callout('NAVIGATOR', 'Storm wall ahead—hold the course!', 'danger');
    if (next.hull < 30 && previous.hull >= 30) this.callout('SHIPWRIGHT', 'Hull is critical! Give me a repair crew!', 'danger');
    if (next.targetId && next.targetId !== previous.targetId) {
      const target = state.ships.find((ship) => ship.id === next.targetId);
      this.callout('LOOKOUT', `${target?.name ?? 'Target'} in cannon range!`, 'danger');
    }
    if (next.repairing && !previous.repairing) this.callout('SHIPWRIGHT', 'Tools out! Keep us steady!', 'info');
    if (!next.repairing && previous.repairing) this.callout('SHIPWRIGHT', 'Patch is holding, Captain!', 'success');
    if (next.raceActive && !previous.raceActive) this.callout('HELMSMAN', 'Four ships. Three laps. One winner.', 'race');
    if (next.objective !== previous.objective && next.objective) this.callout('NAVIGATOR', next.objective, 'info');
  }

  private nearestOpponent(state: WorldState, player: ShipState): ShipState | undefined {
    let nearest: ShipState | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const ship of state.ships) {
      if (ship.id === player.id || ship.surrendered) continue;
      const distance = Math.hypot(ship.position.x - player.position.x, ship.position.z - player.position.z);
      if (distance < nearestDistance) {
        nearest = ship;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private setMeter(key: 'hull' | 'sails' | 'crew', value: number): void {
    this.els[`${key}Bar`].style.width = `${value}%`;
    this.els[`${key}Value`].textContent = String(Math.round(value));
    const row = this.els[`${key}Bar`].closest<HTMLElement>('.vital-row');
    if (row) row.dataset.condition = value < 30 ? 'critical' : value < 60 ? 'damaged' : 'good';
  }

  private setWeapon(key: 'port' | 'starboard' | 'bow', cooldown: number): void {
    const ready = cooldown <= 0.001;
    const box = this.els[`weapon${this.capitalize(key)}`];
    box.dataset.ready = String(ready);
    this.els[`weapon${this.capitalize(key)}State`].textContent = ready ? 'READY' : `${cooldown.toFixed(1)}s`;
    this.els[`weapon${this.capitalize(key)}Bar`].style.width = ready ? '100%' : `${Math.max(4, 100 - Math.min(100, cooldown * 28))}%`;
  }

  private presentNextCallout(): void {
    const next = this.calloutQueue.shift();
    if (!next) {
      this.calloutTimer = undefined;
      return;
    }
    this.els.calloutSpeaker.textContent = next.speaker;
    this.els.calloutMessage.textContent = next.message;
    this.els.callout.dataset.tone = next.tone;
    this.els.callout.hidden = false;
    this.els.callout.classList.remove('is-leaving');
    this.restartAnimation(this.els.callout, 'is-speaking');
    this.calloutTimer = window.setTimeout(() => {
      this.els.callout.classList.add('is-leaving');
      this.calloutTimer = window.setTimeout(() => {
        this.els.callout.hidden = true;
        this.els.callout.classList.remove('is-speaking', 'is-leaving');
        this.calloutTimer = undefined;
        this.presentNextCallout();
      }, 220);
    }, 2800);
  }

  private flashDamage(severity: number, section?: ShipSide): void {
    this.els.damageFlash.dataset.side = section ?? 'all';
    this.els.damageFlash.style.setProperty('--damage-alpha', String(0.18 + Math.min(1, Math.max(0, severity)) * 0.38));
    this.restartAnimation(this.els.damageFlash, 'is-active');
    if (severity > 0.7) this.callout('CREW', 'Brace! Heavy impact!', 'danger');
  }

  private flashBanner(title: string, subtitle: string, tone: string): void {
    this.els.eventTitle.textContent = title;
    this.els.eventSubtitle.textContent = subtitle;
    this.els.eventBanner.dataset.tone = tone;
    this.els.eventBanner.hidden = false;
    this.restartAnimation(this.els.eventBanner, 'is-active');
    window.setTimeout(() => { this.els.eventBanner.hidden = true; }, 2500);
  }

  private showCountdown(text: string): void {
    this.els.countdown.textContent = text;
    this.els.countdown.hidden = false;
    if (this.countdownTimer) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = undefined;
    }
    if (this.captureMode) {
      this.els.countdown.classList.remove('is-active');
      return;
    }
    this.restartAnimation(this.els.countdown, 'is-active');
    this.countdownTimer = window.setTimeout(() => {
      this.els.countdown.hidden = true;
      this.countdownTimer = undefined;
    }, 880);
  }

  private restartAnimation(element: HTMLElement, className: string): void {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  private normalizedDegrees(radiansOrDegrees: number): number {
    const degrees = Math.abs(radiansOrDegrees) <= Math.PI * 2 + 0.001 ? radiansOrDegrees * 180 / Math.PI : radiansOrDegrees;
    return (degrees % 360 + 360) % 360;
  }

  private normalizedLevel(value: number): number {
    return Math.min(100, Math.max(0, value <= 1.001 ? value * 100 : value));
  }

  private integrity(damage: number): number {
    const normalizedDamage = damage <= 1.001 ? damage * 100 : damage;
    return Math.min(100, Math.max(0, 100 - normalizedDamage));
  }

  private compactNumber(value: number): string {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace('.0', '')}B`;
    if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.0', '')}M`;
    if (absolute >= 1_000) return `${(value / 1_000).toFixed(1).replace('.0', '')}K`;
    return Math.round(value).toLocaleString('en-US');
  }

  private ordinal(value: number): string {
    const integer = Math.max(1, Math.round(value));
    const suffix = integer % 10 === 1 && integer % 100 !== 11 ? 'ST'
      : integer % 10 === 2 && integer % 100 !== 12 ? 'ND'
        : integer % 10 === 3 && integer % 100 !== 13 ? 'RD' : 'TH';
    return `${integer}${suffix}`;
  }

  private formatTime(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
  }
}
