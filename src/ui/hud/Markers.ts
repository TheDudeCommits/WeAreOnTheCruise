/**
 * Offscreen arrows and on-screen nameplates for what matters off the ship's bow (FLOW; FOES built the first version).
 *
 * Arrows, in priority order: bosses, named bounty captains, signal cutters marking you, the running world event's
 * anchor (`run.worldEvent.x/z`), elites, chests. Each sits where the ray from your ship towards its target meets the
 * edge of the safe zone (SafeZone: the viewport minus every fixed HUD widget), so no arrow lands on the skill bar,
 * loadout, ship ring, minimap or roster. Arrows that would overlap merge when they are the same kind (a ×N badge,
 * nearest distance shown) or slide along the edge once; anything still colliding is dropped, lowest priority first.
 *
 * Nameplates (title or class, affix tags, hull bar with the Shielded bubble) show over at most three on-screen elites
 * within 560 m: named captains first, then the nearest. A plate never covers a HUD widget, another plate, or (for
 * plain elites) your own ship.
 *
 * Split into measure() (every project() call, before any DOM write this frame: project() reads layout) and apply()
 * (DOM writes only).
 */
import type { ScreenPoint, UiFrame } from '../contracts';
import type { EliteAffixId } from '../../game/ids';
import type { EnemyState, RunState } from '../../game/types';
import { AFFIXES, ENEMIES } from '../../game/content/enemies';
import { h, TextCell } from '../core/dom';
import { glyph, icon, setIcon, type GlyphId } from '../core/icons';
import type { ScreenBasis } from './camera';
import { EVENT_GLYPH } from './EventTracker';
import type { SafeZone } from './SafeZone';
import '../../styles/foes.css';

type Kind = 'boss' | 'bounty' | 'signal' | 'event' | 'elite' | 'chest';
const PRIORITY: Readonly<Record<Kind, number>> = { boss: 0, bounty: 1, signal: 2, event: 3, elite: 4, chest: 5 };
const KIND_GLYPH: Readonly<Record<Kind, GlyphId>> = { boss: 'skull', bounty: 'skull', signal: 'flare', event: 'flare', elite: 'star', chest: 'chest' };
/** Arrows on screen at once. */
const MAX = 7;
const TARGETS = 64;
/** Elite nameplates on screen at once, and how far away a plate still shows (m). */
const PLATES = 3;
const PLATE_RANGE = 560;
/** Arrow footprint below its centre (the distance label), in u. */
const DOWN = 40;

/** Glyph fallbacks until PACE's affix-<id> icons land in /assets/icons. */
export const AFFIX_GLYPH: Readonly<Record<EliteAffixId, GlyphId>> = {
  swift: 'speed', armored: 'shield', volatile: 'burst', vampiric: 'plus', shielded: 'quake', splitting: 'skiff', burning: 'flame', commander: 'crown',
};
const affixIcon = (id: EliteAffixId): string => `/assets/icons/affix-${id}.png`;
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

interface Marker {
  el: HTMLElement; arrow: HTMLElement; icon: HTMLElement; dist: TextCell; label: HTMLElement; labelText: TextCell; tags: HTMLElement[];
  count: TextCell; kind: Kind | ''; key: string; on: boolean; x: number; y: number; a: number; lastDist: number; lastCount: number; edge: string;
}
interface Target { kind: Kind; x: number; z: number; d: number; rank: number; e: EnemyState | null }
/** An arrow's footprint: centre, extent above it (icon or icon + label), half width (icon or label). */
interface Placement { kind: Kind; x: number; y: number; a: number; d: number; e: EnemyState | null; count: number; up: number; hw: number }

interface Plate {
  el: HTMLElement; name: TextCell; sub: TextCell; hp: HTMLElement; shield: HTMLElement; tags: { el: HTMLElement; ico: HTMLElement; text: TextCell }[];
  id: number; on: boolean; x: number; y: number; hpv: number; shv: number; key: string;
}
interface PlateSpot { e: EnemyState | null; x: number; y: number; d: number }

export class Markers {
  readonly el: HTMLElement;
  private readonly pool: Marker[] = [];
  private readonly targets: Target[] = [];
  private readonly order: Target[] = [];
  private readonly placed: Placement[] = [];
  private readonly plates: Plate[] = [];
  private readonly spots: PlateSpot[] = [];
  private readonly markChip: HTMLElement;
  private markOn = false;
  private markX = 0;
  private markY = 0;
  private markWant = false;
  private count = 0;
  private plateCount = 0;
  private eventId = '';
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly v = { x: 0, y: 0 };
  /** QA: arrows merged or dropped last frame. */
  merged = 0;
  dropped = 0;

