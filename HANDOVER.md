# We Are On The Cruise — Project Handover

Last updated: 2026-09-06

Repository: <https://github.com/TheDudeCommits/WeAreOnTheCruise>

Production: <https://we-are-on-the-cruise.vercel.app>

Working branch: `codex/vertical-slice`

## Start here

This repository contains a playable, zero-asset, cel-shaded naval adventure vertical slice built with Vite, TypeScript, and Three.js. The current implementation baseline is commit `e7c3dcc` (`Build iconic crews and living naval combat`); this handover is committed immediately after that baseline. Run `git log -1 --oneline` after cloning to see the exact handover commit.

The default experience is a living open sea populated by nine recognizable procedural ships. Captains and principal crew are visible on deck, pirate and Marine factions choose targets dynamically, and ships fight the player and one another. The project is an unofficial, non-commercial fan work and includes no copied anime models, textures, music, or logos.

## Resume in a new session

```bash
git clone https://github.com/TheDudeCommits/WeAreOnTheCruise.git
cd WeAreOnTheCruise
git switch codex/vertical-slice
npm install
npm test
npm run dev
```

Open <http://localhost:4173>. The repository uses the `codex/vertical-slice` branch; `main` is still the initial repository state and does not contain the game slice.

Before making changes, read:

1. `README.md` for controls, feature scope, capture scenes, and performance strategy.
2. `ARCHITECTURE.md` for the fixed-step simulation and presentation boundaries.
3. This file for the current state and next-session priorities.

If browser automation or Playwright is used, close the browser immediately after verification, per the project-level user instruction.

## Current playable scope

- Nine selectable procedural ships: Thousand Sunny, Going Merry, Moby Dick, Red Force, Oro Jackson, Polar Tang, Queen Mama Chanter, Baratie, and Garp's Navy galleon.
- Distinct hulls, sail plans, figureheads, superstructures, palettes, scale, handling, weapon layouts, and recognizable silhouette landmarks.
- Named captains and principal crew represented by lightweight procedural character rigs at authored deck stations.
- Multi-faction open-sea encounters with pirates, Marines, retaliation, target locks, pursuit leashes, and AI-versus-AI combat.
- Combat roles including broadside, ranged, rammer, flanker, escort, and retreat behavior.
- Round, chain, heavy, and explosive ammunition; independent broadsides; bow weapons; bracing; repair assignments; surrender; weak-point timing; combos; specials; reinforcements; and reward attribution.
- Exploration, combat, race, storm, island-discovery, night, damage, crew, and performance scenarios.
- Deterministic 60 Hz simulation, deterministic world streaming, shared CPU/GPU Gerstner waves, cel materials, ink outlines, procedural Web Audio, adaptive HUD, capture tooling, and runtime profiling.

## Recent implementation

The latest gameplay pass completed four requested areas:

### Anime-readable ships

- `src/render/ships/ShipGeometryFactory.ts` contains the procedural construction for all nine ships.
- `src/content/shipSpecs.ts` defines ship dimensions, handling, weapons, palette, and silhouette metadata.
- The Sunny includes a lion figurehead, lawn, paw anchors, Soldier Dock details, and Coup de Burst nozzles.
- The Merry has a sheep figurehead, compact caravel profile, and mikan trees.
- The Moby Dick has a massive integrated whale hull, fins, and four-mast silhouette.
- The Red Force has a continuous integrated dragon/griffin prow, Viking shields, palms, and four masts.
- The remaining ships use equally distinct submarine, cake, restaurant, dog-galleon, and pirate-flagship construction recipes.

### Captains and crews

- `src/content/crewSpecs.ts` is the canonical roster and visual-spec file.
- Crews include the Straw Hats, Whitebeard commanders, Red Hair officers, Roger Pirates, Heart Pirates, Big Mom officers, Baratie staff, and Garp's Marine group.
- Ship rendering consumes the roster to place named figures on deck at high and medium LODs.

### Living fleet simulation

- `src/simulation/factions.ts` defines faction relationships.
- `src/simulation/GameSimulation.ts` owns target selection, retaliation, combat roles, reinforcements, surrender, rewards, collisions, and damage outcomes.
- `src/content/scenarios.ts` places all nine ship kinds across eight factions in the default open sea.
- The player target is selected from active hostiles with threat priority and hysteresis; allied ships are not treated as enemies solely because they are in combat mode.
- Projectile and disabled events preserve attacker identity so AI-versus-AI action is not incorrectly presented as player damage or reward.

### Combat presentation

- `src/render/fx/NavalFxView.ts` renders cannonballs, smoke trails, muzzle flashes, impacts, water splashes, ram effects, specials, and persistent damage smoke.
- `src/runtime/eventAdapter.ts` converts authoritative events into correctly attributed presentation events.
- `src/ui/Hud.ts` and `src/ui/presentation.ts` show captain cards, intentions, weak-point windows, threat pips, hit chains, reload state, critical hits, surrender, and disabled states.
- `src/audio/AudioDirector.ts` adds directional broadsides, impacts, reload feedback, warnings, and combat layers.
- `src/runtime/GameApp.ts` coordinates camera shake, hit stop, scenario capture staging, faction selection, and presentation adapters.

## Architecture guardrails

- The serializable fixed-step simulation is authoritative. Do not put damage, rewards, racing progress, spawning, or saveable discoveries in Three.js or DOM code.
- Rendering, HUD, audio, and FX consume snapshots/events and must not mutate gameplay state.
- Keep seeded scenario and world generation deterministic. New randomness must use the project PRNG, never `Math.random()` in authoritative systems.
- Add ship gameplay data to content specs and ship visuals to the geometry factory; do not create nine unrelated runtime systems.
- Preserve bounded entity, projectile, effect, and chunk counts.
- Extend deterministic tests whenever target selection, rewards, damage, factions, or scenario composition changes.

