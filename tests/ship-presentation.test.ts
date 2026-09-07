import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ShipGeometryFactory } from "../src/render/ships/ShipGeometryFactory";
import { ShipHullAssets } from "../src/render/loaders/ShipHullAssets";
import { GameSimulation } from "../src/simulation/GameSimulation";
import { sampleCannonTrajectory } from "../src/simulation/ballistics";
import {
  deckHeightAt,
  mainDeckHeight,
} from "../src/render/ships/ShipDeckProfile";
import { getShipSpec, SHIP_SPECS } from "../src/content/shipSpecs";
import type { ShipKind } from "../src/core/contracts";

beforeEach(() => {
  vi.spyOn(ShipHullAssets.prototype, "mount").mockResolvedValue(undefined);
  const context = new Proxy(
    {},
    { get: () => () => undefined, set: () => true },
  );
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => context,
    }),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ship presentation and gameplay alignment", () => {
  it("places Polar crew feet on the rendered capsule and shelters them throughout a dive", () => {
    const sim = new GameSimulation("polar-crew-contact");
    sim.selectPlayerShip("polar-tang");
    const ship = sim.getState().ships.find(entry => entry.isPlayer)!;
    const factory = new ShipGeometryFactory();
    const model = factory.create("polar-tang");
    try {
      model.update(ship, 0);
      model.root.updateMatrixWorld(true);
      const high = model.lod.levels[0].object;
      const crew = high.children.filter(object => object.name.startsWith("crew:"));
      const surfaces: THREE.Object3D[] = [];
      high.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        let parent: THREE.Object3D | null = object;
        while (parent && parent !== high) {
          if (parent.name.startsWith("crew:")) return;
          parent = parent.parent;
        }
        surfaces.push(object);
      });
      expect(crew.length).toBeGreaterThan(0);
      for (const member of crew) {
        const feet = member.getWorldPosition(new THREE.Vector3());
        const ray = new THREE.Raycaster(feet.clone().add(new THREE.Vector3(0, .5, 0)), new THREE.Vector3(0, -1, 0));
        const contact = ray.intersectObjects(surfaces, false)[0];
        expect(contact).toBeDefined();
        expect(Math.abs(contact.point.y - feet.y)).toBeLessThan(.3);
      }
      for (const phase of ["active", "recovery"] as const) {
        ship.specialPhase = { name: "submerge-dash", phase, elapsed: .5, duration: 3.2 };
        model.update(ship, 1);
        expect(crew.every(member => !member.visible)).toBe(true);
      }
      ship.specialPhase = undefined;
      model.update(ship, 2);
      expect(crew.every(member => member.visible)).toBe(true);
    } finally { model.dispose(); factory.dispose(); }
  });
  it.each(
    (Object.keys(SHIP_SPECS) as ShipKind[]).filter(
      (kind) => kind !== "polar-tang",
    ),
  )(
    "keeps every %s broadside muzzle at the authoritative launch position",
    (kind) => {
      const sim = new GameSimulation("ship-anchors");
      sim.selectPlayerShip(kind);
      const ship = sim.getState().ships.find((entry) => entry.isPlayer)!;
      ship.heading = 0.82;
      ship.position = { x: 31, y: 0.8, z: -24 };
      const factory = new ShipGeometryFactory();
      const model = factory.create(kind);
      model.root.position.set(
        ship.position.x,
        ship.position.y,
        ship.position.z,
      );
      model.root.rotation.y = ship.heading;
      model.update(ship, 0);
      model.root.updateMatrixWorld(true);
      for (const side of ["port", "starboard"] as const) {
        const anchors =
          side === "port"
            ? model.anchors.portCannons
            : model.anchors.starboardCannons;
        anchors.forEach((anchor, index) => {
          const point = anchor.getWorldPosition(new THREE.Vector3());
          const actual = sampleCannonTrajectory(
            ship,
            side,
            0,
            index / (anchors.length - 1) - 0.5,
          ).position;
          expect(point.x).toBeCloseTo(actual.x, 5);
          expect(point.y).toBeCloseTo(actual.y, 5);
          expect(point.z).toBeCloseTo(actual.z, 5);
        });
      }
      for (const anchor of model.anchors.bowCannons) {
        const point = anchor.getWorldPosition(new THREE.Vector3());
        const actual = sampleCannonTrajectory(ship, "bow").position;
        expect(point.x).toBeCloseTo(actual.x, 5);
        expect(point.y).toBeCloseTo(actual.y, 5);
        expect(point.z).toBeCloseTo(actual.z, 5);
      }
      model.dispose();
      factory.dispose();
    },
  );
  it("retains meaningful foredeck and quarterdeck height without moving the main gun deck", () => {
    const spec = getShipSpec("thousand-sunny");
    expect(deckHeightAt("thousand-sunny", spec, 0)).toBe(mainDeckHeight(spec));
    expect(
      deckHeightAt("thousand-sunny", spec, -spec.length * 0.4) -
        mainDeckHeight(spec),
    ).toBeGreaterThan(2);
    expect(
      deckHeightAt("thousand-sunny", spec, spec.length * 0.3) -
        mainDeckHeight(spec),
    ).toBeGreaterThan(3);
    const nearRamp = deckHeightAt("thousand-sunny", spec, spec.length * 0.16);
    expect(nearRamp).toBeGreaterThan(mainDeckHeight(spec));
    expect(nearRamp).toBeLessThan(
      deckHeightAt("thousand-sunny", spec, spec.length * 0.3),
    );
  });
  it("places emblems on both sides of the same animated sail, with a strongly scalloped lower edge", () => {
    const factory = new ShipGeometryFactory();
    const model = factory.create("thousand-sunny");
    const sail = model.root.getObjectByName("sail-cloth") as THREE.Mesh;
    expect(
      sail.children.filter((child) => child.name === "sail-emblem"),
    ).toHaveLength(2);
    const position = sail.geometry.getAttribute("position");
    const height = (sail.geometry as THREE.PlaneGeometry).parameters.height;
    const bottom = Array.from({ length: position.count }, (_, index) => ({
      x: position.getX(index),
      y: position.getY(index),
    })).filter((point) => point.y < -height * 0.25);
    const center = bottom.filter((point) => Math.abs(point.x) < 0.01);
    expect(
      Math.min(...center.map((point) => point.y)) -
        Math.min(...bottom.map((point) => point.y)),
    ).toBeGreaterThan(height * 0.15);
    model.dispose();
    factory.dispose();
  });
  it.each(["thousand-sunny", "navy-galleon", "oro-jackson"] as const)(
    "keeps %s paint on the actual cloth facets on both sides through damage and repair",
    (kind) => {
      const factory = new ShipGeometryFactory(), model = factory.create(kind);
      const sim = new GameSimulation("cloth-paint"); sim.selectPlayerShip(kind);
      const state = sim.getState().ships[0]!;
      const sail = model.root.getObjectByName("sail-cloth") as THREE.Mesh;
      const patches = sail.children.filter((child) => child.name === "sail-emblem") as THREE.Mesh[];
      expect(patches).toHaveLength(2);
      for (const damage of [0, .5, .95, 0]) {
        state.damage.sails = damage; model.update(state, 3 + damage);
        const clothPosition = sail.geometry.getAttribute("position");
        for (const patch of patches) {
          const paintPosition = patch.geometry.getAttribute("position");
          expect(paintPosition.count).toBe(clothPosition.count);
          expect(patch.position.length()).toBe(0);
          // Every painted triangle stays coplanar; a coarse decal can pierce these same facets.
          expect(Array.from(paintPosition.array)).toEqual(Array.from(clothPosition.array));
          const clothIndex = sail.geometry.index!, paintIndex = patch.geometry.index!;
          for (let triangle = 0; triangle < clothIndex.count; triangle += 3) {
            const expected = [clothIndex.getX(triangle), clothIndex.getX(triangle + 1), clothIndex.getX(triangle + 2)];
            if (patch.userData.clothSide === -1) [expected[1], expected[2]] = [expected[2], expected[1]];
            expect([paintIndex.getX(triangle), paintIndex.getX(triangle + 1), paintIndex.getX(triangle + 2)]).toEqual(expected);
          }
          const material = patch.material as THREE.MeshBasicMaterial;
          expect(material.side).toBe(THREE.FrontSide);
          expect(material.depthTest).toBe(true);
          expect(material.polygonOffset).toBe(true);
          expect(material.polygonOffsetFactor).toBeLessThan(0);
        }
      }
      const frontUv = patches[0].geometry.getAttribute("uv"), backUv = patches[1].geometry.getAttribute("uv");
      for (let vertex = 0; vertex < frontUv.count; vertex += 1) {
        expect(frontUv.getX(vertex) + backUv.getX(vertex)).toBeCloseTo(1, 6);
        expect(frontUv.getY(vertex)).toBe(backUv.getY(vertex));
      }
      model.dispose(); factory.dispose();
    },
  );
});
