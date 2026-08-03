import * as THREE from 'three';
import type { ShipDamage, ShipKind, ShipState } from '../../core/contracts';
import { getShipSpec, type ShipPalette, type ShipSpec } from '../../content';

const TAU = Math.PI * 2;

export type ShipDetail = 'high' | 'medium' | 'low';

export interface ShipMaterialSet {
  hull: THREE.Material;
  hullDark: THREE.Material;
  cabin: THREE.Material;
  trim: THREE.Material;
  sail: THREE.Material;
  accent: THREE.Material;
  metal: THREE.Material;
  glass: THREE.Material;
  ink: THREE.Material;
  skin: THREE.Material;
  white: THREE.Material;
}

export interface ShipGeometryFactoryOptions {
  materialFactory?: (kind: ShipKind, palette: ShipPalette) => ShipMaterialSet;
  castShadow?: boolean;
}

interface CrewRig {
  root: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  phase: number;
  baseY: number;
}

export interface ShipAnchors {
  bow: THREE.Object3D;
  stern: THREE.Object3D;
  portCannons: THREE.Object3D[];
  starboardCannons: THREE.Object3D[];
  bowCannons: THREE.Object3D[];
  deck: THREE.Object3D;
  cameraDeck: THREE.Object3D;
  wake: THREE.Object3D;
  smoke: THREE.Object3D[];
}

export class ProceduralShipModel {
  readonly root = new THREE.Group();
  readonly lod = new THREE.LOD();
  readonly anchors: ShipAnchors;

  private readonly sails: THREE.Object3D[] = [];
  private readonly masts: THREE.Object3D[] = [];
  private readonly damageMarks: THREE.Object3D[] = [];
  private readonly crew: CrewRig[] = [];
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private disposed = false;

  constructor(readonly kind: ShipKind, readonly spec: ShipSpec) {
    this.root.name = `ship:${kind}`;
    this.root.userData.shipKind = kind;
    this.root.userData.nprOutline = true;
    this.root.add(this.lod);
    const bow = new THREE.Object3D();
    const stern = new THREE.Object3D();
    const deck = new THREE.Object3D();
    const cameraDeck = new THREE.Object3D();
    const wake = new THREE.Object3D();
    bow.position.set(0, spec.draft * 0.28, -spec.length * 0.55);
    stern.position.set(0, spec.draft * 0.15, spec.length * 0.52);
    deck.position.set(0, spec.draft * 0.38 + 2, 0);
    cameraDeck.position.set(0, spec.draft * 0.8 + 4.5, spec.length * 0.12);
    wake.position.set(0, 0, spec.length * 0.52);
    this.root.add(bow, stern, deck, cameraDeck, wake);
    this.anchors = { bow, stern, deck, cameraDeck, wake, portCannons: [], starboardCannons: [], bowCannons: [], smoke: [] };
  }

  registerGeometry(geometry: THREE.BufferGeometry): void { this.ownedGeometries.add(geometry); }
  registerSail(sail: THREE.Object3D): void { this.sails.push(sail); }
  registerMast(mast: THREE.Object3D): void { this.masts.push(mast); }
  registerDamageMark(mark: THREE.Object3D): void { this.damageMarks.push(mark); }
  registerCrew(rig: CrewRig): void { this.crew.push(rig); }

  update(state: ShipState, time: number): void {
    const damage = state.damage;
    this.updateDamage(damage);
    const speedRatio = Math.min(1.3, Math.abs(state.speed) / Math.max(1, state.maxSpeed));
    const turnLean = -state.rudder * speedRatio * 0.22;
    for (let index = 0; index < this.crew.length; index += 1) {
      const rig = this.crew[index];
      const activity = state.repairing ? 2.5 : state.weapons.portCooldown > 0 || state.weapons.starboardCooldown > 0 ? 1.8 : 1;
      rig.root.rotation.z = turnLean + Math.sin(time * 2.1 + rig.phase) * 0.035;
      rig.root.position.y = rig.baseY + Math.sin(time * (2.2 + speedRatio) + rig.phase) * 0.08;
      rig.leftArm.rotation.x = Math.sin(time * activity * 2.4 + rig.phase) * (state.repairing ? 0.9 : 0.28) - 0.25;
      rig.rightArm.rotation.x = -Math.sin(time * activity * 2.4 + rig.phase) * (state.repairing ? 0.9 : 0.28) - 0.25;
    }
    for (let index = 0; index < this.sails.length; index += 1) {
      const sail = this.sails[index];
      sail.rotation.y = Math.sin(time * 1.5 + index * 0.7) * (0.025 + speedRatio * 0.035);
      sail.rotation.z = Math.sin(time * 0.9 + index) * 0.012;
    }
  }

