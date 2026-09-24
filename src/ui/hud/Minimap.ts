/**
 * Minimap with a compass rim, rotated with the camera (screen-up = camera forward). Enemies are coloured by
 * faction; elites and bosses are bigger; chests are gold. Drawn on a small canvas at ~30 Hz.
 * Islands are drawn from the run's WorldQuery as sand-filled coastlines, clipped to the map disc.
 * A wind arrow rides the rim, pointing where the wind blows (bigger in a stronger wind; red while you sail in irons).
 */
import type { IslandDef, RunState, Settings, WorldQuery } from '../../game/types';
import { h, svg } from '../core/dom';
import { FACTION_COLOR, FACTION_EDGE } from '../core/names';
import type { ScreenBasis } from './camera';
import { inIrons } from './wind';

const RANGE = 460;
/** Red-green colour blindness (Settings.colorBlind deutan/protan): corsair red becomes magenta on the map. */
const FACTION_COLOR_CB: Readonly<Record<string, string>> = { ...FACTION_COLOR, corsair: '#ff4fd8' };
const LETTERS = ['N', 'E', 'S', 'W'] as const;

export class Minimap {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly rim: SVGGElement;
  private readonly letters: SVGTextElement[] = [];
  private size = 0;
  private cssSize = 0;
  private dpr = 1;
  private readonly observer: ResizeObserver | null;
  private acc = 0;
  private lastNorth = Number.NaN;
  private pulse = 0;
  private readonly islands: IslandDef[] = [];
  private readonly wind: SVGGElement;
  private lastWind = Number.NaN;
  private lastWindScale = -1;
  private windIrons = false;

  constructor() {
    this.canvas = h('canvas', 'cr-minimap__canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.rim = svg('g', { class: 'cr-minimap__letters' });
    const ticks = svg('g', { class: 'cr-minimap__ticks' });
    for (let i = 0; i < 36; i++) {
      const a = (i * Math.PI) / 18;
      const r1 = 99, r2 = i % 9 === 0 ? 91 : 95;
      ticks.append(svg('line', { x1: 100 + Math.sin(a) * r1, y1: 100 - Math.cos(a) * r1, x2: 100 + Math.sin(a) * r2, y2: 100 - Math.cos(a) * r2 }));
    }
    for (const l of LETTERS) {
      const t = svg('text', { class: `cr-minimap__letter${l === 'N' ? ' is-n' : ''}`, x: 100, y: 100, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = l;
      this.letters.push(t);
      this.rim.append(t);
    }
    // Wind arrow, drawn pointing up at the top of the rim; rotated about the centre to where the wind blows.
    this.wind = svg('g', { class: 'cr-minimap__wind' },
      svg('path', { class: 'cr-minimap__windtail', d: 'M100 24 C 96 18, 104 14, 100 8 M92 22 C 89 17, 95 14, 92 9 M108 22 C 111 17, 105 14, 108 9' }),
      svg('path', { class: 'cr-minimap__windhead', d: 'M100 -9 L111 7 L100 3 L89 7 Z' }),
    );
    const rimSvg = svg('svg', { class: 'cr-minimap__rim', viewBox: '0 0 200 200', 'aria-hidden': 'true' },
      svg('circle', { class: 'cr-minimap__ring', cx: 100, cy: 100, r: 97 }),
      svg('circle', { class: 'cr-minimap__range', cx: 100, cy: 100, r: 36 }),
      svg('circle', { class: 'cr-minimap__range is-outer', cx: 100, cy: 100, r: 72 }),
      ticks,
      this.rim,
      this.wind,
    );
    this.el = h('div', 'cr-minimap', h('div', 'cr-minimap__sea'), this.canvas, rimSvg, h('div', 'cr-minimap__glass'));
    this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
      for (const e of entries) this.cssSize = Math.round(e.contentRect.width);
      this.allocate();
    }) : null;
    this.observer?.observe(this.el);
  }

  dispose(): void { this.observer?.disconnect(); }

  /** Sizes the backing store (done when observed, not on the first sailing frame). */
  private allocate(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.cssSize === this.size && dpr === this.dpr) return;
    this.size = this.cssSize; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(this.size * dpr));
    this.canvas.height = Math.max(1, Math.round(this.size * dpr));
    // Warm the 2D context (first draw initialises the backing surface) outside the sailing frames.
    const ctx = this.ctx;
    if (ctx) { ctx.beginPath(); ctx.arc(4, 4, 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke(); ctx.fillRect(0, 0, 2, 2); ctx.strokeRect(0, 0, 2, 2); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }
  }

  reset(): void { this.lastNorth = Number.NaN; this.lastWind = Number.NaN; this.lastWindScale = -1; this.acc = 1; }