The main flow is:

```text
input actions
    -> fixed-step GameSimulation
    -> serializable snapshots and attributed events
    -> Three.js views + DOM HUD + Web Audio
```

## Important files

| Path | Responsibility |
| --- | --- |
| `src/core/contracts.ts` | Shared serializable IDs, commands, snapshots, and events |
| `src/simulation/GameSimulation.ts` | Authoritative ship, AI, combat, racing, and scenario simulation |
| `src/simulation/factions.ts` | Diplomacy and hostility rules |
| `src/content/shipSpecs.ts` | Ship statistics and procedural blueprint data |
| `src/content/crewSpecs.ts` | Named captains, crews, colors, builds, accessories, and stations |
| `src/content/scenarios.ts` | Deterministic gameplay and capture scenarios |
| `src/render/ships/ShipGeometryFactory.ts` | Procedural ship and crew geometry |
| `src/render/fx/NavalFxView.ts` | Naval combat effects |
| `src/runtime/GameApp.ts` | Main runtime orchestration and debug bridge |
| `src/runtime/eventAdapter.ts` | Simulation-to-presentation event attribution |
| `src/ui/Hud.ts` | Runtime HUD and captain/combat presentation |
| `src/audio/AudioDirector.ts` | Procedural ambience, music, and feedback |
| `tests/determinism.test.ts` | Deterministic simulation and attribution coverage |
| `scripts/capture.mjs` | Seeded scenario screenshots and receipts |
| `scripts/capture-ships.mjs` | Nine-ship identity gallery capture |
| `scripts/profile.mjs` | High-load renderer/runtime profile |

## Controls

| Action | Input |
| --- | --- |
| Raise/lower sail | `W` / `S` |
| Steer | `A` / `D` |
| Hard turn | `Shift` |
| Fire port/starboard | `Q` / `E` |
| Fire bow weapon | `F` |
| Cycle ammunition | `X` |
| Brace | `Space` |
| Repair | `R` |
| Special | `C` |
| Camera presets | `1`–`6` |
| Pause/help | `Esc` / `H` |
| Mute | `M` |

## Verification baseline

The last completed gameplay pass was verified with:

- `npm test`: 8/8 tests passing.
- `npm run build`: passing.
- `npx tsc --noEmit --incremental false`: passing.
- `git diff --check`: clean.
- Deterministic capture receipts: no warnings.
- Keyboard and faction-selection playtests: no browser errors.
- Visual review of the nine-ship contact sheet: pass.
- Performance scenario: 60.057 FPS, 16.7 ms p50, 18.5 ms p95, 18.7 ms p99, one long frame, eight entities, and 25 active chunks on the tested Apple-silicon configuration.

Re-run the core checks before publishing new work:

```bash
npm test
npm run build
npm run profile
```

For deterministic visual QA, run a dev server in one terminal and the capture scripts in another:

```bash
npm run dev
npm run capture
npm run capture:ships
```

The checked evidence is written under `output/`, including:

- `output/ship-gallery/all-ships-contact-sheet.png`
- `output/captures-final/fleet-battle.png`
- `output/captures-final/sunny-broadside.png`
- `output/captures-final/calm-sailing.png`
- `output/perf/perf-fleet.json`

Generated output may be ignored by Git; regenerate it when visual or performance behavior changes.

## Deployment

The Git remote is:

```text
origin  https://github.com/TheDudeCommits/WeAreOnTheCruise.git
```

The project is linked to Vercel and the stable production alias is:

```text
https://we-are-on-the-cruise.vercel.app
```

After tests and build pass, deploy the current checkout with:

```bash
npx vercel deploy --prod -y
```

Do not fetch or `curl` the deployed URL as a post-deploy check; use the deployment command's ready state and returned production alias. If a later task explicitly requests browser verification, close the browser as soon as the verification is finished.

## Known limitations

- This is a polished browser vertical slice, not a seamless authored open-world campaign.
- Ship and character likenesses are stylized procedural approximations, not imported anime assets.
- Boarding resolution, island interiors, persistent progression/save migration, accessibility remapping, crew choreography, finishing sequences, and weather variety remain production opportunities.
- The largest production JavaScript chunk is above Vite's default 500 kB warning threshold; this is currently a warning, not a build failure. Route-level or subsystem code splitting is a sensible future optimization.
- High-DPR capture mode is intentionally heavier than the normal adaptive-performance runtime.
- `main` has not yet been merged with `codex/vertical-slice`.

## Recommended next session

1. Pull and confirm `codex/vertical-slice` is clean, then run tests and build.
2. Decide whether to merge the vertical slice into `main` or continue feature work on a new `codex/` branch.
3. Turn the current scenario menu into a light campaign flow: ports, voyage contracts, persistent bounty/reputation, encounter spawning, and saved discoveries.
4. Add authored ship-specific special sequences and clearer telegraphs for enemy specials.
5. Deepen crew gameplay with station assignment, visible reactions, injuries, and boarding preparation while keeping the simulation authoritative.
6. Expand island interaction and port services without weakening deterministic world generation.
7. Add accessibility settings and remappable controls.
8. Split heavy rendering/content modules if bundle size or startup profiling shows a material benefit.

## Definition of done for future changes

A future slice should not be handed off until:

- Authoritative behavior has deterministic test coverage.
- `npm test` and `npm run build` pass.
- Representative scenarios have been captured and visually inspected.
- The performance profile remains bounded and warnings are explained.
- Browser automation has been closed after use.
- The branch is clean, committed, pushed, and the production deployment reports `READY` when production deployment was requested.
