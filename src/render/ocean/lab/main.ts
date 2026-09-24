/**
 * Ocean lab (lab/ocean.html): the ocean alone with proxy boats sailing circles and figure-eights, a sinking
 * cycle, a sea serpent, hazards and two islands. Controls drive a fake atmosphere/sea state (time of day,
 * weather, wave scale, wind), camera presets, debug views of the interaction targets, click-to-splash and a
 * GPU benchmark. Query params: ?cam=tactical|hero|chase|top|orbit|horizon&hour=10&weather=clear&wave=0.8
 * &debug=0&quality=high&dpr=1.5&clean=1&fixed=1 (fixed = frames only advance through __OCEAN_LAB__.advance()).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { WeatherId } from '../../../game/ids';
import type { SimEvent } from '../../../game/types';
import type { FrameContext, QualityTier, RenderServices } from '../../frame';
import { GpuTimer } from '../GpuTimer';
import { OceanSystem } from '../OceanSystem';
import { applyLabSky, createAtmosphere, createSea, LabSky, WEATHER_PRESETS } from './labAtmosphere';
import { LabFleet } from './labFleet';
import { buildIslandMesh, LabWorld } from './labWorld';

type CameraMode = 'tactical' | 'hero' | 'chase' | 'top' | 'orbit' | 'horizon' | 'free';

const params = new URLSearchParams(location.search);
if (params.get('clean') === '1') document.body.classList.add('clean');

const state = {
  hour: Number(params.get('hour') ?? 10),
  weather: (params.get('weather') ?? 'clear') as WeatherId,
  wave: params.has('wave') ? Number(params.get('wave')) : NaN,
  windDir: 0.6,
  wind: NaN,
  cam: (params.get('cam') ?? 'tactical') as CameraMode,
  debug: Number(params.get('debug') ?? 0),
  quality: (params.get('quality') ?? 'high') as QualityTier,
  speed: 1,
  paused: false,
  fixed: params.get('fixed') === '1',
  yaw: 0,
};

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(Number(params.get('dpr') ?? Math.min(window.devicePixelRatio, 1.5)));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.2, 5000);
camera.position.set(0, 90, 150);
scene.fog = new THREE.Fog(0xa9dbef, 450, 2600);
const hemi = new THREE.HemisphereLight(0xbfe6ff, 0x2a4f6a, 1.1);
const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
scene.add(hemi, sun, sun.target);

const atmosphere = createAtmosphere();
const sea = createSea();
const sky = new LabSky();
scene.add(sky.mesh);
const world = new LabWorld();
for (const island of world.islands) scene.add(buildIslandMesh(island));
const fleet = new LabFleet(scene);
const ocean = new OceanSystem();
ocean.init({ renderer, scene, camera });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = state.cam === 'orbit';
controls.enableDamping = true;

const noop = () => {};
const services: RenderServices = {
  ocean,
  camera: { shake: noop, kick: noop, focusOn: noop },
  post: { impactFrame: noop, speedLines: noop, flash: noop, chromatic: noop },
  ships: { anchor: () => false, transform: () => false },
  requestSlowMo: noop,
};
const frameEvents: SimEvent[] = [];
const ctx: FrameContext = {
  time: 0, dt: 0, screen: 'run', run: fleet.run, events: frameEvents, sea, focus: { x: 0, z: 0, heading: 0, speed: 0 },
  menuShip: null, aim: { x: 0, z: 0 }, world, quality: state.quality,
  settings: { version: 2, masterVolume: 1, musicVolume: 1, sfxVolume: 1, muted: true, cameraShake: 1, damageNumbers: true, quality: 'high', showFps: false },
  viewport: { width: window.innerWidth, height: window.innerHeight, dpr: renderer.getPixelRatio() }, atmosphere, services,
};

// ───────────────────────────── Camera presets ─────────────────────────────
const target = new THREE.Vector3();
const desired = new THREE.Vector3();
const WHITE = new THREE.Color(0xffffff);
const freeEye = new THREE.Vector3(0, 120, 200);
const freeTarget = new THREE.Vector3();
function updateCamera(dt: number, snap: boolean): void {
  const h = fleet.hero;
  const fx = -Math.sin(h.heading);
  const fz = -Math.cos(h.heading);
  const rx = Math.cos(h.heading);
  const rz = -Math.sin(h.heading);
  const k = snap ? 1 : 1 - Math.exp(-dt * 3.5);
  controls.enabled = state.cam === 'orbit';
  switch (state.cam) {
    case 'tactical': {
      const ahead = Math.min(40, h.speed * 1.2);
      target.set(h.x + fx * ahead, 0, h.z + fz * ahead);
      const orbit = h.heading + state.yaw;
      const dist = 150;
      const pitch = 0.62;
      desired.set(target.x + Math.sin(orbit) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, target.z + Math.cos(orbit) * Math.cos(pitch) * dist);
      break;
    }
    case 'hero':
      target.set(h.x + fx * 6, 3, h.z + fz * 6);
      desired.set(h.x + fx * 52 - rx * 30, 13, h.z + fz * 52 - rz * 30);
      break;
    case 'chase':
      target.set(h.x + fx * 30, 0, h.z + fz * 30);
      desired.set(h.x - fx * 95 + rx * 20, 52, h.z - fz * 95 + rz * 20);
      break;
    case 'top':
      target.set(h.x, 0, h.z);
      desired.set(h.x + 0.01, 260, h.z + 0.01);
      break;
    case 'horizon': {
      const sd = atmosphere.sunDirection;
      const len = Math.hypot(sd.x, sd.z) || 1;
      target.set(h.x + (sd.x / len) * 400, 0, h.z + (sd.z / len) * 400);
      desired.set(h.x - (sd.x / len) * 40, 9, h.z - (sd.z / len) * 40);
      break;
    }
    case 'orbit':
      controls.target.lerp(desired.set(h.x, 0, h.z), k);
      controls.update();
      return;
    case 'free':
      camera.position.copy(freeEye);
      camera.lookAt(freeTarget);
      return;
  }
  camera.position.lerp(desired, k);
  camera.lookAt(target);
}

// ───────────────────────────── Frame ─────────────────────────────
let time = 0;
let fpsEma = 60;
let oceanUpdates = true;
function applySea(): void {
  const preset = WEATHER_PRESETS[state.weather];
  sea.weather = sea.nextWeather = state.weather;
  sea.blend = 1;
  sea.waveScale = Number.isFinite(state.wave) ? state.wave : preset.waveScale;
  sea.windStrength = Number.isFinite(state.wind) ? state.wind : preset.wind;
  sea.windDir = state.windDir;
  sea.fog = preset.fog;
  sea.rain = preset.rain;
}

function frame(dt: number, snapCamera = false): void {
  const simDt = state.paused ? 0 : dt;
  time += dt;
  applySea();
  applyLabSky(atmosphere, sea, state.hour, time);
  fleet.step(simDt);
  frameEvents.length = 0;
  for (const e of fleet.events) frameEvents.push(e);
  fleet.events.length = 0;
  const h = fleet.hero;
  ctx.time = time;
  ctx.dt = dt;
  ctx.quality = state.quality;
  (fleet.run as { status: string }).status = state.paused ? 'paused' : 'running';
  ctx.focus.x = h.x; ctx.focus.z = h.z; ctx.focus.heading = h.heading; ctx.focus.speed = h.speed;
  ctx.viewport.width = window.innerWidth; ctx.viewport.height = window.innerHeight;
  if (oceanUpdates) ocean.update(ctx);
  fleet.place(ocean);
  updateCamera(dt, snapCamera);
  sky.update(atmosphere, camera.position);
  hemi.color.copy(atmosphere.skyColor).lerp(WHITE, 0.5);
  hemi.intensity = THREE.MathUtils.lerp(1.15, 0.4, atmosphere.night);
  sun.color.copy(atmosphere.sunColor);
  sun.intensity = atmosphere.sunIntensity;
  sun.position.set(h.x, 0, h.z).addScaledVector(atmosphere.sunDirection, 400);
  sun.target.position.set(h.x, 0, h.z);
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(atmosphere.fogColor); fog.near = atmosphere.fogNear; fog.far = atmosphere.fogFar;
  ocean.setDebugView(state.debug);
  if (frameTiming) { frameTimer.poll(); frameTimer.begin('frame'); }
  renderer.render(scene, camera);
  if (frameTiming) frameTimer.end('frame');
}

let last = performance.now();
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (dt > 0) fpsEma += (1 / dt - fpsEma) * 0.05;
  if (!state.fixed) frame(dt);
  if (!document.body.classList.contains('clean')) renderStats();
}

// ───────────────────────────── UI ─────────────────────────────
const panel = document.getElementById('panel')!;
const statsEl = document.getElementById('stats')!;
function slider(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): void {
  const row = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = 'range'; input.min = `${min}`; input.max = `${max}`; input.step = `${step}`; input.value = `${get()}`;
  const value = document.createElement('span');
  value.textContent = get().toFixed(step < 1 ? 2 : 0);
  input.addEventListener('input', () => { set(Number(input.value)); value.textContent = get().toFixed(step < 1 ? 2 : 0); });
  row.append(text, input, value);
  panel.append(row);
}
function select<T extends string>(label: string, options: readonly T[], get: () => T, set: (v: T) => void): void {
  const row = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('select');
  for (const o of options) { const opt = document.createElement('option'); opt.value = o; opt.textContent = o; input.append(opt); }
  input.value = get();
  input.addEventListener('change', () => set(input.value as T));
  row.append(text, input, document.createElement('span'));
  panel.append(row);
}
function button(label: string, action: () => void, parent: HTMLElement): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', action);
  parent.append(b);
}
const title = document.createElement('h1');
title.textContent = 'OCEAN LAB';
panel.append(title);
slider('time of day', 0, 24, 0.1, () => state.hour, (v) => { state.hour = v; });
select('weather', ['clear', 'breezy', 'storm', 'fog'] as const, () => state.weather, (v) => { state.weather = v; state.wave = NaN; state.wind = NaN; });
slider('wave scale', 0, 2.2, 0.05, () => sea.waveScale, (v) => { state.wave = v; });
slider('wind dir', -3.14, 3.14, 0.05, () => state.windDir, (v) => { state.windDir = v; });
slider('wind', 0, 1, 0.05, () => sea.windStrength, (v) => { state.wind = v; });
slider('boat speed', 0, 2, 0.05, () => state.speed, (v) => { state.speed = v; fleet.speedMul = v; });
select('camera', ['tactical', 'hero', 'chase', 'top', 'orbit', 'horizon'] as const, () => state.cam, (v) => { state.cam = v; });
select('debug', ['0 off', '1 transient', '2 persistent', '3 shore'] as const, () => `${state.debug} ${['off', 'transient', 'persistent', 'shore'][state.debug]}` as '0 off', (v) => { state.debug = Number(v[0]); });
select('quality', ['low', 'medium', 'high', 'ultra'] as const, () => state.quality, (v) => { state.quality = v; });
const row = document.createElement('div');
row.className = 'row';
panel.append(row);
button('jump', () => fleet.jump(), row);
button('wave front', () => fleet.waveFront(), row);
button('pause', () => { state.paused = !state.paused; }, row);
button('bench', () => { void bench().then((r) => console.log('bench', r)); }, row);
const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent = 'Click the water: splash. Shift+click: explosion.';
panel.append(hint);

function renderStats(): void {
  const s = ocean.stats();
  const info = renderer.info.render;
  const gpu = Object.entries(s.gpu).map(([k, v]) => `${k} ${v.toFixed(2)}ms`).join('  ');
  statsEl.textContent = `fps ${fpsEma.toFixed(0)}  calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\n`
    + `particles ${s.particles}  effects ${s.effects}\nstamps T${s.transientStamps} P${s.persistentStamps}  shore ${s.shoreSettled ? 'ok' : '…'}\n${gpu}`;
}

// Click to splash.
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
renderer.domElement.addEventListener('click', (event) => {
  if (state.cam === 'orbit' && event.detail > 1) return;
  const ndc = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(plane, hit)) return;
  splash(hit.x, hit.z, event.shiftKey);
});
function splash(x: number, z: number, big: boolean): void {
  if (big) fleet.events.push({ type: 'explosion', x, z, radius: 16, kind: 'large', team: 'player' });
  else fleet.events.push({ type: 'projectile-hit', projectile: 'cannonball', team: 'player', x, y: 0, z, target: 'water', damage: 0, crit: false });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ───────────────────────────── Automation / bench ─────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frameTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
let frameTiming = false;

/**
 * GPU cost of the ocean, measured with EXT_disjoint_timer_query_webgl2 while the lab runs vsync-paced (a tight
 * loop backs the GPU queue up and inflates timestamps). Phase 1 times the interaction passes and the surface
 * draw; phase 2 times whole frames with the ocean on vs hidden vs fully off.
 */
