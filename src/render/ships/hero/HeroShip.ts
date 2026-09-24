/**
 * The player's ship (SHIPS-owned): the downloaded model scaled to its gameplay length, wave buoyancy (heave, pitch,
 * roll from four ocean samples plus the sim's heel), Lionburst airtime, Deep Dive submersion, hit flash, invulnerable
 * blink, the tier growth bounce and the attachment layer (HeroGrowth). Anchors for FX come from the measured profile.
 */
import * as THREE from 'three';
import type { HeroModelKey } from '../../../game/ids';
import type { OceanServices, ShipAnchor } from '../../frame';
import { HERO_SOURCE_LENGTH, type SketchfabShipAssets, type HeroTemplate } from '../../loaders/SketchfabShipAssets';
import { markInk } from '../../materials/toon';
import type { FleetAssets } from '../../loaders/FleetAssets';
import { FlashDriver } from '../materials';
import { HeroCrew } from './Crew';
import { HeroGrowth, type GrowthInput, type ShipGrowthEvent } from './HeroGrowth';
import { measureHero, type HeroProfile } from './heroProfile';

export interface HeroPose {
  x: number; z: number; heading: number; speed: number;
  /** Sim heel (radians). */
  roll: number;
  airborne: number;
  submerged: number;
  invulnerable: number;
  /** Seconds since the last hit (flash). */
  sinceHit: number;
  hpFraction: number;
  alive: boolean;
}

const profileCache = new Map<string, HeroProfile>();
const tmpV = new THREE.Vector3();
const tmpM = new THREE.Matrix4();

export class HeroShip {
  /** World transform (buoyancy, heading). */
  readonly root = new THREE.Group();
  /** Tier scale + bounces. */
  private readonly body = new THREE.Group();
  /** Model scale (gameplay length / source length). */
  private readonly holder = new THREE.Group();
  private model: THREE.Group | null = null;
  private modelMaterials: THREE.Material[] = [];
  private flash: FlashDriver | null = null;
  growth: HeroGrowth | null = null;
  crew: HeroCrew | null = null;
  profile: HeroProfile | null = null;
  kind: HeroModelKey | null = null;
  length = 34;
  private accent = 0xffc233;
  private loadToken = 0;
  private heave = 0;
  private pitch = 0;
  private roll = 0;
  private lastAir = 0;
  private lastSub = 0;
  private airPitch = 0;
  private landing = 0;
  private landingV = 0;
  private tierScale = 1;
  private bounce = 0;
  private bounceV = 0;
  private lastTier = -1;
  private flashAmount = 0;
  private flashColor = 0xffffff;
  private growthPrimed = false;
  private deathT = 0;
  private windYaw = 0.7;
  private readonly events: ShipGrowthEvent[] = [];
  ready = false;

  constructor(private readonly assets: SketchfabShipAssets, private readonly fleetAssets: FleetAssets | null = null) {
    this.root.name = 'hero-ship';
    this.root.rotation.order = 'YXZ';
    this.root.add(this.body);
    this.body.add(this.holder);
  }

  /** Switches the model (async). Safe to call every frame; only acts on change. */
  setModel(kind: HeroModelKey, length: number, accent: number): void {
    if (this.kind === kind && this.length === length && this.accent === accent) return;
    this.kind = kind; this.length = length; this.accent = accent;
    this.ready = false;
    const token = ++this.loadToken;
    this.clearModel();
    void this.assets.load(kind).then((template) => {
      if (token !== this.loadToken) return;
      this.mount(template, length, accent);
    }).catch((error: unknown) => { console.warn('[ships] hero model failed', error); });
  }

  private mount(template: HeroTemplate, length: number, accent: number): void {
    const { root, materials } = this.assets.instantiate(template);
    this.model = root;
    this.modelMaterials = materials;
    this.holder.scale.setScalar(length / HERO_SOURCE_LENGTH[template.kind]);
    this.holder.add(root);
    markInk(root);
    const key = `${template.kind}:${length}`;
    let profile = profileCache.get(key);
    if (!profile) { profile = measureHero(template.kind, template.scene, length); profileCache.set(key, profile); }
    this.profile = profile;
    this.growth = new HeroGrowth(profile, accent);
    this.body.add(this.growth.group);
    this.flash = new FlashDriver([...materials, ...this.growth.materials]);
    this.crew = new HeroCrew(profile.crew, accent, THREE.MathUtils.clamp(profile.partScale * 0.95, 1, 1.4), this.fleetAssets);
    this.body.add(this.crew.group);
    this.growthPrimed = false;
    this.ready = true;
  }

