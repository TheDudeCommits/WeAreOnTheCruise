# UI/UX, audio, onboarding and game-feel audit

2026-09-23, branch `codex/cinematic-anime-overhaul` @ `1a11e13`. Read-only audit by an audit agent using the code plus today's captures (`output/aaa-audit-2026-09-23/`), build-22 UI captures and older aim captures. The lead spot-checked the `just-fired`/`just-reloaded` (TS) vs `is-firing`/`is-ready-flash` (CSS) class mismatch against source. Parent plan: [AAA-OVERHAUL-PLAN.md](../AAA-OVERHAUL-PLAN.md).

**Biggest findings:** every menu shows a frozen world; aiming is chosen by key, not by camera direction; several feedback effects are wired up but never render; all audio is chiptune-grade synthesis with no spatial positioning; setting camera shake to 0 (or OS reduced motion) hides all combat banners and hit confirms.

Path keys: H = `src/ui/Hud.ts`, VP = `src/ui/VoyagePanel.ts`, PR = `src/ui/presentation.ts`, CSS = `src/styles.css`, AD = `src/audio/AudioDirector.ts`, GA = `src/runtime/GameApp.ts`, EA = `src/runtime/eventAdapter.ts`, IC = `src/input/InputController.ts`, CT = `src/input/controls.ts`, CR = `src/render/camera/CameraRig.ts`, AG = `src/render/camera/AimGuide.ts`, GS = `src/simulation/GameSimulation.ts`.

## 1. Front-end flow and the first 60 seconds

- **Boot** is a text card (index.html:9-12). **Title and ship select share one screen**: a static CSS poster over the 3D Sunny (H:628-664); the decorative sun is disabled (CSS:177-179); no logo animation and no title music, because audio can't start before a click or key (AD:158-173, H:259-261).
- **The world is frozen behind every menu.** Ocean, sky and chunks run on `state.elapsed` (GA:236-247; `src/render/world/WorldRenderer.ts:58-67`), and the simulation only advances when unpaused *and* in the encounter phase (GS:686). Title (paused via H:1167), harbor, route, reward and results are still frames. Closing the harbor chart leaves the HUD over a ship that can't move — a dead end for new players.
- **Clicks to fun: three** text-heavy forms — launch; harbor chart (3 contracts × 3 builds + refits, all prose; VP:135-144); a route screen with a paragraph of risk rules (VP:145-146, 202); then the encounter (GA:468), with the patrol still ~200 m away.
- **Other screens:** crew orders and the chart fully pause the game (H:920-923; VP:107-111) where AC4 stays real-time. Rewards are plain cards (VP:147-157); results are static coin text (VP:158-160) with no count-up or bounty-poster moment. Pause is a side drawer holding controls, Free Sail (collapsed, H:794) and comfort settings (H:814).
- **No tutorial.** The only teaching is a 6 px key legend (H:765; CSS:795-803). The first objective — "target sails, cross its stern, and finish with a broadside" (GS:371) — assumes knowledge of ammo and aiming. Hold-Z/V aiming is never introduced.
- **No narrative hook.** Story is one-line contract descriptions (`src/content/voyages.ts:22-24`). Callouts come from generic roles — LOOKOUT, GUNNER, SHIPWRIGHT (H:444-566) — despite Luffy, Nami and Sanji models; the callout portrait is `display:none` (CSS:1040-1042).
- **A new player's first minute:** boot text → a frozen, silent poster → after the first click, a chiptune loop at 20% (AD:196, 205) behind two forms → sailing with one line of objective text and no taught controls.

## 2. HUD

