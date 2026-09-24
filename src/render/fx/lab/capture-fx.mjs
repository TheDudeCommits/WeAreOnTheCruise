// FX evidence capture: drives lab/fx.html (deterministic fixed-step frames) and the game, writing PNGs to
// output/ovh-fx/. Usage: node src/render/fx/lab/capture-fx.mjs [baseUrl] [shots...]
// Browsers are always closed in `finally`.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4185';
const only = process.argv.slice(3);
const out = 'output/ovh-fx';
mkdirSync(out, { recursive: true });

const SHOTS = [
  // name, scene, advance seconds before the shot, options
  ['broadside-f', 'broadside', 0.05, {}],
  ['broadside-g', 'broadside', 0.1, {}],
  ['broadside-a', 'broadside', 0.18, {}],
  ['broadside-b', 'broadside', 0.55, {}],
  ['broadside-c', 'broadside', 1.3, {}],
  ['sinking-a', 'sinking', 0.12, {}],
  ['sinking-b', 'sinking', 0.9, {}],
  ['sinking-c', 'sinking', 2.2, {}],
  ['lionburst-a', 'lionburst', 0.15, {}],
  ['lionburst-b', 'lionburst', 0.6, {}],
  ['lionburst-c', 'lionburst', 1.2, {}],
  ['explosions-a', 'explosions', 0.1, {}],
  ['explosions-b', 'explosions', 0.45, {}],
  ['explosions-c', 'explosions', 1.4, {}],
  ['projectiles', 'projectiles', 0.9, {}],
  ['hazards', 'hazards', 1.2, {}],
  ['pickups', 'pickups', 0.8, {}],
  ['telegraphs', 'telegraphs', 1.6, {}],
  ['storm', 'storm', 0.1, {}],
  ['numbers', 'numbers', 0.35, {}],
  ['night-broadside', 'broadside', 0.3, { hour: 22.5 }],
  ['barrage', 'barrage', 3, {}],
  ['seaquake-a', 'seaquake', 0.15, {}],
  ['seaquake-b', 'seaquake', 0.6, {}],
  ['inferno', 'inferno', 0.5, {}],
  ['flare', 'flare', 1.4, {}],
  ['sunfire', 'sunfire', 0.12, {}],
  ['tidal', 'tidal', 1.0, {}],
  ['deepdive-a', 'deepdive', 0.2, {}],
  ['deepdive-b', 'deepdive', 1.6, {}],
  ['deepdive-c', 'deepdive', 3.25, {}],
  ['levelup', 'levelup', 0.35, {}],
  ['parry', 'parry', 0.08, {}],
  ['boost', 'boost', 0.5, {}],
  ['finale-a', 'finale', 0.2, {}],
  ['finale-b', 'finale', 1.2, {}],
  ['finale-c', 'finale', 2.6, {}],
  ['wavewall', 'wavewall', 1.5, {}],
  ['enemyfire', 'enemyfire', 0.35, {}],
];

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/lab/fx.html?manual=1&clean=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__FXLAB__?.ready === true, null, { timeout: 60000 });
  await page.evaluate(() => window.__FXLAB__.advance(1.5));
  for (const [name, scene, secs, opts] of SHOTS) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    await page.evaluate(({ scene, opts }) => { window.__FXLAB__.set({ hour: 14, weather: 'clear', ...opts }); window.__FXLAB__.scene(scene); }, { scene, opts });
    await page.evaluate((s) => window.__FXLAB__.advance(s), secs);
    await page.screenshot({ path: `${out}/lab-${name}.png` });
    report[name] = await page.evaluate(() => window.__FXLAB__.stats());
    console.log(name, JSON.stringify(report[name].metrics), 'fxDraws', report[name].fxDraws);
  }
  writeFileSync(`${out}/lab-stats.json`, JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
