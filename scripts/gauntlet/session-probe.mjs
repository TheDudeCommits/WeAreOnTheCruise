#!/usr/bin/env node
/**
 * Gauntlet session probe (critic tooling; changes no game code): one real-time run, no clock jumps unless asked.
 *
 *   node scripts/gauntlet/session-probe.mjs <baseUrl> <outDir> [--ship sunlion] [--sea sunward-shallows]
 *        [--seconds 240] [--god] [--boss-at <s>] [--headed] [--seed probe]
 *
 * A scripted captain (sail at the nearest enemy, turn broadside inside 170 m, skills on cooldown, card 0 on every
 * level-up) plays while an in-page recorder logs:
 *   - pacing: 1 Hz timeline (level, xp, kills, hull, enemies, projectiles, pickups), first kill, level-up times, cards;
 *   - audio: SimEvent type counts, event→cue pairs (router notes), cues requested/played/dropped per cue, drop
 *     reasons, voices, music transitions, a 5 Hz post-limiter meter; derived spam and silent-event lists;
 *   - CPU: profiler split per 10 s window (mean, p95, max, hitch counts);
 *   - a screenshot every 30 s.
 * `--boss-at S` jumps the clock to 4:50 after S real seconds so the Iron Warden warning and fight play in real time.
 * The pilot is not a human: treat its kill/level numbers as a floor. Writes <outDir>/session.json.
 * The browser always closes in `finally`.
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const VALUE_FLAGS = new Set(['--ship', '--sea', '--seconds', '--boss-at', '--seed']);
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}
if (positional.length < 2 || flags.help) {
  console.error('usage: node scripts/gauntlet/session-probe.mjs <baseUrl> <outDir> [--ship id] [--sea id] [--seconds 240] [--god] [--boss-at s] [--headed] [--seed s]');
  process.exit(2);
}
const BASE = positional[0].replace(/\/$/, '');
const OUT = resolve(positional[1]);
const SHIP = flags.ship ?? 'sunlion';
const SEA = flags.sea ?? 'sunward-shallows';
const SECONDS = Number(flags.seconds ?? 240);
const GOD = !!flags.god;
const BOSS_AT = flags['boss-at'] !== undefined ? Number(flags['boss-at']) : null;
const SEED = flags.seed ?? 'probe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pctl = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : null);
const log = (...a) => console.log(`[probe ${new Date().toISOString().slice(11, 19)}]`, ...a);

const out = {
  tool: 'scripts/gauntlet/session-probe.mjs', base: BASE, ship: SHIP, sea: SEA, seconds: SECONDS, god: GOD, bossAt: BOSS_AT, seed: SEED,
  startedAt: new Date().toISOString(), finishedAt: null, browser: null, gpu: null, load: null,
  pacing: null, audio: null, cpu: [], timeline: [], cards: [], shots: [], errors: [], warnings: [],
};

function cpuSplit(rep) {
  if (!rep || !rep.frames) return null;
  const totals = rep.worst.map((f) => f.total).sort((a, b) => a - b);
  return {
    frames: rep.frames, mean: rep.mean, max: rep.max,
    p50: pctl(totals, 0.5), p95: pctl(totals, 0.95), p99: pctl(totals, 0.99),
    over16ms: totals.filter((x) => x > 16.7).length, over33ms: totals.filter((x) => x > 33.3).length, worst: rep.worst.slice(0, 2),
  };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: !flags.headed,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
let page = null;
try {
  out.browser = browser.version();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => out.errors.push({ type: 'pageerror', text: String(e.message ?? e).slice(0, 400) }));
  page.on('console', (m) => {
    if (m.type() === 'error') out.errors.push({ type: 'console.error', text: m.text().slice(0, 400) });
    else if (m.type() === 'warning' && out.warnings.length < 100) out.warnings.push(m.text().slice(0, 300));
  });
  const tNav = Date.now();
  await page.goto(`${BASE}/?seed=${encodeURIComponent(SEED)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 120000, polling: 100 });
  out.load = { readyMs: Date.now() - tNav };
  out.gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  });
  // Harness-side instrumentation: SimEvent types and router event→cue pairs as the audio engine sees them.
  await page.evaluate(() => {
    const eng = window.__CRUISE_AUDIO__?.engine;
    window.__PROBE_EVENTS__ = {};
    window.__PROBE_PAIRS__ = {};
    if (!eng) return;
    const upd = eng.update.bind(eng);
    eng.update = (frame) => { for (const e of frame.events) window.__PROBE_EVENTS__[e.type] = (window.__PROBE_EVENTS__[e.type] ?? 0) + 1; return upd(frame); };
    const hooks = eng.router?.h;
    if (hooks?.note) {
      const note = hooks.note;
      hooks.note = (source, cue) => { const k = `${source} → ${cue}`; window.__PROBE_PAIRS__[k] = (window.__PROBE_PAIRS__[k] ?? 0) + 1; return note(source, cue); };
    }
  });
  // A player's path: title → click → harbor (a few seconds of reading) → set sail.
  await sleep(2000);
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__CRUISE__.goHarbor());
  await sleep(4000);
  await page.evaluate(({ ship, sea, god }) => {
    const c = window.__CRUISE__;
    window.__CRUISE_AUDIO__?.reset?.();
    c.profiler.enable(true);
    c.startRun(ship, sea);
    if (god) c.debug.god(true);
  }, { ship: SHIP, sea: SEA, god: GOD });
  await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 15000 });
  await page.evaluate(() => { const c = window.__CRUISE__; c.press('gear-up'); c.profiler.reset(); });

  // In-page recorder + pilot.
  await page.evaluate(() => {
    const c = window.__CRUISE__, A = window.__CRUISE_AUDIO__;
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const P = (window.__PROBE__ = { t0: performance.now(), timeline: [], meter: [], cards: [], firstKill: null, death: null, stop: false, gearUps: 0 });
    let lastQ = -99, lastE = -99, lastBrace = -99, lastR = -99, lastBoost = -99;
    const now = () => (performance.now() - P.t0) / 1000;
    P.pilotTimer = setInterval(() => {
      if (P.stop) return;
      const t = now();
      const s = c.summary();
      if (!s.player) return;
      if (P.firstKill === null && s.stats.kills > 0) P.firstKill = { wall: +t.toFixed(1), sim: s.time };
      if (s.status === 'levelup' || s.status === 'chest') {
        P.cards.push({ wall: +t.toFixed(1), sim: s.time, status: s.status, level: s.player.level, offers: s.offers });
        c.chooseCard(0);
        return;
      }
      if (s.status === 'dead') { if (!P.death) P.death = { wall: +t.toFixed(1), sim: s.time, level: s.player.level, kills: s.stats.kills }; return; }
      if (s.status !== 'running') return;
      const p = s.player;
      if (p.gear < 2 && P.gearUps < 20) { c.press('gear-up'); P.gearUps++; }
      const n = c.nearest(1)[0];
      let desired = p.heading;
      if (n) {
        const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
        const toward = Math.atan2(-dx, -dz);
        if (d > 170) desired = toward;
        else {
          const port = wrap(toward - Math.PI / 2), star = wrap(toward + Math.PI / 2);
          desired = Math.abs(wrap(port - p.heading)) < Math.abs(wrap(star - p.heading)) ? port : star;
          if (d < 70) desired = wrap(desired + (desired === port ? -0.6 : 0.6));
        }
        c.aim(n.x, n.z);
        if (t - lastQ > 6 && d < 170) { c.press('broadside'); lastQ = t; }
        if (t - lastE > 18 && d < 160) { c.press('special'); lastE = t; }
        if (t - lastBrace > 6 && d < 45) { c.press('brace'); lastBrace = t; }
        if (t - lastR > 4) { c.press('ultimate'); lastR = t; }
        if (t - lastBoost > 12 && d > 260) { c.press('boost'); lastBoost = t; }
      }
      c.steer(Math.max(-1, Math.min(1, wrap(desired - p.heading) * 2.5)));
    }, 100);
    P.meterTimer = setInterval(() => {
      const m = A?.meter?.();
      if (m) P.meter.push([+now().toFixed(1), m.rmsDb, m.peakDb]);
    }, 200);
    P.sampleTimer = setInterval(() => {
      const s = c.summary();
      if (!s.player) return;
      const a = A?.stats?.();
      P.timeline.push({
        wall: +now().toFixed(1), sim: s.time, status: s.status, level: s.player.level, xp: s.player.xp, kills: s.stats.kills,
        hp: s.player.hp, maxHp: s.player.maxHp, speed: s.player.speed, enemies: s.enemies, projectiles: s.projectiles, pickups: s.pickups,
        bosses: s.bosses, weather: s.weather, music: a?.music?.state ?? null, intensity: a?.music?.intensity ?? null, voices: a?.totalVoices ?? null,
      });
    }, 1000);
  });

  log(`run started: ${SHIP} on ${SEA} for ${SECONDS} s${GOD ? ' (god)' : ''}${BOSS_AT !== null ? `, boss jump at ${BOSS_AT} s` : ''}`);
  const t0 = Date.now();
  let nextShot = 0, nextCpu = 10, bossDone = false, shotN = 0;
  while ((Date.now() - t0) / 1000 < SECONDS) {
    await sleep(500);
    const el = (Date.now() - t0) / 1000;
    if (BOSS_AT !== null && !bossDone && el >= BOSS_AT) {
      bossDone = true;
      await page.evaluate(() => window.__CRUISE__.debug.time(290));
      log('clock → 4:50 (boss warning)');
    }
    if (el >= nextCpu) {
      const rep = await page.evaluate(() => { const r = window.__CRUISE__.profiler.report(1000); window.__CRUISE__.profiler.reset(); return r; });
      const summary = await page.evaluate(() => { const s = window.__CRUISE__.summary(); return { enemies: s.enemies, projectiles: s.projectiles, level: s.player?.level, time: s.time }; });
      const m = await page.evaluate(() => { const x = window.__CRUISE__.metrics(); return { drawCalls: x.drawCalls, triangles: x.triangles }; });
      out.cpu.push({ wall: Math.round(el), ...summary, ...m, cpu: cpuSplit(rep) });
      nextCpu += 10;
    }
    if (el >= nextShot) {
      const file = `probe-${String(shotN++).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: join(OUT, file), type: 'jpeg', quality: 78 });
      out.shots.push({ wall: Math.round(el), file });
      nextShot += 30;
    }
    const dead = await page.evaluate(() => !!window.__PROBE__.death);
    if (dead) { log('the ship sank'); await sleep(2500); break; }
  }

  const probe = await page.evaluate(() => {
    const P = window.__PROBE__;
    P.stop = true;
    clearInterval(P.pilotTimer); clearInterval(P.meterTimer); clearInterval(P.sampleTimer);
    const A = window.__CRUISE_AUDIO__;
    return {
      timeline: P.timeline, meter: P.meter, cards: P.cards, firstKill: P.firstKill, death: P.death,
      events: window.__PROBE_EVENTS__, pairs: window.__PROBE_PAIRS__, stats: A?.stats?.() ?? null, log: A?.log?.(400) ?? [],
      final: window.__CRUISE__.summary(),
    };
  });
  const endShot = `probe-end.jpg`;
  await page.screenshot({ path: join(OUT, endShot), type: 'jpeg', quality: 78 });
  out.shots.push({ wall: Math.round((Date.now() - t0) / 1000), file: endShot });

  // ── derive: pacing ──
  const tl = probe.timeline;
  out.timeline = tl;
  out.cards = probe.cards;
  const levelups = [];
  for (let i = 1; i < tl.length; i++) if (tl[i].level > tl[i - 1].level) levelups.push({ sim: tl[i].sim, level: tl[i].level });
  const gaps = levelups.slice(1).map((l, i) => +(l.sim - levelups[i].sim).toFixed(1));
  const at = (sec) => { const row = tl.find((r) => r.sim >= sec); return row ? { level: row.level, kills: row.kills, enemies: row.enemies } : null; };
  const killsPerMin = [];
  for (let m = 1; m * 60 <= (tl.at(-1)?.sim ?? 0) + 1; m++) {
    const a = tl.find((r) => r.sim >= (m - 1) * 60), b = tl.find((r) => r.sim >= m * 60) ?? tl.at(-1);
    if (a && b) killsPerMin.push(b.kills - a.kills);
  }
  const hpPct = tl.map((r) => r.hp / Math.max(1, r.maxHp));
  out.pacing = {
    firstKill: probe.firstKill, death: probe.death,
    finalSim: probe.final?.time ?? null, finalLevel: probe.final?.player?.level ?? null, finalKills: probe.final?.stats?.kills ?? null,
    weapons: probe.final?.weapons ?? null, passives: probe.final?.passives ?? null,
    levelAt: { 30: at(30), 60: at(60), 120: at(120), 180: at(180), 240: at(240), 300: at(300) },
    levelups, levelGapSeconds: gaps, levelGapMedian: pctl([...gaps].sort((a, b) => a - b), 0.5),
    killsPerMinute: killsPerMin,
    enemiesMedian: pctl(tl.map((r) => r.enemies).sort((a, b) => a - b), 0.5), enemiesMax: Math.max(0, ...tl.map((r) => r.enemies)),
    hpMinPct: hpPct.length ? +Math.min(...hpPct).toFixed(2) : null,
    secondsBelowHalfHp: hpPct.filter((x) => x < 0.5).length,
  };

  // ── derive: audio ──
  const st = probe.stats;
  const minutes = Math.max(1 / 60, (tl.at(-1)?.wall ?? SECONDS) / 60);
  const perCue = [];
  if (st) {
    for (const [cue, req] of Object.entries(st.requested)) {
      const played = st.played[cue] ?? 0;
      perCue.push({ cue, requested: req, played, dropped: req - played, playedPerMin: +(played / minutes).toFixed(1) });
    }
    perCue.sort((a, b) => b.played - a.played);
  }
  const sources = new Set(Object.keys(probe.pairs).map((k) => k.split(' → ')[0]));
  const meterSorted = probe.meter.map((m) => m[1]).filter((x) => Number.isFinite(x) && x > -100).sort((a, b) => a - b);
  const peaks = probe.meter.map((m) => m[2]).filter((x) => Number.isFinite(x));
  out.audio = {
    minutes: +minutes.toFixed(2),
    events: probe.events,
    silentEventTypes: Object.keys(probe.events).filter((t) => !sources.has(t)).map((t) => ({ type: t, count: probe.events[t] })),
    pairs: Object.fromEntries(Object.entries(probe.pairs).sort((a, b) => b[1] - a[1])),
    perCue,
    spam: perCue.filter((c) => c.playedPerMin >= 40).map((c) => `${c.cue} ${c.playedPerMin}/min`),
    mostDropped: [...perCue].sort((a, b) => b.dropped - a.dropped).slice(0, 12).map((c) => `${c.cue} ${c.dropped}/${c.requested}`),
    dropReasons: st?.dropped ?? null, peakVoices: st?.peakVoices ?? null, steals: st?.steals ?? null, bank: st?.bank ?? null,
    musicTransitions: st?.musicTransitions ?? null,
    meter: {
      samples: probe.meter.length,
      rmsDbP10: pctl(meterSorted, 0.1), rmsDbP50: pctl(meterSorted, 0.5), rmsDbP90: pctl(meterSorted, 0.9),
      peakDbMax: peaks.length ? Math.max(...peaks) : null, pctPeaksAboveMinus1dB: peaks.length ? +((peaks.filter((p) => p > -1).length / peaks.length) * 100).toFixed(1) : null,
      silentPct: probe.meter.length ? +((probe.meter.filter((m) => m[1] < -60).length / probe.meter.length) * 100).toFixed(1) : null,
    },
    meterTrace: probe.meter.filter((_, i) => i % 5 === 0),
    logTail: probe.log.slice(-120),
  };
  log(`done: sim ${out.pacing.finalSim}s lv ${out.pacing.finalLevel} kills ${out.pacing.finalKills}${probe.death ? ' (sank)' : ''} · silent events: ${out.audio.silentEventTypes.map((e) => e.type).join(', ') || 'none'} · spam: ${out.audio.spam.join(', ') || 'none'}`);
} finally {
  await browser.close().catch(() => undefined);
  out.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'session.json'), JSON.stringify(out, null, 1));
  const cpuMeans = out.cpu.map((w) => w.cpu?.mean?.total).filter((x) => x != null);
  console.log(JSON.stringify({
    out: join(OUT, 'session.json'), errors: out.errors.length, pacing: out.pacing && { firstKill: out.pacing.firstKill, levelAt: out.pacing.levelAt, levelGapMedian: out.pacing.levelGapMedian, killsPerMinute: out.pacing.killsPerMinute, death: out.pacing.death },
    cpuMeanMs: cpuMeans.length ? +(cpuMeans.reduce((a, b) => a + b, 0) / cpuMeans.length).toFixed(2) : null,
    audio: out.audio && { silent: out.audio.silentEventTypes, spam: out.audio.spam, meter: out.audio.meter, transitions: out.audio.musicTransitions?.length },
  }, null, 1));
}
