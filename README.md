# We Are On The Cruise

A zero-asset, cel-shaded naval adventure built with Vite, TypeScript, and Three.js. Every hull, sail, island, ocean wave, texture, effect, UI mark, sound, and musical layer is generated in code at runtime.

> **Fan-project notice:** This is an unofficial, non-commercial technical fan work. One Piece and its characters and vessels belong to their respective rights holders. No original anime, manga, model, texture, audio, or logo assets are distributed here.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:4173`. Chrome on Apple silicon is the primary performance target.

For a production build:

```bash
npm run build
npm run preview
```

## Controls

| Action | Control |
| --- | --- |
| Raise / lower sail | `W` / `S` |
| Steer | `A` / `D` |
| Hard turn | `Shift` |
| Fire port / starboard broadside | `Q` / `E` |
| Fire bow weapon | `F` |
| Cycle ammunition | `X` |
| Brace | `Space` |
| Assign crew to repair | `R` |
| Ship special | `C` |
| Camera presets | `1`–`6` |
| Pause / help | `Esc` / `H` |
| Mute | `M` |

Drag on the ocean to orbit the spring-damped chase camera. The HUD keeps the centre and lower-middle of the playfield clear; detailed controls live in the help drawer.

## Play loop

Choose one of nine ships, launch into the open sea, then use **Voyage Chapters** in the captain's-log menu (`H` or `Esc`) to enter exploration, naval combat, the Pirate Cup, a Grand Line squall, island discovery, or a night encounter. Each chapter runs through the same sailing, wave, damage, AI, camera, HUD, and audio systems; this vertical slice exposes the breadth directly instead of pretending it is already a seamless campaign.

Ship handling is arcade-readable but wave-driven. Throttle, steering, currents, wind alignment, ship mass, and a shared five-wave Gerstner field affect motion. Buoyancy and rendered displacement use the same wave parameters so ships climb the waves that are visibly beneath them.

### Combat

- Port and starboard broadsides have independent reloads and firing arcs.
- Round, chain, heavy, and explosive ammunition trade hull damage, sail damage, range, and blast radius.
- Directional bow/stern/port/starboard damage, sail integrity, weapons, crew readiness, bracing, and timed repairs affect behavior.
- AI captains use aggressive, tactical, reckless, and racing steering profiles.
- The Thousand Sunny’s burst is the reference special move; other procedural ship specifications provide distinct mass, silhouette, battery layout, and handling.

### Racing

Race scenarios use four ships, a countdown, three laps, water-riding checkpoints, placement, wrong-way detection, and results presentation. The circuit remains an optional event inside the streamed ocean rather than replacing exploration.

## Procedural ships

Ship construction lives under `src/content` and `src/render/ships`. A ship blueprint contains simulation stats, proportions, silhouette landmarks, palette, mast and sail plans, weapon mounts, and a construction recipe. Rendering consumes the recipe; simulation consumes only serializable stats and mount metadata.

To add a ship:

1. Add its id to `ShipKind` in `src/core/contracts.ts`.
2. Add a blueprint with genuinely different length, beam, mass, acceleration, turn rate, damage capacity, batteries, and silhouette anchors.
3. Add distinctive procedural construction—not a recolor—to the ship factory: figurehead, hull profile, sail plan, superstructure, and palette blocks should remain readable at the far LOD.
4. Add a capture scenario or extend `moby-scale` so the new silhouette is checked from chase, broadside, and distant cameras.
5. Run the build, capture suite, and high-load profile before shipping.

## Procedural world

The logical world is divided into deterministic ocean chunks. Chunk content is derived from the global seed and integer chunk coordinate, so generation order does not change an island, reef, wreck, route, or landmark. A moving active window creates and disposes chunk views around the player. Render recentering is a view concern; it never changes a logical chunk id or seed.

Islands use generated BufferGeometry, layered profiles, exaggerated cliff/beach bands, and instanced graphic vegetation. Strong landmark templates and spacing rules keep the horizon readable while seeded variation prevents a small hand-placed arena from masquerading as an infinite world.

## Ocean and NPR rendering

- Five Gerstner waves combine a long swell, crossing body waves, and short chop.
- CPU sampling and GLSL displacement share one configuration.
- The ocean grid recentres around the player, with banded deep/mid/crest color, hard crest foam, quantized glitter, wind/current marks, and wake/spray systems.
- Ships and major world props use quantized cel materials, banded highlights, Fresnel-like rim response, and distance-aware inverted-hull ink meshes.
- A screen-space edge pass supplements silhouette ink where enabled; its cost is measurable and can degrade independently of the core toon materials.
- Sky, clouds, sun, weather color shifts, sails, markings, and UI textures are code-generated. There are no runtime model, image, environment, font, or audio requests.

## Architecture

The authoritative state is a serializable fixed-step simulation, not the Three.js scene graph. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full contract.

```text
simulation + seeded world state
        │ immutable snapshots / events
        ├── Three.js render adapters (ocean, ships, islands, FX, camera)
        ├── DOM presentation (HUD, menus, callouts, results)
        └── Web Audio presentation (synthesis, ambience, adaptive score)
