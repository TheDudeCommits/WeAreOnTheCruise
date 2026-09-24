/**
 * Small inked toon props, instanced per shape and rebuilt every frame from RunState: treasure coins (copper,
 * silver, doubloons, compass), gold bars, repair crates, chests, barrels / powder kegs, tide mines.
 * Procedural geometry with baked vertex colours (wood, iron hoops, gold trim); instance colour tints them.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial, markInk } from '../../materials/toon';
import { uploadRange } from '../core/ranges';

export const Prop = { Coin: 0, Bar: 1, Crate: 2, Chest: 3, Barrel: 4, Mine: 5 } as const;
export type PropKind = (typeof Prop)[keyof typeof Prop];

function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setHex(fn(pos.getX(i), pos.getY(i), pos.getZ(i)));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') out.deleteAttribute(name);
  return out;
}

function coinGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 0.24, 18, 1);
  g.rotateX(Math.PI / 2);
  return paint(clean(g), (x, y, z) => (Math.abs(z) > 0.1 && Math.hypot(x, y) < 0.62 ? 0xffffff : 0xd8d8d8));
}

function barGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2, 0.8, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) { pos.setX(i, pos.getX(i) * 0.78); pos.setZ(i, pos.getZ(i) * 0.7); }
  g.computeVertexNormals();
  return paint(clean(g), () => 0xffffff);
}

function crateGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2, 2, 2, 2, 2, 2);
  return paint(clean(g), (x, y, z) => {
    const edge = [Math.abs(x) > 0.85, Math.abs(y) > 0.85, Math.abs(z) > 0.85].filter(Boolean).length >= 2;
    return edge ? 0x5a3a20 : 0xa8733f;
  });
}

function chestGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(2.2, 1.2, 1.5, 3, 1, 1);
  body.translate(0, 0.6, 0);
  const lid = new THREE.CylinderGeometry(0.75, 0.75, 2.2, 10, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  lid.rotateX(Math.PI / 2);
  lid.scale(1, 0.75, 1);
  lid.translate(0, 1.2, 0);
  const merged = mergeGeometries([clean(body), clean(lid)], false)!;
  return paint(merged, (x, y) => {
    if (Math.abs(x) > 0.85 && Math.abs(x) < 1.05) return 0xffc93a; // gold bands
    if (y > 1.0 && y < 1.3) return 0xffc93a; // lid rim
    if (Math.abs(x) < 0.18 && y > 0.7 && y < 1.2) return 0xfff0a0; // lock
    return y > 1.2 ? 0x8a4e24 : 0x6e3b1c;
  });
}

function barrelGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.85, 0.85, 2, 14, 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const bulge = 1 + 0.16 * (1 - (y * y));
    pos.setX(i, pos.getX(i) * bulge); pos.setZ(i, pos.getZ(i) * bulge);
  }
  g.computeVertexNormals();
  return paint(clean(g), (_x, y) => (Math.abs(Math.abs(y) - 0.62) < 0.12 || Math.abs(y) > 0.95 ? 0x3a3440 : 0xffffff));
}

function mineGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [clean(new THREE.IcosahedronGeometry(1, 1))];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7]];
  for (const [x, y, z] of dirs) {
    const spike = new THREE.ConeGeometry(0.16, 0.6, 6);
    spike.translate(0, 1.15, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x!, y!, z!).normalize());
    spike.applyQuaternion(q);
    parts.push(clean(spike));
  }
  const merged = mergeGeometries(parts, false)!;
  return paint(merged, (x, y, z) => (Math.hypot(x, y, z) > 1.05 ? 0xd0d4dc : y > 0.85 ? 0xd8302a : 0x3a3f4c));
}

interface Slot { mesh: THREE.InstancedMesh; n: number }

export class PropPass {
  readonly group = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(capacities: Record<PropKind, number>) {
    this.group.name = 'fx-props';
    const geos = [coinGeometry(), barGeometry(), crateGeometry(), chestGeometry(), barrelGeometry(), mineGeometry()];
    const material = createToonMaterial({ color: 0xffffff, vertexColors: true, name: 'fx-props', rim: 0.35 });
    for (let k = 0; k < geos.length; k++) {
      const mesh = new THREE.InstancedMesh(geos[k]!, material, Math.max(1, capacities[k as PropKind]));
      mesh.name = `fx-prop-${k}`;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, this.c.setRGB(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      markInk(mesh);
      this.group.add(mesh);
      this.slots.push({ mesh, n: 0 });
    }
  }

  beginFrame(): void { for (const s of this.slots) s.n = 0; }

  /** Adds one prop. Euler order YXZ (yaw, then pitch/tilt, then roll). */
  add(kind: PropKind, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, scale: number, hex: number, sy = scale): void {
    const slot = this.slots[kind]!;
    if (slot.n >= slot.mesh.instanceMatrix.count) return;
    this.e.set(pitch, yaw, roll);
    this.q.setFromEuler(this.e);
    this.p.set(x, y, z);
    this.s.set(scale, sy, scale);
    this.m.compose(this.p, this.q, this.s);
    slot.mesh.setMatrixAt(slot.n, this.m);
    slot.mesh.setColorAt(slot.n, this.c.setHex(hex));
    slot.n++;
  }

  endFrame(): void {
    for (const s of this.slots) {
      s.mesh.count = s.n;
      uploadRange(s.mesh.instanceMatrix, 0, s.n * 16);
      if (s.mesh.instanceColor) uploadRange(s.mesh.instanceColor, 0, s.n * 3);
    }
  }

  dispose(): void {
    for (const s of this.slots) s.mesh.geometry.dispose();
    (this.slots[0]?.mesh.material as THREE.Material | undefined)?.dispose();
  }
}
