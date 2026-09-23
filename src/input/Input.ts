/**
 * Input (lead-owned): keyboard + mouse + gamepad → PlayerInput + discrete SimActions.
 * Aim is reported in normalized device coordinates; GameApp raycasts it onto the water.
 */
import type { SimAction } from '../game/types';

export interface InputSnapshot {
  steer: number;
  throttleAxis: number;
  /** Pointer in NDC (−1..1). */
  pointerX: number;
  pointerY: number;
  pointerInside: boolean;
  broadsideHeld: boolean;
  /** Right stick aim (gamepad) in −1..1 when active. */
  stickAimX: number;
  stickAimY: number;
  usingGamepad: boolean;
}

const KEY_ACTIONS: Record<string, SimAction> = {
  KeyW: 'gear-up', ArrowUp: 'gear-up', KeyS: 'gear-down', ArrowDown: 'gear-down',
  KeyQ: 'broadside', KeyE: 'special', KeyR: 'ultimate', Space: 'brace',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};

export class Input {
  private readonly held = new Set<string>();
  private readonly queued: SimAction[] = [];
  private readonly snapshot: InputSnapshot = { steer: 0, throttleAxis: 0, pointerX: 0, pointerY: 0, pointerInside: false, broadsideHeld: false, stickAimX: 0, stickAimY: 0, usingGamepad: false };
  private enabled = true;
  private mouseDown = false;
  private padButtons: boolean[] = [];

  constructor(private readonly surface: HTMLElement) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.surface.addEventListener('pointermove', this.onPointer);
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointerleave', this.onLeave);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.surface.removeEventListener('pointermove', this.onPointer);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointerleave', this.onLeave);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  clear(): void { this.held.clear(); this.queued.length = 0; this.mouseDown = false; }

  /** Discrete actions since the last call. */
  drainActions(): SimAction[] { return this.queued.splice(0, this.queued.length); }

  read(): Readonly<InputSnapshot> {
    const s = this.snapshot;
    const left = this.held.has('KeyA') || this.held.has('ArrowLeft');
    const right = this.held.has('KeyD') || this.held.has('ArrowRight');
    s.steer = (left ? 1 : 0) - (right ? 1 : 0);
    s.throttleAxis = 0;
    s.broadsideHeld = this.enabled && this.mouseDown;
    this.pollGamepad(s);
    return s;
  }

  private pollGamepad(s: InputSnapshot): void {
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!pad) { s.usingGamepad = false; return; }
    const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0), rx = dead(pad.axes[2] ?? 0), ry = dead(pad.axes[3] ?? 0);
    if (lx || ly || rx || ry || pad.buttons.some((b) => b.pressed)) s.usingGamepad = true;
    if (!s.usingGamepad || !this.enabled) return;
    if (lx) s.steer = -lx;
    if (ly) s.throttleAxis = -ly;
    s.stickAimX = rx; s.stickAimY = ry;
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.padButtons[i];
    if (edge(7)) this.queued.push('broadside');
    if ((pad.buttons[7]?.value ?? 0) > 0.5) s.broadsideHeld = true;
    if (edge(4)) this.queued.push('special');
    if (edge(5)) this.queued.push('ultimate');
    if (edge(0)) this.queued.push('brace');
    if (edge(1)) this.queued.push('boost');
    if (edge(12)) this.queued.push('gear-up');
    if (edge(13)) this.queued.push('gear-down');
    this.padButtons = pressed;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.target instanceof HTMLInputElement) return;
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (!event.repeat) {
      const action = KEY_ACTIONS[event.code];
      if (action) this.queued.push(action);
    }
    this.held.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => { this.held.delete(event.code); };
  private readonly onBlur = (): void => this.clear();

  private readonly onPointer = (event: PointerEvent): void => {
    const rect = this.surface.getBoundingClientRect();
    this.snapshot.pointerX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.snapshot.pointerY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    this.snapshot.pointerInside = true;
    this.snapshot.usingGamepad = false;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.onPointer(event);
    if (event.button === 0 && this.enabled) { this.mouseDown = true; this.queued.push('broadside'); }
  };

  private readonly onPointerUp = (event: PointerEvent): void => { if (event.button === 0) this.mouseDown = false; };
  private readonly onLeave = (): void => { this.snapshot.pointerInside = false; };
}
