# We Are On The Cruise — handover

Updated 2026-09-25. Checkout: `/Users/amir/Projects/WeAreOnTheCruise`. Remote: https://github.com/TheDudeCommits/WeAreOnTheCruise. Active branch: `claude/naval-survivor-overhaul`, branched from `codex/cinematic-anime-overhaul` at `9fce64e`. Vercel builds a preview for every pushed branch (project `we-are-on-the-cruise`).

## September 25 — gauntlet rounds 1–2, new production at cruise.dude.work (read first)

**Owner asks** (2026-09-24):
- faster battles;
- more enemy variety;
- more big-world events;
- speed upgrades;
- AI bots playing as other players when no live players are online;
- no darkening behind the upgrade cards;
- "run a gauntlet loop and keep iterating";
- deploy to a NEW Vercel production (keep the old one unchanged) at cruise.dude.work.

**Process.** The gauntlet loop is described in `docs/gauntlet/README.md`:
1. `scripts/gauntlet/evidence.mjs` captures shots and `report.json`;
2. critiques per domain;
3. `PLAN.md`;
4. a contract commit;
5. parallel worktree agents (`scripts/gauntlet/worktrees.sh <round> <names>`);
6. lead integration;
7. QA and deploy.

Round docs live in `docs/gauntlet/round-1/` (critiques, `ROUND.md`) and `docs/gauntlet/round-2/PLAN.md`.

### Round 1 (merged)

**PACE: faster pace and speed upgrades.**
- Ships: +17% speed, +35% acceleration, +12% turning.
- Horde: 76 ships from 12:00.
- XP: first level at about 16 s, early level gaps about 18 s, late gaps about 50 s.
- Magnet: 140 m.
- Speed upgrades: Clipper Rigging, Racing Keel, Momentum and Trade Winds; in the harbor, Copper Sheathing, Storm Sails and Rudder Chains.

**FOES: enemy variety.**
- Seven new classes: signal cutter, ironclad, harpooner, bomb ketch, smoke runner, lantern wisp and drowned galleon.
- Eight elite affixes and named bounty captains.

**EVENTS: world events.**
- Eight set pieces: Kraken, Rogue Wave, Maelstrom, Blockade, Ghost Fleet, Eruption, Sunken Treasure and Bounty Contract.
- A tracker HUD.
- Points of interest: trade-wind lanes, lighthouse beacons and salvage.

**CAPTAINS: AI captains.**
- Default 3, settable 0–4. They split the fleet's attention and appear in a roster, nameplates, a kill feed and callouts.
- `src/runtime/presence.ts`: an AI presence now; the interface for a real online mode is documented there.
- Real online play needs a realtime server. That is not built: it's an owner decision, since it is a paid service.

**Level-up screen:** no shade at all.

### Round 2 (merged)

**SEA & LIGHT.**
- Foam is aware of coverage.
- Night bioluminescence appears only in fresh foam.
- Enemies get faction rim lights and stern lanterns.
- New dusk grade; the Sovereign's contrast is fixed.

**IMPACT.**
- A smoke governor.
- The Full Broadside is a set piece: FOV kick, heel, smoke wall, gold hits and hit-stop.
- Framing by hull size: the hero is at most 18% of the frame height.
- Boss framing, and a `cinematicCamera` option.
- SDF telegraphs with colour-blind palettes.
- Damage-number declutter.

**FLOW.**
- HUD safe zones and marker merging.
- A first-voyage coach.
- Readouts: wind, in-irons, boost charges, Momentum.
- Harbor pane tabs.
- Settings in four tabs: colour-blind palette, HUD scale, key remapping, hold/toggle.
- A victory-lap guard.

**REPLAY.**
- Per-sea balance: with 3 captains, deaths run Sunward 25%, Stormwrack 42%, Gloam 50%, and bosses take 52–79 s.
- An explicit doubloon economy: about 430 per win, and about 22–32 runs to buy the whole harbor.
- 26 quests (titles, boons, pennants).
- Heat 1–8 per sea.
- A daily voyage.
- The logbook.
- Endless milestones.

