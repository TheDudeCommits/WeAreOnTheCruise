export const GERSTNER_WAVE_COUNT = 5 as const;

export interface GerstnerWave {
  readonly directionX: number;
  readonly directionZ: number;
  readonly amplitude: number;
  readonly wavelength: number;
  /** Phase speed in metres per second. */
  readonly speed: number;
  /** Horizontal crest sharpening in the safe 0..1 range. */
  readonly steepness: number;
}

export interface WaveVector {
  x: number;
  y: number;
  z: number;
}

export interface WaveSample {
  /** Displaced surface height; equivalent to displacement.y. */
  height: number;
  displacement: WaveVector;
  normal: WaveVector;
  /** Instantaneous velocity of the displaced surface. */
  velocity: WaveVector;
  /** Normalized sharp-crest signal used by foam and spray. */
  crest: number;
}

export interface WaveSampler {
  sample(x: number, z: number, time: number): WaveSample;
}

/**
 * A coherent wind sea: one long swell, a secondary swell and three shorter waves spread within about ±40°
 * of the swell direction (wide crossings read as an artificial diamond lattice with only five waves).
 * These exact parameters are uploaded to GLSL, keeping buoyancy and rendered water in sync.
 */
export const DEFAULT_GERSTNER_WAVES: readonly GerstnerWave[] = Object.freeze([
  Object.freeze({ directionX: 0.94, directionZ: 0.342, amplitude: 2.3, wavelength: 150, speed: 10.8, steepness: 0.52 }),
  Object.freeze({ directionX: 0.755, directionZ: 0.656, amplitude: 1.05, wavelength: 79, speed: 7.6, steepness: 0.46 }),
  Object.freeze({ directionX: 0.995, directionZ: -0.105, amplitude: 0.55, wavelength: 42, speed: 5.6, steepness: 0.42 }),
  Object.freeze({ directionX: 0.469, directionZ: 0.883, amplitude: 0.27, wavelength: 19.5, speed: 3.7, steepness: 0.36 }),
  Object.freeze({ directionX: 0.857, directionZ: -0.515, amplitude: 0.14, wavelength: 9.6, speed: 2.5, steepness: 0.3 }),
]);

const TAU = Math.PI * 2;

export function sampleGerstnerWaves(
  x: number,
  z: number,
  time: number,
  waves: readonly GerstnerWave[] = DEFAULT_GERSTNER_WAVES,
  strength = 1,
): WaveSample {
  let displacedX = x;
  let displacedY = 0;
  let displacedZ = z;
  let velocityX = 0;
  let velocityY = 0;
  let velocityZ = 0;
  let tangentX = 1;
  let tangentY = 0;
  let tangentZ = 0;
  let bitangentX = 0;
  let bitangentY = 0;
  let bitangentZ = 1;
  let crest = 0;
  let crestWeight = 0;

  const safeStrength = Math.max(0, strength);
  for (const wave of waves) {
    const directionLength = Math.hypot(wave.directionX, wave.directionZ) || 1;
    const directionX = wave.directionX / directionLength;
    const directionZ = wave.directionZ / directionLength;
    const amplitude = wave.amplitude * safeStrength;
    const waveNumber = TAU / Math.max(0.001, wave.wavelength);
    const angularFrequency = waveNumber * wave.speed;
    const phase = waveNumber * (directionX * x + directionZ * z) - angularFrequency * time;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);
    const horizontalAmplitude = amplitude * Math.min(0.95, Math.max(0, wave.steepness));
    const slope = horizontalAmplitude * waveNumber * sine;
    const verticalSlope = amplitude * waveNumber * cosine;

    displacedX += directionX * horizontalAmplitude * cosine;
    displacedY += amplitude * sine;
    displacedZ += directionZ * horizontalAmplitude * cosine;

    velocityX += directionX * horizontalAmplitude * angularFrequency * sine;
    velocityY -= amplitude * angularFrequency * cosine;
    velocityZ += directionZ * horizontalAmplitude * angularFrequency * sine;

    tangentX -= directionX * directionX * slope;
    tangentY += directionX * verticalSlope;
    tangentZ -= directionX * directionZ * slope;
    bitangentX -= directionX * directionZ * slope;
    bitangentY += directionZ * verticalSlope;
    bitangentZ -= directionZ * directionZ * slope;

    const sharpCrest = Math.pow(Math.max(0, sine * 0.5 + 0.5), 5);
    crest += sharpCrest * amplitude;
    crestWeight += Math.max(0.0001, amplitude);
  }

  const normalX = bitangentY * tangentZ - bitangentZ * tangentY;
  const normalY = bitangentZ * tangentX - bitangentX * tangentZ;
  const normalZ = bitangentX * tangentY - bitangentY * tangentX;
  const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;

  return {
    height: displacedY,
    displacement: { x: displacedX, y: displacedY, z: displacedZ },
    normal: { x: normalX / normalLength, y: normalY / normalLength, z: normalZ / normalLength },
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    crest: crest / Math.max(0.0001, crestWeight),
  };
}

