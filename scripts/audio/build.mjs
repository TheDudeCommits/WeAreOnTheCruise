#!/usr/bin/env node
/**
 * Audio asset pipeline (AUDIO-owned).
 *
 *   node scripts/audio/build.mjs [--only <cue|music key>] [--force] [--no-fetch]
 *
 * 1. Fetches every source in scripts/audio/recipe.mjs (Freesound HQ previews, OpenGameArt files, Kenney
 *    zips) into output/audio-cache/ (gitignored) and records each original's sha256.
 * 2. Renders every output file with ffmpeg: trim, layering, pitch, filters, fades, seamless loop crossfades.
 * 3. Loudness-normalizes (one-shots by max momentary loudness, beds/music by integrated loudness, true-peak
 *    ceiling with a gentle limiter only when needed) and encodes Ogg Opus.
 * 4. Writes public/audio/manifest.json, public/audio/CREDITS.md, src/audio/generated/cueIds.ts and a
 *    loudness report in output/ovh-audio/.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUES, MUSIC, SOURCES, TARGETS } from './recipe.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(ROOT, 'output/audio-cache');
const SRC_CACHE = join(CACHE, 'src');
const TMP = join(CACHE, 'tmp');
const OUT = join(ROOT, 'public/audio');
const REPORT = join(ROOT, 'output/ovh-audio');
const FFMPEG = process.env.FFMPEG ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');
const FFPROBE = process.env.FFPROBE ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : 'ffprobe');
const PIPELINE_VERSION = 7;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const NO_FETCH = args.includes('--no-fetch');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

for (const d of [CACHE, SRC_CACHE, TMP, OUT, join(OUT, 'sfx'), join(OUT, 'music'), REPORT]) mkdirSync(d, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const round = (v, n = 2) => (v === null || v === undefined || !Number.isFinite(v) ? null : +v.toFixed(n));

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')}\n${r.stderr?.slice(-3000)}`);
  return r;
}

function runAsync(cmd, argv) {
  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, argv);
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 200000) err = err.slice(-100000); });
    p.on('close', (code) => (code === 0 ? resolveP(err) : reject(new Error(`${cmd} failed (${code})\n${argv.join(' ')}\n${err.slice(-3000)}`))));
  });
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return results;
}

// ───────────────────────── sources ─────────────────────────

async function download(url, dst) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(dst, buf);
      return buf;
    } catch (err) {
      if (attempt === 3) throw new Error(`download failed ${url}: ${err.message}`);
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  return null;
}

const zipDone = new Map();
async function ensureZip(url) {
  const name = basename(new URL(url).pathname).replace(/%20/g, ' ');
  const zipPath = join(CACHE, url.includes('kenney.nl') ? 'kenney' : 'zips', name);
  const dir = zipPath.replace(/\.zip$/i, '');
  if (zipDone.has(url)) return zipDone.get(url);
  const p = (async () => {
    mkdirSync(dirname(zipPath), { recursive: true });
    if (!existsSync(zipPath)) {
      if (NO_FETCH) throw new Error(`missing ${zipPath} (--no-fetch)`);
      await download(url, zipPath);
    }
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); run('unzip', ['-q', '-o', zipPath, '-d', dir]); }
    return dir;
  })();
  zipDone.set(url, p);
  return p;
}

function findInDir(dir, member) {
  const direct = join(dir, member);
  if (existsSync(direct)) return direct;
  const want = member.split('/').pop();
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === want) return p;
    }
  }
  throw new Error(`member ${member} not found in ${dir}`);
}

/** Scratch copies left by earlier sourcing passes (output/audio-cache/{music,sfx}); avoids re-downloading. */
function localCopy(id, s) {
  if (id.startsWith('oga-')) {
    const dir = join(CACHE, 'music', id.slice(4));
    const name = decodeURIComponent(basename(new URL(s.download).pathname));
    if (existsSync(join(dir, name))) return join(dir, name);
  }
  if (id.startsWith('fs-')) {
    const sfx = join(CACHE, 'sfx');
    if (existsSync(sfx)) for (const d of readdirSync(sfx)) { const p = join(sfx, d, `freesound-${id.slice(3)}.ogg`); if (existsSync(p)) return p; }
  }
  return null;
}

