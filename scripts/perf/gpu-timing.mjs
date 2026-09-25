#!/usr/bin/env node
/**
 * GPU timing per render pass (PERF round 2). Measures GPU milliseconds per frame and per pass with
 * EXT_disjoint_timer_query_webgl2, on a frozen build, in a real (headed) Chrome window.
 *
 *   node scripts/perf/gpu-timing.mjs <baseUrl> <outDir> [--cases title,harbor,early,late,boss] [--warm 5] [--seconds 15]
 *                                    [--dpr 1] [--runs 1] [--headless] [--force]
 *
 * METHOD (read before trusting a number)
 *  1. Idle machine. Other sessions share this GPU; their work lands inside our TIME_ELAPSED queries. Close other
 *     browsers, Blender and capture jobs, keep the laptop on power, and wait for `uptime` to show a 1-minute load
 *     average under ~2. The script records os.loadavg() before and after every case and refuses to start above 4
 *     (override with --force; such numbers are marked `contaminated`). Get the owner's go-ahead before idling a
 *     machine other agents are using.
 *  2. Frozen build: `npx vite build --outDir /tmp/cruise-gpu-dist && npx vite preview --outDir /tmp/cruise-gpu-dist
 *     --port <yours> --strictPort --host 127.0.0.1`. Never time a dev server.
 *  3. Fixed resolution: the page loads with `?dpr=<n>` (adaptive resolution off) and `?gpupasses` (the renderer
 *     brackets each pass with a timer query: prepass, colour-setup, shadow, colour, bloom, composite; `scene` is
 *     the gap before the first pass). Window 1600×900, headed and visible (an occluded or headless window may not
 *     present frames at the display rate).
 *  4. Per case: set the state, warm up `--warm` s (programs linked, textures resident, queries flowing), then sample
 *     `--seconds` s. Reported: per-frame GPU total p50/p90 (sum of the pass queries of one frame), per-pass smoothed
 *     means, rAF frame interval, draw calls and triangles. Repeat with `--runs 3` and quote the median run.
 *  5. Caveats: on Chrome/ANGLE-Metal a TIME_ELAPSED result is the command-buffer span of that pass and can include
 *     scheduling gaps; treat passes as relative weights and the frame total as an upper bound. Disjoint events drop
 *     samples (reported). No timer extension → only rAF intervals and CPU timings are reported.
 * The browser always closes in `finally`. Keep <outDir> under output/ (gitignored).
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--cases', '--warm', '--seconds', '--dpr', '--runs'].includes(a)) flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true; else pos.push(a);
}
const BASE = (pos[0] ?? 'http://127.0.0.1:4206').replace(/\/$/, '');
const OUT = resolve(pos[1] ?? 'output/r2-perf/gpu');
const CASES = String(flags.cases ?? 'title,harbor,early,late,boss').split(',');
const WARM = Number(flags.warm ?? 5), SECONDS = Number(flags.seconds ?? 15), DPR = Number(flags.dpr ?? 1), RUNS = Number(flags.runs ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => os.loadavg().map((x) => +x.toFixed(2));

const startLoad = load();
if (startLoad[0] > 4 && !flags.force) {
  console.error(`[gpu] load average ${startLoad[0]} > 4: the GPU is shared right now. Wait for an idle machine or pass --force (numbers will be marked contaminated).`);
  process.exit(3);
}

const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))].toFixed(3); };

async function runOnce(run) {
  const browser = await chromium.launch({
    headless: !!flags.headless,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  });
  const results = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
    await page.goto(`${BASE}/?seed=gpu-timing&gpupasses&dpr=${DPR}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__CRUISE__?.ready && window.__PERF__?.gpu, null, { timeout: 120000, polling: 100 });
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const env = await ev(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, timer: !!gl?.getExtension('EXT_disjoint_timer_query_webgl2'), gpu: window.__PERF__.gpu() };
    });
    const setups = {
      title: async () => {},
      harbor: async () => {
        await page.mouse.click(800, 450);
        await ev(() => window.__CRUISE__.goHarbor());
        // Let the harbor warm-up finish (programs, textures) before timing.
        for (let i = 0; i < 60; i++) { if (await ev(() => !!window.__PERF__?.warmup?.()?.finished)) break; await sleep(500); }
      },
      early: async () => { await ev(() => { const c = window.__CRUISE__; c.startRun('sunlion', 'sunward-shallows'); c.debug.god(true); }); await sleep(8000); },
      late: async () => {
        await ev(() => {
          const c = window.__CRUISE__, d = c.debug;
          if (c.screen() !== 'run') { c.startRun('sunlion', 'sunward-shallows'); d.god(true); }
          d.time(12 * 60 + 30); d.level(24);
          for (const [w, l] of [['rocket-rack', 5], ['storm-rod', 4], ['broadside', 6]]) d.weapon(w, l);
          for (const [id, n] of [['man-o-war', 1], ['frigate', 3], ['corsair-galleon', 1], ['mortar-barge', 2], ['skiff', 10], ['fireship', 3]]) d.spawn(id, n);
        });
      },
      boss: async () => {
        await ev(() => { const c = window.__CRUISE__; if (c.screen() !== 'run') { c.startRun('sunlion', 'sunward-shallows'); c.debug.god(true); } c.debug.boss('sovereign'); });
      },
    };
    for (const name of CASES) {
      if (!setups[name]) { console.warn(`[gpu] unknown case ${name}`); continue; }
      const loadBefore = load();
      await setups[name]();
      const t0 = Date.now();
      const keepGoing = async () => ev(() => {
        const c = window.__CRUISE__; const s = c.summary();
        if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0);
        const n = s.player ? c.nearest(1)[0] : null;
        if (n) { c.aim(n.x, n.z); c.steer(0.2); }
      });
      while (Date.now() - t0 < WARM * 1000) { await keepGoing(); await sleep(250); }
      const frames = [], passes = {}, intervals = [];
      let samples = 0;
      const t1 = Date.now();
      while (Date.now() - t1 < SECONDS * 1000) {
        await keepGoing();
        const g = await ev(() => ({ gpu: window.__PERF__.gpu(), m: window.__CRUISE__.metrics() }));
        if (g.gpu?.frames?.length) frames.push(...g.gpu.frames.slice(-10));
        for (const [k, v] of Object.entries(g.gpu?.passes ?? {})) (passes[k] ??= []).push(v);
        intervals.push(g.m.frameMs);
        samples++;
        await sleep(1000);
      }
      const m = await ev(() => window.__CRUISE__.metrics());
      const loadAfter = load();
      const entry = {
        case: name, run, samples, contaminated: Math.max(loadBefore[0], loadAfter[0]) > 2, loadBefore, loadAfter,
        gpuFrameMs: { p50: pct(frames, 0.5), p90: pct(frames, 0.9), n: frames.length },
        passMs: Object.fromEntries(Object.entries(passes).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)])),
        rafMs: { mean: +(intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length)).toFixed(2) },
        drawCalls: m.drawCalls, triangles: m.triangles, dpr: m.dpr,
      };
      results.push(entry);
      console.log(`[gpu] run ${run} ${name}: gpu p50 ${entry.gpuFrameMs.p50} ms p90 ${entry.gpuFrameMs.p90} | ${Object.entries(entry.passMs).map(([k, v]) => `${k} ${v}`).join(', ')} | raf ${entry.rafMs.mean} ms | load ${loadBefore[0]}→${loadAfter[0]}${entry.contaminated ? ' (contaminated)' : ''}`);
    }
    return { env, results };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

await mkdir(OUT, { recursive: true });
const report = { tool: 'scripts/perf/gpu-timing.mjs', base: BASE, dpr: DPR, warm: WARM, seconds: SECONDS, startedAt: new Date().toISOString(), startLoad, runs: [] };
try {
  for (let r = 1; r <= RUNS; r++) report.runs.push(await runOnce(r));
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'gpu-timing.json'), JSON.stringify(report, null, 1));
  console.log(`[gpu] wrote ${join(OUT, 'gpu-timing.json')}`);
}