```

Input is mapped to named actions once. The simulation advances at 60 Hz. Rendering interpolates and manages visual LOD, but it cannot award damage, progress a lap, spawn a logical encounter, or mutate a saveable discovery.

## AI

AI uses destination steering with lookahead, relative-bearing combat decisions, broadside range bands, brace/repair decisions, and personality weights. Expensive tactical decisions are staggered; distant ships update simplified navigation. Race opponents use the same ship motion system rather than following decorative splines.

## Audio

Audio starts only after a user gesture. Web Audio oscillators, filtered noise buffers, waveshaping, and short envelopes synthesize water, wood, sail strain, weapons, impacts, countdowns, specials, and musical layers. Exploration, combat, racing, victory, and storm states change the procedural arrangement. No audio files ship.

## Deterministic screenshots

The Playwright harness boots a retina browser, loads a seeded scenario, pauses wall-clock simulation, advances exact fixed ticks, chooses a camera, and writes a PNG plus JSON receipt:

```bash
# Capture all required evidence states
npm run dev
npm run capture

# One state from all six camera presets
npm run capture -- sunny-broadside --all-angles

# High-load runtime sample
npm run profile
```

Available scene ids:

```text
calm-sailing       storm-sailing      sunny-broadside
moby-scale         fleet-battle       damaged-ship
island-discovery   race-start         race-rough
crew-closeup       night-encounter    perf-fleet
```

The dev bridge is available as `window.__CRUISE_DEBUG__`. It can load a scene, select a ship, dispatch named actions, pause, step exact frames, switch cameras, return the serializable state, and report renderer metrics. Use a stable `?seed=...&scene=...&capture=1` URL for reproducible review.

## Performance strategy

- Device pixel ratio adapts between 1 and 2 against frame-time pressure; capture mode pins DPR 2.
- `?quality=performance` starts at DPR 1 and disables the premium screen-space and inverted-hull outline passes while retaining cel materials.
- Projectiles and short-lived visual effects are pooled and capped.
- Ocean and world views recenter instead of growing with distance.
- Ships have near, mid, and silhouette detail boundaries; distant crew and rigging are reduced.
- Chunk creation/disposal is deterministic and bounded to the active window.
- Frustum culling, instancing for repeated vegetation/foam marks, staggered AI, and update budgets keep scene cost measurable.
- `window.__CRUISE_DEBUG__.getMetrics()` reports FPS, frame time, calls, triangles, geometry/texture counts, entities, and active chunks.

The checked Metal profile on Apple silicon (`1512×982`, DPR 1, eight ships, 25 chunks) sampled 464 frames at **16.7 ms p50 / 17.2 ms p95** with one frame above 33.4 ms. The measured render frame contained 315 calls and about 96.9k triangles. Run `npm run profile` on the target machine to regenerate `output/perf/perf-fleet.json`; other GPUs, browsers, thermals, and the premium visual tier will vary.

## Honest scope and known limitations

This repository begins with a polished browser vertical slice, not the hundreds of person-years implied by a literal AAA open-world production. The slice is designed to prove the difficult systems together: generated art, shared CPU/GPU waves, distinctive ships, sailing, four-ship race/combat states, damage, crew motion, deterministic streaming, NPR rendering, audio, HUD, capture automation, and performance instrumentation.

The current quality bar should be judged from the checked capture scenes. Areas intended for later production passes include more authored encounter templates, deeper boarding resolution, save migration, every ship’s unique finishing sequence, more island interiors, wider weather variety, richer crew choreography, accessibility remapping, and exhaustive browser/GPU coverage. The project documents these limits rather than presenting procedural breadth as finished AAA content.
