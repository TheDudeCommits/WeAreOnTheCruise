import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ShipHullAssets } from "../loaders/ShipHullAssets";
import { cannonMuzzleHeight } from "../../simulation/ballistics";
import { polarCrewSheltered } from "../../simulation/specials";
import { deckHeightAt, hullHalfWidth, mainDeckHeight, polarDeckHeightAt } from "./ShipDeckProfile";
import type { ShipDamage, ShipKind, ShipState } from "../../core/contracts";
import {
  getShipCrew,
  getShipSpec,
  type CrewAccessory,
  type CrewBuild,
  type CrewHat,
  type CrewMemberSpec,
  type ShipPalette,
  type ShipSpec,
} from "../../content";

const TAU = Math.PI * 2;

export type ShipDetail = "high" | "medium" | "low";

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
  baseX: number;
  baseZ: number;
  baseHeading: number;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  tool: THREE.Object3D;
  captain: boolean;
  combatant: boolean;
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
  private readonly fires: THREE.Group[] = [];
  private readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  private lastPortCooldown = 0;
  private portFiredAt = -100;
  private starboardFiredAt = -100;
  private lastStarboardCooldown = 0;
  private lastBowCooldown = 0;
  private lastUpdateTime = 0;
  private broadsideRecoil = 0;
  private bowRecoil = 0;
  private disposed = false;
  readonly freeboardLift: number;
  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor(
    readonly kind: ShipKind,
    readonly spec: ShipSpec,
  ) {
    this.freeboardLift = kind === "polar-tang" ? 0 : spec.draft * 0.38;
    this.root.userData.presentationFreeboardLift = this.freeboardLift;
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
    for (const anchor of [bow, stern, deck, cameraDeck])
      anchor.position.y += this.freeboardLift;
    this.root.add(bow, stern, deck, cameraDeck, wake);
    this.anchors = {
      bow,
      stern,
      deck,
      cameraDeck,
      wake,
      portCannons: [],
      starboardCannons: [],
      bowCannons: [],
      smoke: [],
    };
  }

  registerGeometry(geometry: THREE.BufferGeometry): void {
    this.ownedGeometries.add(geometry);
  }
  registerSail(sail: THREE.Object3D): void {
    if (sail instanceof THREE.Mesh) {
      const position = sail.geometry.getAttribute("position");
      sail.userData.restPositions = Float32Array.from(position.array);
      sail.userData.sailWidth =
        sail.geometry.parameters?.width ?? this.spec.beam;
      sail.userData.sailHeight =
        sail.geometry.parameters?.height ?? this.spec.beam;
      sail.userData.lastDamage = -1;
      for (const child of sail.children) {
        if (!(child instanceof THREE.Mesh) || child.name !== "sail-emblem")
          continue;
        child.userData.restPositions = Float32Array.from(
          child.geometry.getAttribute("position").array,
        );
      }
    }
    this.sails.push(sail);
  }
  registerMast(mast: THREE.Object3D): void {
    this.masts.push(mast);
  }
  registerDamageMark(mark: THREE.Object3D): void {
    this.damageMarks.push(mark);
  }
  registerCrew(rig: CrewRig): void {
    this.crew.push(rig);
  }
  registerFire(fire: THREE.Group): void {
    this.fires.push(fire);
  }

  update(state: ShipState, time: number): void {
    const damage = state.damage;
    this.updateDamage(damage);
    const dt = Math.min(0.1, Math.max(0, time - this.lastUpdateTime));
    this.lastUpdateTime = time;
    if (state.weapons.portCooldown > this.lastPortCooldown + 0.45) {
      this.broadsideRecoil = 0.065;
      this.portFiredAt = time;
    }
    if (state.weapons.starboardCooldown > this.lastStarboardCooldown + 0.45) {
      this.broadsideRecoil = -0.065;
      this.starboardFiredAt = time;
    }
    if (state.weapons.bowCooldown > this.lastBowCooldown + 0.45)
      this.bowRecoil = 1.35;
    this.lastPortCooldown = state.weapons.portCooldown;
    this.lastStarboardCooldown = state.weapons.starboardCooldown;
    this.lastBowCooldown = state.weapons.bowCooldown;
    this.broadsideRecoil *= Math.exp(-dt * 6.4);
    this.bowRecoil *= Math.exp(-dt * 7.2);
    this.lod.rotation.z = this.broadsideRecoil;
    this.lod.position.y =
      this.freeboardLift +
      Math.abs(this.broadsideRecoil) * this.spec.beam * 0.12;
    this.lod.position.z = this.bowRecoil;
    for (let index = 0; index < this.fires.length; index += 1) {
      const fire = this.fires[index];
      fire.visible =
        state.damage.hull > 0.52 + index * 0.1 &&
        !state.repairing &&
        state.damageStage !== "sunk";
      fire.scale.set(
        1 + Math.sin(time * 11 + index) * 0.14,
        1 + Math.sin(time * 15 + index * 3) * 0.28,
        1,
      );
      fire.rotation.y = time * 0.6 + index;
    }
    const speedRatio = Math.min(
      1.3,
      Math.abs(state.speed) / Math.max(1, state.maxSpeed),
    );
    const turnLean = -state.rudder * speedRatio * 0.22;
    for (const [side, anchors, firedAt] of [
      [-1, this.anchors.portCannons, this.portFiredAt],
      [1, this.anchors.starboardCannons, this.starboardFiredAt],
    ] as const) {
      anchors.forEach((anchor, index) => {
        const age = time - firedAt - index * 0.045;
        const recoil = age >= 0 && age < 1.3 ? Math.exp(-age * 5) * 1.4 : 0;
        const barrel = anchor.children[0];
        if (barrel) barrel.position.x = -side * recoil * 0.58;
      });
    }
    const allocation = state.crew ?? {
      helm: 25,
      guns: 25,
      repair: 25,
      special: 25,
    };
    const totalCrew = Math.max(
      1,
      allocation.helm +
        allocation.guns +
        allocation.repair +
        allocation.special,
    );
    const gunCut = allocation.guns / totalCrew;
    const repairCut = gunCut + allocation.repair / totalCrew;
    const specialCut = repairCut + allocation.special / totalCrew;
    for (let index = 0; index < this.crew.length; index += 1) {
      const rig = this.crew[index];
      // The submarine crew goes below before diving and returns only when
      // physical recovery finishes; nobody stands outside in the water.
      rig.root.visible = !polarCrewSheltered(state);
      const fraction = (index + 0.5) / this.crew.length;
      const role = rig.captain
        ? "helm"
        : fraction < gunCut
          ? "guns"
          : fraction < repairCut
            ? "repair"
            : fraction < specialCut
              ? "special"
              : "helm";
      const working = role === "repair" && state.repairing;
      const reloading =
        role === "guns" &&
        (state.weapons.portCooldown > 0 || state.weapons.starboardCooldown > 0);
      const bracing = state.brace > 0.1;
      const rallying = role === "special" && Boolean(state.specialPhase);
      const walkCycle = time * (working || reloading ? 5 : 2.3) + rig.phase;
      let targetX = rig.baseX;
      let targetZ = rig.baseZ;
      let targetHeading = rig.baseHeading;
      if (working || reloading) {
        const side = index % 2 ? -1 : 1;
        targetX = side * this.spec.beam * (working ? 0.27 : 0.34);
        targetZ =
          ((index % 4) / 3 - 0.5) * this.spec.length * 0.34 -
          this.spec.length * 0.08;
        targetHeading = (side * -Math.PI) / 2;
      }
      const movement = Math.hypot(
        targetX - rig.root.position.x,
        targetZ - rig.root.position.z,
      );
      const approach = 1 - Math.exp(-dt * 2.2);
      rig.root.position.x += (targetX - rig.root.position.x) * approach;
      rig.root.position.z += (targetZ - rig.root.position.z) * approach;
      rig.root.rotation.y +=
        Math.atan2(
          Math.sin(targetHeading - rig.root.rotation.y),
          Math.cos(targetHeading - rig.root.rotation.y),
        ) * approach;
      rig.root.rotation.z =
        turnLean * 0.65 + Math.sin(time * 2.1 + rig.phase) * 0.02;
      rig.root.rotation.x = bracing
        ? 0.26
        : working
          ? 0.27
          : reloading
            ? 0.18
            : 0;
      rig.root.position.y =
        (this.kind === "polar-tang"
          ? polarDeckHeightAt(this.spec, rig.root.position.x, rig.root.position.z) + .025
          : deckHeightAt(this.kind, this.spec, rig.root.position.z) + 0.03) -
        (bracing ? 0.22 : working ? 0.12 : 0) +
        (movement > 0.3 ? Math.abs(Math.sin(walkCycle)) * 0.09 : 0);
      rig.leftLeg.rotation.x =
        movement > 0.3 ? Math.sin(walkCycle) * 0.38 : bracing ? -0.18 : 0;
      rig.rightLeg.rotation.x =
        movement > 0.3 ? -Math.sin(walkCycle) * 0.38 : bracing ? 0.18 : 0;
      rig.leftArm.rotation.x = working
        ? -1.25
        : reloading
          ? -0.9 + Math.sin(walkCycle) * 0.35
          : rallying
            ? -2.7
            : bracing
              ? -0.7
              : Math.sin(walkCycle) * 0.12 - 0.2;
      rig.rightArm.rotation.x = working
        ? -1.2 + Math.sin(time * 7 + rig.phase) * 0.75
        : reloading
          ? -0.9 + Math.sin(walkCycle) * 0.35
          : rallying
            ? -2.7
            : rig.captain && state.targetId
              ? -1.4
              : -0.2 - Math.sin(walkCycle) * 0.12;
      rig.tool.visible = working;
      rig.root.userData.activeStation = role;
    }
    for (let index = 0; index < this.sails.length; index += 1) {
      const sail = this.sails[index];
      sail.rotation.y =
        Math.sin(time * 1.5 + index * 0.7) * (0.025 + speedRatio * 0.035);
      sail.rotation.z = Math.sin(time * 0.9 + index) * 0.012;
    }
  }

  updateDamage(damage: ShipDamage): void {
    for (let index = 0; index < this.damageMarks.length; index += 1) {
      const mark = this.damageMarks[index];
      const side = mark.userData.section as "port" | "starboard";
      mark.visible =
        Math.max(damage.hull * 0.75, damage.sections[side] ?? 0) >
        0.12 + Math.floor(index / 2) * 0.11;
    }
    for (let index = 0; index < this.sails.length; index += 1) {
      const sail = this.sails[index];
      if (!(sail instanceof THREE.Mesh)) continue;
      if (Math.abs((sail.userData.lastDamage as number) - damage.sails) < 0.015)
        continue;
      const rest = sail.userData.restPositions as Float32Array;
      if (!rest) continue;
      const height = sail.userData.sailHeight as number;
      const width = sail.userData.sailWidth as number;
      const updated = new Set<THREE.BufferGeometry>();
      // The paint is a cloth-mounted patch; damage must bend it with the same sail surface.
      for (const surface of [sail, ...sail.children]) {
        if (!(surface instanceof THREE.Mesh) || updated.has(surface.geometry))
          continue;
        const surfaceRest =
          surface === sail
            ? rest
            : (surface.userData.restPositions as Float32Array | undefined);
        if (!surfaceRest) continue;
        const position = surface.geometry.getAttribute("position");
        for (let vertex = 0; vertex < position.count; vertex += 1) {
          const x = surfaceRest[vertex * 3];
          const y = surfaceRest[vertex * 3 + 1];
          const edge = Math.max(0, 0.38 - (y / height + 0.5)) / 0.38;
          const rag =
            0.35 + Math.abs(Math.sin((x / width) * 28 + index * 3.1)) * 0.65;
          position.setXYZ(
            vertex,
            x,
            y + edge * damage.sails * height * 0.58 * rag,
            surfaceRest[vertex * 3 + 2] + edge * damage.sails * width * 0.07,
          );
        }
        position.needsUpdate = true;
        surface.geometry.computeVertexNormals();
        updated.add(surface.geometry);
      }
      sail.userData.lastDamage = damage.sails;
    }
    for (let index = 0; index < this.masts.length; index += 1) {
      this.masts[index].rotation.z =
        damage.sails > 0.62 && index === this.masts.length - 1
          ? (damage.sails - 0.62) * 1.2
          : 0;
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
  readonly hullAssets = new ShipHullAssets();
  ready(): Promise<void> {
    return this.hullAssets.ready();
  }
  private readonly materials = new Map<ShipKind, ShipMaterialSet>();
  private readonly crewMaterials = new Map<number, THREE.MeshToonMaterial>();
  private readonly deckMaterials = new Map<ShipKind, THREE.Material>();
  private readonly emblemMaterials = new Map<
    ShipKind,
    THREE.MeshBasicMaterial
  >();
  private readonly customMaterials: boolean;

  constructor(private readonly options: ShipGeometryFactoryOptions = {}) {
    this.customMaterials = Boolean(options.materialFactory);
  }

  create(kind: ShipKind): ProceduralShipModel {
    const spec = getShipSpec(kind);
    const materials = this.getMaterials(kind, spec.palette);
    const model = new ProceduralShipModel(kind, spec);
    const high = this.buildLevel(model, materials, "high");
    const medium = this.buildLevel(model, materials, "medium");
    const low = this.buildLevel(model, materials, "low");
    model.lod.addLevel(high, 0);
    model.lod.addLevel(medium, Math.max(105, spec.length * 2.15));
    model.lod.addLevel(low, Math.max(260, spec.length * 4.3));
    return model;
  }

  dispose(): void {
    this.hullAssets.dispose();
    for (const material of this.crewMaterials.values()) material.dispose();
    this.crewMaterials.clear();
    for (const material of this.deckMaterials.values()) material.dispose();
    this.deckMaterials.clear();
    for (const material of this.emblemMaterials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    this.emblemMaterials.clear();
    if (!this.customMaterials) {
      const disposed = new Set<THREE.Material>();
      for (const set of this.materials.values()) {
        for (const material of Object.values(set)) {
          if (!disposed.has(material)) material.dispose();
          disposed.add(material);
        }
      }
    }
    this.materials.clear();
  }

  private buildLevel(
    model: ProceduralShipModel,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `${model.kind}:${detail}`;
    if (model.kind === "polar-tang")
      this.buildPolarTang(model, group, materials, detail);
    else {
      const hull = new THREE.Group();
      hull.name = "hull-structure";
      group.add(hull);
      this.addHull(model, hull, materials, detail);
      this.addDeckAndRails(model, group, hull, materials, detail);
      if (detail !== "low")
        void this.hullAssets.mount(
          model.kind,
          hull,
          materials,
          () => !model.isDisposed,
          this.options.castShadow ?? true,
        );
      this.addRig(model, group, materials, detail);
      this.addCannons(model, group, materials, detail);
      this.addTieredDecks(model, group, materials, detail);
      this.addSignature(model, group, materials, detail);
      if (detail === "high") {
        this.addCrew(model, group, materials, detail);
        this.addDamageMarks(model, group, materials);
      } else if (detail === "medium") {
        this.addCrew(model, group, materials, detail, 4);
      }
    }
    const moving = new Set<THREE.Object3D>();
    group.traverse((object) => {
      if (
        object.name === "hull-structure" ||
        object.name === "mast-rig" ||
        object.name === "splintered-hull-breach" ||
        object.name === "critical-hull-fire" ||
        object.name.startsWith("crew:") ||
        object.userData.dynamicCannon
      )
        moving.add(object);
    });
    this.batchStatic(model, group, moving);
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Coplanar paint shares the cloth silhouette and needs no duplicate shadow-map draws.
      object.castShadow = object.name !== "sail-emblem" && (this.options.castShadow ?? true);
      object.receiveShadow = true;
      object.userData.nprOutline = true;
    });
    return group;
  }

  private addHull(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    const spec = model.spec;
    const segments = detail === "high" ? 18 : detail === "medium" ? 11 : 7;
    const geometry = createHullGeometry(
      spec.length,
      spec.beam,
      spec.draft,
      segments,
    );
    model.registerGeometry(geometry);
    const hull = new THREE.Mesh(geometry, materials.hull);
    hull.name = "hull";
    parent.add(hull);
    const trim = this.mesh(
      model,
      new THREE.BoxGeometry(spec.beam * 0.94, 0.55, spec.length * 0.75),
      materials.trim,
    );
    trim.position.y = spec.draft * 0.2 + 0.9;
    parent.add(trim);
    const keel = this.mesh(
      model,
      new THREE.BoxGeometry(
        spec.beam * 0.07,
        spec.draft * 0.35,
        spec.length * 0.65,
      ),
      materials.hullDark,
    );
    keel.position.y = -spec.draft * 0.72;
    parent.add(keel);
  }

  private addDeckAndRails(
    model: ProceduralShipModel,
    parent: THREE.Group,
    hull: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    const spec = model.spec;
    const deck = this.mesh(
      model,
      new THREE.BoxGeometry(spec.beam * 0.8, 0.6, spec.length * 0.7),
      materials.trim,
    );
    deck.position.y = spec.draft * 0.17 + 1.15;
    hull.add(deck);
    const cabinWidth =
      spec.beam *
      (model.kind === "baratie"
        ? 0.76
        : model.kind === "queen-mama-chanter"
          ? 0.62
          : model.kind === "navy-galleon"
            ? 0.64
            : 0.52);
    const cabinHeight =
      model.kind === "baratie"
        ? spec.draft * 1.2
        : model.kind === "navy-galleon"
          ? spec.draft * 0.84
          : spec.draft * 0.62;
    const cabinDepth = spec.length * 0.18;
    const cabin =
      model.kind === "thousand-sunny"
        ? this.mesh(
            model,
            new THREE.CylinderGeometry(
              cabinWidth * 0.5,
              cabinWidth * 0.53,
              cabinHeight,
              detail === "high" ? 24 : 12,
            ),
            materials.cabin,
          )
        : model.kind === "baratie" || model.kind === "queen-mama-chanter"
          ? this.mesh(
              model,
              new THREE.CylinderGeometry(
                cabinWidth * 0.47,
                cabinWidth * 0.52,
                cabinHeight,
                detail === "high" ? 12 : 8,
              ),
              materials.cabin,
            )
          : this.mesh(
              model,
              new THREE.BoxGeometry(cabinWidth, cabinHeight, cabinDepth),
              materials.cabin,
            );
    cabin.name = "cabin";
    cabin.position.set(
      0,
      deckHeightAt(model.kind, spec, spec.length * 0.22) +
        cabinHeight * 0.5 +
        0.06,
      spec.length * 0.22,
    );
    parent.add(cabin);
    const roof =
      model.kind === "thousand-sunny"
        ? this.sunnyDome(model, materials, cabinWidth * 0.57, detail)
        : model.kind === "baratie" || model.kind === "queen-mama-chanter"
          ? this.mesh(
              model,
              new THREE.ConeGeometry(
                cabinWidth * 0.56,
                Math.max(0.9, cabinHeight * 0.22),
                detail === "high" ? 12 : 8,
              ),
              materials.accent,
            )
          : this.mesh(
              model,
              new THREE.BoxGeometry(cabinWidth * 1.1, 0.65, spec.length * 0.21),
              materials.accent,
            );
    roof.position.set(
      cabin.position.x,
      cabin.position.y + cabinHeight * 0.55,
      cabin.position.z,
    );
    parent.add(roof);
    if (detail === "low") return;
    if (model.kind === "thousand-sunny")
      this.sunnyCabinWindows(
        model,
        parent,
        materials,
        cabin.position,
        cabinWidth,
        cabinHeight,
      );
    else
      this.addCabinDetails(
        model,
        parent,
        materials,
        detail,
        cabin.position,
        cabinWidth,
        cabinHeight,
        cabinDepth,
      );
    const railY = spec.draft * 0.2 + 2.05;
    for (const side of [-1, 1]) {
      const rail = this.mesh(
        model,
        new THREE.BoxGeometry(0.26, 1.15, spec.length * 0.66),
        materials.trim,
      );
      rail.position.set(side * spec.beam * 0.41, railY, 0);
      hull.add(rail);
      if (detail === "high") {
        const posts = 9;
        for (let index = 0; index < posts; index += 1) {
          const post = this.mesh(
            model,
            new THREE.CylinderGeometry(0.12, 0.12, 1.55, 5),
            materials.metal,
          );
          post.position.set(
            side * spec.beam * 0.415,
            railY + 0.2,
            (index / (posts - 1) - 0.5) * spec.length * 0.63,
          );
          hull.add(post);
        }
      }
    }
  }

  private deckMaterial(
    model: ProceduralShipModel,
    materials: ShipMaterialSet,
  ): THREE.Material {
    const existing = this.deckMaterials.get(model.kind);
    if (existing) return existing;
    const material = materials.hull.clone();
    if ("color" in material && material.color instanceof THREE.Color)
      material.color.setHex(0xc89555);
    if (
      material instanceof THREE.ShaderMaterial &&
      material.uniforms.uBaseColor
    )
      material.uniforms.uBaseColor.value = new THREE.Color(0xc89555);
    this.deckMaterials.set(model.kind, material);
    return material;
  }

  private addTieredDecks(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    if (model.kind !== "thousand-sunny" && model.kind !== "navy-galleon")
      return;
    const spec = model.spec,
      base = mainDeckHeight(spec),
      segments = detail === "low" ? 12 : 32;
    // Bow and quarterdeck are actual broad volumes, with a walkable connecting slope.
    for (const [start, end] of [
      [-0.485, -0.19],
      [0.13, 0.485],
    ]) {
      const points: number[] = [],
        indices: number[] = [];
      for (let index = 0; index <= segments; index++) {
        const z =
          THREE.MathUtils.lerp(start, end, index / segments) * spec.length;
        const width = hullHalfWidth(spec, z) * 0.94,
          top = deckHeightAt(model.kind, spec, z);
        points.push(
          -width,
          top,
          z,
          width,
          top,
          z,
          -width,
          base - 0.15,
          z,
          width,
          base - 0.15,
          z,
        );
        if (index) {
          const a = (index - 1) * 4,
            b = index * 4;
          indices.push(
            a,
            b,
            a + 1,
            b,
            b + 1,
            a + 1,
            a + 2,
            b + 2,
            a,
            b + 2,
            b,
            a,
            a + 1,
            b + 1,
            a + 3,
            b + 1,
            b + 3,
            a + 3,
          );
        }
      }
      indices.push(0, 1, 2, 1, 3, 2);
      const last = segments * 4;
      indices.push(last, last + 2, last + 1, last + 1, last + 2, last + 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(points, 3),
      );
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const deck = this.mesh(
        model,
        geometry,
        this.deckMaterial(model, materials),
      );
      deck.name = start < 0 ? "raised-forecastle" : "raised-stern-quarterdeck";
      parent.add(deck);
    }
    const railMaterial =
      model.kind === "thousand-sunny" ? materials.white : materials.trim;
    for (const side of [-1, 1]) {
      const wallVertices: number[] = [],
        wallIndices: number[] = [],
        cap: THREE.Vector3[] = [];
      for (let index = 0; index <= segments; index++) {
        const z =
          THREE.MathUtils.lerp(-0.48, 0.48, index / segments) * spec.length;
        const x = side * hullHalfWidth(spec, z) * 0.98,
          floor = deckHeightAt(model.kind, spec, z);
        const upper = floor + (Math.abs(z) > spec.length * 0.19 ? 1.28 : 1.6);
        wallVertices.push(x, base - 0.15, z, x, upper, z);
        cap.push(new THREE.Vector3(x, upper, z));
        if (index) {
          const a = (index - 1) * 2,
            b = index * 2;
          wallIndices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const wallGeometry = new THREE.BufferGeometry();
      wallGeometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(wallVertices, 3),
      );
      wallGeometry.setIndex(wallIndices);
      wallGeometry.computeVertexNormals();
      const wall = this.mesh(model, wallGeometry, materials.hull);
      wall.name = "sculpted-sheer-bulwark";
      parent.add(wall);
      const gunwale = this.mesh(
        model,
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(cap),
          segments * 2,
          spec.beam * 0.018,
          detail === "low" ? 4 : 7,
          false,
        ),
        railMaterial,
      );
      gunwale.name = "substantial-curved-gunwale";
      parent.add(gunwale);
      if (detail !== "low") {
        for (const t of [0.2, 0.36, 0.63, 0.8]) {
          const z = (t - 0.5) * spec.length,
            width = hullHalfWidth(spec, z),
            top = deckHeightAt(model.kind, spec, z) + 1.22;
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(side * width * 0.78, -spec.draft * 0.54, z),
            new THREE.Vector3(side * width * 0.95, -spec.draft * 0.1, z),
            new THREE.Vector3(side * width * 1.002, base * 0.65, z),
            new THREE.Vector3(side * width * 0.98, top, z),
          ]);
          const rib = this.mesh(
            model,
            new THREE.TubeGeometry(curve, 16, spec.beam * 0.022, 7, false),
            railMaterial,
          );
          rib.name = "heavy-pale-structural-rib";
          parent.add(rib);
        }
        for (let index = 0; index < 14; index++) {
          const z = (-0.45 + (index / 13) * 0.9) * spec.length,
            floor = deckHeightAt(model.kind, spec, z);
          const x = side * hullHalfWidth(spec, z) * 0.97;
          const post = this.mesh(
            model,
            new THREE.CylinderGeometry(0.1, 0.15, 1.24, 6),
            railMaterial,
          );
          post.position.set(x, floor + 0.7, z);
          parent.add(post);
        }
        // Stair treads deliberately span the two deck transitions.
        for (const stern of [false, true])
          for (let step = 0; step < 6; step++) {
            const z =
              (stern ? 0.135 + step * 0.011 : -0.195 - step * 0.011) *
              spec.length;
            const tread = this.mesh(
              model,
              new THREE.BoxGeometry(
                spec.beam * 0.18,
                0.22,
                spec.length * 0.013,
              ),
              this.deckMaterial(model, materials),
            );
            tread.position.set(
              side * spec.beam * 0.25,
              deckHeightAt(model.kind, spec, z) + 0.1,
              z,
            );
            parent.add(tread);
          }
      }
    }
  }

  private addRig(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    const spec = model.spec;
    if (spec.mastCount === 0) return;
    const mastPositions = Array.from({ length: spec.mastCount }, (_, index) =>
      spec.mastCount === 1 ? 0 : -0.28 + (index / (spec.mastCount - 1)) * 0.56,
    );
    for (let index = 0; index < spec.mastCount; index += 1) {
      const fraction =
        model.kind === "thousand-sunny"
          ? index === 0
            ? -0.08
            : 0.32
          : (mastPositions[index] ?? 0);
      const normalizedMast =
        spec.mastCount === 1 ? 0 : index / (spec.mastCount - 1);
      const heightScale =
        model.kind === "red-force"
          ? ([0.9, 1, 0.94, 0.72][index] ?? 0.8)
          : model.kind === "moby-dick"
            ? ([0.82, 1, 0.92, 0.7][index] ?? 0.78)
            : spec.mastCount === 2
              ? index === 0
                ? 1
                : 0.78
              : 0.8 + Math.sin(normalizedMast * Math.PI) * 0.2;
      const mastHeight =
        model.kind === "thousand-sunny"
          ? spec.length * 0.69 * (index === 0 ? 1 : 0.71)
          : spec.length * 0.56 * heightScale;
      const mastGroup = new THREE.Group();
      mastGroup.name = "mast-rig";
      mastGroup.position.set(0, spec.draft * 0.2 + 1.4, fraction * spec.length);
      const mast = this.mesh(
        model,
        new THREE.CylinderGeometry(
          spec.beam * 0.018,
          spec.beam * 0.026,
          mastHeight,
          detail === "high" ? 8 : 5,
        ),
        materials.hullDark,
      );
      mast.position.y = mastHeight * 0.5;
      mastGroup.add(mast);
      const yardCount =
        model.kind === "thousand-sunny"
          ? 1
          : detail === "low"
            ? 1
            : detail === "high" &&
                (model.kind === "red-force" || model.kind === "oro-jackson") &&
                index < 3
              ? 3
              : 2;
      for (let yard = 0; yard < yardCount; yard += 1) {
        const yardY =
          mastHeight *
          (model.kind === "thousand-sunny"
            ? 0.92
            : yardCount === 3
              ? 0.48 + yard * 0.2
              : 0.54 + yard * 0.24);
        const yardWidth =
          spec.beam *
          (model.kind === "thousand-sunny"
            ? index === 0
              ? 1.55
              : 0.74
            : (yard === 0 ? 1.36 : yard === 1 ? 1.05 : 0.8) * heightScale);
        const boom = this.mesh(
          model,
          new THREE.CylinderGeometry(
            spec.beam * 0.017,
            spec.beam * 0.022,
            yardWidth,
            8,
          ),
          materials.hullDark,
        );
        boom.rotation.z = Math.PI / 2;
        boom.position.y = yardY;
        mastGroup.add(boom);
        const sailHeight =
          mastHeight *
          (model.kind === "thousand-sunny"
            ? index === 0
              ? 0.67
              : 0.58
            : yard === 0
              ? 0.29
              : yard === 1
                ? 0.22
                : 0.16);
        const sailMaterial =
          model.kind === "oro-jackson" ||
          (model.kind === "thousand-sunny" && index === 1)
            ? materials.accent
            : materials.sail;
        const sail = this.makeSail(
          model,
          yardWidth * 0.88,
          sailHeight,
          sailMaterial,
          detail,
        );
        sail.name = "sail-cloth";
        sail.position.set(0, yardY - sailHeight * 0.5 - 0.15, -0.22);
        mastGroup.add(sail);
        if (model.kind === "oro-jackson" && detail !== "low") {
          const stripeCount = 5;
          for (
            let stripeIndex = 0;
            stripeIndex < stripeCount;
            stripeIndex += 1
          ) {
            const stripe = this.mesh(
              model,
              new THREE.PlaneGeometry(yardWidth * 0.055, sailHeight * 0.88),
              materials.trim,
            );
            stripe.position.set(
              (stripeIndex / (stripeCount - 1) - 0.5) * yardWidth * 0.64,
              sail.position.y,
              sail.position.z - 0.12,
            );
            mastGroup.add(stripe);
          }
        }
        if (yard === 0 && index === 0 && detail !== "low") {
          for (const side of [1, -1] as const) {
            sail.add(this.makeSailEmblem(model, yardWidth * 0.66, sailHeight * 0.76, sail, side));
          }
        }
        if (detail === "high") model.registerSail(sail);
      }
      if (
        detail === "high" &&
        (index === 0 || (index === 1 && spec.mastCount > 2))
      ) {
        const nest = this.mesh(
          model,
          new THREE.CylinderGeometry(
            spec.beam * 0.13,
            spec.beam * 0.17,
            spec.beam * 0.14,
            10,
            1,
            true,
          ),
          materials.trim,
        );
        nest.position.y = mastHeight * 0.76;
        mastGroup.add(nest);
        const nestFloor = this.mesh(
          model,
          new THREE.CylinderGeometry(
            spec.beam * 0.17,
            spec.beam * 0.17,
            0.16,
            10,
          ),
          materials.hullDark,
        );
        nestFloor.position.y = nest.position.y - spec.beam * 0.07;
        mastGroup.add(nestFloor);
      }
      if (detail !== "low" && model.kind === "queen-mama-chanter") {
        const cone = this.mesh(
          model,
          new THREE.ConeGeometry(spec.beam * 0.11, spec.beam * 0.42, 9),
          index % 2 ? materials.accent : materials.trim,
        );
        cone.position.y = mastHeight + spec.beam * 0.16;
        cone.rotation.z = index % 2 ? 0.08 : -0.08;
        mastGroup.add(cone);
      }
      if (detail !== "low" && model.kind === "navy-galleon") {
        const bone = this.mesh(
          model,
          new THREE.CylinderGeometry(0.2, 0.2, spec.beam * 0.55, 7),
          materials.white,
        );
        bone.position.y = mastHeight * 0.96;
        bone.rotation.z = Math.PI / 2;
        mastGroup.add(bone);
        for (const side of [-1, 1]) {
          const paw = this.mesh(
            model,
            new THREE.SphereGeometry(spec.beam * 0.055, 7, 5),
            materials.white,
          );
          paw.position.set(side * spec.beam * 0.29, bone.position.y, 0);
          mastGroup.add(paw);
        }
      }
      const fabric = new Set<THREE.Object3D>();
      mastGroup.traverse((object) => {
        if (object.name === "sail-cloth" || object.name === "sail-emblem")
          fabric.add(object);
      });
      this.batchStatic(model, mastGroup, fabric);
      parent.add(mastGroup);
      if (detail === "high") model.registerMast(mastGroup);
      if (detail === "high") {
        const ropes: THREE.Vector3[] = [];
        const addRope = (from: THREE.Vector3, to: THREE.Vector3): void => {
          ropes.push(from, to);
        };
        for (const side of [-1, 1]) {
          const top = new THREE.Vector3(
            0,
            spec.draft * 0.2 + 1.4 + mastHeight * 0.81,
            fraction * spec.length,
          );
          const footA = new THREE.Vector3(
            side * spec.beam * 0.43,
            spec.draft * 0.17 + 2.8,
            fraction * spec.length - spec.length * 0.055,
          );
          const footB = footA.clone();
          footB.z += spec.length * 0.11;
          for (let shroud = 0; shroud < 4; shroud += 1)
            addRope(top, footA.clone().lerp(footB, shroud / 3));
          for (let rung = 1; rung < 13; rung += 1)
            addRope(
              footA.clone().lerp(top, rung / 15),
              footB.clone().lerp(top, rung / 15),
            );
        }
        if (index === 0) {
          addRope(
            new THREE.Vector3(
              0,
              spec.draft * 0.2 + mastHeight,
              fraction * spec.length,
            ),
            new THREE.Vector3(0, spec.draft * 0.2 + 2.5, -spec.length * 0.52),
          );
        }
        const ropeGeometry = new THREE.BufferGeometry().setFromPoints(ropes);
        model.registerGeometry(ropeGeometry);
        const rigging = new THREE.LineSegments(ropeGeometry, materials.ink);
        rigging.name = "standing-rigging-and-ratlines";
        parent.add(rigging);
      }
    }
  }

  private addCannons(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    if (detail === "low") return;
    const spec = model.spec,
      count = Math.min(6, spec.broadsideCannons);
    const barrelLength = Math.max(1.45, Math.min(3.1, spec.beam * 0.105));
    const radius = Math.max(0.42, Math.min(0.82, spec.beam * 0.022));
    const muzzleY =
      cannonMuzzleHeight(model.kind, "port") - model.freeboardLift;
    for (const side of [-1, 1] as const)
      for (let index = 0; index < count; index++) {
        const normalized = count === 1 ? 0 : index / (count - 1) - 0.5;
        const z = -normalized * spec.length * 0.44;
        const anchor = new THREE.Group();
        anchor.name = "recessed-broadside-mount";
        anchor.userData.dynamicCannon = detail === "high";
        anchor.position.set(side * spec.beam * 0.48, muzzleY, z);
        const assembly = new THREE.Group();
        assembly.name = "recoiling-short-barrel";
        anchor.add(assembly);
        const barrel = this.mesh(
          model,
          new THREE.CylinderGeometry(
            radius * 0.87,
            radius * 1.24,
            barrelLength,
            detail === "high" ? 12 : 8,
          ),
          materials.metal,
        );
        barrel.rotation.z = (-side * Math.PI) / 2;
        barrel.position.x = -side * barrelLength * 0.5;
        assembly.add(barrel);
        const muzzle = this.mesh(
          model,
          new THREE.TorusGeometry(
            radius * 0.9,
            radius * 0.18,
            6,
            detail === "high" ? 12 : 8,
          ),
          materials.trim,
        );
        muzzle.rotation.y = Math.PI / 2;
        assembly.add(muzzle);
        const bore = this.mesh(
          model,
          new THREE.CircleGeometry(radius * 0.72, 12),
          materials.ink,
        );
        bore.rotation.y = (side * Math.PI) / 2;
        bore.position.x = side * 0.025;
        assembly.add(bore);
        const band = this.mesh(
          model,
          new THREE.TorusGeometry(radius * 1.1, radius * 0.11, 5, 10),
          materials.trim,
        );
        band.rotation.y = Math.PI / 2;
        band.position.x = -side * barrelLength * 0.65;
        assembly.add(band);
        const carriage = this.mesh(
          model,
          new THREE.BoxGeometry(barrelLength * 0.78, 0.5, radius * 2.9),
          materials.hullDark,
        );
        carriage.position.set(-side * barrelLength * 0.64, -radius * 0.9, 0);
        anchor.add(carriage);
        // Dark reveal and pale frame sit against the curved hull, behind the barrel mouth.
        const skinX = side * hullHalfWidth(spec, z) * 1.002 - anchor.position.x;
        const port = this.mesh(
          model,
          new THREE.BoxGeometry(0.11, radius * 3.2, radius * 3.65),
          materials.ink,
        );
        port.position.x = skinX;
        anchor.add(port);
        for (const vertical of [-1, 1]) {
          const frame = this.mesh(
            model,
            new THREE.BoxGeometry(0.22, 0.18, radius * 3.8),
            materials.trim,
          );
          frame.position.set(skinX + side * 0.08, vertical * radius * 1.58, 0);
          anchor.add(frame);
        }
        for (const horizontal of [-1, 1]) {
          const frame = this.mesh(
            model,
            new THREE.BoxGeometry(0.22, radius * 3.2, 0.18),
            materials.trim,
          );
          frame.position.set(
            skinX + side * 0.08,
            0,
            horizontal * radius * 1.83,
          );
          anchor.add(frame);
        }
        if (detail === "high") {
          for (const wheelSide of [-1, 1]) {
            const wheel = this.mesh(
              model,
              new THREE.CylinderGeometry(radius * 0.57, radius * 0.57, 0.18, 8),
              materials.hullDark,
            );
            wheel.rotation.x = Math.PI / 2;
            wheel.position.set(
              -side * barrelLength * 0.6,
              -radius * 0.93,
              wheelSide * radius * 1.6,
            );
            anchor.add(wheel);
          }
          if (side < 0) model.anchors.portCannons.push(anchor);
          else model.anchors.starboardCannons.push(anchor);
          model.anchors.smoke.push(anchor);
        }
        this.batchStatic(model, assembly, new Set()); // The whole barrel still recoils as one pivot.
        for (const fixed of [...anchor.children]) {
          if (fixed === assembly) continue;
          fixed.position.add(anchor.position);
          parent.add(fixed);
        }
        parent.add(anchor);
      }
    for (let index = 0; index < Math.min(spec.bowCannons, 3); index++) {
      const normalized =
        Math.min(spec.bowCannons, 3) === 1
          ? 0
          : index / (Math.min(spec.bowCannons, 3) - 1) - 0.5;
      const anchor = new THREE.Group();
      anchor.userData.dynamicCannon = detail === "high";
      anchor.position.set(
        0,
        cannonMuzzleHeight(model.kind, "bow") - model.freeboardLift,
        -spec.length * 0.48,
      );
      const barrel = this.mesh(
        model,
        new THREE.CylinderGeometry(
          radius * 0.95,
          radius * 1.2,
          barrelLength,
          10,
        ),
        materials.metal,
      );
      barrel.rotation.x = -Math.PI / 2;
      barrel.position.set(normalized * radius * 3, 0, barrelLength * 0.5);
      anchor.add(barrel);
      const mouth = this.mesh(
        model,
        new THREE.CircleGeometry(radius * 0.72, 10),
        materials.ink,
      );
      mouth.position.set(barrel.position.x, 0, -0.02);
      mouth.rotation.y = Math.PI;
      anchor.add(mouth);
      parent.add(anchor);
      if (detail === "high") model.anchors.bowCannons.push(anchor);
    }
  }

  private addSignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    const spec = model.spec;
    const bowZ = -spec.length * 0.52;
    switch (model.kind) {
      case "thousand-sunny":
        this.addSunnySignature(model, parent, materials, bowZ, detail);
        break;
      case "going-merry":
        this.addMerrySignature(model, parent, materials, bowZ, detail);
        break;
      case "moby-dick":
        this.addMobySignature(model, parent, materials, bowZ, detail);
        break;
      case "red-force":
        this.addRedForceSignature(model, parent, materials, bowZ, detail);
        break;
      case "oro-jackson":
        this.addOroSignature(model, parent, materials, bowZ, detail);
        break;
      case "queen-mama-chanter":
        this.addQueenSignature(model, parent, materials, bowZ, detail);
        break;
      case "baratie":
        this.addBaratieSignature(model, parent, materials, bowZ, detail);
        break;
      case "navy-galleon":
        this.addNavySignature(model, parent, materials, bowZ, detail);
        break;
      case "polar-tang":
        break;
    }
  }

  private addSunnySignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.22;
    const headY = model.spec.draft * 0.35 + size;
    const connector = this.mesh(
      model,
      new THREE.CylinderGeometry(
        size * 0.48,
        size * 0.7,
        size * 1.55,
        detail === "low" ? 7 : 10,
      ),
      materials.trim,
    );
    connector.name = "sunny-lion-bow-connector";
    connector.position.set(0, headY - size * 0.62, bowZ + size * 0.62);
    connector.rotation.x = -0.48;
    parent.add(connector);
    const collar = this.mesh(
      model,
      new THREE.TorusGeometry(
        size * 0.58,
        size * 0.13,
        6,
        detail === "low" ? 10 : 18,
      ),
      materials.accent,
    );
    collar.position.set(0, headY - size * 0.43, bowZ + size * 0.24);
    collar.rotation.x = Math.PI / 2;
    parent.add(collar);
    const warmIvory = this.crewMaterial(0xffe7b2);
    const head = this.mesh(
      model,
      new THREE.SphereGeometry(1, detail === "high" ? 28 : detail === "medium" ? 20 : 12, detail === "high" ? 18 : 10),
      materials.trim,
    );
    head.scale.set(size * .95, size * .98, size * .67);
    head.name = "sunny-lion-head";
    head.position.set(0, headY, bowZ);
    parent.add(head);
    const maneRing = this.mesh(model, new THREE.TorusGeometry(size * .99, size * .18, 8, detail === "low" ? 12 : 28), materials.accent);
    maneRing.position.set(0, headY, bowZ + size * .18);
    parent.add(maneRing);
    // Tapered, curved sun-shaped locks replace the old blunt capsule spokes.
    for (let index = 0; index < 10; index += 1) {
      const angle = index / 10 * TAU + Math.PI * .1;
      const lock = new THREE.Shape();
      lock.moveTo(-size * .18, 0);
      lock.quadraticCurveTo(-size * .3, size * .3, size * .045, size * .72);
      lock.quadraticCurveTo(size * .08, size * .4, size * .2, size * .05);
      lock.quadraticCurveTo(size * .08, -size * .12, -size * .18, 0);
      const geometry = new THREE.ExtrudeGeometry(lock, { depth: size * .2, bevelEnabled: detail !== "low", bevelSize: size * .025, bevelThickness: size * .035, bevelSegments: 1, curveSegments: detail === "high" ? 5 : 3, steps: 1 });
      geometry.translate(0, 0, -size * .1);
      const ray = this.mesh(model, geometry, materials.accent);
      ray.name = "sunny-tapered-mane";
      ray.position.set(Math.cos(angle) * size * .9, headY + Math.sin(angle) * size * .9, bowZ + size * .12);
      ray.rotation.z = angle - Math.PI / 2;
      parent.add(ray);
    }
    const chin = this.ellipsoid(model, size * .43, size * .36, size * .13, warmIvory);
    chin.name = "sunny-warm-muzzle";
    chin.position.set(0, headY - size * .23, bowZ - size * .65);
    parent.add(chin);
    for (const side of [-1, 1]) {
      const cheek = this.ellipsoid(model, size * .27, size * .19, size * .1, warmIvory);
      cheek.position.set(side * size * .17, headY - size * .09, bowZ - size * .7);
      parent.add(cheek);
      if (detail !== "low") {
        const ear = this.ellipsoid(model, size * .19, size * .24, size * .14, materials.trim);
        ear.position.set(side * size * .76, headY + size * .58, bowZ - size * .06);
        parent.add(ear);
      }
    }
    const nose = this.ellipsoid(model, size * .12, size * .085, size * .065, materials.ink);
    nose.position.set(0, headY + size * .025, bowZ - size * .77);
    parent.add(nose);
    if (detail !== "low") {
      for (const side of [-1, 1]) {
        const eyeX = side * size * .35, eyeY = headY + size * .26;
        const socket = this.ellipsoid(model, size * .215, size * .265, size * .08, materials.ink);
        socket.position.set(eyeX, eyeY, bowZ - size * .585);
        parent.add(socket);
        const eye = this.ellipsoid(model, size * .178, size * .225, size * .064, warmIvory);
        eye.position.set(eyeX, eyeY, bowZ - size * .627);
        parent.add(eye);
        const pupil = this.ellipsoid(model, size * .092, size * .143, size * .048, materials.ink);
        pupil.position.set(eyeX - side * size * .014, eyeY, bowZ - size * .688);
        parent.add(pupil);
        const glint = this.ellipsoid(model, size * .036, size * .046, size * .015, warmIvory);
        glint.position.set(eyeX - size * .029, eyeY + size * .064, bowZ - size * .733);
        parent.add(glint);
      }
      const smile = new THREE.CubicBezierCurve3(
        new THREE.Vector3(-size * .26, headY - size * .27, bowZ - size * .774),
        new THREE.Vector3(-size * .17, headY - size * .46, bowZ - size * .79),
        new THREE.Vector3(size * .17, headY - size * .46, bowZ - size * .79),
        new THREE.Vector3(size * .26, headY - size * .27, bowZ - size * .774),
      );
      parent.add(this.mesh(model, new THREE.TubeGeometry(smile, 14, size * .018, 5, false), materials.ink));

      const lawn = this.mesh(
        model,
        new THREE.BoxGeometry(
          model.spec.beam * 0.42,
          0.18,
          model.spec.length * 0.2,
        ),
        this.crewMaterial(0x58a95b),
      );
      lawn.name = "sunny-deck-lawn";
      lawn.position.set(
        0,
        model.spec.draft * 0.18 + 1.55,
        -model.spec.length * 0.03,
      );
      parent.add(lawn);
      for (const side of [-1, 1]) {
        for (let index = 0; index < 3; index += 1) {
          const dockPlate = this.mesh(
            model,
            new THREE.CylinderGeometry(size * 0.26, size * 0.26, 0.2, 12),
            index === 1 ? materials.accent : materials.trim,
          );
          dockPlate.name = `sunny-soldier-dock:${index + 1}`;
          dockPlate.rotation.z = Math.PI / 2;
          dockPlate.position.set(
            side * model.spec.beam * 0.485,
            model.spec.draft * 0.02 + size * 0.25,
            (index - 1) * model.spec.length * 0.16,
          );
          parent.add(dockPlate);
          const dockHub = this.mesh(
            model,
            new THREE.CylinderGeometry(size * 0.095, size * 0.095, 0.24, 10),
            materials.metal,
          );
          dockHub.name = `sunny-soldier-dock-hub:${index + 1}`;
          dockHub.rotation.z = Math.PI / 2;
          dockHub.position.copy(dockPlate.position);
          dockHub.position.x += side * 0.08;
          parent.add(dockHub);
        }
      }
      if (detail === "high") {
        for (const side of [-1, 1]) {
          const tree = new THREE.Group();
          tree.position.set(
            side * model.spec.beam * 0.28,
            deckHeightAt(model.kind, model.spec, model.spec.length * 0.15),
            model.spec.length * 0.15,
          );
          const trunk = this.mesh(
            model,
            new THREE.CylinderGeometry(0.2, 0.35, 3.4, 7),
            materials.hullDark,
          );
          trunk.position.y = 1.7;
          tree.add(trunk);
          for (let cluster = 0; cluster < 7; cluster += 1) {
            const angle = cluster * 2.4;
            const leaf = this.mesh(
              model,
              new THREE.SphereGeometry(1.35, 9, 6),
              this.crewMaterial(cluster % 2 ? 0x429744 : 0x66ac4e),
            );
            leaf.position.set(
              Math.cos(angle) * 1.1,
              3.2 + Math.sin(cluster * 1.8) * 0.65,
              Math.sin(angle) * 1.1,
            );
            tree.add(leaf);
          }
          for (let fruit = 0; fruit < 12; fruit += 1) {
            const angle = fruit * 2.4;
            const orange = this.mesh(
              model,
              new THREE.SphereGeometry(0.22, 6, 4),
              this.crewMaterial(0xffb42d),
            );
            orange.position.set(
              Math.cos(angle) * 1.8,
              2.8 + Math.sin(fruit * 1.4) * 0.9,
              Math.sin(angle) * 1.8,
            );
            tree.add(orange);
          }
          parent.add(tree);
        }
      }
      for (const x of [-0.23, 0, 0.23]) {
        const booster = this.mesh(
          model,
          new THREE.CylinderGeometry(size * 0.23, size * 0.34, size * 0.72, 9),
          materials.metal,
        );
        booster.name = "sunny-coup-de-burst-nozzle";
        booster.rotation.x = Math.PI / 2;
        booster.position.set(
          x * model.spec.beam,
          model.spec.draft * 0.05 + 0.8,
          model.spec.length * 0.48,
        );
        parent.add(booster);
      }
    }
  }

  private addMerrySignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.2;
    const neck = this.mesh(
      model,
      new THREE.CylinderGeometry(size * 0.26, size * 0.35, size * 2.1, 7),
      materials.white,
    );
    neck.position.set(0, model.spec.draft * 0.45 + size, bowZ + size * 0.25);
    parent.add(neck);
    const head = this.ellipsoid(
      model,
      size * 0.72,
      size * 0.62,
      size * 0.78,
      materials.white,
    );
    head.position.set(0, neck.position.y + size * 1.2, bowZ - size * 0.42);
    parent.add(head);
    for (const side of [-1, 1]) {
      const horn = this.mesh(
        model,
        new THREE.TorusGeometry(
          size * 0.44,
          size * 0.12,
          6,
          detail === "low" ? 10 : 18,
        ),
        materials.trim,
      );
      horn.position.set(
        side * size * 0.65,
        head.position.y + size * 0.12,
        bowZ - size * 0.15,
      );
      horn.rotation.y = Math.PI / 2;
      parent.add(horn);
    }
    if (detail !== "low") {
      for (const side of [-1, 1]) {
        const eye = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.105, 7, 5),
          materials.ink,
        );
        eye.position.set(
          side * size * 0.25,
          head.position.y + size * 0.1,
          bowZ - size * 1.14,
        );
        parent.add(eye);
        const ear = this.mesh(
          model,
          new THREE.ConeGeometry(size * 0.18, size * 0.48, 5),
          materials.white,
        );
        ear.position.set(
          side * size * 0.56,
          head.position.y + size * 0.28,
          bowZ - size * 0.34,
        );
        ear.rotation.z = side * -0.7;
        parent.add(ear);
      }
      const muzzle = this.ellipsoid(
        model,
        size * 0.42,
        size * 0.24,
        size * 0.25,
        materials.trim,
      );
      muzzle.position.set(0, head.position.y - size * 0.18, bowZ - size * 1.13);
      parent.add(muzzle);
      const smile = this.mesh(
        model,
        new THREE.TorusGeometry(size * 0.26, size * 0.045, 5, 12, Math.PI),
        materials.ink,
      );
      smile.position.set(0, head.position.y - size * 0.27, bowZ - size * 1.38);
      smile.rotation.z = Math.PI;
      parent.add(smile);
      const whiteRail = this.mesh(
        model,
        new THREE.BoxGeometry(
          model.spec.beam * 0.93,
          0.38,
          model.spec.length * 0.57,
        ),
        materials.white,
      );
      whiteRail.position.set(0, model.spec.draft * 0.25 + 1.32, 0);
      parent.add(whiteRail);
      for (let treeIndex = 0; treeIndex < 3; treeIndex += 1) {
        const trunk = this.mesh(
          model,
          new THREE.CylinderGeometry(0.09, 0.12, size * 0.82, 6),
          materials.hullDark,
        );
        trunk.position.set(
          (treeIndex - 1) * size * 0.55,
          model.spec.draft * 0.35 + size * 0.5,
          model.spec.length * 0.24,
        );
        parent.add(trunk);
        const leaves = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.34, 7, 5),
          this.crewMaterial(0x4f954c),
        );
        leaves.position.set(
          trunk.position.x,
          trunk.position.y + size * 0.48,
          trunk.position.z,
        );
        parent.add(leaves);
        const fruit = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.07, 5, 4),
          this.crewMaterial(0xe8782c),
        );
        fruit.position.set(
          leaves.position.x + size * 0.16,
          leaves.position.y - size * 0.08,
          leaves.position.z - size * 0.18,
        );
        parent.add(fruit);
      }
    }
  }

  private addMobySignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const beam = model.spec.beam;
    const whaleHull = this.ellipsoid(
      model,
      beam * 0.5,
      model.spec.draft * 0.72,
      model.spec.length * 0.49,
      materials.white,
    );
    whaleHull.name = "moby-integrated-whale-hull";
    whaleHull.position.set(
      0,
      -model.spec.draft * 0.56,
      -model.spec.length * 0.015,
    );
    parent.add(whaleHull);
    const darkBelly = this.ellipsoid(
      model,
      beam * 0.39,
      model.spec.draft * 0.34,
      model.spec.length * 0.42,
      materials.hullDark,
    );
    darkBelly.position.set(
      0,
      -model.spec.draft * 1.03,
      model.spec.length * 0.01,
    );
    parent.add(darkBelly);
    const whale = this.ellipsoid(
      model,
      beam * 0.4,
      beam * 0.22,
      beam * 0.56,
      materials.white,
    );
    whale.position.set(
      0,
      model.spec.draft * 0.15 + beam * 0.05,
      bowZ - beam * 0.12,
    );
    parent.add(whale);
    for (const side of [-1, 1]) {
      const fin = this.mesh(
        model,
        new THREE.ConeGeometry(
          beam * 0.22,
          beam * 0.75,
          detail === "low" ? 4 : 6,
        ),
        materials.white,
      );
      fin.position.set(
        side * beam * 0.34,
        whale.position.y - beam * 0.05,
        bowZ + beam * 0.08,
      );
      fin.rotation.z = side * Math.PI * 0.48;
      parent.add(fin);
    }
    const sprayCrown = this.mesh(
      model,
      new THREE.ConeGeometry(beam * 0.11, beam * 0.45, 7),
      materials.accent,
    );
    sprayCrown.position.set(
      0,
      whale.position.y + beam * 0.32,
      bowZ - beam * 0.12,
    );
    parent.add(sprayCrown);
    if (detail !== "low") {
      const whaleBlue = this.crewMaterial(0x3d7899);
      for (const side of [-1, 1]) {
        const eye = this.mesh(
          model,
          new THREE.SphereGeometry(beam * 0.035, 7, 5),
          materials.ink,
        );
        eye.position.set(
          side * beam * 0.24,
          whale.position.y + beam * 0.08,
          bowZ - beam * 0.65,
        );
        parent.add(eye);
      }
      const mouth = this.ellipsoid(
        model,
        beam * 0.24,
        beam * 0.025,
        beam * 0.025,
        materials.ink,
      );
      mouth.position.set(0, whale.position.y - beam * 0.1, bowZ - beam * 0.68);
      parent.add(mouth);
      for (let index = 0; index < 7; index += 1) {
        const groove = this.mesh(
          model,
          new THREE.BoxGeometry(beam * 0.026, beam * 0.22, beam * 0.025),
          whaleBlue,
        );
        groove.position.set(
          (index / 6 - 0.5) * beam * 0.5,
          whale.position.y - beam * 0.15,
          bowZ - beam * 0.675,
        );
        groove.rotation.z = (index / 6 - 0.5) * 0.45;
        parent.add(groove);
      }
      for (const side of [-1, 1]) {
        const hullBand = this.mesh(
          model,
          new THREE.BoxGeometry(0.35, beam * 0.12, model.spec.length * 0.6),
          whaleBlue,
        );
        hullBand.position.set(
          side * model.spec.beam * 0.47,
          -model.spec.draft * 0.12,
          model.spec.length * 0.04,
        );
        parent.add(hullBand);
      }
    }
  }

  private addRedForceSignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.22;
    const deckY = model.spec.draft * 0.2 + 1.5;
    const headY = deckY + size * 1.55;
    const headZ = bowZ - size * 0.72;
    const neckCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, deckY - size * 0.12, bowZ + size * 1.45),
      new THREE.Vector3(0, deckY + size * 0.25, bowZ + size * 0.48),
      new THREE.Vector3(0, deckY + size * 0.82, bowZ - size * 0.05),
      new THREE.Vector3(0, headY - size * 0.18, bowZ - size * 0.42),
    ]);
    const neck = this.mesh(
      model,
      new THREE.TubeGeometry(
        neckCurve,
        detail === "low" ? 7 : 16,
        size * 0.24,
        detail === "low" ? 5 : 8,
        false,
      ),
      materials.trim,
    );
    neck.name = "red-force-integrated-dragon-neck";
    parent.add(neck);
    const throat = this.mesh(
      model,
      new THREE.TubeGeometry(
        neckCurve,
        detail === "low" ? 7 : 16,
        size * 0.13,
        detail === "low" ? 5 : 7,
        false,
      ),
      materials.accent,
    );
    throat.name = "red-force-dragon-throat";
    throat.position.z -= size * 0.08;
    throat.position.y -= size * 0.08;
    parent.add(throat);
    const dragon = this.ellipsoid(
      model,
      size * 0.68,
      size * 0.54,
      size * 0.92,
      materials.trim,
    );
    dragon.name = "red-force-dragon-head";
    dragon.position.set(0, headY, headZ);
    dragon.rotation.x = -0.12;
    parent.add(dragon);
    const snout = this.ellipsoid(
      model,
      size * 0.48,
      size * 0.27,
      size * 0.62,
      materials.trim,
    );
    snout.name = "red-force-dragon-snout";
    snout.position.set(0, headY - size * 0.15, headZ - size * 0.92);
    parent.add(snout);
    for (const side of [-1, 1]) {
      const horn = this.mesh(
        model,
        new THREE.ConeGeometry(
          size * 0.14,
          size * 0.82,
          detail === "low" ? 4 : 7,
        ),
        materials.white,
      );
      horn.position.set(
        side * size * 0.4,
        headY + size * 0.52,
        headZ + size * 0.05,
      );
      horn.rotation.z = side * -0.52;
      horn.rotation.x = -0.22;
      parent.add(horn);
      const cheek = this.mesh(
        model,
        new THREE.ConeGeometry(size * 0.22, size * 0.72, 5),
        materials.accent,
      );
      cheek.position.set(
        side * size * 0.58,
        headY - size * 0.02,
        headZ + size * 0.18,
      );
      cheek.rotation.z = side * -1.12;
      parent.add(cheek);
    }
    if (detail !== "low") {
      for (const side of [-1, 1]) {
        const eye = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.1, 7, 5),
          materials.white,
        );
        eye.position.set(
          side * size * 0.31,
          headY + size * 0.15,
          headZ - size * 0.79,
        );
        parent.add(eye);
        const pupil = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.045, 5, 4),
          materials.ink,
        );
        pupil.position.set(
          side * size * 0.31,
          eye.position.y,
          eye.position.z - size * 0.1,
        );
        parent.add(pupil);
        const nostril = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.045, 5, 4),
          materials.ink,
        );
        nostril.position.set(
          side * size * 0.2,
          snout.position.y + size * 0.04,
          snout.position.z - size * 0.58,
        );
        parent.add(nostril);
        for (let index = 0; index < 6; index += 1) {
          const shield = this.mesh(
            model,
            new THREE.CylinderGeometry(size * 0.3, size * 0.3, 0.24, 10),
            index % 2 ? materials.trim : materials.accent,
          );
          shield.rotation.z = Math.PI / 2;
          shield.position.set(
            side * model.spec.beam * 0.48,
            model.spec.draft * 0.1 + size * 0.18,
            (index / 5 - 0.5) * model.spec.length * 0.5,
          );
          parent.add(shield);
        }
      }
      const jaw = this.ellipsoid(
        model,
        size * 0.44,
        size * 0.12,
        size * 0.58,
        materials.hullDark,
      );
      jaw.name = "red-force-dragon-jaw";
      jaw.position.set(
        0,
        snout.position.y - size * 0.26,
        snout.position.z - size * 0.04,
      );
      parent.add(jaw);
      for (const side of [-1, 1]) {
        const trunk = this.mesh(
          model,
          new THREE.CylinderGeometry(size * 0.045, size * 0.07, size * 1.25, 6),
          materials.hullDark,
        );
        trunk.position.set(
          side * model.spec.beam * 0.23,
          model.spec.draft * 0.42 + size * 0.62,
          model.spec.length * 0.12,
        );
        trunk.rotation.z = side * 0.08;
        parent.add(trunk);
        for (let leafIndex = 0; leafIndex < 5; leafIndex += 1) {
          const leaf = this.mesh(
            model,
            new THREE.ConeGeometry(size * 0.12, size * 0.72, 5),
            this.crewMaterial(0x3b7d4a),
          );
          const angle = (leafIndex / 5) * TAU;
          leaf.position.set(
            trunk.position.x + Math.cos(angle) * size * 0.28,
            trunk.position.y + size * 0.66,
            trunk.position.z + Math.sin(angle) * size * 0.28,
          );
          leaf.rotation.z = angle;
          parent.add(leaf);
        }
      }
    }
  }

  private addOroSignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.2;
    const crest = this.mesh(
      model,
      new THREE.TorusGeometry(
        size * 0.85,
        size * 0.18,
        6,
        detail === "low" ? 10 : 20,
      ),
      materials.trim,
    );
    crest.position.set(
      0,
      model.spec.draft * 0.5 + size * 1.15,
      bowZ - size * 0.25,
    );
    parent.add(crest);
    const egg = this.ellipsoid(
      model,
      size * 1.15,
      size * 1.6,
      size,
      materials.white,
    );
    egg.position.set(
      0,
      model.spec.draft * 0.35 + size * 1.7,
      model.spec.length * 0.2,
    );
    parent.add(egg);
    if (detail !== "low") {
      const royalCannon = this.mesh(
        model,
        new THREE.CylinderGeometry(size * 0.22, size * 0.34, size * 1.4, 9),
        materials.metal,
      );
      royalCannon.name = "oro-jackson-forward-cannon";
      royalCannon.rotation.x = Math.PI / 2;
      royalCannon.position.set(0, crest.position.y, bowZ - size * 0.72);
      parent.add(royalCannon);
      for (const side of [-1, 1]) {
        const mermaid = new THREE.Group();
        mermaid.name = "oro-jackson-mermaid";
        mermaid.position.set(
          side * size * 0.76,
          crest.position.y - size * 0.08,
          bowZ - size * 0.35,
        );
        const tail = this.mesh(
          model,
          new THREE.ConeGeometry(size * 0.17, size * 0.95, 7),
          materials.trim,
        );
        tail.position.y = -size * 0.38;
        tail.rotation.z = side * 0.22;
        const torso = this.ellipsoid(
          model,
          size * 0.18,
          size * 0.28,
          size * 0.14,
          materials.accent,
        );
        torso.position.y = size * 0.18;
        const head = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.17, 7, 5),
          materials.skin,
        );
        head.position.y = size * 0.58;
        const hair = this.mesh(
          model,
          new THREE.SphereGeometry(
            size * 0.19,
            7,
            5,
            0,
            TAU,
            0,
            Math.PI * 0.55,
          ),
          materials.hullDark,
        );
        hair.position.y = size * 0.63;
        mermaid.add(tail, torso, head, hair);
        parent.add(mermaid);
      }
      const spotPositions = [
        [-0.72, -0.42, -0.55],
        [0.68, -0.18, -0.62],
        [-0.62, 0.32, -0.58],
        [0.7, 0.55, -0.35],
        [-0.48, 0.78, 0.15],
        [0.5, -0.67, 0.25],
      ] as const;
      for (const [x, y, z] of spotPositions) {
        const spot = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.18, 7, 5),
          materials.accent,
        );
        spot.position.set(
          egg.position.x + x * size,
          egg.position.y + y * size,
          egg.position.z + z * size,
        );
        parent.add(spot);
      }
    }
  }

  private addQueenSignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.21;
    const face = this.ellipsoid(
      model,
      size,
      size * 1.15,
      size * 0.65,
      materials.accent,
    );
    face.position.set(
      0,
      model.spec.draft * 0.35 + size * 1.1,
      bowZ - size * 0.28,
    );
    parent.add(face);
    const crown = this.mesh(
      model,
      new THREE.ConeGeometry(size * 0.95, size * 1.05, 5),
      materials.trim,
    );
    crown.position.set(0, face.position.y + size * 1.15, bowZ);
    parent.add(crown);
    const tiers = detail === "low" ? 2 : 4;
    for (let index = 0; index < tiers; index += 1) {
      const tier = this.mesh(
        model,
        new THREE.CylinderGeometry(
          size * (1.2 - index * 0.17),
          size * (1.28 - index * 0.17),
          size * 0.42,
          10,
        ),
        index % 2 ? materials.sail : materials.accent,
      );
      tier.position.set(
        0,
        model.spec.draft * 0.4 + size * (0.45 + index * 0.4),
        model.spec.length * 0.2,
      );
      parent.add(tier);
      if (detail !== "low") {
        const frosting = this.mesh(
          model,
          new THREE.TorusGeometry(
            size * (1.19 - index * 0.17),
            size * 0.08,
            5,
            18,
          ),
          index % 2 ? materials.accent : materials.white,
        );
        frosting.position.set(
          tier.position.x,
          tier.position.y + size * 0.2,
          tier.position.z,
        );
        frosting.rotation.x = Math.PI / 2;
        parent.add(frosting);
      }
    }
    if (detail !== "low") {
      for (const side of [-1, 1]) {
        const eye = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.18, 8, 6),
          materials.white,
        );
        eye.position.set(
          side * size * 0.34,
          face.position.y + size * 0.21,
          bowZ - size * 0.84,
        );
        parent.add(eye);
        const pupil = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.075, 6, 4),
          materials.ink,
        );
        pupil.position.set(
          side * size * 0.34,
          eye.position.y,
          bowZ - size * 0.98,
        );
        parent.add(pupil);
        for (let index = 0; index < 4; index += 1) {
          const candyPost = this.mesh(
            model,
            new THREE.CylinderGeometry(
              size * 0.055,
              size * 0.055,
              size * 1.5,
              7,
            ),
            index % 2 ? materials.white : materials.trim,
          );
          candyPost.position.set(
            side * model.spec.beam * 0.42,
            model.spec.draft * 0.4 + size * 0.72,
            (index / 3 - 0.5) * model.spec.length * 0.45,
          );
          candyPost.rotation.z = side * 0.08;
          parent.add(candyPost);
        }
      }
      const nose = this.mesh(
        model,
        new THREE.SphereGeometry(size * 0.18, 8, 6),
        materials.trim,
      );
      nose.position.set(0, face.position.y, bowZ - size * 0.95);
      parent.add(nose);
      const grin = this.mesh(
        model,
        new THREE.BoxGeometry(size * 0.92, size * 0.28, size * 0.12),
        materials.white,
      );
      grin.position.set(0, face.position.y - size * 0.42, bowZ - size * 0.89);
      parent.add(grin);
      for (let index = 0; index < 5; index += 1) {
        const candle = this.mesh(
          model,
          new THREE.CylinderGeometry(
            size * 0.055,
            size * 0.055,
            size * 0.62,
            7,
          ),
          index % 2 ? materials.accent : materials.trim,
        );
        candle.position.set(
          (index / 4 - 0.5) * size * 1.2,
          model.spec.draft * 0.4 + size * 2.1,
          model.spec.length * 0.2,
        );
        parent.add(candle);
        const flame = this.mesh(
          model,
          new THREE.ConeGeometry(size * 0.07, size * 0.28, 6),
          this.crewMaterial(0xff8f32),
        );
        flame.position.set(
          candle.position.x,
          candle.position.y + size * 0.44,
          candle.position.z,
        );
        parent.add(flame);
      }
    }
  }

  private addBaratieSignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.2;
    const restaurantHull = this.ellipsoid(
      model,
      model.spec.beam * 0.5,
      model.spec.draft * 0.78,
      model.spec.length * 0.47,
      materials.hull,
    );
    restaurantHull.name = "baratie-oval-restaurant-hull";
    restaurantHull.position.set(0, -model.spec.draft * 0.45, 0);
    parent.add(restaurantHull);
    const fish = this.ellipsoid(
      model,
      size * 0.85,
      size * 0.65,
      size * 1.25,
      materials.accent,
    );
    fish.position.set(
      0,
      model.spec.draft * 0.35 + size * 0.7,
      bowZ - size * 0.45,
    );
    parent.add(fish);
    for (const side of [-1, 1]) {
      const fin = this.mesh(
        model,
        new THREE.ConeGeometry(
          size * 0.45,
          size * 1.6,
          detail === "low" ? 4 : 6,
        ),
        materials.trim,
      );
      fin.position.set(
        side * model.spec.beam * 0.5,
        model.spec.draft * 0.12 + size * 0.2,
        -model.spec.length * 0.05,
      );
      fin.rotation.z = (side * Math.PI) / 2;
      parent.add(fin);
    }
    const roof = this.mesh(
      model,
      new THREE.ConeGeometry(model.spec.beam * 0.38, size * 0.9, 8),
      materials.accent,
    );
    roof.position.set(0, model.spec.draft * 1.9, model.spec.length * 0.22);
    parent.add(roof);
    if (detail !== "low") {
      for (const side of [-1, 1]) {
        const eye = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.13, 7, 5),
          materials.white,
        );
        eye.position.set(
          side * size * 0.3,
          fish.position.y + size * 0.15,
          bowZ - size * 1.62,
        );
        parent.add(eye);
        const pupil = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.055, 5, 4),
          materials.ink,
        );
        pupil.position.set(
          side * size * 0.3,
          eye.position.y,
          bowZ - size * 1.72,
        );
        parent.add(pupil);
      }
      const mouth = this.mesh(
        model,
        new THREE.BoxGeometry(size * 0.95, size * 0.22, size * 0.18),
        materials.ink,
      );
      mouth.position.set(0, fish.position.y - size * 0.18, bowZ - size * 1.7);
      parent.add(mouth);
      for (let floor = 0; floor < 4; floor += 1) {
        const radius = model.spec.beam * (0.32 - floor * 0.018);
        const level = this.mesh(
          model,
          new THREE.CylinderGeometry(radius, radius * 1.04, size * 0.38, 12),
          floor % 2 ? materials.white : materials.cabin,
        );
        level.position.set(
          0,
          model.spec.draft * 0.65 + floor * size * 0.4,
          model.spec.length * 0.2,
        );
        parent.add(level);
        for (const side of [-1, 1]) {
          for (let window = 0; window < 3; window += 1) {
            const glass = this.mesh(
              model,
              new THREE.BoxGeometry(0.22, size * 0.15, size * 0.28),
              materials.glass,
            );
            glass.position.set(
              side * radius,
              level.position.y,
              model.spec.length * 0.2 + (window - 1) * size * 0.48,
            );
            parent.add(glass);
          }
        }
      }
      const serviceDeck = this.mesh(
        model,
        new THREE.BoxGeometry(
          model.spec.beam * 1.35,
          0.42,
          model.spec.length * 0.42,
        ),
        materials.trim,
      );
      serviceDeck.name = "baratie-foldout-battle-deck";
      serviceDeck.position.set(
        0,
        model.spec.draft * 0.24 + 1.2,
        -model.spec.length * 0.02,
      );
      parent.add(serviceDeck);
    }
  }

  private addNavySignature(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    bowZ: number,
    detail: ShipDetail,
  ): void {
    const size = model.spec.beam * 0.19;
    const shield = this.mesh(
      model,
      new THREE.CylinderGeometry(
        size,
        size,
        size * 0.38,
        detail === "low" ? 6 : 10,
      ),
      materials.accent,
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.set(0, model.spec.draft * 0.45 + size, bowZ - size * 0.25);
    parent.add(shield);
    const beak = this.mesh(
      model,
      new THREE.ConeGeometry(size * 0.4, size * 1.1, 5),
      materials.trim,
    );
    beak.rotation.x = -Math.PI / 2;
    beak.position.set(0, shield.position.y, bowZ - size * 0.95);
    parent.add(beak);
    for (const side of [-1, 1]) {
      const wing = this.mesh(
        model,
        new THREE.BoxGeometry(size * 1.25, size * 0.22, size * 0.38),
        materials.white,
      );
      wing.position.set(side * size, shield.position.y + size * 0.35, bowZ);
      wing.rotation.z = side * 0.32;
      parent.add(wing);
    }
    if (detail !== "low") {
      const muzzle = this.ellipsoid(
        model,
        size * 0.58,
        size * 0.42,
        size * 0.38,
        materials.white,
      );
      muzzle.position.set(0, shield.position.y - size * 0.1, bowZ - size * 0.7);
      parent.add(muzzle);
      const nose = this.mesh(
        model,
        new THREE.SphereGeometry(size * 0.18, 8, 6),
        materials.ink,
      );
      nose.position.set(0, muzzle.position.y + size * 0.03, bowZ - size * 1.08);
      parent.add(nose);
      const mouthBone = this.mesh(
        model,
        new THREE.CylinderGeometry(size * 0.08, size * 0.08, size * 1.32, 7),
        materials.white,
      );
      mouthBone.position.set(
        0,
        muzzle.position.y - size * 0.22,
        bowZ - size * 1.03,
      );
      mouthBone.rotation.z = Math.PI / 2;
      parent.add(mouthBone);
      for (const side of [-1, 1]) {
        const boneEnd = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.16, 7, 5),
          materials.white,
        );
        boneEnd.position.set(
          side * size * 0.7,
          mouthBone.position.y,
          mouthBone.position.z,
        );
        parent.add(boneEnd);
      }
      for (const side of [-1, 1]) {
        const eye = this.mesh(
          model,
          new THREE.SphereGeometry(size * 0.1, 7, 5),
          materials.ink,
        );
        eye.position.set(
          side * size * 0.27,
          shield.position.y + size * 0.3,
          bowZ - size * 0.54,
        );
        parent.add(eye);
        const ear = this.mesh(
          model,
          new THREE.ConeGeometry(size * 0.22, size * 0.7, 6),
          materials.white,
        );
        ear.position.set(
          side * size * 0.68,
          shield.position.y + size * 0.45,
          bowZ - size * 0.15,
        );
        ear.rotation.z = side * -0.52;
        parent.add(ear);
        const armorBand = this.mesh(
          model,
          new THREE.BoxGeometry(0.38, size * 0.25, model.spec.length * 0.58),
          materials.accent,
        );
        armorBand.position.set(
          side * model.spec.beam * 0.47,
          model.spec.draft * 0.02,
          model.spec.length * 0.02,
        );
        parent.add(armorBand);
      }
      const marineCap = this.mesh(
        model,
        new THREE.CylinderGeometry(size * 0.52, size * 0.6, size * 0.28, 10),
        materials.white,
      );
      marineCap.position.set(
        0,
        shield.position.y + size * 0.73,
        bowZ - size * 0.15,
      );
      parent.add(marineCap);
      const capBand = this.mesh(
        model,
        new THREE.BoxGeometry(size * 0.9, size * 0.13, size * 0.28),
        materials.accent,
      );
      capBand.position.set(0, marineCap.position.y, bowZ - size * 0.62);
      parent.add(capBand);
      const launchRamp = this.mesh(
        model,
        new THREE.BoxGeometry(
          model.spec.beam * 0.42,
          0.45,
          model.spec.length * 0.2,
        ),
        materials.accent,
      );
      launchRamp.name = "garp-cannonball-launch-ramp";
      launchRamp.position.set(
        0,
        model.spec.draft * 0.42 + 2.2,
        -model.spec.length * 0.22,
      );
      launchRamp.rotation.x = -0.12;
      parent.add(launchRamp);
    }
  }

  private buildPolarTang(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: ShipDetail,
  ): void {
    const spec = model.spec;
    const body = this.mesh(
      model,
      new THREE.CapsuleGeometry(
        spec.beam * 0.48,
        spec.length * 0.72,
        detail === "high" ? 8 : 4,
        detail === "low" ? 10 : 18,
      ),
      materials.hull,
    );
    body.rotation.x = Math.PI / 2;
    body.scale.z = 0.82;
    parent.add(body);
    const belly = this.mesh(
      model,
      new THREE.CapsuleGeometry(
        spec.beam * 0.35,
        spec.length * 0.64,
        4,
        detail === "low" ? 8 : 14,
      ),
      materials.hullDark,
    );
    belly.rotation.x = Math.PI / 2;
    belly.position.y = -spec.beam * 0.22;
    parent.add(belly);
    const tower = this.mesh(
      model,
      new THREE.CylinderGeometry(
        spec.beam * 0.16,
        spec.beam * 0.23,
        spec.beam * 0.65,
        detail === "low" ? 7 : 12,
      ),
      materials.hull,
    );
    tower.position.set(0, spec.beam * 0.5, spec.length * 0.05);
    parent.add(tower);
    const cap = this.mesh(
      model,
      new THREE.SphereGeometry(spec.beam * 0.2, detail === "low" ? 7 : 12, 6),
      materials.accent,
    );
    cap.position.set(0, spec.beam * 0.84, spec.length * 0.05);
    parent.add(cap);
    if (detail !== "low") {
      const periscopeStem = this.mesh(
        model,
        new THREE.CylinderGeometry(0.24, 0.29, spec.beam * 0.72, 7),
        materials.metal,
      );
      periscopeStem.position.set(0, spec.beam * 1.2, spec.length * 0.05);
      parent.add(periscopeStem);
      const periscopeHead = this.mesh(
        model,
        new THREE.BoxGeometry(0.58, 0.42, 1.25),
        materials.metal,
      );
      periscopeHead.position.set(0, spec.beam * 1.54, spec.length * 0.01);
      parent.add(periscopeHead);
      const portholeCount = detail === "high" ? 5 : 3;
      for (const side of [-1, 1]) {
        const deckMast = this.mesh(
          model,
          new THREE.CylinderGeometry(0.16, 0.21, spec.beam * 0.82, 7),
          materials.hullDark,
        );
        deckMast.position.set(
          side * spec.beam * 0.28,
          spec.beam * 0.9,
          -spec.length * 0.02,
        );
        parent.add(deckMast);
        for (let index = 0; index < portholeCount; index += 1) {
          const porthole = this.mesh(
            model,
            new THREE.CylinderGeometry(0.52, 0.52, 0.16, 10),
            materials.glass,
          );
          porthole.rotation.z = Math.PI / 2;
          porthole.position.set(
            side * spec.beam * 0.49,
            spec.beam * 0.08,
            (index / Math.max(1, portholeCount - 1) - 0.5) * spec.length * 0.48,
          );
          parent.add(porthole);
        }
        const heartMark = this.makeSailEmblem(
          model,
          spec.beam * 0.72,
          spec.beam * 0.72,
        );
        heartMark.name = "polar-tang-heart-mark";
        heartMark.position.set(
          side * spec.beam * 0.502,
          spec.beam * 0.03,
          -spec.length * 0.14,
        );
        heartMark.rotation.y = (side * Math.PI) / 2;
        parent.add(heartMark);
        const searchLamp = this.mesh(
          model,
          new THREE.CylinderGeometry(0.48, 0.48, 0.44, 10),
          materials.glass,
        );
        searchLamp.position.set(
          side * spec.beam * 0.32,
          spec.beam * 0.74,
          -spec.length * 0.12,
        );
        searchLamp.rotation.x = Math.PI / 2;
        parent.add(searchLamp);
      }
    }
    for (const side of [-1, 1]) {
      const fin = this.mesh(
        model,
        new THREE.BoxGeometry(spec.beam * 0.9, 0.45, spec.length * 0.16),
        materials.hullDark,
      );
      fin.position.set(side * spec.beam * 0.55, 0, spec.length * 0.08);
      fin.rotation.y = side * 0.16;
      parent.add(fin);
    }
    const tail = this.mesh(
      model,
      new THREE.BoxGeometry(
        spec.beam * 0.12,
        spec.beam * 1.2,
        spec.length * 0.08,
      ),
      materials.accent,
    );
    tail.position.set(0, 0, spec.length * 0.45);
    parent.add(tail);
    if (detail === "high") {
      this.addCrew(model, parent, materials, detail);
      this.addDamageMarks(model, parent, materials);
    } else if (detail === "medium") {
      this.addCrew(model, parent, materials, detail, 3);
    }
  }

  private addCrew(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    detail: Exclude<ShipDetail, "low">,
    maximum?: number,
  ): void {
    const spec = model.spec;
    const roster = getShipCrew(model.kind).slice(
      0,
      maximum ?? Number.POSITIVE_INFINITY,
    );
    for (let index = 0; index < roster.length; index += 1) {
      const member = roster[index];
      const rig = new THREE.Group();
      const phase = index * 1.73;
      rig.name = `crew:${member.name}`;
      rig.userData.crewName = member.name;
      rig.userData.crewRole = member.role;
      rig.userData.isCaptain = member.captain === true;
      rig.position.set(
        member.station[0] * spec.beam,
        model.kind === "polar-tang"
          ? polarDeckHeightAt(spec, member.station[0] * spec.beam, member.station[1] * spec.length) + .025
          : deckHeightAt(model.kind, spec, member.station[1] * spec.length) +
              0.03,
        member.station[1] * spec.length,
      );
      rig.rotation.y = member.station[2] ?? 0;
      const buildScale = this.crewBuildScale(member.build);
      const authoredScale = member.scale ?? 1;
      const detailScale = detail === "high" ? 1 : 0.92;
      rig.scale.set(
        buildScale.x * authoredScale * detailScale,
        buildScale.y * authoredScale * detailScale,
        buildScale.z * authoredScale * detailScale,
      );

      if (member.captain && detail === "high") {
        const commandRing = this.mesh(
          model,
          new THREE.RingGeometry(0.62, 0.83, 14),
          materials.trim,
        );
        commandRing.name = "captain-command-ring";
        commandRing.rotation.x = -Math.PI / 2;
        commandRing.position.y = 0.035;
        rig.add(commandRing);
      }

      const primary = this.crewMaterial(member.primary);
      const secondary = this.crewMaterial(member.secondary);
      const skin = this.crewMaterial(member.skin);
      const hair = this.crewMaterial(member.hair);
      const isSkeleton = member.build === "skeleton";
      const isMink = member.build === "mink";
      const leftLeg = this.makeCrewLimb(model, member, detail, "leg", -1);
      const rightLeg = this.makeCrewLimb(model, member, detail, "leg", 1);
      leftLeg.position.set(-0.22, 0.88, 0);
      rightLeg.position.set(0.22, 0.88, 0);
      rig.add(leftLeg, rightLeg);

      const torsoWidth =
        member.build === "round"
          ? 0.67
          : member.build === "giant" || member.build === "broad"
            ? 0.55
            : isSkeleton
              ? 0.3
              : 0.44;
      const body = this.mesh(
        model,
        this.crewLoft(
          [
            [0.82, torsoWidth * 0.83, 0.27, 0],
            [1.08, torsoWidth * 0.79, 0.25, 0],
            [1.5, torsoWidth, 0.29, 0],
            [1.82, torsoWidth * 1.14, 0.24, 0],
            [1.96, torsoWidth * 0.5, 0.18, 0],
          ],
          detail === "high" ? 10 : 6,
        ),
        primary,
      );
      body.name = `${member.name}:shaped-jacket`;
      rig.add(body);
      const neck = this.mesh(
        model,
        new THREE.CylinderGeometry(0.16, 0.2, 0.24, 8),
        isSkeleton ? materials.white : skin,
      );
      neck.position.y = 2.02;
      rig.add(neck);
      if (detail === "high" && !isMink && !isSkeleton) {
        const openVest =
          member.name === "Monkey D. Luffy" || member.name === "Franky";
        const shirt = this.mesh(
          model,
          new THREE.BoxGeometry(torsoWidth * 0.65, 0.66, 0.035),
          openVest ? skin : secondary,
        );
        shirt.position.set(0, 1.54, -0.283);
        rig.add(shirt);
        for (const side of [-1, 1]) {
          const lapel = this.mesh(
            model,
            new THREE.BoxGeometry(0.12, 0.52, 0.045),
            primary,
          );
          lapel.position.set(side * torsoWidth * 0.31, 1.63, -0.309);
          lapel.rotation.z = side * 0.17;
          rig.add(lapel);
        }
        if (!openVest)
          for (let button = 0; button < 3; button++) {
            const stud = this.mesh(
              model,
              new THREE.SphereGeometry(0.035, 5, 4),
              materials.trim,
            );
            stud.position.set(0.065, 1.2 + button * 0.16, -0.322);
            rig.add(stud);
          }
      }
      const sash = this.mesh(
        model,
        new THREE.CylinderGeometry(
          torsoWidth * 1.06,
          torsoWidth * 1.06,
          0.18,
          detail === "high" ? 8 : 5,
        ),
        secondary,
      );
      sash.position.y = 0.91;
      rig.add(sash);

      const headRadius =
        member.build === "round" || isMink ? 0.56 : isSkeleton ? 0.44 : 0.5;
      const head = this.mesh(
        model,
        new THREE.SphereGeometry(
          headRadius,
          detail === "high" ? 12 : 6,
          detail === "high" ? 9 : 5,
        ),
        isSkeleton ? materials.white : skin,
      );
      head.position.y = 2.34;
      head.scale.set(0.89, 0.94, 0.91);
      rig.add(head);

      this.addCrewHair(model, rig, member, hair, materials);
      this.addCrewHat(
        model,
        rig,
        member.hat,
        member,
        primary,
        secondary,
        materials,
      );
      if (detail === "high") {
        this.addCrewFaceDetails(model, rig, member, skin, hair, materials);
      }

      const leftArm = this.makeCrewLimb(model, member, detail, "arm", -1);
      const rightArm = this.makeCrewLimb(model, member, detail, "arm", 1);
      leftArm.position.set(-torsoWidth * 1.13, 1.84, 0);
      rightArm.position.set(torsoWidth * 1.13, 1.84, 0);
      leftArm.rotation.z = -0.12;
      rightArm.rotation.z = 0.12;
      if (member.name === "Shanks") leftArm.visible = false;
      rig.add(leftArm, rightArm);
      const tool = new THREE.Group();
      tool.name = "repair-hammer";
      const handle = this.mesh(
        model,
        new THREE.CylinderGeometry(0.045, 0.045, 0.58, 5),
        materials.hullDark,
      );
      handle.position.set(0, -0.9, -0.17);
      const hammerHead = this.mesh(
        model,
        new THREE.BoxGeometry(0.34, 0.16, 0.18),
        materials.metal,
      );
      hammerHead.position.set(0, -0.9, -0.43);
      tool.add(handle, hammerHead);
      tool.visible = false;
      rightArm.add(tool);

      if (
        (member.captain && member.name !== "Monkey D. Luffy") ||
        member.name === "Shanks" ||
        member.name === "Gol D. Roger" ||
        member.name === "Edward Newgate"
      ) {
        if (detail === "high") {
          const cape = this.mesh(
            model,
            new THREE.CylinderGeometry(
              0.58,
              0.83,
              1.45,
              8,
              1,
              true,
              Math.PI * 0.18,
              Math.PI * 1.62,
            ),
            secondary,
          );
          cape.name = `${member.name}:cape`;
          cape.position.set(0, 1.35, 0.22);
          cape.rotation.y = Math.PI;
          rig.add(cape);
        }
      }
      this.addCrewAccessory(
        model,
        rig,
        member.accessory,
        member,
        secondary,
        materials,
      );
      this.batchStatic(
        model,
        rig,
        new Set([leftArm, rightArm, leftLeg, rightLeg]),
      );

      parent.add(rig);
      if (detail === "high") {
        model.registerCrew({
          root: rig,
          leftArm,
          rightArm,
          phase,
          baseY: rig.position.y,
          baseX: rig.position.x,
          baseZ: rig.position.z,
          baseHeading: rig.rotation.y,
          leftLeg,
          rightLeg,
          tool,
          captain: member.captain === true,
          combatant:
            member.accessory !== "none" ||
            /Commander|Combatant|Swordsman|Sniper|Vice Admiral/.test(
              member.role,
            ),
        });
      }
    }
  }

  private sunnyDome(
    model: ProceduralShipModel,
    materials: ShipMaterialSet,
    radius: number,
    detail: ShipDetail,
  ): THREE.Group {
    const roof = new THREE.Group();
    roof.name = "sunny-striped-observatory-dome";
    for (let panel = 0; panel < 10; panel += 1) {
      const dome = this.mesh(
        model,
        new THREE.SphereGeometry(
          radius,
          detail === "high" ? 5 : 3,
          7,
          (panel / 10) * TAU,
          TAU / 10,
          0,
          Math.PI / 2,
        ),
        panel % 2 ? materials.trim : materials.accent,
      );
      dome.scale.y = 0.58;
      roof.add(dome);
    }
    const lip = this.mesh(
      model,
      new THREE.TorusGeometry(radius, 0.16, 6, detail === "high" ? 32 : 16),
      materials.white,
    );
    lip.rotation.x = Math.PI / 2;
    roof.add(lip);
    return roof;
  }

  private sunnyCabinWindows(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
    center: THREE.Vector3,
    width: number,
    height: number,
  ): void {
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * TAU;
      const frame = new THREE.Group();
      frame.position.set(
        Math.cos(angle) * width * 0.514,
        center.y + height * 0.1,
        center.z + Math.sin(angle) * width * 0.514,
      );
      frame.rotation.y = Math.PI / 2 - angle;
      const surround = this.mesh(
        model,
        new THREE.BoxGeometry(width * 0.19, height * 0.65, 0.22),
        materials.white,
      );
      const pane = this.mesh(
        model,
        new THREE.BoxGeometry(width * 0.145, height * 0.49, 0.25),
        materials.glass,
      );
      pane.position.z = 0.06;
      const mullion = this.mesh(
        model,
        new THREE.BoxGeometry(0.1, height * 0.49, 0.28),
        materials.trim,
      );
      mullion.position.z = 0.09;
      frame.add(surround, pane, mullion);
      parent.add(frame);
    }
  }

  private addCrewHair(
    model: ProceduralShipModel,
    rig: THREE.Group,
    member: CrewMemberSpec,
    hair: THREE.Material,
    materials: ShipMaterialSet,
  ): void {
    if (member.build === "skeleton") {
      const afro = this.mesh(model, new THREE.SphereGeometry(0.73, 9, 7), hair);
      afro.position.set(0, 2.58, 0.08);
      rig.add(afro);
      return;
    }
    if (member.build === "mink") {
      for (const side of [-1, 1]) {
        const ear = this.mesh(
          model,
          new THREE.ConeGeometry(0.21, 0.44, 6),
          materials.white,
        );
        ear.position.set(side * 0.38, 2.67, 0);
        ear.rotation.z = side * -0.42;
        rig.add(ear);
      }
      return;
    }
    const hairCap = this.mesh(
      model,
      new THREE.SphereGeometry(0.53, 12, 8, 0, TAU, 0, Math.PI * 0.55),
      hair,
    );
    hairCap.position.set(0, 2.34, 0.03);
    rig.add(hairCap);
    const spikeCount =
      member.name === "Marco" ||
      member.name === "Roronoa Zoro" ||
      member.name === "Franky"
        ? 5
        : 3;
    for (let index = 0; index < spikeCount; index += 1) {
      const spike = this.mesh(
        model,
        new THREE.ConeGeometry(0.13, member.name === "Franky" ? 0.76 : 0.43, 5),
        hair,
      );
      spike.position.set(
        (index / Math.max(1, spikeCount - 1) - 0.5) * 0.58,
        2.72 + (index % 2) * 0.08,
        0.02,
      );
      spike.rotation.z = (index / Math.max(1, spikeCount - 1) - 0.5) * 0.7;
      rig.add(spike);
    }
    if (member.name === "Yasopp") {
      for (let index = 0; index < 6; index += 1) {
        const dread = this.mesh(
          model,
          new THREE.CylinderGeometry(0.055, 0.07, 0.8, 5),
          hair,
        );
        dread.position.set(
          (index / 5 - 0.5) * 0.68,
          2.25 - (index % 2) * 0.12,
          0.34,
        );
        dread.rotation.x = -0.18;
        rig.add(dread);
      }
    }
  }

  private addCrewHat(
    model: ProceduralShipModel,
    rig: THREE.Group,
    hat: CrewHat,
    member: CrewMemberSpec,
    primary: THREE.Material,
    secondary: THREE.Material,
    materials: ShipMaterialSet,
  ): void {
    if (hat === "none") return;
    if (hat === "bandana") {
      const band = this.mesh(
        model,
        new THREE.TorusGeometry(0.5, 0.075, 5, 12),
        secondary,
      );
      band.position.set(0, 2.35, -0.05);
      rig.add(band);
      return;
    }
    if (hat === "chef") {
      const base = this.mesh(
        model,
        new THREE.CylinderGeometry(0.47, 0.43, 0.46, 9),
        materials.white,
      );
      base.position.y = 2.78;
      rig.add(base);
      for (let index = 0; index < 3; index += 1) {
        const puff = this.mesh(
          model,
          new THREE.SphereGeometry(0.3, 7, 5),
          materials.white,
        );
        puff.position.set(
          (index - 1) * 0.28,
          3.05 + (index === 1 ? 0.08 : 0),
          0,
        );
        rig.add(puff);
      }
      return;
    }
    if (hat === "crown") {
      const crown = this.mesh(
        model,
        new THREE.CylinderGeometry(0.36, 0.5, 0.45, 5),
        materials.trim,
      );
      crown.position.y = 2.87;
      rig.add(crown);
      for (let index = 0; index < 5; index += 1) {
        const point = this.mesh(
          model,
          new THREE.ConeGeometry(0.12, 0.38, 4),
          materials.trim,
        );
        const angle = (index / 5) * TAU;
        point.position.set(
          Math.cos(angle) * 0.36,
          3.25,
          Math.sin(angle) * 0.36,
        );
        rig.add(point);
      }
      return;
    }
    const brimRadius =
      hat === "straw"
        ? 0.82
        : hat === "pirate"
          ? 0.72
          : hat === "top"
            ? 0.65
            : 0.6;
    const brim = this.mesh(
      model,
      new THREE.CylinderGeometry(brimRadius, brimRadius, 0.12, 12),
      hat === "straw" ? materials.trim : primary,
    );
    brim.position.y = 2.66;
    rig.add(brim);
    const crownHeight = hat === "top" ? 0.62 : hat === "pirate" ? 0.45 : 0.38;
    const crown = this.mesh(
      model,
      new THREE.CylinderGeometry(0.42, 0.49, crownHeight, 10),
      hat === "straw" ? materials.trim : primary,
    );
    crown.position.y = 2.72 + crownHeight * 0.5;
    if (hat === "pirate") crown.scale.x = 1.4;
    rig.add(crown);
    if (hat === "spotted") {
      for (let index = 0; index < 7; index += 1) {
        const spot = this.mesh(
          model,
          new THREE.SphereGeometry(0.065, 5, 4),
          materials.ink,
        );
        const angle = (index / 7) * TAU;
        spot.position.set(
          Math.cos(angle) * 0.43,
          crown.position.y + Math.sin(index * 2.1) * 0.12,
          Math.sin(angle) * 0.43,
        );
        rig.add(spot);
      }
    }
    if (hat === "marine") {
      const badge = this.mesh(
        model,
        new THREE.BoxGeometry(0.35, 0.17, 0.08),
        materials.accent,
      );
      badge.position.set(0, 2.81, -0.48);
      rig.add(badge);
    }
    if (hat === "goggles") {
      for (const side of [-1, 1]) {
        const lens = this.mesh(
          model,
          new THREE.CylinderGeometry(0.14, 0.14, 0.08, 8),
          materials.glass,
        );
        lens.rotation.x = Math.PI / 2;
        lens.position.set(side * 0.19, 2.45, -0.48);
        rig.add(lens);
      }
    }
    void member;
  }

  private addCrewFaceDetails(
    model: ProceduralShipModel,
    rig: THREE.Group,
    member: CrewMemberSpec,
    skin: THREE.Material,
    hair: THREE.Material,
    materials: ShipMaterialSet,
  ): void {
    for (const side of [-1, 1]) {
      if (member.build !== "skeleton") {
        const sclera = this.ellipsoid(
          model,
          0.11,
          0.065,
          0.028,
          materials.white,
        );
        sclera.position.set(side * 0.17, 2.36, -0.445);
        rig.add(sclera);
        const ear = this.ellipsoid(model, 0.075, 0.125, 0.07, skin);
        ear.position.set(side * 0.435, 2.34, -0.015);
        rig.add(ear);
      }
      const eye = this.ellipsoid(
        model,
        member.build === "skeleton" ? 0.075 : 0.045,
        0.058,
        0.033,
        materials.ink,
      );
      eye.position.set(side * 0.17, 2.36, -0.475);
      rig.add(eye);
      const brow = this.mesh(
        model,
        new THREE.BoxGeometry(0.17, 0.029, 0.035),
        hair,
      );
      brow.position.set(side * 0.17, 2.46, -0.423);
      brow.rotation.z = side * -0.12;
      rig.add(brow);
    }
    if (
      !["Usopp", "Bepo"].includes(member.name) &&
      member.build !== "skeleton"
    ) {
      const nose = this.ellipsoid(model, 0.068, 0.1, 0.1, skin);
      nose.position.set(0, 2.25, -0.447);
      rig.add(nose);
    }
    const mouth = this.mesh(
      model,
      new THREE.BoxGeometry(0.17, 0.025, 0.03),
      materials.ink,
    );
    mouth.position.set(0, 2.105, -0.4);
    rig.add(mouth);
    if (
      member.name === "Silvers Rayleigh" ||
      member.name === "Koby" ||
      member.name === "Crocus" ||
      member.name === "Scopper Gaban"
    ) {
      for (const side of [-1, 1]) {
        const lens = this.mesh(
          model,
          new THREE.TorusGeometry(0.15, 0.035, 5, 10),
          member.name === "Scopper Gaban" ? materials.ink : materials.metal,
        );
        lens.position.set(side * 0.17, 2.32, -0.5);
        rig.add(lens);
      }
      const bridge = this.mesh(
        model,
        new THREE.BoxGeometry(0.12, 0.035, 0.035),
        materials.metal,
      );
      bridge.position.set(0, 2.32, -0.51);
      rig.add(bridge);
    }
    if (member.name === "Usopp") {
      const nose = this.mesh(
        model,
        new THREE.ConeGeometry(0.08, 0.48, 6),
        skin,
      );
      nose.rotation.x = -Math.PI / 2;
      nose.position.set(0, 2.23, -0.67);
      rig.add(nose);
    }
    if (member.name === "Shanks") {
      for (let index = 0; index < 3; index += 1) {
        const scar = this.mesh(
          model,
          new THREE.BoxGeometry(0.035, 0.34, 0.025),
          materials.ink,
        );
        scar.position.set(-0.23 + index * 0.07, 2.34, -0.505);
        scar.rotation.z = 0.2;
        rig.add(scar);
      }
    }
    if (member.name === "Edward Newgate") {
      for (const side of [-1, 1]) {
        const moustache = this.mesh(
          model,
          new THREE.ConeGeometry(0.11, 0.66, 7),
          materials.white,
        );
        moustache.position.set(side * 0.25, 2.1, -0.48);
        moustache.rotation.z = side * 1.18;
        rig.add(moustache);
      }
    }
    if (member.name === "Gol D. Roger") {
      const moustache = this.mesh(
        model,
        new THREE.TorusGeometry(0.3, 0.075, 5, 12, Math.PI),
        hair,
      );
      moustache.position.set(0, 2.08, -0.48);
      moustache.rotation.z = Math.PI;
      rig.add(moustache);
    }
    if (member.name === "Tony Tony Chopper") {
      for (const side of [-1, 1]) {
        const antler = this.mesh(
          model,
          new THREE.CylinderGeometry(0.055, 0.08, 0.72, 5),
          this.crewMaterial(0x8a5935),
        );
        antler.position.set(side * 0.43, 2.8, 0.05);
        antler.rotation.z = side * -0.46;
        rig.add(antler);
      }
    }
    if (member.name === "Bepo") {
      const muzzle = this.ellipsoid(model, 0.32, 0.23, 0.18, materials.white);
      muzzle.position.set(0, 2.15, -0.46);
      rig.add(muzzle);
      const nose = this.mesh(
        model,
        new THREE.SphereGeometry(0.09, 6, 4),
        materials.ink,
      );
      nose.position.set(0, 2.22, -0.65);
      rig.add(nose);
    }
    if (member.name === "Jinbe") {
      for (const side of [-1, 1]) {
        const tusk = this.mesh(
          model,
          new THREE.ConeGeometry(0.07, 0.42, 6),
          materials.white,
        );
        tusk.position.set(side * 0.26, 2.08, -0.56);
        tusk.rotation.x = -Math.PI / 2;
        rig.add(tusk);
      }
    }
    if (member.name === "Charlotte Katakuri") {
      const scarf = this.mesh(
        model,
        new THREE.TorusGeometry(0.56, 0.2, 7, 12),
        this.crewMaterial(0xc66386),
      );
      scarf.rotation.x = Math.PI / 2;
      scarf.position.y = 1.94;
      rig.add(scarf);
    }
    if (member.name === "Charlotte Perospero") {
      const tongue = this.mesh(
        model,
        new THREE.CapsuleGeometry(0.11, 0.74, 3, 6),
        this.crewMaterial(0xe96f9f),
      );
      tongue.position.set(0, 1.88, -0.47);
      tongue.rotation.x = 0.18;
      rig.add(tongue);
    }
    if (member.name === "Sanji") {
      const fringe = this.mesh(
        model,
        new THREE.ConeGeometry(0.18, 0.72, 6),
        hair,
      );
      fringe.position.set(-0.18, 2.37, -0.42);
      fringe.rotation.z = -0.35;
      rig.add(fringe);
    }
    if (member.name === "Lucky Roux") {
      const meat = this.mesh(
        model,
        new THREE.SphereGeometry(0.27, 7, 5),
        this.crewMaterial(0x8d3e2d),
      );
      meat.position.set(0.72, 1.78, -0.2);
      const bone = this.mesh(
        model,
        new THREE.CylinderGeometry(0.06, 0.06, 0.58, 5),
        materials.white,
      );
      bone.position.set(0.72, 1.35, -0.2);
      rig.add(meat, bone);
    }
    if (member.name === "Charlotte Linlin") {
      const sun = this.mesh(
        model,
        new THREE.SphereGeometry(0.28, 8, 6),
        this.crewMaterial(0xffb736),
      );
      sun.position.set(0.88, 2.75, 0.02);
      const cloud = this.mesh(
        model,
        new THREE.SphereGeometry(0.33, 8, 6),
        materials.white,
      );
      cloud.position.set(-0.87, 2.65, 0.08);
      rig.add(sun, cloud);
    }
    if (member.name === "Zeff") {
      const beard = this.mesh(
        model,
        new THREE.ConeGeometry(0.32, 1.12, 7),
        hair,
      );
      beard.position.set(0, 1.72, -0.32);
      rig.add(beard);
      for (const side of [-1, 1]) {
        const whisker = this.mesh(
          model,
          new THREE.CylinderGeometry(0.035, 0.045, 1.05, 5),
          hair,
        );
        whisker.position.set(side * 0.25, 1.72, -0.43);
        whisker.rotation.z = side * 0.15;
        rig.add(whisker);
      }
    }
  }

  private addCrewAccessory(
    model: ProceduralShipModel,
    rig: THREE.Group,
    accessory: CrewAccessory,
    member: CrewMemberSpec,
    handleMaterial: THREE.Material,
    materials: ShipMaterialSet,
  ): void {
    if (accessory === "none") return;
    const makeRod = (
      length: number,
      radius: number,
      material: THREE.Material,
    ): THREE.Mesh => {
      const rod = this.mesh(
        model,
        new THREE.CylinderGeometry(radius, radius, length, 6),
        material,
      );
      rod.rotation.x = Math.PI * 0.08;
      return rod;
    };
    if (
      accessory === "sword" ||
      accessory === "two-swords" ||
      accessory === "three-swords" ||
      accessory === "axes"
    ) {
      const count =
        accessory === "three-swords"
          ? 3
          : accessory === "two-swords" || accessory === "axes"
            ? 2
            : 1;
      for (let index = 0; index < count; index += 1) {
        const weapon = new THREE.Group();
        weapon.position.set(-0.58 + index * 0.18, 1.15, 0.14 + index * 0.05);
        weapon.rotation.z = -0.22 + index * 0.18;
        const grip = makeRod(0.42, 0.055, handleMaterial);
        grip.position.y = -0.12;
        const blade = makeRod(
          accessory === "axes" ? 1.25 : 1.55,
          0.052,
          materials.metal,
        );
        blade.position.y = 0.82;
        weapon.add(grip, blade);
        if (accessory === "axes") {
          const axeHead = this.mesh(
            model,
            new THREE.ConeGeometry(0.22, 0.52, 4),
            materials.metal,
          );
          axeHead.position.set(0.18, 1.33, 0);
          axeHead.rotation.z = Math.PI / 2;
          weapon.add(axeHead);
        }
        rig.add(weapon);
      }
      return;
    }
    if (accessory === "rifle") {
      const stock = this.mesh(
        model,
        new THREE.BoxGeometry(0.18, 0.22, 1.45),
        handleMaterial,
      );
      stock.position.set(0.56, 1.42, -0.12);
      stock.rotation.x = -0.45;
      const barrel = makeRod(1.55, 0.055, materials.metal);
      barrel.position.set(0.56, 1.82, -0.63);
      barrel.rotation.x = 0.55;
      rig.add(stock, barrel);
      return;
    }
    if (accessory === "slingshot") {
      const grip = makeRod(0.72, 0.055, handleMaterial);
      grip.position.set(0.58, 1.45, -0.15);
      rig.add(grip);
      for (const side of [-1, 1]) {
        const fork = makeRod(0.48, 0.04, handleMaterial);
        fork.position.set(0.58 + side * 0.13, 1.88, -0.15);
        fork.rotation.z = side * -0.45;
        rig.add(fork);
      }
      return;
    }
    const longWeapon = makeRod(
      accessory === "naginata" || accessory === "trident" ? 3.5 : 2.5,
      0.065,
      handleMaterial,
    );
    longWeapon.position.set(0.7, 1.45, 0.12);
    longWeapon.rotation.z = -0.13;
    rig.add(longWeapon);
    if (accessory === "naginata") {
      const blade = this.mesh(
        model,
        new THREE.ConeGeometry(0.18, 0.72, 5),
        materials.metal,
      );
      blade.position.set(0.92, 3.18, 0.12);
      blade.rotation.z = -0.13;
      rig.add(blade);
    } else if (accessory === "trident") {
      for (const offset of [-0.18, 0, 0.18]) {
        const tine = this.mesh(
          model,
          new THREE.ConeGeometry(0.07, 0.48, 5),
          materials.metal,
        );
        tine.position.set(0.7 + offset, 3.25, 0.12);
        rig.add(tine);
      }
    } else if (accessory === "wrench") {
      const jaw = this.mesh(
        model,
        new THREE.TorusGeometry(0.22, 0.065, 5, 8, Math.PI * 1.45),
        materials.metal,
      );
      jaw.position.set(0.83, 2.64, 0.12);
      rig.add(jaw);
    }
    void member;
  }

  /** A small authored cross-section mesh gives shoulders, waist, elbows and calves clear volume. */
  private crewLoft(
    rings: readonly (readonly [number, number, number, number])[],
    segments = 8,
  ): THREE.BufferGeometry {
    const positions: number[] = [],
      indices: number[] = [];
    rings.forEach(([y, width, depth, z], ring) => {
      for (let side = 0; side < segments; side++) {
        const angle = (side / segments) * TAU;
        positions.push(Math.cos(angle) * width, y, Math.sin(angle) * depth + z);
        if (ring) {
          const a = (ring - 1) * segments + side,
            b = (ring - 1) * segments + ((side + 1) % segments),
            c = ring * segments + side,
            d = ring * segments + ((side + 1) % segments);
          indices.push(a, c, b, b, c, d);
        }
      }
    });
    for (let i = 1; i < segments - 1; i++) {
      indices.push(0, i, i + 1);
      const top = (rings.length - 1) * segments;
      indices.push(top, top + i + 1, top + i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  /** One draw per animated limb: sleeve, hand and shoe colors are baked into vertices before merging. */
  private makeCrewLimb(
    model: ProceduralShipModel,
    member: CrewMemberSpec,
    detail: Exclude<ShipDetail, "low">,
    type: "arm" | "leg",
    side: number,
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = `${member.name}:${side < 0 ? "left" : "right"}-${type}`;
    let material = this.crewMaterials.get(-1);
    if (!material) {
      material = new THREE.MeshToonMaterial({
        color: 0xffffff,
        vertexColors: true,
        side: THREE.DoubleSide,
      });
      this.crewMaterials.set(-1, material);
    }
    const add = (
      geometry: THREE.BufferGeometry,
      color: number,
      x = 0,
      y = 0,
      z = 0,
    ) => {
      geometry.translate(x, y, z);
      const tint = new THREE.Color(color),
        colors = new Float32Array(geometry.getAttribute("position").count * 3);
      for (let i = 0; i < colors.length; i += 3) {
        colors[i] = tint.r;
        colors[i + 1] = tint.g;
        colors[i + 2] = tint.b;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      group.add(this.mesh(model, geometry, material!));
    };
    const skeleton = member.build === "skeleton",
      skin = skeleton ? 0xeee5cc : member.skin;
    const radial = detail === "high" ? 8 : 6;
    if (type === "arm") {
      const sleeved =
        !skeleton &&
        member.build !== "mink" &&
        !["Monkey D. Luffy", "Nami", "Franky"].includes(member.name);
      const shoulder = member.build === "giant" ? 0.25 : 0.19;
      add(
        this.crewLoft(
          [
            [0.06, shoulder, shoulder, 0],
            [-0.13, shoulder * 1.07, shoulder, 0],
            [-0.44, shoulder * 0.7, shoulder * 0.7, -0.055],
          ],
          radial,
        ),
        sleeved ? member.primary : skin,
      );
      add(
        this.crewLoft(
          [
            [-0.43, shoulder * 0.72, shoulder * 0.68, -0.055],
            [-0.61, shoulder * 0.78, shoulder * 0.7, -0.11],
            [-0.91, shoulder * 0.5, shoulder * 0.5, -0.19],
          ],
          radial,
        ),
        skin,
      );
      add(
        new THREE.SphereGeometry(skeleton ? 0.115 : 0.15, radial, 5).scale(
          0.84,
          1.2,
          0.82,
        ),
        skin,
        0,
        -1.01,
        -0.2,
      );
      if (detail === "high")
        add(
          new THREE.SphereGeometry(0.07, 5, 4).scale(0.7, 1.25, 0.7),
          skin,
          -side * 0.1,
          -0.96,
          -0.25,
        );
      if (sleeved)
        add(
          new THREE.CylinderGeometry(
            shoulder * 0.76,
            shoulder * 0.75,
            0.08,
            radial,
          ),
          member.secondary,
          0,
          -0.43,
          -0.055,
        );
    } else {
      const shorts = ["Monkey D. Luffy", "Nami", "Franky"].includes(
        member.name,
      );
      const peg = member.name === "Zeff" && side < 0;
      add(
        this.crewLoft(
          [
            [0, 0.2, 0.2, 0],
            [-0.27, 0.19, 0.17, 0.02],
            [-0.42, 0.145, 0.145, 0.06],
          ],
          radial,
        ),
        skeleton ? skin : member.secondary,
      );
      add(
        this.crewLoft(
          [
            [-0.42, peg ? 0.075 : 0.145, 0.14, 0.06],
            [-0.6, peg ? 0.075 : 0.155, 0.15, 0.035],
            [-0.79, 0.1, 0.11, -0.015],
          ],
          radial,
        ),
        peg ? 0x74482f : shorts || skeleton ? skin : member.secondary,
      );
      add(
        new THREE.SphereGeometry(1, radial, 5).scale(0.17, 0.11, 0.31),
        skeleton ? skin : shorts ? 0x68402c : 0x262532,
        0,
        -0.78,
        -0.15,
      );
      if (shorts && detail === "high")
        add(
          new THREE.CylinderGeometry(0.191, 0.182, 0.09, radial),
          0xebdfc9,
          0,
          -0.36,
          0.04,
        );
    }
    this.batchStatic(model, group, new Set());
    return group;
  }

  private crewBuildScale(build: CrewBuild): THREE.Vector3 {
    switch (build) {
      case "small":
        return new THREE.Vector3(0.74, 0.68, 0.74);
      case "lean":
        return new THREE.Vector3(0.9, 1.02, 0.9);
      case "tall":
        return new THREE.Vector3(0.94, 1.2, 0.94);
      case "broad":
        return new THREE.Vector3(1.16, 1.05, 1.12);
      case "giant":
        return new THREE.Vector3(1.38, 1.34, 1.3);
      case "round":
        return new THREE.Vector3(1.42, 1.02, 1.36);
      case "skeleton":
        return new THREE.Vector3(0.82, 1.28, 0.82);
      case "mink":
        return new THREE.Vector3(1.12, 1.08, 1.12);
      default:
        return new THREE.Vector3(1, 1, 1);
    }
  }

  private crewMaterial(color: number): THREE.MeshToonMaterial {
    const existing = this.crewMaterials.get(color);
    if (existing) return existing;
    const material = new THREE.MeshToonMaterial({
      color,
      side: THREE.DoubleSide,
    });
    this.crewMaterials.set(color, material);
    return material;
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
    const windowCount =
      detail === "high" ? (model.kind === "baratie" ? 4 : 3) : 2;
    const windowWidth = Math.min(3.2, Math.max(1.2, cabinDepth * 0.19));
    const windowHeight = Math.min(2.5, Math.max(1.15, cabinHeight * 0.3));
    for (const side of [-1, 1]) {
      for (let index = 0; index < windowCount; index += 1) {
        const z =
          cabinPosition.z +
          (index / Math.max(1, windowCount - 1) - 0.5) * cabinDepth * 0.68;
        const frame = this.mesh(
          model,
          new THREE.BoxGeometry(0.18, windowHeight * 1.22, windowWidth * 1.2),
          materials.trim,
        );
        frame.position.set(
          side * (cabinWidth * 0.5 + 0.07),
          cabinPosition.y + cabinHeight * 0.09,
          z,
        );
        parent.add(frame);
        const glass = this.mesh(
          model,
          new THREE.BoxGeometry(0.22, windowHeight, windowWidth),
          materials.glass,
        );
        glass.position.set(
          side * (cabinWidth * 0.5 + 0.13),
          frame.position.y,
          z,
        );
        parent.add(glass);
      }
    }
    const trimBand = this.mesh(
      model,
      new THREE.BoxGeometry(cabinWidth * 1.08, 0.28, cabinDepth * 1.08),
      materials.trim,
    );
    trimBand.position.set(
      cabinPosition.x,
      cabinPosition.y - cabinHeight * 0.3,
      cabinPosition.z,
    );
    parent.add(trimBand);
    const doorWidth = Math.min(2.6, cabinWidth * 0.24);
    const doorHeight = Math.min(3.8, cabinHeight * 0.7);
    const doorFrame = this.mesh(
      model,
      new THREE.BoxGeometry(doorWidth * 1.18, doorHeight * 1.1, 0.18),
      materials.trim,
    );
    doorFrame.position.set(
      0,
      cabinPosition.y - cabinHeight * 0.5 + doorHeight * 0.52,
      cabinPosition.z + cabinDepth * 0.5 + 0.08,
    );
    parent.add(doorFrame);
    const door = this.mesh(
      model,
      new THREE.BoxGeometry(doorWidth, doorHeight, 0.23),
      materials.hull,
    );
    door.position.set(0, doorFrame.position.y, doorFrame.position.z + 0.04);
    parent.add(door);
    const doorGlass = this.mesh(
      model,
      new THREE.BoxGeometry(doorWidth * 0.52, doorHeight * 0.25, 0.26),
      materials.glass,
    );
    doorGlass.position.set(
      0,
      door.position.y + doorHeight * 0.2,
      door.position.z + 0.04,
    );
    parent.add(doorGlass);
    const knob = this.mesh(
      model,
      new THREE.SphereGeometry(0.11, 6, 4),
      materials.metal,
    );
    knob.position.set(
      doorWidth * 0.32,
      door.position.y - doorHeight * 0.05,
      door.position.z + 0.18,
    );
    parent.add(knob);
  }

  private addDamageMarks(
    model: ProceduralShipModel,
    parent: THREE.Group,
    materials: ShipMaterialSet,
  ): void {
    const spec = model.spec;
    for (let index = 0; index < 12; index += 1) {
      const side = index % 2 ? -1 : 1;
      const t = 0.23 + (Math.floor(index / 2) / 5) * 0.54;
      const width = spec.beam * 0.49 * Math.pow(Math.sin(t * Math.PI), 0.43);
      const top =
        spec.draft * 0.17 + 1.44 + Math.pow(t - 0.5, 2) * spec.draft * 1.5;
      const y = spec.draft * 0.12 + (index % 3) * 0.16;
      const j = (y + spec.draft * 0.8) / (top + spec.draft * 0.8);
      const x = width * (0.1 + 0.9 * Math.sin((j * Math.PI) / 2));
      const breach = new THREE.Group();
      breach.name = "splintered-hull-breach";
      breach.userData.section = side < 0 ? "port" : "starboard";
      breach.position.set(side * (x + 0.09), y, (t - 0.5) * spec.length);
      breach.rotation.y = (side * Math.PI) / 2;
      const radius = 0.85 + (index % 3) * 0.22;
      const shape = new THREE.Shape();
      for (let point = 0; point < 14; point += 1) {
        const angle = (point / 14) * TAU;
        const r = radius * (point % 2 ? 0.72 : 1);
        const px = Math.cos(angle) * r;
        const py = Math.sin(angle) * r * 0.75;
        if (point === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
      }
      shape.closePath();
      breach.add(
        this.mesh(model, new THREE.ShapeGeometry(shape), materials.ink),
      );
      for (let splinter = 0; splinter < 4; splinter += 1) {
        const angle = (splinter / 4) * TAU + index * 0.61;
        const wood = this.mesh(
          model,
          new THREE.ConeGeometry(0.1, radius * 0.8, 3),
          materials.trim,
        );
        wood.position.set(
          Math.cos(angle) * radius * 0.78,
          Math.sin(angle) * radius * 0.61,
          0.08,
        );
        wood.rotation.z = angle - Math.PI / 2;
        wood.rotation.x = 0.3;
        breach.add(wood);
      }
      this.batchStatic(model, breach, new Set());
      breach.visible = false;
      parent.add(breach);
      model.registerDamageMark(breach);
    }
    for (let index = 0; index < 3; index += 1) {
      const fire = new THREE.Group();
      fire.name = "critical-hull-fire";
      fire.position.set(
        (index % 2 ? -1 : 1) * spec.beam * 0.29,
        spec.draft * 0.17 + 1.6,
        (index - 1) * spec.length * 0.15,
      );
      for (let tongue = 0; tongue < 3; tongue += 1) {
        const flame = this.mesh(
          model,
          new THREE.ConeGeometry(0.65 - tongue * 0.14, 3 - tongue * 0.45, 5),
          this.crewMaterial(tongue === 0 ? 0xf16c29 : 0xffd26b),
        );
        flame.position.set((tongue - 1) * 0.36, 1 + tongue * 0.28, 0);
        flame.rotation.z = (tongue - 1) * 0.22;
        fire.add(flame);
      }
      fire.visible = false;
      parent.add(fire);
      model.registerFire(fire);
    }
  }

  /** Batch static detailing while leaving limb, sail, cannon and damage pivots intact. */
  private batchStatic(
    model: ProceduralShipModel,
    root: THREE.Group,
    excluded: ReadonlySet<THREE.Object3D>,
  ): void {
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert();
    const groups = new Map<
      THREE.Material,
      { geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }
    >();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
        return;
      if ("map" in object.material && object.material.map) return;
      let ancestor: THREE.Object3D | null = object;
      while (ancestor && ancestor !== root) {
        if (excluded.has(ancestor)) return;
        ancestor = ancestor.parent;
      }
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
      // Generated details have mixed UV layouts; this pass uses solid-color materials only.
      geometry.deleteAttribute("uv");
      const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
      if (nonIndexed !== geometry) geometry.dispose();
      const group = groups.get(object.material) ?? {
        geometries: [],
        meshes: [],
      };
      group.geometries.push(nonIndexed);
      group.meshes.push(object);
      groups.set(object.material, group);
    });
    for (const [material, group] of groups) {
      if (group.meshes.length > 1) {
        const merged = mergeGeometries(group.geometries, false);
        if (merged) {
          model.registerGeometry(merged);
          const mesh = new THREE.Mesh(merged, material);
          mesh.name = "batched-static-detail";
          root.add(mesh);
          for (const original of group.meshes) original.removeFromParent();
        }
      }
      for (const geometry of group.geometries) geometry.dispose();
    }
  }

  private makeSailEmblem(
    model: ProceduralShipModel,
    width: number,
    height: number,
    cloth?: THREE.Mesh,
    side: 1 | -1 = 1,
  ): THREE.Mesh {
    // Paint must share the actual triangles, not a coarser approximation of the cloth formula.
    // UV remapping keeps the original emblem footprint; transparent texture gutters hide the rest.
    const geometry = cloth
      ? cloth.geometry.clone()
      : new THREE.PlaneGeometry(width, height);
    if (cloth) {
      const parameters = (cloth.geometry as THREE.PlaneGeometry).parameters;
      const uv = geometry.getAttribute("uv");
      for (let index = 0; index < uv.count; index += 1) {
        const u = (uv.getX(index) - .5) * parameters.width / width + .5;
        uv.setXY(index, side === 1 ? u : 1 - u, (uv.getY(index) - .5) * parameters.height / height + .5);
      }
      // Each side paints only its own outward surface, with readable artwork on the reverse.
      if (side === -1) {
        const index = geometry.index!;
        for (let triangle = 0; triangle < index.count; triangle += 3) {
          const second = index.getX(triangle + 1);
          index.setX(triangle + 1, index.getX(triangle + 2));
          index.setX(triangle + 2, second);
        }
      }
    }
    geometry.computeVertexNormals();
    model.registerGeometry(geometry);
    const emblem = new THREE.Mesh(geometry, this.getEmblemMaterial(model.kind));
    emblem.name = "sail-emblem";
    emblem.userData.clothSide = side;
    return emblem;
  }

  private getEmblemMaterial(kind: ShipKind): THREE.MeshBasicMaterial {
    const existing = this.emblemMaterials.get(kind);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) this.drawEmblem(context, kind);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.08,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      toneMapped: false,
    });
    this.emblemMaterials.set(kind, material);
    return material;
  }

  private drawEmblem(context: CanvasRenderingContext2D, kind: ShipKind): void {
    const ink = "#171522";
    const cream = "#fff2cf";
    context.clearRect(0, 0, 256, 256);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = ink;
    context.fillStyle = cream;
    context.lineWidth = 13;

    if (kind === "polar-tang") {
      context.beginPath();
      context.arc(128, 126, 70, 0, TAU);
      context.stroke();
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * TAU;
        context.beginPath();
        context.arc(
          128 + Math.cos(angle) * 93,
          126 + Math.sin(angle) * 93,
          10,
          0,
          TAU,
        );
        context.fillStyle = ink;
        context.fill();
      }
      context.beginPath();
      context.arc(128, 113, 39, 0.15, Math.PI - 0.15);
      context.stroke();
      context.beginPath();
      context.arc(101, 96, 6, 0, TAU);
      context.arc(155, 96, 6, 0, TAU);
      context.fillStyle = ink;
      context.fill();
      context.font = "900 27px sans-serif";
      context.textAlign = "center";
      context.fillText("DEATH", 128, 220);
      return;
    }

    if (kind === "baratie") {
      context.beginPath();
      context.ellipse(128, 126, 86, 50, 0, 0, TAU);
      context.stroke();
      context.beginPath();
      context.moveTo(42, 126);
      context.lineTo(15, 88);
      context.lineTo(15, 164);
      context.closePath();
      context.stroke();
      context.beginPath();
      context.arc(166, 112, 7, 0, TAU);
      context.fillStyle = ink;
      context.fill();
      context.beginPath();
      context.moveTo(191, 141);
      context.quadraticCurveTo(164, 164, 138, 143);
      context.stroke();
      return;
    }

    if (kind === "navy-galleon") {
      context.beginPath();
      context.moveTo(32, 151);
      context.quadraticCurveTo(77, 69, 128, 132);
      context.quadraticCurveTo(179, 69, 224, 151);
      context.quadraticCurveTo(179, 118, 128, 174);
      context.quadraticCurveTo(77, 118, 32, 151);
      context.stroke();
      context.fillStyle = ink;
      context.font = "900 30px sans-serif";
      context.textAlign = "center";
      context.fillText("MARINE", 128, 153);
      context.font = "900 22px sans-serif";
      context.fillText("HQ-03", 128, 184);
      return;
    }

    context.strokeStyle = ink;
    context.lineWidth = 15;
    context.beginPath();
    context.moveTo(54, 49);
    context.lineTo(202, 205);
    context.moveTo(202, 49);
    context.lineTo(54, 205);
    context.stroke();
    for (const [x, y] of [
      [48, 43],
      [208, 211],
      [208, 43],
      [48, 211],
    ] as const) {
      context.beginPath();
      context.arc(x, y, 12, 0, TAU);
      context.fillStyle = ink;
      context.fill();
    }
    context.beginPath();
    context.arc(128, 119, 57, 0, TAU);
    context.fillStyle = cream;
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(107, 112, 10, 0, TAU);
    context.arc(149, 112, 10, 0, TAU);
    context.fillStyle = ink;
    context.fill();
    context.fillRect(116, 146, 24, 25);

    if (kind === "thousand-sunny" || kind === "going-merry") {
      context.fillStyle = "#e6b948";
      context.strokeStyle = ink;
      context.lineWidth = 10;
      context.beginPath();
      context.ellipse(128, 75, 76, 17, 0, 0, TAU);
      context.fill();
      context.stroke();
      context.fillRect(92, 34, 72, 42);
      context.strokeRect(92, 34, 72, 42);
      context.fillStyle = "#d54632";
      context.fillRect(94, 61, 68, 11);
    } else if (kind === "moby-dick") {
      context.strokeStyle = ink;
      context.lineWidth = 16;
      context.beginPath();
      context.arc(128, 143, 68, Math.PI * 0.08, Math.PI * 0.92, true);
      context.stroke();
    } else if (kind === "red-force") {
      context.strokeStyle = "#9d2d35";
      context.lineWidth = 8;
      for (let index = 0; index < 3; index += 1) {
        context.beginPath();
        context.moveTo(88 + index * 15, 77);
        context.lineTo(74 + index * 15, 126);
        context.stroke();
      }
    } else if (kind === "oro-jackson") {
      context.strokeStyle = "#211923";
      context.lineWidth = 11;
      context.beginPath();
      context.arc(128, 143, 54, 0.14, Math.PI - 0.14);
      context.stroke();
    } else if (kind === "queen-mama-chanter") {
      context.fillStyle = "#f2c944";
      context.strokeStyle = ink;
      context.lineWidth = 8;
      context.beginPath();
      context.moveTo(82, 75);
      context.lineTo(93, 29);
      context.lineTo(126, 64);
      context.lineTo(155, 27);
      context.lineTo(176, 76);
      context.closePath();
      context.fill();
      context.stroke();
    }
  }

  private makeSail(
    model: ProceduralShipModel,
    width: number,
    height: number,
    material: THREE.Material,
    detail: ShipDetail,
  ): THREE.Mesh {
    const segments = detail === "high" ? 20 : detail === "medium" ? 12 : 6;
    const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      const normalizedX = Math.abs(position.getX(index)) / (width * 0.5);
      const normalizedY = position.getY(index) / height + 0.5;
      position.setX(
        index,
        position.getX(index) * (0.81 + 0.19 * Math.sin(normalizedY * Math.PI)),
      );
      position.setY(
        index,
        position.getY(index) +
          (1 - normalizedX * normalizedX) *
            height *
            0.19 *
            Math.pow(1 - normalizedY, 3),
      );
      position.setZ(
        index,
        (1 - normalizedX * normalizedX) *
          Math.sin(normalizedY * Math.PI) *
          width *
          0.21 +
          Math.sin(normalizedX * Math.PI * 7) *
            width *
            0.007 *
            Math.sin(normalizedY * Math.PI),
      );
    }
    geometry.computeVertexNormals();
    model.registerGeometry(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private mesh(
    model: ProceduralShipModel,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
  ): THREE.Mesh {
    model.registerGeometry(geometry);
    return new THREE.Mesh(geometry, material);
  }

  private ellipsoid(
    model: ProceduralShipModel,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const mesh = this.mesh(model, new THREE.SphereGeometry(1, 12, 8), material);
    mesh.scale.set(x, y, z);
    return mesh;
  }

  private getMaterials(kind: ShipKind, palette: ShipPalette): ShipMaterialSet {
    const existing = this.materials.get(kind);
    if (existing) return existing;
    const set =
      this.options.materialFactory?.(kind, palette) ??
      defaultMaterialSet(palette);
    this.materials.set(kind, set);
    return set;
  }
}

