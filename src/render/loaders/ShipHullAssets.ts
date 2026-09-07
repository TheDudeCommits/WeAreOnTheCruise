import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { ShipKind } from "../../core/contracts";
import { getShipSpec } from "../../content/shipSpecs";
import type { ShipMaterialSet } from "../ships/ShipGeometryFactory";

/** Original Blender-authored hulls. Sketchfab intake stays explicit in the source manifest. */
export class ShipHullAssets {
  private readonly loader = new GLTFLoader();
  private readonly pending = new Map<ShipKind, Promise<THREE.Group | null>>();
  private readonly sources = new Set<THREE.Group>();
  private readonly deckMaterials = new Map<ShipKind, THREE.Material>();
  private disposed = false;
  readonly status = new Map<ShipKind, "loading" | "ready" | "fallback">();

  load(kind: ShipKind): Promise<THREE.Group | null> {
    if (kind === "polar-tang" || this.disposed) return Promise.resolve(null);
    const existing = this.pending.get(kind);
    if (existing) return existing;
    this.status.set(kind, "loading");
    const promise = this.loader
      .loadAsync(`/assets/ships/${kind}-hull.glb`)
      .then((gltf) => {
        if (this.disposed) {
          this.release(gltf.scene);
          return null;
        }
        this.prepareHull(gltf.scene, kind);
        this.sources.add(gltf.scene);
        this.status.set(kind, "ready");
        return gltf.scene;
      })
      .catch((error: unknown) => {
        this.status.set(kind, "fallback");
        console.warn(
          `Hull asset ${kind} unavailable; using built-in geometry.`,
          error,
        );
        return null;
      });
    this.pending.set(kind, promise);
    return promise;
  }

  async mount(
    kind: ShipKind,
    target: THREE.Group,
    materials: ShipMaterialSet,
    alive: () => boolean,
    castShadow: boolean,
  ): Promise<void> {
    const source = await this.load(kind);
    if (!source || this.disposed || !alive()) return;
    const instance = source.clone(true);
    instance.name = `authored-hull:${kind}`;
    instance.userData.assetSource = "original-blender-authored";
    let deckMaterial = this.deckMaterials.get(kind);
    if (!deckMaterial) {
      deckMaterial = materials.hull.clone();
      if ("color" in deckMaterial && deckMaterial.color instanceof THREE.Color)
        deckMaterial.color.setHex(0xc79850);
      if (
        deckMaterial instanceof THREE.ShaderMaterial &&
        deckMaterial.uniforms.uBaseColor
      )
        deckMaterial.uniforms.uBaseColor.value = new THREE.Color(0xc79850);
      this.deckMaterials.set(kind, deckMaterial);
    }
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const sourceMaterial = Array.isArray(object.material)
        ? object.material[0]
        : object.material;
      const role = sourceMaterial.name
        .replace(/^CruiseHull_/, "")
        .replace(/\.\d+$/, "");
      if (
        role === "metal" &&
        (kind === "thousand-sunny" || kind === "navy-galleon")
      )
        object.visible = false;
      object.material =
        role === "deck"
          ? deckMaterial!
          : role === "seam"
            ? materials.hullDark
            : (materials[role as keyof ShipMaterialSet] ?? materials.hull);
      object.castShadow = castShadow;
      object.receiveShadow = true;
      object.userData.nprOutline = role !== "hullDark";
    });
    target.clear();
    target.add(instance);
    target.userData.assetReady = true;
  }

  /** Refine the original authoring mesh once, keeping decks and gun mounts in gameplay coordinates. */
  private prepareHull(root: THREE.Group, kind: ShipKind): void {
    if (kind !== "thousand-sunny" && kind !== "navy-galleon") return;
    const spec = getShipSpec(kind);
    const deck = spec.draft * 0.17 + 1.44;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = object.geometry;
      const original = source.getAttribute("position");
      const geometry = source.clone();
      // Quantized GLBs carry normalized integer attributes: deform float positions, never write metre values into those integers.
      const positions = new Float32Array(original.count * 3);
      for (let index = 0; index < original.count; index++) {
        positions[index * 3] = original.getX(index);
        positions[index * 3 + 1] = original.getY(index);
        positions[index * 3 + 2] = original.getZ(index);
      }
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );
      geometry.applyMatrix4(object.matrixWorld);
      const attribute = geometry.getAttribute("position");
      for (let index = 0; index < attribute.count; index++) {
        const y = attribute.getY(index);
        if (y < deck - 0.15)
          attribute.setY(
            index,
            deck - (deck - y) * (kind === "thousand-sunny" ? 1.36 : 1.27),
          );
      }
      geometry.applyMatrix4(object.matrixWorld.clone().invert());
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      object.geometry = geometry;
      source.dispose();
    });
    root.userData.presentationRevision = "rounded-keel-and-tiered-decks-02";
  }

  async ready(): Promise<void> {
    await Promise.all(this.pending.values());
  }

  dispose(): void {
    this.disposed = true;
    for (const source of this.sources) this.release(source);
    this.sources.clear();
    for (const material of this.deckMaterials.values()) material.dispose();
    this.deckMaterials.clear();
    this.pending.clear();
  }

  private release(source: THREE.Group): void {
    source.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        material.dispose();
    });
  }
}
