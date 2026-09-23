# Independent visual critique — pass 01

Reviewed only the supplied images. No implementation narratives, source code, measurements, or other critiques were read. The concepts are visual targets, not implementation evidence.

## Evidence

Actual rendered captures:
- `output/overhaul-gauntlet/pass-01/calm-sailing.png`
- `output/asset-gauntlet/thousand-sunny-cinematic.png`
- `output/asset-gauntlet/thousand-sunny-crew.png`
- `output/asset-gauntlet/navy-galleon-cinematic.png`
- `output/asset-gauntlet/navy-galleon-crew.png`

Approved comparison images:
- `docs/art-direction/concepts/02-the-hero-ship.png`
- `docs/art-direction/concepts/03-living-sea.png`
- `docs/art-direction/concepts/07-arch-passage.png`
- `output/art-overhaul-2026-09-06/concepts/A-cinematic-anime.png`

## Resemblance scores

Scale: 1 = little resemblance beyond subject matter; 5 = substantial structural resemblance with visible gaps; 8 = credible realization of the approved direction; 10 = close visual match. These are visual judgments, not pixel metrics. A different camera angle is allowed, but the target's visual hierarchy and sense of scale still need to survive gameplay framing.

| Task | Form | Material | Lighting | Scale | Composition | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 2 — vessels | 3/10 | 2/10 | 2/10 | 3/10 | 3/10 | **FAIL** |
| 3 — sea and sky | 2/10 | 2/10 | 2/10 | 3/10 | 3/10 | **FAIL** |
| 7 — terrain and arch | 2/10 | 1/10 | 2/10 | 2/10 | 2/10 | **FAIL** |

### Task 2 — vessels

The Sunny's lion figurehead, warm hull, circular stern cabin, pale main sail, and fruit trees establish recognition. The enemy has three masts and a distinct blue-white palette. These are useful starting points.

The target's main identity, however, depends on a deep rounded hull, nested deck levels, substantial bulwarks, recessed gun ports, dense functional rigging, and curved cloth. The actual Sunny reads as a long shallow open boat with a single flat deck. The navy vessel reads as an angular barge with a box cabin. Long thin black rods protrude across the rails and visually read as spars or oars; they do not communicate the target's thick recessed cannon barrels and gun decks. Hull planks have lines, but little visible grain, bevel, wear, occlusion, or tonal variation. The sail rectangles have almost straight silhouettes and broad flat color regions rather than a full wind-loaded shape with seams and folds.

The cinematic Sunny capture clips the top of the sail, while the navy capture leaves most of the frame as empty water. The calm chase camera shows a large blank rear sail near the center, concealing the deck and much of the destination. Neither captures the target's readable relationship between ship construction, crew, and world.

### Task 3 — sea and sky

The ocean has color variation and a suggestion of undulation. It does not yet have the target's deep cobalt troughs, luminous turquoise wave faces, sharp irregular foam crests, dense fine surface detail, and convincing hull-water contact. In the lower half of the calm capture, broad blurred cyan patches dominate; near the horizon, the surface becomes a repeated noisy pattern. The pale strips beside the asset-view hulls look detached and geometric instead of disturbed water flowing around the hull.

Clouds are a dominant mismatch: huge visibly faceted overlapping ellipsoids with hard horizontal color cuts fill much of the upper frame. The references use towering irregular cumulus silhouettes, many smaller edge lobes, warm highlights, cool lavender shadows, and blue gaps that establish depth. The actual sky is pale and low contrast, with little distinction between foreground light, distant haze, and cloud volume.

### Task 7 — terrain and arch

The calm capture establishes an arch and a palm-topped island, but the arch resembles a smooth constructed semicircular ring on two matching supports. The neighboring cliff is a broad cream slab with a nearly level grassy cap. Visible materials offer little rock structure, erosion, ledges, fissures, vegetation clustering, or shaded cavities. Thin waterfall marks do not create the scale or water impact of the reference.

