#!/usr/bin/env node
/**
 * Smoke / framing probe (IMPACT, round 2). Works on any build (it only uses window.__CRUISE__, __OCEAN__ and __SHIPS__).
 *
 *   node src/render/fx/lab/smoke-probe.mjs <baseUrl> <outDir> [--scenarios mid,late,boss-iron-warden,...] [--samples 8]
 *                                          [--ships sunlion,dawn-ram,...] [--headed]
 *
 * Each sample re-renders the live frame (raw scene, no post) several times with parts hidden and diffs the pixels:
 *   A = only smoke sprites (cel puffs with a smoke palette + cooling fireballs)   D = only dark smoke
 *   B = no cel sprites     H = B without the hero     S = B without bosses/serpents
 * and reports, per sample and per scenario:
 *   smoke      screen fraction covered by smoke (A≠B)          dark   the same for dark smoke only (D≠B)
 *   heroOcc    fraction of the hero's pixels covered by smoke   bossOcc  the same for boss pixels
 *   heroH      hero height as a fraction of the frame height    bossArea boss pixels as a fraction of the frame
 *   numbers    screen fraction covered by damage numbers (full render vs the numbers mesh hidden)
 * Scenarios: mid, late, swarm (skiff packs), boss-iron-warden, boss-tidewyrm, boss-sovereign, early (one per --ships entry).
 * The browser closes in `finally`. Keep <outDir> under output/ (gitignored).
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const VALUE_FLAGS = new Set(['--scenarios', '--samples', '--ships', '--seed', '--gap']);
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}
if (positional.length < 2) {
  console.error('usage: node src/render/fx/lab/smoke-probe.mjs <baseUrl> <outDir> [--scenarios a,b] [--samples 8] [--ships a,b]');
  process.exit(2);
}
const BASE = positional[0].replace(/\/$/, '');
const OUT = resolve(positional[1]);
const SAMPLES = Number(flags.samples ?? 8);
const GAP = Number(flags.gap ?? 0.8);
const SCENARIOS = String(flags.scenarios ?? 'mid,late,boss-iron-warden,boss-sovereign,early').split(',');
const SHIPS = String(flags.ships ?? 'sunlion,dawn-ram,yellowfin,grand-galley,seawarden,white-leviathan').split(',');
const SEED = flags.seed ?? 'gauntlet';

const MID = { time: 370, level: 12, weapons: [['bow-chaser', 3], ['stern-mortar', 3]], spawns: [['frigate', 2], ['brig', 3], ['cutter', 3], ['skiff', 6], ['fireship', 2]] };
const LATE = { time: 750, level: 24, weapons: [['rocket-rack', 5], ['storm-rod', 4], ['broadside', 6]], spawns: [['man-o-war', 1], ['frigate', 3], ['corsair-galleon', 1], ['mortar-barge', 2], ['skiff', 10], ['fireship', 3]] };
const BOSS = { time: 200, level: 15, weapons: [['bow-chaser', 4], ['stern-mortar', 3], ['swivel-guns', 3]] };
const SWARM = { time: 370, level: 12, weapons: [['swivel-guns', 3], ['bow-chaser', 3]], spawns: [['skiff', 16], ['cutter', 4], ['frigate', 2], ['man-o-war', 1]] };

let page = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (fn, arg) => page.evaluate(fn, arg);
const log = (...a) => console.log(`[smoke-probe ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** In-page pilot (same behaviour as scripts/gauntlet/evidence.mjs): engage / boss approach, presses skills. */
function pilot(opts) {
  const o = { seconds: 10, mode: 'engage', stopDist: 0, fire: true, special: true, ...opts };
  return ev((o) => new Promise((done) => {
    const c = window.__CRUISE__;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const t0 = performance.now();
    let lastQ = -99, lastE = -99, lastR = -99, minDist = null;
    const finish = (reason) => { clearInterval(timer); done({ reason, minDist }); };
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      const s = c.summary();
      if (!s.player) return finish('no-run');
      if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0);
      else if (s.status === 'running') {
        const p = s.player;
        let desired = p.heading;
        const list = c.nearest(o.mode === 'boss' ? 16 : 1);
        const n = o.mode === 'boss' ? list.find((q) => q.boss) : list[0];
        if (n) {
          const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
          minDist = minDist === null ? Math.round(d) : Math.min(minDist, Math.round(d));
          const toward = Math.atan2(-dx, -dz);
          if (o.mode !== 'engage' || d > 170) desired = toward;
          else {
            const port = wrap(toward - Math.PI / 2), star = wrap(toward + Math.PI / 2);
            desired = Math.abs(wrap(port - p.heading)) < Math.abs(wrap(star - p.heading)) ? port : star;
            if (d < 70) desired = wrap(desired + (desired === port ? -0.6 : 0.6));
          }
          c.aim(n.x, n.z);
          if (o.fire && o.mode === 'engage') {
            if (t - lastQ > 6 && d < 170) { c.press('broadside'); lastQ = t; }
            if (o.special && t - lastE > 18 && d < 160) { c.press('special'); lastE = t; }
            if (t - lastR > 4) { c.press('ultimate'); lastR = t; }
          }
          if (o.stopDist > 0 && d <= o.stopDist && o.mode === 'boss') return finish('arrived');
        }
        const diff = wrap(desired - p.heading);
        c.steer(Math.max(-1, Math.min(1, diff * 2.5)));
      }
      if (t >= o.seconds) finish('time');
    };
    const timer = setInterval(step, 100);
    step();
  }), o);
}