export function createWaveSampler(
  waves: readonly GerstnerWave[] = DEFAULT_GERSTNER_WAVES,
  strength = 1,
): WaveSampler {
  return {
    sample: (x, z, time) => sampleGerstnerWaves(x, z, time, waves, strength),
  };
}

/** Shared GLSL implementation. Consumers provide the five wave uniform arrays. */
export const GERSTNER_GLSL = /* glsl */ `
#define GERSTNER_WAVE_COUNT 5

uniform vec2 uWaveDirection[GERSTNER_WAVE_COUNT];
uniform float uWaveAmplitude[GERSTNER_WAVE_COUNT];
uniform float uWaveLength[GERSTNER_WAVE_COUNT];
uniform float uWaveSpeed[GERSTNER_WAVE_COUNT];
uniform float uWaveSteepness[GERSTNER_WAVE_COUNT];
uniform float uWaveStrength;

void sampleGerstnerWaves(
  vec2 worldXZ,
  float time,
  out vec3 displaced,
  out vec3 surfaceNormal,
  out float crestSignal
) {
  displaced = vec3(worldXZ.x, 0.0, worldXZ.y);
  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 bitangent = vec3(0.0, 0.0, 1.0);
  float crest = 0.0;
  float crestWeight = 0.0;

  for (int index = 0; index < GERSTNER_WAVE_COUNT; index++) {
    vec2 direction = normalize(uWaveDirection[index]);
    float amplitude = uWaveAmplitude[index] * max(0.0, uWaveStrength);
    float waveNumber = 6.28318530718 / max(0.001, uWaveLength[index]);
    float angularFrequency = waveNumber * uWaveSpeed[index];
    float phase = waveNumber * dot(direction, worldXZ) - angularFrequency * time;
    float sinePhase = sin(phase);
    float cosinePhase = cos(phase);
    float horizontalAmplitude = amplitude * clamp(uWaveSteepness[index], 0.0, 0.95);
    float slope = horizontalAmplitude * waveNumber * sinePhase;
    float verticalSlope = amplitude * waveNumber * cosinePhase;

    displaced.xz += direction * horizontalAmplitude * cosinePhase;
    displaced.y += amplitude * sinePhase;

    tangent += vec3(
      -direction.x * direction.x * slope,
      direction.x * verticalSlope,
      -direction.x * direction.y * slope
    );
    bitangent += vec3(
      -direction.x * direction.y * slope,
      direction.y * verticalSlope,
      -direction.y * direction.y * slope
    );

    float sharpCrest = pow(max(0.0, sinePhase * 0.5 + 0.5), 5.0);
    crest += sharpCrest * amplitude;
    crestWeight += max(0.0001, amplitude);
  }

  surfaceNormal = normalize(cross(bitangent, tangent));
  crestSignal = crest / max(0.0001, crestWeight);
}
`;

