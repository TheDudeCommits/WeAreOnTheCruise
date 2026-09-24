# Round 1 critique: UI and UX

**Build and evidence:** as in `critique-combat-feel.md`. `R1/` is `output/gauntlet/round-1/`.

The layout numbers come from the evidence tool's new check (`report.json → shots[].layout`). It lists every visible button that is clipped by the viewport or covered at its centre by another element.

**Bar:**
- Vampire Survivors, Brotato and Halls of Torment for flow: a new player sails within 10 seconds and every screen's next action is obvious.
- AC4 for naval HUD clarity.

## Verdict

The art direction of the UI is strong: brush type, WANTED posters, manga stamps, a clear harbor, and a good pause card (`R1/31-pause.jpg`). The flow has three first-impression breakers:

- **The winning screen has no visible buttons.**
- **The win itself stalls behind four card picks.**
- **There is no onboarding at all,** for a game with eleven inputs.

The shipwright tab overflows now that round 1 added three upgrades.

The level-up screen no longer blacks out the battle, which the owner asked for. A residual edge vignette remains.

## Issues, ranked

### 1. [S1] The victory results screen hides all three buttons

**Evidence:**
- On the victory results (`R1/rerun-victory/01-results-victory.jpg`, re-verified in `R1/rerun-layout/report.json`), the layout check puts all three buttons at the bottom edge of a 900 px viewport:

  | Button | Position |
  |---|---|
  | Return to Harbor | `[620, 895, 321×62]` |
  | Keep Sailing | `[961, 895, 203×62]` |
  | Sail Again | `[1176, 891, 262×70]` |

- Five unlock chips push the log panel past the fold. `.cr-results__right` is absolutely positioned between `top: 60u` and `bottom: 40u`, and the buttons use `margin-top: auto` inside it (`src/styles/results.css:15,49`).
- **"Keep Sailing" (endless mode) is only reachable from this screen, so endless is effectively hidden.**

**Fix:**
- Give the log a `max-height` with `overflow: auto`. Or collapse the unlocks into one row with "+N more".
- Move the buttons into a footer that is always visible.
- **Acceptance:** `layout.clipped` is empty on every `results-*` shot at 1600×900 and at 1280×720.

**Owner:** UI (`src/styles/results.css`, `src/ui/screens/ResultsScreen.ts`).

### 2. [S1] The victory lap stalls behind 4 level-up picks

**Evidence:**
- Sinking the Sovereign grants 400 XP (`src/game/content/bosses.ts:28`: sovereign `xp: 400`) through `grantXp` inside the final-boss branch (`src/game/sim/progression.ts:450-456`).
- This queues 4 level-ups (22→26). The run sits in `status: levelup` with the Sovereign at 0%.
- The "VICTORY — The flagship is going down…" banner is covered by the LEVEL UP title (`R1/30-victory-lap.jpg`).
- The results only appear after 4 cards are picked (`R1/rerun-victory/report.json → checks.victoryLapStatus = { status: 'levelup', level: 26, cardsPicked: 4 }`).
- The capture script originally timed out waiting for the results screen for exactly this reason.

**Fix:**
- In the final-boss branch, convert the boss XP into bounty or doubloons instead of level-ups.
- Or grant the XP without queueing offers (`pendingLevelUps` untouched), and suppress the cards modal during the victory lap.

**Owner:** META (`src/game/sim/progression.ts`). UI (`src/ui/modals/CardsModal.ts`) only if a guard is needed.

### 3. [S1] No onboarding for eleven inputs

**Evidence:**
- A new player sees "Press any key", then the harbor, then the sea.
- The controls exist only under Pause → Controls, as a read-only table of 11 actions (`src/ui/modals/PauseMenu.ts:19-31`):
  - sail gears (W/S);
  - rudder;
  - mouse aim;
  - Full Broadside (LMB/Q);
  - special (E);
  - ultimate (R);
  - boost (Shift);
  - brace, where an early brace is a parry (Space);
  - cards (1–4 and X);
  - orbit and zoom;
  - pause.
