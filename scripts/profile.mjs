import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const output = resolve(process.env.CRUISE_PROFILE_DIR ?? 'output/perf');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist']
    : ['--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`${baseURL}/?quality=performance&seed=perf-001&scene=perf-fleet`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready === true);
await page.evaluate(() => window.__CRUISE_DEBUG__?.setPaused(false));
const frameSample = await page.evaluate(async () => {
  const frameTimes = [];
  const durationMs = 8_000;
  const startedAt = performance.now();
  let previous = startedAt;
  await new Promise((resolveSample) => {
    const sample = (now) => {
      if (now > previous) frameTimes.push(now - previous);
      previous = now;
      if (now - startedAt >= durationMs) resolveSample();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  frameTimes.sort((a, b) => a - b);
  const percentile = (p) => frameTimes[Math.min(frameTimes.length - 1, Math.floor(frameTimes.length * p))] ?? 0;
  return {
    samples: frameTimes.length,
    p50FrameMs: percentile(0.5),
    p95FrameMs: percentile(0.95),
    p99FrameMs: percentile(0.99),
    longFrames: frameTimes.filter((time) => time > 33.4).length,
  };
});
const metrics = await page.evaluate(() => window.__CRUISE_DEBUG__?.getMetrics());
const report = { scene: 'perf-fleet', seed: 'perf-001', frameSample, renderer: metrics, warnings: errors };
await writeFile(resolve(output, 'perf-fleet.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
