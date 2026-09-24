/**
 * UI evidence capture (UI-owned tooling; not part of the build). Screenshots every screen and HUD state at 1600×900
 * from the UI lab (mock state over engine plates) and from the real game, into output/ovh-ui/.
 *
 *   npx vite --host 127.0.0.1 --port 4189 --strictPort &   # dev server
 *   node src/ui/lab/capture-ui.mjs [baseUrl] [outDir]
 *
 * Browsers are closed in `finally`. Generated paint-over backgrounds (bg=t-*) are dev-only stress plates, not engine frames.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4189';
const OUT = (process.argv[3] ?? 'output/ovh-ui').replace(/\/$/, '');
mkdirSync(OUT, { recursive: true });

/** [name, query, waitMs, script?, afterScriptMs?, viewport?] */
const LAB = [
  ['lab-title', 'screen=title&panel=0', 3300],
  ['lab-harbor-fleet', 'screen=harbor&panel=0&freeze=1', 1800],
  ['lab-harbor-seas', 'screen=harbor&panel=0&freeze=1&tab=seas', 1800],
  ['lab-harbor-shipwright', 'screen=harbor&panel=0&freeze=1&tab=shipwright', 1800],
  ['lab-harbor-fresh', 'screen=harbor&panel=0&freeze=1&profile=fresh', 1800],
  ['lab-harbor-pad', 'screen=harbor&panel=0&freeze=1&pad=1', 1800],
  ['lab-hud-day', 'screen=run&bg=day&panel=0&freeze=1&boss=1', 1800],
  ['lab-hud-night-lowhull', 'screen=run&bg=night&panel=0&freeze=1&hp=0.18', 1800],
  ['lab-hud-bright-event', 'screen=run&bg=t-bright&panel=0&freeze=1&fire=director-event', 1500],
  ['lab-hud-storm-panel', 'screen=run&bg=storm&boss=1', 2000],
  ['lab-hud-pad', 'screen=run&bg=day&panel=0&freeze=1&pad=1', 1600],
  ['lab-hud-bosswarning', 'screen=run&bg=day&panel=0&freeze=1', 1500, "window.__UI_LAB__.fire('boss-warning')", 900],
  ['lab-hud-ultimate', 'screen=run&bg=day&panel=0&freeze=1', 1500, "window.__UI_LAB__.fire('ultimate')", 600],
  ['lab-hud-special', 'screen=run&bg=night&panel=0&freeze=1', 1500, "window.__UI_LAB__.fire('special')", 450],
  ['lab-hud-parry-hit', 'screen=run&bg=day&panel=0&freeze=1', 1500, "(() => { const l = window.__UI_LAB__; l.fire('hit'); setTimeout(() => l.fire('hit'), 60); setTimeout(() => l.fire('parry'), 120); })()", 420],
  ['lab-hud-tier-stamp', 'screen=run&bg=day&panel=0&freeze=1&boss=1', 1500, "window.__UI_LAB__.fire('tier-up')", 500],
  ['lab-hud-toasts', 'screen=run&bg=day&panel=0&freeze=1', 1500, "(() => { const l = window.__UI_LAB__; l.fire('new-weapon'); l.fire('repair'); l.fire('weather'); l.fire('ult-full'); })()", 700],
  ['lab-hud-boss-phase', 'screen=run&bg=day&panel=0&freeze=1&boss=1', 1500, "window.__UI_LAB__.fire('boss-phase')", 500],
  ['lab-cards-basic', 'screen=run&bg=day&panel=0&freeze=1&modal=levelup', 2200],
  ['lab-cards-branch', 'screen=run&bg=day&panel=0&freeze=1&modal=branch', 2200],
  ['lab-cards-overdrive', 'screen=run&bg=night&panel=0&freeze=1&modal=overdrive', 2200],
  ['lab-cards-four', 'screen=run&bg=day&panel=0&freeze=1&modal=four', 2200],
  ['lab-cards-banish-mode', 'screen=run&bg=day&panel=0&freeze=1&modal=levelup', 2000, "window.__UI_LAB__.key('KeyB')", 300],
  ['lab-chest', 'screen=run&bg=day&panel=0&freeze=1&modal=chest', 3800],
  ['lab-pause', 'screen=run&bg=day&panel=0&freeze=1&modal=pause', 1800],
  ['lab-settings', 'screen=run&bg=day&panel=0&freeze=1&modal=settings', 1800],
  ['lab-controls', 'screen=run&bg=day&panel=0&freeze=1&modal=controls', 1800],
  ['lab-confirm-retire', 'screen=run&bg=day&panel=0&freeze=1&modal=confirm', 1800],
  ['lab-results-victory', 'screen=results&outcome=victory&bg=menu&panel=0', 3800],
  ['lab-results-defeat', 'screen=results&outcome=defeat&bg=night&panel=0', 3800],
  ['lab-results-retired', 'screen=results&outcome=retired&bg=menu&panel=0', 3800],
  ['lab-720-harbor', 'screen=harbor&panel=0&freeze=1', 1800, null, 0, { width: 1280, height: 720 }],
  ['lab-1080-hud', 'screen=run&bg=day&panel=0&freeze=1&boss=1', 1800, null, 0, { width: 1920, height: 1080 }],
];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  for (const [name, query, wait, script, after, viewport] of LAB) {
    const page = await browser.newPage({ viewport: viewport ?? { width: 1600, height: 900 } });
    page.on('pageerror', (e) => console.log('[pageerror]', name, e.message));
    await page.goto(`${BASE}/lab/ui.html?${query}`);
    await page.waitForTimeout(wait);
    if (script) { await page.evaluate(script); await page.waitForTimeout(after ?? 900); }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await page.close();
    console.log('lab', name);
  }

  // Real game: title → harbor (tabs) → set sail → HUD → level-up → boss → pause → retire → results → harbor.
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('[pageerror] game', e.message));
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('game', name); };
  const bridge = (fn) => page.evaluate(fn);
  await page.goto(`${BASE}/?seed=ui`);
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(3300);
  await shot('game-title');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await shot('game-harbor');
  await page.keyboard.press('KeyE'); await page.waitForTimeout(500); await shot('game-harbor-seas');
  await page.keyboard.press('KeyE'); await page.waitForTimeout(500); await shot('game-harbor-shipwright');
  await page.keyboard.press('KeyQ'); await page.keyboard.press('KeyQ');
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1500);
  await bridge(() => { const c = window.__CRUISE__; c.debug.god(true); c.debug.spawn('brig', 6); c.debug.spawn('skiff', 14); c.debug.spawn('cutter', 5, true); });
  await page.waitForTimeout(5000);
  await shot('game-hud');
  await bridge(() => window.__CRUISE__.debug.xp(50));
  await page.waitForTimeout(1200);
  await shot('game-levelup');
  for (let i = 0; i < 8; i++) { if ((await bridge(() => window.__CRUISE__.summary().status)) !== 'levelup') break; await page.keyboard.press('Digit1'); await page.waitForTimeout(450); }
  await bridge(() => window.__CRUISE__.debug.boss('iron-warden'));
  await page.waitForTimeout(2500);
  await shot('game-boss');
  await page.keyboard.press('Escape'); await page.waitForTimeout(800); await shot('game-pause');
  await page.click('.cr-pause .cr-menuitem:nth-child(4)'); await page.waitForTimeout(400);
  await page.click('.cr-confirm .cr-btn.is-danger'); await page.waitForTimeout(1000); await shot('game-retire-stamp');
  await page.waitForTimeout(3600); await shot('game-results');
  console.log('ui perf', JSON.stringify(await bridge(() => window.__CRUISE_UI__.perf())));
  await page.close();
} finally {
  await browser.close();
}
