/**
 * Ships lab (SHIPS-owned) — lab/ships.html.
 *   ?mode=heroes   all six hero ships side by side, tier slider 0–4, weapon mount toggles (default)
 *   ?mode=enemies  every EnemyId, normal + elite, plus a sinking demo
 *   ?mode=bosses   the three bosses
 *   ?mode=crew     crew figures on a deck
 * Scriptable through window.__SHIPS_LAB__ (used for evidence captures).
 */
import * as THREE from 'three';
import { SHIPS } from '../../../game/content';
import { SHIP_IDS, WEAPON_IDS, type ShipId, type WeaponId } from '../../../game/ids';
import { SketchfabShipAssets } from '../../loaders/SketchfabShipAssets';
import type { GrowthWeapon } from '../hero/HeroGrowth';
import { HeroShip, type HeroPose } from '../hero/HeroShip';
import { LabScene } from './labScene';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'heroes';
if (params.get('clean') === '1') document.body.classList.add('clean');
const root = document.getElementById('lab-root')!;
const panel = document.getElementById('lab-panel')!;
const stats = document.getElementById('lab-stats')!;
const lab = new LabScene(root);

interface LabApi { ready: boolean; [key: string]: unknown }
const api: LabApi = { ready: false };
(window as unknown as { __SHIPS_LAB__: LabApi }).__SHIPS_LAB__ = api;

// ───────────────────────── Heroes ─────────────────────────

