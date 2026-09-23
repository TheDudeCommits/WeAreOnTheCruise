# Gameplay systems audit

2026-09-23, branch `codex/cinematic-anime-overhaul` @ `1a11e13`. Read-only code audit by an audit agent; drift and range figures come from re-running the cited formulas in isolation, not from play. The lead spot-checked the AI lead (`GS:1473`), the boss kind (`GS:346`), the two-enemy cap (`GS:341`) and the ammo table (`GS:147-157`) against source. Parent plan: [AAA-OVERHAUL-PLAN.md](../AAA-OVERHAUL-PLAN.md).

**Short answer:** the save system and voyage state machine are solid; the gameplay on top is a prototype. Fights have at most 2 hostile hulls. There is no boarding and you never sail between legs. The boss is an ordinary galleon. Meta progression is used up after about one voyage.

Path keys: GS = `src/simulation/GameSimulation.ts`, BA = `src/simulation/ballistics.ts`, SP = `src/simulation/specials.ts`, SV = `src/simulation/saveValidation.ts`, FA = `src/simulation/factions.ts`, CT = `src/core/contracts.ts`, SS = `src/content/shipSpecs.ts`, VY = `src/content/voyages.ts`, SC = `src/content/scenarios.ts`, IN = `src/input/InputController.ts`, HUD = `src/ui/Hud.ts`, AG = `src/render/camera/AimGuide.ts`.

## 1. Ship handling

- **Sails:** one continuous throttle from −0.25 to 1, ramped at 0.68/s (GS:1015). No discrete sail states. Speed = maxSpeed × throttle × wind × sail damage × drag × build × helm crew (GS:1303-1311).
- **Wind:** `0.68 + 0.34 × following × strength` (GS:1299-1302), a simple dot product. No points of sail and no in-irons; dead upwind still gives 68% speed. Wind never changes during an encounter and is the same on every route: 0.25 rad, or 0.7 in storms (GS:366-367). The player always spawns at (0,0,100) heading 0 (GS:329-332), so the wind angle is always the same.
- **Drift:** the velocity *vector* is damped equally in every direction, accel/maxSpeed (GS:1315-1319): a time constant of about 6 s for Sunny and 10 s for Moby, with no keel model. Replaying GS:1298-1335 for Sunny at full rudder gives 42° drift after 2 s and 79° after 5 s while speed falls from 28.6 to about 10–14 m/s. The ship slides sideways like a hovercraft.
- **Turning:** turn rate rises with speed (GS:1327-1331). Yaw lag is a fixed 4/s for every hull (GS:1332), so the 6,400 t Moby turns in as quickly as the 350 t Merry. Mass only affects buoyancy, heel and collisions (GS:1366, 1380, 1731-1743). The rudder reaches full lock in about 0.1 s (GS:1019). Gamepad steering is read as on/off (IN:87-92).
- **Hard turn (Shift):** yaw × 1.85 × grip, bleeds speed, charges the special (GS:1314, 1320-1330). It switches off below 28% forward speed, after about 1.5 s.
- **Waves:** only heave and tilt the ship (GS:1339-1384). No surfing, slamming or rogue waves. Weather's physical effect is wave height (`src/render/ocean/InfiniteOcean.ts:245-253`) plus stronger wind in storms. Current is one global vector (GS:1312-1313); per-chunk currents are generated but never read (`src/world/chunks.ts:167-169`).
- **Compared with AC4:** no stop/half/full/sprint gears, no sharper turn at half sail, a weak and constant wind bonus.
- **Missing for weighty steering:** sideways drag much stronger than forward drag, mass-scaled yaw and roll inertia, rudder grip that depends on flow, a speed curve by wind angle with gusts, wave forces, impulse collisions, analog steering.

## 2. Combat

