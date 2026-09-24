#!/usr/bin/env node
/**
 * Audio lab QA (AUDIO-owned): opens lab/audio.html in Chromium, unlocks with a real click, fires every cue and a
 * battery of SimEvents through the router, walks the music states, runs the 50 cues/s storm and records voice
 * counts, drops, steals and post-limiter levels. Writes output/ovh-audio/lab-report.json + screenshots.
 *
 *   node scripts/audio/qa-lab.mjs [--url http://127.0.0.1:4190] [--headed]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const BASE = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:4190';
const OUT = 'output/ovh-audio';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: !args.includes('--headed'), args: ['--autoplay-policy=document-user-activation-required'] });
const report = { base: BASE, started: new Date().toISOString() };
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') logs.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/lab/audio.html`, { waitUntil: 'networkidle' });
  report.beforeUnlock = await page.evaluate(() => window.__AUDIO_LAB__.engine.stats());
  await page.getByRole('button', { name: 'Click to unlock audio' }).click();
  await page.waitForFunction(() => window.__AUDIO_LAB__.engine.unlocked, null, { timeout: 15000 });
  const t0 = Date.now();
  await page.evaluate(() => window.__AUDIO_LAB__.engine.ready('run'));
  report.decodeMs = Date.now() - t0;
  report.afterUnlock = await page.evaluate(() => window.__AUDIO_LAB__.engine.stats());

  // 1. Every cue, directly, at a spatial position; measure the output meter shortly after.
  report.cues = await page.evaluate(async () => {
    const { engine } = window.__AUDIO_LAB__;
    const m = engine.getManifest();
    const out = {};
    for (const id of Object.keys(m.cues)) {
      if (id.startsWith('amb-')) continue;
      engine.music?.force('silent');
      const ok = engine.playCue(id, { x: 60, z: -40, force: true });
      await new Promise((r) => setTimeout(r, 120));
      let peak = -120;
      for (let i = 0; i < 4; i++) { const v = engine.meter(); if (v && v.peakDb > peak) peak = v.peakDb; await new Promise((r) => setTimeout(r, 40)); }
      out[id] = { started: ok, peakDb: +peak.toFixed(1) };
    }
    return out;
  });
  await page.waitForTimeout(1500);

  // 2. Spatial check: the same cue left vs right vs far (pan + attenuation from the log gains).
  report.spatial = await page.evaluate(async () => {
    const { engine } = window.__AUDIO_LAB__;
    engine.resetStats();
    const pos = { left: { x: -120, z: 0 }, right: { x: 120, z: 0 }, near: { x: 20, z: 0 }, mid: { x: 250, z: 0 }, far: { x: 700, z: 0 } };
    const res = {};
    for (const [k, p] of Object.entries(pos)) { engine.playCue('cannon-near', { ...p, force: true, variant: 0 }); await new Promise((r) => setTimeout(r, 30)); }
    const keys = Object.keys(pos);
    engine.recentLog(10).forEach((e, i) => { res[keys[i] ?? `#${i}`] = { d: e.d, played: e.played, gain: e.gain, pan: e.pan, reason: e.reason }; });
    return res;
  });

  // 3. Every lab SimEvent button → router mapping (requested vs played per cue).
  await page.evaluate(() => window.__AUDIO_LAB__.engine.resetStats());
  const buttons = await page.locator('section:has(h2:text("SimEvents")) button').all();
  for (const b of buttons) { await b.click(); await page.waitForTimeout(60); }
  await page.waitForTimeout(3500);
  report.events = await page.evaluate(() => { const s = window.__AUDIO_LAB__.engine.stats(); return { buttons: document.querySelectorAll('section button').length, bySource: s.bySource, played: s.played, dropped: s.dropped, peakVoices: s.peakVoices }; });

  // 4. Music director: forced states, then automatic intensity flips with hysteresis.
  report.music = await page.evaluate(async () => {
    const { engine } = window.__AUDIO_LAB__;
    const d = engine.music;
    const seq = [];
    for (const st of ['title', 'harbor', 'calm', 'combat', 'horde', 'boss', 'boss-final']) {
      d.force(st);
      await new Promise((r) => setTimeout(r, 2600));
      const info = d.trackInfo();
      seq.push({ state: st, track: info.track, position: info.position, level: info.level, meter: engine.meter() });
    }
    d.force(null);
    d.intensityOverride = 0.05;
    await new Promise((r) => setTimeout(r, 1500));
    const flips = [];
    for (const v of [0.9, 0.1, 0.9, 0.1]) { d.intensityOverride = v; await new Promise((r) => setTimeout(r, 1200)); flips.push({ set: v, runState: d.trackInfo().runState, state: d.state }); }
    d.intensityOverride = null;
    return { seq, flips, transitions: d.transitions.slice(-12) };
  });

  // 5. Storm: 50 cues/s for 10 s; sample voices every 250 ms.
  await page.evaluate(() => window.__AUDIO_LAB__.engine.resetStats());
  await page.evaluate(() => window.__AUDIO_LAB__.storm(50, 10000));
  const samples = [];
  for (let i = 0; i < 40; i++) {
    samples.push(await page.evaluate(() => { const s = window.__AUDIO_LAB__.engine.stats(); const m = window.__AUDIO_LAB__.engine.meter(); return { total: s.totalVoices, voices: s.voices, peakDb: m?.peakDb ?? null, rmsDb: m?.rmsDb ?? null }; }));
    await page.waitForTimeout(250);
  }
  const storm = await page.evaluate(() => window.__AUDIO_LAB__.engine.stats());
  report.storm = {
    maxTotalVoices: Math.max(...samples.map((s) => s.total)),
    meanTotalVoices: +(samples.reduce((a, s) => a + s.total, 0) / samples.length).toFixed(1),
    maxPeakDb: Math.max(...samples.map((s) => s.peakDb ?? -120)),
    meanRmsDb: +(samples.reduce((a, s) => a + (s.rmsDb ?? -120), 0) / samples.length).toFixed(1),
    peakVoices: storm.peakVoices, steals: storm.steals, dropped: storm.dropped,
    requested: Object.values(storm.requested).reduce((a, b) => a + b, 0), played: Object.values(storm.played).reduce((a, b) => a + b, 0),
  };
  await page.screenshot({ path: `${OUT}/lab.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/lab-full.png`, fullPage: true });
  report.consoleWarnings = logs.slice(0, 40);
  report.finished = new Date().toISOString();
} finally {
  await browser.close();
}
writeFileSync(`${OUT}/lab-report.json`, JSON.stringify(report, null, 1));
const silent = Object.entries(report.cues ?? {}).filter(([, v]) => !v.started || v.peakDb < -60).map(([k]) => k);
console.log(JSON.stringify({ decodeMs: report.decodeMs, bank: report.afterUnlock?.bank, silentCues: silent, spatial: report.spatial, music: report.music?.seq, flips: report.music?.flips, storm: report.storm, warnings: report.consoleWarnings }, null, 1));
