#!/usr/bin/env node
/**
 * Round-2 audio QA (AUDIO-owned): stages every round-1 feature that got a new cue in a god-mode run and checks that
 * the cue fired (the engine's cue log and per-cue counters), that the new loops came up, and that no page errors
 * happened. Writes output/r2-audio/qa-round2.json.
 *
 *   node scripts/audio/qa-round2.mjs [--url http://127.0.0.1:4205] [--headed] [--only kraken,wisp]
 *
 * Staging goes through window.__CRUISE__.debug (spawn, event, teleport) and window.__FOES_QA__ (forced elite affixes;
 * its `sim` handle finds hazards and applies statuses). The browser always closes in `finally`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const BASE = (args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:4205').replace(/\/$/, '');
const ONLY = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const OUT = 'output/r2-audio';
mkdirSync(OUT, { recursive: true });

/** Each scene: stage it, wait, then expect cues (played at least once) and loops (level > 0 at some sample). */
const SCENES = [
  { id: 'signal-cutter', expect: ['flare', 'flare-pop', 'flare-hang', 'marked'], wait: 14, stage: `d.spawn('signal-cutter', 3)` },
  { id: 'ironclad', expect: ['steam-whistle'], wait: 12, stage: `d.spawn('ironclad', 3)` },
  { id: 'harpooner', expect: ['harpoon-throw', 'harpoon-hit'], loops: ['amb-rope'], wait: 14, stage: `d.spawn('harpooner', 4)`, after: `c.press('boost')`, expectAfter: ['rope-snap'] },
  { id: 'wisp', expect: ['wisp-latch'], loops: ['amb-wisp'], wait: 12, holdFire: true, stage: `d.spawn('lantern-wisp', 8)`, after: `d.killAll()`, expectAfter: ['wisp-burst'] },
  { id: 'drowned-galleon', expect: ['galleon-rise', 'galleon-breach'], wait: 16, stage: `d.spawn('drowned-galleon', 2)` },
  { id: 'shielded', expect: ['shield-shatter'], wait: 10, stage: `window.__FOES_QA__.affixes = ['shielded']; d.spawn('brig', 3, true)` },
  { id: 'vampiric', expect: ['vamp-siphon'], wait: 14, stage: `window.__FOES_QA__.affixes = ['vampiric']; d.spawn('brig', 4, true)` },
  { id: 'smoke-runner', expect: ['smoke-pot'], wait: 14, holdFire: true, stage: `d.spawn('smoke-runner', 4)` },
  { id: 'kraken', expect: ['serpent-roar'], wait: 16, holdFire: true, stage: `d.event('kraken-rising')`, after: `d.killAll()`, expectAfter: ['ink-splash'], optional: ['kraken-squeeze'] },
  { id: 'rogue-wave', expect: ['wave-roar'], loops: ['amb-surf'], wait: 18, stage: `d.event('rogue-wave')` },
  { id: 'maelstrom', expect: ['whirlpool-cast'], loops: ['amb-maelstrom'], wait: 8, stage: `d.event('maelstrom')` },
  { id: 'eruption', expect: ['lava-launch'], wait: 16, stage: `d.event('volcanic-eruption')`, optional: ['coin-shower'] },
  { id: 'salvage', expect: ['salvage-haul'], wait: 4, stage: `d.event('poi:salvage')`, teleportTo: 'salvage' },
  { id: 'beacon', expect: ['beacon-bell'], wait: 4, stage: `d.event('poi:beacon')`, teleportTo: 'beacon' },
  { id: 'trade-wind', expect: ['wind-gust'], wait: 4, stage: `d.event('poi:trade-wind')`, teleportTo: 'trade-wind' },
  { id: 'momentum', expect: ['momentum-swell', 'momentum-luff'], wait: 5, stage: `const q = window.__FOES_QA__.sim; q.applyStatus(q.state.player, 'momentum', 2.5, 0.12)` },
  { id: 'boost-charges', expect: ['boost-light'], wait: 3, stage: `const q = window.__FOES_QA__.sim; q.state.player.stats.boostCharges = 2; q.state.director.scratch['pace:boostCharges'] = 3; c.press('boost')` },
];

