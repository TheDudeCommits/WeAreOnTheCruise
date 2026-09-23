/** Audio contract (lead-owned). All sound is driven by screen changes, RunState and SimEvents. */
import type { RunState, Settings, SimEvent } from '../game/types';
import type { AppScreen } from '../render/frame';

export interface AudioFrame {
  screen: AppScreen;
  time: number;
  dt: number;
  run: Readonly<RunState> | null;
  events: readonly SimEvent[];
  /** Camera/listener pose in world space. */
  listener: { x: number; y: number; z: number; forwardX: number; forwardZ: number };
}

export interface AudioSystem {
  /** Must be called from a user gesture; nothing plays before it. */
  unlock(): Promise<void>;
  readonly unlocked: boolean;
  update(frame: AudioFrame): void;
  setSettings(settings: Settings): void;
  dispose(): void;
}
