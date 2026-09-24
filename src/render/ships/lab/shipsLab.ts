/**
 * Ships lab (SHIPS-owned) — lab/ships.html.
 *   ?mode=heroes   all six hero ships side by side, tier slider 0–4, weapon mount toggles (default)
 *   ?mode=enemies  every EnemyId, normal + elite, plus a sinking demo
 *   ?mode=bosses   the three bosses
 *   ?mode=crew     crew figures on a deck
 * Scriptable through window.__SHIPS_LAB__ (used for evidence captures).
 */
import * as THREE from 'three';
import { BOSSES, ENEMIES, SHIPS } from '../../../game/content';
import { BOSS_IDS, ENEMY_IDS, SHIP_IDS, WEAPON_IDS, type BossId, type EnemyId, type ShipId, type WeaponId } from '../../../game/ids';
import type { BossState, EnemyState } from '../../../game/types';
import { FleetAssets } from '../../loaders/FleetAssets';
import { SketchfabShipAssets } from '../../loaders/SketchfabShipAssets';
import { Bosses } from '../fleet/Bosses';
import { EnemyFleet } from '../fleet/EnemyFleet';
import { Serpents, type SerpentPose } from '../fleet/Serpents';
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

// ───────────────────────── Enemies ─────────────────────────

function enemyState(id: number, defId: EnemyId, x: number, z: number, elite: boolean): EnemyState {
  const def = ENEMIES[defId];
  return {
    id, defId, faction: def.faction, life: 'alive', sink: 0, x, z, y: 0, heading: 0, speed: def.speed * 0.5, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
    radius: def.radius * (elite ? 1.2 : 1), length: def.length * (elite ? 1.2 : 1), beam: def.radius * 2, hp: 1, maxHp: 1, armor: 0, elite, hitFlash: 0,
    statuses: [], attackCooldown: 1, ai: {}, spawnTime: 0,
  };
}

function labels(items: { text: string; at: THREE.Vector3 }[]): () => void {
  const els = items.map((it) => { const el = document.createElement('div'); el.className = 'lab-label'; el.textContent = it.text; document.body.appendChild(el); return el; });
  const v = new THREE.Vector3();
  return () => items.forEach((it, i) => {
    v.copy(it.at).project(lab.camera);
    const el = els[i]!;
    el.style.display = v.z < 1 ? 'block' : 'none';
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  });
}

