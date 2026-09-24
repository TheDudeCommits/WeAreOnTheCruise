/**
 * Input (FLOW owns it this round): keyboard + mouse + gamepad → PlayerInput + discrete SimActions.
 * Aim is reported in normalized device coordinates; GameApp raycasts it onto the water.
 *
 * Controls are remappable (keyboard; two keys per action) and stored under `cruise.controls.v2`, separately from the
 * Settings contract. Rebinding a key that another action uses swaps the two (nothing is ever left unbound), and the
 * in-run system keys (Esc, P, Tab) cannot be taken. Full Broadside and Brace each have a hold or toggle mode:
 *  - hold (default): the key or button fires once, and holding it repeats as soon as the skill is ready;
 *  - toggle: one press latches auto-repeat on (the HUD shows AUTO on the slot), the next press turns it off.
 * The pad layout is fixed: RT broadside, A brace, B boost, LB special, RB ultimate, D-pad gears, sticks sail and aim.
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

// ───────────────────────────── Bindings ─────────────────────────────

export type BindAction = 'gear-up' | 'gear-down' | 'port' | 'starboard' | 'broadside' | 'special' | 'ultimate' | 'brace' | 'boost';
export const BIND_ACTIONS: readonly BindAction[] = ['gear-up', 'gear-down', 'port', 'starboard', 'broadside', 'special', 'ultimate', 'brace', 'boost'];
export const BIND_LABEL: Readonly<Record<BindAction, string>> = {
  'gear-up': 'Raise sail', 'gear-down': 'Strike sail', port: 'Rudder to port', starboard: 'Rudder to starboard',
  broadside: 'Full Broadside', special: 'Special', ultimate: 'Ultimate', brace: 'Brace / parry', boost: 'Boost',
};
/** Two keys per action (KeyboardEvent.code; '' = none). */
export type Bindings = Record<BindAction, [string, string]>;
export type HoldMode = 'hold' | 'toggle';

export interface ControlPrefs {
  bindings: Bindings;
  broadsideMode: HoldMode;
  braceMode: HoldMode;
}

export const DEFAULT_BINDINGS: Readonly<Bindings> = {
  'gear-up': ['KeyW', 'ArrowUp'], 'gear-down': ['KeyS', 'ArrowDown'], port: ['KeyA', 'ArrowLeft'], starboard: ['KeyD', 'ArrowRight'],
  broadside: ['KeyQ', ''], special: ['KeyE', ''], ultimate: ['KeyR', ''], brace: ['Space', ''], boost: ['ShiftLeft', 'ShiftRight'],
};

/** Keys the run itself uses (pause, pause, roster): never bindable. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Escape', 'KeyP', 'Tab', 'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12']);

const STORE_KEY = 'cruise.controls.v2';
const SIM_ACTION: Partial<Record<BindAction, SimAction>> = {
  'gear-up': 'gear-up', 'gear-down': 'gear-down', broadside: 'broadside', special: 'special', ultimate: 'ultimate', brace: 'brace', boost: 'boost',
};

const cloneBindings = (b: Readonly<Bindings>): Bindings => {
  const out = {} as Bindings;
  for (const a of BIND_ACTIONS) out[a] = [b[a][0], b[a][1]];
  return out;
};

export function defaultControls(): ControlPrefs {
  return { bindings: cloneBindings(DEFAULT_BINDINGS), broadsideMode: 'hold', braceMode: 'hold' };
}

/** Anything (old data, hand edits) → valid prefs: known actions, no reserved keys, no key on two actions. */
export function sanitizeControls(raw: unknown): ControlPrefs {
  const out = defaultControls();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Partial<Record<keyof ControlPrefs, unknown>>;
  if (r.broadsideMode === 'toggle') out.broadsideMode = 'toggle';
  if (r.braceMode === 'toggle') out.braceMode = 'toggle';
  const b = r.bindings as Partial<Record<BindAction, unknown>> | undefined;
  if (b && typeof b === 'object') {
    const used = new Set<string>();
    for (const a of BIND_ACTIONS) {
      const slots = Array.isArray(b[a]) ? (b[a] as unknown[]) : null;
      if (!slots) { for (const c of out.bindings[a]) if (c) used.add(c); continue; }
      const next: [string, string] = ['', ''];
      for (let i = 0; i < 2; i++) {
        const c = slots[i];
        if (typeof c === 'string' && c && !RESERVED_KEYS.has(c) && !used.has(c)) { next[i] = c; used.add(c); }
      }
      out.bindings[a] = next;
    }
    // A defaulted action may now clash with a key the save gave to another action: drop the default's copy.
    const seen = new Map<string, BindAction>();
    for (const a of BIND_ACTIONS) for (let i = 0; i < 2; i++) {
      const c = out.bindings[a][i]!;
      if (!c) continue;
      if (seen.has(c)) out.bindings[a][i] = ''; else seen.set(c, a);
    }
  }
  return out;
}

