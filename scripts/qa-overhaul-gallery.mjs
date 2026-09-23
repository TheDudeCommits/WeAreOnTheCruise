import { chromium } from '@playwright/test';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const gallery = resolve(process.env.CRUISE_GALLERY_FILE ?? 'docs/overhaul/gallery/index.html');
const output = resolve(process.env.CRUISE_GALLERY_QA_DIR ?? 'output/overhaul-gauntlet/gallery-qa');
await mkdir(output, { recursive: true });
const receipt = { gallery, runs: [] };
let browser;
try {
  browser = await chromium.launch({ headless: false });
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 1000 }, portrait: { width: 390, height: 844 } })) {
    const page = await browser.newPage({ viewport });
    const run = { name, viewport, checks: [], errors: [] };
    receipt.runs.push(run);
    page.on('pageerror', error => run.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') run.errors.push(message.text()); });
    const check = (label, pass) => { run.checks.push({ label, pass }); if (!pass) throw new Error(`${name}: ${label}`); };
    try {
      await page.goto(pathToFileURL(gallery).href, { waitUntil: 'load' });
      const tabs = page.getByRole('tab');
      check('Nine concept sections', await tabs.count() === 9);
      for (let i = 0; i < 9; i++) {
        await tabs.nth(i).click();
        const panel = page.locator('[role="tabpanel"]:visible');
        check(`Section ${i + 1} selected`, await panel.count() === 1 && await tabs.nth(i).getAttribute('aria-selected') === 'true');
        const images = panel.locator('img');
        for (let j = 0; j < await images.count(); j++) {
          await images.nth(j).scrollIntoViewIfNeeded();
          await images.nth(j).evaluate(image => image.decode());
        }
        check(`Section ${i + 1} has both uncropped images`, await images.count() === 2 && await images.evaluateAll(images => images.every(image => image.naturalWidth > 0 && getComputedStyle(image).objectFit === 'contain')));
      }
      await tabs.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      check('Keyboard changes selected section', await tabs.nth(1).getAttribute('aria-selected') === 'true');
      const opener = page.locator('[role="tabpanel"]:visible [data-image]').last();
      await opener.click();
      check('Full-size viewer opens', await page.getByRole('dialog').isVisible());
      await page.getByRole('button', { name: 'Native size', exact: true }).click();
      check('Native image can be inspected', await page.locator('#zoom-native').getAttribute('aria-pressed') === 'true');
      await page.keyboard.press('Escape');
      check('Viewer closes and restores focus', !await page.getByRole('dialog').isVisible() && await opener.evaluate(element => element === document.activeElement));
      const hrefs = await page.locator('a[href]').evaluateAll(links => links.map(link => link.href));
      for (const href of hrefs) if (href.startsWith('file:')) await access(fileURLToPath(new URL(href)));
      check('Local evidence links resolve', true);
      check('No page-wide overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: resolve(output, `${name}.png`) });
      check('No browser errors', run.errors.length === 0);
    } catch (error) {
      run.errors.push(String(error));
      await page.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => {});
      process.exitCode = 1;
    } finally { await page.close(); }
  }
} finally {
  await browser?.close();
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
