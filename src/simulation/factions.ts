import type { AiCombatRole, ShipFaction, ShipKind } from '../core/contracts';

const FRIENDLY_PIRATES = new Set<ShipFaction>(['straw-hat', 'red-hair', 'whitebeard', 'heart', 'roger']);

export function defaultFactionForShip(kind: ShipKind): ShipFaction {
  switch (kind) {
    case 'thousand-sunny':
    case 'going-merry': return 'straw-hat';
    case 'moby-dick': return 'whitebeard';
    case 'red-force': return 'red-hair';
    case 'oro-jackson': return 'roger';
    case 'polar-tang': return 'heart';
    case 'queen-mama-chanter': return 'big-mom';
    case 'baratie': return 'merchant';
    case 'navy-galleon': return 'marine';
  }
}

export function defaultCombatRoleForShip(kind: ShipKind): AiCombatRole {
  switch (kind) {
    case 'moby-dick':
    case 'queen-mama-chanter': return 'rammer';
    case 'polar-tang': return 'flanker';
    case 'baratie': return 'flee';
    case 'navy-galleon': return 'broadside';
    case 'oro-jackson': return 'ranged';
    case 'going-merry': return 'escort';
    case 'thousand-sunny':
    case 'red-force': return 'broadside';
  }
}

/** Symmetric baseline diplomacy. Individual damage can temporarily override this in simulation. */
export function areFactionsHostile(first?: ShipFaction, second?: ShipFaction): boolean {
  if (!first || !second || first === second) return false;
  if (first === 'merchant' || second === 'merchant') return false;
  if (first === 'independent' || second === 'independent') return false;
  if (first === 'big-mom' || second === 'big-mom') return true;
  if (first === 'marine' || second === 'marine') return true;
  if (FRIENDLY_PIRATES.has(first) && FRIENDLY_PIRATES.has(second)) return false;
  return true;
}

export function areFactionsAllied(first?: ShipFaction, second?: ShipFaction): boolean {
  if (!first || !second) return false;
  return first === second || FRIENDLY_PIRATES.has(first) && FRIENDLY_PIRATES.has(second);
}
