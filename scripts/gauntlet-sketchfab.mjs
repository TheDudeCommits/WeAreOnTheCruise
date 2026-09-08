import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.CRUISE_CAPTURE_DIR ?? 'output/asset-gauntlet/in-world-current';
await mkdir(out, { recursive: true });
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['thousand-sunny', 'going-merry', 'navy-galleon', 'moby-dick', 'polar-tang', 'baratie'];
const browser = await chromium.launch({ headless: false });
const receipts = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${process.env.CRUISE_URL ?? 'http://127.0.0.1:4197'}/?capture=1&seed=assets-17&scene=crew-closeup`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready, { timeout: 90000 });
  for (const kind of kinds) {
    await page.evaluate(async kind => {
      const d = window.__CRUISE_DEBUG__;
      await d.selectShip(kind);
      await d.readyAssets();
      d.setCamera('cinematic');
      for (let i = 0; i < 15; i++) { d.step(8); await new Promise(requestAnimationFrame); }
      d.setPaused(true);
    }, kind);
    const receipt = await page.evaluate(() => ({ assets: window.__CRUISE_DEBUG__.getAssets(), state: window.__CRUISE_DEBUG__.getState(), metrics: window.__CRUISE_DEBUG__.getMetrics() }));
    if (!receipt.assets.some(asset => asset.kind === kind && asset.source === 'sketchfab' && asset.status === 'ready' && asset.meshes > 0 && asset.bounds)) throw new Error(`Missing actual source model: ${kind}`);
    const player=receipt.assets.find(asset=>asset.id===receipt.state.playerId);
    const expectedCrew={'thousand-sunny':3,'going-merry':3,'moby-dick':1,'baratie':1}[kind]??0;
    if(player.crew.length!==expectedCrew||player.crew.some(member=>!member.sourceUid||!member.contact?.every(Number.isFinite)))throw new Error(`Missing downloaded crew/deck contact: ${kind}`);
    await page.screenshot({ path: `${out}/${kind}.png` });
    receipts.push({ kind, ...receipt, errors: [...errors] });
    console.log(JSON.stringify({ kind, assets: receipt.assets, errors }));
  }
  await writeFile(`${out}/receipt.json`, JSON.stringify(receipts, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
