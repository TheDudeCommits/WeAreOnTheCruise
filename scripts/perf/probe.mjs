#!/usr/bin/env node
/**
 * PERF probe (round 2): per-pass triangles/draw calls, program growth and real-time CPU hitches on a frozen build.
 *
 *   node scripts/perf/probe.mjs <baseUrl> <outDir> [--headed] [--stages title,harbor,opening,late,bosses] [--seconds 3]
 *
 * Instruments the page from outside (no game code): wraps the post stack's ink prepass, the shadow map render and
 * the post stack render to split each frame's triangles into prepass / shadow / colour+post, and records WebGL
 * programs (name + cache key) per stage so late compiles can be named. CPU numbers come from the game's own
 * profiler over real-time windows (rAF frames, not advance()). Writes <outDir>/probe.json. The browser always
 * closes in `finally`. Keep <outDir> under output/ (gitignored).
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--stages' || a === '--seconds' || a === '--ship' || a === '--sea') flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true; else pos.push(a);
}
const BASE = (pos[0] ?? 'http://127.0.0.1:4206').replace(/\/$/, '');
const OUT = resolve(pos[1] ?? 'output/r2-perf/probe');
const SECONDS = Number(flags.seconds ?? 3);
const STAGES = String(flags.stages ?? 'title,harbor,opening,late,bosses').split(',');
const SHIP = flags.ship ?? 'sunlion';
const SEA = flags.sea ?? 'sunward-shallows';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { base: BASE, startedAt: new Date().toISOString(), stages: [], programsByStage: {}, errors: [], load: null };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({
  headless: !flags.headed,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
let page;
const ev = (fn, arg) => page.evaluate(fn, arg);
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  page.on('pageerror', (e) => out.errors.push(String(e.message ?? e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text().slice(0, 300)); });
  const t0 = Date.now();
  await page.goto(`${BASE}/?seed=gauntlet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__CRUISE__?.ready && window.__SHIPS__?.lastContext, null, { timeout: 120000, polling: 100 });
  out.load = { readyMs: Date.now() - t0 };
  // Instrumentation: split each frame's renderer.info into passes.
  await ev(() => {
    const post = window.__SHIPS__.lastContext.services.post;
    const r = post.renderer;
    const info = r.info.render;
    const acc = { frames: 0, pre: 0, preCalls: 0, shadow: 0, shadowCalls: 0, total: 0, totalCalls: 0, maxTotal: 0, maxCalls: 0 };
    window.__PROBE__ = { acc, r, post, reset() { for (const k of Object.keys(acc)) acc[k] = 0; } };
    const ink = post.ink; const inkRender = ink.render.bind(ink);
    ink.render = (a, b, c) => { const t = info.triangles, n = info.calls; inkRender(a, b, c); acc.pre += info.triangles - t; acc.preCalls += info.calls - n; };
    const sm = r.shadowMap; const smRender = sm.render.bind(sm);
    sm.render = (a, b, c) => { const t = info.triangles, n = info.calls; smRender(a, b, c); acc.shadow += info.triangles - t; acc.shadowCalls += info.calls - n; };
    const postRender = post.render.bind(post);
    post.render = (a, b) => { postRender(a, b); acc.frames++; acc.total += info.triangles; acc.totalCalls += info.calls; acc.maxTotal = Math.max(acc.maxTotal, info.triangles); acc.maxCalls = Math.max(acc.maxCalls, info.calls); };
    window.__CRUISE__.profiler.enable(true);
  });

  const programs = () => ev(() => window.__PROBE__.r.info.programs.map((p) => `${p.name}#${p.cacheKey.length}:${[...p.cacheKey].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0}`));
  const programKeys = () => ev(() => Object.fromEntries(window.__PROBE__.r.info.programs.map((p) => [`${p.name}#${p.cacheKey.length}:${[...p.cacheKey].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0}`, p.cacheKey.slice(0, 600)])));
  let seen = new Set();
  async function measure(label, seconds = SECONDS, pilot = null) {
    await ev(() => { window.__PROBE__.reset(); window.__CRUISE__.profiler.reset(); });
    const tEnd = Date.now() + seconds * 1000;
    while (Date.now() < tEnd) {
      await ev((pilot) => {
        const c = window.__CRUISE__;
        const s = c.summary();
        if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0);
        if (pilot && s.player) {
          const n = c.nearest(16).find((q) => (pilot === 'boss' ? q.boss : true));
          if (n) { const p = s.player; const toward = Math.atan2(-(n.x - p.x), -(n.z - p.z)); let d = toward - p.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; c.steer(Math.max(-1, Math.min(1, d * 2.5))); c.aim(n.x, n.z); }
        }
      }, pilot);
      await sleep(250);
    }
    const data = await ev(() => {
      const c = window.__CRUISE__; const a = window.__PROBE__.acc; const f = Math.max(1, a.frames);
      const rep = c.profiler.report(5);
      return {
        frames: a.frames,
        passes: { prepass: Math.round(a.pre / f), shadow: Math.round(a.shadow / f), colourAndPost: Math.round((a.total - a.pre - a.shadow) / f), total: Math.round(a.total / f), maxTotal: a.maxTotal,
          calls: { prepass: +(a.preCalls / f).toFixed(1), shadow: +(a.shadowCalls / f).toFixed(1), total: +(a.totalCalls / f).toFixed(1), max: a.maxCalls } },
        metrics: c.metrics(), scene: c.sceneStats(), summary: c.summary(),
        cpu: { mean: rep.mean, max: rep.max, worst: rep.worst.slice(0, 3), frames: rep.frames },
        hulls: c.captains()?.hulls ?? null,
      };
    });
    const now = await programs();
    const fresh = now.filter((k) => !seen.has(k));
    seen = new Set(now);
    const entry = { label, ...data, programs: now.length, newPrograms: fresh };
    out.stages.push(entry);
    const sceneTris = Object.values(data.scene).reduce((s, g) => s + g.tris, 0);
    console.log(`[probe] ${label}: tris ${data.passes.total} (pre ${data.passes.prepass}, shadow ${data.passes.shadow}, colour+post ${data.passes.colourAndPost}; scene ${sceneTris}) calls ${data.passes.calls.total} programs ${now.length} (+${fresh.length}) cpu mean ${data.cpu.mean.total?.toFixed?.(2)} max ${data.cpu.max.total} enemies ${data.summary.enemies ?? '-'}`);
    return entry;
  }

  if (STAGES.includes('title')) { await sleep(2500); await measure('title'); }
  if (STAGES.includes('harbor')) {
    await page.mouse.click(800, 450);
    await ev(() => window.__CRUISE__.goHarbor());
    await sleep(1500);
    await measure('harbor', SECONDS);
    // Warm-up (PERF round 2): wait until it reports finished (older builds have no __PERF__.warmup).
    const tw = Date.now();
    while (Date.now() - tw < 45000) {
      const done = await ev(() => { const w = window.__PERF__?.warmup?.(); return w ? !!w.finished : null; });
      if (done !== false) break;
      await sleep(500);
    }
    out.warmup = await ev(() => window.__PERF__?.warmup?.() ?? null);
    out.captainBakes = await ev(() => window.__PERF__?.captainBakes?.() ?? null);
    if (out.warmup) console.log(`[probe] warm-up ${out.warmup.elapsed} ms: ${out.warmup.phases.map((p) => `${p.name} ${p.ms} ms (programs ${p.programs})`).join(', ')}; errors ${out.warmup.errors.length}`);
    await measure('harbor-after-warmup', 2);
  }
  const keysBeforeRun = await programKeys();
  if (STAGES.includes('opening') || STAGES.includes('late') || STAGES.includes('bosses')) {
    await ev(({ ship, sea }) => { const c = window.__CRUISE__; c.startRun(ship, sea); c.debug.god(true); }, { ship: SHIP, sea: SEA });
    await page.waitForFunction(() => window.__CRUISE__.summary().status === 'running', null, { timeout: 15000 });
    await measure('opening-0-12s', 12, 'any');
    await measure('opening-12-20s', 8, 'any');
  }
  if (STAGES.includes('late')) {
    await ev(() => {
      const c = window.__CRUISE__, d = c.debug;
      d.time(12 * 60 + 30); d.level(24);
      for (const [w, l] of [['rocket-rack', 5], ['storm-rod', 4], ['broadside', 6], ['bow-chaser', 3], ['stern-mortar', 3]]) d.weapon(w, l);
      for (const [id, n] of [['man-o-war', 1], ['frigate', 3], ['corsair-galleon', 1], ['mortar-barge', 2], ['skiff', 10], ['fireship', 3], ['brig', 4], ['cutter', 4], ['ironclad', 2], ['harpooner', 2], ['signal-cutter', 2], ['bomb-ketch', 2], ['smoke-runner', 3]]) d.spawn(id, n);
    });
    await measure('late-loadout-0-6s', 6, 'any');
    await measure('late-6-12s', 6, 'any');
    await measure('late-12-18s', 6, 'any');
  }
  if (STAGES.includes('bosses')) {
    for (const id of ['iron-warden', 'tidewyrm', 'sovereign']) {
      await ev((id) => window.__CRUISE__.debug.boss(id), id);
      await measure(`boss-${id}-approach`, 8, 'boss');
      await measure(`boss-${id}`, 4, 'boss');
      await ev(() => window.__CRUISE__.debug.sinkBosses());
      await measure(`boss-${id}-sinking`, 3, 'any');
    }
  }
  const keysAfter = await programKeys();
  out.lateProgramKeys = Object.fromEntries(Object.entries(keysAfter).filter(([k]) => !(k in keysBeforeRun)));
} finally {
  await browser.close().catch(() => undefined);
  out.finishedAt = new Date().toISOString();
  await writeFile(join(OUT, 'probe.json'), JSON.stringify(out, null, 1));
  console.log(`[probe] wrote ${join(OUT, 'probe.json')} (${out.errors.length} errors)`);
}