function enemiesMode(): void {
  const assets = params.get('procedural') === '1' ? null : new FleetAssets();
  const fleet = new EnemyFleet(assets);
  const serpents = new Serpents(8);
  lab.scene.add(fleet.group, serpents.group);
  fleet.prebuild();
  const rows: EnemyState[] = [];
  let x = 0, id = 1;
  const xs: number[] = [];
  for (const defId of ENEMY_IDS) {
    const L = ENEMIES[defId].length;
    x += L * 0.65 + 8;
    xs.push(x);
    x += L * 0.65 + 8;
  }
  const centre = x / 2;
  const items: { text: string; at: THREE.Vector3 }[] = [];
  ENEMY_IDS.forEach((defId, i) => {
    const px = xs[i]! - centre;
    rows.push(enemyState(id++, defId, px, 0, false));
    rows.push(enemyState(id++, defId, px, 90, true));
    const sinker = enemyState(id++, defId, px, 185, false);
    sinker.life = 'sinking';
    rows.push(sinker);
    items.push({ text: ENEMIES[defId].name, at: new THREE.Vector3(px, ENEMIES[defId].length * 0.9 + 6, 0) });
  });
  items.push({ text: 'ELITE ROW', at: new THREE.Vector3(-centre - 30, 5, 90) }, { text: 'SINKING', at: new THREE.Vector3(-centre - 30, 5, 185) });
  const place = labels(items);
  lab.camera.position.set(0, 190, 330);
  lab.controls.target.set(0, 5, 80);
  let flashT = 0, sinkT = 0;
  const poses: SerpentPose[] = [];
  const step = (dt: number) => {
    const t = lab.ocean.time;
    flashT += dt; sinkT += dt;
    for (const e of rows) {
      if (e.life === 'sinking') e.sink = Math.min(1, (sinkT % 4.2) / 3.2);
      e.hitFlash = e.elite ? 0 : Math.max(0, 1 - ((flashT + e.id * 0.3) % 3) * 4);
      if (e.defId === 'wyrmling') {
        // Swim in small circles so the body trail is visible.
        const a = t * 0.35 + e.id;
        e.x = (xs[ENEMY_IDS.indexOf('wyrmling')]! - centre) + Math.cos(a) * 14;
        e.z = (e.elite ? 90 : e.life === 'sinking' ? 185 : 0) + Math.sin(a) * 14;
        e.heading = Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI;
        e.speed = 8;
      }
    }
    fleet.update(dt, t, rows, lab.ocean);
    let n = 0;
    for (const e of rows) {
      if (e.defId !== 'wyrmling') continue;
      const sp = poses[n] ?? (poses[n] = { id: 0, x: 0, z: 0, heading: 0, speed: 0, submerged: 0, rear: 0, sink: 0, flash: 0 });
      sp.id = e.id; sp.x = e.x; sp.z = e.z; sp.heading = e.heading; sp.speed = e.speed; sp.submerged = 0.1; sp.rear = e.elite ? 0.8 : 0.2;
      sp.sink = e.life === 'sinking' ? e.sink : 0; sp.flash = e.hitFlash;
      n++;
    }
    serpents.updateWyrmlings(t, poses, n, lab.ocean);
    lab.frame(dt);
    place();
    const info = lab.renderer.info.render;
    stats.textContent = `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  fleet draws ${fleet.drawCalls}`;
    api.ready = !assets || assets.loaded;
  };
  api.sources = () => fleet.sources();
  api.advance = (seconds: number) => { const k = Math.round(seconds * 60); for (let i = 0; i < k; i++) step(1 / 60); };
  api.view = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => { lab.camera.position.set(px, py, pz); lab.controls.target.set(tx, ty, tz); };
  api.metrics = () => ({ calls: lab.renderer.info.render.calls, triangles: lab.renderer.info.render.triangles, fleetDraws: fleet.drawCalls });
  api.xOf = (defId: EnemyId) => xs[ENEMY_IDS.indexOf(defId)]! - centre;
  api.stress = (count: number) => {
    // 90-enemy mixed fleet for the draw-call budget check.
    rows.length = 0;
    const ids = ENEMY_IDS.filter((d) => d !== 'fort');
    for (let i = 0; i < count; i++) {
      const defId = ids[i % ids.length]!;
      const a = (i / count) * Math.PI * 2, r = 120 + (i % 5) * 45;
      const e = enemyState(id++, defId, Math.cos(a) * r, Math.sin(a) * r, i % 9 === 0);
      e.heading = a + Math.PI / 2;
      if (i % 11 === 0) { e.life = 'sinking'; }
      rows.push(e);
    }
    lab.camera.position.set(0, 330, 420); lab.controls.target.set(0, 0, 0);
  };
  panel.innerHTML = `<h1>Ships lab — enemies</h1><div class="row">Rows: normal · elite · sinking (loops). Hit flash cycles on the normal row.</div>
    <div class="row"><a href="?mode=heroes">heroes</a> · <a href="?mode=bosses">bosses</a> · <a href="?mode=enemies&procedural=1">procedural only</a></div>`;
  let last = performance.now();
  const loop = () => { requestAnimationFrame(loop); const now = performance.now(); step(Math.min(0.05, (now - last) / 1000)); last = now; };
  loop();
}

// ───────────────────────── Bosses ─────────────────────────

