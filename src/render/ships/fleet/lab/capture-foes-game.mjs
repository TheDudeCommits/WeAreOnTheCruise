// FOES evidence: in-game captures of the round-1 classes, elite affixes and a named bounty captain.
// Usage: node src/render/ships/fleet/lab/capture-foes-game.mjs [url] [outDir] [only]. The browser always closes in `finally`.
// Uses window.__FOES_QA__ (src/game/sim/affixes.ts) to reach the run's sim and force affixes.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:4192';
const out = process.argv[3] ?? 'output/r1-foes/game';
const only = process.argv[4] ?? '';
await mkdir(out, { recursive: true });
const log = { errors: [], scenes: {} };
const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });

/** Scenes: sea, spawns (class, forward m, lateral m, elite, affixes), the condition that makes the shot, time limit. */
const SCENES = [
  { name: 'signal-cutter', sea: 'sunward-shallows', minute: 6, spawns: [['signal-cutter', 150, 40], ['brig', 110, -60], ['cutter', 90, 70]], until: "e('signal-cutter')?.ai.markT > 0.3", max: 14, after: 0.4 },
  { name: 'ironclad-windup', sea: 'sunward-shallows', minute: 7, spawns: [['ironclad', 120, 10]], until: "e('ironclad')?.ai.ic === 1", max: 12, after: 0.5 },
  { name: 'ironclad-charge', sea: 'sunward-shallows', minute: 7, spawns: [['ironclad', 120, 10]], until: "e('ironclad')?.ai.ic === 2", max: 14, after: 0.8 },
  { name: 'harpooner-line', sea: 'sunward-shallows', minute: 6, spawns: [['harpooner', 90, 30]], until: "(e('harpooner')?.ai.hpW ?? 0) > 0.3", max: 14, after: 0 },
  { name: 'harpooner-tether', sea: 'sunward-shallows', minute: 6, spawns: [['harpooner', 90, 30]], until: "e('harpooner')?.ai.tether === 1", max: 16, after: 0.6 },
  { name: 'bomb-ketch', sea: 'sunward-shallows', minute: 8, spawns: [['bomb-ketch', 190, 20]], until: "s.projectiles.some((p) => p.alive && p.kind === 'enemy-bomb' && p.age > 0.8)", max: 16, after: 0 },
  { name: 'bomb-ketch-fire', sea: 'sunward-shallows', minute: 8, spawns: [['bomb-ketch', 190, 20]], until: "s.hazards.some((h) => h.alive && h.kind === 'fire-patch' && h.age > 0.4)", max: 18, after: 0 },
  { name: 'smoke-runner', sea: 'sunward-shallows', minute: 6, spawns: [['smoke-runner', 120, 30], ['smoke-runner', 130, -30], ['brig', 150, 0]], until: "s.hazards.some((h) => h.alive && h.kind === 'smoke-screen' && h.age > 1)", max: 16, after: 0 },
  { name: 'lantern-wisp', sea: 'the-gloam', minute: 3.5, noGuns: true, spawns: [['lantern-wisp', 10, 55], ['lantern-wisp', 0, 60], ['lantern-wisp', -8, 52], ['lantern-wisp', 18, 64], ['lantern-wisp', 4, -58], ['lantern-wisp', -6, -64]], until: "s.enemies.filter((x) => x.defId === 'lantern-wisp' && x.ai.wl === 1).length >= 2", max: 12, after: 0.3 },
  { name: 'drowned-galleon-rising', sea: 'the-gloam', minute: 8.5, spawns: [['drowned-galleon', 200, 0]], until: "e('drowned-galleon')?.ai.dg === 1 && e('drowned-galleon').ai.t < 1.4", max: 14, after: 0 },
  { name: 'drowned-galleon-surfacing', sea: 'the-gloam', minute: 8.5, spawns: [['drowned-galleon', 200, 0]], until: "e('drowned-galleon')?.ai.dg === 2 && e('drowned-galleon').ai.sub < 0.55", max: 16, after: 0 },
  { name: 'drowned-galleon-fight', sea: 'the-gloam', minute: 8.5, spawns: [['drowned-galleon', 200, 0]], until: "e('drowned-galleon')?.ai.dg === 3", max: 18, after: 1.5 },
  { name: 'affix-shielded-commander', sea: 'sunward-shallows', minute: 11, spawns: [['frigate', 85, 25, true, ['shielded', 'commander']], ['brig', 110, -40], ['cutter', 100, 60]], until: 'true', max: 1, after: 1.2 },
  { name: 'affix-burning-swift', sea: 'sunward-shallows', minute: 11, spawns: [['corsair-brig', 80, 30, true, ['burning', 'swift']]], until: 'true', max: 1, after: 3 },
  { name: 'affix-vampiric-volatile', sea: 'sunward-shallows', minute: 11, spawns: [['brig', 80, 30, true, ['vampiric', 'volatile']]], until: 'true', max: 1, after: 1.2 },
  { name: 'affix-armored-splitting', sea: 'sunward-shallows', minute: 11, spawns: [['corsair-galleon', 90, 30, true, ['armored', 'splitting']]], until: 'true', max: 1, after: 1.2 },
  { name: 'affix-volatile-blast', sea: 'sunward-shallows', minute: 11, spawns: [['brig', 70, 30, true, ['volatile', 'splitting']]], until: 'true', max: 1, after: 0.6, kill: true, afterKill: 0.8 },
  { name: 'shield-break', sea: 'sunward-shallows', minute: 11, spawns: [['frigate', 75, 25, true, ['shielded']]], until: 'true', max: 1, after: 0.5, strip: true },
  { name: 'named-captain', sea: 'sunward-shallows', minute: 7, spawns: [['corsair-galleon', 110, 30, true, null, true]], until: 'true', max: 1, after: 1.5 },
];