/** Codes bound to more than one action (empty for sanitized prefs; the settings UI shows any it finds). */
export function bindingConflicts(b: Readonly<Bindings>): Map<string, BindAction[]> {
  const by = new Map<string, BindAction[]>();
  for (const a of BIND_ACTIONS) for (const c of b[a]) if (c) { const list = by.get(c) ?? []; list.push(a); by.set(c, list); }
  for (const [c, list] of by) if (list.length < 2) by.delete(c);
  return by;
}

export type RebindResult =
  | { ok: true; bindings: Bindings; swapped: BindAction | null }
  | { ok: false; reason: 'reserved' };

/**
 * Binds `code` to `action` in `slot`. If another action already uses it, that action takes over this slot's old key
 * (a swap), so nothing is left unbound; the caller reports the swap.
 */
export function rebind(b: Readonly<Bindings>, action: BindAction, slot: 0 | 1, code: string): RebindResult {
  if (RESERVED_KEYS.has(code)) return { ok: false, reason: 'reserved' };
  const next = cloneBindings(b);
  const old = next[action][slot];
  let swapped: BindAction | null = null;
  for (const a of BIND_ACTIONS) {
    for (let i = 0; i < 2; i++) {
      if (next[a][i] !== code || (a === action && i === slot)) continue;
      if (a === action) next[a][i] = old; // the key moves between this action's own slots
      else { next[a][i] = old; swapped = a; }
    }
  }
  next[action][slot] = code;
  return { ok: true, bindings: next, swapped };
}

/** Clears one slot (the primary slot of an action cannot be emptied while the secondary is empty). */
export function unbind(b: Readonly<Bindings>, action: BindAction, slot: 0 | 1): Bindings {
  const next = cloneBindings(b);
  next[action][slot] = '';
  if (!next[action][0] && next[action][1]) { next[action][0] = next[action][1]; next[action][1] = ''; }
  return next;
}

const NAMED: Readonly<Record<string, string>> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'SPACE', ShiftLeft: 'SHIFT', ShiftRight: 'R-SHIFT',
  ControlLeft: 'CTRL', ControlRight: 'R-CTRL', AltLeft: 'ALT', AltRight: 'R-ALT', Enter: 'ENTER', Backspace: 'BKSP',
  CapsLock: 'CAPS', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Delete: 'DEL', Insert: 'INS', Home: 'HOME', End: 'END',
  PageUp: 'PG UP', PageDown: 'PG DN', NumpadEnter: 'NUM ENT', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -',
  NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
};

/** Short keycap text for a KeyboardEvent.code ('KeyW' → 'W', 'ShiftLeft' → 'SHIFT', '' → '—'). */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad') && /\d$/.test(code)) return `NUM ${code.slice(6)}`;
  return NAMED[code] ?? code.toUpperCase();
}

type Listener = (prefs: Readonly<ControlPrefs>) => void;

/** Module-level control prefs (Input reads them; the settings UI edits them). Storage failures fall back to defaults. */
class ControlStore {
  private prefs: ControlPrefs | null = null;
  /** Bumped on every change (widgets showing keycaps re-read the labels when it moves). */
  version = 0;
  private readonly listeners = new Set<Listener>();
  /** Latched auto-repeat (toggle mode) for the HUD's AUTO badges. */
  readonly latched = { broadside: false, brace: false };

  get(): Readonly<ControlPrefs> {
    if (!this.prefs) {
      let raw: unknown = null;
      try { raw = JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) ?? 'null'); } catch { raw = null; }
      this.prefs = sanitizeControls(raw);
    }
    return this.prefs;
  }

  set(next: ControlPrefs): void {
    this.prefs = sanitizeControls(next);
    try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(this.prefs)); } catch { /* storage unavailable */ }
    if (this.prefs.broadsideMode === 'hold') this.latched.broadside = false;
    if (this.prefs.braceMode === 'hold') this.latched.brace = false;
    this.version++;
    for (const fn of this.listeners) fn(this.prefs);
  }

  reset(): void { this.set(defaultControls()); }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Keycap labels of an action's keys (primary first; empty slots skipped). */
  labels(action: BindAction): string[] {
    const out: string[] = [];
    for (const c of this.get().bindings[action]) if (c) out.push(keyLabel(c));
    return out;
  }
}

export const controls = new ControlStore();

// ───────────────────────────── Input ─────────────────────────────

