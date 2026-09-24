// In-game FX evidence: drives the real app through window.__CRUISE__ (fixed-step `advance`) and writes PNGs to
// output/ovh-fx/game-*.png. With CORE merged, every weapon and each ship's special/ultimate fires for real.
// Usage: node src/render/fx/lab/capture-game.mjs [baseUrl] [filter...]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4185';
const only = process.argv.slice(3);
const out = 'output/ovh-fx';
mkdirSync(out, { recursive: true });

const SCENES = [
  // name, ship, weapons [id, level][], spawn [defId, n][], seconds before the shot, action
  ['broadside', 'sunlion', [['broadside', 6]], [['brig', 4], ['frigate', 2], ['skiff', 8]], [6, 1.2], 'manual'],
  ['arsenal', 'sunlion', [['broadside', 4], ['bow-chaser', 5], ['stern-mortar', 5], ['swivel-guns', 5], ['rocket-rack', 5], ['harpoon', 5]],
    [['brig', 5], ['cutter', 5], ['skiff', 12], ['frigate', 2]], [7, 0.8], null],
  ['storm-rod', 'sunlion', [['storm-rod', 6], ['tide-mines', 5], ['fire-barrels', 5], ['maelstrom-charm', 5]], [['skiff', 14], ['cutter', 6]], [7, 0.5], null],
  ['skiffs', 'sunlion', [['escort-skiffs', 6], ['iron-ram', 5]], [['skiff', 10], ['brig', 3]], [7, 0.5], null],
  ['lionburst', 'sunlion', [['broadside', 3]], [['brig', 3], ['skiff', 6]], [4, 0.45], 'special'],
  ['sunfire', 'sunlion', [['broadside', 5]], [['brig', 4], ['skiff', 8]], [4, 1.0], 'ultimate'],
  ['seaquake', 'white-leviathan', [['broadside', 3]], [['skiff', 10], ['cutter', 4]], [4, 0.35], 'special'],
  ['tidal', 'white-leviathan', [['broadside', 3]], [['skiff', 10], ['brig', 4]], [4, 1.0], 'ultimate'],
  ['deep-dive', 'yellowfin', [['broadside', 3]], [['skiff', 8]], [4, 3.3], 'special'],
  ['torpedoes', 'yellowfin', [['broadside', 3]], [['brig', 4], ['frigate', 2]], [4, 1.0], 'ultimate'],
  ['banquet', 'grand-galley', [['broadside', 3]], [['skiff', 6]], [4, 0.5], 'special'],
  ['inferno', 'grand-galley', [['broadside', 3]], [['skiff', 8], ['brig', 3]], [4, 1.2], 'ultimate'],
  ['flare', 'seawarden', [['broadside', 3]], [['brig', 4], ['skiff', 6]], [4, 1.5], 'special'],
  ['judgment', 'seawarden', [['broadside', 3]], [['brig', 4], ['skiff', 6]], [4, 1.6], 'ultimate'],
  ['ramming', 'dawn-ram', [['iron-ram', 5]], [['skiff', 10], ['brig', 3]], [4, 1.0], 'ultimate'],
  ['boss', 'sunlion', [['broadside', 6], ['stern-mortar', 5]], [], [8, 0.1], 'boss'],
];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const log = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  for (const [name, ship, weapons, spawns, [warm, after], action] of SCENES) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    await page.goto(`${base}/?run=${ship}:sunward-shallows&god=1&seed=fx-${name}&hud=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__CRUISE__?.ready === true && window.__CRUISE__.screen() === 'run', null, { timeout: 90000 });
    await page.evaluate(({ weapons, spawns, action }) => {
      const C = window.__CRUISE__;
      for (const [id, lv] of weapons) C.debug.weapon(id, lv);
      C.debug.time(420);
      for (const [id, n] of spawns) C.debug.spawn(id, n);
      if (action === 'boss') C.debug.boss('iron-warden');
    }, { weapons, spawns, action });
    const step = (s) => page.evaluate((s) => {
      const C = window.__CRUISE__;
      const frames = Math.round(s * 60);
      for (let i = 0; i < frames; i++) {
        const st = C.summary();
        if (st.status === 'levelup' || st.status === 'chest') C.chooseCard(0);
        const n = C.nearest(1)[0];
        if (n) C.aim(n.x, n.z);
        C.steer(0.2);
        C.advance(1 / 60);
      }
    }, s);
    if (action === 'ultimate') {
      // the bridge has no charge hook: deal ≥ 2500 damage (sink heavy ships), let that FX clear, repopulate
      await page.evaluate(() => { const C = window.__CRUISE__; C.debug.spawn('man-o-war', 5); C.debug.killAll(); });
      await step(4.5);
      await page.evaluate((spawns) => { const C = window.__CRUISE__; for (const [id, n] of spawns) C.debug.spawn(id, n); }, spawns);
    }
    await step(warm);
    await page.evaluate((action) => {
      const C = window.__CRUISE__;
      if (action === 'manual') C.press('broadside');
      if (action === 'special') C.press('special');
      if (action === 'ultimate') C.press('ultimate');
    }, action);
    await step(after);
    await page.screenshot({ path: `${out}/game-${name}.png` });
    log[name] = await page.evaluate(() => ({ summary: window.__CRUISE__.summary(), fx: window.__CRUISE_FX__ ? { ...window.__CRUISE_FX__.stats } : null }));
    console.log(name, JSON.stringify({ proj: log[name].summary.projectiles, enemies: log[name].summary.enemies, fx: log[name].fx && { upd: +log[name].fx.updateMs.toFixed(2), debris: log[name].fx.debris } }));
  }
  writeFileSync(`${out}/game-log.json`, JSON.stringify(log, null, 2));
} finally {
  await browser.close();
}