async function bench(seconds = 4): Promise<Record<string, unknown>> {
  const had = state.fixed;
  state.fixed = false;
  const mesh = ocean.mesh!;
  const available = ocean.enableGpuTiming(true);
  ocean.resetGpuTiming();
  await sleep(seconds * 1000);
  const passes = { ...ocean.stats().gpu };
  ocean.enableGpuTiming(false);
  const phase = async (visible: boolean, updates: boolean) => {
    mesh.visible = visible;
    oceanUpdates = updates;
    frameTimer.reset();
    frameTiming = true;
    await sleep(seconds * 500);
    frameTiming = false;
    return frameTimer.ms.frame ?? NaN;
  };
  const full = await phase(true, true);
  const hidden = await phase(false, true);
  const off = await phase(false, false);
  mesh.visible = true;
  oceanUpdates = true;
  state.fixed = had;
  const s = ocean.stats();
  const r = (v: number) => +v.toFixed(3);
  return {
    timerQuery: available,
    passesMs: Object.fromEntries(Object.entries(passes).map(([k, v]) => [k, r(v)])),
    frameMs: { full: r(full), surfaceHidden: r(hidden), oceanOff: r(off) },
    oceanMs: { surface: r(full - hidden), interaction: r(hidden - off), total: r(full - off) },
    particles: s.particles, stamps: [s.transientStamps, s.persistentStamps], size: [renderer.domElement.width, renderer.domElement.height],
    fps: +fpsEma.toFixed(1),
  };
}

declare global {
  interface Window { __OCEAN_LAB__?: unknown }
}
window.__OCEAN_LAB__ = {
  get state() { return state; },
  set(patch: Partial<typeof state>) { Object.assign(state, patch); fleet.speedMul = state.speed; },
  advance(seconds: number, snap = true) {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) frame(1 / 60, snap && i === frames - 1);
  },
  splash,
  /** Fixed camera: eye and target in world space. */
  view(ex: number, ey: number, ez: number, tx: number, ty: number, tz: number) { state.cam = 'free'; freeEye.set(ex, ey, ez); freeTarget.set(tx, ty, tz); },
  explode: (x: number, z: number, radius = 16) => fleet.events.push({ type: 'explosion', x, z, radius, kind: 'large', team: 'player' }),
  jump: () => fleet.jump(),
  waveFront: () => fleet.waveFront(),
  bench,
  hero: () => ({ ...fleet.hero }),
  ocean,
};

frame(1 / 60, true);
requestAnimationFrame(loop);
