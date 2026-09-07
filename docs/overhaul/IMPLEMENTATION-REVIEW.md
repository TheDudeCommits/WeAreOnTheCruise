# Downloaded-asset correction — current implementation review

Updated 2026-09-07. **The runtime now uses actual downloaded Sketchfab ships and crew. Target-A visual acceptance remains rejected.** This supersedes the asset claims in [historical build 15](IMPLEMENTATION-REVIEW-BUILD-15.md). Exact release identity belongs in [RELEASE.md](RELEASE.md).

## What changed

The generated hull files, procedural replacement-ship construction and old hull loader were removed from the public/runtime path. Six complete downloaded vessels now supply the actual hulls, figureheads, decks, sails, rigging and fittings: Sunny, Merry, Marine ship, Moby Dick, Polar Tang and Baratie. High/low LODs preserve source meshes, UVs and textures through uniform normalization, simplification, WebP and Meshopt. Untextured Moby/Baratie receive material styling on their source surfaces. Every source is credited in the menu-linked public credits and hashed in the [runtime manifest](../../public/assets/sketchfab/manifest.json).

Luffy, Nami, Sanji and Whitebeard are downloaded character models, retaining their source skeletons and available clips. Source-deck raycasts place three characters each on Sunny/Merry and one each on Moby/Baratie. Navy/Polar have no exterior character model yet. Visual crew currently use idle/posed clips and balance motion; tactical allocation is implemented separately and does not yet produce authored work vignettes.

The picker now offers six reviewed vessels with real model thumbnails. It preloads before changing the player ship and blocks launch on a model error; a later selection wins over a slower previous request. Unsupported named ships are not silently substituted. Old voyages using unavailable kinds are preserved in recovery storage but cannot resume. Source models receive per-instance localized damage shading, weather exposure and high/low presentation. Physics, source cannon alignment and source-specific damage deformation still need further work.

Polar’s dive target increased from 17 to 34 m because its downloaded source reaches 27.2 m above the normalized waterline. Physical surfacing and weapon locks remain authoritative. Source-derived waterline contours replace generic hull outlines. Build 23 subsequently normalizes wake fading to the actual trail length, fades deposited foam over 12 seconds and samples the sea at both wake edges to remove the hard rectangular short-trail artifact observed by critics.

## Acquisition and provenance

[Current acquisition receipt](evidence/sketchfab-acquisition-2026-09-07.json): 241 official archives, 2,065,915,868 bytes; 30/32 tagged vehicle candidates downloaded. The catalog includes 1,678 unique records, including two supplemental Polar results. Fifty-one candidates remain pending and eight rate-limited. Authentication succeeded; repeated HTTP 429 stopped the queue after cooldowns. The downloader now has a circuit breaker for persistent 429 and resumes hash-verified archives. Downloaded archives are not all runtime assets: six ships/four characters are integrated, totaling 21,387,516 bytes across 16 runtime GLBs. [ASSET-LICENSES.md](../../ASSET-LICENSES.md) lists creators, licenses and rebuild steps.

## Verification

Maintained suite: **163 tests across nine files**, TypeScript/Vite build and whitespace check. Old presentation tests asserted removed generated cloth/primitive geometry; their replacements verify supported-source coverage, authoritative gun-anchor transforms and raycast deck contact under transforms. Browser receipts verify real GLB and crew presence. Test counts are not visual acceptance.

Build 22 has six valid [source-model captures](evidence/assets-22-receipt.json), including expected downloaded crew counts and finite source-deck contacts. All have zero JavaScript/shader errors. [UI receipt](evidence/ui-22-receipt.json): 27 checks across desktop 1600×900, portrait 390×844 and landscape 844×390, covering all six selections, launch, contract/route, crew, pause, remapping and exact voyage reload identity. [Special receipt](evidence/specials-22-receipt.json): 191 checks, Sunny 20, Polar 143, Moby 28; actual buttons/keys, phase progression, underwater weapon rejection, physical surfacing and subsequent firing. Those captures use paused fixed ticks and are not FPS measurements.

[Build 22 sustained measurements](evidence/performance-22-summary.json): four cases, calm sailing and fleet combat at desktop and landscape viewports, each with 5 s warm-up + 15 s real RAF. All are valid, approximately 60 FPS, p95 18.7 ms, worst 18.8 ms, zero frames over 25 ms and zero errors. Desktop render sizes were 2592×1458 and 2304×1296; landscape 1139×526 and 1012×468. Adaptive DPR was approximately 1.2–1.35. Hardware is Apple M4 / ANGLE Metal / headed Chromium. Landscape is a desktop-GPU emulated viewport, not a physical phone.

