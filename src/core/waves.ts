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
 * One long swell, two crossing body waves and two short chops. These exact
 * parameters are uploaded to GLSL, keeping buoyancy and rendered water in sync.
 */
export const DEFAULT_GERSTNER_WAVES: readonly GerstnerWave[] = Object.freeze([
  Object.freeze({ directionX: 0.94, directionZ: 0.342, amplitude: 2.65, wavelength: 142, speed: 10.8, steepness: 0.56 }),
  Object.freeze({ directionX: 0.588, directionZ: 0.809, amplitude: 1.2, wavelength: 61, speed: 7.1, steepness: 0.48 }),
  Object.freeze({ directionX: -0.454, directionZ: 0.891, amplitude: 0.72, wavelength: 31, speed: 5.2, steepness: 0.44 }),
  Object.freeze({ directionX: 0.982, directionZ: -0.191, amplitude: 0.31, wavelength: 14.5, speed: 3.4, steepness: 0.36 }),
  Object.freeze({ directionX: -0.766, directionZ: -0.643, amplitude: 0.16, wavelength: 7.4, speed: 2.2, steepness: 0.3 }),
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
