#!/usr/bin/env node
/**
 * Gauntlet evidence capture (critic tooling; changes no game code).
 *
 *   node scripts/gauntlet/evidence.mjs <baseUrl> <outDir> [--quick] [--stages a,b] [--seas s1,s2] [--headed]
 *                                      [--dpr 1] [--seed gauntlet] [--measure 2.5]
 *
 * Drives a built game through window.__CRUISE__ (plus __CRUISE_AUDIO__ / __CRUISE_UI__ when present) and writes:
 *   <outDir>/NN-<shot>.jpg        one 1600×900 JPEG per shot (some also get a HUD-free `-plate` twin)
 *   <outDir>/contact-sheet.jpg    labelled thumbnails, tiled by ffmpeg (image sequence + `tile` filter)
 *   <outDir>/report.json          per shot: CPU split (profiler mean/max/p95, hitch counts), draw calls, triangles,
 *                                 sceneStats, sim summary, UI cost, audio deltas + meter, page/console errors;
 *                                 plus load timing, transfer sizes, GPU string, checks and stage errors.
 *
 * Stages (default = all): title, harbor, settings, seas, levelup, bosses (+ chest), gloam-night, victory, defeat,
 * harbor-after. `--quick` runs a ~2-minute subset. Each stage sets up its own run, so any subset works.
 * Perf on the shared machine: read the CPU split (`cpu`), never the FPS. The browser always closes in `finally`.
 * Keep <outDir> under output/ (gitignored).
 */
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// ───────────────────────── args ─────────────────────────

const VALUE_FLAGS = new Set(['--stages', '--seas', '--dpr', '--seed', '--measure']);
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}
if (positional.length < 2 || flags.help) {
  console.error('usage: node scripts/gauntlet/evidence.mjs <baseUrl> <outDir> [--quick] [--stages a,b] [--seas s1,s2] [--headed] [--dpr 1] [--seed s] [--measure 2.5]');
  process.exit(2);
}
const BASE = positional[0].replace(/\/$/, '');
const OUT = resolve(positional[1]);
const QUICK = !!flags.quick;
const SEED = flags.seed ?? 'gauntlet';
const DPR = Number(flags.dpr ?? 1);
const MEASURE = Number(flags.measure ?? (QUICK ? 1.5 : 2.5));
const ALL_STAGES = ['title', 'harbor', 'settings', 'seas', 'levelup', 'bosses', 'gloam-night', 'victory', 'defeat', 'harbor-after'];
const QUICK_STAGES = ['title', 'harbor', 'seas', 'levelup', 'bosses', 'defeat'];
const STAGES = flags.stages ? String(flags.stages).split(',') : QUICK ? QUICK_STAGES : ALL_STAGES;
const ALL_SEAS = ['sunward-shallows', 'stormwrack-reach', 'the-gloam'];
const SEAS = flags.seas ? String(flags.seas).split(',') : QUICK ? ['sunward-shallows'] : ALL_SEAS;
for (const s of STAGES) if (!ALL_STAGES.includes(s)) { console.error(`unknown stage "${s}" (known: ${ALL_STAGES.join(', ')})`); process.exit(2); }

/** Which hero ship sails each part of the capture (all six appear in a full run). */
const SEA_SHIP = { 'sunward-shallows': 'sunlion', 'stormwrack-reach': 'dawn-ram', 'the-gloam': 'white-leviathan' };
/** Loadouts per sea so the full capture exercises all twelve weapons. */
const SEA_WEAPONS = {
  'sunward-shallows': { mid: [['bow-chaser', 3], ['stern-mortar', 3]], late: [['rocket-rack', 5], ['storm-rod', 4], ['broadside', 6]] },
  'stormwrack-reach': { mid: [['swivel-guns', 3], ['harpoon', 3]], late: [['tide-mines', 4], ['fire-barrels', 4], ['broadside', 5]] },
  'the-gloam': { mid: [['maelstrom-charm', 3], ['escort-skiffs', 3]], late: [['iron-ram', 4], ['bow-chaser', 5], ['broadside', 6]] },
};
/** Extra ships per sea state (the director adds its own floor on top). Round-1 stub classes are left out on purpose. */
const SEA_SPAWNS = {
  'sunward-shallows': { mid: [['frigate', 2], ['brig', 3], ['cutter', 3], ['skiff', 6], ['fireship', 2]], late: [['man-o-war', 1], ['frigate', 3], ['corsair-galleon', 1], ['mortar-barge', 2], ['skiff', 10], ['fireship', 3]] },
  'stormwrack-reach': { mid: [['corsair-brig', 3], ['brig', 2], ['cutter', 3], ['skiff', 8], ['wyrmling', 3]], late: [['corsair-galleon', 2], ['frigate', 2], ['mortar-barge', 2], ['fireship', 3], ['skiff', 10], ['wyrmling', 4]] },
  'the-gloam': { mid: [['wraith', 4], ['corsair-brig', 3], ['skiff', 8], ['cutter', 2]], late: [['wraith', 6], ['man-o-war', 1], ['corsair-galleon', 1], ['fireship', 3], ['skiff', 10], ['wyrmling', 3]] },
};

