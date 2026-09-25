/** Number and time formatting for the UI (formatters are created once). */

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function fmtInt(n: number): string {
  return INT.format(Math.round(n));
}

/** 12:34 (minutes zero-padded to two digits, hours roll into minutes). */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
}

/** 1.2K / 3.4M / 12M. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${trim(n / 1e9)}B`;
  if (a >= 1e6) return `${trim(n / 1e6)}M`;
  if (a >= 1e4) return `${trim(n / 1e3)}K`;
  return fmtInt(n);
}

function trim(v: number): string {
  return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
}

export const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/**
 * Speed readout in knots on the game's scale (ships are sized and paced for play, not to scale): m/s × 1.944 read as
 * 50-60 kn, so the HUD and the harbor divide by three — a fast hull tops out around 20 kn, like a real clipper.
 */
export function knots(metresPerSecond: number): number {
  return Math.round((Math.abs(metresPerSecond) * 1.944) / 3);
}