  updateDamage(damage: ShipDamage): void {
    const visibleMarks = Math.round(damage.hull * this.damageMarks.length);
    for (let index = 0; index < this.damageMarks.length; index += 1) this.damageMarks[index].visible = index < visibleMarks;
    for (let index = 0; index < this.sails.length; index += 1) {
      const sail = this.sails[index];
      const tear = Math.max(0.24, 1 - damage.sails * (0.42 + (index % 3) * 0.1));
      sail.scale.x = tear;
      sail.rotation.z += (index % 2 ? -1 : 1) * damage.sails * 0.045;
    }
    for (let index = 0; index < this.masts.length; index += 1) {
      this.masts[index].rotation.z = damage.sails > 0.62 && index === this.masts.length - 1 ? (damage.sails - 0.62) * 1.2 : 0;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.root.removeFromParent();
  }
}

export class ShipGeometryFactory {
  private readonly materials = new Map<ShipKind, ShipMaterialSet>();
  private readonly customMaterials: boolean;

  constructor(private readonly options: ShipGeometryFactoryOptions = {}) {
    this.customMaterials = Boolean(options.materialFactory);
  }

  create(kind: ShipKind): ProceduralShipModel {
    const spec = getShipSpec(kind);
    const materials = this.getMaterials(kind, spec.palette);
    const model = new ProceduralShipModel(kind, spec);
    const high = this.buildLevel(model, materials, 'high');
    const medium = this.buildLevel(model, materials, 'medium');
    const low = this.buildLevel(model, materials, 'low');
    model.lod.addLevel(high, 0);
    model.lod.addLevel(medium, Math.max(105, spec.length * 2.15));
    model.lod.addLevel(low, Math.max(260, spec.length * 4.3));
    return model;
  }

  dispose(): void {
    if (this.customMaterials) return;
    const disposed = new Set<THREE.Material>();
    for (const set of this.materials.values()) {
      for (const material of Object.values(set)) {
        if (!disposed.has(material)) material.dispose();
        disposed.add(material);
      }
    }
    this.materials.clear();
  }

