/** Short real-time profiles of the complete reference-special sequences. No stepping or injected charge. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import os from 'node:os';

const base = process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const output = resolve(process.env.CRUISE_SPECIAL_PROFILE_DIR ?? 'output/overhaul-gauntlet/special-performance');
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const duration = values.reduce((sum, value) => sum + value, 0);
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { samples: values.length, measuredMs: duration, averageFps: values.length * 1000 / duration,
    p95FrameMs: percentile(.95), p99FrameMs: percentile(.99), maxFrameMs: sorted.at(-1),
    over25ms: values.filter(value => value > 25).length, over50ms: values.filter(value => value > 50).length };
};
const result = { method: 'Headed Chromium, normal auto quality, three-second warmup, trusted C key, 6.5 seconds of raw real RAF. Phase labels read from rendered HUD; no snapshot cloning within sampled frames, no capture mode, no stepping or charge injection. Short phase measurements supplement the sustained ordinary-scene benchmark.',
  machine: { cpu: [...new Set(os.cpus().map(cpu => cpu.model))], platform: os.platform(), arch: os.arch(), logicalCpus: os.cpus().length, memoryBytes: os.totalmem() }, records: [] };
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: false });
  result.browserVersion = browser.version();
  for (const [viewportName, viewport] of Object.entries({ desktop: { width: 1920, height: 1080 }, landscape: { width: 844, height: 390 } })) {
    for (const [kind, scene, camera] of [['thousand-sunny', 'calm-sailing', 'cinematic'], ['polar-tang', 'calm-sailing', 'cinematic'], ['moby-dick', 'sunny-broadside', 'overhead']]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: viewportName === 'landscape' });
      const page = await context.newPage();
      const record = { name: `${viewportName}-${kind}`, viewport, kind, scene, camera, errors: [], scripts: [] };
      result.records.push(record);
      const scripts = [];
      page.on('pageerror', error => record.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') record.errors.push(message.text()); });
      page.on('response', response => {
        if (response.request().resourceType() === 'script') scripts.push((async () => {
          const bytes = await response.body(); record.scripts.push({ url: response.url(), sha256: createHash('sha256').update(bytes).digest('hex') });
        })());
      });
      try {
        await page.goto(`${base}/?scene=${scene}&seed=profile-specials-A&quality=auto`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready);
        await page.locator(`[data-ship="${kind}"]`).click();
        await page.locator('[data-action="launch"]').click();
        await page.waitForFunction(() => !window.__CRUISE_DEBUG__.getState().paused);
        await page.evaluate(camera => window.__CRUISE_DEBUG__.setCamera(camera), camera);
        await page.waitForTimeout(3000);
        record.before = await page.evaluate(() => {
          const state = window.__CRUISE_DEBUG__.getState(), canvas = document.querySelector('canvas');
          const gl = canvas.getContext('webgl2'), info = gl?.getExtension('WEBGL_debug_renderer_info');
          return { elapsed: state.elapsed, player: state.ships.find(ship => ship.id === state.playerId), paused: state.paused,
            canvas: { width: canvas.width, height: canvas.height }, visible: document.visibilityState,
            renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null, capture: document.documentElement.dataset.capture };
        });
        if (record.before.player.kind !== kind || record.before.player.special < .999 || record.before.paused || record.before.capture === 'true') throw Error('Invalid normal-play starting state');
        await page.evaluate(() => {
          const label = document.querySelector('[data-touch="special"]');
          const canvas = document.querySelector('canvas');
          window.__SPECIAL_PROFILE__ = new Promise(resolve => {
            const frames = []; let start, previous;
            const frame = timestamp => {
              if (start === undefined) start = timestamp;
              if (previous !== undefined) frames.push({ dt: timestamp - previous, phase: label.dataset.phase || 'ready', at: timestamp - start, canvasWidth: canvas.width, canvasHeight: canvas.height });
              previous = timestamp;
              if (timestamp - start >= 6500) resolve(frames); else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        });
        await page.keyboard.press('c');
        record.frames = await page.evaluate(() => Promise.race([window.__SPECIAL_PROFILE__, new Promise((_, reject) => setTimeout(() => reject(Error('RAF profile timed out')), 15000))]));
        record.after = await page.evaluate(() => {
          const state = window.__CRUISE_DEBUG__.getState(), canvas = document.querySelector('canvas');
          return { elapsed: state.elapsed, player: state.ships.find(ship => ship.id === state.playerId), canvas: { width: canvas.width, height: canvas.height }, visible: document.visibilityState };
        });
        record.frameTimes = summarize(record.frames.map(frame => frame.dt));
        record.resizeEvents = record.frames.filter((frame, index, frames) => index > 0 && (frame.canvasWidth !== frames[index - 1].canvasWidth || frame.canvasHeight !== frames[index - 1].canvasHeight));
        record.phases = Object.fromEntries(['windup', 'active', 'recovery'].map(phase => [phase, summarize(record.frames.filter(frame => frame.phase === phase).map(frame => frame.dt))]));
        record.valid = record.errors.length === 0 && record.before.visible === 'visible' && record.after.visible === 'visible'
          && record.after.elapsed - record.before.elapsed > 5.2 && Object.values(record.phases).every(phase => phase.samples >= 10);
        if (!record.valid) throw Error('Incomplete or invalid real-time special profile');
      } catch (error) { record.valid = false; record.failure = String(error); process.exitCode = 1; }
      finally { await Promise.allSettled(scripts); await context.close(); }
      await writeFile(resolve(output, `${record.name}.json`), JSON.stringify(record, null, 2) + '\n');
      console.log(JSON.stringify({ name: record.name, valid: record.valid, frameTimes: record.frameTimes, active: record.phases?.active, failure: record.failure }));
    }
  }
} finally {
  await browser?.close(); result.completedAt = new Date().toISOString();
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
}