// ───────────────────────── state ─────────────────────────

const report = {
  tool: 'scripts/gauntlet/evidence.mjs', base: BASE, out: OUT, quick: QUICK, stages: STAGES, seas: SEAS, seed: SEED,
  viewport: { width: 1600, height: 900, dpr: DPR }, measureSeconds: MEASURE,
  startedAt: new Date().toISOString(), finishedAt: null, browser: null, gpu: null,
  load: null, transfer: null, shots: [], checks: {}, stageErrors: [], errors: [], warnings: [], audio: null, ui: null,
};
let page = null;
let stage = 'boot';
let shotIndex = 0;
let pendingErrors = [];
let lastAudio = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[evidence ${new Date().toISOString().slice(11, 19)}] [${stage}]`, ...a);
const ev = (fn, arg) => page.evaluate(fn, arg);

// ───────────────────────── in-page pilot ─────────────────────────

/**
 * Real-time pilot running inside the page (no CDP round-trips per step). Modes:
 *  - 'engage': sail at the nearest enemy, turn broadside inside 170 m, veer off inside 70 m, fire skills now and then;
 *  - 'boss':   close on the nearest boss until `stopDist`;
 *  - 'point':  sail to {x,z} until `stopDist`;
 *  - 'idle':   hold the helm amidships.
 * `fire: false` stops skill presses; `special: false` keeps the special charged for a later shot.
 * Stops on time, arrival, or `until` ('levelup' | 'chest' | 'dead' | 'results'). Chooses card 0 when `autoCards`.
 */
async function pilot(opts) {
  const o = { seconds: 10, mode: 'engage', stopDist: 0, autoCards: true, fire: true, until: null, target: null, ...opts };
  return ev((o) => new Promise((resolveP) => {
    const c = window.__CRUISE__;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const t0 = performance.now();
    const out = { reason: 'time', seconds: 0, cards: [], minDist: null, kills0: null, kills1: null, level0: null, level1: null };
    let lastQ = -99, lastE = -99, lastBrace = -99, lastR = -99;
    const finish = (reason) => {
      clearInterval(timer);
      out.reason = reason;
      out.seconds = +((performance.now() - t0) / 1000).toFixed(2);
      const s = c.summary();
      out.kills1 = s.stats?.kills ?? null; out.level1 = s.player?.level ?? null;
      resolveP(out);
    };
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      const s = c.summary();
      if (out.kills0 === null) { out.kills0 = s.stats?.kills ?? null; out.level0 = s.player?.level ?? null; }
      if (o.until === 'results' && s.screen === 'results') return finish('results');
      if (!s.player) return finish(s.screen === 'results' ? 'results' : 'no-run');
      if (o.until && s.status === o.until) return finish(o.until);
      if (s.status === 'levelup' || s.status === 'chest') {
        if (o.autoCards) { out.cards.push({ t: +t.toFixed(1), status: s.status, level: s.player.level, offers: s.offers }); c.chooseCard(0); }
      } else if (s.status === 'dead' || s.status === 'victory') {
        if (o.until !== 'results') return finish(s.status);
      } else if (s.status === 'running') {
        const p = s.player;
        let desired = p.heading;
        let tx, tz;
        if (o.mode === 'point' && o.target) { tx = o.target.x; tz = o.target.z; }
        else if (o.mode === 'engage' || o.mode === 'boss') {
          const list = c.nearest(o.mode === 'boss' ? 16 : 1);
          const n = o.mode === 'boss' ? list.find((q) => q.boss) : list[0];
          if (n) { tx = n.x; tz = n.z; }
        }
        if (tx !== undefined) {
          const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
          out.minDist = out.minDist === null ? Math.round(d) : Math.min(out.minDist, Math.round(d));
          const toward = Math.atan2(-dx, -dz);
          if (o.mode !== 'engage' || d > 170) desired = toward;
          else {
            const port = wrap(toward - Math.PI / 2), star = wrap(toward + Math.PI / 2);
            desired = Math.abs(wrap(port - p.heading)) < Math.abs(wrap(star - p.heading)) ? port : star;
            if (d < 70) desired = wrap(desired + (desired === port ? -0.6 : 0.6));
          }
          c.aim(tx, tz);
          if (o.fire && o.mode !== 'point') {
            if (t - lastQ > 6 && d < 170) { c.press('broadside'); lastQ = t; }
            if (o.special !== false && t - lastE > 18 && d < 160) { c.press('special'); lastE = t; }
            if (t - lastBrace > 6 && d < 45) { c.press('brace'); lastBrace = t; }
            if (t - lastR > 4) { c.press('ultimate'); lastR = t; }
          }
          if (o.stopDist > 0 && d <= o.stopDist && o.mode !== 'engage') return finish('arrived');
        }
        if (o.mode !== 'idle') { const diff = wrap(desired - p.heading); c.steer(Math.max(-1, Math.min(1, diff * 2.5))); }
        else c.steer(0);
      }
      if (t >= o.seconds) finish('time');
    };
    const timer = setInterval(step, 100);
    step();
  }), o);
}

// ───────────────────────── measurement ─────────────────────────

function pctl(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : 0; }

/** Profiler report → compact CPU split (mean/max/p95 per part, hitch counts, 3 worst frames). */
function cpuSplit(rep) {
  if (!rep || !rep.frames) return null;
  const totals = rep.worst.map((f) => f.total).sort((a, b) => a - b);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(+v).toFixed(2)]));
  return {
    frames: rep.frames,
    mean: round(rep.mean),
    max: round(rep.max),
    p50: +pctl(totals, 0.5).toFixed(2), p95: +pctl(totals, 0.95).toFixed(2), p99: +pctl(totals, 0.99).toFixed(2),
    over8ms: totals.filter((x) => x > 8).length, over16ms: totals.filter((x) => x > 16.7).length, over33ms: totals.filter((x) => x > 33.3).length,
    worst: rep.worst.slice(0, 3),
  };
}

/** Mean luma (0–255) of regions of a JPEG, via ffmpeg (crop → gray → 1×1 area average). */
function luma(file, regions) {
  const out = {};
  for (const [name, [x, y, w, h]] of Object.entries(regions)) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=${w}:${h}:${x}:${y},format=gray,scale=1:1:flags=area`, '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    out[name] = r.status === 0 && r.stdout.length ? r.stdout[0] : null;
  }
  return out;
}

