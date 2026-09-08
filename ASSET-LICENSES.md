# Asset sources and licenses

Updated 2026-09-07. The runtime now uses complete downloaded Sketchfab ship models. The generated hull kits and the procedural replacement-ship path have been removed from the public build. Historical authoring scripts remain in the repository; they are not the current asset pipeline.

## Integrated models

| Runtime asset | Creator | License | Source |
|---|---|---|---|
| going-merry | Oliver Edwards | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [The Going Merry (One Piece) - Game Ready](https://sketchfab.com/3d-models/the-going-merry-one-piece-game-ready-4b2cb678bf984c018dfa1936bd156c8d) |
| thousand-sunny | Miraculousetabug | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [One piece Thousand Sunny🌞](https://sketchfab.com/3d-models/one-piece-thousand-sunny-99986d1c93654c9d8889017435b5fe06) |
| navy-galleon | Ryanwill679/TrashCG | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [Marine ship From One piece](https://sketchfab.com/3d-models/marine-ship-from-one-piece-92898d5f63ad43589203d5a8dc14aa12) |
| moby-dick | Tigerar1 | [CC Attribution-ShareAlike](http://creativecommons.org/licenses/by-sa/4.0/) | [Moby Dick Ship](https://sketchfab.com/3d-models/moby-dick-ship-d9be26addfec48019188dd615a930311) |
| polar-tang | taem5070 | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [Polar Tang](https://sketchfab.com/3d-models/polar-tang-a7feb48976ce484aa4537e4c7124a9c4) |
| baratie | Chin Eeyang | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [Baratie - One Piece](https://sketchfab.com/3d-models/baratie-one-piece-015ebe70a76749eeb92f5f39693b8ea5) |
| luffy | Ricardo3D | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [Luffy - One Piece](https://sketchfab.com/3d-models/none-44b58336c7344f058a02c6944b7ad843) |
| nami | jvmartins | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [Nami one piece](https://sketchfab.com/3d-models/none-182735247cfb45b5853684ac54a6e767) |
| sanji | Justin Rajan | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [Sanji (One Piece)](https://sketchfab.com/3d-models/none-7dfddca8f50c45d7a430b538118d3f9a) |
| whitebeard | VorLucky | [CC Attribution](http://creativecommons.org/licenses/by/4.0/) | [One Piece - WhiteBeard](https://sketchfab.com/3d-models/none-13ebbf108c7949959608b341dbde80d3) |

The source UID, source SHA-256, output SHA-256, bytes and changes are recorded in [the runtime manifest](public/assets/sketchfab/manifest.json). [Artist credits](public/credits.html) are accessible from the game menu. Moby Dick’s adapted high/low GLBs retain CC BY-SA 4.0; the other nine adapted models retain CC BY 4.0. Source geometry and UVs are preserved through normalization, material styling and simplification. Runtime source painting also applies to the untextured Moby Dick and Baratie surfaces. No replacement ship is generated.

## Acquisition coverage

The two requested search cursors were exhausted across 72 pages: 1,676 unique UIDs, plus two Polar Tang results from a supplemental official search. This is a dated catalog, not a guarantee that future search results are unchanged. Of 1,678 catalog records, 32 are tagged vehicle candidates, one a ship component, one a restaurant interior, 266 crew candidates and 1,378 unrelated results. Some candidate labels are broad and still need geometry review.

**241 official archives, 2,065,915,868 bytes downloaded.** This includes 30 of the 32 tagged vehicles. The remaining Waver and Nami’s Waver have not been acquired. Fifty-one candidates are pending and eight have a recorded rate-limit response. Repeated official HTTP 429 responses stopped the queue after cooldowns; authentication has succeeded and is not the blocker. The resumable downloader now stops the whole queue after persistent 429 instead of continuing through every model. No viewer-delivery extraction is used.

Six reviewed ships and four reviewed characters are integrated. Other acquired files remain in the local intake archive; they are not silently published, used as another named ship, or counted as integrated. Navy and Polar Tang currently have no exterior character models. Red Force, Oro Jackson and Queen Mama Chanter have no reviewed downloaded match and are unavailable in the six-ship picker.

## Source and rebuild pipeline

Official source archives live under `assets/source/sketchfab/<uid>/` and are gitignored, outside the public build. Retain the local archives: approximately 2.07 GB. Runtime ship LODs plus crew total 21,387,516 bytes. The catalog has source links, authors, offered licenses, download status and hashes. Do not commit API tokens, signed download URLs or a Blender file containing authenticated scene configuration.

1. `scripts/assets/download-sketchfab.py --dry-run` reports candidate coverage without network access. Authenticated acquisition reads `SKETCHFAB_API_TOKEN` privately from the process environment; `--include-crew` adds tagged crew and `--uids` limits a resumed batch. Respect the shared provider cooldown before resuming.
2. Substitute each job from `scripts/assets/sketchfab-runtime.json` into `scripts/assets/prepare-sketchfab-blender.py` and execute through Blender MCP. It imports existing meshes into dedicated Cruise source/export scenes, evaluates transforms, normalizes scale/orientation/waterline, and exports only the active scene with extras disabled. Preserve unrelated scenes. This template currently contains the absolute Cruise checkout path.
3. `python3 scripts/assets/build-sketchfab-runtime.py` optimizes reviewed normalized GLBs with pinned glTF Transform 4.5.0, Meshopt and WebP. `--manifest-only` regenerates both ship/crew provenance and the public credits without optimization. Crew source definitions live in `scripts/assets/sketchfab-crew.json`; current crew exports preserve source skeletons and available animation clips.
4. `python3 scripts/assets/measure-sketchfab-waterlines.py` derives the still-water contact contours from the normalized downloaded meshes. Runtime foam follows sampled waves around this approximation.
5. Run the maintained tests, build, actual-asset screenshot gauntlet, UI/special checks and sustained real-RAF profile. Inspect every screenshot and request a fresh blind critic. Capture stepping never establishes FPS.

## Original generated artwork

Codex imagegen created eight base section concepts and a supplemental three-special concept board in `docs/art-direction/concepts/`. These are labeled target illustrations, never substituted for screenshots. It also generated three original runtime assets: `public/assets/materials/limestone.png`, `painted-timber.png`, and `cinematic-sky.png`. The first two are sampled as surface materials; the sky is mapped onto the actual 3D skydome and weather graded. No generated ship/world illustration is composited over a gameplay screenshot.

Runtime material hashes:

- `cinematic-sky.png` — SHA-256 `9ab3d6acb2d74e00ecf979396c811f340815e5e87a5010ab3329b279460120fe`
- `painted-timber.png` — SHA-256 `caa10fa3036163004119911670c9f85c93dde57616d3fab77e925cc7ac744369`
- `limestone.png` — SHA-256 `dfe0680734034aafe2d47a2d9cdd060c0fdcadddc11a1488978f4bd320bc391a`