/** Resolves a source id to a local file path, downloading on first use. Records the original's sha256. */
const sourceInfo = new Map();
async function resolveSource(id) {
  if (sourceInfo.has(id)) return sourceInfo.get(id);
  const s = SOURCES[id];
  if (!s) throw new Error(`unknown source ${id}`);
  let path;
  if (s.zip) {
    const dir = await ensureZip(s.zip);
    path = findInDir(dir, s.member);
  } else {
    const ext = (s.download.match(/\.(ogg|mp3|wav|flac|m4a)(?:$|\?)/i)?.[1] ?? 'bin').toLowerCase();
    path = join(SRC_CACHE, `${id.replace(/[^a-z0-9._-]+/gi, '_')}.${ext}`);
    if (!existsSync(path)) {
      const local = localCopy(id, s);
      if (local) writeFileSync(path, readFileSync(local));
      else {
        if (NO_FETCH) throw new Error(`missing ${path} (--no-fetch)`);
        await download(s.download, path);
      }
    }
  }
  const info = { id, path, sha256: sha256(readFileSync(path)), bytes: statSync(path).size };
  sourceInfo.set(id, info);
  return info;
}

// ───────────────────────── measurement ─────────────────────────

function probe(path) {
  const r = run(FFPROBE, ['-v', 'error', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', path]);
  const j = JSON.parse(r.stdout);
  return { duration: +j.format.duration, channels: j.streams?.[0]?.channels ?? 0, sampleRate: +(j.streams?.[0]?.sample_rate ?? 0) };
}

/** Integrated loudness, max momentary loudness (padded so sub-400 ms sounds still register) and true peak. */
async function loudness(path) {
  const err = await runAsync(FFMPEG, ['-hide_banner', '-nostats', '-v', 'verbose', '-i', path, '-af', 'apad=pad_dur=0.5,ebur128=peak=true:framelog=verbose', '-f', 'null', '-']);
  let mMax = -Infinity;
  for (const m of err.matchAll(/ M:\s*(-?[\d.]+)/g)) { const v = +m[1]; if (v > mMax) mMax = v; }
  const I = err.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/);
  const TP = [...err.matchAll(/Peak:\s+(-?[\d.]+|-inf) dBFS/g)].pop();
  return { I: I ? +I[1] : null, mMax: Number.isFinite(mMax) ? mMax : null, tp: TP && TP[1] !== '-inf' ? +TP[1] : null };
}

// ───────────────────────── segmentation ─────────────────────────

function pcmMono(path, sr = 16000) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`decode failed ${path}`);
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
}

const segCache = new Map();
/**
 * Splits a recording into events: [start, end, peakDb]. An event starts when the 10 ms RMS envelope rises
 * above (file peak − 30 dB) or jumps ≥ 14 dB over the last 60 ms inside a tail; it ends after 150 ms below
 * max(file peak − 52, event peak − 42) dB.
 */
