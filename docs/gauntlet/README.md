# The gauntlet loop

The owner's standing brief: "keep on improving the game. Run a gauntlet loop and keep on iterating and improving and expanding the game in all aspects." This document describes how that loop runs for We Are On The Cruise: who does what, where each round's documents live, which tools produce the evidence, and the rules everyone follows.

Each round has six steps:

1. **Capture** evidence of the running game (screens, numbers, audio logs).
2. **Critique** it, one document per domain, against AAA naval games and top survivor-likes.
3. **Plan** the next round: 4–6 parallel streams with clear file ownership.
4. **Implement**: the streams work in parallel git worktrees.
5. **Integrate, QA and deploy**: the lead merges the streams, re-runs the evidence, then deploys a preview.
6. **Repeat.** The next round's capture starts from the integrated build.

A round is finished when its `ROUND.md` records what shipped, the before/after evidence, and what carries over.

## Roles

| Role | Who | Owns |
|---|---|---|
| **Owner** | Amir | Direction and decisions. The owner judges the game by playing it, not by reading the docs. Nothing is "accepted" or "AAA" until the owner says so. |
| **Lead** | The integrating agent on `claude/naval-survivor-overhaul` | Contract files (`src/game/{ids,types}.ts`, `src/render/frame.ts`, `src/ui/contracts.ts`, `src/audio/contracts.ts`, `src/runtime/*`), the round contract commit, merges, `PLAN.md`, `ROUND.md`, deploys. |
| **Critic** | One agent per round, branch `r<N>/critic` | Evidence runs, `critique-<domain>.md`, `PLAN-draft.md`, and gauntlet tooling (`scripts/gauntlet/*`, this README). The critic changes no game code. |
| **Stream agents** | 4–6 per round, branch `r<N>/<stream>` | Only the files their stream owns in `PLAN.md`. If the contract blocks them, they write the need in their final report and work around it locally. |

## Where things live

```
docs/gauntlet/
  README.md                  this file
  round-N/
    critique-<domain>.md     one per domain (critic)
    PLAN-draft.md            the critic's proposal for round N+1
    PLAN.md                  the plan the lead actually runs (lead edits the draft)
    ROUND.md                 what shipped, evidence before/after, verdicts, carry-overs (lead)
output/gauntlet/round-N/     evidence: JPEGs, contact sheet, report.json, probe logs (gitignored, this machine only)
scripts/gauntlet/            evidence.mjs, session-probe.mjs, worktrees.sh
```

The critique domains are `combat-feel`, `visuals`, `ui-ux`, `audio`, `performance` and `content-replayability`. Add a domain when a round needs one, for example `onboarding` or `balance`.

Documents cite evidence by path (`output/gauntlet/round-1/07-sunward-late.jpg`) and by number (`report.json → shots[7].cpu.mean.total = 9.9 ms`). Evidence images stay out of git. Any image a document must keep permanently goes in `docs/gauntlet/round-N/img/`, sparingly (≤300 KB each, JPEG).

## Critique format

Each `critique-<domain>.md` opens with a one-paragraph verdict and the reference bar used: AC4 Black Flag and Sea of Thieves for naval games; Vampire Survivors, Brotato and Halls of Torment for survivor-likes. A ranked issue list follows. Every issue carries:

- **Severity:**
  - **S1:** breaks the experience, or is a first-minute impression killer. Fix next round.
  - **S2:** clearly below the bar and noticed by most players. Fix within two rounds.
  - **S3:** polish, or an edge case.
- **Evidence:** image paths plus numbers from `report.json`, probe logs, or `file:line`.
- **Fix:** a concrete proposal that an agent can implement, not "improve X".
- **Owner:** the files or module that own the fix, so the plan can assign it to one stream.

## Plan format

`PLAN-draft.md` groups the next round's work into 4–6 streams. Each stream gets:

- a goal and acceptance checks the evidence tool can verify;
- the files it owns. Two streams never share a file. Shared needs go through the lead's contract commit, which comes first.
- the critique issues it closes.

Anything a running stream already covers is excluded or marked as a follow-up.

## Tools

### Build and serve an immutable copy

Never capture from a dev server that agents are editing.