async function audioSnapshot() {
  return ev(() => {
    const a = window.__CRUISE_AUDIO__;
    if (!a) return null;
    const s = a.stats();
    return { unlocked: s.unlocked, ctx: s.contextState, played: s.played, dropped: s.dropped, requested: s.requested, totalVoices: s.totalVoices, music: s.music, ducks: s.ducks, loops: s.loops };
  });
}

function diffCounts(now = {}, before = {}) {
  const d = {};
  for (const [k, v] of Object.entries(now)) { const x = v - (before[k] ?? 0); if (x) d[k] = x; }
  return d;
}

/**
 * One shot: measure `measure` seconds of real frames (pilot keeps sailing when in a run), then screenshot + collect.
 * opts: { measure, pilot: pilotOpts | false, plate: bool, note }
 */
async function shot(name, opts = {}) {
  const measure = opts.measure ?? MEASURE;
  const idx = String(shotIndex++).padStart(2, '0');
  const file = `${idx}-${name}.jpg`;
  await ev(() => { const c = window.__CRUISE__; c.profiler.reset(); window.__CRUISE_UI__?.resetPerf?.(); });
  const meter = [];
  const t0 = Date.now();
  const sampler = (async () => {
    while (Date.now() - t0 < measure * 1000) {
      const m = await ev(() => window.__CRUISE_AUDIO__?.meter?.() ?? null).catch(() => null);
      if (m) meter.push(m);
      await sleep(200);
    }
  })();
  if (opts.pilot) await pilot({ ...opts.pilot, seconds: measure });
  else await sleep(measure * 1000);
  await sampler;
  await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 82 });
  let plateFile = null;
  if (opts.plate) {
    plateFile = `${idx}-${name}-plate.jpg`;
    await ev(() => document.querySelector('#game-root')?.classList.add('hide-ui'));
    await sleep(120);
    await page.screenshot({ path: join(OUT, plateFile), type: 'jpeg', quality: 82 });
    await ev(() => document.querySelector('#game-root')?.classList.remove('hide-ui'));
  }
  const data = await ev(() => {
    const c = window.__CRUISE__;
    const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return {
      screen: c.screen(), summary: c.summary(), metrics: c.metrics(), scene: c.sceneStats(), cpu: c.profiler.report(1000),
      ui: window.__CRUISE_UI__?.perf?.() ?? null, heapMB: heap,
    };
  });
  const audio = await audioSnapshot();
  // Layout check: visible buttons/links that are clipped by the viewport or covered by another element.
  const layout = await ev(() => {
    const vw = innerWidth, vh = innerHeight, clipped = [], covered = [];
    for (const el of document.querySelectorAll('#game-root button, #game-root a[href]')) {
      if (el.closest('[hidden]') || el.closest('.hide-ui')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const text = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      const rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      if (r.bottom > vh + 1 || r.right > vw + 1 || r.top < -1 || r.left < -1) { clipped.push({ text, rect }); continue; }
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) covered.push({ text, rect, by: `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]}` });
    }
    return { clipped, covered };
  });
  const entry = {
    name, file, plate: plateFile, stage, note: opts.note ?? null, wall: new Date().toISOString(), screen: data.screen,
    sim: data.summary, cpu: cpuSplit(data.cpu),
    render: data.metrics && {
      drawCalls: data.metrics.drawCalls, triangles: data.metrics.triangles, programs: data.metrics.programs, geometries: data.metrics.geometries,
      textures: data.metrics.textures, dpr: data.metrics.dpr, tier: data.metrics.tier, frameMs: +(data.metrics.frameMs ?? 0).toFixed(2),
      frameP90: data.metrics.frameP90 != null ? +data.metrics.frameP90.toFixed(2) : null, gpuMs: data.metrics.gpuMs, missRate: data.metrics.missRate,
      fpsDoNotTrust: +(data.metrics.fps ?? 0).toFixed(1),
    },
    scene: data.scene, sceneTris: Object.values(data.scene ?? {}).reduce((a, g) => a + g.tris, 0), ui: data.ui, heapMB: data.heapMB,
    audio: audio && {
      music: audio.music && { state: audio.music.state, track: audio.music.track, intensity: audio.music.intensity, runState: audio.music.runState },
      voices: audio.totalVoices, played: diffCounts(audio.played, lastAudio?.played), dropped: diffCounts(audio.dropped, lastAudio?.dropped),
      meter: meter.length ? {
        rmsDbMean: +(meter.reduce((a, m) => a + m.rmsDb, 0) / meter.length).toFixed(1),
        rmsDbMax: Math.max(...meter.map((m) => m.rmsDb)), peakDbMax: Math.max(...meter.map((m) => m.peakDb)), samples: meter.length,
      } : null,
    },
    layout,
    errors: pendingErrors.splice(0),
  };
  lastAudio = audio;
  report.shots.push(entry);
  const c = entry.cpu;
  const lay = layout.clipped.length + layout.covered.length ? ` | layout: ${layout.clipped.length} clipped, ${layout.covered.length} covered` : '';
  log(`${file}: cpu mean ${c?.mean?.total ?? '-'} ms p95 ${c?.p95 ?? '-'} max ${c?.max?.total ?? '-'} | calls ${entry.render?.drawCalls} tris ${entry.render?.triangles} | enemies ${entry.sim?.enemies ?? '-'} | music ${entry.audio?.music?.state ?? '-'}${lay}${entry.errors.length ? ` | ${entry.errors.length} errors` : ''}`);
  return entry;
}

