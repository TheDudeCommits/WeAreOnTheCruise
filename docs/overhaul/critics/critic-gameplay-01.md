# Independent gameplay review 01

Reviewed 2026-09-06, approximately 21:19–21:27 Asia/Bangkok. Repository HEAD: `ba33a1760fddebb084764a612e4ee52589337c3d`; assessment includes the current working tree. No browser, other reviewer notes, or implementation worklog was used. Source was not changed.

At review, SHA-256:

- `src/simulation/GameSimulation.ts`: `313b429fe1a1dc67efb1f2b954eea03c1edffb898b3709a728a44eb8f6255ce5`
- `src/world/LogicalWorld.ts`: `2b4a426601e9d8eda8fb3c2ff1722262ae0f5da7528e3d552df4fe01f9ceb01d`
- `src/render/ships/ShipFleetView.ts`: `b1b9014081bab8faba5521dff9c813c50922e2f74f1ce3950a2de3729e9b0404`

## Acceptance verdicts

| Section | Verdict | Evidence |
|---|---|---|
| 5 — persistent damage and meaningful finishing choices | **FAIL** | Lethal targets disappear before their available/sinking state ends. The 4.5-second automatic reward transition freezes sinking and removes the opportunity to approach distant targets. Spare does not make a rival escape or return. |
| 6 — ten crew and meaningful station tradeoffs | **FAIL** | Valid allocations total ten and all four stations affect simulation, but immediate reassignment lets the player take the fast gunnery reload and move those same hands into full repairs throughout the reload. The stored cooldown never responds to their departure. |
| 8 — repeatable three-leg voyage, objectives, rewards, builds, continuation | **FAIL** | Basic progression and duplicate-payout guards pass. However the storm gate is bypassable using ordinary input, and malformed version 1 saves are accepted or partially committed before throwing. Three-build viability is not established by the current tests. |
| Fire/trajectory determinism | **PASS within tested scope** | Staggered volley launch, aiming adjustment, unequal frame batches, and JSON continuation matched. This does not certify visual muzzle alignment or actual GPU wave/aim correspondence. |

## P1 — lethal targets disappear immediately

Source: `src/render/ships/ShipFleetView.ts:39`.

The renderer uses `!ship.surrendered || ship.damage.hull < 0.995`. A normal projectile hit clamps a lethal target to hull damage 1 and marks it surrendered. The model therefore becomes invisible while the simulation still offers salvage/spare/scuttle. This also hides the entire sinking sequence for those targets.

Reproduction in `critic-gameplay-probes.test.ts`, first case: start a voyage using Red Force, isolate an enemy with cooldowns held high, position it 40 m to port at 74% hull damage, and launch an actual heavy broadside. These fixture changes isolate the finishing path; damage itself is applied by ordinary projectile simulation.

Observed: `hull: 1`, `finish.state: available`, `finish.creditedTo: player`, `damageStage: disabled`, renderer visibility predicate `false`.

Smallest fix: derive visibility from explicit finishing state, retaining available/salvaged/spared/sinking models and hiding only a completed sunk/removal state. Recheck a lethal hull-1 target, not only an AI surrender at less than 99.5% damage.

## P1 — automatic rewards freeze aftermath before it can finish

Sources: `GameSimulation.ts:500–509`, `GameSimulation.ts:551–560`, and the non-encounter early returns in `update`/`tick`.

A combat objective waits only 4.5 seconds, then enters `reward`; every subsequent tick returns. Scuttling requires 12 seconds to reach sunk; salvage requires four seconds before even starting the 12-second sink. The final enemy cannot complete either animation in a normal final-target aftermath. Closing the reward chart does not resume the simulation.

Reproduction in `critic-gameplay-probes.test.ts`: disable the target with the heavy volley above, select scuttle, advance 1,200 frames, then another 1,200.

Observed after both advances: voyage `reward`; finish `sinking`; finish elapsed `3.299999999999993`; Y `-6.619326972982043`. The second advance does not change the finish timer.

