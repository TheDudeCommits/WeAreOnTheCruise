/**
 * FX lab (lab/fx.html): the real Sim + sky/ocean/ship/camera systems + FxSystem on an open sea, with buttons
 * that emit every event type and spawn every projectile, hazard, pickup and telegraph kind, plus a barrage
 * stress test (650 projectiles + 30 explosions/s) with FPS and draw-call readouts.
 *
 * Automation: window.__FXLAB__ (scene presets, deterministic `advance`, stats). `?manual=1` disables the RAF
 * loop so captures step in fixed 1/60 frames; `?clean=1` hides the panels.
 */
import * as THREE from 'three';
import { defaultProfile, defaultSettings } from '../../../game/meta/save';
import type { BossId, EnemyId, HazardKind, PickupKind, ProjectileKind, ShipId, SkillSlot, SpecialId, UltimateId } from '../../../game/ids';
import { Sim } from '../../../game/sim/Sim';
import type { EnemyState, SeaState, SimEvent, TelegraphShape } from '../../../game/types';
import { RendererHost } from '../../app/RendererHost';
import { CameraDirector } from '../../camera/CameraDirector';
import type { AtmosphereState, FrameContext, QualityTier, RenderServices, RenderSystem } from '../../frame';
import { OceanSystem } from '../../ocean/OceanSystem';
import { ShipSystem } from '../../ships/ShipSystem';
import { SkySystem } from '../../sky/SkySystem';
import { seedFx } from '../core/rand';
import { FxSystem } from '../FxSystem';
import { LabPost, OpenSea } from './LabSupport';

const params = new URLSearchParams(location.search);
const manual = params.get('manual') === '1';
if (params.get('clean') === '1') document.body.classList.add('clean');
seedFx(1234567);

const root = document.getElementById('root') as HTMLDivElement;
const host = new RendererHost(root, params.get('capture') === '1', false);
host.setAdaptiveQualityEnabled(false);
const post = new LabPost(host.renderer);
const sky = new SkySystem();
const ocean = new OceanSystem();
const ships = new ShipSystem();
const fx = new FxSystem();
const camera = new CameraDirector();
const systems: RenderSystem[] = [sky, ocean, ships, fx, camera];
const world = new OpenSea();
const settings = defaultSettings();
let quality: QualityTier = 'high';
let shipId: ShipId = (params.get('ship') as ShipId) || 'sunlion';

const atmosphere: AtmosphereState = {
  sunDirection: new THREE.Vector3(0.4, 0.8, 0.3), sunColor: new THREE.Color(0xfff2cf), sunIntensity: 2, ambientColor: new THREE.Color(0xbfdcff),
  skyColor: new THREE.Color(0x1a6fd0), horizonColor: new THREE.Color(0xa9dbef), fogColor: new THREE.Color(0xa9dbef),
  fogNear: 400, fogFar: 2400, night: 0, storm: 0, flash: 0,
};

let sim = makeSim();
let time = 0;
let hour = Number(params.get('hour') ?? 14);
let weather: SeaState['weather'] = 'clear';
let paused = false;
let slow = 1;
let hold = true;
let barrage = false;
let barrageAcc = 0;
let aim = { x: 90, z: 0 };
const injected: SimEvent[] = [];
const frameEvents: SimEvent[] = [];
let airT = 0;
let subT = 0;
let camPreset: 'director' | 'low' | 'side' | 'top' | 'high' | 'shot' = (params.get('cam') as 'low') || 'director';
/** Scene-specific framing: target (relative to the player frame: side/along), distance, yaw offset, pitch. */
const shot = { side: 0, along: 0, y: 4, dist: 90, yaw: 0, pitch: 0.35 };
const camTarget = new THREE.Vector3();
const holds = new Map<number, { x: number; z: number; heading: number }>();
const fpsSamples: number[] = [];
const fxMs: number[] = [];
const perfFrames: number[] = [];
let lastNow = performance.now();

const services: RenderServices = {
  ocean, camera, post, ships,
  requestSlowMo: (scale, duration) => sim.requestTimeScale(scale, duration),
};

function makeSim(): Sim {
  const s = new Sim({ seed: 'fx-lab', shipId, seaId: 'sunward-shallows', meta: defaultProfile(), world });
  s.debug.god(true);
  s.press('gear-down');
  s.state.player.invulnerable = 0;
  return s;
}

function resetSim(): void {
  sim = makeSim();
  holds.clear();
  fx.reset();
  airT = subT = 0;
}

// ───────────────────────── frame ─────────────────────────