function segments(path) {
  if (segCache.has(path)) return segCache.get(path);
  const x = pcmMono(path);
  const hop = 160;
  const n = Math.floor(x.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) { let acc = 0; for (let j = 0; j < hop; j++) { const v = x[i * hop + j]; acc += v * v; } env[i] = 10 * Math.log10(acc / hop + 1e-12); }
  let peak = -120; for (const v of env) if (v > peak) peak = v;
  const on = peak - 30;
  const segs = [];
  let i = 0;
  while (i < n) {
    if (env[i] <= on) { i++; continue; }
    let s0 = i; while (s0 > 0 && i - s0 < 6 && env[s0 - 1] < env[s0] - 0.5) s0--;
    let segPeak = env[i], quiet = 0, j = i + 1;
    for (; j < n; j++) {
      if (env[j] > segPeak) segPeak = env[j];
      let recentMin = Infinity; for (let k = Math.max(i, j - 6); k < j; k++) recentMin = Math.min(recentMin, env[k]);
      if (j - i > 20 && env[j] > on && env[j] - recentMin >= 14) break; // a new attack inside this tail
      if (env[j] < Math.max(peak - 52, segPeak - 42)) { if (++quiet >= 15) break; } else quiet = 0;
    }
    const e = quiet >= 15 ? j - quiet + 1 : j;
    segs.push([+(s0 * 0.01).toFixed(3), +(e * 0.01).toFixed(3), +segPeak.toFixed(1)]);
    i = Math.max(j, i + 1);
  }
  segCache.set(path, segs);
  return segs;
}

/** Resolves `hit` (event index, or 'loudest') to a trim window, honouring maxLen and a pre-roll. */
async function resolveHit(L) {
  if (L.hit === undefined) return L;
  const src = await resolveSource(L.src);
  const segs = segments(src.path);
  if (!segs.length) throw new Error(`no events in ${L.src}`);
  let seg;
  if (L.hit === 'loudest') seg = segs.reduce((a, b) => (b[2] > a[2] ? b : a));
  else { seg = segs[L.hit]; if (!seg) throw new Error(`${L.src} has ${segs.length} events, wanted #${L.hit}: ${JSON.stringify(segs)}`); }
  const pre = L.preRoll ?? 0.008;
  const start = Math.max(0, seg[0] - pre + (L.offset ?? 0));
  let end = seg[1] + (L.tail ?? 0.05);
  if (L.maxLen) end = Math.min(end, start + L.maxLen);
  const { hit: _h, maxLen: _m, preRoll: _p, tail: _t, offset: _o, ...rest } = L;
  return { ...rest, trim: [+start.toFixed(3), +end.toFixed(3)], fadeOut: rest.fadeOut ?? Math.min(0.35, Math.max(0.04, (end - start) * 0.2)), _auto: true };
}

async function resolveSpec(spec) {
  if (spec.layers) return { ...spec, layers: await Promise.all(spec.layers.map(resolveHit)) };
  return resolveHit(spec);
}

/** Max RMS (dBFS) over a sliding window — a transient-friendly level for short one-shots. */
function maxWindowRms(path, win = 0.1) {
  const sr = 48000, x = pcmMono(path, sr);
  // Full band (bright coins/chimes carry most energy above 8 kHz); sub-100 ms clicks use their own length.
  const w = Math.min(win, Math.max(0.02, (x.length / sr) * 0.8));
  const n = Math.max(1, Math.round(w * sr)), hop = Math.round(0.005 * sr);
  const sq = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sq[i + 1] = sq[i] + x[i] * x[i];
  let best = 0;
  if (x.length <= n) best = sq[x.length] / Math.max(1, x.length);
  else for (let i = 0; i + n <= x.length; i += hop) { const e = (sq[i + n] - sq[i]) / n; if (e > best) best = e; }
  return 10 * Math.log10(best + 1e-12);
}

// ───────────────────────── rendering ─────────────────────────

const semisToRate = (s) => Math.pow(2, s / 12);