  constructor(private readonly zone: SafeZone) {
    this.el = h('div', 'cr-markers');
    for (let i = 0; i < PLATES; i++) {
      const name = h('span', 'cr-plate__name');
      const sub = h('span', 'cr-plate__sub');
      const hp = h('span', 'cr-plate__hp');
      const shield = h('span', 'cr-plate__shield');
      const tagsEl = h('span', 'cr-plate__tags');
      const tags = [0, 1].map(() => {
        const ico = icon(null, 'star', 'cr-plate__ico');
        const text = h('span', 'cr-plate__tagtext');
        const el = h('span', 'cr-plate__tag', ico, text);
        tagsEl.append(el);
        return { el, ico, text: new TextCell(text) };
      });
      const el = h('div', 'cr-plate', h('span', 'cr-plate__head', name, sub), tagsEl, h('span', 'cr-plate__bar', hp, shield));
      el.hidden = true;
      this.el.append(el);
      this.plates.push({ el, name: new TextCell(name), sub: new TextCell(sub), hp, shield, tags, id: -1, on: false, x: -1e4, y: -1e4, hpv: -1, shv: -1, key: '' });
      this.spots.push({ e: null, x: 0, y: 0, d: 0 });
    }
    for (let i = 0; i < MAX; i++) {
      const arrow = h('span', 'cr-marker__arrow');
      const ic = h('span', 'cr-marker__icon');
      const dist = h('span', 'cr-marker__dist');
      const count = h('span', 'cr-marker__count');
      const labelText = h('span', 'cr-marker__labeltext');
      const tagA = h('span', 'cr-marker__tag'), tagB = h('span', 'cr-marker__tag');
      const label = h('span', 'cr-marker__label', labelText, tagA, tagB);
      const el = h('div', 'cr-marker', arrow, ic, count, dist, label);
      el.hidden = true;
      label.hidden = true;
      this.el.append(el);
      this.pool.push({ el, arrow, icon: ic, dist: new TextCell(dist), label, labelText: new TextCell(labelText), tags: [tagA, tagB], count: new TextCell(count), kind: '', key: '', on: false, x: -1e4, y: -1e4, a: 99, lastDist: -1, lastCount: -1, edge: '' });
      this.placed.push({ kind: 'chest', x: 0, y: 0, a: 0, d: 0, e: null, count: 1, up: 0, hw: 0 });
    }
    for (let i = 0; i < TARGETS; i++) this.targets.push({ kind: 'chest', x: 0, z: 0, d: 0, rank: 0, e: null });
    this.markChip = h('div', 'cr-markchip', h('span', 'cr-markchip__icon', glyph('flare')), h('span', 'cr-markchip__text', 'Marked!'));
    this.markChip.hidden = true;
    this.el.append(this.markChip);
  }

  reset(): void {
    this.count = 0; this.plateCount = 0;
    for (const m of this.pool) { m.on = false; m.el.hidden = true; m.key = ''; m.lastCount = -1; }
    for (const p of this.plates) { p.on = false; p.el.hidden = true; p.id = -1; p.key = ''; }
    for (const s of this.spots) s.e = null;
    this.markWant = false; this.markOn = false; this.markChip.hidden = true;
  }

  /** Nameplate spots claimed this frame (the first plateSpotCount entries; captain plates keep clear of them). */
  get plateSpots(): readonly PlateSpot[] { return this.spots; }
  get plateSpotCount(): number { return this.plateCount; }