function tick(dt: number): void {
  time += dt;
  const s = sim.state;
  s.director.budget = -1e6;
  s.director.nextBossIndex = 99;
  if (s.status === 'levelup' || s.status === 'chest') sim.chooseCard(0);
  sim.setInput({ steer: 0, aimX: aim.x, aimZ: aim.z, broadsideHeld: false, throttleAxis: 0 });
  // fake special states the skeleton sim does not implement yet
  const p = s.player;
  if (airT > 0) { airT = Math.max(0, airT - dt * slow); const k = 1 - airT / 1.1; p.airborne = Math.sin(Math.min(1, k) * Math.PI); p.x += 150 * dt * slow * Math.sin(p.heading + Math.PI) ; p.z += 150 * dt * slow * Math.cos(p.heading + Math.PI); if (airT === 0) p.airborne = 0; }
  if (subT > 0) { subT = Math.max(0, subT - dt * slow); p.submerged = subT > 0.2 ? Math.min(1, (3 - subT) * 3) : subT * 5; if (subT === 0) p.submerged = 0; }
  if (barrage) runBarrage(dt);
  if (!paused) sim.step(dt * slow);
  // the sim's sea-state schedule runs inside step(); the lab's time-of-day/weather overrides win afterwards
  s.sea.timeOfDay = hour;
  s.sea.weather = s.sea.nextWeather = weather;
  s.sea.blend = 1;
  s.sea.rain = weather === 'storm' ? 1 : 0;
  s.sea.fog = weather === 'fog' ? 1 : 0;
  s.sea.waveScale = weather === 'storm' ? 1.7 : weather === 'fog' ? 0.7 : 0.8;
  if (hold) for (const e of s.enemies) {
    const h = holds.get(e.id);
    if (h && e.life === 'alive') { e.x = h.x; e.z = h.z; e.heading = h.heading; e.vx = e.vz = 0; e.speed = 0; }
  }
  frameEvents.length = 0;
  for (const e of sim.drainEvents()) frameEvents.push(e);
  for (const e of injected) frameEvents.push(e);
  injected.length = 0;

  const vp = host.getViewport();
  const ctx: FrameContext = {
    time, dt, screen: 'run', run: s, events: frameEvents, sea: s.sea,
    focus: { x: p.x, z: p.z, heading: p.heading, speed: p.speed }, menuShip: null, aim: { x: aim.x, z: aim.z }, world,
    quality, settings, viewport: { width: vp.width, height: vp.height, dpr: host.renderer.getPixelRatio() }, atmosphere, services,
  };
  for (const system of systems) {
    if (system === fx) {
      const t0 = performance.now();
      system.update(ctx);
      fxMs.push(performance.now() - t0);
      if (fxMs.length > 1200) fxMs.shift();
    } else system.update(ctx);
  }
  applyCameraPreset(p.x, p.z, p.heading);
  post.update(dt);
  host.render(() => post.render(host.scene, host.camera));
}

function applyCameraPreset(px: number, pz: number, heading: number): void {
  if (camPreset === 'director') return;
  const cam = host.camera;
  const fx0 = -Math.sin(heading), fz0 = -Math.cos(heading);
  const sx = Math.cos(heading), sz = -Math.sin(heading);
  if (camPreset === 'low') {
    // T3: low over the port quarter, looking across the starboard battery toward the enemy line
    // ahead of the bow on the firing (starboard) side, looking aft: hero right, enemy line left, flashes face camera
    cam.position.set(px + fx0 * 72 + sx * 34, 12, pz + fz0 * 72 + sz * 34);
    camTarget.set(px - fx0 * 8 + sx * 46, 6, pz - fz0 * 8 + sz * 46);
  } else if (camPreset === 'side') {
    cam.position.set(px - sx * 120 + fx0 * 10, 26, pz - sz * 120 + fz0 * 10);
    camTarget.set(px, 14, pz);
  } else if (camPreset === 'shot') {
    const tx = px + sx * shot.side + fx0 * shot.along, tz = pz + sz * shot.side + fz0 * shot.along;
    const a = heading + shot.yaw;
    cam.position.set(tx + Math.sin(a) * Math.cos(shot.pitch) * shot.dist, shot.y + Math.sin(shot.pitch) * shot.dist, tz + Math.cos(a) * Math.cos(shot.pitch) * shot.dist);
    camTarget.set(tx, shot.y, tz);
  } else if (camPreset === 'high') {
    cam.position.set(px - sx * 40 - fx0 * 150, 95, pz - sz * 40 - fz0 * 150);
    camTarget.set(px + sx * 60, 0, pz + sz * 60);
  } else {
    cam.position.set(px + 1, 260, pz + 60);
    camTarget.set(px, 0, pz);
  }
  cam.lookAt(camTarget);
  if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
}

function frameShot(side: number, along: number, y: number, dist: number, yaw: number, pitch: number): void {
  camPreset = 'shot';
  shot.side = side; shot.along = along; shot.y = y; shot.dist = dist; shot.yaw = yaw; shot.pitch = pitch;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  fpsSamples.push(dt);
  if (fpsSamples.length > 90) fpsSamples.shift();
  perfFrames.push(dt);
  if (perfFrames.length > 1200) perfFrames.shift();
  tick(dt);
  if (Math.round(now / 250) !== Math.round((now - dt * 1000) / 250)) drawStats();
}

