# Gameplay integrity fixes — round 02

Implemented and validated on 2026-09-06 against `critic-gameplay-02.md` and its independent probes.

- Voyage payout IDs now use canonical seed-scoped positive serials. Restore rejects ledger serials beyond `totalVoyages` and a current voyage whose serial differs from the current counter. Starting a voyage allocates after both the counter and every existing paid serial, preventing a stale in-memory counter from reusing a payout ID. Seeds containing colons remain supported.
- Permanent upgrades already owned cannot appear among saved reward choices and cannot be applied again through `chooseReward()`. Supplies remain an immediate consumable and are available repeatedly across legs; they never enter the permanent upgrade array.
- Saved route offers must match every generated authored field and contain the complete unique offer set. Route selection also resolves the canonical offer at the command boundary.
- Encounter target IDs must reference non-player ships in the contract's opposing faction. Escort IDs must reference a distinct allied non-player ship outside the enemy target set. All nine selectable ships retain reloadable contracts, including the normally neutral Baratie.
- Full objective progress and completion must agree, with a valid completion time. Storm gate index and progress must agree; the existing canonical coordinates and ordered crossing checks remain enforced.
- The visible ship geometry and trajectory sampler now share the exported `cannonMuzzleHeight()` calculation. This refactor does not change physical launch heights.

Validation:

- `npm test`: **100 / 100 tests passed** across six maintained suites. The new `tests/voyage-semantics.test.ts` contributes 30 regressions covering corrupt route fields, command-boundary recovery, target references, all nine ships, storm contradictions, duplicate upgrades, repeated supplies, ledger identity corruption, and defensive ID allocation.
- `npx vitest run --config output/overhaul-gauntlet/critic-gameplay-02.config.ts`: **13 / 13 independent probes passed**, including all five previously failing safe-rejection cases and all eight normal-play probes.
- `npx tsc --noEmit`, `npm run build`, and `git diff --check`: passed. Vite retains its existing large entry-chunk advisory.

These checks prove the tested simulation and persistence behavior. They do not establish combat balance, visual acceptance, or GPU frame rate. The original critic report and pre-fix log remain preserved; a fresh critic may review these changes independently.
