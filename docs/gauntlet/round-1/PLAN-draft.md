# Round 2 plan (draft from the round-1 critic)

This draft turns the round-1 critiques in this folder into six parallel streams for round 2. It excludes everything the four round-1 streams already own:

| Round-1 stream | Scope |
|---|---|
| PACE | XP rhythm, density, handling, speed upgrades |
| FOES | enemy classes, elite affixes, bounty captains |
| EVENTS | world events, tracker, POIs |
| CAPTAINS | AI captains |

Round 2 starts from the lead branch **after** those four merge. The lead edits this into `PLAN.md`.

## Goal of round 2

Make the game read and flow like a finished game:
- clean water;
- a framed boss;
- a broadside you feel;
- a first run that teaches itself;
- a win that ends properly;
- a reason to play run 6.

Every S1 from round 1 is closed or has an owner decision attached.

## Before the streams start

### Owner decisions

Ask these with one question each:

1. **Hero-sail marks.** Repaint the Straw Hat Jolly Roger (Dawn Ram, Sunlion) and the "MARINE" lettering (Seawarden) with the game's own heraldry, keeping the downloaded geometry? This comes from visuals #2. It is separate from the still-open title rename.
2. **Camera.** Add a horizon band: a lower pitch when the sea is quiet, easing back to tactical in a melee. Should this be the default, or a "Cinematic" option? From visuals #6.
3. **Level-up screen.** Remove the remaining edge vignette entirely (zero darkening)? From ui-ux #5.
4. **Starting pool.** Start new profiles with 6 of the 12 weapons and 8 of the 16 passives, and unlock the rest through quests? This changes a veteran's first run after the update. From content #1.
5. **Crew barks.** Spend Higgsfield speech-TTS credits on 20–30 generic crew barks? The owner must confirm the amount. From audio #5.

### Lead contract commit

This is one commit, landed before any stream branches.

**Types** (`src/game/types.ts`):
- On `MetaProfile`:
  - `seenHints: string[]`;
  - `quests: Record<string, { progress: number; done: boolean }>`;
  - `heat: Partial<Record<SeaId, number>>`, the highest heat cleared;
  - `history: RunSummary[]`, capped at 20.
- On `Settings`:
  - `bindings?`;
  - `colorBlind?: 'off' | 'deutan' | 'protan' | 'tritan'`;
  - `hudScale?`;
  - `coach?: boolean`.
- A `RunOptions` passed to `Sim` with `heat` and `daily`.

**Meta API stub:** `src/game/meta/goals.ts`, with `nextGoals(profile): Goal[]`. REPLAY implements it and FLOW renders it.

**Harbor pane registry:** a `HarborPane` interface in `src/ui/contracts.ts` (`id`, `label`, `el`, `update(frame)`, `onKey`). FLOW wires it into `HarborScreen`. REPLAY ships its panes as new files.

**Bridge** (`src/runtime/debugBridge.ts`):
- `debug.teleport(x, z)` and `debug.resetCooldowns()`. The Sim already has both.
- `oceanFoamCoverage(radiusM)`, via `RenderServices.ocean`.
- `goals()`.

**Warm-up hook:** GameApp calls `warmup(app)` from a new `src/render/app/warmup.ts` (owned by PERF) while the harbor is showing.

## Streams

File ownership is exclusive. A stream may read anything, but writes only its own files.

### 1. SEA & LIGHT: water, light and night readability

**Owns:**
- `src/render/ocean/**`
- `src/render/sky/**`
- `src/render/app/grading.ts`
- `src/render/ships/materials.ts`
- `src/render/ships/fleet/{EnemyFleet,Bosses}.ts` (materials, rim and lanterns only)
- `src/render/ships/emblems.ts`
- `src/render/loaders/SketchfabShipAssets.ts` (sail overrides at load)
- `public/assets/sketchfab/thumbnails/**`

**Closes:**
- visuals #1 (foam carpet, shader and stamp side);
- visuals #3 (night hordes);
- visuals #4 (Gloam noise);
- visuals #5 (magenta dusk);
- visuals #8 (glints);
- visuals #9 (pale Sovereign);
- visuals #2 (sail marks), if the owner says yes.

**Work, in order:**
1. **Foam coverage.**
   - Implement `foamCoverage(radius)`.
   - Make persistent deposits coverage-aware: strength × (1 − coverage).
   - Saturated foam renders as turquoise aeration plus lace, never a flat white slab.
2. **Gloam night crest foam.**
   - Height-keyed threshold, with wind-aligned strokes.
   - Coverage ≤10% of water pixels.
   - Bioluminescence only in fresh wakes and on impact.
