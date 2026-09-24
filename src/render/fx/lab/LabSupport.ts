/**
 * FX lab support: an open-sea WorldQuery (no islands) and a PostServices stand-in that visualizes the juice
 * the FX system requests (flash, speed lines, impact frames, chromatic kicks) with DOM overlays, so effects
 * can be judged before the LOOK post stack lands.
 */
import type * as THREE from 'three';
import type { CircleHit, IslandDef, WorldQuery } from '../../../game/types';
import type { PostServices } from '../../frame';

export class OpenSea implements WorldQuery {
  readonly seed = 'fx-lab';
  islandsNear(_x: number, _z: number, _radius: number, out: IslandDef[] = []): IslandDef[] { out.length = 0; return out; }
  collideCircle(): CircleHit { return { hit: false, nx: 0, nz: 0, depth: 0 }; }
  isWater(): boolean { return true; }
  shoreDistance(_x: number, _z: number, max: number): number { return max; }
}

export class LabPost implements PostServices {
  private flashT = 0; private flashD = 0.12; private flashS = 0;
  private linesT = 0; private linesD = 0; private linesS = 0;
  private impactFrames = 0;
  private chromT = 0;
  readonly counts = { impact: 0, flash: 0, speedLines: 0, chromatic: 0 };
  private readonly flashEl = document.getElementById('flash') as HTMLDivElement | null;
  private readonly lines = document.getElementById('lines') as HTMLCanvasElement | null;
  private readonly g: CanvasRenderingContext2D | null;
  enabled = true;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.g = this.lines?.getContext('2d') ?? null;
  }

  impactFrame(strength = 1): void { if (strength > 0.2) { this.impactFrames = 2; this.counts.impact++; } }
  speedLines(strength: number, duration: number): void { this.linesS = Math.max(this.linesS, strength); this.linesD = Math.max(duration, 0.1); this.linesT = duration; this.counts.speedLines++; }
  flash(color: number, strength: number, duration = 0.15): void {
    this.flashS = strength; this.flashD = duration; this.flashT = duration; this.counts.flash++;
    if (this.flashEl) this.flashEl.style.background = `#${color.toString(16).padStart(6, '0')}`;
  }
  chromatic(_strength: number, duration = 0.2): void { this.chromT = duration; this.counts.chromatic++; }

  update(dt: number): void {
    const canvas = this.renderer.domElement;
    if (!this.enabled) { canvas.style.filter = ''; if (this.flashEl) this.flashEl.style.opacity = '0'; this.clearLines(); return; }
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.flashEl) this.flashEl.style.opacity = String(this.flashD > 0 ? (this.flashT / this.flashD) * this.flashS : 0);
    this.chromT = Math.max(0, this.chromT - dt);
    if (this.impactFrames > 0) {
      canvas.style.filter = this.impactFrames === 2 ? 'invert(1) grayscale(1) contrast(3)' : 'grayscale(1) contrast(4) brightness(1.3)';
      this.impactFrames--;
    } else canvas.style.filter = this.chromT > 0 ? 'saturate(1.35) contrast(1.08)' : '';
    this.linesT = Math.max(0, this.linesT - dt);
    this.drawLines();
  }

  private clearLines(): void {
    const c = this.lines; const g = this.g;
    if (c && g) g.clearRect(0, 0, c.width, c.height);
  }

  private drawLines(): void {
    const c = this.lines; const g = this.g;
    if (!c || !g) return;
    if (c.width !== innerWidth || c.height !== innerHeight) { c.width = innerWidth; c.height = innerHeight; }
    g.clearRect(0, 0, c.width, c.height);
    if (this.linesT <= 0) { this.linesS = 0; return; }
    const k = Math.min(1, this.linesT / Math.min(0.4, this.linesD)) * this.linesS;
    const cx = c.width / 2, cy = c.height / 2;
    const R = Math.hypot(cx, cy);
    g.fillStyle = 'rgba(20, 28, 60, 0.85)';
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = R * (0.55 + Math.random() * 0.3);
      const w = (0.004 + Math.random() * 0.01) * k;
      g.beginPath();
      g.moveTo(cx + Math.cos(a - w) * R * 1.1, cy + Math.sin(a - w) * R * 1.1);
      g.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a + w) * R * 1.1, cy + Math.sin(a + w) * R * 1.1);
      g.fill();
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void { this.renderer.render(scene, camera); }
}
