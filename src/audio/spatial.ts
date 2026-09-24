/**
 * Listener-relative spatialisation for a tactical 3/4 camera (AUDIO-owned, pure functions).
 *
 * The "ears" sit on the water at the player ship (or the camera's ground focus in menus) and face the
 * camera's heading, so screen-left is ear-left. Distance attenuation is inverse-distance with a
 * reference radius; far sources are also low-passed (air absorption) and culled beyond maxDistance.
 */
import type { CategorySpec } from './categories';

export interface ListenerFrame {
  x: number;
  z: number;
  /** Unit vector pointing to screen-right on the water plane. */
  rightX: number;
  rightZ: number;
  /** Unit vector pointing up-screen (camera heading) on the water plane. */
  fwdX: number;
  fwdZ: number;
}

export interface SpatialResult {
  gain: number;
  pan: number;
  /** Low-pass cutoff in Hz. */
  cutoff: number;
  distance: number;
}

export const OPEN_CUTOFF = 20000;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Builds the listener frame from the camera pose of the AudioFrame contract.
 * `forwardX/forwardZ` are the horizontal components of the camera's unit forward vector, so the
 * vertical component is recovered as -sqrt(1 - fx² - fz²) (the camera looks down at the sea).
 */
export function listenerFromCamera(
  cam: { x: number; y: number; z: number; forwardX: number; forwardZ: number },
  focus: { x: number; z: number } | null,
  out: ListenerFrame,
): ListenerFrame {
  let fx = cam.forwardX, fz = cam.forwardZ;
  const h = Math.hypot(fx, fz);
  if (h > 1e-4) { fx /= h; fz /= h; } else { fx = 0; fz = -1; }
  out.fwdX = fx; out.fwdZ = fz;
  // right = forward × up = (-fz, fx) on the XZ plane.
  out.rightX = -fz; out.rightZ = fx;
  if (focus) { out.x = focus.x; out.z = focus.z; return out; }
  // Ground focus: intersect the view ray with the water plane (y = 0).
  const fy = -Math.sqrt(Math.max(0, 1 - cam.forwardX * cam.forwardX - cam.forwardZ * cam.forwardZ));
  if (fy < -0.05 && cam.y > 0) {
    const t = Math.min(600, cam.y / -fy);
    out.x = cam.x + cam.forwardX * t;
    out.z = cam.z + cam.forwardZ * t;
  } else {
    out.x = cam.x; out.z = cam.z;
  }
  return out;
}

/** Distance gain (0..1) for a category model. */
export function distanceGain(d: number, ref: number, rolloff: number, maxDistance: number): number {
  if (d >= maxDistance) return 0;
  const g = ref / (ref + rolloff * Math.max(0, d - ref));
  return g * (1 - smoothstep(maxDistance * 0.78, maxDistance, d));
}

export function spatialize(
  l: ListenerFrame, x: number, z: number, spec: Pick<CategorySpec, 'ref' | 'rolloff' | 'maxDistance'>, out: SpatialResult,
): SpatialResult {
  const dx = x - l.x, dz = z - l.z;
  const d = Math.hypot(dx, dz);
  out.distance = d;
  out.gain = distanceGain(d, spec.ref, spec.rolloff, spec.maxDistance);
  if (d < 1e-3) { out.pan = 0; out.cutoff = OPEN_CUTOFF; return out; }
  const side = (dx * l.rightX + dz * l.rightZ) / d;
  // Near sources collapse towards the centre; never hard-pan (keeps both ears alive on headphones).
  out.pan = Math.max(-0.85, Math.min(0.85, side * 0.9 * smoothstep(4, 30, d)));
  // Air absorption: open up close, roll down to ~1.8 kHz at the far edge.
  const far = smoothstep(spec.ref * 1.5, spec.maxDistance, d);
  out.cutoff = OPEN_CUTOFF * Math.pow(2, -3.4 * far);
  return out;
}
