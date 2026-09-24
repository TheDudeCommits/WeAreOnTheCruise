# Round 1 critique: content and replayability

**Build and evidence:** as in `critique-combat-feel.md`. The numbers come from:
- the content tables: `src/game/content/{world,ships,bosses,rewards,weapons,passives,director}.ts`;
- the meta save: `src/game/meta/save.ts`;
- a cost dump run through `npx tsx`;
- the victory and defeat captures, `R1/rerun-victory/01-results-victory.jpg` and `R1/33-results-defeat.jpg`.

**Round-1 coverage:**
- FOES is adding 7 enemy classes, elite affixes and bounty captains.
- EVENTS is adding about 8 world events, a tracker and points of interest.
- CAPTAINS is adding AI captains.
- PACE is retuning XP, density and handling, and adding speed upgrades.

These are not repeated here. Items marked *(after merge)* need a re-check once those streams land.

**Bar:**
- **Vampire Survivors:** 70+ unlockables gated by in-run feats, weapon evolutions, stages with distinct rules, Arcanas and a "new thing almost every run" cadence.
- **Brotato:** 40+ characters that change the rules, and Danger 0–5.
- **Halls of Torment:** hundreds of quests, a wellspring and per-character traits.
- **Hades:** heat and pacts.

## Verdict

One run is a good 15 minutes:
- 12 weapons, each with an A/B branch at level 3 and an OVERDRIVE at level 6;
- 16 passives and stat chips;
- chests;
- three bosses.

After that the meta runs out fast:
- One win unlocks White Leviathan, Stormwrack and the Gloam in a single results screen.
- The two paid ships cost 1,550 doubloons in total.
- After about 3–5 runs, the only progress left is 13 flat +% upgrades worth 17,990 doubloons, roughly 40–60 more runs of number-grinding.
- There are 5 achievements, no quests, no difficulty ladder and no daily voyage.
- The three seas share one boss trio on one schedule.

