# We Are On The Cruise — Runtime Contract

The authoritative game is a serializable fixed-step simulation. Three.js, DOM UI and Web Audio are presentation adapters. They may request named commands and consume state/events; they must not award damage, settle rewards, advance checkpoints or create logical collision state independently.

## Ownership

| Area | Responsibility |
| --- | --- |
| `src/core` | Serializable contracts, seeded randomness and shared wave definitions |
| `src/content` | Ship stats, practice scenes, contracts, builds, route generation, crew presets and refits |
| `src/simulation` | Sailing, AI, ballistics, damage, racing, voyages, payout ledger and save validation |
| `src/world` | Deterministic chunks and the shared `LogicalWorld` island/collision catalog |
| `src/render` | Loaded and generated geometry, materials, ocean, sky, scenery, FX and camera |
| `src/input` | Keyboard, touch and gamepad action aggregation, bindings and aim input |
| `src/ui` | Launch, chart, rewards, crew orders, HUD, help and settings |
| `src/audio` | Web Audio synthesis, ambience and adaptive score |
| `src/runtime` | Lifecycle, input gates, adapters, local persistence and debug bridge |
| `scripts` | Asset preparation, capture, interaction, progression and performance harnesses |

## Coordinates and clocks

One Three.js unit represents one metre. Ship logical pivots are at the waterline near hull centre. Local forward is `-Z`, starboard is `+X`, and up is `+Y`. The render adapter applies `ship.heading` as Y rotation. In world X/Z coordinates:

```text
forward   = (-sin(heading), -cos(heading))
starboard = ( cos(heading), -sin(heading))
```

Positive Y heading turns the bow toward **port**, not starboard. Player right/D therefore commands negative rudder/yaw; player left/A commands positive rudder/yaw. AI already steers by signed angular error and uses the existing yaw convention. Do not invert AI steering to compensate for a player-input mapping error. Movement tests project actual keyboard-driven displacement onto the starting starboard vector at several headings.

Simulation advances in 1/60-second ticks. `update()` bounds accumulated input delta and limits catch-up work to 15 ticks; rendering runs through `requestAnimationFrame` with independently damped cameras and presentation animation. Version-1 normal saves use `timeScale=1`; explicit pause is a separate property. The runtime pauses and saves when hidden or leaving the page. Blocking UI clears held and queued input. Discrete released taps are buffered to the next fixed tick and cannot replay after a blocked repair/pause action.

Camera damping, presentation hit freeze and exact debug stepping are not equivalent to real-time simulation throughput. Do not infer performance from how quickly `step()` advances a saved state.

## Voyage state machine

Normal launch starts at Dawn Harbor or restores the local voyage. Three contracts each contain three legs. The public sequence is:

```text
harbor → route → encounter → navigable aftermath → collect → reward
                    ↑                                     │
                    └──────── next route / next leg ───────┘

reward or eligible route → extract → complete → harbor
final reward → full contract settlement → complete → harbor
player loss → failed → harbor
```

Aftermath remains `phase=encounter` with `encounter.completed=true`; collection is an explicit command. Disabled ships remain available for salvage/spare/sink until selected, and sinking advances on ordinary ticks. Enemy intent and pending reinforcements/volleys do not restart a resolved encounter. A player lost during aftermath still loses unbanked spoils.

Routes are generated from voyage ID, contract and leg. Saved offer records must match authored route metadata, and command execution resolves canonical terms again. Battles count surrendered required targets. Salvage uses a 12-second hold, escort 75 seconds, and storm progress records ordered approach/arch/exit crossings with the vessel beam inside each gate. Encounter target references and completion/progress relationships are validated.

Permanent upgrades cannot be offered or applied twice. Supplies repair immediately and are never stored as a permanent modifier. Ten crew members are divided among helm, guns, repair and special stations. Reallocation rescales remaining reload time by old/new gun efficiency so work already completed is preserved.

## Full local persistence

`GameSimulation.exportSave()` serializes version, seed, world state, scenario, ship runtimes, projectile pool and pending salvos, accumulator, director timers, reinforcement serial, race course/finish order and authored islands. World state includes the voyage, banked/unbanked rewards, refits, discoveries, selected ship, crew and rival history.

`GameApp` writes one `cruise.voyage.v1` local-storage value, keeping bank balance and payout ledger together. It saves periodically, at transitions/pause and on page lifecycle exit. `cruise.controls.v1` stores bindings and comfort settings separately. Explicit `?scene=...` and capture sessions bypass voyage autosave and restoration. Browser storage is local to the origin/profile; there is no cloud account synchronization or cross-version migration implementation.

Restore validates before hydration: required fields and enums, finite numbers, array/tuple structure, unique IDs, ship/runtime references, crew totals, authored route terms, objective timing, race course indices/laps and payout identities. It clones and constructs temporary state before committing, so rejected data leaves the running simulation unchanged. Manual pause survives restore.

Voyage identities are positive serials scoped to the complete world seed, including seeds with colons. Ledger serials cannot exceed the progression counter; the active voyage serial must match it. New allocation also skips existing paid IDs. Settlement records the ID once and updates bank and ledger in the same exported value. These checks prevent corrupted-state crashes and softlocks; they are not cryptographic anti-cheat for client-controlled history.

