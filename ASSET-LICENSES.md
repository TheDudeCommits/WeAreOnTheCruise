# Asset sources and download status

The eight runtime hull kits in `public/assets/ships/` are **original Blender-authored assets**, generated from `scripts/assets/build-anime-hulls.py` through Blender MCP during the initial authoring session, then optimized with glTF Transform. They are not downloaded Sketchfab models. Existing procedural figureheads and crew remain original game geometry.

Runtime manifest: `public/assets/ships/hull-manifest.json` records SHA-256, bytes, triangles, material draw count and orientation. Raw original GLB exports live in `assets/source/`, outside Vite public output.

## Sketchfab requested searches

The official public API exhausted both search cursors: 72 pages, 1,676 unique catalog records. `assets/source/sketchfab/catalog.json` records every returned UID, author, source link, offered license, candidate/excluded status, runtime mapping and download bytes (zero). Search results can change after this snapshot.

**Acquisition remains blocked: zero Sketchfab models and zero model bytes downloaded.** The earlier official `/v3/models/{uid}/download` request returned 401 (authentication credentials not provided); the Blender native addon previously reported Sketchfab disabled and did not implement its advertised download command. The latest status request on September 7, 2026 failed because the Blender connection closed before returning data, so the current connection and authentication state are unverified. See [the recorded status evidence](docs/overhaul/evidence/sketchfab-status-2026-09-07.json). No viewer mesh extraction was attempted. Locally configured authenticated official download access is still required to finish the requested acquisition.

Candidate ship catalog (title/tag reviewed; geometry not yet inspected):