Endless mode exists, but its button is off-screen (ui-ux #1).

## Issues, ranked

### 1. [S1] The unlock tree is exhausted in about 3–5 runs; after that there is only flat-stat grinding

**Evidence:**
- **Unlocks** (`src/game/content/ships.ts:14-49`, `world.ts:4-28`):
  - ships: 2 at the start, 2 for doubloons (Yellowfin 450, Grand Galley 1,100), 2 for achievements (the Iron Warden, and a win);
  - seas: survive 10:00, and win once.
- The first victory produced five unlock chips at once: two achievements, White Leviathan, Stormwrack and the Gloam (`R1/rerun-victory/01-results-victory.jpg`).
- A victory banks about 300 doubloons (+308 in the capture). That is 100 victory bonus + 200 for the Sovereign + 4 per minute in wages, plus drops.
- **Meta shop:** 13 upgrades, all flat (+6% hull, +5% damage, +4% speed…), 17,990 doubloons in total (`src/game/content/world.ts:37-52`):

  | Upgrade | Ranks | Total cost (◈) | Last rank (◈) |
  |---|---|---|---|
  | Powder | 8 | 4,195 | 1,610 |
  | Hull | 8 | 2,795 | 1,075 |

- **Achievements:** 5 in total (`src/game/meta/save.ts:13-21`).
- **Nothing gates weapons or passives.** All 12 weapons are in the card pool from run one, so there is nothing new to discover in the cards after the first few runs.

**Fix:** a long unlock track with discovery.
- **A quest board** with 40–60 quests, for example:
  - "Sink 50 ships with Tide Mines";
  - "Win with Dawn Ram";
  - "Reach OVERDRIVE on 3 weapons in one voyage";
  - "Parry 20 volleys".

  Each quest unlocks content, not just stats.
- **Start the pool small.** Start with 6 of the 12 weapons and 8 of the 16 passives, and unlock the rest through quests.
- **Per-ship mastery** (win and reach heat 3): alternate specials and cosmetic sails or flags.
- **A relic slot** that opens after the first win.

**Owner:**
- META: `src/game/content/*` plus a new `src/game/content/quests.ts`, `src/game/meta/save.ts`, and the offer pool in `src/game/sim/progression.ts` / `meta-cards.ts`.
- UI: a new harbor tab.

### 2. [S2] The three seas are palette swaps of one structure

**Evidence:**
- Every sea runs the same 15:00 script, with the Iron Warden at 5:00, the Tidewyrm at 10:00 and the Sovereign at 15:00 (`src/game/content/world.ts:8,15,23`).
- Every sea uses the same spawn bands, filtered by faction (`src/game/content/director.ts:28-39`).
- What does differ:
  - difficulty (1, 1.3, 1.55);
  - weather and time of day;
  - the Gloam's wraith faction;
  - the event mix (`SEA_EVENTS`).
- Music is identical too (audio #4).
- EVENTS is adding set pieces. *(After merge)*, re-check whether each sea now has one signature rule.

**Fix:**
- **Per-sea boss variants:**
  - Stormwrack: a storm-charged Iron Warden that calls lightning on its line of battle;
  - the Gloam: a drowned Sovereign that phases like the wraiths.
  - At least one new boss per sea over the next two rounds.
- **One sea rule each:**
  - Stormwrack: a rogue-wave cadence you can surf;
  - the Gloam: target acquisition capped at 180 m outside lantern light.
- **A per-sea card-pool bias.**

**Owner:**
- META: `src/game/content/{world,bosses,director}.ts`, `src/game/sim/bosses.ts`, taken after PACE and EVENTS merge.
- SHIPS: boss visual variants in `src/render/ships/fleet/Bosses.ts`.

### 3. [S2] No difficulty ladder after the first win

**Evidence:** the only knob is choosing a harder sea. There are no heat, danger or curse levels. The WANTED poster records best bounty and longest voyage per ship, but nothing about difficulty (`R1/34-harbor-after.jpg`).

**Fix:** Heat 1–8 per sea, unlocked by winning the previous level.
- Each level stacks one rule: +enemy HP, faster enemy fire, elite affixes (from FOES), one less reroll, bosses one phase harder.
- Bounty gets a multiplier per level.
- Show the best heat per ship on the poster.

**Owner:** META (`src/game/content/director.ts` heat hooks, `src/game/meta/save.ts`) and UI (seas tab, poster).

### 4. [S2] Builds have depth but no synergies

**Evidence:**
- The card pool is 12 weapons (each with A/B branches and an OVERDRIVE ★), 16 passives and stat chips.
- There are no cross-item combinations: no evolutions (weapon plus passive, as in Vampire Survivors) and no set bonuses.
- Loadouts from the capture read as lists of independent guns (`report.json → checks.*-late-loadout`). An example: `broadside:6A★, maelstrom-charm:4A, storm-rod:4A, rocket-rack:5A, swivel-guns:3A, iron-ram:1`.

**Fix:**
- Add 6–8 synergies, each unlocking a special card. Examples:
  - Storm Rod + Tide Mines → charged mines;
  - Fire Barrels + Maelstrom Charm → a fire whirl;
  - Harpoon + Iron Ram → a reel-in ram.
- Show them as locked silhouettes in a codex, so players hunt for them.

**Owner:** META and CORE (`src/game/content/weapons.ts`, `src/game/sim/meta-cards.ts`, `src/game/sim/progression.ts`, weapon behaviour in `src/game/sim/weapons/*`).

### 5. [S2] Endless mode is hidden and has no goals

**Evidence:**
- "Keep Sailing" appears only on the victory results screen, where it is clipped off-screen (ui-ux #1; `R1/rerun-layout/report.json`).
- Once in endless mode, bosses loop every 300 s with +75% HP per loop (`src/game/content/director.ts:85,104`: `bossHpScale`, `endlessBossGap`). There are no milestones and no record.

**Fix:**
- Endless milestones every 5:00, each with a bounty tier and a doubloon chest.
- A best-endless record on the poster.
- An "Endless" entry on the seas tab after a win.

**Owner:** META and UI.

### 6. [S3] No daily voyage, run history or codex

**Evidence:** none of these exist in `src/`. A seed parameter already exists (`?seed=`, `src/runtime/AppConfig.ts`).

**Fix:**
- A daily voyage with a date-based seed, a fixed ship and sea, and a local best.
- A history of the last 20 runs: ship, sea, time, level, bounty and loadout.
- A codex of enemies, bosses, weapons and synergies, filled in as they are met.

**Owner:** META (`src/game/meta/save.ts`) and UI.

## Baseline for PACE (round 1; re-measure after merge)

- The probe reached only level 4 by 2:02 and level 5 by 6:09 of sim time, including the boss jump (`R1/session-sunlion/session.json → pacing`).
- Kills ran at 29–31 per minute.
- The pilot collected 69 coins against 112 kills: coins dropped at broadside range are left behind.

## What works (keep)

- A/B branches with an OVERDRIVE ★ per weapon.
- Boss chests that can force an OVERDRIVE (`R1/24-chest.jpg`: Lance of Dawn).
- A WANTED poster per ship with best bounty and longest voyage.
- Clear unlock chips on results.
- Reroll and banish meta upgrades.
- The endless loop exists and scales.