// ───────────────────────── run helpers ─────────────────────────

async function waitFor(fn, arg, timeout = 20000) {
  await page.waitForFunction(fn, arg, { timeout, polling: 100 });
}

async function startRun(ship, sea, { god = true } = {}) {
  await ev(({ ship, sea, god }) => {
    const c = window.__CRUISE__;
    c.startRun(ship, sea);
    if (god) c.debug.god(true);
    c.press('gear-up'); c.press('gear-up');
  }, { ship, sea, god });
  await waitFor(() => window.__CRUISE__.summary().status === 'running', null, 15000);
  await sleep(300);
  await ev(() => window.__CRUISE__.press('gear-up'));
}

/** Jumps the clock, levels up (debug picks card 0 each level), then adds missing weapons while slots are free. */
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
    for (const [id, n, elite] of spawns) d.spawn(id, n, !!elite);
    return { weapons: s.weapons, passives: s.passives, level: s.player.level };
  }, { time, level, weapons, spawns });
}

async function toHarbor() {
  const screen = await ev(() => window.__CRUISE__.screen());
  if (screen === 'results') {
    await clickText('.cr-results__buttons button', 'Return to Harbor').catch(async () => { await page.keyboard.press('Escape'); });
    await waitFor(() => window.__CRUISE__.screen() === 'harbor', null, 8000).catch(() => undefined);
  }
  await ev(() => window.__CRUISE__.goHarbor());
  await sleep(400);
}

