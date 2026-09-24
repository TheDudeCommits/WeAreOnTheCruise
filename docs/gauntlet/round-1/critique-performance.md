# Round 1 critique: performance

**Build and evidence:** as in `critique-combat-feel.md`.

**Capture:** headless Chromium 151 on the real GPU (`ANGLE Metal Renderer: Apple M4`, `report.json → gpu`), 1600×900, DPR 1, quality auto (resolves to high).

**Machine:** shared. Other agents' browsers and Blender were running, with a load average around 13–16. FPS and GPU timings are therefore ignored.

**What the numbers are:**
- **CPU:** the per-system CPU split from `__CRUISE__.profiler`, measured over a 2.5 s real-time window before each shot (`report.json → shots[].cpu`: mean, max, p95, and counts of frames over 8, 16.7 and 33 ms).
- **Draw calls and triangles:** from `renderer.info`, reset once per frame.
- **Scene triangles:** from `sceneStats()`.
- **Sustained CPU:** in 10 s windows, from the probe `R1/session-sunlion/session.json → cpu[]`.

**Budget (design bible §7):** 60 FPS with 80 enemies, 400 projectiles and FX; ≤300 draw calls; ≤2.5M triangles; textures ≤350 MB; shaders precompiled at load.

## Verdict

The CPU side is healthy and has headroom. Across 35 measured windows:
- mean frame CPU was 2.1–6.7 ms;
- p95 was ≤10.7 ms;
- the worst frame was 15.4 ms;
- **no frame exceeded 16.7 ms**, including the 80-enemy Stormwrack late state.

`render` (WebGL submit) is the largest part at 1.4–4.3 ms. The simulation stays ≤1.1 ms.

The problems are the triangle budget, which multi-pass rendering blows through even on menus, and first-use shader compiles that cause real hitches. GPU cost is still unmeasured.

## Issues, ranked

### 1. [S2] Multi-pass rendering triples the triangle count; menus exceed the budget

**Evidence:**

| Shot | Scene triangles (`sceneStats`) | Rendered triangles (`renderer.info`) | Factor |
|---|---|---|---|
| `00-title` | 0.71M | 2.44M | 3.4× |
| `01-harbor-fleet` | 0.71M | 2.34M | 3.3× |
| `12-stormwrack-late` (80 enemies) | 0.84M | 2.56M | 3.0× |
| `rerun-victory/02-harbor-after` (Seawarden) | — | **2.93M** | — |
| `27-boss-sovereign` | 0.55M | 1.99M | 3.6× |

- The extra passes are the shadow pass and the ink prepass, which redraws outlined meshes.
- On the title and harbor, islands (`world`) are 403k triangles, **334k of them shadow-casting**, and the hero is 164k, 162k of them shadow-casting.
- A menu showing one ship renders 2.3–2.9M triangles, above the 2.5M budget with no enemies on screen.

**Fix:**
- Islands receive shadows but don't cast them. Or they cast from a proxy with 10% of the triangles.
- The hero uses its low LOD in the shadow pass.
- The ink prepass skips islands beyond about 250 m and uses LOD1 geometry.
- **Acceptance:**
  - menus ≤1.6M rendered triangles;
  - the worst run shot ≤2.2M;
  - `report.json` shows the factor at ≤2×.

**Owner:**
- LOOK: `src/render/app/PostStack.ts`, `src/render/npr/ink.ts`, `src/render/app/quality.ts`.
- WORLD: `castShadow` and LOD in `src/render/world/*`.
- SHIPS: the hero shadow proxy.

### 2. [S2] First-use shader compiles cause hitches mid-run

**Evidence:**
- The WebGL program count climbs through the capture: 74 on the title, 76 in the first run, 79–82 by the late states, 84 at the bosses, 86 at the victory lap. That is 12 programs compiled during play (`report.json → shots[].render.programs`).
- In the quick capture, the late-loadout jump (new weapons plus a weather change) produced a **70.9 ms frame**, with `render` at 51.5 ms and `ocean` at 18.5 ms, while programs went from 76 to 80. That window had 4 frames over 16.7 ms (`R1/quick/report.json → shots[3].cpu.worst`).
- The full capture shows no spike at the same point only because those programs were already warm.
- The design bible says shaders are precompiled at load (`PostStack.precompile`), but weapon, boss and weather variants are not covered.

