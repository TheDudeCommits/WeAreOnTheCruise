import type { InputAction } from '../core/contracts';
import type { ActionState } from '../simulation';

export type InputSink = (action: InputAction, pressed: boolean) => void;

const KEY_BINDINGS: Readonly<Record<string, InputAction>> = {
  KeyW: 'throttle-up',
  ArrowUp: 'throttle-up',
  KeyS: 'throttle-down',
  ArrowDown: 'throttle-down',
  KeyA: 'steer-left',
  ArrowLeft: 'steer-left',
  KeyD: 'steer-right',
  ArrowRight: 'steer-right',
  ShiftLeft: 'hard-turn',
  ShiftRight: 'hard-turn',
  KeyQ: 'fire-port',
  KeyE: 'fire-starboard',
  KeyF: 'fire-bow',
  KeyX: 'cycle-ammo',
  Space: 'brace',
  KeyR: 'repair',
  KeyC: 'special',
  BracketLeft: 'camera-left',
  BracketRight: 'camera-right',
  Backslash: 'camera-reset',
  Escape: 'pause',
};

const GAMEPAD_BUTTONS: readonly (InputAction | undefined)[] = [
  'fire-bow', 'special', 'cycle-ammo', 'brace', 'fire-port', 'fire-starboard', undefined, undefined,
  'camera-reset', 'pause', undefined, undefined, undefined, undefined, undefined, undefined,
];

/** Centralized physical-input to semantic-action adapter. */
export class InputController {
  private readonly state: ActionState = {};
  private readonly keyboardActions = new Set<InputAction>();
  private readonly gamepadActions = new Set<InputAction>();
  private attached = false;

  constructor(private readonly sink?: InputSink, private readonly target: Window = window) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.target.addEventListener('keydown', this.onKeyDown, { passive: false });
    this.target.addEventListener('keyup', this.onKeyUp, { passive: false });
    this.target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.clear();
  }

  pollGamepad(): void {
    const navigatorRef = this.target.navigator;
    const gamepad = navigatorRef.getGamepads?.()[0];
    const next = new Set<InputAction>();
    if (gamepad) {
      const horizontal = gamepad.axes[0] ?? 0;
      const vertical = gamepad.axes[1] ?? 0;
      if (horizontal < -0.2) next.add('steer-left');
      if (horizontal > 0.2) next.add('steer-right');
      if (vertical < -0.28) next.add('throttle-up');
      if (vertical > 0.28) next.add('throttle-down');
      for (let index = 0; index < GAMEPAD_BUTTONS.length; index += 1) {
        const action = GAMEPAD_BUTTONS[index];
        if (action && gamepad.buttons[index]?.pressed) next.add(action);
      }
      if (gamepad.buttons[10]?.pressed) next.add('hard-turn');
      if (gamepad.buttons[11]?.pressed) next.add('repair');
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
    if (pressed) this.keyboardActions.add(action);
    else this.keyboardActions.delete(action);
    this.commit(action);
  }

  clear(): void {
    const active = new Set([...this.keyboardActions, ...this.gamepadActions]);
    this.keyboardActions.clear();
    this.gamepadActions.clear();
    for (const action of active) this.commit(action);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    event.preventDefault();
    this.keyboardActions.add(action);
    this.commit(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    event.preventDefault();
    this.keyboardActions.delete(action);
    this.commit(action);
  };

  private readonly onBlur = (): void => this.clear();

  private commit(action: InputAction): void {
    const pressed = this.keyboardActions.has(action) || this.gamepadActions.has(action);
    if (this.state[action] === pressed) return;
    this.state[action] = pressed;
    this.sink?.(action, pressed);
  }
}

export const DEFAULT_KEY_BINDINGS = KEY_BINDINGS;
