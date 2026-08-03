import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
  type ColorRepresentation,
} from 'three';
import type { Vec3, WeatherKind } from '../../core/contracts';
import {
  DEFAULT_GERSTNER_WAVES,
  GERSTNER_GLSL,
  sampleGerstnerWaves,
  type WaveSample,
} from '../../core/waves';

export interface OceanFrame {
  time: number;
  focus: Vec3;
  weather?: WeatherKind;
  windDirection?: number;
  windStrength?: number;
  currentDirection?: number;
  currentStrength?: number;
}

export interface OceanPalette {
  deep: ColorRepresentation;
  mid: ColorRepresentation;
  crest: ColorRepresentation;
  foam: ColorRepresentation;
  horizon: ColorRepresentation;
}

const DEFAULT_PALETTE: OceanPalette = {
  deep: 0x087797,
  mid: 0x089cad,
  crest: 0x35c8c4,
  foam: 0xfff7d6,
  horizon: 0x75c9dc,
};

const oceanVertexShader = /* glsl */ `
${GERSTNER_GLSL}

uniform float uTime;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vCrest;

void main() {
  vec3 baseWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 displaced;
  vec3 surfaceNormal;
  float crestSignal;
  sampleGerstnerWaves(baseWorld.xz, uTime, displaced, surfaceNormal, crestSignal);
  vWorldPosition = displaced;
  vWorldNormal = surfaceNormal;
  vHeight = displaced.y;
  vCrest = crestSignal;
  gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
}
`;

const oceanFragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uWaveStrength;
uniform float uFoamThreshold;
uniform float uSparkleStrength;
uniform vec2 uWindVector;
uniform vec2 uCurrentVector;
uniform float uWindStrength;
uniform float uCurrentStrength;
uniform vec3 uDeepColor;
uniform vec3 uMidColor;
uniform vec3 uCrestColor;
uniform vec3 uFoamColor;
uniform vec3 uHorizonColor;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vCrest;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

mat2 directionBasis(vec2 direction) {
  vec2 along = normalize(direction + vec2(0.0001));
  return mat2(along.x, -along.y, along.y, along.x);
}

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 lightDirection = normalize(vec3(-0.42, 0.84, 0.34));
  float light = dot(normal, lightDirection) * 0.5 + 0.5;
  float normalizedHeight = vHeight / max(0.75, 4.7 * uWaveStrength);

  vec3 waterColor = uDeepColor;
  if (normalizedHeight > -0.12 || light > 0.62) waterColor = uMidColor;
  if (normalizedHeight > 0.42 || light > 0.82) waterColor = uCrestColor;

  float foamNoise = hash21(floor(vWorldPosition.xz * 0.22 + uTime * vec2(0.7, -0.45)));
  float foam = step(uFoamThreshold, vCrest + normalizedHeight * 0.23);
  foam *= step(0.92, foamNoise);

  vec2 currentSpace = directionBasis(uCurrentVector) * vWorldPosition.xz;
  float lane = step(0.91, sin(currentSpace.y * 0.105 + sin(currentSpace.x * 0.016)));
  float arrowPulse = step(0.72, sin(currentSpace.x * 0.09 - uTime * (1.2 + uCurrentStrength * 2.0)));
  float currentMark = lane * arrowPulse * smoothstep(0.08, 0.7, uCurrentStrength);

  vec2 windSpace = directionBasis(uWindVector) * vWorldPosition.xz;
  float windStreak = step(0.965, sin(windSpace.y * 0.045 + sin(windSpace.x * 0.006)));
  windStreak *= step(0.58, sin(windSpace.x * 0.055 - uTime * (1.8 + uWindStrength * 2.6)));
  windStreak *= smoothstep(0.22, 0.9, uWindStrength);

  float fresnel = pow(1.0 - max(0.0, dot(normal, viewDirection)), 2.0);
  waterColor = mix(waterColor, uHorizonColor, step(0.62, fresnel) * 0.25);
  waterColor = mix(waterColor, uCrestColor, currentMark * 0.10);
  waterColor = mix(waterColor, uFoamColor, windStreak * 0.07);

  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float sparkleFacing = step(0.945, dot(normal, halfDirection));
  float sparkleNoise = step(0.985, hash21(floor(vWorldPosition.xz * 0.38) + floor(uTime * 7.0)));
  float sparkle = sparkleFacing * sparkleNoise * uSparkleStrength;
  waterColor = mix(waterColor, uFoamColor, sparkle);
  waterColor = mix(waterColor, uFoamColor, foam * 0.72);

  float fog = clamp((distance(cameraPosition.xz, vWorldPosition.xz) - 820.0) / 1800.0, 0.0, 1.0);
  fog = floor(fog * 5.0) * 0.2;
  waterColor = mix(waterColor, uHorizonColor, fog * 0.86);
  gl_FragColor = vec4(waterColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class InfiniteOcean {
  readonly group = new Group();
  readonly material: ShaderMaterial;

  private readonly nearGeometry: BufferGeometry;
  private readonly farGeometry: BufferGeometry;
  private waveStrength = 1;

  constructor(palette: Partial<OceanPalette> = {}) {
    const colors = { ...DEFAULT_PALETTE, ...palette };
    this.material = new ShaderMaterial({
      name: 'FiveWaveCelOcean',
      vertexShader: oceanVertexShader,
      fragmentShader: oceanFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWaveStrength: { value: 1 },
        uWaveDirection: { value: DEFAULT_GERSTNER_WAVES.map((wave) => new Vector2(wave.directionX, wave.directionZ)) },
        uWaveAmplitude: { value: DEFAULT_GERSTNER_WAVES.map((wave) => wave.amplitude) },
        uWaveLength: { value: DEFAULT_GERSTNER_WAVES.map((wave) => wave.wavelength) },
        uWaveSpeed: { value: DEFAULT_GERSTNER_WAVES.map((wave) => wave.speed) },
        uWaveSteepness: { value: DEFAULT_GERSTNER_WAVES.map((wave) => wave.steepness) },
        uFoamThreshold: { value: 0.67 },
        uSparkleStrength: { value: 0.78 },
        uWindVector: { value: new Vector2(0, 1) },
        uCurrentVector: { value: new Vector2(0, 1) },
        uWindStrength: { value: 0.6 },
        uCurrentStrength: { value: 0.2 },
        uDeepColor: { value: new Color(colors.deep) },
        uMidColor: { value: new Color(colors.mid) },
        uCrestColor: { value: new Color(colors.crest) },
        uFoamColor: { value: new Color(colors.foam) },
        uHorizonColor: { value: new Color(colors.horizon) },
      },
      depthWrite: true,
      side: DoubleSide,
    });

    this.nearGeometry = createPolarGridGeometry(0, 720, 112, 288);
    this.farGeometry = createPolarGridGeometry(720, 3_100, 34, 144);
    const nearMesh = new Mesh(this.nearGeometry, this.material);
    const farMesh = new Mesh(this.farGeometry, this.material);
    nearMesh.frustumCulled = false;
    farMesh.frustumCulled = false;
    nearMesh.renderOrder = -20;
    farMesh.renderOrder = -21;
    this.group.name = 'InfiniteCelOcean';
    this.group.add(farMesh, nearMesh);
  }

  update(frame: OceanFrame): void {
    this.material.uniforms.uTime!.value = frame.time;
    this.setWeather(frame.weather ?? 'calm');
    setDirection(this.material.uniforms.uWindVector!.value as Vector2, frame.windDirection ?? 0);
    setDirection(this.material.uniforms.uCurrentVector!.value as Vector2, frame.currentDirection ?? 0);
    this.material.uniforms.uWindStrength!.value = frame.windStrength ?? 0.6;
    this.material.uniforms.uCurrentStrength!.value = frame.currentStrength ?? 0.2;
    const snap = 32;
    this.group.position.set(Math.round(frame.focus.x / snap) * snap, 0, Math.round(frame.focus.z / snap) * snap);
  }

  sample(x: number, z: number, time: number): WaveSample {
    return sampleGerstnerWaves(x, z, time, DEFAULT_GERSTNER_WAVES, this.waveStrength);
  }

  setWeather(weather: WeatherKind): void {
    const state = getSeaState(weather);
    this.waveStrength = state.strength;
    this.material.uniforms.uWaveStrength!.value = state.strength;
    this.material.uniforms.uFoamThreshold!.value = state.foamThreshold;
    this.material.uniforms.uSparkleStrength!.value = state.sparkle;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.nearGeometry.dispose();
    this.farGeometry.dispose();
    this.material.dispose();
  }
}