/** Builds the pre-normalization render (48 kHz float WAV) for one output spec. */
async function renderRaw(spec, channels, tmpWav) {
  const layers = spec.layers ?? [{ ...spec }];
  const inputs = [];
  const chains = [];
  let total = 0;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const src = await resolveSource(L.src);
    inputs.push('-i', src.path);
    const f = [];
    const [s, e] = L.trim ?? [0, null];
    const loopX = typeof spec.loop === 'object' ? spec.loop.xfade : 0;
    const end = e === null || e === undefined ? null : e + (layers.length === 1 ? loopX : 0);
    f.push(`atrim=start=${s}${end !== null ? `:end=${end}` : ''}`, 'asetpts=PTS-STARTPTS', 'aresample=48000');
    f.push(`aformat=sample_fmts=fltp:channel_layouts=${channels === 1 ? 'mono' : 'stereo'}`);
    const rate = L.rate ?? (L.semis !== undefined ? semisToRate(L.semis) : 1);
    if (Math.abs(rate - 1) > 1e-4) f.push(`asetrate=${Math.round(48000 * rate)}`, 'aresample=48000');
    if (L.highpass) f.push(`highpass=f=${L.highpass}`);
    if (L.lowpass) f.push(`lowpass=f=${L.lowpass}`);
    if (L.gainDb) f.push(`volume=${L.gainDb}dB`);
    if (L.fadeIn) f.push(`afade=t=in:d=${L.fadeIn}:curve=qsin`);
    const dur = ((end ?? probe(src.path).duration) - s) / rate;
    const fo = L.fadeOut ?? (layers.length === 1 ? spec.fadeOut : undefined);
    if (fo && typeof spec.loop !== 'object') f.push(`afade=t=out:st=${Math.max(0, dur - fo).toFixed(3)}:d=${fo}`);
    if (L.pan !== undefined && channels === 2) {
      const l = Math.cos(((L.pan + 1) * Math.PI) / 4), r = Math.sin(((L.pan + 1) * Math.PI) / 4);
      f.push(`pan=stereo|c0=${(l * Math.SQRT2).toFixed(3)}*c0|c1=${(r * Math.SQRT2).toFixed(3)}*c1`);
    }
    if (L.delay) f.push(`adelay=${Math.round(L.delay * 1000)}:all=1`);
    total = Math.max(total, (L.delay ?? 0) + dur);
    chains.push(`[${i}:a]${f.join(',')}[l${i}]`);
  }
  let graph = chains.join(';');
  let last;
  if (layers.length > 1) { graph += `;${layers.map((_, i) => `[l${i}]`).join('')}amix=inputs=${layers.length}:duration=longest:normalize=0[mix]`; last = 'mix'; }
  else last = 'l0';
  if (typeof spec.loop === 'object') {
    // Seamless loop: out(t) = head(t)·sin + tail(L+t)·cos over the first X seconds.
    const X = spec.loop.xfade;
    const L = total - X;
    graph += `;[${last}]asplit=2[la][lb];[la]atrim=end=${L},asetpts=PTS-STARTPTS,afade=t=in:d=${X}:curve=qsin[ha];[lb]atrim=start=${L},asetpts=PTS-STARTPTS,afade=t=out:d=${X}:curve=qsin[hb];[ha][hb]amix=inputs=2:duration=first:normalize=0[loop]`;
    last = 'loop';
    total = L;
  } else {
    const post = [];
    if (spec.fadeOut && layers.length > 1) post.push(`afade=t=out:st=${Math.max(0, total - spec.fadeOut).toFixed(3)}:d=${spec.fadeOut}`);
    if (spec.silenceTrim !== false && !spec.music) post.push('silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.004');
    if (post.length) { graph += `;[${last}]${post.join(',')}[post]`; last = 'post'; }
  }
  await runAsync(FFMPEG, ['-hide_banner', '-y', ...inputs, '-filter_complex', graph, '-map', `[${last}]`, '-c:a', 'pcm_f32le', '-ar', '48000', tmpWav]);
}

function targetFor(spec, kind) {
  const t = TARGETS[spec.norm ?? kind];
  if (!t) throw new Error(`no loudness target for ${spec.norm ?? kind}`);
  return t;
}

