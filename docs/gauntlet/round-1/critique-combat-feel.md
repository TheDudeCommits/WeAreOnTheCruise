# Round 1 critique: combat feel

**Build under review:** lead branch at `f27839f`. The only later lead commit, `d64b57a`, is audio-only. The build was served from `/tmp/cruise-critic-dist`. The four round-1 streams (PACE, FOES, EVENTS, CAPTAINS) were still running and are **not** in this build.

**Evidence paths:**
- `R1/`: `output/gauntlet/round-1/`, the full capture and `report.json` (gitignored).
- `R1/quick/`: the quick capture.
- `R1/rerun-victory/` and `R1/rerun-layout/`: re-shoots.
- The probe: `R1/session-sunlion/session.json`. This is a 4-minute real-time run with Sunlion on Sunward Shallows, without god mode, played by the scripted pilot. After 150 s it jumped to the 5:00 boss.

The pilot is not a human, so read its kill and level numbers as a floor.

**Bar:**
- AC4 Black Flag: broadside weight, camera language, and the enemy always framed.
- Vampire Survivors and Halls of Torment: power growth that you feel every 10–20 s, and a threat that is always readable.

## Verdict

The loop is there. Guns fire on their own, you steer to bring them to bear, three skills sit on top, and cards arrive. The FX kit is richer than most survivor-likes: cel smoke, planks, speed lines, cut-ins, starburst stamps. Two things undercut it.

- **The big moments are not framed.** In every boss capture the boss is hidden under smoke, off-screen, or cropped.
- **The player's own guns have little weight.** An auto-volley is a thin tracer and a muzzle flash, with no camera response. The manual Full Broadside, which should be the AC4 moment, gets a 2.5° FOV kick and nothing else.

The opening two minutes are slow: four level-ups by 2:02. PACE owns that.

## Issues, ranked

### 1. [S1] Boss fights are not framed: the boss is hidden, cropped or invisible in every boss capture

**Evidence:**
- **Iron Warden** (`R1/22-boss-iron-warden.jpg`): the pilot closed to 142 m (`checks.boss-iron-warden-approach.minDist`). The dreadnought is not visible. One cel smoke cloud covers about a quarter of the frame, and a red skull marker reading "60 M" is the only sign of the boss.
- **Tidewyrm** (`R1/25-boss-tidewyrm.jpg`, `R1/26-boss-tidewyrm-sinking.jpg`): the serpent is not visible in either frame. It is "HUNTING", only a marker shows, and the sinking frame is two thirds explosion.
- **Sovereign** (`R1/27-boss-sovereign.jpg`): the flagship sits at 70 m. It is cropped into the lower-left corner as a pale mass of sails, and its hull is out of frame.
- **Cause:** the camera already has a framing envelope (`focusPoint` / `focusEnvelope`, `src/render/camera/CameraDirector.ts:136-143`), but no live boss drives it. Distance only follows the enemy count and the ship's length (`:135`).

