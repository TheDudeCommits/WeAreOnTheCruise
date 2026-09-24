// Ocean evidence capture (OCEAN lab tooling). Needs the dev server: npx vite --port 4184 --strictPort
// Usage: node src/render/ocean/lab/capture-evidence.mjs [--only=lab|game|perf]
// Writes PNGs + perf.json to output/ovh-ocean/. Uses the installed Chrome (real GPU); the browser closes in finally.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const out = resolve(root, 'output/ovh-ocean');
mkdirSync(out, { recursive: true });
const base = process.env.OCEAN_URL ?? 'http://127.0.0.1:4184';
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const want = (k) => !only || only === k;

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const perf = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));

  // ───────────── Lab ─────────────
  const lab = async (query) => {
    await page.goto(`${base}/lab/ocean.html?fixed=1&clean=1&dpr=1&${query}`);
    await page.waitForFunction(() => window.__OCEAN_LAB__, null, { timeout: 30000 });
  };
  const adv = (s, snap = true) => page.evaluate(([x, y]) => window.__OCEAN_LAB__.advance(x, y), [s, snap]);
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  if (want('lab')) {
    for (const [name, q] of [
      ['lab-01-tactical-day', 'cam=tactical&hour=10'],
      ['lab-02-chase-day-island', 'cam=chase&hour=10'],
      ['lab-03-hero-bow-wave', 'cam=hero&hour=10'],
      ['lab-04-golden-hour', 'cam=chase&hour=17.6'],
      ['lab-05-night-biolum-moon', 'cam=chase&hour=22'],
      ['lab-06-storm', 'cam=chase&hour=15&weather=storm'],
      ['lab-07-fog', 'cam=chase&hour=10&weather=fog'],
      ['lab-08-debug-transient', 'cam=top&hour=10&debug=1'],
      ['lab-09-debug-persistent', 'cam=top&hour=10&debug=2'],
    ]) { await lab(q); await adv(8); await shot(name); }
    await lab('hour=10');
    await adv(0.2);
    await page.evaluate(() => window.__OCEAN_LAB__.view(300, 40, -250, 400, 0, -300));
    await adv(2.6, false); await shot('lab-10-shore-surf');
    await page.evaluate(() => window.__OCEAN_LAB__.view(150, 80, -30, 150, 0, -110));
    await adv(2, false); await shot('lab-11-whirlpool');
    await page.evaluate(() => window.__OCEAN_LAB__.view(-150, 70, -10, -150, 0, -120));
    await adv(0.9, false); await shot('lab-12-sinking-whirl');
    await page.evaluate(() => window.__OCEAN_LAB__.view(60, 120, 90, -30, 0, -20));
    await adv(4.5, false); await shot('lab-13-serpent-body');
    await lab('hour=10');
    await page.evaluate(() => {
      const L = window.__OCEAN_LAB__; L.set({ speed: 0.001 }); L.advance(0.3);
      const h = L.hero(); const fx = -Math.sin(h.heading), fz = -Math.cos(h.heading);
      window.__p = { x: h.x + fx * 150, z: h.z + fz * 150 };
      L.view(window.__p.x + 60, 70, window.__p.z + 80, window.__p.x, 0, window.__p.z);
      L.explode(window.__p.x, window.__p.z, 16); L.splash(window.__p.x + 38, window.__p.z + 8, false); L.splash(window.__p.x - 34, window.__p.z + 20, false);
    });
    for (const [t, n] of [[0.25, 'a'], [0.5, 'b'], [1.0, 'c'], [3.0, 'd']]) { await adv(t, false); await shot(`lab-14-splash-explosion-${n}`); }
  }

  // ───────────── Game ─────────────
  const game = async (query, setup, secs, drag = null, zoom = 0) => {
    await page.goto(`${base}/?hud=0&god=1&seed=ocean&${query}`);
    await page.waitForFunction(() => window.__CRUISE__?.ready, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    if (setup) await page.evaluate(setup);
    await page.mouse.move(800, 450);
    for (let i = 0; i < zoom; i++) await page.mouse.wheel(0, -100);
    if (drag) { await page.mouse.down({ button: 'right' }); await page.mouse.move(800 + drag[0], 450 + drag[1], { steps: 10 }); await page.mouse.up({ button: 'right' }); }
    await page.evaluate((s) => window.__CRUISE__.advance(s), secs);
    await page.waitForTimeout(300);
  };
  const sail = "const c=window.__CRUISE__; c.press('gear-up'); c.press('gear-up');";
  if (want('game')) {
    await game('run=sunlion:sunward-shallows', `${sail} c.debug.spawn('brig', 6); c.steer(0.25);`, 8); await shot('game-01-tactical-day');
    await game('run=sunlion:sunward-shallows', sail, 8, [628, -60], 9); await shot('game-02-bow-front');
    await game('run=sunlion:sunward-shallows', `${sail} c.debug.time(700); c.debug.spawn('brig', 5); c.steer(-0.2);`, 8); await shot('game-03-evening');
    await game('run=sunlion:stormwrack-reach', `${sail} c.debug.time(240); c.debug.spawn('brig', 4);`, 10); await shot('game-04-storm');
    await game('run=sunlion:the-gloam', `${sail} c.debug.spawn('brig', 4);`, 8); await shot('game-05-gloam-night-fog');
    await game('run=sunlion:sunward-shallows', `${sail} c.debug.spawn('brig', 20); c.steer(0.35);`, 12); await shot('game-06-twenty-brigs');
    try {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', resolve(root, 'docs/aaa-overhaul/targets/t1-hero-sailing.jpg'), '-i', `${out}/game-02-bow-front.png`,
        '-filter_complex', '[0:v]scale=-2:540[a];[1:v]scale=-2:540[b];[a][b]hstack=inputs=2', `${out}/compare-t1-vs-game-bow.png`]);
    } catch (e) { console.warn('ffmpeg compare failed', e.message); }
  }

  // ───────────── Perf ─────────────
  if (want('perf')) {
    for (const [dpr, quality] of [['1', 'high'], ['1.25', 'high'], ['1.5', 'high'], ['1.25', 'medium']]) {
      await page.goto(`${base}/lab/ocean.html?clean=1&dpr=${dpr}&quality=${quality}&cam=tactical&hour=10`);
      await page.waitForFunction(() => window.__OCEAN_LAB__, null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      perf[`lab dpr${dpr} ${quality}`] = await page.evaluate(() => window.__OCEAN_LAB__.bench(4));
    }
    // Contention calibration: an ALU-bound pass with a known cost (vec4 x 256 FMAs per pixel at 2000x1125).
    perf.calibration = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1125; document.body.append(canvas);
      const gl = canvas.getContext('webgl2', { antialias: false });
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const src = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
      const pr = gl.createProgram();
      gl.attachShader(pr, src(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }'));
      gl.attachShader(pr, src(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; out vec4 o; uniform float u; void main(){ vec4 a = vec4(gl_FragCoord.xy*0.001,u,1.); vec4 b = vec4(1.0001,0.9999,1.0002,0.9998); for(int i=0;i<256;i++){ a = a*b + vec4(0.0001);} o = a; }'));
      gl.linkProgram(pr); gl.useProgram(pr);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const qs = [];
      for (let f = 0; f < 90; f++) { await new Promise((r) => requestAnimationFrame(r)); const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); gl.uniform1f(gl.getUniformLocation(pr, 'u'), f); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      await new Promise((r) => setTimeout(r, 300));
      const ms = qs.filter((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)).map((q) => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((a, b) => a - b);
      const measured = ms[Math.floor(ms.length / 2)];
      const ideal = (2000 * 1125 * 1024) / 2.13e12 * 1000; // 1024 lane-FMAs/px at M4 peak (~2.13 T FMA/s)
      return { measuredMs: +measured.toFixed(3), idealMs: +ideal.toFixed(3), inflation: +(measured / ideal).toFixed(2) };
    });
    perf.loadAverage = execFileSync('uptime').toString().trim();
    writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 2));
    console.log(JSON.stringify(perf, null, 2));
  }
} finally {
  await browser.close();
}