**AUDIO.**
- Combat-heat music, with per-sea tracks for Stormwrack and the Gloam.
- One cue per volley.
- Reserved alert voices.
- 56 new cues.
- 29 crew barks (Higgsfield TTS, 5.9 credits).

**PERF.**
- Harbor warm-up, so shader programs stay flat during runs.
- Fleet culling and detail tiers; tree LODs.
- Shadow proxies.
- Sunlion goes from 36 materials to 6.
- Deferred boss loads.
- Every evidence shot is ≤2.5M triangles (max 2.38M) and ≤200 draw calls.

### Lead integration notes

**Contracts:**
- `focusOf`/`friendlies` targeting in `sim/targeting.ts`.
- `EnemyState.hidden`, `affixes` and `title`.
- `RunState.captains` and `worldEvent`.
- `acquirable()`: smoke hides a ship from auto-aim only.
- Captain damage goes through `captains-damage.hurtCaptain`.
- The Momentum flag skips captains' kills.
- The contact shove cap.
- Impact frames only for set pieces, with a 1.2 s cooldown.
- The decal grid is 16×16.

**Balance tools:**
- `npx tsx scripts/balance-sim.ts --seeds 3 --minutes 18 --proxy off --captains 3`, with `[--heat N] [--tune JSON]`.
- `scripts/economy-model.ts`.

**QA bridge:**
- `__CRUISE__`: `profiler`, `sceneStats`, `ocean`, `fx`, `camera` and `captains`.
- `debug.*`: `event`, `sinkBosses`, `sinkCaptain`, `teleport`, `resetCooldowns` and `chargeUltimate`.

### Production (v2)

- **Project:** a new Vercel project, `cruise-dude-work`, with the domain `cruise.dude.work`. The domain `dude.work` is on Vercel DNS.
- **Deploy:** `scripts/deploy-prod.sh` exports HEAD cleanly and runs `vercel deploy --prod`. Verify via the Vercel API.
- **Previews:** the old `we-are-on-the-cruise` project keeps building previews per branch. Its production is untouched.

### Open items

- **Owner decisions:**
  - Repaint the One Piece marks on the kept hero sails?
  - Rename the title?
  - Add a realtime server for real online captains?
- **Measurements:**
  - Take an idle-machine GPU timing (`scripts/perf/gpu-timing.mjs`) and verify the 2-minute ≤33 ms session.
  - 5 of 24 Gloam balance runs time out (low-level Dawn Ram against the Sovereign).
- **Contract wishes from round 2:**
  - SimEvents to replace AUDIO's state diffs (mark, tether, wisp latch, galleon phases, shield break, kraken grab, wave hit).
  - A `projectile-hit` weapon/manual flag.
  - Projectile owner ids.
  - Show captain titles and pennants in the run HUD and on the hero.
  - A Seawarden cannon LOD for the victory lap.

## September 24 — v2 naval survivor overhaul, integrated

The game is rebuilt as a naval survivor-like on an original world, following the user's five decisions:
1. an original world, keeping the six hero ships;
2. Meshy for ships Sketchfab lacks;
3. no boarding, only ship battles with upgrades, weapons and Mecha-Survivor-style progression;
4. desktop Chrome;
5. free Creative Commons audio.

The design bible is [docs/overhaul-v2/DESIGN.md](docs/overhaul-v2/DESIGN.md). It has world names, numbers, weapons and passives, enemies, bosses, director, meta, visual direction and budgets.

**How it was built.** A lead-owned contract commit came first: `src/game/{ids,types,constants}.ts`, `src/game/sim/context.ts`, `src/render/frame.ts`, `src/ui/contracts.ts`, `src/audio/contracts.ts` and `src/runtime/*`. Ten parallel workstreams then built against it, each on an `ovh/<name>` branch that has since been merged:

| Stream | Scope | Key paths |
|---|---|---|
| CORE | fixed-step 60 Hz deterministic sim, handling, 12 weapons, specials and ultimates, collisions | `src/game/sim/*` |
| META | enemy AI, director, bosses, cards, progression, save, balance | `src/game/sim/{ai,director,bosses,progression,weather}.ts`, `src/game/content/*`, `scripts/balance-sim.ts` |
| LOOK | renderer host, quality, post stack (ink, grade, bloom), cel materials, sky, camera | `src/render/{app,materials,npr,sky,camera}` |
| OCEAN | projected-grid sea, wakes, foam, shore surf, interaction field | `src/render/ocean`, `src/core/waves.ts` |
| SHIPS | hero ships with visible growth tiers, instanced fleets, bosses, crew | `src/render/ships`, `src/render/loaders` |
| FX | sakuga projectiles, explosions, telegraphs, pickups, damage numbers, screen juice | `src/render/fx` |
| WORLD | deterministic island field, biomes and landmarks, harbour set | `src/world`, `src/render/world` |
| UI | title, harbor, HUD, cards, chest, pause, settings, results | `src/ui`, `src/styles` |
| AUDIO | CC0/CC BY music and SFX pipeline, spatial mixer, music director | `src/audio`, `scripts/audio`, `public/audio` |
| ASSETS | fleet, props, crew and nature GLBs, icons, licence ledger | `public/assets/fleet`, `public/assets/icons`, `scripts/assets` |

Every module has a lab page at `/lab/<name>.html`.

**Integration fixes on the lead branch.**
- `EnemyState.hidden` replaced META's off-map "limbo". Wraiths now phase in place and wyrmlings dive in place.
- Contact damage now scales through META's helpers.
- Forts stay on WORLD battery sites.
- The minimap draws islands.
- Night foam no longer carpets a melee.
- Horde enemy GLBs are decimated: the fleet went from 913k to 331k triangles per pass.
- Long card text fits.
- Endless mode ("Keep Sailing" after a victory) is live.
- XP per ship scales down on harder seas.
- The ledger now includes audio and fonts.

**QA tools.**
- `node scripts/qa-play.mjs --url … --ship … --sea … --seconds 90 [--god] [--level N] [--boss id]` plays a real run and saves screenshots plus metrics.
- `window.__CRUISE__` provides `summary()` (which includes hazards), `nearest()` and `advance()`. It also has `profiler.enable/report` for a per-system CPU breakdown and `sceneStats()` for triangles per scene group. Under `debug.*` it has `spawn`, `boss`, `level`, `weapon`, `killAll`, `sinkBosses` and `chargeUltimate`.
- `npx tsx scripts/balance-sim.ts --seeds 3 --minutes 18 --proxy off` runs headless balance. Use `--minutes 18` or the Sovereign fight gets cut off.
- Keep QA browsers closed after use.
- **Frame-rate numbers are only meaningful on an idle machine.** Other sessions' captures share the GPU. Use `profiler.report()` for the CPU split. Frames stepped back-to-back through `advance()` stall on GPU back-pressure; that is not a real hitch.

**Measured on 2026-09-24, in a crowded scene with 75 enemies and a boss.**
- Real-time CPU: 3.6 ms mean, 13.9 ms max.
- About 280 draw calls.
- 2.64M triangles in total. The outline prepass redraws every outlined mesh.
- GPU time on an idle M4 has not been measured.

**Balance** (3 seeds × 2 starter ships, 18 min):
- Levels: 7.8–8.5 at 5 min, 15.7–16.7 at 10, and 24–25 at 15.
- Deaths: Sunward 1/6, Stormwrack 1/6, Gloam 3/6.
- Bosses sink in 45–160 s.
- The live horde at minute 12 is 33–45 ships, below the 60–90 target.

**Open items**
- Decide whether to rename the title: "We Are On The Cruise" is a One Piece opening lyric.
- The hero ships are still community fan-art downloads. Sunlion's provenance is medium-confidence, and White Leviathan's has not been checked yet. Replace them before any commercial use.
- Sunlion has 36 materials and needs an offline re-bake.
- The horde needs to be denser; see `DIRECTOR.minAlive` and `budgetRate`.
- Projectiles don't record which ship fired them, so hits can't be attributed to their shooter.
- Special and ultimate names live in the UI; they should move into content.
- There is no back-to-title callback.
- Crew figures are small at gameplay distance.
- A few Iron Warden armour plates stand off the hull.
- Take a clean GPU timing on an idle machine.