function bossesMode(): void {
  const assets = params.get('procedural') === '1' ? null : new FleetAssets();
  const fleet = new EnemyFleet(assets);
  const bosses = new Bosses(assets, fleet.fleetMaterial);
  bosses.preload();
  lab.scene.add(bosses.group);
  const states: BossState[] = BOSS_IDS.map((defId, i) => {
    const def = BOSSES[defId];
    return {
      id: 100 + i, defId, life: 'alive', sink: 0, x: (i - 1) * 175, z: 0, y: 0, heading: 0, speed: defId === 'tidewyrm' ? 10 : 0, vx: 0, vz: 0, yawRate: 0, roll: 0, pitch: 0,
      radius: def.radius, length: def.length, beam: def.radius * 2, hp: 1, maxHp: 1, armor: 0, phase: 0, hitFlash: 0, statuses: [], attack: 'arrive', attackTime: 0,
      submerged: 0, ai: {}, spawnTime: 0,
    } satisfies BossState;
  });
  const place = labels(states.map((b) => ({ text: BOSSES[b.defId].name, at: new THREE.Vector3(b.x, b.defId === 'tidewyrm' ? 30 : BOSSES[b.defId].length * 0.75, b.z) })));
  lab.camera.position.set(0, 230, 380);
  lab.controls.target.set(0, 20, 0);
  let sinking = false;
  const step = (dt: number) => {
    const t = lab.ocean.time;
    const wyrm = states[1]!;
    const a = t * 0.12;
    wyrm.x = Math.cos(a) * 60; wyrm.z = Math.sin(a) * 60 + 20;
    wyrm.heading = Math.atan2(Math.sin(a), -Math.cos(a)) + Math.PI;
    wyrm.attackTime += dt;
    for (const b of states) if (sinking && b.life === 'sinking') b.sink = Math.min(1, b.sink + dt / 6);
    bosses.update(dt, t, states, lab.ocean);
    lab.frame(dt);
    place();
    const info = lab.renderer.info.render;
    stats.textContent = `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  ${JSON.stringify(bosses.sources())}`;
    api.ready = !assets || assets.loaded;
  };
  api.phase = (defId: BossId, phase: number) => { const b = states.find((s) => s.defId === defId); if (b) b.phase = phase; };
  api.sink = (on: boolean) => { sinking = on; for (const b of states) { b.life = on ? 'sinking' : 'alive'; b.sink = 0; } };
  api.submerge = (v: number) => { states[1]!.submerged = v; };
  api.lunge = () => { states[1]!.attack = 'submerge-lunge'; states[1]!.attackTime = 0; };
  api.flash = () => { for (const b of states) b.hitFlash = 1; };
  api.sources = () => bosses.sources();
  api.view = (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => { lab.camera.position.set(px, py, pz); lab.controls.target.set(tx, ty, tz); };
  api.advance = (seconds: number) => { const k = Math.round(seconds * 60); for (let i = 0; i < k; i++) step(1 / 60); };
  panel.innerHTML = `<h1>Ships lab — bosses</h1>
    <div class="row"><button id="p0">Phase 0</button><button id="p1">Phase 1</button><button id="p2">Phase 2</button><button id="sink" class="off">Sink</button><button id="lunge" class="off">Lunge</button></div>
    <div class="row"><a href="?mode=heroes">heroes</a> · <a href="?mode=enemies">enemies</a></div>`;
  for (const k of [0, 1, 2]) panel.querySelector<HTMLButtonElement>(`#p${k}`)!.onclick = () => { for (const id of BOSS_IDS) (api.phase as (d: BossId, p: number) => void)(id, Math.min(k, BOSSES[id].phases.length - 1)); };
  panel.querySelector<HTMLButtonElement>('#sink')!.onclick = () => (api.sink as (on: boolean) => void)(!sinking);
  panel.querySelector<HTMLButtonElement>('#lunge')!.onclick = () => (api.lunge as () => void)();
  let last = performance.now();
  const loop = () => { requestAnimationFrame(loop); const now = performance.now(); step(Math.min(0.05, (now - last) / 1000)); last = now; };
  loop();
}

if (mode === 'heroes' || mode === 'crew') heroesMode();
else if (mode === 'enemies') enemiesMode();
else if (mode === 'bosses') bossesMode();
