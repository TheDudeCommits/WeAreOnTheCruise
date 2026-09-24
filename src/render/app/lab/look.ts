/**
 * LOOK lab (lab/look.html): the six hero GLBs on the real ocean, lit by the sky system, drawn through the post stack.
 * Toggles for time of day, weather, quality, camera, ink/bloom/grade, ShipTint, and buttons for every PostService.
 * URL: ?hour=17.6&weather=storm&quality=high&cam=showcase|tactical|fleet&ship=sunlion&ui=0&play=0
 * QA hook: window.__LOOK__ (see LookLabApi).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SHIPS } from '../../../game/content';
import type { HeroModelKey, ShipId, WeatherId } from '../../../game/ids';
import type { SeaState, Settings } from '../../../game/types';
import { IslandField } from '../../../world/IslandField';
import { CameraDirector } from '../../camera/CameraDirector';
import type { AppScreen, AtmosphereState, FrameContext, QualityTier, RenderServices } from '../../frame';
import {
  HERO_TOON_PRESETS, createToonMaterial, ensureInstanceTint, markInk, setInstanceTint, setShipTint, toonifyObject,
} from '../../materials/toon';
import { OceanSystem } from '../../ocean/OceanSystem';
import { SkySystem } from '../../sky/SkySystem';
import { WorldVisuals } from '../../world/WorldVisuals';
import { PostStack } from '../PostStack';
import { RendererHost } from '../RendererHost';

type CamMode = 'showcase' | 'tactical' | 'fleet' | 'sky';

/** Lengths the downloaded GLBs were normalized to at intake (metres). */
const SOURCE_LENGTH: Record<HeroModelKey, number> = {
  'going-merry': 34, 'thousand-sunny': 56, 'polar-tang': 52, baratie: 74, 'navy-galleon': 70, 'moby-dick': 122,
};
const SHIP_ORDER: ShipId[] = ['dawn-ram', 'sunlion', 'yellowfin', 'grand-galley', 'seawarden', 'white-leviathan'];

const WEATHER: Record<WeatherId, { waveScale: number; wind: number; rain: number; fog: number }> = {
  clear: { waveScale: 0.8, wind: 0.45, rain: 0, fog: 0 },
  breezy: { waveScale: 1.1, wind: 0.7, rain: 0, fog: 0 },
  storm: { waveScale: 1.7, wind: 1, rain: 1, fog: 0 },
  fog: { waveScale: 0.7, wind: 0.25, rain: 0, fog: 1 },
};

interface HeroSlot { id: ShipId; root: THREE.Group; loaded: boolean; x: number; z: number; heading: number }

const params = new URLSearchParams(location.search);
const root = document.getElementById('lab-root')!;
const host = new RendererHost(root, params.get('capture') === '1', params.get('quality') === 'low');
const post = new PostStack(host.renderer);
const sky = new SkySystem();
const ocean = new OceanSystem();
const world = new IslandField(params.get('seed') ?? 'look-lab');
const worldVisuals = new WorldVisuals();
const cameraDirector = new CameraDirector();
const scene = host.scene;
const camera = host.camera;

let quality: QualityTier = (['low', 'medium', 'high', 'ultra'] as const).find((q) => q === params.get('quality')) ?? 'high';
let camMode: CamMode = (['showcase', 'tactical', 'fleet', 'sky'] as const).find((c) => c === params.get('cam')) ?? 'showcase';
let selected: ShipId = (SHIP_ORDER.find((s) => s === params.get('ship')) ?? 'sunlion');
let hour = Number(params.get('hour') ?? 16.8);
let playing = params.get('play') === '1';
let weather: WeatherId = (['clear', 'breezy', 'storm', 'fog'] as const).find((w) => w === params.get('weather')) ?? 'clear';
let time = 0;
let lightningTimer = 2;
let tint = { flash: false, glow: false, spectral: false };

