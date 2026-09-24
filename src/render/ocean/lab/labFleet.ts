/**
 * Ocean lab: proxy boats sailing circles and figure-eights, a sinking cycle, a surfacing sea serpent and a few
 * hazards, exposed as a (partial) RunState so the ocean stamps them through the same code path as the game.
 */
import * as THREE from 'three';
import type { RunState, SimEvent } from '../../../game/types';
import type { OceanServices } from '../../frame';

type PathFn = (s: number, out: { x: number; z: number }) => void;

const circle = (cx: number, cz: number, r: number, dir = 1): PathFn => (s, out) => {
  out.x = cx + r * Math.sin(s * dir);
  out.z = cz + r * Math.cos(s * dir);
};
const eight = (cx: number, cz: number, a: number, b: number, rot: number): PathFn => (s, out) => {
  const x = a * Math.sin(s);
  const z = b * Math.sin(s) * Math.cos(s);
  out.x = cx + x * Math.cos(rot) - z * Math.sin(rot);
  out.z = cz + x * Math.sin(rot) + z * Math.cos(rot);
};

class Mover {
  param: number;
  x = 0; z = 0; vx = 0; vz = 0; heading = 0; speed = 0;
  private readonly a = { x: 0, z: 0 };
  private readonly b = { x: 0, z: 0 };
  constructor(private readonly path: PathFn, public cruise: number, param = 0) {
    this.param = param;
    this.sample();
  }
  advance(dt: number, mul: number): void {
    const eps = 1e-3;
    this.path(this.param, this.a);
    this.path(this.param + eps, this.b);
    const rate = Math.max(1e-3, Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z) / eps);
    this.param += (this.cruise * mul * dt) / rate;
    this.speed = this.cruise * mul;
    this.sample();
  }
  private sample(): void {
    this.path(this.param, this.a);
    this.path(this.param + 1e-3, this.b);
    const dx = this.b.x - this.a.x;
    const dz = this.b.z - this.a.z;
    const len = Math.hypot(dx, dz) || 1;
    this.x = this.a.x;
    this.z = this.a.z;
    this.vx = (dx / len) * this.speed;
    this.vz = (dz / len) * this.speed;
    this.heading = Math.atan2(-dx, -dz);
  }
}

function hullShape(length: number, beam: number): THREE.Shape {
  const s = new THREE.Shape();
  const hl = length * 0.5;
  const hb = beam * 0.5;
  // Local 2D: x = starboard, y = forward (bow at +y). Pointed bow, round stern.
  s.moveTo(0, hl);
  s.bezierCurveTo(hb * 0.7, hl * 0.75, hb, hl * 0.35, hb, 0);
  s.lineTo(hb * 0.97, -hl * 0.55);
  s.bezierCurveTo(hb * 0.9, -hl * 0.95, hb * 0.55, -hl, 0, -hl);
  s.bezierCurveTo(-hb * 0.55, -hl, -hb * 0.9, -hl * 0.95, -hb * 0.97, -hl * 0.55);
  s.lineTo(-hb, 0);
  s.bezierCurveTo(-hb, hl * 0.35, -hb * 0.7, hl * 0.75, 0, hl);
  return s;
}

function boatMesh(length: number, beam: number, hull: number, sail: number): THREE.Group {
  const group = new THREE.Group();
  const freeboard = Math.max(1.5, length * 0.09);
  const draft = Math.max(1, length * 0.06);
  const geometry = new THREE.ExtrudeGeometry(hullShape(length * 0.82, beam), { depth: freeboard + draft, bevelEnabled: false, curveSegments: 8 });
  // Shape XY → world: x = starboard, y(shape) = forward (−Z), extrude along +Y.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -draft, 0);
  const hullMesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: hull }));
  group.add(hullMesh);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(hullShape(length * 0.78, beam * 0.9)), new THREE.MeshToonMaterial({ color: 0xb98a55 }));
  deck.geometry.rotateX(-Math.PI / 2);
  deck.position.y = freeboard + 0.05;
  group.add(deck);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, length * 0.75, 6), new THREE.MeshToonMaterial({ color: 0x5a3b22 }));
  mast.position.y = freeboard + length * 0.37;
  group.add(mast);
  const sailMesh = new THREE.Mesh(new THREE.PlaneGeometry(beam * 1.4, length * 0.42), new THREE.MeshToonMaterial({ color: sail, side: THREE.DoubleSide }));
  sailMesh.position.set(0, freeboard + length * 0.42, -0.6);
  group.add(sailMesh);
  return group;
}

interface Boat { id: number; mover: Mover | null; mesh: THREE.Group; length: number; beam: number; state: Record<string, unknown> }

const up = new THREE.Vector3(0, 1, 0);
const normal = new THREE.Vector3();
const quat = new THREE.Quaternion();
const yaw = new THREE.Quaternion();

