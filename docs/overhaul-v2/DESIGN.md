# We Are On The Cruise — Overhaul v2 design bible

Owner decisions (2026-09-24): **inspired-by world** (original names, factions, lore — no One Piece names, characters, currency or terms in game text); **keep the six downloaded ship models for now** (renamed in game); **new ships come from Sketchfab (CC0/CC-BY, clean provenance) or, when Sketchfab has nothing usable, Meshy**; **no boarding — ship battles only**, with ships that level up, gain weapons and grow like the Mecha survivor game; **desktop Chrome** is the only target; **free Creative Commons music and SFX** (CC0 / CC-BY, ledgered).

Visual targets: `docs/aaa-overhaul/targets/` (generated paint-overs; goals, not evidence). The "Grand Line Cel" style rules in `docs/aaa-overhaul/AAA-OVERHAUL-PLAN.md` §4.2 still apply (rename aside).

---

## 1. The game in one paragraph

A naval **survivor-like**. You captain one ship through a 15-minute run on an endless sea. Enemy ships arrive in escalating waves from every direction; your guns fire **automatically** whenever an enemy bears, so the skill is **seamanship** — turning to bring broadsides to bear, using wind gears and boost, dodging mortar circles and rams, bracing at the right moment, and aiming three manual skills. Sunk ships leave floating treasure (XP). Every level-up offers **three cards**: new weapons, weapon levels (branch at level 3, **OVERDRIVE ★** at 6), passives and stat chips. Your ship visibly grows: more guns on deck, iron plating, lanterns, bigger flags, weapon mounts. Bosses arrive at 5, 10 and 15 minutes. Doubloons bank between runs for permanent harbor upgrades, new ships and new seas.

## 2. World (original IP)

| Element | Name |
|---|---|
| The ocean | **The Brightwater** |
| Seas (run maps) | **Sunward Shallows** (bright day, turquoise, starter) · **Stormwrack Reach** (storms, rogue waves, dusk) · **The Gloam** (fog and night, wraith ships) |
| Navy faction | **The Admiralty** — white hulls, navy-blue trim, gold wave-crest emblem. Ranks: Ensign, Lieutenant, Captain, Commodore, Vice-Admiral, Fleet Admiral |
| Pirate faction | **Redtide Corsairs** — red sails, black hulls, cutlass-and-sun emblem |
| Undead faction | **Gloam Wraiths** — spectral teal fire, torn sails (The Gloam only) |
| Monsters | **The Deep** — Wyrmlings, the **Tidewyrm** (sea serpent boss) |
| Currency | **Doubloons** (◈) |
| Score | **Bounty** — shown on a WANTED poster at the end of a run |
| Player crew | "your crew" — generic original sailors (no named anime characters) |

Player ships (models kept, renamed; `modelKey` = legacy file name in `/assets/sketchfab/`):

| id | Name | Epithet | modelKey | Identity |
|---|---|---|---|---|
| `dawn-ram` | Dawn Ram | The Lucky Little Ram | `going-merry` | nimble, fragile, lucky — starter |
| `sunlion` | Sunlion | The Roaring Brig | `thousand-sunny` | all-rounder — starter |
| `yellowfin` | Yellowfin | The Diving Blade | `polar-tang` | ambusher, dives |
| `grand-galley` | Grand Galley | The Floating Feast | `baratie` | fortress, heals, deck guns |
| `seawarden` | Seawarden | The Captured Warship | `navy-galleon` | armour and artillery |
| `white-leviathan` | White Leviathan | The Old Titan | `moby-dick` | ponderous, massive broadside |

## 3. Controls (desktop Chrome; gamepad optional)

| Action | Keys | Notes |
|---|---|---|
| Sail gear up / down | W / S (↑/↓) | gears: ANCHOR · HALF · FULL. Half sail turns tightest. |
| Rudder | A / D (←/→) | A = port (positive yaw per the coordinate contract) |
| Boost (wind gust) | Shift | +45% speed ~2.5 s, cooldown |
| Brace | Space | −70% damage ~1.2 s; a hit in the first 0.25 s is a **Parry** (reflect a shock ring) |
| Aim | mouse | world point on the water under the cursor |
| Full Broadside | LMB or Q | manual heavy volley from the side facing the cursor; the AC4 moment |
| Special | E | ship-specific, aimed at the cursor where relevant |
| Ultimate | R | charged by damage dealt |
| Camera | RMB drag orbit, wheel zoom | |
| Level-up cards | 1 / 2 / 3 (/4), X reroll | game pauses on level-up |
| Pause | Esc / P | |

