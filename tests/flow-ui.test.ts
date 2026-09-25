/** FLOW (round 2): remappable controls, safe-zone geometry, restored round-2 fields. Pure logic, no DOM. */
import { describe, expect, it } from 'vitest';
import {
  bindingConflicts, DEFAULT_BINDINGS, defaultControls, keyLabel, rebind, RESERVED_KEYS, sanitizeControls, unbind,
} from '../src/input/Input';
import { rayBox, SafeZone } from '../src/ui/hud/SafeZone';
import { mergeRestored } from '../src/ui/core/restore';
import { angleOffWind, inIrons } from '../src/ui/hud/wind';
import { knots } from '../src/ui/core/format';
import type { SeaState, Settings } from '../src/game/types';

describe('controls: bindings', () => {
  it('defaults have no conflicts and no reserved keys', () => {
    expect(bindingConflicts(DEFAULT_BINDINGS).size).toBe(0);
    for (const slots of Object.values(DEFAULT_BINDINGS)) for (const c of slots) expect(RESERVED_KEYS.has(c)).toBe(false);
  });

  it('rebinding a key another action uses swaps the two, leaving nothing unbound', () => {
    const r = rebind(DEFAULT_BINDINGS, 'boost', 0, 'KeyE');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swapped).toBe('special');
    expect(r.bindings.boost[0]).toBe('KeyE');
    expect(r.bindings.special[0]).toBe('ShiftLeft');
    expect(bindingConflicts(r.bindings).size).toBe(0);
  });

  it('moving a key between the same action’s slots swaps the slots', () => {
    const r = rebind(DEFAULT_BINDINGS, 'gear-up', 1, 'KeyW');
    expect(r.ok && r.bindings['gear-up']).toEqual(['ArrowUp', 'KeyW']);
    expect(r.ok && r.swapped).toBe(null);
  });

  it('refuses the run’s own keys', () => {
    for (const code of ['Escape', 'KeyP', 'Tab']) expect(rebind(DEFAULT_BINDINGS, 'brace', 0, code)).toEqual({ ok: false, reason: 'reserved' });
  });

  it('unbinding the primary slot promotes the secondary', () => {
    expect(unbind(DEFAULT_BINDINGS, 'boost', 0).boost).toEqual(['ShiftRight', '']);
  });

  it('sanitizes garbage, reserved keys and duplicates from storage', () => {
    expect(sanitizeControls('nope')).toEqual(defaultControls());
    const s = sanitizeControls({ broadsideMode: 'toggle', braceMode: 'weird', bindings: { brace: ['Tab', 'KeyB'], boost: ['KeyB', 7], 'gear-up': 'W' } });
    expect(s.broadsideMode).toBe('toggle');
    expect(s.braceMode).toBe('hold');
    expect(s.bindings.brace).toEqual(['', 'KeyB']);
    expect(s.bindings.boost).toEqual(['', '']);
    expect(s.bindings['gear-up']).toEqual(DEFAULT_BINDINGS['gear-up']);
    expect(bindingConflicts(s.bindings).size).toBe(0);
  });

  it('labels keys for keycaps', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ShiftLeft')).toBe('SHIFT');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Digit4')).toBe('4');
    expect(keyLabel('')).toBe('—');
  });
});

describe('HUD safe zone', () => {
  it('rayBox finds the entry distance and misses boxes behind the ray', () => {
    expect(rayBox(0, 0, 1, 0, 10, -5, 20, 5)).toBeCloseTo(10);
    expect(rayBox(0, 0, -1, 0, 10, -5, 20, 5)).toBe(Infinity);
    expect(rayBox(15, 0, 1, 0, 10, -5, 20, 5)).toBe(Infinity); // origin inside
  });

  it('hits() and rayEntry() respect the widget rects and the marker size', () => {
    const z = new SafeZone();
    z.resize(1600, 900, 1);
    z.blocks.set([1300, 0, 1600, 500]);
    z.count = 1;
    expect(z.hits(1290, 100, 20, 20)).toBe(true);
    expect(z.hits(1200, 100, 20, 20)).toBe(false);
    expect(z.rayEntry(800, 450, 1, 0, 30, 30)).toBeCloseTo(470);
    expect(z.u).toBe(1);
    z.resize(1280, 720, 1.2);
    expect(z.u).toBeCloseTo(0.96);
  });
});

describe('restored round-2 settings', () => {
  const base: Settings = { version: 2, masterVolume: 1, musicVolume: 1, sfxVolume: 1, muted: false, cameraShake: 1, damageNumbers: true, quality: 'auto', showFps: false };
  it('fills only fields the loader dropped', () => {
    const r = { hints: [], settings: { coach: false, hudScale: 1.1, colorBlind: 'deutan' as const } };
    expect(mergeRestored(base, r)).toMatchObject({ coach: false, hudScale: 1.1, colorBlind: 'deutan' });
    expect(mergeRestored({ ...base, coach: true, hudScale: 0.9, colorBlind: 'off' }, r)).toBe(null);
  });
});

describe('wind and speed readouts', () => {
  const sea = { windDir: 0.6, windStrength: 0.6 } as SeaState;
  it('in irons with the bow into the wind, not across or downwind', () => {
    expect(angleOffWind(0.6, sea)).toBeCloseTo(0);
    expect(inIrons(0.6, sea)).toBe(true);
    expect(inIrons(0.6 + Math.PI / 2, sea)).toBe(false);
    expect(inIrons(0.6 + Math.PI, sea)).toBe(false);
  });
  it('knots on the game scale', () => {
    expect(knots(30)).toBe(19);
    expect(knots(-30)).toBe(19);
  });
});
