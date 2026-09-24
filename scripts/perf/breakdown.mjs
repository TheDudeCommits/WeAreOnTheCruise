#!/usr/bin/env node
/**
 * One-frame draw breakdown (PERF diagnostics): wraps renderer.renderBufferDirect for a single frame and attributes
 * triangles and draw calls to (pass, object path, material). Pass = prepass | shadow | colour | post.
 *
 *   node scripts/perf/breakdown.mjs <baseUrl> <outFile.json> [--run ship:sea] [--late] [--boss id]
 *
 * The browser always closes in `finally`.
 */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flags = {}; const pos = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--run' || a === '--boss') flags[a.slice(2)] = argv[++i]; else if (a.startsWith('--')) flags[a.slice(2)] = true; else pos.push(a); }
const BASE = (pos[0] ?? 'http://127.0.0.1:4206').replace(/\/$/, '');
const OUT = resolve(pos[1] ?? 'output/r2-perf/breakdown.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: !flags.headed, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`${BASE}/?seed=gauntlet`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE__?.ready && window.__SHIPS__?.lastContext, null, { timeout: 120000 });
  await sleep(2500);
  if (flags.run) {
    const [ship, sea] = flags.run.split(':');
    await page.evaluate(({ ship, sea }) => { const c = window.__CRUISE__; c.goHarbor(); c.startRun(ship, sea); c.debug.god(true); }, { ship, sea });
    await sleep(4000);
    if (flags.late) {
      await page.evaluate(() => {
        const c = window.__CRUISE__, d = c.debug;
        d.time(12 * 60 + 30); d.level(24);
        for (const [id, n] of [['man-o-war', 1], ['frigate', 3], ['corsair-galleon', 1], ['mortar-barge', 2], ['skiff', 10], ['fireship', 3], ['brig', 4], ['cutter', 4], ['ironclad', 2], ['harpooner', 2], ['signal-cutter', 2], ['bomb-ketch', 2], ['smoke-runner', 3]]) d.spawn(id, n);
      });
      for (let i = 0; i < 24; i++) { await page.evaluate(() => { const c = window.__CRUISE__; const s = c.summary(); if (s.status === 'levelup' || s.status === 'chest') c.chooseCard(0); }); await sleep(250); }
    }
    if (flags.boss) { await page.evaluate((id) => window.__CRUISE__.debug.boss(id), flags.boss); await sleep(5000); }
  }
  const result = await page.evaluate(() => new Promise((resolveP) => {
    const post = window.__SHIPS__.lastContext.services.post;
    const r = post.renderer;
    const rows = new Map();
    let pass = 'idle';
    const pathOf = (o) => { const names = []; let x = o; while (x && names.length < 4) { if (x.name) names.unshift(x.name); x = x.parent; } return names.join('/') || o.type; };
    const orig = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      const info = r.info.render; const t = info.triangles, c = info.calls;
      orig(camera, scene, geometry, material, object, group);
      const key = `${pass}|${pathOf(object)}|${material.name || material.type}|${object.isInstancedMesh ? 'inst' + object.count : ''}`;
      const e = rows.get(key) ?? { pass, object: pathOf(object), material: material.name || material.type, tris: 0, calls: 0, side: material.side, transparent: material.transparent };
      e.tris += info.triangles - t; e.calls += info.calls - c; rows.set(key, e);
    };
    const ink = post.ink; const inkRender = ink.render.bind(ink);
    ink.render = (a, b, c) => { pass = 'prepass'; inkRender(a, b, c); pass = 'colour'; };
    const sm = r.shadowMap; const smRender = sm.render.bind(sm);
    sm.render = (a, b, c) => { const p = pass; pass = 'shadow'; smRender(a, b, c); pass = p; };
    const postRender = post.render.bind(post);
    let frames = 0;
    post.render = (a, b) => {
      frames++;
      if (frames === 2) { pass = 'colour'; rows.clear(); }
      postRender(a, b);
      if (frames === 2) {
        r.renderBufferDirect = orig; ink.render = inkRender; sm.render = smRender; post.render = postRender;
        resolveP({ rows: [...rows.values()].sort((x, y) => y.tris - x.tris), info: { ...r.info.render } });
      }
    };
  }));
  const byPass = {};
  for (const row of result.rows) { const p = (byPass[row.pass] ??= { tris: 0, calls: 0 }); p.tris += row.tris; p.calls += row.calls; }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ byPass, info: result.info, rows: result.rows }, null, 1));
  console.log(JSON.stringify(byPass));
  for (const row of result.rows.slice(0, 40)) console.log(row.pass.padEnd(8), String(row.tris).padStart(8), String(row.calls).padStart(4), row.object.slice(0, 70).padEnd(70), row.material.slice(0, 40), row.side, row.transparent ? 'T' : '');
} finally {
  await browser.close().catch(() => undefined);
}
