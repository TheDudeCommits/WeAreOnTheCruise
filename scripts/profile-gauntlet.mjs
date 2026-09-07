#!/usr/bin/env node
/** Sustained, headed-browser measurements. No capture mode, synthetic stepping or engine FPS averages. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import os from 'node:os';

const baseURL = process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const output = resolve(process.env.CRUISE_PROFILE_DIR ?? 'output/overhaul-gauntlet/performance');
const seed = 'sustained-gauntlet-A';
const warmupMs = 5_000;
const sampleMs = 15_000;
const scenes = {
  'calm-sailing': 'chase',
  'perf-fleet': 'overhead',
  'sunny-broadside': 'broadside',
  'storm-sailing': 'chase',
  // No ghost-fog scenario exists. This authored scene supplies the fog workload.
  'island-discovery': 'chase',
};
const viewports = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2, hasTouch: false },
  landscape: { width: 844, height: 390, deviceScaleFactor: 2, hasTouch: true },
};
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/profile-gauntlet.mjs [scene ...] [--dry-run]\n'
    + 'CRUISE_URL: running game URL; CRUISE_PROFILE_DIR: evidence directory.\n'
    + 'CRUISE_PROFILE_VIEWPORTS: desktop,landscape (default both).\n'
    + `Scenes: ${Object.keys(scenes).join(', ')}. Each case uses 5s warmup + 15s real RAF sampling.\n`
    + 'Always headed Chromium; landscape is desktop-GPU viewport/touch emulation, not mobile hardware.');
  process.exit(0);
}
if (args.some((arg) => arg.startsWith('--') && arg !== '--dry-run')) throw new Error('Unknown option; use --help.');
const requestedScenes = args.filter((arg) => !arg.startsWith('--'));
const selectedScenes = requestedScenes.length ? [...new Set(requestedScenes)] : Object.keys(scenes);
const selectedViewports = [...new Set((process.env.CRUISE_PROFILE_VIEWPORTS ?? 'desktop,landscape').split(',').map((value) => value.trim()))];
if (selectedScenes.some((scene) => !Object.hasOwn(scenes, scene))) throw new Error('Unknown scenario; use --help for authored cases.');
if (selectedViewports.some((name) => !Object.hasOwn(viewports, name))) throw new Error('CRUISE_PROFILE_VIEWPORTS must contain desktop and/or landscape.');
const jobs = selectedViewports.flatMap((viewport) => selectedScenes.map((scene) => ({ viewport, scene, camera: scenes[scene] })));
const urlFor = (scene) => {
  const url = new URL(baseURL);
  for (const key of ['capture', 'ui', 'scenario']) url.searchParams.delete(key);
  for (const [key, value] of Object.entries({ quality: 'auto', hud: '1', seed, scene })) url.searchParams.set(key, value);
  return url.href;
};
const configuration = {
  baseURL, output, seed, warmupMs, sampleMs, quality: 'auto', headless: false, selectedShip:process.env.CRUISE_PROFILE_SHIP??null,
  initialRendererDpr: 1.5, adaptiveDprAllowed: true, viewports,
  notes: ['Ordinary launch UI is dismissed through real buttons.', 'RAF intervals are uncapped wall-clock samples.',
    'Adaptive DPR is observed, not overridden.', 'Landscape runs on the same desktop CPU/GPU, not a physical mobile device.',
    'Screenshots occur after sampling; screenshot work is outside the measured interval.'],
  jobs: jobs.map((job) => ({ ...job, url: urlFor(job.scene) })),
};
if (args.includes('--dry-run')) { console.log(JSON.stringify(configuration, null, 2)); process.exit(0); }

const cpus = os.cpus();
const machine = {
  platform: os.platform(), osType: os.type(), release: os.release(), version: os.version(), architecture: os.arch(),
  cpuModels: [...new Set(cpus.map((cpu) => cpu.model))], logicalCpuCount: cpus.length,
  reportedCpuMhz: [...new Set(cpus.map((cpu) => cpu.speed))], totalMemoryBytes: os.totalmem(),
  nodeVersion: process.version,
};
const records = [];
await mkdir(output, { recursive: true });
let browser;

/** A frozen/hidden RAF must fail rather than leave Chromium open indefinitely. */
async function deadline(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

function summarize(intervals) {
  if (!intervals.length) throw new Error('No real animation-frame intervals were recorded.');
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((sum, value) => sum + value, 0);
  const percentile = (p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    samples: intervals.length, measuredMs: total, averageFps: intervals.length * 1000 / total,
    meanFrameMs: total / intervals.length, p50FrameMs: percentile(.5), p95FrameMs: percentile(.95),
    p99FrameMs: percentile(.99), maxFrameMs: sorted.at(-1),
    overBudget: Object.fromEntries([25, 33.4, 50, 100].map((ms) => {
      const count = intervals.filter((value) => value > ms).length;
      return [`${ms}ms`, { count, percent: count * 100 / intervals.length }];
    })),
  };
}

try {
  // No forced software renderer, synthetic GPU flags, CPU throttling or headless fallback.
  browser = await chromium.launch({ headless: false });
  const browserVersion = browser.version();
  await writeFile(resolve(output, 'configuration.json'), `${JSON.stringify({ ...configuration, machine, browserVersion }, null, 2)}\n`);
  for (const job of jobs) {
    const viewport = viewports[job.viewport];
    const name = `${job.viewport}-${job.scene}`;
    const record = { ...job, name, url: urlFor(job.scene), requestedViewport: viewport, browserVersion, startedAt: new Date().toISOString(), errors: [], consoleMessages: [], failedRequests: [], scripts: [] };
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: viewport.deviceScaleFactor, hasTouch: viewport.hasTouch, isMobile: false });
    let page;
    const scriptReads = [];
    try {
      page = await context.newPage();
      page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(60_000);
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) record.consoleMessages.push({ type: message.type(), text: message.text(), location: message.location() });
        if (message.type() === 'error') record.errors.push({ source: 'console', message: message.text() });
      });
      page.on('pageerror', (error) => record.errors.push({ source: 'pageerror', message: error.stack ?? error.message }));
      page.on('requestfailed', (request) => record.failedRequests.push({ url: request.url(), resourceType: request.resourceType(), failure: request.failure() }));
      page.on('response', (response) => {
        if (response.request().resourceType() !== 'script') return;
        scriptReads.push((async () => {
          const item = { url: response.url(), status: response.status(), contentType: response.headers()['content-type'], etag: response.headers().etag };
          try { const body = await response.body(); Object.assign(item, { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }); }
          catch (error) { item.hashError = String(error); }
          record.scripts.push(item);
        })());
      });
      await page.goto(record.url, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready === true, null, { timeout: 60_000 });
      if(process.env.CRUISE_PROFILE_SHIP){
        await page.locator(`[data-ship="${process.env.CRUISE_PROFILE_SHIP}"]`).click();
        await page.waitForFunction(kind=>window.__CRUISE_DEBUG__.getState().ships.find(ship=>ship.isPlayer)?.kind===kind,process.env.CRUISE_PROFILE_SHIP);
        await page.evaluate(()=>window.__CRUISE_DEBUG__.readyAssets());
      }
      const launch = page.locator('[data-action="launch"]');
      if (await launch.isVisible()) { await launch.click(); record.launchDismissedBy = 'actual launch button'; }
      else record.launchDismissedBy = 'launch overlay was already absent';
      await page.locator('[data-ui="intro"]').waitFor({ state: 'hidden' });
      const chartClose = page.getByRole('button', { name: 'Close voyage chart', exact: true });
      if (await chartClose.isVisible()) await chartClose.click();
      await page.evaluate(({ scene, camera }) => {
        const debug = window.__CRUISE_DEBUG__;
        if (document.documentElement.dataset.capture === 'true') throw new Error('Capture mode invalidates this benchmark.');
        if (debug.getScene() !== scene) throw new Error(`Expected ${scene}, got ${debug.getScene()}`);
        debug.setCamera(camera); debug.setPaused(false);
      }, job);
      await page.waitForFunction(() => !window.__CRUISE_DEBUG__.getState().paused && document.visibilityState === 'visible');
      await deadline(Promise.all(scriptReads), 20_000, 'Startup script hashing');
      record.browser = await page.evaluate(() => {
        const canvas = document.getElementById('cruise-canvas');
        const gl = canvas.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemoryGiB: navigator.deviceMemory ?? null, devicePixelRatio: window.devicePixelRatio,
          quality: document.getElementById('game-root')?.dataset.quality,
          initialCanvas: { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, renderDpr: canvas.width / canvas.clientWidth },
          webgl: gl ? { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
            unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
            version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION), contextAttributes: gl.getContextAttributes() } : null,
        };
      });
      await deadline(page.evaluate((duration) => new Promise((done) => {
        let start;
        const warm = (now) => { start ??= now; if (now - start >= duration) done(); else requestAnimationFrame(warm); };
        requestAnimationFrame(warm);
      }), warmupMs), warmupMs + 20_000, 'RAF warmup');

      record.sample = await deadline(page.evaluate((duration) => new Promise((done) => {
        const debug = window.__CRUISE_DEBUG__, canvas = document.getElementById('cruise-canvas');
        const canvasState = () => ({ width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, renderDpr: canvas.width / canvas.clientWidth, deviceDpr: window.devicePixelRatio });
        const stateSummary = () => {
          const state = debug.getState(), { fps: _fps, frameMs: _frameMs, ...renderCounters } = debug.getMetrics();
          return { scene: debug.getScene(), elapsed: state.elapsed, paused: state.paused, timeScale: state.timeScale,
            visibility: document.visibilityState, mode: state.mode, weather: state.weather, playerId: state.playerId,
            shipCount: state.ships.length, projectileCount: state.projectiles.length, islandCount: state.islands.length,
            ships: state.ships.map((ship) => ({ id: ship.id, kind: ship.kind, position: ship.position, heading: ship.heading, speed: ship.speed, hullDamage: ship.damage.hull, surrendered: ship.surrendered, finish: ship.finish?.state })),
            canvas: canvasState(), renderCounters };
        };
        const intervalsMs = [], canvasChanges = [], visibilityChanges = [];
        let first, previous, before, lastSize = `${canvas.width}:${canvas.height}`;
        const visibility = () => visibilityChanges.push({ atMs: performance.now() - (first ?? performance.now()), state: document.visibilityState });
        document.addEventListener('visibilitychange', visibility);
        const frame = (now) => {
          if (first === undefined) { first = previous = now; before = stateSummary(); }
          else { intervalsMs.push(now - previous); previous = now; }
          const size = `${canvas.width}:${canvas.height}`;
          if (size !== lastSize) { canvasChanges.push({ atMs: now - first, ...canvasState() }); lastSize = size; }
          if (now - first >= duration) {
            document.removeEventListener('visibilitychange', visibility);
            done({ intervalsMs, firstRafMs: first, lastRafMs: now, before, after: stateSummary(), canvasChanges, visibilityChanges });
          } else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }), sampleMs), sampleMs + 20_000, 'Sustained RAF sample');
      record.frameTimes = summarize(record.sample.intervalsMs);
      const before = record.sample.before, after = record.sample.after;
      const simSeconds = after.elapsed - before.elapsed;
      record.activity = {
        simulationSecondsAdvanced: simSeconds, wallSecondsMeasured: record.frameTimes.measuredMs / 1000,
        simulationToWallRatio: simSeconds / (record.frameTimes.measuredMs / 1000),
        shipsWithChangedPosition: after.ships.filter((ship) => {
          const prior = before.ships.find((entry) => entry.id === ship.id);
          return prior && Math.hypot(ship.position.x - prior.position.x, ship.position.y - prior.position.y, ship.position.z - prior.position.z) > .01;
        }).map((ship) => ship.id),
      };
      record.validMeasurement = !before.paused && !after.paused && simSeconds > 0 && before.visibility === 'visible' && after.visibility === 'visible' && !record.sample.visibilityChanges.length;
      record.frameBudget = { averageAtLeast40Fps: record.frameTimes.averageFps >= 40, p95AtMost25Ms: record.frameTimes.p95FrameMs <= 25 };
      record.screenshot = { file: `${name}.png`, before: await page.evaluate(() => ({ elapsed: window.__CRUISE_DEBUG__.getState().elapsed, capturedAt: new Date().toISOString() })) };
      await page.screenshot({ path: resolve(output, record.screenshot.file), type: 'png', timeout: 60_000 });
      record.screenshot.after = await page.evaluate(() => ({ elapsed: window.__CRUISE_DEBUG__.getState().elapsed, capturedAt: new Date().toISOString() }));
      record.loadedScriptElements = await page.evaluate(() => [...document.scripts].map((script) => script.src).filter(Boolean));
      await deadline(Promise.all(scriptReads), 20_000, 'Script digest collection');
    } catch (error) {
      record.errors.push({ source: 'harness', message: error.stack ?? String(error) });
      record.validMeasurement = false;
    } finally {
      // Close the case immediately, including frozen RAF, navigation and screenshot failures.
      await context.close();
    }
    record.scripts.sort((a, b) => a.url.localeCompare(b.url));
    record.buildDigest = createHash('sha256').update(JSON.stringify(record.scripts.map(({ url, sha256 }) => ({ url, sha256 })))).digest('hex');
    record.finishedAt = new Date().toISOString();
    records.push(record);
    await writeFile(resolve(output, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ case: name, valid: record.validMeasurement, ...record.frameTimes, simulationSeconds: record.activity?.simulationSecondsAdvanced, canvas: record.sample?.after.canvas, errors: record.errors.length }));
  }
} finally {
  if (browser) await browser.close();
  // Persist partial evidence even when launching Chromium or a later case fails.
  await writeFile(resolve(output, 'summary.json'), `${JSON.stringify({ configuration, machine, completedAt: new Date().toISOString(), records: records.map(({ sample, ...record }) => ({ ...record, sample: sample && { ...sample, intervalsMs: undefined } })) }, null, 2)}\n`);
}
if (records.some((record) => !record.validMeasurement || record.errors.length || record.failedRequests.length)) process.exitCode = 1;