function drawStats(): void {
  const m = host.getMetrics();
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, fpsSamples.length);
  const worst = Math.max(...fpsSamples, 0);
  const st = fx.stats;
  const s = sim.state;
  const el = document.getElementById('stats');
  if (!el) return;
  el.textContent = [
    `FPS ${(1 / Math.max(1e-3, avg)).toFixed(0).padStart(3)}  worst ${(worst * 1000).toFixed(1)} ms`,
    `draw ${m.drawCalls}  tris ${(m.triangles / 1000).toFixed(0)}k  dpr ${m.dpr.toFixed(2)}`,
    `projectiles ${s.projectiles.filter((q) => q.alive).length}  hazards ${s.hazards.filter((q) => q.alive).length}`,
    `pickups ${s.pickups.filter((q) => q.alive).length}  enemies ${s.enemies.length}`,
    `fx imm: cel ${st.cel} glow ${st.glow} heads ${st.heads}`,
    `     trails ${st.trails} decals ${st.decals} debris ${st.debris}`,
    `juice: ${JSON.stringify(fx.juice.last)}`,
    `post: ${JSON.stringify(post.counts)}`,
    `fx draw calls: ${fxDrawCalls()}`,
  ].join('\n');
}

/** Counts FX meshes that drew this frame (instanced passes with instances > 0). */
function fxDrawCalls(): number {
  let n = 0;
  fx.group.traverse((o) => {
    const mesh = o as THREE.Mesh & { count?: number };
    if (!(mesh as THREE.Mesh).isMesh) return;
    const g = mesh.geometry as THREE.InstancedBufferGeometry;
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) { if ((mesh as unknown as THREE.InstancedMesh).count > 0) n++; }
    else if (g.instanceCount > 0) n++;
  });
  return n;
}

// ───────────────────────── helpers ─────────────────────────

const P = () => sim.state.player;
function ahead(dist: number, side = 0): { x: number; z: number } {
  const p = P();
  const fx0 = -Math.sin(p.heading), fz0 = -Math.cos(p.heading), sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
  return { x: p.x + fx0 * dist + sx * side, z: p.z + fz0 * dist + sz * side };
}

function enemy(defId: EnemyId, side: number, along: number, elite = false, heading?: number): EnemyState | null {
  const at = ahead(along, side);
  const e = sim.spawnEnemy(defId, at.x, at.z, { elite, heading: heading ?? P().heading + (side > 0 ? 0.3 : -0.3) });
  if (e) holds.set(e.id, { x: e.x, z: e.z, heading: e.heading });
  return e;
}

function projectile(kind: ProjectileKind, fromSide: number, count: number, team: 'player' | 'enemy' = 'player'): void {
  const p = P();
  const sx = Math.cos(p.heading) * fromSide, sz = -Math.sin(p.heading) * fromSide;
  const fx0 = -Math.sin(p.heading), fz0 = -Math.cos(p.heading);
  const ballistic = kind === 'mortar-shell' || kind === 'enemy-mortar' || kind === 'bomblet' || kind === 'boss-shell';
  for (let i = 0; i < count; i++) {
    const along = (i / Math.max(1, count - 1) - 0.5) * 30;
    const speed = kind === 'torpedo' ? 35 : kind === 'harpoon' ? 80 : kind === 'rocket' ? 70 : ballistic ? 55 : kind === 'water-bolt' ? 50 : 95;
    const ox = team === 'player' ? p.x + fx0 * along + sx * 10 : p.x + sx * 170 + fx0 * along;
    const oz = team === 'player' ? p.z + fz0 * along + sz * 10 : p.z + sz * 170 + fz0 * along;
    const dir = team === 'player' ? 1 : -1;
    sim.spawnProjectile({
      kind, team, weapon: team === 'player' ? 'broadside' : undefined,
      x: ox, y: kind === 'torpedo' ? 0 : 3, z: oz,
      vx: sx * speed * dir + fx0 * (Math.random() - 0.5) * 6, vy: ballistic ? 26 : 0, vz: sz * speed * dir + fz0 * (Math.random() - 0.5) * 6,
      damage: 20, radius: 1.5, ttl: ballistic ? 4 : 150 / speed, area: ballistic ? 9 : 0, crit: i === 1,
    });
  }
}

function hazard(kind: HazardKind, side: number, along: number, radius: number, ttl: number, extra: Partial<{ vx: number; vz: number; tick: number; armed: boolean; team: 'player' | 'enemy' }> = {}): void {
  const at = ahead(along, side);
  sim.spawnHazard({ kind, team: extra.team ?? 'player', x: at.x, z: at.z, radius, ttl, damage: 5, tick: extra.tick ?? 0.5, vx: extra.vx, vz: extra.vz, armed: extra.armed ?? true });
}

function telegraph(shape: TelegraphShape, side: number, along: number, radius: number, length: number, angle: number, duration: number, team: 'player' | 'enemy' = 'enemy'): void {
  const at = ahead(along, side);
  sim.addTelegraph({ shape, team, x: at.x, z: at.z, radius, length, angle, duration });
}

