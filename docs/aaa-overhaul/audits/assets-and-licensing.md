# 3D asset inventory and licensing check

2026-09-23, branch `codex/cinematic-anime-overhaul` @ `1a11e13`. Read-only audit by an audit agent: it parsed the GLB headers/JSON chunks of all 241 local source files and the 16 runtime GLBs, fingerprinted textures and geometry to find duplicates, and rendered silhouettes of six unclear files in a temporary directory (deleted afterwards). No network, Sketchfab API or Blender calls; the repo is unchanged. Parent plan: [AAA-OVERHAUL-PLAN.md](../AAA-OVERHAUL-PLAN.md).

Provenance findings below are **indicators**, not legal conclusions. Where a file is described as showing extraction indicators, the evidence is listed; confirm before acting publicly.

## Headlines

- All 241 source "archives" are plain GLBs (`assets/source/sketchfab/<uid>/source.glb`); sizes match `catalog.json` byte for byte (2,065,915,868 total). Also on disk: six `normalized.glb` Blender intermediates (114.6 MB) and 13 empty uid folders (placeholders for the 8 rate-limited and 5 pending items).
- **The pile is mostly characters:** 205 character-tagged files, 24 ship files, 1 ship part, 1 interior. No generic ships, cannons, props, island or harbor pieces, and no sea monsters. The 24 unused ship files are mostly Going Merry (12) and Thousand Sunny (6) variants.
- **Red Force, Oro Jackson, Queen Mama Chanter, Sea Kings, Kraken, Flying Dutchman, Striker, Mini Merry, Big Top and Victoria Punk are not in the 1,678-record catalog at all.** The search only ran "one piece", "one piece ships" and "polar tang".
- **62 downloaded files (213 MB) show indicators of extraction from Bandai Namco games — including 3 of the 4 characters currently in the game** (section 3).
- **The Marine ship's source file has a 73-joint skeleton with named cannon bones** (`Cannon.L/R.*`, `Guns 1 .L/R.*`, `gun3.*`). The runtime GLB drops it. It can supply real cannon positions (HANDOVER item 4).

## 1. Runtime assets (21,387,516 bytes; glTF-Transform 4.5.0: Meshopt, quantization, WebP)

| Asset | MB high/low | Tris high/low | Mats (= draws) | Textures per LOD (max res) | Anim / skin | Source uid · tris · MB | Licence · author |
|---|---|---|---|---|---|---|---|
| going-merry | 1.93/1.18 | 114,773/16,843 | 4 | 12 (1024²) | – | 4b2cb678 · 176,578 · 17.3 | CC BY · Oliver Edwards |
| thousand-sunny | 0.89/0.68 | 28,064/14,508 | 36 | 36 (≤1024×512, mostly 256–512) | – | 99986d1c · 28,064 · 6.2 | CC BY · Miraculousetabug |
| navy-galleon | 6.20/4.57 | 254,289/157,613 | 7 | 19 (1024²) | – (source: 73-joint skeleton) | 92898d5f · 582,938 · 63.0 | CC BY · Ryanwill679/TrashCG |
| moby-dick | 0.15/0.09 | 15,274/7,287 | 1 | 1 (32×4 colour strip; source untextured) | – | d9be26ad · 15,274 · 0.7 | CC BY-SA · Tigerar1 |
| polar-tang | 2.03/1.29 | 115,672/14,162 | 10 | 30 (1024²) | – | a7feb489 · 440,018 · 31.9 | CC BY · taem5070 |
| baratie | 0.93/0.23 | 143,185/21,687 | 1 | 1 (32×4 colour strip; source untextured) | – | 015ebe70 · 596,624 · 18.4 | CC BY · Chin Eeyang |
| crew/luffy | 0.39 | 20,174 | 1 | 1 (1024²) | 66-joint Mixamo; Idle 2.0 s / Kick 2.3 s / Walk 1.07 s | 44b58336 · 28,822 · 2.1 | CC BY · Ricardo3D |
| crew/nami | 0.12 | 3,093 | 1 unlit | 1 (1024²) | 47-joint skin, no clips | 18273524 · 3,354 · 0.7 | CC BY · jvmartins |
| crew/sanji | 0.49 | 8,833 | 10 | 10 (1024²) | 66-joint Mixamo; 1 clip 3.3 s | 7dfddca8 · 9,039 · 2.6 | CC BY · Justin Rajan |
| crew/whitebeard | 0.21 | 7,422 | 2 | 2 (1024²) | static, no skeleton | 13ebbf10 · 9,885 · 1.2 | CC BY · VorLucky |

