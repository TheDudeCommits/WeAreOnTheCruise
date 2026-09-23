import type { InputAction } from "../core/contracts";
import type { ActionState } from "../simulation";
import {
  DEFAULT_KEY_BINDINGS,
  loadControlSettings,
  type AimState,
} from "./controls";
export { DEFAULT_KEY_BINDINGS } from "./controls";
export type InputSink = (action: InputAction, pressed: boolean) => void;
const GAMEPAD_BUTTONS: readonly (InputAction | undefined)[] = [
  "fire-bow",
  "special",
  "cycle-ammo",
  "brace",
  "fire-port",
  "fire-starboard",
  undefined,
  undefined,
  "camera-reset",
  "pause",
  "hard-turn",
  "repair",
];

/** Input is gated as a whole so menu focus cannot leak into sailing or gamepad fire. */
export class InputController {
  private readonly state: ActionState = {};
  private readonly keyboardActions = new Set<InputAction>();
  private readonly gamepadActions = new Set<InputAction>();
  private readonly virtualActions = new Set<InputAction>();
  private readonly physicalKeys = new Set<string>();
  private bindings: Record<string, InputAction> = { ...DEFAULT_KEY_BINDINGS };
  private attached = false;
  private enabled = true;
  private aim: AimState = { adjustment: 0 };
  private gamepadPauseDown = false;
  constructor(
    private readonly sink?: InputSink,
    private readonly target: Window = window,
  ) {
    this.bindings = loadControlSettings().keyBindings;
  }
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.target.addEventListener("keydown", this.onKeyDown, { passive: false });
    this.target.addEventListener("keyup", this.onKeyUp, { passive: false });
    this.target.addEventListener("blur", this.onBlur);
    this.target.addEventListener("pointermove",this.onAimPointerMove);
  }
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
    this.target.removeEventListener("pointermove",this.onAimPointerMove);
    this.clear();
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) this.clear();
    this.enabled = enabled;
  }
  setBindings(bindings: Readonly<Record<string, InputAction>>): void {
    this.clear();
    this.bindings = { ...bindings };
  }
  getAimState(): Readonly<AimState> {
    return this.aim;
  }
  setAim(side?: "port" | "starboard", adjustment = this.aim.adjustment): void {
    this.aim = {
      side,
      adjustment: Math.min(0.28, Math.max(-0.28, adjustment)),
    };
  }
  pollGamepad(): void {
    const gamepad = this.target.navigator.getGamepads?.()[0];
    const pauseDown = Boolean(gamepad?.buttons[9]?.pressed);
    if (pauseDown !== this.gamepadPauseDown) {
      this.gamepadPauseDown = pauseDown;
      this.sink?.("pause", pauseDown);
    }
    if (!this.enabled) return;
    const next = new Set<InputAction>();
    if (gamepad) {
      const horizontal = gamepad.axes[0] ?? 0;
      const vertical = gamepad.axes[1] ?? 0;
      if (horizontal < -0.2) next.add("steer-left");
      if (horizontal > 0.2) next.add("steer-right");
      if (vertical < -0.28) next.add("throttle-up");
      if (vertical > 0.28) next.add("throttle-down");
      for (let index = 0; index < GAMEPAD_BUTTONS.length; index += 1) {
        const action = GAMEPAD_BUTTONS[index];
        if (action && action !== "pause" && gamepad.buttons[index]?.pressed)
          next.add(action);
      }
      if (gamepad.buttons[6]?.pressed) this.setAim("port");
      else if (gamepad.buttons[7]?.pressed) this.setAim("starboard");
      else if (!this.physicalKeys.has("KeyZ") && !this.physicalKeys.has("KeyV"))
        this.setAim(undefined, 0);
      if (this.aim.side && Math.abs(gamepad.axes[2] ?? 0) > 0.2)
        this.setAim(this.aim.side, (gamepad.axes[2] ?? 0) * 0.28);
    }
    const changed = new Set([...this.gamepadActions, ...next]);
    this.gamepadActions.clear();
    for (const action of next) this.gamepadActions.add(action);
    for (const action of changed) this.commit(action);
  }
  getActionState(): Readonly<ActionState> {
    return this.state;
  }
  setVirtualAction(action: InputAction, pressed: boolean): void {
    if (!this.enabled && pressed) return;
    if (pressed) this.virtualActions.add(action);
    else this.virtualActions.delete(action);
    this.commit(action);
  }
  clear(): void {
    const active = new Set([
      ...this.keyboardActions,
      ...this.gamepadActions,
      ...this.virtualActions,
    ]);
    this.keyboardActions.clear();
    this.gamepadActions.clear();
    this.virtualActions.clear();
    this.physicalKeys.clear();
    this.aim = { adjustment: 0 };
    for (const action of active) this.commit(action);
  }
  private typing(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))
    );
  }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.defaultPrevented || this.typing(event.target))
      return;
    if (["KeyZ", "KeyV", "Comma", "Period"].includes(event.code)) {
      event.preventDefault();
      this.physicalKeys.add(event.code);
      if (event.code === "KeyZ" || event.code === "KeyV")
        this.setAim(event.code === "KeyZ" ? "port" : "starboard");
      else if (this.aim.side)
        this.setAim(
          this.aim.side,
          this.aim.adjustment + (event.code === "Comma" ? -0.035 : 0.035),
        );
      return;
    }
    const action = this.bindings[event.code];
    if (!action || action === "pause") return;
    event.preventDefault();
    this.physicalKeys.add(event.code);
    this.keyboardActions.add(action);
    this.commit(action);
  };
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.physicalKeys.delete(event.code);
    if (event.code === "KeyZ" || event.code === "KeyV") {
      this.setAim(
        this.physicalKeys.has("KeyZ")
          ? "port"
          : this.physicalKeys.has("KeyV")
            ? "starboard"
            : undefined,
        0,
      );
      return;
    }
    const action = this.bindings[event.code];
    if (!action || action === "pause") return;
    if (this.enabled) event.preventDefault();
    if (![...this.physicalKeys].some((code) => this.bindings[code] === action))
      this.keyboardActions.delete(action);
    this.commit(action);
  };
  private readonly onAimPointerMove=(event:PointerEvent):void=>{
    if(!this.enabled || !this.aim.side || event.pointerType!=="mouse" || !(event.target instanceof HTMLCanvasElement))return;
    this.setAim(this.aim.side,this.aim.adjustment+event.movementX*.0015);
  };
  private readonly onBlur = (): void => this.clear();
  private commit(action: InputAction): void {
    const pressed =
      this.keyboardActions.has(action) ||
      this.gamepadActions.has(action) ||
      this.virtualActions.has(action);
    if (this.state[action] === pressed) return;
    this.state[action] = pressed;
    this.sink?.(action, pressed);
  }
}