A separate proximity fixture moves the player beyond 240 m after the disabling volley. Once reward opens, movement stops and salvage returns false. The choice cannot be recovered by closing the chart. In multi-enemy fights an earlier disabled ship can naturally be out of range when the last one falls.

Smallest coherent fix: use an explicit aftermath state after the objective, with enemies unable to resume fighting but normal player navigation and finishing timers continuing. Offer an explicit collect-reward action to leave aftermath. Preserve manual pause behavior, and preserve this phase/timer in saves. Merely increasing the fixed timer still strands some distant targets.

## P2 — gunnery reload can be borrowed for one frame

Sources: `GameSimulation.ts:260–275`, `1198–1200`, `1348–1353`, `1368–1370`.

Reload duration is calculated using the gun allocation only at the moment of firing. It then counts down at one second per second regardless of the current gun crew. Crew changes are immediate. Fire with six hands on guns, transfer instantly to six repair hands, and transfer back just before the next salvo. The player gets essentially the gunnery reload and full repair work from the same hands throughout the reload.

Observed in the crew probe with damaged Red Force/precision: gunnery cooldown `2.2729885057471266`; after immediate repair allocation and two seconds, cooldown `0.25632183908046297`, hull damage improves from `0.5` to `0.4267193750000002`. Automatic repair also allows actual firing: the intent gate checks the repair key, not `ship.repairing`. This latter behavior may be intentional when one hand remains on guns, but the fixed reload borrowing is the exploitable part.

Smallest fix: store reload work/progress and advance it using the live assigned gun crew, or introduce an explicit reassignment delay that persists through save/reload. Test a swap during reload against staying in gunnery and staying in repair. Keep the existing total-ten validation.

## P2 — save validation is incomplete and restoration is not atomic

Sources: `GameSimulation.ts:91–103`, `427–453`.

The recursive finite-number check only validates fields that exist. It does not require numeric fields, validate tuple contents, enforce crew totals, or validate phase-dependent voyage arrays/IDs. `restoreSave` commits `this.state` and seed before iterating runtimes and rebuilding world state.

Reproductions in `critic-gameplay-save-schema.test.ts` all begin with a valid exported encounter save and change just the stated field:

| Modification | Result |
|---|---|
| Delete `state.voyage.upgrades` | `restoreSave` returns true; next tick throws `TypeError: this.state.voyage.upgrades is not iterable`. |
| Delete player `heading` | Restore returns true; next tick produces a non-finite heading. |
| Delete `state.progression.bankedCoins` | Restore returns true with a non-finite/undefined bank balance. |
| Set `runtimes` to `[null]` | Restore throws `TypeError: .for is not iterable` after replacing the previous state. |
| Set each crew station to 100 | Restore returns true and retains all 400 assigned crew. |

The last case is not a demand for anti-cheat in a local game. It demonstrates that continuation bypasses invariants enforced by normal gameplay APIs. Likewise, no server-authoritative persistence is implied.

Smallest fix: validate all required fields and enums, bounded finite numerics, crew total, runtime/projectile tuple shapes, unique ship/runtime IDs, referenced target IDs, progression counters, known contract/build IDs, and phase-required encounter/routes/reward state. Hydrate into temporary state first; commit only after validation succeeds. Failure must return false and leave the old simulation untouched. Add corruption cases to the existing version/NaN test.

## P2 — storm gate reward can be earned without using the gate

Source: `GameSimulation.ts:491–492`. Contract objective: “Sail through the central arch to the gate beyond it.” Only distance from the destination is checked; no passage state exists.

The ordinary-input test `critic-gameplay-storm.test.ts` uses throttle and steering to follow waypoints west of the arch, with no position or damage overrides. It crosses the arch's Z plane at X `-173.21552042754325`, outside the central opening, then approaches the reward waypoint from behind.

Observed: `reward` phase in `38.41666666666577` seconds, hull damage `0`, no central arch crossing, `175` coins awarded.

