#!/usr/bin/env node
/**
 * Full Broadside vs auto-fire probe (IMPACT, round 2).
 *
 *   node src/render/fx/lab/broadside-probe.mjs <baseUrl> <outDir> [--ship sunlion] [--level 10] [--headed]
 *
 * One real-time run (god mode, targets spawned around the ship, the evidence pilot turning broadside):
 *   1. 3.5 s of auto-fire only (no skill presses), then
 *   2. one manual Full Broadside (Q) and 3.5 s after it.
 * The page is recorded (Playwright video, 1280×720) with a label in the corner; ffmpeg cuts the two 3-second windows
 * and stacks them side by side → <outDir>/auto-vs-manual.mp4 (+ a GIF preview).
 * In-page traces at every rendered frame: camera FOV, the hero root roll, the FX clock rate (hit-stop = clock ≈ frozen)
 * and __CRUISE_FX_STATS__.volley → <outDir>/traces.json with peak FOV kick, peak heel and hit-stop length per window.
 * The browser closes in `finally`.
 */
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--ship' || a === '--level') flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}
if (positional.length < 2) { console.error('usage: broadside-probe.mjs <baseUrl> <outDir> [--ship id] [--level n]'); process.exit(2); }
const BASE = positional[0].replace(/\/$/, '');
const OUT = resolve(positional[1]);
const SHIP = flags.ship ?? 'sunlion';
const LEVEL = Number(flags.level ?? 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[broadside-probe ${new Date().toISOString().slice(11, 19)}]`, ...a);

let page = null;
const ev = (fn, arg) => page.evaluate(fn, arg);

/** Teleports the ship so the nearest enemy sits 95 m off the starboard beam (a clean, repeatable firing solution). */
function placeAbeam() {
  return ev(() => {
    const c = window.__CRUISE__;
    const s = c.summary();
    const n = c.nearest(1)[0];
    if (!n || !s.player) return false;
    const h = s.player.heading;
    const sx = Math.cos(h), sz = -Math.sin(h);
    c.debug.teleport(n.x - sx * 95, n.z - sz * 95, h);
    c.aim(n.x, n.z);
    window.__PROBE_TARGET__ = n.id;
    return n.id;
  });
}

/** Keeps aiming at the placed target (by id) for `ms`. */
async function holdAim(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await ev(() => { const c = window.__CRUISE__; const t = c.nearest(24).find((q) => q.id === window.__PROBE_TARGET__); if (t) c.aim(t.x, t.z); });
    await sleep(100);
  }
}

/** In-page pilot: engage the nearest ship broadside-on; presses nothing unless told to. */
function pilot(seconds) {
  return ev((seconds) => new Promise((done) => {
    const c = window.__CRUISE__;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const t0 = performance.now();
    const step = () => {
      const s = c.summary();
      if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0);
      else if (s.status === 'running') {
        const p = s.player;
        const n = c.nearest(1)[0];
        if (n) {
          const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
          const toward = Math.atan2(-dx, -dz);
          let desired = toward;
          if (d < 170) {
            const port = wrap(toward - Math.PI / 2), star = wrap(toward + Math.PI / 2);
            desired = Math.abs(wrap(port - p.heading)) < Math.abs(wrap(star - p.heading)) ? port : star;
            if (d < 70) desired = wrap(desired + (desired === port ? -0.6 : 0.6));
          }
          c.aim(n.x, n.z);
          c.steer(Math.max(-1, Math.min(1, wrap(desired - p.heading) * 2.5)));
        }
      }
      if ((performance.now() - t0) / 1000 >= seconds) { clearInterval(timer); done(); }
    };
    const timer = setInterval(step, 100);
    step();
  }), seconds);
}

await mkdir(OUT, { recursive: true });
const videoDir = join(OUT, '.video');
await rm(videoDir, { recursive: true, force: true });
const browser = await chromium.launch({ headless: !flags.headed, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'] });
const result = { base: BASE, ship: SHIP, level: LEVEL };
let recStart = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } });
  recStart = Date.now();
  page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', String(e.message ?? e).slice(0, 200)));
  await page.goto(`${BASE}/?seed=broadside`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000, polling: 100 });
  await sleep(1000);
  await ev(({ ship, level }) => {
    const c = window.__CRUISE__;
    c.startRun(ship, 'sunward-shallows');
    c.debug.god(true);
  }, { ship: SHIP, level: LEVEL });
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000 });
  await ev(({ level }) => {
    const c = window.__CRUISE__, d = c.debug;
    d.level(level);
    c.press('gear-up'); c.press('gear-up');
    for (const [id, n] of [['brig', 4], ['frigate', 3], ['cutter', 3]]) d.spawn(id, n, false);
    // label + per-frame traces (evidence only)
    const tag = document.createElement('div');
    tag.id = 'probe-tag';
    tag.style.cssText = 'position:fixed;left:14px;top:120px;z-index:99999;font:700 28px/1.1 Helvetica,Arial,sans-serif;color:#fff;background:rgba(8,12,28,.78);padding:8px 14px;border-radius:6px;pointer-events:none';
    tag.textContent = 'AUTO-FIRE';
    document.body.appendChild(tag);
    const cam = window.__OCEAN__.surface.mainCamera;
    const hero = window.__SHIPS__.heroShip.root;
    window.__TRACE__ = [];
    window.__TRACE_ON__ = false;
    let lastClock = window.__CRUISE_FX_STATS__?.clock ?? 0, lastT = performance.now();
    const tick = () => {
      const fx = window.__CRUISE_FX_STATS__;
      const now = performance.now();
      if (window.__TRACE_ON__ && fx) {
        const rate = (fx.clock - lastClock) / Math.max(1e-3, (now - lastT) / 1000);
        window.__TRACE__.push({ t: now, fov: cam.fov, roll: hero.rotation.z, heel: window.__SHIPS__.heroShip.heel ?? 0, rate, v: { ...fx.volley }, smoke: fx.smokeCoverage, thin: fx.smokeThin, window: window.__TRACE_WIN__ });
      }
      lastClock = fx?.clock ?? 0; lastT = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { level: LEVEL });
  await pilot(5); // close in and turn broadside
  // Window 1: auto-fire only.
  await placeAbeam();
  await sleep(1200);
  await ev(() => { window.__TRACE_WIN__ = 'auto'; window.__TRACE_ON__ = true; document.getElementById('probe-tag').textContent = 'AUTO-FIRE'; });
  const tAuto = (Date.now() - recStart) / 1000;
  await pilot(3.5);
  // Window 2: the manual Full Broadside.
  await placeAbeam();
  await holdAim(1200);
  await ev(() => { window.__TRACE_WIN__ = 'manual'; document.getElementById('probe-tag').textContent = 'FULL BROADSIDE (Q)'; });
  await ev(() => {
    const c = window.__CRUISE__;
    const t = c.nearest(24).find((q) => q.id === window.__PROBE_TARGET__) ?? c.nearest(1)[0];
    if (t) c.aim(t.x, t.z);
    c.debug.resetCooldowns(); c.press('broadside');
  });
  const tManual = (Date.now() - recStart) / 1000;
  await holdAim(3500);
  await ev(() => { window.__TRACE_ON__ = false; });
  const traces = await ev(() => window.__TRACE__);
  const stats = await ev(() => window.__CRUISE_FX_STATS__?.volley ?? null);
  const perWindow = {};
  for (const w of ['auto', 'manual']) {
    const list = traces.filter((x) => x.window === w);
    if (!list.length) continue;
    const baseFov = Math.min(...list.map((x) => x.fov));
    const base = list[0];
    const fovs = list.map((x) => x.fov);
    const rolls = list.map((x) => x.roll * 180 / Math.PI);
    const rollMean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
    // hit-stop: consecutive frames with the FX clock running under 20% speed
    let stop = 0, best = 0, prevT = list[0].t;
    for (const x of list) { if (x.rate < 0.2) { stop += x.t - prevT; best = Math.max(best, stop); } else stop = 0; prevT = x.t; }
    const slow = list.filter((x) => x.rate < 0.6).length;
    perWindow[w] = {
      frames: list.length,
      fovKickDeg: +(Math.max(...fovs) - baseFov).toFixed(2),
      heelSwingDeg: +(Math.max(...rolls.map((r) => Math.abs(r - rollMean)))).toFixed(2),
      recoilHeelPeakDeg: +Math.max(...list.map((x) => Math.abs(x.heel) * 180 / Math.PI)).toFixed(2),
      longestFreezeMs: Math.round(best), slowFrames: slow,
      volley: { start: base.v, end: list[list.length - 1].v },
      smokeMax: +Math.max(...list.map((x) => x.smoke)).toFixed(4),
    };
  }
  Object.assign(result, { tAuto, tManual, perWindow, volleyStats: stats });
  await writeFile(join(OUT, 'traces.json'), JSON.stringify({ ...result, traces }, null, 1));
  await page.screenshot({ path: join(OUT, 'after-volley.jpg'), type: 'jpeg', quality: 80 });
  await ctx.close();
} finally {
  await browser.close().catch(() => undefined);
}
// Video: take the recorded webm, cut the windows and stack them.
const files = (await readdir(videoDir).catch(() => [])).filter((f) => f.endsWith('.webm'));
if (files.length && result.tAuto) {
  const src = join(OUT, 'session.webm');
  await rename(join(videoDir, files[0]), src);
  await rm(videoDir, { recursive: true, force: true });
  const cut = (name, t) => spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.max(0, t)), '-t', '3', '-i', src, '-vf', 'scale=800:450,fps=30', '-an', join(OUT, name)], { encoding: 'utf8' });
  cut('auto.mp4', result.tAuto + 0.2);
  cut('manual.mp4', result.tManual - 0.15);
  const st = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', join(OUT, 'auto.mp4'), '-i', join(OUT, 'manual.mp4'), '-filter_complex', 'hstack=inputs=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(OUT, 'auto-vs-manual.mp4')], { encoding: 'utf8' });
  if (st.status !== 0) log('ffmpeg hstack failed', st.stderr);
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', join(OUT, 'auto-vs-manual.mp4'), '-vf', 'fps=12,scale=960:-1:flags=lanczos', join(OUT, 'auto-vs-manual.gif')], { encoding: 'utf8' });
}
console.log(JSON.stringify(result, null, 1));