function inject(e: SimEvent): void { injected.push(e); }

function kill(e: EnemyState | null, crit = false): void {
  if (!e) return;
  if (crit) inject({ type: 'damage', target: e.id, amount: 999, crit: true, x: e.x, y: 4, z: e.z });
  sim.damageTarget(e, 1e9, { pierceArmor: true, crit });
}

function skill(slot: SkillSlot, id: SkillSlot | SpecialId | UltimateId): void {
  const p = P();
  const target = ahead(0, 90);
  inject({ type: 'skill-used', slot, skill: id, x: p.x, z: p.z, aimX: target.x, aimZ: target.z });
  if (slot === 'brace') p.skills.brace.active = 1.2;
  if (slot === 'boost') p.skills.boost.active = 2.5;
  if (id === 'lionburst') airT = 1.1;
  if (id === 'deep-dive') subT = 3;
  if (slot === 'ultimate') { p.skills.ultimate.active = 4; }
  if (id === 'second-wind') p.shield = 60;
}

function runBarrage(dt: number): void {
  const s = sim.state;
  const p = s.player;
  let alive = 0;
  for (const q of s.projectiles) if (q.alive) alive++;
  const kinds: ProjectileKind[] = ['cannonball', 'enemy-cannonball', 'chain-shot', 'heavy-shot', 'grapeshot', 'rocket', 'mortar-shell', 'water-bolt', 'skiff-shot', 'enemy-chaser'];
  let guard = 0;
  while (alive < 650 && guard++ < 90) {
    const a = Math.random() * Math.PI * 2;
    const r = 60 + Math.random() * 90;
    const kind = kinds[(Math.random() * kinds.length) | 0]!;
    const ballistic = kind === 'mortar-shell';
    const speed = ballistic ? 50 : 80 + Math.random() * 30;
    const dirA = a + Math.PI + (Math.random() - 0.5) * 1.4;
    sim.spawnProjectile({
      kind, team: kind.startsWith('enemy') ? 'enemy' : 'player', x: p.x + Math.cos(a) * r, y: 3, z: p.z + Math.sin(a) * r,
      vx: Math.cos(dirA) * speed, vy: ballistic ? 20 : 0, vz: Math.sin(dirA) * speed, damage: 1, ttl: 0.8 + Math.random() * 1.6,
      radius: 0.5, area: ballistic ? 6 : 0, crit: Math.random() < 0.1,
    });
    alive++;
  }
  barrageAcc += dt * 30;
  const kindsX = ['small', 'medium', 'large', 'fire', 'powder', 'mine', 'mortar', 'water'] as const;
  while (barrageAcc >= 1) {
    barrageAcc -= 1;
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 130;
    inject({ type: 'explosion', x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, radius: 6 + Math.random() * 10, kind: kindsX[(Math.random() * kindsX.length) | 0]!, team: 'player' });
  }
}

// ───────────────────────── scenes (evidence presets) ─────────────────────────