- **Always on screen** (H:666-785): objective slip, chart button + coins, compass + wind, WANTED + treasure, menu, HULL/SAILS/CREW + brace/repair, speed/throttle/wind, radar, crew preset + allocation, ammo + PORT/BOW/STBD cooldowns + special, key legend, callouts. **Contextual:** target tag, threat pips, aim readout, race widgets, collect button, salvage/spare/scuttle, crew popover, hit confirm, volley stamp, damage vignette, banner, pause stamp, weather overlay, 14 touch buttons. **In-world:** a 1 px aim fan, impact ring and arc (AG:187-193, 318-378) plus an HTML target label with inline styles (AG:221-227).
- **Assessment:** ~12 always-on widgets at equal visual weight; bounty, coins, crew allocation and chart stay up in combat. **Text is far too small:** 140 of 271 font-size declarations are ≤9 px and 79 are ≤7 px (WANTED 6 px CSS:474, key legend 6 px CSS:800, objective label 7 px CSS:394-398). No web font is loaded; the Avenir stack falls back to Trebuchet/Roboto off Mac (CSS:4, 15-16). At 1600×900 corner labels are illegible and "WIND 92%" collides with the crew [T] label.
- **Hierarchy is upside down:** battery readiness, enemy hull and incoming fire sit in corners at 7–8 px while a mid-screen text box covers the shot landing point (H:714; CSS:946). Enemy health only appears in the top-right tag (CSS:851), not over the ship.
- **Phone:** portrait HUD + controls cover ~55% of the screen; landscape aiming panels cover the target; keyboard labels still show on touch.
- **Remove in combat:** key legend (use contextual prompts), bounty/coins (show on change), crew allocation text, chart button, mode/weather line. **Merge:** hull/sails/crew + speed + weapons + special into one ship ring (hull ring, three battery arcs, special gauge); fold the compass into the minimap rim. **Move into the world:** enemy nameplates with health/intent; incoming-fire warnings on the water; a thick filled aim wedge that turns green on target instead of 1 px lines and the central text box. **Later, diegetic:** sail states, smoke/fire for damage, crew reload animations.

## 3. Feedback and juice

- **Exists:** position-only camera shake (CR:191-195) on fire/impact/ram/special (GA:297-311); 35–85 ms hit-stop (GA:221-222, 300-310); FOV widen at speed/in combat (GA:270); hit confirm with "N HIT CHAIN" (H:1978-2026) and a rising-pitch combo ping (AD:426-443); kill banner + fanfare (EA:59-70; H:444-457); damage vignette (H:2095); muzzle/impact puffs and shock rings (`src/render/fx/NavalFxView.ts:194-252`).
- **Broken:** weapon fire/reload pulses never play — code adds `just-fired`/`just-reloaded` (H:1973, 2055) but CSS defines `is-firing`/`is-ready-flash` (CSS:756-761); `is-alerting`/`is-speaking` have no CSS. Hit confirms can't restart while visible — the restart helper (H:2137-2141) toggles `is-active` but the animations sit on base selectors (CSS:1066, 1092, 1116), so chain counts arriving >0.8 s after the first hit land on a faded frame; the banner hide timer is never cleared (H:2114). **Every heavy-shot hit says "CRITICAL HIT!"**: heavy has severity 0.88 (EA:21) and >0.82 is critical (H:1993; AD:439). Many declared events are never emitted (PR:52-91 vs EA:5-71): special charge/ready, discovery, crew callouts, threats and target-status handlers are dead (H:471-567; AD:265-317); firing the special gets no HUD reaction.
- **Missing:** on-target hit markers and damage numbers; directional damage styling (side recorded at H:2099, never styled); slow-mo/kill cam (time scale locked to 1 and rejected otherwise by `src/simulation/saveValidation.ts:106`); rumble; rotational shake, FOV punches, impact frames, speed lines; special cut-ins; sinking finisher; coin/bounty count-ups. The whole UI has 8 CSS animations.

## 4. Audio

