#!/usr/bin/env node
/** Real selection and special input, followed by paused fixed-step capture. Never an FPS benchmark. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const output = resolve(process.env.CRUISE_SPECIALS_DIR ?? 'output/overhaul-gauntlet/specials');
const base = process.env.CRUISE_URL ?? 'http://127.0.0.1:4173';
const jobs = [
  { name: 'sunny', kind: 'thousand-sunny', scene: 'calm-sailing', camera: 'cinematic', activeAt: .5 },
  { name: 'polar', kind: 'polar-tang', scene: 'calm-sailing', camera: 'cinematic', activeAt: 1.5 },
  { name: 'moby', kind: 'moby-dick', scene: 'sunny-broadside', camera: 'overhead', activeAt: .6 },
];
const requested = process.argv.slice(2).filter((arg) => arg !== '--dry-run');
for (const name of requested) if (!jobs.some((job) => job.name === name)) throw Error(`Unknown special: ${name}`);
const selected = jobs.filter((job) => !requested.length || requested.includes(job.name));
const receipt = {
  method: 'Real vessel and launch buttons, trusted C special key, and real weapon keys. Public snapshot reads and explicit paused fixed ticks only for phase capture. No charge, position, damage, timer, save or effect injection. These captures and simulated timings are not FPS, human-play or cinematic-quality acceptance.',
  startedAt: new Date().toISOString(), base, viewport: { width: 1600, height: 900 }, runs: [],
};
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ output, jobs: selected, ...receipt }, null, 2));
  process.exit(0);
}
await mkdir(output, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: false });
  receipt.browserVersion = browser.version();
  for (const job of selected) {
    const context = await browser.newContext({ viewport: receipt.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);
    const run = { ...job, checks: [], trace: [], captures: [], errors: [], warnings: [], dialogs: [], scripts: [] };
    receipt.runs.push(run);
    const scriptReads = [];
    page.on('pageerror', (error) => run.errors.push({ type: 'pageerror', message: error.message }));
    page.on('console', (message) => {
      if (message.type() === 'error') run.errors.push({ type: 'console', message: message.text() });
      else if (message.type() === 'warning' && run.warnings.length < 100) run.warnings.push(message.text());
    });
    page.on('dialog', async (dialog) => {
      run.dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });
    page.on('response', (response) => {
      if (response.request().resourceType() !== 'script') return;
      scriptReads.push((async () => {
        try {
          const bytes = await response.body();
          run.scripts.push({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
        } catch (error) { run.scripts.push({ url: response.url(), status: response.status(), error: String(error) }); }
      })());
    });
    const check = (name, pass, detail) => {
      run.checks.push({ name, pass: Boolean(pass), detail });
      if (!pass) throw Error(name);
    };
    const read = () => page.evaluate(() => {
      const d = window.__CRUISE_DEBUG__, state = d.getState();
      const player = state.ships.find((ship) => ship.id === state.playerId);
      return {
        elapsed: state.elapsed, paused: state.paused, scene: d.getScene(),
        captureMode: document.documentElement.dataset.capture,
        player,
        targets: state.ships.filter((ship) => ship.id !== state.playerId).map((ship) => ({
          id: ship.id, kind: ship.kind, position: ship.position, damage: ship.damage,
          surrendered: ship.surrendered, faction: ship.faction,
        })),
        projectiles: state.projectiles.filter((shot) => shot.ownerId === state.playerId),
        queued: d.exportSave().projectiles.filter((slot) => slot.active && slot.state.ownerId === state.playerId && slot.pending)
          .map((slot) => ({ id: slot.state.id, pending: slot.pending })),
        hud: {
          crewLocation: document.querySelector('[data-ui="repair"]')?.textContent,
          special: document.querySelector('[data-ui="special-label"]')?.textContent,
          specialPhase: document.querySelector('[data-ui="special-meter"]')?.dataset.phase,
          batteries: Object.fromEntries(['port', 'starboard', 'bow'].map((side) => {
            const box = document.querySelector(`[data-ui="weapon-${side}"]`);
            return [side, { text: document.querySelector(`[data-ui="weapon-${side}-state"]`)?.textContent, ready: box?.dataset.ready, blocked: box?.dataset.blocked }];
          })),
        },
      };
    });
    const trace = (state) => {
      run.trace.push({ elapsed: state.elapsed, phase: state.player?.specialPhase ?? null, position: state.player?.position, speed: state.player?.speed, charge: state.player?.special });
      return state;
    };
    const step = async (frames = 1) => {
      await page.evaluate(async (frames) => {
        const d = window.__CRUISE_DEBUG__;
        if (!d.getState().paused) throw Error('Capture stepping requires an explicit paused simulation');
        for (let index = 0; index < frames; index++) d.step(1);
        await new Promise(requestAnimationFrame);
      }, frames);
      return trace(await read());
    };
    const phaseOrder = ['windup', 'active', 'recovery'];
    const reach = async (phase, minimumElapsed = 0, maxFrames = 420) => {
      let state = await read();
      for (let frame = 0; frame <= maxFrames; frame++) {
        const current = state.player?.specialPhase;
        if (phase === 'clear' ? !current : current?.phase === phase && current.elapsed >= minimumElapsed) return state;
        if (phase !== 'clear' && (!current || phaseOrder.indexOf(current.phase) > phaseOrder.indexOf(phase)))
          throw Error(`Missed ${phase} capture window: ${JSON.stringify(current)}`);
        state = await step();
      }
      throw Error(`Special did not reach ${phase} within ${maxFrames} fixed frames`);
    };
    const shot = async (label) => {
      const before = await read();
      check(`${label}: captured simulation is paused`, before.paused);
      const filename = `${job.kind}-${label}.png`;
      await page.screenshot({ path: resolve(output, filename), timeout: 45000 });
      const after = await read();
      check(`${label}: screenshot preserves exact phase and simulation time`,
        before.elapsed === after.elapsed && JSON.stringify(before.player.specialPhase) === JSON.stringify(after.player.specialPhase),
        { before: before.player.specialPhase, after: after.player.specialPhase });
      run.captures.push({ filename, label, state: before });
      await writeFile(resolve(output, `${job.kind}-${label}.json`), JSON.stringify(before, null, 2));
      return before;
    };
    // The only activation path is a real keyboard event. One fixed tick consumes the normal input,
    // then pausing prevents screenshot latency from skipping a short phase.
    const tapAndPause = async (keys) => {
      await page.evaluate(() => window.__CRUISE_DEBUG__.setPaused(false));
      for (const key of keys) await page.keyboard.down(key);
      await page.evaluate(() => {
        const d = window.__CRUISE_DEBUG__;
        d.step(1);
        d.setPaused(true);
      });
      for (const key of keys) await page.keyboard.up(key);
      return trace(await read());
    };
    try {
      const url = new URL(base);
      url.searchParams.delete('capture');
      url.searchParams.delete('scenario');
      url.searchParams.set('hud', '1');
      url.searchParams.set('scene', job.scene);
      url.searchParams.set('seed', `specials-${job.name}-A`);
      run.url = url.href;
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready, undefined, { timeout: 45000 });
      await page.locator(`[data-ship="${job.kind}"]`).click();
      const selectedState = await read();
      check('Real vessel selection matches the requested ship', selectedState.player?.kind === job.kind, selectedState.player?.kind);
      check('Fresh selected ship starts with full special charge', selectedState.player.special >= .999 && !selectedState.player.specialPhase, selectedState.player.special);
      await page.locator('[data-action="launch"]').click();
      await page.waitForFunction(() => !window.__CRUISE_DEBUG__.getState().paused);
      await page.evaluate((camera) => {
        const d = window.__CRUISE_DEBUG__;
        d.setPaused(true); d.setCamera(camera); d.step(1);
      }, job.camera);
      run.before = await shot('ready');
      check('Launch preserves selected vessel and full special charge', run.before.player.kind === job.kind && run.before.player.special >= .999 && !run.before.player.specialPhase, run.before.player);
      check('Ordinary scene entry retains launch UI without capture-mode bypass', run.before.captureMode !== 'true' && run.before.scene === job.scene, { capture: run.before.captureMode, scene: run.before.scene });
      const activated = await tapAndPause(['c']);
      check('Actual special key starts wind-up and consumes charge', activated.player.specialPhase?.phase === 'windup' && activated.player.special < .1, activated.player.specialPhase);
      await reach('windup', .25);
      const windup = await shot('windup');
      await reach('active', job.activeAt);
      const active = await shot('active');
      check('Wind-up transitions to active without changing special identity', windup.player.specialPhase.name === active.player.specialPhase.name && active.elapsed > windup.elapsed, { windup: windup.player.specialPhase, active: active.player.specialPhase });
      if (job.name === 'moby') {
        const wave = active.player.specialPhase.pressureWave;
        check('Moby exposes an active physical pressure front', wave && Number.isFinite(wave.radius) && wave.radius > 0 && wave.radius <= 135 && Array.isArray(wave.hitIds), wave);
        await reach('active', 1.45);
        const outer = await shot('wave-expanded');
        const laterWave = outer.player.specialPhase.pressureWave;
        check('Moby pressure front expands and preserves unique hit attribution',
          laterWave.radius > wave.radius && laterWave.radius <= 135 && new Set(laterWave.hitIds).size === laterWave.hitIds.length && wave.hitIds.every((id) => laterWave.hitIds.includes(id)),
          { earlier: wave, later: laterWave });
        run.pressureWaveObservations = { earlierTargets: active.targets, laterTargets: outer.targets, hitIds: laterWave.hitIds };
        const settlePausedCamera = async (camera) => {
          const before = await read();
          await page.evaluate(async (camera) => {
            const d = window.__CRUISE_DEBUG__;
            if (!d.getState().paused) throw Error('Wave comparison requires paused simulation');
            d.setCamera(camera);
            // Normal render RAF settles camera damping; no fixed step or simulation resume.
            for (let frame = 0; frame < 72; frame++) await new Promise(requestAnimationFrame);
          }, camera);
          const after = await read();
          check(`Moby ${camera} camera settles without advancing the paused wave`,
            before.paused && after.paused && before.elapsed === after.elapsed &&
            JSON.stringify(before.player.specialPhase) === JSON.stringify(after.player.specialPhase) &&
            JSON.stringify(before.player.position) === JSON.stringify(after.player.position),
            { camera, renderedFrames: 72, beforeElapsed: before.elapsed, afterElapsed: after.elapsed,
              beforePhase: before.player.specialPhase, afterPhase: after.player.specialPhase });
        };
        await settlePausedCamera('cinematic');
        const cinematic = await shot('wave-cinematic');
        run.pressureWaveViews = {
          overhead: { filename: `${job.kind}-wave-expanded.png`, elapsed: outer.elapsed, radius: laterWave.radius },
          cinematic: { filename: `${job.kind}-wave-cinematic.png`, elapsed: cinematic.elapsed, radius: cinematic.player.specialPhase.pressureWave.radius },
        };
        await settlePausedCamera('overhead');
      }
      if (job.name === 'polar') {
        check('Polar active crew is correctly reported inside', active.hud.crewLocation === 'CREW INSIDE', active.hud.crewLocation);
        check('Polar active batteries visibly read SUBMERGED', Object.values(active.hud.batteries).every((battery) => battery.text === 'SUBMERGED' && battery.ready === 'false'), active.hud.batteries);
        const blocked = await tapAndPause(['q', 'e', 'f']);
        check('Polar remains active while submerged weapon inputs are tested', blocked.player.specialPhase?.phase === 'active', blocked.player.specialPhase);
        check('Polar active dive blocks actual battery and bow inputs', blocked.projectiles.length === 0 && blocked.queued.length === 0 && Object.entries(blocked.player.weapons).filter(([key]) => key.endsWith('Cooldown')).every(([, value]) => value === 0), { weapons: blocked.player.weapons, projectiles: blocked.projectiles, queued: blocked.queued });
      }
      await reach('recovery', job.name === 'polar' ? .55 : .3);
      const recovery = await shot('recovery');
      check('Active transitions to recovery without changing special identity', recovery.player.specialPhase.name === active.player.specialPhase.name && recovery.elapsed > active.elapsed, recovery.player.specialPhase);
      if (job.name === 'polar') {
        check('Polar recovering crew remains reported inside', recovery.hud.crewLocation === 'CREW INSIDE', recovery.hud.crewLocation);
        check('Polar recovering batteries visibly read SURFACING', Object.values(recovery.hud.batteries).every((battery) => battery.text === 'SURFACING' && battery.ready === 'false'), recovery.hud.batteries);
        const blocked = await tapAndPause(['f']);
        check('Polar early recovery still blocks its bow weapon', blocked.player.specialPhase?.phase === 'recovery' && blocked.player.specialPhase.elapsed < blocked.player.specialPhase.duration * .7 && blocked.projectiles.length === 0 && blocked.queued.length === 0 && blocked.player.weapons.bowCooldown === 0, { phase: blocked.player.specialPhase, bowCooldown: blocked.player.weapons.bowCooldown, projectiles: blocked.projectiles });
        let surfacing = await read();
        const phase = surfacing.player.specialPhase;
        const recoveryStartedAt = surfacing.elapsed - phase.elapsed;
        const maximumFrames = Math.ceil((phase.duration - phase.elapsed) * 60) + 120;
        let frames = 0, heldFrames = 0;
        while (surfacing.player.specialPhase && frames < maximumFrames) {
          const current = surfacing.player.specialPhase;
          check('Polar remains in recovery until physical surface clearance', current.phase === 'recovery', current);
          if (current.elapsed >= current.duration) {
            if (heldFrames === 0) await shot('surfacing');
            heldFrames++;
            check('Timed recovery hold is visibly SURFACING, never READY', surfacing.hud.special === 'SURFACING' && Object.values(surfacing.hud.batteries).every((battery) => battery.text === 'SURFACING' && battery.ready === 'false'), surfacing.hud);
          }
          surfacing = await step(); frames++;
        }
        check('Polar physically resurfaces within 120 extra fixed ticks', !surfacing.player.specialPhase && heldFrames <= 120, { frames, heldFrames, phase: surfacing.player.specialPhase });
        run.surfacing = { nominalRecoverySeconds: phase.duration, heldFrames, framesAfterEarlyRecoveryCheck: frames, simulatedRecoverySeconds: surfacing.elapsed - recoveryStartedAt, elapsedAtSurface: surfacing.elapsed };
      } else {
        await reach('clear');
      }
      run.after = await shot(job.name === 'polar' ? 'surfaced' : 'recovered');
      check('Recovery completes with charge below readiness and no stuck phase', !run.after.player.specialPhase && run.after.player.special < .999 && run.after.player.kind === job.kind, { phase: run.after.player.specialPhase, charge: run.after.player.special });
      if (job.name === 'polar') {
        check('Polar bow reports READY after physical recovery completes', run.after.hud.batteries.bow.text === 'READY' && run.after.hud.batteries.bow.ready === 'true', run.after.hud.batteries.bow);
        const fired = await tapAndPause(['f']);
        check('Polar bow weapon becomes usable after recovery', fired.player.weapons.bowCooldown > 0 && fired.projectiles.length + fired.queued.length > 0, { weapons: fired.player.weapons, projectiles: fired.projectiles, queued: fired.queued });
      }
      const transitions = run.trace.map((entry) => entry.phase?.phase ?? 'clear').filter((phase, index, list) => index === 0 || phase !== list[index - 1]);
      check('Observed phase sequence is windup → active → recovery → clear', JSON.stringify(transitions) === JSON.stringify(['windup', 'active', 'recovery', 'clear']), transitions);
      check('No page/console errors or dialogs', run.errors.length === 0 && run.dialogs.length === 0, { errors: run.errors, dialogs: run.dialogs });
      run.passed = true;
    } catch (error) {
      run.passed = false;
      run.failure = String(error);
      process.exitCode = 1;
      try { await page.screenshot({ path: resolve(output, `${job.kind}-failure.png`), timeout: 15000 }); } catch { /* Keep the original failure. */ }
    } finally {
      await Promise.allSettled(scriptReads);
      await context.close();
      await writeFile(resolve(output, `${job.kind}-receipt.json`), JSON.stringify(run, null, 2));
      console.log(JSON.stringify({ special: job.name, passed: run.passed, checks: run.checks.length, captures: run.captures.length, failure: run.failure }));
    }
  }
} finally {
  if (browser) await browser.close();
  receipt.finishedAt = new Date().toISOString();
  receipt.passed = receipt.runs.length === selected.length && receipt.runs.every((run) => run.passed);
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