**Fix:**
- Build a warm-up scene during the title and harbor. It should include every weapon prop, FX material, enemy class, boss and weather/night variant, compiled with `renderer.compileAsync` with the post targets bound.
- Lazy-load GLBs only after their programs are warm.
- **Acceptance:** the program count is constant from the harbor onward, and no window has frames over 33 ms after a loadout or weather change.

**Owner:** LOOK (`src/render/app/PostStack.ts precompile`). FX and SHIPS supply the warm-up lists (`src/render/fx/FxSystem.ts`, `src/render/ships/ShipSystem.ts`).

### 3. [S3] Asset weight: boss models load at boot, and LODs duplicate textures

**Evidence:**
- A full session transfers 15.6 MB (`report.json → transfer`):
  - GLB 11.8 MB;
  - OGG 3.0 MB, 178 files;
  - JS 0.48 MB (1.55 MB decoded).
- All three boss GLBs (5.9 MB) are requested at start-up by `Bosses.preload()` in `ShipSystem.init` (`src/render/ships/ShipSystem.ts:57`, `src/render/ships/fleet/Bosses.ts:85-89`):
  - `sovereign.glb` 2.7 MB;
  - `dreadnought.glb` 1.9 MB;
  - `tidewyrm-head.glb` 1.3 MB.

  The first boss appears at 5:00.
- The Seawarden's models are `navy-galleon.glb` at 6.2 MB and `navy-galleon-low.glb` at 4.6 MB. Textures are duplicated per LOD, as noted in AAA plan F8.
- Local time-to-ready is 0.84–1.6 s. Remote players will pay for the boss preloads while the hero model loads.

**Fix:**
- Defer boss loads to idle time after the first run frame, or to 4:00.
- Share textures across LODs.
- Adopt KTX2/Basis textures in `scripts/assets`.
- **Acceptance:** under 6 MB transferred before the first sail, and time-to-ready ≤3 s on a throttled 20 Mbps profile. This is a new evidence option: throttle with CDP `Network.emulateNetworkConditions`.

**Owner:** SHIPS (`src/render/ships/fleet/Bosses.ts`, `src/render/loaders/*`) and ASSETS (`scripts/assets/*`).

### 4. [S3] About 129 MB of decoded audio

**Evidence and fix:** see `critique-audio.md` #7. Stream the ambience beds (about 60 MB decoded).

**Owner:** AUDIO.

### 5. [S3] The `world` system spikes to about 3.8 ms

**Evidence:** the worst frames show `world` at 3.7–3.8 ms against a mean below 0.1 ms (`shots[13].cpu.worst`, `shots[22].cpu.worst`). This is probably island/foliage streaming or instancing rebuilds as the player crosses cells.

**Fix:** profile `WorldVisuals.update`, and amortise rebuilds over frames with a 0.5 ms budget.

**Owner:** WORLD (`src/render/world/WorldVisuals.ts`).

## Gaps (not measured this round)

- **GPU time.** The machine is shared, so GPU time is unmeasured.
  - The profiler's `render` column is only CPU submit time.
  - A clean GPU timing needs an idle machine and the owner's say-so: headed Chrome, `EXT_disjoint_timer_query`, 5 s warm-up and 15 s per case, using the existing `scripts/profile-gauntlet.mjs` pattern.
  - Until then, triangles, draw calls and passes are the proxies.
- **Memory.** JS heap was a steady 73 MB. GPU texture memory was not measured: `renderer.info.memory.textures` counts 46–142 textures, but not their bytes.

## What works (keep)

- Instanced enemy fleets: 80 enemies cost `ships` 0.36–0.62 ms CPU.
- The profiler and `sceneStats` hooks, which made this critique possible.
- Draw calls ≤238 everywhere, within the 300 budget.
- Sim ≤1.1 ms at 80 enemies.
- The UI's DOM update cost is ≤0.28 ms mean.
