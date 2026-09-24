# Round 1 critique: audio

**Build and evidence:** as in `critique-combat-feel.md`.

**Primary source:** the real-time probe, `R1/session-sunlion/session.json`. It covers a 4-minute Sunlion run on Sunward with a boss jump at 150 s. The probe hooks `__CRUISE_AUDIO__`:
- it counts SimEvent types as the audio engine sees them;
- it records every router event→cue pair through the router's `note` hook;
- it logs cues requested, played and dropped, drop reasons, voices and music transitions;
- it samples the post-limiter meter at 5 Hz (1,202 samples).

The full capture (`R1/report.json → shots[].audio`) adds per-screen music state and meter readings.

**Code reviewed:**
- `src/audio/{AudioEngine,router,music,mixer,categories}.ts`
- `public/audio/manifest.json`: 105 cues, 7 music tracks, loudness per file
- `public/audio/CREDITS.md`

**Bar:**
- AC4: shanties, crew barks and cannon layers with distance tails.
- Halls of Torment and Vampire Survivors: a mix that stays readable with hundreds of hits a minute, and danger cues that always cut through.

## Verdict

The pipeline is solid. It has:
- sampled CC0 and CC-BY assets with a ledger and per-file LUFS;
- spatial voices with category caps and ducking;
- bar-synced music crossfades.

Coverage is complete. Every SimEvent type seen in the session maps to cues, except two types that are silent by design. The weak spots are musical and mix decisions:
- the "calm" track plays through the first two minutes of non-stop fighting;
- auto-fire turns into a cannon machine-gun;
- danger cues rank below gunfire;
- three 100-second combat loops carry a 15-minute run in every sea;
- the ship has no voice.

## Issues, ranked

### 1. [S2] Music ignores the player's own fighting

**Evidence:**
- Music transitions in the probe (`musicTransitions`):
  - harbor → calm at the start;
  - calm → **combat at 122 s**;
  - combat → boss at 154 s, at the boss warning.
- Over the same span:
  - the first kill came at 8 s;
  - kills ran at 29 and 31 per minute in minutes 1–2;
  - `weapon-fired` fired 680 times.
- **Cause:** `measure()` in `src/audio/music.ts` builds intensity as follows.
  - **Threat:** nearby enemies weighted by `THREAT`, where a skiff counts 0.45 and falls off from 120 m to 340 m.
  - **Activity:** enemy fire, player hits, and +0.06 per kill.
  - **Time:** a term that only counts after 2:00.
  - **Missing:** the player's own volleys and damage are not counted at all.
  - A skiff screen at 150–250 m computes to about 0.18 against the 0.34 calm→combat threshold, which also has a 14 s minimum dwell.

**Fix:**
- Feed the player's `weapon-fired` (+0.02 per gun) and damage dealt into activity.
- Lower the threshold to 0.25 for the first 3 minutes.
- Reserve `run-calm` for real lulls: no enemy within 300 m for 8 s.
- **Acceptance:** the probe shows calm→combat within 20 s of the first kill.

**Owner:** AUDIO (`src/audio/music.ts`).

### 2. [S2] Auto-fire turns the mix into a cannon machine-gun

**Evidence:** in 4 minutes, with a level-3 Chain-Shot broadside:

| Cue | Requested | Played | Dropped | Played per minute |
|---|---|---|---|---|
| `cannon-near` | 674 | 399 | 275 | 99.8 |
| `splash-small` | 472 | 338 | 134 | 84.5 |
| `chain-rattle` | 480 | 198 | 282 | 49.5 |
| `sail-rip` | 178 | 108 | 70 | 27 |

Also:
- Peak voices: cannon 12, impact 13.
- 72 voice steals.
- 933 drops for rate limiting.

**Causes:**
- The router plays one `cannon-near` per gun, because CORE emits one `weapon-fired` per gun (`src/audio/router.ts:269-282`, broadside case of `weaponFired`).
- It adds `chain-rattle` for every Chain-Shot gun.
- It plays `sail-rip` on every chain hit.

Every level-up adds guns, so this gets denser as the run goes on.

**Fix:**
- **Per volley:** one sample per side, layered by size. A single report for 1–2 guns, a ripple for 3–5, a heavy ripple plus a tail for 6 or more.
- **Once per volley:** `chain-rattle` and `sail-rip`.
- **Balance:** auto-fire −3 dB under the manual Full Broadside, so the player's big button is the loudest gun on the sea.
- **Acceptance:** `cannon-near` played per minute ≤40 at level 10, and rate drops fall by more than half.

**Owner:** AUDIO (`src/audio/router.ts`, gains in `public/audio/manifest.json` via `scripts/audio/recipe.mjs`).

### 3. [S2] Danger cues rank below gunfire