- A search for tutorial, onboarding, first-run or coach code in `src/` finds nothing.
- Nothing ever explains any of these:
  - that guns fire on their own and you aim by turning;
  - what half sail does;
  - the wind (combat-feel #4);
  - parry timing;
  - weapon branches at level 3;
  - OVERDRIVE at level 6.
- Vampire Survivors needs no tutorial because it has one input. This game has eleven.
- The only in-run hint is the "<ultimate> ready — press R" toast (`src/ui/hud/Hud.ts:108`).

**Fix:** a first-voyage coach module.
- **Contextual prompts during the first 2 minutes:**
  - after 3 s: "W: raise sail";
  - when the first enemy is in range: "Your guns fire by themselves — turn your side to them";
  - when the first Full Broadside is ready: "Q / Left-click: full broadside toward the cursor";
  - on the first mortar circle: "Space: brace — just before impact = parry".
- **One-time explainers** on the first branch card and the first OVERDRIVE card.
- **Persistence:** a `seenHints` set stored in the profile.
- Turning it off in Settings.

**Owner:**
- UI: a new `src/ui/hud/Coach.ts`, and `src/ui/hud/Banners.ts`.
- Lead contract: `MetaProfile.seenHints` in `src/game/types.ts` and `src/game/meta/save.ts`.

### 4. [S2] The shipwright tab overflows; the last upgrades are unreachable by mouse

**Evidence:**
- 13 upgrade tiles no longer fit (`R1/03-harbor-shipwright.jpg`). The last row (Copper Sheathing, Storm Sails) runs under the key legend and past the viewport.
- The layout check puts the Copper Sheathing buy button at y = 943 in a 900 px viewport (`R1/rerun-layout/report.json → shots[2].layout.clipped`).
- The cause is CSS:
  - `.cr-pane--shipwright` is a flex column with no overflow handling (`src/styles/harbor.css:285-288`);
  - it sits inside a panel that ends 66u above the bottom (`harbor.css:94`).
- Round 1 added 3 upgrades; PACE designs their content, but the layout belongs to UI.

**Fix:**
- Use compact 3-column tiles, or make the pane a scroll container with fade masks and wheel/pad scrolling.
- The key legend must never overlap interactive content.

**Owner:** UI (`src/styles/harbor.css`, `src/ui/screens/HarborScreen.ts`).

### 5. [S2] Level-up darkening: fixed, but a vignette remains (the owner's request)

**Evidence:**
- `f27839f` replaced the blackout. The shade used to run from 45% alpha at the centre to 86% at the edges; it is now transparent to 42% of the radius, then reaches 34% at the edges (`src/styles/modals.css:9`).
- The battle stays visible behind the cards (`R1/21-levelup.jpg`; compare the pre-level-up frame `R1/20-levelup-pre.jpg`).
- Measured luma ratios, during level-up versus the frame before (`report.json → checks.levelupDarkening`):

  | Region | Ratio |
  |---|---|
  | Corners | 0.66–0.87 |
  | Left middle | 0.87 |
  | Right middle | 0.99 |

  So the edges are still 13–34% darker. The sea keeps moving between frames, which adds about ±5% noise.
- A rotating speed-line burst at 6% also streaks the sea.

**Fix:** if the owner wants **no** darkening:
- remove the edge shade;
- keep a soft backplate only behind the card row;
- drop the burst to ≤4% or remove it.
- **Acceptance:** every region ratio ≥0.92.

**Owner:** UI (`src/styles/modals.css`).

### 6. [S2] Chest reward text spills out of its cards

**Evidence:** in `R1/24-chest.jpg`, the Lance of Dawn OVERDRIVE card's text runs below the card onto the HUD skill bar. Cards 1–2 cut off "+3.8% range." (also `R1/quick/08-chest.jpg`). The level-up row grows with its text since `8f4ccaa`; the chest row does not.

**Fix:** apply the same auto-height and the step-down font rule to the chest row. Cap it at 4 lines with a "more" tooltip.

**Owner:** UI (`src/ui/modals/CardsModal.ts`, `src/styles/modals.css` / `components.css`).

### 7. [S2] Accessibility gaps

**Evidence:**
- Settings has 9 rows: three volumes, mute, shake, reduce flashing, damage numbers, quality and FPS (`src/ui/modals/SettingsPanel.ts:26-35`).
- There is:
  - no key or pad remapping (the Controls page is read-only);
  - no colour-blind option, although danger is red and friendly arcs are green or teal;
  - no HUD or text scale;
  - no hold/toggle choice for broadside or brace.

**Fix:**
- Remapping with conflict detection, keyboard and pad.
- A colour-blind telegraph palette: red becomes magenta, plus a hatch pattern.
- HUD scale from 80% to 120%.
- A hold/toggle choice.

**Owner:** UI (`src/ui/modals/SettingsPanel.ts`). The lead owns the binding table in `src/input/Input.ts` and the `Settings` type.

### 8. [S3] The stat chip reads "+0% REPAIR"

**Evidence:** Caulking Crew shows the header "+0% REPAIR" above "Repair 0.1% hull per second" (`R1/quick/05-levelup.jpg`). `CardsModal.ts:60` rounds 0.001 to 0%.

**Fix:** use one decimal below 1%, and add the "/s" unit for regen.

**Owner:** UI (`src/ui/modals/CardsModal.ts`).

### 9. [S3] The seas tab lock label sits on top of the description

**Evidence:** "SURVIVE 10:00 ON ANY SEA" and "WIN A RUN (DEFEAT THE SOVEREIGN)" are laid over each locked sea's description text, and both become hard to read (`R1/02-harbor-seas.jpg`, `src/styles/harbor.css:272-277`).

**Fix:** put the lock ribbon in the art column and keep the description readable. Players want to know what they are unlocking.

**Owner:** UI (`src/styles/harbor.css`).

### 10. [S3] Speeds read as 52–59 knots

**Evidence:**
- The ship card shows Dawn Ram at "52 KN" (`R1/01-harbor-fleet.jpg`).
- The HUD reaches "59 KN" (`R1/12-stormwrack-late.jpg`).
- These come from m/s × 1.944 (`src/ui/hud/ShipRing.ts:158`, `src/ui/screens/shipStats.ts:12`).
- A caravel at 52 knots reads wrong to anyone who sails. The same point was flagged in the September 23 audit.

**Fix:** show the sail gear plus a speed bar, or scale to plausible knots (about ÷3). Use the same fix in both places.

**Owner:** UI.

### 11. [S3] Toasts land in the middle of the battlefield and repeat

**Evidence:** "Tidal Colossus ready — press R" appears at about y = 370 on the right side, over the play space, and again after each use (`R1/16-the-mid.jpg`, `R1/19-…`, `R1/30-…`). The toasts are anchored at `top: 356u` in `src/styles/hud.css:207`.

**Fix:** anchor toasts above the skill bar, next to the R slot. Drop repeats of the same toast within 60 s.

**Owner:** UI (`src/styles/hud.css`, `src/ui/hud/Banners.ts`).

### 12. [S3] Results and harbor don't point to the next goal

**Evidence:**
- The results screen lists unlocks, but not progress toward the next one (`R1/33-results-defeat.jpg`). Examples: "Yellowfin: 308/450 ◈", "Stormwrack: survive 10:00".
- Back in the harbor, nothing highlights what is new (`R1/34-harbor-after.jpg`).

**Fix:**
- Add a "Next" strip on results: the two closest unlocks, with progress bars.
- Add "NEW" badges on harbor cards until they are viewed.

**Owner:** UI (`src/ui/screens/{ResultsScreen,HarborScreen}.ts`).

## Level-up verification (owner request)

- **Verified:** there is no blackout. The battle is visible behind the cards (`R1/21-levelup.jpg`).
- **Still there:** an edge vignette of 13–34%, and a faint speed-line burst.
- If the owner wants literally no darkening, issue #5 lists the one-file fix.
