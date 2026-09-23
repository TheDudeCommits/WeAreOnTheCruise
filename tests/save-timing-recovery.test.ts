import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameSimulation } from '../src/simulation/GameSimulation';
import { isNavalSave } from '../src/simulation/saveValidation';
import { GameApp, preserveRejectedVoyage } from '../src/runtime/GameApp';
import rejectedRaw from './fixtures/negative-accumulator-save.json?raw';

// Stop startup immediately after persistence initialization, before graphics need a browser.
vi.mock('../src/render/app/RendererHost', () => ({ RendererHost: class {
  constructor() { throw new Error('graphics boundary'); }
} }));
afterEach(() => { vi.unstubAllGlobals(); });

describe('fractional frame saves', () => {
  it.each([1 / 60 - 5e-10, 1 / 60 - 1.3253287356462806e-15])('restores a normal frame with delta %s and continues its queued volley', (delta) => {
    const sim = new GameSimulation('fractional-frame-save');
    sim.returnToHarbor();
    expect(sim.startVoyage('lost-cargo', 'interceptor')).toBe(true);
    expect(sim.chooseRoute('leg-1-sheltered')).toBe(true);
    sim.setCrewPreset('gunnery');
    sim.setAction('fire-port', true);
    sim.update(delta);
    const saved = JSON.parse(JSON.stringify(sim.exportSave()));
    expect(saved.state.elapsed).toBeGreaterThan(0);
    expect(saved.accumulator).toBeGreaterThanOrEqual(0);
    expect(saved.projectiles.some((slot: { pending?: unknown }) => slot.pending)).toBe(true);
    expect(isNavalSave(saved)).toBe(true);
    const restored = new GameSimulation('different-seed');
    expect(restored.restoreSave(saved)).toBe(true);
    expect(restored.getState().voyage?.id).toBe(sim.getState().voyage?.id);
    expect(restored.getState().ships.find(ship => ship.isPlayer)?.crewPreset).toBe('gunnery');
    sim.clearActions();
    for (let frame = 0; frame < 60; frame += 1) {
      const nextDelta = frame % 2 ? 1 / 120 : 1 / 60 - 5e-10;
      sim.update(nextDelta); restored.update(nextDelta);
    }
    expect(restored.snapshot()).toEqual(sim.snapshot());
    expect(restored.exportSave().projectiles).toEqual(sim.exportSave().projectiles);
  });

  it('retains strict rejection of the exact browser underflow fixture', () => {
    // Build qBZRjr-I, ui-09-save-repro-02: natural RAF state, then immediate reload.
    const rejected = JSON.parse(rejectedRaw);
    expect(rejected.accumulator).toBe(-1.3253287356462806e-15);
    expect(isNavalSave(rejected)).toBe(false);
    const sim = new GameSimulation('unchanged-running-session');
    const before = sim.exportSave();
    expect(sim.restoreSave(rejected)).toBe(false);
    expect(sim.exportSave()).toEqual(before);
    expect(isNavalSave({ ...rejected, accumulator: 0 })).toBe(true);
  });
});

describe('rejected save preservation', () => {
  it('keeps exact bytes and earlier recovery copies without duplicating the same rejection', () => {
    const values = new Map([['cruise.voyage.v1', rejectedRaw], ['cruise.voyage.recovery.v1', 'earlier rejected save']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const key = preserveRejectedVoyage(storage, rejectedRaw);
    expect(key).toBe('cruise.voyage.recovery.v1.1');
    expect(values.get(key)).toBe(rejectedRaw);
    expect(values.get('cruise.voyage.recovery.v1')).toBe('earlier rejected save');
    expect(values.get('cruise.voyage.v1')).toBe(rejectedRaw);
    expect(preserveRejectedVoyage(storage, rejectedRaw)).toBe(key);
    expect(values.size).toBe(3);
  });

  it.each([false, true])('preserves rejected startup bytes before autosave when recovery storage is full: %s', async (storageFull) => {
    const values = new Map([['cruise.voyage.v1', rejectedRaw]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (storageFull && key.startsWith('cruise.voyage.recovery.')) throw new Error('quota exceeded');
        values.set(key, value);
      },
    });
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
    const root = { innerHTML: '', dataset: {} as Record<string, string> };
    const app = new GameApp(root as unknown as HTMLElement, { seed: 'fresh-session', initialScene: 'calm-sailing', captureMode: false, showHud: true, quality: 'auto' });
    await expect(app.start()).rejects.toThrow('graphics boundary');
    (app as unknown as { saveProgress(): void }).saveProgress();
    if (storageFull) {
      expect(root.dataset.saveRecovery).toBe('protected');
      expect(values.get('cruise.voyage.v1')).toBe(rejectedRaw);
      expect(values.size).toBe(1);
    } else {
      expect(root.dataset.saveRecovery).toBe('preserved');
      expect(values.get(root.dataset.saveRecoveryKey!)).toBe(rejectedRaw);
      expect(JSON.parse(values.get('cruise.voyage.v1')!).state.voyage.phase).toBe('harbor');
    }
  });
});