- **The Marine ship's low LOD (157,613 tris) is heavier than any other ship's high LOD.**
- **Textures load twice per ship:** `SketchfabShipAssets.ts` waits for both LODs and each LOD file carries its own texture copies. If all were resident: roughly 806 MB of GPU texture memory (8-bit RGBA + mips) — Polar pair ≈336 MB, Marine ≈213 MB, Merry ≈134 MB, Sanji alone ≈56 MB. Share textures between LODs and move to KTX2 before adding assets.

## 2. Downloaded but not in the game (231 files, 1.92 GB)

### (a) One Piece ships (24 + 1 part)

| uid | Title · author | Lic | MB | Tris | Textures | Note |
|---|---|---|---|---|---|---|
| 8cf21462 | Going Merry · RadhruinT | BY | 6.5 | 22.5k | 17 (1024) | 5 textures byte-identical to the in-game Sunny |
| 10d9c9ab | Going Merry · kenzie | BY | 2.6 | 36.7k | 1 (1024) | |
| 0e1f1618 | Going Merry · Anex | BY | 4.4 | 86.8k | 1 (1024) | same mesh re-uploaded as 7953efd4 (untextured) |
| 5594f352 | GOING_MERRY_FULL · Riki.exe | BY | 2.8 | 78.9k | none | |
| eb96bb9d | Going Merry · MAN123 | BY | 1.5 | 30.6k | none | |
| f13ee3dc | Going Merry · PedroSouza | BY | 17.6 | 425k | 7 (512) | |
| 5206a935 | The Going Merry · EKBTheSquire | Std | 19.1 | 319k | none | |
| 5a5802eb | Goin Merry FBX · j0el_02 | BY | 40.7 | 1.36M | none | |
| d4395362 | Going Merry Ship · Tigerar1 | BY-SA | 0.9 | 22.5k | none | same triangle count as RadhruinT's |
| 11761ce8 | Vogue Merry Minecraft · IronDurand | BY | 2.2 | 21.5k | 2 | voxel |
| 56cd0ac4 | Aquatic Stage: Merry with Laboon · andreagonzalez28 | BY | 5.8 | 132.6k | 4 (1024) | diorama: Merry + 2 whale bodies + fish |
| ef8de71c | "[HW XYZ School] Detailing 3" · AlinaDracheva | BY | 7.9 | 178k | 2 (23 mats) | silhouette is a Thousand Sunny; ~118k tris are a round water base |
| 5e26e621 | The Thousand Sunny · Ian LaMorre | BY | 5.8 | 18.1k | 8 unlit (1024) | masts without sails |
| 59e09814 | THOUSAND SUNNY · ShacLaw | BY | 3.7 | 61.7k | 4 | |
| 3a992d82 | THOUSAND SUNNY · jacksparrow6730 | BY | 3.9 | 59.7k | none | |
| 59b59a3f | Thousand Sunny Ship · Tigerar1 | BY-SA | 1.2 | 28.1k | none | same 28,064 tris as the in-game Sunny |
| f25860a0 | Thousand Sunny voxel · P_4_N_D_A | BY | 5.2 | 62.3k | 2 (512) | voxel |
| e2db38f4 | Thousand Sunny Lionhead (part) · Randyr1444 | BY | 2.0 | 8.5k | 3 PBR (1024) | |
| a0e59983 | White Wale Ship (Moby Dick) · 3ddans | BY | 5.9 | 93.3k | none | |
| e62c83aa | Law's Submarine (Polar Tang) · GrowlingVarla | BY | 21.2 | 850k | none (STL) | |
| e162a1ff | Marine Ship · Tigerar1 | BY-SA | 0.3 | 7.6k | none (STL) | small single-mast Marine sloop |
| 8be28a20 | Blackbeard Pirates Raft · emperor_prime | BY | 0.7 | 7.2k | 1 unlit (512) | 21-joint skin; extraction indicators (mesh named `SeaBattle_heihuzichuan`) |
| cc4283f5 | Waver Nami · Alec (Dreams Creator) | BY | 3.8 | 10.3k | 4 (1024) | |

