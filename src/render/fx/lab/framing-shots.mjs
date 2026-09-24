#!/usr/bin/env node
/**
 * Framing shots (IMPACT, round 2): the harbor showcase per ship and the cinematic camera option.
 *
 *   node src/render/fx/lab/framing-shots.mjs <baseUrl> <outDir> [--ships a,b] [--headed]
 *
 *  - harbor-<ship>.jpg: the harbor showcase after the orbit settles (framed by the measured mast height and length);
 *  - cinematic-quiet.jpg: settings.cinematicCamera on, an early sea (few ships near) → 33° band, horizon at the top;
 *  - cinematic-melee.jpg: the same run after spawning a crowd → back to the 44° tactical view.
 * The cinematic toggle is flipped on the live settings object (via __SHIPS__.lastContext.settings); nothing is saved.
 * The browser closes in `finally`.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--ships') flags.ships = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}
const BASE = positional[0].replace(/\/$/, '');
const OUT = resolve(positional[1]);
const SHIPS = String(flags.ships ?? 'dawn-ram,sunlion,yellowfin,grand-galley,seawarden,white-leviathan').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: !flags.headed, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const out = {};
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.goto(`${BASE}/?seed=framing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000 });
  await page.mouse.click(800, 450);
  for (const ship of SHIPS) {
    await ev((ship) => { window.__CRUISE__.startRun(ship, 'sunward-shallows'); }, ship);
    await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000 });
    await ev(() => window.__CRUISE__.goHarbor());
    await sleep(600);
    await page.locator(`.cr-shipcard[data-ship="${ship}"]`).first().click({ timeout: 4000 }).catch(() => undefined);
    await sleep(4500);
    await page.screenshot({ path: join(OUT, `harbor-${ship}.jpg`), type: 'jpeg', quality: 82 });
  }
  // Cinematic option.
  await ev(() => { const c = window.__CRUISE__; c.startRun('sunlion', 'sunward-shallows'); c.debug.god(true); });
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000 });
  await ev(() => { const c = window.__CRUISE__; window.__SHIPS__.lastContext.settings.cinematicCamera = true; c.press('gear-up'); c.press('gear-up'); });
  await sleep(6000);
  out.quiet = await ev(() => ({ cam: { ...window.__CRUISE_CAMERA__ }, enemies: window.__CRUISE__.summary().enemies }));
  await page.screenshot({ path: join(OUT, 'cinematic-quiet.jpg'), type: 'jpeg', quality: 82 });
  await ev(() => { const d = window.__CRUISE__.debug; d.time(370); for (const [id, n] of [['brig', 4], ['skiff', 10], ['cutter', 4]]) d.spawn(id, n, false); });
  await sleep(5000);
  out.melee = await ev(() => ({ cam: { ...window.__CRUISE_CAMERA__ }, enemies: window.__CRUISE__.summary().enemies }));
  await page.screenshot({ path: join(OUT, 'cinematic-melee.jpg'), type: 'jpeg', quality: 82 });
} finally {
  await browser.close().catch(() => undefined);
}
await writeFile(join(OUT, 'framing-shots.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
