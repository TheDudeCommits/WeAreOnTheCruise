# Rendering and visual-technology audit

2026-09-23, branch `codex/cinematic-anime-overhaul` @ `1a11e13`. Read-only code audit by an audit agent, using the in-world-23 stills and committed receipts; nothing was run. The lead spot-checked: `NoToneMapping` (`RendererHost.ts:18`), shake added before the damping lerp (`CameraRig.ts:191-198`), `shipPresentation.ts` imported nowhere, and `CelEdgeComposer` declared but never constructed (`GameApp.ts:15,53`). "three" means `node_modules/three` 0.185.1. Parent plan: [AAA-OVERHAUL-PLAN.md](../AAA-OVERHAUL-PLAN.md).

## Headlines

- **No outlines render anywhere.** `ensureShipInk` / `createShipMaterialSet` (`src/runtime/shipPresentation.ts:8-89`) are dead code, and `CelEdgeComposer` is never constructed (`src/runtime/GameApp.ts:53,280`). Both were unhooked in commit 9641605; the "selective geometry contours" comment at `GameApp.ts:130-131` is out of date.
- **Four shading models are on screen at once:** GLSL `CelMaterial` (islands), `MeshToonMaterial` + a 38% unlit fill (ships), `MeshStandardMaterial` (crew), unlit shaders (ocean, FX).
- **No post-processing and no tone mapping.**
- **Camera shake reaches the screen at ~6% strength.**
- **The ocean looks busy mainly because of unfiltered noise** on a grid centred on the ship rather than the camera.

## 1. Current pipeline

- **Renderer:** `WebGLRenderer`, MSAA (off in performance mode), sRGB output, `NoToneMapping` (`src/render/app/RendererHost.ts:16-23`). LDR: nothing exceeds 1.0.
- **Post:** none; one `renderer.render` per frame (`GameApp.ts:279-282`).
- **Lights:** one hemisphere + one sun, recoloured per weather and kept at a fixed offset from the player (`GameApp.ts:248-256,431-441`). The same sun direction is hard-coded in three shaders (`src/render/ocean/InfiniteOcean.ts:104`, `src/render/world/ProceduralSky.ts:26`, `src/render/npr/celMaterial.ts:187`), which blocks any time-of-day system.
- **Shadows:** 2048² over a 250 m box following the player without texel snapping, so edges shimmer (`GameApp.ts:436-440`). `PCFSoftShadowMap` is deprecated in r185 and falls back to PCF with a console warning.
- **Ship ramp:** 4-step gradient [100,163,218,255] (`src/render/loaders/SketchfabShipAssets.ts:14`) plus an unlit `diffuse*0.38` fill (:51-55). With the sun at 2.0 (`GameApp.ts:251`) neighbouring bands differ by ~10–25% and shadows never drop below ~0.4–0.5 × albedo: it reads as soft Lambert, not cel.
- **Island ramp:** a separate hard 4-band `if` ramp, fixed light vector, multiplied blue shadow (`celMaterial.ts:122-129,155`).
- **Fog:** three curves — linear `THREE.Fog` 700–2550 m for built-ins (`GameApp.ts:253`; `src/render/world/Atmosphere.ts:5`), CelMaterial's own smoothstep (`celMaterial.ts:165-167`), and the ocean's horizontal smoothstep capped at 0.92 (`InfiniteOcean.ts:136-137`). Nothing gets haze closer than ~650 m.
- **Sky:** a static painted 1774×887 PNG repeated **4 times** around the horizon; painted detail reaches ~27° elevation, then UV clamps; drift 8e-6/s (`ProceduralSky.ts:17`). Sun disc, stars and lightning pulse are procedural (:26-33).
- **Weather / time of day:** six fixed palettes (`Atmosphere.ts:5-10`) chosen per route (`src/simulation/GameSimulation.ts:365`), switched instantly (`ProceduralSky.ts:53-61`; `InfiniteOcean.ts:220-231`). No time of day; "night" is a palette. Rain is a CSS overlay on the canvas (`src/styles.css:1226-1238`).

## 2. Ocean

