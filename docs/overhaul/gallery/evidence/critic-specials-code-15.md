# Bounded source follow-up — build 15

Verdict: **PASS. No regression found in this small change.** No browser use or runtime edits; no broader audit repeated.

- `polarCrewSheltered(state)` preserves the previous visibility expression exactly: only Polar shelters, after strictly more than half of windup, throughout active/recovery, and never without a phase. The model negates the shared predicate as before. The former model-kind check and new state-kind check are equivalent on this path because `ShipFleetView.sync` recreates a model whenever its kind differs from the state.
- The HUD uses that same predicate for `CREW INSIDE` versus `CREW ON DECK`, while preserving `REPAIRS UNDERWAY` precedence. This removes the contradictory on-deck label during a dive without changing simulation phases or crew visibility timing.
- Both base and narrow-screen `.weapon-row` rules now use `repeat(3, minmax(0, 1fr))`; no later weapon-row override was found. The source provides equal battery-column widths. Actual text fit remains a browser-capture check.
- The harness reads the displayed `[data-ui="repair"]` text and asserts `CREW INSIDE` in both active and recovery snapshots. These are checks of the browser label, not inferred state-only assertions. They were inspected, not run by this reviewer.
- The existing Polar capsule-contact/sheltering test passes (1 test; remaining file tests skipped by the name filter). Targeted `git diff --check` passes.

Command:

```sh
npm test -- --run tests/ship-presentation.test.ts -t 'places Polar crew feet'
```

The build-14 code verdict and build-13 mechanics verdict are unchanged by this extraction and HUD/CSS update.