/** One measurement of the live frame (see the header). Returns null if the handles are missing. */
function measureFrame() {
  return ev(() => {
    const O = window.__OCEAN__, S = window.__SHIPS__;
    if (!O || !S || !O.renderer || !S.scene) return null;
    const renderer = O.renderer, scene = S.scene;
    const camera = O.surface?.mainCamera;
    const cel = scene.getObjectByName('fx-cel');
    if (!camera || !cel) return null;
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const buf = cel.geometry.attributes.iA.data;
    const arr = buf.array, stride = buf.stride, count = Math.floor(arr.length / stride);
    const saved = new Float32Array(count);
    for (let i = 0; i < count; i++) saved[i] = arr[i * stride + 13];
    const shape = (i) => Math.round(arr[i * stride + 16]);
    const pal = (i) => Math.round(arr[i * stride + 17]);
    // Cel palettes: 0 Gunsmoke, 1 DarkSmoke, 4 Dust, 5 Steam, 11 WreckSmoke; shape 0 = puff, 7 = fireball (cools into smoke).
    const smoke = (i) => shape(i) === 7 || (shape(i) === 0 && [0, 1, 4, 5, 11].includes(pal(i)));
    const dark = (i) => shape(i) === 7 || (shape(i) === 0 && (pal(i) === 1 || pal(i) === 11));
    const upload = () => { if (buf.clearUpdateRanges) buf.clearUpdateRanges(); buf.needsUpdate = true; };
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.autoClear = true;
    const shot = () => { renderer.render(scene, camera); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const keepOnly = (pred) => { for (let i = 0; i < count; i++) arr[i * stride + 13] = pred(i) ? saved[i] : 0; upload(); };
    let A, D, B, Hn, Sn, F, Nn;
    const nums = scene.getObjectByName('fx-damage-numbers');
    try {
      F = shot();
      if (nums) { nums.visible = false; Nn = shot(); nums.visible = true; }
      keepOnly(smoke); A = shot();
      keepOnly(dark); D = shot();
      keepOnly(() => true);
      cel.visible = false; B = shot();
      S.heroShip.root.visible = false; Hn = shot(); S.heroShip.root.visible = true;
      const bv = S.bosses.group.visible, sv = S.serpents.group.visible;
      S.bosses.group.visible = false; S.serpents.group.visible = false; Sn = shot();
      S.bosses.group.visible = bv; S.serpents.group.visible = sv;
    } finally {
      for (let i = 0; i < count; i++) arr[i * stride + 13] = saved[i];
      upload();
      cel.visible = true;
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
    }
    const step = 2;
    const diff = (a, b, o) => Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]) > 30;
    let n = 0, smokeN = 0, darkN = 0, hero = 0, heroCov = 0, boss = 0, bossCov = 0, numN = 0;
    let heroTop = -1, heroBottom = -1, heroSx = 0, heroSy = 0;
    const heroRows = new Uint16Array(H);
    for (let y = 0; y < H; y += step) {
      for (let x = 0; x < W; x += step) {
        const o = (y * W + x) * 4;
        n++;
        const sm = diff(A, B, o);
        if (sm) smokeN++;
        if (Nn && diff(F, Nn, o)) numN++;
        if (diff(D, B, o)) darkN++;
        if (diff(B, Hn, o)) { hero++; heroRows[y]++; heroSx += x; heroSy += y; if (sm) heroCov++; }
        if (diff(B, Sn, o)) { boss++; if (sm) bossCov++; }
      }
    }
    for (let y = 0; y < H; y++) if (heroRows[y] >= 2) { if (heroTop < 0) heroTop = y; heroBottom = y; }
    // separate damage numbers on screen: connected components of the numbers mask (4 px cells, 8-connected)
    let numberCount = 0;
    if (Nn) {
      const cw = Math.ceil(W / 4), ch = Math.ceil(H / 4);
      const m = new Uint8Array(cw * ch);
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const o = (y * W + x) * 4; if (diff(F, Nn, o)) m[((y / 4) | 0) * cw + ((x / 4) | 0)] = 1; }
      const stack = new Int32Array(cw * ch);
      for (let i = 0; i < m.length; i++) {
        if (m[i] !== 1) continue;
        let sp = 0, size = 0; stack[sp++] = i; m[i] = 2;
        while (sp > 0) {
          const j = stack[--sp]; size++;
          const jx = j % cw, jy = (j / cw) | 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const nx = jx + dx, ny = jy + dy;
            if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
            const q = ny * cw + nx;
            if (m[q] === 1) { m[q] = 2; stack[sp++] = q; }
          }
        }
        if (size >= 6) numberCount++;
      }
    }
    const s = window.__CRUISE__.summary();
    const r4 = (v) => +v.toFixed(4);
    const fx = window.__CRUISE_FX_STATS__;
    // Hull-only height: the measured hull box (waterline → rail, bow → stern, full beam) projected by the live camera.
    let hullH = null;
    const hp = S.heroShip.profile;
    if (hp) {
      let ymin = 1e9, ymax = -1e9;
      const b = hp.bounds;
      for (const x of [b.min.x, b.max.x]) for (const y of [0, hp.railY]) for (const z of [b.min.z, b.max.z]) {
        const v = camera.position.clone().set(x, y, z).applyMatrix4(S.heroShip.root.matrixWorld).project(camera);
        ymin = Math.min(ymin, v.y); ymax = Math.max(ymax, v.y);
      }
      hullH = r4((Math.min(1, ymax) - Math.max(-1, ymin)) / 2);
    }
    return {
      cam: window.__CRUISE_CAMERA__ ? Object.fromEntries(Object.entries(window.__CRUISE_CAMERA__).map(([k, v]) => [k, +(+v).toFixed(3)])) : null,
      gov: fx ? { est: r4(fx.smokeCoverage), raw: r4(fx.smokeCoverageRaw), thin: r4(fx.smokeThin), live: fx.smokeLive, ms: +fx.smokeMs.toFixed(3) } : null,
      nums: fx && fx.numbersLegacy !== undefined ? { legacy: fx.numbersLegacy, spawned: fx.numbersSpawned, onScreen: fx.numbersShown } : null,
      t: s.time, enemies: s.enemies, bosses: s.bosses,
      bossSep: (() => { const b = window.__CRUISE__.nearest(24).find((q) => q.boss); return b ? Math.round(Math.hypot(b.x - s.player.x, b.z - s.player.z)) : null; })(),
      smoke: r4(smokeN / n), dark: r4(darkN / n), numbers: r4(numN / n), numberCount,
      heroOcc: hero > 0 ? r4(heroCov / hero) : null, heroArea: r4(hero / n),
      heroAt: hero > 0 ? [r4(heroSx / hero / W), r4(heroSy / hero / H)] : null, heroH: heroTop >= 0 ? r4((heroBottom - heroTop + 1) / H) : null, hullH,
      bossOcc: boss > 20 ? r4(bossCov / boss) : null, bossArea: r4(boss / n),
      fov: +camera.fov.toFixed(2),
      camDist: +Math.hypot(camera.position.x - s.player.x, camera.position.z - s.player.z, camera.position.y).toFixed(1),
    };
  });
}

