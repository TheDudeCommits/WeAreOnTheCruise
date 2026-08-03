import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseURL = process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const output = resolve(process.env.CRUISE_CAPTURE_DIR ?? 'output/ship-gallery');
const ships = [
  ['thousand-sunny', 'THOUSAND SUNNY'],
  ['going-merry', 'GOING MERRY'],
  ['moby-dick', 'MOBY DICK'],
  ['red-force', 'RED FORCE'],
  ['oro-jackson', 'ORO JACKSON'],
  ['polar-tang', 'POLAR TANG'],
  ['queen-mama-chanter', 'QUEEN MAMA CHANTER'],
  ['baratie', 'BARATIE'],
  ['navy-galleon', 'GARP MARINE GALLEON'],
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(60_000);
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`${baseURL}/?capture=1&seed=ship-gallery&scene=crew-closeup`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready === true, null, { timeout: 60_000 });

const cards = [];
for (const [kind, label] of ships) {
  await page.evaluate(async ({ nextKind }) => {
    await window.__CRUISE_DEBUG__?.setScene('crew-closeup');
    window.__CRUISE_DEBUG__?.selectShip(nextKind);
    window.__CRUISE_DEBUG__?.setCamera('cinematic');
    window.__CRUISE_DEBUG__?.step(4);
  }, { nextKind: kind });
  const buffer = await page.screenshot({ path: resolve(output, `${kind}-cinematic.png`), type: 'png', timeout: 60_000 });
  cards.push({ label, data: buffer.toString('base64') });
  await page.evaluate(() => {
    window.__CRUISE_DEBUG__?.setCamera('deck');
    window.__CRUISE_DEBUG__?.step(2);
  });
  await page.screenshot({ path: resolve(output, `${kind}-crew.png`), type: 'png', timeout: 60_000 });
}

const sheet = await context.newPage();
await sheet.setViewportSize({ width: 1800, height: 1200 });
await sheet.setContent(`<!doctype html>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; background: #101522; color: #fff2cf; font: 900 22px/1 system-ui, sans-serif; }
    main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; height: 1164px; }
    figure { position: relative; margin: 0; min-width: 0; overflow: hidden; border: 4px solid #fff2cf; background: #117b95; }
    img { width: 100%; height: 100%; object-fit: cover; display: block; }
    figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 16px; background: rgba(16,21,34,.9); letter-spacing: .08em; }
  </style>
  <main>${cards.map((card) => `<figure><img src="data:image/png;base64,${card.data}"><figcaption>${card.label}</figcaption></figure>`).join('')}</main>`);
await sheet.screenshot({ path: resolve(output, 'all-ships-contact-sheet.png'), type: 'png', timeout: 60_000 });
await writeFile(resolve(output, 'receipt.json'), `${JSON.stringify({ ships: ships.map(([kind]) => kind), warnings: errors }, null, 2)}\n`);

await sheet.close();
await page.close();
await context.close();
await browser.close();
if (errors.length) throw new Error(`Ship gallery emitted browser errors:\n${errors.join('\n')}`);
console.log(`Captured ${ships.length} ship identity and crew pairs to ${output}`);