- **All synthesized, no samples.** Master 0.72 → one compressor (−14 dB, 5:1); music/SFX/ambience buses 0.28/0.82/0.5 (AD:37-43, 526-553). Water: a 3 s noise loop through a speed-following filter (206-208, 573-575); wind: the same loop sped up (209-210); hull: 35–86 Hz sine (211-213); creaks: synth blips (773-780); storm thunder (223-226).
- **"Adaptive score":** a 16-step oscillator sequencer, four modes at 92–144 BPM, fixed patterns, synth drums (57-76, 714-756); mode change resets the pattern and ramps volume (704-712) — effectively a one-bar chiptune loop.
- **SFX:** cannon as layered noise + pitch drops with ammo variants (341-371); impacts as square-wave "splinter" blips (395-399); reload, hit ping, status/threat beeps, countdown, fanfare (403-511, 790-829); special (477-496). **Absent:** voices, crew barks, shanties, UI sounds, cannonball whistles, cracking wood, mast falls, fire, harbor ambience, rain.
- **Ceiling:** oscillators and noise can't produce timber, black powder, surf or orchestral/folk instruments; the ocean is a steady hiss.
- **Mix gaps:** no spatial audio — every volley at full volume (EA:7-13; no distance term), panned by the *firing ship's* side rather than its position relative to the player (AD:354, 947-951); every splash on the map plays (EA:31-32); no panner or listener. No ducking or voice limits; the single compressor will pump in fleet fights. Menus reuse the gameplay loop at 20% (AD:196, 205). Crew callouts are silent (H:579-594). Mute isn't saved and says "Audio toggled" (H:1077-1080); a volume function (AD:332) has no UI.
- **Replace with sourced assets:** orchestral + shanty/folk score as stems (fiddle, concertina, bodhrán, a brass hero theme); cannon near/far layers with tails, fly-by whistle, wood impact/splinter, sail tear, mast fall, sinking groans, fire, splashes; bow-wash and hull-slap loops synced to waves, harbor bed; crew barks and sung shanties while sailing; a UI set. Keep the synth only as fallback.
- **Music states:** title, harbor, exploring (calm/under sail), tension, low/high combat, boss, special sting, low-hull layer, victory/defeat/extraction, storm — transitions on bar lines.

## 5. Controls

- All actions sit on the left hand: aim is hard-coded to holding Z or V (IC:142-153), fire is Q/E; holding V blocks the finger steering with D, Z conflicts with A and Q; you can't steer, aim and fire together. The mouse only orbits (CR:56-81) and nudges lead (IC:181-184); no mouse button can be bound (H:1437).
- **Side selection is key-driven** (Z/V, LT/RT at IC:98-99, touch AIM L/R at H:764); aiming snaps to a fixed rail and ignores orbit (CR:126-130, 173-181). In AC4 the camera direction picks port/starboard/bow/stern; hold to aim, press to fire.
- **Gamepad:** fixed map (IC:10-23), first pad only (IC:78), on/off steering and sail (IC:87-92), right stick only adjusts lead (IC:102-103) so no camera control; D-pad unused; no rumble; menus not navigable by pad (no gamepad code in `src/ui`).
- **Touch:** 4 arrows + 10 actions (H:764); aiming needs a two-finger hold-and-tap (H:798); 44 px targets are fine (CSS:2574).
- **Remapping:** 11 keyboard actions only; aim, lead, H/J/T/M and camera keys reserved (H:1424-1436); hint text hard-codes "Z / V" (H:1243, 1366, 1383); remapping silently drops the arrow alternate (H:1451-1453); Arrow Left/Right show blank labels (CT:73-81); no gamepad remapping.

## 6. Accessibility and settings

- **Present:** shake slider, aim-camera assist, subtitle size (callouts only, CSS:1051), key remapping, shake defaults to 0 under OS reduced motion (CT:39-41), focus trapping in menus (H:1461-1482) with visible focus rings (CSS:62-67).
- **Bug:** shake 0 turns on reduced motion for the whole UI (H:1351-1353), cutting every animation to 0.001 ms (CSS:2354-2365); hit confirms, volley stamps and victory/defeat banners jump to their faded end frame (CSS:1751-1798) and never appear.
- **Missing:** volume sliders, HUD/text scale, colour-blind-safe status colours (mint/yellow/coral only), hold vs toggle, FOV-change toggle, in-game graphics quality (URL-only, `src/runtime/AppConfig.ts:18-21`), gamepad remapping, length-scaled callout durations (fixed 2.8 s, H:2084-2092), localization. The callout live region announces everything immediately (H:776), flooding screen readers.