Everything below is the September 23 plan and the v1 history.

## September 23 AAA audit and overhaul plan

A second September 23 session audited the running game and wrote [docs/aaa-overhaul/AAA-OVERHAUL-PLAN.md](docs/aaa-overhaul/AAA-OVERHAUL-PLAN.md). No gameplay or runtime code changed. The plan contains:

- the current-state verdict, with fresh real-time engine frames (`docs/aaa-overhaul/current/`);
- the "Grand Line Cel" style rules;
- 12 **generated** paint-over targets of real engine plates (`targets/`, `compare/`, [provenance](docs/aaa-overhaul/targets/manifest.json)), which are goals, never evidence;
- ordered render, gameplay, UI, audio, asset and tech work lists;
- a phased roadmap, starting with Phase 0 quick wins and then the "One Perfect Battle" vertical slice;
- five decisions awaiting the user.

Four code audits with file:line evidence are in `docs/aaa-overhaul/audits/`.

**Key new facts:**
- Ink outlines are dead code.
- There is no post-processing or tone mapping.
- Camera shake reaches the screen at about 6%.
- The AI never leads its shots.
- Voyages field at most two hostile ships.
- Bounty resets every voyage.
- **Three of the four in-game characters show indicators of extraction from Bandai Namco games** (Luffy `44b58336`, Nami `18273524`, Whitebeard `13ebbf10`). Replace them first.

**Audit tooling notes:**
- `?hud=0` gives clean plates.
- Launch practice scenes through `[data-action="launch"]`.
- The audit's play driver and raw captures live outside the repo (`output/aaa-audit-2026-09-23/`, gitignored).
- Higgsfield image edits of 2K plates cost 2 credits (about 157 credits remain). Meshy has 1,285 credits; confirm every Meshy spend with the user.

## Session continuation and release

Start in the checkout above, then run `git status --short` and `git log -3 --oneline`. The last gameplay/asset implementation is `a851c37f98b1091aa3cee3f90d66034ac89753c1`; subsequent commits contain documentation/release records. This September 23 session found no uncommitted gameplay changes and refreshed the handover before pushing and deploying the branch again.

- Latest branch Preview: https://we-are-on-the-cruise-git-codex-c-9ea501-amirs-projects-d9680079.vercel.app (moving branch alias; use Vercel metadata to resolve its exact commit).
- Review: https://github.com/TheDudeCommits/WeAreOnTheCruise/pull/1 (draft, targeting `codex/vertical-slice`).
- Verified September 23 Preview: https://we-are-on-the-cruise-gwuw0wm4v-amirs-projects-d9680079.vercel.app, deployment `dpl_FiD7tYKMUYDMSqCEEWCMrESN9Eqb`, **READY**, commit `48629623fbc89ef8e4d3dddfcb0fd41dc78b44e6`. This subsequent verification-record commit is documentation-only; the moving branch alias resolves the newest deployment. [RELEASE.md](docs/overhaul/RELEASE.md) and its receipt preserve the immutable verified release. Do not mistake the September 7 Preview for the current release.
- Production is still https://we-are-on-the-cruise.vercel.app at baseline `ba33a1760fddebb084764a612e4ee52589337c3d`; this was re-resolved through Vercel metadata on September 23. This request deploys a Preview; it does not merge the draft PR or promote Production.
- Fresh September 23 checks: all 163 tests / nine files, TypeScript/Vite build and `git diff --check` pass; all 16 public GLB hashes match the provenance manifest. The local intake still contains 241 source archives / 2,065,915,868 bytes. JS/CSS build names are `index-JOAubjRr.js` / `index-mwMK32qf.css`.
- Browser, visual-critic and approximately 60 FPS evidence below is from September 7, not rerun in this documentation/deployment session. No browser was opened in this release refresh.

