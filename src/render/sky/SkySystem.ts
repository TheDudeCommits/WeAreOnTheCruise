/**
 * Sky, lighting rig, fog and time of day (LOOK-owned). Writes ctx.atmosphere every frame before other systems.
 *
 * - Time of day from sea.timeOfDay (0–24): palette keyframes (palette.ts) for dawn, day, golden hour, dusk and night;
 *   a sun that rises east and sets late (golden hour keeps its elevation) and a moon that takes over as key light.
 * - Weather: storm (sea.rain) and fog (sea.fog) looks blended over the hour; rain streaks; lightning bolts and
 *   atmosphere.flash on sea.lightningSerial changes; cloud shadows drifting with the wind.
 * - Sky: camera-centred dome (gradient, HDR sun, crescent moon, stars, storm overcast) + cel cumulus cards at three
 *   parallax depths.
 * - Light: one key DirectionalLight whose shadow camera is fitted to the view footprint on the sea with texel
 *   snapping, a hemisphere fill for non-cel materials, a warm lantern pool around the focus at night.
 * - Publishes everything to ctx.atmosphere and to the shared atmosphere uniforms (materials/atmosphere.ts).
 */
import * as THREE from 'three';
import type { FrameContext, QualityTier, RenderHostHandles, RenderSystem } from '../frame';
import { atmosphereUniforms, ensureAtmosphereResources, installUnifiedFog } from '../materials/atmosphere';
import { qualityProfile, type QualityProfile } from '../app/quality';
import { CloudLayer } from './clouds';
import { SkyDome } from './dome';
import { LightningBolt } from './lightning';
import { FOG_LOOK, NIGHT_FOG_LOOK, STORM_LOOK, createLook, lerpLook, lookForHour, moonDirection, sunDirection } from './palette';
import { RainField } from './rain';

const UP = new THREE.Vector3(0, 1, 0);
/** Enemy albedo lift at full night: +0.3 EV. */
const NIGHT_LIFT = Math.pow(2, 0.3);
/** Shadow-fit probe points in NDC, x/y pairs (screen corners + a point above centre). */
const SHADOW_CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1, 0, 0.35] as const;

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const LANTERN_COLOR = new THREE.Color(0xffa860);
const GOLDEN_FILL = new THREE.Color().setRGB(1.0, 0.7, 0.42, THREE.LinearSRGBColorSpace);
/** Reach of the focus fill (m). */
export const HERO_FILL_DISTANCE = 60;
/** Peak dusk fill intensity (tuned with output/r2-sealight/hero-exposure.ts: hero ≥ 0.9 of noon over 17.6–19.9 h). */
const DUSK_FILL = 9.0;

/**
 * Warm fill light around the focus (the hero's own lanterns): golden while the sun sets (it keeps the hero near its
 * noon exposure through golden hour and dusk instead of sinking into a purple silhouette), lantern orange at night.
 * Writes the colour, returns the intensity.
 */
export function heroFill(hour: number, night: number, fog: number, out: THREE.Color): number {
  const h = ((hour % 24) + 24) % 24;
  // Rises through golden hour, peaks in blue hour (sun down, night not yet full), hands over to the night lantern.
  const dusk = h >= 12 ? smoothstep(17.0, 19.4, h) * (1 - smoothstep(20.0, 21.0, h)) : 0;
  const nightK = night * (1 - fog * 0.3);
  const duskK = dusk;
  out.copy(GOLDEN_FILL).lerp(LANTERN_COLOR, nightK / Math.max(1e-4, nightK + duskK));
  return Math.max(5.5 * nightK, DUSK_FILL * duskK);
}

/** 0 = day, 1 = full night, from the hour. */
export function nightAmount(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 12) return smoothstep(18.9, 20.4, h);
  return 1 - smoothstep(4.7, 6.3, h);
}