- **Motion:** 5 Gerstner waves with fixed directions (142 m → 7.4 m wavelengths, amplitudes summing to 5 m), shared with CPU buoyancy (`src/core/waves.ts:39-45,130-186`). Weather scales one strength value (`InfiniteOcean.ts:245-254`). Wind uniforms are uploaded every frame (:208-210) but never read by the shader.
- **Shading:** opaque ShaderMaterial; a noise-perturbed normal drives three colour bands + crest tint (:99-109), brush strokes (:111-112), crest foam from `pow(sin,5)` + noise (`waves.ts:179`; :114-120), "lace" foam as noise contours (:121-124), fresnel to a flat horizon colour (:125-126), a specular glint with exponent 105 (:127-129), a loop over 32 shore circles (:130-135).
- **Geometry:** polar grid of 180 rings × 512 segments to 720 m plus an outer ring to 3.1 km, ~194k triangles (:187-188), snapping in 32 m steps (:212-213).
- **Why it reads as busy:** three hash value-noise normal layers (13 m, 3.4 m, 1.15 m lattices) plus 0.5 m froth with no distance or `fwidth` fade — bands, glints and lace inherit the shimmer. The grid is centred on the ship (`GameApp.ts:238`) but the chase camera sits 110–240 m behind (`src/render/camera/CameraRig.ts:16,132-136`); there the radial spacing is ~3.2–4.2 m (`InfiniteOcean.ts:264`), about 2 samples per 7.4 m wave, so the foreground crawls and pops on every grid snap. Foam follows neither wave shapes nor wind.
- **Missing vs reference oceans:** depth-based colour (no scene depth, only analytic shore circles); back-lit crest SSS; crest-aligned foam strokes; shore foam that follows real rock outlines (it follows circles); hull-intersection foam in the water shader (it is a separate overlay ring, `src/render/fx/NavalFxView.ts:711-721`); Kelvin wake arms; bow-wave displacement; reflections; a horizon that isn't flat.
- **Flat Kit:** its approach (depth colour gradient, intersection foam, banded crests) maps onto these gaps; reimplement the techniques only (Unity licence, never ship its files).

## 3. Ships and materials

- **Styling:** every source material becomes `MeshToonMaterial` (`SketchfabShipAssets.ts:39-49`), keeping colour map, normal map at 0.42, AO at 0.45, emissive capped at 0.15, double-sided; metalness/roughness dropped.
- **Why the fleet looks inconsistent:** the sources differ in kind — Merry 4 PBR materials; Navy 19 textures at 1024²; Polar 30 textures at 1024² (colour, normal, packed ORM); Sunny 36 small colour-only materials; Moby and Baratie had textures stripped in Blender and faces recoloured by position into a 32×4 palette (`scripts/assets/prepare-sketchfab-blender.py:32-76`), then repainted again at runtime (`SketchfabShipAssets.ts:113-126`). Band edges follow normal-map noise (Sunny's "muddy" look), baked texture lighting fights the ramp, the 38% fill flattens everything, and without tone mapping saturated colours clip (Polar's yellow loses its bands).
- **Crew:** cloned `MeshStandardMaterial`, no ramp/fill/outline (`src/render/loaders/SketchfabCrewAssets.ts:80-85`); attached only to the high LOD (`src/render/ships/ShipGeometryFactory.ts:426-428`); Nami and Whitebeard GLBs have no clips, so they stand frozen (`SketchfabCrewAssets.ts:66-68`); Navy and Polar have no crew stations (:11-16).
- **Unified look, runtime route (days):** one lighting chunk shared by ships, crew (`MeshToonMaterial` supports skinning) and CelMaterial — 2–3 anti-aliased bands, cool-tinted shadow colour, lit-side rim, normal maps capped at 0.15, AO as crevice ink, a per-ship colour-levels table.
- **Unified look, Blender re-bake route (weeks; start with the worst four ships):** de-lit albedo, AO + curvature on a second UV set (source UVs untouched), consistent texel density, a smoothed-normal attribute for outlines, painted detail for Moby and Baratie.
- **Outlines:** the existing inverted hull (`src/render/npr/invertedHull.ts:22-55`) cracks at hard edges, doesn't support skinned crew and ignores fog.
- **Damage:** only a sine-pattern scorch darkening is visible (`SketchfabShipAssets.ts:129-135`). Fire, sail tears, mast breaks, damage marks and procedural crew animation exist but are never hooked up (`ShipGeometryFactory.ts:159-164,192-204,330-383`). Damage smoke rises from the ship's centre, not the hit point (`NavalFxView.ts:774-798`).