// ───────────────────────── Non-allocating, footprint-filtered sampling (OCEAN) ─────────────────────────
//
// The ocean renders the waves on a camera-projected grid. Waves shorter than the grid can resolve are faded
// out (instead of aliasing into crawling noise), so the rendered surface is the Gerstner sum with each wave
// weighted by `gerstnerFilter(wavelength, footprint)`. `footprint` is the local sample spacing in metres (0 =
// unfiltered). The ocean's OceanServices.heightAt/normalAt pass the same footprint the vertex shader used, so
// ships float on exactly the surface that is drawn.
//
// Positions are world XZ of the *displaced* surface: the samplers invert the horizontal Gerstner displacement
// with two fixed-point steps before evaluating height/normal, matching what the rendered mesh shows at (x, z).

/** 1 when the spacing resolves the wave comfortably (≤ λ/8), 0 when it cannot (≥ λ/3). Mirrors GERSTNER_FILTER_GLSL. */
export function gerstnerFilter(wavelength: number, footprint: number): number {
  const lo = wavelength * 0.125;
  const hi = wavelength * 0.33;
  if (footprint <= lo) return 1;
  if (footprint >= hi) return 0;
  const t = (footprint - lo) / (hi - lo);
  return 1 - t * t * (3 - 2 * t);
}

/** GLSL twin of gerstnerFilter (smoothstep is identical to the JS polynomial). */
export const GERSTNER_FILTER_GLSL = /* glsl */ `
float gerstnerFilter(float wavelength, float footprint) {
  return 1.0 - smoothstep(wavelength * 0.125, wavelength * 0.33, footprint);
}
`;

/** Per-wave constants derived once per wave set (normalized direction, wave number, angular frequency). */
export interface PreparedWaves {
  readonly count: number;
  readonly dirX: Float64Array;
  readonly dirZ: Float64Array;
  readonly k: Float64Array;
  readonly omega: Float64Array;
  readonly amplitude: Float64Array;
  readonly steepness: Float64Array;
  readonly wavelength: Float64Array;
}

const preparedCache = new WeakMap<readonly GerstnerWave[], PreparedWaves>();

export function prepareGerstnerWaves(waves: readonly GerstnerWave[] = DEFAULT_GERSTNER_WAVES): PreparedWaves {
  const cached = preparedCache.get(waves);
  if (cached) return cached;
  const n = waves.length;
  const prepared: PreparedWaves = {
    count: n,
    dirX: new Float64Array(n), dirZ: new Float64Array(n), k: new Float64Array(n), omega: new Float64Array(n),
    amplitude: new Float64Array(n), steepness: new Float64Array(n), wavelength: new Float64Array(n),
  };
  waves.forEach((wave, i) => {
    const len = Math.hypot(wave.directionX, wave.directionZ) || 1;
    const wavelength = Math.max(0.001, wave.wavelength);
    prepared.dirX[i] = wave.directionX / len;
    prepared.dirZ[i] = wave.directionZ / len;
    prepared.k[i] = TAU / wavelength;
    prepared.omega[i] = prepared.k[i]! * wave.speed;
    prepared.amplitude[i] = wave.amplitude;
    prepared.steepness[i] = Math.min(0.95, Math.max(0, wave.steepness));
    prepared.wavelength[i] = wavelength;
  });
  preparedCache.set(waves, prepared);
  return prepared;
}

const filterScratch = new Float64Array(16);

function fillFilters(p: PreparedWaves, strength: number, footprint: number): void {
  for (let i = 0; i < p.count; i++) filterScratch[i] = strength * (footprint > 0 ? gerstnerFilter(p.wavelength[i]!, footprint) : 1);
}