3. **Enemy readability at night and in storms.**
   - A faction rim light on each enemy.
   - One instanced stern lantern per enemy: Admiralty gold, Corsair red, Wraith teal.
   - Night exposure +0.3 EV.
   - Bioluminescence capped below the rim brightness.
4. **Dusk grade.**
   - At steep pitch, tint the water from the haze and horizon colours.
   - Add a sun-glitter path.
   - Keep hero exposure ≥0.9 from 17.6 to 19.9 h.
5. **Glints.** Anti-alias with `fwidth`, fade with distance and pitch, and cluster into the glitter path.
6. **Sovereign contrast.** Admiralty colours on the Sovereign's materials.
7. **Owner-gated sail overrides.**
   - Canvas-paint the crew emblem and the Admiralty crest over the measured sail UV rectangles.
   - Regenerate the ship-card and poster thumbnails.

**Acceptance** (checked with `evidence.mjs`):
- `oceanFoamCoverage(150)` ≤15% in `sunward-mid` and every `boss-*` shot.
- The Gloam mid and late plates show no pattern covering more than 10% of the water.
- A blind count of enemies in `stormwrack-late` is within ±20% of `sim.enemies`.
- The owner reviews all `-plate` shots against targets T1 and T4.

### 2. IMPACT: camera and combat FX

**Owns:**
- `src/render/camera/**`
- `src/render/fx/**`
- `src/render/ships/hero/HeroShip.ts` (visual volley heel only)

**Closes:**
- combat-feel #1 (boss framing), #2 (broadside weight), #3 (big hulls), #5 (circle telegraphs), #6 (Lionburst washout), #7 (number confetti);
- visuals #6 (horizon band), if the owner says yes;
- visuals #7 (smoke occlusion);
- visuals #10 (harbor crop);
- visuals #1 (foam decals, FX side).

**Work, in order:**
1. **Boss-aware framing.**
   - Weighted midpoint: 0.6 player, 0.4 boss.
   - Distance `max(base, separation × 1.1 + boss length)`, pitch −4°.
   - A 1.2 s arrival beat.
2. **Smoke rules.**
   - Fade with screen coverage past 6%.
   - Erode over 1.2 s.
   - Never opaque over the hero or a boss hull.
3. **Foam decals** (`Sakuga.foam` and friends).
   - Alpha ≤0.6, ring or lace when overlapping, life ≤1.2 s.
   - No decal on enemy spawn (`EventFx.ts:153`).
4. **Full Broadside as a set piece.**
   - FOV kick 5–6°, shake 0.25.
   - 60–80 ms hit-stop when 3 or more balls hit.
   - A drifting smoke wall, and gold hit rings with a plank burst.
   - Auto-volley gets a 1–1.5° heel impulse only.
5. **Framing by hull size.** Distance scales with `(length − 40) × 1.8` plus the mast height. The hero is ≤18% of the frame height.
6. **Horizon band** (owner-gated). 32–36° pitch when fewer than about 8 enemies are within 250 m.
7. **Circle telegraphs.** Flat SDF rings above the wave maximum, with an ink edge and a timer sweep.
8. **Small fixes.**
   - Lionburst flash ≤3 frames.
   - Hit numbers below 3% of maximum hull hidden, unless crit or kill.
   - Harbor showcase framed by the bounding box.

**Acceptance:**
- In every `boss-*` shot, the boss hull is on screen and covers ≥6% of the frame. Measured with a new evidence projection check: bounding box to screen.
- Each hero ship is ≤18% of frame height in its early shot.
- The owner blind-compares a 3 s manual-broadside clip with an auto-fire clip.

### 3. FLOW: UI/UX, onboarding and accessibility

**Owns:**
- `src/ui/**`, except REPLAY's new pane files
- `src/styles/**`, except `src/styles/meta.css`
- `src/input/Input.ts` (binding table, granted by the lead)

**Closes:**
- ui-ux #1 (victory buttons), #3 (onboarding), #4 (shipwright), #5 (vignette), #6 (chest text), #7 (accessibility), #8–#12;
- combat-feel #4 (the wind indicator);
- the UI guard for ui-ux #2.

**Work, in order:**
1. **Results layout.**
   - The log scrolls or collapses the unlock chips.
   - The buttons live in a footer that is always visible.
2. **Victory-lap guard.** The cards modal never opens after `run-ended`.
3. **Shipwright layout.**
   - Compact 3-column tiles, or a scroll container with fade masks.
   - The key legend never overlaps content.