  private buildLevel(model: ProceduralShipModel, materials: ShipMaterialSet, detail: ShipDetail): THREE.Group {
    const group = new THREE.Group();
    group.name = `${model.kind}:${detail}`;
    if (model.kind === 'polar-tang') this.buildPolarTang(model, group, materials, detail);
    else {
      this.addHull(model, group, materials, detail);
      this.addDeckAndRails(model, group, materials, detail);
      this.addRig(model, group, materials, detail);
      this.addCannons(model, group, materials, detail);
      this.addSignature(model, group, materials, detail);
      if (detail === 'high') {
        this.addCrew(model, group, materials);
        this.addDamageMarks(model, group, materials);
      }
    }
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = this.options.castShadow ?? true;
      object.receiveShadow = true;
      object.userData.nprOutline = true;
    });
    return group;
  }

  private addHull(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, detail: ShipDetail): void {
    const spec = model.spec;
    const segments = detail === 'high' ? 18 : detail === 'medium' ? 11 : 7;
    const geometry = createHullGeometry(spec.length, spec.beam, spec.draft, segments);
    model.registerGeometry(geometry);
    const hull = new THREE.Mesh(geometry, materials.hull);
    hull.name = 'hull';
    parent.add(hull);
    const trim = this.mesh(model, new THREE.BoxGeometry(spec.beam * 0.94, 0.55, spec.length * 0.75), materials.trim);
    trim.position.y = spec.draft * 0.2 + 0.9;
    parent.add(trim);
    const keel = this.mesh(model, new THREE.BoxGeometry(spec.beam * 0.07, spec.draft * 0.35, spec.length * 0.65), materials.hullDark);
    keel.position.y = -spec.draft * 0.72;
    parent.add(keel);
  }

  private addDeckAndRails(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, detail: ShipDetail): void {
    const spec = model.spec;
    const deck = this.mesh(model, new THREE.BoxGeometry(spec.beam * 0.8, 0.6, spec.length * 0.7), materials.trim);
    deck.position.y = spec.draft * 0.17 + 1.15;
    parent.add(deck);
    const cabinWidth = spec.beam * (model.kind === 'baratie' ? 0.76 : 0.52);
    const cabinHeight = model.kind === 'baratie' ? spec.draft * 1.5 : spec.draft * 0.62;
    const cabinDepth = spec.length * 0.18;
    const cabin = this.mesh(model, new THREE.BoxGeometry(cabinWidth, cabinHeight, cabinDepth), materials.cabin);
    cabin.name = 'cabin';
    cabin.position.set(0, spec.draft * 0.18 + cabinHeight * 0.5 + 1.5, spec.length * 0.22);
    parent.add(cabin);
    const roof = this.mesh(model, new THREE.BoxGeometry(cabinWidth * 1.1, 0.65, spec.length * 0.21), materials.accent);
    roof.position.set(cabin.position.x, cabin.position.y + cabinHeight * 0.55, cabin.position.z);
    parent.add(roof);
    if (detail === 'low') return;
    this.addCabinDetails(model, parent, materials, detail, cabin.position, cabinWidth, cabinHeight, cabinDepth);
    const railY = spec.draft * 0.2 + 2.05;
    for (const side of [-1, 1]) {
      const rail = this.mesh(model, new THREE.BoxGeometry(0.26, 1.15, spec.length * 0.66), materials.trim);
      rail.position.set(side * spec.beam * 0.41, railY, 0);
      parent.add(rail);
      if (detail === 'high') {
        const posts = 9;
        for (let index = 0; index < posts; index += 1) {
          const post = this.mesh(model, new THREE.CylinderGeometry(0.12, 0.12, 1.55, 5), materials.metal);
          post.position.set(side * spec.beam * 0.415, railY + 0.2, (index / (posts - 1) - 0.5) * spec.length * 0.63);
          parent.add(post);
        }
      }
    }
  }

  private addRig(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, detail: ShipDetail): void {
    const spec = model.spec;
    if (spec.mastCount === 0) return;
    const mastPositions = spec.mastCount === 2 ? [-0.15, 0.2] : [-0.24, 0.02, 0.27];
    for (let index = 0; index < spec.mastCount; index += 1) {
      const fraction = mastPositions[index] ?? 0;
      const heightScale = index === 1 || spec.mastCount === 2 && index === 0 ? 1 : 0.83;
      const mastHeight = spec.length * 0.52 * heightScale;
      const mastGroup = new THREE.Group();
      mastGroup.position.set(0, spec.draft * 0.2 + 1.4, fraction * spec.length);
      const mast = this.mesh(model, new THREE.CylinderGeometry(spec.beam * 0.018, spec.beam * 0.026, mastHeight, detail === 'high' ? 8 : 5), materials.hullDark);
      mast.position.y = mastHeight * 0.5;
      mastGroup.add(mast);
      const yardCount = detail === 'low' ? 1 : 2;
      for (let yard = 0; yard < yardCount; yard += 1) {
        const yardY = mastHeight * (0.54 + yard * 0.24);
        const yardWidth = spec.beam * (yard === 0 ? 1.36 : 1.05) * heightScale;
        const boom = this.mesh(model, new THREE.CylinderGeometry(0.14, 0.18, yardWidth, 6), materials.hullDark);
        boom.rotation.z = Math.PI / 2;
        boom.position.y = yardY;
        mastGroup.add(boom);
        const sailHeight = mastHeight * (yard === 0 ? 0.28 : 0.2);
        const sail = this.makeSail(model, yardWidth * 0.88, sailHeight, materials.sail, detail);
        sail.position.set(0, yardY - sailHeight * 0.5 - 0.15, -0.22);
        mastGroup.add(sail);
        if (detail === 'high') model.registerSail(sail);
      }
      parent.add(mastGroup);
      if (detail === 'high') model.registerMast(mastGroup);
      if (detail === 'high') {
        this.addRiggingLine(model, parent, new THREE.Vector3(0, spec.draft * 0.35 + mastHeight * 0.92, fraction * spec.length), new THREE.Vector3(-spec.beam * 0.43, spec.draft * 0.3 + 2, fraction * spec.length + 1), materials.ink);
        this.addRiggingLine(model, parent, new THREE.Vector3(0, spec.draft * 0.35 + mastHeight * 0.92, fraction * spec.length), new THREE.Vector3(spec.beam * 0.43, spec.draft * 0.3 + 2, fraction * spec.length + 1), materials.ink);
      }
    }
  }

  private addCannons(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, detail: ShipDetail): void {
    if (detail === 'low') return;
    const spec = model.spec;
    const visibleCannons = Math.min(detail === 'high' ? 7 : 4, spec.broadsideCannons);
    for (const side of [-1, 1] as const) {
      for (let index = 0; index < visibleCannons; index += 1) {
        const z = (index / Math.max(1, visibleCannons - 1) - 0.5) * spec.length * 0.5;
        const anchor = new THREE.Group();
        anchor.position.set(side * spec.beam * 0.43, spec.draft * 0.23 + 1.65, z);
        const barrel = this.mesh(model, new THREE.CylinderGeometry(0.23, 0.36, spec.beam * 0.18, 7), materials.metal);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.x = side * spec.beam * 0.08;
        anchor.add(barrel);
        parent.add(anchor);
        if (detail === 'high') {
          if (side < 0) model.anchors.portCannons.push(anchor);
          else model.anchors.starboardCannons.push(anchor);
          model.anchors.smoke.push(anchor);
        }
      }
    }
    for (let index = 0; index < Math.min(spec.bowCannons, detail === 'high' ? 2 : 1); index += 1) {
      const anchor = new THREE.Group();
      anchor.position.set((index - 0.5) * spec.beam * 0.15, spec.draft * 0.25 + 1.65, -spec.length * 0.4);
      const barrel = this.mesh(model, new THREE.CylinderGeometry(0.24, 0.36, spec.beam * 0.22, 7), materials.metal);
      barrel.rotation.x = Math.PI / 2;
      anchor.add(barrel);
      parent.add(anchor);
      if (detail === 'high') model.anchors.bowCannons.push(anchor);
    }
  }

  private addSignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, detail: ShipDetail): void {
    const spec = model.spec;
    const bowZ = -spec.length * 0.52;
    switch (model.kind) {
      case 'thousand-sunny': this.addSunnySignature(model, parent, materials, bowZ, detail); break;
      case 'going-merry': this.addMerrySignature(model, parent, materials, bowZ, detail); break;
      case 'moby-dick': this.addMobySignature(model, parent, materials, bowZ, detail); break;
      case 'red-force': this.addRedForceSignature(model, parent, materials, bowZ, detail); break;
      case 'oro-jackson': this.addOroSignature(model, parent, materials, bowZ, detail); break;
      case 'queen-mama-chanter': this.addQueenSignature(model, parent, materials, bowZ, detail); break;
      case 'baratie': this.addBaratieSignature(model, parent, materials, bowZ, detail); break;
      case 'navy-galleon': this.addNavySignature(model, parent, materials, bowZ, detail); break;
      case 'polar-tang': break;
    }
  }

  private addSunnySignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.22;
    const headY = model.spec.draft * 0.35 + size;
    const connector = this.mesh(
      model,
      new THREE.CylinderGeometry(size * 0.48, size * 0.7, size * 1.55, detail === 'low' ? 7 : 10),
      materials.trim,
    );
    connector.name = 'sunny-lion-bow-connector';
    connector.position.set(0, headY - size * 0.62, bowZ + size * 0.62);
    connector.rotation.x = -0.48;
    parent.add(connector);
    const collar = this.mesh(
      model,
      new THREE.TorusGeometry(size * 0.58, size * 0.13, 6, detail === 'low' ? 10 : 18),
      materials.accent,
    );
    collar.position.set(0, headY - size * 0.43, bowZ + size * 0.24);
    collar.rotation.x = Math.PI / 2;
    parent.add(collar);
    const head = this.ellipsoid(model, size, size * 0.9, size * 0.55, materials.trim);
    head.name = 'sunny-lion-head';
    head.position.set(0, headY, bowZ);
    parent.add(head);
    const maneRing = this.mesh(
      model,
      new THREE.TorusGeometry(size * 1.06, size * 0.2, 6, detail === 'low' ? 12 : 22),
      materials.accent,
    );
    maneRing.position.set(0, headY, bowZ + size * 0.25);
    parent.add(maneRing);
    const rays = detail === 'low' ? 8 : 14;
    for (let index = 0; index < rays; index += 1) {
      const angle = index / rays * TAU;
      const ray = this.mesh(model, new THREE.ConeGeometry(size * 0.2, size * 0.9, 4), materials.accent);
      ray.position.set(Math.cos(angle) * size * 1.15, head.position.y + Math.sin(angle) * size * 1.15, bowZ + 0.15);
      ray.rotation.z = angle - Math.PI / 2;
      parent.add(ray);
    }
    const muzzle = this.ellipsoid(model, size * 0.52, size * 0.31, size * 0.19, materials.white);
    muzzle.position.set(0, headY - size * 0.2, bowZ - size * 0.52);
    parent.add(muzzle);
    const nose = this.mesh(model, new THREE.SphereGeometry(size * 0.18, 8, 6), materials.accent);
    nose.position.set(0, headY - size * 0.08, bowZ - size * 0.7);
    parent.add(nose);
    if (detail !== 'low') {
      for (const x of [-0.35, 0.35]) {
        const eye = this.ellipsoid(model, size * 0.2, size * 0.25, size * 0.1, materials.white);
        eye.position.set(x * size, headY + size * 0.2, bowZ - size * 0.51);
        parent.add(eye);
        const pupil = this.ellipsoid(model, size * 0.085, size * 0.13, size * 0.055, materials.ink);
        pupil.position.set(x * size, headY + size * 0.19, bowZ - size * 0.62);
        parent.add(pupil);
      }
      const mouth = this.ellipsoid(model, size * 0.31, size * 0.055, size * 0.045, materials.ink);
      mouth.position.set(0, headY - size * 0.4, bowZ - size * 0.65);
      parent.add(mouth);
    }
  }

  private addMerrySignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.2;
    const neck = this.mesh(model, new THREE.CylinderGeometry(size * 0.26, size * 0.35, size * 2.1, 7), materials.white);
    neck.position.set(0, model.spec.draft * 0.45 + size, bowZ + size * 0.25);
    parent.add(neck);
    const head = this.ellipsoid(model, size * 0.72, size * 0.62, size * 0.78, materials.white);
    head.position.set(0, neck.position.y + size * 1.2, bowZ - size * 0.42);
    parent.add(head);
    for (const side of [-1, 1]) {
      const horn = this.mesh(model, new THREE.TorusGeometry(size * 0.44, size * 0.12, 6, detail === 'low' ? 10 : 18), materials.trim);
      horn.position.set(side * size * 0.65, head.position.y + size * 0.12, bowZ - size * 0.15);
      horn.rotation.y = Math.PI / 2;
      parent.add(horn);
    }
  }

  private addMobySignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const beam = model.spec.beam;
    const whale = this.ellipsoid(model, beam * 0.4, beam * 0.22, beam * 0.56, materials.white);
    whale.position.set(0, model.spec.draft * 0.15 + beam * 0.05, bowZ - beam * 0.12);
    parent.add(whale);
    for (const side of [-1, 1]) {
      const fin = this.mesh(model, new THREE.ConeGeometry(beam * 0.22, beam * 0.75, detail === 'low' ? 4 : 6), materials.white);
      fin.position.set(side * beam * 0.34, whale.position.y - beam * 0.05, bowZ + beam * 0.08);
      fin.rotation.z = side * Math.PI * 0.48;
      parent.add(fin);
    }
    const sprayCrown = this.mesh(model, new THREE.ConeGeometry(beam * 0.11, beam * 0.45, 7), materials.accent);
    sprayCrown.position.set(0, whale.position.y + beam * 0.32, bowZ - beam * 0.12);
    parent.add(sprayCrown);
  }

  private addRedForceSignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.22;
    const dragon = this.ellipsoid(model, size * 0.55, size * 0.62, size * 1.25, materials.accent);
    dragon.position.set(0, model.spec.draft * 0.5 + size, bowZ - size * 0.5);
    dragon.rotation.x = -0.25;
    parent.add(dragon);
    for (const side of [-1, 1]) {
      const horn = this.mesh(model, new THREE.ConeGeometry(size * 0.15, size * 0.8, detail === 'low' ? 4 : 7), materials.trim);
      horn.position.set(side * size * 0.42, dragon.position.y + size * 0.55, bowZ - size * 0.25);
      horn.rotation.z = side * -0.45;
      parent.add(horn);
    }
  }

  private addOroSignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.2;
    const crest = this.mesh(model, new THREE.TorusGeometry(size * 0.85, size * 0.18, 6, detail === 'low' ? 10 : 20), materials.trim);
    crest.position.set(0, model.spec.draft * 0.5 + size * 1.15, bowZ - size * 0.25);
    parent.add(crest);
    const egg = this.ellipsoid(model, size * 1.15, size * 1.6, size, materials.white);
    egg.position.set(0, model.spec.draft * 0.35 + size * 1.7, model.spec.length * 0.2);
    parent.add(egg);
    if (detail !== 'low') {
      for (let index = 0; index < 3; index += 1) {
        const band = this.mesh(model, new THREE.TorusGeometry(size * (0.68 + index * 0.08), size * 0.07, 5, 18), materials.accent);
        band.position.copy(egg.position).add(new THREE.Vector3(0, (index - 1) * size * 0.43, 0));
        band.rotation.x = Math.PI / 2;
        parent.add(band);
      }
    }
  }

  private addQueenSignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.21;
    const face = this.ellipsoid(model, size, size * 1.15, size * 0.65, materials.accent);
    face.position.set(0, model.spec.draft * 0.35 + size * 1.1, bowZ - size * 0.28);
    parent.add(face);
    const crown = this.mesh(model, new THREE.ConeGeometry(size * 0.95, size * 1.05, 5), materials.trim);
    crown.position.set(0, face.position.y + size * 1.15, bowZ);
    parent.add(crown);
    const tiers = detail === 'low' ? 2 : 4;
    for (let index = 0; index < tiers; index += 1) {
      const tier = this.mesh(model, new THREE.CylinderGeometry(size * (1.2 - index * 0.17), size * (1.28 - index * 0.17), size * 0.42, 10), index % 2 ? materials.sail : materials.accent);
      tier.position.set(0, model.spec.draft * 0.4 + size * (0.45 + index * 0.4), model.spec.length * 0.2);
      parent.add(tier);
    }
  }

  private addBaratieSignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.2;
    const fish = this.ellipsoid(model, size * 0.85, size * 0.65, size * 1.25, materials.accent);
    fish.position.set(0, model.spec.draft * 0.35 + size * 0.7, bowZ - size * 0.45);
    parent.add(fish);
    for (const side of [-1, 1]) {
      const fin = this.mesh(model, new THREE.ConeGeometry(size * 0.45, size * 1.6, detail === 'low' ? 4 : 6), materials.trim);
      fin.position.set(side * model.spec.beam * 0.5, model.spec.draft * 0.12 + size * 0.2, -model.spec.length * 0.05);
      fin.rotation.z = side * Math.PI / 2;
      parent.add(fin);
    }
    const roof = this.mesh(model, new THREE.ConeGeometry(model.spec.beam * 0.38, size * 0.9, 8), materials.accent);
    roof.position.set(0, model.spec.draft * 1.9, model.spec.length * 0.22);
    parent.add(roof);
  }

  private addNavySignature(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, bowZ: number, detail: ShipDetail): void {
    const size = model.spec.beam * 0.19;
    const shield = this.mesh(model, new THREE.CylinderGeometry(size, size, size * 0.38, detail === 'low' ? 6 : 10), materials.accent);
    shield.rotation.x = Math.PI / 2;
    shield.position.set(0, model.spec.draft * 0.45 + size, bowZ - size * 0.25);
    parent.add(shield);
    const beak = this.mesh(model, new THREE.ConeGeometry(size * 0.4, size * 1.1, 5), materials.trim);
    beak.rotation.x = -Math.PI / 2;
    beak.position.set(0, shield.position.y, bowZ - size * 0.95);
    parent.add(beak);
    for (const side of [-1, 1]) {
      const wing = this.mesh(model, new THREE.BoxGeometry(size * 1.25, size * 0.22, size * 0.38), materials.white);
      wing.position.set(side * size, shield.position.y + size * 0.35, bowZ);
      wing.rotation.z = side * 0.32;
      parent.add(wing);
    }
  }

  private buildPolarTang(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, detail: ShipDetail): void {
    const spec = model.spec;
    const body = this.mesh(model, new THREE.CapsuleGeometry(spec.beam * 0.48, spec.length * 0.72, detail === 'high' ? 8 : 4, detail === 'low' ? 10 : 18), materials.hull);
    body.rotation.x = Math.PI / 2;
    body.scale.z = 0.82;
    parent.add(body);
    const belly = this.mesh(model, new THREE.CapsuleGeometry(spec.beam * 0.35, spec.length * 0.64, 4, detail === 'low' ? 8 : 14), materials.hullDark);
    belly.rotation.x = Math.PI / 2;
    belly.position.y = -spec.beam * 0.22;
    parent.add(belly);
    const tower = this.mesh(model, new THREE.CylinderGeometry(spec.beam * 0.16, spec.beam * 0.23, spec.beam * 0.65, detail === 'low' ? 7 : 12), materials.hull);
    tower.position.set(0, spec.beam * 0.5, spec.length * 0.05);
    parent.add(tower);
    const cap = this.mesh(model, new THREE.SphereGeometry(spec.beam * 0.2, detail === 'low' ? 7 : 12, 6), materials.accent);
    cap.position.set(0, spec.beam * 0.84, spec.length * 0.05);
    parent.add(cap);
    if (detail !== 'low') {
      const portholeCount = detail === 'high' ? 5 : 3;
      for (const side of [-1, 1]) {
        for (let index = 0; index < portholeCount; index += 1) {
          const porthole = this.mesh(model, new THREE.CylinderGeometry(0.52, 0.52, 0.16, 10), materials.glass);
          porthole.rotation.z = Math.PI / 2;
          porthole.position.set(
            side * spec.beam * 0.49,
            spec.beam * 0.08,
            (index / Math.max(1, portholeCount - 1) - 0.5) * spec.length * 0.48,
          );
          parent.add(porthole);
        }
      }
    }
    for (const side of [-1, 1]) {
      const fin = this.mesh(model, new THREE.BoxGeometry(spec.beam * 0.9, 0.45, spec.length * 0.16), materials.hullDark);
      fin.position.set(side * spec.beam * 0.55, 0, spec.length * 0.08);
      fin.rotation.y = side * 0.16;
      parent.add(fin);
    }
    const tail = this.mesh(model, new THREE.BoxGeometry(spec.beam * 0.12, spec.beam * 1.2, spec.length * 0.08), materials.accent);
    tail.position.set(0, 0, spec.length * 0.45);
    parent.add(tail);
    if (detail === 'high') {
      this.addCrew(model, parent, materials, 3);
      this.addDamageMarks(model, parent, materials);
    }
  }

  private addCrew(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet, maximum?: number): void {
    const spec = model.spec;
    const count = Math.min(maximum ?? 10, Math.max(3, Math.round(spec.crewCount * 0.55)));
    for (let index = 0; index < count; index += 1) {
      const rig = new THREE.Group();
      const phase = index * 1.73;
      const x = ((index % 4) / 3 - 0.5) * spec.beam * 0.48;
      const row = Math.floor(index / 4);
      const z = (row / Math.max(1, Math.ceil(count / 4) - 1) - 0.5) * spec.length * 0.33;
      rig.position.set(x, spec.draft * 0.28 + 1.7, z);
      rig.scale.setScalar(index === 0 ? 1.24 : 1.12 + index % 3 * 0.025);
      const bodyMaterial = index === 0 ? materials.accent : index % 3 === 0 ? materials.trim : index % 3 === 1 ? materials.sail : materials.cabin;
      const leftLeg = this.mesh(model, new THREE.CylinderGeometry(0.14, 0.17, 0.72, 5), materials.ink);
      const rightLeg = this.mesh(model, new THREE.CylinderGeometry(0.14, 0.17, 0.72, 5), materials.ink);
      leftLeg.position.set(-0.19, 0.36, 0);
      rightLeg.position.set(0.19, 0.36, 0);
      rig.add(leftLeg, rightLeg);
      const body = this.mesh(model, new THREE.CapsuleGeometry(0.44, 0.98, 3, 7), bodyMaterial);
      body.position.y = 1.25;
      rig.add(body);
      const sash = this.mesh(model, new THREE.CylinderGeometry(0.47, 0.47, 0.18, 8), index % 2 ? materials.accent : materials.trim);
      sash.position.y = 0.91;
      rig.add(sash);
      const head = this.mesh(model, new THREE.SphereGeometry(0.5, 8, 6), materials.skin);
      head.position.y = 2.25;
      rig.add(head);
      if (index === 0) {
        const brim = this.mesh(model, new THREE.CylinderGeometry(0.82, 0.82, 0.14, 12), materials.trim);
        brim.position.y = 2.7;
        const crown = this.mesh(model, new THREE.CylinderGeometry(0.5, 0.58, 0.38, 10), materials.accent);
        crown.position.y = 2.88;
        rig.add(brim, crown);
      } else if (index % 4 === 1) {
        const hair = this.mesh(model, new THREE.ConeGeometry(0.52, 0.72, 7), materials.ink);
        hair.position.set(0, 2.74, 0.1);
        rig.add(hair);
      } else if (index % 4 === 2) {
        const bandana = this.mesh(model, new THREE.TorusGeometry(0.48, 0.075, 5, 10), materials.accent);
        bandana.position.set(0, 2.3, -0.12);
        rig.add(bandana);
      } else {
        const cap = this.mesh(model, new THREE.SphereGeometry(0.54, 7, 5, 0, TAU, 0, Math.PI * 0.48), materials.white);
        cap.position.y = 2.41;
        rig.add(cap);
      }
      const leftArm = this.mesh(model, new THREE.CylinderGeometry(0.14, 0.17, 0.98, 6), materials.skin);
      const rightArm = this.mesh(model, new THREE.CylinderGeometry(0.14, 0.17, 0.98, 6), materials.skin);
      leftArm.position.set(-0.6, 1.38, 0);
      rightArm.position.set(0.6, 1.38, 0);
      rig.add(leftArm, rightArm);
      parent.add(rig);
      model.registerCrew({ root: rig, leftArm, rightArm, phase, baseY: rig.position.y });
    }
  }

  private addCabinDetails(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
    cabinPosition: THREE.Vector3,
    cabinWidth: number,
    cabinHeight: number,
    cabinDepth: number,
  ): void {
    const windowCount = detail === 'high' ? (model.kind === 'baratie' ? 4 : 3) : 2;
    const windowWidth = Math.min(3.2, Math.max(1.2, cabinDepth * 0.19));
    const windowHeight = Math.min(2.5, Math.max(1.15, cabinHeight * 0.3));
    for (const side of [-1, 1]) {
      for (let index = 0; index < windowCount; index += 1) {
        const z = cabinPosition.z + (index / Math.max(1, windowCount - 1) - 0.5) * cabinDepth * 0.68;
        const frame = this.mesh(model, new THREE.BoxGeometry(0.18, windowHeight * 1.22, windowWidth * 1.2), materials.trim);
        frame.position.set(side * (cabinWidth * 0.5 + 0.07), cabinPosition.y + cabinHeight * 0.09, z);
        parent.add(frame);
        const glass = this.mesh(model, new THREE.BoxGeometry(0.22, windowHeight, windowWidth), materials.glass);
        glass.position.set(side * (cabinWidth * 0.5 + 0.13), frame.position.y, z);
        parent.add(glass);
      }
    }
    const trimBand = this.mesh(model, new THREE.BoxGeometry(cabinWidth * 1.08, 0.28, cabinDepth * 1.08), materials.trim);
    trimBand.position.set(cabinPosition.x, cabinPosition.y - cabinHeight * 0.3, cabinPosition.z);
    parent.add(trimBand);
    const doorWidth = Math.min(2.6, cabinWidth * 0.24);
    const doorHeight = Math.min(3.8, cabinHeight * 0.7);
    const doorFrame = this.mesh(model, new THREE.BoxGeometry(doorWidth * 1.18, doorHeight * 1.1, 0.18), materials.trim);
    doorFrame.position.set(0, cabinPosition.y - cabinHeight * 0.5 + doorHeight * 0.52, cabinPosition.z + cabinDepth * 0.5 + 0.08);
    parent.add(doorFrame);
    const door = this.mesh(model, new THREE.BoxGeometry(doorWidth, doorHeight, 0.23), materials.hull);
    door.position.set(0, doorFrame.position.y, doorFrame.position.z + 0.04);
    parent.add(door);
    const doorGlass = this.mesh(model, new THREE.BoxGeometry(doorWidth * 0.52, doorHeight * 0.25, 0.26), materials.glass);
    doorGlass.position.set(0, door.position.y + doorHeight * 0.2, door.position.z + 0.04);
    parent.add(doorGlass);
    const knob = this.mesh(model, new THREE.SphereGeometry(0.11, 6, 4), materials.metal);
    knob.position.set(doorWidth * 0.32, door.position.y - doorHeight * 0.05, door.position.z + 0.18);
    parent.add(knob);
  }

  private addDamageMarks(model: ProceduralShipModel, parent: THREE.Group, materials: ShipMaterialSet): void {
    const spec = model.spec;
    for (let index = 0; index < 12; index += 1) {
      const side = index % 2 ? -1 : 1;
      const mark = this.mesh(model, new THREE.CircleGeometry(0.65 + index % 3 * 0.28, 7), materials.ink);
      mark.position.set(side * spec.beam * 0.5, -spec.draft * 0.1 + (index % 4) * 0.65, (index / 11 - 0.5) * spec.length * 0.58);
      mark.rotation.y = side * Math.PI / 2;
      mark.visible = false;
      parent.add(mark);
      model.registerDamageMark(mark);
    }
  }

  private makeSail(model: ProceduralShipModel, width: number, height: number, material: THREE.Material, detail: ShipDetail): THREE.Mesh {
    const segments = detail === 'high' ? 5 : 2;
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    const position = geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      const normalizedX = Math.abs(position.getX(index)) / (width * 0.5);
      const normalizedY = position.getY(index) / height + 0.5;
      position.setZ(index, (1 - normalizedX * normalizedX) * Math.sin(normalizedY * Math.PI) * width * 0.055);
    }
    geometry.computeVertexNormals();
    model.registerGeometry(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private addRiggingLine(model: ProceduralShipModel, parent: THREE.Group, start: THREE.Vector3, end: THREE.Vector3, material: THREE.Material): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    model.registerGeometry(geometry);
    parent.add(new THREE.Line(geometry, material));
  }

  private mesh(model: ProceduralShipModel, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): THREE.Mesh {
    model.registerGeometry(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private ellipsoid(model: ProceduralShipModel, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const mesh = this.mesh(model, new THREE.SphereGeometry(1, 12, 8), material);
    mesh.scale.set(x, y, z);
    return mesh;
  }

  private getMaterials(kind: ShipKind, palette: ShipPalette): ShipMaterialSet {
    const existing = this.materials.get(kind);
    if (existing) return existing;
    const set = this.options.materialFactory?.(kind, palette) ?? defaultMaterialSet(palette);
    this.materials.set(kind, set);
    return set;
  }
}

function createHullGeometry(length: number, beam: number, draft: number, segments: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const ringSize = 5;
  for (let segment = 0; segment <= segments; segment += 1) {
    const t = segment / segments;
    const z = (t - 0.5) * length;
    const silhouette = Math.pow(Math.max(0.001, Math.sin(t * Math.PI)), 0.42);
    const bowLift = Math.pow(Math.abs(t - 0.5) * 2, 2) * draft * 0.32;
    const width = beam * 0.5 * silhouette;
    const top = draft * 0.18 + bowLift;
    const keel = -draft * (0.82 - bowLift / Math.max(1, draft) * 0.32) * Math.pow(silhouette, 0.35);
    vertices.push(
      -width, top, z,
      -width * 0.82, -draft * 0.28, z,
      0, keel, z,
      width * 0.82, -draft * 0.28, z,
      width, top, z,
    );
    if (segment === 0) continue;
    const previous = (segment - 1) * ringSize;
    const current = segment * ringSize;
    for (let point = 0; point < ringSize - 1; point += 1) {
      const materialOffset = point === 1 || point === 2 ? 1 : 0;
      indices.push(
        previous + point, current + point, previous + point + 1,
        current + point, current + point + 1, previous + point + 1,
      );
      void materialOffset;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function toon(color: number, side: THREE.Side = THREE.FrontSide): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, side });
}

function defaultMaterialSet(palette: ShipPalette): ShipMaterialSet {
  const readableHull = liftDarkColor(palette.hull, 0.2);
  const readableHullDark = liftDarkColor(palette.hullDark, 0.245);
  const cabin = liftDarkColor(new THREE.Color(readableHullDark).lerp(new THREE.Color(readableHull), 0.18).getHex(), 0.29);
  return {
    hull: toon(readableHull, THREE.DoubleSide),
    hullDark: toon(readableHullDark, THREE.DoubleSide),
    cabin: toon(cabin, THREE.DoubleSide),
    trim: toon(palette.trim, THREE.DoubleSide),
    sail: toon(palette.sail, THREE.DoubleSide),
    accent: toon(palette.accent, THREE.DoubleSide),
    metal: toon(palette.metal, THREE.DoubleSide),
    glass: toon(0x63c9dc, THREE.DoubleSide),
    ink: new THREE.MeshBasicMaterial({ color: 0x171625, side: THREE.DoubleSide }),
    skin: toon(0xd99868, THREE.DoubleSide),
    white: toon(0xf2ead6, THREE.DoubleSide),
  };
}

function liftDarkColor(color: number, minimumLightness: number): number {
  const lifted = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  lifted.getHSL(hsl);
  lifted.setHSL(hsl.h, Math.min(0.82, hsl.s), Math.max(minimumLightness, hsl.l));
  return lifted.getHex();
}
