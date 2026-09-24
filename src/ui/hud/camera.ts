/**
 * Screen-space basis of the world around the player, derived from UiFrame.project() once per frame. Lets the HUD
 * rotate the minimap with the camera and point offscreen/damage indicators without knowing the camera itself.
 */
import type { ScreenPoint, UiFrame } from '../contracts';

export class ScreenBasis {
  ok = false;
  /** Player position on screen (CSS px). */
  sx = 0;
  sy = 0;
  /** Screen displacement per metre towards world north (−Z) and east (+X). */
  nx = 0;
  ny = -1;
  ex = 1;
  ey = 0;
  /** Clockwise angle of world north from screen-up (radians). */
  north = 0;
  private readonly a: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly b: ScreenPoint = { x: 0, y: 0, visible: false };
  private readonly c: ScreenPoint = { x: 0, y: 0, visible: false };

  update(f: UiFrame, px: number, pz: number): void {
    const step = 24;
    f.project(px, 0, pz, this.a);
    f.project(px, 0, pz - step, this.b);
    f.project(px + step, 0, pz, this.c);
    const nx = (this.b.x - this.a.x) / step, ny = (this.b.y - this.a.y) / step;
    const ex = (this.c.x - this.a.x) / step, ey = (this.c.y - this.a.y) / step;
    if (!Number.isFinite(nx + ny + ex + ey) || (nx === 0 && ny === 0)) { this.ok = false; return; }
    this.ok = true;
    this.sx = this.a.x; this.sy = this.a.y;
    this.nx = nx; this.ny = ny; this.ex = ex; this.ey = ey;
    this.north = Math.atan2(nx, -ny);
  }

  /** Screen direction (not normalised) of a world offset from the player. */
  dir(dx: number, dz: number, out: { x: number; y: number }): { x: number; y: number } {
    out.x = this.ex * dx - this.nx * dz;
    out.y = this.ey * dx - this.ny * dz;
    return out;
  }
}
