/**
 * Sky, lighting rig, fog and time of day (LOOK-owned). Writes ctx.atmosphere every frame before other systems.
 * Stub: gradient dome, a sun that follows sea.timeOfDay, hemisphere + directional light, linear fog.
 */
import * as THREE from 'three';
import type { FrameContext, RenderHostHandles, RenderSystem } from '../frame';

const vertex = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;
const fragment = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor;
void main(){
  vec3 d = normalize(vDir);
  float h = max(0., d.y);
  vec3 c = mix(uHorizon, uZenith, pow(h, .55));
  float s = max(0., dot(d, normalize(uSunDir)));
  c += uSunColor * (smoothstep(.9985,.9992,s) * .9 + pow(s, 40.) * .18);
  gl_FragColor = vec4(c, 1.);
  #include <colorspace_fragment>
}`;

export class SkySystem implements RenderSystem {
  readonly name = 'sky';
  private scene!: THREE.Scene;
  private readonly hemi = new THREE.HemisphereLight(0xbfe6ff, 0x2a4f6a, 1.1);
  private readonly sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
  private readonly dome: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, side: THREE.BackSide, depthWrite: false,
      uniforms: { uZenith: { value: new THREE.Color(0x1a6fd0) }, uHorizon: { value: new THREE.Color(0xa9dbef) }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, uSunColor: { value: new THREE.Color(0xfff2cf) } },
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(2800, 32, 16), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
  }

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -160; cam.right = cam.top = 160; cam.near = 1; cam.far = 700;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.dome);
    this.scene.fog = new THREE.Fog(0xa9dbef, 400, 2400);
  }

  update(ctx: FrameContext): void {
    const a = ctx.atmosphere;
    const hour = ctx.sea.timeOfDay;
    const elevation = Math.sin(((hour - 6) / 12) * Math.PI); // 1 at noon, <0 at night
    const azimuth = ((hour - 6) / 12) * Math.PI;
    const night = THREE.MathUtils.clamp(-elevation * 3 + 0.2, 0, 1);
    a.night = night;
    a.storm = ctx.sea.rain;
    a.sunDirection.set(Math.cos(azimuth) * 0.6, Math.max(0.12, elevation), Math.sin(azimuth) * 0.4 + 0.3).normalize();
    a.sunColor.setRGB(1, 0.9 - (1 - elevation) * 0.25, 0.78 - (1 - elevation) * 0.4).lerp(new THREE.Color(0x9fb8ff), night);
    a.sunIntensity = THREE.MathUtils.lerp(2.3, 0.35, night) * (1 - a.storm * 0.5);
    a.skyColor.setHex(0x1a6fd0).lerp(new THREE.Color(0x061633), night).lerp(new THREE.Color(0x35485c), a.storm * 0.8);
    a.horizonColor.setHex(0xa9dbef).lerp(new THREE.Color(0x2b4868), night).lerp(new THREE.Color(0x7d8f99), a.storm * 0.8);
    a.fogColor.copy(a.horizonColor);
    a.fogNear = THREE.MathUtils.lerp(420, 90, ctx.sea.fog);
    a.fogFar = THREE.MathUtils.lerp(2400, 700, Math.max(ctx.sea.fog, a.storm * 0.4));
    a.ambientColor.copy(a.skyColor).lerp(new THREE.Color(0xffffff), 0.35);
    a.flash = 0;

    const u = this.material.uniforms;
    (u.uZenith!.value as THREE.Color).copy(a.skyColor);
    (u.uHorizon!.value as THREE.Color).copy(a.horizonColor);
    (u.uSunDir!.value as THREE.Vector3).copy(a.sunDirection);
    (u.uSunColor!.value as THREE.Color).copy(a.sunColor);
    this.dome.position.set(ctx.focus.x, 0, ctx.focus.z);
    this.hemi.color.copy(a.skyColor).lerp(new THREE.Color(0xffffff), 0.5);
    this.hemi.intensity = THREE.MathUtils.lerp(1.2, 0.45, night);
    this.sun.color.copy(a.sunColor);
    this.sun.intensity = a.sunIntensity;
    this.sun.position.set(ctx.focus.x, 0, ctx.focus.z).addScaledVector(a.sunDirection, 400);
    this.sun.target.position.set(ctx.focus.x, 0, ctx.focus.z);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(a.fogColor); fog.near = a.fogNear; fog.far = a.fogFar;
  }

  dispose(): void {
    this.dome.geometry.dispose(); this.material.dispose();
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.dome);
  }
}
