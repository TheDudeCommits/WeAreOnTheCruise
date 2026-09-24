/**
 * Terrain meshing (WORLD-owned): stitches a RingModel (src/world/surface.ts) into triangles and paints it with
 * vertex colours. The `water` ring is the IslandDef outline itself, so the mesh meets the sea exactly where the
 * simulation collides.
 *
 * Paint rules: wet dark band at the waterline, sand + wet sand on beaches, strata tones per absolute-height band
 * (darker under each ledge, vertical weathering streaks, moss drips from the rim), mossy upward ledges and dark
 * overhang undersides, grass tops with noise patches that turn to rock where steep.
 */
import * as THREE from 'three';
import { fbm, hash01, smoothstep, valueNoise } from '../../world/noise';
import type { RingModel, RingRole } from '../../world/surface';
import type { MeshBuilder } from './meshBuilder';
import type { TerrainPalette } from './palette';

const ROLE_ID: Record<RingRole, number> = {
  skirt: 0, water: 1, wet: 2, shore: 3, face: 4, ledge: 5, lip: 6, top: 7, 'tier-face': 4, 'tier-ledge': 5, 'tier-lip': 6,
};

const col = new THREE.Color();
const tmp = new THREE.Color();

export interface TerrainStats { vertices: number; triangles: number }

