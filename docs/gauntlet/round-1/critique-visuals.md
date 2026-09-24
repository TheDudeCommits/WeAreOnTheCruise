# Round 1 critique: visuals

**Build and evidence:** as in `critique-combat-feel.md`. `R1/` is `output/gauntlet/round-1/`. Shots ending in `-plate` are the same frame with the HUD hidden.

**Targets:** `docs/aaa-overhaul/targets/` holds generated paint-overs. They are goals, not evidence. T7 (combat HUD) and T1 (hero sailing) were checked against this build.

**Bar:**
- AC4 Black Flag and Sea of Thieves for water and sky.
- Wind Waker HD for cel readability.
- Vampire Survivors and Halls of Torment for crowd readability.

## Verdict

- **Close up, the cel/ink finish is good.**
  - The hulls are inked.
  - Smoke is shape-first cel smoke.
  - The harbor set is charming (`R1/01-harbor-fleet.jpg`).
  - The hero ship visibly grows by tier 4: lantern, spikes, flags (`R1/07-sunward-late.jpg`).
- **In play, the image is dominated by the sea, and the sea is often the worst thing in it:**
  - a white foam carpet around every daytime melee;
  - a cyan leopard-spot field at night in the Gloam;
  - a magenta sheet at dusk;
  - sparkle noise in the afternoon.
- **The tactical camera shows no horizon,** so the sky, the time-of-day script and the islands barely appear in a run.
- **The hero ships still carry One Piece marks on their sails.** These are the first thing on the title and harbor screens.

## Issues, ranked

### 1. [S1] Daytime melees sit on a white foam carpet

**Evidence:**
- Frames:
  - At 0:23, after only 9 kills, a flat white field with blue "holes" and dot speckles fills most of the lower half of the frame around the ship, like an ice floe rather than water (`R1/05-sunward-early.jpg` and `-plate`).
  - The same carpet appears in `R1/06-sunward-mid.jpg`, `R1/20-levelup-pre.jpg`, `R1/25-boss-tidewyrm-plate.jpg` and `R1/26-boss-tidewyrm-sinking.jpg`.
  - The night fix (`8f4ccaa`) only toned down bioluminescence and lightened the splash stamps.
- Foam comes from two stacked sources:
  - **Persistent ocean stamps** (`stampFoam`) from splashes, explosions, kills and sinkings (`src/render/fx/Sakuga.ts:313,360,391,447,479,506`).
  - **Cel foam decals** at 0.95 alpha with radii up to 12×s and lives of 1.9–3.2 s (`Sakuga.ts:213-215`). A decal is also spawned for **every non-elite enemy spawn** (`src/render/fx/EventFx.ts:153`).
- Skiffs ram, so they die right beside the hull, and the stamps pile up exactly where the player looks.

**Fix:**
- **Coverage-aware deposits:** multiply the stamp strength by `(1 − coverage)`, read from the persistent field (`src/render/ocean/InteractionField.ts`).
- **Foam decals:** at most 0.6 alpha; ring or lace only (no filled disk) when they overlap existing foam; a life of ≤1.2 s; no decal on enemy spawn.
- **Shader:** when foam is saturated, render turquoise aeration plus lace edges, never a flat white slab with dot holes (`src/render/ocean/surfaceShaders.ts`).
- **Acceptance:**
  - Add an OCEAN debug stat, `ocean.foamCoverage(radiusM)`, exposed on the bridge (lead).
  - It must read ≤15% within 150 m of the player in `sunward-mid` and every `boss-*` shot.
  - The owner looks at the plates.

**Owner:** OCEAN (`src/render/ocean/{surfaceShaders,InteractionField,WakeSystem}.ts`) and FX (`src/render/fx/Sakuga.ts`, `EventFx.ts:153`).

### 2. [S1] One Piece marks on the hero ships (needs an owner decision)

