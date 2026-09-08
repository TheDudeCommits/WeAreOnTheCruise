# We Are On The Cruise — handover

Updated 2026-09-07. Actual checkout: `/Users/amir/Projects/WeAreOnTheCruise`; `/Users/amir/Codex-ThreeJS` is unrelated. Remote: https://github.com/TheDudeCommits/WeAreOnTheCruise. Branch: `codex/cinematic-anime-overhaul`, based on `codex/vertical-slice` at `ba33a1760fddebb084764a612e4ee52589337c3d`.

## Current direction and correction

The user chose **A: cinematic anime** and requested all eight [overhaul packages](docs/overhaul/APPROVED-SCOPE.md), actual downloaded Sketchfab vehicles and crew, Blender MCP preparation, imagegen concepts, blind visual critics and 40–60 FPS. They explicitly rejected generated replacement ships. **Do not reintroduce those fallbacks or describe the current game as AAA/target-A accepted.**

The current candidate replaces the entire generated-ship factory with six complete downloaded models: Thousand Sunny, Going Merry, Marine ship, Moby Dick, Polar Tang and Baratie. Four downloaded characters supply Luffy, Nami, Sanji and Whitebeard. The Sunny/Merry each show three characters, Moby one, Baratie one; Navy/Polar have no exterior characters yet. Original source geometry/UVs are normalized, styled and optimized rather than replaced. Public high/low GLBs and crew total 21.4 MB. The old `public/assets/ships/` files and hull loader are deleted.

Authentication succeeded using the user's supplied credential. **Do not ask for the key again or put it in any repo file/report.** There are 241 official archives / 2,065,915,868 bytes locally, including 30 of 32 tagged vehicles. Repeated provider HTTP 429 responses stopped the remaining queue. There are 51 pending and eight rate-limited catalog candidates. Acquired does not mean integrated: only six ships/four characters are runtime-ready. See [asset provenance](ASSET-LICENSES.md), [catalog](assets/source/sketchfab/catalog.json) and [runtime manifest](public/assets/sketchfab/manifest.json).

Read [current implementation review](docs/overhaul/IMPLEMENTATION-REVIEW.md) for builds 22/23 evidence, limitations and the next art work. [Release record](docs/overhaul/RELEASE.md) is authoritative for the exact Preview and commit. Production at https://we-are-on-the-cruise.vercel.app remains separate; do not infer a promotion from a local build or READY Preview.

## Runtime

Vite, TypeScript and Three.js, with an authoritative fixed-step simulation and DOM HUD. `npm ci`, `npm test`, `npm run build`, `npm run dev`.

- Entry: six actual-asset ship choices, real source thumbnails, async preloading before selection/launch, visible load errors, keyboard/touch controls, remapping, pause-safe menus, contracts/builds/routes and reload continuity.
- Presentation: full source models with high/low LODs, retained maps, toon lighting, per-instance damage tint and weather exposure. Downloaded character skeletons and available animations are retained; deck placement raycasts the actual source mesh. Source crew are currently idle/combat poses, not a complete station-work animation system. The old procedural sail tear, mast break and gun-recoil geometry is not applied to these source models.
- Ocean/world: shared CPU/GPU Gerstner waves, sampled hull contact, derived source waterline contours, wakes/bow spray, weather profiles and generated original sky/wood/limestone textures. Dawn Harbor, Sky Arch, Razor Reef and Sunwatch Fort share authoritative shore/collision data. Their environment art remains below the target.
- Combat: side-aware target/lead, shared trajectory equations, staggered gun queues, per-gun events, independent battery state, pooled impacts, authoritative damage and disabled/sinking states. Cannon anchors remain simulation transforms; aligning every muzzle to the sculpted source cannon still needs work.
- Crew gameplay: ten hands and five presets alter helm, reload, repair and special charge. Moving hands preserves reload work. This tactical pool is separate from the four integrated visual character assets.
- Specials: Sunny committed stern jets; Polar physical dive now targets 34 m to clear the downloaded model’s 27.2 m periscope, with guns locked until physical surfacing clears their sampled mounts; Moby pressure front advances to 135 m and damages actual crossings once. Their target art is generated concept work; engine captures remain separate.
- Replay: three contracts, three legs, two route choices per leg, five encounter types, three builds, six temporary upgrades, three harbor refits, extraction risk, banked coins and rivals. The old build-15 full-voyage proof remains historical evidence; current asset replacement needs longer play acceptance.

