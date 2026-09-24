/**
 * Optional GPU timing for the ocean passes (OCEAN-owned, debug only): EXT_disjoint_timer_query_webgl2 queries
 * around labelled sections, polled without stalling. Disabled unless OceanSystem.enableGpuTiming(true).
 */
interface Pending { label: string; query: WebGLQuery }

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class GpuTimer {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: TimerExt | null;
  private readonly pending: Pending[] = [];
  private readonly free: WebGLQuery[] = [];
  private active: Pending | null = null;
  /** Exponential moving averages in milliseconds, per label. */
  readonly ms: Record<string, number> = {};
  /** Samples collected per label. */
  readonly samples: Record<string, number> = {};

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get available(): boolean { return this.ext !== null; }

  begin(label: string): void {
    if (!this.ext || this.active) return;
    const query = this.free.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { label, query };
  }

  end(label: string): void {
    if (!this.ext || !this.active || this.active.label !== label) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collects finished queries (call once per frame). */
  poll(): void {
    if (!this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    for (let i = 0; i < this.pending.length; ) {
      const p = this.pending[i]!;
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) { i++; continue; }
      if (!disjoint) {
        const ms = (gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number) / 1e6;
        const n = (this.samples[p.label] ?? 0) + 1;
        this.samples[p.label] = n;
        const prev = this.ms[p.label] ?? ms;
        this.ms[p.label] = n < 10 ? prev + (ms - prev) / n : prev + (ms - prev) * 0.05;
      }
      this.free.push(p.query);
      this.pending[i] = this.pending[this.pending.length - 1]!;
      this.pending.pop();
    }
  }

  reset(): void {
    for (const key of Object.keys(this.ms)) { delete this.ms[key]; delete this.samples[key]; }
  }

  dispose(): void {
    for (const q of this.free) this.gl.deleteQuery(q);
    for (const p of this.pending) this.gl.deleteQuery(p.query);
    this.free.length = 0;
    this.pending.length = 0;
  }
}