function heroesMode(): void {
  const assets = new SketchfabShipAssets();
  const heroes: { id: ShipId; ship: HeroShip; pose: HeroPose; x: number }[] = [];
  const growth = { tier: Number(params.get('tier') ?? 0), weapons: [] as GrowthWeapon[] };
  let x = 0;
  const only = params.get('ship') as ShipId | null;
  const ids = only ? [only] : [...SHIP_IDS];
  const widths: Record<string, number> = { 'grand-galley': 96, 'white-leviathan': 52, seawarden: 36, sunlion: 32, yellowfin: 36, 'dawn-ram': 22 };
  for (const id of ids) {
    const def = SHIPS[id];
    const ship = new HeroShip(assets);
    ship.setModel(def.modelKey, def.length, def.accent);
    const w = widths[id] ?? 40;
    x += w / 2;
    const pose: HeroPose = { x, z: 0, heading: 0, speed: 8, roll: 0, airborne: 0, submerged: 0, invulnerable: 0, sinceHit: 99, hpFraction: 1, alive: true };
    heroes.push({ id, ship, pose, x });
    x += w / 2 + 14;
    lab.scene.add(ship.root);
  }
  const centre = x / 2;
  for (const h of heroes) h.pose.x -= centre;
  lab.camera.position.set(0, 160, 260);
  lab.controls.target.set(0, 5, 0);

  const setWeapon = (id: WeaponId, level: number, branch?: 'A' | 'B', overdrive = false) => {
    const i = growth.weapons.findIndex((w) => w.id === id);
    if (level <= 0) { if (i >= 0) growth.weapons.splice(i, 1); return; }
    const w: GrowthWeapon = { id, level, branch: level >= 3 ? branch ?? 'A' : undefined, overdrive: overdrive || level >= 6 };
    if (i >= 0) growth.weapons[i] = w; else growth.weapons.push(w);
  };
  const allWeapons = (level: number) => { for (const id of WEAPON_IDS) if (id !== 'escort-skiffs') setWeapon(id, level); };
  api.setTier = (t: number) => { growth.tier = t; syncPanel(); };
  api.setWeapon = (id: WeaponId, level: number, branch?: 'A' | 'B', overdrive = false) => { setWeapon(id, level, branch, overdrive); syncPanel(); };
  api.allWeapons = (level: number) => { allWeapons(level); syncPanel(); };
  api.clearWeapons = () => { growth.weapons.length = 0; };
  api.night = (v: number) => lab.setNight(v);
  api.focus = (id: ShipId | null, distance = 150, pitch = 0.62, yaw = 0) => {
    const h = heroes.find((e) => e.id === id);
    if (!h) { lab.chase = null; return; }
    lab.chaseCamera(h.ship.root, distance, pitch, yaw);
  };
  api.overview = () => { lab.chase = null; lab.camera.position.set(0, 160, 260); lab.controls.target.set(0, 5, 0); };
  api.info = () => heroes.map((h) => ({ id: h.id, ready: h.ship.ready, probeMs: h.ship.profile?.probeMs, rails: h.ship.profile?.rails.map((r) => r.length), deckY: h.ship.profile?.deckY, masts: h.ship.profile?.masts.map((m) => m.toArray().map((v) => +v.toFixed(1))) }));
  api.hit = (id: ShipId) => { const h = heroes.find((e) => e.id === id); if (h) h.pose.sinceHit = 0; };

  // Panel.
  panel.innerHTML = `<h1>Ships lab — heroes</h1>
    <div class="row">Tier <input id="tier" type="range" min="0" max="4" step="1" value="${growth.tier}"> <b id="tierv">${growth.tier}</b></div>
    <div class="row">Night <input id="night" type="range" min="0" max="1" step="0.05" value="0"></div>
    <div class="row" id="weapons"></div>
    <div class="row"><button id="all6">All weapons ★</button><button id="all3">All Lv3</button><button id="none" class="off">No weapons</button></div>
    <div class="row" id="focus"></div>`;
  const tierInput = panel.querySelector<HTMLInputElement>('#tier')!;
  const tierV = panel.querySelector<HTMLElement>('#tierv')!;
  tierInput.oninput = () => { growth.tier = Number(tierInput.value); tierV.textContent = tierInput.value; };
  const nightInput = panel.querySelector<HTMLInputElement>('#night')!;
  nightInput.oninput = () => lab.setNight(Number(nightInput.value));
  const weaponsEl = panel.querySelector<HTMLElement>('#weapons')!;
  const syncPanel = () => {
    tierInput.value = String(growth.tier); tierV.textContent = String(growth.tier);
    weaponsEl.innerHTML = '';
    for (const id of WEAPON_IDS) {
      const w = growth.weapons.find((e) => e.id === id);
      const b = document.createElement('button');
      b.textContent = `${id} ${w ? `L${w.level}${w.branch ?? ''}${w.overdrive ? '★' : ''}` : ''}`;
      b.className = w ? '' : 'off';
      b.onclick = () => { const cur = growth.weapons.find((e) => e.id === id)?.level ?? 0; setWeapon(id, cur >= 6 ? 0 : cur + 1); syncPanel(); };
      weaponsEl.appendChild(b);
    }
  };
  syncPanel();
  panel.querySelector<HTMLButtonElement>('#all6')!.onclick = () => { allWeapons(6); syncPanel(); };
  panel.querySelector<HTMLButtonElement>('#all3')!.onclick = () => { allWeapons(3); syncPanel(); };
  panel.querySelector<HTMLButtonElement>('#none')!.onclick = () => { growth.weapons.length = 0; syncPanel(); };
  const focusEl = panel.querySelector<HTMLElement>('#focus')!;
  for (const h of heroes) {
    const b = document.createElement('button');
    b.textContent = SHIPS[h.id].name;
    b.onclick = () => (api.focus as (id: ShipId) => void)(h.id);
    focusEl.appendChild(b);
  }
  const all = document.createElement('button');
  all.textContent = 'Overview'; all.className = 'off';
  all.onclick = () => (api.overview as () => void)();
  focusEl.appendChild(all);

  let last = performance.now();
  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
  };
  const debug = params.get('debug') === '1';
  const markers = new Map<ShipId, THREE.Points>();
  const addMarkers = (h: { id: ShipId; ship: HeroShip }) => {
    const p = h.ship.profile;
    if (!p || markers.has(h.id)) return;
    const pos: number[] = [], col: number[] = [];
    const push = (x: number, y: number, z: number, c: number) => { pos.push(x, y, z); const k = new THREE.Color(c); col.push(k.r, k.g, k.b); };
    for (const band of p.rails) for (const r of band) for (const s of [1, -1]) { push(r.x * s, r.railY, r.z, 0xffff00); push((r.x - 1) * s, r.deckY, r.z, 0x00ff66); }
    for (const g of p.guns) for (const s of [1, -1]) push(g.x * s, g.y, g.z, 0xff2222);
    for (const run of p.plating) for (const st of run) for (const s of [1, -1]) { push(st.x0 * s, st.y0, st.z, 0x3366ff); push(st.x1 * s, st.y1, st.z, 0x66ccff); }
    for (const v of [p.stern, p.sternSide, p.sternFlag, p.sternLantern, p.bow, p.prow, p.figurehead, p.mid, p.totem, ...p.masts]) push(v.x, v.y, v.z, 0xff00ff);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, depthTest: false }));
    pts.renderOrder = 99;
    h.ship.root.add(pts);
    markers.set(h.id, pts);
  };
  const step = (dt: number) => {
    const t = lab.ocean.time;
    if (debug) for (const h of heroes) addMarkers(h);
    for (const h of heroes) {
      h.pose.sinceHit += dt;
      h.ship.update(dt, t, h.pose, growth, lab.night, lab.ocean);
    }
    lab.frame(dt);
    const info = lab.renderer.info.render;
    stats.textContent = `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  tier ${growth.tier}  weapons ${growth.weapons.length}`;
    api.ready = heroes.every((h) => h.ship.ready);
  };
  api.advance = (seconds: number) => { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) step(1 / 60); };
  api.metrics = () => ({ calls: lab.renderer.info.render.calls, triangles: lab.renderer.info.render.triangles, programs: lab.renderer.info.programs?.length });
  loop();
}

if (mode === 'heroes') heroesMode();
