import type {
  CrewPreset,
  DebugScene,
  InputAction,
  ShipKind,
  ShipSide,
  ShipState,
  WorldState,
} from "../core/contracts";
import { hasSketchfabShip } from "../content/sketchfabShips";
import { CREW_PRESETS } from "../content/voyages";
import { getShipCaptain } from "../content";
import {
  DEFAULT_KEY_BINDINGS,
  CONTROL_SETTINGS_KEY,
  keyLabel,
  loadControlSettings,
  type AimState,
  type ControlSettings,
} from "../input/controls";
import { VoyagePanel, voyageStageLabel, type VoyageAction } from "./VoyagePanel";
import { aimTargetSolution } from "../render/camera/AimGuide";
import { areFactionsHostile } from "../simulation/factions";
import { polarCrewSheltered } from "../simulation/specials";
import type { PresentationEvent } from "./presentation";

export type { PresentationEvent } from "./presentation";

export interface HudOptions {
  /** Bypasses the launch poster for deterministic capture and test harnesses. */
  captureMode?: boolean;
  /** Alias for captureMode when an embedding runtime already owns ship selection. */
  skipIntro?: boolean;
  initialShip?: ShipKind;
  onPreviewShip?: (ship: ShipKind) => void | Promise<void>;
  onVoyageAction?: (action: VoyageAction) => void | Promise<void>;
  onSettingsChange?: (settings: ControlSettings) => void;
  onAimChange?: (side?: "port" | "starboard") => void;
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
  mode: WorldState["mode"];
  weather: WorldState["weather"];
  objective: string;
  hull: number;
  targetId?: string;
  repairing: boolean;
  countdown: number;
  raceActive: boolean;
  targetHull: number;
  targetSurrendered: boolean;
  targetOpening: boolean;
  targetWeakPoint: string;
}

interface Callout {
  speaker: string;
  message: string;
  tone: "info" | "danger" | "success" | "race";
}

interface VoyageChapter {
  scene: DebugScene;
  label: string;
  note: string;
}

interface TargetReadout {
  intent: string;
  opening: boolean;
  weakPoint: string;
  status: "strong" | "damaged" | "critical" | "surrendered";
}

const VOYAGE_CHAPTERS: readonly VoyageChapter[] = [
  { scene: "calm-sailing", label: "Open Sea", note: "Free sail" },
  { scene: "sunny-broadside", label: "Naval Clash", note: "Broadside battle" },
  { scene: "race-start", label: "Pirate Cup", note: "Three-lap race" },
  { scene: "storm-sailing", label: "Squall", note: "Storm run" },
  { scene: "island-discovery", label: "Land Ho", note: "Island voyage" },
  { scene: "night-encounter", label: "Night Hunt", note: "Dark-water duel" },
] as const;

const ALL_SHIP_CHOICES: readonly ShipChoice[] = [
  {
    kind: "thousand-sunny",
    name: "Thousand Sunny",
    epithet: "The Sun Lion",
    role: "All-round adventure ship",
    special: "Coup de Burst",
    speed: 92,
    power: 84,
    turn: 78,
    hull: 74,
  },
  {
    kind: "going-merry",
    name: "Going Merry",
    epithet: "The Brave Little Ram",
    role: "Agile morale runner",
    special: "Miracle Tack",
    speed: 76,
    power: 48,
    turn: 96,
    hull: 46,
  },
  {
    kind: "moby-dick",
    name: "Moby Dick",
    epithet: "The White Colossus",
    role: "Heavy broadside fortress",
    special: "Seaquake Salvo",
    speed: 42,
    power: 100,
    turn: 34,
    hull: 100,
  },
  {
    kind: "red-force",
    name: "Red Force",
    epithet: "The Scarlet Dragon",
    role: "Precision interceptor",
    special: "Emperor's Glare",
    speed: 82,
    power: 88,
    turn: 76,
    hull: 80,
  },
  {
    kind: "oro-jackson",
    name: "Oro Jackson",
    epithet: "The Golden Legend",
    role: "Elite treasure hunter",
    special: "Conqueror Wake",
    speed: 86,
    power: 92,
    turn: 72,
    hull: 88,
  },
  {
    kind: "polar-tang",
    name: "Polar Tang",
    epithet: "The Yellow Submersible",
    role: "Technical ambusher",
    special: "Room Dive",
    speed: 88,
    power: 70,
    turn: 90,
    hull: 66,
  },
  {
    kind: "queen-mama-chanter",
    name: "Queen Mama Chanter",
    epithet: "The Singing Dreadnought",
    role: "Area-control flagship",
    special: "Soul Storm",
    speed: 46,
    power: 96,
    turn: 38,
    hull: 98,
  },
  {
    kind: "baratie",
    name: "Baratie",
    epithet: "The Fighting Restaurant",
    role: "Resilient support vessel",
    special: "Banquet Barrage",
    speed: 52,
    power: 72,
    turn: 54,
    hull: 92,
  },
  {
    kind: "navy-galleon",
    name: "Navy Galleon",
    epithet: "The Iron Pursuer",
    role: "Disciplined gun platform",
    special: "Justice Volley",
    speed: 64,
    power: 82,
    turn: 58,
    hull: 86,
  },
] as const;

const SHIPS = ALL_SHIP_CHOICES.filter(ship => hasSketchfabShip(ship.kind));

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
const KNOTS_PER_METRE_PER_SECOND = 1.94384;
const SPECIAL_PHASE_LABELS = { windup: "CHARGING", active: "ACTIVE", recovery: "RECOVERY" } as const;

function specialPhaseText(ship: ShipState): string | undefined {
  const phase = ship.specialPhase;
  if (!phase) return undefined;
  if (ship.kind === "polar-tang" && phase.phase === "recovery" && phase.elapsed >= phase.duration)
    return "SURFACING";
  return `${SPECIAL_PHASE_LABELS[phase.phase]} ${Math.max(0, phase.duration - phase.elapsed).toFixed(1)}s`;
}

function batteryBlockLabel(ship: ShipState): "SUBMERGED" | "SURFACING" | undefined {
  if (ship.kind !== "polar-tang") return undefined;
  if (ship.specialPhase?.phase === "active") return "SUBMERGED";
  if (ship.specialPhase?.phase === "recovery") return "SURFACING";
  return undefined;
}

export class Hud {
  readonly element: HTMLDivElement;

  private selectedIndex: number;
  private introOpen: boolean;
  private readonly captureMode: boolean;
  private drawerOpen = false;
  private crewMenuOpen = false;
  private readonly voyagePanel: VoyagePanel;
  private readonly controlSettings = loadControlSettings();
  private remapping?: InputAction;
  private objectiveChangedAt = 0;
  private lastObjective = "";
  private lastCrewPreset?: CrewPreset;
  private practiceLocked = false;
  private snapshot?: HudSnapshot;
  private calloutQueue: Callout[] = [];
  private calloutTimer?: number;
  private countdownTimer?: number;
  private hitTimer?: number;
  private volleyTimer?: number;
  private currentPlayerId?: string;
  private currentTarget?: ShipState;
  private currentTargetReadout?: TargetReadout;
  private hitCombo = 0;
  private lastHitAt = 0;
  private lastImpactAt = 0;
  private lastImpactTarget?: string;
  private lastImpactSection?: ShipSide;
  private lastDamageAt = 0;
  private readonly els: Record<string, HTMLElement>;
  private readonly onKeyDown = (event: KeyboardEvent): void =>
    this.handleKeyDown(event);
  private readonly onPointerDown = (): void => {
    void this.options.onUserGesture?.();
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly options: HudOptions = {},
  ) {
    this.selectedIndex = Math.max(
      0,
      SHIPS.findIndex(
        (ship) => ship.kind === (options.initialShip ?? "thousand-sunny"),
      ),
    );
    this.captureMode = options.captureMode === true || Hud.isCaptureMode();
    this.introOpen = !this.captureMode && options.skipIntro !== true;
    this.element = document.createElement("div");
    this.element.className = "cruise-ui";
    this.element.dataset.capture = String(this.captureMode);
    this.element.style.setProperty(
      "--subtitle-scale",
      String(this.controlSettings.subtitleScale),
    );
    this.element.innerHTML = this.template();
    this.host.append(this.element);

    this.els = this.collectElements();
    this.voyagePanel = new VoyagePanel(
      this.element,
      options.onVoyageAction,
      (blocked) =>
        this.requestPause(blocked || this.drawerOpen || this.introOpen),
      () => this.showShipSelect(),
    );
    this.bindControls();
    this.applySettings(false);
    this.selectShip(this.selectedIndex, false);
    this.setIntroOpen(this.introOpen);
    window.addEventListener("keydown", this.onKeyDown);
    this.element.addEventListener("pointerdown", this.onPointerDown, {
      passive: true,
    });
  }

  static isCaptureMode(search = window.location.search): boolean {
    const params = new URLSearchParams(search);
    return (
      params.get("capture") === "1" ||
      params.get("capture") === "true" ||
      params.get("ui") === "capture" ||
      document.documentElement.dataset.capture === "true"
    );
  }

  get selectedShip(): ShipKind {
    return SHIPS[this.selectedIndex].kind;
  }

  get isBlockingInput(): boolean {
    return this.introOpen || this.drawerOpen || this.voyagePanel.isOpen || this.crewMenuOpen;
  }

  get settings(): Readonly<ControlSettings> {
    return this.controlSettings;
  }

  togglePauseMenu(): void {
    if (this.introOpen) return;
    if (this.voyagePanel.isOpen) this.voyagePanel.close();
    else this.toggleDrawer();
  }

  showVoyage(): void {
    this.setDrawerOpen(false);
    this.voyagePanel.show();
  }

  get isIntroOpen(): boolean {
    return this.introOpen;
  }

