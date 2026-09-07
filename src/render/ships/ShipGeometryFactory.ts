import * as THREE from "three";
import { SketchfabCrewAssets } from "../loaders/SketchfabCrewAssets";
import { SketchfabShipAssets } from "../loaders/SketchfabShipAssets";
import { hasSketchfabShip } from "../../content/sketchfabShips";
import { cannonMuzzleHeight } from "../../simulation/ballistics";
import { polarCrewSheltered } from "../../simulation/specials";
import { deckHeightAt, polarDeckHeightAt } from "./ShipDeckProfile";
import type { ShipDamage, ShipKind, ShipState } from "../../core/contracts";
import {
  getShipSpec,
  type ShipPalette,
  type ShipSpec,
} from "../../content";


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
  private readonly sourceAnimations: Array<(state:ShipState,time:number,dt:number)=>void> = [];
  private readonly sourceDisposals: Array<()=>void> = [];
  registerSourceAnimation(update:(state:ShipState,time:number,dt:number)=>void, dispose:()=>void):void {
    this.sourceAnimations.push(update); this.sourceDisposals.push(dispose);
  }
  readonly freeboardLift: number;
  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor(
    readonly kind: ShipKind,
    readonly spec: ShipSpec,
  ) {
    this.freeboardLift = hasSketchfabShip(kind) || kind === "polar-tang" ? 0 : spec.draft * 0.38;
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
    for (const update of this.sourceAnimations) update(state,time,dt);
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
    for (const dispose of this.sourceDisposals) dispose();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    this.root.removeFromParent();
  }
}

/** The runtime factory accepts only downloaded, reviewed source assets. */
export class ShipGeometryFactory {
  readonly sketchfabAssets = new SketchfabShipAssets();
  readonly crewAssets = new SketchfabCrewAssets();
  private readonly mounts = new Set<Promise<void>>();
  constructor(private readonly options: ShipGeometryFactoryOptions = {}) {}

  async prepare(kind: ShipKind): Promise<void> {
    if (!hasSketchfabShip(kind)) throw new Error(`A downloaded source model is not available for ${kind}.`);
    await Promise.all([this.sketchfabAssets.prepare(kind), this.crewAssets.prepare(kind)]);
  }
  async ready(): Promise<void> {
    await Promise.all([this.sketchfabAssets.ready(), this.crewAssets.ready()]);
    await Promise.all(this.mounts);
  }
  create(kind: ShipKind): ProceduralShipModel {
    if (!hasSketchfabShip(kind)) throw new Error(`A downloaded source model is not available for ${kind}.`);
    const spec = getShipSpec(kind), model = new ProceduralShipModel(kind, spec);
    const high = new THREE.Group(), low = new THREE.Group();
    high.name = `${kind}:downloaded-high`; low.name = `${kind}:downloaded-low`;
    model.lod.addLevel(high, 0);
    model.lod.addLevel(low, Math.max(170, spec.length * 2.8));
    model.root.userData.assetSource = 'sketchfab';
    const alive = () => !model.isDisposed;
    const configure=(instance:THREE.Group)=>{
      const damage=this.sketchfabAssets.bindDamage(instance,kind);
      model.registerSourceAnimation(state=>{
        damage.uniform.value.set(state.damage.hull,state.damage.sails,state.damage.sections.port,state.damage.sections.starboard);
        model.root.updateWorldMatrix(true,false);
        damage.inverse.value.copy(model.root.matrixWorld).invert();
      },damage.dispose);
    };
    const highMount = this.sketchfabAssets.mount(kind, 'high', high, alive, this.options.castShadow ?? true,configure).then(async () => {
      await this.crewAssets.mount(kind, high, alive, (update, dispose) => model.registerSourceAnimation(update, dispose));
    });
    const lowMount = this.sketchfabAssets.mount(kind, 'low', low, alive, this.options.castShadow ?? true,configure);
    for (const mount of [highMount,lowMount]) {
      this.mounts.add(mount);
      void mount.then(()=>this.mounts.delete(mount),error=>{this.mounts.delete(mount);model.root.userData.assetError=String(error);});
    }
    // These are transform anchors, not invented cannon geometry. They share the projectile mounts.
    for (const side of ['port','starboard','bow'] as const) {
      const count = side === 'bow' ? Math.min(3,spec.bowCannons) : Math.min(6,spec.broadsideCannons);
      for(let index=0;index<count;index++) {
        const anchor = new THREE.Object3D(), offset = count > 1 ? index / (count-1)-.5 : 0;
        anchor.position.set(side === 'bow' ? 0 : (side === 'port' ? -1 : 1)*spec.beam*.48,
          cannonMuzzleHeight(kind,side), side === 'bow' ? -spec.length*.48 : -offset*spec.length*.44);
        model.root.add(anchor);
        model.anchors[side === 'port' ? 'portCannons' : side === 'starboard' ? 'starboardCannons' : 'bowCannons'].push(anchor);
      }
    }
    return model;
  }
  dispose(): void { this.sketchfabAssets.dispose(); this.crewAssets.dispose(); }
}
