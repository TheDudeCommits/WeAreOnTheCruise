/**
 * Fleet / prop / crew / nature build jobs (consumed by build-fleet.mjs).
 * `src` is relative to $CRUISE_ASSET_SRC (default /tmp/cruise-asset-work): sketchfab downloads live in src/<uid>/source.glb,
 * Meshy outputs in meshy/<key>.glb, CC0 kits in kenney/ and quaternius/.
 * `yaw` (degrees about +Y) turns the source so its bow/forward faces −Z. Ships: `length` (m) = Z extent, `draft` = keel depth.
 */
import { RECOLOR } from './recolor.mjs';

export const SRC = process.env.CRUISE_ASSET_SRC || '/tmp/cruise-asset-work';

const MESHY = (task, title) => ({ kind: 'meshy', uid: task, author: 'Owner-generated with Meshy image-to-3D (concept: Higgsfield Nano Banana Pro)', title, license: 'Meshy (owner-generated)', url: '' });
const SKETCHFAB = (uid, title, author, license = 'CC-BY-4.0') => ({ kind: 'sketchfab', uid, author, title, license, url: `https://sketchfab.com/3d-models/${uid}` });
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
    source: SKETCHFAB('1c62191534174bf7a67470fb02b97db1', 'Stylized Pirate Ship', 'c3posw01'),
    notes: 'Redtide brig: hull and rails recoloured black, new red sails with the original cutlass-and-sun emblem, black flags. Water plane and hold props removed; deck cannons kept.',
  },
  {
    key: 'corsair-galleon', role: 'enemy', src: 'src/fe0ea2cee119476fb1a7524d5ff380dc/source.glb', yaw: 0, length: 44, draft: 3.6, tris: 24000, tex: 1024, palette: true,
    recolor: (ctx) => RECOLOR.corsairGalleon(ctx),
    source: SKETCHFAB('fe0ea2cee119476fb1a7524d5ff380dc', 'Pirate Ship', 'olemuzyka'),
    notes: 'Redtide galleon: flat colours remapped to the Redtide palette (black hull, red trim) and baked into one palette texture; new red sails with the original cutlass-and-sun emblem. Decimated from 74k tris.',
  },
  // ───────────── Admiralty (Sketchfab CC-BY, recoloured) ─────────────
  {
    key: 'sloop', role: 'enemy', src: 'src/1b27f1f60e0e49f886984ea099977757/source.glb', yaw: 180, length: 20, draft: 1.5, tris: 12000, tex: 1024,
    recolor: (ctx) => RECOLOR.admiraltyCutter(ctx),
    source: SKETCHFAB('1b27f1f60e0e49f886984ea099977757', 'Low Poly Sloop Sailing Ship', 'Razer820'),
    notes: 'Admiralty Cutter (enemy id cutter uses modelKey sloop): palette swapped to white topsides / navy bottom / gold stripe; skull sail replaced by white canvas with the original gold wave-crest.',
  },
  {
    key: 'brig', role: 'enemy', src: 'src/d9953f66583340c4879a3770f6d09a37/source.glb', yaw: 180, length: 28, draft: 2.2, tris: 14000, tex: 1024,
    recolor: (ctx) => RECOLOR.admiraltyBrig(ctx),
    source: SKETCHFAB('d9953f66583340c4879a3770f6d09a37', 'Pirate Ship (Low Poly)', 'anagvf'),
    notes: 'Admiralty Brig: hull sides repainted white with a navy boot-top (texture copies through luminance ramps), sails re-mapped to white canvas with the original gold wave-crest.',
  },
  {
    key: 'frigate', role: 'enemy', src: 'src/c5e06cf1ba164b749cb47044fe7b86eb/source.glb', yaw: 245.67, length: 38, draft: 3.2, tris: 24000, tex: 1024, palette: process.env.NOPAL ? false : true,
    exclude: /Cannon_Balls|M_Cups|Bottle|M_Rum|Black_Powder|lambert/,
    recolor: (ctx) => RECOLOR.admiraltyFrigate(ctx),
    source: SKETCHFAB('c5e06cf1ba164b749cb47044fe7b86eb', 'Low-Poly Pirate Ship', 'Greggory_Fisher'),
    notes: 'Admiralty Frigate: flat colours remapped (white upper hull, navy lower hull, gold trim) and baked into one palette texture; black sails re-mapped to white canvas with the original gold wave-crest; loose deck clutter (cannonballs, cups, bottles) removed; decimated from 73k tris.',
  },
];

export { RECOLOR };
