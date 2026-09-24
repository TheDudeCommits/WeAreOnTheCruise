/**
 * Ocean lab: a fake sky system. Drives AtmosphereState + SeaState from a time of day and a weather preset so
 * the ocean can be judged without the LOOK agent's sky. Not used by the game.
 */
import * as THREE from 'three';
import type { WeatherId } from '../../../game/ids';
import type { SeaState } from '../../../game/types';
import type { AtmosphereState } from '../../frame';

export function createAtmosphere(): AtmosphereState {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.3), sunColor: new THREE.Color(0xfff2cf), sunIntensity: 2,
    ambientColor: new THREE.Color(0xbfdcff), skyColor: new THREE.Color(0x1a6fd0), horizonColor: new THREE.Color(0xa9dbef),
    fogColor: new THREE.Color(0xa9dbef), fogNear: 450, fogFar: 2600, night: 0, storm: 0, flash: 0,
  };
}

export function createSea(): SeaState {
  return {
    weather: 'clear', nextWeather: 'clear', blend: 1, waveScale: 0.8, windDir: 0.6, windStrength: 0.45,
    timeOfDay: 10, fog: 0, rain: 0, lightningSerial: 0,
  };
}

export const WEATHER_PRESETS: Record<WeatherId, { waveScale: number; wind: number; fog: number; rain: number }> = {
  clear: { waveScale: 0.8, wind: 0.45, fog: 0, rain: 0 },
  breezy: { waveScale: 1.1, wind: 0.7, fog: 0, rain: 0 },
  storm: { waveScale: 1.7, wind: 1, fog: 0, rain: 1 },
  fog: { waveScale: 0.7, wind: 0.25, fog: 1, rain: 0 },
};

const C = (hex: number) => new THREE.Color(hex);
const ZENITH = { day: C(0x2a76d2), dusk: C(0x4b5fa6), night: C(0x040b24), storm: C(0x2c3b45), fog: C(0xa3b6bc) };
const HORIZON = { day: C(0xaadcf0), dusk: C(0xf3a877), night: C(0x17314f), storm: C(0x6a7d86), fog: C(0xb7c8cb) };
const SUN = { day: C(0xfff2d6), dusk: C(0xffa25a), moon: C(0xa9c0ff) };
const tmp = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);
const sun = new THREE.Vector3();
const moon = new THREE.Vector3(-0.45, 0.42, -0.62).normalize();
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Writes atmosphere for an hour (0–24) and the sea's weather mix. Lightning flashes are random in storms. */
export function applyLabSky(a: AtmosphereState, sea: SeaState, hour: number, time: number): void {
  const phase = ((hour - 6) / 12) * Math.PI;
  const elevation = Math.sin(phase);
  const night = Math.min(1, Math.max(0, -elevation * 3 + 0.2));
  const dusk = smooth(0.45, 0.04, elevation) * (1 - night);
  const storm = sea.rain;
  const fog = sea.fog;
  // Key light: sun by day, moon by night (moon rides opposite, fairly high).
  const sunX = Math.cos(phase) * 0.85;
  const sunZ = 0.45 + Math.sin(phase) * 0.25;
  sun.set(sunX, Math.max(0.05, elevation), sunZ).normalize();
  a.sunDirection.copy(sun).lerp(moon, night).normalize();
  a.night = night;
  a.storm = storm;
  a.sunColor.copy(SUN.day).lerp(SUN.dusk, dusk).lerp(SUN.moon, night);
  a.sunIntensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(2.3, 1.6, dusk), 0.5, night) * (1 - storm * 0.55) * (1 - fog * 0.35);
  a.skyColor.copy(ZENITH.day).lerp(ZENITH.dusk, dusk).lerp(ZENITH.storm, storm * 0.85).lerp(ZENITH.fog, fog * 0.9).lerp(ZENITH.night, night * (1 - fog * 0.3));
  a.horizonColor.copy(HORIZON.day).lerp(HORIZON.dusk, dusk).lerp(HORIZON.storm, storm * 0.85).lerp(HORIZON.fog, fog * 0.9);
  tmp.copy(HORIZON.night).lerp(HORIZON.fog, fog * 0.25);
  a.horizonColor.lerp(tmp, night);
  a.fogColor.copy(a.horizonColor);
  a.fogNear = THREE.MathUtils.lerp(THREE.MathUtils.lerp(450, 220, storm), 60, fog);
  a.fogFar = THREE.MathUtils.lerp(THREE.MathUtils.lerp(2600, 1500, storm), 650, fog);
  a.ambientColor.copy(a.skyColor).lerp(WHITE, 0.35);
  // Random lightning in storms (a quick double flicker).
  const bolt = storm > 0.5 ? Math.max(0, Math.sin(time * 0.61) * Math.sin(time * 1.37) - 0.93) * 14 : 0;
  a.flash = Math.min(1, bolt * (0.6 + 0.4 * Math.sin(time * 40)));
  sea.timeOfDay = hour;
}

const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight; uniform float uFlash;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(0.0, d.y);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
  float s = max(0.0, dot(d, normalize(uSunDir)));
  float disc = smoothstep(0.9990, 0.9994, s);
  c += uSunColor * (disc * mix(6.0, 2.0, uNight) + pow(s, 60.0) * 0.25 * (1.0 - uNight * 0.5) + pow(s, 8.0) * 0.08);
  float star = step(0.9985, hash(floor(d * 400.0))) * uNight * smoothstep(0.05, 0.3, d.y);
  c += vec3(star * 1.5);
  c += vec3(0.8, 0.85, 1.0) * uFlash * 0.8;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class LabSky {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
        uSunColor: { value: new THREE.Color() }, uNight: { value: 0 }, uFlash: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }
  update(a: AtmosphereState, cameraPosition: THREE.Vector3): void {
    const u = this.material.uniforms;
    (u.uZenith!.value as THREE.Color).copy(a.skyColor);
    (u.uHorizon!.value as THREE.Color).copy(a.horizonColor);
    (u.uSunDir!.value as THREE.Vector3).copy(a.sunDirection);
    (u.uSunColor!.value as THREE.Color).copy(a.sunColor);
    u.uNight!.value = a.night;
    u.uFlash!.value = a.flash;
    this.mesh.position.copy(cameraPosition);
  }
}
