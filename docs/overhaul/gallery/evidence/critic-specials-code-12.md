# Independent special-mechanics code review — build 12

Verdict: **two reproducible P2 failures; changes requested before acceptance.** No source files were edited. No prior critic reports were read. No browser was opened.

## P2 — An accepted legacy-shaped Moby save becomes invalid after migration

Location: `src/simulation/GameSimulation.ts:450–454`, coupled to `src/simulation/saveValidation.ts:40–42`.

The migration adds `pressureWave` to an active legacy-shaped phase but preserves its supplied duration. A phase with `elapsed: 0.3`, `duration: 1.2`, and no `pressureWave` passes validation and restores successfully. Its migrated export now contains the wave, so the stricter wave validator demands an active duration of `1.8`. An immediate second restore fails. An accepted restore therefore produces a rejected export before its active phase ends.

This review has not established that a released build emitted `duration: 1.2`; the root agent checked build 11 and reports its actual Moby duration was `1.8`. The finding is the accepted-input/valid-output inconsistency at the migration boundary, rather than evidence of a naturally emitted build-11 save failing. Either reject unsupported legacy phase shapes or normalize them into a valid canonical state.

Measured repro (`actualLegacyDuration` in the evidence JSON):

```json
{"originalAccepted":true,"accepted":true,"migratedValid":false,"immediateRerestore":false}
```

If normalizing, update the legacy phase duration and elapsed/radius coherently during migration, retaining the already-hit suppression. Verify that `restoreSave(legacy)`, `isNavalSave(exportSave())`, and a second restore all succeed throughout the remainder of the phase. A test that only deletes `pressureWave` from a `1.8`-second phase does not cover other duration values that this boundary currently accepts.

## P2 — Collision separation can skip a real Moby wave crossing

Location: `src/simulation/GameSimulation.ts:1568–1573`; tick calls `resolveShipCollisions()` before `updatePressureWave()`.

The swept-crossing test reconstructs the previous target position from its **post-collision** position and velocity. Collision separation is not represented by that velocity. When separation pushes a target through the front, the reconstructed previous position is also behind the old front, so the target is classified as a late arrival and receives no hit, including on later ticks.

Measured repro uses the normal tick and collision solver. Two navy hulls start just touching at x `75.1` and `97.6`, outside a stationary Moby front at radius `75`. The outer hull moves inward at `31 m/s` and has an existing impact cooldown. The target moves to x `74.84222765088317` through collision separation while the wave advances to `76.25`. The target receives no damage or `special-impact`, and never appears in `hitIds`; the other hull is subsequently hit normally. No initial hull overlap is required.

Capture actual target x/z before the tick's movement and collision resolution, and compare that position to the old front. Preserve the rule that ships genuinely introduced behind an already-passed front are not retroactively hit.

## Verified behavior

- Stationary hostile centers at 80 m and 125 m are hit only when the advancing front reaches them, once each. The origin remains fixed while the radius advances.
- A JSON save after the first hit restores and remains identical to the uninterrupted simulation for the remainder of both impacts and recovery.
- Bracing reduces the observed pressure damage to exactly 32% of its unbraced value.
- Legacy migration suppresses additional damage to existing ships; the defect above concerns validity of the migrated save, not duplicate immediate damage.
- Polar reaches a physical minimum y of `-17.06367839343076` on flat water and returns to y `0.032379694772634936` by frame 421, a bounded spring response around the 17 m target.
- Repeated Polar port/bow fire inputs produce no underwater muzzle events. Shots resume with the muzzle above the surface.
- A Polar volley queued near the end of windup has two pending shots; both are cancelled during the transition to active dive and emit no cannon events.
- Source inspection confirms that Moby's rendered front radius uses the authoritative persisted wave radius, and Sunny, Polar and Moby have separate phase-driven meshes. Visual quality and GPU rendering were not assessed in this code review.
- A forged active wave with a noncanonical `.001` duration is rejected by the current validator.

## Reproduction artifacts

- `output/overhaul-gauntlet/critic-specials-code-12-repro.ts`
- `output/overhaul-gauntlet/critic-specials-code-12-evidence.json`

Run from the repo root:

```sh
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer({server:{middlewareMode:true},appType:"custom"}); try { await server.ssrLoadModule("/output/overhaul-gauntlet/critic-specials-code-12-repro.ts"); } finally { await server.close(); }' > output/overhaul-gauntlet/critic-specials-code-12-evidence.json
```

The bounded fixture uses a flat ocean and disables AI intent, environmental hazards, and encounter reinforcements to isolate special mechanics. It keeps normal movement, collision resolution, phase progression, damage, projectile launch/cancellation, save validation, and restore behavior. Successful expected-behavior assertions terminate the runner with exit code 0; the two review failures are captured as measurements rather than deliberately failing assertions. This is a mechanics review, not production or browser acceptance.