/** Appends one island's terrain (positions relative to `ox, oz`). */
export function appendTerrain(b: MeshBuilder, model: RingModel, pal: TerrainPalette, ox: number, oz: number): TerrainStats {
  const { n, sin, cos, surface } = model;
  const cx = surface.cx - ox, cz = surface.cz - oz;
  const v0 = b.vCount, i0 = b.iCount;
  const flip = !surface.ccw;
  let vertexTotal = 0;
  for (const s of model.sections) vertexTotal += s.rings.length * n;
  vertexTotal += 1;
  const role = new Uint8Array(vertexTotal);
  const band = new Int16Array(vertexTotal);
  const coast = new Int32Array(vertexTotal);
  const quad = (a: number, c: number, d: number, e: number) => {
    // a,c = lower ring j, j+1; d,e = upper ring j, j+1
    if (flip) { b.tri(a, d, c); b.tri(d, e, c); } else { b.tri(a, c, d); b.tri(d, c, e); }
  };
  for (let si = 0; si < model.sections.length; si++) {
    const section = model.sections[si]!;
    const start = b.vCount;
    for (const ring of section.rings) {
      const rid = ROLE_ID[ring.role];
      for (let j = 0; j < n; j++) {
        const r = ring.r[j]!;
        const v = b.vertex(cx + sin[j]! * r, ring.y[j]!, cz + cos[j]! * r, 0, 1, 0, 1, 1, 1) - v0;
        role[v] = rid; band[v] = ring.band; coast[v] = model.index[j]!;
      }
    }
    for (let k = 0; k < section.rings.length - 1; k++) {
      const lo = start + k * n, hi = lo + n;
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        quad(lo + j, lo + j1, hi + j, hi + j1);
      }
    }
    if (si === model.sections.length - 1) {
      const last = start + (section.rings.length - 1) * n;
      const centre = b.vertex(cx, model.centerY, cz, 0, 1, 0, 1, 1, 1) - v0;
      role[centre] = ROLE_ID.top; band[centre] = -1; coast[centre] = 0;
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        if (flip) b.tri(last + j, v0 + centre, last + j1); else b.tri(last + j, last + j1, v0 + centre);
      }
    }
  }
  b.computeNormals(v0, b.vCount, i0, b.iCount);

  // Paint.
  const shape = surface.shape;
  const strata = shape.strata;
  const seed = shape.spec.seed;
  const lush = pal.lush;
  for (let v = 0; v < b.vCount - v0; v++) {
    const o = (v0 + v) * 3;
    const x = b.pos[o]! + ox, y = b.pos[o + 1]!, z = b.pos[o + 2]! + oz;
    const ny = b.nor[o + 1]!;
    const ci = coast[v]!;
    const beach = surface.beach[ci]!;
    const H = surface.H[ci]!;
    const t = surface.theta[ci]!;
    const streak = valueNoise(seed + 7, t * 26, 0.5) * 0.5 + 0.5;
    const patch = fbm(seed + 3, x / 38, z / 38, 3);
    switch (role[v]) {
      case 0: case 1: col.copy(pal.wet).multiplyScalar(0.75); break;
      case 2: col.copy(pal.wet).lerp(pal.sandWet, beach); break;
      case 3: if (beach > 0.5) col.copy(pal.sand); else col.copy(pal.wet).lerp(pal.strata[0]!, 0.35); break;
      case 4: {
        const k = band[v]!;
        const bandDef = strata[Math.max(0, k)] ?? strata[0]!;
        if (ny > 0.72 && beach > 0.3) {
          // Gentle bank behind a beach: sand low, grass above.
          if (y < 2.9) col.copy(pal.sand);
          else grass(col, pal, patch, lush);
          break;
        }
        col.copy(pal.strata[bandDef.tone % pal.strata.length]!);
        const f = bandDef.top > bandDef.bottom ? (y - bandDef.bottom) / (bandDef.top - bandDef.bottom) : 1;
        col.multiplyScalar((0.8 + 0.24 * Math.min(1, Math.max(0, f))) * (0.84 + 0.18 * streak));
        // Moss drips from the grass rim (only on real cliffs).
        const drip = (1 - beach) * (1.5 + 7 * Math.max(0, valueNoise(seed + 11, t * 17, 2.5))) * lush;
        if (H - y < drip && H > 5) col.lerp(pal.moss, 0.78 * smoothstep(drip, drip * 0.4, H - y));
        // Wet rock near the waterline.
        if (y < 3.2) col.lerp(pal.wet, smoothstep(3.2, 1.4, y) * 0.8);
        break;
      }
      case 5: {
        const bandDef = strata[Math.max(0, band[v]!)] ?? strata[0]!;
        col.copy(pal.strata[bandDef.tone % pal.strata.length]!);
        if (ny > 0.35) col.lerp(pal.moss, (0.35 + 0.45 * hash01(seed, ci, band[v]!)) * lush);
        else if (ny < -0.3) col.multiplyScalar(0.58);
        break;
      }
      case 6: col.copy(pal.underside).lerp(pal.grassDark, 0.25 * lush); break;
      default: {
        const steep = 1 - ny;
        if (steep > 0.42 && lush > 0) {
          // Steep top: exposed rock in the strata tone for that height.
          let k = 0;
          while (k < strata.length - 1 && strata[k]!.top < y) k++;
          col.copy(pal.strata[strata[k]!.tone % pal.strata.length]!).multiplyScalar(0.92);
          col.lerp(pal.moss, smoothstep(0.75, 0.42, steep) * 0.5 * lush);
        } else if (y < 3.3 && beach > 0.5) {
          col.copy(pal.sand).lerp(pal.grass, smoothstep(2.6, 3.3, y) * 0.6);
        } else if (lush <= 0) {
          col.copy(pal.strata[1]!).lerp(pal.moss, Math.max(0, patch) * 0.6);
        } else {
          grass(col, pal, patch, lush);
        }
      }
    }
    b.col[o] = col.r; b.col[o + 1] = col.g; b.col[o + 2] = col.b;
  }
  return { vertices: b.vCount - v0, triangles: (b.iCount - i0) / 3 };
}

function grass(out: THREE.Color, pal: TerrainPalette, patch: number, lush: number): void {
  const p = patch * 1.6;
  if (p > 0.25) out.copy(pal.grass).lerp(pal.grassLight, Math.min(1, (p - 0.25) * 1.8));
  else out.copy(pal.grass).lerp(pal.grassDark, Math.min(1, (0.25 - p) * 1.4));
  if (lush < 1) out.lerp(tmp.copy(pal.strata[1]!), (1 - lush) * 0.45);
}