export class SkySystem implements RenderSystem {
  readonly name = 'sky';
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private readonly sun = new THREE.DirectionalLight(0xfff0d6, 2.5);
  private readonly hemi = new THREE.HemisphereLight(0xbfe6ff, 0x2a4f6a, 0.9);
  private readonly lantern = new THREE.PointLight(0xffa860, 0, 90, 1);
  private readonly dome = new SkyDome();
  private readonly clouds = new CloudLayer(40);
  private readonly rain = new RainField(5200);
  private readonly bolt = new LightningBolt();
  private readonly look = createLook();
  private readonly fog = new THREE.Fog(0xa9dbef, 340, 2700);
  private readonly sunDir = new THREE.Vector3();
  private readonly moonDir = new THREE.Vector3();
  private readonly keyDir = new THREE.Vector3(0.4, 0.8, 0.3);
  private readonly flashDir = new THREE.Vector3(1, 0.3, 0);
  // A camera (not a plain Object3D): lookAt must match the shadow camera's -Z convention.
  private readonly lightCam = new THREE.OrthographicCamera();
  private readonly lightView = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();
  private readonly footprint: THREE.Vector3[] = Array.from({ length: 10 }, () => new THREE.Vector3());
  private readonly rainOrigin = new THREE.Vector3();
  private readonly rainColor = new THREE.Color();
  private readonly tmpColor = new THREE.Color();
  private lastSerial = -1;
  private strikes = 0;
  private flash = 0;
  private flashTime = 0;
  private profile: QualityProfile = qualityProfile('high');
  private tier: QualityTier | null = null;
  /** Lab override: pinned hour (null = follow sea.timeOfDay). */
  hourOverride: number | null = null;

  /** World direction to the moon this frame (read-only; the camera lab frames shots with it). */
  get moonDirection(): THREE.Vector3 { return this.moonDir; }
  /** World direction to the sun this frame (read-only; may point below the horizon at night). */
  get sunDirection(): THREE.Vector3 { return this.sunDir; }

