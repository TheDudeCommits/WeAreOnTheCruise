# PERF tools and notes (round 2)

Scripts for the performance stream. They drive a **frozen build** (`npx vite build --outDir /tmp/<dir>` then
`npx vite preview --outDir /tmp/<dir> --port <port> --strictPort --host 127.0.0.1`), write under `output/` (gitignored)
and close their browser in `finally`.

| Script | What it measures |
|---|---|
| `probe.mjs <base> <out> [--stages title,harbor,opening,late,bosses]` | Per-pass triangles and draw calls (ink prepass, shadow map, colour + post), program growth per stage with cache keys of late compiles, real-time CPU windows from the game profiler, the harbor warm-up phases. |
| `breakdown.mjs <base> <out.json> [--run ship:sea] [--late] [--boss id]` | One frame's draws attributed to (pass, object path, material): where the triangles go. |
| `shots.mjs <base> <out>` | HUD-free title, harbor and run plates for before/after looks. |
| `gpu-timing.mjs <base> <out>` | GPU time per pass with `EXT_disjoint_timer_query_webgl2` (method below). |
| `load-bytes.mjs <base> <out.json>` | Time to ready and bytes per phase (boot, title, harbor, run) from every network response. |

In-page hooks: `window.__PERF__` — `passes()` (last frame's triangles/draw calls per pass), `programCount()`,
`programs()`, `rewarmMs()`, `ink()`, `gpu()`, `setGpuPassTiming(on)`; after the harbor warm-up also `warmup()`,
`captainBakes()`, `bossSources()`, `bossBuilds()`. `window.__SHIPS__.assets.proxyStats()` lists hero shadow proxies,
`window.__SHIPS__.fleet.stats` the fleet's near/far/culled split.

## GPU timing method

`gpu-timing.mjs` documents the method in its header. In short: an idle machine (1-minute load under ~2; the script
refuses above 4 without `--force` and marks anything above 2 as contaminated), a frozen build, headed Chrome at
1600×900 with `?dpr=1&gpupasses`, 5 s warm-up then 15 s per case, three runs, quote the median. `?gpupasses` makes
RendererHost/PostStack bracket each pass with a timer query (`prepass`, `colour-setup`, `shadow`, `colour`, `bloom`,
`composite`); per-frame totals are the sum of one frame's queries. On Chrome/ANGLE-Metal a query spans the pass's
command buffer and can include scheduling gaps: read passes as relative weights, the total as an upper bound.

First (contaminated, load average 10–18, headless) reading on 2026-09-25, Apple M4, DPR 1: GPU per frame p50
16–23 ms; per pass — colour 6.0–8.3 ms, bloom 5.1–7.2 ms, composite 4.5–6.5 ms, prepass 1.2–2.3 ms, shadow
0.5–1.0 ms. Post-processing fill (bloom chain and composite) weighs as much as the colour pass; triangles are not
the GPU bottleneck. Re-take on an idle machine before acting on absolute numbers.

## Texture compression (KTX2/Basis): measured, not adopted

`toktx`/`basisu` are not installed and three's KTX2Loader needs the Basis transcoder (~0.5 MB wasm) in `public/`,
so KTX2 is not cheap in this pipeline today. What it would change, from every runtime GLB (2026-09-25):

| Set | Mtexels | WebP on disk | GPU RGBA8 + mips | BC7/ASTC (UASTC) + mips | BC1 (ETC1S) + mips | est. UASTC+zstd file | est. ETC1S file |
|---|---|---|---|---|---|---|---|
| hero high (6) | 69.6 | 4.35 MB | 371 MB | 93 MB | 46 MB | ~45 MB | ~10 MB |
| fleet (49 GLBs) | 31.0 | 5.05 MB | 165 MB | 41 MB | 21 MB | ~20 MB | ~4.6 MB |

- GPU memory: ÷4 with UASTC (BC7/ASTC), ÷8 with ETC1S (BC1) — the one large win. Resident today: the fleet set
  (165 MB with the three 2048² boss atlases at 22 MB each) plus the loaded heroes (Sunlion 30 MB, Dawn Ram 67 MB,
  Seawarden 106 MB as RGBA8 + mips) — about 230–340 MB, close to the design bible's 350 MB texture budget.
- Download: these textures are mostly flat, painterly albedo; lossy WebP is far smaller than either Basis mode (ETC1S
  would be ~2× the WebP bytes, UASTC ~10×). KTX2 would make every load slower.
- Upload: KTX2 skips the RGBA8 upload and GPU mip generation at first use; the warm-up already uploads textures in
  idle time (`initTexture`), which removes that hitch without KTX2.
- Recommendation: stay on WebP for now (downloads matter more for a web game than memory on the M4 target). If the
  350 MB texture budget binds, convert the largest sets first — the boss atlases and the Seawarden / Yellowfin /
  Dawn Ram textures (1024² each) — to ETC1S (UASTC for the hero hulls if ETC1S blocks show), install KTX-Software
  (`toktx`) for `gltf-transform etc1s/uastc`, ship `basis_transcoder.{js,wasm}` and register KTX2Loader on both GLB
  loaders; check the looks in the harbor first.

## Load time and bytes

`load-bytes.mjs` counts every response body per phase (the evidence report's `transfer` reads the browser's
resource-timing buffer, which holds 250 entries by default, so its totals are truncated). Lead branch 009e8cc vs
r2/perf merged, 2026-09-25, local preview, load average 5–7, Dawn Ram, two runs each:

| Phase | Lead | r2/perf merged |
|---|---|---|
| boot → ready | 12.97 MB (GLB 11.72), ready 325–684 ms | 7.19 MB (GLB 5.93), ready 373–675 ms |
| title (3 s) | 0.8–5.4 MB (audio) | 5.4 MB (audio) |
| harbor (20 s) | 0.3–4.9 MB (audio) | 19.8–23.0 MB (GLB 19.5: bosses, captain candidates, unlocked heroes) |
| first 45 s of the run | 15.9–16.1 MB (GLB 14.6: captain bakes) | 0.3–0.5 MB |
| session total | 34.6–34.8 MB | 32.9–35.8 MB |

Changes that affect them:
boss GLBs (5.9 MB) no longer load at boot (idle time ~20 s later, or from the harbor warm-up); the hero `-low.glb`
files, read only by the captain hull bake, dropped 3.4 MB of images the runtime never decoded; the Sunlion high GLB
grew 276 KB with its atlas while its low file dropped 376 KB; meshopt decoding runs in two workers.