const scenes: Record<string, () => void> = {
  broadside: () => {
    resetSim(); camPreset = 'low';
    enemy('brig', 88, 20); enemy('frigate', 118, 55); enemy('corsair-brig', 102, -18);
    aim = ahead(0, 100);
    sim.state.player.skills.broadside.cooldown = 0;
    sim.press('broadside');
  },
  sinking: () => {
    resetSim(); frameShot(58, 18, 8, 105, 2.0, 0.22);
    const e = enemy('frigate', 70, 10, false, P().heading + 1.2);
    kill(e, true);
    sim.spawnPickup('chest', ahead(10, 76).x, ahead(10, 76).z, 1);
  },
  lionburst: () => {
    resetSim(); camPreset = 'side';
    skill('special', 'lionburst');
  },
  explosions: () => {
    resetSim(); frameShot(95, 5, 8, 150, 1.9, 0.32);
    const kinds = ['small', 'medium', 'large', 'fire', 'powder', 'mine', 'mortar', 'lightning', 'water'] as const;
    kinds.forEach((kind, i) => {
      const at = ahead(-40 + (i % 3) * 45, 50 + Math.floor(i / 3) * 45);
      inject({ type: 'explosion', x: at.x, z: at.z, radius: 10, kind, team: 'player' });
    });
  },
  projectiles: () => {
    resetSim(); frameShot(55, 0, 4, 70, 2.6, 0.45);
    const kinds: ProjectileKind[] = ['cannonball', 'chain-shot', 'heavy-shot', 'chaser-shot', 'lance', 'mortar-shell', 'bomblet', 'swivel-shot', 'grapeshot', 'harpoon', 'rocket', 'torpedo', 'skiff-shot', 'water-bolt'];
    kinds.forEach((k, i) => projectile(k, 1, 1 + (i % 2)));
    (['enemy-cannonball', 'enemy-chaser', 'enemy-mortar', 'boss-shell'] as ProjectileKind[]).forEach((k) => projectile(k, 1, 2, 'enemy'));
  },
  hazards: () => {
    resetSim(); frameShot(75, -20, 6, 175, 1.75, 0.5);
    hazard('fire-patch', 45, -30, 12, 30);
    hazard('barrel', 30, 5, 2, 30);
    hazard('powder-keg', 38, 12, 2, 30);
    hazard('mine', 26, 20, 3, 30);
    hazard('whirlpool', 90, -20, 26, 30);
    hazard('storm-cloud', 140, 40, 30, 30, { tick: 1.2 });
    hazard('shockwave', 70, 60, 40, 2.5);
    hazard('lightning-strike', 60, 30, 10, 2.2);
    hazard('burning-wreck', 110, -60, 14, 30);
    hazard('wave-front', 130, -120, 60, 30, { vx: 0, vz: 6 });
  },
  pickups: () => {
    resetSim(); frameShot(62, 5, 2, 48, 2.3, 0.5);
    const kinds: PickupKind[] = ['xp-copper', 'xp-silver', 'xp-gold', 'doubloon', 'repair', 'compass', 'powder-keg', 'chest'];
    kinds.forEach((k, i) => { for (let j = 0; j < 3; j++) { const at = ahead(-30 + i * 10, 55 + j * 9); sim.spawnPickup(k, at.x, at.z, 1); } });
  },
  telegraphs: () => {
    resetSim(); frameShot(30, 10, 0, 190, 1.5, 0.95);
    telegraph('circle', 50, -20, 14, 0, 0, 3);
    telegraph('ring', 60, 40, 22, 12, 0, 3);
    const a = P().heading + Math.PI;
    telegraph('line', 110, -40, 8, 120, a, 3);
    telegraph('cone', 40, 60, 30, 60, P().heading + Math.PI / 2, 3);
    telegraph('circle', -60, 0, 30, 0, 0, 3, 'player');
  },
  storm: () => {
    resetSim(); frameShot(70, 10, 12, 150, 2.0, 0.28); weather = 'storm';
    const e1 = enemy('brig', 70, -20), e2 = enemy('cutter', 90, 20), e3 = enemy('skiff', 60, 50);
    const p = P();
    inject({ type: 'lightning', points: [{ x: p.x, z: p.z }, { x: e1!.x, z: e1!.z }, { x: e2!.x, z: e2!.z }, { x: e3!.x, z: e3!.z }], team: 'player' });
    const at = ahead(-50, 110);
    inject({ type: 'lightning-strike', x: at.x, z: at.z });
  },
  numbers: () => {
    resetSim(); frameShot(20, 20, 6, 150, 1.2, 0.6);
    const e1 = enemy('frigate', 60, 0), e2 = enemy('brig', 80, 50);
    for (let i = 0; i < 6; i++) inject({ type: 'damage', target: e1!.id, amount: 14 + i, crit: false, x: e1!.x, y: 4, z: e1!.z });
    inject({ type: 'damage', target: e2!.id, amount: 186, crit: true, x: e2!.x, y: 4, z: e2!.z });
    e1!.statuses.push({ kind: 'burning', time: 30, magnitude: 1 });
    e2!.statuses.push({ kind: 'stunned', time: 30, magnitude: 1 });
    const e3 = enemy('cutter', -70, 10); e3!.statuses.push({ kind: 'slowed', time: 30, magnitude: 1 }, { kind: 'hooked', time: 30, magnitude: 1 });
  },
  barrage: () => { resetSim(); camPreset = 'director'; barrage = true; },
  seaquake: () => { shipId = 'white-leviathan'; resetSim(); frameShot(0, 0, 0, 260, 2.2, 0.62); skill('special', 'seaquake'); },
  inferno: () => { shipId = 'sunlion'; resetSim(); frameShot(0, 0, 4, 150, 2.4, 0.45); skill('ultimate', 'kitchen-inferno'); },
  flare: () => { shipId = 'sunlion'; resetSim(); frameShot(45, 0, 16, 150, 2.2, 0.28); skill('special', 'signal-flare'); },
  sunfire: () => { shipId = 'sunlion'; resetSim(); frameShot(0, 0, 8, 140, 2.2, 0.35); skill('ultimate', 'sunfire-barrage'); },
  tidal: () => {
    shipId = 'sunlion'; resetSim(); frameShot(-40, 60, 8, 170, 1.2, 0.2);
    skill('ultimate', 'tidal-colossus');
    const p = P();
    hazard('wave-front', 0, 40, 70, 8, { vx: -Math.sin(p.heading) * 30, vz: -Math.cos(p.heading) * 30 });
  },
  deepdive: () => { shipId = 'sunlion'; resetSim(); frameShot(0, 0, 2, 110, 2.2, 0.4); skill('special', 'deep-dive'); },
  levelup: () => { resetSim(); frameShot(0, 0, 10, 140, 2.2, 0.3); inject({ type: 'level-up', level: 5 }); inject({ type: 'tier-up', tier: 1 }); },
  parry: () => { resetSim(); frameShot(0, 0, 4, 110, 2.0, 0.35); const p = P(); p.skills.brace.active = 1.2; inject({ type: 'player-hit', amount: 0, x: p.x + 20, z: p.z, braced: true, parried: true }); },
  boost: () => { resetSim(); frameShot(0, 0, 4, 90, 2.5, 0.3); sim.press('gear-up'); sim.press('gear-up'); skill('boost', 'boost'); },
  finale: () => {
    resetSim(); frameShot(90, 40, 12, 230, 2.1, 0.3);
    const at = ahead(40, 100);
    const b = sim.spawnBoss('iron-warden', at.x, at.z, P().heading + 1.3);
    sim.damageTarget(b, 1e9, { pierceArmor: true });
  },
  wavewall: () => {
    resetSim(); frameShot(40, 110, 8, 150, 2.9, 0.12);
    const p = P();
    hazard('wave-front', 60, 160, 90, 14, { vx: Math.sin(p.heading) * 10, vz: Math.cos(p.heading) * 10 });
  },
  enemyfire: () => {
    resetSim(); frameShot(70, 0, 6, 120, 2.6, 0.25);
    const e1 = enemy('frigate', 110, -10, false, P().heading + Math.PI); const e2 = enemy('brig', 95, 50, false, P().heading + Math.PI);
    if (e1) e1.attackCooldown = 0; if (e2) e2.attackCooldown = 0.2;
  },
};

