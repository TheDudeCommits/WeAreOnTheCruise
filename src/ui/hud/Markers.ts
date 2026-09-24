/** Offscreen arrows for bosses, elites and chests, placed on the screen edge via UiFrame.project(). */
import type { ScreenPoint, UiFrame } from '../contracts';
import type { RunState } from '../../game/types';
import { h, TextCell } from '../core/dom';
import { glyph } from '../core/icons';
import type { ScreenBasis } from './camera';

type Kind = 'boss' | 'elite' | 'chest';
const MAX = 8;

interface Marker { el: HTMLElement; arrow: HTMLElement; dist: TextCell; kind: Kind | ''; on: boolean; x: number; y: number; a: number; lastDist: number }
interface Target { kind: Kind; x: number; z: number; d: number }

export class Markers {
  readonly el: HTMLElement;
  private readonly pool: Marker[] = [];
  private readonly targets: Target[] = [];
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly v = { x: 0, y: 0 };
  width = 1600;
  height = 900;

  constructor() {
    this.el = h('div', 'cr-markers');
    for (let i = 0; i < MAX; i++) {
      const arrow = h('span', 'cr-marker__arrow');
      const icon = h('span', 'cr-marker__icon');
      const dist = h('span', 'cr-marker__dist');
      const el = h('div', 'cr-marker', arrow, icon, dist);
      el.hidden = true;
      this.el.append(el);
      this.pool.push({ el, arrow, dist: new TextCell(dist), kind: '', on: false, x: -1, y: -1, a: 99, lastDist: -1 });
    }
    for (let i = 0; i < 64; i++) this.targets.push({ kind: 'chest', x: 0, z: 0, d: 0 });
  }

  reset(): void { for (const m of this.pool) { m.on = false; m.el.hidden = true; } }

  update(f: UiFrame, run: Readonly<RunState>, basis: ScreenBasis): void {
    const p = run.player;
    let n = 0;
    const push = (kind: Kind, x: number, z: number) => {
      if (n >= this.targets.length) return;
      const t = this.targets[n++]!;
      t.kind = kind; t.x = x; t.z = z; t.d = Math.hypot(x - p.x, z - p.z);
    };
    for (const b of run.bosses) if (b.life === 'alive') push('boss', b.x, b.z);
    for (const e of run.enemies) if (e.elite && e.life === 'alive') push('elite', e.x, e.z);
    for (const k of run.pickups) if (k.alive && k.kind === 'chest') push('chest', k.x, k.z);
    // Bosses first, then nearest.
    const list = this.targets;
    for (let i = 1; i < n; i++) {
      const t = list[i]!;
      let j = i - 1;
      const rank = (q: Target) => (q.kind === 'boss' ? 0 : 1) * 1e6 + q.d;
      const rt = rank(t);
      while (j >= 0 && rank(list[j]!) > rt) { list[j + 1] = list[j]!; j--; }
      list[j + 1] = t;
    }
    const W = this.width, H = this.height;
    const u = Math.max(0.72, Math.min(1.7, Math.min(W / 1600, H / 900)));
    let bossUp = false;
    for (const b of run.bosses) if (b.life !== 'dead') { bossUp = true; break; }
    const L = 56 * u, T = (bossUp ? 200 : 124) * u, R = W - 56 * u, B = H - 214 * u;
    let used = 0;
    for (let i = 0; i < n && used < MAX; i++) {
      const t = list[i]!;
      f.project(t.x, 4, t.z, this.sp);
      const inside = this.sp.visible && this.sp.x > L && this.sp.x < R && this.sp.y > T && this.sp.y < B;
      if (inside || !basis.ok) continue;
      basis.dir(t.x - p.x, t.z - p.z, this.v);
      const len = Math.hypot(this.v.x, this.v.y);
      if (len < 1e-6) continue;
      const dx = this.v.x / len, dy = this.v.y / len;
      const ox = Math.min(Math.max(basis.sx, L + 1), R - 1), oy = Math.min(Math.max(basis.sy, T + 1), B - 1);
      let s = Infinity;
      if (dx > 1e-6) s = Math.min(s, (R - ox) / dx);
      if (dx < -1e-6) s = Math.min(s, (L - ox) / dx);
      if (dy > 1e-6) s = Math.min(s, (B - oy) / dy);
      if (dy < -1e-6) s = Math.min(s, (T - oy) / dy);
      if (!Number.isFinite(s)) continue;
      let x = ox + dx * s, y = oy + dy * s;
      // Keep clear of the fixed HUD blocks (minimap, ship ring + statuses, loadout).
      if (x > W - 260 * u && y < 262 * u) y = 262 * u;
      if (x < 430 * u && y > H - 330 * u) y = H - 330 * u;
      if (x > W - 460 * u && y > H - 214 * u) y = H - 214 * u;
      const m = this.pool[used++]!;
      this.place(m, t, x, y, Math.atan2(dx, -dy));
    }
    for (let i = used; i < MAX; i++) { const m = this.pool[i]!; if (m.on) { m.on = false; m.el.hidden = true; } }
  }

  private place(m: Marker, t: Target, x: number, y: number, angle: number): void {
    if (!m.on) { m.on = true; m.el.hidden = false; }
    if (m.kind !== t.kind) {
      m.kind = t.kind;
      m.el.dataset.kind = t.kind;
      (m.el.children[1] as HTMLElement).replaceChildren(glyph(t.kind === 'boss' ? 'skull' : t.kind === 'elite' ? 'star' : 'chest'));
    }
    if (Math.abs(x - m.x) > 0.5 || Math.abs(y - m.y) > 0.5) { m.x = x; m.y = y; m.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; }
    if (Math.abs(angle - m.a) > 0.01) { m.a = angle; m.arrow.style.transform = `rotate(${angle.toFixed(3)}rad)`; }
    const d = Math.round(t.d / 10) * 10;
    if (d !== m.lastDist) { m.lastDist = d; m.dist.set(`${d}m`); }
  }
}