function createHullGeometry(
  length: number,
  beam: number,
  draft: number,
  segments: number,
): THREE.BufferGeometry {
  const vertices: number[] = [],
    indices: number[] = [];
  const ringSize = 17;
  for (let segment = 0; segment <= segments; segment++) {
    const t = segment / segments,
      z = (t - 0.5) * length;
    const silhouette = Math.pow(Math.max(0.001, Math.sin(t * Math.PI)), 0.43);
    const width = beam * 0.49 * silhouette;
    const top = draft * 0.17 + 1.44 + Math.pow(t - 0.5, 2) * draft * 1.5;
    for (let cross = 0; cross < ringSize; cross++) {
      const angle = (cross / (ringSize - 1)) * Math.PI;
      const round = Math.sin(angle);
      vertices.push(
        -Math.cos(angle) * width,
        top * (1 - round) - draft * 1.12 * round * Math.pow(silhouette, 0.25),
        z,
      );
    }
    if (!segment) continue;
    const previous = (segment - 1) * ringSize,
      current = segment * ringSize;
    for (let point = 0; point < ringSize - 1; point++)
      indices.push(
        previous + point,
        current + point,
        previous + point + 1,
        current + point,
        current + point + 1,
        previous + point + 1,
      );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function toon(
  color: number,
  side: THREE.Side = THREE.FrontSide,
): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, side });
}