// ───────────────────────── UI ─────────────────────────

const panel = document.getElementById('panel') as HTMLDivElement;
function section(title: string): HTMLDivElement { const h = document.createElement('h2'); h.textContent = title; panel.append(h); const d = document.createElement('div'); panel.append(d); return d; }
function button(parent: HTMLElement, label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(); parent.append(b); return b;
}
function toggle(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void): void {
  const b = button(parent, label, () => { set(!get()); b.classList.toggle('on', get()); });
  b.classList.toggle('on', get());
}

const sc = section('Scenes (evidence)');
for (const name of Object.keys(scenes)) button(sc, name, () => { barrage = false; weather = 'clear'; scenes[name]!(); });

const ctl = section('Controls');
toggle(ctl, 'pause', () => paused, (v) => { paused = v; });
toggle(ctl, 'slow ×0.25', () => slow < 1, (v) => { slow = v ? 0.25 : 1; });
toggle(ctl, 'hold enemies', () => hold, (v) => { hold = v; });
toggle(ctl, 'barrage', () => barrage, (v) => { barrage = v; });
toggle(ctl, 'post juice', () => post.enabled, (v) => { post.enabled = v; });
button(ctl, 'reset', () => { barrage = false; resetSim(); });
for (const c of ['director', 'low', 'side', 'high', 'top'] as const) button(ctl, `cam:${c}`, () => { camPreset = c; });
for (const [label, h] of [['dawn', 7], ['noon', 13], ['golden', 18.2], ['night', 22.5]] as const) button(ctl, label, () => { hour = h; });
for (const w of ['clear', 'storm', 'fog'] as const) button(ctl, w, () => { weather = w; });
for (const q of ['low', 'medium', 'high', 'ultra'] as const) button(ctl, `q:${q}`, () => { quality = q; });
for (const s of ['sunlion', 'dawn-ram', 'white-leviathan'] as const) button(ctl, s, () => { shipId = s; resetSim(); });

