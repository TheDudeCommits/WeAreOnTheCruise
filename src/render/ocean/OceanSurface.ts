/**
 * Camera-projected ocean surface (OCEAN-owned): geometry, material and uniforms.
 *
 * The geometry is a fixed grid in NDC (with overscan) that the vertex shader projects onto the water plane every
 * draw, using the camera passed to onBeforeRender. The mesh therefore follows the camera (not the ship), keeps
 * uniform on-screen density and never snaps. The grid footprint it implies (uGridAngle * d^2 / h) is recorded
 * for the main camera so OceanServices.heightAt/normalAt can filter the waves exactly like the vertex shader.
 */
import * as THREE from 'three';
import type { QualityTier } from '../frame';
import { DEFAULT_GERSTNER_WAVES, GERSTNER_WAVE_COUNT, prepareGerstnerWaves } from '../../core/waves';
import type { InteractionField } from './InteractionField';
import type { OceanLook } from './OceanLook';
import type { OceanTextureSet } from './OceanTextures';
import type { ShoreField } from './ShoreField';
import { OCEAN_FRAGMENT, OCEAN_VERTEX } from './surfaceShaders';

/**
 * Grid cells in NDC. ~7-8 px cells at 1600-2400 px wide keep ~1 m spacing near the ship while avoiding the
 * quad over-shading that ~5 px triangles cause (fragment cost dominates the ocean).
 */
const GRID: Record<QualityTier, [number, number]> = {
  low: [200, 124],
  medium: [260, 160],
  high: [330, 204],
  ultra: [430, 264],
};
const NDC_X: [number, number] = [-1.25, 1.25];
const NDC_Y: [number, number] = [-1.42, 1.25];

/** Detail texture tiles (metres) and scroll speeds (m/s along the wind). */
const TILE_A = 88;
const TILE_B = 23;
const SPEED_A = 1.9;
const SPEED_B = 1.15;
const FOAM_E_TILE = 26;
const FOAM_L_TILE_U = 34;
const FOAM_L_TILE_V = 12;
const CLOUD_TILE = 230;
const TAU = Math.PI * 2;

const fract = (x: number): number => x - Math.floor(x);

function buildGrid(cols: number, rows: number): THREE.BufferGeometry {
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  let p = 0;
  for (let j = 0; j <= rows; j++) {
    const y = NDC_Y[0] + (NDC_Y[1] - NDC_Y[0]) * (j / rows);
    for (let i = 0; i <= cols; i++) {
      positions[p++] = NDC_X[0] + (NDC_X[1] - NDC_X[0]) * (i / cols);
      positions[p++] = y;
      positions[p++] = 0;
    }
  }
  const indices = new Uint32Array(cols * rows * 6);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      indices[k++] = a; indices[k++] = b; indices[k++] = d;
      indices[k++] = a; indices[k++] = d; indices[k++] = c;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return geometry;
}

export class OceanSurface {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Main camera used for the CPU footprint (heightAt filtering). */
  mainCamera: THREE.Camera | null = null;
  camX = 0;
  camY = 100;
  camZ = 0;
  gridAngle = 0;
  hasCamera = false;
  private tier: QualityTier = 'high';
  private readonly invViewProj = new THREE.Matrix4();
  private readonly waveA: THREE.Vector4[];
  private readonly waveB: THREE.Vector4[];
  private originX = 0;
  private originZ = 0;

