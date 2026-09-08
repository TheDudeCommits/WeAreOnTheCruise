import type { InputAction } from "../core/contracts";

export const DEFAULT_KEY_BINDINGS: Readonly<Record<string, InputAction>> = {
  KeyW: "throttle-up",
  ArrowUp: "throttle-up",
  KeyS: "throttle-down",
  ArrowDown: "throttle-down",
  KeyA: "steer-left",
  ArrowLeft: "steer-left",
  KeyD: "steer-right",
  ArrowRight: "steer-right",
  ShiftLeft: "hard-turn",
  ShiftRight: "hard-turn",
  KeyQ: "fire-port",
  KeyE: "fire-starboard",
  KeyF: "fire-bow",
  KeyX: "cycle-ammo",
  Space: "brace",
  KeyR: "repair",
  KeyC: "special",
  BracketLeft: "camera-left",
  BracketRight: "camera-right",
  Backslash: "camera-reset",
  Escape: "pause",
};
export interface AimState {
  side?: "port" | "starboard";
  adjustment: number;
}
export interface ControlSettings {
  cameraShake: number;
  aimAssist: boolean;
  subtitleScale: number;
  keyBindings: Record<string, InputAction>;
}
export const CONTROL_SETTINGS_KEY = "cruise.controls.v1";
export function loadControlSettings(): ControlSettings {
  const defaults: ControlSettings = {
    cameraShake: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 0.65,
    aimAssist: true,
    subtitleScale: 1,
    keyBindings: { ...DEFAULT_KEY_BINDINGS },
  };
  try {
    const saved = JSON.parse(
      localStorage.getItem(CONTROL_SETTINGS_KEY) ?? "null",
    );
    if (!saved || typeof saved !== "object") return defaults;
    const actions = new Set(Object.values(DEFAULT_KEY_BINDINGS));
    const valid =
      saved.keyBindings &&
      typeof saved.keyBindings === "object" &&
      Object.entries(saved.keyBindings).every(
        ([key, value]) =>
          /^[A-Za-z0-9]+$/.test(key) && actions.has(value as InputAction),
      );
    return {
      cameraShake: Number.isFinite(saved.cameraShake)
        ? Math.min(1, Math.max(0, saved.cameraShake))
        : defaults.cameraShake,
      aimAssist: typeof saved.aimAssist === "boolean" ? saved.aimAssist : true,
      subtitleScale: Number.isFinite(saved.subtitleScale)
        ? Math.min(1.5, Math.max(0.85, saved.subtitleScale))
        : 1,
      keyBindings: valid ? saved.keyBindings : defaults.keyBindings,
    };
  } catch {
    return defaults;
  }
}
export function keyLabel(code: string): string {
  return code
    .replace(/^Key/, "")
    .replace(/^Digit/, "")
    .replace("Arrow", "")
    .replace("Left", "")
    .replace("Right", "")
    .replace("Space", "Space");
}