[Build 20](evidence/performance-20-summary.json) additionally covered ten ordinary scene/viewport combinations at approximately 60 FPS. It predates the final source-paint coordinate fix, deeper Polar dive and wake fix; it is broader historical evidence, not exact final-bundle proof. Likewise build 15’s full-voyage, aim and special profiles remain historical. Do not carry their acceptance claims onto changed source geometry without rerunning the relevant check.

## Blind visual gauntlet

[Pass 19 critic](evidence/critic-assets-19.md): rejected, 5.3/10. Full source ships are recognizable; material consistency, weak immersion and Baratie cropping blocked acceptance. The following pass corrected Baratie framing and source color boundaries and lowered Polar to its measured waterline.

[Pass 22 fresh critic](evidence/critic-assets-22.md): rejected, 4.5/10. These subjective independent scores are not a controlled before/after metric. The critic inspected only the six engine stills and target A. It found inconsistent material finish, underlit Sunny, pale Moby detail, rectangular short wakes, weak mass in the water, sparse crew and primitive coast. The wake issue has a concrete subsequent fix; the remaining art findings are still open. No critic was instructed to approve or infer FPS/provenance from stills.

## Final build 23 checks

The six [actual source captures](evidence/assets-23-receipt.json) all pass ship/crew readiness checks with zero JavaScript/shader errors. The [loading gauntlet](evidence/asset-loading-23-receipt.json) passes eight checks: deliberate HTTP 503 prevents launch and preserves the current model, retry succeeds, a slow previous request cannot override the latest choice, every mounted model reports a ready source, and no unhandled JavaScript error occurs. The one deliberate 503 console error is recorded as expected.

Final sustained profiles cover [Baratie selected through the actual UI](evidence/performance-23-baratie-summary.json) and [the fleet workload](evidence/performance-23-fleet-summary.json), both desktop and landscape. Four valid 5 s warm-up + 15 s RAF cases averaged **59.994–60.000 FPS**, p95 ≤18.7 ms, worst ≤18.8 ms, **zero frames over 25 ms** and zero errors/failed requests. Actual desktop renders were 2592×1458 at DPR 1.35; landscape was 1139×526 or 1266×585 at DPR approximately 1.35–1.5. This is Apple M4 evidence for this bundle, not physical mobile performance. [Frozen bundle/assets hashes](evidence/build-23-manifest.json) identify the tested files. The final wake/loading changes do not alter the build-22 tested special mechanics or voyage UI; no full-voyage rerun is claimed.

[Pass 23 fresh critic](evidence/critic-assets-23.md): **rejected, 5/10**. It identifies recognizable complete-looking source ships and improved presentation relative to the target's basic palette, but weak water contact, detached Merry bow puffs, mixed material finish and insufficient readable crew still block acceptance. The hard rectangular strip is no longer identified as the leading artifact. The [current six-ship gallery](assets-gallery/index.html) contains unedited final captures alongside the separately labeled approved target. This is an asset-correction milestone, not completion of the AAA overhaul.

## Original packages and remaining acceptance

| Approved package | Current behavior | Required before acceptance |
|---|---|---|
| 1 Entry/control | Six actual-asset choices, async load, controls/menus/reload | Physical mobile/controller and longer onboarding play |
| 2 Hero ship | Full downloaded models, UV materials, high/low LOD, actual crew | Unified source finish, source-specific guns/sails/damage, better hero camera |
| 3 Ocean/atmosphere | Shared wave field, weather, source contours, wake fade | Convincing bow pileup, side turbulence, coast art and anime lighting |
| 4 Broadside | Shared guide/projectiles, lead, side targeting, staggered fire | Match sculpted source cannon positions, source recoil/reload and cinematic impacts |
| 5 Damage/finishing | Authoritative damage, disabled/sinking state, salvage/spare/scuttle, shading | Restore authored torn sails, broken structure and wreckage on downloaded geometry |
| 6 Crew tactics | Allocation tradeoffs and reload-work preservation; four source characters | Station-specific working animations, more populated decks, Navy/Polar crew |
| 7 Specials | Sunny jets, real Polar dive/recovery, once-per-target Moby front | Target-A visual acceptance and physical-device performance |
| 8 Archipelago | Four authored landmarks and authoritative shore/collision | Art-detail and traversal acceptance; current islands remain blocky |
| Additional replay loop | Contracts/routes/builds/upgrades/refits/rivals/saves | Longer complete-voyage play with new source geometry and physical devices |

Baratie is a specific collision risk: the source includes unfolded platforms approximately 124 m across while the legacy simulation beam is 34 m. Gun transforms agree with the simulation contract but are not yet measured against every actual cannon on each source. Do not describe these models as fully physics-aligned. Asset acceptance, art acceptance, gameplay validation, measured performance and deployment state are separate claims.
