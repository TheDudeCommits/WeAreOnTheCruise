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

  ready(): Promise<void> { return this.factory.ready(); }

  get assetStatus(): ReadonlyMap<ShipKind, 'loading' | 'ready' | 'fallback'> { return this.factory.hullAssets.status; }

  getModel(shipId: string): ProceduralShipModel | undefined {
    return this.models.get(shipId);
  }

  dispose(): void {
    for (const model of this.models.values()) model.dispose();
    this.models.clear();
    this.factory.dispose();
    this.root.removeFromParent();
  }
}
