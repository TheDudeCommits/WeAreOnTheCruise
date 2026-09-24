#!/usr/bin/env node
/**
 * In-game audio QA (AUDIO-owned): starts a god-mode run, unlocks audio with a real click, spawns brigs and other
 * ships, levels up, calls a boss, and logs which SimEvents produced which cues, voice counts, music states and
 * loop levels. Writes output/ovh-audio/game-report.json + game.png.
 *
 *   node scripts/audio/qa-game.mjs [--url http://127.0.0.1:4190] [--headed]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const BASE = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:4190';
const OUT = 'output/ovh-audio';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: !args.includes('--headed'), args: ['--autoplay-policy=document-user-activation-required', '--use-angle=metal', '--enable-gpu'] });
const report = { url: `${BASE}/?run=sunlion:sunward-shallows&god=1&seed=audio`, samples: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready && window.__CRUISE_AUDIO__, null, { timeout: 90000 });
  report.beforeClick = await page.evaluate(() => window.__CRUISE_AUDIO__.stats());
  await page.mouse.click(800, 450);
  await page.waitForFunction(() => window.__CRUISE_AUDIO__.engine.unlocked, null, { timeout: 15000 });
  await page.evaluate(() => window.__CRUISE_AUDIO__.engine.ready('run'));
  await page.evaluate(() => window.__CRUISE_AUDIO__.reset());

  const sample = async (label) => {
    const s = await page.evaluate(() => {
      const a = window.__CRUISE_AUDIO__.stats();
      const g = window.__CRUISE__.summary();
      return { t: g.time, screen: g.screen, status: g.status, enemies: g.enemies, bosses: g.bosses, level: g.player?.level, speed: g.player?.speed, voices: a.totalVoices, byCat: a.voices, music: a.music, loops: a.loops, meter: window.__CRUISE_AUDIO__.meter() };
    });
    s.label = label;
    report.samples.push(s);
    return s;
  };

  // Phase 1: calm sailing (full sail), 6 s.
  await page.evaluate(() => { const c = window.__CRUISE__; c.press('gear-up'); c.steer(0.15); });
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(1000); await sample('calm'); }
  // Phase 2: 20 brigs + a mortar barge + skiffs; fight for 18 s with manual broadsides, brace and boost.
  await page.evaluate(() => { const d = window.__CRUISE__.debug; d.spawn('brig', 20); d.spawn('mortar-barge', 2); d.spawn('skiff', 8); d.spawn('frigate', 1, true); });
  for (let i = 0; i < 18; i++) {
    await page.evaluate((k) => { const c = window.__CRUISE__; if (k % 3 === 0) c.press('broadside'); if (k % 5 === 1) c.press('brace'); if (k % 7 === 2) c.press('boost'); if (k === 9) c.press('special'); c.aim(150 * Math.sin(k), 150 * Math.cos(k)); }, i);
    await page.waitForTimeout(1000);
    await sample('combat');
  }
  // Phase 3: level-ups (cards chosen by the debug helper → card/weapon/passive/tier events).
  await page.evaluate(() => window.__CRUISE__.debug.level(6));
  await page.waitForTimeout(1500);
  await sample('levels');
  // Phase 4: boss.
  await page.evaluate(() => window.__CRUISE__.debug.boss('iron-warden'));
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); await sample('boss'); }
  await page.evaluate(() => window.__CRUISE__.debug.killAll());
  await page.waitForTimeout(2500);
  await sample('killAll');
  await page.screenshot({ path: `${OUT}/game.png` });

  const final = await page.evaluate(() => window.__CRUISE_AUDIO__.stats());
  report.bySource = final.bySource;
  report.requested = final.requested;
  report.played = final.played;
  report.dropped = final.dropped;
  report.peakVoices = final.peakVoices;
  report.steals = final.steals;
  report.musicTransitions = final.musicTransitions;
  report.log = await page.evaluate(() => window.__CRUISE_AUDIO__.log(120));
  report.consoleWarnings = logs.slice(0, 30);
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/game-report.json`, JSON.stringify(report, null, 1));
const cuesBySource = {};
for (const e of report.log ?? []) (cuesBySource[e.src] ??= new Set()).add(e.cue);
console.log(JSON.stringify({
  bySource: report.bySource,
  playedTotal: Object.values(report.played ?? {}).reduce((a, b) => a + b, 0),
  requestedTotal: Object.values(report.requested ?? {}).reduce((a, b) => a + b, 0),
  dropped: report.dropped, peakVoices: report.peakVoices, steals: report.steals,
  music: report.musicTransitions,
  samples: report.samples.map((s) => `${s.label} t=${s.t} enemies=${s.enemies} bosses=${JSON.stringify(s.bosses)} lvl=${s.level} v=${s.voices} music=${s.music?.state}/${s.music?.track} i=${s.music?.intensity} loops=${JSON.stringify(s.loops)} meter=${JSON.stringify(s.meter)}`),
  cuesBySource: Object.fromEntries(Object.entries(cuesBySource).map(([k, v]) => [k, [...v]])),
  warnings: report.consoleWarnings,
}, null, 1));