## 4. FX inventory (anime readiness 0–5)

Every smoke/spray/splash effect is the same unlit soft sphere at ≤22% opacity with normal blending (`NavalFxView.ts:113-129`). No additive blending, flipbooks, soft particles or bloom.

| Effect | Score | Evidence (`NavalFxView.ts` unless stated) |
|---|---|---|
| Cannonball | 1 | 1 m dark unlit ball (:96-98) |
| Projectile trail | 1 | 34%-opacity tube, ≤5.9 m (:104-105,517) |
| Muzzle blast | 1 | 7 smoke + 3 "flash" puffs ≤22% opacity; no flash shape or light (:194-210) |
| Hull impact | 1 | Spheres + an always-horizontal shock ring (:212-216,568); no debris, sparks or decal |
| Water impact | 1 | Spheres + flat ring; no splash column (:217-220) |
| Shock rings | — | Fixed 58% opacity, then vanish (:151,555-578) |
| Ram / disabled | 1 | Puff bursts |
| Damage smoke | 2 | From the ship's centre |
| Fire | 0 | Never spawned |
| Bow spray | 0 | Sphere puffs every 0.1 s (:599-608) — the critic's detached Merry puffs |
| Wake | 2 | Ribbon (:654-672,738-748), flat across its width so crests poke through |
| Hull contact foam | 1 | Uniform 1–2 m ring (:711-721) |
| Sunny special jets | 3 | :409-431 |
| Polar special | 2 | Rings and bubbles |
| Moby pressure wave | 3 | :319-382 — the best existing effect |
| Aim guide | 1 | 1-pixel lines (`src/render/camera/AimGuide.ts:187-219`) |
| Race ribbon | 1 | Plain neon strip (`src/render/fx/RaceCourseView.ts:16-23`) |

- **Timing:** drag exp(−0.7·dt) (:537-539) is floaty; anime timing wants a fast burst out, then a hang.
- **Hit-stop** exists (35–85 ms, `GameApp.ts:221-222,300-310`) but without an impact frame it reads as a hitch.
- **Cheap wins:** delete sphere bow spray; additive starburst flashes; fade and surface-orient shock rings; two-tone smoke that dissolves out; splash columns and plank debris; a 2-frame flash on each hit-stop.

## 5. Camera

- Modes: chase, broadside, bow, deck, cinematic, overhead, scaled by ship mass; broadside can frame the target; aiming cuts to a firing rail (`CameraRig.ts:15-22,132-181`).
- Damping: position 4.8/s, look-at 5/s (:197-198,251-255). FOV 53°, +8° at speed, +3° in combat (`GameApp.ts:270-272`).
- **Shake bug:** offsets are added *before* the damping lerp (:191-198), so only ~6% of the ~13 Hz shake survives; a 0.5 m impulse moves the camera ~3 cm. No rotational shake, no FOV kick.
- Cinematics: only the Sunny special orbit and the Polar dive lift (:154-166). No kill cam or sinking shot; a special just shows a banner (`src/ui/Hud.ts:566`).
- **Missing Black Flag camera language:** low rail camera over the guns with the target in the upper third; horizon lean with heel; lag and look-ahead in turns; roll shake; volley FOV kick; follow-the-ball camera; slow-motion kill cam; spyglass zoom; two-ship framing in combat; letterboxed cut-ins with depth of field for specials.

## 6. World and coast

- Islands are merged primitives (`src/render/world/ChunkVisuals.ts:103-107`). `rock()` stacks 8 rings × 48 segments tapering 1.01→0.70 with ±5% jitter and a flat top, flat-shaded with alternating pale greys per ring (:170-186) — the striped "layer cake". Beaches are plain cylinders (:82), houses boxes with 4-sided cone roofs (:112-122), shrubs 20-face icosahedra (:110).
- They read as pale blocks because of weak cel contrast (:14), no outlines or AO, and no wet band, scattered rocks or rock-following surf at the waterline.
- Atmospheric depth: haze starts ~650 m, so islands at 200–600 m look as sharp as the foreground and landmarks beyond 1.5 km turn ghostly (the see-through arch in baratie.png). The horizon join is clean but flat; clouds neither reflect in nor tint the water.