Read this file, `docs/overhaul/APPROVED-SCOPE.md`, `docs/overhaul/IMPLEMENTATION-REVIEW.md`, `ASSET-LICENSES.md`, and the final critic at `docs/overhaul/evidence/critic-assets-23.md`. The actual-engine gallery is `docs/overhaul/assets-gallery/index.html`; the older `docs/overhaul/gallery/` contains explicitly historical generated ships. Approved direction A is `docs/art-direction/approved-direction-A.png` and section targets are in `docs/art-direction/concepts/`.

## Current direction and correction

The user chose **A: cinematic anime** and requested all eight [overhaul packages](docs/overhaul/APPROVED-SCOPE.md), actual downloaded Sketchfab vehicles and crew, Blender MCP preparation, imagegen concepts, blind visual critics and 40–60 FPS. They explicitly rejected generated replacement ships. **Do not reintroduce those fallbacks or describe the current game as AAA/target-A accepted.**

The current candidate replaces the entire generated-ship factory with six complete downloaded models: Thousand Sunny, Going Merry, Marine ship, Moby Dick, Polar Tang and Baratie. Four downloaded characters supply Luffy, Nami, Sanji and Whitebeard. The Sunny/Merry each show three characters, Moby one, Baratie one; Navy/Polar have no exterior characters yet. Original source geometry/UVs are normalized, styled and optimized rather than replaced. Public high/low GLBs and crew total 21.4 MB. The old `public/assets/ships/` files and hull loader are deleted.

Authentication succeeded on September 7 using the user's supplied credential; current authentication and provider quota were not rechecked on September 23. **Do not ask for the key again or put it in any repo file/report.** There are 241 official archives / 2,065,915,868 bytes locally, including 30 of 32 tagged vehicles. On September 7, repeated provider HTTP 429 responses stopped the remaining queue. Treat that as historical provider state and check a single paced request before resuming; the downloader stops after persistent 429. There are 51 pending and eight rate-limited catalog candidates. Acquired does not mean integrated: only six ships/four characters are runtime-ready. See [asset provenance](ASSET-LICENSES.md), [catalog](assets/source/sketchfab/catalog.json) and [runtime manifest](public/assets/sketchfab/manifest.json).

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
3. Build 23 already corrected hard rectangular wake endpoints, added age fading and sampled both edges against waves. Next improve hull-connected foam, remove detached Merry bow puffs, add stronger bow/side displacement, and improve coast art and controlled anime light/shadow.
4. Match source geometry to gameplay envelopes, especially Baratie’s unfolded approximately 124 m wide platforms versus its legacy 34 m beam, and real source cannon locations. This is a known physical/visual mismatch.
5. Continue blind visual gauntlets until target-A acceptance; do not turn a passing performance measurement into art acceptance. Physical mobile/controller/audio/long-session testing and final Production promotion remain open. The latest independent visual verdict is **rejected, 5/10**, not target-A acceptance.

## Practical next-session workflow

1. Verify branch/remote and current release metadata; preserve any newer user changes. Run `npm ci` only if dependencies need restoring, then `npm test` and `npm run build`.
2. Begin with a focused visual/physics pass on the actual downloaded Merry/Sunny: hull contact, cannon positions, crew stations and consistent lighting. Address Baratie's collision mismatch before treating it as a finished combat vessel.
3. Start a local server with `npm run dev -- --port 4173`. Use `CRUISE_URL=http://127.0.0.1:4173` with the maintained gauntlet scripts and choose a new evidence directory/pass number. Freeze each candidate build before measuring; do not overwrite builds 20/22/23.
4. Inspect actual engine screenshots, obtain a new blind critic, then run sustained profiles. Keep generated concept targets separate from unedited engine evidence. Never replace a requested source ship with a generated hull to improve a score.
5. Update provenance and this handover, commit/push, and verify deployment READY/source commit through Vercel metadata and build logs. Close each browser immediately after its work and stop owned QA servers before ending.

Source archives are gitignored and **are not recoverable by cloning this repository**. Preserve `assets/source/sketchfab/<uid>/` on this machine; public optimized models, metadata and preparation scripts are committed. The Blender template currently contains the absolute checkout path and must be adjusted if the project moves. Credentials and signed provider download URLs must never enter the repository, handover, screenshots or saved full Blender scene.
