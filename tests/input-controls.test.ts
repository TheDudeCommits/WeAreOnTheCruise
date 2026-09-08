import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputController } from "../src/input/InputController";
import { loadControlSettings } from "../src/input/controls";

function makeTarget() {
  const target = new EventTarget() as Window;
  Object.defineProperty(target, "navigator", {
    value: { getGamepads: () => [] },
    configurable: true,
  });
  Object.defineProperty(target, "matchMedia", {
    value: () => ({ matches: false }),
  });
  return target;
}
function key(target: Window, type: string, code: string) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "code", { value: code });
  target.dispatchEvent(event);
}
let target: Window;
beforeEach(() => {
  target = makeTarget();
  vi.stubGlobal("window", target);
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("helm input safety", () => {
  it("clears held keyboard and touch actions when a menu opens, including aim", () => {
    const sink = vi.fn();
    const input = new InputController(sink, target);
    input.attach();
    key(target, "keydown", "KeyW");
    key(target, "keydown", "KeyZ");
    input.setVirtualAction("fire-port", true);
    expect(input.getActionState()["throttle-up"]).toBe(true);
    expect(input.getAimState().side).toBe("port");
    input.setEnabled(false);
    expect(input.getActionState()["throttle-up"]).toBe(false);
    expect(input.getActionState()["fire-port"]).toBe(false);
    expect(input.getAimState().side).toBeUndefined();
    key(target, "keydown", "KeyE");
    input.setVirtualAction("special", true);
    expect(input.getActionState()["fire-starboard"]).not.toBe(true);
    expect(input.getActionState().special).not.toBe(true);
    input.detach();
  });
  it("does not release an action while its alternative key remains held", () => {
    const input = new InputController(undefined, target);
    input.attach();
    key(target, "keydown", "KeyW");
    key(target, "keydown", "ArrowUp");
    key(target, "keyup", "KeyW");
    expect(input.getActionState()["throttle-up"]).toBe(true);
    key(target, "keyup", "ArrowUp");
    expect(input.getActionState()["throttle-up"]).toBe(false);
    input.detach();
  });
  it("controller start can close a paused menu but held fire remains gated", () => {
    const buttons = Array.from({ length: 12 }, () => ({ pressed: false }));
    Object.defineProperty(target, "navigator", {
      value: { getGamepads: () => [{ axes: [0, 0], buttons }] },
    });
    const sink = vi.fn();
    const input = new InputController(sink, target);
    input.setEnabled(false);
    buttons[9].pressed = true;
    buttons[4].pressed = true;
    input.pollGamepad();
    input.pollGamepad();
    expect(
      sink.mock.calls.filter(
        ([action, pressed]) => action === "pause" && pressed,
      ),
    ).toHaveLength(1);
    expect(input.getActionState()["fire-port"]).not.toBe(true);
    buttons[9].pressed = false;
    input.pollGamepad();
    expect(sink).toHaveBeenCalledWith("pause", false);
  });
  it("remapping clears the old held action and accepts the new key", () => {
    const input = new InputController(undefined, target);
    input.attach();
    key(target, "keydown", "KeyW");
    input.setBindings({ KeyP: "throttle-up" });
    expect(input.getActionState()["throttle-up"]).toBe(false);
    key(target, "keydown", "KeyW");
    expect(input.getActionState()["throttle-up"]).toBe(false);
    key(target, "keydown", "KeyP");
    expect(input.getActionState()["throttle-up"]).toBe(true);
    input.detach();
  });
  it("recovers safely from corrupt stored control settings", () => {
    vi.stubGlobal("localStorage", { getItem: () => "{bad json" });
    expect(loadControlSettings().keyBindings.KeyQ).toBe("fire-port");
  });
});

import { GameSimulation } from "../src/simulation/GameSimulation";
describe("physical helm direction through keyboard controls", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -.82]) {
    it.each([
      ["KeyD", 1], ["ArrowRight", 1], ["KeyA", -1], ["ArrowLeft", -1],
    ] as const)("%s moves toward its intended side from heading " + heading, (code, direction) => {
      const sim = new GameSimulation("physical-helm");
      sim.loadScenario("crew-closeup");
      const player = sim.getState().ships[0]!;
      player.heading = heading;
      const input = new InputController((action, pressed) => sim.setAction(action, pressed), target);
      input.attach();
      try {
        key(target, "keydown", "KeyW");
        sim.step(180); // Get underway through the normal throttle control before commanding the turn.
        const start = { ...player.position };
        const initialStarboard = { x: Math.cos(heading), z: -Math.sin(heading) };
        const initialForward = { x: -Math.sin(heading), z: -Math.cos(heading) };
        key(target, "keydown", code);
        sim.step(180);
        const displacement = { x: player.position.x - start.x, z: player.position.z - start.z };
        const across = displacement.x * initialStarboard.x + displacement.z * initialStarboard.z;
        const ahead = displacement.x * initialForward.x + displacement.z * initialForward.z;
        expect(across * direction).toBeGreaterThan(2);
        expect(ahead).toBeGreaterThan(10);
      } finally { input.detach(); }
    });
  }
});

describe("fixed-step one-shot action buffer", () => {
  it("consumes an ammo tap released before the next frame exactly once", () => {
    const sim = new GameSimulation("fast-tap");
    sim.loadScenario("calm-sailing");
    sim.setAction("cycle-ammo", true);
    sim.setAction("cycle-ammo", false);
    sim.step(1);
    const player = sim.getState().ships.find((ship) => ship.isPlayer)!;
    expect(player.weapons.ammo).toBe("chain");
    sim.step(12);
    expect(player.weapons.ammo).toBe("chain");
  });
  it("fires a quick broadside once and clears pending shots on pause", () => {
    const sim = new GameSimulation("fast-fire");
    sim.loadScenario("calm-sailing");
    sim.setAction("fire-port", true);
    sim.setAction("fire-port", false);
    sim.step(1);
    expect(
      sim
        .drainEvents()
        .filter(
          (event) =>
            event.type === "cannon-fired" &&
            event.shipId === sim.getState().playerId,
        ),
    ).toHaveLength(1);
    const other = new GameSimulation("paused-tap");
    other.loadScenario("calm-sailing");
    other.setAction("cycle-ammo", true);
    other.setAction("cycle-ammo", false);
    other.setPaused(true);
    other.step(1);
    expect(
      other.getState().ships.find((ship) => ship.isPlayer)!.weapons.ammo,
    ).toBe("round");
  });
});