const resolvedSpecs = new Map();
async function encode(rawSpec, kind, outPath, channels, bitrate) {
  const spec = await resolveSpec(rawSpec);
  resolvedSpecs.set(outPath, spec);
  const key = createHash('sha1').update(JSON.stringify({ spec, kind, channels, bitrate, target: targetFor(spec, kind), PIPELINE_VERSION })).digest('hex');
  const stamp = `${outPath}.buildkey`;
  const stampPath = join(CACHE, 'stamps', relative(OUT, outPath).replace(/[\\/]/g, '__'));
  mkdirSync(dirname(stampPath), { recursive: true });
  if (!FORCE && existsSync(outPath) && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === key) return { cached: true };
  void stamp;
  const tmpWav = join(TMP, `${basename(outPath, '.ogg')}-${process.pid}.wav`);
  await renderRaw(spec, channels, tmpWav);
  const m = await loudness(tmpWav);
  const t = targetFor(spec, kind);
  const measured = t.mode === 'integrated' ? (m.I ?? m.mMax) : t.mode === 'rms100' ? maxWindowRms(tmpWav) : (m.mMax ?? m.I);
  const level = t.mode === 'rms100' ? t.rms : t.lufs;
  let gain = (level + (spec.trimDb ?? 0)) - (measured ?? level);
  const headroom = t.ceiling - (m.tp ?? -20);
  const maxLimit = spec.limitDb ?? t.maxLimitDb;
  let limit = false;
  if (gain > headroom) {
    const over = gain - headroom;
    if (over > maxLimit) gain = headroom + maxLimit;
    limit = true;
  }
  const af = [`volume=${gain.toFixed(2)}dB`];
  if (limit) af.push(`alimiter=limit=${Math.pow(10, t.ceiling / 20).toFixed(4)}:attack=4:release=60:level=disabled`);
  const codec = ['-c:a', 'libopus', '-b:a', `${bitrate}k`, '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-ac', String(channels)];
  await runAsync(FFMPEG, ['-hide_banner', '-y', '-i', tmpWav, '-af', af.join(','), ...codec, '-map_metadata', '-1', outPath]);
  rmSync(tmpWav, { force: true });
  writeFileSync(stampPath, key);
  return { cached: false, gain: round(gain), limited: limit, pre: m };
}

// ───────────────────────── main ─────────────────────────

const CATEGORY_KIND = (cat, spec) => (typeof spec.loop === 'object' ? 'bed' : cat === 'stinger' ? 'stinger' : cat === 'ui' ? 'ui' : 'sfx');
const DEFAULT_CHANNELS = (cat, spec) => spec.channels ?? (typeof spec.loop === 'object' || cat === 'stinger' ? 2 : 1);