**Fix:**
- Add boss-aware framing: while a boss is within 400 m, aim at a weighted midpoint (0.6 player, 0.4 boss).
- Distance should be `max(base, separation × 1.1 + boss length)`, with pitch −4°.
- Give each boss a 1.2 s arrival beat: pull out, show the name card, then settle.
- When smoke sits over a boss hull or between the camera and the boss, fade it to ≤35% opacity (see visuals #7).
- **Acceptance:** in every `boss-*` evidence shot, the boss hull is on screen and covers ≥6% of the frame.

**Owner:** `src/render/camera/CameraDirector.ts` (LOOK). The smoke fade is in `src/render/fx/Sakuga.ts` (FX).

### 2. [S2] The player's broadside has no weight; the "AC4 moment" is missing

**Evidence:**
- An auto-fired gun gets a muzzle flash and a thin tracer, and nothing else (`src/render/fx/EventFx.ts:354-361`).
- Only the manual Full Broadside gets a camera response: `juice.kick(2.5, 0.25)` (`EventFx.ts:362`). There is no shake, no hit-stop, and no smoke wall that lingers.
- In `R1/07-sunward-late.jpg` and `R1/09-sunward-ultimate-sunlion.jpg`, the level-24 ship at full broadside reads as a spray of thin orange lines. The strongest hit confirmation on screen is the damage number.
- Audio does not separate the two either (audio #2).

**Fix:**
- Keep auto-fire light, since it is constant.
- Make the **manual** Full Broadside a set piece:
  - an FOV kick of 5–6°;
  - shake 0.25;
  - a 60–80 ms hit-stop when ≥3 balls hit one target;
  - a drifting inked smoke wall along the firing side for 2–3 s;
  - a gold hit ring and a plank burst on each ship hit.
- Add a 1–1.5° visual heel impulse per auto-volley: the recoil spring already exists (`src/game/sim/player.ts:14,211`).
- **Acceptance:** a blind viewer can tell the manual volley from auto-fire in a 3-second clip.

**Owner:**
- FX: `src/render/fx/EventFx.ts` and `Sakuga.ts`.
- The heel impulse comes from CORE (`src/game/sim/player.ts`) or SHIPS (`src/render/ships/hero/HeroShip.ts`).

### 3. [S2] Big hulls hide the fight around them

**Evidence:**
- At 0:22, White Leviathan fills about 40% of the frame height and hides the water on its port side (`R1/15-the-early.jpg`). The Grand Galley's platforms fill the centre third (`R1/29-gloam-night-melee.jpg`).
- The camera adds only 0.7 m of distance per metre of hull over 40 m (`CameraDirector.ts:135`). An 84 m ship gets +31 m against a 118–172 m base.

**Fix:**
- Scale distance by `(length − 40) × 1.8` plus the mast height.
- Clamp so the hero never exceeds about 18% of frame height.
- Check this per ship with the evidence tool.

**Owner:** `src/render/camera/CameraDirector.ts` (LOOK).

### 4. [S2] Wind decides your top speed, but nothing shows the wind

**Evidence:**
- The points-of-sail polar scales top speed from 0.35 (in irons) to 1.10 (broad reach) (`src/game/sim/player.ts:35-36`).
- No HUD element references wind. A grep of `src/ui/hud/*.ts` finds only the weather-change toast (`Hud.ts:193`).
- A player turning into the wind loses about two thirds of their speed with no explanation. AC4 shows the wind on the minimap and through sail trim.

**Fix:**
- Add a wind arrow on the minimap rim.
- Add a sail-trim state on the ship ring (luffing icon plus a speed penalty tint when in irons).
- Add optional wind streaks near the hull.

**Owner:** UI (`src/ui/hud/Minimap.ts`, `ShipRing.ts`). The wind value is already in `RunState.sea.windDir`.

### 5. [S2] Circle telegraphs melt into blobs on rough water

**Evidence:**
- On the storm sea, the fire-ship/mortar danger circle renders as a warped red blob with no clear edge or timer (`R1/11-stormwrack-mid.jpg`).
- Line and lane telegraphs are crisp and readable: the Sovereign's chevron lanes (`R1/27-boss-sovereign.jpg`) and the judgment line (`R1/17-the-late.jpg`).
- Circles are drawn as decals projected onto the displaced sea (`src/render/fx/StateFx.ts:575-586`).

**Fix:**
- Draw circle telegraphs as flat SDF rings just above the local maximum wave height, with a navy ink edge and a clockwise fill sweep for the timer (the lanes already work this way).
- Keep the colour-blind option in mind (ui-ux #8).

**Owner:** FX (`src/render/fx/StateFx.ts`, `src/render/fx/passes/Decals.ts`).

### 6. [S3] Signature specials: one reads well, one washes out, two unproven

**Evidence:**
- **Lionburst** (`R1/08-sunward-special-sunlion.jpg`): the cut-in and speed lines land, but the whole frame is pale blue for the ~0.9 s window. Impact frames should last 2–3 frames.
- **Ramming Speed** (`R1/14-stormwrack-ultimate-dawn-ram.jpg`): its speed lines read well.
- **Seaquake and Tidal Colossus** (`R1/18-…`, `R1/19-…`): the special was on cooldown ("2" on the E slot) and the ultimate still showed READY, so this capture does not prove them either way. This is a tooling gap: the next round's evidence script should wait for `skills.special.cooldown == 0`.

**Fix:**
- Cap the Lionburst flash at 3 frames and keep silhouettes during it.
- Re-shoot all six specials and six ultimates with a cooldown-aware stage.

**Owner:** FX (`src/render/fx/StateFx.ts:805-826`, `Juice.ts`). The re-shoot belongs to the critic.

### 7. [S3] Damage-number confetti on swarms

**Evidence:** runs of single-digit numbers ("8" seven times) over a skiff pack (`R1/16-the-mid.jpg`). Numbers merge per target (`src/render/fx/passes/DamageNumbers.ts:4,170-186`) but not per area.

**Fix:**
- Hide a hit number below 3% of the target's maximum hull, unless it is a crit or a kill.
- Or merge numbers within 12 m.

**Owner:** FX (`DamageNumbers.ts`).

## Baseline for PACE (round 1 owns these, so they are not in the round-2 plan)

The probe measured the following:

| Measure | Value |
|---|---|
| First kill | 8.0 s |
| First level-up | 41 s |
| Level 3 | 89 s |
| Level 4 | 122 s |
| Kills per minute, minutes 1–2 | 29 and 31 |
| Live enemies, first 6 minutes | median 12, max 24 |
| Lowest hull, no god mode | 71% |
| Coins collected vs kills | 69 of 112 (the pilot never detours for loot) |

This is about half the level-up cadence of Vampire Survivors' first two minutes, with little threat. Re-run the same probe after PACE merges and compare:

```
node scripts/gauntlet/session-probe.mjs <url> <out> --ship sunlion --sea sunward-shallows --seconds 240
```

## What works (keep)

- Telegraph lanes with chevrons: the Sovereign's Broadside Storm.
- Manga stamps: "BOSS SUNK!" and "SUNK! ABANDON SHIP!".
- The cut-in banner for specials.
- The boss bar with its current attack name ("LINE OF BATTLE", "BROADSIDE STORM").
- Crits in gold.
- The kill impact frame on elites and crits.