## 7. Performance headroom and WebGPU

- **Measured (Apple M4, build-23 fleet):** 119–183 draw calls and 1.28–1.66 M triangles per frame including shadows; adaptive DPR had already dropped 1.5→1.35 at 2592×1458 (`docs/overhaul/evidence/performance-23-fleet-summary.json:335-471`).
- **Main costs:** the ocean (~194k tris + a 32-step shore loop per water pixel); Navy (254k tris high, still 158k "low", `public/assets/sketchfab/manifest.json:122,130`); every ship mesh casts shadows (`SketchfabShipAssets.ts:85`); Sunny's 36 draws per LOD.
- **Texture memory:** Polar's 30 uncompressed 1024² textures are duplicated in its low LOD (~320 MiB once both LODs draw); Navy ~130 MiB; 156 textures resident after all six ships load; no KTX2.
- **Warm-up/LOD:** only FX shaders are precompiled (`GameApp.ts:177`), so ships hitch on first appearance or LOD switch. **Baratie bug:** the default chase camera sits ~215 m from Baratie, beyond its ~207 m low-LOD switch (`ShipGeometryFactory.ts:415`), so the player's own Baratie shows the low LOD and Sanji disappears with it.
- **Adaptive quality:** DPR only (`RendererHost.ts:109-123`). Stepping up needs 90% of frames under 13.5 ms, which a 60 Hz display never reports, so it only steps down. No GPU timing; the performance tier is URL-only (`src/runtime/AppConfig.ts:18-21`). three is unpinned (`"latest"`).
- **Post is already possible in WebGL:** r185's `new WebGLRenderer({outputBufferType: HalfFloatType})` + `renderer.setEffects([...])` renders into a 4× MSAA half-float target with depth and tone-maps at the end; existing custom shaders keep working and the standard bloom, LUT, SMAA and outline passes are available.
- **WebGPURenderer + TSL would add** `RenderPipeline` and bloom, god-ray, lens-flare, LUT, outline, Sobel, TRAA, GTAO, SSR and radial-blur nodes; GPU compute particles for spray/foam; a GPU wake/foam simulation; MRT for cheap outlines and selective bloom.
- **WebGPU risks:** every custom material is GLSL or an `onBeforeCompile` patch (ocean, sky, 8 cel materials, FX, wakes, ship fill, damage) and none run under WebGPURenderer — ~2–3 weeks to port plus a new performance proof. Tests look up FX objects by name (`tests/specials.test.ts:257-310`). Safari only has WebGPU from 26; older iOS and many Android devices fall back to a slower WebGL2 backend. r185's node-materials-in-WebGL bridge lacks MRT, the post stack and `compile`.
- **Recommendation:** build the look on WebGL2 now; keep new FX instanced and stamp-based so they port to TSL later; WebGPU is a separate milestone.

## 8. Leverage points

- **(a) Unified toon shading + ink:** `SketchfabShipAssets.ts:34-58,97-144`; `SketchfabCrewAssets.ts:80-85`; `celMaterial.ts:118-172,187,218-225`; `invertedHull.ts:22-55`; `shipPresentation.ts:67-89`; `GameApp.ts:431-441`; `Atmosphere.ts:4-10`; `prepare-sketchfab-blender.py:32-76`.
- **(b) Post stack:** `RendererHost.ts:16-23`; `GameApp.ts:53,279-282,428`; `CelEdgeComposer.ts:31-95` (reuse edge detection, but render normals only for ships, crew and islands so the ocean is excluded). Bright sources to push above 1.0 for bloom: `InfiniteOcean.ts:127-129`, `NavalFxView.ts:207-208,418-421`.
- **(c) Hull contact foam, bow wave, Kelvin wake:** `InfiniteOcean.ts:58-69` (vertex displacement hook) and :96-141 (foam composition); `NavalFxView.ts:580-763`; `src/content/sketchfabWaterlines.json` (32-point hull outlines). Keep new displacement visual-only so buoyancy stays in sync (`ARCHITECTURE.md:71`).
- **(d) Stylized FX system:** `NavalFxView.ts:112-165` (pools), :191-260 (event→effect mapping), :800-845 (spawns); `GameApp.ts:177` (precompile).
- **(e) Dynamic sky, time of day, weather:** `Atmosphere.ts:4-11`; `ProceduralSky.ts:7-37,53-61`; `InfiniteOcean.ts:104,220-231`; `GameApp.ts:248-256`; `GameSimulation.ts:365-367`; `styles.css:1226-1238`.