  update(state: WorldState, _deltaSeconds = 0): void {
    this.voyagePanel.update(state);
    const practiceLocked = Boolean(
      state.voyage &&
        ["route", "encounter", "reward"].includes(state.voyage.phase),
    );
    if (practiceLocked !== this.practiceLocked) {
      this.practiceLocked = practiceLocked;
      this.element
        .querySelectorAll<HTMLButtonElement>("[data-chapter]")
        .forEach((button) => {
          button.disabled = practiceLocked;
          button.title = practiceLocked
            ? "Finish or extract your voyage before entering practice."
            : "";
        });
      this.els.practiceStatus.textContent = practiceLocked
        ? "Finish or extract your voyage before entering practice."
        : "Practice without voyage rewards";
    }
    const recoveryNotice = this.host.dataset.saveRecoveryReason ?? (this.host.dataset.saveRecovery === "preserved"
      ? "Your previous voyage could not be restored. Its original save is preserved on this device."
      : this.host.dataset.saveRecovery === "protected"
        ? "Your previous voyage could not be restored. Its original save is protected; this new session cannot be saved."
        : "");
    this.els.saveStatus.hidden = !recoveryNotice && this.host.dataset.save !== "unavailable";
    this.els.saveStatus.textContent = recoveryNotice || "Progress cannot be saved in this browser.";
    this.els.launchRecovery.hidden = !recoveryNotice;
    this.els.launchRecovery.textContent = recoveryNotice;
    this.updateWeather(state);
    this.currentPlayerId = state.playerId;
    const player = state.ships.find((ship) => ship.id === state.playerId);
    if (!player) {
      this.els.shipName.textContent = "Awaiting crew…";
      this.els.hud.setAttribute("data-active", "false");
      this.updateRace(state);
      this.els.target.hidden = true;
      this.els.threatCompass.hidden = true;
      return;
    }

    this.els.hud.setAttribute("data-active", "true");
    this.updateNavigation(state, player);
    this.updateShipStatus(state, player);
    this.updateWeapons(player);
    this.updateVoyageStatus(state, player);
    this.updateTarget(state, player);
    this.updateThreats(state, player);
    this.updateRace(state);
    this.updateRadar(state, player);
    this.observeState(state, player);
  }

  push(event: PresentationEvent): void {
    switch (event.type) {
      case "impact": {
        if (event.material === "water") break;
        const incoming =
          event.incoming ??
          (!event.targetId || event.targetId === this.currentPlayerId);
        if (incoming) this.flashDamage(event.severity ?? 0.5, event.section);
        else if (event.targetId) {
          this.registerHit(
            event.targetId,
            event.severity ?? 0.5,
            event.section,
            {
              critical: event.critical,
              disabled: event.disabled,
              weakPoint: event.weakPoint,
              combo: event.combo,
            },
          );
        }
        this.lastImpactAt = performance.now();
        this.lastImpactTarget = event.targetId;
        this.lastImpactSection = event.section;
        break;
      }
      case "damage": {
        const pairedImpact =
          performance.now() - this.lastImpactAt < 80 &&
          event.targetId === this.lastImpactTarget &&
          event.section === this.lastImpactSection;
        if (pairedImpact) break;
        const incoming =
          event.incoming ??
          (!event.targetId || event.targetId === this.currentPlayerId);
        if (incoming) this.flashDamage(event.severity ?? 0.5, event.section);
        else if (event.targetId) {
          this.registerHit(
            event.targetId,
            event.severity ?? 0.5,
            event.section,
            {
              critical: event.critical,
              disabled: event.disabled,
              weakPoint: event.weakPoint,
              combo: event.combo,
            },
          );
        }
        break;
      }
      case "victory":
        this.flashBanner(
          event.title ?? "VICTORY!",
          event.subtitle ?? "The sea remembers your name",
          "victory",
        );
        if (event.title?.includes("DISABLED"))
          this.callout(
            "LOOKOUT",
            "Target disabled! Their colors are coming down!",
            "success",
          );
        else this.callout("CREW", "We did it! Raise the colors!", "success");
        break;
      case "defeat":
        this.flashBanner(
          event.title ?? "SHIP DISABLED",
          event.subtitle ?? "The voyage is not over",
          "defeat",
        );
        if (event.title?.includes("DISABLED"))
          this.callout(
            "SHIPWRIGHT",
            "We are disabled! All hands, save the ship!",
            "danger",
          );
        break;
      case "discovery":
        this.flashBanner("LAND HO!", event.title, "discovery");
        this.callout(
          "LOOKOUT",
          event.subtitle ?? `${event.title}, dead ahead!`,
          "success",
        );
        break;
      case "crew-callout":
        this.callout(
          event.speaker ?? "CREW",
          event.message,
          event.tone ?? "info",
        );
        break;
      case "race-countdown":
        this.showCountdown(event.count > 0 ? String(event.count) : "GO!");
        break;
      case "race-start":
        this.showCountdown("GO!");
        this.callout("HELMSMAN", "Full sail—leave them in our wake!", "race");
        break;
      case "checkpoint":
        this.flashBanner(
          "CHECKPOINT",
          event.total ? `${event.index ?? 0} / ${event.total}` : "Clean line!",
          "checkpoint",
        );
        break;
      case "target-acquired":
        this.callout(
          "LOOKOUT",
          `${event.name ?? "Hostile ship"} sighted!`,
          "danger",
        );
        if (event.opening)
          this.showTargetOpening(event.weakPoint ?? "EXPOSED HULL");
        break;
      case "target-status":
        if (event.intent && !["windup", "active", "recovery"].includes(this.els.target.dataset.phase ?? ""))
          this.els.targetIntent.textContent = event.intent.toUpperCase();
        if (event.opening)
          this.showTargetOpening(event.weakPoint ?? "EXPOSED HULL");
        if (event.status === "critical")
          this.callout(
            "GUNNER",
            `${event.name ?? "Target"} is listing—finish it!`,
            "success",
          );
        if (event.status === "disabled")
          this.callout(
            "LOOKOUT",
            `${event.name ?? "Target"} disabled!`,
            "success",
          );
        if (event.status === "surrendered")
          this.callout(
            "LOOKOUT",
            "Their colors are down—they surrender!",
            "success",
          );
        break;
      case "reload":
        this.pulseWeapon(event.side, event.phase === "ready");
        if (event.phase === "ready")
          this.showVolleyStatus(event.side, "RELOADED", "ready");
        break;
      case "combo":
        this.registerHit("event-target", event.critical ? 1 : 0.55, undefined, {
          critical: event.critical,
          weakPoint: event.weakPoint,
          combo: event.count,
        });
        break;
      case "threat":
        if (event.level === "incoming") this.pulseThreats();
        break;
      case "repair":
        if (event.phase === "start")
          this.callout("SHIPWRIGHT", "Damage crew, move!", "info");
        if (event.phase === "complete")
          this.callout(
            "SHIPWRIGHT",
            "She’ll hold! Back to stations!",
            "success",
          );
        break;
      case "special":
        if (event.phase === "ready")
          this.callout(
            "CAPTAIN",
            `${event.name ?? "Special"} is ready!`,
            "success",
          );
        if (event.phase === "charge")
          this.flashBanner("SPECIAL", event.name ?? "Charging!", "special");
        break;
      case "cannon-fired":
        if (event.shipId === this.currentPlayerId) {
          this.showVolleyStatus(event.side, "FIRE!", "fire");
          if (event.side) this.pulseWeapon(event.side, false);
        }
        break;
      case "thunder":
        break;
    }
  }

  callout(
    speaker: string,
    message: string,
    tone: Callout["tone"] = "info",
  ): void {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    const last = this.calloutQueue.at(-1);
    if (last?.message === cleanMessage) return;
    this.calloutQueue.push({
      speaker: speaker.toUpperCase(),
      message: cleanMessage,
      tone,
    });
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
    this.els.menuButton.setAttribute(
      "aria-label",
      paused ? "Resume voyage" : "Pause and open help",
    );
    if (openDrawer) this.setDrawerOpen(paused);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    if (this.calloutTimer) window.clearTimeout(this.calloutTimer);
    if (this.countdownTimer) window.clearTimeout(this.countdownTimer);
    if (this.hitTimer) window.clearTimeout(this.hitTimer);
    if (this.volleyTimer) window.clearTimeout(this.volleyTimer);
    this.element.remove();
  }