**Evidence:**
- **Straw Hat Jolly Roger** on the Dawn Ram and Sunlion sails. It appears in:
  - the title (`R1/00-title.jpg`);
  - the harbor (`R1/01-harbor-fleet.jpg`: the main 3D ship, both ship cards, and the WANTED poster portrait);
  - the defeat poster (`R1/33-results-defeat.jpg`);
  - every Sunward gameplay frame.
- **"MARINE" lettering** on the Seawarden's sails, in the harbor (`R1/rerun-victory/02-harbor-after.jpg`) and on the victory poster (`R1/rerun-victory/01-results-victory.jpg`).
- The title screen says "An original naval adventure on the Brightwater". The design bible bans One Piece names and terms in game text. The game already paints original heraldry at startup (`src/render/ships/emblems.ts`) and uses it on growth flags only.

**Fix:** this keeps the downloaded geometry, as the owner requires.
- Apply per-model sail texture overrides that paint the Brightwater crew emblem over the Jolly Roger regions. Use canvas decals into the sail material's map at load, with the UV rectangles measured once per model.
- Repaint the Seawarden's sail lettering as the Admiralty wave-crest.
- Regenerate the ship-card and poster thumbnails.
- **Ask the owner first:** the models are kept as fan art "for now", and the title rename is still open.

**Owner:**
- SHIPS: `src/render/ships/hero/HeroShip.ts` or `src/render/loaders/SketchfabShipAssets.ts`.
- ASSETS: `public/assets/sketchfab/thumbnails/`.

### 3. [S1] Night and storm hordes are unreadable

**Evidence:**
- At 12:42 in Stormwrack, 80 enemies were alive (`report.json → shots[12].sim.enemies = 80`) (`R1/12-stormwrack-late.jpg`). About five hulls can be identified. The rest are dark shapes on navy water under a glowing cyan foam field.
- The same holds in `R1/13-…` and `R1/14-…`.
- Enemy ink is navy (`#1b2340`), the same value as the night sea, so silhouettes vanish.
- The Gloam at night reads better only because each enemy drags a cyan foam ring (`R1/29-gloam-night-melee.jpg`).

**Fix:**
- At night and in storms, give each enemy class a faction-coloured rim light, plus one instanced emissive stern lantern (Admiralty gold, Corsair red, Wraith teal).
- Raise enemy albedo exposure by about 0.3 EV at night.
- Cap the bioluminescent foam below the enemy rim brightness.
- **Acceptance:** in the storm-late and gloam-late shots, a blind tester can count the enemies within ±20%.

**Owner:**
- SHIPS: `src/render/ships/fleet/EnemyFleet.ts`, `src/render/ships/materials.ts`.
- OCEAN: `surfaceShaders.ts`, the `uBiolum` term.
- LOOK: the night keys in `src/render/sky/palette.ts`.

### 4. [S1] The Gloam's sea turns into a noise field

**Evidence:** at 23.4 h in clear weather, the entire visible sea is a cyan leopard-spot pattern (`R1/16-the-mid.jpg`). The same happens in fog at 2.8 h (`R1/17-the-late.jpg`). This breaks the style bible ("never pixel noise") and competes with every telegraph and pickup.

**Fix:**
- Key night crest foam to wave height with a much higher threshold, using wind-aligned strokes.
- Clamp crest-foam coverage to ≤10% of water pixels.
- Keep the glow only in fresh wakes and on impact.

**Owner:** OCEAN (`src/render/ocean/surfaceShaders.ts`, night crest branch). LOOK owns the Gloam palette.

### 5. [S2] Dusk turns the sea magenta and the ships muddy

**Evidence:**
- At 18.9 h on Sunward (`R1/07-sunward-late.jpg` and `-plate`, `R1/09-…`), the water is a saturated violet-blue sheet with pink highlights. The hero ship is a dark purple silhouette, and nothing reads as "golden".
- **Cause:** the 18.9 h key has zenith `0x252c6e` and haze `0xc47a8c` (`src/render/sky/palette.ts:96-100`). At the tactical pitch the water mostly reflects the zenith, and the warm horizon (`0xff8a6a`) never enters the frame.