  constructor(textures: OceanTextureSet, field: InteractionField, shore: ShoreField) {
    const prepared = prepareGerstnerWaves(DEFAULT_GERSTNER_WAVES);
    this.waveA = Array.from({ length: GERSTNER_WAVE_COUNT }, (_, i) => new THREE.Vector4(prepared.dirX[i], prepared.dirZ[i], prepared.k[i], prepared.wavelength[i]));
    this.waveB = Array.from({ length: GERSTNER_WAVE_COUNT }, () => new THREE.Vector4());
    this.uniforms = {
      uInvViewProj: { value: this.invViewProj },
      uFarDist: { value: 4500 },
      uGridAngle: { value: 0.004 },
      uOrigin: { value: new THREE.Vector2() },
      uWaveA: { value: this.waveA },
      uWaveB: { value: this.waveB },
      uAmpSum: { value: 1 },
      uCapNorm: { value: 0.2 },
      uTransient: { value: field.transientTexture },
      uPersist: { value: field.persistentTexture },
      uRtRect: { value: field.rect },
      uRtTexel: { value: 1 / field.resolution },
      uRtWorldTexel: { value: field.texel },
      uShore: { value: shore.texture },
      uShoreRect: { value: shore.rect },
      uShoreMax: { value: shore.maxDistance },
      uDetailA: { value: textures.detailA },
      uDetailB: { value: textures.detailB },
      uFoamTex: { value: textures.foam },
      uDetailOff: { value: new THREE.Vector4() },
      uDetailScale: { value: new THREE.Vector2(1 / TILE_A, 1 / TILE_B) },
      uFoamOff: { value: new THREE.Vector4() },
      uCloudOff: { value: new THREE.Vector2() },
      uWind: { value: new THREE.Vector4(0, 1, 0.5, 0.1) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uSunColor: { value: new THREE.Color() },
      uSky: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFog: { value: new THREE.Vector2(400, 2400) },
      uDeep: { value: new THREE.Color() },
      uMid: { value: new THREE.Color() },
      uSSS: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uFoamColor: { value: new THREE.Color() },
      uFoamShadow: { value: new THREE.Color() },
      uBiolum: { value: new THREE.Color() },
      uLookA: { value: new THREE.Vector4() },
      uLookB: { value: new THREE.Vector4() },
      uLookC: { value: new THREE.Vector4() },
      uTime: { value: 0 },
      uShoreActive: { value: 0 },
      uDebug: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'StylizedOcean',
      vertexShader: OCEAN_VERTEX,
      fragmentShader: OCEAN_FRAGMENT,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
      depthWrite: true,
      depthTest: true,
      defines: { OCEAN_PROFILE: 0 },
    });
    this.mesh = new THREE.Mesh(buildGrid(...GRID.high), this.material);
    this.mesh.name = 'ocean-surface';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Drawn after the other opaque objects so early-z skips water hidden behind hulls and islands.
    this.mesh.renderOrder = 10;
    this.mesh.userData.oceanProjectedGrid = true;
    this.mesh.onBeforeRender = (_renderer, _scene, camera) => this.syncCamera(camera);
  }

  /** Debug: compile-time shader variants for cost profiling (0 = full, 1 = flat colour). */
  setProfile(mode: number): void {
    this.material.defines.OCEAN_PROFILE = mode;
    this.material.needsUpdate = true;
  }

  setQuality(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    const old = this.mesh.geometry;
    this.mesh.geometry = buildGrid(...GRID[tier]);
    old.dispose();
  }

  /** Same as the onBeforeRender hook (used when the hook is re-wrapped for debugging). */
  syncCameraPublic(camera: THREE.Camera): void { this.syncCamera(camera); }

