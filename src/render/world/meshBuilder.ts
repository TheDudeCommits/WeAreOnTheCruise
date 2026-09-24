/**
 * Merge-everything geometry builder (WORLD-owned). Terrain, kit pieces and props are appended into one vertex-
 * coloured BufferGeometry per feature so an island costs one draw call. Primitive templates are cached.
 */
import * as THREE from 'three';

export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color) => void;

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpC = new THREE.Color();
const normalMatrix = new THREE.Matrix3();

export class MeshBuilder {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  idx: Uint32Array;
  vCount = 0;
  iCount = 0;

  constructor(vertexCapacity = 4096) {
    this.pos = new Float32Array(vertexCapacity * 3);
    this.nor = new Float32Array(vertexCapacity * 3);
    this.col = new Float32Array(vertexCapacity * 3);
    this.idx = new Uint32Array(vertexCapacity * 3);
  }

  private growV(extra: number): void {
    const need = (this.vCount + extra) * 3;
    if (need <= this.pos.length) return;
    const size = Math.max(need, this.pos.length * 2);
    const grow = (a: Float32Array) => { const b = new Float32Array(size); b.set(a); return b; };
    this.pos = grow(this.pos); this.nor = grow(this.nor); this.col = grow(this.col);
  }

  private growI(extra: number): void {
    const need = this.iCount + extra;
    if (need <= this.idx.length) return;
    const b = new Uint32Array(Math.max(need, this.idx.length * 2));
    b.set(this.idx);
    this.idx = b;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number): number {
    this.growV(1);
    const o = this.vCount * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.nor[o] = nx; this.nor[o + 1] = ny; this.nor[o + 2] = nz;
    this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = b;
    return this.vCount++;
  }

  tri(a: number, b: number, c: number): void {
    this.growI(3);
    this.idx[this.iCount++] = a; this.idx[this.iCount++] = b; this.idx[this.iCount++] = c;
  }

  setColor(v: number, color: THREE.Color): void {
    const o = v * 3;
    this.col[o] = color.r; this.col[o + 1] = color.g; this.col[o + 2] = color.b;
  }

  /** Recomputes smooth normals for vertices [v0, v1) from triangles [i0, i1) (indices must stay in range). */
  computeNormals(v0: number, v1: number, i0: number, i1: number): void {
    const p = this.pos, n = this.nor;
    n.fill(0, v0 * 3, v1 * 3);
    for (let t = i0; t < i1; t += 3) {
      const a = this.idx[t]! * 3, b = this.idx[t + 1]! * 3, c = this.idx[t + 2]! * 3;
      const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
      const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      for (const o of [a, b, c]) { n[o] = n[o]! + fx; n[o + 1] = n[o + 1]! + fy; n[o + 2] = n[o + 2]! + fz; }
    }
    for (let v = v0; v < v1; v++) {
      const o = v * 3;
      const l = Math.hypot(n[o]!, n[o + 1]!, n[o + 2]!);
      if (l > 1e-9) { n[o] = n[o]! / l; n[o + 1] = n[o + 1]! / l; n[o + 2] = n[o + 2]! / l; }
      else { n[o] = 0; n[o + 1] = 1; n[o + 2] = 0; }
    }
  }

  /** Appends a template geometry transformed by `m`, coloured by a colour or a per-vertex function. */
  append(geo: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color | ColorFn): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();
    normalMatrix.getNormalMatrix(m);
    const base = this.vCount;
    this.growV(pos.count);
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (nor) tmpN.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize(); else tmpN.set(0, 1, 0);
      if (typeof color === 'function') color(tmpV.x, tmpV.y, tmpV.z, tmpN.x, tmpN.y, tmpN.z, tmpC); else tmpC.copy(color);
      this.vertex(tmpV.x, tmpV.y, tmpV.z, tmpN.x, tmpN.y, tmpN.z, tmpC.r, tmpC.g, tmpC.b);
    }
    // Mirrored transforms flip winding.
    const flip = m.determinant() < 0;
    if (index) {
      this.growI(index.count);
      for (let i = 0; i < index.count; i += 3) {
        const a = base + index.getX(i), b = base + index.getX(i + 1), c = base + index.getX(i + 2);
        if (flip) this.tri(a, c, b); else this.tri(a, b, c);
      }
    } else {
      for (let i = 0; i < pos.count; i += 3) { if (flip) this.tri(base + i, base + i + 2, base + i + 1); else this.tri(base + i, base + i + 1, base + i + 2); }
    }
  }

  box(m: THREE.Matrix4, color: THREE.Color | ColorFn): void { this.append(templates.box(), m, color); }
  cylinder(m: THREE.Matrix4, color: THREE.Color | ColorFn, segments = 10, top = 1, bottom = 1, open = false): void {
    this.append(templates.cylinder(segments, top, bottom, open), m, color);
  }
  cone(m: THREE.Matrix4, color: THREE.Color | ColorFn, segments = 10): void { this.append(templates.cylinder(segments, 0, 1, false), m, color); }
  sphere(m: THREE.Matrix4, color: THREE.Color | ColorFn, detail = 1): void { this.append(templates.sphere(detail), m, color); }
  prism(m: THREE.Matrix4, color: THREE.Color | ColorFn): void { this.append(templates.prism(), m, color); }

  get empty(): boolean { return this.iCount === 0; }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.vCount * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.vCount * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.vCount * 3), 3));
    const idx = this.vCount > 65535 ? this.idx.slice(0, this.iCount) : Uint16Array.from(this.idx.subarray(0, this.iCount));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Cached unit primitives (centred at the origin; cylinders span y −0.5..0.5 with radius 1). */
export const templates = (() => {
  const cache = new Map<string, THREE.BufferGeometry>();
  const get = (key: string, make: () => THREE.BufferGeometry) => {
    let g = cache.get(key);
    if (!g) { g = make(); cache.set(key, g); }
    return g;
  };
  return {
    box: () => get('box', () => new THREE.BoxGeometry(1, 1, 1)),
    cylinder: (segments: number, top: number, bottom: number, open: boolean) =>
      get(`cyl:${segments}:${top}:${bottom}:${open}`, () => new THREE.CylinderGeometry(top, bottom, 1, segments, 1, open)),
    sphere: (detail: number) => get(`ico:${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),
    /** Gable prism: base −0.5..0.5 in X at y = 0, ridge at y = 1, extruded −0.5..0.5 in Z. */
    prism: () => get('prism', () => {
      const p = [
        // slopes
        -0.5, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, -0.5, -0.5, 0, -0.5,
        0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0.5, 0, 0.5,
        // gables
        -0.5, 0, 0.5, 0.5, 0, 0.5, 0, 1, 0.5,
        0.5, 0, -0.5, -0.5, 0, -0.5, 0, 1, -0.5,
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.computeVertexNormals();
      return g;
    }),
  };
})();

/** Composes a matrix from position, yaw, and scale (with optional pitch/roll). */
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const vp = new THREE.Vector3();
const vs = new THREE.Vector3();
export function trs(out: THREE.Matrix4, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, pitch = 0, roll = 0): THREE.Matrix4 {
  e.set(pitch, yaw, roll, 'YXZ');
  q.setFromEuler(e);
  return out.compose(vp.set(x, y, z), q, vs.set(sx, sy, sz));
}
