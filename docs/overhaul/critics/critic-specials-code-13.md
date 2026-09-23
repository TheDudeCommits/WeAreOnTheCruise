# Independent special-mechanics follow-up — build 13

Verdict: **both previous P2 findings fixed; one remaining reproducible P2 in Polar recovery clearance.** No source edits or browser use. The independently authored build-12 reproduction was rerun against the current simulation, then extended with migration and actual muzzle-position checks. NavalFx changes in progress were not assessed.

## P2 — Polar recovery checks battery centers rather than every actual muzzle

Location: `src/simulation/GameSimulation.ts`, `polarMuzzlesClear()` and its recovery-release caller.

`polarMuzzlesClear()` calls `sampleCannonTrajectory(ship, side)` once per side, so it tests `gunOffset: 0`. An actual broadside volley uses offsets `-0.5`, `0`, and `0.5`, placing its first and last muzzles 11.44 m fore/aft of the tested center. Water height differs at those positions. Recovery can therefore clear while an actual muzzle remains submerged, immediately allowing a volley whose first shot is cancelled by the later launch check. The UI can report ready although the first gun does not fire.

Reproduced using the existing **FallbackWaveSampler**, a Polar at origin (0, 0), heading `Math.PI`, and normal special activation. At release frame 322:

| Mount | Height above local water |
| --- | ---: |
| Port first gun, offset -0.5 | **-0.167758835 m** |
| Port center, offset 0 | 0.158250728 m |
| Port last gun, offset 0.5 | 0.376573027 m |

The next immediate `fire-port` input emits **zero cannon-fired events**. A second, smooth local-slope fixture (`height = .12 * z`) makes the discrepancy larger: the first port/starboard guns remain 1.117 m underwater when recovery clears; the first port shot is cancelled and only the later two shots fire.

Fix the clearance gate to sample the actual barrel/volley mount positions, using the same side and gun-offset convention as launch. Preserve the existing phase lock and per-shot water check. Test an immediate port volley after release with a heading/wave combination where the stern mount sits below the battery center.

## Closed previous findings

**Collision crossing:** The unchanged just-touching hull repro now hits correctly on the crossing tick. The target moves from x 75.1 to 74.842227651 while the wave grows from radius 75 to 76.25, records exactly one `special-impact`, and receives 0.121194695 hull damage. The second target also receives exactly one impact later. Source inspection confirms positions are captured before integration and collision separation rather than reconstructed from post-collision velocity.

**Accepted legacy-shaped save validity:** Both active and recovery phases with supplied duration 1.2 now normalize coherently. Active elapsed 0.3 becomes elapsed 0.45/duration 1.8/radius 33.75; recovery becomes elapsed 0.3125/duration 1.25/radius 135. Each case passes **240 consecutive export → validate → new instance restore → one tick cycles**, with no added damage to any existing ship. This tests accepted noncanonical input and does not claim that build 11 naturally emitted duration 1.2.

## Other checks that passed

- Original two-target propagation, no double hits, brace ratio 0.32, JSON midwave restore equality, legacy no repeated damage, and malformed wave-duration rejection still pass.
- Polar remains locked for the entire active and recovery phases.
- On flat water, recovery holds its elapsed timer at exactly 1.25 for 15 additional frames; every held save validates and restores. It clears at frame 322 after all sampled actual muzzles clear, and the immediately following port input fires its first shot.
- Polar's late-windup queued shots are still cancelled without underwater cannon events.
- Physical dive depth and bounded resurface checks still pass.
- Targeted `git diff --check` passes.

## Artifacts and reproduction

- `output/overhaul-gauntlet/critic-specials-code-13-repro.ts`
- `output/overhaul-gauntlet/critic-specials-code-13-evidence.json`

Run from the repo root:

```sh
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer({server:{middlewareMode:true},appType:"custom"}); try { await server.ssrLoadModule("/output/overhaul-gauntlet/critic-specials-code-13-repro.ts"); } finally { await server.close(); }' > output/overhaul-gauntlet/critic-specials-code-13-evidence.json
```

Fixture scope: AI intent, environmental hazards and reinforcements are disabled to isolate special mechanics; normal movement, collision, phase, save/restore, projectile scheduling and muzzle-water checks run. Passing invariants use assertions; the remaining defect is recorded under `polarFallbackWaveRelease` and `polarRelease`. The SSR runner is closed in `finally`. This is code/mechanics acceptance only, not browser/visual acceptance.
