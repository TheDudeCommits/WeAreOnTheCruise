/**
 * Idle-time work (PERF-owned): background loads, bakes and warm-up steps run in small slices between frames so they
 * never lengthen a frame's critical path or block input.
 *
 *   await idleSlice()                  → resolves in the next idle period with the time available (ms)
 *   await runSliced(generator, 5)      → steps a generator until each slice's budget is used, then waits for idle
 *   await nextFrame()                  → resolves after the next animation frame
 *
 * Without requestIdleCallback (Safari), slices fall back to short timeouts. Work that must finish is never starved:
 * every idle request carries a timeout, after which it runs as an ordinary task (still in a small slice).
 */

type IdleCb = (deadline: { timeRemaining(): number; didTimeout: boolean }) => void;

const ric: (cb: IdleCb, opts?: { timeout: number }) => number =
  typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? (cb, opts) => window.requestIdleCallback(cb, opts)
    : (cb) => setTimeout(() => cb({ didTimeout: true, timeRemaining: () => 4 }), 12) as unknown as number;

/** Resolves in the next idle period with the milliseconds available (clamped to 2..10; 4 after a timeout). */
export function idleSlice(timeout = 250): Promise<number> {
  return new Promise((resolve) => {
    ric((d) => resolve(d.didTimeout ? 4 : Math.max(2, Math.min(10, d.timeRemaining()))), { timeout });
  });
}

/** Resolves after the next animation frame (or a 16 ms timeout when rAF is unavailable). */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

/** Waits `ms` of wall time. */
export function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

/**
 * Runs `steps` in idle slices: each slice steps the generator until `budgetMs` (or the idle time left) is used,
 * then yields to the browser. Steps should be ≤ 1–2 ms each. Returns the generator's return value.
 */
export async function runSliced<T>(steps: Iterator<unknown, T>, budgetMs = 5, timeout = 250): Promise<T> {
  for (;;) {
    const slice = Math.min(budgetMs, await idleSlice(timeout));
    const t0 = performance.now();
    do {
      const r = steps.next();
      if (r.done) return r.value;
    } while (performance.now() - t0 < slice);
  }
}

/** Runs async tasks one after another, each starting in an idle period. Errors are reported and skipped. */
export async function runQueued(tasks: readonly (() => Promise<unknown> | unknown)[], label = 'idle'): Promise<void> {
  for (const task of tasks) {
    await idleSlice();
    try {
      await task();
    } catch (error) {
      console.warn(`[perf] ${label} task failed`, error);
    }
  }
}
