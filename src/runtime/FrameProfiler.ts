/**
 * Opt-in per-frame CPU breakdown for QA (window.__CRUISE__.profiler). Costs nothing while disabled.
 * Laps are cumulative per frame, so a part can be lapped more than once.
 */
export interface FrameSample { total: number; parts: Record<string, number> }

export class FrameProfiler {
  enabled = false;
  private start = 0;
  private t = 0;
  private parts: Record<string, number> = {};
  private readonly frames: FrameSample[] = [];

  begin(): void {
    if (!this.enabled) return;
    this.parts = {};
    this.start = this.t = performance.now();
  }

  lap(name: string): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.parts[name] = (this.parts[name] ?? 0) + now - this.t;
    this.t = now;
  }

  end(): void {
    if (!this.enabled) return;
    this.frames.push({ total: performance.now() - this.start, parts: this.parts });
    if (this.frames.length > 900) this.frames.shift();
  }

  reset(): void { this.frames.length = 0; }

  /** Mean and max per part over the recorded frames, plus the `worst` slowest frames with their breakdowns. */
  report(worst = 8): { frames: number; mean: Record<string, number>; max: Record<string, number>; worst: FrameSample[] } {
    const mean: Record<string, number> = {}, max: Record<string, number> = {};
    for (const f of this.frames) {
      for (const [k, v] of Object.entries(f.parts)) { mean[k] = (mean[k] ?? 0) + v; max[k] = Math.max(max[k] ?? 0, v); }
      mean.total = (mean.total ?? 0) + f.total; max.total = Math.max(max.total ?? 0, f.total);
    }
    const n = Math.max(1, this.frames.length);
    for (const k of Object.keys(mean)) mean[k] = +(mean[k]! / n).toFixed(3);
    for (const k of Object.keys(max)) max[k] = +max[k]!.toFixed(2);
    const slow = [...this.frames].sort((a, b) => b.total - a.total).slice(0, worst)
      .map((f) => ({ total: +f.total.toFixed(2), parts: Object.fromEntries(Object.entries(f.parts).map(([k, v]) => [k, +v.toFixed(2)])) }));
    return { frames: this.frames.length, mean, max, worst: slow };
  }
}
