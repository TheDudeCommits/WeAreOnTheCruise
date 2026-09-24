/**
 * Harbor pane registry (lead contract). FLOW renders registered panes as extra harbor tabs; REPLAY (quests, logbook,
 * daily voyage, heat) registers its panes from its own files. Panes are DOM-only and read the UiFrame.
 */
import type { UiCallbacks, UiFrame } from '../contracts';

export interface HarborPane {
  id: string;
  /** Tab label. */
  label: string;
  readonly el: HTMLElement;
  /** Called once when mounted, with the UI callbacks. */
  mount?(cb: UiCallbacks): void;
  update(f: UiFrame): void;
  /** Keyboard/gamepad intent while the pane is showing; true if handled. */
  onKey?(e: KeyboardEvent): boolean;
}

const panes: HarborPane[] = [];

export function registerHarborPane(pane: HarborPane): void {
  if (!panes.some((p) => p.id === pane.id)) panes.push(pane);
}

export function harborPanes(): readonly HarborPane[] { return panes; }