- **Batteries:** port, starboard and bow only (CT:39-44); stern fire is rejected (GS:1466). Volleys are capped at 6 shots per broadside and 3 from the bow (BA:11-15), so Moby's 14 guns (SS:75) fire the same 6 balls as Sunny's.
- **Ammo:** round, chain, heavy, explosive (CT:16); one selection per ship, unlimited supply (GS:1023-1026); stats at GS:147-157 and BA:32-36. **Explosive has round shot's arc and reload but deals 24/16/19/18 against 18/7/10/7, so round shot is never worth using.** Nothing causes fire or flooding.
- **Aiming:** Z/V picks a side; mouse or `,`/`.` sets fore/aft lead of ±0.28 rad (IN:142-151, 181-184). No elevation, so range is fixed per ammo (Sunny: round ~136 m, heavy ~81 m). Hits use a box from −0.75 to +1.9 × draft (GS:1646-1652); the whole arc stays inside it, so any ship on the line of fire within range is hit. **The AI never leads (lead = 0, GS:1473).**
- **Damage:** hull, sails, weapons, crew, plus 4 hull sections (GS:1689-1693). Sail and stern damage reduce steering; sail damage reduces speed (GS:1303, 1329). Weapons damage removes guns and slows reload; guns lock at ≥0.92 (BA:14; GS:1466-1470). Crew damage slows reload and repair (GS:1433, 1470). You cannot knock out a battery and there are no masts, rudder or magazine to hit.
- **Weak point:** the side that just fired takes ×1.52 damage (×1.82 from heavy) for 2.35 s (GS:1487-1492, 1683-1684) — a timing window, not a spot you aim at.
- **Lethality:** one Navy round volley does 1.38× a Merry's whole hull; one player explosive volley removes 0.74 of a galleon's hull (SS:65, 128). Fights are decided in 2–3 volleys.
- **Brace:** −68% damage, −28% speed, no firing near full brace (≥0.78), no cost (GS:1020-1031, 1305, 1688).
- **Repair:** hold R (blocks firing), or automatic with 4+ crew on repair (GS:1021, 1027). No materials. A Guardian-build Sunny regenerates ~4.1% hull/s *while firing* (GS:1433-1434; VY:18); Moby with Carpenter Watch + Repair Locker gets ~11%/s.
- **Disabled/sinking:** disabled at hull ≥0.98 (GS:1903-1917); AI surrenders earlier by role (GS:1140-1145); sinking takes 12 s (GS:622-626). Salvage 90 coins, spare 45 + 0.2 special charge, scuttle 30 (GS:424-436); salvage almost always wins.
- **Ramming:** circle collisions (GS:1726). Damage = relative speed × uncapped mass ratio × alignment; the rammer takes none; the target's *bow* section always takes it (GS:1743-1751). A galleon meeting a Merry at ~3.5 m/s disables it in one contact.
- **AC4 arsenal:** present — broadside, chain, heavy (ammo only), brace. Shallow — ramming, weak points. Missing — mortars, fire barrels, swivel guns, boarding, forts, legendary ships. A `'boarding'` mode is declared (CT:15) but unused; Sunwatch Fort is a collision circle (`src/world/LogicalWorld.ts:50`).
- **Boarding / on-deck play:** none. Named characters are HUD display data (`src/content/crewSpecs.ts:7-21`); gameplay crew is 10 anonymous hands over 4 stations (GS:262-280).

## 3. Enemy AI

- 6 combat roles (CT:29), 3 personalities (CT:18), re-plan every 0.12–0.17 s (GS:1046).
- **Steering:** head for the target, then circle at ~85° off. Circling direction is a hash of the ship id, so each AI always circles the same way and uses the same battery; it never turns to bring a loaded side to bear (GS:1081-1109). Flankers aim behind the stern (GS:1069-1073), rammers charge (GS:1083-1087), reckless ships weave (GS:1111). "Mistakes" are random heading errors (GS:1038-1044).
- **Firing:** whenever the target is in arc within 165–205 m, no lead (GS:1115-1126). The ranged role fires beyond the Navy galleon's real reach (~150 m).
- **Works reasonably:** ammo choice (GS:1233-1241), bracing against incoming fire (GS:1127-1133), repairing out of range (GS:1134-1136), specials (GS:1137), surrender.
- **Missing:** formations, focus fire, coordinated flanking, retreat, hard turns, boarding, terrain use, difficulty levels.
- **Voyage enemies:** 3 setups, at most 2 hostile ships (GS:341-353): galleon "Dawn Patrol", Polar "Reef Interceptor", galleon "Captain of Sunwatch". Nothing gets harder with later legs or more runs.
- **Exploit:** after the objective completes, surviving attackers go passive and can be sunk freely for coins (GS:573-580, 879, 1461, 1934-1936).

## 4. Content volume

- Ship classes: 6 playable (`src/content/sketchfabShips.ts:4-11`) plus 3 legacy specs without models (SS:79-114).
- Enemy ship types in voyages: 2 (Navy galleon, Polar Tang). Free play also uses Moby, Sunny, Merry and Baratie as AI (SC:75-81, 164-172).
- Encounter types: 5 (CT:85). Salvage and storm spawn **no enemies** (GS:340-341): salvage is "sail ~320 m, wait 12 s"; storm is "pass 3 gates". Escort is an armed, pre-damaged Baratie trailing *you*; stay within 260 m for 75 s (GS:357, 566, 1191-1198, 1257).
- Contracts: 3, differing only in first-leg type and payout (VY:21-25, 50-59). Leg 2 is a random pick of 3 types; leg 3 is always the boss; 2 routes per leg.
- Route landmarks are labels only: nothing reads `landmarkId` and every encounter uses the same spawn points (GS:329-347).
- Islands: 4 hand-placed (VY:43-48) plus procedural; they block movement and give +1 treasure on discovery (GS:1828-1837).
- Bosses: 1, a full-health Navy galleon (GS:345-349); both branches of the kind choice at GS:346 return the galleon. The "admiral" and "rival captain" in contract text (VY:23-24) don't exist.
- Rewards/builds: 6 in-run upgrades, 3 builds, 3 one-level refits (780 coins total), 5 crew presets (VY:4-40). Free play: 12 scenes (CT:249-262).
- **Unique content:** a voyage is ~5–8 minutes; everything distinct is seen in ~25–40 minutes, about an hour including every ship and the free-play scenes.