async function startRun(ship, sea) {
  await ev(({ ship, sea }) => {
    const c = window.__CRUISE__;
    c.startRun(ship, sea);
    c.debug.god(true);
    c.press('gear-up'); c.press('gear-up');
  }, { ship, sea });
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000, polling: 100 });
  await sleep(300);
  await ev(() => window.__CRUISE__.press('gear-up'));
}

async function loadout({ time, level, weapons = [], spawns = [] }) {
  return ev(({ time, level, weapons, spawns }) => {
    const c = window.__CRUISE__, d = c.debug;
    if (time !== undefined) d.time(time);
    if (level) d.level(level);
    let s = c.summary();
    for (const [id, lv] of weapons) {
      const owned = s.weapons.some((w) => w.startsWith(`${id}:`));
      if (owned || s.weapons.length < 6) d.weapon(id, lv);
      s = c.summary();
    }
    for (const [id, n] of spawns) d.spawn(id, n, false);
    return s.weapons;
  }, { time, level, weapons, spawns });
}

/** Samples while the pilot keeps fighting; returns the samples and saves a screenshot of the densest-smoke sample. */
async function sampleWhileFighting(name, mode = 'engage', samples = SAMPLES) {
  const list = [];
  let worst = -1;
  for (let i = 0; i < samples; i++) {
    await pilot({ seconds: GAP, mode, stopDist: 0 });
    const m = await measureFrame();
    if (!m) continue;
    list.push(m);
    if (m.smoke > worst) { worst = m.smoke; await page.screenshot({ path: join(OUT, `${name}-worst.jpg`), type: 'jpeg', quality: 80 }); }
  }
  await page.screenshot({ path: join(OUT, `${name}-last.jpg`), type: 'jpeg', quality: 80 });
  return list;
}