```sh
npx vite build --outDir /tmp/cruise-critic-dist
npx vite preview --outDir /tmp/cruise-critic-dist --port 4195 --strictPort --host 127.0.0.1
```

Ports: critic 4195; streams 4181–4194; the lead's QA server 4173. Stop your server when you finish (`lsof -ti tcp:4195 | xargs kill`).

### `scripts/gauntlet/evidence.mjs`: screens and numbers

```sh
node scripts/gauntlet/evidence.mjs http://127.0.0.1:4195 output/gauntlet/round-N            # full, about 6–7 minutes
node scripts/gauntlet/evidence.mjs http://127.0.0.1:4195 output/gauntlet/round-N-quick --quick   # about 2 minutes
node scripts/gauntlet/evidence.mjs <base> <out> --stages bosses,victory --seas the-gloam
```

The script drives the game through `window.__CRUISE__`. Each stage starts its own run, so `--stages` can re-shoot any subset.

| Stage | Shots |
|---|---|
| `title` | title screen |
| `harbor` | fleet, seas and shipwright tabs. A real click unlocks audio. |
| `settings` | settings modal, opened from the harbor |
| `seas` | per sea (Sunward/Sunlion, Stormwrack/Dawn Ram, Gloam/White Leviathan): **early** (the real opening, 24 s, no clock jump), **mid** (`debug.time` 6:10, level 12, extra weapons, spawns), **late** (12:30, level 24, full loadout), plus the ship's **special** and **ultimate**. Across the three seas all twelve weapons appear. |
| `levelup` | a frame just before the level-up, then the level-up modal, with a luminance check on the frame edges (`checks.levelupDarkening`) |
| `bosses` | `debug.boss` for each boss, the pilot closes to 150 m, then the sinking frame. The Iron Warden's chest is sailed over to open the chest reveal. |
| `gloam-night` | a night melee in the Gloam at 7:00 (Grand Galley) |
| `victory` | `debug.time(14.9*60)`, then the scheduled Sovereign, then `debug.sinkBosses`: the victory lap and the victory results |
| `defeat` | the pause menu, then Dawn Ram without god mode at 13:00 in a crowd until it sinks, then the defeat results. If it survives 70 s, the script retires through the real pause menu instead. |
| `harbor-after` | the harbor after the runs: banked doubloons and unlocks |

Output files:

- `NN-<shot>.jpg` at 1600×900. Key shots also get a HUD-free `-plate` twin for comparison with `docs/aaa-overhaul/targets/`.
- `contact-sheet.jpg`: labelled thumbnails tiled with ffmpeg (an image sequence plus the `tile` filter; this ffmpeg build has no `drawtext`, so the labels are drawn in a blank page first).
- `report.json`, with a `shots` entry for each shot containing:
  - `cpu`: the profiler over the measured window. It includes mean and max per system (`sim`, `ocean`, `ships`, `fx`, `post`, `render`, `ui`, `audio`…), p50, p95 and p99 of the frame total, `over8ms`, `over16ms` and `over33ms` counts, and the three worst frames.
  - `render`: draw calls, triangles, programs, textures, DPR and tier.
  - `scene`: triangles per scene group.
  - `sim`: the `summary()` fields: time, level, weapons, enemies, bosses, hazards.
  - `ui`: the DOM update cost.
  - `audio`: music state, cues played and dropped since the previous shot, and the post-limiter RMS/peak meter.
  - `errors`.

  At the top level, `report.json` also holds:
  - `load`: time to `__CRUISE__.ready`;
  - `transfer`: bytes by file type, and the largest files;
  - `gpu`: the WebGL renderer string;
  - `checks`: opening pace, loadouts, level-up darkening, boss approaches, chest, defeat;
  - `audio`: the final `__CRUISE_AUDIO__.stats()`, SimEvent type counts and the last 400 cue log lines;
  - `stageErrors`.

Headless Chromium uses the real GPU here (`ANGLE Metal Renderer: Apple M4`). Pass `--headed` to watch a run.

### `scripts/gauntlet/session-probe.mjs`: a real-time session

```sh
node scripts/gauntlet/session-probe.mjs http://127.0.0.1:4195 output/gauntlet/round-N/session-sunlion --ship sunlion --sea sunward-shallows --seconds 240
```

