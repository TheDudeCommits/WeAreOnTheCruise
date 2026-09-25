#!/usr/bin/env node
/**
 * Telegraph shots (IMPACT, round 2): enemy mortar circles on rough water, per colour-vision setting.
 *
 *   node src/render/fx/lab/telegraph-shots.mjs <baseUrl> <outDir> [--modes off,deutan,protan,tritan] [--headed]
 *
 * Stormwrack at 6:10 (rough sea), god mode, mortar barges and bomb ketches spawned around a slow ship; for each mode
 * the live settings object gets `colorBlind` (nothing is saved) and a shot is taken while at least two circle
 * telegraphs are alive (plus a HUD-free plate). Works on older builds too (the mode is then ignored).
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
  if (a === '--modes') flags.modes = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}
const BASE = positional[0].replace(/\/$/, '');
const OUT = resolve(positional[1]);
const MODES = String(flags.modes ?? 'off,deutan,protan,tritan').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: !flags.headed, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const out = {};
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.goto(`${BASE}/?seed=telegraphs`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000 });
  // no AI captains: the barges then lob at the player, so the circles land in frame
  await ev(() => { window.__SHIPS__.lastContext.settings.captains = 0; const c = window.__CRUISE__; c.startRun('dawn-ram', 'stormwrack-reach'); c.debug.god(true); });
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000 });
  await ev(() => { const d = window.__CRUISE__.debug; d.time(370); d.level(8); });
  for (const mode of MODES) {
    await ev((mode) => {
      const c = window.__CRUISE__, d = c.debug;
      window.__SHIPS__.lastContext.settings.colorBlind = mode;
      d.killAll();
    }, mode);
    await sleep(2500); // let the kill FX clear
    await ev(() => { const d = window.__CRUISE__.debug; d.spawn('mortar-barge', 5, false); d.spawn('bomb-ketch', 2, false); });
    // wait for a circle telegraph near the ship (on screen), past a third of its timer
    let got = false;
    for (let i = 0; i < 100 && !got; i++) {
      await sleep(150);
      got = await ev(() => {
        const run = window.__SHIPS__.lastContext?.run;
        if (!run) return false;
        const p = run.player;
        return run.telegraphs.some((t) => t.alive && t.shape === 'circle' && t.time / t.duration > 0.3 && Math.hypot(t.x - p.x, t.z - p.z) < 70);
      });
    }
    const info = await ev(() => {
      const s = window.__CRUISE__.summary();
      const run = window.__SHIPS__.lastContext.run;
      return { weather: s.weather, waveScale: +run.sea.waveScale.toFixed(2), circles: run.telegraphs.filter((t) => t.alive && t.shape === 'circle').length };
    });
    out[mode] = { ...info, got };
    await page.screenshot({ path: join(OUT, `telegraph-${mode}.jpg`), type: 'jpeg', quality: 85 });
    await ev(() => document.querySelector('#game-root')?.classList.add('hide-ui'));
    await sleep(80);
    await page.screenshot({ path: join(OUT, `telegraph-${mode}-plate.jpg`), type: 'jpeg', quality: 85 });
    await ev(() => document.querySelector('#game-root')?.classList.remove('hide-ui'));
  }
} finally {
  await browser.close().catch(() => undefined);
}
await writeFile(join(OUT, 'telegraph-shots.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
