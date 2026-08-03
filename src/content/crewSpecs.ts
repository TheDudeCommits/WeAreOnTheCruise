import type { ShipKind } from '../core/contracts';

export type CrewBuild = 'small' | 'lean' | 'average' | 'tall' | 'broad' | 'giant' | 'round' | 'skeleton' | 'mink';
export type CrewHat = 'none' | 'straw' | 'bandana' | 'chef' | 'pirate' | 'top' | 'spotted' | 'crown' | 'marine' | 'goggles';
export type CrewAccessory = 'none' | 'sword' | 'two-swords' | 'three-swords' | 'rifle' | 'staff' | 'slingshot' | 'wrench' | 'cane' | 'naginata' | 'trident' | 'axes';

export interface CrewMemberSpec {
  name: string;
  role: string;
  captain?: boolean;
  build: CrewBuild;
  hat: CrewHat;
  accessory: CrewAccessory;
  primary: number;
  secondary: number;
  skin: number;
  hair: number;
  scale?: number;
  /** Normalized deck coordinates: x is port/starboard, z is bow/stern. */
  station: readonly [x: number, z: number, facing?: number];
}

const SUNNY_CREW: readonly CrewMemberSpec[] = [
  { name: 'Monkey D. Luffy', role: 'Captain', captain: true, build: 'lean', hat: 'straw', accessory: 'none', primary: 0xd93f2f, secondary: 0x2456a6, skin: 0xc87b4d, hair: 0x15151d, scale: 1.04, station: [0, -0.07, Math.PI] },
  { name: 'Roronoa Zoro', role: 'Swordsman', build: 'broad', hat: 'bandana', accessory: 'three-swords', primary: 0x2c7b43, secondary: 0x171921, skin: 0xc8895e, hair: 0x63a845, station: [-0.27, -0.12, -0.4] },
  { name: 'Nami', role: 'Navigator', build: 'lean', hat: 'none', accessory: 'staff', primary: 0x2f93a5, secondary: 0xf0d5ae, skin: 0xd48a5d, hair: 0xe66b2e, station: [0.22, 0.13, 2.5] },
  { name: 'Usopp', role: 'Sniper', build: 'lean', hat: 'goggles', accessory: 'slingshot', primary: 0xc68a2d, secondary: 0x76512f, skin: 0xaa653e, hair: 0x17151b, scale: 1.03, station: [0.27, -0.17, 0.6] },
  { name: 'Sanji', role: 'Cook', build: 'tall', hat: 'none', accessory: 'none', primary: 0x20222d, secondary: 0x416b9c, skin: 0xd29a6c, hair: 0xe3bd4e, station: [-0.2, 0.1, -2.4] },
  { name: 'Tony Tony Chopper', role: 'Doctor', build: 'small', hat: 'top', accessory: 'none', primary: 0xe95d93, secondary: 0x67b9ce, skin: 0x86512e, hair: 0x6e4229, scale: 0.8, station: [0.08, -0.03, 0.4] },
  { name: 'Nico Robin', role: 'Archaeologist', build: 'tall', hat: 'none', accessory: 'none', primary: 0x503d81, secondary: 0xe6c85a, skin: 0xc88c63, hair: 0x17151e, station: [-0.08, -0.2, -0.2] },
  { name: 'Franky', role: 'Shipwright', build: 'giant', hat: 'none', accessory: 'wrench', primary: 0x45b9d2, secondary: 0xd53f35, skin: 0xb97651, hair: 0x48afd1, scale: 1.08, station: [0.3, 0.02, 1.2] },
  { name: 'Brook', role: 'Musician', build: 'skeleton', hat: 'top', accessory: 'cane', primary: 0x25212f, secondary: 0x4e91c7, skin: 0xf2ead5, hair: 0x16151d, scale: 1.13, station: [-0.3, 0.03, -1.1] },
  { name: 'Jinbe', role: 'Helmsman', build: 'giant', hat: 'none', accessory: 'none', primary: 0xd46b39, secondary: 0x295d91, skin: 0x4f91aa, hair: 0x1b2e40, scale: 1.05, station: [0, 0.08, Math.PI] },
];

