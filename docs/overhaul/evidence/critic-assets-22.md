# Independent blind visual critique — in-world-22

**Decision: REJECT for acceptance against the cinematic-anime target.**

**Overall visual score: 4.5 / 10.** This is a subjective assessment of the supplied stills, not a runtime or technical benchmark.

## Evidence and scope

Inspected only these six PNGs in `output/asset-gauntlet/in-world-22/`: `baratie.png`, `thousand-sunny.png`, `navy-galleon.png`, `moby-dick.png`, `going-merry.png`, and `polar-tang.png`. Compared them with `output/art-overhaul-2026-09-06/concepts/A-cinematic-anime.png`. No code, previous critiques, browser, or other evidence was consulted.

The reference establishes a strongly lit, illustrated ship with readable crew, rich but controlled surface detail, a forceful waterline, and large, sculpted waves. The candidates reproduce the bright blue/cream sky palette and recognizable ship silhouettes. They do not yet reproduce the unified illustration treatment or the sense of a heavy vessel participating in the sea.

## Assessment

| Criterion | Score | Visible evidence |
| --- | ---: | --- |
| Ship completeness | 6 / 10 | Each vessel reads as a recognizable assembled ship with a hull and characteristic upper structures. Going Merry and Thousand Sunny have the strongest silhouette and detail hierarchy. Baratie's very large empty side decks, Polar Tang's exposed angular lower body, and Moby Dick's largely undifferentiated white bow make the presentation feel unfinished. A single angle cannot establish unseen geometry completeness. |
| Material coherence | 4 / 10 | The fleet mixes flat saturated surfaces, visible wood textures, pale featureless trim, gray sails, and plain gray weapon shapes. Sunny is conspicuously dark against the brilliantly lit sky; Moby Dick loses separation across broad white surfaces; Polar Tang reads as a smooth yellow toy. None consistently achieves the reference's warm light, colored shadows, and deliberate edge definition. |
| Water immersion | 3 / 10 | Hulls generally meet the sea with little more than a thin contour. There is almost no convincing bow pileup, connected foam, or turbulent displacement around the ship body. Large lower hull areas remain visibly exposed. The boats read as laid over the water, especially Polar Tang and Going Merry. |
| Framing | 5 / 10 | All ships are contained and identifiable, and most retain clear silhouettes. Repeated centered, elevated inspection views leave substantial unused sea/sky. Navy and Moby Dick crowd the upper compass area with tall rigging. Sunny and Navy's sail stacks conceal much of their inhabited deck. The reference has a much stronger foreground subject and an intentional visual path through ship, action, and distant landscape. |
| Crew readability | 3 / 10 | Going Merry is the clear leader: two differently colored figures can be distinguished at the forward deck. Sunny and Moby Dick contain tiny human-like figures that are difficult to read at this scale. No distinct crew is readily legible on Baratie, Navy, or Polar Tang. Even the stronger example does not communicate stations or purposeful activity as clearly as the reference. |
| Cinematic-anime match | 4 / 10 | The sky is the closest match. Ship shading and detail have a different visual language from both the painted sky and the glossy, softly patterned sea. The sparse, blocky islands further expose the gap from the reference's detailed, illustrated world. |

## Three concrete acceptance blockers

1. **Unify the ships' materials and illumination into the target's illustrated treatment.** Give wood, cloth, painted hulls, trim, and metal distinct but compatible surface responses, with legible warm highlights and colored shadow planes. Correct Sunny's muddy gray/dark presentation and Moby Dick's broad white-on-white loss of form. Replace the visibly plain gray cannon plates/tubes on Navy with finished, readable metal forms. Reassess the fleet together so no vessel looks like a different rendering style.

2. **Make every ship visibly occupy and disturb the water.** Establish a believable waterline that occludes the appropriate lower hull, then attach foam and displacement to the bow and sides. Going Merry and Polar Tang currently show conspicuous straight wake strips; replace their flat, hard-edged appearance with a wake that blends into the sea and follows the vessel. The contact must remain convincing without relying on a distant patch of white sea texture to imply a wake.

3. **Make the gameplay camera show an inhabited ship with a deliberate composition.** Use each vessel's proportions to keep its deck and crew visible, reduce sail occlusion where practical, and give crew adequate screen size, contrast, and distinguishable poses. Fill Baratie's conspicuously empty deck presentation with purposeful visible detail. Keep tall masts clear of the compass. The fleet should communicate people operating a ship, rather than six isolated model portraits beneath a detailed sky.

## Visible rendering defects and per-ship notes

- **Going Merry:** Best combined ship/crew readability, but the stern wake contains translucent straight-sided strips with hard angular endpoints. Small detached fuzzy white puffs near the bow/below the hull do not form a coherent splash. The narrow bright outline along the underside does not convincingly join the hull to the water.
- **Polar Tang:** A similarly conspicuous pale rectangular wake strip sits behind the right-hand stern area. Its exposed lower body terminates in a sharp, clean silhouette with virtually no waterline interruption or foam, producing a particularly strong floating-model impression. The large yellow panels have little light/shadow or material complexity to establish weight.
- **Thousand Sunny:** Recognizable lion bow, red hull, trim, and domed structures. Gray sail shading and dark deck/hull values make the subject feel underlit relative to the saturated environment. Pale trim reads stone-like in places. The prominent forward sail hides much of the deck, and crew scale is insufficient for clear reading.
- **Navy galleon:** Strong mast/sail identity and comparatively rich rigging, but sail overlap hides the working deck. Forward weapons look like unfinished gray disks and tubes. The lower hull has a conspicuous dark diagonal pattern that competes with the rest of the material treatment. The upper mast crosses into the compass region, reducing separation between scene and HUD.
- **Moby Dick:** Dense rigging and multiple decks make the vessel appear assembled, but most surfaces collapse toward the same cream-white value. The large rounded bow lacks the shading and detail needed to carry its screen area. Repeated sharply folded, triangular sail shapes read stiff at this angle. The mast/flag also crowds the compass region. A small dark figure provides minimal human scale but little readable crew activity.
- **Baratie:** Distinctive fish bow and central restaurant structure are present. The broad brown side platforms are conspicuously empty, and their repeated plank lines dominate the ship's detail. Flat green, pink, cream, and brown surfaces appear poorly integrated with one another. Minimal waterline disturbance makes the broad structure look suspended over the sea.

Hard-edged wake strips and weak water contact are visible findings; their implementation causes cannot be determined from these stills. I cannot establish actual buoyancy behavior, animation, temporal artifacts, FPS, hidden geometry, or asset provenance from this evidence. No obvious full-frame corruption or completely missing ship silhouette is visible, but that does not resolve the acceptance blockers above.