export class Input {
  private readonly held = new Set<string>();
  private readonly queued: SimAction[] = [];
  private readonly snapshot: InputSnapshot = { steer: 0, throttleAxis: 0, pointerX: 0, pointerY: 0, pointerInside: false, broadsideHeld: false, stickAimX: 0, stickAimY: 0, usingGamepad: false };
  private enabled = true;
  private mouseDown = false;
  private padButtons: boolean[] = [];
  /** code → action, rebuilt when the bindings change. */
  private readonly byCode = new Map<string, BindAction>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly surface: HTMLElement) {
    this.rebuild(controls.get());
  }

  private rebuild(prefs: Readonly<ControlPrefs>): void {
    this.byCode.clear();
    for (const a of BIND_ACTIONS) for (const c of prefs.bindings[a]) if (c) this.byCode.set(c, a);
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.surface.addEventListener('pointermove', this.onPointer);
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointerleave', this.onLeave);
    this.unsubscribe = controls.subscribe((p) => this.rebuild(p));
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.surface.removeEventListener('pointermove', this.onPointer);
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointerleave', this.onLeave);
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  /** Releases every held key and button. Toggle latches survive (a level-up or pause does not switch AUTO off). */
  clear(): void { this.held.clear(); this.queued.length = 0; this.mouseDown = false; }

  /** Discrete actions since the last call. */
  drainActions(): SimAction[] { return this.queued.splice(0, this.queued.length); }

  private heldAction(action: BindAction): boolean {
    const [a, b] = controls.get().bindings[action];
    return (!!a && this.held.has(a)) || (!!b && this.held.has(b));
  }

  read(): Readonly<InputSnapshot> {
    const s = this.snapshot;
    const prefs = controls.get();
    s.steer = (this.heldAction('port') ? 1 : 0) - (this.heldAction('starboard') ? 1 : 0);
    s.throttleAxis = 0;
    const latch = controls.latched;
    s.broadsideHeld = this.enabled && (latch.broadside || (prefs.broadsideMode === 'hold' && (this.mouseDown || this.heldAction('broadside'))));
    let brace = this.enabled && (latch.brace || (prefs.braceMode === 'hold' && this.heldAction('brace')));
    brace = this.pollGamepad(s, brace);
    // Held / latched brace re-braces the moment the cooldown ends (the sim ignores a press while on cooldown).
    if (brace && !this.queued.includes('brace')) this.queued.push('brace');
    return s;
  }

  /** Returns whether brace is held on the pad (hold mode). */
  private pollGamepad(s: InputSnapshot, braceHeld: boolean): boolean {
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!pad) { s.usingGamepad = false; return braceHeld; }
    const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0), rx = dead(pad.axes[2] ?? 0), ry = dead(pad.axes[3] ?? 0);
    if (lx || ly || rx || ry || pad.buttons.some((b) => b.pressed)) s.usingGamepad = true;
    if (!s.usingGamepad || !this.enabled) return braceHeld;
    const prefs = controls.get();
    if (lx) s.steer = -lx;
    if (ly) s.throttleAxis = -ly;
    s.stickAimX = rx; s.stickAimY = ry;
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number) => pressed[i] && !this.padButtons[i];
    if (edge(7)) this.press('broadside');
    if (prefs.broadsideMode === 'hold' && (pad.buttons[7]?.value ?? 0) > 0.5) s.broadsideHeld = true;
    if (edge(4)) this.queued.push('special');
    if (edge(5)) this.queued.push('ultimate');
    if (edge(0)) this.press('brace');
    if (prefs.braceMode === 'hold' && pressed[0]) braceHeld = true;
    if (edge(1)) this.queued.push('boost');
    if (edge(12)) this.queued.push('gear-up');
    if (edge(13)) this.queued.push('gear-down');
    this.padButtons = pressed;
    return braceHeld;
  }

  /** A press of a bound action (keyboard, mouse or pad): toggle mode flips the latch, hold mode fires once. */
  private press(action: BindAction): void {
    const prefs = controls.get();
    if (action === 'broadside' && prefs.broadsideMode === 'toggle') {
      controls.latched.broadside = !controls.latched.broadside;
      if (controls.latched.broadside) this.queued.push('broadside');
      return;
    }
    if (action === 'brace' && prefs.braceMode === 'toggle') {
      controls.latched.brace = !controls.latched.brace;
      if (controls.latched.brace) this.queued.push('brace');
      return;
    }
    const sim = SIM_ACTION[action];
    if (sim) this.queued.push(sim);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.target instanceof HTMLInputElement) return;
    const action = this.byCode.get(event.code);
    if (action || event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (action && !event.repeat) this.press(action);
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
    if (event.button === 0 && this.enabled) { this.mouseDown = true; this.press('broadside'); }
  };

  private readonly onPointerUp = (event: PointerEvent): void => { if (event.button === 0) this.mouseDown = false; };
  private readonly onLeave = (): void => { this.snapshot.pointerInside = false; };
}