## 5. Replayability and progression

- **No sailing between legs:** the simulation only runs during an encounter (GS:686, 851); each leg clears the world and teleports the player to the spawn (GS:328-336).
- **Roguelite elements:** losing forfeits unbanked coins (GS:497). The leg-3 upgrade pick is discarded because the voyage settles immediately (GS:397-399); only 2 picks matter.
- **Meta:** banked coins only buy the 3 refits (GS:414-422). One completed voyage pays >900 coins (`tests/voyages.test.ts:42`), enough for all three. Every ship is unlocked from the start.
- **Rivals:** one counter (GS:362-363, 501-504); its only effect switches the boss role from broadside to ranged (GS:346-347). **Bug:** extracting after beating the boss records an "escape" and forfeits the contract payout (GS:497, 501-504, 524-525).
- **"WANTED ฿30M":** real but mostly cosmetic — `state.bounty` (HUD:692-693, 1520) starts at 30M (GS:748; SC:149) and grows with kills (GS:1930-1936), **resets at every new voyage and harbor visit** (GS:286, 304) and is not saved in progression (CT:131-141). Its only effect makes Marines prefer you (GS:1168-1172). Treasure has nothing to spend it on (HUD:1521).
- **What stops run #5:** same arena, wind and 1–2 enemies every fight; no difficulty ramp, unlocks, coin sinks, story, or boss variety.

## 6. One Piece flavour