4. **Harbor pane registry.** Implement the interface from the contract commit.
5. **First-voyage coach** (`src/ui/hud/Coach.ts`).
   - Contextual prompts over the first 2 minutes: sail, auto-fire, Full Broadside, brace and parry, wind.
   - One-time explainers for the first branch and OVERDRIVE cards.
   - `seenHints` persistence.
   - A Settings toggle.
6. **Wind indicator.**
   - An arrow on the minimap rim.
   - An in-irons state on the ship ring.
7. **Accessibility.**
   - Keyboard and pad remapping, with conflict detection.
   - A colour-blind telegraph palette plus a hatch pattern.
   - HUD scale from 80% to 120%.
   - A hold/toggle choice for broadside and brace.
8. **Polish.**
   - Chest cards auto-size.
   - The chip header shows one decimal and "/s".
   - The seas lock ribbon moves to the art column.
   - The speed readout becomes a gear plus bar, or plausible knots.
   - Toasts sit next to the skill bar and are deduplicated for 60 s.
   - A "Next" strip on results, from `nextGoals()`.
   - "NEW" badges in the harbor.
   - Level-up vignette removed, if the owner says yes.

**Acceptance:**
- `layout.clipped` and `layout.covered` are empty on every shot at 1600×900 **and** 1280×720. This needs a new evidence `--viewport` flag.
- `checks.levelupDarkening`: every region ratio ≥0.92, if the owner chose zero darkening.
- A new player (the owner, or a fresh profile run by the coach script) fires a Full Broadside and a brace within the first 90 s.

### 4. REPLAY: meta, quests, heat and the victory fix

**Owns:**
- `src/game/content/**`
- `src/game/meta/**`
- `src/game/sim/{progression,director,bosses,meta-cards,meta-runtime,meta-spawn}.ts`
- new files: `src/ui/screens/panes/{Quests,Heat,History}.ts`, `src/styles/meta.css`

**Closes:**
- ui-ux #2 (the victory-lap stall);
- content #1 (unlock track), #2 (sea identity), #3 (heat), #4 (synergies), #5 (endless goals), #6 (daily and history).

**Work, in order:**
1. **The victory-lap fix.** The final boss's XP becomes bounty and doubloons; no level-ups are queued.
2. **Quest board.**
   - 40 quests to start, each unlocking content: weapons, passives, relic slot, ship mastery.
   - A reduced starting pool, if the owner says yes.
3. **Heat 1–8 per sea.**
   - One stacked rule per level, using FOES affixes.
   - A bounty multiplier.
   - The best heat shown on the poster.
4. **Sea identity.**
   - One signature rule per sea: Stormwrack surfable rogue-wave cadence, and a Gloam lantern-range limit.
   - One boss variant per sea (Storm Warden, Drowned Sovereign), as data plus behaviour.
   - SEA & LIGHT recolours the visuals via materials.
5. **Synergies.** 6 weapon-and-passive synergy cards, plus the codex data.
6. **Endless milestones.** Every 5:00, and endless as an entry in the seas pane.
7. **Daily voyage and history.**
   - A date-seeded daily voyage.
   - A run history of the last 20 runs.
   - `nextGoals()`.

**Acceptance:**
- `rerun-victory` → `checks.victoryLapStatus.status` is `victory`, never `levelup`.
- `npx tsx scripts/balance-sim.ts --seeds 3 --minutes 18 --proxy off` still passes at heat 0.
- Heat 3 is winnable by the balance proxy in at least 1 of 3 seeds.
- Save migration: an old profile loads, and its unlocks are preserved (tests in `tests/`).

### 5. AUDIO: mix, music and alerts

**Owns:** `src/audio/**`, `public/audio/**`, `scripts/audio/**`, and the `public/audio/CREDITS.md` ledger.

**Closes:** audio #1–#7.

**Work, in order:**
1. **Music intensity.**
   - Count the player's volleys, damage and kills.
   - Threshold 0.25 for the first 3 minutes.
   - Calm plays only in real lulls.
2. **Volley consolidation.**
   - One layered sample per side per volley.
   - `chain-rattle` and `sail-rip` once per volley.
   - Auto-fire −3 dB under the Full Broadside.
3. **`alert` category.**
   - 2 reserved voices at priority 95, covering `warning`, `mortar-whistle` and `boss-horn`.
   - A −3 dB, 250 ms SFX duck on near telegraphs.
4. **Loudness.**
   - About −16 LUFS integrated in combat and about −20 in menus.
   - A limiter ceiling of −1 dBTP.
   - Bus gains compensate for the defaults in `save.ts`.