## 4. Core numbers (tuned by `scripts/balance-sim.ts`; content tables are the source of truth)

- Tick 60 Hz fixed step. Run 15:00 (Sunward), bosses at 5:00 / 10:00 / 15:00; beating the 15:00 boss = **Victory** (then optional endless).
- XP to next level: `6 + 4 × (level − 1)` (tunable). Target ~level 25–35 at 15:00.
- Slots: **6 weapons** (slot 1 = ship's starting weapon, normally Broadside) and **6 passives**.
- Weapon levels 1–6; **level 3 = branch A/B choice**; **level 6 = OVERDRIVE ★** (replaces the level card once the weapon is 5 and the run has reached ~level 10+).
- Passive ranks 1–5.
- Cards per level: 3 (4 with enough Luck). Card pool weights: owned weapon/passive upgrades > new weapons/passives (while slots free) > stat chips > heal/doubloons fallback.
- Ship **tier** (visual growth) by level: T0 1–4 · T1 5–9 · T2 10–14 · T3 15–21 · T4 22+.
- Spawn ring 260–420 m from the player, outside the view; separation between enemies; soft cap ~90 live enemies (director budget).

### Weapons (12)
| id | Name | Behaviour (auto-fire) | Branch A / B | Overdrive ★ |
|---|---|---|---|---|
| `broadside` | Broadside Battery | volleys to port/starboard at enemies within ±40° of the beam | Chain Shot (slow, shreds) / Heavy Shot (pierce, knockback) | Rolling Thunder — continuous ripple fire both sides |
| `bow-chaser` | Bow Chaser | long-range shot at enemies ahead (±25°) | Twin Chasers / Longtom (piercing line) | Lance of Dawn — piercing beam shot |
| `stern-mortar` | Stern Mortar | lobs shells at the densest cluster 90–260 m | Cluster Shells / Firepots (burning ground) | Meteor Rain |
| `swivel-guns` | Swivel Guns | rapid 360° fire at the nearest within ~90 m | Double Swivels / Grapeshot cone | Hailstorm |
| `fire-barrels` | Fire Barrels | drops burning barrels astern; fire patches | Barrel Chains / Powder Kegs (explode) | Sea of Fire |
| `harpoon` | Harpoon Gun | spears an enemy, damage + pull + slow | Chain Harpoon (3 targets) / Tow Line (smash targets together) | Leviathan Hook |
| `rocket-rack` | Rocket Rack | homing rocket volley | Swarm / Big Bertha | Skyburst |
| `storm-rod` | Storm Rod | chain lightning from the mast | Forked (+jumps) / Thunderclap (AoE stun) | Thunderhead — a storm cloud follows the ship |
| `tide-mines` | Tide Mines | drifting proximity mines | Magnet Mines / Depth Charges | Minefield |
| `iron-ram` | Iron Ram | ramming damage ×, knockback, contact spikes | Spiked Hull / Shockwave Prow | Iron Tusk — rams heal and grant i-frames |
| `escort-skiffs` | Escort Skiffs | small boats orbit and shoot | +2 Skiffs / Fire Skiffs (kamikaze, respawn) | Armada |
| `maelstrom-charm` | Maelstrom Charm | whirlpools at clusters pull and grind | Twin Vortex / Riptide | Maelstrom |

### Passives (12, max rank 5)
Ironwood Hull (+max HP, armour) · Cloudsilk Sails (+speed, turn) · Powder Monkeys (−cooldown) · Master Gunner (+damage) · Long Barrels (+range, projectile speed) · Salvage Nets (+pickup radius) · Lucky Doubloon (+crit, +luck) · Shipwright (regen) · Figurehead of Fury (+crit damage, +area) · Weather Eye (+XP) · Drill Master (−skill cooldowns) · Deep Stores (+projectiles every 2 ranks, +duration).

### Specials (E) and ultimates (R)
| Ship | Special | Ultimate |
|---|---|---|
| Dawn Ram | Second Wind — heal 30% + 3 s shield | Ramming Speed — 6 s: +80% speed, ram ×5, knockback |
| Sunlion | Lionburst — 1 s airborne dash (~180 m), invulnerable, damaging landing ring | Sunfire Barrage — 8 s of both broadsides + fire rounds |
| Yellowfin | Deep Dive — 3 s submerged (untargetable, +speed), surfacing burst | Torpedo Swarm — 12 homing torpedoes |
| Grand Galley | Chef's Banquet — heal 20% + 6 s crew frenzy (+50% fire rate) | Kitchen Inferno — ring of fire barrels + flaming broadsides |
| Seawarden | Signal Flare — 12-shell mortar barrage at the cursor | Admiral's Judgment — carpet bombardment along the aim line |
| White Leviathan | Seaquake — 160 m shockwave: damage, knockback, slow | Tidal Colossus — a huge wave front sweeps ahead ~400 m |

### Enemies
| id | Name | Faction | Behaviour | Notes |
|---|---|---|---|---|
| `skiff` | Raider Skiff | Corsair | swarm, rams | fast, fragile, early fodder |
| `cutter` | Admiralty Cutter | Admiralty | chaser, bow gun | |
| `brig` | Admiralty Brig | Admiralty | broadside circler | leads shots (skill scales with time) |
| `fireship` | Fire Ship | Corsair | kamikaze | telegraphed explosion |
| `mortar-barge` | Mortar Barge | Admiralty | artillery at range | red telegraph circles on the water |
| `frigate` | Admiralty Frigate | Admiralty | broadside, formations | tanky mid-game |
| `man-o-war` | Man-o'-War | Admiralty | heavy broadsides | elite-tier, drops chests |
| `corsair-brig` | Redtide Brig | Corsair | aggressive broadside, boards-by-ramming | |
| `corsair-galleon` | Redtide Galleon | Corsair | heavy, slow | |
| `wraith` | Gloam Wraith | Wraith | phases in/out | The Gloam |
| `wyrmling` | Wyrmling | Deep | lunges from under water | |
| `fort` | Cliff Battery | Admiralty | stationary on islands | |

Elites: any enemy may spawn elite (×3.5 HP, glow, bigger, drops a chest).

### Bosses
| id | At | Name | Kit |
|---|---|---|---|
| `iron-warden` | 5:00 | **The Iron Warden** (Commodore's dreadnought) | broadside volleys with line telegraphs, mortar barrage circles, summons cutters; phase 2 at 50%: armour plates off, ram charge |
| `tidewyrm` | 10:00 | **The Tidewyrm** | submerge → telegraphed ripple → lunge; tail-slam wave rings; water-bolt volleys; phase 2 summons wyrmlings |
| `sovereign` | 15:00 | **The Sovereign** (Fleet Admiral's flagship) | broadside storms, Judgment-line artillery, man-o'-war escorts; defeat = Victory |

### Director
Time-based spawn budget, enemy mix per minute, set-piece events: *Ambush ring* (skiffs from all sides), *Fire ship rush*, *Mortar line*, *Treasure convoy* (fleeing merchants drop doubloons), *Storm front* (rogue waves, lightning strikes; Stormwrack), *Fog bank* (reduced view; Gloam). Heat increases enemy HP/density over time and with meta difficulty.

### Pickups
Treasure XP (copper coins 1, silver 5, gold bars 25; merge when many), doubloons (meta currency), repair crate (+25% HP), compass (magnet everything), powder keg (screen-clear blast), chest (from elites/bosses: 1–3 upgrades; boss chests can force an Overdrive).

### Meta (localStorage `cruise.meta.v2`, settings `cruise.settings.v2`)
Harbor upgrades (ranks with rising doubloon costs): Hull, Sails, Powder (damage), Gunnery (cooldown), Salvage (pickup radius), Fortune (luck), Wisdom (XP), Second Wind (revives, max 2), Charts (rerolls), Banish. Ship unlocks: Dawn Ram and Sunlion from the start; Yellowfin (doubloons); Grand Galley (doubloons); Seawarden (defeat the Iron Warden); White Leviathan (win a run). Seas: Stormwrack after surviving 10:00; The Gloam after a victory. Best bounty per ship; lifetime kills; achievements.

## 5. Visual direction (summary)

Grand Line Cel: one toon ramp for everything (2 hard bands + soft core band, cool violet shadows, lit-side rim), navy ink outlines that fade with fog, HDR post (bloom on flashes/glints/lanterns, per-weather grade, vignette), sakuga FX (shape-first, inked two-tone smoke that erodes, additive starburst flashes, splash crowns, debris, impact frames on crits/kills, speed lines on dash/boost), an ocean with calm readable swells, crest glow and **hull-driven foam** (bow wave, V wake, impact rings, sinking whirls), time of day across a run (dawn → noon → golden hour → night on Sunward), storms with rain/lightning/rogue waves, lush islands with strata cliffs, beaches, palms and forts. Readability first: the camera sits higher than the old chase cam (tactical 3/4, ~110–160 m) so enemies around the ship are visible, and zooms out as the fight grows.

The ship's growth must read at a glance: each tier adds deck cannons, plating, lanterns, flags, figurehead glow; each weapon adds its mount (mortar on the stern, rocket rack on deck, swivels on rails, harpoon on the bow, storm rod on the mast, ram plating on the prow, skiffs alongside).

## 6. Architecture and ownership

```
src/game/            contract types, ids, constants            (lead)
src/game/content/    all data tables                           (META)
src/game/sim/        Sim orchestrator + core systems           (CORE)  — except ai.ts, director.ts, bosses.ts, progression.ts, weather.ts (META)
src/game/meta/       persistence, unlocks                      (META)
src/world/           island generation + collision queries     (WORLD)
src/render/frame.ts  render contracts                          (lead)
src/render/app/      RendererHost + post stack + quality       (LOOK)
src/render/materials/ toon material API                        (LOOK)
src/render/npr/      ink outlines                              (LOOK)
src/render/camera/   camera director                           (LOOK)
src/render/sky/      sky, lighting rig, time of day, weather   (LOOK)
src/render/ocean/    ocean + interaction target + foam         (OCEAN)
src/render/fx/       all effects, projectiles, pickups, damage numbers, telegraph decals  (FX)
src/render/ships/    hero ship, enemies (instanced), bosses, upgrades/attachments, crew, sinking  (SHIPS)
src/render/world/    island meshes, vegetation, forts, harbor set  (WORLD)
src/ui/, src/styles/ every DOM screen and HUD                  (UI)
src/audio/, public/audio/  audio engine + CC assets + ledger   (AUDIO)
public/assets/ (new dirs), scripts/assets/, ASSET-LICENSES.md  (ASSETS)
src/runtime/, src/input/, src/main.ts, index.html, vite/ts config  (lead)
lab/<name>.html + src/<area>/lab/*.ts   each agent's standalone lab page (auto-included in the build)
```

Rules for every agent: stay inside your file set; do not edit another area's files or the contract (`src/game/types.ts`, `src/game/ids.ts`, `src/render/frame.ts`, `src/ui/contracts.ts`, `src/audio/contracts.ts`) — if the contract blocks you, write the need in your final report and work around it locally. Keep `npm test` and `npm run build` green. Close every browser you open. Never add One Piece names/terms/characters. Never commit credentials or signed URLs.

## 7. Performance budget (Apple M4, Chrome, 1600×900 @ DPR ≥1.25)

60 FPS with 80 enemies, 400 projectiles and FX. Draw calls ≤ 300; triangles ≤ 2.5 M; textures ≤ 350 MB. Enemies are instanced per class. No per-frame allocations in hot loops. Shaders precompiled at load (`renderer.compile` with a render target bound).

## 8. Evidence

Engine captures go to `output/` (gitignored) or `docs/overhaul-v2/evidence/`; generated images never masquerade as engine frames. Browsers opened by scripts close in `finally`.
