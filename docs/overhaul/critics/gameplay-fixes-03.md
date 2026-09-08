# Gameplay recovery fixes — round 03

Implemented on 2026-09-06 after the four semantic failures in the fresh critic's probes. Source changes in this round are confined to `src/simulation/saveValidation.ts`; regressions extend `tests/voyage-semantics.test.ts`.

- Race checkpoint indices must fit the actual course, for both ship runtimes and the displayed race state. Active race courses require at least two checkpoints. Race lap/finish bounds prevent out-of-range runtime states while allowing the final checkpoint, lap wrapping and a completed race to reload.
- Version 1 uses `timeScale=1` throughout normal runtime. Save recovery requires that clock; zero, near-zero and altered clock rates are rejected. Manual pause remains a separate, resumable saved property.
- Battle/boss progress corresponds to the count of surrendered required targets; completed battles require every target to be disabled. A legitimate same-tick player loss may stop the objective update before its progress counter catches up, so that terminal case remains reloadable.
- Salvage requires its authored 12-second hold; escort requires 75 seconds. Timed hold progress cannot exceed total encounter elapsed time.

Validation:

- **119 / 119 maintained tests passed**, across seven suites.
- **9 / 9 untouched critic-03 probes passed.** The normal-play probes include all 27 ship/build storm combinations, an input-driven salvage and extraction, aftermath sailing, and a combat bot that won leg one then legitimately lost leg two and restarted. This is not a claim that the bot completed a full winning combat voyage.
- `npx tsc --noEmit` and `git diff --check` passed. No browser was opened by this task, and no performance result is claimed here.

The original critic probe output remains preserved. The new rerun is `critic-gameplay-03-resolved-results.log`.

The separately prepared `scripts/profile-gauntlet.mjs` passed syntax and dry-run checks. Root owns its live execution so no concurrent browser competes with the ongoing GPU captures.