Smallest fix: persist ordered crossing state (approach, central arch crossing, downstream gate), require a forward crossing inside the opening, and award only after that sequence. Alternatively change the contract to truthfully request reaching the destination; that would give up the advertised gate challenge.

## P2 — finishing decisions have limited persistent consequence

Sources: `GameSimulation.ts:408–418`, `456–477`, `551–561`, and boss creation in `chooseRoute`.

Spare sets `finish.state = spared` and grants 45 coins plus 20% special, but the ship remains surrendered indefinitely. It does not sail away, update the rival's escapes, or alter a later encounter. A spared final captain followed by successful settlement is counted as defeated; the different returning boss is selected only after a lost/extracted boss settlement increments escapes. Salvage grants 90 coins and later sinks the target; scuttle gives 30 and starts sinking immediately. Beyond the timing and payouts, scuttle has no countervailing gameplay advantage.

Smallest fix: connect a spared named captain to a persisted escape/mercy record and actual departure, and consume that record on a later voyage. Give scuttle a stated consequence that can make it rational (for example removing an ongoing hazard or denying reinforcement), or avoid presenting the three choices as an established strategic tradeoff. This issue is independent of the P1 visibility/freeze defects.

## Balance and coverage limits

Baseline `npm test` passed: 3 files / 26 tests at 21:20:55. The existing full-voyage test directly sets enemy hull damage to 0.99 each leg. It verifies progression wiring, not a winnable three-leg combat loop. Existing tests positively cover repeat payout prevention after a completed save, refit limits, failed-run nonpayment, partial salvage persistence, selected-ship continuity, world collision, discovery persistence, and projectile continuation.

A deterministic ordinary-input combat controller was run on the first measured Dawn Blockade fight using default crew allocations, round shot, steering, aiming, and specials; it did not edit damage or positions. Results:

| Ship | Build | Outcome | Seconds | Player hull damage | Enemy hull damage |
|---|---|---|---:|---:|---:|
| Thousand Sunny | precision | reward | 27.93 | 0.561 | 0.999 |
| Thousand Sunny | interceptor | failed | 53.10 | 1.000 | 0.902 |
| Thousand Sunny | guardian | failed | 33.08 | 1.000 | 0.675 |
| Red Force | precision | reward | 30.83 | 0.479 | 0.959 |
| Red Force | interceptor | failed | 18.15 | 1.000 | 0.610 |
| Red Force | guardian | failed | 32.37 | 1.000 | 0.894 |

This controller emphasizes broadside combat and cannot prove interceptor/guardian are unwinnable. It does demonstrate why the three-build acceptance cannot be inferred from multiplier definitions or damage-injected test completion. Require successful full three-leg ordinary-input runs with each build using its intended tactics, including at least one escort and the final boss. No claim of an escort softlock is made here.

Shared world catalogue and arch pylon collision have existing positive tests. No separate reproducible world-generation/collision softlock was established in this review. The storm bypass is an objective validation problem, not a failed collision test.

Uneven frame batch replay (`30 × 1/60` versus `10 × (1/120 + 1/24)`) matched with aim correction and staged fire. A JSON save after that salvo and 180 more ticks also matched exactly. Special windup, pending salvo records, runtimes, projectiles, and payout ledger are present in normal exports. No duplicate payout exploit through the ordinary completed-save flow was found.

## Reproduction artifacts

- `output/overhaul-gauntlet/critic-gameplay-probes.test.ts` — seven targeted behavior probes.
- `output/overhaul-gauntlet/critic-gameplay-save-schema.test.ts` — malformed-save cases.
- `output/overhaul-gauntlet/critic-gameplay-storm.test.ts` — genuine control-input storm bypass.
- `output/overhaul-gauntlet/critic-gameplay-builds.test.ts` — combat sample/controller.

Run each with `npx vitest run <path> --reporter=verbose`. These are diagnostic artifacts asserting the reviewed behavior, including defects; do not adopt the defect expectations as permanent regression contracts. Invert or replace those assertions when fixing the game. No production source was modified by this review.