  init(host: RenderHostHandles): void {
    this.scene = host.scene;
    this.camera = host.camera;
    ensureAtmosphereResources();
    installUnifiedFog();
    this.sun.name = 'key-light';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.12;
    // Small PCF radius: the cel shader hardens the result, and a wide rotated-disk kernel leaves ragged edges.
    this.sun.shadow.radius = 1.0;
    this.sun.target.name = 'key-light-target';
    this.hemi.name = 'sky-fill';
    this.lantern.name = 'night-lantern';
    this.lantern.castShadow = false;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.lantern, this.dome.mesh, this.clouds.mesh, this.rain.mesh, this.bolt.mesh);
    this.scene.fog = this.fog;
  }

  update(ctx: FrameContext): void {
    const sea = ctx.sea;
    const dt = Math.min(0.1, Math.max(0, ctx.dt));
    const hour = this.hourOverride ?? sea.timeOfDay;
    if (ctx.quality !== this.tier) this.applyQuality(ctx.quality);

    // ── Look: hour, then weather ──
    const look = lookForHour(this.look, hour);
    const night = nightAmount(hour);
    const storm = THREE.MathUtils.clamp(sea.rain, 0, 1);
    const fogAmount = THREE.MathUtils.clamp(sea.fog, 0, 1);
    const breezy = (sea.weather === 'breezy' ? 1 - sea.blend : 0) + (sea.nextWeather === 'breezy' ? sea.blend : 0);
    if (storm > 0) lerpLook(look, STORM_LOOK, storm * (1 - night * 0.55));
    if (storm > 0 && night > 0) look.keyIntensity *= 1 - storm * 0.25;
    if (fogAmount > 0) lerpLook(look, night > 0.5 ? NIGHT_FOG_LOOK : FOG_LOOK, fogAmount);

    // ── Key light: sun by day, moon by night ──
    sunDirection(hour, this.sunDir);
    moonDirection(hour, this.moonDir);
    const sunWeight = smoothstep(-0.06, 0.1, this.sunDir.y);
    this.keyDir.copy(this.sunDir).multiplyScalar(sunWeight).addScaledVector(this.moonDir, 1 - sunWeight).addScaledVector(UP, 0.25);
    this.keyDir.y = Math.max(this.keyDir.y, 0.16 * this.keyDir.length());
    this.keyDir.normalize();

    // ── Lightning ──
    if (this.lastSerial < 0) this.lastSerial = sea.lightningSerial;
    if (sea.lightningSerial !== this.lastSerial) {
      this.lastSerial = sea.lightningSerial;
      this.strike(ctx);
    }
    const boltFlash = this.bolt.update(dt);
    this.flashTime = Math.max(0, this.flashTime - dt);
    const envelope = this.flashTime > 0 ? Math.pow(this.flashTime / 0.45, 1.3) : 0;
    this.flash = Math.max(envelope * (0.55 + 0.45 * Math.abs(Math.sin(this.flashTime * 55))), boltFlash * 0.85);

    // ── Atmosphere state (contract) ──
    const a = ctx.atmosphere;
    a.sunDirection.copy(this.keyDir);
    a.sunColor.copy(look.key);
    a.sunIntensity = look.keyIntensity;
    a.ambientColor.copy(look.shadow);
    a.skyColor.copy(look.zenith);
    a.horizonColor.copy(look.horizon);
    a.fogColor.copy(look.haze);
    a.fogNear = look.fogNear;
    a.fogFar = look.fogFar;
    a.night = night;
    a.storm = storm;
    a.flash = this.flash;

    // ── Shared uniforms ──
    const u = atmosphereUniforms;
    const flashLift = this.flash * 0.9;
    u.uCruiseSunDir.value.copy(this.keyDir);
    u.uCruiseSunColor.value.copy(look.key).multiplyScalar(look.keyIntensity * (1 + flashLift));
    u.uCruiseShadowTint.value.copy(look.shadow).lerp(this.tmpColor.setRGB(0.75, 0.82, 0.95), flashLift * 0.5);
    u.uCruiseSkyAmbient.value.setRGB(1, 1, 1);
    u.uCruiseGroundAmbient.value.setRGB(0.86, 0.97, 1.02).lerp(this.tmpColor.setRGB(1, 1, 1), night);
    u.uCruiseRimColor.value.copy(look.rim).multiplyScalar(0.9 + night * 0.5);
    u.uCruiseInkColor.value.copy(look.ink);
    u.uCruiseSkyColor.value.copy(look.zenith);
    u.uCruiseHorizonColor.value.copy(look.horizon);
    u.uCruiseFogColor.value.copy(look.haze);
    u.uCruiseFogNear.value = look.fogNear;
    u.uCruiseFogFar.value = look.fogFar;
    u.uCruiseNight.value = night;
    u.uCruiseStorm.value = storm;
    u.uCruiseFlash.value = this.flash;
    u.uCruiseTime.value = ctx.time;
    const windX = Math.sin(sea.windDir), windZ = Math.cos(sea.windDir);
    u.uCruiseWind.value.set(windX, windZ, sea.windStrength);
    const cloudDrift = 6 + 10 * sea.windStrength;
    const cs = u.uCruiseCloudShadow.value;
    cs.x = (-windX * ctx.time * cloudDrift) % 100000;
    cs.y = (-windZ * ctx.time * cloudDrift) % 100000;
    cs.z = 1 / 1500;
    cs.w = 0.5 * (1 - night) * (1 - fogAmount) * (1 - storm * 0.85);
    u.uCruiseCloudCover.value = THREE.MathUtils.clamp(0.26 + breezy * 0.16 + storm * 0.3, 0, 0.9);
    // Faction light (materials/faction.ts): enemy rims and the albedo lift come up at night, in storms and in fog.
    const factionRim = Math.max(night, storm * 0.85, fogAmount * 0.7);
    u.uCruiseFactionRim.value.set(factionRim, 1 + (NIGHT_LIFT - 1) * Math.max(night, storm * 0.7), 0.6, 0);

    // ── Lights ──
    const focusX = ctx.focus.x, focusZ = ctx.focus.z;
    this.sun.color.copy(look.key);
    this.sun.intensity = look.keyIntensity * Math.PI * 0.85;
    this.hemi.color.copy(look.zenith).lerp(this.tmpColor.setRGB(1, 1, 1), 0.55);
    this.hemi.groundColor.copy(look.shadow);
    this.hemi.intensity = 0.9 + 0.3 * (1 - night);
    // A warm pool around the focus: golden fill through dusk, ship lanterns at night (SHIPS adds the emissive lanterns).
    this.lantern.intensity = heroFill(hour, night, fogAmount, this.lantern.color);
    this.lantern.distance = HERO_FILL_DISTANCE;
    this.lantern.visible = true;
    this.lantern.position.set(focusX, 22, focusZ);
    this.fitShadow(focusX, focusZ);

    // ── Fog ──
    this.fog.color.copy(look.haze);
    this.fog.near = look.fogNear;
    this.fog.far = look.fogFar;

    // ── Dome ──
    const d = this.dome.uniforms;
    d.uZenith.value.copy(look.zenith);
    d.uHorizon.value.copy(look.horizon);
    d.uHaze.value.copy(look.haze);
    d.uSunDir.value.copy(this.sunDir);
    d.uSunColor.value.copy(look.key).lerp(this.tmpColor.setRGB(1, 0.62, 0.35), smoothstep(0.35, 0.05, this.sunDir.y));
    d.uSunVisible.value = smoothstep(-0.03, 0.03, this.sunDir.y) * (1 - fogAmount * 0.8);
    d.uMoonDir.value.copy(this.moonDir);
    d.uMoonVisible.value = (1 - smoothstep(-0.12, 0.04, this.sunDir.y)) * (1 - storm) * (1 - fogAmount * 0.6);
    d.uStars.value = look.stars * (1 - storm) * (1 - fogAmount);
    d.uStorm.value = storm;
    d.uFog.value = fogAmount;
    d.uTime.value = ctx.time;
    d.uFlash.value = this.flash;
    d.uFlashDir.value.copy(this.flashDir);
    d.uOvercastLit.value.copy(look.cloudLit);
    d.uOvercastShade.value.copy(look.cloudShade);

    // ── Clouds ──
    const c = this.clouds.uniforms;
    c.uSunDir.value.copy(this.sunWeightDir(sunWeight));
    c.uLit.value.copy(look.cloudLit);
    c.uShade.value.copy(look.cloudShade);
    c.uHaze.value.copy(look.haze);
    c.uRimColor.value.copy(look.rim);
    c.uFade.value = fogAmount * 0.75;
    c.uFlash.value = this.flash;
    // In a storm the cards sink into the rolling deck instead of reading as cut-outs over it.
    c.uOpacity.value = (1 - fogAmount * 0.5) * (1 - storm * 0.55);
    this.clouds.setDensity(this.profile.clouds * THREE.MathUtils.clamp(0.62 + breezy * 0.25 + storm * 0.38 - fogAmount * 0.4, 0.15, 1));
    this.clouds.update(ctx.time, focusX, focusZ, sea.windDir, this.camera.position);

    // ── Rain ──
    const cam = this.camera.position;
    this.rainOrigin.set(cam.x * 0.45 + focusX * 0.55, cam.y * 0.45 + 12, cam.z * 0.45 + focusZ * 0.55);
    this.rainColor.copy(look.haze).lerp(this.tmpColor.setRGB(0.9, 0.95, 1), 0.6);
    this.rain.update(ctx.time, storm, this.rainOrigin, windX, windZ, sea.windStrength, this.profile.rain, this.rainColor);
  }

  /** Clouds are lit by the sun by day and by the moon at night. */
  private sunWeightDir(sunWeight: number): THREE.Vector3 {
    return this.v.copy(this.sunDir).multiplyScalar(sunWeight).addScaledVector(this.moonDir, 1 - sunWeight).normalize();
  }

  private strike(ctx: FrameContext): void {
    this.strikes++;
    const angle = (this.strikes * 2.39996 + ctx.time * 0.37) % (Math.PI * 2);
    // Prefer the half of the horizon the camera faces so the bolt is seen.
    const forward = this.camera.getWorldDirection(this.w);
    const heading = Math.atan2(forward.x, forward.z);
    const az = heading + Math.sin(angle) * 0.9;
    const dist = 520 + (this.strikes * 137) % 480;
    const x = ctx.focus.x + Math.sin(az) * dist;
    const z = ctx.focus.z + Math.cos(az) * dist;
    this.bolt.strike(x, z, 520, this.strikes * 7919 + Math.floor(ctx.time * 10));
    this.flashTime = 0.45;
    this.flashDir.set(x - this.camera.position.x, 260, z - this.camera.position.z).normalize();
  }

  private applyQuality(tier: QualityTier): void {
    this.tier = tier;
    const profile = qualityProfile(tier);
    const previous = this.profile;
    this.profile = profile;
    this.sun.castShadow = profile.shadows;
    if (previous.shadowMapSize !== profile.shadowMapSize || !this.sun.shadow.map) {
      this.sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }

  /**
   * Fits the key light's orthographic shadow camera to what the camera sees of the sea (plus masts), in light space,
   * with a stable size and texel-snapped centre so shadow edges never crawl as the ship moves.
   */
  private fitShadow(focusX: number, focusZ: number): void {
    if (!this.sun.castShadow) {
      this.sun.position.set(focusX, 0, focusZ).addScaledVector(this.keyDir, 900);
      this.sun.target.position.set(focusX, 0, focusZ);
      return;
    }
    const cam = this.camera;
    cam.updateMatrixWorld();
    const reach = this.profile.shadowReach;
    const pts = this.footprint;
    let n = 0;
    for (let c = 0; c < SHADOW_CORNERS.length; c += 2) {
      this.ndc.set(SHADOW_CORNERS[c]!, SHADOW_CORNERS[c + 1]!, 0.5).unproject(cam);
      const dir = this.ndc.sub(cam.position).normalize();
      let t = reach * 2;
      if (dir.y < -1e-4) t = Math.min(t, -cam.position.y / dir.y);
      const hx = cam.position.x + dir.x * t, hz = cam.position.z + dir.z * t;
      // Clamp to the reach around the focus.
      const dx = hx - focusX, dz = hz - focusZ;
      const dd = Math.hypot(dx, dz);
      const k = dd > reach ? reach / dd : 1;
      pts[n++]!.set(focusX + dx * k, 0, focusZ + dz * k);
    }
    const ground = n;
    for (let i = 0; i < ground; i++) pts[n++]!.copy(pts[i]!).setY(55);

    // Light space anchored at the world origin (fixed orientation → stable texel grid).
    this.lightCam.position.copy(this.keyDir).multiplyScalar(4000);
    this.lightCam.lookAt(0, 0, 0);
    this.lightCam.updateMatrixWorld();
    const view = this.lightView.copy(this.lightCam.matrixWorld).invert();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = this.w.copy(pts[i]!).applyMatrix4(view);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const size = Math.ceil(Math.max(maxX - minX, maxY - minY, 120) / 32) * 32;
    const texel = size / this.sun.shadow.mapSize.x;
    // Normal offset of ~1.2 texels keeps steep cliffs free of acne at any fitted frustum size.
    this.sun.shadow.normalBias = Math.max(0.12, texel * 1.2);
    const cx = Math.round((minX + maxX) * 0.5 / texel) * texel;
    const cy = Math.round((minY + maxY) * 0.5 / texel) * texel;
    const sc = this.sun.shadow.camera;
    sc.left = cx - size / 2; sc.right = cx + size / 2;
    sc.bottom = cy - size / 2; sc.top = cy + size / 2;
    sc.near = Math.max(1, -maxZ - 260);
    sc.far = -minZ + 120;
    sc.updateProjectionMatrix();
    this.sun.position.copy(this.lightCam.position);
    this.sun.target.position.set(0, 0, 0);
  }

  dispose(): void {
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.lantern, this.dome.mesh, this.clouds.mesh, this.rain.mesh, this.bolt.mesh);
    if (this.scene.fog === this.fog) this.scene.fog = null;
    this.dome.dispose();
    this.clouds.dispose();
    this.rain.dispose();
    this.bolt.dispose();
    this.sun.shadow.map?.dispose();
  }
}
