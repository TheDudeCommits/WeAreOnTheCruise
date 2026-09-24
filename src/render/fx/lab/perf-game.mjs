// In-game FX performance probe (headed Chromium, real RAF): Sunlion run, broadside level 6, ~60 enemies, god mode.
// Samples window.__CRUISE_FX__.stats (FX self-timing, dev builds) and the app metrics.
// Usage: node src/render/fx/lab/perf-game.mjs [baseUrl] [seconds]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4185';
const seconds = Number(process.argv[3] ?? 12);
mkdirSync('output/ovh-fx', { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--window-size=1600,980', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/?run=sunlion:sunward-shallows&god=1&seed=fx`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__CRUISE__?.ready === true && window.__CRUISE__.screen() === 'run', null, { timeout: 90000 });
  await page.evaluate(() => {
    const C = window.__CRUISE__;
    C.debug.weapon('broadside', 6);
    C.debug.time(480);
    for (const [id, n] of [['skiff', 20], ['cutter', 12], ['brig', 10], ['frigate', 6], ['mortar-barge', 4], ['corsair-brig', 8]]) C.debug.spawn(id, n);
    C.steer(0.3);
    window.__perf = { frames: [], fx: [] };
    let last = performance.now();
    const loop = (now) => {
      window.__perf.frames.push(now - last); last = now;
      const fx = window.__CRUISE_FX__;
      if (fx) window.__perf.fx.push(fx.stats.updateMs);
      const s = C.summary();
      if (s.status === 'levelup' || s.status === 'chest') C.chooseCard(0);
      if (s.enemies < 40) { C.debug.spawn('brig', 4); C.debug.spawn('skiff', 6); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { window.__perf.frames.length = 0; window.__perf.fx.length = 0; });
  await page.waitForTimeout(seconds * 1000);
  const result = await page.evaluate(() => {
    const p = window.__perf;
    const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * q)] ?? 0; };
    const avg = p.frames.reduce((a, b) => a + b, 0) / Math.max(1, p.frames.length);
    const C = window.__CRUISE__;
    const fx = window.__CRUISE_FX__;
    let fxDraws = 0;
    fx?.group.traverse((o) => { if (o.isInstancedMesh ? o.count > 0 : o.isMesh && o.geometry.instanceCount > 0) fxDraws++; });
    return {
      frames: p.frames.length, fps: 1000 / avg, p95FrameMs: pct(p.frames, 0.95), p99FrameMs: pct(p.frames, 0.99),
      fxAvgMs: p.fx.reduce((a, b) => a + b, 0) / Math.max(1, p.fx.length), fxP50: pct(p.fx, 0.5), fxP95: pct(p.fx, 0.95), fxP99: pct(p.fx, 0.99),
      fxDraws, metrics: C.metrics(), summary: C.summary(), fxStats: fx ? { ...fx.stats } : null,
    };
  });
  console.log(JSON.stringify(result, null, 1));
  await page.screenshot({ path: 'output/ovh-fx/perf-game.png' });
  writeFileSync('output/ovh-fx/perf-game.json', JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
