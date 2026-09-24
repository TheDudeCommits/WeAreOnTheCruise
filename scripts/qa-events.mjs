// World-event QA (EVENTS): forces every set piece through window.__CRUISE__.debug.event(id) in a real run and
// captures screenshots of each at a few moments, plus the tracker state, hazards, the CPU profiler and scene stats.
// Usage:
//   node scripts/qa-events.mjs --url http://127.0.0.1:4193 --out output/r1-events/qa [--events kraken-rising,maelstrom]
//     [--ship sunlion] [--hud 0] [--shots 1.5,4,8] [--win]
// Points of interest are forced with the same hook: --events poi:trade-wind,poi:salvage,poi:beacon.
// --win sinks everything after the last shot and captures the tracker's outcome flourish.
// The browser always closes in `finally`.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, cur, i, all) => {
  if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const url = args.url ?? process.env.CRUISE_URL ?? 'http://127.0.0.1:4193';
const out = resolve(args.out ?? 'output/r1-events/qa');
const ship = args.ship ?? 'sunlion';
const shots = (args.shots ?? '1.5,4,8').split(',').map(Number);
const only = args.events ? new Set(args.events.split(',')) : null;
const PLAN = [
  { sea: 'sunward-shallows', minute: 6, events: ['kraken-rising', 'rogue-wave', 'maelstrom', 'admiralty-blockade', 'volcanic-eruption', 'sunken-treasure', 'bounty-contract'] },
  { sea: 'the-gloam', minute: 3.5, events: ['ghost-fleet'] },
  { sea: 'sunward-shallows', minute: 4, events: ['poi:trade-wind', 'poi:salvage', 'poi:beacon'] },
];
await mkdir(out, { recursive: true });
const log = { url, ship, events: [], errors: [] };

const state = () => {
  const fx = window.__CRUISE_FX__;
  const run = fx?.lastRun;
  const ev = run?.worldEvent;
  return {
    summary: window.__CRUISE__.summary(),
    worldEvent: ev ? { id: ev.id, name: ev.name, text: ev.text, time: +ev.time.toFixed(1), duration: +ev.duration.toFixed(1), progress: ev.progress, goal: ev.goal } : null,
    metrics: window.__CRUISE__.metrics(),
  };
};

const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: Number(args.dpr ?? 1) });
  page.on('pageerror', (e) => log.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  await page.goto(`${url}/?seed=${args.seed ?? 'events-qa'}${args.hud === '0' ? '&hud=0' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(800, 450);
  for (const leg of PLAN) {
    const events = leg.events.filter((id) => !only || only.has(id));
    if (events.length === 0) continue;
    await page.evaluate(() => window.__CRUISE__.goHarbor());
    await page.waitForTimeout(800);
    await page.evaluate(({ ship, sea, minute }) => {
      window.__CRUISE__.startRun(ship, sea);
      window.__CRUISE__.debug.god(true);
      window.__CRUISE__.debug.time(minute * 60);
      window.__CRUISE__.debug.level(8);
    }, { ship, sea: leg.sea, minute: leg.minute });
    await page.waitForTimeout(1500);
    await page.keyboard.press('KeyW');
    await page.keyboard.press('KeyW');
    await page.evaluate(() => { window.__CRUISE__.profiler.enable(true); window.__CRUISE__.profiler.reset(); });
    await page.waitForTimeout(2500);
    const SLOW = new Set(['rogue-wave', 'volcanic-eruption', 'maelstrom', 'poi:trade-wind', 'poi:salvage', 'poi:beacon']);
    for (const id of events) {
      // Hold the ship near the set pieces that are best seen from a standstill (half sail), full sail otherwise.
      if (SLOW.has(id)) { await page.keyboard.press('KeyS'); } else { await page.keyboard.press('KeyW'); await page.keyboard.press('KeyW'); }
      const started = await page.evaluate((id) => window.__CRUISE__.debug.event(id), id);
      const entry = { id, sea: leg.sea, started, samples: [] };
      let t = 0;
      for (const at of shots) {
        while (t < at) {
          await page.evaluate((s) => window.__CRUISE__.steer(s), id === 'sunken-treasure' || id.startsWith('poi:') ? 0 : 0.18);
          await page.waitForTimeout(250);
          t += 0.25;
          // Clear the level-up / chest screens so the run keeps going.
          const status = await page.evaluate(() => window.__CRUISE__.summary().status);
          if (status === 'levelup' || status === 'chest') await page.evaluate(() => window.__CRUISE__.chooseCard(0));
        }
        const file = `${id.replace(':', '-')}-${String(at).replace('.', '_')}s.png`;
        await page.screenshot({ path: `${out}/${file}` });
        entry.samples.push({ at, file, ...(await page.evaluate(state)) });
      }
      if (args.win && !id.startsWith('poi:')) {
        await page.evaluate(() => window.__CRUISE__.debug.killAll());
        await page.waitForTimeout(700);
        const file = `${id}-outcome.png`;
        await page.screenshot({ path: `${out}/${file}` });
        entry.samples.push({ at: 'outcome', file, ...(await page.evaluate(state)) });
      }
      log.events.push(entry);
      console.log(JSON.stringify({ id, started, last: entry.samples.at(-1)?.worldEvent, hazards: entry.samples.at(-1)?.summary?.hazards, fps: entry.samples.map((s) => Math.round(s.metrics?.fps ?? 0)) }));
    }
    log[`profile-${leg.sea}`] = await page.evaluate(() => window.__CRUISE__.profiler.report(5));
    log[`scene-${leg.sea}`] = await page.evaluate(() => window.__CRUISE__.sceneStats());
  }
} finally {
  await browser.close();
  await writeFile(`${out}/qa-events-log.json`, JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ out, events: log.events.length, errors: log.errors.slice(0, 8) }));
}