  update(run: Readonly<RunState>, basis: ScreenBasis, dt: number, world: WorldQuery | null = null, colorBlind: Settings['colorBlind'] = 'off'): void {
    const faction = colorBlind === 'deutan' || colorBlind === 'protan' ? FACTION_COLOR_CB : FACTION_COLOR;
    this.acc += dt;
    this.pulse += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const ctx = this.ctx;
    if (!ctx) return;
    this.allocate();
    const dpr = this.dpr;
    const S = this.size;
    if (S <= 0) return;
    const theta = basis.ok ? basis.north : 0;
    if (Math.abs(theta - this.lastNorth) > 0.004 || Number.isNaN(this.lastNorth)) {
      this.lastNorth = theta;
      for (let i = 0; i < 4; i++) {
        const a = theta + (i * Math.PI) / 2;
        this.letters[i]!.setAttribute('x', (100 + Math.sin(a) * 84).toFixed(1));
        this.letters[i]!.setAttribute('y', (100 - Math.cos(a) * 84).toFixed(1));
      }
    }
    // Wind: blows toward world (sin w, cos w); compass bearing π − w, drawn clockwise from screen-up like the letters.
    const sea = run.sea;
    const wa = theta + Math.PI - sea.windDir;
    const ws = Math.round((0.8 + 0.35 * Math.min(1.5, Math.max(0, sea.windStrength))) * 20) / 20;
    if (Math.abs(Math.atan2(Math.sin(wa - this.lastWind), Math.cos(wa - this.lastWind))) > 0.01 || Number.isNaN(this.lastWind) || ws !== this.lastWindScale) {
      this.lastWind = wa; this.lastWindScale = ws;
      this.wind.setAttribute('transform', `rotate(${((wa * 180) / Math.PI).toFixed(1)} 100 100) translate(100 0) scale(${ws}) translate(-100 0)`);
    }
    const irons = run.player.alive && run.player.gear > 0 && inIrons(run.player.heading, sea);
    if (irons !== this.windIrons) { this.windIrons = irons; this.wind.classList.toggle('is-irons', irons); }
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const p = run.player;
    const half = S / 2;
    const edge = half * 0.72;
    const scale = edge / RANGE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.lineWidth = 1.5;

    const plot = (x: number, z: number, out: { x: number; y: number; clamped: boolean }) => {
      const e = x - p.x, n = -(z - p.z);
      let mx = (e * cos + n * sin) * scale;
      let my = (e * sin - n * cos) * scale;
      const d = Math.hypot(mx, my);
      out.clamped = d > edge;
      if (out.clamped) { mx *= edge / d; my *= edge / d; }
      out.x = half + mx; out.y = half + my;
      return out;
    };
    const pt = { x: 0, y: 0, clamped: false };

    // Islands (clipped to the map disc; outlines are unclamped so coasts cross the rim cleanly).
    if (world) {
      const near = world.islandsNear(p.x, p.z, RANGE * 1.45, this.islands);
      if (near.length) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(half, half, edge + 6, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#e8c98a';
        ctx.strokeStyle = '#7a5a2a';
        ctx.lineWidth = 1.4;
        for (const isl of near) {
          ctx.beginPath();
          for (let i = 0; i < isl.outline.length; i++) {
            const v = isl.outline[i]!;
            const e = v.x - p.x, n = -(v.z - p.z);
            const mx = half + (e * cos + n * sin) * scale, my = half + (e * sin - n * cos) * scale;
            if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // World event area (EVENTS sets run.worldEvent.x/z/radius): a dashed gold ring.
    const ev = run.worldEvent;
    if (ev && ev.x !== undefined && ev.z !== undefined) {
      plot(ev.x, ev.z, pt);
      const r = Math.max(5, (ev.radius ?? 40) * scale);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.clamped ? 6 : Math.min(r, edge), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 207, 51, 0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Chests.
    for (const k of run.pickups) {
      if (!k.alive || k.kind !== 'chest') continue;
      plot(k.x, k.z, pt);
      ctx.fillStyle = '#ffcf33';
      ctx.strokeStyle = '#5a3200';
      ctx.fillRect(pt.x - 4, pt.y - 3.5, 8, 7);
      ctx.strokeRect(pt.x - 4, pt.y - 3.5, 8, 7);
    }
    // Enemies (normal first, elites on top).
    for (let pass = 0; pass < 2; pass++) {
      for (const en of run.enemies) {
        if (en.life !== 'alive' || en.hidden >= 1 || en.elite !== (pass === 1)) continue;
        plot(en.x, en.z, pt);
        const r = en.elite ? 4.6 : 2.7;
        ctx.globalAlpha = pt.clamped ? 0.55 : 1;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.clamped ? r * 0.8 : r, 0, Math.PI * 2);
        ctx.fillStyle = faction[en.faction]!;
        ctx.fill();
        ctx.strokeStyle = en.elite ? '#ffcf33' : FACTION_EDGE[en.faction];
        ctx.lineWidth = en.elite ? 2 : 1.2;
        ctx.stroke();
        if (en.title) {
          // Named bounty captain (FOES): a pulsing orange halo around the elite dot.
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 7.5 + Math.sin(this.pulse * 5) * 1.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 138, 28, .95)';
          ctx.lineWidth = 2.2;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    // Bosses.
    for (const b of run.bosses) {
      if (b.life !== 'alive') continue;
      plot(b.x, b.z, pt);
      const pr = 9 + Math.sin(this.pulse * 6) * 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pr + 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,74,61,.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ff4a3d';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // AI captains: teal arrows (friendly), hollow while sunk.
    for (const k of run.captains) {
      plot(k.x, k.z, pt);
      const fe2 = -Math.sin(k.heading), fn2 = Math.cos(k.heading);
      const a2 = Math.atan2(fe2 * cos + fn2 * sin, -(fe2 * sin - fn2 * cos));
      ctx.save();
      ctx.globalAlpha = pt.clamped ? 0.6 : 1;
      ctx.translate(pt.x, pt.y);
      ctx.rotate(a2);
      ctx.beginPath();
      ctx.moveTo(0, -6.5);
      ctx.lineTo(4.8, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.8, 5);
      ctx.closePath();
      ctx.fillStyle = k.alive ? '#3fe0c8' : 'rgba(63, 224, 200, 0)';
      ctx.fill();
      ctx.strokeStyle = k.alive ? '#0b1026' : '#3fe0c8';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.restore();
    }

    // Player arrow.
    const fe = -Math.sin(p.heading), fn = Math.cos(p.heading);
    const ax = fe * cos + fn * sin, ay = fe * sin - fn * cos;
    const ang = Math.atan2(ax, -ay);
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fillStyle = '#ffcf33';
    ctx.fill();
    ctx.strokeStyle = '#0b1026';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
