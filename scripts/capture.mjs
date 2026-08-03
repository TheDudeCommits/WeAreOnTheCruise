import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const baseURL = process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const output = resolve(process.env.CRUISE_CAPTURE_DIR ?? 'output/captures');
const args = process.argv.slice(2);
const requested = args.filter((arg) => !arg.startsWith('--'));
const allAngles = args.includes('--all-angles');
const scenes = requested.length ? requested : [
  'calm-sailing', 'storm-sailing', 'sunny-broadside', 'moby-scale',
  'fleet-battle', 'damaged-ship', 'island-discovery', 'race-start',
  'race-rough', 'crew-closeup', 'night-encounter', 'perf-fleet',
];
const cameraByScene = {
  'calm-sailing': 'chase', 'storm-sailing': 'chase', 'sunny-broadside': 'broadside',
  'moby-scale': 'cinematic', 'fleet-battle': 'overhead', 'damaged-ship': 'cinematic',
  'island-discovery': 'chase', 'race-start': 'cinematic', 'race-rough': 'cinematic',
  'crew-closeup': 'deck', 'night-encounter': 'broadside', 'perf-fleet': 'overhead',
};
const angles = ['chase', 'broadside', 'bow', 'deck', 'cinematic', 'overhead'];
const jobs = scenes.flatMap((scene) => (allAngles ? angles : [cameraByScene[scene] ?? 'chase']).map((camera) => ({ scene, camera })));

await mkdir(output, { recursive: true });

for (const { scene, camera } of jobs) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(`${baseURL}/?capture=1&seed=capture-001&scene=${scene}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready === true, null, { timeout: 30_000 });
  await page.evaluate(async ({ nextScene, cameraPreset }) => {
    await window.__CRUISE_DEBUG__?.setScene(nextScene);
    window.__CRUISE_DEBUG__?.setCamera(cameraPreset);
    window.__CRUISE_DEBUG__?.setPaused(true);
    window.__CRUISE_DEBUG__?.step(3);
  }, { nextScene: scene, cameraPreset: camera });
  const basename = allAngles ? `${scene}-${camera}` : scene;
  await page.screenshot({ path: resolve(output, `${basename}.png`), type: 'png' });
  const evidence = await page.evaluate(() => ({
    version: window.__CRUISE_DEBUG__?.version,
    scene: window.__CRUISE_DEBUG__?.getScene(),
    state: window.__CRUISE_DEBUG__?.getState(),
    metrics: window.__CRUISE_DEBUG__?.getMetrics(),
  }));
  const canonicalState = JSON.stringify(evidence.state);
  const receipt = {
    apiVersion: evidence.version,
    scene: evidence.scene,
    camera,
    seed: evidence.state?.seed,
    elapsed: evidence.state?.elapsed,
    viewport: { width: 1728, height: 1117, dpr: 2 },
    simHash: createHash('sha256').update(canonicalState).digest('hex').slice(0, 16),
    entityCounts: {
      ships: evidence.state?.ships.length ?? 0,
      projectiles: evidence.state?.projectiles.length ?? 0,
      islands: evidence.state?.islands.length ?? 0,
    },
    metrics: evidence.metrics,
    warnings: browserErrors,
  };
  await writeFile(resolve(output, `${basename}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  await page.close();
  await context.close();
  await browser.close();
  if (browserErrors.length) throw new Error(`${scene} emitted browser errors:\n${browserErrors.join('\n')}`);
}

console.log(`Captured ${jobs.length} deterministic frame(s) to ${output}`);