async function scene(page, sc) {
  await page.evaluate(({ sea }) => {
    window.__FOES_QA__ = {};
    window.__CRUISE__.startRun('sunlion', sea);
    window.__CRUISE__.debug.god(true);
  }, sc);
  await page.waitForTimeout(700);
  await page.evaluate(({ minute, spawns, noGuns }) => {
    const qa = window.__FOES_QA__;
    window.__CRUISE__.advance(0.2);
    const sim = qa.sim;
    sim.debug.setTime(minute * 60);
    const s = sim.state, p = s.player;
    // A clean stage: no director waves or set pieces while the scene plays.
    s.director.budget = -1e9; s.director.scratch.nextEvent = 1e9;
    if (noGuns) p.weapons.length = 0;
    const fx = -Math.sin(p.heading), fz = -Math.cos(p.heading), sx = Math.cos(p.heading), sz = -Math.sin(p.heading);
    for (const e of s.enemies) e.life = 'dead';
    qa.keep = [];
    for (const [id, fwd, lat, elite, affixes, named] of spawns) {
      qa.affixes = affixes ?? undefined;
      qa.named = !!named;
      const x = p.x + fx * fwd + sx * lat, z = p.z + fz * fwd + sz * lat;
      const e = named && qa.spawnNamed ? qa.spawnNamed(id, x, z) : sim.spawnEnemy(id, x, z, { elite: !!elite });
      if (e && elite && !named && qa.roll) qa.roll(e);
      if (e) qa.keep.push(e.id);
    }
    qa.affixes = undefined; qa.named = false;
  }, sc);
  const deadline = sc.max;
  let t = 0, ok = false;
  while (t < deadline) {
    ok = await page.evaluate(({ until }) => {
      const qa = window.__FOES_QA__;
      const s = qa.sim.state;
      s.director.budget = -1e9; s.director.scratch.nextEvent = 1e9;
      for (const e of s.enemies) if (!qa.keep.includes(e.id) && e.life === 'alive' && e.spawnTime < s.time - 5) e.life = 'dead';
      const e = (id) => s.enemies.find((x) => x.defId === id && x.life === 'alive');
      // eslint-disable-next-line no-new-func
      return Function('s', 'e', `return !!(${until});`)(s, e);
    }, sc);
    if (ok) break;
    await page.evaluate(() => window.__CRUISE__.advance(0.25));
    t += 0.25;
  }
  if (sc.after) await page.evaluate((a) => window.__CRUISE__.advance(a), sc.after);
  if (sc.strip) await page.evaluate(() => { const s = window.__FOES_QA__.sim; const e = s.state.enemies.find((x) => x.elite && x.life === 'alive'); if (e) s.damageTarget(e, (e.ai.shield ?? 0) + 5, { pierceArmor: true }); window.__CRUISE__.advance(0.12); });
  if (sc.kill) {
    await page.evaluate(() => { const s = window.__FOES_QA__.sim; for (const e of s.state.enemies) if (e.elite && e.life === 'alive') s.damageTarget(e, 1e7, { pierceArmor: true }); });
    await page.evaluate((a) => window.__CRUISE__.advance(a), sc.afterKill ?? 0.5);
  }
  await page.screenshot({ path: `${out}/${sc.name}.png` });
  log.scenes[sc.name] = { ok, t, summary: await page.evaluate(() => { const s = window.__FOES_QA__.sim.state; return s.enemies.filter((e) => e.life === 'alive').map((e) => `${e.defId}${e.elite ? '*' : ''}${e.affixes.length ? '[' + e.affixes.join('+') + ']' : ''}${e.title ? '«' + e.title + '»' : ''}`); }) };
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => log.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  await page.goto(`${url}/?seed=foes`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__CRUISE__.goHarbor());
  await page.waitForTimeout(600);
  for (const sc of SCENES) if (!only || sc.name.includes(only)) await scene(page, sc);
  log.metrics = await page.evaluate(() => window.__CRUISE__.metrics());
} finally {
  await browser.close();
  await writeFile(`${out}/capture-log.json`, JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ errors: log.errors.slice(0, 6), scenes: Object.fromEntries(Object.entries(log.scenes).map(([k, v]) => [k, `${v.ok ? 'ok' : 'TIMEOUT'} ${v.t}s ${v.summary.slice(0, 6).join(',')}`])) }, null, 1));
}
