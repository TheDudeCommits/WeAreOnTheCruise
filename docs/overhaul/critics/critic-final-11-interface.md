# Independent screenshot follow-up — pass 11 interface

Inspected with `view_image`, without browser, source, or test receipts:

- `aim-11/portrait-port-touch-aim.png`
- `aim-11/portrait-starboard-touch-aim.png`
- `aim-11/portrait-port-multitouch-reload.png`
- `aim-11/landscape-port-touch-aim.png`
- `ui-11/landscape-routes.png`
- `ui-11/portrait-helm.png`

## Specific defects

**The specific captured overlap and close-control defects are visually resolved in these images.**

| Earlier concern | Pass 11 visible result | Judgment |
| --- | --- | --- |
| Portrait LOOKOUT toast obscures aim flight information | Aim instructions now occupy a compact strip near the top; lookout dialogue sits separately above the controls. The full impact-distance and flight-time line is readable in port, starboard, and reload captures. | Resolved in inspected frames. |
| Portrait SPECIAL/bottom HUD competes with Crew Orders | Special readiness is shown within the SPECIAL action button. Battery cards end above a separate full-width Crew Orders row. The crew allocation line fits below it in both aim and helm screenshots. | Resolved in inspected frames. |
| Landscape route header/close control mostly outside captured view | “Choose your passage,” voyage label and complete close X are visible above the two route cards while the content is scrolled. | Resolved in inspected frame; this is visual evidence, not a click test. |

No new text collision or clipped control is evident in these six screenshots at the supplied dimensions.

## Remaining readability

Portrait aim is materially clearer. Removing the chart/compass clutter from this aiming state and moving the compact aim instructions away from the central water view creates a useful unobstructed band. The separate one-line lookout strip is a sensible improvement. Battery READY/reload labels remain readable, and crew status no longer fights the bottom control cluster.

It is still a dense interface. Portrait keeps four steering buttons, ten action buttons, three battery cards, ship/sail statistics and crew controls visible simultaneously. Tiny keyboard chips remain on a touch screen, and `HARD` still depends on prior explanation. These are remaining usability/design concerns, not established functional failures.

The portrait port target is offscreen, and the starboard target is only a narrow hull slice at the left edge. The offscreen arrow communicates direction, and the aim message explicitly says to turn the broadside to bear; therefore these captures do not prove a targeting defect. They also do not demonstrate the intended well-composed aiming moment with the target actually in the firing field. That visual acceptance case remains absent from the inspected images.

Landscape aim still devotes much of its short viewport to the upper ship/speed/compass stack, target panel, central instruction panel, bottom lookout panel and right action/battery grid. Its target is visible, which is useful, but several UI elements sit over the enemy's sail and hull. The layout is orderly rather than overlapping; the concern is how much attention and combat space it consumes.

The portrait helm capture still has low-contrast moments where bright sea foam shows through transparent action buttons and ship-status panels. The principal labels are readable in this frame, but stronger local backing would make readability less dependent on the water beneath them.

**Phone readability judgment: approximately 5/10 overall, improved from the pass 10 aim assessment.** The clear overlap fixes should be credited without treating the remaining dense composition as solved.

## Boundaries

This report verifies visible presentation only. It does not establish that taps, simultaneous touches, aim holding, firing, hit resolution, reload timing, or close-button interaction work. Test totals reported elsewhere are not used as evidence for this judgment.

The scene artwork was not reassessed in this narrow follow-up. The separate pass 10 art verdict remains **4/10 concept proximity, below the requested cinematic anime spectacle**. Resolving phone layout defects does not close the ship, environment, crew, combat-effect, and staging gaps documented in `critic-final-10.md`.
