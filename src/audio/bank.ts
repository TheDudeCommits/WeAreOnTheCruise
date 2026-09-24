/**
 * Sample bank (AUDIO-owned): fetches encoded files early (no AudioContext needed, nothing plays) and decodes
 * them after unlock, in tier order (menu first). Music is streamed by media elements and never decoded here.
 */

export type LoadTier = 'menu' | 'run';

type State = 'idle' | 'queued' | 'fetching' | 'fetched' | 'decoding' | 'ready' | 'failed';

interface Entry {
  file: string;
  url: string;
  tier: LoadTier;
  state: State;
  bytes: ArrayBuffer | null;
  buffer: AudioBuffer | null;
}

const FETCH_CONCURRENCY = 6;
const DECODE_CONCURRENCY = 3;

export class SampleBank {
  private readonly entries = new Map<string, Entry>();
  private readonly fetchQueue: Entry[] = [];
  private readonly decodeQueue: Entry[] = [];
  private activeFetches = 0;
  private activeDecodes = 0;
  private ctx: BaseAudioContext | null = null;
  private disposed = false;
  private readonly waiters = new Set<() => void>();
  /** Encoded bytes downloaded so far (lab/debug readout). */
  fetchedBytes = 0;

  constructor(private readonly baseUrl: string) {}

  register(file: string, tier: LoadTier): void {
    const existing = this.entries.get(file);
    if (existing) { if (tier === 'menu') existing.tier = 'menu'; return; }
    this.entries.set(file, { file, url: this.baseUrl + file, tier, state: 'idle', bytes: null, buffer: null });
  }

  /** Starts downloading every registered file of a tier. Safe before unlock (nothing is played). */
  prefetch(tier: LoadTier): void {
    for (const e of this.entries.values()) {
      if (e.tier === tier && e.state === 'idle') { e.state = 'queued'; this.fetchQueue.push(e); }
    }
    this.pumpFetch();
  }

  /** After unlock: decodes everything fetched so far (menu tier first) and each later download as it lands. */
  attach(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    const fetched = [...this.entries.values()].filter((e) => e.state === 'fetched');
    fetched.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'menu' ? -1 : 1));
    for (const e of fetched) this.queueDecode(e);
  }

  get(file: string): AudioBuffer | null {
    return this.entries.get(file)?.buffer ?? null;
  }

  counts(): { total: number; fetched: number; decoded: number; failed: number; bytes: number } {
    let fetched = 0, decoded = 0, failed = 0;
    for (const e of this.entries.values()) {
      if (e.state === 'fetched' || e.state === 'decoding' || e.state === 'ready') fetched++;
      if (e.state === 'ready') decoded++;
      if (e.state === 'failed') failed++;
    }
    return { total: this.entries.size, fetched, decoded, failed, bytes: this.fetchedBytes };
  }

  /** Resolves when every file of the tier is decoded or failed (requires attach()). */
  whenTierReady(tier: LoadTier): Promise<void> {
    this.prefetch(tier);
    const done = (): boolean => [...this.entries.values()].every((e) => e.tier !== tier || e.state === 'ready' || e.state === 'failed');
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const check = (): void => { if (this.disposed || done()) { this.waiters.delete(check); resolve(); } };
      this.waiters.add(check);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.fetchQueue.length = 0;
    this.decodeQueue.length = 0;
    this.entries.clear();
    this.ctx = null;
    for (const w of [...this.waiters]) w();
  }

  private notify(): void {
    for (const w of [...this.waiters]) w();
  }

  private pumpFetch(): void {
    while (!this.disposed && this.activeFetches < FETCH_CONCURRENCY && this.fetchQueue.length) {
      const e = this.fetchQueue.shift()!;
      if (e.state !== 'queued') continue;
      e.state = 'fetching';
      this.activeFetches++;
      fetch(e.url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((bytes) => {
          if (this.disposed) return;
          this.fetchedBytes += bytes.byteLength;
          e.bytes = bytes;
          e.state = 'fetched';
          if (this.ctx) this.queueDecode(e);
        })
        .catch((err: unknown) => { e.state = 'failed'; console.warn('[audio] fetch failed', e.url, err); this.notify(); })
        .finally(() => { this.activeFetches--; this.pumpFetch(); });
    }
  }

  private queueDecode(e: Entry): void {
    if (e.state !== 'fetched') return;
    e.state = 'decoding';
    this.decodeQueue.push(e);
    this.pumpDecode();
  }

  private pumpDecode(): void {
    const ctx = this.ctx;
    while (ctx && !this.disposed && this.activeDecodes < DECODE_CONCURRENCY && this.decodeQueue.length) {
      const e = this.decodeQueue.shift()!;
      const bytes = e.bytes;
      if (!bytes) { e.state = 'failed'; continue; }
      this.activeDecodes++;
      ctx.decodeAudioData(bytes)
        .then((buffer) => { if (this.disposed) return; e.buffer = buffer; e.bytes = null; e.state = 'ready'; })
        .catch((err: unknown) => { e.state = 'failed'; console.warn('[audio] decode failed', e.url, err); })
        .finally(() => { this.activeDecodes--; this.notify(); this.pumpDecode(); });
    }
  }
}