**Evidence:**
- The telegraph `warning` cue sits in the `world` category at priority 40, with `minInterval` 0.4 s (`public/audio/manifest.json`, `src/audio/categories.ts:34`).
- Cannons are priority 55 and impacts share a 16-voice cap (`categories.ts:27-29`).
- The probe shows 72 voice steals, and `warning` played 4 of 20 requests. Most of those drops are same-instant duplicates (one sound for six lanes is correct). The ranking problem remains: in a dense fight, a stolen or quiet warning costs the player a hit.
- `mortar-whistle` played 23 of 31 requests.

**Fix:**
- Create an `alert` category with 2 reserved voices at priority 95, covering `warning`, `mortar-whistle` and `boss-horn`.
- Add a short SFX duck (−3 dB for 250 ms) on enemy telegraphs within 200 m.
- Pan off-screen threats hard.

**Owner:** AUDIO (`src/audio/categories.ts`, `router.ts telegraph()`, `manifest.json`).

### 4. [S2] Three loops carry every sea

**Evidence:**
- There are 7 tracks in total (`public/audio/manifest.json → music`).
- The run layers are short loops: calm 99.4 s, combat 102.5 s and horde 93.6 s. Each plays 3–9 times in a 15-minute run.
- All three seas use the same tracks (`STATE_TRACK` in `src/audio/music.ts:19-23`).
- Only the Sovereign has its own boss track.
- The Gloam and Stormwrack sound exactly like Sunward, although they are meant to be different worlds.

**Fix:**
- Source per-sea variants of the calm and combat layers for Stormwrack and the Gloam, from the same CC0 and CC-BY libraries.
- Add a percussion stem as the horde layer, so the rise is additive rather than a track swap.

**Owner:** AUDIO (`scripts/audio/{sources.json,recipe.mjs,build.mjs}`, `public/audio/music/`, `src/audio/music.ts`).

### 5. [S2] The crew is silent

**Evidence:**
- The only human sounds are 3 `crew-cheer` files.
- There are no barks for fire, brace, hit, low hull or kill streaks, and no sea shanty while sailing (AAA plan A-3, still open).
- In AC4 the crew's shanties and barks carry most of the feel of sailing.

**Fix:**
- A priority-queued bark system with 20–30 lines on the `player` bus, ducking music −4 dB.
- Shanty snippets during calm stretches.
- **Owner decision:** CC0 voice is scarce. Higgsfield speech TTS (never imitating voice actors) costs credits, and the owner must approve any spend.

**Owner:** AUDIO (a new `src/audio/barks.ts`, `router.ts`) and the owner.

### 6. [S3] The overall mix is conservative

**Evidence:**
- **In a run:** RMS p10 / p50 / p90 of −26.5 / −22.8 / −19.2 dBFS. The peak maximum was −5.4 dBFS, and 0% of samples peaked above −1 dBFS, so the limiter never engages.
- **Menus:** the harbor sits at −26 to −34 dBFS RMS (`R1/report.json → shots[1–4].audio.meter`).
- **Defaults:** master 0.8 × music 0.7 × SFX 0.85 (`src/game/meta/save.ts:36`).
- Players will run the game roughly 6–8 dB quieter than typical titles and will turn it up, and the ambience will then feel thin.

**Fix:**
- Target about −16 LUFS integrated in combat and about −20 in menus.
- Set master's default to 1.0.
- Keep a −1 dBTP limiter ceiling.
- Re-check with the probe meter.

**Owner:** AUDIO (`src/audio/mixer.ts`). The default settings live in `save.ts` (META or lead).

### 7. [S3] About 129 MB of decoded SFX sit in RAM

**Evidence:**
- 214 SFX files, 530 s in total, are decoded to float32. At 48 kHz that is about 129 MB.
- The long ambience beds alone account for about 60 MB decoded:
  - `amb-harbor` 40 s, stereo, 15.4 MB;
  - `amb-ocean` 30 s, stereo, 11.5 MB;
  - `amb-bow-wash`, `amb-rain`, `amb-wind`, …

**Fix:** stream beds longer than 10 s through media elements, as the music already does. Keep one-shots decoded.

**Owner:** AUDIO (`src/audio/{bank,ambience}.ts`).

## What works (keep)

- **Coverage.** Only two event types in the session had no cue, and both are by design:
  - `enemy-spawned` (127, non-elite);
  - `pickup-spawned` (147, non-chest).

  Everything else maps: telegraphs to whistles, boss phases to groans and horns, tier-up to bell and cheer, crits to the crit cue.
- **Boss music.** It lands on the warning (combat → boss at 154 s).
- **Victory and defeat.** Their stingers and music states work (`R1/rerun-layout`: state `victory`).
- **Round-1 routing.** The lead's `d64b57a` already routes round-1 world events, bounty captains and AI captains.
- **The ledger.** Per-file LUFS and true-peak data make loudness work straightforward.
