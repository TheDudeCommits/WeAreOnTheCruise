/**
 * Visual recoil heel for the hero ship (IMPACT round 2): FX knows when a volley fires, the hero model owns its roll.
 * Kicks are roll-velocity impulses in rad/s with the sim's sign convention (`side * v`, +1 = starboard guns: the hull
 * heels away from the firing side). HeroShip drains them into a stiff spring (peak ≈ 0.094 × impulse radians).
 * Kept dependency-free so both sides can import it.
 */
export const heroHeel = { impulse: 0 };

/** Peak heel (degrees) → impulse for HeroShip's spring (ω 7, ζ 0.32). */
export const heelImpulse = (degrees: number): number => (degrees * Math.PI) / 180 / 0.094;

export function kickHeroHeel(v: number): void { heroHeel.impulse += v; }