Not downloaded (not in the catalog): Red Force, Oro Jackson, Queen Mama Chanter, Marine battleships, the Donquixote ship, Big Top, Victoria Punk, Flying Dutchman, Striker, Mini Merry. Only Ark Maxim (1071de3e) and Puffing Tom (a5eb3240) are in the catalog, both filed as "excluded", and both show extraction indicators.

### (b) Generic pirate ships, galleons, boats

None usable. 84d2d49f "one-piece-ship" (madexc, BY, 21k tris) is a voxel galleon. The catalog's "Sailboat" (15d6b149, np-dev, BY, 142k faces) was never downloaded.

### (c) Characters: 205 files, 85 rigged, 32 with real clips

| Character | Files | Rigged | With clips | Clean-looking highlights |
|---|---|---|---|---|
| Luffy | 66 (17 hats/props) | 27 | 16 | 3d9fb8bd (nitwit.friends: Mixamo, 9 clips, 12.5k); 50df4672 (D7Xtreme, 2.1k) |
| Zoro | 33 (~12 swords/busts) | 10 | 4 | 3709d625 (D7Xtreme, 1.4k) |
| Chopper | 23 | 8 | 1 | mostly unrigged |
| Nami | 21 | 6 | 3 | 7b000ea3 / 0155be27 (Chechorams16, rigged, ~36k) |
| Usopp | 13 | 8 | 1 | 97c2cd70 (D7Xtreme, 6.2k) |
| Franky | 12 | 8 | 1 | 4df3468c (D7Xtreme, 2.0k) |
| Sanji | 9 | 7 | 3 | – |
| Whitebeard | 7 (2 bisentos, 1 grave) | 3 | 1 | – |
| Robin / Brook | 5 / 5 | 2 / 1 | 0 | 3b9b9013 (TheKing7, 19.5k, rigged) |
| Law / Shanks / Jinbe | 4 / 3 / 2 | 1 / 1 / 1 | 0 / 1 / 1 | d4dfcbcf (D7Xtreme Law, 4.0k) |

- **Rigs:** only 3 files use a Mixamo skeleton (in-game Luffy and Sanji, plus 3d9fb8bd; Sanji and 3d9fb8bd share the exact skeleton). **The five D7Xtreme characters (Luffy, Zoro, Usopp, Franky, Law) share one identical 32-joint IK rig**, so one animation set can drive all of them.
- **Animations:** of the 29 files with ≥9 clips, 28 show extraction indicators (clip names like `pl_luffy_thou01_*`) and their clips are combat moves, not ship work. 35 character files are untextured.
- **No Marines or generic sailors** (only a 528-tri Marine coat, 93517812, BY-NC). No enemy captains; Whitebeard and Shanks are allied factions in `factions.ts`.

### (d) Sea creatures

Laboon exists only inside the 56cd0ac4 diorama (needs a Blender cut-out). Yagara Bull 210ff666 (24.7k tris, 191-joint rig) has an internal file name `Ship_35307_H.fbx` that looks like a game asset ID. No Sea Kings in the catalog.

### (e) Islands, environment, props

07a2daa4 Baratie restaurant interior (BY-NC-SA, 96k tris, 15 textures); e81d2664 grave diorama (27k); wanted posters d828707b (4.5k, 6 textures) and 0ebeef67 (430k, untextured); flags fe0c5ed6 (34k, untextured) and c846e910 (85k, 5 textures); ~10 swords, 2 bisentos (b28bcf45, 81c9434f), Law's and Shanks' swords, Nami's staff, Usopp's slingshot, ~13 hats. **No cannons, barrels, crates, docks, buildings, rocks, palm trees, islands or forts.**

### (f) Other

