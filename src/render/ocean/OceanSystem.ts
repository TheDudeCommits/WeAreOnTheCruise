/**
 * Ocean render system (OCEAN-owned; the RenderSystem + OceanServices surface is contract).
 * Stub: wraps the legacy InfiniteOcean; stamps are no-ops until the interaction target exists.
 */
import * as THREE from 'three';
import { DEFAULT_GERSTNER_WAVES, sampleGerstnerWaves } from '../../core/waves';
import type { FrameContext, OceanServices, RenderHostHandles, RenderSystem } from '../frame';
import { InfiniteOcean, type WeatherKind } from './InfiniteOcean';

export class OceanSystem implements RenderSystem, OceanServices {
  readonly name = 'ocean';
  private readonly ocean = new InfiniteOcean();
  private time = 0;
  private strength = 1;

  init(host: RenderHostHandles): void { host.scene.add(this.ocean.group); }

  update(ctx: FrameContext): void {
    this.time = ctx.time;
    const weather: WeatherKind = ctx.atmosphere.night > 0.6 ? 'night' : ctx.sea.weather === 'storm' ? 'storm' : ctx.sea.weather === 'fog' ? 'fog' : ctx.sea.weather === 'breezy' ? 'swell' : 'calm';
    this.ocean.update({ time: ctx.time, focus: { x: ctx.focus.x, y: 0, z: ctx.focus.z }, weather, windDirection: ctx.sea.windDir, windStrength: ctx.sea.windStrength });
    this.strength = ctx.sea.waveScale;
    (this.ocean.material.uniforms.uWaveStrength!.value as number) = this.strength;
  }

  heightAt(x: number, z: number): number {
    return sampleGerstnerWaves(x, z, this.time, DEFAULT_GERSTNER_WAVES, this.strength).height;
  }

  normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    const n = sampleGerstnerWaves(x, z, this.time, DEFAULT_GERSTNER_WAVES, this.strength).normal;
    return out.set(n.x, n.y, n.z);
  }

  stampWake(): void {}
  stampRing(): void {}
  stampFoam(): void {}
  stampDisplace(): void {}

  dispose(): void { this.ocean.dispose(); }
}