  private template(): string {
    const shipCards = SHIPS.map((ship, index) =>
      this.shipCard(ship, index),
    ).join("");
    return `
      <section class="launch-poster" data-ui="intro" aria-label="Choose your ship">
        <div class="launch-sun" aria-hidden="true"></div>
        <div class="launch-copy">
          <p class="eyebrow">DAWN HARBOR · THE GRAND LINE</p>
          <h1><span>WE ARE ON</span><strong>THE CRUISE</strong></h1>
          <p class="launch-deck">A ship. A crew. An uncharted horizon.</p>
        </div>
        <div class="ship-selector">
          <div class="selector-heading">
            <span class="poster-number">SHIP No. <b data-ui="ship-number">01</b></span>
            <h2>Your vessel.</h2>
            <span class="selector-hint">← → SELECT · ENTER CONTINUE</span>
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
            ${this.statRow("Speed", "speed")}
            ${this.statRow("Power", "power")}
            ${this.statRow("Turn", "turn")}
            ${this.statRow("Hull", "hull")}
          </div>
          <button class="launch-button" type="button" data-action="launch">
            <span>PLAN YOUR VOYAGE</span><small>Enter</small>
          </button>
          <p class="launch-recovery" data-ui="launch-recovery" role="status" hidden></p>
          <p class="launch-status" data-ui="launch-status" role="status">${SHIPS.length} vessels. Three builds. Your next story.</p>
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

        <p class="save-status" data-ui="save-status" role="status" hidden>Progress cannot be saved in this browser.</p>
        <div class="hud-top-right">
          <section class="wanted-tab" aria-label="Bounty and treasure">
            <div><small>WANTED</small><strong data-ui="bounty">฿ 0</strong></div>
            <span><i aria-hidden="true">◆</i><b data-ui="treasure">0</b></span>
          </section>
          <button class="menu-button" data-ui="menu-button" data-action="menu" type="button" aria-label="Pause and open help"><i></i><i></i><i></i></button>
        </div>

        <section class="target-tag" data-ui="target" aria-label="Enemy target" hidden>
          <span class="target-eye" aria-hidden="true"></span>
          <div><small>TARGET · <b data-ui="target-distance">0 m</b></small><strong data-ui="target-name">Enemy ship</strong><span class="target-captain">CAPT. <b data-ui="target-captain">UNKNOWN</b></span></div>
          <div class="target-hull"><i data-ui="target-hull"></i></div>
          <em data-ui="target-intent">MANEUVERING</em>
          <div class="target-opening" data-ui="target-opening" hidden><span>FIRE WINDOW</span><b data-ui="target-weak">PORT HULL</b></div>
        </section>

        <div class="threat-compass" data-ui="threat-compass" aria-hidden="true" hidden>
          <i class="threat-pip" data-ui="threat-0"><b>!</b></i>
          <i class="threat-pip" data-ui="threat-1"><b>!</b></i>
          <i class="threat-pip" data-ui="threat-2"><b>!</b></i>
          <i class="threat-pip" data-ui="threat-3"><b>!</b></i>
        </div>

        <section class="aim-readout" data-ui="aim" aria-label="Broadside firing solution" hidden><span data-ui="aim-side">PORT BATTERY</span><strong data-ui="aim-solution">ALIGN THE BROADSIDE</strong><small data-ui="aim-range">SHOT RANGE</small><div class="aim-crosshair" aria-hidden="true"></div><p>Q / E FIRE · , / . LEAD · RELEASE Z / V TO HELM</p></section>
        <div class="voyage-status" data-ui="voyage-status"><button type="button" data-action="voyage"><span data-ui="voyage-label">CAPTAIN’S CHART</span><kbd>J</kbd></button><small data-ui="voyage-progress"></small></div>
        <button type="button" class="collect-rewards" data-ui="collect" data-action="collect" hidden><span>ENCOUNTER SECURED</span><strong>COLLECT REWARDS →</strong><small>Resolve surrendered vessels before leaving.</small></button>
        <div class="crew-station-bar" aria-label="Crew allocation"><button type="button" data-action="crew-cycle" popovertarget="crew-orders-popover"><span data-ui="crew-preset">BALANCED CREW</span><kbd>T</kbd></button><small data-ui="crew-stations">3 HELM · 3 GUNS · 2 REPAIR · 2 SPECIAL</small></div>
        <div class="crew-quick-orders" id="crew-orders-popover" popover data-ui="crew-orders" aria-label="Assign crew stations"><strong>CREW ORDERS</strong><p>Moving hands off the guns slows the remaining reload.</p>${Object.entries(CREW_PRESETS).map(([preset,c])=>`<button type="button" data-quick-crew="${preset}" aria-pressed="false"><b>${preset.toUpperCase()}</b><span>${c.helm} helm · ${c.guns} guns · ${c.repair} repair · ${c.special} special</span><em>${({balanced:'Even handling, reload and repairs',gunnery:'Faster reload; fewer hands on repairs',sailing:'Faster sails and sharper turns; slower guns',repair:'Automatic repairs; slowest gun crews',special:'Faster special charge; light repair crew'} as Record<string,string>)[preset]}</em></button>`).join('')}</div>
        <div class="resolution-prompt" data-ui="resolution" hidden><span data-ui="resolution-name">VESSEL DISABLED</span><button type="button" data-resolve="salvage">SALVAGE</button><button type="button" data-resolve="spare">SPARE</button><button type="button" data-resolve="sink">SCUTTLE</button></div>
        <section class="ship-vitals ink-panel" aria-label="Ship condition">
          <div class="ship-identity">
            <span class="ship-wheel" aria-hidden="true"></span>
            <div><small>YOUR SHIP</small><strong data-ui="ship-name">At the helm</strong></div>
          </div>
          ${this.meter("HULL", "hull", "100")}
          ${this.meter("SAILS", "sails", "100")}
          ${this.meter("CREW", "crew", "100")}
          <div class="brace-repair">
            <span data-ui="brace">BRACE READY</span><b data-ui="repair">CREW ON DECK</b>
          </div>
        </section>

        <section class="sailing-gauge" aria-label="Sailing speed">
          <div class="speed-readout"><strong data-ui="speed">00</strong><span>kn</span></div>
          <div class="throttle-track"><i data-ui="throttle"></i><span data-ui="sail-state">FULL SAIL</span></div>
          <output class="sail-setting" data-ui="sail-setting">SAIL 0%</output>
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
            ${this.weaponBox("PORT", "port", "Q")}
            ${this.weaponBox("BOW", "bow", "F")}
            ${this.weaponBox("STARBOARD", "starboard", "E")}
          </div>
          <div class="special-meter" data-ui="special-meter" data-phase="ready">
            <div><small>SPECIAL</small><strong data-ui="special-label">CHARGING</strong><kbd>C</kbd></div>
            <span><i data-ui="special"></i></span>
          </div>
        </section>

        <div class="touch-helm" aria-label="Touch sailing and combat controls"><div>${this.touchButton("throttle-up", "▲", "Raise sail")}${this.touchButton("throttle-down", "▼", "Lower sail")}${this.touchButton("steer-left", "◀", "Steer port")}${this.touchButton("steer-right", "▶", "Steer starboard")}</div><div>${this.touchButton("fire-port", "PORT", "Fire port broadside")}${this.touchButton("fire-starboard", "STBD", "Fire starboard broadside")}${this.touchButton("fire-bow", "BOW", "Fire bow weapon")}${this.touchButton("brace", "BRACE", "Brace")}${this.touchButton("special", "SPECIAL", "Special")}${this.touchButton("cycle-ammo", "AMMO", "Cycle ammo")}${this.touchButton("repair", "REPAIR", "Assign repairs")}${this.touchButton("hard-turn", "HARD", "Hard turn")}<button type="button" data-touch-aim="port" aria-label="Hold to aim port broadside">AIM L</button><button type="button" data-touch-aim="starboard" aria-label="Hold to aim starboard broadside">AIM R</button></div></div>
        <div class="helm-hint">W / S SAIL · A / D HELM · HOLD Z / V AIM · Q / E FIRE · J CHART</div>
        <div class="wrong-way" data-ui="wrong-way" hidden><small>TURN AROUND</small><strong>WRONG WAY!</strong></div>
        <div class="countdown-burst" data-ui="countdown" hidden>3</div>
        <div class="pause-stamp" data-ui="pause-stamp" hidden>VOYAGE PAUSED</div>
        <div class="hit-confirm" data-ui="hit-confirm" data-tone="hit" hidden>
          <small data-ui="hit-label">HULL HIT</small><strong data-ui="combo-count">2 HIT CHAIN</strong><span data-ui="hit-section">PORT SECTION</span>
        </div>
        <div class="volley-stamp" data-ui="volley-stamp" data-tone="fire" hidden>
          <small data-ui="volley-side">PORT BATTERY</small><strong data-ui="volley-label">FIRE!</strong>
        </div>

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
      <aside class="voyage-drawer" data-ui="drawer" aria-label="Pause and controls" aria-hidden="true" inert>
        <button class="drawer-close" data-action="close-drawer" type="button" aria-label="Close controls">×</button>
        <p class="eyebrow">CAPTAIN'S LOG</p>
        <h2>At ease, Captain.</h2>
        <p class="drawer-lede">Wind, waves, and firing angles win battles. Keep the enemy off your damaged side.</p>
        <button class="chart-open-button primary-button" type="button" data-action="voyage">OPEN THE CAPTAIN’S CHART →</button>
        <details class="scenario-details"><summary>FREE SAIL & PRACTICE</summary><section class="chapter-launcher" aria-label="Voyage chapters">
          <div class="chapter-heading"><b>FREE SAIL SCENARIOS</b><span data-ui="practice-status">Practice without voyage rewards</span></div>
          <div class="chapter-grid">${this.chapterButtons()}</div>
        </section></details>
        <div class="touch-control-help"><strong>AT THE TOUCH HELM</strong><p><b>▲ / ▼</b> Hold to raise or lower sail.<br><b>◀ / ▶</b> Hold to steer. HARD makes a sharper turn.<br><b>AIM L / AIM R</b> Hold to view that broadside, then tap PORT / STBD to fire.<br><b>AMMO</b> Cycles shots. BRACE reduces incoming damage.<br><b>REPAIR</b> Hold for repairs. Crew Orders assigns hands permanently.</p></div>
        <div class="control-map">
          ${this.controlRow("W / S", "Raise / lower sail")}
          ${this.controlRow("A / D", "Steer port / starboard")}
          ${this.controlRow("Shift", "Hard turn")}
          ${this.controlRow("Z / V", "Hold to aim port / starboard")}
          ${this.controlRow(", / .", "Adjust broadside lead")}
          ${this.controlRow("Q / E", "Fire port / starboard")}
          ${this.controlRow("F", "Fire bow weapon")}
          ${this.controlRow("X", "Cycle ammunition")}
          ${this.controlRow("Space", "Brace for impact")}
          ${this.controlRow("R", "Assign repair crew")}
          ${this.controlRow("C", "Crew special")}
          ${this.controlRow("1—6", "Camera views")}
          ${this.controlRow("M", "Mute / unmute")}
        </div>
        <details class="comfort-settings"><summary>CONTROLS & COMFORT</summary><label>Camera shake <input type="range" min="0" max="1" step="0.05" data-setting="cameraShake" value="${this.controlSettings.cameraShake}"></label><label>Target camera assist <input type="checkbox" data-setting="aimAssist" ${this.controlSettings.aimAssist ? "checked" : ""}></label><small>Framing assistance only. Your bearing and lead determine the shot.</small><label>Subtitle size <input type="range" min="0.85" max="1.5" step="0.05" data-setting="subtitleScale" value="${this.controlSettings.subtitleScale}"></label><div class="remap-grid">${(["throttle-up", "throttle-down", "steer-left", "steer-right", "fire-port", "fire-starboard", "fire-bow", "brace", "repair", "special", "cycle-ammo"] as InputAction[]).map((action) => `<button type="button" data-remap="${action}"><span>${action.replaceAll("-", " ")}</span><kbd>${this.bindingLabel(action)}</kbd></button>`).join("")}</div><p data-ui="remap-status">Select an action, then press its new key.</p><button type="button" class="quiet-button" data-action="reset-controls">RESET CONTROLS</button></details>
        <div class="drawer-tip"><b>SEA DOG'S TIP</b><span>Chain shot tears sails. Heavy shot loves a close broadside.</span></div>
        <button class="resume-button" data-action="resume" type="button">RETURN TO THE HELM</button>
        <p class="controller-hint">CONTROLLER · Left stick helm · Bumpers fire · Triggers aim · Start pause</p>
        <small class="drawer-footer">H or Esc · Open / close this log · <a href="/credits.html" target="_blank" rel="noopener">Artist credits</a></small>
      </aside>
    `;
  }