- **Real:** three canon ship specials (Moby's quake belongs to the ship, not Whitebeard). Marines are the only voyage enemy (GS:339). A Yonko diplomacy table exists (FA:3-47) but only matters in free play.
- **Absent:** no haki, devil fruit, log pose or sea king anywhere in `src`. The only Haki-like attack belongs to the unplayable Red Force (GS:1525-1527). "Buster Call" is scene text (SC:162). Fog and night change only wave height; no detection rules. Maelstrom weather is unused.
- **Cosmetic:** crew rosters and ship epithets. Ship-card stats are hand-typed and contradict specs: Polar's card shows hull 66 vs Sunny's 74 (HUD:113, 168) but real hull strengths are 160 vs 145 (SS:56, 101).

## 7. Specials

- Full charge ~55 s passively (GS:1286), faster with hits, combos, hard turns, sparing and disables (GS:434, 1323, 1870-1878, 1938). Effects fire after a 0.65 s windup (Moby 1.05 s) (GS:617-645, 1497-1501).
- **Sunny (Coup de Burst):** +26 m/s and a hop, no damage (GS:1509-1513).
- **Polar Tang (dive):** 34 m dive, +22 m/s dash; guns locked until every muzzle clears the water (SP:5-25; GS:1446-1463, 1540-1544). Shots only register above hull height − 0.75 × draft (GS:1650) and die at the surface (GS:1664-1665), **so a fully dived Polar is effectively immune for ~3 s.**
- **Moby (pressure wave):** front to 135 m over 1.8 s; 34 damage once per ship (brace reduces); instantly reloads Moby's broadsides (GS:1520-1524, 1587-1613).
- **Merry ("Miracle Tack", HUD:120):** heals crew/sails, +11 m/s; does not tack (GS:1514-1519).
- **Navy galleon:** instant reload + unaimed heavy shot from both sides (GS:1554-1562).
- **Baratie ("Banquet Barrage", HUD:186):** only heals (GS:1548-1553).
- Merry, Navy and Baratie specials are one-off stat changes with nothing happening during their active phase.

## 8. Code health

- **Monolith:** GS is 1,993 lines, one class, ~75 methods mixing input, voyage state machine, save/load, AI, physics, weapons, specials, racing and rewards.
- **Coupling:** ship-kind checks scattered (GS:453, 637, 1463, 1500, 1628; BA:7); specials are one switch (GS:1508-1564); faction/role rules are switches (FA:5-31). Ship kinds are a fixed union (CT:3-12); adding a ship touches ~8 files. Weapons are 3 cooldowns + one ammo selection with inline stats (CT:39-44; GS:147-157, 1636; BA:32-36); no weapon table, no hazards (fire barrels).
- **Save lock-in:** internal runtime state and projectile slots are saved as-is (GS:440); the validator requires every field (SV:54) and version 1 exactly (SV:103); no migrations. Tuning constants are duplicated inside the validator (SV:41, 71, 140, 158). Hard limits: 20 ships (SV:107, 112), 256 projectile slots (SV:113), exactly 10 crew (SV:28-29), every encounter target must be Marine or Big Mom (SV:139-141).
- **Scaling to 10–20 ships:** only 160 projectile slots (GS:191) and volleys are silently truncated (GS:1477-1478); linear ship lookup (GS:1951-1953); every AI re-plan scans all projectiles × ships (GS:1127-1130); all-pairs collisions; buoyancy allocates every tick (GS:1340); event queue caps at 256 (GS:892).
- **Determinism:** fixed timestep, seeded noise (GS:1984-1992), replay test (`tests/determinism.test.ts:10-20`). But in the real game buoyancy reads wave settings owned by the renderer (`src/runtime/GameApp.ts:121-122`; `InfiniteOcean.ts:216-228`) while tests use a fallback wave model (GS:190): the real wave physics are untested and the simulation depends on presentation code.
- **Tests:** saves, voyage state machine, specials, input and aiming are covered; handling, AI, balance and difficulty are not. Main voyage tests play as unselectable `red-force` (`tests/voyages.test.ts:12`; `tests/voyage-integrity.test.ts:8`).
- **Dead code:** Red Force, Oro Jackson, Queen Mama specs/crews/specials/cards (SS:79-114; `crewSpecs.ts:46-69`; GS:1525-1547; HUD:137-180); boarding mode, maelstrom weather, chunk regions/currents, `timeOfDay`, route `landmarkId`, island `service` (only "harbor" is read).
- **Bugs:** a player sailing the Baratie never gets an aim target (AG:22-25 checks hostility; merchant faction is never hostile, FA:36). Baratie's collision width is 34 m against a ~124 m model (SS:117). Plus the ram-section, extract-as-escape and passive-enemy bugs above.
- **Refactor first:** (1) split GS into systems over one entity store with id lookup — sailing, weapons, damage, AI (planning + steering), specials, encounter director, persistence; (2) move ship, weapon, ammo, special and enemy definitions into data tables; (3) version the save and add migrations; (4) raise ship/projectile limits; (5) move sea state into the simulation; (6) add a per-ship crew-count resource and encounter sub-states (boarding needs both).

## Top 15 gameplay gaps (ranked by impact on AAA feel and replayability)

1. **Hovercraft handling** → keel-style drag (lateral ≈10× forward), mass-scaled yaw inertia, 4 sail gears with a tighter turn at half sail.
2. **Thin arsenal** → per-battery ammo, stern chasers, mortars with a reticle, swivel guns at physical weak points, fire barrels, fire/flooding DoT, limited ammo stocks; rebalance explosive.
3. **Tiny, static battles** → enemy type table (gunboat, brig, frigate, man-o'-war, mortar ship, fire ship, pirates), 4–10 ships per encounter scaling with leg and notoriety.
4. **Weak gunnery AI** → skill-scaled intercept lead, switching to the loaded side, stern rakes/crossing the T, focus fire, formations, retreat.
5. **No boarding** → grapple when slow (<6 m/s, <30 m), then a boarding phase (crew duel + captain action) ending in capture, plunder or recruitment.
6. **Arena teleports** → keep simulating on the sea chart; place encounters at their landmarks with random wind and approach; give salvage/storm legs real threats.
7. **Fake boss** → phased bosses with armoured sections, a signature special and reinforcements (e.g. a Vice-Admiral calling a Buster Call wave).
8. **Meta runs out after one run** → tiered refits per ship, ship unlocks, crew recruitment, cosmetics, bounty-scaled coin sinks.
9. **No One Piece powers** → cooldown abilities on the crew already in the game (grapple-boarding, cutting cannonballs, lightning/weather, weak-point sniping, repairs, Room).
10. **Cosmetic WANTED** → persist bounty; tiers raise Marine pressure, spawn hunters, unlock contracts.
11. **Cosmetic weather** → simulation-owned weather: fog/night cut detection range; storms bring gusts and rogue waves; a maelstrom pulls ships in.
12. **Broken collisions** → ship-shaped hulls, impulses, damage the rammer, cap mass ratio, damage the side actually hit, full-sail ram bonus.
13. **Free unlimited repair** → materials from salvage, component-targeted crew repair, brace stamina.
14. **Rivalry is one counter** → persistent named nemesis captains with traits and scars who return stronger.
15. **No forts or set-pieces** → fort batteries with destructible guns; landmark objectives (arch ambush, reef-narrows run).