const ev = section('Events');
button(ev, 'broadside (manual)', () => { const p = P(); p.skills.broadside.cooldown = 0; aim = ahead(0, 100); sim.press('broadside'); });
button(ev, 'broadside port', () => { const p = P(); p.skills.broadside.cooldown = 0; aim = ahead(0, -100); sim.press('broadside'); });
button(ev, 'enemy broadside', () => { const e = enemy('frigate', 90, 0, false, P().heading); if (e) e.attackCooldown = 0; hold = true; });
button(ev, 'hull hit', () => { const e = enemy('brig', 60, 0); if (e) projectile('cannonball', 1, 4); });
button(ev, 'water splash', () => { const at = ahead(20, 60); inject({ type: 'projectile-hit', projectile: 'cannonball', team: 'player', x: at.x, y: 0, z: at.z, target: 'water', damage: 0, crit: false }); });
button(ev, 'island hit', () => { const at = ahead(20, 60); inject({ type: 'projectile-hit', projectile: 'cannonball', team: 'player', x: at.x, y: 3, z: at.z, target: 'island', damage: 0, crit: false }); });
for (const kind of ['small', 'medium', 'large', 'fire', 'powder', 'mine', 'mortar', 'lightning', 'water'] as const) {
  button(ev, `boom:${kind}`, () => { const at = ahead(10, 70); inject({ type: 'explosion', x: at.x, z: at.z, radius: 10, kind, team: 'player' }); });
}
button(ev, 'kill brig', () => kill(enemy('brig', 70, 10)));
button(ev, 'crit kill', () => kill(enemy('frigate', 70, 10), true));
button(ev, 'elite kill', () => kill(enemy('man-o-war', 90, 10, true)));
button(ev, 'lightning chain', () => {
  const e1 = enemy('skiff', 50, -30), e2 = enemy('skiff', 70, 10), e3 = enemy('cutter', 60, 50);
  const p = P();
  inject({ type: 'lightning', points: [{ x: p.x, z: p.z }, { x: e1!.x, z: e1!.z }, { x: e2!.x, z: e2!.z }, { x: e3!.x, z: e3!.z }], team: 'player' });
});
button(ev, 'storm strike', () => { const at = ahead(-20, 80); inject({ type: 'lightning-strike', x: at.x, z: at.z }); });
button(ev, 'player hit', () => { const p = P(); inject({ type: 'player-hit', amount: 18, x: p.x + 8, z: p.z, braced: false, parried: false }); });
button(ev, 'parry', () => { const p = P(); inject({ type: 'player-hit', amount: 0, x: p.x + 8, z: p.z, braced: true, parried: true }); });
button(ev, 'level-up', () => inject({ type: 'level-up', level: 2 }));
button(ev, 'tier-up', () => inject({ type: 'tier-up', tier: 1 }));
button(ev, 'chest opened', () => inject({ type: 'chest-opened', rewards: [] }));
button(ev, 'revived', () => inject({ type: 'revived' }));
button(ev, 'ram', () => { const at = ahead(20, 0); inject({ type: 'ram', attacker: 0, target: 1, damage: 60, x: at.x, z: at.z }); });
button(ev, 'collide island', () => { const at = ahead(20, 0); inject({ type: 'collision', a: 0, b: 'island', x: at.x, z: at.z, impulse: 40 }); });
button(ev, 'harpoon', () => { const e = enemy('brig', 60, 30); projectile('harpoon', 1, 1); if (e) { e.statuses.push({ kind: 'hooked', time: 6, magnitude: 1 }); inject({ type: 'harpoon', from: 0, to: e.id, x1: P().x, z1: P().z, x2: e.x, z2: e.z }); } });
button(ev, 'boss warning', () => inject({ type: 'boss-warning', boss: 'iron-warden', eta: 10 }));
button(ev, 'boss spawn', () => { const at = ahead(40, 180); sim.spawnBoss('iron-warden' as BossId, at.x, at.z, P().heading); });
button(ev, 'boss phase', () => { const b = sim.state.bosses[0]; if (b) inject({ type: 'boss-phase', boss: b.defId, id: b.id, phase: 1 }); });
button(ev, 'boss volley', () => { const b = sim.state.bosses[0]; if (b) inject({ type: 'boss-attack', boss: b.defId, id: b.id, attack: 'broadside-volley', x: b.x, z: b.z }); });
button(ev, 'boss defeated', () => { let b = sim.state.bosses[0]; if (!b) { const at = ahead(20, 120); b = sim.spawnBoss('iron-warden', at.x, at.z, P().heading); } sim.damageTarget(b, 1e9, { pierceArmor: true }); });
button(ev, 'player died', () => inject({ type: 'player-died', reviving: false }));

const sk = section('Skills');
button(sk, 'brace', () => skill('brace', 'brace'));
button(sk, 'boost', () => skill('boost', 'boost'));
for (const id of ['second-wind', 'lionburst', 'deep-dive', 'chefs-banquet', 'signal-flare', 'seaquake'] as const) button(sk, id, () => skill('special', id));
for (const id of ['ramming-speed', 'sunfire-barrage', 'torpedo-swarm', 'kitchen-inferno', 'admirals-judgment', 'tidal-colossus'] as const) button(sk, id, () => skill('ultimate', id));

const pr = section('Projectiles');
for (const k of ['cannonball', 'chain-shot', 'heavy-shot', 'chaser-shot', 'lance', 'mortar-shell', 'bomblet', 'swivel-shot', 'grapeshot', 'harpoon', 'rocket', 'torpedo', 'skiff-shot', 'water-bolt'] as ProjectileKind[]) button(pr, k, () => projectile(k, 1, 5));
for (const k of ['enemy-cannonball', 'enemy-chaser', 'enemy-mortar', 'boss-shell'] as ProjectileKind[]) button(pr, k, () => projectile(k, 1, 5, 'enemy'));

