import type { ShipKind } from "../../core/contracts";
import type { ShipSpec } from "../../content/shipSpecs";

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export function mainDeckHeight(spec: ShipSpec): number {
  return spec.draft * 0.17 + 1.44;
}
/** Surface of Polar's rotated, vertically compressed capsule hull. */
export function polarDeckHeightAt(spec: ShipSpec, x: number, z: number): number {
  const radius = spec.beam * .48;
  const end = Math.max(0, Math.abs(z) - spec.length * .36);
  return Math.sqrt(Math.max(0, radius * radius - x * x - end * end)) * .82;
}
export function deckHeightAt(
  kind: ShipKind,
  spec: ShipSpec,
  z: number,
): number {
  const base = mainDeckHeight(spec);
  if (kind !== "thousand-sunny" && kind !== "navy-galleon") return base;
  const fore =
    smooth((-z / spec.length - 0.19) / 0.07) *
    spec.draft *
    (kind === "thousand-sunny" ? 0.29 : 0.3);
  const stern =
    smooth((z / spec.length - 0.13) / 0.07) *
    spec.draft *
    (kind === "thousand-sunny" ? 0.5 : 0.56);
  return base + fore + stern;
}
export function hullHalfWidth(spec: ShipSpec, z: number): number {
  const t = Math.max(0.005, Math.min(0.995, z / spec.length + 0.5));
  return spec.beam * 0.49 * Math.pow(Math.sin(t * Math.PI), 0.43);
}