  /** Read phase: gathers targets and computes edge placements and nameplate spots (calls project()). */
  measure(f: UiFrame, run: Readonly<RunState>, basis: ScreenBasis): void {
    const p = run.player;
    const order = this.order;
    order.length = 0;
    let n = 0;
    const add = (kind: Kind, x: number, z: number, d: number, e: EnemyState | null): void => {
      if (n >= TARGETS) return;
      const t = this.targets[n++]!;
      t.kind = kind; t.x = x; t.z = z; t.d = d; t.e = e; t.rank = PRIORITY[kind] * 1e6 + d;
      order.push(t);
    };
    for (const b of run.bosses) if (b.life === 'alive') add('boss', b.x, b.z, Math.hypot(b.x - p.x, b.z - p.z), null);
    let marked = false;
    for (const e of run.enemies) {
      if (e.life !== 'alive' || e.hidden >= 1) continue;
      const signal = e.defId === 'signal-cutter' && (e.ai.markT ?? 0) > 0 && (e.ai.markRef ?? 0) === 0;
      if (signal) marked = true;
      if (!e.elite && !signal) continue;
      add(e.title ? 'bounty' : signal ? 'signal' : 'elite', e.x, e.z, Math.hypot(e.x - p.x, e.z - p.z), e);
    }
    const ev = run.worldEvent;
    if (ev && ev.x !== undefined && ev.z !== undefined) {
      // Same distance the tracker shows: to the edge of the event's area.
      const d = Math.hypot(ev.x - p.x, ev.z - p.z) - (ev.radius ?? 0);
      if (d > 15) { add('event', ev.x, ev.z, d, null); this.eventId = ev.id; }
    }
    for (const k of run.pickups) if (k.alive && k.kind === 'chest') add('chest', k.x, k.z, Math.hypot(k.x - p.x, k.z - p.z), null);
    // Insertion sort by rank (priority, then nearest).
    for (let i = 1; i < order.length; i++) {
      const t = order[i]!;
      let j = i - 1;
      while (j >= 0 && order[j]!.rank > t.rank) { order[j + 1] = order[j]!; j--; }
      order[j + 1] = t;
    }

    const zone = this.zone;
    const W = zone.width, H = zone.height, u = zone.u;
    // Marker body: icon (±24u), affix/title label above (−46u), distance below (+40u).
    const rx = 30 * u, ry = 44 * u;
    // The bottom band (ship ring, skill bar, loadout) is HUD: bottom-edge arrows ride just above it.
    const L = 34 * u, R = W - 34 * u, T = 64 * u, B = H - 150 * u;
    let used = 0, plates = 0;
    this.merged = 0; this.dropped = 0;
    for (let i = 0; i < order.length; i++) {
      const t = order[i]!;
      const e = t.e;
      const topY = e ? Math.max(6, ENEMIES[e.defId].length * 0.55) : 4;
      f.project(t.x, topY, t.z, this.sp);
      const onScreen = this.sp.visible && this.sp.x > L && this.sp.x < R && this.sp.y > T && this.sp.y < H - 44 * u;
      const covered = onScreen && zone.hits(this.sp.x, this.sp.y, 2, 2);
      // A plain elite or chest hidden under a HUD widget gets no arrow (it is close; the rest of the ship shows).
      if (covered && PRIORITY[t.kind] >= PRIORITY.elite) continue;
      if (onScreen && !covered) {
        if (e && e.elite && plates < PLATES && t.d <= PLATE_RANGE) {
          const px = this.plateX(e, this.sp.x, this.sp.y, plates, used, basis, u);
          if (!Number.isNaN(px)) { const s = this.spots[plates++]!; s.e = e; s.x = px; s.y = this.sp.y; s.d = t.d; }
        }
        continue;
      }
      if (!basis.ok) continue;
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
      s = Math.min(s, zone.rayEntry(ox, oy, dx, dy, rx, ry));
      if (!Number.isFinite(s) || s < 1) continue;
      let x = ox + dx * s, y = oy + dy * s;
      const onSide = Math.abs(dx) * (B - T) > Math.abs(dy) * (R - L);
      // Footprint: a title / affix tags / 'Signal' ride above the icon.
      const labelW = (e?.title ? e.title.length * 8 + 8 : t.kind === 'signal' ? 52 : 0) + (e ? Math.min(2, e.affixes.length) * 24 : 0);
      const up = (labelW > 0 ? 54 : 28) * u, hw = Math.max(28, labelW * 0.5) * u;
      // Overlaps an arrow already placed: merge (same kind) or slide once along the edge, else drop.
      const hit = this.overlap(x, y, up, hw, used, u);
      if (hit >= 0) {
        const o = this.placed[hit]!;
        if (o.kind === t.kind) { o.count++; this.merged++; continue; }
        if (onSide) y = y >= o.y ? o.y + (DOWN + 6) * u + up : o.y - o.up - (DOWN + 6) * u;
        else x = x >= o.x ? o.x + o.hw + hw + 6 * u : o.x - o.hw - hw - 6 * u;
        if (x < L || x > R || y < T || y > B || zone.hits(x, y, rx * 0.8, ry * 0.8) || this.overlap(x, y, up, hw, used, u) >= 0) { this.dropped++; continue; }
      }
      if (used >= MAX || this.onPlate(x, y, plates, u)) { this.dropped++; continue; }
      const pl = this.placed[used++]!;
      pl.kind = t.kind; pl.x = x; pl.y = y; pl.a = Math.atan2(dx, -dy); pl.d = t.d; pl.e = e; pl.count = 1; pl.up = up; pl.hw = hw;
    }
    this.count = used;
    this.plateCount = plates;
    // "Marked!" chip under the player's ship while a signal flare marks it.
    this.markWant = marked && p.alive && basis.ok;
    if (this.markWant) { this.markX = basis.sx; this.markY = basis.sy + 64 * u; }
  }

