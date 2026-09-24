// FOES evidence: close-ups of the round-1 classes in the ships lab lineup (normal + elite rows).
// Usage: node src/render/ships/fleet/lab/capture-foes-lab.mjs [url] [outDir]. The browser always closes in `finally`.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:4192';
const out = process.argv[3] ?? 'output/r1-foes/lab';
const ids = ['signal-cutter', 'ironclad', 'harpooner', 'bomb-ketch', 'smoke-runner', 'lantern-wisp', 'drowned-galleon'];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${url}/lab/ships.html?mode=enemies`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__SHIPS_LAB__?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  const sources = await page.evaluate(() => window.__SHIPS_LAB__.sources());
  const LEN = { 'signal-cutter': 20, ironclad: 30, harpooner: 26, 'bomb-ketch': 24, 'smoke-runner': 14, 'lantern-wisp': 6, 'drowned-galleon': 44 };
  for (const id of ids) {
    const x = await page.evaluate((d) => window.__SHIPS_LAB__.xOf(d), id);
    const L = Math.max(10, LEN[id]);
    // 3/4 view of the normal row (z = 0) with the elite row (z = 90) behind it.
    await page.evaluate(({ x, L }) => window.__SHIPS_LAB__.view(x + L * 1.1, L * 0.95, -L * 1.5, x, L * 0.12, 10), { x, L });
    await page.evaluate(() => window.__SHIPS_LAB__.advance(0.5));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${id}.png` });
  }
  // Whole lineup of the new classes.
  const x0 = await page.evaluate(() => window.__SHIPS_LAB__.xOf('signal-cutter'));
  const x1 = await page.evaluate(() => window.__SHIPS_LAB__.xOf('drowned-galleon'));
  await page.evaluate(({ x0, x1 }) => window.__SHIPS_LAB__.view((x0 + x1) / 2, 150, 230, (x0 + x1) / 2, 0, 40), { x0, x1 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/lineup.png` });
  console.log(JSON.stringify({ errors: errors.slice(0, 5), sources: Object.fromEntries(ids.map((i) => [i, sources[i]])), metrics: await page.evaluate(() => window.__SHIPS_LAB__.metrics()) }));
} finally {
  await browser.close();
}
