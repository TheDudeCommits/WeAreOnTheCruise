import type { ShipKind } from '../core/contracts';

export type ShipSpecial =
  | 'coup-de-burst'
  | 'merry-heart'
  | 'tremor-broadside'
  | 'conquerors-feint'
  | 'roger-volley'
  | 'submerge-dash'
  | 'soul-cannon'
  | 'banquet-repair'
  | 'justice-salvo';

export interface ShipPalette {
  hull: number;
  hullDark: number;
  trim: number;
  sail: number;
  accent: number;
  metal: number;
}

export interface ShipSpec {
  kind: ShipKind;
  displayName: string;
  subtitle: string;
  length: number;
  beam: number;
  draft: number;
  mastCount: number;
  crewCount: number;
  buoyancySamples: 5 | 6 | 7 | 8;
  mass: number;
  maxSpeed: number;
  acceleration: number;
  reverseSpeed: number;
  turnRate: number;
  hardTurnGrip: number;
  hullStrength: number;
  sailStrength: number;
  weaponStrength: number;
  crewStrength: number;
  broadsideCannons: number;
  bowCannons: number;
  reloadTime: number;
  projectileSpeed: number;
  special: ShipSpecial;
  palette: ShipPalette;
}

export const SHIP_SPECS: Readonly<Record<ShipKind, ShipSpec>> = {
  'thousand-sunny': {
    kind: 'thousand-sunny', displayName: 'Thousand Sunny', subtitle: 'Dream Ship of the Straw Hats',
    length: 56, beam: 22, draft: 7, mastCount: 2, crewCount: 10, buoyancySamples: 7,
    mass: 860, maxSpeed: 29, acceleration: 4.8, reverseSpeed: 5.5, turnRate: 0.48, hardTurnGrip: 0.82,
    hullStrength: 145, sailStrength: 105, weaponStrength: 115, crewStrength: 125,
    broadsideCannons: 7, bowCannons: 1, reloadTime: 3.8, projectileSpeed: 70,
    special: 'coup-de-burst',
    palette: { hull: 0x7b2f20, hullDark: 0x3c1716, trim: 0xf2b632, sail: 0xf2e2bd, accent: 0xf05a32, metal: 0x263341 },
  },
  'going-merry': {
    kind: 'going-merry', displayName: 'Going Merry', subtitle: 'The Beloved Caravel',
    length: 34, beam: 13, draft: 4.2, mastCount: 2, crewCount: 7, buoyancySamples: 5,
    mass: 350, maxSpeed: 26, acceleration: 5.8, reverseSpeed: 6.5, turnRate: 0.71, hardTurnGrip: 0.94,
    hullStrength: 78, sailStrength: 88, weaponStrength: 68, crewStrength: 135,
    broadsideCannons: 4, bowCannons: 1, reloadTime: 3.2, projectileSpeed: 66,
    special: 'merry-heart',
    palette: { hull: 0xa86f40, hullDark: 0x4f2e20, trim: 0xe9d9af, sail: 0xf5efe0, accent: 0x3f80a8, metal: 0x333844 },
  },
  'moby-dick': {
    kind: 'moby-dick', displayName: 'Moby Dick', subtitle: "Whitebeard's Flagship",
    length: 104, beam: 40, draft: 13, mastCount: 3, crewCount: 22, buoyancySamples: 8,
    mass: 4_600, maxSpeed: 20, acceleration: 2.1, reverseSpeed: 3.2, turnRate: 0.22, hardTurnGrip: 0.52,
    hullStrength: 260, sailStrength: 178, weaponStrength: 230, crewStrength: 220,
    broadsideCannons: 14, bowCannons: 2, reloadTime: 5.2, projectileSpeed: 72,
    special: 'tremor-broadside',
    palette: { hull: 0xe7e4dd, hullDark: 0x29313b, trim: 0xd8a84a, sail: 0xe6ddd0, accent: 0x8f2637, metal: 0x252a32 },
  },
  'red-force': {
    kind: 'red-force', displayName: 'Red Force', subtitle: "Red-Haired Pirates' Dread Ship",
    length: 78, beam: 27, draft: 9.5, mastCount: 3, crewCount: 15, buoyancySamples: 8,
    mass: 2_050, maxSpeed: 25, acceleration: 3.3, reverseSpeed: 4.2, turnRate: 0.37, hardTurnGrip: 0.72,
    hullStrength: 188, sailStrength: 142, weaponStrength: 170, crewStrength: 190,
    broadsideCannons: 10, bowCannons: 1, reloadTime: 4.15, projectileSpeed: 76,
    special: 'conquerors-feint',
    palette: { hull: 0x772326, hullDark: 0x2e1719, trim: 0xd5a649, sail: 0xd9d0bb, accent: 0x421a22, metal: 0x252934 },
  },
  'oro-jackson': {
    kind: 'oro-jackson', displayName: 'Oro Jackson', subtitle: "The Pirate King's Ship",
    length: 82, beam: 29, draft: 10, mastCount: 3, crewCount: 16, buoyancySamples: 8,
    mass: 2_220, maxSpeed: 27, acceleration: 3.6, reverseSpeed: 4.4, turnRate: 0.39, hardTurnGrip: 0.77,
    hullStrength: 205, sailStrength: 155, weaponStrength: 190, crewStrength: 210,
    broadsideCannons: 11, bowCannons: 2, reloadTime: 4, projectileSpeed: 78,
    special: 'roger-volley',
    palette: { hull: 0x7e3821, hullDark: 0x321e19, trim: 0xf0c448, sail: 0xf4e2b7, accent: 0xd2432f, metal: 0x29313d },
  },
  'polar-tang': {
    kind: 'polar-tang', displayName: 'Polar Tang', subtitle: "Heart Pirates' Submarine",
    length: 52, beam: 15, draft: 6, mastCount: 0, crewCount: 8, buoyancySamples: 6,
    mass: 1_080, maxSpeed: 31, acceleration: 5.2, reverseSpeed: 8.5, turnRate: 0.55, hardTurnGrip: 0.91,
    hullStrength: 160, sailStrength: 190, weaponStrength: 104, crewStrength: 140,
    broadsideCannons: 3, bowCannons: 3, reloadTime: 3.6, projectileSpeed: 75,
    special: 'submerge-dash',
    palette: { hull: 0xe7b52f, hullDark: 0x70531b, trim: 0x252a34, sail: 0xe8e3d6, accent: 0x8a2025, metal: 0x303843 },
  },
  'queen-mama-chanter': {
    kind: 'queen-mama-chanter', displayName: 'Queen Mama Chanter', subtitle: 'The Singing Candy Galleon',
    length: 91, beam: 36, draft: 11.5, mastCount: 3, crewCount: 18, buoyancySamples: 8,
    mass: 3_500, maxSpeed: 21, acceleration: 2.6, reverseSpeed: 3.5, turnRate: 0.28, hardTurnGrip: 0.59,
    hullStrength: 238, sailStrength: 168, weaponStrength: 205, crewStrength: 185,
    broadsideCannons: 12, bowCannons: 2, reloadTime: 4.6, projectileSpeed: 69,
    special: 'soul-cannon',
    palette: { hull: 0xd64f76, hullDark: 0x5b2241, trim: 0xf5c848, sail: 0xf6ddea, accent: 0x58afd0, metal: 0x4b3549 },
  },
  baratie: {
    kind: 'baratie', displayName: 'Baratie', subtitle: 'The Sea Restaurant',
    length: 74, beam: 34, draft: 8, mastCount: 2, crewCount: 14, buoyancySamples: 8,
    mass: 2_850, maxSpeed: 17, acceleration: 2.2, reverseSpeed: 3.1, turnRate: 0.27, hardTurnGrip: 0.54,
    hullStrength: 230, sailStrength: 122, weaponStrength: 95, crewStrength: 215,
    broadsideCannons: 6, bowCannons: 1, reloadTime: 4.4, projectileSpeed: 65,
    special: 'banquet-repair',
    palette: { hull: 0x7b5632, hullDark: 0x332419, trim: 0xdcb64e, sail: 0xefead8, accent: 0x4f8b60, metal: 0x30363b },
  },
  'navy-galleon': {
    kind: 'navy-galleon', displayName: 'Marine Galleon', subtitle: 'Armored Ship of Justice',
    length: 70, beam: 25, draft: 9, mastCount: 3, crewCount: 16, buoyancySamples: 8,
    mass: 2_200, maxSpeed: 23, acceleration: 3, reverseSpeed: 3.8, turnRate: 0.34, hardTurnGrip: 0.66,
    hullStrength: 195, sailStrength: 145, weaponStrength: 185, crewStrength: 175,
    broadsideCannons: 11, bowCannons: 2, reloadTime: 4.05, projectileSpeed: 74,
    special: 'justice-salvo',
    palette: { hull: 0xd8dce0, hullDark: 0x263c56, trim: 0x3d78a7, sail: 0xf4f3e8, accent: 0x1b568a, metal: 0x26313e },
  },
};

export const SHIP_KINDS = Object.freeze(Object.keys(SHIP_SPECS) as ShipKind[]);

export function getShipSpec(kind: ShipKind): ShipSpec {
  return SHIP_SPECS[kind];
}