const browser = await chromium.launch({ headless: !args.includes('--headed'), args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { url: `${BASE}/?run=sunlion:sunward-shallows&god=1&seed=audio-r2`, scenes: [], errors: [], summary: null };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.addInitScript(() => { window.__FOES_QA__ = {}; });
  await page.goto(report.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready && window.__CRUISE_AUDIO__, null, { timeout: 120000 });
  await page.mouse.click(640, 360);
  await page.waitForFunction(() => window.__CRUISE_AUDIO__.engine.unlocked, null, { timeout: 15000 });
  await page.evaluate(() => window.__CRUISE_AUDIO__.engine.ready('run'));
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 20000 });
  await page.evaluate(() => {
    const c = window.__CRUISE__;
    c.press('gear-up'); c.press('gear-up');
    // Kills level the ship up: take the first card so the sea keeps moving (the sim waits on the card screen).
    window.__QA_CARDS__ = setInterval(() => { const s = c.summary(); if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0); }, 150);
  });

  for (const scene of SCENES) {
    if (ONLY && !ONLY.has(scene.id)) continue;
    const t0 = Date.now();
    await page.evaluate(() => { const d = window.__CRUISE__.debug; d.killAll(); window.__FOES_QA__.affixes = undefined; window.__CRUISE_AUDIO__.reset(); });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__CRUISE_AUDIO__.reset());
    // Hold fire: keep the player's guns on cooldown so fragile foes live long enough to act (wisps, smoke runners, arms).
    if (scene.holdFire) await page.evaluate(() => { window.__QA_HOLD__ = setInterval(() => { const q = window.__FOES_QA__.sim; if (q) for (const w of q.state.player.weapons) w.cooldown = Math.max(w.cooldown, 0.5); }, 50); });
    await page.evaluate(`(() => { const c = window.__CRUISE__, d = c.debug; ${scene.stage}; })()`);
    if (scene.teleportTo) {
      await page.waitForTimeout(300);
      await page.evaluate((kind) => {
        const q = window.__FOES_QA__.sim;
        const h = q?.state.hazards.find((x) => x.alive && x.kind === kind);
        if (h) window.__CRUISE__.debug.teleport(h.x, h.z);
      }, scene.teleportTo);
    }
    const loopMax = {};
    const sample = async () => {
      const loops = await page.evaluate(() => window.__CRUISE_AUDIO__.stats().loops);
      for (const [k, v] of Object.entries(loops)) loopMax[k] = Math.max(loopMax[k] ?? 0, v);
    };
    for (let i = 0; i < scene.wait * 2; i++) { await page.waitForTimeout(500); await sample(); }
    if (scene.holdFire) await page.evaluate(() => clearInterval(window.__QA_HOLD__));
    let played = await page.evaluate(() => window.__CRUISE_AUDIO__.stats().played);
    let afterPlayed = null;
    if (scene.after) {
      await page.evaluate(`(() => { const c = window.__CRUISE__, d = c.debug; ${scene.after}; })()`);
      for (let i = 0; i < 6; i++) { await page.waitForTimeout(500); await sample(); }
      afterPlayed = await page.evaluate(() => window.__CRUISE_AUDIO__.stats().played);
      played = afterPlayed;
    }
    const missing = [...scene.expect, ...(scene.expectAfter ?? [])].filter((c) => !(played[c] > 0));
    const missingLoops = (scene.loops ?? []).filter((k) => !(loopMax[k] > 0));
    const optionalMissing = (scene.optional ?? []).filter((c) => !(played[c] > 0));
    const barks = await page.evaluate(() => window.__CRUISE_AUDIO__.stats().barks);
    const log = await page.evaluate(() => window.__CRUISE_AUDIO__.log(400).filter((e) => e.src === 'watch' || e.src === 'hazard-spawned' || e.src === 'hazard-triggered' || e.src === 'status-changed').slice(-12));
    const entry = {
      id: scene.id, ok: missing.length === 0 && missingLoops.length === 0, missing, missingLoops, optionalMissing,
      played: Object.fromEntries([...scene.expect, ...(scene.expectAfter ?? []), ...(scene.optional ?? [])].map((c) => [c, played[c] ?? 0])),
      loops: Object.fromEntries((scene.loops ?? []).map((k) => [k, +(loopMax[k] ?? 0).toFixed(3)])),
      seconds: +((Date.now() - t0) / 1000).toFixed(1), barks, log,
    };
    report.scenes.push(entry);
    console.log(`${entry.ok ? 'OK  ' : 'FAIL'} ${scene.id.padEnd(16)} ${JSON.stringify(entry.played)} ${JSON.stringify(entry.loops)}${missing.length ? ` missing ${missing.join(',')}` : ''}${missingLoops.length ? ` loops ${missingLoops.join(',')}` : ''}${optionalMissing.length ? ` (optional not heard: ${optionalMissing.join(',')})` : ''}${Object.keys(barks ?? {}).length ? ` barks ${JSON.stringify(barks)}` : ''}`);
  }
  report.summary = { passed: report.scenes.filter((s) => s.ok).length, total: report.scenes.length, errors: report.errors.length };
} finally {
  await browser.close().catch(() => undefined);
  writeFileSync(`${OUT}/qa-round2.json`, JSON.stringify(report, null, 1));
}
console.log(JSON.stringify(report.summary), report.errors.slice(0, 5));
