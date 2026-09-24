// FX performance probe: headed Chromium (real GPU + vsync), lab/fx.html barrage (650 projectiles + 30
// explosions/s), 1600×900. Prints FPS, p95/worst frame, FX update CPU time and draw calls.
// Usage: node src/render/fx/lab/perf-fx.mjs [baseUrl] [seconds]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4185';
const seconds = Number(process.argv[3] ?? 10);
mkdirSync('output/ovh-fx', { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,980', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const results = {};
  for (const [label, scene, cam] of [['idle', 'broadside', 'director'], ['barrage', 'barrage', 'director']]) {
    await page.goto(`${base}/lab/fx.html?scene=${scene}&cam=${cam}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__FXLAB__?.ready === true, null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__FXLAB__.perf(true));
    await page.waitForTimeout(seconds * 1000);
    results[label] = await page.evaluate(() => window.__FXLAB__.perf(false));
    console.log(label, JSON.stringify(results[label]));
    await page.screenshot({ path: `output/ovh-fx/perf-${label}.png` });
  }
  writeFileSync('output/ovh-fx/perf.json', JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
