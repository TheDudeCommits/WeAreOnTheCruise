#!/usr/bin/env node
/**
 * Contact-sheet renderer for GLB review (ASSETS pipeline).
 *
 *   node scripts/assets/render-sheet.mjs --out output/ovh-assets/fleet.png [--cols 4] [--views side,34,top,front]
 *        [--size 360] [--bg #cfd8dc] file.glb[=label] ...
 *
 * Renders every GLB with plain three.js lighting (no toon pass) from the requested views and writes one PNG.
 * Each tile is annotated with the label, bounding box (X beam × Y height × Z length, metres), triangle count,
 * material count, and the Y range, so orientation (bow toward −Z), waterline (y = 0) and scale can be checked.
 * The side view looks from +X, so the bow (−Z) points to the right; the top view puts the bow at the top.
 * A blue line marks y = 0 (waterline / ground) and a red cone marks −Z in the top view.
 * Headless Chromium from the repo's Playwright; the browser always closes in `finally`.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = { out: 'output/ovh-assets/sheet.png', cols: 4, views: 'side,34,top', size: 340, bg: '#d9e2e6', files: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--cols') opt.cols = Number(args[++i]);
  else if (a === '--views') opt.views = args[++i];
  else if (a === '--size') opt.size = Number(args[++i]);
  else if (a === '--bg') opt.bg = args[++i];
  else opt.files.push(a);
}
if (!opt.files.length) { console.error('no GLB files given'); process.exit(1); }

const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.gltf': 'model/gltf+json' };
const models = opt.files.map((spec, i) => {
  const [file, label] = spec.split('=');
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`missing ${abs}`);
  return { url: `/f/${i}/${encodeURIComponent(path.basename(abs))}`, abs, label: label || path.basename(abs, path.extname(abs)) };
});

const page = `<!doctype html><html><head><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head>
<body style="margin:0;background:#222"><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const cfg = ${JSON.stringify({ models: models.map(({ url, label }) => ({ url, label })), views: opt.views.split(','), size: opt.size, cols: opt.cols, bg: opt.bg })};
const S = cfg.size, V = cfg.views.length, LH = 58;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(S, S); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const tileW = S * V, tileH = S + LH;
const cols = Math.min(cfg.cols, cfg.models.length), rows = Math.ceil(cfg.models.length / cols);
const sheet = document.createElement('canvas'); sheet.width = cols * tileW; sheet.height = rows * tileH;
const g = sheet.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
const report = [];
for (let m = 0; m < cfg.models.length; m++) {
  const spec = cfg.models[m];
  const scene = new THREE.Scene(); scene.background = new THREE.Color(cfg.bg);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6470, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(40, 80, 30); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6); fill.position.set(-40, 20, -30); scene.add(fill);
  let info = { label: spec.label, error: null };
  try {
    const gltf = await loader.loadAsync(spec.url);
    const root = gltf.scene; scene.add(root); root.updateMatrixWorld(true);
    let tris = 0; const mats = new Set(); let skinned = 0;
    root.traverse((o) => { if (o.isMesh) { const gm = o.geometry; tris += (gm.index ? gm.index.count : gm.attributes.position.count) / 3; (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => mats.add(x)); if (o.isSkinnedMesh) { skinned++; o.frustumCulled = false; } } });
    const box = new THREE.Box3().setFromObject(root, true); const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
    info = { label: spec.label, tris: Math.round(tris), materials: mats.size, size: size.toArray().map((v) => +v.toFixed(2)), min: box.min.toArray().map((v) => +v.toFixed(2)), max: box.max.toArray().map((v) => +v.toFixed(2)), clips: gltf.animations.map((a) => a.name), skinned };
    const R = Math.max(size.x, size.y, size.z) * 0.62 + 0.001;
    // waterline marker (y = 0) along Z and X
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1565c0 });
    const L = Math.max(size.x, size.z) * 0.75;
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -L), new THREE.Vector3(0, 0, L)]), lineMat));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-L, 0, 0), new THREE.Vector3(L, 0, 0)]), lineMat));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(R * 0.05, R * 0.14, 12), new THREE.MeshBasicMaterial({ color: 0xd32f2f }));
    cone.rotation.x = -Math.PI / 2; cone.position.set(0, box.max.y + R * 0.05, box.min.z - R * 0.08); cone.visible = false; scene.add(cone);
    for (let v = 0; v < V; v++) {
      const view = cfg.views[v];
      const cam = new THREE.PerspectiveCamera(30, 1, R * 0.05, R * 40);
      const d = R / Math.tan((30 * Math.PI) / 360) * 1.05;
      cone.visible = view === 'top';
      if (view === 'side') { cam.position.set(c.x + d, c.y, c.z); cam.up.set(0, 1, 0); }
      else if (view === 'front') { cam.position.set(c.x, c.y, c.z - d); cam.up.set(0, 1, 0); }
      else if (view === 'back') { cam.position.set(c.x, c.y, c.z + d); cam.up.set(0, 1, 0); }
      else if (view === 'top') { cam.position.set(c.x, c.y + d, c.z + 0.0001); cam.up.set(0, 0, -1); }
      else { cam.position.set(c.x + d * 0.62, c.y + d * 0.42, c.z - d * 0.66); cam.up.set(0, 1, 0); }
      cam.lookAt(c); cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      g.drawImage(renderer.domElement, (m % cols) * tileW + v * S, Math.floor(m / cols) * tileH);
    }
  } catch (e) { info.error = String(e && e.message || e); }
  report.push(info);
  const x = (m % cols) * tileW, y = Math.floor(m / cols) * tileH + S;
  g.fillStyle = '#000'; g.fillRect(x, y, tileW, LH);
  g.fillStyle = info.error ? '#ff8a80' : '#fff'; g.font = 'bold 17px Helvetica'; g.fillText(info.label, x + 8, y + 22);
  g.font = '14px Helvetica'; g.fillStyle = '#b0bec5';
  const line = info.error ? info.error.slice(0, 90) : 'X ' + info.size[0] + '  Y ' + info.size[1] + '  Z ' + info.size[2] + ' m   y ' + info.min[1] + '..' + info.max[1] + '   ' + info.tris + ' tris  ' + info.materials + ' mats' + (info.clips.length ? '  clips: ' + info.clips.join(',') : '');
  g.fillText(line, x + 8, y + 44);
}
window.__done = { png: sheet.toDataURL('image/png'), report };
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  if (u === '/' || u === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
  if (u.startsWith('/three/')) file = path.join(repo, 'node_modules', 'three', u.slice(7));
  else if (u.startsWith('/f/')) { const [, , idx, ...rest] = u.split('/'); const mdl = models[Number(idx)]; if (mdl) file = path.join(path.dirname(mdl.abs), rest.join('/')); }
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const p = await browser.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/`);
  await p.waitForFunction(() => window.__done, null, { timeout: 600000, polling: 500 });
  const done = await p.evaluate(() => window.__done);
  fs.mkdirSync(path.dirname(path.resolve(opt.out)), { recursive: true });
  fs.writeFileSync(opt.out, Buffer.from(done.png.split(',')[1], 'base64'));
  console.log(`wrote ${opt.out}` + (errors.length ? `  page errors: ${errors.join(' | ')}` : ''));
  for (const r of done.report) console.log(r.error ? `${r.label}: ERROR ${r.error}` : `${r.label}: size ${r.size.join(' x ')}  y ${r.min[1]}..${r.max[1]}  x ${r.min[0]}..${r.max[0]}  z ${r.min[2]}..${r.max[2]}  tris ${r.tris}  mats ${r.materials}${r.clips.length ? '  clips ' + r.clips.join(',') : ''}${r.skinned ? '  skinned ' + r.skinned : ''}`);
} finally {
  await browser.close();
  server.close();
}
