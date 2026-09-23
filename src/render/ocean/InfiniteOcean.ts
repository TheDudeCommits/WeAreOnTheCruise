import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type ColorRepresentation,
} from 'three';
import type { Vec3, WeatherKind, WorldCollisionFeature } from '../../core/contracts';
import {
  DEFAULT_GERSTNER_WAVES,
  GERSTNER_GLSL,
  sampleGerstnerWaves,
  type WaveSample,
} from '../../core/waves';
import { atmosphereFor } from '../world/Atmosphere';

export interface OceanFrame {
  time: number;
  focus: Vec3;
  weather?: WeatherKind;
  windDirection?: number;
  windStrength?: number;
  currentDirection?: number;
  currentStrength?: number;
  shores?: readonly WorldCollisionFeature[];
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
uniform vec3 uShores[32];
uniform int uShoreCount;
uniform float uFogFar;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vHeight;
varying float vCrest;
float hash(vec2 p) { p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p) { vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y); }
void main() {
  vec2 p = vWorldPosition.xz;
  vec2 flow=p+uCurrentVector*uTime*(0.8+uCurrentStrength*2.0);
  float n = noise(flow*.075 + vec2(uTime*.06,-uTime*.05));
  float fine = noise(flow*.29 + vec2(-uTime*.13,uTime*.1));
  float micro=noise(flow*.87+vec2(uTime*.18,-uTime*.11));
  vec3 normal = normalize(vWorldNormal + vec3((n-.5)*.17+(micro-.5)*.055,0.,(fine-.5)*.13));
  vec3 V=normalize(cameraPosition-vWorldPosition);
  vec3 L=normalize(vec3(-.45,.82,.35));
  float facing=dot(normal,L);
  float h=vHeight/max(0.75,4.7*uWaveStrength);
  float band=smoothstep(.61,.91,facing+h*.28);
  vec3 color=mix(uDeepColor,uMidColor,band*.77+.1);
  color=mix(color,uCrestColor,smoothstep(.89,1.05,facing+h*.24)*.64);
  // Broken painted strokes follow the wave faces at several scales.
  float brush=smoothstep(.44,.59,fine*.62+micro*.38);
  color=mix(color,uCrestColor,brush*smoothstep(.62,.96,facing+h*.2)*.12);
  // Long connected ridge ribbons, carried by the same wave field as the hull.
  float ridge=vCrest+h*.18+(n-.5)*.13;
  // Cap the solid crest and break its fringe at sub-metre scales. A single
  // low-frequency mask made foreground breakers read as white islands.
  float crestBand=smoothstep(uFoamThreshold-.025,uFoamThreshold+.065,ridge);
  float froth=noise(flow*1.9+vec2(uTime*.28,-uTime*.21));
  float foam=crestBand*smoothstep(.50,.76,n+fine*.22);
  foam*=smoothstep(.44,.68,micro*.48+froth*.52);
  vec2 streakUv=vec2(flow.x*.5+flow.y*.14,flow.y*.95)+vec2(uTime*.12,-uTime*.16);
  float lace=1.-smoothstep(.018,.046,abs(noise(streakUv+vec2(n*2.,fine))-.51));
  float laceMask=smoothstep(.53,.79,ridge+fine*.13)*smoothstep(.4,.64,micro);
  foam=max(foam,lace*laceMask*.62);
  float fresnel=pow(1.0-max(0.0,dot(normal,V)),3.0);
  color=mix(color,uHorizonColor,fresnel*.21);
  float spec=pow(max(0.0,dot(normal,normalize(L+V))),105.0);
  float glint=smoothstep(.30,.72,spec)*(0.35+fine*.65)*uSparkleStrength;
  color=mix(color,uFoamColor,glint*.8);
  float shoreDistance=10000.;
  for(int i=0;i<32;i++) { if(i>=uShoreCount) break; shoreDistance=min(shoreDistance,length(p-uShores[i].xy)-uShores[i].z); }
  float shallows=(1.-smoothstep(0.,45.,shoreDistance))*.46;
  color=mix(color,uCrestColor,shallows);
  float surf=(1.-smoothstep(2.,7.,abs(shoreDistance-3.5-n*3.0))) * smoothstep(.24,.62,n+sin(uTime*1.8+shoreDistance*.5)*.16);
  color=mix(color,uFoamColor,max(foam*.88,surf*.8));
  float fog=smoothstep(650.,uFogFar,distance(cameraPosition.xz,p));
  color=mix(color,uHorizonColor,fog*.92);
  gl_FragColor=vec4(color,1.0);
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
  private weather?: WeatherKind;
  private shoreReference?: readonly WorldCollisionFeature[];

  constructor(palette: Partial<OceanPalette> = {}) {
    const colors = { ...DEFAULT_PALETTE, ...palette };
    this.material = new ShaderMaterial({
      name: 'FiveWaveCelOcean',
      vertexShader: oceanVertexShader,
      fragmentShader: oceanFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uShores: { value: Array.from({ length: 32 }, () => new Vector3(0, 0, 0)) },
        uShoreCount: { value: 0 },
        uFogFar: { value: 2550 },
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

    this.nearGeometry = createPolarGridGeometry(0, 720, 180, 512);
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
    if (frame.shores !== this.shoreReference) {
      this.shoreReference = frame.shores;
      const shores = [...(frame.shores ?? [])].filter(f=>f.kind!=='reef').sort((a,b)=>Math.hypot(a.x-frame.focus.x,a.z-frame.focus.z)-Math.hypot(b.x-frame.focus.x,b.z-frame.focus.z)).slice(0,32);
      this.material.uniforms.uShoreCount!.value=shores.length;
      shores.forEach((s,i)=>(this.material.uniforms.uShores!.value as Vector3[])[i].set(s.x,s.z,s.radius));
    }
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
    if (weather === this.weather) return;
    this.weather = weather;
    const palette=atmosphereFor(weather);
    for(const [uniform,key] of [['uDeepColor','deep'],['uMidColor','mid'],['uCrestColor','crest'],['uFoamColor','foam'],['uHorizonColor','horizon']] as const) (this.material.uniforms[uniform]!.value as Color).setHex(palette[key]);
    this.material.uniforms.uFogFar!.value=palette.fogFar;
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
  const ringCount = innerRadius === 0 ? radialSegments : radialSegments + 1;

  if (innerRadius === 0) positions.push(0, 0, 0);
  for (let ring = 0; ring < ringCount; ring += 1) {
    const normalized = innerRadius === 0 ? (ring + 1) / radialSegments : ring / radialSegments;
    const radius = innerRadius === 0 ? outerRadius * Math.pow((ring+1)/radialSegments,1.6) : innerRadius + (outerRadius - innerRadius) * normalized;
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