## Top 15 rendering changes (visual impact per engineering day; S ≈ 1–2 d, M ≈ 3–5 d, L ≈ 6+ d)

1. **Bring back ink outlines (S, ~2 d):** average normals into an outline-normal attribute at load; inverted-hull shells on ships, skinned crew and islands; 1.5–2.5 px, fading into fog.
2. **Make camera shake visible (S, 1–1.5 d):** apply after damping with roll/pitch; +4–6° FOV kick on volleys; 2-frame ink/white flash on hit-stop.
3. **One fog with real aerial perspective (S, 1 d):** shared distance + height fog from ~150 m for ocean, islands, ships, outlines and FX; density per weather.
4. **HDR, bloom, colour grading (S–M, 2–3 d):** `outputBufferType: HalfFloatType` + `setEffects([UnrealBloomPass, LUTPass])`; keep `NoToneMapping` at first; push glints, flashes and jets above 1.0.
5. **One anime ramp for ships and crew (M, 4 d):** remove the 0.38 fill; anti-aliased bands, cool shadow tint, lit-side rim; normal maps ≤0.15; AO as ink; per-ship colour levels; crew on `MeshToonMaterial`.
6. **Water-contact triage (M, 3 d):** delete sphere bow spray; contact foam heavier at the bow (3–5 m) than the sides (~1 m) with the inner edge tucked under the hull; sample 5–7 heights across each wake ribbon; Kelvin arms at ±19.5°.
7. **Calm and stylize the ocean (M, 5 d):** two wind-aligned normal textures fading with distance; tapered crest-following foam strokes; back-lit crest scattering; sky-texture reflection; one sun uniform; dense grid centred on the camera; fade waves too small to sample.
8. **Anime post extras (S–M, 2 d):** radial speed lines (Coup de Burst, rams, crits); sun flare; vignette; brief chromatic aberration on player hits.
9. **Stylized FX kit (M, 5 d):** cel-lit dissolving smoke; additive starburst flipbooks; splash columns with foam decals; instanced plank debris and sparks; fast-out / hang / settle curves.
10. **Cinematic camera beats (M, 3–4 d):** low rail broadside camera; follow-the-volley camera; 0.5 s slow-motion orbit on disable; letterboxed special cut-ins keyed to special phases.
11. **Damage visuals (M, 4–5 d):** breach/scorch decals at real impact points; cel flipbook fire with glow; sail-tear masks driven by `damage.sails`.
12. **Ocean interaction render target (L, 8–10 d)** — the real fix for "water contact 3/10": a top-down texture around the camera target collecting hull outlines, bow-wave height and wake/Kelvin/impact stamps that fade over time; the ocean vertex shader reads it for visual-only displacement, the fragment shader for foam.
13. **Coast art pass (L, 6–8 d):** displaced cliff meshes with overhangs; warm/cool palette with top-lit grass; wet band and scattered rocks; surf driven by #12; denser vegetation.
14. **Dynamic sky, time of day, weather blends (L, 6–8 d):** one shared sun state replacing the four hard-coded vectors; 3–5 s crossfades of palette, sea state and fog; non-repeating two-layer cloud dome; golden hour; 3D rain and lightning; moon and lanterns at night.
15. **Budget and quality tiers (M, 4 d)** — needed before #4, #7 and #9 reach mobile: share textures between LODs + KTX2; rebuild Navy's low LOD; atlas Sunny's 36 materials; always show the player's ship at high LOD (fixes Baratie); precompile ships; GPU-timed tiers that can step back up on 60 Hz screens; precomputed shore distance field instead of the per-pixel loop; pin three to 0.185.1.
