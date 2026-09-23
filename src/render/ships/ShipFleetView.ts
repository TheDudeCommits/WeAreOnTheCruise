import * as THREE from 'three';
import type { ShipKind, WorldState } from '../../core/contracts';
import { ProceduralShipModel, ShipGeometryFactory, type ShipGeometryFactoryOptions } from './ShipGeometryFactory';

export interface ShipFleetViewOptions extends ShipGeometryFactoryOptions {
  visibleKinds?: readonly ShipKind[];
}

/** Three.js projection of simulation ships. Simulation remains authoritative. */
export class ShipFleetView {
  readonly root = new THREE.Group();

  private readonly factory: ShipGeometryFactory;
  private readonly models = new Map<string, ProceduralShipModel>();
  private readonly visibleKinds?: ReadonlySet<ShipKind>;

  constructor(scene: THREE.Scene, options: ShipFleetViewOptions = {}) {
    this.root.name = 'ship-fleet';
    scene.add(this.root);
    this.factory = new ShipGeometryFactory(options);
    this.visibleKinds = options.visibleKinds ? new Set(options.visibleKinds) : undefined;
  }

  sync(state: WorldState, time = state.elapsed): void {
    const activeIds = new Set<string>();
    for (const ship of state.ships) {
      if (this.visibleKinds && !this.visibleKinds.has(ship.kind)) continue;
      activeIds.add(ship.id);
      let model = this.models.get(ship.id);
      if (!model || model.kind !== ship.kind) {
        model?.dispose();
        model = this.factory.create(ship.kind);
        this.models.set(ship.id, model);
        this.root.add(model.root);
      }
      model.root.position.set(ship.position.x, ship.position.y, ship.position.z);
      model.root.rotation.order = 'YXZ';
      model.root.rotation.set(ship.pitch, ship.heading, ship.roll);
      // Disabled ships remain inspectable for salvage/spare and through the sinking animation.
      // A legacy snapshot without finishing state retains its previous disappearance behavior.
      model.root.visible = ship.finish ? ship.finish.state !== 'sunk' : !ship.surrendered || ship.damage.hull < .995;
      model.root.userData.shipId = ship.id;
      model.root.userData.isPlayer = ship.isPlayer;
      model.update(ship, time);
    }
    for (const [id, model] of this.models) {
      if (activeIds.has(id)) continue;
      model.dispose();
      this.models.delete(id);
    }
  }

  prepare(kind:ShipKind): Promise<void> { return this.factory.prepare(kind); }

  ready(): Promise<void> { return this.factory.ready(); }

  get assetStatus(): ReadonlyMap<ShipKind, 'loading' | 'ready' | 'error'> { return this.factory.sketchfabAssets.status; }

  getModel(shipId: string): ProceduralShipModel | undefined {
    return this.models.get(shipId);
  }

  setAssetExposure(exposure: number): void { this.factory.sketchfabAssets.setExposure(exposure); }

  inspectAssets(): unknown[] {
    return [...this.models.entries()].map(([id, model]) => {
      const bounds = new THREE.Box3().setFromObject(model.lod);
      let meshes = 0;
      const crew:unknown[]=[];
      model.lod.traverse(object => { if (object instanceof THREE.Mesh) meshes++; });
      model.lod.traverse(object=>{if(object.name.startsWith('crew:'))crew.push({name:object.name,sourceUid:object.userData.assetSource,contact:object.userData.deckContact,visible:object.visible});});
      return { id, kind: model.kind, source: model.root.userData.assetSource ?? 'unavailable', status: this.assetStatus.get(model.kind), meshes, crew, error:model.root.userData.assetError, bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() } };
    });
  }

  dispose(): void {
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    this.factory.dispose();
    this.root.removeFromParent();
  }
}