In the approved arch image, the landmark occupies most of the scene, dwarfs multiple vessels, and connects irregular cliff masses. Settlements, rock pillars, vegetation, and layered coastlines supply intermediate scale cues. In the actual capture, the arch sits at the left edge at a scale comparable to nearby ships, while a relatively blank slab dominates the right. The navigation route has no equivalent monumental framing or inhabited coastline density.

## Five highest-impact feasible corrections

1. **Rebuild the vessels' primary proportions before adding small decoration.** Deepen and round the Sunny hull, raise and articulate its stern, introduce clear foredeck/main-deck/stern levels, and add substantial pale structural ribs and bulwarks. Give the navy vessel a deep multi-deck hull and raised stern silhouette. Replace the rail-height black rods with short thick barrels seated in visible ports. Bow the sails and scallop their lower edges; add batched rigging and rope ladders. Use shared materials and a coarse distance LOD. Acceptance: each vessel should read as a substantial sailing ship in an untextured silhouette and retain that identity from chase distance.

2. **Make the ocean's shape, color, and foam agree.** Use a few large directional wave components for readable wave faces, smaller normal detail for sparkle, darker trough color, and brighter turquoise on crests and shallow coastal water. Break up crest foam into narrow irregular streaks and speckles. Replace isolated pale hull strips with a bow contact band and tapered, disturbed wake tied to motion. A modest displaced grid plus shader detail and pooled foam geometry can deliver this without expensive screen-space reflections. Acceptance: a still frame should show wave direction and shape immediately, with the hull visibly displacing water.

3. **Restore a deliberate sun-and-shadow palette across the scene.** The current pastel midtones flatten wood, cloth, cloud, and rock together. Establish warm directional sunlight, cool blue-violet shaded faces, deeper contact shadows under rails and cabins, and a more saturated upper blue sky. Give wood, sailcloth, painted trim, rock, and foliage different roughness and restrained texture variation. Keep the distant horizon softer while preserving near-object contrast. Use limited shadow coverage around the player and baked or vertex occlusion for static detail. Acceptance: materials and volumes should remain distinct even in a grayscale comparison, without crushing the crew or deck into black.

4. **Replace the oversized cloud ellipsoids with composed cumulus groups.** Build fewer intentional cloud towers from varied lobes, soften visible faceting, break the repetitive lower-edge bands, and add smaller distant cloud layers. Reserve blue openings above and through the route. Mesh clusters with distant impostors or a compact layered sky treatment are sufficient; volumetric ray marching is unnecessary for this target. Acceptance: clouds should frame the scene and communicate atmospheric distance, rather than resembling nearby suspended stones.

5. **Turn the arch into a large navigable landscape and frame its approach.** Enlarge the opening and cliff mass so several full-height ships fit beneath it, roughen the outer and inner silhouettes, use asymmetric supports, and add broken ledges, cool rock crevices, vegetation patches, thin continuous waterfall ribbons, and foam at their bases. Populate selected ledges with instanced buildings and palms for scale, then layer smaller pillars and coastlines into the distance. Adjust the approach framing so the ship occupies a lower-third region and the arch remains readable above or beside the sail. Use repeated modular meshes and distance LODs. Acceptance: the route should visibly lead through a landmark that dwarfs the vessels; the same scene should remain legible during play, not only in an asset viewer.

## Acceptance boundary

All three tasks fail against the approved cinematic-anime target on the supplied rendered evidence. The shortfall is in primary form, surface hierarchy, lighting, scale, and staging; it cannot be resolved by UI polish or a color filter alone. This judgment does not require photorealism or a literal reconstruction of every concept detail.

The user's 40–60 fps goal is unverified: still images cannot establish frame rate, animation quality, camera behavior, or sustained performance. The corrections above deliberately favor bounded mesh detail, instancing, LOD, simple wave displacement, and economical shadows, but their performance must be measured in the actual populated runtime. Any next acceptance set should include a gameplay approach frame, a full-height three-quarter view of each vessel, a close hull-water-contact frame, and frame-time evidence from the same build.
