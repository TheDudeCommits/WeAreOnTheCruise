import type { CrewAllocation, CrewPreset, IslandState, VoyageBuildId, VoyageRoute } from '../core/contracts';
import { createSeededRandom, hashString } from '../core/rng';

export const CREW_PRESETS: Record<CrewPreset, CrewAllocation> = {
  balanced: { helm: 3, guns: 3, repair: 2, special: 2 },
  gunnery: { helm: 2, guns: 6, repair: 1, special: 1 },
  sailing: { helm: 6, guns: 2, repair: 1, special: 1 },
  repair: { helm: 2, guns: 1, repair: 6, special: 1 },
  special: { helm: 2, guns: 2, repair: 1, special: 5 },
};

export const VOYAGE_BUILDS: readonly {
  id: VoyageBuildId; name: string; description: string; crew: CrewPreset;
  speed: number; turning: number; reload: number; damage: number; repair: number; special: number;
}[] = [
  { id: 'precision', name: 'Deadeye Broadside', description: 'Tight volleys and 20% faster reload. Slower helm; repairs require commitment.', crew: 'gunnery', speed: 0.94, turning: 0.9, reload: 0.8, damage: 1.15, repair: 0.85, special: 0.9 },
  { id: 'interceptor', name: 'Storm Interceptor', description: 'Fast sails, sharp turns and rapid specials. Lighter broadside and slower repairs.', crew: 'sailing', speed: 1.2, turning: 1.24, reload: 1.16, damage: 0.9, repair: 0.78, special: 1.35 },
  { id: 'guardian', name: 'Ironheart Crew', description: 'Repair crews work 45% faster; reinforced hull absorbs 18% of hits. Slower sails and guns.', crew: 'repair', speed: 0.9, turning: 0.94, reload: 1.16, damage: 1, repair: 1.45, special: 1 },
];

export const VOYAGE_CONTRACTS = [
  { id: 'dawn-blockade', name: 'Break the Dawn Blockade', description: 'Run the arch passage, break the patrol line, and face the fort captain.', legs: 3, reward: 420, firstKind: 'battle' },
  { id: 'lost-cargo', name: 'The Sunken Payroll', description: 'Recover cargo among the reefs, protect a merchant, and outrun a rival captain.', legs: 3, reward: 360, firstKind: 'salvage' },
  { id: 'tempest-chart', name: 'Chart the Tempest', description: 'Navigate storm gates, discover new water, and challenge the admiral at night.', legs: 3, reward: 500, firstKind: 'storm' },
] as const;

export const VOYAGE_UPGRADES = [
  { id: 'powder', name: 'Hot Powder', description: '20% faster reload; repair output reduced by 15%.' },
  { id: 'hull', name: 'Ironwood Bracing', description: '20% less incoming damage; maximum speed reduced by 8%.' },
  { id: 'sails', name: 'Cloudsilk Sails', description: '15% more speed and special charge; outgoing hull damage reduced by 8%.' },
  { id: 'chain', name: 'Rigging Hunters', description: 'Chain shot deals 45% more sail damage; other shots reload 8% slower.' },
  { id: 'medic', name: 'Carpenter Watch', description: 'Repair output increased 35%; guns reload 10% slower.' },
  { id: 'supplies', name: 'Fresh Supplies', description: 'Immediately restore 24% hull, sails and guns; no lasting modifier.' },
] as const;

export const HARBOR_REFITS = [
  { id: 'rangefinder', name: 'Rangefinder', description: '8% stronger hull hits; 4% slower reload.', cost: 280, maxLevel: 1 },
  { id: 'storm-rig', name: 'Storm Rig', description: '8% more sail speed; 6% slower repairs.', cost: 260, maxLevel: 1 },
  { id: 'repair-locker', name: 'Repair Locker', description: '15% faster repairs; 4% slower sailing.', cost: 240, maxLevel: 1 },
] as const;

/** Both simulation and renderer consume these exact landmark records. */
export const VOYAGE_LANDMARKS: readonly IslandState[] = [
  { id: 'dawn-harbor', name: 'Dawn Harbor', position: { x: 310, y: 0, z: 80 }, radius: 100, height: 55, palette: 1, discovered: true, landmark: 'palms', service: 'harbor' },
  { id: 'sky-arch', name: 'The Sky Arch', position: { x: 0, y: 0, z: -420 }, radius: 125, height: 165, palette: 2, discovered: false, landmark: 'arches', service: 'passage' },
  { id: 'razor-reef', name: 'Razor Reef', position: { x: -250, y: 0, z: -240 }, radius: 68, height: 57, palette: 1, discovered: false, landmark: 'needles', service: 'ambush' },
  { id: 'sunwatch-fort', name: 'Sunwatch Fort', position: { x: 270, y: 0, z: -480 }, radius: 108, height: 85, palette: 3, discovered: false, landmark: 'fort', service: 'fort' },
];

export function createVoyageRoutes(seed: string, contractId: string, leg: number): VoyageRoute[] {
  const random = createSeededRandom(hashString(`${seed}:${contractId}:${leg}`));
  const contract = VOYAGE_CONTRACTS.find((entry) => entry.id === contractId) ?? VOYAGE_CONTRACTS[0];
  const last = leg >= contract.legs;
  const alternate = random.pick(['salvage', 'storm', 'escort'] as const);
  const kind = last ? 'boss' : leg === 1 ? contract.firstKind : alternate;
  return [
    { id: `leg-${leg}-sheltered`, name: last ? 'The Captain’s Challenge' : kind === 'salvage' ? 'The Wreck Channel' : kind === 'storm' ? 'The Storm Gates' : kind === 'escort' ? 'The Merchant Road' : 'The Arch Passage', description: last ? 'Defeat the fort captain and return with the full contract reward.' : kind === 'salvage' ? 'Sail to the wreck and hold close to retrieve its cargo.' : kind === 'storm' ? 'Cross the marked gate through rough water; keep your hull intact.' : kind === 'escort' ? 'Protect the merchant until its escape preparations are complete.' : 'Break a patrol with room to maneuver beneath the arch.', kind, weather: kind === 'storm' ? 'storm' : random.pick(['calm', 'swell'] as const), risk: 'measured', reward: 120 + leg * 55, landmarkId: last ? 'sunwatch-fort' : 'sky-arch' },
    { id: `leg-${leg}-dangerous`, name: last ? 'The Admiral’s Nightwatch' : 'Razor Reef Ambush', description: last ? 'A stronger captain and escort under moonlight. Increased spoils.' : 'A heavier patrol in narrow reef water. Increased spoils.', kind: last ? 'boss' : 'battle', weather: last ? 'night' : random.pick(['swell', 'fog'] as const), risk: 'dangerous', reward: 210 + leg * 80, landmarkId: last ? 'sunwatch-fort' : 'razor-reef' },
  ];
}
