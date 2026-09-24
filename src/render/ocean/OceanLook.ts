/**
 * Ocean look (OCEAN-owned): turns ctx.atmosphere + ctx.sea into the palette and style scalars the water shader
 * uses. Allocation-free; everything is recomputed each frame (the sky and the sim already blend smoothly).
 *
 * Palettes follow the "Grand Line Cel" water rules: deep cobalt → turquoise by view angle, teal shallows,
 * cyan back-lit crests, white foam with a blue-grey shadow edge. Night = dark indigo with silver moon glints and
 * a bioluminescent wake; storm = dark teal with whitecaps and wind streaks; fog = pale, low contrast.
 */
import * as THREE from 'three';
import type { SeaState } from '../../game/types';
import type { AtmosphereState } from '../frame';

interface Palette {
  deep: THREE.Color;
  mid: THREE.Color;
  sss: THREE.Color;
  shallow: THREE.Color;
  foam: THREE.Color;
  foamShadow: THREE.Color;
}

function palette(deep: number, mid: number, sss: number, shallow: number, foam: number, foamShadow: number): Palette {
  return {
    deep: new THREE.Color(deep), mid: new THREE.Color(mid), sss: new THREE.Color(sss),
    shallow: new THREE.Color(shallow), foam: new THREE.Color(foam), foamShadow: new THREE.Color(foamShadow),
  };
}

const DAY = palette(0x0a3a8c, 0x1a6cc0, 0x2ee6d6, 0x39d2c2, 0xffffff, 0x8fb6dc);
const DUSK = palette(0x14306c, 0x2d5c9c, 0x4fe0c8, 0x3cb9b0, 0xfff4e6, 0x8f98c8);
const STORM = palette(0x0d2a31, 0x2a5559, 0x5ab5a6, 0x3e8a82, 0xe4efec, 0x7d9c9f);
const FOG = palette(0x2c6680, 0x5a8ea2, 0x93d1cc, 0x7cc4bc, 0xf4fbfa, 0xa2bec4);
const NIGHT = palette(0x030a22, 0x09214b, 0x1a8cb8, 0x0c4f63, 0x9ebde4, 0x30507a);
const BIOLUM = new THREE.Color(0x27f0ff);

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export class OceanLook {
  readonly deep = new THREE.Color();
  readonly mid = new THREE.Color();
  readonly sss = new THREE.Color();
  readonly shallow = new THREE.Color();
  readonly foam = new THREE.Color();
  readonly foamShadow = new THREE.Color();
  readonly biolum = new THREE.Color();
  readonly sky = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly fogColor = new THREE.Color();
  readonly sunColor = new THREE.Color();
  readonly sunDir = new THREE.Vector3(0.4, 0.8, 0.3);
  readonly windDir = new THREE.Vector2(0, 1);
  sunIntensity = 1;
  fogNear = 400;
  fogFar = 2400;
  glint = 6;
  sheen = 0.3;
  specPower = 900;
  capLo = 0.6;
  capHi = 0.85;
  streak = 0.1;
  detail = 1;
  reflectivity = 1;
  sssStrength = 1;
  cloudPatch = 0.18;
  night = 0;
  storm = 0;
  fog = 0;
  flash = 0;
  windStrength = 0.5;
  waveScale = 1;

  update(atmosphere: AtmosphereState, sea: Readonly<SeaState>): void {
    const night = Math.min(1, Math.max(0, atmosphere.night));
    const storm = Math.min(1, Math.max(0, Math.max(atmosphere.storm, sea.rain)));
    const fog = Math.min(1, Math.max(0, sea.fog));
    const breezy = (sea.weather === 'breezy' ? 1 - sea.blend : 0) + (sea.nextWeather === 'breezy' ? sea.blend : 0);
    const sunElevation = atmosphere.sunDirection.y;
    const dusk = smooth(0.42, 0.06, sunElevation) * (1 - night);
    this.night = night;
    this.storm = storm;
    this.fog = fog;
    this.flash = atmosphere.flash;
    this.waveScale = sea.waveScale;
    this.windStrength = sea.windStrength;
    this.windDir.set(Math.sin(sea.windDir), Math.cos(sea.windDir));

    this.blendPalette(dusk, storm, fog, night);
    this.biolum.copy(BIOLUM).multiplyScalar(night * (1 - fog * 0.5));

    this.sky.copy(atmosphere.skyColor);
    this.horizon.copy(atmosphere.horizonColor);
    this.fogColor.copy(atmosphere.fogColor);
    this.fogNear = atmosphere.fogNear;
    this.fogFar = Math.max(atmosphere.fogNear + 1, atmosphere.fogFar);
    this.sunDir.copy(atmosphere.sunDirection).normalize();
    this.sunColor.copy(atmosphere.sunColor);
    this.sunIntensity = atmosphere.sunIntensity;

    const clear = 1 - Math.max(storm, fog);
    this.glint = lerp(lerp(6.5, 5.0, dusk), 3.2, night) * lerp(1, 0.12, storm) * lerp(1, 0.2, fog);
    this.sheen = lerp(lerp(0.32, 0.45, dusk), 0.85, night) * lerp(1, 0.25, storm) * lerp(1, 0.3, fog);
    this.specPower = lerp(lerp(1100, 700, dusk), 260, night);
    this.capLo = lerp(lerp(0.62, 0.5, breezy), 0.28, storm) + fog * 0.08;
    this.capHi = this.capLo + lerp(0.24, 0.3, storm);
    this.streak = Math.max(0.12, breezy * 0.35, storm);
    this.detail = lerp(1, 1.25, breezy) * lerp(1, 1.45, storm) * lerp(1, 0.55, fog);
    this.reflectivity = lerp(1, 0.85, storm) * lerp(1, 0.65, fog);
    this.sssStrength = lerp(lerp(1, 1.25, dusk), 0.45, night) * lerp(1, 0.55, storm) * lerp(1, 0.35, fog) * (0.6 + 0.4 * clear);
    this.cloudPatch = lerp(0.16, 0.3, storm) * (1 - fog * 0.7);
  }

  private blendPalette(dusk: number, storm: number, fog: number, night: number): void {
    const keys = ['deep', 'mid', 'sss', 'shallow', 'foam', 'foamShadow'] as const;
    for (const key of keys) {
      const c = this[key];
      c.copy(DAY[key]).lerp(DUSK[key], dusk).lerp(FOG[key], fog).lerp(STORM[key], storm);
      // Night keeps a little of the storm/fog character.
      c.lerp(NIGHT[key], night * (1 - 0.25 * Math.max(storm, fog)));
    }
  }
}