## Save and coordinate contracts

Forward is `(-sin(heading), 0, -cos(heading))`; positive heading turns port/left. Keep `LogicalWorld` authoritative for visible/collidable coast. Simulation owns hits, damage, route gates, rewards, wave hit ledgers and saveable state; presentation consumes it. Preserve bounded entities/effects and avoid per-frame material construction or full-scene traversal.

`cruise.voyage.v1` stores a full voyage and progression atomically; `cruise.controls.v1` stores controls. Invalid saved bytes are preserved under the recovery key before a fresh autosave. If recovery storage fails, protect the primary save. **A legacy voyage containing an unavailable Red Force/Oro Jackson/Queen Mama Chanter is preserved as rejected data and starts at a fresh harbor; it cannot currently resume.** Do not silently substitute another named ship. Historical simulation types still include those three for data compatibility.

Polar recovery may hold beyond its nominal timer while buoyancy finishes. Do not clear it by elapsed time alone. Moby front origin/radius/hit IDs remain authoritative and persistent. Capture mode, debug selection and accelerated `step()` are staging tools, never FPS or ordinary human-play evidence.

## Tools and verification

The user requires every automated browser closed immediately after use. Browser harnesses use `finally`. Preserve unrelated Blender scenes (including the quarry and another task's Podracing content); do not save the complete authenticated Blender scene. Coordinate any sustained GPU/Blender window with concurrent work before measuring performance.

- `scripts/gauntlet-sketchfab.mjs`: six source-model captures, mesh/source readiness and actual downloaded crew deck contacts.
- `scripts/gauntlet-ui.mjs`: actual six-choice selection, launch, contracts/routes, crew, pause, remap and reload at desktop and phone viewports.
- `scripts/gauntlet-specials.mjs`: actual selection/launch/key inputs, deterministic phase screenshots and physical surfacing/weapon checks.
- `scripts/profile-gauntlet.mjs`: headed Chromium, 5 s warm-up and 15 s real RAF per case; records GPU, script hash, DPR, long frames and actual simulation advance.
- `scripts/profile-specials.mjs`: real-RAF special profiles with phase distributions.
- Existing aim/progression/full-voyage scripts preserve real input and earned-reward rules. Historical passes do not automatically verify the new assets.

Run `npm test`, `npm run build`, `git diff --check`, then focused browser checks on an immutable copy of `dist/`. Do not overwrite an evidence server's build. Apple M4 phone viewport emulation is not physical mobile acceptance. Keep the exact current receipts and candid independent critic verdict in the implementation review.

## Remaining work

1. Resume missing official downloads only after provider cooldown, finish geometry review and use additional appropriate vehicles as explicit named variants/encounters. Do not call the 241 archives all ships or all integrated assets.
2. Unify source material finish, animated sail/damage/cannon structure and working crew. Preserve actual downloaded geometry; no invented replacement vessels.
3. Replace the conspicuous straight wake ribbon with dissipating curved turbulence and stronger bow/side water displacement; improve coast art and controlled anime light/shadow.
4. Match source geometry to gameplay envelopes, especially Baratie’s unfolded approximately 124 m wide platforms versus its legacy 34 m beam, and real source cannon locations. This is a known physical/visual mismatch.
5. Continue blind visual gauntlets until target-A acceptance; do not turn a passing performance measurement into art acceptance. Physical mobile/controller/audio/long-session testing and final Production promotion remain open.