async function clickText(selector, text) {
  const loc = page.locator(selector, { hasText: text }).first();
  await loc.click({ timeout: 4000 });
}

// ───────────────────────── stages ─────────────────────────

const stages = {
  async title() {
    await shot('title', { measure: MEASURE });
  },

  async harbor() {
    await page.mouse.click(800, 450); // real gesture: unlocks audio and leaves the title
    await ev(() => window.__CRUISE__.goHarbor());
    await waitFor(() => window.__CRUISE__.screen() === 'harbor', null, 8000);
    await sleep(1400);
    await shot('harbor-fleet');
    if (QUICK) return;
    for (const tab of ['seas', 'shipwright']) {
      await page.locator(`[data-tab="${tab}"]`).first().click({ timeout: 4000 });
      await sleep(700);
      await shot(`harbor-${tab}`, { measure: 1 });
    }
    await page.locator('[data-tab="fleet"]').first().click({ timeout: 4000 }).catch(() => undefined);
  },

  async settings() {
    await toHarbor();
    await clickText('.cr-harbor__meta button', 'Settings');
    await sleep(600);
    await shot('settings', { measure: 1 });
    await page.keyboard.press('Escape');
    await sleep(300);
  },

  async seas() {
    for (const sea of SEAS) {
      const tag = sea === 'the-gloam' ? 'gloam' : sea.split('-')[0];
      const ship = SEA_SHIP[sea];
      await startRun(ship, sea);
      // Early: the real opening, no clock jump. Record the first kill / level for pacing.
      const early = await pilot({ seconds: QUICK ? 12 : 24, mode: 'engage' });
      report.checks[`${tag}-opening`] = { ship, seconds: early.seconds, kills: early.kills1, level: early.level1, cards: early.cards.map((c) => ({ t: c.t, level: c.level, pick: c.offers?.[0] })) };
      await shot(`${tag}-early`, { pilot: { mode: 'engage' }, plate: tag === 'sunward' });
      if (!QUICK) {
        const w = SEA_WEAPONS[sea];
        const lo = await loadout({ time: 6 * 60 + 10, level: 12, weapons: w.mid, spawns: SEA_SPAWNS[sea].mid });
        report.checks[`${tag}-mid-loadout`] = lo;
        await pilot({ seconds: 11, mode: 'engage' });
        await shot(`${tag}-mid`, { pilot: { mode: 'engage' }, plate: tag === 'stormwrack' });
      }
      const w = SEA_WEAPONS[sea];
      const lo = await loadout({ time: 12 * 60 + 30, level: 24, weapons: [...(QUICK ? w.mid : []), ...w.late], spawns: SEA_SPAWNS[sea].late });
      report.checks[`${tag}-late-loadout`] = lo;
      await pilot({ seconds: QUICK ? 8 : 13, mode: 'engage', special: false });
      await shot(`${tag}-late`, { pilot: { mode: 'engage', special: false }, plate: tag === 'sunward' && !QUICK });
      if (!QUICK) {
        // Signature moments: the ship's special, then its ultimate.
        await ev(() => window.__CRUISE__.press('special'));
        await shot(`${tag}-special-${ship}`, { measure: 0.9, pilot: { mode: 'engage', fire: false } });
        await ev(() => { const c = window.__CRUISE__; c.debug.chargeUltimate(); c.press('ultimate'); });
        await shot(`${tag}-ultimate-${ship}`, { measure: 1.4, pilot: { mode: 'engage', fire: false } });
      }
    }
  },

  async levelup() {
    const sea = 'sunward-shallows';
    await startRun('sunlion', sea);
    await loadout({ time: 4 * 60, level: 9, weapons: [['bow-chaser', 2]], spawns: [['brig', 2], ['skiff', 6]] });
    await pilot({ seconds: QUICK ? 5 : 8, mode: 'engage' });
    const pre = await shot('levelup-pre', { measure: 1, pilot: { mode: 'engage', autoCards: false } });
    await ev(() => window.__CRUISE__.debug.xp(400));
    await waitFor(() => window.__CRUISE__.summary().status === 'levelup', null, 5000);
    await sleep(1300); // cards dealt
    const lv = await shot('levelup', { measure: 0.6 });
    // Did the level-up screen darken the battle? Compare region luma before/while the cards are up.
    const regions = {
      cornerTL: [0, 0, 240, 135], cornerTR: [1360, 0, 240, 135], cornerBL: [0, 765, 240, 135], cornerBR: [1360, 765, 240, 135],
      leftMid: [0, 300, 180, 300], rightMid: [1420, 300, 180, 300], topMid: [560, 0, 480, 80], full: [0, 0, 1600, 900],
    };
    const a = luma(join(OUT, pre.file), regions), b = luma(join(OUT, lv.file), regions);
    const ratio = Object.fromEntries(Object.keys(regions).map((k) => [k, a[k] && b[k] != null ? +(b[k] / a[k]).toFixed(2) : null]));
    report.checks.levelupDarkening = { before: a, during: b, ratio, note: 'ratio < 0.8 on the edges = visible darkening; the sea keeps moving between frames (±5% noise)' };
    log('level-up luma ratio', JSON.stringify(ratio));
    const offers = await ev(() => window.__CRUISE__.summary().offers);
    report.checks.levelupOffers = offers;
    await ev(() => window.__CRUISE__.chooseCard(0));
    await sleep(500);
    // Drain any queued level-ups so later stages start clean.
    await pilot({ seconds: 2, mode: 'engage' });
  },

  async bosses() {
    await startRun('sunlion', 'sunward-shallows');
    await loadout({ time: 200, level: 15, weapons: [['bow-chaser', 4], ['stern-mortar', 3], ['swivel-guns', 3]] });
    const ids = QUICK ? ['iron-warden'] : ['iron-warden', 'tidewyrm', 'sovereign'];
    for (const id of ids) {
      await ev((id) => window.__CRUISE__.debug.boss(id), id);
      const approach = await pilot({ seconds: 22, mode: 'boss', stopDist: 150 });
      report.checks[`boss-${id}-approach`] = { reason: approach.reason, seconds: approach.seconds, minDist: approach.minDist };
      await shot(`boss-${id}`, { pilot: { mode: 'engage' }, plate: id === 'tidewyrm' });
      const pos = await ev(() => { const b = window.__CRUISE__.nearest(16).find((q) => q.boss); return b ? { x: b.x, z: b.z } : null; });
      await ev(() => window.__CRUISE__.debug.sinkBosses());
      await sleep(700);
      await shot(`boss-${id}-sinking`, { measure: 0.5, plate: id === 'iron-warden' && !QUICK });
      if (id === 'iron-warden' && pos) {
        // The boss drops a tier-2 chest where it sank: sail over it to open the chest reveal.
        const got = await pilot({ seconds: 30, mode: 'point', target: pos, autoCards: true, until: 'chest', fire: false });
        report.checks.chest = { reason: got.reason, seconds: got.seconds };
        if (got.reason === 'chest') {
          await sleep(1400);
          await shot('chest', { measure: 0.6 });
          report.checks.chestOffers = await ev(() => window.__CRUISE__.summary().offers);
          await ev(() => window.__CRUISE__.chooseCard(0));
        }
      }
      await pilot({ seconds: 2, mode: 'engage' });
    }
  },

  async 'gloam-night'() {
    await startRun('grand-galley', 'the-gloam');
    await loadout({
      time: 7 * 60, level: 16, weapons: [['swivel-guns', 4], ['fire-barrels', 3], ['stern-mortar', 3]],
      spawns: [['wraith', 6], ['corsair-brig', 4], ['skiff', 10], ['fireship', 2], ['frigate', 1]],
    });
    const melee = await pilot({ seconds: 14, mode: 'engage' });
    report.checks.gloamNight = { minDist: melee.minDist };
    await shot('gloam-night-melee', { pilot: { mode: 'engage' }, plate: true });
  },

  async victory() {
    await startRun('seawarden', 'sunward-shallows');
    await loadout({ time: 14.9 * 60, level: 22, weapons: [['stern-mortar', 4], ['rocket-rack', 3]] });
    await waitFor(() => window.__CRUISE__.summary().bosses.some((b) => b.startsWith('sovereign')), null, 20000);
    const approach = await pilot({ seconds: 14, mode: 'boss', stopDist: 170 });
    report.checks.victoryApproach = { reason: approach.reason, seconds: approach.seconds, minDist: approach.minDist };
    await ev(() => window.__CRUISE__.debug.sinkBosses());
    await sleep(900);
    const lap = await shot('victory-lap', { measure: 0.8 });
    // The final boss's XP can queue level-ups that pause the victory lap; record it, then pick through them.
    report.checks.victoryLapStatus = { status: lap.sim?.status ?? null, level: lap.sim?.player?.level ?? null, offers: lap.sim?.offers ?? null };
    const through = await pilot({ seconds: 25, mode: 'idle', until: 'results', autoCards: true });
    report.checks.victoryLapStatus.cardsPicked = through.cards.length;
    await waitFor(() => window.__CRUISE__.screen() === 'results', null, 20000);
    await sleep(3200); // bounty count-up + stamp
    await shot('results-victory', { measure: 0.8 });
  },

  async defeat() {
    await toHarbor();
    await startRun('dawn-ram', 'stormwrack-reach', { god: false });
    await sleep(800);
    await page.keyboard.press('Escape');
    await sleep(700);
    await shot('pause', { measure: 0.6 });
    await page.keyboard.press('Escape');
    await sleep(500);
    if (!QUICK) {
      await loadout({ time: 13 * 60, spawns: [['fireship', 8], ['skiff', 16], ['mortar-barge', 3], ['frigate', 2], ['corsair-brig', 3]] });
      await ev(() => { const c = window.__CRUISE__; c.press('gear-down'); });
      const fight = await pilot({ seconds: 70, mode: 'idle', until: 'dead', autoCards: true });
      report.checks.defeat = { reason: fight.reason, seconds: fight.seconds };
      if (fight.reason === 'dead') {
        await sleep(250);
        await shot('defeat-sinking', { measure: 0.3 });
        await waitFor(() => window.__CRUISE__.screen() === 'results', null, 15000);
        await sleep(3200);
        await shot('results-defeat', { measure: 0.8 });
        return;
      }
    }
    // Retire through the real pause menu.
    await page.keyboard.press('Escape');
    await sleep(500);
    await clickText('.cr-pause__menu button', 'Retire');
    await sleep(400);
    await shot('retire-confirm', { measure: 0.4 });
    await page.locator('.cr-confirm .cr-btn.is-danger').first().click({ timeout: 4000 });
    await waitFor(() => window.__CRUISE__.screen() === 'results', null, 15000);
    await sleep(3200);
    await shot('results-retired', { measure: 0.8 });
  },

  async 'harbor-after'() {
    await toHarbor();
    await sleep(1200);
    await shot('harbor-after', { measure: 1 });
  },
};