function defaultMaterialSet(palette: ShipPalette): ShipMaterialSet {
  const readableHull = liftDarkColor(palette.hull, 0.2);
  const readableHullDark = liftDarkColor(palette.hullDark, 0.245);
  const cabin = liftDarkColor(
    new THREE.Color(readableHullDark)
      .lerp(new THREE.Color(readableHull), 0.18)
      .getHex(),
    0.29,
  );
  return {
    hull: toon(readableHull, THREE.DoubleSide),
    hullDark: toon(readableHullDark, THREE.DoubleSide),
    cabin: toon(cabin, THREE.DoubleSide),
    trim: toon(palette.trim, THREE.DoubleSide),
    sail: toon(palette.sail, THREE.DoubleSide),
    accent: toon(palette.accent, THREE.DoubleSide),
    metal: toon(palette.metal, THREE.DoubleSide),
    glass: toon(0x63c9dc, THREE.DoubleSide),
    ink: new THREE.MeshBasicMaterial({
      color: 0x171625,
      side: THREE.DoubleSide,
    }),
    skin: toon(0xd99868, THREE.DoubleSide),
    white: toon(0xf2ead6, THREE.DoubleSide),
  };
}

function liftDarkColor(color: number, minimumLightness: number): number {
  const lifted = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  lifted.getHSL(hsl);
  lifted.setHSL(
    hsl.h,
    Math.min(0.82, hsl.s),
    Math.max(minimumLightness, hsl.l),
  );
  return lifted.getHex();
}