## Shared physical world

`LogicalWorld` owns the active 5×5 chunk window, generated islands/reefs/stacks, authored landmark overrides and persistent discovery IDs. The simulation and `ChunkVisuals` consume the same returned records. Chunk seeds depend on world seed and integer coordinates, not generation order. Authored encounter water excludes conflicting generated islands.

An arch produces two shore collision pylons at ±0.76×radius, each with radius 0.22×the landmark radius. Its central opening remains navigable. Scenery terraces, vegetation and buildings must respect the corresponding coast; render-only decoration must not invent obstacles in clear encounter lanes. Storm gate coordinates come from the same authored arch landmark.

CPU buoyancy sampling and GLSL ocean displacement share Gerstner wave parameters. `sampleCannonTrajectory()` and exported `cannonMuzzleHeight()` provide a common launch contract for actual projectiles, approximate aiming guidance and visible gun anchors. The guide is an estimate; camera assistance does not guarantee a hit.

The three reference specials share phase timing in `simulation/specials.ts`. Moby stores its pressure origin, radius and already-hit IDs; collision crossing compares the actual previous fixed-step position, and the rendered crest samples the water at every vertex while retaining the damage front's XZ radius. Restoring an accepted older phase normalizes duration and excludes already-resolved damage. Polar holds recovery until every actual volley muzzle clears the sampled water. `cannonVolleyCount()` and `cannonVolleyOffset()` drive both those checks and shot scheduling; delayed shots still check their live muzzle. Sunny's stern nozzle effects and wake gap follow its authoritative phase.

## Art and asset pipeline

The selected style is Cinematic Anime A. Six full downloaded models load from `public/assets/sketchfab/` through `SketchfabShipAssets`, with high/low LODs, source maps, shared source geometry and per-instance damage materials. `SketchfabCrewAssets` retains character skeletons and available animation clips; raycasts place each character on the actual source deck. The factory rejects unsupported kinds and contains no generated replacement ship path. `scripts/assets/sketchfab-runtime.json` records normalization; the public manifest records exact source and optimized hashes, creators and licenses.

The six available source kinds are Sunny, Merry, Marine, Moby Dick, Polar Tang and Baratie. Legacy simulation data still recognizes three unavailable kinds; ordinary save restoration preserves such voyages as rejected bytes before a fresh harbor starts. Current source geometry does not yet drive sail tears, broken masts or physical source-cannon recoil. Cannon anchor transforms still share authoritative ballistics; they are not proof of alignment to every sculpted cannon. Baratie's unfolded platforms also exceed the legacy beam envelope and need a dedicated collision pass.

The official intake archive contains 241 downloaded models / 2,065,915,868 bytes outside public output, including 30 of 32 tagged vehicle candidates. Remaining intake is rate-limited, not authentication-blocked. Six ships and four characters are integrated. Follow [ASSET-LICENSES.md](./ASSET-LICENSES.md) for exact coverage and current rebuild scripts; do not run historical hull-generation scripts as the asset pipeline.

Imagegen-created limestone, timber and sky PNGs remain original runtime materials. World scenery is merged by material when streamed authoritative records change. Source-derived waterline contours guide hull foam; wake vertices sample the sea independently and their strips fade by live trail extent and age. These effects remain visual approximations, not a new water physics solver.

## Rendering budgets and evidence

- Chrome/Chromium on Apple silicon is the primary target. Normal auto quality starts at at most DPR 1.5 and adapts down under pressure; capture mode pins DPR 2. Performance quality starts at DPR 1 with antialiasing/shadows disabled.
- Projectiles and short-lived effects are pooled and capped. Ship construction supplies near, medium and distant detail; world geometry uses bounded merged batches and the logical window is disposed as it moves.
- Tactical AI decisions are staggered. Camera and material work must not add unbounded per-frame scene traversal.
- `getMetrics()` reports rolling engine FPS/frame time and current render counters. Those short rolling values are diagnostic, not a sustained benchmark.
- `scripts/profile-gauntlet.mjs` launches headed Chromium with ordinary UI, warms for five seconds, and samples fifteen seconds of real RAF intervals without capture mode or manual stepping. Reports include raw frame times, percentiles, long frames, actual DPR changes, active simulation evidence, browser/GPU/OS identity, script hashes and a same-page screenshot. Its 844×390 case is desktop-GPU viewport emulation, not a mobile-device result.

`window.__CRUISE_DEBUG__.ready` is set after ship and surface assets are ready. Deterministic captures then select a scene/camera, pause and step a recorded number of ticks; they are visual fixtures. `gauntlet-ui.mjs` and `gauntlet-aim.mjs` exercise actual UI/input. `gauntlet-progression.mjs` combines real UI decisions with accelerated deterministic ticks and is explicitly not a performance sample. All browser work must close its browser when done.

Concepts under `docs/art-direction/concepts/` are generated targets. Actual screenshots, independent critic reports and receipts are under `output/overhaul-gauntlet/`. Neither a generated target nor a single screenshot proves motion quality, sustained 40–60 FPS, a successful complete combat voyage or production deployment. [README.md](./README.md) lists commands; [HANDOVER.md](./HANDOVER.md) records current acceptance and release status.