## 7. Code health

- Hud.ts is one 2,190-line class owning title, ship select, HUD, pause, settings/remap, crew menu, touch controls, callouts, radar, feedback and targeting rules. Elements are looked up by string keys (H:873-882) from a 200-line template string (H:623-821). VoyagePanel rewrites its whole innerHTML on each change and restores focus by hand (VP:173-199).
- Target/intent selection is implemented three times (H:1579-1706, AD:665-695, AG:9-73). Ship stats are hand-typed and drifting ("Navy Galleon" at H:194 vs "Marine Galleon" at `src/content/shipSpecs.ts:125`).
- The HUD rewrites the page every frame (GA:273); the radar is rebuilt from scratch each frame (H:1840-1841); media queries and DOM lookups repeat per frame (H:1236, 1293). CSS is one global 2,834-line sheet with repeated breakpoints and minified patches at the end (CSS:2567-2591); tokens exist only for colours and safe areas (CSS:1-22); AG:225 uses inline styles.
- Dead code: never-emitted event types; `src/runtime/shipPresentation.ts` (imported nowhere); hidden `.launch-sun` and `.crew-portrait`.
- **Refactor before the UI overhaul:** one typed HUD data model + shared targeting; split Hud.ts into components (title, harbor, pause, settings, helm HUD, world overlay, feedback, callouts, touch); a single per-frame projection pass for world-anchored UI; a type scale with a 12 px minimum that scales with the viewport, licensed fonts, layered CSS; an input action map where aim is an action, with per-device bindings and menu navigation; a data-driven audio cue table; a render clock separate from the simulation clock.

## Top 12 UI/audio/feel changes (ranked by impact)

| # | Change | Fix | Effort |
|---|---|---|---|
| 1 | Sourced audio | Adaptive orchestral/shanty score; recorded cannon, wood and water SFX; synth as fallback | L |
| 2 | Camera-driven aiming | Hold RMB/LT to aim the side the camera faces; fire LMB/RT; orbit with mouse/right stick; filled colour-coded wedge on the water | M |
| 3 | Combat feedback layer | On-target hit markers, damage numbers, enemy nameplates, directional damage; fix the CSS mismatch, restart bug and heavy=critical label | M |
| 4 | Anime special moment | Portrait cut-in, name call, speed lines, ~0.5 s slow-mo, camera push; emit charge/ready events | M |
| 5 | Declutter the HUD | Ship ring, minimap with compass rim, contextual prompts; hide economy in combat; 12 px minimum, real fonts | M |
| 6 | Keep the world alive behind menus | Ocean, sky and ship idle motion on a render clock during title, harbor and pause | S |
| 7 | Cold-open onboarding | Scripted ~90 s first skirmish teaching sail/steer/aim/fire/brace with a story hook; contracts afterwards | L |
| 8 | Crew voice and portraits | Barks for fire/brace/reload/hit/kill, portraits, a priority queue, length-based timing | M |
| 9 | Audio mix | Listener-relative spatial audio with falloff; fix side-pan; ducking and voice limits; title/harbor themes; volume sliders; saved mute | M |
| 10 | Front-end spectacle | Animated logo + title theme, ship turntable with stats from specs, harbor as a map table, animated rewards and bounty | M |
| 11 | Input parity + accessibility | Pad menu navigation, right-stick camera, analog helm, rumble, full remapping incl. aim, hold/toggle; fix reduced-motion bug; colour-blind modes; HUD scale | M |
| 12 | Refactor that unlocks the rest (do first) | Split Hud.ts, typed HUD model with shared targeting, throttle DOM writes, delete dead event paths | M |