export const SHIP_CREWS: Readonly<Record<ShipKind, readonly CrewMemberSpec[]>> = {
  'thousand-sunny': SUNNY_CREW,
  'going-merry': SUNNY_CREW.slice(0, 6),
  'moby-dick': [
    { name: 'Edward Newgate', role: 'Captain — Whitebeard', captain: true, build: 'giant', hat: 'none', accessory: 'naginata', primary: 0xf1ede0, secondary: 0xa32f38, skin: 0xb9774f, hair: 0xf3ead4, scale: 1.23, station: [0, 0.06, Math.PI] },
    { name: 'Marco', role: '1st Division Commander', build: 'tall', hat: 'none', accessory: 'none', primary: 0x634a8e, secondary: 0xf0c94d, skin: 0xd39a70, hair: 0xe7c73d, station: [-0.22, 0.03, -0.4] },
    { name: 'Portgas D. Ace', role: '2nd Division Commander', build: 'broad', hat: 'pirate', accessory: 'none', primary: 0xd77a2d, secondary: 0x27202c, skin: 0xc77d50, hair: 0x18161d, station: [0.22, -0.05, 0.4] },
    { name: 'Jozu', role: '3rd Division Commander', build: 'giant', hat: 'none', accessory: 'none', primary: 0x627c97, secondary: 0x2b323e, skin: 0xa76645, hair: 0x2a2524, scale: 1.11, station: [-0.3, -0.2, 0.2] },
    { name: 'Vista', role: '5th Division Commander', build: 'tall', hat: 'top', accessory: 'two-swords', primary: 0x8e2940, secondary: 0xf2eee3, skin: 0xbc7a53, hair: 0x17151a, station: [0.29, -0.2, -0.2] },
  ],
  'red-force': [
    { name: 'Shanks', role: 'Captain', captain: true, build: 'tall', hat: 'none', accessory: 'sword', primary: 0x23202a, secondary: 0xa73132, skin: 0xc47d55, hair: 0xb83234, scale: 1.1, station: [0, 0.06, Math.PI] },
    { name: 'Benn Beckman', role: 'First Mate', build: 'tall', hat: 'none', accessory: 'rifle', primary: 0x34353b, secondary: 0x6c7180, skin: 0xb77b59, hair: 0xb2abb0, station: [-0.24, -0.06, -0.5] },
    { name: 'Lucky Roux', role: 'Combatant', build: 'round', hat: 'goggles', accessory: 'none', primary: 0x54774b, secondary: 0xe2bd3c, skin: 0xaa6547, hair: 0x241b1b, scale: 1.1, station: [0.2, 0.02, 0.45] },
    { name: 'Yasopp', role: 'Sniper', build: 'lean', hat: 'bandana', accessory: 'rifle', primary: 0xb17835, secondary: 0x673425, skin: 0x8e5135, hair: 0x39241d, station: [0.26, -0.19, 0.2] },
  ],
  'oro-jackson': [
    { name: 'Gol D. Roger', role: 'Captain — Pirate King', captain: true, build: 'broad', hat: 'pirate', accessory: 'sword', primary: 0xba3034, secondary: 0xe1b345, skin: 0xb66f4d, hair: 0x16151c, scale: 1.16, station: [0, 0.02, Math.PI] },
    { name: 'Silvers Rayleigh', role: 'First Mate', build: 'tall', hat: 'none', accessory: 'sword', primary: 0xd8d5c9, secondary: 0x364664, skin: 0xbc805d, hair: 0xd8d4c8, station: [-0.24, -0.06, -0.4] },
    { name: 'Scopper Gaban', role: 'Senior Officer', build: 'broad', hat: 'none', accessory: 'axes', primary: 0x426b79, secondary: 0x4a3127, skin: 0xa96445, hair: 0x282123, station: [0.24, -0.08, 0.4] },
    { name: 'Crocus', role: 'Doctor', build: 'average', hat: 'none', accessory: 'none', primary: 0xdfd5c2, secondary: 0xb2833d, skin: 0xb47a5a, hair: 0xe1ded2, station: [0, -0.22, 0] },
  ],
  'polar-tang': [
    { name: 'Trafalgar Law', role: 'Captain & Doctor', captain: true, build: 'tall', hat: 'spotted', accessory: 'sword', primary: 0xe8bd35, secondary: 0x25252e, skin: 0xb97552, hair: 0x1b1920, scale: 1.08, station: [0, -0.17, Math.PI] },
    { name: 'Bepo', role: 'Navigator', build: 'mink', hat: 'none', accessory: 'none', primary: 0xe8873b, secondary: 0x2e3945, skin: 0xf0eadb, hair: 0xf0eadb, scale: 1.05, station: [-0.24, -0.08, -0.2] },
    { name: 'Shachi', role: 'Crew Officer', build: 'lean', hat: 'goggles', accessory: 'none', primary: 0xe8aa2d, secondary: 0x2c3038, skin: 0xb66e4e, hair: 0xb34a31, station: [0.23, -0.09, 0.2] },
    { name: 'Penguin', role: 'Crew Officer', build: 'lean', hat: 'marine', accessory: 'none', primary: 0xe6a82d, secondary: 0x2d3039, skin: 0xb97654, hair: 0x2a2424, station: [0, -0.22, 0] },
  ],
  'queen-mama-chanter': [
    { name: 'Charlotte Linlin', role: 'Captain — Big Mom', captain: true, build: 'giant', hat: 'crown', accessory: 'sword', primary: 0xea78a7, secondary: 0x8b3f75, skin: 0xe1a581, hair: 0xe06a9d, scale: 1.35, station: [0, -0.08, Math.PI] },
    { name: 'Charlotte Katakuri', role: 'Sweet Commander', build: 'giant', hat: 'none', accessory: 'trident', primary: 0x572b60, secondary: 0xbb5679, skin: 0xb77556, hair: 0x842943, scale: 1.12, station: [-0.25, -0.16, -0.5] },
    { name: 'Charlotte Perospero', role: 'Minister of Candy', build: 'tall', hat: 'top', accessory: 'cane', primary: 0xd0426a, secondary: 0xf2c848, skin: 0xc78660, hair: 0xb7476c, station: [0.24, -0.15, 0.5] },
    { name: 'Charlotte Smoothie', role: 'Sweet Commander', build: 'tall', hat: 'none', accessory: 'sword', primary: 0xe8e1d2, secondary: 0x9b4f84, skin: 0xb47a5a, hair: 0xf0e9dd, scale: 1.08, station: [0, -0.24, 0] },
  ],
  baratie: [
    { name: 'Zeff', role: 'Head Chef & Owner', captain: true, build: 'tall', hat: 'chef', accessory: 'none', primary: 0xf0eee3, secondary: 0x3a6f92, skin: 0xc7875c, hair: 0xd8be4b, scale: 1.1, station: [0, -0.09, Math.PI] },
    { name: 'Sanji', role: 'Sous-chef', build: 'tall', hat: 'none', accessory: 'none', primary: 0x20222d, secondary: 0x416b9c, skin: 0xd29a6c, hair: 0xe3bd4e, station: [-0.23, -0.17, -0.5] },
    { name: 'Patty', role: 'Cook', build: 'broad', hat: 'chef', accessory: 'none', primary: 0xf2eee1, secondary: 0x61906c, skin: 0xb67150, hair: 0x2b2525, station: [0.23, -0.16, 0.5] },
    { name: 'Carne', role: 'Cook', build: 'average', hat: 'chef', accessory: 'none', primary: 0xeeeadd, secondary: 0xb36e3b, skin: 0xb97854, hair: 0x342925, station: [0, -0.25, 0] },
  ],
  'navy-galleon': [
    { name: 'Monkey D. Garp', role: 'Vice Admiral', captain: true, build: 'giant', hat: 'marine', accessory: 'none', primary: 0xf2f0e7, secondary: 0x235d9c, skin: 0xb77b58, hair: 0xe7e4da, scale: 1.14, station: [0, 0.04, Math.PI] },
    { name: 'Koby', role: 'Marine Captain', build: 'lean', hat: 'marine', accessory: 'none', primary: 0xf0eee6, secondary: 0x3f7bad, skin: 0xc58a65, hair: 0xe57b92, station: [-0.22, -0.05, -0.4] },
    { name: 'Helmeppo', role: 'Lieutenant Commander', build: 'tall', hat: 'marine', accessory: 'sword', primary: 0xf1efe7, secondary: 0x557fa6, skin: 0xc38863, hair: 0xd8c354, station: [0.22, -0.06, 0.4] },
    { name: 'Bogard', role: 'Marine Headquarters Officer', build: 'tall', hat: 'top', accessory: 'sword', primary: 0x262b35, secondary: 0x141821, skin: 0xb77956, hair: 0x2f3137, station: [0, -0.2, 0] },
  ],
};

export function getShipCrew(kind: ShipKind): readonly CrewMemberSpec[] {
  return SHIP_CREWS[kind];
}

export function getShipCaptain(kind: ShipKind): CrewMemberSpec {
  return SHIP_CREWS[kind].find((member) => member.captain) ?? SHIP_CREWS[kind][0];
}
