#!/usr/bin/env node
/**
 * Load time and bytes per phase (PERF round 2): counts every network response body (Playwright request sizes, not the
 * 250-entry resource-timing buffer) for a player's path — boot to ready, the title, the harbor (with its warm-up),
 * then 45 s of a run — and reports bytes per file type per phase. Browser closed in `finally`.
 *   node scripts/perf/load-bytes.mjs <baseUrl> <out.json> [--harbor 20] [--run 45] [--ship dawn-ram]
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) flags[a.slice(2)] = argv[++i]; else pos.push(a); }
const BASE = (pos[0] ?? 'http://127.0.0.1:4206').replace(/\/$/, '');
const OUT = pos[1] ?? 'output/r2-perf/load-bytes.json';
const HARBOR = Number(flags.harbor ?? 20), RUN = Number(flags.run ?? 45), SHIP = flags.ship ?? 'dawn-ram';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let phase = 'boot';
const bytes = {};
const add = (type, n) => { const p = (bytes[phase] ??= {}); p[type] = (p[type] ?? 0) + n; };
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const result = { base: BASE, ship: SHIP };
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.on('requestfinished', async (req) => {
    try {
      const sizes = await req.sizes();
      const url = req.url().split('?')[0];
      const type = (url.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'other').toLowerCase();
      add(type, sizes.responseBodySize + sizes.responseHeadersSize);
    } catch { /* ignore */ }
  });
  const t0 = Date.now();
  await page.goto(`${BASE}/?seed=load-bytes`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  result.domContentLoadedMs = Date.now() - t0;
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000, polling: 50 });
  result.readyMs = Date.now() - t0;
  phase = 'title';
  await sleep(3000);
  phase = 'harbor';
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__CRUISE__.goHarbor());
  await sleep(HARBOR * 1000);
  result.warmup = await page.evaluate(() => window.__PERF__?.warmup?.() ?? null);
  phase = 'run';
  await page.evaluate((ship) => { const c = window.__CRUISE__; c.startRun(ship, 'sunward-shallows'); c.debug.god(true); }, SHIP);
  const r0 = Date.now();
  while (Date.now() - r0 < RUN * 1000) { await page.evaluate(() => { const c = window.__CRUISE__; const s = c.summary(); if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0); }); await sleep(500); }
  await sleep(1000);
} finally {
  await browser.close().catch(() => undefined);
}
const mb = (n) => +(n / 1048576).toFixed(2);
result.phases = Object.fromEntries(Object.entries(bytes).map(([p, t]) => [p, { totalMB: mb(Object.values(t).reduce((a, b) => a + b, 0)), ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, mb(v)])) }]));
result.totalMB = mb(Object.values(bytes).flatMap((t) => Object.values(t)).reduce((a, b) => a + b, 0));
await writeFile(OUT, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ readyMs: result.readyMs, dcl: result.domContentLoadedMs, totalMB: result.totalMB, phases: Object.fromEntries(Object.entries(result.phases).map(([p, v]) => [p, `${v.totalMB} MB (glb ${v.glb ?? 0}, ogg ${v.ogg ?? 0})`])) }));