const hz = section('Hazards');
button(hz, 'fire-patch', () => hazard('fire-patch', 50, 0, 12, 10));
button(hz, 'barrel', () => hazard('barrel', 30, 10, 2, 10));
button(hz, 'powder-keg', () => hazard('powder-keg', 30, 18, 2, 10));
button(hz, 'mine', () => hazard('mine', 30, 26, 3, 10));
button(hz, 'whirlpool', () => hazard('whirlpool', 80, 0, 26, 10));
button(hz, 'storm-cloud', () => hazard('storm-cloud', 110, 0, 30, 12, { tick: 1.2 }));
button(hz, 'shockwave', () => hazard('shockwave', 0, 0, 80, 1.6));
button(hz, 'wave-front', () => hazard('wave-front', 0, -150, 90, 12, { vx: 0, vz: 12 }));
button(hz, 'lightning-strike', () => hazard('lightning-strike', 60, 20, 10, 2));
button(hz, 'burning-wreck', () => hazard('burning-wreck', 70, -20, 14, 10));
button(hz, 'escort-skiff', () => hazard('escort-skiff', 30, 0, 4, 10, { vx: 10, vz: 0 }));

const pk = section('Pickups');
for (const k of ['xp-copper', 'xp-silver', 'xp-gold', 'doubloon', 'repair', 'compass', 'powder-keg', 'chest'] as PickupKind[]) {
  button(pk, k, () => { for (let j = 0; j < 5; j++) { const at = ahead(-20 + j * 9, 60 + (j % 2) * 8); sim.spawnPickup(k, at.x, at.z, 1); } });
}
button(pk, 'magnet all', () => { for (const q of sim.state.pickups) if (q.alive) q.magnet = true; });

const tg = section('Telegraphs');
button(tg, 'circle', () => telegraph('circle', 50, 0, 14, 0, 0, 2.5));
button(tg, 'ring', () => telegraph('ring', 60, 0, 24, 12, 0, 2.5));
button(tg, 'line', () => telegraph('line', 120, -30, 8, 140, P().heading + Math.PI, 2.5));
button(tg, 'cone', () => telegraph('cone', 30, 30, 30, 60, P().heading + Math.PI / 2, 2.5));

// ───────────────────────── boot ─────────────────────────

declare global {
  interface Window {
    __FXLAB__?: {
      ready: boolean;
      scene(name: string): void;
      advance(seconds: number): void;
      stats(): unknown;
      perf(reset: boolean): unknown;
      set(opts: { hour?: number; weather?: SeaState['weather']; cam?: typeof camPreset; barrage?: boolean; quality?: QualityTier; juice?: boolean }): void;
      emit(label: string): void;
      fx: FxSystem;
    };
  }
}

async function boot(): Promise<void> {
  const handles = { renderer: host.renderer, scene: host.scene, camera: host.camera };
  for (const system of systems) await system.init(handles);
  await ships.preload('thousand-sunny').catch(() => undefined);
  window.__FXLAB__ = {
    ready: true,
    scene: (name) => { barrage = false; weather = 'clear'; seedFx(1234567); scenes[name]?.(); },
    advance: (seconds) => { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) tick(1 / 60); drawStats(); },
    stats: () => ({ metrics: host.getMetrics(), fx: { ...fx.stats }, fxDraws: fxDrawCalls(), juice: { ...fx.juice.last }, post: { ...post.counts } }),
    perf: (reset: boolean) => {
      if (reset) { perfFrames.length = 0; fxMs.length = 0; return null; }
      const sorted = [...perfFrames].sort((a, b) => a - b);
      const avg = perfFrames.reduce((a, b) => a + b, 0) / Math.max(1, perfFrames.length);
      const fxAvg = fxMs.reduce((a, b) => a + b, 0) / Math.max(1, fxMs.length);
      const fxSorted = [...fxMs].sort((a, b) => a - b);
      const s = sim.state;
      return {
        frames: perfFrames.length, fps: 1 / Math.max(1e-6, avg), p95ms: (sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 1000,
        worstMs: (sorted[sorted.length - 1] ?? 0) * 1000, fxUpdateMs: fxAvg, fxUpdateMaxMs: Math.max(0, ...fxMs),
        fxP50: fxSorted[Math.floor(fxSorted.length * 0.5)] ?? 0, fxP99: fxSorted[Math.floor(fxSorted.length * 0.99)] ?? 0,
        fxOver4ms: fxMs.filter((v) => v > 4).length, framesOver20ms: perfFrames.filter((v) => v > 0.02).length,
        projectiles: s.projectiles.filter((q) => q.alive).length, drawCalls: host.getMetrics().drawCalls, fxDraws: fxDrawCalls(),
        triangles: host.getMetrics().triangles, debris: fx.stats.debris,
      };
    },
    set: (o) => {
      if (o.hour !== undefined) hour = o.hour;
      if (o.weather) weather = o.weather;
      if (o.cam) camPreset = o.cam;
      if (o.barrage !== undefined) barrage = o.barrage;
      if (o.quality) quality = o.quality;
      if (o.juice !== undefined) post.enabled = o.juice;
    },
    emit: (label) => { for (const b of panel.querySelectorAll('button')) if (b.textContent === label) { (b as HTMLButtonElement).click(); return; } },
    fx,
  };
  const start = params.get('scene');
  if (start && scenes[start]) scenes[start]!();
  if (!manual) requestAnimationFrame(frame);
  else { tick(1 / 60); drawStats(); }
}

void boot();
