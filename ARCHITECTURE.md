# We Are On The Cruise — Runtime Contract

The game is a deterministic browser simulation with three adapters: Three.js rendering, DOM presentation, and Web Audio. The renderer is never authoritative.

## Fixed boundaries

- `src/core`: serializable contracts, seeded random helpers, configuration.
- `src/simulation`: fixed-step sailing, combat, AI, racing, damage, encounter streaming.
- `src/render`: scene graph, procedural geometry, cel materials, water, FX, camera.
- `src/world`: deterministic ocean chunks and generated landmarks.
- `src/ui`: DOM HUD, ship select, pause/help, results and callouts.
- `src/audio`: synthesized sound and adaptive music only.
- `src/runtime` + `scripts`: debug bridge, deterministic capture harness, and frame/performance probes.

One Three.js unit is one metre. Ship pivots sit at the waterline at hull centre. Forward is local `-Z`; starboard is local `+X`; positive heading turns clockwise when viewed from above. Simulation uses a 60 Hz fixed step and plain serializable objects. Rendering interpolates but does not write gameplay state.

## First playable loop

Choose a ship and spawn behind the helm in open water. The in-game Voyage Chapters launcher swaps the fixed-step simulation into exploration, race, combat, storm, discovery, and night presets. This is the first-playable vertical-slice loop; seamless campaign travel, persistence, unlocks, and save migration remain later production work.

## Deterministic evidence contract

`window.__CRUISE_DEBUG__` is installed at boot. `?seed=<seed>&scene=<scene>` must recreate a stable state. Capture scenes are: calm sailing, storm sailing, Sunny broadside, Moby Dick scale, fleet battle, persistent damage, island discovery, race start, race over rough water, crew close-up, night encounter, and high-load fleet. The bridge owns pause, fixed-frame stepping, actions, camera presets, state snapshots, and renderer metrics.

No screenshot is accepted until the bridge reports `ready`, the scene is paused, and three fixed frames have been advanced. Visual acceptance is screenshot-based; DOM assertions alone are insufficient.

## Runtime budgets

- Adaptive device pixel ratio: 1.0–2.0, adjusted against a 16.7 ms frame target.
- Active world: 5×5 logical chunks; persistent discoveries keyed by deterministic chunk id.
- Pooled projectiles, smoke, spray, wakes and impact flashes.
- Near/full ship, mid/simplified rigging, far/silhouette LODs.
- Expensive AI at staggered rates; distant ships use destination steering only.
- Persistent HUD below 25% viewport coverage; center and lower-middle playfield remain clear.

## Asset policy

There are no runtime asset URLs. Geometry, sails, markings, ramp textures, sky, ocean, particles, UI marks, voices, effects, and music are generated in code. A new ship is a data specification plus a procedural construction function and LOD profile.
