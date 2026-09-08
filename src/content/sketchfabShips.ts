import type { ShipKind } from '../core/contracts';

/** Runtime art is derived from these downloaded source models, never generated hulls. */
export const SKETCHFAB_SHIPS: Partial<Record<ShipKind, { uid: string; author: string; title: string }>> = {
  'thousand-sunny': { uid: '99986d1c93654c9d8889017435b5fe06', author: 'Miraculousetabug', title: 'One piece Thousand Sunny' },
  'going-merry': { uid: '4b2cb678bf984c018dfa1936bd156c8d', author: 'Oliver Edwards', title: 'The Going Merry (One Piece) - Game Ready' },
  'navy-galleon': { uid: '92898d5f63ad43589203d5a8dc14aa12', author: 'Ryanwill679 / TrashCG', title: 'Marine ship From One piece' },
  'moby-dick': { uid: 'd9be26addfec48019188dd615a930311', author: 'Tigerar1', title: 'Moby Dick Ship' },
  'baratie': { uid: '015ebe70a76749eeb92f5f39693b8ea5', author: 'Chin Eeyang', title: 'Baratie - One Piece' },
  'polar-tang': { uid: 'a7feb48976ce484aa4537e4c7124a9c4', author: 'taem5070', title: 'Polar Tang' },
};

export const hasSketchfabShip = (kind: ShipKind): boolean => Object.hasOwn(SKETCHFAB_SHIPS,kind);
