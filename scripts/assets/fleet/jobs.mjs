/**
 * Fleet / prop / crew / nature build jobs (consumed by build-fleet.mjs).
 * `src` is relative to $CRUISE_ASSET_SRC (default /tmp/cruise-asset-work): sketchfab downloads live in src/<uid>/source.glb,
 * Meshy outputs in meshy/<key>.glb, CC0 kits in kenney/ and quaternius/.
 * `yaw` (degrees about +Y) turns the source so its bow/forward faces −Z. Ships: `length` (m) = Z extent, `draft` = keel depth.
 */
import { RECOLOR, buildFlag } from './recolor.mjs';

export const SRC = process.env.CRUISE_ASSET_SRC || '/tmp/cruise-asset-work';

const MESHY = (task, title) => ({ kind: 'meshy', uid: task, author: 'Owner-generated with Meshy image-to-3D (concept: Higgsfield Nano Banana Pro)', title, license: 'Meshy (owner-generated)', url: '' });
const SKETCHFAB = (uid, title, user, display = null, license = 'CC-BY-4.0') => ({ kind: 'sketchfab', uid, author: display ? `${display} (${user})` : user, authorUrl: `https://sketchfab.com/${user}`, title, license, url: `https://sketchfab.com/3d-models/${uid}` });
const KENNEY = (file) => ({ kind: 'cc0-kit', uid: `kenney-pirate-kit/${file}`, author: 'Kenney (kenney.nl)', title: `Pirate Kit 2.1 — ${file}`, license: 'CC0-1.0', url: 'https://kenney.nl/assets/pirate-kit' });
const QUATERNIUS = (file) => ({ kind: 'cc0-kit', uid: `quaternius-pirate-kit/${file}`, author: 'Quaternius (quaternius.com)', title: `Pirate Kit — ${file}`, license: 'CC0-1.0', url: 'https://quaternius.com/packs/piratekit.html' });