5. **Per-sea calm and combat variants** for Stormwrack and the Gloam (CC0 or CC-BY, ledgered), and a percussion stem for the horde layer.
6. **Ambience beds.** Stream beds over 10 s.
7. **Barks** (owner-gated): a priority queue plus 20–30 lines.

**Acceptance:** `session-probe.mjs` on the same seed shows:
- calm→combat ≤20 s after the first kill;
- `cannon-near` ≤40 plays per minute at level 10;
- rate drops more than halved;
- `alert` cues with 0 steals;
- RMS p50 between −18 and −16 dBFS in the run.

### 6. PERF: budgets, compiles and load

**Owns:**
- `src/render/app/{PostStack,RendererHost,quality}.ts`
- `src/render/app/post/**`
- `src/render/app/warmup.ts` (new)
- `src/render/npr/**`
- `src/render/world/**` (shadow flags and LOD only)
- `src/render/loaders/FleetAssets.ts`
- `src/render/ships/ShipSystem.ts` (boss preload deferral)
- `scripts/assets/**`

**Closes:** performance #1–#3 and #5. Performance #4 (decoded audio) belongs to AUDIO.

**Work, in order:**
1. **Warm-up.**
   - Compile every weapon prop, FX material, enemy class, boss and weather or night variant during the harbor.
   - `compileAsync` with the post targets bound.
2. **Triangle budget.**
   - Islands receive shadows but don't cast them, or cast from 10% proxies.
   - The hero uses its low LOD in the shadow pass.
   - The ink prepass skips islands beyond 250 m and uses LOD1.
3. **Boss loads.** Defer from boot to idle after the first run frame, or to 4:00.
4. **Textures.** A KTX2/Basis pipeline in `scripts/assets` for the fleet and bosses, and shared LOD textures for the fleet.
5. **`world` spike.** Budget `WorldVisuals` rebuilds at 0.5 ms per frame.
6. **GPU timing.** A clean run on an idle machine with the owner's say-so: headed Chrome, `EXT_disjoint_timer_query`, 5 s warm-up plus 15 s per case.

**Acceptance** (from `report.json`):
- The program count is constant from `harbor-fleet` onward.
- `over33ms` is 0 in every window.
- Rendered triangles are ≤1.6M on menus and ≤2.2M in the worst run shot.
- Less than 6 MB is transferred before the first sail.
- Time-to-ready is ≤3 s on a throttled 20 Mbps profile. This needs a new evidence `--throttle` flag.

## Merge order and conflicts

The recommended merge order is:
1. PERF: warm-up and budgets touch the render host; merge first.
2. SEA & LIGHT.
3. IMPACT.
4. AUDIO.
5. REPLAY.
6. FLOW: it consumes `nextGoals()` and the panes.

Watch these points:
- **Foam:** SEA & LIGHT (shader and stamps) and IMPACT (decals) share the foam goal but no files. Both are judged against the same `oceanFoamCoverage` number.
- **Bosses:** REPLAY's boss variants need SEA & LIGHT materials. Land the data first behind a flag, then the visuals.
- **Settings:** REPLAY owns `save.ts`. FLOW's new settings fields go through the contract types, and REPLAY adds their defaults and migration.

## Critic tooling for round-2 evidence (critic branch)

- **`evidence.mjs` flags:**
  - `--viewport 1280x720`;
  - `--throttle 20mbps` (CDP network emulation);
  - cooldown-aware `special` and `ultimate` shots, which wait for `skills.*.cooldown == 0`. This needs the bridge `resetCooldowns`.
- **New evidence metrics:**
  - `oceanFoamCoverage`;
  - water hue histogram, to check dusk magenta;
  - boss on-screen share, from a projected bounding box;
  - per-shot `layout` checks, which already exist.
- **Stages for round-1 content:**
  - a new-enemy gallery (FOES);
  - one shot per world event (EVENTS);
  - captains' nameplates and roster (CAPTAINS).
- **Probe re-runs:** re-run `session-probe.mjs` on the three starter combinations after PACE, as the new pacing baseline.

## Deferred, or not in round 2

These are owned by round 1:
- XP curve, density, handling, magnet (PACE);
- new enemies and affixes (FOES);
- world events and POIs (EVENTS);
- AI captains (CAPTAINS).

These wait for later rounds:
- The title rename (owner).
- Hero-model provenance replacement (owner, before any commercial use).
- A new boss art pipeline and new boss models (Meshy is owner-gated).
- Mobile (not a target).