**Fix:**
- When the camera pitch is steep, tint the water from the haze and horizon colours rather than the zenith.
- Add a sun-glitter path toward the sun.
- Keep the hero's albedo exposure at ≥0.9 at golden hour.

**Owner:** LOOK (`src/render/sky/palette.ts`, `src/render/app/grading.ts`) and OCEAN (reflection weights in `surfaceShaders.ts`).

### 6. [S2] No horizon, sky or landmarks in play

**Evidence:**
- The tactical camera uses `TACTICAL_PITCH = 44°` with a 50° FOV (`src/render/camera/CameraDirector.ts:19-22`). With the top frustum edge about 19° below horizontal, the horizon never enters the frame. It can rise even further when islands block the view (`MAX_PITCH` 72°).
- As a result, none of the following ever reach the screen in a run:
  - the sky dome, cloud cards, sun and moon;
  - the time-of-day script;
  - the landmark islands that targets T1, T2 and T6 are built around.
- Every run frame is "sea wallpaper". T7 shows a low 3/4 view with the horizon.

**Fix:**
- **Horizon band:** 32–36° pitch when fewer than about 8 enemies are within 250 m, easing to 44° in a melee.
- Alternatively, a Camera: Tactical / Cinematic setting.
- Verify readability with the same evidence shots before shipping.

**Owner:** LOOK (`src/render/camera/CameraDirector.ts`).

### 7. [S2] Smoke and explosion sprites occlude the play space

**Evidence:**
- One smoke cloud covers about 25% of the frame mid-fight (`R1/22-boss-iron-warden.jpg`).
- Explosion plus smoke cover about 35% (`R1/26-boss-tidewyrm-sinking.jpg`).
- Big cel clouds hide skiffs next to the player (`R1/06-sunward-mid.jpg`).

**Fix:**
- Fade smoke with screen coverage: once a puff covers more than 6% of the screen, fade it.
- Erode smoke over 1.2 s rather than 3 s.
- Never let smoke draw fully opaque over the player hull or a boss hull.

**Owner:** FX (`src/render/fx/Sakuga.ts` `smoke()`/`kill()`, and the cel sprite pass).

### 8. [S2] Afternoon glints make the sea shimmer

**Evidence:** hundreds of single-pixel white glints across the afternoon sea (`R1/10-stormwrack-early.jpg`, 15.2 h). In motion they shimmer, which the style bible forbids.

**Fix:** anti-alias glints with `fwidth`, fade them with distance and camera pitch, and cluster them into a sun-glitter path.

**Owner:** OCEAN (`src/render/ocean/surfaceShaders.ts`).

### 9. [S3] The Sovereign reads pale and low-contrast

**Evidence:** at 70 m the flagship's sails and rigging render washed out, almost ghostly, next to the crisp hero ship (`R1/27-boss-sovereign.jpg`). The final boss should be the most striking object in the game.

**Fix:** bring the boss materials up to the hero's cel contrast, and give the flagship Admiralty colours: white hull, navy trim, gold crest.

**Owner:** SHIPS (`src/render/ships/fleet/Bosses.ts`).

### 10. [S3] The harbor showcase crops tall ships

**Evidence:** with the Seawarden selected, the masts are cut off at the top of the frame (`R1/rerun-victory/02-harbor-after.jpg`). The showcase distance uses hull length only (`CameraDirector.ts:189-199`).

**Fix:** frame by the model's bounding box (height and length).

**Owner:** LOOK (`CameraDirector.ts`).

## What works (keep)

- Inked hero hulls and cel smoke.
- The harbor town and the lit cliff (`R1/01-…`).
- Cyan foam rings under Gloam enemies: they help readability at night.
- Chevron danger lanes.
- Visible tier growth on the hero.
- The victory, defeat and WANTED poster art direction (`R1/33-…`).