// ───────────────────────── contact sheet ─────────────────────────

/** Labelled 480×270 thumbnails rendered in a blank page (this ffmpeg build has no drawtext). */
async function makeThumbs(browser, dir, files) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const p = await browser.newPage();
  try {
    for (let i = 0; i < files.length; i++) {
      const b64 = (await readFile(join(OUT, files[i]))).toString('base64');
      const data = await p.evaluate(async ({ b64, label }) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = 480; cv.height = 270;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0, 480, 270);
        g.fillStyle = 'rgba(4,8,20,.72)'; g.fillRect(0, 0, 480, 24);
        g.fillStyle = '#fff'; g.font = '600 15px Helvetica, Arial, sans-serif'; g.fillText(label, 8, 17);
        return cv.toDataURL('image/jpeg', 0.86).split(',')[1];
      }, { b64, label: files[i].replace(/\.jpg$/, '') });
      await writeFile(join(dir, `${String(i).padStart(3, '0')}.jpg`), Buffer.from(data, 'base64'));
    }
  } finally {
    await p.close().catch(() => undefined);
  }
}

function tileSheet(dir, count, labelled) {
  const cols = Math.min(6, Math.max(1, count)), rows = Math.max(1, Math.ceil(count / cols));
  const vf = `${labelled ? '' : 'scale=480:270,'}tile=${cols}x${rows}:padding=4:margin=4:color=0x0b1220`;
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-start_number', '0', '-i', join(dir, '%03d.jpg'), '-vf', vf, '-frames:v', '1', '-q:v', '3', join(OUT, 'contact-sheet.jpg')], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || `ffmpeg exited ${r.status}`);
}