  /** Index of a placed arrow whose footprint meets this one (4u gap), or −1. */
  private overlap(x: number, y: number, up: number, hw: number, used: number, u: number): number {
    const down = DOWN * u, gap = 4 * u;
    for (let k = 0; k < used; k++) {
      const o = this.placed[k]!;
      if (Math.abs(o.x - x) < o.hw + hw + gap && y - up < o.y + down + gap && y + down > o.y - o.up - gap) return k;
    }
    return -1;
  }

  /** An arrow at (x, y) would sit on a nameplate already claimed this frame. */
  private onPlate(x: number, y: number, plates: number, u: number): boolean {
    for (let k = 0; k < plates; k++) {
      const s = this.spots[k]!;
      if (Math.abs(s.x - x) < 110 * u && y > s.y - 110 * u && y < s.y + 40 * u) return true;
    }
    return false;
  }

  /**
   * Where a nameplate over `e` (anchored at x, y; it hangs about 90u above) can go: x nudged inside the viewport, or
   * NaN when it would cover a HUD widget, an arrow, another plate or (plain elites) your own ship.
   */
  private plateX(e: EnemyState, x: number, y: number, placed: number, arrows: number, basis: ScreenBasis, u: number): number {
    const named = e.title !== null;
    const name = named ? e.title! : ENEMIES[e.defId].name;
    let tagsW = 0;
    for (let k = 0; k < e.affixes.length && k < 2; k++) tagsW += AFFIXES[e.affixes[k]!].name.length * 8 + 36;
    const hw = Math.max(name.length * (named ? 13 : 10), tagsW, named ? 150 : 96) * 0.5 * u + 6 * u;
    const W = this.zone.width;
    const cx = Math.min(Math.max(x, hw + 8 * u), W - hw - 8 * u);
    if (Math.abs(cx - x) > 170 * u || y - 92 * u < 24 * u) return Number.NaN;
    const cy = y - 46 * u;
    if (this.zone.hits(cx, cy, hw, 40 * u)) return Number.NaN;
    for (let k = 0; k < arrows; k++) {
      const o = this.placed[k]!;
      if (Math.abs(o.x - cx) < hw + o.hw && o.y - o.up < y && o.y + DOWN * u > y - 92 * u) return Number.NaN;
    }
    if (!named && basis.ok && Math.abs(cx - basis.sx) < hw + 40 * u && cy > basis.sy - 150 * u && cy < basis.sy + 70 * u) return Number.NaN;
    for (let k = 0; k < placed; k++) {
      const s = this.spots[k]!;
      if (Math.abs(s.x - cx) < hw + 90 * u && Math.abs(s.y - y) < 96 * u) return Number.NaN;
    }
    return cx;
  }