export class LabFleet {
  readonly run: RunState;
  readonly events: SimEvent[] = [];
  speedMul = 1;
  private readonly boats: Boat[] = [];
  private readonly player: Record<string, unknown>;
  private readonly heroMover: Mover;
  private readonly sinker: Record<string, unknown>;
  private sinkClock = 0;
  private readonly wyrm: Record<string, unknown>;
  private readonly wyrmMover: Mover;
  private readonly wyrmBody: THREE.Mesh[] = [];
  private readonly wyrmPath: { x: number; z: number }[] = [];
  private wyrmClock = 0;
  private jumpClock = -1;
  private readonly hazards: Record<string, unknown>[];
  private readonly heroMesh: THREE.Group;
  private readonly sinkerMesh: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.heroMover = new Mover(circle(0, 0, 230, 1), 22, 0.4);
    this.heroMesh = boatMesh(46, 17, 0x8a3d25, 0xf4ead2);
    scene.add(this.heroMesh);
    this.player = { x: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, length: 46, beam: 17, alive: true, airborne: 0, submerged: 0, roll: 0, pitch: 0, y: 0, radius: 12, yawRate: 0 };

    const enemy = (id: number, mover: Mover, length: number, beam: number, hull: number, sail: number, faction = 'admiralty', defId = 'brig') => {
      const mesh = boatMesh(length, beam, hull, sail);
      scene.add(mesh);
      const state = { id, defId, faction, life: 'alive', sink: 0, x: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, length, beam, statuses: [], radius: length * 0.3, y: 0, roll: 0, pitch: 0, yawRate: 0 };
      this.boats.push({ id, mover, mesh, length, beam, state });
      return state;
    };
    enemy(101, new Mover(eight(-40, 60, 210, 150, 0.3), 15, 0.2), 28, 10, 0xe9eef2, 0xf7f8fb);
    enemy(102, new Mover(circle(240, 210, 120, -1), 9, 1.2), 44, 15, 0x2b2021, 0xb3262b, 'corsair', 'corsair-galleon');
    enemy(103, new Mover(eight(160, -80, 95, 60, -0.5), 19, 2.4), 12, 5, 0x2b2021, 0xb3262b, 'corsair', 'skiff');
    this.sinker = enemy(104, null as unknown as Mover, 28, 10, 0xe9eef2, 0xf7f8fb);
    this.sinkerMesh = this.boats[this.boats.length - 1]!.mesh;
    Object.assign(this.sinker, { x: -150, z: -120, heading: 1.0 });

