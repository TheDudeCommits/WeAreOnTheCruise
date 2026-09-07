# We Are On The Cruise — overhaul handover

Updated: 2026-09-07. Repository: [TheDudeCommits/WeAreOnTheCruise](https://github.com/TheDudeCommits/WeAreOnTheCruise).

## Start here

Working branch: `codex/cinematic-anime-overhaul`, based on `codex/vertical-slice` at `ba33a1760fddebb084764a612e4ee52589337c3d`. The actual checkout is `/Users/amir/Projects/WeAreOnTheCruise`; `/Users/amir/Codex-ThreeJS` is an unrelated checkout. This is a Vite/TypeScript/Three.js game, with a fixed-step authoritative simulation and a DOM interface.

The user accepted all eight overhaul recommendations and chose **A: theatrical cinematic anime**. The gameplay overhaul and several art iterations are implemented. **Visual concept parity and the requested Sketchfab asset acquisition are not complete.** Do not describe this as AAA-ready or all requested assets downloaded. The exact original numbering is preserved in [approved scope](docs/overhaul/APPROVED-SCOPE.md). Read [implementation review](docs/overhaul/IMPLEMENTATION-REVIEW.md) and [comparison gallery](docs/overhaul/gallery/index.html) for candidate evidence and gaps.

The current immutable candidate is build 15: 168 maintained tests and all 165 special behavior checks pass; UI 27/27, aim 92/92, two earned extraction/refit runs, full-voyage 10/10, nine ordinary scene captures and six special profiles also pass their recorded checks. All ten ordinary sustained benchmark cases are valid at 59.992–60.008 average FPS, with an 18.8 ms worst frame and zero frames over 25 ms; adaptive DPR and exact render sizes are recorded in the review. Build 15 aligns CREW INSIDE with the real exterior shelter state and widens the bow battery label; scene art and mechanics are unchanged from build 14. Six final build 15 special profiles average 59.982–60.001 FPS on Apple M4 at adaptive DPR 1.35–1.5, with an 18.8 ms worst frame and zero frames over 25 ms in the sampled windows. Historical build 13 specials averaged 49.846–60 FPS on Apple M4, with a 133.9 ms worst frame and 85 frames over 25 ms, and its special visuals were rejected at 3/10. Do not claim that source optimizations or passing mechanics checks close those gaps.

The existing Production alias is [we-are-on-the-cruise.vercel.app](https://we-are-on-the-cruise.vercel.app). It was not promoted as part of the local implementation passes. Exact branch release status belongs in [RELEASE.md](docs/overhaul/RELEASE.md); never infer that the alias runs this branch.

## Resume

```sh
git switch codex/cinematic-anime-overhaul
npm ci
npm test
npm run build
npm run dev
```

Read `README.md`, `ARCHITECTURE.md`, `ASSET-LICENSES.md`, this file, and the implementation review. Close every browser immediately after automation, per the user's instruction. Preserve unrelated Blender content and keep telemetry disabled. Do not store authentication tokens in source, reports, or chat.

## Implemented behavior

1. **Launch and continuity:** nine selectable vessels, focused keyboard selection, contract/build/route choices, pause-safe input, remapping, touch controls, crew orders, loading and WebGL fallback states. A normal launch opens the harbor chart. Active voyages restore to a paused chart.
2. **Ships:** eight original Blender-authored GLB hulls, procedural Polar Tang, rebuilt Sunny and Marine structures, sails/rigging/gun ports/decks/crew. Hull import supports a procedural fallback. Sail emblems follow exact cloth topology, both faces, and damage deformation. These are not Sketchfab downloads.
3. **Sea and atmosphere:** shared CPU/GPU Gerstner field, near/far ocean meshes, painted water, shoreline/contact foam, connected wakes/bow spray, original generated sky/wood/limestone textures, weather palettes, shadows, and bounded rendering batches.
4. **Combat:** side-aware targeting, shared ballistic equations for guide and actual shots, mouse/keyboard/gamepad lead, rail aiming, selected-target locator, staggered gun queues, per-gun muzzle events, camera/reload/weak-point cues, pooled effects. The trajectory guide estimates still-water landing; moving waves and targets mean it is not a hit guarantee.
5. **Damage and aftermath:** sail deformation, hull breaches, fire, list, disabled vessels, explicit salvage/spare/sink decisions, navigable aftermath until the captain collects. Sinking and escape states persist. Damage and queued projectiles survive reload.
6. **Crew:** ten hands allocated among helm/guns/repair/special with five presets and real handling/reload/repair/special tradeoffs. Reassignment preserves reload work, preventing free instant volleys. Visible crew remain procedural rigs, not final character assets.
7. **Reference specials:** Sunny has a committed stern charge, aft jets and wake break; Polar physically dives toward 17 m and holds recovery until every scheduled cannon muzzle clears its sampled waterline; Moby launches a surface-following front out to 135 m, with damage only at actual front crossings and a persistent once-only hit ledger. The special meter and weapon cards report commitment and surfacing. Build 15 passes 165 phase/weapon checks, with an additional cinematic Moby view at the exact same paused instant as its overhead capture. Its stronger Sunny jets, raised Moby crest, surface-relative Polar camera, corrected deck contact and exterior crew shelter state respond to the rejected build 13 visuals. Build 15 special profiles pass the measured frame-time envelope on this host, with actual adaptive render sizes disclosed in the review. The fresh build 14 special-image review scores 4.5/10 and rejects target parity; its art judgment still applies to build 15’s unchanged scene art. The special board is generated target art.
8. **World:** Dawn Harbor, Sky Arch, Razor Reef, and Sunwatch Fort share simulation-owned collision records with the renderer. Villages, towers, palms, stone ledges and waterfalls provide authored landmarks; the remaining environment still needs substantial art work.
9. **Replay loop (additional replayability work):** three contracts, three legs, two routes per leg, five encounter types, three builds, six temporary voyage upgrades, three permanent harbor refits, extraction risk, banked coins and rival history. Full versioned local saves are validated transactionally, including canonical routes, payouts, identities, gates, projectiles and runtime state.

This remains an unofficial fan project. Music and audio are procedural; bespoke performances, orchestral layers and final mixes are not provided by the visual overhaul.

## Asset acquisition is blocked

The two requested Sketchfab searches were cataloged through the official public API: **72 pages, 1,676 unique records, 28 relevant ship/vehicle candidates plus one figurehead**. Principal crew candidates are also tagged. Actual model downloads require authentication: the official download endpoint returns HTTP 401, and the connected Blender Sketchfab integration is disabled. **Downloaded model files: zero.** Hunyuan3D and Hyper3D integrations were also checked and are disabled.

The user has already been asked to enable Sketchfab in the Blender MCP panel or unlock the Mac and sign in. No answer was available during these passes. Do not repeat the question unnecessarily. Once enabled, use the official downloader, retain each asset's creator/license/source, inspect geometry, normalize units/pivots, retopologize and LOD, restyle materials, and verify performance. Never extract the viewer's protected delivery assets.

Catalog: `assets/source/sketchfab/catalog.json`. Tools: `scripts/assets/catalog-sketchfab.py`, `download-sketchfab.py`, `build-anime-hulls.py`, `optimize-hulls.py`. Provenance and generated artwork hashes: `ASSET-LICENSES.md`. The original hull authoring is reproducible; Blender's safe mode blocked saving a `.blend`, so source Python and raw GLBs are retained.

## Guardrails and coordinates

- The simulation owns damage, routes, gates, collisions, rewards, saveable state and deterministic random generation. Views consume snapshots/events.
- Forward is `(-sin(heading), 0, -cos(heading))`. Positive Y heading turns port/left; right input applies negative yaw. Do not reintroduce the former player-helm inversion.
- Keep `LogicalWorld` authoritative for visible/collidable coast. Never add a separate procedural island field in presentation.
- Preserve bounded entities, projectiles, effects and batches; avoid per-frame material construction or full-scene traversal.
- `cruise.voyage.v1` saves full voyage and progression atomically. `cruise.controls.v1` stores control preferences. Save failure is surfaced in the HUD. Restore rejects malformed state without partially applying it. Fractional frame accumulation is clamped after fixed ticks; exact rejected save bytes are quarantined under `cruise.voyage.recovery.v1` before fresh autosaves. If storage cannot preserve them, saves are blocked to protect the primary record.
- Polar active/recovery locks all guns. Recovery elapsed may clamp at its duration while buoyancy finishes surfacing; do not clear it by elapsed time alone or replace actual volley mount positions with a center proxy. Moby wave origin/radius/hit IDs are authoritative and saveable; retain actual pre-motion/collision target positions for crossing detection.
- `?scene=...` is a scenario/debug entry, not a proof of ordinary contract completion. Capture mode and accelerated `step()` are never FPS benchmarks.

## Verification and capture

Core checks are `npm test`, `npm run build`, and `git diff --check`. Maintained tests are explicitly `tests/**/*.test.ts`; historical critic probes in `output/` deliberately test rejected conditions and must not be silently added to the maintained suite.

The gauntlet uses immutable copies of `dist/` with bundle SHA-256 manifests. Do not rebuild into an evidence server's directory. Scripts close browsers in `finally`:

- `scripts/gauntlet-capture.mjs`: deterministic image/state receipts, including working repairs; **not performance**.
- `scripts/gauntlet-ui.mjs`: ordinary launch/route/crew/pause/remap/reload on desktop and both phone orientations.
- `scripts/gauntlet-aim.mjs`: real keyboard, mouse and CDP multitouch, both batteries, actual queued lead/projectile/marker identity and release behavior; no state injection or stepping.
- `scripts/gauntlet-progression.mjs`: real UI plus accelerated normal helm inputs, earned salvage/reward/extraction/refit/reload; no fabricated rewards; **not performance**.
- `scripts/gauntlet-full-voyage.mjs`: actual UI contract and route choices plus accelerated legal helm/fire inputs, three earned legs, payout once and exact reload; **not performance**.
- `scripts/gauntlet-specials.mjs`: actual vessel selection and special action, phase/weapon checks and staged Sunny/Polar/Moby screenshots; **not performance**.
- `scripts/profile-specials.mjs`: normal quality, 3 s warm-up and 6.5 s real RAF per reference special and viewport, including phase distributions and long frames. No capture mode, stepping or injected charge.
- `scripts/profile-gauntlet.mjs`: headed Chromium, 5 s warm-up and 15 s uncapped real RAF samples per case; no capture mode or stepping. Records hardware, bundle hash, resolution, DPR, simulation advance, p95/p99 and long frames.
- `scripts/build-overhaul-gallery.mjs`: portable nine-section concept/engine comparisons (original eight packages plus the additional voyage loop) and copied evidence, with source hashes and explicit quality limits.

The measured host is Apple M4/ANGLE Metal. Phone viewport tests run on that desktop GPU; they are not physical iOS/Android acceptance. The 40–60 FPS objective requires sustained samples and long-frame disclosure, not the engine's short capped counter. Final exact results and historical failed-to-resolved critic findings are in the implementation review. The gallery defaults to pass/UI/aim/progression/full-voyage/special/performance datasets 15; it derives special behavior and real-RAF claims from receipts and refuses incomplete selected image sets.

## Remaining acceptance work

1. Authenticate Sketchfab and fulfill the requested asset batch; current original hulls are fallbacks.
2. Replace prototype-grade crew and remaining primitive ship/environment forms. Fresh independent visual review scored pass 10 at 4/10 against the targets. Pass 11 corrected identified phone overlaps and kept the route close control visible; it did not establish art parity.
3. Continue screenshot-led art iteration on hero geometry, working crew, detailed coast, hull/sea contact, weapon effects and lighting. The implemented special sequences still require cinematic acceptance. Build 13 special visuals scored 3/10; build 14 adds new forms/framing and compiles hidden FX during loading while removing redundant adaptive resize work. Its six special profiles show an 18.8 ms worst frame and no frames over 25 ms during sampling, while the earlier failures remain in the review. Do not infer a causal explanation or physical-device acceptance from that comparison. Keep actual engine captures distinct from generated concept targets.
4. Physical mobile aim and play acceptance remain pending. Build 15 passes 92 aim checks across desktop and both emulated phone orientations. The final independent interface review confirms legible Polar status/crew labels, while identifying crowded starboard keys, bright-jet interference, cloud-backed text and portrait interface occlusion. Keep this separate from physical-device testing. Five of six scripted legal-input simulation runs and the build 15 browser proof completed three legs; the final browser payout is 1,175 coins and 3,870,000 bounty, paid once and restored exactly; final voyage receipts are tracked in the implementation review.
5. Run physical device, controller, audio/motion comfort and longer-session performance checks. Current evidence cannot establish these.
6. Keep review deployment separate from Production promotion. Do not claim Production acceptance from a local build or Preview being READY.
