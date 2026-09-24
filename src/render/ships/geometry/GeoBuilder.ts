/**
 * Small CPU mesh builder for procedural ship parts (SHIPS-owned). Every part is emitted with position, normal,
 * uv and a linear vertex colour so any number of parts merge into one BufferGeometry and render with a single
 * vertex-coloured toon material (optionally with an atlas map; untextured parts point their UVs at a white texel).
 */
import * as THREE from 'three';

/** UV of a pure-white texel in the fleet atlas (see atlas.ts). Untextured parts use it. */
export const WHITE_UV: readonly [number, number] = [0.995, 0.005];

const tmpColor = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();

export type ColorLike = THREE.ColorRepresentation;

export interface PartOptions {
  /** Placement. */
  at?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  color?: ColorLike;
  /** Overrides the white UV (e.g. to a region of the atlas): uvRect = [u0, v0, u1, v1] remaps 0..1 UVs. */
  uvRect?: [number, number, number, number];
  /** Flat shading (split normals per face) for faceted parts. */
  flat?: boolean;
}

/** Accumulates triangles; `build()` returns an indexed BufferGeometry. */
export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];

  get vertexCount(): number { return this.pos.length / 3; }

  /** Appends a three.js geometry (it is not modified). */
  add(geometry: THREE.BufferGeometry, opts: PartOptions = {}): this {
    let g = geometry;
    if (opts.flat) g = g.index ? g.toNonIndexed() : g;
    if (opts.flat) g.computeVertexNormals();
    const matrix = composeMatrix(opts);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute | undefined;
    const t = g.attributes.uv as THREE.BufferAttribute | undefined;
    const c = g.attributes.color as THREE.BufferAttribute | undefined;
    tmpColor.set(opts.color ?? 0xffffff);
    const base = this.vertexCount;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      if (n) { v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); this.nor.push(v.x, v.y, v.z); } else this.nor.push(0, 1, 0);
      if (opts.uvRect && t) {
        const [u0, v0, u1, v1] = opts.uvRect;
        this.uv.push(u0 + (u1 - u0) * t.getX(i), v0 + (v1 - v0) * t.getY(i));
      } else this.uv.push(WHITE_UV[0], WHITE_UV[1]);
      if (c) this.col.push(c.getX(i) * tmpColor.r, c.getY(i) * tmpColor.g, c.getZ(i) * tmpColor.b);
      else this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    if (g !== geometry) g.dispose();
    return this;
  }

  box(w: number, h: number, d: number, opts: PartOptions = {}): this { return this.addTemp(new THREE.BoxGeometry(w, h, d), opts); }
  /** Cylinder along +Y (use rot to lay it down). */
  cylinder(rTop: number, rBottom: number, h: number, segments = 10, opts: PartOptions = {}, open = false): this {
    return this.addTemp(new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open), opts);
  }
  sphere(r: number, w = 10, h = 8, opts: PartOptions = {}): this { return this.addTemp(new THREE.SphereGeometry(r, w, h), opts); }
  cone(r: number, h: number, segments = 10, opts: PartOptions = {}): this { return this.addTemp(new THREE.ConeGeometry(r, h, segments), opts); }
  torus(r: number, tube: number, radial = 6, tubular = 16, opts: PartOptions = {}, arc = Math.PI * 2): this {
    return this.addTemp(new THREE.TorusGeometry(r, tube, radial, tubular, arc), opts);
  }
  octa(r: number, opts: PartOptions = {}): this { return this.addTemp(new THREE.OctahedronGeometry(r, 0), { flat: true, ...opts }); }
  ico(r: number, detail = 0, opts: PartOptions = {}): this { return this.addTemp(new THREE.IcosahedronGeometry(r, detail), opts); }
  dodeca(r: number, opts: PartOptions = {}): this { return this.addTemp(new THREE.DodecahedronGeometry(r, 0), { flat: true, ...opts }); }
  plane(w: number, h: number, sx = 1, sy = 1, opts: PartOptions = {}): this { return this.addTemp(new THREE.PlaneGeometry(w, h, sx, sy), opts); }

  /** Raw triangle soup (already in local space). */
  raw(positions: readonly number[], indices: readonly number[], color: ColorLike, uvs?: readonly number[], normals?: readonly number[]): this {
    const base = this.vertexCount;
    tmpColor.set(color);
    for (let i = 0; i < positions.length / 3; i++) {
      this.pos.push(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      if (normals) this.nor.push(normals[i * 3]!, normals[i * 3 + 1]!, normals[i * 3 + 2]!); else this.nor.push(0, 0, 0);
      if (uvs) this.uv.push(uvs[i * 2]!, uvs[i * 2 + 1]!); else this.uv.push(WHITE_UV[0], WHITE_UV[1]);
      this.col.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    for (const i of indices) this.idx.push(base + i);
    if (!normals) this.recomputeNormals(base, this.vertexCount);
    return this;
  }

  private addTemp(g: THREE.BufferGeometry, opts: PartOptions): this { this.add(g, opts); g.dispose(); return this; }

  /** Recomputes smooth normals for a vertex range from the triangles that reference it. */
  private recomputeNormals(from: number, to: number): void {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = from; i < to; i++) { this.nor[i * 3] = 0; this.nor[i * 3 + 1] = 0; this.nor[i * 3 + 2] = 0; }
    for (let t = 0; t < this.idx.length; t += 3) {
      const i0 = this.idx[t]!, i1 = this.idx[t + 1]!, i2 = this.idx[t + 2]!;
      if (i0 < from || i0 >= to) continue;
      a.fromArray(this.pos, i0 * 3); b.fromArray(this.pos, i1 * 3); c.fromArray(this.pos, i2 * 3);
      n.subVectors(c, b).cross(a.sub(b));
      for (const i of [i0, i1, i2]) { this.nor[i * 3]! += n.x; this.nor[i * 3 + 1]! += n.y; this.nor[i * 3 + 2]! += n.z; }
    }
    for (let i = from; i < to; i++) {
      n.fromArray(this.nor, i * 3).normalize();
      if (n.lengthSq() === 0) n.set(0, 1, 0);
      this.nor[i * 3] = n.x; this.nor[i * 3 + 1] = n.y; this.nor[i * 3 + 2] = n.z;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export function composeMatrix(opts: PartOptions, out = tmpM): THREE.Matrix4 {
  const at = opts.at ?? [0, 0, 0];
  const rot = opts.rot ?? [0, 0, 0];
  const s = opts.scale ?? [1, 1, 1];
  tmpQ.setFromEuler(tmpE.set(rot[0], rot[1], rot[2], 'YXZ'));
  return out.compose(tmpP.set(at[0], at[1], at[2]), tmpQ, tmpS.set(s[0], s[1], s[2]));
}

/** Linear colour from a hex/string (for writing vertex colours by hand). */
export function linear(color: ColorLike, out = new THREE.Color()): THREE.Color { return out.set(color); }