// ───────────────────────── main ─────────────────────────

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: !flags.headed,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
let thumbsDir = null;
try {
  report.browser = browser.version();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: DPR });
  page = await ctx.newPage();
  page.on('pageerror', (e) => { const x = { stage, type: 'pageerror', text: String(e.message ?? e).slice(0, 400) }; report.errors.push(x); pendingErrors.push(x); });
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') { const x = { stage, type: 'console.error', text: m.text().slice(0, 400) }; report.errors.push(x); pendingErrors.push(x); }
    else if (t === 'warning' && report.warnings.length < 200) report.warnings.push({ stage, text: m.text().slice(0, 300) });
  });
  page.on('crash', () => { report.errors.push({ stage, type: 'crash', text: 'page crashed' }); });

  stage = 'load';
  const tNav = Date.now();
  await page.goto(`${BASE}/?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tDom = Date.now();
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000, polling: 100 });
  const tReady = Date.now();
  report.load = { domContentLoadedMs: tDom - tNav, readyMs: tReady - tNav };
  report.gpu = await ev(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? { vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) } : null;
  });
  // Instrumentation (harness-side): count SimEvent types as the audio engine sees them each frame.
  await ev(() => {
    const eng = window.__CRUISE_AUDIO__?.engine;
    window.__GAUNTLET_EVENTS__ = {};
    if (!eng) return;
    const orig = eng.update.bind(eng);
    eng.update = (frame) => { for (const e of frame.events) window.__GAUNTLET_EVENTS__[e.type] = (window.__GAUNTLET_EVENTS__[e.type] ?? 0) + 1; return orig(frame); };
  });
  await ev(() => window.__CRUISE__.profiler.enable(true));
  await sleep(2500);
  log(`ready in ${report.load.readyMs} ms · ${report.gpu?.renderer ?? 'no webgl2'} · ${report.browser}`);

  for (const name of STAGES) {
    stage = name;
    const t0 = Date.now();
    try {
      await stages[name]();
    } catch (err) {
      const msg = String(err?.message ?? err).split('\n')[0].slice(0, 300);
      report.stageErrors.push({ stage: name, error: msg });
      log(`stage failed: ${msg}`);
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  stage = 'wrap-up';
  report.transfer = await ev(() => {
    const byType = {};
    let total = 0, decoded = 0;
    for (const r of performance.getEntriesByType('resource')) {
      const url = r.name.split('?')[0];
      const ext = (url.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'other').toLowerCase();
      const e = (byType[ext] ??= { files: 0, transferKB: 0, decodedKB: 0 });
      e.files++; e.transferKB += r.transferSize / 1024; e.decodedKB += r.decodedBodySize / 1024;
      total += r.transferSize; decoded += r.decodedBodySize;
    }
    for (const e of Object.values(byType)) { e.transferKB = Math.round(e.transferKB); e.decodedKB = Math.round(e.decodedKB); }
    const big = performance.getEntriesByType('resource').sort((a, b) => b.decodedBodySize - a.decodedBodySize).slice(0, 15)
      .map((r) => ({ url: r.name.replace(location.origin, ''), KB: Math.round(r.decodedBodySize / 1024), ms: Math.round(r.duration) }));
    return { totalMB: +(total / 1048576).toFixed(2), decodedMB: +(decoded / 1048576).toFixed(2), byType, largest: big };
  });
  report.audio = await ev(() => {
    const a = window.__CRUISE_AUDIO__;
    if (!a) return null;
    const s = a.stats();
    return { stats: s, events: window.__GAUNTLET_EVENTS__ ?? null, log: a.log(400) };
  });
  report.ui = await ev(() => ({ perf: window.__CRUISE_UI__?.perf?.() ?? null, spikes: window.__CRUISE_UI__?.spikes?.() ?? null }));

  const files = report.shots.flatMap((s) => (s.plate ? [s.file, s.plate] : [s.file]));
  if (files.length) {
    thumbsDir = join(OUT, '.thumbs');
    await makeThumbs(browser, thumbsDir, files).catch((e) => { report.stageErrors.push({ stage: 'thumbs', error: String(e.message ?? e) }); thumbsDir = null; });
  }
} finally {
  await browser.close().catch(() => undefined);
  report.finishedAt = new Date().toISOString();
  // Contact sheet: labelled thumbnails when available, else the raw shots scaled by ffmpeg.
  const files = report.shots.flatMap((s) => (s.plate ? [s.file, s.plate] : [s.file]));
  if (files.length) {
    let dir = thumbsDir;
    if (!dir) {
      dir = join(OUT, '.thumbs-raw');
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      for (let i = 0; i < files.length; i++) spawnSync('cp', [join(OUT, files[i]), join(dir, `${String(i).padStart(3, '0')}.jpg`)]);
    }
    const err = tileSheet(dir, files.length, !!thumbsDir);
    report.contactSheet = err ? { error: err } : { file: 'contact-sheet.jpg', tiles: files };
    await rm(dir, { recursive: true, force: true });
  }
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const cpu = report.shots.filter((s) => s.cpu).map((s) => s.cpu.mean.total);
  console.log(JSON.stringify({
    out: OUT, shots: report.shots.length, stageErrors: report.stageErrors, errors: report.errors.length,
    cpuMeanMs: cpu.length ? +(cpu.reduce((a, b) => a + b, 0) / cpu.length).toFixed(2) : null, cpuMeanMaxMs: cpu.length ? Math.max(...cpu) : null,
    maxDrawCalls: Math.max(0, ...report.shots.map((s) => s.render?.drawCalls ?? 0)), maxTriangles: Math.max(0, ...report.shots.map((s) => s.render?.triangles ?? 0)),
    levelupDarkening: report.checks.levelupDarkening?.ratio ?? null, contactSheet: report.contactSheet ?? null,
  }, null, 1));
}