  private syncCamera(camera: THREE.Camera): void {
    this.invViewProj.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    const [cols, rows] = GRID[this.tier];
    let angle = 0.004;
    let far = 4500;
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const cam = camera as THREE.PerspectiveCamera;
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5) / cam.zoom;
      const rowAngle = tanHalf * ((NDC_Y[1] - NDC_Y[0]) / rows);
      const colAngle = tanHalf * cam.aspect * ((NDC_X[1] - NDC_X[0]) / cols);
      angle = Math.max(rowAngle, colAngle);
      far = cam.far * 0.92;
    }
    this.uniforms.uGridAngle!.value = angle;
    this.uniforms.uFarDist!.value = far;
    if (camera === this.mainCamera || this.mainCamera === null) {
      const e = camera.matrixWorld.elements;
      this.camX = e[12]!;
      this.camY = e[13]!;
      this.camZ = e[14]!;
      this.gridAngle = angle;
      this.hasCamera = true;
    }
  }

  /** Grid footprint (metres) at world (x, z) for the last main-camera draw; 0 before the first draw. */
  footprintAt(x: number, z: number): number {
    if (!this.hasCamera) return 0;
    const dx = x - this.camX;
    const dz = z - this.camZ;
    const h = Math.max(this.camY, 1);
    return (this.gridAngle * (dx * dx + h * h + dz * dz)) / h;
  }

  /**
   * Per-frame uniforms. `originX/Z` anchor phases and texture offsets near the camera (float precision for
   * long runs); every CPU-side offset is computed in double precision and wrapped.
   */
  update(time: number, waveStrength: number, look: OceanLook, field: InteractionField, shore: ShoreField, originX: number, originZ: number): void {
    const u = this.uniforms;
    this.originX = Math.floor(originX / 256) * 256;
    this.originZ = Math.floor(originZ / 256) * 256;
    const ox = this.originX;
    const oz = this.originZ;
    (u.uOrigin!.value as THREE.Vector2).set(ox, oz);

    const p = prepareGerstnerWaves(DEFAULT_GERSTNER_WAVES);
    let ampSum = 0;
    let capNorm = 0;
    for (let i = 0; i < GERSTNER_WAVE_COUNT; i++) {
      const amplitude = p.amplitude[i]! * waveStrength;
      capNorm += p.steepness[i]! * p.k[i]! * amplitude;
      const phase = p.k[i]! * (p.dirX[i]! * ox + p.dirZ[i]! * oz) - p.omega[i]! * time;
      this.waveB[i]!.set(amplitude, amplitude * p.steepness[i]!, phase - Math.floor(phase / TAU) * TAU, 0);
      ampSum += amplitude;
    }
    u.uAmpSum!.value = ampSum;
    u.uCapNorm!.value = capNorm;

    // Textures and interaction/shore state.
    u.uTransient!.value = field.transientTexture;
    u.uPersist!.value = field.persistentTexture;
    u.uRtTexel!.value = 1 / field.resolution;
    u.uRtWorldTexel!.value = field.texel;

    // Wind frame offsets (texture space), double precision then wrapped.
    const wd = look.windDir;
    const originU = ox * wd.x + oz * wd.y;
    const originV = -ox * wd.y + oz * wd.x;
    const scrollA = time * SPEED_A * (0.6 + 0.6 * look.windStrength);
    const scrollB = time * SPEED_B * (0.6 + 0.6 * look.windStrength);
    // Layer B samples a frame rotated by ~20 degrees (0.94, 0.34).
    const bU = originU * 0.94 + originV * 0.34;
    const bV = -originU * 0.34 + originV * 0.94;
    (u.uDetailOff!.value as THREE.Vector4).set(
      fract((originU + scrollA) / TILE_A), fract(originV / TILE_A + 0.37),
      fract((bU + scrollB) / TILE_B), fract(bV / TILE_B + 0.61),
    );
    (u.uFoamOff!.value as THREE.Vector4).set(
      fract(ox / FOAM_E_TILE), fract(oz / FOAM_E_TILE),
      fract(originU / FOAM_L_TILE_U), fract(originV / FOAM_L_TILE_V),
    );
    const drift = time * (2 + 5 * look.windStrength);
    (u.uCloudOff!.value as THREE.Vector2).set(fract((ox + wd.x * drift) / CLOUD_TILE), fract((oz + wd.y * drift) / CLOUD_TILE));
    (u.uWind!.value as THREE.Vector4).set(wd.x, wd.y, look.windStrength, look.streak);

    (u.uSunDir!.value as THREE.Vector3).copy(look.sunDir);
    (u.uSunColor!.value as THREE.Color).copy(look.sunColor);
    (u.uSky!.value as THREE.Color).copy(look.sky);
    (u.uHorizon!.value as THREE.Color).copy(look.horizon);
    (u.uFogColor!.value as THREE.Color).copy(look.fogColor);
    (u.uFog!.value as THREE.Vector2).set(look.fogNear, look.fogFar);
    (u.uDeep!.value as THREE.Color).copy(look.deep);
    (u.uMid!.value as THREE.Color).copy(look.mid);
    (u.uSSS!.value as THREE.Color).copy(look.sss);
    (u.uShallow!.value as THREE.Color).copy(look.shallow);
    (u.uFoamColor!.value as THREE.Color).copy(look.foam);
    (u.uFoamShadow!.value as THREE.Color).copy(look.foamShadow);
    (u.uBiolum!.value as THREE.Color).copy(look.biolum);
    (u.uLookA!.value as THREE.Vector4).set(look.glint, look.sheen, look.specPower, look.detail);
    (u.uLookB!.value as THREE.Vector4).set(look.capLo, look.capHi, look.reflectivity, look.sssStrength);
    const sunLevel = Math.min(1.2, Math.max(0.15, look.sunIntensity / 2.2));
    (u.uLookC!.value as THREE.Vector4).set(look.cloudPatch, look.night, look.flash, sunLevel);
    u.uTime!.value = time % 3600;
    u.uShoreMax!.value = shore.maxDistance;
    u.uShoreActive!.value = shore.active ? 1 : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
