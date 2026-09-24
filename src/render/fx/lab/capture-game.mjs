// In-game FX evidence: drives the real app through window.__CRUISE__ (fixed-step `advance`) and writes PNGs to
// output/ovh-fx/game-*.png. Usage: node src/render/fx/lab/capture-game.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4185';
const out = 'output/ovh-fx';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const log = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await page.goto(`${base}/?run=sunlion:sunward-shallows&god=1&seed=fx&hud=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__CRUISE__?.ready === true && window.__CRUISE__.screen() === 'run', null, { timeout: 90000 });
  const step = async (seconds) => page.evaluate((s) => {
    const C = window.__CRUISE__;
    const frames = Math.round(s * 60);
    for (let i = 0; i < frames; i++) {
      const st = C.summary();
      if (st.status === 'levelup' || st.status === 'chest') C.chooseCard(0);
      C.advance(1 / 60);
    }
    return C.summary();
  }, seconds);
  const shot = async (name) => {
    await page.screenshot({ path: `${out}/game-${name}.png` });
    log[name] = await page.evaluate(() => ({ summary: window.__CRUISE__.summary(), metrics: window.__CRUISE__.metrics() }));
    console.log(name, JSON.stringify(log[name].metrics));
  };
  await page.evaluate(() => {
    const C = window.__CRUISE__;
    C.debug.weapon('broadside', 6);
    C.debug.time(420);
    C.debug.spawn('brig', 3); C.debug.spawn('cutter', 3); C.debug.spawn('frigate', 2); C.debug.spawn('skiff', 6); C.debug.spawn('mortar-barge', 2);
    C.steer(0.25);
  });
  await step(6);
  await shot('combat-a');
  await step(1.5);
  await shot('combat-b');
  await page.evaluate(() => { const C = window.__CRUISE__; const s = C.summary(); C.aim(s.player.x + 80, s.player.z); C.press('broadside'); });
  await step(0.12);
  await shot('manual-broadside');
  await step(0.6);
  await shot('manual-broadside-b');
  await page.evaluate(() => window.__CRUISE__.debug.killAll());
  await step(0.25);
  await shot('kill-all-a');
  await step(1.6);
  await shot('kill-all-b');
  await page.evaluate(() => { const C = window.__CRUISE__; C.debug.boss('iron-warden'); });
  await step(4);
  await shot('boss');
  writeFileSync(`${out}/game-log.json`, JSON.stringify(log, null, 2));
} finally {
  await browser.close();
}