function summarize(list) {
  const pick = (k) => list.map((m) => m[k]).filter((v) => v !== null && v !== undefined);
  const stat = (k) => {
    const v = pick(k);
    if (!v.length) return null;
    const sorted = [...v].sort((a, b) => a - b);
    return { mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4), max: sorted[sorted.length - 1], min: sorted[0], n: v.length };
  };
  return { numberCount: stat('numberCount'), numbers: stat('numbers'), smoke: stat('smoke'), dark: stat('dark'), heroOcc: stat('heroOcc'), heroH: stat('heroH'), hullH: stat('hullH'), bossOcc: stat('bossOcc'), bossArea: stat('bossArea'), camDist: stat('camDist') };
}

const report = { base: BASE, samples: SAMPLES, gap: GAP, scenarios: {}, startedAt: new Date().toISOString() };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: !flags.headed,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', String(e.message ?? e).slice(0, 300)));
  await page.goto(`${BASE}/?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000, polling: 100 });
  await sleep(1500);
  for (const sc of SCENARIOS) {
    try {
      if (sc === 'mid' || sc === 'late' || sc === 'swarm') {
        await startRun('sunlion', 'sunward-shallows');
        await loadout(sc === 'mid' ? MID : sc === 'late' ? LATE : SWARM);
        await pilot({ seconds: 10, mode: 'engage' });
        const list = await sampleWhileFighting(sc);
        report.scenarios[sc] = { summary: summarize(list), samples: list };
      } else if (sc.startsWith('boss-')) {
        const id = sc.slice(5);
        await startRun('sunlion', 'sunward-shallows');
        await loadout(BOSS);
        await ev((id) => window.__CRUISE__.debug.boss(id), id);
        const approach = await pilot({ seconds: 22, mode: 'boss', stopDist: 150 });
        const list = await sampleWhileFighting(sc);
        report.scenarios[sc] = { approach, summary: summarize(list), samples: list };
      } else if (sc === 'early') {
        for (const ship of SHIPS) {
          await startRun(ship, 'sunward-shallows');
          await pilot({ seconds: 14, mode: 'engage' });
          const list = await sampleWhileFighting(`early-${ship}`, 'engage', 3);
          report.scenarios[`early-${ship}`] = { summary: summarize(list), samples: list };
        }
      }
      const s = report.scenarios[sc] ?? report.scenarios[`early-${SHIPS.at(-1)}`];
      log(sc, JSON.stringify(s?.summary ?? null));
    } catch (err) {
      report.scenarios[sc] = { error: String(err?.message ?? err).split('\n')[0] };
      log(sc, 'failed', report.scenarios[sc].error);
    }
  }
} finally {
  await browser.close().catch(() => undefined);
  report.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'probe.json'), JSON.stringify(report, null, 1));
  const table = Object.fromEntries(Object.entries(report.scenarios).map(([k, v]) => [k, v.summary ? {
    numbers: v.summary.numbers?.mean, numbersMax: v.summary.numbers?.max, smoke: v.summary.smoke?.mean, smokeMax: v.summary.smoke?.max, dark: v.summary.dark?.mean, heroOcc: v.summary.heroOcc?.mean,
    heroOccMax: v.summary.heroOcc?.max, bossOcc: v.summary.bossOcc?.mean, bossArea: v.summary.bossArea?.mean, bossAreaMin: v.summary.bossArea?.min,
    heroH: v.summary.heroH?.mean, heroHMax: v.summary.heroH?.max, hullH: v.summary.hullH?.mean, hullHMax: v.summary.hullH?.max,
  } : v]));
  console.log(JSON.stringify(table, null, 1));
}
