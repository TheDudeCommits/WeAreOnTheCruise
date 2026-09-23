#!/usr/bin/env node
/** Ordinary gameplay only: real UI/keyboard/CDP touch input, public debug reads, no stepping or state injection. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const base = process.env.CRUISE_URL ?? "http://127.0.0.1:4173";
const out = resolve(
  process.env.CRUISE_AIM_DIR ?? "output/overhaul-gauntlet/aim",
);
const requested = process.argv.slice(2);
const sizes = {
  desktop: { width: 1600, height: 900 },
  landscape: { width: 844, height: 390 },
  portrait: { width: 390, height: 844 },
};
const receipt = {
  method:
    "Real launch UI, ordinary sunny-broadside simulation, trusted keyboard/mouse/CDP touch; no capture mode, stepping, state edits, or private scene access. Snapshot FPS is not a sustained performance measurement.",
  startedAt: new Date().toISOString(),
  base,
  runs: [],
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: false });
try {
  for (const [name, viewport] of Object.entries(sizes).filter(
    ([name]) => !requested.length || requested.includes(name),
  )) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      hasTouch: name !== "desktop",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(45000);
    const run = {
      name,
      viewport,
      checks: [],
      captures: [],
      errors: [],
      dialogs: [],
      scripts: [],
      observations: [],
    };
    receipt.runs.push(run);
    const check = (title, pass, detail) => {
      run.checks.push({ title, pass, detail });
      if (pass === false) throw new Error(title);
    };
    const gap = (title, detail) => {
      run.checks.push({ title, pass: null, detail });
    };
    page.on("pageerror", (error) => run.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") run.errors.push(message.text());
    });
    page.on("dialog", async (dialog) => {
      run.dialogs.push({ type: dialog.type(), message: dialog.message() });
      await dialog.dismiss();
    });
    page.on("response", async (response) => {
      if (response.request().resourceType() === "script") {
        try {
          run.scripts.push({
            url: response.url(),
            sha256: createHash("sha256")
              .update(await response.body())
              .digest("hex"),
          });
        } catch {
          run.scripts.push({ url: response.url() });
        }
      }
    });
    const read = () =>
      page.evaluate(() => {
        const debug = window.__CRUISE_DEBUG__,
          state = debug.getState(),
          player = state.ships.find((ship) => ship.id === state.playerId);
        const aim = document.querySelector('[data-ui="aim"]'),
          tag = document.querySelector('[data-ui="target"]');
        const publicAim =
          typeof debug.getAim === "function" ? debug.getAim() : undefined;
        const locator=document.querySelector('[data-aim-target-locator]');
        const rect=locator?.getBoundingClientRect();
        return {
          at: new Date().toISOString(),
          scene: debug.getScene(),
          capture: document.documentElement.dataset.capture,
          elapsed: state.elapsed,
          paused: state.paused,
          player,
          ships: state.ships,
          projectiles: state.projectiles.filter(
            (shot) => shot.ownerId === state.playerId,
          ),
          metrics: debug.getMetrics(),
          aim: publicAim,
          locator: locator?{targetId:locator.dataset.targetId,text:locator.textContent,visible:getComputedStyle(locator).display!=='none',insideViewport:rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight,offscreen:locator.dataset.offscreen}:undefined,
          hud: {
            aimVisible: Boolean(
              aim && !aim.hidden && getComputedStyle(aim).display !== "none",
            ),
            aimSide: document.querySelector('[data-ui="aim-side"]')
              ?.textContent,
            solution: document.querySelector('[data-ui="aim-solution"]')
              ?.textContent,
            range: document.querySelector('[data-ui="aim-range"]')?.textContent,
            aimTargetId: aim?.dataset.targetId,
            targetId: tag?.dataset.targetId,
            targetName: document.querySelector('[data-ui="target-name"]')
              ?.textContent,
            targetVisible: Boolean(tag && !tag.hidden),
          },
          queuedShots:
            debug
              .exportSave?.()
              .projectiles?.filter(
                (slot) =>
                  slot.active &&
                  slot.state?.ownerId === state.playerId &&
                  slot.pending,
              )
              .map((slot) => ({ id: slot.state.id, ...slot.pending })) ?? [],
          loadedScripts: [...document.scripts].map((script) => script.src),
        };
      });
    const settle = (frames = 12) =>
      page.evaluate(async (frames) => {
        for (let index = 0; index < frames; index++)
          await new Promise(requestAnimationFrame);
      }, frames);
    const snapshot = async (label) => {
      await settle(3);
      const before = await read();
      const path = resolve(out, `${name}-${label}.png`);
      await page.screenshot({ path, timeout: 45000 });
      const after = await read();
      run.captures.push({ label, path, before, after });
      await writeFile(
        resolve(out, `${name}-${label}.json`),
        JSON.stringify({ before, after }, null, 2),
      );
      return before;
    };
    const waitPlaying = () =>
      page.waitForFunction(() => !window.__CRUISE_DEBUG__.getState().paused);
    const waitAim = (side) =>
      page.waitForFunction((side) => {
        const el = document.querySelector('[data-ui="aim"]');
        return (
          el &&
          !el.hidden &&
          document
            .querySelector('[data-ui="aim-side"]')
            ?.textContent.startsWith(side.toUpperCase())
        );
      }, side);
    const targetCheck = (state, label) => {
      check(`${label}: selected target locator remains visible inside viewport`,Boolean(state.locator?.visible&&state.locator.insideViewport&&state.locator.targetId===state.hud.targetId),state.locator);
      check(
        `${label}: target tag and aim readout agree`,
        state.hud.targetId === state.hud.aimTargetId,
        { tag: state.hud.targetId, aim: state.hud.aimTargetId },
      );
      const target = state.ships.find((ship) => ship.id === state.hud.targetId);
      check(
        `${label}: displayed target exists and its name matches`,
        Boolean(target && target.name === state.hud.targetName),
        { id: state.hud.targetId, name: state.hud.targetName },
      );
      if (state.aim && "markerTargetId" in state.aim)
        check(
          `${label}: world marker identifies the same target`,
          state.aim.markerTargetId === state.hud.targetId &&
            state.aim.targetId === state.hud.targetId,
          state.aim,
        );
      else
        gap(
          `${label}: world marker identity requires public debug evidence`,
          "getAim() with markerTargetId/targetId is unavailable; screenshot supplied, no private scene traversal used.",
        );
    };
    const fire = async (side, key) => {
      await page.waitForFunction(
        (side) => {
          const s = window.__CRUISE_DEBUG__.getState(),
            p = s.ships.find((p) => p.id === s.playerId);
          return p.weapons[side + "Cooldown"] <= 0;
        },
        side,
        { timeout: 20000 },
      );
      const before = await read(),
        ids = new Set(before.projectiles.map((shot) => shot.id));
      await page.keyboard.down(key);
      try {
        await page.waitForFunction((side) => {
          const s = window.__CRUISE_DEBUG__.getState(),
            p = s.ships.find((p) => p.id === s.playerId);
          return p.weapons[side + "Cooldown"] > 0;
        }, side);
        const launched = await read();
        run.observations.push({
          kind: "keyboard-volley",
          side,
          before,
          launched,
        });
        check(
          `${side}: real firing begins reload`,
          launched.player.weapons[side + "Cooldown"] > 0,
          launched.player.weapons,
        );
        const pending = launched.queuedShots.filter(
          (shot) => shot.side === side,
        );
        if (pending.length)
          check(
            `${side}: actual queued volley preserves current aim lead`,
            pending.every(
              (shot) =>
                Number.isFinite(shot.lead) &&
                Math.abs(shot.lead - launched.aim.adjustment) < 0.00001,
            ),
            { pending, aim: launched.aim },
          );
        await page.waitForFunction(
          (ids) => {
            const s = window.__CRUISE_DEBUG__.getState();
            return s.projectiles.some(
              (shot) => shot.ownerId === s.playerId && !ids.includes(shot.id),
            );
          },
          [...ids],
        );
        const live = await read();
        const shots = live.projectiles.filter((shot) => !ids.has(shot.id));
        const sign = side === "port" ? -1 : 1;
        check(
          `${side}: projectiles travel out of the chosen battery`,
          shots.length > 0 &&
            shots.every(
              (shot) =>
                (shot.velocity.x * Math.cos(live.player.heading) -
                  shot.velocity.z * Math.sin(live.player.heading)) *
                  sign >
                0,
            ),
          shots,
        );
        await snapshot(`${side}-reload`);
      } finally {
        await page.keyboard.up(key);
      }
    };
    const launchScenario = async () => {
      await page.goto(
        `${base.replace(/\/$/, "")}/?scene=sunny-broadside&seed=aim-gauntlet-A`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForFunction(() => window.__CRUISE_DEBUG__?.ready, null, {
        timeout: 45000,
      });
      await page.locator('[data-ship="thousand-sunny"]').click();
      await page.locator('[data-action="launch"]').click();
      await page.locator('[data-ui="intro"]').waitFor({ state: "hidden" });
      if (await page.locator(".voyage-panel").isVisible())
        await page
          .locator('.voyage-panel [data-voyage="close"]')
          .first()
          .click();
      await waitPlaying();
      await settle(12);
    };
    let touchSession;
    try {
      await launchScenario();
      const initial = await read();
      check(
        "Ordinary sunny-broadside scenario is playing",
        initial.scene === "sunny-broadside" &&
          initial.capture === "false" &&
          !initial.paused,
        initial,
      );
      check(
        "Build exposes read-only actual aim and marker evidence",
        Boolean(
          initial.aim &&
            "markerTargetId" in initial.aim &&
            "adjustment" in initial.aim,
        ),
        initial.aim,
      );
      if (name === "desktop") {
        await page.mouse.move(520, 420);
        await page.keyboard.down("z");
        await waitAim("port");
        await settle();
        targetCheck(await snapshot("port-aim"), "port");
        const beforePointer = await read();
        await page.mouse.move(580, 420, { steps: 6 });
        await settle(2);
        const afterPointer = await read();
        run.observations.push({
          kind: "pointer-lead",
          before: beforePointer,
          after: afterPointer,
        });
        check(
          "Moving pointer across canvas adjusts actual held aim lead",
          afterPointer.aim.adjustment > beforePointer.aim.adjustment,
          { before: beforePointer.aim, after: afterPointer.aim },
        );
        for (let index = 0; index < 4; index++) await page.keyboard.press(".");
        await settle(2);
        const lead = await read();
        run.observations.push({ kind: "keyboard-lead", state: lead });
        if (lead.aim)
          check(
            "Period key changes actual aim lead",
            lead.aim.adjustment > 0,
            lead.aim,
          );
        await fire("port", "q");
        await page.keyboard.up("z");
        await settle(3);
        await page.keyboard.down("v");
        await waitAim("starboard");
        await settle();
        targetCheck(await snapshot("starboard-aim"), "starboard");
        await fire("starboard", "e");
        await page.keyboard.down("w");
        await settle(3);
        await page.locator('[data-action="menu"]').click();
        await page.waitForFunction(
          () => window.__CRUISE_DEBUG__.getState().paused,
        );
        await page.keyboard.up("v");
        await page.keyboard.up("w");
      } else {
        touchSession = await context.newCDPSession(page);
        const point = async (selector, id) => {
          const box = await page.locator(selector).boundingBox();
          if (!box) throw new Error("Missing touch control " + selector);
          check(
            "Touch control is in viewport",
            box.x >= 0 &&
              box.y >= 0 &&
              box.x + box.width <= viewport.width + 1 &&
              box.y + box.height <= viewport.height + 1,
            { selector, box },
          );
          return {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            id,
            radiusX: 4,
            radiusY: 4,
            force: 1,
          };
        };
        for (const side of ["port", "starboard"]) {
          if (side === "starboard") {
            await launchScenario();
            run.observations.push({
              kind: "ordinary-scenario-relaunch",
              reason:
                "Isolate second touch battery from previous battle damage",
              state: await read(),
            });
          }
          const aimPoint = await point(`[data-touch-aim="${side}"]`, 1);
          await touchSession.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [aimPoint],
          });
          await waitAim(side);
          await settle();
          targetCheck(await snapshot(`${side}-touch-aim`), `${side} touch`);
          await fire(side, side === "port" ? "q" : "e");
          await page.waitForFunction(
            (side) => {
              const s = window.__CRUISE_DEBUG__.getState(),
                p = s.ships.find((p) => p.id === s.playerId);
              return p.weapons[side + "Cooldown"] <= 0;
            },
            side,
            { timeout: 20000 },
          );
          const beforeTouchFire = await read();
          run.observations.push({
            kind: "before-multitouch-fire",
            side,
            state: beforeTouchFire,
          });
          check(
            `${side}: test ship can still fire`,
            !beforeTouchFire.player.surrendered &&
              beforeTouchFire.player.damage.hull < 1 &&
              beforeTouchFire.player.damage.weapons < 0.92,
            beforeTouchFire.player,
          );
          const firePoint = await point(
            `[data-touch-action="fire-${side}"], [data-touch="fire-${side}"]`,
            2,
          );
          await touchSession.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [aimPoint, firePoint],
          });
          await page.waitForFunction((side) => {
            const s = window.__CRUISE_DEBUG__.getState(),
              p = s.ships.find((p) => p.id === s.playerId);
            return p.weapons[side + "Cooldown"] > 0;
          }, side);
          check(
            `${side}: simultaneous touch aim and touch fire remain active`,
            (await read()).hud.aimVisible,
            await read(),
          );
          await touchSession.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [aimPoint],
          });
          await settle(2);
          check(
            `${side}: releasing only firing finger preserves held aim`,
            (await read()).aim?.side === side,
            await read(),
          );
          await snapshot(`${side}-multitouch-reload`);
          await touchSession.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await settle(3);
          check(
            `${side}: ending touch aim clears readout`,
            !(await read()).hud.aimVisible,
          );
        }
        const held = await point('[data-touch-aim="port"]', 1);
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [held],
        });
        await waitAim("port");
        await page.locator('[data-action="menu"]').click();
        await page.waitForFunction(
          () => window.__CRUISE_DEBUG__.getState().paused,
        );
        await touchSession.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      }
      await settle(4);
      const paused = await snapshot("paused-from-aim");
      await page.waitForTimeout(350);
      const stable = await read();
      check(
        "Pause freezes simulation",
        Math.abs(stable.elapsed - paused.elapsed) < 0.001,
        { before: paused.elapsed, after: stable.elapsed },
      );
      check(
        "Pause clears aiming",
        !stable.hud.aimVisible && (!stable.aim || !stable.aim.side),
        stable,
      );
      await page.locator('[data-action="resume"]').click();
      await waitPlaying();
      const resumed = await read();
      await settle(18);
      const after = await snapshot("resumed");
      check(
        "Resume advances simulation with released inputs",
        after.elapsed > resumed.elapsed && !after.hud.aimVisible,
        { resumed, after },
      );
      if (name === "desktop")
        check(
          "Released throttle does not remain held after pause",
          Math.abs(after.player.throttle - resumed.player.throttle) < 0.002,
          { before: resumed.player.throttle, after: after.player.throttle },
        );
      check("No dialogs", run.dialogs.length === 0, run.dialogs);
      check(
        "No JavaScript or shader errors",
        run.errors.length === 0,
        run.errors,
      );
    } catch (error) {
      run.errors.push(String(error));
      process.exitCode = 1;
      await snapshot("failure").catch((error) =>
        run.errors.push("Failure screenshot: " + String(error)),
      );
    } finally {
      if (touchSession)
        await touchSession
          .send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          })
          .catch(() => {});
      await context.close();
      run.finishedAt = new Date().toISOString();
      await writeFile(
        resolve(out, "receipt.json"),
        JSON.stringify(receipt, null, 2),
      );
      console.log(
        JSON.stringify({
          name,
          checks: run.checks.map(({ title, pass }) => ({ title, pass })),
          errors: run.errors,
        }),
      );
    }
  }
} finally {
  await browser.close();
  receipt.finishedAt = new Date().toISOString();
  receipt.passed =
    receipt.runs.length > 0 &&
    receipt.runs.every(
      (run) =>
        !run.errors.length && run.checks.every((check) => check.pass === true),
    );
  if (!receipt.passed) process.exitCode = 1;
  await writeFile(
    resolve(out, "receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
}
