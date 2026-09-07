import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const out = resolve(process.env.CRUISE_FULL_VOYAGE_DIR ?? 'output/overhaul-gauntlet/full-voyage-browser');
const url = new URL(process.env.CRUISE_URL ?? 'http://127.0.0.1:4173');
url.searchParams.set('seed', 'full-voyage-02');
url.searchParams.delete('capture');
url.searchParams.delete('scene');
const receipt = {
  method: 'Real launch, ship, contract, build, crew, route, salvage and reward UI. Public debug action/step only for accelerated legal helm/fire/repair/special. Aim enters through ordinary keyboard/pointer listeners; no mutable state, fixtures or save injection. Not a performance benchmark.',
  policy: { seed: 'full-voyage-02', ship: 'oro-jackson', build: 'guardian', contract: 'lost-cargo', routes: 'measured', crew: 'repair', reward: 'supplies', decisionFrames: 12, maxFramesPerLeg: 36000, maxWallSecondsPerLeg: 180, source: 'output/overhaul-gauntlet/full-voyage-probe.test.ts', note: 'Same steering, range, velocity-lead and repair formulas as successful Node probe, sampled every 12 fixed steps to bound render cost. Normal RAF ticks also continue; browser result is independently checked.' },
  url: url.href, startedAt: new Date().toISOString(), legs: [], screenshots: [], checks: [], errors: [], scripts: [],
};
if (process.argv.includes('--dry-run')) { console.log(JSON.stringify({ out, ...receipt }, null, 2)); process.exit(0); }
await mkdir(out, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: false });
  receipt.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => receipt.errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') receipt.errors.push({ type: 'console', message: message.text() }); });
  page.on('response', async response => {
    if (response.request().resourceType() !== 'script') return;
    try { const bytes = await response.body(); receipt.scripts.push({ url: response.url(), status: response.status(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    catch (error) { receipt.scripts.push({ url: response.url(), status: response.status(), error: String(error) }); }
  });
  const check = (name, pass, detail) => { receipt.checks.push({ name, pass, detail }); if (!pass) throw new Error(`${name}: ${JSON.stringify(detail)}`); };
  const state = () => page.evaluate(() => window.__CRUISE_DEBUG__.getState());
  const shot = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const filename = `${name}.png`; await page.screenshot({ path: resolve(out, filename) }); receipt.screenshots.push(filename);
  };
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready);
  await page.locator('[data-ship="oro-jackson"]').click();
  await page.waitForFunction(() => window.__CRUISE_DEBUG__.getState().ships.find(ship => ship.isPlayer)?.kind === 'oro-jackson');
  await shot('00-selected-vessel');
  await page.locator('[data-action="launch"]').click();
  await page.locator('[data-contract="lost-cargo"]').click();
  await page.locator('[data-build="guardian"]').click();
  await page.locator('[data-voyage="start"]').click();
  for (let leg = 1; leg <= 3; leg++) {
    await page.locator(`[data-route="leg-${leg}-sheltered"]`).waitFor({ state: 'visible' });
    await shot(`leg-${leg}-route`);
    await page.locator(`[data-route="leg-${leg}-sheltered"]`).click();
    await page.locator('.voyage-panel').waitFor({ state: 'hidden' });
    await page.locator('[data-action="crew-cycle"]').click();
    await page.locator('[data-quick-crew="repair"]').click();
    await page.locator('#crew-orders-popover').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => { const s = window.__CRUISE_DEBUG__.getState(); return !s.paused && s.ships.find(ship => ship.isPlayer).crewPreset === 'repair'; });
    const run = await page.evaluate(async policy => {
      const d = window.__CRUISE_DEBUG__, canvas = document.querySelector('canvas');
      const started = performance.now(), samples = [], actions = {}, held = new Map();
      let aimSide, aimLead = 0, fixedFrames = 0;
      const command = (action, pressed) => {
        if (held.get(action) === pressed) return;
        held.set(action, pressed); d.action(action, pressed);
        const key = `${action}:${pressed ? 'down' : 'up'}`; actions[key] = (actions[key] ?? 0) + 1;
      };
      const tap = action => { command(action, true); command(action, false); };
      const key = (code, pressed) => window.dispatchEvent(new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code, key: code === 'KeyZ' ? 'z' : 'v', bubbles: true, cancelable: true }));
      const aim = (side, lead) => {
        if (side !== aimSide) {
          if (aimSide) key(aimSide === 'port' ? 'KeyZ' : 'KeyV', false);
          aimLead = 0; aimSide = side;
          if (side) key(side === 'port' ? 'KeyZ' : 'KeyV', true);
        }
        const wanted = Math.max(-.28, Math.min(.28, lead));
        if (side && Math.abs(wanted - aimLead) > .00001) {
          // Pointer movement follows the same public input listener as mouse aim;
          // Keyboard side selection keeps it within the normal input gate.
          const movementX = Math.round((wanted - aimLead) / .0015);
          canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', movementX, bubbles: true }));
          aimLead = Math.max(-.28, Math.min(.28, aimLead + movementX * .0015)); actions.aimPointer = (actions.aimPointer ?? 0) + 1;
        }
      };
      const wrap = n => Math.atan2(Math.sin(n), Math.cos(n));
      const helm = (p, desired, throttle) => {
        const error = wrap(desired - p.heading);
        command('steer-left', error > .03); command('steer-right', error < -.03);
        command('throttle-up', p.throttle < throttle - .025); command('throttle-down', p.throttle > throttle + .025);
      };
      const sailTo = (p, point, throttle) => {
        const bearing = Math.atan2(-(point.x - p.position.x), -(point.z - p.position.z));
        helm(p, bearing, Math.abs(wrap(bearing - p.heading)) > 1 ? .2 : throttle);
      };
      try {
        while (fixedFrames < policy.maxFramesPerLeg && performance.now() - started < policy.maxWallSecondsPerLeg * 1000) {
          const s = d.getState(), e = s.voyage.encounter, p = s.ships.find(ship => ship.isPlayer);
          if (s.voyage.phase !== 'encounter' || e.completed) break;
          if (s.paused) throw new Error('A blocking UI paused normal player input');
          if (e.kind === 'storm') { sailTo(p, { x: 0, z: -700 }, .8); command('repair', p.damage.hull > .05); }
          else if (e.kind === 'salvage') {
            const distance = Math.hypot(p.position.x - e.waypoint.x, p.position.z - e.waypoint.z);
            if (distance < 60) helm(p, p.heading, 0); else sailTo(p, e.waypoint, .55);
            command('repair', p.damage.hull > .05);
          } else {
            const target = s.ships.filter(ship => e.targetIds.includes(ship.id) && !ship.surrendered).sort((a, b) => Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) - Math.hypot(b.position.x - p.position.x, b.position.z - p.position.z))[0];
            const escort = s.ships.find(ship => ship.id === e.escortId);
            if (!target || escort && Math.hypot(escort.position.x - p.position.x, escort.position.z - p.position.z) > 205) {
              if (escort) sailTo(p, escort.position, .8); else helm(p, p.heading, .2);
              command('repair', true);
            } else {
              const dx = target.position.x - p.position.x, dz = target.position.z - p.position.z, distance = Math.hypot(dx, dz);
              const bearing = Math.atan2(-dx, -dz);
              helm(p, bearing + (distance < 130 ? Math.PI * .48 : .1), distance > 140 ? .8 : distance < 65 ? .15 : .4);
              // Oro Jackson canonical beam 29m and projectile speed 78m/s.
              const flight = Math.max(.1, (distance - 29 * .48) / 78);
              const leadX = dx - Math.sin(target.heading) * target.speed * flight + Math.sin(p.heading) * p.speed * .65 * flight;
              const leadZ = dz - Math.cos(target.heading) * target.speed * flight + Math.cos(p.heading) * p.speed * .65 * flight;
              const forward = leadX * -Math.sin(p.heading) + leadZ * -Math.cos(p.heading), sideward = leadX * Math.cos(p.heading) + leadZ * -Math.sin(p.heading);
              const side = sideward < 0 ? 'port' : 'starboard', lead = Math.atan2(forward, Math.abs(sideward));
              aim(side, lead);
              const cooldown = p.weapons[side === 'port' ? 'portCooldown' : 'starboardCooldown'];
              const fire = distance < 150 && Math.abs(lead) < .29 && cooldown <= 0;
              command('repair', !fire && p.damage.hull > .08 && cooldown > .3); command('brace', false);
              // Let the ordinary RAF copy keyboard/pointer aim into simulation
              // before the volley is sampled. No direct aim/state mutation.
              await new Promise(requestAnimationFrame);
              if (fire) tap(`fire-${side}`);
              if (distance < 138 && forward > Math.abs(sideward) * 1.5 && p.weapons.bowCooldown <= 0) { command('repair', false); tap('fire-bow'); }
              if (distance < 110 && p.special >= .999 && !p.specialPhase) tap('special');
            }
          }
          d.step(policy.decisionFrames); fixedFrames += policy.decisionFrames;
          if (fixedFrames % 360 === 0) {
            const after = d.getState(), player = after.ships.find(ship => ship.isPlayer);
            samples.push({ elapsed: after.voyage.encounter.elapsed, progress: after.voyage.encounter.progress, position: player.position, heading: player.heading, speed: player.speed, hullDamage: player.damage.hull, aim: d.getAim?.() });
          }
          await new Promise(requestAnimationFrame);
        }
      } finally {
        for (const [action, pressed] of held) if (pressed) d.action(action, false);
        if (aimSide) key(aimSide === 'port' ? 'KeyZ' : 'KeyV', false);
      }
      const final = d.getState();
      return { fixedFrames, wallSeconds: (performance.now() - started) / 1000, phase: final.voyage.phase, completed: final.voyage.encounter.completed, encounter: final.voyage.encounter, ships: final.ships, actions, samples };
    }, receipt.policy);
    receipt.legs.push(run);
    check(`Leg ${leg} completed through legal commands`, run.phase === 'encounter' && run.completed, { phase: run.phase, encounter: run.encounter });
    await shot(`leg-${leg}-secured`);
    const resolveButton = page.locator('[data-resolve="salvage"]');
    if (await resolveButton.isVisible()) {
      const before = await state(); await resolveButton.click();
      await page.waitForFunction(() => window.__CRUISE_DEBUG__.getState().ships.some(ship => ship.finish?.state === 'salvaged' || ship.finish?.state === 'sinking'));
      run.salvage = { beforeCoins: before.voyage.unbankedCoins, after: (await state()).voyage.unbankedCoins };
      check(`Leg ${leg} salvage credited once`, run.salvage.after === run.salvage.beforeCoins + 90, run.salvage);
      await shot(`leg-${leg}-salvaged`);
    }
    await page.locator('[data-action="collect"]').click();
    await page.locator('[data-reward="supplies"]').waitFor({ state: 'visible' });
    await shot(`leg-${leg}-reward`);
    run.beforeReward = await state();
    await page.locator('[data-reward="supplies"]').click();
  }
  await page.locator('[data-voyage="harbor"]').waitFor({ state: 'visible' });
  receipt.final = await state();
  const { voyage, progression } = receipt.final;
  const beforeFinal = receipt.legs.at(-1).beforeReward;
  check('Full contract is completed, not extracted', voyage.phase === 'complete' && voyage.result.outcome === 'completed' && progression.completedVoyages === 1, { voyage, progression });
  check('Exact third-leg payout plus contract bonus', voyage.result.coins === beforeFinal.voyage.unbankedCoins + 360 && progression.bankedCoins === beforeFinal.progression.bankedCoins + voyage.result.coins, { payout: voyage.result, bank: progression.bankedCoins, before: beforeFinal.voyage.unbankedCoins });
  check('Paid ledger has one entry for this voyage', progression.paidVoyageIds.length === 1 && progression.paidVoyageIds[0] === voyage.id, progression.paidVoyageIds);
  await shot('04-contract-completed');
  await page.waitForFunction(() => {
    try { const saved = JSON.parse(localStorage.getItem('cruise.voyage.v1')); return saved?.state?.voyage?.result?.outcome === 'completed'; } catch { return false; }
  });
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('cruise.voyage.v1')));
  await writeFile(resolve(out, 'completed-save.json'), JSON.stringify(persisted, null, 2));
  check('Browser storage contains final payout and ledger', JSON.stringify(persisted.state.progression) === JSON.stringify(progression) && JSON.stringify(persisted.state.voyage) === JSON.stringify(voyage), { version: persisted.version, result: persisted.state.voyage.result });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready);
  receipt.restored = await state();
  check('Reload restores exact completed voyage and payout ledger', JSON.stringify(receipt.restored.voyage) === JSON.stringify(voyage) && JSON.stringify(receipt.restored.progression) === JSON.stringify(progression), { phase: receipt.restored.voyage.phase, bank: receipt.restored.progression.bankedCoins, paid: receipt.restored.progression.paidVoyageIds });
  await shot('05-completed-save-restored');
  check('No browser console or page errors', receipt.errors.length === 0, receipt.errors);
} catch (error) {
  receipt.errors.push({ type: 'harness', message: String(error) }); process.exitCode = 1;
  if (browser) {
    try { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: resolve(out, 'failure.png') }); receipt.failureState = await page.evaluate(() => window.__CRUISE_DEBUG__?.getState()); } } catch { /* Preserve original failure. */ }
  }
} finally {
  if (browser) await browser.close();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ output: out, legs: receipt.legs.map(leg => ({ kind: leg.encounter.kind, completed: leg.completed, elapsed: leg.encounter.elapsed })), final: receipt.final?.voyage?.result, checks: receipt.checks, errors: receipt.errors }));
}