async function main() {
  const t0 = Date.now();
  if (args.includes('--segments')) {
    for (const id of args.slice(args.indexOf('--segments') + 1)) {
      const src = await resolveSource(id);
      const p = probe(src.path);
      console.log(`${id} (${p.duration.toFixed(2)} s, ${p.channels} ch): ${JSON.stringify(segments(src.path))}`);
    }
    return;
  }
  const jobs = [];
  for (const [id, cue] of Object.entries(CUES)) {
    if (ONLY && ONLY !== id) continue;
    cue.files.forEach((spec, i) => {
      const file = `sfx/${id}${cue.files.length > 1 ? `-${i + 1}` : ''}.ogg`;
      const channels = DEFAULT_CHANNELS(cue.category, spec);
      const kind = CATEGORY_KIND(cue.category, spec);
      const bitrate = spec.bitrate ?? (channels === 2 ? (kind === 'stinger' ? 112 : 80) : 56);
      jobs.push({ kind: 'cue', id, file, spec, channels, norm: kind, bitrate });
    });
  }
  for (const [key, m] of Object.entries(MUSIC)) {
    if (ONLY && ONLY !== key) continue;
    jobs.push({ kind: 'music', id: key, file: `music/${key}.ogg`, spec: { ...m, music: true }, channels: 2, norm: 'music', bitrate: m.bitrate ?? 96 });
  }
  // Resolve sources sequentially first (downloads, polite to hosts).
  const used = new Set();
  for (const j of jobs) for (const L of j.spec.layers ?? [j.spec]) used.add(L.src);
  let n = 0;
  for (const id of used) { await resolveSource(id); n++; if (n % 20 === 0) process.stdout.write(`  sources ${n}/${used.size}\n`); }
  console.log(`sources ready: ${used.size}`);

  const results = await pool(jobs, 6, async (j) => {
    const out = join(OUT, j.file);
    const r = await encode(j.spec, j.norm, out, j.channels, j.bitrate);
    if (!r.cached) process.stdout.write(`  ${j.file} gain ${r.gain} dB${r.limited ? ' (limited)' : ''}\n`);
    return r;
  });
  void results;
  if (ONLY) { console.log('partial build (--only): manifest not rewritten'); return; }

  // Measure final encodes.
  const fileMeta = {};
  await pool(jobs, 6, async (j) => {
    const path = join(OUT, j.file);
    const buf = readFileSync(path);
    const p = probe(path);
    const l = await loudness(path);
    fileMeta[j.file] = {
      bytes: buf.length, sha256: sha256(buf), duration: round(p.duration, 3), channels: p.channels,
      lufs: round(j.norm === 'music' || j.norm === 'bed' ? l.I : l.mMax, 1), truePeak: round(l.tp, 1),
      rms100: j.norm === 'music' || j.norm === 'bed' ? undefined : round(maxWindowRms(path), 1),
      sources: [...new Set((j.spec.layers ?? [j.spec]).map((L) => L.src))],
    };
  });

  // Stale outputs (renamed/removed cues).
  const expected = new Set(jobs.map((j) => j.file));
  for (const dir of ['sfx', 'music']) for (const f of readdirSync(join(OUT, dir))) if (!expected.has(`${dir}/${f}`)) { rmSync(join(OUT, dir, f)); console.log(`  removed stale ${dir}/${f}`); }

  const manifest = { version: 1, generated: new Date().toISOString().slice(0, 10), cues: {}, music: {}, files: {} };
  for (const [id, cue] of Object.entries(CUES)) {
    const files = jobs.filter((j) => j.kind === 'cue' && j.id === id).map((j) => j.file);
    const { files: _specs, ...rest } = cue;
    manifest.cues[id] = { ...rest, files };
  }
  for (const [key, m] of Object.entries(MUSIC)) {
    const { src: _s, trim: _t, fadeIn: _fi, fadeOut: _fo, layers: _l, bitrate: _b, norm: _n, trimDb: _td, ...rest } = m;
    const dur = fileMeta[`music/${key}.ogg`].duration;
    manifest.music[key] = { ...rest, file: `music/${key}.ogg`, loopEnd: rest.loopEnd ?? (rest.loop ? round(dur - 0.05, 2) : undefined) };
  }
  for (const f of [...expected].sort()) manifest.files[f] = fileMeta[f];
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);

  writeFileSync(join(ROOT, 'src/audio/generated/cueIds.ts'), cueIdsTs());
  writeFileSync(join(OUT, 'CREDITS.md'), creditsMd(manifest));
  writeReport(manifest);
  const total = Object.values(manifest.files).reduce((a, f) => a + f.bytes, 0);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${Object.keys(manifest.files).length} files, ${(total / 1048576).toFixed(2)} MB`);
}

function cueIdsTs() {
  const ids = Object.keys(CUES);
  const lines = [];
  let line = ' ';
  for (const id of ids) {
    const tok = ` '${id}',`;
    if (line.length + tok.length > 118) { lines.push(line); line = ' '; }
    line += tok;
  }
  lines.push(line);
  return `/* Generated by scripts/audio/build.mjs from scripts/audio/recipe.mjs — do not edit by hand. */
export const CUE_IDS = [
${lines.join('\n')}
] as const;

export type CueId = (typeof CUE_IDS)[number];

