// QA bot for the integrated game (lead-owned). Plays a real-time run through window.__CRUISE__, captures
// screenshots and metrics. Usage:
//   node scripts/qa-play.mjs --url http://127.0.0.1:4173 --out output/qa-run --ship sunlion --sea sunward-shallows --seconds 90 [--god] [--boss iron-warden] [--hud 0]
// The browser always closes in `finally`.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const url = args.url ?? process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const out = resolve(args.out ?? 'output/qa-run');
const ship = args.ship ?? 'sunlion';
const sea = args.sea ?? 'sunward-shallows';
const seconds = Number(args.seconds ?? 60);
const shotEvery = Number(args.every ?? 10);
await mkdir(out, { recursive: true });

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const log = { url, ship, sea, samples: [], errors: [], cards: [] };

const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: Number(args.dpr ?? 1) });
  page.on('pageerror', (e) => log.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  await page.goto(`${url}/?seed=${args.seed ?? 'qa'}${args.hud === '0' ? '&hud=0' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/00-title.png` });
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__CRUISE__.goHarbor());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/01-harbor.png` });
  await page.evaluate(({ ship, sea, god }) => { window.__CRUISE__.startRun(ship, sea); if (god) window.__CRUISE__.debug.god(true); }, { ship, sea, god: !!args.god });
  await page.waitForTimeout(1200);
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyW');
  if (args.boss) await page.evaluate((b) => window.__CRUISE__.debug.boss(b), args.boss);
  if (args.level) await page.evaluate((l) => window.__CRUISE__.debug.level(Number(l)), args.level);

  const held = new Set();
  const hold = async (key, on) => {
    if (on && !held.has(key)) { await page.keyboard.down(key); held.add(key); }
    if (!on && held.has(key)) { await page.keyboard.up(key); held.delete(key); }
  };
  const t0 = Date.now();
  let nextShot = 0, shot = 0, lastQ = 0, lastE = 0, lastBrace = 0;
  while ((Date.now() - t0) / 1000 < seconds) {
    const t = (Date.now() - t0) / 1000;
    const state = await page.evaluate(() => ({ s: window.__CRUISE__.summary(), n: window.__CRUISE__.nearest(4) }));
    const s = state.s;
    if (!s.player) break;
    if (s.status === 'levelup' || s.status === 'chest') {
      log.cards.push({ t: +t.toFixed(1), offers: s.offers });
      await page.keyboard.press('Digit1');
      await page.waitForTimeout(250);
      continue;
    }
    if (s.status === 'dead' || s.status === 'victory') { log.outcome = s.status; break; }
    const p = s.player;
    const target = state.n[0];
    let desired = p.heading;
    if (target) {
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz);
      const toward = Math.atan2(-dx, -dz);
      if (d > 170) desired = toward;
      else {
        const port = wrap(toward - Math.PI / 2), star = wrap(toward + Math.PI / 2);
        desired = Math.abs(wrap(port - p.heading)) < Math.abs(wrap(star - p.heading)) ? port : star;
        if (d < 70) desired = wrap(desired + (desired === port ? -0.6 : 0.6));
      }
      // Aim the mouse roughly at the target side for the manual broadside.
      if (t - lastQ > 8 && d < 160) { await page.keyboard.press('KeyQ'); lastQ = t; }
      if (t - lastE > 20 && d < 150) { await page.keyboard.press('KeyE'); lastE = t; }
      if (t - lastBrace > 6 && d < 45) { await page.keyboard.press('Space'); lastBrace = t; }
      await page.keyboard.press('KeyR');
    }
    const diff = wrap(desired - p.heading);
    await hold('KeyA', diff > 0.08); await hold('KeyD', diff < -0.08);
    if (t >= nextShot) {
      await page.screenshot({ path: `${out}/run-${String(shot).padStart(2, '0')}.png` });
      const metrics = await page.evaluate(() => window.__CRUISE__.metrics());
      log.samples.push({ t: +t.toFixed(1), summary: s, metrics });
      shot++; nextShot += shotEvery;
    }
    await page.waitForTimeout(100);
  }
  for (const k of [...held]) await hold(k, false);
  await page.screenshot({ path: `${out}/zz-end.png` });
  log.final = await page.evaluate(() => window.__CRUISE__.summary());
} finally {
  await browser.close();
  await writeFile(`${out}/qa-log.json`, JSON.stringify(log, null, 2));
  const last = log.samples.at(-1);
  console.log(JSON.stringify({ out, samples: log.samples.length, errors: log.errors.slice(0, 5), fps: log.samples.map((x) => Math.round(x.metrics?.fps ?? 0)), final: log.final && { t: log.final.time, lv: log.final.player?.level, kills: log.final.stats?.kills, hp: log.final.player?.hp, weapons: log.final.weapons }, last: last?.metrics }));
}