This runs a real-time run with no clock jumps. The pilot sails at the nearest enemy, turns broadside and uses its skills; it is not a human, so its numbers are a floor. Add `--god` to keep it alive, or `--boss-at 180` to fast-forward to the 5:00 boss warning after 180 s. It writes `session.json` containing:

- a 1 Hz timeline: level, XP, kills, hull, enemies, projectiles, music state and intensity;
- the level-up times and every card offer;
- SimEvent counts, and the cues played and dropped per event source;
- per-cue rates, used to find spammy cues and events that map to no sound;
- music transitions;
- a 5 Hz loudness meter;
- a CPU split per 10-second window;
- a screenshot every 30 s.

Use it for pacing (time to first kill, XP rhythm), audio (coverage, spam, mix) and sustained-load CPU.

### `scripts/gauntlet/worktrees.sh`: stream worktrees

```sh
scripts/gauntlet/worktrees.sh 2 look ocean ui audio       # /tmp/cruise-r2-<name> on branch r2/<name>
BASE=r1/critic scripts/gauntlet/worktrees.sh 2 critic      # branch from another ref
```

The script branches from the main checkout's current HEAD, unless `BASE` is set. It symlinks `node_modules` to the main checkout and leaves existing directories alone. Once merged, clean up with `git worktree remove /tmp/cruise-r2-look && git branch -d r2/look`.

### Existing tools that also help

- `scripts/qa-play.mjs`: the lead's QA bot. It launches a headed browser and saves PNGs every 10 s.
- `scripts/audio/qa-game.mjs`: audio event → cue mapping check.
- `npx tsx scripts/balance-sim.ts --seeds 3 --minutes 18 --proxy off`: headless balance. Use 18 minutes, otherwise the Sovereign fight gets cut off.
- In-page tools:
  - `window.__CRUISE__`: `summary`, `nearest`, `profiler`, `sceneStats`, `metrics` and `debug.*`;
  - `window.__CRUISE_AUDIO__`: `stats`, `log`, `meter`, `play`;
  - `window.__CRUISE_UI__`: `perf` and `spikes`;
  - `?hud=0` for clean plates;
  - `?run=<ship>:<sea>&god=1` to jump straight into a run.

## Rules

1. **Close every automated browser, and stop every server you start.** The owner requires this. Scripts close the browser in `finally`. Nothing is left running when a stream ends: check with `lsof -nP -iTCP -sTCP:LISTEN | grep node`.
2. **Judge performance by the CPU split, not FPS.** This machine is shared with other sessions' GPU work (load average above 10 is normal), so FPS and GPU timings are contaminated. Use:
   - `report.json → shots[].cpu`: mean, p95 and hitch counts;
   - draw calls and triangles.

   Frames stepped through `advance()` stall on GPU back-pressure, so they are not hitches. A clean GPU timing needs an idle machine and the owner's say-so.
3. **Evidence is gitignored.** It goes under `output/` (ignored). Engine captures and generated images never mix: generated paint-overs live in `docs/aaa-overhaul/targets/` and are goals, never evidence.
4. **Freeze the build you measure.** Capture from `vite preview` of a build in `/tmp`, never from a dev server that agents are editing. Don't overwrite another agent's build directory.
5. **Stay in your lane.** A stream edits only the files its plan section owns. Contract changes go through the lead. You may merge another stream's branch to test against it, but you never edit its files.
6. **Commit early and often** on your own branch. End messages with the attribution line from the session instructions. Don't push, merge or deploy unless you are the lead.
7. **No secrets and no spending.** Never commit credentials, signed URLs or the owner's email. Meshy and Higgsfield spending needs the owner's explicit go-ahead. Blender (:9876) is shared: never save or clear the owner's scene.
8. **Stay on the owner's direction.** Keep the original world: no One Piece names, terms or characters in game text. Keep the six hero ships and never swap in generated replacement hulls. Target desktop Chrome, with CC0/CC-BY audio only, and ledger every new asset in `ASSET-LICENSES.md`.
9. **Claim only what the evidence shows.** A passing number is not art acceptance. Don't call anything AAA or accepted; the owner decides.
10. **Keep `npm test` and `npm run build` green** on every branch you hand over.