function setDirection(target: Vector2, angle: number): void {
  target.set(Math.sin(angle), Math.cos(angle));
}

function getSeaState(weather: WeatherKind): { strength: number; foamThreshold: number; sparkle: number } {
  switch (weather) {
    case 'swell': return { strength: 1.32, foamThreshold: 0.67, sparkle: 0.65 };
    case 'storm': return { strength: 1.75, foamThreshold: 0.58, sparkle: 0.18 };
    case 'fog': return { strength: 0.78, foamThreshold: 0.72, sparkle: 0.22 };
    case 'maelstrom': return { strength: 2.05, foamThreshold: 0.42, sparkle: 0.12 };
    case 'night': return { strength: 1.05, foamThreshold: 0.62, sparkle: 0.42 };
    case 'calm': return { strength: 0.82, foamThreshold: 0.76, sparkle: 0.92 };
  }
}

function createPolarGridGeometry(innerRadius: number, outerRadius: number, radialSegments: number, angularSegments: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const startRadius = innerRadius === 0 ? outerRadius / radialSegments : innerRadius;
  const ringCount = innerRadius === 0 ? radialSegments : radialSegments + 1;

  if (innerRadius === 0) positions.push(0, 0, 0);
  for (let ring = 0; ring < ringCount; ring += 1) {
    const normalized = innerRadius === 0 ? (ring + 1) / radialSegments : ring / radialSegments;
    const radius = innerRadius === 0 ? startRadius * (ring + 1) : innerRadius + (outerRadius - innerRadius) * normalized;
    for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
      const angle = angleIndex / angularSegments * Math.PI * 2;
      positions.push(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    }
  }

  const firstRingOffset = innerRadius === 0 ? 1 : 0;
  if (innerRadius === 0) {
    for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
      indices.push(0, firstRingOffset + (angleIndex + 1) % angularSegments, firstRingOffset + angleIndex);
    }
  }
  const connectedRings = innerRadius === 0 ? ringCount - 1 : ringCount - 1;
  for (let ring = 0; ring < connectedRings; ring += 1) {
    const currentOffset = firstRingOffset + ring * angularSegments;
    const nextOffset = currentOffset + angularSegments;
    for (let angleIndex = 0; angleIndex < angularSegments; angleIndex += 1) {
      const nextAngle = (angleIndex + 1) % angularSegments;
      const a = currentOffset + angleIndex;
      const b = currentOffset + nextAngle;
      const c = nextOffset + angleIndex;
      const d = nextOffset + nextAngle;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