export const JOBS = [
  // ───────────── Meshy (owner-generated) Admiralty heavies, bosses, fort ─────────────
  {
    key: 'man-o-war', role: 'enemy', src: 'meshy/man-o-war.glb', yaw: -90, length: 50, draft: 4.2, tris: 24000, tex: 1024,
    source: MESHY('01a0cfd2-7479-727b-8343-a801a489a5d0', "Admiralty Man-o'-War"),
    notes: 'Three-decker ship of the line: white hull, navy bands, gold rails, white sails with the gold wave-crest emblem. Single mesh, single 1024² atlas.',
  },
  {
    key: 'mortar-barge', role: 'enemy', src: 'meshy/mortar-barge.glb', yaw: -90, length: 24, draft: 1.6, tris: 20000, tex: 1024,
    source: MESHY('01a0cfd3-a6a4-75a2-b2a7-e67d8c0b8d4b', 'Admiralty Mortar Barge'),
    notes: 'Boxy armoured barge; the siege mortar sits on a turntable amidships (about z = 0, y ≈ 3 m) — a good muzzle anchor for the lob FX.',
  },
  {
    key: 'dreadnought', role: 'boss', src: 'meshy/dreadnought.glb', yaw: -90, length: 90, draft: 6.5, tris: 50000, tex: 2048,
    source: MESHY('01a0cfd2-8df7-7094-bc09-1d0c9682b2cc', 'The Iron Warden (dreadnought)'),
    notes: "Commodore's ironclad for the Iron Warden boss: riveted steel over a white/navy hull, bow ram, two turrets, smokestack, gold wave-crest on the bow. Phase-2 'plates off' is left to shaders/FX (single mesh).",
  },
  {
    key: 'sovereign', role: 'boss', src: 'meshy/sovereign.glb', yaw: -90, length: 120, draft: 8.5, tris: 55000, tex: 2048,
    source: MESHY('01a0cfd4-3712-74dc-a16e-938b8d635374', 'The Sovereign (flagship)'),
    notes: "Fleet Admiral's four-masted flagship: white hull, navy bands, gold filigree, gold eagle figurehead, wave-crest sails, lantern-lit stern castle.",
  },
  {
    key: 'fort', role: 'enemy', src: 'meshy/fort.glb', yaw: 0, length: 20, draft: 1.2, tris: 20000, tex: 1024,
    source: MESHY('01a0cfd2-a8e2-708d-a2ed-ec1c6d47df30', 'Cliff Battery'),
    notes: 'Round stone bastion on a rock base with cannon embrasures and an Admiralty flag. Origin at base centre, base sunk 1.2 m so it can sit on an island or reef.',
  },
  {
    key: 'tidewyrm-head', role: 'boss', origin: 'ground', src: 'meshy/tidewyrm-head.glb', yaw: 180, height: 18, tris: 30000, tex: 2048,
    source: MESHY('01a0cfd2-c593-772f-802a-12cb38fa3184', 'Tidewyrm head'),
    notes: 'Head + upper neck of the Tidewyrm, facing −Z, origin at the neck cut (y = 0). Attach to the procedural serpent body; scale freely.',
  },
  // ───────────── Redtide Corsairs (Sketchfab CC-BY, recoloured) ─────────────
  {
    key: 'corsair-brig', role: 'enemy', src: 'src/1c62191534174bf7a67470fb02b97db1/source.glb', yaw: -90, length: 28, draft: 2.4, tris: 22000, tex: 1024,
    exclude: /WaterPlane|Cannon[345]|Pallet[345]|Barrel[456]|Box(8|9|10)_/,
    recolor: (ctx) => RECOLOR.corsairBrig(ctx),
    source: SKETCHFAB('1c62191534174bf7a67470fb02b97db1', 'Stylized Pirate Ship', 'c3posw01', 'Maksim Batyrev'),
    notes: 'Redtide brig: hull and rails recoloured black, new red sails with the original cutlass-and-sun emblem, black flags. Water plane and hold props removed; deck cannons kept.',
  },
  {
    key: 'corsair-galleon', role: 'enemy', src: 'src/fe0ea2cee119476fb1a7524d5ff380dc/source.glb', yaw: 0, length: 44, draft: 3.6, tris: 24000, tex: 1024, palette: true,
    recolor: (ctx) => RECOLOR.corsairGalleon(ctx),
    source: SKETCHFAB('fe0ea2cee119476fb1a7524d5ff380dc', 'Pirate Ship', 'olemuzyka', 'Oleg Muzyka'),
    notes: 'Redtide galleon: flat colours remapped to the Redtide palette (black hull, red trim) and baked into one palette texture; new red sails with the original cutlass-and-sun emblem. Decimated from 74k tris.',
  },
  // ───────────── Admiralty (Sketchfab CC-BY, recoloured) ─────────────
  {
    key: 'sloop', role: 'enemy', src: 'src/1b27f1f60e0e49f886984ea099977757/source.glb', yaw: 180, length: 20, draft: 1.5, tris: 12000, tex: 1024,
    recolor: (ctx) => RECOLOR.admiraltyCutter(ctx),
    source: SKETCHFAB('1b27f1f60e0e49f886984ea099977757', 'Low Poly Sloop Sailing Ship', 'Razer820', 'Ship Builder 9000'),
    notes: 'Admiralty Cutter (enemy id cutter uses modelKey sloop): palette swapped to white topsides / navy bottom / gold stripe; skull sail replaced by white canvas with the original gold wave-crest.',
  },
  {
    key: 'brig', role: 'enemy', src: 'src/d9953f66583340c4879a3770f6d09a37/source.glb', yaw: 180, length: 28, draft: 2.2, tris: 14000, tex: 1024,
    recolor: (ctx) => RECOLOR.admiraltyBrig(ctx),
    source: SKETCHFAB('d9953f66583340c4879a3770f6d09a37', 'Pirate Ship (Low Poly)', 'anagvf', 'Ana Vassallo'),
    notes: 'Admiralty Brig: hull sides repainted white with a navy boot-top (texture copies through luminance ramps), sails re-mapped to white canvas with the original gold wave-crest.',
  },
  {
    key: 'frigate', role: 'enemy', src: 'src/c5e06cf1ba164b749cb47044fe7b86eb/source.glb', yaw: 245.67, length: 38, draft: 3.2, tris: 24000, tex: 1024, palette: process.env.NOPAL ? false : true,
    exclude: /Cannon_Balls|M_Cups|Bottle|M_Rum|Black_Powder|lambert/,
    recolor: (ctx) => RECOLOR.admiraltyFrigate(ctx),
    source: SKETCHFAB('c5e06cf1ba164b749cb47044fe7b86eb', 'Low-Poly Pirate Ship', 'Greggory_Fisher'),
    notes: 'Admiralty Frigate: flat colours remapped (white upper hull, navy lower hull, gold trim) and baked into one palette texture; black sails re-mapped to white canvas with the original gold wave-crest; loose deck clutter (cannonballs, cups, bottles) removed; decimated from 73k tris.',
  },
  {
    key: 'fireship', role: 'enemy', src: 'src/83b5b588468f4d89a463dd0729f234ce/source.glb', yaw: 0, length: 22, draft: 1.8, tris: 13500, tex: 1024,
    recolor: (ctx) => RECOLOR.fireship(ctx),
    source: SKETCHFAB('83b5b588468f4d89a463dd0729f234ce', 'Stylized Pirate Ship', 'Nik_kale'),
    notes: 'Redtide Fire Ship: hull charred, blue trim turned ember orange, sails re-mapped to Redtide red with the cutlass-and-sun. Attach powder-keg props on deck (y ≈ 2 m) and fire FX at runtime.',
  },
  {
    key: 'skiff', role: 'enemy', src: 'src/c9b94c52d0704614930ad5e076e02198/source.glb', yaw: 90, length: 12, draft: 0.6, tris: 8000, tex: 512,
    recolor: (ctx) => RECOLOR.raiderSkiff(ctx),
    source: SKETCHFAB('c9b94c52d0704614930ad5e076e02198', 'Boat', 'local.yany'),
    notes: 'Raider Skiff: rowboat hull stained black with a red gunwale; a simple mast, yard and red square sail (cutlass-and-sun) were added so skiffs read as Redtide at a distance. Also suitable for escort-skiff summons with a different tint.',
  },
  // ───────────── Gloam Wraiths ─────────────
  {
    key: 'wraith', role: 'enemy', src: 'src/31f365301da8410d83dce11d3ace5813/source.glb', yaw: -90, length: 30, draft: 2.2, tris: 22000, tex: 1024, keepEmissive: true,
    recolor: (ctx) => RECOLOR.wraith(ctx),
    source: SKETCHFAB('31f365301da8410d83dce11d3ace5813', 'Ghost ship', 'Sololopenko'),
    notes: 'Gloam Wraith: whole hull shifted to spectral teal, purple sails re-mapped to torn pale-teal canvas with a spiral sigil, lanterns keep a teal emissive glow (material wraith-light). Decimated from 105k tris.',
  },
  // ───────────── Crew (Quaternius Pirate Kit, CC0; rigged + animated) ─────────────
  {
    key: 'sailor-a', role: 'crew', src: 'quaternius/pirate/Characters_Henry.gltf', yaw: 180, height: 1.75, poseScale: 1.1, tris: 5800, tex: 256,
    exclude: /^Weapon_/, keepAnimations: ['Idle', 'Wave', 'Yes', 'Punch', 'Duck', 'HitReact', 'Death', 'Run', 'Walk', 'Sword'],
    source: QUATERNIUS('Characters_Henry.gltf'),
    notes: 'Deckhand with a red bandana. Lute removed. Skinned; clips Idle/Wave/Yes (cheer)/Punch (haul)/Duck (brace)/HitReact/Death/Run/Walk/Sword. Faces −Z.',
  },
  {
    key: 'sailor-b', role: 'crew', src: 'quaternius/pirate/Characters_Anne.gltf', yaw: 180, height: 1.75, poseScale: 1.1, tris: 5800, tex: 256,
    exclude: /^Weapon_/, keepAnimations: ['Idle', 'Wave', 'Yes', 'Punch', 'Duck', 'HitReact', 'Death', 'Run', 'Walk', 'Sword'],
    source: QUATERNIUS('Characters_Anne.gltf'),
    notes: 'Deckhand (woman, braided hair). Axe removed. Same clip set as sailor-a.',
  },
  {
    key: 'sailor-c', role: 'crew', src: 'quaternius/pirate/Characters_Henry.gltf', yaw: 180, height: 1.75, poseScale: 1.1, tris: 5800, tex: 256,
    exclude: /^Weapon_/, keepAnimations: ['Idle', 'Wave', 'Yes', 'Punch', 'Duck', 'HitReact', 'Death', 'Run', 'Walk', 'Sword'], recolor: (ctx) => RECOLOR.sailorC(ctx),
    source: QUATERNIUS('Characters_Henry.gltf'),
    notes: 'sailor-a with a blue bandana, red vest and brown trousers (palette swap) for crowd variety.',
  },
  {
    key: 'admiralty-sailor', role: 'crew', src: 'quaternius/pirate/Characters_Henry.gltf', yaw: 180, height: 1.75, poseScale: 1.1, tris: 5800, tex: 256,
    exclude: /^Weapon_/, keepAnimations: ['Idle', 'Wave', 'Yes', 'Punch', 'Duck', 'HitReact', 'Death', 'Run', 'Walk', 'Sword'], recolor: (ctx) => RECOLOR.admiraltySailor(ctx),
    source: QUATERNIUS('Characters_Henry.gltf'),
    notes: 'Admiralty deckhand: navy bandana and trousers, white vest and sleeves (palette swap of the CC0 character).',
  },
  {
    key: 'corsair', role: 'crew', src: 'quaternius/pirate/Characters_Captain_Barbarossa.gltf', yaw: 180, height: 1.8, poseScale: 1.084, tris: 6000, tex: 256,
    keepAnimations: ['Idle', 'Wave', 'Yes', 'Punch', 'Duck', 'HitReact', 'Death', 'Run', 'Walk', 'Sword'],
    source: QUATERNIUS('Characters_Captain_Barbarossa.gltf'),
    notes: 'Redtide corsair captain with red tricorn, hook, cutlass and a parrot (second skinned mesh). Enemy decks / cutscenes.',
  },
  {
    key: 'wraith-crew', role: 'crew', src: 'quaternius/pirate/Characters_Skeleton.gltf', yaw: 180, height: 1.75, poseScale: 1.108, tris: 6000, tex: 256,
    keepAnimations: ['Idle', 'Wave', 'Yes', 'Punch', 'Duck', 'HitReact', 'Death', 'Run', 'Walk', 'Sword'],
    source: QUATERNIUS('Characters_Skeleton.gltf'),
    notes: 'Extra: skeleton deckhand with dagger for Gloam Wraith ships (tint teal/emissive at runtime).',
  },
  // ───────────── Props: weapon mounts, pickups, hazards (Meshy owner-generated + CC0 kits + procedural) ─────────────
  { key: 'cannon', role: 'prop', src: 'quaternius/pirate/Prop_Cannon.gltf', yaw: -90, longest: 2.2, tris: 3000, tex: 256, source: QUATERNIUS('Prop_Cannon.gltf'), notes: 'Deck cannon on a wooden carriage; muzzle toward −Z. Broadside/bow-chaser mounts.' },
  { key: 'mortar', role: 'prop', src: 'meshy/mortar.glb', yaw: -90, longest: 2.2, tris: 3000, tex: 512, source: MESHY('01a0d1dd-482e-72e9-b018-3f1d41709641', 'Deck mortar'), notes: 'Squat iron mortar on a round wooden mount (stern-mortar weapon); muzzle leans toward −Z.' },
  { key: 'rocket-rack', role: 'prop', src: 'meshy/rocket-rack.glb', yaw: 180, height: 2, tris: 3000, tex: 512, source: MESHY('01a0d1dd-5c6c-762d-8e54-611dd3f5a1b3', 'Rocket rack'), notes: 'Wooden rack of six red rockets angled up and toward −Z (rocket-rack weapon, deck mount).' },
  { key: 'swivel-gun', role: 'prop', src: 'meshy/swivel-gun.glb', yaw: -90, height: 1.6, tris: 3000, tex: 512, source: MESHY('01a0d1dd-7198-7286-997a-559c19c534c9', 'Swivel gun'), notes: 'Brass swivel gun on a Y-pivot and wooden post (swivel-guns weapon, rail mount); rotate the whole prop about Y.' },
  { key: 'harpoon-gun', role: 'prop', src: 'meshy/harpoon-gun.glb', yaw: -90, longest: 2.6, tris: 3000, tex: 512, source: MESHY('01a0d1dd-8c2f-72d7-829b-0c67bdb39bd0', 'Harpoon gun'), notes: 'Mounted harpoon cannon on a pivot base, harpoon tip toward −Z (harpoon weapon, bow mount).' },
  { key: 'storm-rod', role: 'prop', src: 'meshy/storm-rod.glb', yaw: 0, height: 4, tris: 3000, tex: 512, source: MESHY('01a0d1dd-9f90-76c9-ac91-2899f928bb1b', 'Storm rod'), notes: 'Copper three-pronged lightning rod with blue insulator rings (storm-rod weapon, mast-top mount); prongs at y ≈ 3.2–4 m.' },
  { key: 'mine', role: 'prop', src: 'meshy/mine.glb', yaw: 0, height: 1.6, tris: 3000, tex: 512, source: MESHY('01a0d1dd-b0f4-76f6-97f8-b591345b4979', 'Sea mine'), notes: 'Spiked sea mine with a chain loop (tide-mines hazard). Origin at the chain bottom; float it so the sphere centre (y ≈ 0.95 m) sits at the waterline.' },
  { key: 'lantern', role: 'prop', src: 'meshy/lantern.glb', yaw: 0, height: 0.7, tris: 3000, tex: 512, source: MESHY('01a0d1dd-c38f-759b-bb35-4592eb61b960', 'Ship lantern'), notes: 'Iron ship lantern with amber panes (tier growth decoration); add a point light / bloom at y ≈ 0.3 m.' },
  { key: 'powder-keg', role: 'prop', src: 'meshy/powder-keg.glb', yaw: 0, height: 1, tris: 3000, tex: 512, source: MESHY('01a0d1dd-d637-7127-8e3b-16b60d9b7ff9', 'Powder keg'), notes: 'Black powder keg with red bands and fuse (powder-keg pickup and fire-barrels/powder-keg hazards).' },
  { key: 'iron-ram', role: 'prop', src: 'meshy/iron-ram.glb', yaw: 180, longest: 3.2, tris: 3000, tex: 512, source: MESHY('01a0d1dd-e992-7045-8877-559bb56a2502', 'Iron ram prow cap'), notes: 'Extra: riveted iron prow cap with spike toward −Z (iron-ram weapon, prow mount). Scale to the hull.' },
  { key: 'barrel', role: 'prop', src: 'quaternius/pirate/Prop_Barrel.gltf', yaw: 0, height: 1.1, tris: 3000, tex: 256, source: QUATERNIUS('Prop_Barrel.gltf'), notes: 'Wooden barrel (fire-barrels drops, deck clutter, floating debris).' },
  { key: 'chest', role: 'prop', src: 'quaternius/pirate/Prop_Chest_Closed.gltf', yaw: 180, longest: 1.3, tris: 3000, tex: 256, source: QUATERNIUS('Prop_Chest_Closed.gltf'), notes: 'Closed treasure chest (elite/boss chest pickup), front toward −Z.' },
  { key: 'chest-open', role: 'pickup', src: 'quaternius/pirate/Prop_Chest_Gold.gltf', yaw: 180, longest: 1.5, tris: 3000, tex: 256, source: QUATERNIUS('Prop_Chest_Gold.gltf'), notes: 'Extra: open chest spilling gold (chest reveal).' },
  { key: 'crate', role: 'prop', src: 'kenney/pirate-kit/Models/GLB format/crate.glb', yaw: 0, height: 0.9, tris: 3000, tex: 256, source: KENNEY('crate.glb'), notes: 'Open wooden crate (repair crate pickup / deck cargo).' },
  { key: 'anchor', role: 'prop', src: 'quaternius/pirate/Prop_Anchor.gltf', yaw: 0, rotate: [['x', -90]], height: 2, tris: 3000, tex: 256, source: QUATERNIUS('Prop_Anchor.gltf'), notes: 'Upright iron anchor (stood up from the flat source).' },
  { key: 'coins', role: 'pickup', src: 'quaternius/pirate/Prop_Coins.gltf', yaw: 0, height: 0.45, tris: 2100, tex: 256, source: QUATERNIUS('Prop_Coins.gltf'), notes: 'Extra: stacks of gold coins (treasure / doubloon pickups).' },
  { key: 'gold-bag', role: 'pickup', src: 'quaternius/pirate/Prop_GoldBag.gltf', yaw: 0, height: 0.7, tris: 2500, tex: 256, source: QUATERNIUS('Prop_GoldBag.gltf'), notes: 'Extra: sack of gold coins (big treasure pickup).' },
  {
    key: 'flag', role: 'prop', src: null, height: 4.44, tris: 3000, tex: 256, procedural: (ctx) => buildFlag(ctx, 'admiralty-flag'),
    source: { kind: 'procedural', uid: 'flag', author: 'We Are On The Cruise (ASSETS)', title: 'Admiralty flag on a pole', license: 'Project-original', url: '' },
    notes: 'Procedural pole + waving cloth with the original Admiralty wave-crest (navy/gold); cloth flies toward +Z. Swap the texture for other factions (see flag-redtide).',
  },
  {
    key: 'flag-redtide', role: 'prop', src: null, height: 4.44, tris: 3000, tex: 256, procedural: (ctx) => buildFlag(ctx, 'redtide-flag'),
    source: { kind: 'procedural', uid: 'flag-redtide', author: 'We Are On The Cruise (ASSETS)', title: 'Redtide flag on a pole', license: 'Project-original', url: '' },
    notes: 'Extra: procedural pole + cloth with the Redtide cutlass-and-sun (black/red).',
  },
  // ───────────── Nature / world set dressing (CC0 kits) ─────────────
  { key: 'palm-a', role: 'nature', src: 'quaternius/pirate/Environment_PalmTree_1.gltf', yaw: 0, height: 10, tris: 3500, tex: 256, source: QUATERNIUS('Environment_PalmTree_1.gltf'), notes: 'Straight palm, 10 m. Scale 0.7–1.3× for variety.' },
  { key: 'palm-b', role: 'nature', src: 'quaternius/pirate/Environment_PalmTree_3.gltf', yaw: 0, height: 8, tris: 3500, tex: 256, source: QUATERNIUS('Environment_PalmTree_3.gltf'), notes: 'Leaning palm, 8 m.' },
  { key: 'rock-a', role: 'nature', src: 'quaternius/pirate/Environment_Cliff2.gltf', yaw: 0, height: 12, tris: 5000, tex: 256, source: QUATERNIUS('Environment_Cliff2.gltf'), notes: 'Sea stack / rock cluster, 12 m tall, origin at its lowest point — sink ~1 m into water or ground.' },
  { key: 'rock-b', role: 'nature', src: 'quaternius/pirate/Environment_Rock_2.gltf', yaw: 0, height: 5, tris: 3000, tex: 256, source: QUATERNIUS('Environment_Rock_2.gltf'), notes: 'Tall boulder, 5 m.' },
  { key: 'bush', role: 'nature', src: 'kenney/pirate-kit/Models/GLB format/grass-plant.glb', yaw: 0, height: 1.2, tris: 3000, tex: 256, source: KENNEY('grass-plant.glb'), notes: 'Chunky tropical shrub, 1.2 m.' },
  { key: 'hut', role: 'nature', src: 'quaternius/pirate/Environment_House3.gltf', yaw: 0, height: 11, tris: 6000, tex: 256, source: QUATERNIUS('Environment_House3.gltf'), notes: 'Stilt house built from an upturned hull with a mast and striped sail (harbor/shore dressing), 11 m tall.' },
  { key: 'dock', role: 'nature', src: 'quaternius/pirate/Environment_Dock.gltf', yaw: 0, longest: 4, tris: 3000, tex: 256, source: QUATERNIUS('Environment_Dock.gltf'), notes: 'Modular dock segment on stilts (deck ≈ 2.9 × 3.5 m, 4 m tall incl. mooring post); origin at the stilt feet, deck top ≈ 2.6 m — sink the stilts into the water.' },
  { key: 'tower', role: 'nature', src: 'kenney/pirate-kit/Models/GLB format/tower-complete-large.glb', yaw: 0, height: 14, tris: 3000, tex: 256, source: KENNEY('tower-complete-large.glb'), notes: 'Stone watchtower with a blue conical roof, 14 m (Admiralty outposts / lighthouse stand-in).' },
];

export { RECOLOR };