  private clearModel(): void {
    if (this.model) { this.holder.remove(this.model); for (const m of this.modelMaterials) m.dispose(); }
    if (this.growth) { this.body.remove(this.growth.group); this.growth.dispose(); }
    if (this.crew) { this.body.remove(this.crew.group); this.crew.dispose(); }
    this.model = null; this.modelMaterials = []; this.growth = null; this.crew = null; this.profile = null; this.flash = null;
  }

  /** Called on 'player-hit' events: colour of the next flash (white hit, gold parry, cyan braced). */
  hit(kind: 'hit' | 'braced' | 'parried', amount: number): void {
    this.flashColor = kind === 'parried' ? 0xffd35e : kind === 'braced' ? 0x9fe8ff : amount > 25 ? 0xff6a4a : 0xffffff;
    this.flashAmount = 1;
  }

  update(dt: number, time: number, pose: HeroPose, growth: GrowthInput | null, night: number, ocean: OceanServices, wind: { dir: number; strength: number } = { dir: 0.6, strength: 0.5 }): void {
    const L = this.length;
    const p = this.profile;
    const half = L * 0.4;
    const beam = p ? Math.max(4, p.bounds.max.x * 0.8) : L * 0.15;
    const sin = Math.sin(pose.heading), cos = Math.cos(pose.heading);
    const fx = -sin, fz = -cos, sx = cos, sz = -sin;
    const hBow = ocean.heightAt(pose.x + fx * half, pose.z + fz * half);
    const hStern = ocean.heightAt(pose.x - fx * half, pose.z - fz * half);
    const hStar = ocean.heightAt(pose.x + sx * beam, pose.z + sz * beam);
    const hPort = ocean.heightAt(pose.x - sx * beam, pose.z - sz * beam);
    const hMid = ocean.heightAt(pose.x, pose.z);
    const stiffness = THREE.MathUtils.clamp(40 / L, 0.45, 1);
    const targetHeave = (hBow + hStern + hStar + hPort + hMid * 2) / 6;
    const targetPitch = Math.atan2(hBow - hStern, 2 * half) * 0.85;
    const targetRoll = Math.atan2(hStar - hPort, 2 * beam) * 0.7 * stiffness;
    const k = 1 - Math.exp(-dt * 7);
    this.heave += (targetHeave - this.heave) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.roll += (targetRoll - this.roll) * k;

    // Lionburst: rise with nose up, fall nose down, squash on landing.
    const airRate = dt > 0 ? (pose.airborne - this.lastAir) / dt : 0;
    this.airPitch += (THREE.MathUtils.clamp(airRate * 0.35, -0.38, 0.38) - this.airPitch) * (1 - Math.exp(-dt * 10));
    if (this.lastAir > 0.05 && pose.airborne <= 0.001) this.landingV -= 9;
    this.lastAir = pose.airborne;
    this.landingV += (-this.landing * 90 - this.landingV * 9) * dt;
    this.landing += this.landingV * dt;
    // Deep Dive: sink below the surface, nose down while diving, up while surfacing.
    const subRate = dt > 0 ? (pose.submerged - this.lastSub) / dt : 0;
    this.lastSub = pose.submerged;
    const diveDepth = (p ? p.bounds.max.y : L * 0.5) + 3;
    const subPitch = THREE.MathUtils.clamp(-subRate * 0.3, -0.3, 0.3);
    if (pose.submerged > 0.25) ocean.stampFoam(pose.x, pose.z, L * 0.35, 0.35 * pose.submerged);

    // Defeat: list, raise the bow and go down.
    this.deathT = pose.alive ? 0 : this.deathT + dt;
    const sink = THREE.MathUtils.clamp(this.deathT / 4.5, 0, 1);
    const sinkDepth = sink * sink * ((p ? p.bounds.max.y : L * 0.5) * 0.9 + 4);

    this.root.position.set(pose.x, this.heave * (1 - pose.submerged) + pose.airborne * 26 - pose.submerged * diveDepth + this.landing - sinkDepth, pose.z);
    this.root.rotation.set(this.pitch * (1 - pose.airborne) + this.airPitch + subPitch + sink * 0.28, pose.heading,
      this.roll * (1 - pose.airborne) + pose.roll + Math.sin(time * 5) * 0.05 * pose.airborne + sink * 0.42);

    // Tier growth: slightly bigger per tier, with a bounce on tier-up.
    const tier = growth?.tier ?? 0;
    if (tier !== this.lastTier) { if (this.lastTier >= 0 && tier > this.lastTier) this.bounceV += 1.6; this.lastTier = tier; }
    this.tierScale += (1 + tier * 0.025 - this.tierScale) * (1 - Math.exp(-dt * 3));
    this.bounceV += (-this.bounce * 140 - this.bounceV * 10) * dt;
    this.bounce += this.bounceV * dt;
    this.body.scale.setScalar(this.tierScale * (1 + this.bounce * 0.06));

    // Invulnerable blink (revive / spawn), never while airborne or submerged.
    const blink = pose.invulnerable > 0.05 && pose.airborne < 0.05 && pose.submerged < 0.05 && Math.sin(time * 40) > 0.3;
    this.body.visible = !blink;

    // Hit flash (sinceHit drives it so fixed-step capture works too).
    const hitFlash = Math.max(this.flashAmount, pose.sinceHit < 0.2 ? 1 - pose.sinceHit / 0.2 : 0);
    this.flashAmount = Math.max(0, this.flashAmount - dt * 6);
    this.flash?.set(hitFlash, this.flashColor);

    if (this.growth && growth) {
      this.growth.apply(growth, !this.growthPrimed);
      this.growthPrimed = true;
      // Apparent wind (true wind minus ship motion) in ship space; flags never fly dead aft (edge-on to the camera).
      const wx = Math.sin(wind.dir) * wind.strength * 12 + sin * pose.speed, wz = Math.cos(wind.dir) * wind.strength * 12 + cos * pose.speed;
      const lx = wx * cos - wz * sin, lz = wx * sin + wz * cos;
      let yaw = Math.atan2(lx, lz);
      if (Math.abs(yaw) < 0.55) yaw = (yaw >= 0 ? 1 : -1) * 0.55;
      this.windYaw += (yaw - this.windYaw) * (1 - Math.exp(-dt * 1.5));
      this.growth.update(dt, time, night, pose.speed, this.windYaw);
      const before = this.events.length;
      this.growth.drainEvents(this.events);
      if (this.events.length > before && this.crew) this.crew.cheer();
    }
    this.crew?.update(dt, time);
  }

