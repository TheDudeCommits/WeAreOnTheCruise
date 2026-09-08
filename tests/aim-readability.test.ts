import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AimGuide,
  aimTargetSolution,
  selectAimTarget,
} from "../src/render/camera/AimGuide";
import { GameSimulation } from "../src/simulation/GameSimulation";
import { sampleCannonTrajectory } from "../src/simulation/ballistics";
import type { ShipState } from "../src/core/contracts";

function fixture() {
  const sim = new GameSimulation("aim-readability");
  const player = sim.getState().ships.find((ship) => ship.isPlayer)!;
  player.position = { x: 0, y: 0, z: 0 };
  player.heading = 0;
  player.speed = 0;
  player.faction = "straw-hat";
  const enemy = (id: string, x: number, z: number) => {
    const ship = structuredClone(player);
    ship.id = id;
    ship.isPlayer = false;
    ship.faction = "marine";
    ship.position = { x, y: 0, z };
    ship.speed = 0;
    ship.surrendered = false;
    ship.finish = undefined;
    return ship;
  };
  return { player, enemy };
}
function rotateShip(ship: ShipState, heading: number) {
  const { x, z } = ship.position;
  ship.position.x = x * Math.cos(heading) + z * Math.sin(heading);
  ship.position.z = -x * Math.sin(heading) + z * Math.cos(heading);
  ship.heading += heading;
}

describe("readable broadside targets", () => {
  it("chooses a hostile on the selected side before a closer opposite-side opening", () => {
    const { player, enemy } = fixture();
    const port = enemy("port", -115, 0),
      starboard = enemy("starboard", 40, 0);
    expect(
      selectAimTarget(
        player,
        [player, starboard, port],
        { side: "port", adjustment: 0 },
        starboard.id,
      )?.id,
    ).toBe(port.id);
    expect(
      selectAimTarget(
        player,
        [player, port, starboard],
        { side: "starboard", adjustment: 0 },
        port.id,
      )?.id,
    ).toBe(starboard.id);
    const friendly = enemy("friendly", -25, 0);
    friendly.faction = "straw-hat";
    const surrendered = enemy("surrendered", -20, 0);
    surrendered.surrendered = true;
    expect(
      selectAimTarget(player, [friendly, surrendered, port], {
        side: "port",
        adjustment: 0,
      })?.id,
    ).toBe(port.id);
  });
  it("retains side selection and corrective lead when the entire encounter rotates", () => {
    const { player, enemy } = fixture();
    const target = enemy("ahead", -105, -22);
    const before = aimTargetSolution(
      player,
      { side: "port", adjustment: 0 },
      target,
    );
    expect(before.guidance).toBe(". LEAD TOWARD THE BOW");
    rotateShip(player, 1.13);
    rotateShip(target, 1.13);
    const after = aimTargetSolution(
      player,
      { side: "port", adjustment: 0 },
      target,
    );
    expect(after.correctSide).toBe(true);
    expect(after.guidance).toBe(before.guidance);
    expect(after.distance).toBeCloseTo(before.distance, 5);
    expect(
      selectAimTarget(player, [target], { side: "port", adjustment: 0 })?.id,
    ).toBe(target.id);
  });
  it("distinguishes changing firing side, closing range, and leading fore/aft", () => {
    const { player, enemy } = fixture();
    expect(
      aimTargetSolution(
        player,
        { side: "port", adjustment: 0 },
        enemy("wrong", 80, 0),
      ).guidance,
    ).toBe("AIM STARBOARD · HOLD V");
    expect(
      aimTargetSolution(
        player,
        { side: "port", adjustment: 0 },
        enemy("far", -800, 0),
      ).guidance,
    ).toMatch(/^CLOSE ≈/);
    expect(
      aimTargetSolution(
        player,
        { side: "port", adjustment: 0 },
        enemy("aft", -105, 22),
      ).guidance,
    ).toBe(", LEAD TOWARD THE STERN");
    expect(
      aimTargetSolution(
        player,
        { side: "port", adjustment: 0 },
        enemy("straight", -105, 0),
      ).guidance,
    ).toBe("TARGET CROSSES THE SHOT LANE");
  });
  it("shares the exact physical impact across ammo types without moving the firing solution toward the target", () => {
    const { player, enemy } = fixture();
    const target = enemy("moving", -95, 12);
    target.speed = 18;
    for (const ammo of ["round", "chain", "heavy"] as const) {
      player.weapons.ammo = ammo;
      const solution = aimTargetSolution(
        player,
        { side: "port", adjustment: 0.12 },
        target,
      );
      expect(solution.shot).toEqual(
        sampleCannonTrajectory(player, "port", 0.12),
      );
      expect(solution.predicted!.z).toBeLessThan(target.position.z);
      expect(solution.timeToTarget).toBeLessThanOrEqual(
        solution.shot.flightTime,
      );
    }
  });
  it("anchors the marker to the same candidate and releases it when aim ends", () => {
    const { player, enemy } = fixture();
    const target = enemy("marked", -120, 0);
    const scene = new THREE.Scene();
    const guide = new AimGuide(scene);
    const camera = new THREE.PerspectiveCamera(53, 16 / 9, 0.1, 1200);
    camera.position.set(-15, 17, 8);
    const aim = { side: "port" as const, adjustment: 0 };
    guide.update(player, aim, target, camera);
    const marker = guide.root.getObjectByName("selected-hostile-world-marker")!;
    expect(guide.root.userData.targetId).toBe(target.id);
    expect(marker.position.x).toBe(target.position.x);
    expect(marker.position.z).toBe(target.position.z);
    expect(guide.root.userData.impact).toEqual(
      sampleCannonTrajectory(player, "port").impact,
    );
    guide.update(player, { adjustment: 0 });
    expect(guide.root.visible).toBe(false);
    guide.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