export const MUSIC_KEYS = [${Object.keys(MUSIC).map((k) => `'${k}'`).join(', ')}] as const;

export type MusicKey = (typeof MUSIC_KEYS)[number];
`;
}

const LICENSE_URL = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

function describeChanges(spec) {
  const parts = [];
  for (const L of spec.layers ?? [spec]) {
    const p = [];
    if (L.trim) p.push(`${L._auto ? 'event' : 'trim'} ${L.trim[0]}–${L.trim[1] ?? 'end'} s`);
    if (L.semis) p.push(`pitch ${L.semis > 0 ? '+' : ''}${L.semis} st`);
    if (L.rate) p.push(`rate ×${L.rate}`);
    if (L.lowpass) p.push(`low-pass ${L.lowpass} Hz`);
    if (L.highpass) p.push(`high-pass ${L.highpass} Hz`);
    if (L.delay) p.push(`delayed ${L.delay} s`);
    if (L.pan !== undefined) p.push(`pan ${L.pan}`);
    if (L.gainDb) p.push(`${L.gainDb > 0 ? '+' : ''}${L.gainDb} dB`);
    if (spec.layers) parts.push(`${L.src}: ${p.join(', ') || 'as is'}`);
    else parts.push(p.join(', '));
  }
  const tail = [];
  if (spec.layers) tail.push(`mixed ${spec.layers.length} layers`);
  if (typeof spec.loop === 'object') tail.push(`seamless loop (${spec.loop.xfade} s crossfade)`);
  if (spec.fadeOut) tail.push(`fade-out ${spec.fadeOut} s`);
  tail.push('loudness-normalized', 'Opus encode');
  return [...parts.filter(Boolean), ...tail].join('; ');
}

function creditsMd(manifest) {
  const usedSources = new Map();
  const rows = [];
  const allSpecs = [];
  for (const [id, cue] of Object.entries(CUES)) cue.files.forEach((spec, i) => allSpecs.push({ file: `sfx/${id}${cue.files.length > 1 ? `-${i + 1}` : ''}.ogg`, spec, cue: id }));
  for (const [key, m] of Object.entries(MUSIC)) allSpecs.push({ file: `music/${key}.ogg`, spec: m, cue: `music:${key}` });
  for (const { file, spec: raw, cue } of allSpecs) {
    const spec = resolvedSpecs.get(join(OUT, file)) ?? raw;
    const meta = manifest.files[file];
    const srcIds = [...new Set((spec.layers ?? [spec]).map((L) => L.src))];
    for (const s of srcIds) { const list = usedSources.get(s) ?? []; list.push(file); usedSources.set(s, list); }
    const lic = [...new Set(srcIds.map((s) => SOURCES[s].license))].join(' + ');
    rows.push(`| \`${file}\` | ${cue} | ${srcIds.map((s) => `[${SOURCES[s].title.replace(/\|/g, '/')}](${SOURCES[s].page}) — ${SOURCES[s].author}`).join('<br>')} | ${lic} | ${describeChanges(spec)} | \`${meta.sha256}\` |`);
  }
  const srcRows = [...usedSources.keys()].sort().map((s) => {
    const S = SOURCES[s];
    const info = sourceInfo.get(s);
    return `| ${s} | [${S.title.replace(/\|/g, '/')}](${S.page}) | ${S.author} | [${S.license}](${LICENSE_URL[S.license]}) | ${S.download ? `[file](${S.download})` : `${S.zip ? `[zip](${S.zip}) → \`${S.member}\`` : ''}`} | \`${info?.sha256 ?? '?'}\` |`;
  });
  const byLicense = {};
  for (const s of usedSources.keys()) byLicense[SOURCES[s].license] = (byLicense[SOURCES[s].license] ?? 0) + 1;
  const attributions = [...usedSources.keys()].filter((s) => SOURCES[s].license !== 'CC0-1.0').sort().map((s) => {
    const S = SOURCES[s];
    return `- "${S.title}" by ${S.author} — ${S.page} — licensed under ${S.license.replace('CC-BY-', 'CC BY ')} (${LICENSE_URL[S.license]}). Changes: trimmed/processed and re-encoded as described below.`;
  });
  const total = Object.values(manifest.files).reduce((a, f) => a + f.bytes, 0);
  return `# Audio credits and ledger

Every file in \`public/audio/\` is built by \`scripts/audio/build.mjs\` from the sources below (recipe:
\`scripts/audio/recipe.mjs\`). Licences are CC0 1.0 or CC BY 3.0/4.0 only — no NC/ND/Sampling+ or
"royalty-free" licences, no audio extracted from commercial games. Each source's licence was verified on its
own page on ${manifest.generated}. SHA-256 of each original download and of each shipped file is recorded.

Totals: ${Object.keys(manifest.files).length} shipped files, ${(total / 1048576).toFixed(2)} MB; ${usedSources.size} sources (${Object.entries(byLicense).map(([k, v]) => `${v} ${k}`).join(', ')}).

## Attribution (CC BY)

${attributions.length ? attributions.join('\n') : '- None: every source is CC0.'}

CC0 sources need no attribution; they are credited anyway below.

## Sources

| Source id | Title | Author | Licence | Original | SHA-256 of original |
|---|---|---|---|---|---|
${srcRows.join('\n')}

## Shipped files

| File | Cue | Source(s) | Licence | Changes | SHA-256 |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

function writeReport(manifest) {
  const cats = {};
  for (const [id, cue] of Object.entries(manifest.cues)) {
    const c = CUES[id].files.some((f) => typeof f.loop === 'object') ? 'ambience (beds)' : cue.category;
    for (const f of cue.files) {
      const m = manifest.files[f];
      (cats[c] ??= []).push({ file: f, lufs: m.lufs, tp: m.truePeak, gain: cue.gain });
    }
  }
  for (const f of Object.keys(manifest.music)) (cats.music ??= []).push({ file: manifest.music[f].file, lufs: manifest.files[manifest.music[f].file].lufs, tp: manifest.files[manifest.music[f].file].truePeak, gain: manifest.music[f].gain });
  const lines = ['| Category | Files | Loudness (LUFS, mean / min / max) | Max true peak (dBTP) | Mean cue gain (dB) | Effective (LUFS) |', '|---|---|---|---|---|---|'];
  const summary = {};
  for (const [c, list] of Object.entries(cats).sort()) {
    const l = list.map((x) => x.lufs).filter((v) => v !== null);
    const mean = l.reduce((a, b) => a + b, 0) / l.length;
    const gains = list.map((x) => 20 * Math.log10(x.gain));
    const g = gains.reduce((a, b) => a + b, 0) / gains.length;
    const tp = Math.max(...list.map((x) => x.tp ?? -99));
    summary[c] = { files: list.length, mean: round(mean, 1), min: round(Math.min(...l), 1), max: round(Math.max(...l), 1), tp: round(tp, 1), gainDb: round(g, 1), effective: round(mean + g, 1) };
    lines.push(`| ${c} | ${list.length} | ${summary[c].mean} / ${summary[c].min} / ${summary[c].max} | ${summary[c].tp} | ${summary[c].gainDb} | ${summary[c].effective} |`);
  }
  const note = `\nOne-shots are measured as max momentary loudness (400 ms window, padded); beds and music as integrated loudness. "Effective" adds the manifest cue gain (before bus volumes, distance and the ${'v²'} volume curve).\n`;
  writeFileSync(join(REPORT, 'loudness.md'), `# Loudness by category (${manifest.generated})\n\n${lines.join('\n')}\n${note}`);
  writeFileSync(join(REPORT, 'loudness.json'), JSON.stringify({ summary, files: manifest.files }, null, 1));
  console.log(lines.join('\n'));
}

main().catch((err) => { console.error(err); process.exit(1); });