const sea: SeaState = {
  weather, nextWeather: weather, blend: 1, waveScale: WEATHER[weather].waveScale, windDir: 0.6, windStrength: WEATHER[weather].wind,
  timeOfDay: hour, fog: WEATHER[weather].fog, rain: WEATHER[weather].rain, lightningSerial: 0,
};
const settings: Settings = {
  version: 2, masterVolume: 0, musicVolume: 0, sfxVolume: 0, muted: true, cameraShake: 1, damageNumbers: false, quality: 'auto', showFps: false,
};
const atmosphere: AtmosphereState = {
  sunDirection: new THREE.Vector3(0.4, 0.8, 0.3), sunColor: new THREE.Color(), sunIntensity: 1, ambientColor: new THREE.Color(),
  skyColor: new THREE.Color(), horizonColor: new THREE.Color(), fogColor: new THREE.Color(), fogNear: 300, fogFar: 2600,
  night: 0, storm: 0, flash: 0,
};
const tmpMatrix = new THREE.Matrix4();
const services: RenderServices = {
  ocean,
  camera: cameraDirector,
  post,
  ships: {
    anchor: (id, _name, out) => { const slot = slots[id]; if (!slot) return false; out.set(slot.x, 4, slot.z); return true; },
    transform: (id, out) => { const slot = slots[id]; if (!slot) return false; out.copy(slot.root.matrixWorld); return true; },
  },
  requestSlowMo: () => undefined,
};

// ───────────── Heroes ─────────────
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const slots: HeroSlot[] = SHIP_ORDER.map((id, i) => {
  const group = new THREE.Group();
  group.name = `hero:${id}`;
  scene.add(group);
  const angle = (i / SHIP_ORDER.length) * Math.PI * 2;
  return { id, root: group, loaded: false, x: Math.cos(angle) * 150, z: Math.sin(angle) * 150, heading: angle + Math.PI * 0.5 };
});

async function loadHero(slot: HeroSlot): Promise<void> {
  const def = SHIPS[slot.id];
  const gltf = await loader.loadAsync(`/assets/sketchfab/${def.modelKey}.glb`);
  const model = gltf.scene;
  toonifyObject(model, { keepMaps: true, tintable: true, ...HERO_TOON_PRESETS[def.modelKey] });
  model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  markInk(model);
  const holder = new THREE.Group();
  holder.scale.setScalar(def.length / SOURCE_LENGTH[def.modelKey]);
  holder.add(model);
  slot.root.add(holder);
  slot.loaded = true;
}

// ───────────── Instanced fleet (ink + ShipTint on InstancedMesh) ─────────────
function buildBrigGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const colored = (geo: THREE.BufferGeometry, color: number) => {
    const c = new THREE.Color(color);
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo.index ? geo.toNonIndexed() : geo;
  };
  const hull = new THREE.CylinderGeometry(3.2, 2.2, 18, 10, 1).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0, 1.2, 0);
  parts.push(colored(hull, 0xf1f3f6));
  const trim = new THREE.BoxGeometry(6.6, 0.6, 17).translate(0, 2.6, 0);
  parts.push(colored(trim, 0x2a4d9c));
  const mast = new THREE.CylinderGeometry(0.3, 0.35, 16, 6).translate(0, 10, 0);
  parts.push(colored(mast, 0x6b4a2e));
  const sail = new THREE.BoxGeometry(9, 7, 0.3).translate(0, 11, -0.5);
  parts.push(colored(sail, 0xf7f3e8));
  const flag = new THREE.BoxGeometry(2.4, 1.4, 0.1).translate(1.2, 17.8, 0);
  parts.push(colored(flag, 0x2a4d9c));
  let vertexCount = 0;
  for (const p of parts) vertexCount += p.getAttribute('position').count;
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color'] as const) {
    const size = name === 'position' || name === 'normal' || name === 'color' ? 3 : 2;
    const data = new Float32Array(vertexCount * size);
    let offset = 0;
    for (const p of parts) { const a = p.getAttribute(name).array as Float32Array; data.set(a, offset); offset += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  return merged;
}
const FLEET = 48;
const fleet = new THREE.InstancedMesh(buildBrigGeometry(), createToonMaterial({ vertexColors: true, tintable: true, rim: 0.3, name: 'lab-brig' }), FLEET);
fleet.name = 'lab-fleet';
fleet.castShadow = true; fleet.receiveShadow = true;
ensureInstanceTint(fleet);
markInk(fleet);
fleet.count = 0;
scene.add(fleet);
let fleetCount = Number(params.get('fleet') ?? 0);

