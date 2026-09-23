# Blind visual critique — pass 08

Reviewed only the eight PNGs in `output/overhaul-gauntlet/pass-08/`, all eight `docs/art-direction/concepts/*.png` images, and selected target `output/art-overhaul-2026-09-06/concepts/A-cinematic-anime.png`. No source, scenario JSON, earlier critique, or browser inspection informed this review. These are still-image judgments; animation, gameplay behavior, and off-camera content are unverified.

## Verdict

**Overall proximity to the selected cinematic-anime target: 3/10. Not approved for visual parity.**

The palette, cloud painting, recognizable ship colors, emblems, and recognizable naval setting establish the intended theme. The actual foreground rendering is still a simplified low-poly game scene. The target depends on a densely constructed hero ship, human-scale working crew, sculpted landforms, deep warm/cool lighting, and a forceful sea that physically embraces every hull. Those qualities are largely absent or substantially weaker in these captures. Attractive clouds do not bridge that gap.

Scores are subjective visual comparisons, not measured completion percentages. Ten means comparable authored quality and spectacle at the shown camera scale; five means a coherent approximation with significant simplification.

| Dimension | Score / 10 | Visible evidence |
| --- | ---: | --- |
| Theme and color recognition | 7 | Cream sail, red/gold hull, blue sea, orange figurehead, and lavender cloud shadows convey the intended world. |
| Sky art | 7 | Layered, illustrated cloud shapes are the closest element to the concepts. Their intricacy makes the sparse geometry below them more conspicuous. |
| Ship topology and silhouette | 3 | Narrow, simplified hulls; few authored deck levels; thick blocklike fixtures; smooth spars; schematic cabin and rail construction. |
| Materials and small surface detail | 2.5 | Large flat color areas, weak metal/wood separation, little visible joinery or wear; sails read as broad facets rather than cloth under tension. |
| Lighting and volume | 3 | Some cast shadows are visible, but weak contact darkness and material response flatten deck fittings. Fog scenes lose depth; night has little localized warm light. |
| Water and hull interaction | 4 | Wave displacement and turquoise/deep-blue variation work at a broad level. Smooth surface lobes, swollen foam patterns, and detached hull markings do not resemble the concepts' sharp breaking water. |
| Islands and environmental scale | 2 | Large pale plinths, few spikes, minimal vegetation, and a visibly segmented arch substitute for layered cliff faces and inhabited coasts. |
| Crew anatomy and task readability | 2 | Oversized heads, small mittenlike extremities, simple outfits, idle-looking upright poses, and little visible prop contact in the close views. |
| Composition and spectacle | 3 | Mostly centered rear views with substantial empty water. Hero identity is hidden by the stern and red sail; combat lacks the target's large, separated hero/enemy staging. |
| Combat/damage image impact | 2.5 | Broadside projectiles read as small black dots. Damage reads mainly through HUD values, torn sail edges, and one large soft smoke mass. |

## Five highest-impact changes

### 1. Rebuild the hero ship's visible construction before adding more decorative effects

**Evidence:** `sunny-broadside.png` shows a narrow toy-like hull and a nearly empty readable deck. `crew-closeup.png` exposes the simplified cabin, large smooth rail strips, low-detail cannon blocks, low-poly spherical foliage, and a flat rectangular lawn. The concepts' ship is a broad, deep vessel with a strong curved sheer, a massive sculpted figurehead, nested raised decks, distinctive ribs, substantial gunports, and a dense hierarchy of rails, ladders, fittings, and foliage.

**Engine action:** Give the hero hull a broader rounded bow and stronger vertical depth; construct raised forecastle/quarterdeck platforms with readable stairs; model the figurehead in volumetric layers; replace featureless rail bands with supported rails and balusters; give cannons barrels, carriages, wheels, and recesses. Break the dome into shaped roof panels and give its windows real recesses. Introduce plank joints, hull strakes, fasteners, edge wear, and distinct painted wood/varnished wood/dark iron/brass roughness. Sculpt sail curvature around attachments and add restrained cloth folds rather than broad planar shading wedges.

**Acceptance image:** A close three-quarter hero view should be visually rich even with the sky removed and no effects active. Silhouette, deck levels, material separation, and fixture scale must carry the image on their own.

### 2. Replace generic island primitives with an authored coastal landmark

**Evidence:** The arch in `calm-sailing.png` is a short sequence of huge flat-edged segments with a pale crack texture. The islands in `sunny-broadside.png`, `storm-sailing.png`, and `night-encounter.png` read as shaved plinths with a few vertical blocks. `island-discovery.png` places a nearly featureless rock face behind the ship. The concept arch is an inhabited geographic formation: fractured strata, overhangs, shaded recesses, multiple terraces, vegetation clinging to ledges, waterfalls, architecture, and shoreline structure all reinforce enormous scale.

**Engine action:** Author one landmark region rather than spreading more simple pillars across the horizon. Use irregular layered cliff meshes with meaningful recesses and broken silhouettes; add terraces and clustered vegetation at multiple heights; build several compact town clusters with different elevations and rooflines; integrate a waterfall into a recess and a foaming basin. Add smaller shore rocks, a coastal ledge, and intermediate landforms to connect water to cliff. Use directional rock color variation and crevice shading instead of relying on a fine crack texture over giant flat faces.