  /** Write phase. */
  apply(): void {
    for (let i = 0; i < MAX; i++) {
      const m = this.pool[i]!;
      if (i >= this.count) { if (m.on) { m.on = false; m.el.hidden = true; } continue; }
      const pl = this.placed[i]!;
      if (!m.on) { m.on = true; m.el.hidden = false; }
      const e = pl.e;
      const key = e ? `${e.id}:${e.affixes.join(',')}:${e.title ?? ''}:${pl.kind}` : pl.kind === 'event' ? `event:${this.eventId}` : pl.kind;
      if (key !== m.key) {
        m.key = key;
        if (m.kind !== pl.kind) { m.kind = pl.kind; m.el.dataset.kind = pl.kind; }
        if (pl.kind === 'event') m.el.dataset.event = this.eventId; else delete m.el.dataset.event;
        m.icon.replaceChildren(glyph(pl.kind === 'event' ? EVENT_GLYPH[this.eventId] ?? 'flare' : KIND_GLYPH[pl.kind]));
        const label = e?.title ?? (pl.kind === 'signal' ? 'Signal' : '');
        m.labelText.set(label);
        let tags = 0;
        for (let t = 0; t < 2; t++) {
          const tag = m.tags[t]!;
          const id = e?.affixes[t];
          if (!id) { tag.hidden = true; continue; }
          tags++;
          tag.hidden = false;
          tag.style.setProperty('--ax', hex(AFFIXES[id].color));
          tag.replaceChildren(icon(affixIcon(id), AFFIX_GLYPH[id], 'cr-marker__tagico'));
          tag.title = AFFIXES[id].name;
        }
        m.label.hidden = !label && tags === 0;
      }
      // Near a side edge the label hangs inwards instead of being cut off.
      const edge = pl.x < 150 * this.zone.u ? 'l' : pl.x > this.zone.width - 150 * this.zone.u ? 'r' : '';
      if (edge !== m.edge) { m.edge = edge; if (edge) m.el.dataset.edge = edge; else delete m.el.dataset.edge; }
      if (pl.count !== m.lastCount) { m.lastCount = pl.count; m.count.set(pl.count > 1 ? `×${pl.count}` : ''); }
      if (Math.abs(pl.x - m.x) >= 1 || Math.abs(pl.y - m.y) >= 1) { m.x = pl.x; m.y = pl.y; m.el.style.transform = `translate3d(${pl.x.toFixed(0)}px,${pl.y.toFixed(0)}px,0)`; }
      if (Math.abs(pl.a - m.a) > 0.02) { m.a = pl.a; m.arrow.style.transform = `rotate(${pl.a.toFixed(2)}rad)`; }
      const d = Math.round(pl.d / 10) * 10;
      if (d !== m.lastDist) { m.lastDist = d; m.dist.set(`${d}m`); }
    }
    this.applyPlates();
    if (this.markWant !== this.markOn) { this.markOn = this.markWant; this.markChip.hidden = !this.markWant; }
    if (this.markOn) this.markChip.style.transform = `translate3d(${this.markX.toFixed(0)}px,${this.markY.toFixed(0)}px,0)`;
  }

  private applyPlates(): void {
    for (let i = 0; i < PLATES; i++) {
      const plate = this.plates[i]!;
      const s = this.spots[i]!;
      const e = s.e;
      if (i >= this.plateCount || !e) { if (plate.on) { plate.on = false; plate.el.hidden = true; plate.id = -1; } continue; }
      if (!plate.on) { plate.on = true; plate.el.hidden = false; }
      const key = `${e.id}:${e.affixes.join(',')}:${e.title ?? ''}`;
      if (key !== plate.key) {
        plate.key = key;
        plate.id = e.id;
        plate.el.classList.toggle('is-named', e.title !== null);
        plate.name.set(e.title ?? ENEMIES[e.defId].name);
        plate.sub.set(e.title ? ENEMIES[e.defId].name : '');
        for (let t = 0; t < 2; t++) {
          const tag = plate.tags[t]!;
          const id = e.affixes[t];
          if (!id) { tag.el.hidden = true; continue; }
          tag.el.hidden = false;
          tag.el.style.setProperty('--ax', hex(AFFIXES[id].color));
          setIcon(tag.ico, affixIcon(id), AFFIX_GLYPH[id]);
          tag.text.set(AFFIXES[id].name);
        }
      }
      const shield = e.ai.shield ?? 0;
      const hull = Math.max(0, Math.min(1, (e.hp - shield) / Math.max(1, e.maxHp)));
      const sh = Math.max(0, Math.min(1, shield / Math.max(1, e.maxHp)));
      if (Math.abs(hull - plate.hpv) > 0.004) { plate.hpv = hull; plate.hp.style.transform = `scaleX(${hull.toFixed(3)})`; }
      if (Math.abs(sh - plate.shv) > 0.004) { plate.shv = sh; plate.shield.style.transform = `scaleX(${sh.toFixed(3)})`; }
      if (Math.abs(s.x - plate.x) >= 1 || Math.abs(s.y - plate.y) >= 1) {
        plate.x = s.x; plate.y = s.y;
        plate.el.style.transform = `translate3d(${s.x.toFixed(0)}px,${s.y.toFixed(0)}px,0)`;
      }
    }
  }
}
