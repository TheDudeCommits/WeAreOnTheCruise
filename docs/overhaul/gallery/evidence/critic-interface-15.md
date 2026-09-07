# Blind HUD screenshot review — interface 15

Scope: all 24 PNGs in `ui-15`, plus `specials-15/polar-tang-active.png`, `polar-tang-surfacing.png`, `polar-tang-surfaced.png`, and `thousand-sunny-active.png`. Only these images were read. No source, metadata, earlier reviews, browser, or runtime inspection. This is a bounded visible-interface review, not a whole-game quality verdict.

## Findings

1. **P2 — Bright special effects wash out the special-status strip.** In `thousand-sunny-active.png`, the pale/gold burst crosses the lower-right HUD. The battery cards retain enough dark backing to read READY, but the thin SPECIAL / ACTIVE 0.7s row, progress line, and C hint below them lose considerable contrast. That row needs its own reliably dark backing through the full effect area, with larger status text. This is the most material visible status-readability issue in the supplied special frames.

2. **P2 — STARBOARD crowds the E hint.** In `desktop-helm.png`, `landscape-helm.png`, and the desktop special frames, the end of STARBOARD runs into the small E keycap on the same header line. The card's READY/SUBMERGED/SURFACING state remains readable; the label/key relationship is cramped. Reserve separate space for the keycap or shorten the header consistently to STBD.

3. **P2 — Portrait helm controls obscure much of the ship's lower silhouette.** In `portrait-helm.png`, the steering pad overlays the left hull and the action grid overlays its right side; the speed panel then covers the lower-left scene. These translucent overlays contain readable labels, but their borders and text compete with the boat at the center of attention. The frame still has an open upper scene. A smaller ship framing or more consolidated control arrangement would preserve more of its hull and surrounding water. This is a visual occlusion finding only; the image cannot establish whether aiming or touch operation is impaired.

4. **P3 — Unbacked corner information loses contrast against clouds.** In `desktop-helm.png`, `landscape-helm.png`, and `desktop-restored.png`, the upper-right WANTED/currency area sits over near-white clouds and is substantially harder to read than the backed status cards. The pale voyage/chart header at upper left has the same weakness in some special frames. A compact dark backing would make these labels dependable across backgrounds.

## What reads clearly

- Polar Tang's battery states are explicit: SUBMERGED in the active frame, SURFACING during emergence, and READY once surfaced. CREW INSIDE changes to CREW ON DECK in the surfaced frame. The state words are not clipped in these supplied images.
- Port, bow, and starboard battery cards remain individually distinguishable on desktop and both phone orientations. The portrait READY cards fit inside the screen.
- Hull/sails/crew labels, values, and bars fit their cards. Landscape's compact ship-status row preserves the values without overlapping the central compass.
- Route, contract, restored-voyage, crew-order, and pause panels show clear titles and selected options. Portrait route and restored-voyage panels display their main choices and bottom action without horizontal truncation.
- Long phone panels have visible scrollbars. The supplied landscape contracts/restored/pause frames and portrait contracts/settings frames show only part of their content; these stills do not establish a scrolling failure or inaccessible content. Some HUD shows through the translucent menus, but foreground text stays readable.

All four special screenshots visibly say VOYAGE PAUSED. No claim is made about their timers advancing, input response, animation continuity, performance, or restoration behavior.

## Bounded assessment

The supplied current HUD has legible and differentiated weapon/surfacing state words. The remaining visible priorities are special-strip contrast during the Sunny effect, starboard/keycap spacing, and portrait scene occlusion. No missing or clipped battery state word is evident in this screenshot set.