35 files over 250k tris take 1.35 GB (65% of bytes) — apart from the three in-game ships these are mostly 3D-print sculpts (e.g. a 6.5M-tri Zoro, 213 MB). Unusable without rebuilding. 4 voxel files.

## 3. Licensing reality check

| Licence (downloaded / in game) | Free non-commercial fan game with credit | Commercial release |
|---|---|---|
| CC BY (213 / 9) | Yes | Licence allows it |
| CC BY-SA (4 / 1 — Moby Dick) | Yes; modified file stays BY-SA (manifest already does this) | Yes, same condition |
| Sketchfab Standard (17 / 0) | Allowed, no credit needed, but it bans redistributing the asset itself — a public `.glb` URL makes that trivial. Check the licence text first. | Same caveat |
| CC BY-NC (4: ca7a5a97, 36a78e0a, 3b656169, 93517812) | Only with no money involved (ads, donations, paid tiers are risky) | No |
| CC BY-NC-SA (3: 50d2f44a, 07a2daa4, 96a108bb) | Same; derivatives stay NC-SA | No |

- **Labels are less reliable than they look.** 62 files (213 MB) carry extraction indicators: titles naming Bounty Rush, Fighting Path, Burning Will or Pirate Warriors; Bandai-style internal names (`pl_nami_2yaf01`, `pl_luffy_thou01`) and 5-digit asset IDs (`11001_`, `34011_`); "Noesis Frames" left by an extraction tool; textures or meshes byte-identical to such files. A CC licence granted by someone who doesn't own the asset is void.
- **Three in-game characters are affected:** Nami 18273524 (material `pl_nami_2yaf01_di25ff_png`; texture byte-identical to d126daab "Mobile - One Piece Bounty Rush - Nami"); Luffy 44b58336 (texture byte-identical to 7f5fad66, whose source file is `11001_DSZZ_U.fbx` on a 3ds Max skeleton, re-rigged for Mixamo); Whitebeard 13ebbf10 (material `edward001_cloak_d`).
- **Medium-confidence doubts:** the in-game Sunny shares 5 texture files byte for byte with RadhruinT's Merry (common unknown source). Several Tigerar1 uploads are byte-identical to other creators' earlier uploads (2619979a = akennedy007's "Pirate Warriors" Chopper; 34f85d8a = 262d3614), so that uploader's files — including the in-game Moby Dick, which came from an STL — need a provenance check. Chechorams16's rigs use game-engine-style names (unverified).
- **The IP itself:** every file depicts One Piece IP (Eiichiro Oda / Shueisha / Toei; for extracted files, Bandai Namco also owns the actual data). A free fan game exists at the rights holders' tolerance; credits don't change that, and extracted game files are the most likely takedown trigger — replace the three in-game characters first. A commercial release could use nothing from this pile: every ship, character, Jolly Roger and Marine insignia would need an original design.

## 4. Gaps

| Need | What the pile has | Most practical source |
|---|---|---|
| Enemy/neutral fleets (Marine classes, pirate sloops, merchants, longboats) | one Marine sloop (e162a1ff) + an extracted raft | Blender kitbash from 2–3 hull bases; Kenney/Quaternius CC0 pirate kits (also on Poly Pizza, fetchable via Blender MCP) as block-outs |
| Red Force, Oro Jackson, Queen Mama Chanter | not in the catalog | targeted Sketchfab searches after the rate-limit cooldown; otherwise model in Blender |
| Modular islands (rocks, beaches, palms) | none | procedural terrain with the existing limestone texture; Poly Haven CC0 rocks (decimated); CC0 palms; catalog rock packs 268fc0df (BY), 719d8ee3 (Std) |
| Harbor town and docks | none | Blender modular toon kit; catalog e5db65bf Tavern Kit, 0bb3c7a6 Japan Modular Props, 836696792 townhouses, 1ebaf13a/1bdb15c3 crates |
| Fort and lighthouse | none | Blender; catalog b5d885c8 lighthouse (336k) and c6e5072e watchtower (1.9M) are too heavy |
| Sea monsters | Laboon (in a diorama), Yagara (indicators) | original serpent in Blender with a spine-chain rig; Meshy image-to-3D can do the sculpt (decimate ~1.9M → ~30k, custom rig, decal repaint); catalog 461b8a98 water dragon (69k) |
| Crew work animations (helm, rope hauling, cannon loading, lookout, repair) | none | author once on the shared D7Xtreme 32-joint rig; Mixamo clips for Mixamo-rigged characters |
| Marine NPC crew | none | Quaternius CC0 humans recoloured in Marine whites (catalog adfac91d shows indicators; 399a2952 is 632 tris) |
| Cannons, carriages, kegs, barrels, crates, lanterns | none standalone | Blender or CC0 kits; Marine ship cannon bones for positions now; d4cc276c barrel (pending, 100k — decimate) |
| Flag and sail variants | 2 flag meshes | procedural cloth sails with 2D Jolly Roger textures |
| Wreckage/debris kit; weather props | none | procedural plank fracture + a small Blender kit; waterspouts, rain, lightning as shaders/particles |
| FX textures (muzzle flash, smoke, splash, fire) | none | anime-style flipbooks rendered in Blender; Kenney CC0 particle packs as placeholders |

- **Pending (51) and rate-limited (8) queue:** 57 characters, mostly duplicate Luffy/Chopper/Zoro and statues, plus 2 Wavers. Worth fetching: 713b7518 Waver Skypia, 1f666427 Nami's Waver, d9188773 Law's Den Den Mushi, f1cce5a1 Law's Jolly Roger, d4cc276c barrel, b39d2731 Jinbe (a natural helmsman).
- **More useful candidates sit in the "excluded" bucket** (the filter only accepted ships and principal crew): locations 0928d862 Arlong Park, 42e680f8 Enies Lobby bridge, 30a92231 Marineford, 75dfd695 Sky Island, 7404c8d8 Amazon Lily arena, 2a6f44c5 Egghead building; Sunny cabin interiors 94d54612, 37ef1254; enemy captains in one consistent style (Chechorams16) bc1be2a2 Buggy, 8fcb227c Tashigi. Excluded items from uploaders whose other files show extraction indicators (Ark Maxim, Puffing Tom, Laboon, Garp, Koby, Impel Down, Transponder Snails) need the same check.

## 5. Top 10 from the downloaded pile

Bonus (no new licence exposure): extract the cannon bones from Marine source 92898d5f as firing points and recoil pivots, then re-export the runtime file.

1. **d4dfcbcf Trafalgar Law** (D7Xtreme, BY, 4.0k, 32-joint IK rig) — first crew for Polar Tang, where the critic saw none.
2. **50df4672 / 3709d625 / 97c2cd70 / 4df3468c: D7Xtreme Luffy, Zoro, Usopp, Franky** (1.4–6.2k each) — same skeleton as Law, so one set of Blender work animations drives all five; flat colour + emissive maps suit the toon look; cheap enough to fill every deck.
3. **3d9fb8bd Luffy** (Mixamo, 9 clips incl. walk/run/punch/wave, 12.5k) — same skeleton as the in-game Sanji; a clean replacement for the in-game Luffy.
4. **cc4283f5 Waver Nami** (10.3k, 4 PBR textures) — a small fast craft for scouting, specials or background traffic.
5. **e162a1ff Marine Ship** (7.6k) — a second Marine class for escorts and fleet density, far cheaper than the 254k galleon (provenance check needed).
6. **56cd0ac4 Aquatic Stage** — cut out the whales for a Laboon / Reverse Mountain set piece; the only creature without indicators.
7. **5e26e621 Ian LaMorre Sunny** (18.1k, 8 unlit painted textures) — far LOD or a cleaner-provenance Sunny; ef8de71c is a heavier alternative.
8. **e2db38f4 Sunny Lionhead** (8.5k) — hero figurehead for close-ups, the ship picker, or a harbor statue.
9. **d828707b Wanted Luffy** (4.5k) — harbor bounty boards; a prop for the bounty loop.
10. **07a2daa4 Baratie interior** (BY-NC-SA) — Baratie refit/harbor backdrop, only while strictly non-commercial.