  private shipCard(ship: ShipChoice, index: number): string {
    return `
      <button class="ship-card" type="button" data-ship="${ship.kind}" data-index="${index}" aria-label="Select ${ship.name}" aria-pressed="false">
        <span class="ship-card-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="ship-silhouette ship-silhouette--${ship.kind}" aria-hidden="true">
          <img src="/assets/sketchfab/thumbnails/${ship.kind}.jpg" alt="" loading="lazy">
        </span>
        <strong>${ship.name}</strong><small>${ship.epithet}</small>
      </button>
    `;
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

  private touchButton(
    action: InputAction,
    label: string,
    description: string,
  ): string {
    if (action === "special") {
      return `<button type="button" data-touch="${action}" data-ui="special-button" data-phase="ready" aria-label="${description}" aria-describedby="touch-special-state"><span>${label}</span><small id="touch-special-state" data-ui="touch-special-state">READY</small></button>`;
    }
    return `<button type="button" data-touch="${action}" aria-label="${description}">${label}</button>`;
  }

  private controlRow(key: string, action: string): string {
    return `<div><kbd>${key}</kbd><span>${action}</span></div>`;
  }

  private chapterButtons(): string {
    return VOYAGE_CHAPTERS.map(
      (chapter, index) => `
      <button type="button" data-chapter="${chapter.scene}" aria-label="Start ${chapter.label}">
        <b>${String(index + 1).padStart(2, "0")}</b>
        <span><strong>${chapter.label}</strong><small>${chapter.note}</small></span>
      </button>
    `,
    ).join("");
  }

  private collectElements(): Record<string, HTMLElement> {
    const result: Record<string, HTMLElement> = {};
    this.element
      .querySelectorAll<HTMLElement>("[data-ui]")
      .forEach((element) => {
        const key = element.dataset.ui;
        if (key) result[this.camelCase(key)] = element;
      });
    return result;
  }

  private camelCase(value: string): string {
    return value.replace(/-([a-z])/g, (_match, letter: string) =>
      letter.toUpperCase(),
    );
  }

  private bindControls(): void {
    this.element
      .querySelectorAll<HTMLButtonElement>("[data-touch-aim]")
      .forEach((button) => {
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          this.options.onAimChange?.(
            button.dataset.touchAim as "port" | "starboard",
          );
        });
        const release = () => this.options.onAimChange?.(undefined);
        button.addEventListener("pointerup", release);
        button.addEventListener("pointercancel", release);
        button.addEventListener("lostpointercapture", release);
      });
    this.element
      .querySelector('[data-action="collect"]')
      ?.addEventListener("click", () => {
        void this.options.onVoyageAction?.({ type: "collect" });
      });
    this.element
      .querySelectorAll('[data-action="voyage"]')
      .forEach((button) =>
        button.addEventListener("click", () => this.showVoyage()),
      );
    this.element
      .querySelector('[data-action="crew-cycle"]')
      ?.addEventListener("click", () => { void this.options.onUserGesture?.(); });
    const crewPopover=this.els.crewOrders;
    crewPopover.addEventListener('beforetoggle',(event)=>{
      this.crewMenuOpen=(event as Event & {newState:string}).newState==='open';
      this.requestPause(this.crewMenuOpen || this.introOpen || this.drawerOpen || this.voyagePanel.isOpen);
    });
    this.element.querySelectorAll<HTMLButtonElement>('[data-quick-crew]').forEach(button=>button.addEventListener('click',async()=>{
      await this.options.onVoyageAction?.({type:'crew',preset:button.dataset.quickCrew as CrewPreset});
      crewPopover.hidePopover();
    }));
    this.element
      .querySelectorAll<HTMLButtonElement>("[data-touch]")
      .forEach((button) => {
        const action = button.dataset.touch as InputAction;
        button.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          this.options.onAction?.(action, true);
        });
        const release = () => this.options.onAction?.(action, false);
        button.addEventListener("pointerup", release);
        button.addEventListener("pointercancel", release);
        button.addEventListener("lostpointercapture", release);
      });
    this.element
      .querySelectorAll<HTMLButtonElement>("[data-resolve]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const id = this.els.resolution.dataset.shipId;
          if (id)
            void this.options.onVoyageAction?.({
              type: "resolve",
              shipId: id,
              resolution: button.dataset.resolve as
                | "salvage"
                | "spare"
                | "sink",
            });
        }),
      );
    this.element
      .querySelectorAll<HTMLInputElement>("[data-setting]")
      .forEach((input) =>
        input.addEventListener("input", () => {
          if (input.dataset.setting === "aimAssist")
            this.controlSettings.aimAssist = input.checked;
          else if (input.dataset.setting === "cameraShake")
            this.controlSettings.cameraShake = Number(input.value);
          else this.controlSettings.subtitleScale = Number(input.value);
          this.applySettings();
        }),
      );
    this.element
      .querySelectorAll<HTMLButtonElement>("[data-remap]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          this.remapping = button.dataset.remap as InputAction;
          this.els.remapStatus.textContent = `Press a new key for ${this.remapping.replaceAll("-", " ")}. Escape cancels.`;
        }),
      );
    this.element
      .querySelector('[data-action="reset-controls"]')
      ?.addEventListener("click", () => {
        this.controlSettings.keyBindings = { ...DEFAULT_KEY_BINDINGS };
        this.applySettings();
      });
    this.element
      .querySelector('[data-action="previous-ship"]')
      ?.addEventListener("click", () =>
        this.selectShip(this.selectedIndex - 1),
      );
    this.element
      .querySelector('[data-action="next-ship"]')
      ?.addEventListener("click", () =>
        this.selectShip(this.selectedIndex + 1),
      );
    this.element
      .querySelector('[data-action="launch"]')
      ?.addEventListener("click", () => {
        void this.launch();
      });
    this.element
      .querySelector('[data-action="menu"]')
      ?.addEventListener("click", () => this.toggleDrawer());
    this.element
      .querySelector('[data-action="close-drawer"]')
      ?.addEventListener("click", () => this.setDrawerOpen(false));
    this.element
      .querySelector('[data-action="resume"]')
      ?.addEventListener("click", () => this.resume());
    this.els.drawerScrim.addEventListener("click", () =>
      this.setDrawerOpen(false),
    );
    this.element
      .querySelectorAll<HTMLButtonElement>("[data-chapter]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const scene = button.dataset.chapter as DebugScene;
          void this.launchChapter(scene);
        });
      });
    this.element
      .querySelectorAll<HTMLElement>("[data-ship]")
      .forEach((card) => {
        card.addEventListener("click", () =>
          this.selectShip(Number(card.dataset.index)),
        );
      });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.remapping) {
      event.preventDefault();
      this.remapKey(event.code);
      return;
    }
    if(this.crewMenuOpen && event.code==='Escape')return;
    if (event.code === "Tab" && this.isBlockingInput) {
      this.trapFocus(event);
      return;
    }
    if (event.defaultPrevented || this.isTypingTarget(event.target)) return;
    if (this.introOpen) {
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        this.selectShip(this.selectedIndex - 1);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        this.selectShip(this.selectedIndex + 1);
      } else if (
        event.code === "Enter" &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest(
            "button, input, select, textarea, summary, a[href]",
          )
        )
      ) {
        event.preventDefault();
        void this.launch();
      }
      return;
    }

    if (event.repeat) return;
    if (event.code === "KeyH") {
      event.preventDefault();
      this.toggleDrawer();
    } else if (event.code === "Escape") {
      event.preventDefault();
      if (this.voyagePanel.isOpen) this.voyagePanel.close();
      else this.toggleDrawer();
    } else if (event.code === "KeyJ") {
      event.preventDefault();
      if (this.voyagePanel.isOpen) this.voyagePanel.close();
      else this.showVoyage();
    } else if (event.code === "KeyT" && !this.isBlockingInput) {
      event.preventDefault();
      this.cycleCrew();
    } else if (event.code === "KeyM") {
      event.preventDefault();
      this.options.onMuteToggle?.();
      this.callout("SYSTEM", "Audio toggled", "info");
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  private selectShip(index: number, announce = true): void {
    const length = SHIPS.length;
    this.selectedIndex = ((index % length) + length) % length;
    const selected = SHIPS[this.selectedIndex];
    this.els.shipNumber.textContent = String(this.selectedIndex + 1).padStart(
      2,
      "0",
    );
    this.els.selectedShipName.textContent = selected.name;
    this.els.shipEpithet.textContent = selected.epithet;
    this.els.shipRole.textContent = selected.role;
    this.els.shipSpecial.textContent = selected.special;
    (["speed", "power", "turn", "hull"] as const).forEach((stat) => {
      const value = selected[stat];
      this.els[`stat${this.capitalize(stat)}`].style.width = `${value}%`;
      this.els[`stat${this.capitalize(stat)}Value`].textContent = String(value);
    });

    const cards = [...this.element.querySelectorAll<HTMLElement>(".ship-card")];
    cards.forEach((card, cardIndex) => {
      const active = cardIndex === this.selectedIndex;
      card.classList.toggle("is-selected", active);
      card.setAttribute("aria-pressed", String(active));
      card.tabIndex = 0;
    });
    if (announce && this.introOpen) {
      const launch = this.element.querySelector<HTMLButtonElement>('[data-action="launch"]');
      if (launch) launch.disabled = true;
      this.els.launchStatus.textContent = `Loading ${selected.name}…`;
      Promise.resolve(this.options.onPreviewShip?.(selected.kind)).then(() => {
        if (this.selectedShip !== selected.kind) return;
        if (launch) launch.disabled = false;
        this.els.launchStatus.textContent = `${selected.name}: ${selected.special}. Ready to launch.`;
      }).catch(() => {
        if (this.selectedShip === selected.kind) this.els.launchStatus.textContent = `${selected.name} could not load. Select another ship or reload to retry.`;
      });
    }
  }

  private capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private async launch(): Promise<void> {
    if (!this.introOpen) return;
    const button = this.element.querySelector<HTMLButtonElement>(
      '[data-action="launch"]',
    );
    if (button?.disabled) return;
    void this.options.onUserGesture?.();
    if (button) button.disabled = true;
    this.els.launchStatus.textContent = "Cast off! The horizon is ours.";
    this.element.classList.add("is-launching");
    try {
      await this.options.onLaunch?.(this.selectedShip);
      this.setIntroOpen(false);
      this.voyagePanel.show();
    } catch (error) {
      this.element.classList.remove("is-launching");
      this.els.launchStatus.textContent =
        error instanceof Error
          ? error.message
          : "The tide pushed us back. Try again.";
      if (button) button.disabled = false;
    }
  }

  private setIntroOpen(open: boolean): void {
    this.introOpen = open;
    this.element.classList.toggle("has-intro", open);
    this.els.intro.hidden = !open;
    this.els.hud.setAttribute("aria-hidden", String(open));
    this.els.hud.inert = open;
    this.voyagePanel.setIntroHidden(open);
    this.requestPause(open || this.drawerOpen || this.voyagePanel.isOpen);
    const launchButton = this.element.querySelector<HTMLButtonElement>(
      '[data-action="launch"]',
    );
    if (launchButton) launchButton.disabled = false;
    if (!open) {
      this.element.classList.remove("is-launching");
      if (!this.captureMode)
        this.callout("LOOKOUT", "Clear water ahead, Captain!", "info");
    }
  }

  private toggleDrawer(): void {
    if (this.voyagePanel.isOpen) this.voyagePanel.close();
    this.setDrawerOpen(!this.drawerOpen);
  }

  private setDrawerOpen(open: boolean): void {
    this.drawerOpen = open;
    this.els.drawer.classList.toggle("is-open", open);
    this.els.drawer.setAttribute("aria-hidden", String(!open));
    this.els.drawer.inert = !open;
    this.els.drawerScrim.hidden = !open;
    this.element.classList.toggle("has-drawer", open);
    this.requestPause(open || this.introOpen || this.voyagePanel.isOpen);
    if (open)
      window.setTimeout(
        () =>
          this.element
            .querySelector<HTMLButtonElement>(".drawer-close")
            ?.focus(),
        0,
      );
  }

  private requestPause(paused: boolean): void {
    this.options.onPauseChange?.(paused);
    if (!this.options.onPauseChange) this.options.onAction?.("pause", paused);
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
      this.callout("NAVIGATOR", "That route is not charted yet.", "danger");
    }
  }

  setAim(
    aim: Readonly<AimState>,
    player?: ShipState,
    target?: ShipState,
  ): void {
    const aiming = Boolean(aim.side && player) && !this.isBlockingInput;
    this.els.aim.hidden = !aiming;
    this.els.hud.dataset.aiming = String(aiming);
    if (!aim.side || !player) return;
    const solution = aimTargetSolution(player, aim, target);
    const cooldown = aim.side === "port" ? player.weapons.portCooldown : player.weapons.starboardCooldown;
    const blocked = batteryBlockLabel(player);
    const fireKey = this.bindingLabel(aim.side === "port" ? "fire-port" : "fire-starboard");
    const fireLabel = window.matchMedia("(pointer: coarse)").matches
      ? `TAP ${aim.side === "port" ? "PORT" : "STBD"}`
      : `${fireKey} FIRE`;
    // The fixed screen crosshair was unrelated to either the target or a projectile. World markers replace it.
    const crosshair = this.els.aim.querySelector<HTMLElement>(".aim-crosshair");
    if (crosshair) crosshair.style.display = "none";
    const aimHint = this.els.aim.querySelector("p");
    if (aimHint) aimHint.textContent = `${fireKey} FIRE · , / . ADJUST LEAD · RELEASE Z / V TO HELM`;
    this.els.aimSide.textContent = `${aim.side.toUpperCase()} BATTERY · ${blocked ?? (cooldown > 0 ? `RELOAD ${cooldown.toFixed(1)}s` : fireLabel)}`;
    this.els.aimRange.textContent = `${player.weapons.ammo.toUpperCase()} · WATER IMPACT ≈${Math.round(solution.range)} m · ${solution.shot.flightTime.toFixed(1)}s FLIGHT`;
    this.els.aimSolution.textContent = solution.guidance;
    this.els.aim.dataset.valid = String(!blocked && solution.inLane && cooldown <= 0);
    this.els.aim.dataset.targetId = target?.id ?? "";
    this.els.aim.setAttribute("aria-label", `${aim.side} broadside.${blocked ? ` ${blocked}.` : ""} ${target ? `${target.name}, ${Math.round(solution.distance)} metres. ` : ""}${solution.guidance}. Estimated water impact ${Math.round(solution.range)} metres.`);
    // Keep the visible tag tied to exactly the ship marked in the world while aiming.
    this.els.target.hidden = !target;
    this.els.target.dataset.phase = target?.specialPhase?.phase ?? "none";
    if (target) {
      const sameTarget = this.currentTarget?.id === target.id;
      this.els.target.dataset.targetId = target.id;
      this.els.targetName.textContent = target.name;
      this.els.targetCaptain.textContent = getShipCaptain(target.kind).name;
      this.els.targetDistance.textContent = `${Math.round(solution.distance)} m`;
      const hull = this.integrity(target.damage.hull);
      this.els.targetHull.style.width = `${hull}%`;
      this.els.target.dataset.condition = hull < 30 ? "critical" : hull < 60 ? "damaged" : "strong";
      if (!sameTarget) {
        this.els.targetOpening.hidden = true;
        this.els.targetIntent.textContent = target.repairing ? "REPAIRING" : target.brace > 0.55 ? "BRACING" : (target.ai ?? "MANEUVERING").toUpperCase();
        this.els.target.dataset.intent = "tracking";
      }
      if (target.specialPhase && !target.surrendered)
        this.els.targetIntent.textContent = `SPECIAL ${specialPhaseText(target)}`;
    }
  }

  private updateVoyageStatus(state: WorldState, player: ShipState): void {
    const voyage = state.voyage;
    this.els.voyageLabel.textContent =
      !voyage || voyage.phase === "harbor"
        ? "CAPTAIN’S CHART"
        : voyage.result
          ? voyageStageLabel(voyage)
          : `VOYAGE · ${voyage.leg} / ${voyage.totalLegs}`;
    const encounter = voyage?.encounter;
    this.els.collect.hidden = !(
      voyage?.phase === "encounter" && encounter?.completed
    );
    this.els.voyageProgress.textContent =
      encounter && voyage?.phase === "encounter"
        ? `${encounter.title} · ${Math.min(100, Math.round((encounter.progress / Math.max(1, encounter.target)) * 100))}% · ${voyage.unbankedCoins} AT RISK · ${state.progression?.bankedCoins??0} BANKED`
        : voyage?.result
          ? `${voyage.result.coins} COINS BANKED · ${state.progression?.bankedCoins ?? 0} TOTAL BANKED`
        : voyage && voyage.phase !== "harbor"
          ? `${voyage.unbankedCoins} COINS AT RISK`
          : `${state.progression?.bankedCoins??0} BANKED · CONTRACTS & REFITS`;
    this.lastCrewPreset = player.crewPreset;
    for(const button of this.element.querySelectorAll<HTMLButtonElement>('[data-quick-crew]'))button.setAttribute('aria-pressed',String(button.dataset.quickCrew===player.crewPreset));
    this.els.crewPreset.textContent = `CREW ORDERS · ${(player.crewPreset ?? "balanced").toUpperCase()} ›`;
    const crew = player.crew;
    this.els.crewStations.textContent = crew
      ? `${crew.helm} HELM · ${crew.guns} GUNS · ${crew.repair} REPAIR · ${crew.special} SPECIAL`
      : "CREW AT STATIONS";
    const disabled = state.ships.find(
      (ship) =>
        ship.id !== player.id &&
        (ship.surrendered || ship.damage.hull >= 1) &&
        ship.finish?.state === "available" &&
        ship.finish.creditedTo === player.id &&
        Math.hypot(
          ship.position.x - player.position.x,
          ship.position.z - player.position.z,
        ) <= 240,
    );
    this.els.resolution.hidden = !disabled;
    if (disabled) {
      this.els.resolution.dataset.shipId = disabled.id;
      this.els.resolutionName.textContent = `${disabled.name} · COLORS DOWN`;
    }
  }

  private cycleCrew(): void {
    if (this.isBlockingInput) return;
    const presets: CrewPreset[] = [
      "balanced",
      "gunnery",
      "sailing",
      "repair",
      "special",
    ];
    const preset =
      presets[
        (presets.indexOf(this.lastCrewPreset ?? "balanced") + 1) %
          presets.length
      ];
    void this.options.onVoyageAction?.({ type: "crew", preset });
    this.callout(
      "FIRST MATE",
      `${preset.toUpperCase()} stations. Every hand counts.`,
      "info",
    );
  }

  private bindingLabel(action: InputAction): string {
    const code = Object.keys(this.controlSettings.keyBindings).find(
      (key) => this.controlSettings.keyBindings[key] === action,
    );
    return code ? keyLabel(code) : "—";
  }

  private applySettings(persist = true): void {
    this.element.style.setProperty(
      "--subtitle-scale",
      String(this.controlSettings.subtitleScale),
    );
    this.element.dataset.reducedMotion = String(
      this.controlSettings.cameraShake === 0,
    );
    const controls = this.element.querySelector(".control-map");
    if (controls)
      controls.innerHTML = [
        this.controlRow(
          `${this.bindingLabel("throttle-up")} / ${this.bindingLabel("throttle-down")}`,
          "Raise / lower sail",
        ),
        this.controlRow(
          `${this.bindingLabel("steer-left")} / ${this.bindingLabel("steer-right")}`,
          "Steer port / starboard",
        ),
        this.controlRow(this.bindingLabel("hard-turn"), "Hard turn"),
        this.controlRow("Z / V", "Hold to aim port / starboard"),
        this.controlRow(", / .", "Adjust broadside lead"),
        this.controlRow(
          `${this.bindingLabel("fire-port")} / ${this.bindingLabel("fire-starboard")}`,
          "Fire port / starboard",
        ),
        this.controlRow(this.bindingLabel("fire-bow"), "Fire bow weapon"),
        this.controlRow(this.bindingLabel("cycle-ammo"), "Cycle ammunition"),
        this.controlRow(this.bindingLabel("brace"), "Brace for impact"),
        this.controlRow(this.bindingLabel("repair"), "Assign repair crew"),
        this.controlRow(this.bindingLabel("special"), "Crew special"),
        this.controlRow("T / J", "Crew stations / voyage chart"),
        this.controlRow("1—6", "Camera views"),
        this.controlRow("M", "Mute / unmute"),
      ].join("");
    const hint = this.element.querySelector(".helm-hint");
    if (hint)
      hint.textContent = `${this.bindingLabel("throttle-up")} / ${this.bindingLabel("throttle-down")} SAIL · ${this.bindingLabel("steer-left")} / ${this.bindingLabel("steer-right")} HELM · HOLD Z / V AIM · ${this.bindingLabel("fire-port")} / ${this.bindingLabel("fire-starboard")} FIRE · J CHART`;
    this.element
      .querySelectorAll<HTMLButtonElement>("[data-remap]")
      .forEach((button) => {
        const key = button.querySelector("kbd");
        if (key)
          key.textContent = this.bindingLabel(
            button.dataset.remap as InputAction,
          );
      });
    for (const side of ["port", "starboard", "bow"] as const) {
      const key =
        this.els[`weapon${this.capitalize(side)}`]?.querySelector("kbd");
      if (key) key.textContent = this.bindingLabel(`fire-${side}`);
    }
    const ammoKey = this.element.querySelector(".ammo-strip kbd");
    if (ammoKey) ammoKey.textContent = this.bindingLabel("cycle-ammo");
    const specialKey = this.element.querySelector(".special-meter kbd");
    if (specialKey) specialKey.textContent = this.bindingLabel("special");
    if (persist) {
      try {
        localStorage.setItem(
          CONTROL_SETTINGS_KEY,
          JSON.stringify(this.controlSettings),
        );
        this.els.remapStatus.textContent = "Controls saved on this device.";
      } catch {
        this.els.remapStatus.textContent =
          "Settings applied. This browser could not save them.";
      }
      this.options.onSettingsChange?.(this.controlSettings);
    }
  }

  private remapKey(code: string): void {
    if (code === "Escape") {
      this.remapping = undefined;
      this.els.remapStatus.textContent = "Remapping cancelled.";
      return;
    }
    if (
      [
        "KeyZ",
        "KeyV",
        "KeyH",
        "KeyJ",
        "KeyT",
        "KeyM",
        "Comma",
        "Period",
        "Tab",
        "Enter",
      ].includes(code) ||
      /^Digit[1-6]$/.test(code) ||
      !/^(Key[A-Z]|Digit[0-9]|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(
        code,
      )
    ) {
      this.els.remapStatus.textContent =
        "That key is reserved for menus, aiming or cameras. Choose another key.";
      return;
    }
    const action = this.remapping;
    if (!action) return;
    const previous = Object.keys(this.controlSettings.keyBindings).find(
      (key) => this.controlSettings.keyBindings[key] === action,
    );
    const displaced = this.controlSettings.keyBindings[code];
    for (const key of Object.keys(this.controlSettings.keyBindings))
      if (this.controlSettings.keyBindings[key] === action)
        delete this.controlSettings.keyBindings[key];
    this.controlSettings.keyBindings[code] = action;
    if (displaced && displaced !== action && previous)
      this.controlSettings.keyBindings[previous] = displaced;
    this.remapping = undefined;
    this.applySettings();
  }

  private trapFocus(event: KeyboardEvent): void {
    const container = this.crewMenuOpen ? this.els.crewOrders : this.introOpen
      ? this.els.intro
      : this.voyagePanel.isOpen
        ? this.voyagePanel.element
        : this.els.drawer;
    const focusable = [
      ...container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, summary, [tabindex="0"]',
      ),
    ].filter((entry) => entry.getClientRects().length > 0);
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (
      index < 0 ||
      (!event.shiftKey && index === focusable.length - 1) ||
      (event.shiftKey && index === 0)
    ) {
      event.preventDefault();
      focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
    }
  }

  private updateWeather(state: WorldState): void {
    const weather =
      state.weather === "storm" || state.weather === "maelstrom"
        ? "storm"
        : state.weather === "fog" || state.weather === "night"
          ? state.weather
          : "none";
    this.els.weatherLayer.dataset.weather = weather;
    this.els.weatherLayer.hidden = weather === "none";
  }

  private updateNavigation(state: WorldState, player: ShipState): void {
    const heading = this.normalizedDegrees(player.heading);
    const cardinalIndex = Math.round(heading / 45) % 8;
    this.els.compassMain.textContent = CARDINALS[cardinalIndex];
    this.els.compassLeft.textContent = CARDINALS[(cardinalIndex + 7) % 8];
    this.els.compassRight.textContent = CARDINALS[(cardinalIndex + 1) % 8];
    this.els.heading.textContent = `${String(Math.round(heading)).padStart(3, "0")}°`;
    this.els.windArrow.style.transform = `rotate(${this.normalizedDegrees(state.windDirection) - heading}deg)`;
    const objective = state.objective || "Follow the horizon";
    if (objective !== this.lastObjective) {
      this.lastObjective = objective;
      this.objectiveChangedAt = performance.now();
    }
    this.els.objective
      .closest(".objective-slip")
      ?.classList.toggle(
        "is-quiet",
        performance.now() - this.objectiveChangedAt > 7000,
      );
    this.els.objective.textContent = objective;
    this.els.objective.title = objective;
    this.els.mode.textContent = state.mode.toUpperCase();
    this.els.weather.textContent = state.weather
      .replace("-", " ")
      .toUpperCase();
    this.els.bounty.textContent = `฿ ${this.compactNumber(state.bounty)}`;
    this.els.treasure.textContent = this.compactNumber(state.treasure);
  }

  private updateShipStatus(state: WorldState, player: ShipState): void {
    const hull = this.integrity(player.damage.hull);
    const sails = this.integrity(player.damage.sails);
    const crew = this.integrity(player.damage.crew);
    this.els.shipName.textContent = player.name;
    this.setMeter("hull", hull);
    this.setMeter("sails", sails);
    this.setMeter("crew", crew);

    const speed = Math.max(0, player.speed * KNOTS_PER_METRE_PER_SECOND);
    this.els.speed.textContent = String(Math.round(speed)).padStart(2, "0");
    const throttle = this.normalizedLevel(player.throttle);
    this.els.throttle.style.height = `${Math.max(4, throttle)}%`;
    this.els.sailSetting.textContent = `SAIL ${Math.round(throttle)}%`;
    this.els.sailState.textContent =
      throttle > 88
        ? "FULL SAIL"
        : throttle > 45
          ? "HALF SAIL"
          : throttle > 5
            ? "EASY SAIL"
            : "SAILS FURLED";
    this.els.windStrength.textContent = `${Math.round(this.normalizedLevel(state.windStrength))}%`;

    const brace = this.normalizedLevel(player.brace);
    this.els.brace.textContent =
      brace > 4 ? `BRACED ${Math.round(brace)}%` : "BRACE READY";
    this.els.brace.classList.toggle("is-active", brace > 4);
    this.els.repair.textContent = player.repairing
      ? "REPAIRS UNDERWAY"
      : polarCrewSheltered(player) ? "CREW INSIDE" : "CREW ON DECK";
    this.els.repair.classList.toggle("is-active", player.repairing);
    this.setPaused(state.paused);
  }

  private updateWeapons(player: ShipState): void {
    this.els.ammo.textContent = player.weapons.ammo.toUpperCase();
    const blocked = batteryBlockLabel(player);
    this.setWeapon("port", player.weapons.portCooldown, blocked);
    this.setWeapon("starboard", player.weapons.starboardCooldown, blocked);
    this.setWeapon("bow", player.weapons.bowCooldown, blocked);
    const special = this.normalizedLevel(player.special);
    const phase = player.specialPhase;
    const phaseName = phase?.phase ?? (special >= 99.5 ? "ready" : "charging");
    const phaseText = specialPhaseText(player);
    this.els.special.style.width = `${special}%`;
    this.els.specialLabel.textContent =
      phaseText ?? (special >= 99.5 ? "READY!" : `CHARGING ${Math.round(special)}%`);
    this.els.touchSpecialState.textContent =
      phase ? SPECIAL_PHASE_LABELS[phase.phase] : special >= 99.5 ? "READY" : `CHARGING ${Math.round(special)}%`;
    this.els.specialMeter.dataset.phase = phaseName;
    this.els.specialButton.dataset.phase = phaseName;
    this.els.specialMeter.classList.toggle("is-ready", !phase && special >= 99.5);
  }

  private updateTarget(state: WorldState, player: ShipState): void {
    const explicit = player.targetId
      ? state.ships.find((ship) => ship.id === player.targetId)
      : undefined;
    const target =
      explicit ??
      (state.mode === "combat"
        ? this.nearestOpponent(state, player)
        : undefined);
    this.currentTarget = target;
    this.currentTargetReadout = target
      ? this.targetReadout(state, player, target)
      : undefined;
    this.els.target.hidden = !target;
    this.els.target.dataset.phase = target?.specialPhase?.phase ?? "none";
    if (!target || !this.currentTargetReadout) {
      this.els.targetOpening.hidden = true;
      return;
    }

    const dx = target.position.x - player.position.x;
    const dz = target.position.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    const hull = this.integrity(target.damage.hull);
    const readout = this.currentTargetReadout;
    this.els.targetName.textContent = target.name;
    this.els.targetCaptain.textContent = getShipCaptain(target.kind).name;
    this.els.targetDistance.textContent =
      distance >= 1000
        ? `${(distance / 1000).toFixed(1)} km`
        : `${Math.round(distance)} m`;
    this.els.targetHull.style.width = `${hull}%`;
    this.els.targetIntent.textContent = readout.intent;
    this.els.target.dataset.condition = readout.status;
    this.els.target.dataset.intent = target.surrendered
      ? "surrendered"
      : readout.opening
        ? "opening"
        : "tracking";
    this.els.targetOpening.hidden = !readout.opening;
    this.els.targetWeak.textContent = readout.weakPoint;
  }

  private targetReadout(
    state: WorldState,
    player: ShipState,
    target: ShipState,
  ): TargetReadout {
    const hull = this.integrity(target.damage.hull);
    const sectionWeaknesses = (
      ["bow", "stern", "port", "starboard"] as const
    ).map((side) => ({
      label: `${side.toUpperCase()} HULL`,
      score: target.damage.sections[side],
    }));
    const weaknesses = [
      ...sectionWeaknesses,
      { label: "GUN DECK", score: target.damage.weapons * 1.04 },
      { label: "RIGGING", score: target.damage.sails },
      { label: "CREW DECK", score: target.damage.crew * 0.94 },
      { label: "WATERLINE", score: target.damage.hull * 0.9 },
    ].sort((first, second) => second.score - first.score);
    const weakness = weaknesses[0];
    const allReloading =
      target.weapons.portCooldown > 0.85 &&
      target.weapons.starboardCooldown > 0.85;
    const openingTimer =
      state.combat?.weakPointTargetId === target.id
        ? state.combat.weakPointTimer
        : 0;
    const openingSide =
      openingTimer > 0 ? state.combat?.weakPointSide : undefined;
    const opening =
      !target.surrendered && openingTimer > 0 && openingSide !== undefined;
    const weakPoint = opening
      ? `${openingSide.toUpperCase()} GUN DECK · ${openingTimer.toFixed(1)}s`
      : weakness.score >= 0.25
        ? weakness.label
        : target.repairing
          ? "REPAIR CREW"
          : allReloading
            ? "GUNS RELOADING"
            : "HULL PLATING";

    const toPlayerX = player.position.x - target.position.x;
    const toPlayerZ = player.position.z - target.position.z;
    const distance = Math.hypot(toPlayerX, toPlayerZ);
    const localForward =
      toPlayerX * -Math.sin(target.heading) +
      toPlayerZ * -Math.cos(target.heading);
    const localStarboard =
      toPlayerX * Math.cos(target.heading) +
      toPlayerZ * -Math.sin(target.heading);
    const broadsideWindow =
      Math.abs(localForward) < Math.abs(localStarboard) * 0.72;
    const armedSideCooldown =
      localStarboard > 0
        ? target.weapons.starboardCooldown
        : target.weapons.portCooldown;
    const ramming =
      distance < 70 &&
      localForward > Math.abs(localStarboard) * 0.82 &&
      target.speed > target.maxSpeed * 0.48;

    let intent = target.ai ? target.ai.toUpperCase() : "MANEUVERING";
    if (target.ai === "aggressive") intent = "CLOSING FAST";
    if (target.ai === "tactical") intent = "SEEKING BROADSIDE";
    if (target.ai === "reckless") intent = "ERRATIC COURSE";
    if (target.ai === "racer") intent = "BREAKING AWAY";
    if (hull < 22) intent = "LISTING • CRITICAL";
    if (broadsideWindow && armedSideCooldown <= 0.18)
      intent = "BROADSIDE READY";
    if (target.brace > 0.55) intent = "BRACING";
    if (target.repairing) intent = "REPAIRING";
    if (opening) intent = "RELOADING • OPENING";
    if (ramming) intent = "RAMMING COURSE";
    if (target.specialPhase) intent = `SPECIAL ${specialPhaseText(target)}`;
    if (target.surrendered) intent = "COLORS DOWN";

    const status = target.surrendered
      ? "surrendered"
      : hull < 30
        ? "critical"
        : hull < 60
          ? "damaged"
          : "strong";
    return { intent, opening, weakPoint, status };
  }

  private updateThreats(state: WorldState, player: ShipState): void {
    const incomingOwners = new Set<string>();
    for (const projectile of state.projectiles) {
      if (projectile.ownerId === player.id) continue;
      const toPlayerX = player.position.x - projectile.position.x;
      const toPlayerZ = player.position.z - projectile.position.z;
      const distance = Math.hypot(toPlayerX, toPlayerZ);
      const closing =
        projectile.velocity.x * toPlayerX + projectile.velocity.z * toPlayerZ >
        0;
      if (distance < 185 && closing) incomingOwners.add(projectile.ownerId);
    }

    const threats = state.ships
      .filter(
        (ship) =>
          ship.id !== player.id &&
          !ship.surrendered &&
          (ship.targetId === player.id ||
            areFactionsHostile(ship.faction, player.faction)),
      )
      .map((ship) => ({
        ship,
        distance: Math.hypot(
          ship.position.x - player.position.x,
          ship.position.z - player.position.z,
        ),
      }))
      .filter((entry) => entry.distance < 440)
      .sort((first, second) => first.distance - second.distance)
      .slice(0, 4);

    this.els.threatCompass.hidden = threats.length === 0 || state.race.active;
    for (let index = 0; index < 4; index += 1) {
      const pip = this.els[`threat-${index}`];
      const threat = threats[index];
      pip.hidden = !threat;
      if (!threat) continue;
      const dx = threat.ship.position.x - player.position.x;
      const dz = threat.ship.position.z - player.position.z;
      const bearing = Math.atan2(-dx, -dz);
      const relative = Math.atan2(
        Math.sin(bearing - player.heading),
        Math.cos(bearing - player.heading),
      );
      const ready =
        Math.min(
          threat.ship.weapons.portCooldown,
          threat.ship.weapons.starboardCooldown,
          threat.ship.weapons.bowCooldown,
        ) <= 0.15;
      const level = incomingOwners.has(threat.ship.id)
        ? "incoming"
        : ready && threat.distance < 185
          ? "armed"
          : "tracking";
      pip.dataset.level = level;
      pip.style.left = `${50 + Math.sin(relative) * 46}%`;
      pip.style.top = `${50 - Math.cos(relative) * 43}%`;
      pip.style.setProperty(
        "--threat-angle",
        `${(relative * 180) / Math.PI + 180}deg`,
      );
      pip.title = `${getShipCaptain(threat.ship.kind).name} aboard ${threat.ship.name}: ${level}`;
    }
  }

  private updateRace(state: WorldState): void {
    const visible = state.race.active || state.mode === "race";
    this.els.race.hidden = !visible;
    this.els.wrongWay.hidden = !visible || !state.race.wrongWay;
    if (!visible) return;
    this.els.racePlace.textContent = this.ordinal(state.race.placement);
    this.els.raceLap.textContent = `LAP ${state.race.lap} / ${state.race.totalLaps}`;
    this.els.raceCheckpoint.textContent = `GATE ${state.race.checkpoint + 1}`;
    this.els.raceTime.textContent = this.formatTime(state.race.elapsed);
    const count = Math.ceil(state.race.countdown);
    if (count > 0 && this.snapshot?.countdown !== count)
      this.showCountdown(String(count));
  }

  private updateRadar(state: WorldState, player: ShipState): void {
    const ranges = [800, 2000, 5000];
    const furthestEntity = Math.max(
      0,
      ...state.ships
        .filter((ship) => ship.id !== player.id)
        .map((ship) =>
          Math.hypot(
            ship.position.x - player.position.x,
            ship.position.z - player.position.z,
          ),
        ),
      ...state.islands.map((island) =>
        Math.hypot(
          island.position.x - player.position.x,
          island.position.z - player.position.z,
        ),
      ),
    );
    const range =
      ranges.find((candidate) => furthestEntity <= candidate) ?? 5000;
    this.els.radarRange.textContent =
      range >= 1000 ? `${range / 1000} km` : `${range} m`;
    const scale = 42 / range;

    const islandMarkup = state.islands
      .slice(0, 12)
      .map((island) => {
        const x = (island.position.x - player.position.x) * scale;
        const y = (island.position.z - player.position.z) * scale;
        if (Math.hypot(x, y) > 44) return "";
        const radius = Math.min(8, Math.max(2, island.radius * scale));
        return `<circle class="chart-island${island.discovered ? " is-known" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}"/>`;
      })
      .join("");
    const shipMarkup = state.ships
      .filter((ship) => ship.id !== player.id)
      .slice(0, 8)
      .map((ship) => {
        const x = (ship.position.x - player.position.x) * scale;
        const y = (ship.position.z - player.position.z) * scale;
        if (Math.hypot(x, y) > 44) return "";
        const relation = ship.surrendered
          ? "neutral"
          : ship.targetId === player.id ||
              areFactionsHostile(ship.faction, player.faction)
            ? "hostile"
            : "unknown";
        return `<path class="chart-ship chart-ship--${relation}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${this.normalizedDegrees(ship.heading).toFixed(1)})" d="M0-4L3 3L0 2L-3 3Z"/>`;
      })
      .join("");
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
      targetId: this.currentTarget?.id,
      repairing: player.repairing,
      countdown: Math.ceil(state.race.countdown),
      raceActive: state.race.active,
      targetHull: this.currentTarget
        ? this.integrity(this.currentTarget.damage.hull)
        : 100,
      targetSurrendered: this.currentTarget?.surrendered ?? false,
      targetOpening: this.currentTargetReadout?.opening ?? false,
      targetWeakPoint: this.currentTargetReadout?.weakPoint ?? "",
    };
    const previous = this.snapshot;
    this.snapshot = next;
    if (!previous) return;
    // A new objective supersedes queued instructions from the previous voyage phase.
    if(next.objective!==previous.objective){
      this.calloutQueue=[];
      if(this.calloutTimer)window.clearTimeout(this.calloutTimer);
      this.calloutTimer=undefined;
      this.els.callout.hidden=true;
      this.els.callout.classList.remove("is-speaking","is-leaving");
    }

    if (next.weather === "storm" && previous.weather !== "storm")
      this.callout("NAVIGATOR", "Storm wall ahead—hold the course!", "danger");
    if (next.hull < 30 && previous.hull >= 30)
      this.callout(
        "SHIPWRIGHT",
        "Hull is critical! Give me a repair crew!",
        "danger",
      );
    if (next.targetId && next.targetId !== previous.targetId) {
      const target = state.ships.find((ship) => ship.id === next.targetId);
      const captain = target ? getShipCaptain(target.kind).name : undefined;
      this.callout(
        "LOOKOUT",
        `${captain ? `${captain}'s ` : ""}${target?.name ?? "target"} in cannon range!`,
        "danger",
      );
    }
    if (next.targetId && next.targetId === previous.targetId) {
      if (next.targetHull < 30 && previous.targetHull >= 30)
        this.callout(
          "GUNNER",
          "Enemy hull critical—one clean broadside!",
          "success",
        );
      if (next.targetSurrendered && !previous.targetSurrendered)
        this.callout(
          "LOOKOUT",
          "Their colors are down—they surrender!",
          "success",
        );
      if (next.targetOpening && !previous.targetOpening) {
        this.restartAnimation(this.els.targetOpening, "is-active");
        this.callout(
          "GUNNER",
          `Opening on ${next.targetWeakPoint.toLowerCase()}—fire!`,
          "success",
        );
      }
    }
    if (next.repairing && !previous.repairing)
      this.callout("SHIPWRIGHT", "Tools out! Keep us steady!", "info");
    if (!next.repairing && previous.repairing)
      this.callout("SHIPWRIGHT", "Patch is holding, Captain!", "success");
    if (next.raceActive && !previous.raceActive)
      this.callout("HELMSMAN", "Four ships. Three laps. One winner.", "race");
    if (next.objective !== previous.objective && next.objective)
      this.callout("NAVIGATOR", next.objective, "info");
  }

  private nearestOpponent(
    state: WorldState,
    player: ShipState,
  ): ShipState | undefined {
    let nearest: ShipState | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const ship of state.ships) {
      if (
        ship.id === player.id ||
        ship.surrendered ||
        (ship.targetId !== player.id &&
          !areFactionsHostile(ship.faction, player.faction))
      )
        continue;
      const distance = Math.hypot(
        ship.position.x - player.position.x,
        ship.position.z - player.position.z,
      );
      if (distance < nearestDistance) {
        nearest = ship;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private setMeter(key: "hull" | "sails" | "crew", value: number): void {
    this.els[`${key}Bar`].style.width = `${value}%`;
    this.els[`${key}Value`].textContent = String(Math.round(value));
    const row = this.els[`${key}Bar`].closest<HTMLElement>(".vital-row");
    if (row)
      row.dataset.condition =
        value < 30 ? "critical" : value < 60 ? "damaged" : "good";
  }

  private setWeapon(key: "port" | "starboard" | "bow", cooldown: number, blocked?: "SUBMERGED" | "SURFACING"): void {
    const ready = !blocked && cooldown <= 0.001;
    const box = this.els[`weapon${this.capitalize(key)}`];
    const wasReady = box.dataset.ready === "true";
    const wasBlocked = Boolean(box.dataset.blocked);
    box.dataset.ready = String(ready);
    box.dataset.blocked = blocked?.toLowerCase() ?? "";
    this.els[`weapon${this.capitalize(key)}State`].textContent = blocked ?? (ready
      ? "READY"
      : `${cooldown.toFixed(1)}s`);
    this.els[`weapon${this.capitalize(key)}Bar`].style.width = blocked ? "0%" : ready
      ? "100%"
      : `${Math.max(4, 100 - Math.min(100, cooldown * 28))}%`;
    if (ready && !wasReady && !wasBlocked) {
      this.restartAnimation(box, "just-reloaded");
      this.showVolleyStatus(key, "RELOADED", "ready");
    }
  }

  private registerHit(
    targetId: string,
    severity: number,
    section?: ShipSide,
    options: {
      critical?: boolean;
      disabled?: boolean;
      weakPoint?: string;
      combo?: number;
    } = {},
  ): void {
    const now = performance.now();
    this.hitCombo =
      options.combo ?? (now - this.lastHitAt < 2200 ? this.hitCombo + 1 : 1);
    this.lastHitAt = now;
    const critical = options.critical || severity >= 0.82;
    this.els.hitLabel.textContent = options.disabled
      ? "SHIP DISABLED!"
      : critical
        ? "CRITICAL HIT!"
        : "HULL HIT";
    this.els.comboCount.textContent =
      this.hitCombo > 1 ? `${this.hitCombo} HIT CHAIN` : "DIRECT HIT";
    this.els.hitSection.textContent =
      options.weakPoint ??
      (section ? `${section.toUpperCase()} SECTION` : "SOLID CONTACT");
    this.els.hitConfirm.dataset.tone = options.disabled
      ? "disabled"
      : critical
        ? "critical"
        : "hit";
    this.els.hitConfirm.dataset.target = targetId;
    this.els.hitConfirm.hidden = false;
    this.restartAnimation(this.els.hitConfirm, "is-active");
    if (this.hitTimer) window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(
      () => {
        this.els.hitConfirm.hidden = true;
        this.hitTimer = undefined;
      },
      critical ? 1450 : 1050,
    );
    if (options.disabled)
      this.callout(
        "LOOKOUT",
        "Target disabled! Their colors are coming down!",
        "success",
      );
  }

  private showVolleyStatus(
    side: ShipSide | undefined,
    label: string,
    tone: "fire" | "ready",
  ): void {
    const sideLabel =
      side === "port" || side === "starboard"
        ? `${side.toUpperCase()} BATTERY`
        : side === "bow"
          ? "BOW CANNON"
          : "BROADSIDE";
    this.els.volleySide.textContent = sideLabel;
    this.els.volleyLabel.textContent = label;
    this.els.volleyStamp.dataset.tone = tone;
    this.els.volleyStamp.hidden = false;
    this.restartAnimation(this.els.volleyStamp, "is-active");
    if (this.volleyTimer) window.clearTimeout(this.volleyTimer);
    this.volleyTimer = window.setTimeout(() => {
      this.els.volleyStamp.hidden = true;
      this.volleyTimer = undefined;
    }, 780);
  }

  private pulseWeapon(side: ShipSide, ready: boolean): void {
    if (side === "stern") return;
    const box = this.els[`weapon${this.capitalize(side)}`];
    if (!box) return;
    this.restartAnimation(box, ready ? "just-reloaded" : "just-fired");
  }

  private showTargetOpening(weakPoint: string): void {
    this.els.targetOpening.hidden = false;
    this.els.targetWeak.textContent = weakPoint.toUpperCase();
    this.els.target.dataset.intent = "opening";
    this.restartAnimation(this.els.targetOpening, "is-active");
  }

  private pulseThreats(): void {
    for (let index = 0; index < 4; index += 1) {
      const pip = this.els[`threat-${index}`];
      if (pip && !pip.hidden) this.restartAnimation(pip, "is-alerting");
    }
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
    this.els.callout.classList.remove("is-leaving");
    this.restartAnimation(this.els.callout, "is-speaking");
    this.calloutTimer = window.setTimeout(() => {
      this.els.callout.classList.add("is-leaving");
      this.calloutTimer = window.setTimeout(() => {
        this.els.callout.hidden = true;
        this.els.callout.classList.remove("is-speaking", "is-leaving");
        this.calloutTimer = undefined;
        this.presentNextCallout();
      }, 220);
    }, 2800);
  }

  private flashDamage(severity: number, section?: ShipSide): void {
    const now = performance.now();
    if (now - this.lastDamageAt < 70) return;
    this.lastDamageAt = now;
    this.els.damageFlash.dataset.side = section ?? "all";
    this.els.damageFlash.style.setProperty(
      "--damage-alpha",
      String(0.18 + Math.min(1, Math.max(0, severity)) * 0.38),
    );
    this.restartAnimation(this.els.damageFlash, "is-active");
    if (severity > 0.7) this.callout("CREW", "Brace! Heavy impact!", "danger");
  }

  private flashBanner(title: string, subtitle: string, tone: string): void {
    this.els.eventTitle.textContent = title;
    this.els.eventSubtitle.textContent = subtitle;
    this.els.eventBanner.dataset.tone = tone;
    this.els.eventBanner.hidden = false;
    this.restartAnimation(this.els.eventBanner, "is-active");
    window.setTimeout(() => {
      this.els.eventBanner.hidden = true;
    }, 2500);
  }

  private showCountdown(text: string): void {
    this.els.countdown.textContent = text;
    this.els.countdown.hidden = false;
    if (this.countdownTimer) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = undefined;
    }
    if (this.captureMode) {
      this.els.countdown.classList.remove("is-active");
      return;
    }
    this.restartAnimation(this.els.countdown, "is-active");
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
    const degrees =
      Math.abs(radiansOrDegrees) <= Math.PI * 2 + 0.001
        ? (radiansOrDegrees * 180) / Math.PI
        : radiansOrDegrees;
    return ((degrees % 360) + 360) % 360;
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
    if (absolute >= 1_000_000_000)
      return `${(value / 1_000_000_000).toFixed(1).replace(".0", "")}B`;
    if (absolute >= 1_000_000)
      return `${(value / 1_000_000).toFixed(1).replace(".0", "")}M`;
    if (absolute >= 1_000)
      return `${(value / 1_000).toFixed(1).replace(".0", "")}K`;
    return Math.round(value).toLocaleString("en-US");
  }

  private ordinal(value: number): string {
    const integer = Math.max(1, Math.round(value));
    const suffix =
      integer % 10 === 1 && integer % 100 !== 11
        ? "ST"
        : integer % 10 === 2 && integer % 100 !== 12
          ? "ND"
          : integer % 10 === 3 && integer % 100 !== 13
            ? "RD"
            : "TH";
    return `${integer}${suffix}`;
  }

  private formatTime(seconds: number): string {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const remainder = safe - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
  }
}
