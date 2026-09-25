#!/usr/bin/env node
/**
 * Loudness QA (AUDIO-owned): plays the title, the harbor, calm sailing, a staged fight and a boss at the default
 * volume settings and samples window.__CRUISE_AUDIO__.meter() at 5 Hz: output RMS/peak (dBFS) and short-term
 * K-weighted levels (LUFS-like) of the output, the music bus and the SFX bus. Each phase reports the energy mean of
 * the K levels (a gated integrated-loudness estimate: samples below −70 are ignored), the RMS percentiles and the peaks.
 * Writes output/r2-audio/loudness.json.
 *
 *   node scripts/audio/qa-loudness.mjs [--url http://127.0.0.1:4205] [--headed] [--out loudness-after]
 *
 * Targets (round 2): combat ≈ −18 LUFS (−20…−16), calm sailing and menus ≈ −23…−20, music under the SFX in a fight,
 * peaks ≤ −1 dBFS. The browser always closes in `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const BASE = (args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:4205').replace(/\/$/, '');
const NAME = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'loudness';
const OUT = 'output/r2-audio';
mkdirSync(OUT, { recursive: true });

const energyMean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x) && x > -70);
  if (!v.length) return null;
  return +(10 * Math.log10(v.reduce((a, x) => a + Math.pow(10, x / 10), 0) / v.length)).toFixed(1);
};
const pct = (xs, q) => { const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] : null; };

const browser = await chromium.launch({ headless: !args.includes('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { url: BASE, phases: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/?seed=loudness`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready && window.__CRUISE_AUDIO__, null, { timeout: 120000 });
  await page.mouse.click(640, 360);
  await page.waitForFunction(() => window.__CRUISE_AUDIO__.engine.unlocked, null, { timeout: 15000 });
  await page.evaluate(() => window.__CRUISE_AUDIO__.engine.ready('run'));

  const measure = async (name, seconds, each) => {
    const samples = [];
    for (let i = 0; i < seconds * 5; i++) {
      if (each && i % 5 === 0) await page.evaluate(each);
      await page.waitForTimeout(200);
      const m = await page.evaluate(() => window.__CRUISE_AUDIO__.meter());
      if (m) samples.push(m);
    }
    const music = await page.evaluate(() => window.__CRUISE_AUDIO__.stats().music?.state ?? null);
    const phase = {
      name, seconds, music, samples: samples.length,
      lufs: energyMean(samples.map((s) => s.lufs)), musicLufs: energyMean(samples.map((s) => s.musicLufs)), sfxLufs: energyMean(samples.map((s) => s.sfxLufs)),
      rmsP50: pct(samples.map((s) => s.rmsDb), 0.5), rmsP90: pct(samples.map((s) => s.rmsDb), 0.9),
      peakMax: Math.max(...samples.map((s) => s.peakDb)), peaksOverMinus3: +((samples.filter((s) => s.peakDb > -3).length / Math.max(1, samples.length)) * 100).toFixed(1),
    };
    report.phases.push(phase);
    console.log(`${name.padEnd(8)} ${String(music).padEnd(8)} LUFS ${phase.lufs} (music ${phase.musicLufs}, sfx ${phase.sfxLufs})  RMS p50 ${phase.rmsP50} p90 ${phase.rmsP90}  peak ${phase.peakMax} dBFS, >−3 dBFS ${phase.peaksOverMinus3}%`);
  };

  await measure('title', 6);
  await page.evaluate(() => window.__CRUISE__.goHarbor());
  await page.waitForTimeout(1500);
  await measure('harbor', 8);
  await page.evaluate(() => { const c = window.__CRUISE__; c.startRun('sunlion', 'sunward-shallows'); });
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000 });
  await page.evaluate(() => {
    const c = window.__CRUISE__;
    c.debug.god(true); c.press('gear-up'); c.press('gear-up');
    window.__QA_CARDS__ = setInterval(() => { const s = c.summary(); if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0); }, 150);
  });
  await page.evaluate(() => window.__CRUISE__.debug.killAll());
  await measure('sailing', 10);
  await page.evaluate(() => { const d = window.__CRUISE__.debug; d.level(8); d.spawn('brig', 10); d.spawn('skiff', 14); d.spawn('frigate', 3); d.spawn('bomb-ketch', 2); });
  await measure('combat', 30, () => {
    const c = window.__CRUISE__, n = c.nearest(1)[0];
    if (n) c.aim(n.x, n.z);
    c.press('broadside');
    if (c.summary().enemies < 14) { c.debug.spawn('brig', 6); c.debug.spawn('skiff', 6); }
  });
  await page.evaluate(() => { window.__CRUISE__.debug.killAll(); window.__CRUISE__.debug.boss('iron-warden'); });
  await measure('boss', 20, () => { const c = window.__CRUISE__, n = c.nearest(1)[0]; if (n) c.aim(n.x, n.z); c.press('broadside'); });
} finally {
  await browser.close().catch(() => undefined);
  writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify(report, null, 1));
}
console.log(`errors: ${report.errors.length}`);
