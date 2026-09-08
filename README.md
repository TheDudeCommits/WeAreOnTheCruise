# We Are On The Cruise

A browser naval adventure built with Vite, TypeScript and Three.js, inspired by One Piece and the ship combat of Assassin’s Creed IV: Black Flag. The current overhaul follows the selected **Cinematic Anime A** direction: cobalt and turquoise water, ivory sails, warm timber, cool stone shadows, sculpted clouds and restrained navy contours.

**[Existing live baseline](https://we-are-on-the-cruise.vercel.app)** — this link is not evidence that the current overhaul branch has been deployed. Consult [HANDOVER.md](./HANDOVER.md) for the checkout, release status and latest verification.

This is an unofficial, non-commercial fan project. One Piece and its characters and vessels belong to their respective rights holders. The current fleet uses six downloaded Sketchfab ships and four downloaded crew characters with recorded creator licenses. These are community fan models, not official game assets. See [ASSET-LICENSES.md](./ASSET-LICENSES.md) for source and acquisition records.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:4173`. Chrome/Chromium on Apple silicon is the primary browser and performance target.

```bash
npm test
npm run build
npm run preview
```

The dev and preview servers both use port 4173; run one at a time. Tests cover deterministic simulation, combat and voyage transitions, full-save recovery, world/collision relationships, input, aiming and ship presentation.

## Make a voyage

Choose one of six vessels and launch to Dawn Harbor. Accept **Break the Dawn Blockade**, **The Sunken Payroll**, or **Chart the Tempest**, then choose a crew build: Deadeye Broadside, Storm Interceptor or Ironheart Crew. Each contract has three legs with generated route offers, measured or dangerous water, encounter rewards and a final captain battle.

Encounters include patrol battles, a 12-second cargo hold, a 75-second escort and three ordered storm gates through the arch. Winning an objective leaves a navigable aftermath. Approach disabled enemies to salvage, spare or scuttle them; available targets remain until a choice is made. Sinking continues over time. Collect the encounter reward explicitly when ready, then choose an upgrade or supplies and continue, or extract to bank the spoils. Losing the ship forfeits unbanked coins. Banked refits, discoveries, selected vessel and rival history persist across voyages.

Ten crew members are allocated among helm, guns, repairs and special ability stations. Moving hands changes handling, reload, repairs and special charge continuously; moving them away from guns preserves the fraction of reload work already completed. Crew presets and three voyage builds have explicit advantages and costs.

Ship specials show charging, active and recovery phases. Sunny charges its stern nozzles before a burst; Polar dives and locks its batteries until all gun mounts clear the water during resurfacing; Moby sends a growing pressure front that damages each target once when it arrives. Brace against the pressure front. Polar's dive does not confer invulnerability.

The normal entry URL saves the complete versioned simulation in browser local storage and resumes it on return. Saves include active encounters, crew, damage, pending volleys, projectiles, timers, progression and the payout ledger. This is local persistence, not cloud synchronization. Free Sail & Practice in the help drawer retains the twelve exploration, battle and race scenes. Explicit `?scene=...` review URLs are isolated from voyage autosave.

## Controls

| Action | Default control |
| --- | --- |
| Raise / lower sail | `W` / `S`, or up / down arrows |
| Steer port / starboard | `A` / `D`, or left / right arrows |
| Hard turn | `Shift` while steering underway |
| Fire port / starboard broadside | `Q` / `E` |
| Fire bow weapon | `F` |
| Hold port / starboard aim | `Z` / `V` |
| Adjust lead while aiming | Mouse movement over the sea, or `,` / `.` |
| Cycle ammunition | `X` |
| Brace | `Space` |
| Repair while held | Hold `R`; the Repair crew preset also repairs automatically when not bracing |
| Ship special | `C` |
| Cycle crew preset | `T`; crew buttons also offer direct selection |
| Captain’s chart | `J` |
| Camera presets | `1`–`6`; `[` / `]` cycle, `\` resets |
| Pause / help | `Esc` / `H` |
| Mute | `M` |

Drag on the sea to orbit the camera. Aim assistance frames targets; the firing bearing and lead still determine the shot. Port, starboard and bow batteries use independent reloads. Round, chain, heavy and explosive ammunition have different trajectories and damage effects.

The Controls & Comfort drawer provides action remapping, camera shake, target framing assistance and subtitle sizing. Touch controls expose helm, weapons, brace, repair, special and aim actions; gamepads use the same named action layer. Menus and loss of focus clear held input so commands do not leak into the next interaction. Portrait and landscape viewport testing on a desktop GPU does not establish physical phone performance.

## Ships, scenery and asset provenance

Six downloaded ships are selectable: Thousand Sunny, Going Merry, Moby Dick, Polar Tang, Baratie and Navy Galleon. Blender MCP prepared their existing source geometry and materials; optimized high/low GLBs preserve the source silhouettes and maps. Four downloaded character models provide Luffy, Nami, Sanji and Whitebeard. The factory contains no generated replacement ship path. Other acquired source models remain under review. Current geometry and crew-animation limitations are recorded in the handover.

- Runtime hulls and their hash/size/triangle manifest: `public/assets/ships/`.
- Original imagegen surface and sky artwork: `public/assets/materials/`.
- Reproducible Blender authoring and optimization: `scripts/assets/`.
- Raw exports and provider catalog records, outside public output: `assets/source/`.

The requested Sketchfab search inventory exhausted 72 official API pages and recorded **1,676 unique catalog records**, including **28 ship candidates** identified from titles/tags. **Zero model bytes were downloaded**: the official model-download endpoint requires authenticated access, and that access was unavailable. Candidate geometry has not been inspected or integrated. These records are an acquisition inventory, not a claim that the requested Sketchfab collection is in the game. Attribution, offered licenses and exact status are in [ASSET-LICENSES.md](./ASSET-LICENSES.md).

The shared logical world provides authored landmarks and a bounded, seeded ocean region. The arch has two collision pylons and a clear central passage; the harbor, reefs and fort have corresponding simulation records. Rendered geography adds fractured stone, vegetation, terraces, windows, roofs and waterfalls around those records. Exploration is streamed, while voyage legs are discrete encounter transitions rather than a seamless narrative campaign.

## Rendering and audio

The ocean shader and CPU buoyancy sampler share Gerstner wave configuration. Weather changes ocean color, sky and cel lighting; wakes, bow spray, foam and impact effects accompany moving ships and combat. Ship/world materials use painted surfaces, shadow bands and directional shadows in normal quality. Selective geometry contours replace the former full-scene normal/Sobel edge pass.

The browser loads local GLBs and PNG textures at runtime. Asset readiness is included in the debug bridge’s ready signal. Near, medium and distant ship detail, merged world geometry and pooled projectiles/effects limit cost. Audio remains synthesized through Web Audio and begins after a user gesture.

Normal automatic quality starts at at most DPR 1.5 and adapts under frame pressure. `?quality=performance` starts at DPR 1 and disables antialiasing and shadows; capture mode pins DPR 2. A 40–60 FPS experience is the target, not a claim established by a concept frame or an old profile. Check the latest hardware-identified gauntlet report before quoting performance.

## Evidence and verification

[Implementation review](./docs/overhaul/IMPLEMENTATION-REVIEW.md) records the eight overhaul scopes, current verification and outstanding acceptance. [Section concepts](./docs/art-direction/SECTION-CONCEPTS.md) and `docs/art-direction/concepts/` contain generated **visual targets**, not in-game screenshots. Actual captures, critic findings and test/performance receipts live under `output/overhaul-gauntlet/`. Screenshots can establish visible quality at a moment; motion, controls, sustained frame rate and replayability need separate evidence.

Run browser harnesses against a running local server, one at a time, and close the browser after use. The gauntlet harnesses close their browser in `finally` blocks.

```bash
# Core verification
npm test
npm run build

git diff --check

# Deterministic visual captures; these pause and step simulation
node scripts/gauntlet-capture.mjs calm-sailing sunny-broadside crew-closeup
npm run capture -- sunny-broadside --all-angles

# Real UI/input and responsive-layout checks
node scripts/gauntlet-ui.mjs
node scripts/gauntlet-aim.mjs

# Voyage navigation, extraction, refit and reload with accelerated fixed ticks
# This is progression evidence, not a real-time performance test.
node scripts/gauntlet-progression.mjs
node scripts/gauntlet-full-voyage.mjs

# Trusted special inputs with paused phase captures, then a separate real RAF profile
node scripts/gauntlet-specials.mjs
node scripts/profile-specials.mjs

# Sustained real RAF performance: 5s warmup + 15s sample per case
node scripts/profile-gauntlet.mjs --dry-run
node scripts/profile-gauntlet.mjs
```

The harnesses accept `CRUISE_URL`. Output overrides include `CRUISE_CAPTURE_DIR`, `CRUISE_UI_DIR`, `CRUISE_AIM_DIR`, `CRUISE_PROGRESSION_DIR` and `CRUISE_PROFILE_DIR`. `CRUISE_PROFILE_VIEWPORTS=desktop` or `landscape` selects part of the performance matrix. Its default is five scenes at 1920×1080 and 844×390, device scale 2, normal auto quality. It records uncapped RAF intervals, percentiles, long frames, actual canvas DPR changes, simulation advancement, GPU/browser/OS identity, script hashes and screenshots. The HUD’s rolling FPS and legacy `npm run profile` output are not substitutes for this sustained receipt.

Available scene IDs:

```text
calm-sailing       storm-sailing      sunny-broadside
moby-scale         fleet-battle       damaged-ship
island-discovery   race-start         race-rough
crew-closeup       night-encounter    perf-fleet
```

`window.__CRUISE_DEBUG__` exposes readiness, scene selection, named actions, pause, exact stepping, cameras, snapshots, renderer counters and save export/restore. Use `?seed=...&scene=...&capture=1` for controlled visual review. Use ordinary URLs without capture mode for real-time profiling.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for ownership and persistence contracts and [HANDOVER.md](./HANDOVER.md) for current results and remaining work. Visual parity with the concept targets, full browser/device coverage, deeper encounter variety and authenticated Sketchfab acquisition remain acceptance work; this repository does not claim a finished AAA production.
