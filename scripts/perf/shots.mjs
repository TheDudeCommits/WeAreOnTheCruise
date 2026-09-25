#!/usr/bin/env node
/**
 * PERF visual check: HUD-free plates of the title, the harbor and a run (near an island) for before/after
 * comparisons of LOD and shadow-proxy changes. Browser closed in `finally`.
 *   node scripts/perf/shots.mjs <baseUrl> <outDir> [--ship sunlion] [--sea sunward-shallows]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) flags[a.slice(2)] = argv[++i]; else pos.push(a); }
const BASE = (pos[0] ?? 'http://127.0.0.1:4206').replace(/\/$/, '');
const OUT = resolve(pos[1] ?? 'output/r2-perf/shots');
const SHIP = flags.ship ?? 'sunlion', SEA = flags.sea ?? 'sunward-shallows';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`${BASE}/?seed=gauntlet&hud=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000 });
  await sleep(3000);
  await page.screenshot({ path: join(OUT, 'title.jpg'), type: 'jpeg', quality: 90 });
  await page.evaluate(() => window.__CRUISE__.goHarbor());
  await sleep(14000);
  await page.screenshot({ path: join(OUT, 'harbor.jpg'), type: 'jpeg', quality: 90 });
  await page.evaluate(({ ship, sea }) => { const c = window.__CRUISE__; c.startRun(ship, sea); c.debug.god(true); }, { ship: SHIP, sea: SEA });
  await sleep(1500);
  // Sail toward the nearest island for a while (trees, terrain shadows).
  const island = await page.evaluate(() => {
    const s = window.__CRUISE__.summary();
    return { x: s.player.x, z: s.player.z };
  });
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => { const c = window.__CRUISE__; const st = c.summary(); if (st.status === 'levelup' || st.status === 'chest') c.chooseCard(0); c.steer(0.15); });
    await sleep(250);
  }
  await page.screenshot({ path: join(OUT, 'run.jpg'), type: 'jpeg', quality: 90 });
  void island;
} finally {
  await browser.close();
}
