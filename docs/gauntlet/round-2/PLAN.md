# Round 2 plan

Source: `docs/gauntlet/round-1/PLAN-draft.md` plus the round-1 critiques, the integration notes in `round-1/ROUND.md`, and what the merged build shows. The combined game is fast and dense but visually noisy and too generous. Round 2 makes it read cleanly, feel heavy, teach itself, and give reasons to come back.

## Lead contract (landed before the streams)
- **MetaProfile:** `seenHints`, `quests`, `heat`, `history` (`RunSummary[]`), `daily`.
- **Settings:** `coach`, `colorBlind`, `hudScale`, `cinematicCamera`.
- **SimOptions:** `heat`, `daily`.
- **`src/game/meta/goals.ts`:** `nextGoals()` stub.
- **`src/ui/screens/harborPanes.ts`:** registry of harbor tabs.
- **`src/render/app/warmup.ts`:** stub, called once when the harbor first shows.
- **Bridge:** `debug.teleport`, `debug.resetCooldowns`.

## Owner decisions
- **Taken by the lead:**
  - The level-up screen has zero darkening.
  - The horizon-band camera ships as an option (`cinematicCamera`), off by default.
  - The starting pool is not reduced; nothing already unlocked is taken away. New content unlocks through quests.
  - Crew barks may use up to 10 Higgsfield credits.
- **Still open:** repainting the One Piece marks on the kept hero sails.

## Streams (exclusive file ownership)
1. **SEA & LIGHT.**
   - **Owns:**
     - `src/render/ocean/**`
     - `src/render/sky/**`
     - `src/render/app/grading.ts`
     - `src/render/materials/**`
     - `src/render/npr/**`
     - `src/render/ships/materials.ts`
     - a new `src/render/ships/fleet/Lanterns.ts`, mounted with one line in ShipSystem
   - **Work:**
     - foam coverage awareness;
     - Gloam night crest pattern;
     - enemy readability at night and in storms: faction rim light and stern lanterns;
     - dusk grade;
     - glints;
     - Sovereign contrast.
2. **IMPACT.**
   - **Owns:**
     - `src/render/camera/**`
     - `src/render/fx/**`, except `WorldEventFx.ts` and `world-events/**`, where only smoke and flash tuning is allowed
     - `src/render/ships/hero/HeroShip.ts` (visual heel)
   - **Work:**
     - smoke rules: coverage cap, never over the hero or a boss, erosion;
     - Full Broadside as a set piece;
     - framing by hull size;
     - `cinematicCamera` horizon band;
     - SDF circle telegraphs with the colour-blind palette;
     - Lionburst flash;
     - damage-number declutter;
     - harbor showcase framed by the bounding box;
     - captain damage smoke (the StateFx ship path).
3. **FLOW.**
   - **Owns:**
     - `src/ui/**`, except `src/ui/replay/**`
     - `src/styles/**`, except `src/styles/replay.css`
     - `src/input/Input.ts`
   - **Work:**
     - the victory-lap guard;
     - first-voyage coach (`seenHints`, the `coach` setting);
     - HUD declutter: markers versus the skill bar, the roster and tracker layout, elite nameplates, and an off-screen world-event arrow;
     - wind indicator;
     - boost-charge and Momentum display;
     - shipwright layout;
     - harbor pane tabs from the registry;
     - accessibility: colour-blind setting, HUD scale, key remap.
4. **REPLAY.**
   - **Owns:**
     - `src/game/meta/**`
     - `src/game/content/rewards.ts`
     - the `DIRECTOR` tuning block and the economy in `src/game/content/director.ts`
     - heat, economy and quest hooks in `src/game/sim/{progression,director}.ts`
     - `scripts/balance-sim.ts`
     - `src/ui/replay/**` panes and `src/styles/replay.css`
     - run options in `src/runtime/GameApp.ts`
   - **Work:**
     - the real balance and economy pass for the merged game with 3 captains;
     - quests (20–30) with unlock rewards;
     - heat levels 1–8 per sea;
     - daily voyage;
     - logbook/history;
     - endless milestones;
     - `nextGoals`.
5. **AUDIO.**
   - **Owns:** `src/audio/**`, `scripts/audio/**`, `public/audio/**`.
   - **Work:**
     - music intensity from combat heat;
     - one cue per volley (cannon voice budget);
     - an alert category with reserved voices;
     - loudness targets;
     - per-sea music variety;
     - cues for FOES, EVENTS and PACE (harpoon, wisp, whirlpool drone, rogue-wave roar, momentum swell, boost gust, shield shatter);
     - crew barks with Higgsfield TTS, capped at 10 credits.
6. **PERF.**
   - **Owns:**
     - `src/render/app/{RendererHost,PostStack,quality,warmup}.ts`
     - `src/render/loaders/**`
     - `src/render/ships/fleet/{EnemyFleet,Bosses,Captains,captainHulls}.ts` (LODs)
     - `src/render/world/**` (shadow casters, LOD)
     - `public/assets/**` re-bakes
     - build config
   - **Work:**
     - shader and asset warm-up in the harbor;
     - horde and menu triangle budget: fleet LOD, island shadow casters, ink prepass cost;
     - Sunlion material re-bake;
     - deferred boss loads;
     - texture compression if cheap;
     - a GPU timing method on an idle machine.

## Acceptance
- `scripts/gauntlet/evidence.mjs` shows no S1 from round 1.
- Balance with 3 captains:
  - some deaths on Sunward and more on Stormwrack and the Gloam;
  - bosses sink in 45–120 s;
  - doubloons land in the band REPLAY sets.
- Triangles stay ≤2.5M in `boss-*` and `late` shots.
- No page errors.