/** Fixed-point inversion of the horizontal displacement: returns the base point via the out array [bx, bz]. */
function invertBase(p: PreparedWaves, x: number, z: number, time: number, out: Float64Array): void {
  let bx = x;
  let bz = z;
  for (let iteration = 0; iteration < 2; iteration++) {
    let ox = 0;
    let oz = 0;
    for (let i = 0; i < p.count; i++) {
      const weight = filterScratch[i]!;
      if (weight <= 0) continue;
      const horizontal = p.amplitude[i]! * p.steepness[i]! * weight;
      if (horizontal <= 0) continue;
      const phase = p.k[i]! * (p.dirX[i]! * bx + p.dirZ[i]! * bz) - p.omega[i]! * time;
      const c = Math.cos(phase) * horizontal;
      ox += p.dirX[i]! * c;
      oz += p.dirZ[i]! * c;
    }
    bx = x - ox;
    bz = z - oz;
  }
  out[0] = bx;
  out[1] = bz;
}

const baseScratch = new Float64Array(2);

/**
 * Height of the rendered surface at world (x, z). No allocations. `footprint` (metres) fades waves the render
 * grid cannot resolve; pass 0 for the full-detail surface.
 */
export function sampleGerstnerHeight(
  x: number,
  z: number,
  time: number,
  waves: readonly GerstnerWave[] = DEFAULT_GERSTNER_WAVES,
  strength = 1,
  footprint = 0,
): number {
  const p = prepareGerstnerWaves(waves);
  fillFilters(p, Math.max(0, strength), footprint);
  invertBase(p, x, z, time, baseScratch);
  const bx = baseScratch[0]!;
  const bz = baseScratch[1]!;
  let height = 0;
  for (let i = 0; i < p.count; i++) {
    const weight = filterScratch[i]!;
    if (weight <= 0) continue;
    const phase = p.k[i]! * (p.dirX[i]! * bx + p.dirZ[i]! * bz) - p.omega[i]! * time;
    height += p.amplitude[i]! * weight * Math.sin(phase);
  }
  return height;
}

/** Unit normal of the rendered surface at world (x, z), written into `out`. No allocations. */
export function sampleGerstnerNormal<T extends WaveVector>(
  x: number,
  z: number,
  time: number,
  out: T,
  waves: readonly GerstnerWave[] = DEFAULT_GERSTNER_WAVES,
  strength = 1,
  footprint = 0,
): T {
  const p = prepareGerstnerWaves(waves);
  fillFilters(p, Math.max(0, strength), footprint);
  invertBase(p, x, z, time, baseScratch);
  const bx = baseScratch[0]!;
  const bz = baseScratch[1]!;
  let tx = 1, ty = 0, tz = 0;
  let sx = 0, sy = 0, sz = 1;
  for (let i = 0; i < p.count; i++) {
    const weight = filterScratch[i]!;
    if (weight <= 0) continue;
    const dx = p.dirX[i]!;
    const dz = p.dirZ[i]!;
    const k = p.k[i]!;
    const amplitude = p.amplitude[i]! * weight;
    const phase = k * (dx * bx + dz * bz) - p.omega[i]! * time;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const slope = amplitude * p.steepness[i]! * k * s;
    const vertical = amplitude * k * c;
    tx -= dx * dx * slope;
    ty += dx * vertical;
    tz -= dx * dz * slope;
    sx -= dx * dz * slope;
    sy += dz * vertical;
    sz -= dz * dz * slope;
  }
  // normal = bitangent × tangent (same orientation as sampleGerstnerWaves).
  const nx = sy * tz - sz * ty;
  const ny = sz * tx - sx * tz;
  const nz = sx * ty - sy * tx;
  const len = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return out;
}

/** Sum of amplitudes (metres at strength 1) — used to normalise crest signals. */
export function gerstnerAmplitudeSum(waves: readonly GerstnerWave[] = DEFAULT_GERSTNER_WAVES): number {
  let sum = 0;
  for (const wave of waves) sum += wave.amplitude;
  return sum;
}
