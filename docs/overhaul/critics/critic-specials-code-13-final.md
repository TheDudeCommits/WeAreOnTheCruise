# Independent special-mechanics final review — build 13

Verdict: **PASS for the reviewed simulation/save/launch scope. All three previously reported P2 failures are closed.** No remaining concrete failure was found in the bounded follow-up checks. No source files were edited and no browser was opened. Rendering/visual acceptance remains with the root agent's final capture.

The source now uses shared `cannonVolleyCount` and `cannonVolleyOffset` helpers for both launch scheduling and Polar battery clearance. The recovery phase remains locked until those actual scheduled mount positions clear the sampled local waterline. The per-shot launch water check remains in place.

## Exact Polar regressions

| Fixture | Recovery clears | Extra held frames | Lowest actual muzzle clearance | Immediate / remaining port shots |
| --- | ---: | ---: | ---: | ---: |
| Flat water | Frame 322 | 15 | 0.236424 m | 1 / 2 |
| Smooth slope, height = .12 × z | Frame 329 | 22 | 0.125679 m | 1 / 2 |
| Existing FallbackWaveSampler, heading π | Frame 324 | — | 0.154369 m | Immediate first shot confirmed |

The exact heading-π fallback fixture previously released at frame 322 with its first port muzzle 0.167759 m underwater and emitted no immediate shot. It now holds two further frames, clears every mount, and fires on the next input.

I also checked **24 fallback-wave configurations**: eight headings at each of three starting x coordinates. Every actual muzzle was above its local waterline by more than the required 0.1 m when recovery cleared, and every immediate port input emitted the first cannon event. The smallest observed release clearance across those configurations was 0.115022 m.

For both the flat and sloped fixtures, saving during held recovery and restoring into a new simulation preserved the full JSON snapshot on every remaining frame through phase release. The elapsed recovery timer stayed clamped and all held saves validated. Saving after the immediately fired first cannon preserved the two pending shots, and the restored and uninterrupted simulations remained identical for the following 100 frames of launch and flight.

## Previous P2 regressions

**Moby collision crossing:** The exact initially touching hull fixture still passes. The target starts at x 75.1 and is pushed to x 74.842227651 while the pressure front advances from 75 to 76.25. It receives one crossing impact and 0.121194695 hull damage. It is never hit twice; the other target is hit once later.

**Accepted legacy-shaped save normalization:** Both active and recovery input phases with supplied duration 1.2 pass 240 consecutive export → validate → restore into a new simulation → one tick cycles. All exported states remain valid and no additional damage is applied to existing ships. Active/recovery timing and radius normalize coherently. This covers accepted noncanonical input; it does not assert that build 11 emitted duration 1.2.

## Preserved behavior

- Moby's normal 80 m / 125 m two-target propagation and once-only hits pass.
- Midwave JSON reload remains identical to uninterrupted simulation.
- Brace damage remains 32% of the unbraced amount.
- Polar reaches approximately 17 m depth and resurfaces within the bounded test period.
- All guns remain locked during active dive and recovery.
- Pending Polar shots from late windup are cancelled during the dive transition without cannon events.
- Forged noncanonical active pressure-wave duration remains rejected.
- Targeted `git diff --check` passes.

## Reproduction evidence

- `output/overhaul-gauntlet/critic-specials-code-13-final-repro.ts`
- `output/overhaul-gauntlet/critic-specials-code-13-final-evidence.json`

The final reproduction uses assertions for actual mount clearance, immediate firing, all save/flight continuity comparisons, and the closed collision/legacy failures. Its run completed with exit code 0.

```sh
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer({server:{middlewareMode:true},appType:"custom"}); try { await server.ssrLoadModule("/output/overhaul-gauntlet/critic-specials-code-13-final-repro.ts"); } finally { await server.close(); }' > output/overhaul-gauntlet/critic-specials-code-13-final-evidence.json
```

Fixture limits: unrelated AI intent, environmental hazards and encounter reinforcements are disabled. The tests retain normal movement, collision resolution, special phases, damage, save validation/restore, projectile scheduling, and launch-water checks. The SSR runner closes in `finally`. This review does not establish browser performance, visual quality, or production deployment acceptance.
