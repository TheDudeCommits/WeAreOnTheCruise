/**
 * World lab (lab/world.html): fly around one feature per biome/landmark with the real sky and ocean systems,
 * switch time of day/weather, and overlay the collision polygons (or slice the terrain at the waterline) to prove
 * that visuals and collision agree.
 *
 * URL: ?view=<showcase>&cam=hero|tactical|top&tod=day|golden|night|storm|fog&overlay=1&slice=1&lod=0|1|2&ui=0
 * Automation: window.__WORLD_LAB__ (see bottom).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SeaState, Settings } from '../../../game/types';
import type { WeatherId } from '../../../game/ids';
import { PostStack } from '../../app/PostStack';
import { RendererHost } from '../../app/RendererHost';
import type { AppScreen, AtmosphereState, FrameContext, RenderServices, RenderSystem } from '../../frame';
import { OceanSystem } from '../../ocean/OceanSystem';
import { SkySystem } from '../../sky/SkySystem';
import { WorldVisuals } from '../WorldVisuals';
import { buildShowcaseWorld, SHOWCASES } from './showcase';

type Tod = 'day' | 'golden' | 'night' | 'storm' | 'fog';
type CamMode = 'hero' | 'tactical' | 'top';

const TODS: Record<Tod, { hour: number; weather: WeatherId; fog: number; rain: number; wave: number }> = {
  day: { hour: 11.5, weather: 'clear', fog: 0, rain: 0, wave: 0.8 },
  golden: { hour: 17.3, weather: 'clear', fog: 0, rain: 0, wave: 0.8 },
  night: { hour: 22.5, weather: 'clear', fog: 0, rain: 0, wave: 0.8 },
  storm: { hour: 14, weather: 'storm', fog: 0, rain: 1, wave: 1.6 },
  fog: { hour: 8.5, weather: 'fog', fog: 1, rain: 0, wave: 0.7 },
};

const params = new URLSearchParams(location.search);
const root = document.getElementById('lab-root')!;
if (params.get('ui') === '0') document.body.classList.add('clean');

const host = new RendererHost(root, params.get('capture') === '1', false);
const post = new PostStack(host.renderer);
const scene = host.scene;
const camera = host.camera;
const sky = new SkySystem();
const ocean = new OceanSystem();
const world = new WorldVisuals();
const { world: labWorld, features } = buildShowcaseWorld();

const sea: SeaState = { weather: 'clear', nextWeather: 'clear', blend: 1, waveScale: 0.8, windDir: 0.6, windStrength: 0.5, timeOfDay: 11.5, fog: 0, rain: 0, lightningSerial: 0 };
const settings: Settings = { version: 2, masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, muted: true, cameraShake: 1, damageNumbers: true, quality: 'high', showFps: false };
const atmosphere: AtmosphereState = {
  sunDirection: new THREE.Vector3(0.4, 0.8, 0.3), sunColor: new THREE.Color(0xfff2cf), sunIntensity: 2, ambientColor: new THREE.Color(0xbfdcff),
  skyColor: new THREE.Color(0x1a6fd0), horizonColor: new THREE.Color(0xa9dbef), fogColor: new THREE.Color(0xa9dbef),
  fogNear: 400, fogFar: 2400, night: 0, storm: 0, flash: 0,
};
const noop = () => undefined;
const services: RenderServices = {
  ocean,
  camera: { shake: noop, kick: noop, focusOn: noop },
  post,
  ships: { anchor: () => false, transform: () => false },
  requestSlowMo: noop,
};

const systems: RenderSystem[] = [sky, ocean, world];
const before = new Set(scene.children);
const handles = { renderer: host.renderer, scene, camera };
for (const s of systems) await s.init(handles);
const oceanObjects = scene.children.filter((o) => !before.has(o) && o.name !== 'world');
// Lab only: the v2 sky stub leaves shadow bias at 0, which paints acne stripes on steep cliffs. LOOK owns the real
// light setup; only patch it here when it is still unset.
scene.traverse((o) => {
  const light = o as THREE.DirectionalLight;
  if (light.isDirectionalLight && light.shadow.normalBias === 0 && light.shadow.bias === 0) { light.shadow.normalBias = 0.6; light.shadow.bias = -0.0004; }
});

const controls = new OrbitControls(camera, host.renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
camera.far = 6000;
camera.updateProjectionMatrix();

// Collision overlay: every island outline, drawn on top.
const overlay = new THREE.Group();
overlay.name = 'collision-overlay';
const overlayMat = new THREE.LineBasicMaterial({ color: 0xff2d55, depthTest: false, transparent: true });
for (const f of features.values()) {
  for (const island of f.islands) {
    const pts = island.outline.map((p) => new THREE.Vector3(p.x, 0.45, p.z));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), overlayMat);
    line.renderOrder = 999;
    overlay.add(line);
  }
}
overlay.visible = false;
scene.add(overlay);
const slicePlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.6);

let screen: AppScreen = 'run';
let time = 0;
let current = params.get('view') ?? 'tropical';
let camMode: CamMode = (params.get('cam') as CamMode) ?? 'hero';
let tod: Tod = (params.get('tod') as Tod) ?? 'day';
const lodParam = params.get('lod');
world.forceLod = lodParam === '0' || lodParam === '1' || lodParam === '2' ? (Number(lodParam) as 0 | 1 | 2) : null;

function setTod(next: Tod): void {
  tod = next;
  const t = TODS[next];
  sea.timeOfDay = t.hour; sea.weather = t.weather; sea.nextWeather = t.weather; sea.fog = t.fog; sea.rain = t.rain; sea.waveScale = t.wave;
  refreshButtons();
}

function setView(name: string, mode: CamMode = camMode): void {
  const f = features.get(name);
  if (!f) return;
  current = name; camMode = mode;
  const s = SHOWCASES.find((x) => x.name === name)!;
  const top = Math.max(...f.islands.map((i) => i.height));
  const target = new THREE.Vector3(f.x, Math.min(top * 0.35, 30), f.z);
  const pos = new THREE.Vector3();
  if (mode === 'top') {
    target.y = 0;
    pos.set(f.x + 0.01, f.radius * 2.6 + 60, f.z + 0.01);
  } else if (mode === 'tactical') {
    // The game's tactical 3/4 camera: ship in the water beside the island, camera ~190 m behind and above it.
    const shipX = f.x + Math.sin(s.view) * (f.radius + 70), shipZ = f.z + Math.cos(s.view) * (f.radius + 70);
    target.set(shipX, 0, shipZ);
    const back = s.view + Math.PI * 0.35;
    pos.set(shipX + Math.sin(back) * 150, 105, shipZ + Math.cos(back) * 150);
    target.lerp(new THREE.Vector3(f.x, 0, f.z), 0.35);
  } else {
    const dist = f.radius * 1.25 + 90;
    pos.set(f.x + Math.sin(s.view) * dist, dist * 0.2 + top * 0.3, f.z + Math.cos(s.view) * dist);
  }
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.update();
  refreshButtons();
}

function setOverlay(on: boolean): void { overlay.visible = on; refreshButtons(); }
function setSlice(on: boolean): void {
  host.renderer.clippingPlanes = on ? [slicePlane] : [];
  for (const o of oceanObjects) o.visible = !on;
  refreshButtons();
}
function setScreen(next: AppScreen): void { screen = next; refreshButtons(); }

// ── Panel ──
const controlsEl = document.getElementById('lab-controls')!;
const statsEl = document.getElementById('lab-stats')!;
const buttons: { el: HTMLButtonElement; on: () => boolean }[] = [];
function row(label: string, items: [string, () => void, () => boolean][]): void {
  const l = document.createElement('div'); l.className = 'label'; l.textContent = label; controlsEl.append(l);
  const r = document.createElement('div'); r.className = 'row';
  for (const [text, fn, on] of items) {
    const b = document.createElement('button'); b.textContent = text; b.onclick = fn; r.append(b);
    buttons.push({ el: b, on });
  }
  controlsEl.append(r);
}
function refreshButtons(): void { for (const b of buttons) b.el.classList.toggle('on', b.on()); }
row('Showcase', SHOWCASES.map((s) => [s.label, () => setView(s.name), () => current === s.name]));
row('Camera', (['hero', 'tactical', 'top'] as CamMode[]).map((m) => [m, () => setView(current, m), () => camMode === m]));
row('Time / weather', (Object.keys(TODS) as Tod[]).map((t) => [t, () => setTod(t), () => tod === t]));
row('Debug', [
  ['collision overlay', () => setOverlay(!overlay.visible), () => overlay.visible],
  ['waterline slice', () => setSlice(host.renderer.clippingPlanes.length === 0), () => host.renderer.clippingPlanes.length > 0],
  ['menu screen', () => setScreen(screen === 'run' ? 'title' : 'run'), () => screen === 'title'],
]);
row('LOD', ([null, 0, 1, 2] as const).map((l) => [l === null ? 'auto' : `lod${l}`, () => { world.forceLod = l; refreshButtons(); }, () => world.forceLod === l]));

setTod(tod);
setView(current, camMode);
if (params.get('overlay') === '1') setOverlay(true);
if (params.get('slice') === '1') setSlice(true);
if (params.get('screen') === 'title') setScreen('title');

let last = performance.now();
let frames = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  step(dt);
}

function step(dt: number): void {
  time += dt;
  controls.update();
  const viewport = host.getViewport();
  const ctx: FrameContext = {
    time, dt, screen, run: null, events: [], sea, focus: { x: controls.target.x, z: controls.target.z, heading: 0, speed: 0 },
    menuShip: null, aim: { x: 0, z: 0 }, world: labWorld, quality: 'high', settings,
    viewport: { width: viewport.width, height: viewport.height, dpr: host.renderer.getPixelRatio() }, atmosphere, services,
  };
  for (const s of systems) s.update(ctx);
  post.update(ctx);
  host.render(() => post.render(scene, camera));
  if (++frames % 10 === 0) {
    const info = host.renderer.info.render;
    const st = world.stats();
    statsEl.textContent = `draw calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\n` +
      `features ${st.built}/${st.features}  pending ${st.pending}  world tris ${(st.triangles / 1000).toFixed(0)}k\n` +
      `last build ${st.buildMs.toFixed(1)} ms  night ${atmosphere.night.toFixed(2)}`;
  }
}

requestAnimationFrame(frame);

declare global {
  interface Window {
    __WORLD_LAB__?: {
      setView: typeof setView; setTod: typeof setTod; setOverlay: typeof setOverlay; setSlice: typeof setSlice;
      setScreen: typeof setScreen; setLod: (l: 0 | 1 | 2 | null) => void; idle: () => boolean; stats: () => unknown;
      step: (seconds: number) => void; views: string[];
    };
  }
}
window.__WORLD_LAB__ = {
  setView, setTod, setOverlay, setSlice, setScreen,
  setLod: (l) => { world.forceLod = l; },
  idle: () => world.stats().pending === 0,
  stats: () => ({ ...world.stats(), calls: host.renderer.info.render.calls, triangles: host.renderer.info.render.triangles }),
  step: (seconds) => { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) step(1 / 60); },
  views: SHOWCASES.map((s) => s.name),
};