**Acceptance image:** From a wide passage camera, the arch should still read as geological, inhabited, and immense without requiring close inspection. Its base should meet a designed shoreline rather than simply intersect the water plane.

### 3. Make the sea break against the hull instead of surrounding it with a surface pattern

**Evidence:** `sunny-broadside.png` has large blurry, inflated white patches across rounded wave lobes. `crew-closeup.png` and `crew-repairs.png` reveal dashed white arcs alongside the hull that look like a graphic selection ring. The ships sit in the ocean without the targets' connected bow collision, aerated waterline, turbulent troughs, spray, or long directional wake. `storm-sailing.png` increases surface roughness, but the visible hull contact remains weak.

**Engine action:** Sharpen selected wave crests and make whitewater follow crest steepness and travel direction. Layer finer broken foam over broad water color forms rather than expanding a smooth white threshold. Replace the dashed hull-adjacent pattern with a continuous, irregular contact band that tears into streaks; add bow wedge foam, sparse upward spray, stern churn, and a tapered wake. Keep these effects localized and strongly connected to hull displacement. Use a darker wet waterline to anchor the ship, with foam naturally crossing in front of its lower hull.

**Acceptance image:** At normal sailing speed, the bow visibly pushes water aside and the stern leaves a directional wake. No evenly spaced dashed ring is visible. Foreground foam resolves into energetic torn shapes rather than a soft repeating cellular pattern.

### 4. Upgrade crew from tokens to characters visibly performing work

**Evidence:** `crew-closeup.png` is the clearest validation view and shows very small bodies beneath large heads, simplistic hair/outfits, heavy dark faces, and mostly upright idle-looking silhouettes. In `crew-repairs.png`, crew occupy the deck but the capture does not clearly show a hammer striking, a plank held to damage, or hands gripping a working fitting. Concept 06 relies on individual anatomy, costume silhouette, weight, gesture, and hand-to-tool contact to make the ship feel occupied.

**Engine action:** Rework proportions toward the concept's stylized human figures; preserve distinct costumes while improving elbows, knees, hands, hair shapes, and face readability. Give each visible station a strong working pose: a bent-back cannon loader cradling a ball, a sailor bracing and hauling a rope, a helmsman gripping the wheel, a kneeling repairer holding a plank and hammer. Add station props and ensure actual hand placement meets them. Avoid distributing idle characters evenly across open deck space. Brighten controlled face planes and garment accents while keeping directional shadows.

**Acceptance image:** A silent still frame must communicate at least three different jobs without the crew-order HUD. Two visible hands should demonstrably contact their task objects. At deck camera scale, crew should read as expressive stylized people rather than board-game pieces.

### 5. Stage the camera and light around a large hero subject and a readable dramatic event

**Evidence:** The normal ship occupies a relatively small central area in `calm-sailing.png`, `storm-sailing.png`, and `island-discovery.png`. Their rear angle hides the most distinctive bow design. `sunny-broadside.png` still shows the stern and places an enemy directly behind the hero, reducing silhouette separation. The rendered combat moment has little visible muzzle flash, smoke, or splash scale relative to the target. `damaged-ship.png` makes damage difficult to assess because the ship is very small. `night-encounter.png` remains broadly blue-lit without strong lantern pools or rim separation; the fog frames flatten sea, sky, and ship values.

**Engine action:** Add a lower three-quarter sailing/broadside camera that puts the hero hull in a foreground third, reveals its bow and deck, and separates the enemy on the opposing third. Keep practical navigation visibility, but frame landmarks beyond the action rather than directly as blank backdrops. Build warm directional key light with cooler shadow planes and deliberate contact shading under fittings; at night, use restrained moon rim light plus visible warm lantern pools and narrow reflections. Stage the volley capture at the readable event peak: differentiated muzzle flashes, layered smoke, a small number of large clear projectiles, and vertical impact plumes in the gap between ships. Frame damage close enough that listing, torn cloth, broken structure, embers, and smoke shapes are legible.

**Acceptance image:** The primary subject and action should be obvious when the screenshot is reduced to thumbnail size and the HUD is hidden. The crew/deck should retain internal light/shadow structure. Night should read through motivated light sources, not just a darker blue version of daytime.

## Capture limitations and evidence gaps

- No embark/harbor screen or voyage-chart screen is included. Concepts 01 and 08 cannot be judged as implemented or missing from this set; only their shared ship/environment art can be compared.
- No matched wide arch-passage composition appears. The arch is visibly present in `calm-sailing.png`, but distant/off-camera settlements, waterfalls, and a complete passage experience cannot be declared absent from the project. The visible nearby landforms are materially simpler than the target.
- The damage/repair frames feature the Going Merry while the damage concept centers on an enemy ship. They verify a damaged player-ship appearance in stills, not the concept's enemy-defeat composition or sinking sequence.
- The stills do not establish that crew never animate, cannon effects never appear, or wakes never evolve. They do establish that those qualities are not convincingly communicated in the selected validation images.
- HUD typography is generally legible, but its small translucent panels have a different visual identity from the concepts' large illustrated nautical controls. This is a secondary priority while the world remains far below the target's construction and staging quality.

**Recommended order:** ship construction/materials, one authored coastal landmark, hull-contact water, working crew, then lighting/camera/effect staging. Capture matched three-quarter, crew-work, and wide-arch frames after those changes. More global saturation, more cloud detail, or a stronger vignette will not resolve the core mismatch.