// ───────────── Skinned test (ink + cel on SkinnedMesh) ─────────────
function buildSkinned(): THREE.SkinnedMesh {
  const height = 14, segments = 12;
  const geo = new THREE.CylinderGeometry(1.2, 1.8, height, 10, segments, false).translate(0, height / 2, 0);
  const pos = geo.getAttribute('position');
  const skinIndex: number[] = [], skinWeight: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / height * 2; // 0..2 across two bones
    const b = Math.min(1, Math.floor(y));
    const w = y - b;
    skinIndex.push(b, Math.min(2, b + 1), 0, 0);
    skinWeight.push(1 - w, w, 0, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  bones[1]!.position.y = height / 2; bones[2]!.position.y = height / 2;
  bones[0]!.add(bones[1]!); bones[1]!.add(bones[2]!);
  const mesh = new THREE.SkinnedMesh(geo, createToonMaterial({ color: 0xe0634a, rim: 0.6, name: 'lab-skinned' }));
  mesh.add(bones[0]!);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  markInk(mesh);
  return mesh;
}
const skinned = buildSkinned();
skinned.name = 'lab-skinned';
scene.add(skinned);

// ───────────── Frame ─────────────
function focusSlot(): HeroSlot { return slots[SHIP_ORDER.indexOf(selected)]!; }

function updateSea(dt: number): void {
  if (playing) hour = (hour + dt * 0.25) % 24;
  sea.timeOfDay = hour;
  const target = WEATHER[weather];
  const k = 1 - Math.exp(-dt * 0.8);
  sea.waveScale += (target.waveScale - sea.waveScale) * k;
  sea.windStrength += (target.wind - sea.windStrength) * k;
  sea.rain += (target.rain - sea.rain) * k;
  sea.fog += (target.fog - sea.fog) * k;
  sea.weather = weather; sea.nextWeather = weather; sea.blend = 1;
  if (sea.rain > 0.6) {
    lightningTimer -= dt;
    if (lightningTimer <= 0) { sea.lightningSerial++; lightningTimer = 3 + Math.random() * 4; }
  }
}

const shipPos = new THREE.Vector3();
const normal = new THREE.Vector3();
function updateShips(ctx: FrameContext): void {
  const t = ctx.time;
  const sailing = camMode === 'tactical';
  const orbitR = 420;
  const centerAngle = sailing ? t * 0.03 : 0;
  slots.forEach((slot, i) => {
    if (sailing) {
      // Formation sailing along a large circle.
      const lane = (i - 2.5) * 70;
      const a = centerAngle + (i % 2 ? 0.08 : -0.08) * Math.floor(i / 2);
      const r = orbitR + lane * 0.3;
      slot.x = Math.cos(a) * r + lane * 0.2;
      slot.z = Math.sin(a) * r;
      slot.heading = -a;
    } else if (camMode === 'fleet') {
      slot.x = (i - 2.5) * 95; slot.z = 0; slot.heading = Math.PI * 0.5;
    } else {
      const angle = (i / slots.length) * Math.PI * 2;
      slot.x = Math.cos(angle) * 180; slot.z = Math.sin(angle) * 180; slot.heading = angle + Math.PI * 0.5;
      if (slot.id === selected) { slot.x = 0; slot.z = 0; slot.heading = 0.4; }
    }
    const y = ocean.heightAt(slot.x, slot.z);
    ocean.normalAt(slot.x, slot.z, normal);
    slot.root.position.set(slot.x, y, slot.z);
    slot.root.rotation.set(normal.z * 0.35, slot.heading, -normal.x * 0.35, 'YXZ');
    const pulse = tint.flash ? Math.max(0, Math.sin(t * 5)) ** 6 : 0;
    setShipTint(slot.root, { flash: pulse, glowStrength: tint.glow ? 0.8 : 0, spectral: tint.spectral ? 1 : 0 });
  });
  // Instanced fleet ring around the focus.
  const focus = ctx.focus;
  fleet.count = fleetCount;
  for (let i = 0; i < fleetCount; i++) {
    const a = (i / Math.max(1, fleetCount)) * Math.PI * 2 + t * 0.05;
    const r = 120 + (i % 4) * 28;
    const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
    shipPos.set(x, ocean.heightAt(x, z), z);
    tmpMatrix.makeRotationY(-a).setPosition(shipPos);
    fleet.setMatrixAt(i, tmpMatrix);
    const hit = Math.max(0, Math.sin(t * 3 + i * 1.7)) ** 12;
    setInstanceTint(fleet, i, hit, i % 7 === 0 ? 0.9 : 0, i % 11 === 5 ? 1 : 0);
  }
  fleet.instanceMatrix.needsUpdate = true;
  // Skinned test beside the focus.
  skinned.position.set(focus.x + 40, ocean.heightAt(focus.x + 40, focus.z + 25) - 1, focus.z + 25);
  const bones = skinned.skeleton.bones;
  bones[1]!.rotation.z = Math.sin(t * 1.4) * 0.5;
  bones[2]!.rotation.z = Math.sin(t * 1.4 + 0.8) * 0.7;
}

let last = performance.now();
let screen: AppScreen = 'title';
function tick(dt: number): void {
  time += dt;
  updateSea(dt);
  const slot = focusSlot();
  screen = camMode === 'showcase' ? 'title' : 'run';
  const fleetCenter = camMode === 'fleet';
  const focus = fleetCenter ? { x: 0, z: 0, heading: Math.PI * 0.5, speed: 0 } : { x: slot.x, z: slot.z, heading: slot.heading, speed: camMode === 'tactical' ? 12 : 0 };
  const viewport = host.getViewport();
  const ctx: FrameContext = {
    time, dt, screen, run: null, events: [], sea, focus, menuShip: selected, aim: { x: focus.x, z: focus.z - 100 }, world,
    quality, settings, viewport: { width: viewport.width, height: viewport.height, dpr: host.renderer.getPixelRatio() }, atmosphere, services,
  };
  sky.update(ctx);
  ocean.update(ctx);
  worldVisuals.update(ctx);
  updateShips(ctx);
  cameraDirector.update(ctx);
  if (camMode === 'sky') {
    // Sky review: low eye point looking at the cloud ring and the horizon, slowly panning.
    const az = time * 0.05 + skyYaw;
    camera.position.set(focus.x, 26, focus.z);
    camera.lookAt(focus.x + Math.sin(az) * 1000, 26 + skyPitch * 1000, focus.z + Math.cos(az) * 1000);
    camera.fov = 55; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  post.update(ctx);
  host.render(() => post.render(scene, camera));
}
let skyYaw = Number(params.get('yaw') ?? 0);
let skyPitch = Number(params.get('pitch') ?? 0.18);

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  tick(dt);
  updateStats(now);
}

// ───────────── UI ─────────────
const panel = document.getElementById('lab-panel')!;
if (params.get('ui') === '0') panel.style.display = 'none';
const stats = document.getElementById('lab-stats')!;
let lastStats = 0;
function updateStats(now: number): void {
  if (now - lastStats < 500) return;
  lastStats = now;
  const m = host.getMetrics();
  stats.textContent = `${m.fps.toFixed(0)} fps · p90 ${m.frameP90.toFixed(1)} ms · gpu ${m.gpuMs?.toFixed(1) ?? 'n/a'} ms · ${m.drawCalls} draws · ${(m.triangles / 1000).toFixed(0)}k tris · dpr ${m.dpr.toFixed(2)} (${m.tier}) · ${m.width}×${m.height} · h ${hour.toFixed(1)}`;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
function select<T extends string>(label: string, options: readonly T[], value: T, onChange: (v: T) => void): HTMLLabelElement {
  const l = document.createElement('label');
  l.textContent = label;
  const s = document.createElement('select');
  for (const o of options) { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; s.append(opt); }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  l.append(s);
  return l;
}
function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
  const l = document.createElement('label');
  const c = document.createElement('input');
  c.type = 'checkbox'; c.checked = value;
  c.addEventListener('change', () => onChange(c.checked));
  l.append(c, document.createTextNode(` ${label}`));
  return l;
}

const hourLabel = document.createElement('label');
hourLabel.textContent = 'Hour ';
const hourInput = document.createElement('input');
hourInput.type = 'range'; hourInput.min = '0'; hourInput.max = '24'; hourInput.step = '0.05'; hourInput.value = String(hour);
hourInput.addEventListener('input', () => { hour = Number(hourInput.value); });
hourLabel.append(hourInput);
const presets = document.createElement('div');
for (const [name, h] of [['dawn', 6.5], ['noon', 12.4], ['golden', 17.6], ['dusk', 18.9], ['night', 22]] as const) {
  presets.append(button(name, () => { hour = h; hourInput.value = String(h); }));
}
panel.append(
  hourLabel, presets,
  toggle('time flows', playing, (v) => { playing = v; }),
  select('Weather', ['clear', 'breezy', 'storm', 'fog'] as const, weather, (v) => { weather = v; }),
  select('Quality', ['low', 'medium', 'high', 'ultra'] as const, quality, (v) => { quality = v; }),
  select('Camera', ['showcase', 'tactical', 'fleet', 'sky'] as const, camMode, (v) => { camMode = v; cameraDirector.resetView(); }),
  select('Ship', SHIP_ORDER, selected, (v) => { selected = v; }),
  select('Enemy fleet', ['0', '12', '24', '48'] as const, String(fleetCount) as '0', (v) => { fleetCount = Number(v); }),
  toggle('ink', true, (v) => { post.overrides.ink = v; }),
  toggle('bloom', true, (v) => { post.overrides.bloom = v; }),
  toggle('grade', true, (v) => { post.overrides.grade = v ? undefined : false; }),
  toggle('hit flash', false, (v) => { tint.flash = v; }),
  toggle('elite glow', false, (v) => { tint.glow = v; }),
  toggle('spectral', false, (v) => { tint.spectral = v; }),
  (() => {
    const row = document.createElement('div');
    row.append(
      button('impact', () => post.impactFrame(1)),
      button('speed lines', () => post.speedLines(1, 1.4)),
      button('flash', () => post.flash(0xfff1d0, 0.8, 0.25)),
      button('chromatic', () => post.chromatic(1, 0.35)),
      button('shake', () => cameraDirector.shake(1, 0.5)),
      button('kick', () => cameraDirector.kick(6, 0.4)),
      button('lightning', () => { sea.lightningSerial++; }),
      button('focus', () => cameraDirector.focusOn(focusSlot().x + 220, focusSlot().z - 120, 3)),
    );
    return row;
  })(),
);

// ───────────── QA hook ─────────────
export interface LookLabApi {
  ready: boolean;
  loaded(): number;
  set(opts: Partial<{ yaw: number; pitch: number; hour: number; weather: WeatherId; quality: QualityTier; cam: CamMode; ship: ShipId; fleet: number; ink: boolean; bloom: boolean; grade: boolean; flash: boolean; glow: boolean; spectral: boolean; dpr: number }>): void;
  advance(seconds: number): void;
  impact(strength?: number): void;
  speed(strength?: number, duration?: number): void;
  flash(): void;
  chromatic(): void;
  strike(): void;
  metrics(): unknown;
}
const api: LookLabApi = {
  ready: false,
  loaded: () => slots.filter((s) => s.loaded).length,
  set(opts) {
    if (opts.yaw !== undefined) skyYaw = opts.yaw;
    if (opts.pitch !== undefined) skyPitch = opts.pitch;
    if (opts.hour !== undefined) { hour = opts.hour; hourInput.value = String(hour); }
    if (opts.weather) {
      weather = opts.weather;
      const w = WEATHER[weather];
      sea.waveScale = w.waveScale; sea.windStrength = w.wind; sea.rain = w.rain; sea.fog = w.fog;
    }
    if (opts.quality) quality = opts.quality;
    if (opts.cam) camMode = opts.cam;
    if (opts.ship) selected = opts.ship;
    if (opts.fleet !== undefined) fleetCount = Math.min(FLEET, opts.fleet);
    if (opts.ink !== undefined) post.overrides.ink = opts.ink;
    if (opts.bloom !== undefined) post.overrides.bloom = opts.bloom;
    if (opts.grade !== undefined) post.overrides.grade = opts.grade ? undefined : false;
    if (opts.flash !== undefined) tint.flash = opts.flash;
    if (opts.glow !== undefined) tint.glow = opts.glow;
    if (opts.spectral !== undefined) tint.spectral = opts.spectral;
    if (opts.dpr !== undefined) { host.setAdaptiveQualityEnabled(false); host.setPixelRatio(opts.dpr, true); }
  },
  advance(seconds) { const frames = Math.round(seconds * 60); for (let i = 0; i < frames; i++) tick(1 / 60); },
  impact: (s = 1) => post.impactFrame(s),
  speed: (s = 1, d = 1.4) => post.speedLines(s, d),
  flash: () => post.flash(0xfff1d0, 0.8, 0.25),
  chromatic: () => post.chromatic(1, 0.35),
  strike: () => { sea.lightningSerial++; },
  metrics: () => ({ ...host.getMetrics(), inked: post.ink.lastInked, occluders: post.ink.lastOccluders }),
};
(window as unknown as { __LOOK__: LookLabApi }).__LOOK__ = api;

async function start(): Promise<void> {
  const handles = { renderer: host.renderer, scene, camera };
  for (const system of [sky, ocean, worldVisuals, cameraDirector]) await system.init(handles);
  await Promise.all(slots.map((slot) => loadHero(slot).catch((error: unknown) => console.error(`hero ${slot.id} failed`, error))));
  await post.precompile(scene, camera);
  api.ready = true;
  document.body.dataset.ready = '1';
  last = performance.now();
  requestAnimationFrame(frame);
}
void start();
