/** UI contract (lead-owned). The UI is DOM-only, reads state, and reports player intent through callbacks. */
import type { MetaUpgradeId, SeaId, ShipId } from '../game/ids';
import type { MetaProfile, RunResult, RunState, Settings, SimEvent, WorldQuery } from '../game/types';
import type { AppScreen } from '../render/frame';

export interface UiCallbacks {
  /** Any click/key: lets audio unlock on a user gesture. */
  onUserGesture(): void;
  onGoToHarbor(): void;
  onSelectShip(shipId: ShipId): void;
  onStartRun(shipId: ShipId, seaId: SeaId): void;
  onChooseCard(index: number): void;
  onReroll(): void;
  onBanish(index: number): void;
  onPause(paused: boolean): void;
  onRetire(): void;
  onReturnToHarbor(): void;
  /** After a victory: keep the run going in endless mode (bosses return, stronger). */
  onContinueEndless(): void;
  onPurchaseUpgrade(id: MetaUpgradeId): void;
  onUnlockShip(id: ShipId): void;
  onSettingsChange(settings: Settings): void;
}

export interface ScreenPoint { x: number; y: number; visible: boolean }

export interface UiFrame {
  screen: AppScreen;
  time: number;
  dt: number;
  run: Readonly<RunState> | null;
  events: readonly SimEvent[];
  profile: Readonly<MetaProfile>;
  settings: Readonly<Settings>;
  result: Readonly<RunResult> | null;
  selectedShip: ShipId;
  fps: number;
  /** The run's island field (minimap coastlines); null outside a run. */
  world: WorldQuery | null;
  /** Projects a world point to CSS pixels in the game root (visible=false when behind the camera/off-screen). */
  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint;
}

export interface UiSystem {
  mount(root: HTMLElement, callbacks: UiCallbacks): void;
  setScreen(screen: AppScreen): void;
  update(frame: UiFrame): void;
  /** True while a modal (pause, cards, settings) should block gameplay input. */
  readonly blockingInput: boolean;
  dispose(): void;
}