| Model | Author | Offered license | Mapping | Status |
|---|---|---|---|---|
| [Marine ship From One piece](https://sketchfab.com/3d-models/none-92898d5f63ad43589203d5a8dc14aa12) | [Ryanwill679/TrashCG](https://sketchfab.com/Ryanwill679) | CC Attribution | navy-galleon | Auth required |
| [The Going Merry (One Piece) - Game Ready](https://sketchfab.com/3d-models/none-4b2cb678bf984c018dfa1936bd156c8d) | [Oliver Edwards](https://sketchfab.com/OliverEdwards_3DArt) | CC Attribution | going-merry | Auth required |
| [[HW XYZ School] Detailing l Детализация l 3](https://sketchfab.com/3d-models/none-ef8de71cdacb48ce9bf401d63c5c678d) | [AlinaDracheva](https://sketchfab.com/alecxanachka) | CC Attribution | harbor-collection-or-new-hull-variant | Auth required |
| [one-piece-ship](https://sketchfab.com/3d-models/none-84d2d49fb845449aaf73b9546ebdf2ea) | [madexc](https://sketchfab.com/madexc) | CC Attribution | harbor-collection-or-new-hull-variant | Auth required |
| [One Piece Ship Going Merry 3D Model](https://sketchfab.com/3d-models/none-eb96bb9d60a84d3bac0b2f7ee7474866) | [MAN123](https://sketchfab.com/aydrman) | CC Attribution | going-merry | Auth required |
| [The Going Merry](https://sketchfab.com/3d-models/none-5206a9353bc347b4b378c2bef853af0a) | [EKBTheSquire](https://sketchfab.com/EKBTheSquire) | Free Standard | going-merry | Auth required |
| [Going Merry](https://sketchfab.com/3d-models/none-10d9c9ab99324f96ba3dca152df7eb4c) | [kenzie](https://sketchfab.com/kazemaru) | CC Attribution | going-merry | Auth required |
| [One Piece -Going Merry](https://sketchfab.com/3d-models/none-0e1f16189e8b4b4d9d9c3c60893d692b) | [Anex](https://sketchfab.com/anex) | CC Attribution | going-merry | Auth required |
| [Going Merry (One Piece)](https://sketchfab.com/3d-models/none-8cf214627e02411387d4df4b815ef28d) | [RadhruinT](https://sketchfab.com/radhruint) | CC Attribution | going-merry | Auth required |
| [Baratie - One Piece](https://sketchfab.com/3d-models/none-015ebe70a76749eeb92f5f39693b8ea5) | [Chin Eeyang](https://sketchfab.com/chinyang1607) | CC Attribution | baratie | Auth required |
| [THOUSAND SUNNY - ONE PIECE](https://sketchfab.com/3d-models/none-59e09814b4a14ecfb27471c4abe78be4) | [ShacLaw](https://sketchfab.com/aleix46) | CC Attribution | thousand-sunny | Auth required |
| [One-piece-going-merry](https://sketchfab.com/3d-models/none-7953efd4795a4e16a94e4d09ba14fa78) | [bronywilson](https://sketchfab.com/bronywilson) | CC Attribution | going-merry | Auth required |
| [Aquatic Stage. Going Merry with Laboon,One Piece](https://sketchfab.com/3d-models/none-56cd0ac4b7b14144bc42e690692eb140) | [andreagonzalez28](https://sketchfab.com/andreagonzalez28) | CC Attribution | going-merry | Auth required |
| [Thousand Sunny voxel art](https://sketchfab.com/3d-models/none-f25860a07aeb4dbfb3c1005a8c388c4e) | [P_4_N_D_A](https://sketchfab.com/P_4_N_D_A) | CC Attribution | thousand-sunny | Auth required |
| [GOING_MERRY_FULL](https://sketchfab.com/3d-models/none-5594f352db7e425f8f4150247a86b07c) | [Riki.exe](https://sketchfab.com/Riccardo.Morson) | CC Attribution | going-merry | Auth required |
| [one piece burning will Blackbeard Pirates Raft](https://sketchfab.com/3d-models/none-8be28a2087194608a3fb7862459cd385) | [emperor_prime](https://sketchfab.com/primalfrom12) | CC Attribution | harbor-collection-or-new-hull-variant | Auth required |
| [One piece Thousand Sunny🌞](https://sketchfab.com/3d-models/none-99986d1c93654c9d8889017435b5fe06) | [Miraculousetabug](https://sketchfab.com/descendienteslamasmendieta) | CC Attribution | thousand-sunny | Auth required |
| [Vogue Merry Minecraft Litematic](https://sketchfab.com/3d-models/none-11761ce889ee43d8b9a78d1b13f381f7) | [IronDurand](https://sketchfab.com/IronDurand) | CC Attribution | going-merry | Auth required |
| [Going Merry](https://sketchfab.com/3d-models/none-f13ee3dccb6f48fd8b997a54d18fd5ab) | [PedroSouza](https://sketchfab.com/PedroSouza) | CC Attribution | going-merry | Auth required |
| [GAME_SCENE_RESTAURANT_BARATIE](https://sketchfab.com/3d-models/none-07a2daa40fa74836a20337c581222ef4) | [captainike](https://sketchfab.com/captainike) | CC Attribution-NonCommercial-ShareAlike | baratie | Auth required |
| [The Thousand Sunny](https://sketchfab.com/3d-models/none-5e26e6216e494e9aa8c52aa1e19db844) | [Ian LaMorre](https://sketchfab.com/ilamorre) | CC Attribution | thousand-sunny | Auth required |
| [Goin Merry - FBX model](https://sketchfab.com/3d-models/none-5a5802eba7c74f55b422f466966c9f63) | [j0el_02](https://sketchfab.com/j0el_02) | CC Attribution | going-merry | Auth required |
| [THOUSAND SUNNY](https://sketchfab.com/3d-models/none-3a992d82a21a4902ab437ddc5f7b197c) | [jacksparrow6730](https://sketchfab.com/jacksparrow6730) | CC Attribution | thousand-sunny | Auth required |
| [Marine Ship](https://sketchfab.com/3d-models/none-e162a1ff635e4e4aa9b24a41dcee01b6) | [Tigerar1](https://sketchfab.com/allanromanreyes) | CC Attribution-ShareAlike | navy-galleon | Auth required |
| [Going Merry Ship](https://sketchfab.com/3d-models/none-d439536259424f8a86c3c80b5d4c64a0) | [Tigerar1](https://sketchfab.com/allanromanreyes) | CC Attribution-ShareAlike | going-merry | Auth required |
| [Thousand Sunny Ship](https://sketchfab.com/3d-models/none-59b59a3fb0c04113af5520bce3534a20) | [Tigerar1](https://sketchfab.com/allanromanreyes) | CC Attribution-ShareAlike | thousand-sunny | Auth required |
| [Moby Dick Ship](https://sketchfab.com/3d-models/none-d9be26addfec48019188dd615a930311) | [Tigerar1](https://sketchfab.com/allanromanreyes) | CC Attribution-ShareAlike | moby-dick | Auth required |
| [White Wale Ship Onepiece (Mob Dick) Fanmade](https://sketchfab.com/3d-models/none-a0e59983f0cf428588c80a91fe61ab37) | [3ddans](https://sketchfab.com/3ddans) | CC Attribution | moby-dick | Auth required |

## Intake rules

`scripts/assets/download-sketchfab.py` only calls the official authenticated download API using a locally configured SKETCHFAB_API_TOKEN. It stores provider archives outside public/, records hashes and offered licenses, and never automatically publishes unreviewed downloads. Redistribution must retain author/source/license attribution and follow the offered license. A model containing NonCommercial, ShareAlike, NoDerivs, or Free Standard terms needs those terms preserved in its asset record before deployment.

The default selection is the 28 tagged vehicle candidates plus one ship component. `--include-crew` adds the existing 268 `crew-candidate` records; the 1,379 unrelated records remain excluded. These are catalog tags, not inspected geometry or approved runtime assets. Preview either selection without credentials, network access or file changes:

```sh
python3 scripts/assets/download-sketchfab.py --dry-run
python3 scripts/assets/download-sketchfab.py --include-crew --dry-run
```

After configuring `SKETCHFAB_API_TOKEN` privately in the local environment, run `python3 scripts/assets/download-sketchfab.py --include-crew` to acquire ships, the ship component and tagged crew through the official API. Omit `--include-crew` for ships/components only. The script resumes existing downloads; it never prints tokens or signed download URLs. This command documents the remaining authenticated intake step; no Sketchfab model bytes have been acquired for this snapshot.

## Rebuild

Run the checked-in Blender authoring script from this checkout:

```sh
python3 scripts/assets/build-anime-hulls.py --dry-run
blender --background --python scripts/assets/build-anime-hulls.py
python3 scripts/assets/optimize-hulls.py
```

Normal file execution discovers the checkout from `__file__`, independently of the current directory. For Blender MCP `exec`, explicitly provide an absolute `CRUISE_PROJECT_ROOT` global (or configure the same environment variable in Blender's process):

```python
from pathlib import Path
project_root = "/absolute/path/to/WeAreOnTheCruise"
source = Path(project_root) / "scripts/assets/build-anime-hulls.py"
exec(compile(source.read_text(), str(source), "exec"), {"CRUISE_PROJECT_ROOT": project_root})
```

Root discovery verifies the Cruise package and source markers before importing Blender or exporting anything. An absent or incorrect root fails with setup instructions; it never falls back to the current directory. `--dry-run` validates the root and lists export paths without opening Blender or writing assets.

The script creates a dedicated Cruise scene and exports only each named Cruise collection with `use_active_scene=True`; existing user scenes remain intact. During the initial authoring session, native addon safe mode permitted GLB export but rejected standalone `bpy.data.libraries.write`, so the reproducible Python source and raw GLBs are the shipped editable source artifacts. Run the optimizer once after re-exporting, as above. It verifies each GLB contains one Cruise scene and exactly five meshes before recording the manifest.

## Original generated artwork

Codex imagegen created eight base section concepts and a supplemental three-special concept board in `docs/art-direction/concepts/`. These are labeled target illustrations, never substituted for screenshots. It also generated three original runtime assets: `public/assets/materials/limestone.png`, `painted-timber.png`, and `cinematic-sky.png`. The first two are sampled as surface materials; the sky is mapped onto the actual 3D skydome and weather graded. No generated ship/world illustration is composited over a gameplay screenshot.

Runtime material hashes:

- `cinematic-sky.png` — SHA-256 `9ab3d6acb2d74e00ecf979396c811f340815e5e87a5010ab3329b279460120fe`
- `painted-timber.png` — SHA-256 `caa10fa3036163004119911670c9f85c93dde57616d3fab77e925cc7ac744369`
- `limestone.png` — SHA-256 `dfe0680734034aafe2d47a2d9cdd060c0fdcadddc11a1488978f4bd320bc391a`