  /** Growth events in world space (drained). */
  drainGrowthEvents(out: ShipGrowthEvent[]): void {
    if (!this.events.length) return;
    this.root.updateMatrixWorld();
    tmpM.copy(this.body.matrixWorld);
    for (const e of this.events) {
      tmpV.set(e.x, e.y, e.z).applyMatrix4(tmpM);
      out.push({ ...e, x: tmpV.x, y: tmpV.y, z: tmpV.z });
    }
    this.events.length = 0;
  }

  anchor(name: ShipAnchor, out: THREE.Vector3): boolean {
    const p = this.profile;
    if (!p) { out.set(0, 3, name === 'bow' ? -this.length / 2 : name === 'stern' ? this.length / 2 : 0).applyMatrix4(this.root.matrixWorld); return true; }
    out.copy(p.anchors[name]).applyMatrix4(this.body.matrixWorld);
    return true;
  }

  transform(out: THREE.Matrix4): boolean { out.copy(this.root.matrixWorld); return true; }

  /** World positions of the low-HP smoke emitters (returns count written). */
  smokePoints(out: THREE.Vector3[]): number {
    const p = this.profile;
    if (!p) return 0;
    const n = Math.min(out.length, p.smoke.length);
    for (let i = 0; i < n; i++) out[i]!.copy(p.smoke[i]!).applyMatrix4(this.body.matrixWorld);
    return n;
  }

  dispose(): void { this.clearModel(); }
}