    this.wyrmMover = new Mover(circle(-320, -300, 150, 1), 16, 0);
    this.wyrm = { id: 201, defId: 'tidewyrm', life: 'alive', sink: 0, submerged: 0, x: 0, z: 0, heading: 0, speed: 0, vx: 0, vz: 0, length: 140, beam: 9, radius: 16, hp: 1, maxHp: 1, phase: 0 };
    const wyrmMat = new THREE.MeshToonMaterial({ color: 0x2f6f63 });
    const seg = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(seg, wyrmMat);
      const r = 4.6 * (1 - (i / 24) * 0.65);
      m.scale.set(r, r * 0.8, r);
      scene.add(m);
      this.wyrmBody.push(m);
    }

    this.hazards = [
      { id: 301, alive: true, kind: 'whirlpool', team: 'player', x: 60, z: -300, radius: 26, ttl: 14, age: 0, vx: 0, vz: 0 },
      { id: 302, alive: true, kind: 'mine', team: 'enemy', x: 40, z: 120, radius: 6, ttl: 1e9, age: 0, vx: 0, vz: 0 },
      { id: 303, alive: true, kind: 'barrel', team: 'player', x: -70, z: 150, radius: 5, ttl: 1e9, age: 0, vx: 0, vz: 0 },
      { id: 304, alive: false, kind: 'wave-front', team: 'player', x: 0, z: 0, radius: 110, ttl: 14, age: 0, vx: 0, vz: 0 },
    ];

    this.run = {
      status: 'running', timeScale: 1, player: this.player,
      enemies: this.boats.map((b) => b.state), bosses: [this.wyrm], hazards: this.hazards,
    } as unknown as RunState;
  }

  get hero(): { x: number; z: number; heading: number; speed: number } {
    return this.player as unknown as { x: number; z: number; heading: number; speed: number };
  }

  jump(): void { if (this.jumpClock < 0) this.jumpClock = 0; }

  waveFront(): void {
    const h = this.hazards[3]!;
    Object.assign(h, { alive: true, age: 0, x: this.hero.x - 380, z: this.hero.z + 40, vx: 36, vz: 0 });
    this.events.push({ type: 'hazard-spawned', id: 304, kind: 'wave-front', x: h.x as number, z: h.z as number, radius: 110 });
  }

  /** Advances the fake sim (positions, cycles). */
  step(dt: number): void {
    const p = this.player;
    this.heroMover.advance(dt, this.speedMul);
    Object.assign(p, { x: this.heroMover.x, z: this.heroMover.z, heading: this.heroMover.heading, speed: this.heroMover.speed, vx: this.heroMover.vx, vz: this.heroMover.vz });
    if (this.jumpClock >= 0) {
      this.jumpClock += dt;
      const t = this.jumpClock / 1.3;
      p.airborne = t < 1 ? Math.sin(Math.PI * t) : 0;
      if (t >= 1) this.jumpClock = -1;
    }
    for (const b of this.boats) {
      if (!b.mover) continue;
      b.mover.advance(dt, this.speedMul);
      Object.assign(b.state, { x: b.mover.x, z: b.mover.z, heading: b.mover.heading, speed: b.mover.speed, vx: b.mover.vx, vz: b.mover.vz });
    }
    // Sinker: afloat (slow drift) 4 s → sinking 3 s → gone 3 s.
    this.sinkClock = (this.sinkClock + dt) % 10;
    const s = this.sinker;
    if (this.sinkClock < 4) { s.life = 'alive'; s.sink = 0; }
    else if (this.sinkClock < 7) {
      if (s.life === 'alive') this.events.push({ type: 'enemy-killed', id: 104, defId: 'brig', x: s.x as number, z: s.z as number, elite: false });
      s.life = 'sinking'; s.sink = (this.sinkClock - 4) / 3;
    } else { s.life = 'dead'; s.sink = 1; }
    // Serpent: surfaced 6 s, dive 1 s, submerged 4 s, rise 1 s.
    this.wyrmClock = (this.wyrmClock + dt) % 12;
    const c = this.wyrmClock;
    const w = this.wyrm;
    w.submerged = c < 6 ? 0 : c < 7 ? c - 6 : c < 11 ? 1 : 12 - c;
    this.wyrmMover.advance(dt, this.speedMul);
    Object.assign(w, { x: this.wyrmMover.x, z: this.wyrmMover.z, heading: this.wyrmMover.heading, speed: this.wyrmMover.speed, vx: this.wyrmMover.vx, vz: this.wyrmMover.vz });
    const last = this.wyrmPath[this.wyrmPath.length - 1];
    if (!last || Math.hypot(last.x - (w.x as number), last.z - (w.z as number)) > 2.5) {
      this.wyrmPath.push({ x: w.x as number, z: w.z as number });
      if (this.wyrmPath.length > 80) this.wyrmPath.shift();
    }
    // Hazards.
    for (const h of this.hazards) {
      h.age = (h.age as number) + dt;
      if (h.kind === 'whirlpool' && (h.age as number) > (h.ttl as number)) h.age = 0;
      if (h.kind === 'wave-front' && h.alive) {
        h.x = (h.x as number) + (h.vx as number) * dt;
        h.z = (h.z as number) + (h.vz as number) * dt;
        if ((h.age as number) > (h.ttl as number)) h.alive = false;
      }
    }
  }

  /** Places meshes on the ocean surface (after the ocean updated this frame). */
  place(ocean: OceanServices): void {
    const p = this.player;
    this.placeMesh(this.heroMesh, p.x as number, p.z as number, p.heading as number, ocean, (p.airborne as number) * 22, 46);
    for (const b of this.boats) {
      const st = b.state;
      b.mesh.visible = st.life !== 'dead';
      const sink = (st.sink as number) * b.length * 0.35;
      this.placeMesh(b.mesh, st.x as number, st.z as number, st.heading as number, ocean, -sink, b.length);
      if (st.life === 'sinking') b.mesh.rotateX((st.sink as number) * 0.5);
    }
    this.sinkerMesh.visible = this.sinker.life !== 'dead';
    // Serpent body follows the head path.
    const sub = this.wyrm.submerged as number;
    let idx = this.wyrmPath.length - 1;
    for (let i = 0; i < this.wyrmBody.length; i++) {
      const m = this.wyrmBody[i]!;
      const pt = this.wyrmPath[Math.max(0, idx)];
      idx -= 2;
      if (!pt) { m.visible = false; continue; }
      m.visible = true;
      const y = ocean.heightAt(pt.x, pt.z) - sub * 9 + Math.sin(i * 0.7) * 0.6;
      m.position.set(pt.x, y, pt.z);
    }
  }

  private placeMesh(mesh: THREE.Group, x: number, z: number, heading: number, ocean: OceanServices, lift: number, length: number): void {
    ocean.normalAt(x, z, normal);
    quat.setFromUnitVectors(up, normal.lerp(up, Math.min(0.6, 12 / length)).normalize());
    yaw.setFromAxisAngle(up, heading);
    mesh.quaternion.copy(quat).multiply(yaw);
    mesh.position.set(x, ocean.heightAt(x, z) + lift, z);
  }
}
