/**
 * Audio recipe (AUDIO-owned): every shipped file, how it is cut from which CC source, and the cue table.
 * `scripts/audio/build.mjs` turns this into public/audio/** + manifest.json + CREDITS.md + src/audio/generated/cueIds.ts.
 *
 * File spec keys: src (source id in sources.json) · hit (event index or 'loudest', auto-trimmed at the build) ·
 * trim [s, e] · maxLen · semis (pitch) · lowpass/highpass (Hz) · gainDb · fadeIn/fadeOut · delay (layers) ·
 * pan (−1..1, stereo outputs) · reverse · layers [...] (mixed) · loop { xfade } (seamless bed) · channels · norm · trimDb.
 * Cue keys (copied to the manifest): category · gain · pitch (± semitones) · gainJitter (± dB) · priority ·
 * minInterval · maxPerFrame · desc.
 */
import { readFileSync } from 'node:fs';

export const SOURCES = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));

/** Loudness targets: one-shots by max 100 ms RMS; beds, music and stingers by integrated loudness (EBU R128). */
export const TARGETS = {
  /** One-shots: max 100 ms RMS (transient-friendly), true-peak ceiling, ≤6 dB of peak limiting. */
  sfx: { mode: 'rms100', rms: -13, ceiling: -1, maxLimitDb: 6 },
  ui: { mode: 'rms100', rms: -17, ceiling: -1, maxLimitDb: 6 },
  stinger: { mode: 'integrated', lufs: -15, ceiling: -1, maxLimitDb: 2 },
  bed: { mode: 'integrated', lufs: -21, ceiling: -3, maxLimitDb: 1 },
  music: { mode: 'integrated', lufs: -16, ceiling: -1, maxLimitDb: 2 },
};

const K = (pack, name, extra = {}) => ({ src: `kenney-${pack}-${name}`, ...extra });
const F = (id, extra = {}) => ({ src: `fs-${id}`, ...extra });
const O = (slug, extra = {}) => ({ src: `oga-${slug}`, ...extra });

// Reusable cuts.
const CANNON_A = F(125348, { trim: [0.2, 2.4], fadeOut: 0.45 });
const CANNON_B = F(187767, { trim: [0.07, 3.0], fadeOut: 0.7 });
const CANNON_C = F(187767, { trim: [6.35, 9.3], fadeOut: 0.7 });
const CANNON_D = F(853281, { trim: [0, 2.09], fadeOut: 0.5 });
const SHIP_BELL = F(353233, { trim: [0.1, 2.9], fadeOut: 0.8 });

/**
 * Volleys (router.ts plays ONE of these per broadside volley): `n` reports `step` s apart like the in-game ripple
 * (50 ms per gun, 35 ms for Full Broadside), alternating the four cannon cuts, plus optional extra layers.
 */
const GUN_CUTS = [CANNON_A, CANNON_B, CANNON_D, CANNON_C];
const GUN_SEMIS = [0, -1, 1, -2, 0.5, -1.5, 1.5, -0.5, 0.8];
const ripple = (n, step, rot, extra = [], opts = {}) => ({
  layers: [
    ...Array.from({ length: n }, (_, i) => ({
      ...GUN_CUTS[(i + rot) % GUN_CUTS.length], delay: +(i * step + (i % 3 === 1 ? 0.007 : 0)).toFixed(3),
      semis: GUN_SEMIS[(i + rot) % GUN_SEMIS.length], gainDb: -2 - Math.min(5, i * 0.7),
    })),
    ...extra,
  ],
  fadeOut: 0.9,
  ...opts,
});
/** Low rolling tail for the bigger volleys: the report rolling away across the water. */
const GUN_TAIL = (delay, gainDb) => F(187767, { trim: [6.35, 9.3], lowpass: 650, delay, gainDb, fadeOut: 1.2 });
const HEAVY_BOOM = (delay, gainDb) => F(853280, { trim: [0, 3.2], delay, gainDb, fadeOut: 0.8 });

/** Crew barks: owner-generated masters (scripts/audio/generated/barks), cut at the end of speech, band-limited to sit
 * under the guns like a shout across the deck. One voice at a time (category 'voice'); barks.ts rate-limits them. */
const G = (id, end, extra = {}) => ({ src: `gen-crew-${id}`, trim: [0, end], highpass: 110, lowpass: 7500, fadeOut: 0.12, ...extra });
const BARK = { category: 'voice', gain: 0.55, priority: 85, minInterval: 1.5, maxPerFrame: 1, rate: 22050 };

export const CUES = {
  // ───────────── UI (Kenney CC0 packs) ─────────────
  'ui-hover': { category: 'ui', gain: 0.22, pitch: 0.4, minInterval: 0.04, desc: 'button hover tick', files: [K('ui-audio', 'rollover2'), K('ui-audio', 'rollover3')] },
  'ui-click': { category: 'ui', gain: 0.4, pitch: 0.3, minInterval: 0.03, desc: 'button click', files: [K('interface-sounds', 'click_001'), K('ui-audio', 'click1'), K('ui-audio', 'click3')] },
  'ui-back': { category: 'ui', gain: 0.4, pitch: 0.2, minInterval: 0.05, desc: 'back / close / cancel', files: [K('interface-sounds', 'back_001'), K('interface-sounds', 'back_002')] },
  'ui-confirm': { category: 'ui', gain: 0.45, pitch: 0.2, minInterval: 0.08, desc: 'confirm / buy / start', files: [K('interface-sounds', 'confirmation_001'), K('interface-sounds', 'confirmation_003')] },
  'ui-error': { category: 'ui', gain: 0.4, minInterval: 0.15, desc: 'refused action', files: [K('interface-sounds', 'error_004')] },
  'ui-open': { category: 'ui', gain: 0.4, minInterval: 0.1, desc: 'pause/menu opens', files: [K('interface-sounds', 'open_001')] },
  'ui-close': { category: 'ui', gain: 0.4, minInterval: 0.1, desc: 'pause/menu closes', files: [K('interface-sounds', 'close_001')] },
  'ui-tick': { category: 'ui', gain: 0.25, pitch: 0.5, minInterval: 0.06, desc: 'slider tick', files: [K('interface-sounds', 'tick_002')] },
  'ui-transition': { category: 'ui', gain: 0.35, pitch: 0.8, minInterval: 0.3, desc: 'screen change: canvas swish', files: [K('rpg-audio', 'cloth1'), K('rpg-audio', 'cloth3')] },
  'card-hover': { category: 'ui', gain: 0.32, pitch: 0.8, minInterval: 0.05, desc: 'level-up card slide', files: [K('casino-audio', 'card-slide-1'), K('casino-audio', 'card-slide-3'), K('casino-audio', 'card-slide-5')] },
  'card-select': { category: 'ui', gain: 0.55, pitch: 0.4, minInterval: 0.1, desc: 'card chosen', files: [K('casino-audio', 'card-place-1'), K('casino-audio', 'card-place-2'), K('casino-audio', 'card-place-3')] },
  reroll: { category: 'ui', gain: 0.5, pitch: 0.3, minInterval: 0.25, desc: 'reroll: cards shuffled', files: [K('casino-audio', 'card-fan-1'), K('casino-audio', 'card-shuffle', { trim: [0, 1.25], fadeOut: 0.3 })] },
  'weapon-new': { category: 'ui', gain: 0.55, pitch: 0.3, minInterval: 0.3, desc: 'new weapon mounted: latch + blade', files: [{ layers: [K('rpg-audio', 'metalLatch'), K('rpg-audio', 'drawKnife1', { delay: 0.1, gainDb: -3 }), K('impact-sounds', 'impactPlank_medium_000', { delay: 0.02, semis: -3, gainDb: -4 })] }] },
  'weapon-upgrade': { category: 'ui', gain: 0.5, pitch: 0.3, minInterval: 0.2, desc: 'weapon level up', files: [K('interface-sounds', 'maximize_003'), K('interface-sounds', 'maximize_006')] },
  overdrive: { category: 'ui', gain: 0.7, minInterval: 0.6, priority: 85, desc: 'OVERDRIVE: brass stab + whoosh + sparkle', files: [{ layers: [F(350433, { trim: [0, 1.7], fadeOut: 0.3 }), F(683101, { trim: [0.05, 0.9], gainDb: -3 }), F(545238, { delay: 0.25, gainDb: -4 })] }] },
  'passive-upgrade': { category: 'ui', gain: 0.45, pitch: 0.2, minInterval: 0.2, desc: 'passive rank up', files: [K('interface-sounds', 'select_003'), K('interface-sounds', 'select_005')] },
  'skill-ready': { category: 'ui', gain: 0.35, minInterval: 0.5, desc: 'special ready', files: [K('interface-sounds', 'pluck_002')] },
  'ultimate-ready': { category: 'ui', gain: 0.45, minInterval: 1, desc: 'ultimate charged', files: [{ layers: [K('interface-sounds', 'glass_005'), K('interface-sounds', 'bong_001', { delay: 0.06, gainDb: -2 })] }] },
  'level-up': { category: 'ui', gain: 0.55, minInterval: 1.2, priority: 90, desc: 'level-up sting under 1 s (steel drum / pizzicato)', files: [K('music-jingles', 'jingles_STEEL08'), K('music-jingles', 'jingles_STEEL11'), K('music-jingles', 'jingles_PIZZI10')] },
  'set-sail': { category: 'ui', gain: 0.55, minInterval: 2, desc: 'run starts: two bells + sail snap', files: [{ layers: [F(353232, { trim: [0.3, 2.6], fadeOut: 0.6 }), F(428337, { trim: [0.06, 0.8], delay: 0.55, gainDb: -3 })] }] },

  // ───────────── music stingers (music bus) ─────────────
  'stinger-victory': { category: 'stinger', gain: 0.9, desc: 'victory fanfare', files: [O('victory-fanfare-short', { trim: [0, 11.8], fadeOut: 1.2, norm: 'stinger', channels: 2 })] },
  'stinger-defeat': { category: 'stinger', gain: 0.85, desc: 'defeat lament', files: [O('medieval-defeat-theme', { trim: [0, 9.5], fadeOut: 3.2, norm: 'stinger', channels: 2 })] },
  'stinger-boss-defeated': { category: 'stinger', gain: 0.8, desc: 'boss defeated fanfare', files: [O('medieval-victory-theme', { trim: [0, 6.2], fadeOut: 2, norm: 'stinger', channels: 2 })] },

  // ───────────── guns ─────────────
  'cannon-near': { category: 'cannon', gain: 0.85, pitch: 1.2, gainJitter: 1.5, priority: 55, minInterval: 0.02, maxPerFrame: 3, desc: 'black-powder cannon, near (one or two guns)', files: [CANNON_A, CANNON_B, CANNON_C, CANNON_D] },
  'volley-small': { category: 'cannon', gain: 0.85, pitch: 0.8, gainJitter: 1, priority: 58, minInterval: 0.02, maxPerFrame: 2, desc: 'broadside volley, 3–4 guns rippling', files: [ripple(3, 0.05, 0), ripple(3, 0.05, 2)] },
  'volley-mid': { category: 'cannon', gain: 0.85, pitch: 0.8, gainJitter: 1, priority: 62, minInterval: 0.02, maxPerFrame: 2, desc: 'broadside volley, 5–7 guns + rolling tail', files: [ripple(5, 0.05, 1, [GUN_TAIL(0.28, -7)]), ripple(5, 0.05, 3, [GUN_TAIL(0.3, -7)])] },
  'volley-big': { category: 'cannon', gain: 0.85, pitch: 0.6, gainJitter: 1, priority: 66, minInterval: 0.02, maxPerFrame: 2, desc: 'broadside volley, 8+ guns + heavy boom + tail', files: [ripple(8, 0.045, 0, [HEAVY_BOOM(0.02, -5), GUN_TAIL(0.36, -5)], { trimDb: 1 }), ripple(8, 0.045, 2, [HEAVY_BOOM(0.03, -5), GUN_TAIL(0.4, -5)], { trimDb: 1 })] },
  'volley-full': { category: 'cannon', gain: 1, pitch: 0.5, priority: 85, minInterval: 0.3, maxPerFrame: 1, desc: 'Full Broadside: every gun at once, the loudest gun on the sea', files: [ripple(9, 0.035, 1, [HEAVY_BOOM(0, -3), HEAVY_BOOM(0.14, -6), GUN_TAIL(0.3, -3)], { trimDb: 2.5, fadeOut: 1.2 }), ripple(9, 0.035, 3, [HEAVY_BOOM(0.01, -3), HEAVY_BOOM(0.16, -6), GUN_TAIL(0.34, -3)], { trimDb: 2.5, fadeOut: 1.2 })] },
  'cannon-far': { category: 'cannon', gain: 0.8, pitch: 1.5, gainJitter: 2, priority: 35, minInterval: 0.04, maxPerFrame: 3, desc: 'cannon boom rolling across the water', files: [F(149966, { trim: [0, 3.2], fadeOut: 0.8 }), F(565794, { trim: [0, 2.8], fadeOut: 0.7 }), { ...CANNON_C, lowpass: 700, fadeOut: 0.9 }] },
  'broadside-ripple': {
    category: 'cannon', gain: 0.8, pitch: 0.8, priority: 60, minInterval: 0.15, maxPerFrame: 1, desc: 'rolling broadside (5 guns)',
    files: [
      { layers: [{ ...CANNON_A, gainDb: -3 }, { ...CANNON_B, delay: 0.11, semis: -1, gainDb: -4 }, { ...CANNON_D, delay: 0.2, gainDb: -4 }, { ...CANNON_A, delay: 0.34, semis: 1, gainDb: -5 }, { ...CANNON_C, delay: 0.47, semis: -2, gainDb: -5 }], fadeOut: 0.8 },
      { layers: [{ ...CANNON_C, gainDb: -3 }, { ...CANNON_D, delay: 0.09, semis: 1, gainDb: -4 }, { ...CANNON_B, delay: 0.21, gainDb: -4 }, { ...CANNON_A, delay: 0.3, semis: -1, gainDb: -5 }, { ...CANNON_D, delay: 0.44, semis: -2, gainDb: -5 }], fadeOut: 0.8 },
    ],
  },
  'heavy-shot': { category: 'cannon', gain: 0.95, pitch: 1, priority: 65, minInterval: 0.03, maxPerFrame: 3, desc: 'heavy gun / boss shell', files: [F(853280, { trim: [0, 3.2], fadeOut: 0.8 }), F(127845, { trim: [0, 3.0], semis: -2, fadeOut: 0.8 })] },
  'bow-chaser': { category: 'cannon', gain: 0.75, pitch: 1.2, priority: 50, minInterval: 0.05, maxPerFrame: 2, desc: 'long gun crack', files: [F(702245, { trim: [0.02, 1.1], fadeOut: 0.35 }), F(175430, { trim: [0, 0.78], semis: 1, fadeOut: 0.25 })] },
  'swivel-shot': { category: 'cannon', gain: 0.5, pitch: 1.5, priority: 40, minInterval: 0.05, maxPerFrame: 2, desc: 'swivel gun / musket crack', files: [F(234869, { trim: [0.68, 1.7], fadeOut: 0.3 }), F(347647, { trim: [0, 1.0], fadeOut: 0.3 }), F(538795, { trim: [0.14, 1.7], fadeOut: 0.4 }), F(593908, { trim: [0, 0.95], fadeOut: 0.25 })] },
  'swivel-burst': { category: 'cannon', gain: 0.5, pitch: 1.2, priority: 42, minInterval: 0.08, maxPerFrame: 1, desc: 'swivel guns: three cracks in a burst', files: [{ layers: [F(234869, { trim: [0.68, 1.7] }), F(593908, { trim: [0, 0.95], delay: 0.05, gainDb: -2 }), F(347647, { trim: [0, 1.0], delay: 0.11, gainDb: -3 })], fadeOut: 0.3 }, { layers: [F(538795, { trim: [0.14, 1.7] }), F(234869, { trim: [0.68, 1.7], delay: 0.06, semis: 1, gainDb: -2 }), F(593908, { trim: [0, 0.95], delay: 0.1, semis: -1, gainDb: -3 })], fadeOut: 0.3 }] },
  'mortar-launch': { category: 'cannon', gain: 0.75, pitch: 1, priority: 50, minInterval: 0.08, maxPerFrame: 2, desc: 'mortar thump', files: [F(529239, { trim: [0, 2.2], fadeOut: 0.6 }), F(187542, { trim: [0, 1.6], fadeOut: 0.4 }), F(854478, { trim: [0, 1.8], fadeOut: 0.4 })] },
  'chain-rattle': { category: 'weapon', gain: 0.45, pitch: 1.5, minInterval: 0.3, maxPerFrame: 1, desc: 'chain shot whirr', files: [F(506146, { trim: [0, 1.25], fadeOut: 0.3 }), F(370877, { trim: [0.4, 1.8], fadeOut: 0.3, highpass: 300 })] },
  'mortar-whistle': { category: 'weapon', gain: 0.6, pitch: 1, priority: 60, minInterval: 0.12, maxPerFrame: 2, desc: 'incoming shell whistle (ends at impact)', files: [F(241840, { trim: [0, 1.68], fadeOut: 0.08 }), F(506313, { trim: [0, 2.9], fadeOut: 0.1 }), F(398255, { trim: [0.8, 3.4], fadeOut: 0.1 })] },
  'rocket-launch': { category: 'weapon', gain: 0.5, pitch: 1.5, minInterval: 0.06, maxPerFrame: 2, desc: 'rocket whoosh + fizz', files: [F(140726, { trim: [0, 1.4], fadeOut: 0.3 }), F(455547, { trim: [0, 1.6], fadeOut: 0.4 }), F(587173, { trim: [0.06, 2.28], fadeOut: 0.4 }), F(186933, { trim: [0, 1.44], fadeOut: 0.3 })] },
  'rocket-salvo': { category: 'weapon', gain: 0.5, pitch: 1.2, minInterval: 0.1, maxPerFrame: 1, desc: 'rocket rack salvo: three whooshes', files: [{ layers: [F(140726, { trim: [0, 1.4] }), F(455547, { trim: [0, 1.6], delay: 0.08, gainDb: -2 }), F(186933, { trim: [0, 1.44], delay: 0.17, gainDb: -3 })], fadeOut: 0.4 }, { layers: [F(587173, { trim: [0.06, 2.28] }), F(140726, { trim: [0, 1.4], delay: 0.09, semis: 1, gainDb: -2 }), F(455547, { trim: [0, 1.6], delay: 0.16, gainDb: -3 })], fadeOut: 0.4 }] },
  'harpoon-throw': { category: 'weapon', gain: 0.6, pitch: 1, minInterval: 0.08, maxPerFrame: 2, desc: 'harpoon launch', files: [{ layers: [F(163453), F(523230, { trim: [0, 0.5], delay: 0.02, gainDb: -3 })] }, { layers: [F(249810, { trim: [0.54, 0.85] }), F(523230, { trim: [0, 0.5], delay: 0.01, semis: -2, gainDb: -3 })] }] },
  'harpoon-hit': { category: 'weapon', gain: 0.6, pitch: 1.2, minInterval: 0.06, maxPerFrame: 2, desc: 'harpoon strikes timber', files: [{ layers: [F(534956, { trim: [0.05, 0.62], fadeOut: 0.15 }), K('impact-sounds', 'impactMetal_heavy_000', { gainDb: -6, semis: -3 })] }, { layers: [F(205938, { trim: [0, 0.61], fadeOut: 0.15 }), K('impact-sounds', 'impactMetal_heavy_001', { gainDb: -6, semis: -4 })] }] },
  'lightning-zap': { category: 'weapon', gain: 0.6, pitch: 1.5, minInterval: 0.05, maxPerFrame: 2, desc: 'electric arc', files: [F(136542, { trim: [0, 0.75], fadeOut: 0.15 }), F(403252, { trim: [0.74, 1.25], fadeOut: 0.1 }), F(403252, { trim: [1.62, 2.1], fadeOut: 0.1 }), F(264779, { trim: [0.09, 0.4], fadeOut: 0.06 })] },
  lance: { category: 'weapon', gain: 0.8, pitch: 1, priority: 60, minInterval: 0.08, maxPerFrame: 2, desc: 'Lance of Dawn: arc + gun', files: [{ layers: [F(403252, { trim: [2.23, 2.7] }), F(175430, { trim: [0, 0.78], semis: -2, gainDb: -2 })], fadeOut: 0.25 }] },
  'mine-drop': { category: 'weapon', gain: 0.5, pitch: 1.5, minInterval: 0.1, maxPerFrame: 2, desc: 'mine dropped overboard', files: [{ layers: [F(404829, { trim: [0, 0.8] }), K('impact-sounds', 'impactMetal_light_000', { gainDb: -8, semis: -5 })], fadeOut: 0.2 }] },
  'barrel-drop': { category: 'weapon', gain: 0.55, pitch: 1.5, minInterval: 0.1, maxPerFrame: 2, desc: 'barrel dropped astern', files: [{ layers: [K('impact-sounds', 'impactWood_heavy_001', { semis: -3 }), F(398032, { delay: 0.06, gainDb: -2 })], fadeOut: 0.3 }] },
  fuse: { category: 'weapon', gain: 0.35, pitch: 1, minInterval: 0.3, desc: 'burning fuse', files: [F(45650, { trim: [0.1, 2.6], fadeIn: 0.05, fadeOut: 0.4 })] },
  flare: { category: 'weapon', gain: 0.6, minInterval: 0.4, desc: 'signal flare launch', files: [{ layers: [F(587173, { trim: [0.06, 1.8] }), F(186933, { delay: 0.35, gainDb: -3 })], fadeOut: 0.4 }] },
  'water-bolt': { category: 'weapon', gain: 0.55, pitch: 2, minInterval: 0.05, maxPerFrame: 3, desc: 'water projectile swish', files: [F(321489, { trim: [0.06, 0.62], fadeOut: 0.12 }), F(151289, { trim: [0, 0.62], fadeOut: 0.12 })] },
  'whirlpool-cast': { category: 'weapon', gain: 0.6, pitch: 1, minInterval: 0.3, desc: 'whirlpool opens', files: [F(537920, { trim: [0, 1.0], fadeOut: 0.25 })] },
  reload: { category: 'weapon', gain: 0.35, pitch: 1, minInterval: 0.5, desc: 'manual broadside reloaded', files: [{ layers: [K('rpg-audio', 'metalLatch', { semis: -3 }), K('impact-sounds', 'impactPlank_medium_001', { delay: 0.12, semis: -4, gainDb: -2 })] }] },

  // ───────────── impacts ─────────────
  'hit-wood': { category: 'impact', gain: 0.6, pitch: 1.5, gainJitter: 1.5, minInterval: 0.05, maxPerFrame: 2, desc: 'shot hits a hull', files: [F(853277, { trim: [0, 0.6], fadeOut: 0.15 }), F(257752, { trim: [0, 1.4], fadeOut: 0.4 }), F(536777, { trim: [0, 0.9], fadeOut: 0.2 }), F(66772, { trim: [0, 1.0], fadeOut: 0.25 })] },
  'hit-wood-light': { category: 'impact', gain: 0.45, pitch: 2, minInterval: 0.05, maxPerFrame: 2, desc: 'small shot hits wood', files: [K('impact-sounds', 'impactWood_medium_000'), K('impact-sounds', 'impactWood_medium_001'), K('impact-sounds', 'impactPlank_medium_001')] },
  'hit-wood-heavy': { category: 'impact', gain: 0.7, pitch: 1.2, minInterval: 0.05, maxPerFrame: 3, desc: 'heavy shot splinters timber', files: [F(443293, { trim: [0, 0.86], fadeOut: 0.2 }), F(183450, { trim: [0.05, 1.1], fadeOut: 0.25 }), F(501302, { trim: [0, 1.2], fadeOut: 0.3 })] },
  splinters: { category: 'impact', gain: 0.45, pitch: 2, minInterval: 0.08, maxPerFrame: 2, desc: 'wood debris', files: [F(452554, { trim: [0, 0.58], fadeOut: 0.15 }), F(562187, { trim: [0.45, 1.8], fadeOut: 0.3 })] },
  'sail-rip': { category: 'impact', gain: 0.4, pitch: 1.5, minInterval: 0.45, maxPerFrame: 1, desc: 'chain shot shreds canvas', files: [F(591195, { trim: [0, 0.7], fadeOut: 0.15 }), F(565970, { trim: [0, 0.8], fadeOut: 0.15 })] },
  'hit-metal': { category: 'impact', gain: 0.55, pitch: 1.5, minInterval: 0.05, maxPerFrame: 2, desc: 'shot rings off iron plate', files: [K('impact-sounds', 'impactMetal_heavy_000', { semis: -3 }), K('impact-sounds', 'impactMetal_heavy_002', { semis: -4 }), K('impact-sounds', 'impactPlate_heavy_000', { semis: -3 })] },
  'hit-flesh': { category: 'impact', gain: 0.6, pitch: 1.5, minInterval: 0.06, maxPerFrame: 2, desc: 'shot thumps the serpent', files: [K('impact-sounds', 'impactPunch_heavy_000', { semis: -6, lowpass: 2500 }), K('impact-sounds', 'impactPunch_heavy_001', { semis: -7, lowpass: 2500 })] },
  'hit-rock': { category: 'impact', gain: 0.5, pitch: 1.5, minInterval: 0.08, maxPerFrame: 2, desc: 'shot hits rock / hull scrapes an island', files: [F(385938, { trim: [0.1, 0.62], fadeOut: 0.12 }), F(522099, { trim: [0, 0.9], fadeOut: 0.25 })] },
  'splash-small': { category: 'impact', gain: 0.45, pitch: 2, gainJitter: 2, priority: 25, minInterval: 0.06, maxPerFrame: 2, desc: 'shot plunges into the sea', files: [F(404829, { trim: [0, 0.8], fadeOut: 0.2 }), F(398032, { trim: [0, 1.3], fadeOut: 0.3 }), F(189504, { trim: [0.05, 1.2], fadeOut: 0.35 }), F(583348, { trim: [0, 2.0], fadeOut: 0.5 })] },
  'splash-large': { category: 'impact', gain: 0.65, pitch: 1.5, priority: 45, minInterval: 0.08, maxPerFrame: 2, desc: 'big splash', files: [F(442773, { trim: [0, 2.17], fadeOut: 0.4 }), F(469608, { trim: [0, 1.75], fadeOut: 0.4 }), F(436792, { trim: [0, 1.78], fadeOut: 0.4 })] },
  crit: { category: 'impact', gain: 0.5, pitch: 1, priority: 50, minInterval: 0.07, maxPerFrame: 1, desc: 'critical hit accent', files: [{ layers: [K('impact-sounds', 'impactBell_heavy_001', { semis: 5, gainDb: -3 }), K('impact-sounds', 'impactPunch_heavy_002', { semis: -2 })], fadeOut: 0.2 }, { layers: [K('impact-sounds', 'impactMetal_light_002', { semis: 2 }), K('impact-sounds', 'impactPunch_heavy_000', { semis: -3 })], fadeOut: 0.2 }] },
  'ram-crash': { category: 'impact', gain: 0.85, pitch: 1, priority: 75, minInterval: 0.15, maxPerFrame: 1, desc: 'ramming crunch', files: [{ layers: [F(257752, { trim: [0, 2.2] }), K('impact-sounds', 'impactWood_heavy_002', { semis: -5 })], fadeOut: 0.5 }, F(139952, { trim: [0.7, 3.2], fadeOut: 0.7 })] },
  'collide-ship': { category: 'impact', gain: 0.55, pitch: 1.5, minInterval: 0.2, maxPerFrame: 1, desc: 'hulls bump', files: [K('impact-sounds', 'impactWood_heavy_003', { semis: -4 }), F(449955, { trim: [0, 0.48], semis: -3, fadeOut: 0.12 })] },

  // ───────────── explosions ─────────────
  'explosion-small': { category: 'explosion', gain: 0.75, pitch: 1.2, priority: 55, minInterval: 0.07, maxPerFrame: 2, desc: 'small blast', files: [F(207322, { trim: [0, 1.42], fadeOut: 0.4 }), F(609587, { trim: [0, 2.6], fadeOut: 0.8 }), F(182429, { trim: [0, 2.2], fadeOut: 0.6 }), F(258195, { trim: [0, 1.9], fadeOut: 0.5 })] },
  'explosion-large': { category: 'explosion', gain: 0.95, pitch: 1, priority: 75, minInterval: 0.12, maxPerFrame: 2, desc: 'big blast with debris', files: [F(235968, { trim: [0.3, 6.0], fadeOut: 1.5 }), F(132929, { trim: [0, 4.6], fadeOut: 1.2 }), F(259300, { trim: [0, 4.2], fadeOut: 1.2 })] },
  'explosion-powder': { category: 'explosion', gain: 1, pitch: 0.8, priority: 85, minInterval: 0.2, maxPerFrame: 1, desc: 'powder keg', files: [{ layers: [F(259300, { trim: [0, 5.0] }), F(132929, { trim: [2.1, 6.5], delay: 0.4, gainDb: -4 })], fadeOut: 1.5 }, { layers: [F(235968, { trim: [0.3, 5.5] }), F(241601, { trim: [0, 1.4], delay: 0.2, gainDb: -3 })], fadeOut: 1.4 }] },
  'explosion-water': { category: 'explosion', gain: 0.8, pitch: 1, priority: 60, minInterval: 0.1, maxPerFrame: 2, desc: 'underwater blast / geyser', files: [F(212689, { trim: [0, 2.5], fadeOut: 0.6 }), F(519008, { trim: [0, 1.99], fadeOut: 0.5 }), F(147876, { trim: [0, 3.5], fadeOut: 1.0 })] },
  shockwave: { category: 'explosion', gain: 0.75, pitch: 1, priority: 70, minInterval: 0.2, maxPerFrame: 1, desc: 'deep boom + air', files: [F(255111, { trim: [0, 3.0], fadeOut: 1.0 }), F(268084, { trim: [0, 3.2], fadeOut: 1.0 })] },
  'fire-burst': { category: 'explosion', gain: 0.65, pitch: 1.5, minInterval: 0.08, maxPerFrame: 2, desc: 'fireball', files: [F(267887, { trim: [0, 1.1], fadeOut: 0.3 }), F(431174, { trim: [0, 0.95], fadeOut: 0.25 }), F(244926, { trim: [0, 1.9], fadeOut: 0.5 })] },
  'wave-roar': { category: 'explosion', gain: 0.8, pitch: 1, priority: 70, minInterval: 0.5, maxPerFrame: 1, desc: 'great wave crashes', files: [{ layers: [F(412308, { trim: [113.5, 120.5], gainDb: 4 }), F(268084, { trim: [0, 2.5], gainDb: -8 }), F(237980, { gainDb: -8 })], fadeOut: 1.5 }, { layers: [F(412308, { trim: [259, 266], gainDb: 4 }), F(249414, { trim: [4.3, 9.0], gainDb: -6 })], fadeOut: 1.5 }] },
  'thunder-near': { category: 'explosion', gain: 0.85, pitch: 1, priority: 70, minInterval: 0.3, maxPerFrame: 1, desc: 'lightning crack + rumble', files: [F(475094, { trim: [0.1, 3.5], fadeOut: 1.0 }), F(646912, { trim: [0.5, 8.8], fadeOut: 2.0 }), F(188767, { trim: [0.03, 3.6], fadeOut: 1.0 })] },

  // ───────────── world ─────────────
  'fire-ignite': { category: 'world', gain: 0.5, pitch: 1.5, minInterval: 0.1, maxPerFrame: 2, desc: 'fire catches', files: [F(260554, { trim: [0, 1.8], fadeOut: 0.5 }), F(539972, { trim: [0, 0.76], fadeOut: 0.2 }), F(348767, { trim: [0, 2.0], fadeOut: 0.6, limitDb: 9 })] },
  'thunder-far': { category: 'world', gain: 0.6, pitch: 1, minInterval: 1, maxPerFrame: 1, ref: 400, maxDistance: 3000, desc: 'distant thunder', files: [F(581124, { trim: [0.4, 7.6], fadeOut: 2.0 }), F(347562, { trim: [3.7, 14.0], fadeOut: 3.0 })] },
  'ship-break': { category: 'world', gain: 0.7, pitch: 1.2, priority: 50, minInterval: 0.15, maxPerFrame: 1, desc: 'hull breaking up', files: [F(494071, { trim: [2.4, 6.6], fadeOut: 1.0 }), F(183452, { trim: [0.15, 2.9], fadeOut: 0.6 }), F(257752, { trim: [0, 3.3], fadeOut: 0.8 })] },
  'ship-sink': { category: 'world', gain: 0.55, pitch: 1.2, minInterval: 0.6, maxPerFrame: 1, desc: 'sinking: groan + bubbles', files: [{ layers: [F(173439, { trim: [0, 5.5] }), F(338286, { trim: [0.7, 3.9], semis: -5, gainDb: -2 }), F(423959, { trim: [1.6, 5.0], delay: 0.5, gainDb: -6 })], fadeOut: 1.2 }, { layers: [F(539823, { trim: [0.8, 4.3] }), F(496836, { trim: [0.4, 4.5], semis: -3, lowpass: 2500, gainDb: -3 })], fadeOut: 1.2 }] },
  'hull-creak': { category: 'player', gain: 0.4, pitch: 1.5, minInterval: 1.2, maxPerFrame: 1, desc: 'timbers creak', files: [F(31574, { trim: [3.2, 5.3], fadeIn: 0.05, fadeOut: 0.5 }), K('rpg-audio', 'creak3', { semis: -3 }), K('rpg-audio', 'creak1', { semis: -4 }), K('rpg-audio', 'creak2', { semis: -5 })] },
  gull: { category: 'world', gain: 0.35, pitch: 1, minInterval: 1.2, maxPerFrame: 1, desc: 'seagull call', files: [F(683400, { trim: [0.02, 1.05], fadeOut: 0.2 }), F(683400, { trim: [3.03, 3.62], fadeOut: 0.15 }), F(73497, { trim: [0.4, 1.4], fadeOut: 0.2 }), F(75195, { trim: [0.08, 0.9], fadeOut: 0.2 })] },
  'ship-bell': { category: 'world', gain: 0.5, pitch: 0.3, minInterval: 0.5, maxPerFrame: 1, desc: "ship's bell", files: [SHIP_BELL, F(353232, { trim: [0.3, 2.6], fadeOut: 0.6 })] },
  'alarm-bell': { category: 'world', gain: 0.55, minInterval: 2, maxPerFrame: 1, ref: 400, desc: 'tall-ship alarm bell (director events)', files: [F(418705, { trim: [0.95, 4.6], fadeOut: 0.8 })] },
  warning: { category: 'alert', gain: 0.55, pitch: 1, priority: 95, minInterval: 0.25, maxPerFrame: 1, desc: 'telegraph warning drum (alert: never stolen)', files: [F(369394, { trim: [0, 2.0], fadeOut: 0.6 })] },

  // ───────────── player ─────────────
  'player-hit': { category: 'player', gain: 0.85, pitch: 1, priority: 90, minInterval: 0.08, maxPerFrame: 1, desc: 'our hull is hit', files: [{ layers: [F(853277, { trim: [0, 0.6] }), K('impact-sounds', 'impactPunch_heavy_000', { semis: -6, lowpass: 1200, gainDb: -2 })], fadeOut: 0.2 }, { layers: [F(443293, { trim: [0, 0.8] }), K('impact-sounds', 'impactWood_heavy_004', { semis: -4, gainDb: -3 })], fadeOut: 0.2 }, { layers: [F(66772, { trim: [0, 1.0] }), K('impact-sounds', 'impactPunch_heavy_001', { semis: -6, lowpass: 1200, gainDb: -2 })], fadeOut: 0.25 }] },
  brace: { category: 'player', gain: 0.6, minInterval: 0.2, desc: 'brace: timbers tense', files: [{ layers: [K('impact-sounds', 'impactWood_heavy_000', { semis: -6, lowpass: 1500 }), K('rpg-audio', 'creak3', { delay: 0.05, semis: -2, gainDb: -2 })] }, { layers: [K('impact-sounds', 'impactSoft_heavy_000', { semis: -4 }), K('rpg-audio', 'creak1', { delay: 0.03, semis: -3, gainDb: -2 })] }] },
  'brace-hit': { category: 'player', gain: 0.7, pitch: 1, priority: 85, minInterval: 0.1, maxPerFrame: 1, desc: 'braced hit: dull thud', files: [{ layers: [K('impact-sounds', 'impactSoft_heavy_001', { semis: -5 }), K('impact-sounds', 'impactWood_heavy_001', { semis: -7, lowpass: 900, gainDb: -2 })] }, { layers: [K('impact-sounds', 'impactSoft_heavy_000', { semis: -6 }), K('impact-sounds', 'impactWood_heavy_003', { semis: -8, lowpass: 900, gainDb: -2 })] }] },
  parry: { category: 'player', gain: 0.75, pitch: 0.5, priority: 90, minInterval: 0.15, maxPerFrame: 1, desc: 'parry clang', files: [{ layers: [K('impact-sounds', 'impactMetal_heavy_002'), K('impact-sounds', 'impactBell_heavy_002', { semis: 2, gainDb: -3 })] }, { layers: [K('impact-sounds', 'impactMetal_heavy_003'), K('impact-sounds', 'impactBell_heavy_003', { semis: 1, gainDb: -3 })] }] },
  boost: { category: 'player', gain: 0.55, pitch: 0.8, minInterval: 0.3, desc: 'gust fills the sails', files: [{ layers: [F(683101, { trim: [0, 1.6] }), F(428337, { trim: [0.06, 0.8], delay: 0.05, gainDb: -2 })], fadeOut: 0.4 }, { layers: [F(237980, { trim: [0.2, 2.4] }), F(244982, { trim: [0, 0.8], delay: 0.1, gainDb: -3 })], fadeOut: 0.4 }] },
  heal: { category: 'player', gain: 0.5, minInterval: 0.5, desc: 'repair / heal shimmer', files: [F(351408, { trim: [1.1, 4.1], fadeOut: 0.8 }), F(511484, { trim: [0, 2.2], fadeOut: 0.6 })] },
  'shield-up': { category: 'player', gain: 0.45, minInterval: 0.5, desc: 'ward shimmer', files: [K('sci-fi-sounds', 'forceField_000', { lowpass: 6000 }), K('sci-fi-sounds', 'forceField_001', { lowpass: 6000 })] },
  'dash-whoosh': { category: 'player', gain: 0.6, minInterval: 0.3, desc: 'Lionburst leap', files: [F(237980, { trim: [0, 2.9], fadeOut: 0.5 })] },
  dive: { category: 'player', gain: 0.6, minInterval: 0.5, desc: 'Deep Dive: submerge', files: [{ layers: [F(173438, { trim: [0.2, 1.5] }), F(539823, { trim: [1.2, 3.4], delay: 0.4, gainDb: -3 })], fadeOut: 0.6 }] },
  'crew-cheer': { category: 'player', gain: 0.45, pitch: 0.6, minInterval: 3, maxPerFrame: 1, desc: 'crew cheers', files: [F(57204, { trim: [0, 1.25], fadeOut: 0.3 }), F(182571, { trim: [0.28, 3.0], fadeIn: 0.05, fadeOut: 0.8 }), F(139973, { trim: [0.2, 3.5], fadeOut: 0.9 })] },
  'ultimate-sting': { category: 'player', gain: 0.7, minInterval: 1, priority: 95, desc: 'ultimate: orchestral hit', files: [F(427803, { trim: [0, 3.4], fadeOut: 0.9 })] },
  'war-horn': { category: 'boss', gain: 0.7, minInterval: 1.5, maxPerFrame: 1, desc: 'battle horn', files: [F(188815, { trim: [0.1, 6.3], fadeOut: 1.5 })] },

  // ───────────── bosses ─────────────
  'boss-horn': { category: 'boss', gain: 0.9, minInterval: 2, maxPerFrame: 1, priority: 95, desc: 'deep foghorn (boss warning)', files: [F(99630, { trim: [0, 6.5], fadeOut: 1.5 }), F(69663, { trim: [0.45, 7.0], fadeOut: 1.5 })] },
  'serpent-roar': { category: 'boss', gain: 0.95, pitch: 1, minInterval: 1, maxPerFrame: 1, priority: 95, desc: 'Tidewyrm roar', files: [F(398908, { trim: [1.45, 4.8], fadeOut: 0.8, semis: -2 }), F(85568, { trim: [0, 1.65], semis: -3, fadeOut: 0.4 }), F(145729, { trim: [0.6, 3.3], semis: -2, fadeOut: 0.7 })] },
  'elite-spawn': { category: 'world', gain: 0.55, minInterval: 1.5, maxPerFrame: 1, desc: 'elite sighted: gong', files: [F(121800, { trim: [0.1, 4.0], fadeOut: 1.2 })] },
  'metal-groan': { category: 'boss', gain: 0.6, minInterval: 1, maxPerFrame: 1, desc: 'armour plates tear', files: [F(496836, { trim: [0.38, 4.5], fadeOut: 0.8 }), F(556714, { trim: [0.28, 3.55], fadeOut: 0.6 })] },

  // ───────────── pickups ─────────────
  'coin-copper': { category: 'pickup', gain: 0.3, pitch: 0.5, gainJitter: 1, priority: 20, minInterval: 0.055, maxPerFrame: 1, desc: 'copper coin tink', files: [F(146723, { trim: [0, 0.14] }), F(17502, { trim: [0.22, 0.5], fadeOut: 0.08, limitDb: 12 }), F(17502, { trim: [0.48, 0.8], fadeOut: 0.08, limitDb: 12 })] },
  'coin-silver': { category: 'pickup', gain: 0.33, pitch: 0.5, priority: 25, minInterval: 0.06, maxPerFrame: 1, desc: 'silver coins clink', files: [F(512216, { trim: [0, 0.44], fadeOut: 0.1 }), F(248143, { trim: [0, 0.6], fadeOut: 0.15 })] },
  'coin-gold': { category: 'pickup', gain: 0.4, pitch: 0.5, priority: 30, minInterval: 0.06, maxPerFrame: 2, desc: 'gold bar / coin pile', files: [K('rpg-audio', 'handleCoins'), F(338260, { trim: [0.2, 1.2], fadeOut: 0.3 })] },
  doubloon: { category: 'pickup', gain: 0.45, pitch: 0.5, priority: 40, minInterval: 0.06, maxPerFrame: 2, desc: 'doubloon: coin + shimmer', files: [{ layers: [F(248143, { trim: [0, 0.6] }), F(545238, { delay: 0.05, gainDb: -4 })], fadeOut: 0.15 }, { layers: [F(512216, { trim: [0, 0.44], semis: 2 }), F(545238, { delay: 0.04, semis: 2, gainDb: -4 })], fadeOut: 0.15 }] },
  'chest-open': { category: 'pickup', gain: 0.6, priority: 70, minInterval: 0.3, desc: 'treasure chest opens', files: [F(202092, { trim: [0.1, 3.0], fadeOut: 0.6 }), F(573654, { trim: [0, 2.3], fadeOut: 0.4, limitDb: 10 })] },
  compass: { category: 'pickup', gain: 0.5, minInterval: 0.5, desc: 'compass: magnet all treasure', files: [F(442774, { trim: [0, 1.62], fadeOut: 0.4 })] },
  'treasure-sparkle': { category: 'pickup', gain: 0.4, minInterval: 0.15, desc: 'glint / reward sparkle', files: [F(545238), F(511485, { trim: [0, 1.0], fadeOut: 0.3 })] },
  repair: { category: 'pickup', gain: 0.5, minInterval: 0.3, desc: 'repair crate: hammering', files: [F(17012, { trim: [0, 1.5], fadeOut: 0.3 }), F(207782, { trim: [0.15, 2.1], fadeOut: 0.4 })] },

  // ───────────── round 2: FOES (state diffs in watch.ts, events in router.ts) ─────────────
  'marked': { category: 'alert', gain: 0.6, priority: 95, minInterval: 2, maxPerFrame: 1, desc: 'Marked! a signal flare has you: quick double bell', files: [{ layers: [F(353233, { trim: [0.1, 1.1], semis: 5 }), F(353233, { trim: [0.1, 1.4], semis: 5, delay: 0.2, gainDb: -1 }), K('interface-sounds', 'glass_005', { semis: 2, gainDb: -6 })], fadeOut: 0.5 }] },
  'flare-pop': { category: 'weapon', gain: 0.6, pitch: 1, priority: 55, minInterval: 0.3, maxPerFrame: 1, desc: 'signal flare bursts overhead', files: [{ layers: [F(140711, { trim: [0.04, 0.29] }), F(348766, { trim: [0, 0.7], delay: 0.03, gainDb: -6 })], fadeOut: 0.25 }] },
  'flare-hang': { category: 'weapon', gain: 0.35, minInterval: 0.5, maxPerFrame: 1, desc: 'flare hangs and fizzes', files: [F(348766, { trim: [2.4, 6.6], fadeIn: 0.15, fadeOut: 1.8 })] },
  'steam-whistle': { category: 'world', gain: 0.55, pitch: 0.5, priority: 70, minInterval: 1.5, maxPerFrame: 1, ref: 120, desc: 'ironclad steam whistle before its charge', files: [F(71778, { trim: [0.05, 2.6], fadeOut: 0.6 })] },
  'rope-snap': { category: 'weapon', gain: 0.65, pitch: 1, priority: 60, minInterval: 0.3, maxPerFrame: 1, desc: 'harpoon line snaps', files: [{ layers: [F(529925, { trim: [0, 0.26] }), F(540266, { trim: [0, 0.3], delay: 0.012, gainDb: -2 }), K('impact-sounds', 'impactMetal_light_000', { delay: 0.02, semis: 3, gainDb: -9 })], fadeOut: 0.12 }] },
  'wisp-latch': { category: 'world', gain: 0.5, pitch: 1.5, priority: 60, minInterval: 0.25, maxPerFrame: 1, desc: 'lantern wisp latches on: eerie chime', files: [{ layers: [K('interface-sounds', 'glass_003', { semis: -5 }), K('impact-sounds', 'impactBell_heavy_001', { semis: 7, delay: 0.03, gainDb: -8 }), F(752478, { trim: [2, 3.2], delay: 0.05, gainDb: -10 })], fadeOut: 0.6 }] },
  'wisp-burst': { category: 'explosion', gain: 0.6, pitch: 1.5, priority: 60, minInterval: 0.12, maxPerFrame: 2, desc: 'lantern wisp bursts: glassy shatter + spectral puff', files: [{ layers: [F(202093, { trim: [0.3, 1.11], semis: 4 }), K('interface-sounds', 'glass_005', { semis: -4, gainDb: -4 }), F(807221, { trim: [0.07, 1.6], delay: 0.02, gainDb: -8, fadeOut: 0.8 })], fadeOut: 0.5 }] },
  'galleon-rise': { category: 'boss', gain: 0.75, pitch: 0.5, priority: 80, minInterval: 1, maxPerFrame: 1, desc: 'drowned galleon rising: deep groan + bubbles', files: [{ layers: [F(496836, { trim: [0.38, 4.5], semis: -6, fadeIn: 0.6 }), F(423959, { trim: [1.6, 5.0], delay: 0.3, gainDb: -3, fadeIn: 0.5 }), F(31574, { trim: [3.2, 5.3], semis: -5, delay: 1, gainDb: -6 })], fadeOut: 0.8 }] },
  'galleon-breach': { category: 'explosion', gain: 0.9, pitch: 0.5, priority: 80, minInterval: 0.5, maxPerFrame: 1, desc: 'drowned galleon breaches: surge, splash and its drowned bell', files: [{ layers: [F(442773, { trim: [0, 2.17] }), F(212689, { trim: [0, 2.5], delay: 0.05, gainDb: -3 }), F(353233, { trim: [0.1, 2.9], semis: -7, delay: 0.35, gainDb: -3 })], fadeOut: 0.9 }] },
  'shield-shatter': { category: 'impact', gain: 0.6, pitch: 1.5, priority: 60, minInterval: 0.25, maxPerFrame: 1, desc: "an elite's ward bubble shatters", files: [{ layers: [F(221528, { trim: [0.3, 1.5] }), K('sci-fi-sounds', 'forceField_001', { semis: 5, gainDb: -8 })], fadeOut: 0.4 }] },
  'vamp-siphon': { category: 'world', gain: 0.5, pitch: 1, minInterval: 0.8, maxPerFrame: 1, desc: 'vampiric elite siphons hull: reversed rush + spectral breath', files: [{ layers: [F(683101, { trim: [0, 1.2], reverse: true, semis: -3 }), F(807221, { trim: [0.07, 1.4], delay: 0.35, gainDb: -8 })], fadeOut: 0.3 }] },
  'smoke-pot': { category: 'world', gain: 0.55, pitch: 1.5, minInterval: 0.3, maxPerFrame: 1, desc: 'smoke pot: low whoomph + hiss', files: [{ layers: [F(244926, { trim: [0, 1.9], semis: -5, lowpass: 1800 }), F(234782, { trim: [0, 1.47], delay: 0.08, gainDb: -5 })], fadeOut: 0.5 }] },
  'kraken-squeeze': { category: 'player', gain: 0.75, pitch: 1, priority: 90, minInterval: 1, maxPerFrame: 1, desc: 'kraken grips the hull: timbers groan, wet squeeze', files: [{ layers: [F(31574, { trim: [3.2, 5.3], semis: -3 }), K('rpg-audio', 'creak1', { semis: -6, delay: 0.1, gainDb: -2 }), F(447929, { trim: [0.04, 0.87], semis: -5, delay: 0.05, gainDb: -4 })], fadeOut: 0.5 }] },
  'ink-splash': { category: 'impact', gain: 0.65, pitch: 1.5, priority: 55, minInterval: 0.2, maxPerFrame: 1, desc: 'kraken arm sinks: ink splat + splash', files: [{ layers: [F(445118, { trim: [0, 0.78], semis: -4 }), F(442773, { trim: [0, 1.7], delay: 0.08, gainDb: -5 })], fadeOut: 0.4 }] },

  // ───────────── round 2: EVENTS and points of interest ─────────────
  'lava-launch': { category: 'explosion', gain: 0.55, pitch: 1.5, minInterval: 0.25, maxPerFrame: 1, ref: 150, desc: 'eruption hurls a lava bomb', files: [{ layers: [F(529239, { trim: [0, 2.2], semis: -4 }), F(267887, { trim: [0, 1.1], delay: 0.05, gainDb: -4 })], fadeOut: 0.6 }] },
  'coin-shower': { category: 'pickup', gain: 0.5, pitch: 0.5, priority: 45, minInterval: 0.3, maxPerFrame: 1, desc: 'gold bomb lands: a shower of coins', files: [{ layers: [K('rpg-audio', 'handleCoins'), F(338260, { trim: [0.2, 1.2], delay: 0.08, gainDb: -2 }), F(248143, { trim: [0, 0.6], delay: 0.2, semis: 2, gainDb: -3 }), F(545238, { delay: 0.12, gainDb: -6 })], fadeOut: 0.3 }] },
  'salvage-haul': { category: 'pickup', gain: 0.55, priority: 45, minInterval: 0.5, maxPerFrame: 1, desc: 'salvage hauled aboard: crate thump + coins', files: [{ layers: [K('impact-sounds', 'impactPlank_medium_000', { semis: -4 }), K('rpg-audio', 'creak2', { delay: 0.05, semis: -2, gainDb: -5 }), K('rpg-audio', 'handleCoins2', { delay: 0.28, gainDb: -1 })], fadeOut: 0.3 }] },
  'beacon-bell': { category: 'world', gain: 0.6, priority: 60, minInterval: 1, maxPerFrame: 1, ref: 150, desc: "lighthouse keeper's bell + blessing shimmer", files: [{ layers: [F(353233, { trim: [0.1, 2.9] }), F(353233, { trim: [0.1, 2.9], delay: 0.45, semis: 5, gainDb: -4 }), F(511485, { trim: [0, 1.0], delay: 0.3, gainDb: -3 }), F(545238, { delay: 0.7, gainDb: -4 })], fadeOut: 0.8 }] },
  'wind-gust': { category: 'player', gain: 0.5, minInterval: 3, maxPerFrame: 1, desc: 'trade wind fills the sails: gust', files: [{ layers: [F(344887, { trim: [2, 5.5], fadeIn: 0.8 }), F(683101, { trim: [0, 1.6], delay: 0.3, gainDb: -5 }), F(428337, { trim: [0.06, 0.8], delay: 0.45, gainDb: -8 })], fadeOut: 1.2 }] },

  // ───────────── round 2: PACE ─────────────
  'momentum-swell': { category: 'player', gain: 0.5, minInterval: 1.5, maxPerFrame: 1, desc: 'Momentum: sails snap full, a swell of wind', files: [{ layers: [F(428337, { trim: [0.06, 0.8] }), F(683101, { trim: [0, 1.6], delay: 0.04, gainDb: -3 }), F(237980, { trim: [0.2, 1.6], delay: 0.1, gainDb: -9 })], fadeOut: 0.4 }] },
  'momentum-luff': { category: 'player', gain: 0.4, minInterval: 1.5, maxPerFrame: 1, desc: 'Momentum spent: the sails luff softly', files: [{ layers: [K('rpg-audio', 'cloth1', { semis: -5 }), K('rpg-audio', 'cloth3', { semis: -7, delay: 0.16, gainDb: -3 }), F(344887, { trim: [6, 8], fadeIn: 0.2, gainDb: -10 })], fadeOut: 0.8 }] },
  'boost-light': { category: 'player', gain: 0.45, pitch: 0.8, minInterval: 0.3, desc: 'boost with a charge to spare: a lighter gust', files: [{ layers: [F(683101, { trim: [0, 1.1], semis: 2 }), F(428337, { trim: [0.06, 0.6], delay: 0.04, semis: 1, gainDb: -7 })], fadeOut: 0.3 }] },

  // ───────────── round 2: crew barks (owner-generated voices, barks.ts decides when anyone shouts) ─────────────
  'bark-fire': { ...BARK, desc: 'bosun: "Fire!" / "Fire as she bears!" / "Give \'em a broadside!"', files: [G('fire-1', 1.35), G('fire-2', 3.0), G('fire-3', 3.2)] },
  'bark-brace': { ...BARK, desc: 'bosun: "Brace! Brace!" / "Hold fast, lads!"', files: [G('brace-1', 2.2), G('brace-2', 1.9)] },
  'bark-boss': { ...BARK, desc: 'bosun: "Boss off the bow! Stand to your guns!"', files: [G('boss', 4.75)] },
  'bark-sink': { ...BARK, desc: 'bosun: "She\'s going down!" / "Down she goes!"', files: [G('sink-1', 2.6), G('sink-2', 2.78)] },
  'bark-level': { ...BARK, desc: 'bosun: "Level up, captain!"', files: [G('level', 3.0)] },
  'bark-water': { ...BARK, desc: 'bosun: "We\'re taking water!" / "Hull\'s breached! Patch her up!"', files: [G('water-1', 2.78), G('water-2', 4.0)] },
  'bark-harpoon': { ...BARK, desc: 'bosun: "Harpoon on the hull! Boost to snap the line!"', files: [G('harpoon', 5.5)] },
  'bark-kraken': { ...BARK, desc: 'bosun: "Kraken! All hands!"', files: [G('kraken', 2.78)] },
  'bark-grab': { ...BARK, desc: 'bosun: "It\'s got us! Boost free!"', files: [G('grab', 3.58)] },
  'bark-whirlpool': { ...BARK, desc: 'bosun: "Whirlpool off the bow!"', files: [G('whirlpool', 2.7)] },
  'bark-blockade': { ...BARK, desc: 'bosun: "Blockade ahead! Run out the guns!"', files: [G('blockade', 4.4)] },
  'bark-victory': { ...BARK, desc: 'bosun: "Victory! The sea is ours!"', files: [G('victory', 3.4)] },
  'bark-guns': { ...BARK, desc: 'bosun: "Man the guns!"', files: [G('guns', 2.78)] },
  'bark-marked': { ...BARK, desc: 'lookout: "They\'ve marked us! Here they come!"', files: [G('marked', 3.0)] },
  'bark-wisps': { ...BARK, desc: 'lookout: "Wisps on the hull! Brace to shake \'em off!"', files: [G('wisps', 3.9)] },
  'bark-wave': { ...BARK, desc: 'lookout: "Rogue wave! Boost through it!"', files: [G('wave', 3.5)] },
  'bark-ghosts': { ...BARK, desc: 'lookout: "Ghost ships rising!"', files: [G('ghosts', 2.0)] },
  'bark-eruption': { ...BARK, desc: 'lookout: "Eruption! Watch the sky!"', files: [G('eruption', 2.1)] },
  'bark-treasure': { ...BARK, desc: 'lookout: "Treasure ho!"', files: [G('treasure', 1.55)] },
  'bark-rising': { ...BARK, desc: 'lookout: "Something\'s rising below us!"', files: [G('rising', 3.5)] },
  'bark-captain-down': { ...BARK, desc: 'lookout: "Captain down! Cover them!"', files: [G('captain-down', 3.9)] },
  'bark-rider': { ...BARK, desc: 'lookout: "Wave rider! Ha ha!"', files: [G('rider', 3.1)] },
  'bark-beacon': { ...BARK, desc: 'lookout: "The lighthouse blesses us, captain!"', files: [G('beacon', 2.2)] },
  'bark-elite': { ...BARK, desc: 'lookout: "Elite sighted! Mind her guns!"', files: [G('elite', 4.4)] },

  // ───────────── ambience beds (loops) ─────────────
  'amb-ocean': { category: 'ambience', rate: 32000, gain: 1, desc: 'open-sea wash', files: [F(176617, { trim: [118, 148], loop: { xfade: 3 }, norm: 'bed' })] },
  'amb-bow-wash': { category: 'ambience', rate: 32000, gain: 1, desc: 'bow wave along the hull (rate follows speed)', files: [F(360631, { trim: [20, 38], loop: { xfade: 3 }, norm: 'bed' })] },
  'amb-wind': { category: 'ambience', rate: 32000, gain: 0.9, desc: 'wind (level + brightness follow sea.windStrength)', files: [F(344887, { trim: [2, 15.5], loop: { xfade: 3 }, norm: 'bed' })] },
  'amb-rain': { category: 'ambience', rate: 32000, gain: 0.9, desc: 'heavy rain (decorrelated stereo)', files: [{ layers: [F(200272, { trim: [4, 21], pan: -0.85 }), F(200272, { trim: [22, 39], pan: 0.85 })], loop: { xfade: 3 }, norm: 'bed', limitDb: 4 }] },
  'amb-fire': { category: 'ambience', rate: 32000, gain: 1, desc: 'burning ship crackle (positional)', files: [F(364992, { trim: [2, 16], loop: { xfade: 3 }, norm: 'bed', channels: 1, limitDb: 10 })] },
  'amb-whirlpool': { category: 'ambience', rate: 32000, gain: 1, desc: 'whirlpool churn (positional)', files: [F(193755, { trim: [7, 21], loop: { xfade: 3 }, norm: 'bed', channels: 1, limitDb: 10 })] },
  'amb-harbor': { category: 'ambience', rate: 32000, gain: 1, desc: 'harbour: water lapping, boats, rigging', files: [F(254125, { trim: [2, 42], loop: { xfade: 4 }, norm: 'bed' })] },
  'amb-rope': { category: 'ambience', rate: 32000, gain: 0.8, desc: 'tow line creaking under strain (harpoon tether on the player)', files: [F(559079, { trim: [2.4, 10.4], loop: { xfade: 1.5 }, norm: 'bed', channels: 1, limitDb: 8 })] },
  'amb-wisp': { category: 'ambience', rate: 32000, gain: 0.8, desc: 'wisps draining the hull: ghostly harmonic hum', files: [F(752478, { trim: [2, 14], loop: { xfade: 2 }, norm: 'bed', channels: 1, limitDb: 6 })] },
  'amb-maelstrom': { category: 'ambience', rate: 32000, gain: 1, desc: 'the Maelstrom: deep churning drone (positional)', files: [{ layers: [F(193755, { trim: [7, 21], semis: -5 }), F(412308, { trim: [200, 214], lowpass: 380, gainDb: 2 })], loop: { xfade: 3 }, norm: 'bed', channels: 1, limitDb: 10 }] },
  'amb-surf': { category: 'ambience', rate: 32000, gain: 1, desc: 'rogue wave approaching: roaring surf (follows the wave front)', files: [F(412308, { trim: [259, 271], lowpass: 5000, loop: { xfade: 2 }, norm: 'bed', channels: 1, limitDb: 8 })] },
};

/** Streamed music (MusicDirector). bpm values are estimates used only for bar-ish crossfade timing. */
export const MUSIC = {
  title: { ...O('pirates-orchestra-208'), gain: 1, bpm: 120, beatsPerBar: 4, loop: true, loopEnd: 124, loopCrossfade: 3, desc: "title: Pirate's Orchestra — orchestra + accordion" },
  harbor: { ...O('a-sailors-chant'), gain: 1, bpm: 140, beatsPerBar: 4, loop: true, seamless: true, desc: "harbor: A Sailor's Chant — shanty, loopable" },
  'run-calm': { ...O('trials-of-the-sea'), gain: 0.95, bpm: 117.5, beatsPerBar: 4, loop: true, loopEnd: 99.4, loopCrossfade: 2.5, desc: 'calm sailing: Trials of the Sea' },
  'run-combat': { ...O('chest-of-adventure'), gain: 1, bpm: 120, beatsPerBar: 4, loop: true, loopStart: 3, loopEnd: 102.5, loopCrossfade: 3, desc: 'combat: Chest of Adventure' },
  'run-horde': { ...O('battle-theme-a'), gain: 1, bpm: 148, beatsPerBar: 4, loop: true, loopEnd: 93.6, loopCrossfade: 2, desc: 'late-run horde: Battle Theme A' },
  // Per-sea run layers (music.ts SEA_SUFFIX): Stormwrack is martial and driving, the Gloam dark and eerie.
  'run-calm-storm': { ...O('war-on-water-tracks'), gain: 0.95, bpm: 86, beatsPerBar: 4, loop: true, loopEnd: 124.7, loopCrossfade: 2, desc: 'Stormwrack calm: War on Water, chapter 2 — tense military march' },
  'run-combat-storm': { ...O('qazijamjam-orchestral-battle-theme'), gain: 1, bpm: 120.2, beatsPerBar: 4, loop: true, loopEnd: 232.3, loopCrossfade: 3, desc: 'Stormwrack combat: QaziJamJam — a 4-minute orchestral battle theme with variations' },
  'run-horde-storm': { ...O('determined-pursuit-epic-orchestra-loop'), gain: 1, bpm: 120.2, beatsPerBar: 4, loop: true, seamless: true, desc: 'Stormwrack horde: Determined Pursuit (seamless loop)' },
  'run-calm-gloam': { ...O('mysterious-ambience-song21'), gain: 0.9, bpm: 99.4, beatsPerBar: 4, loop: true, loopEnd: 39.5, loopCrossfade: 3, desc: 'Gloam calm: Mysterious Ambience — dark piano textures' },
  'run-combat-gloam': { ...O('battle-theme-b-for-rpg'), gain: 1, bpm: 143.6, beatsPerBar: 4, loop: true, loopEnd: 63.6, loopCrossfade: 1.5, desc: 'Gloam combat: Battle Theme B (B minor)' },
  'run-horde-gloam': { ...O('dark-descent'), gain: 1, bpm: 132.5, beatsPerBar: 4, loop: true, loopEnd: 71.2, loopCrossfade: 2.5, desc: 'Gloam horde: Dark Descent — orchestra and choir (CC BY 3.0, Matthew Pablo)' },
  boss: { ...O('boss-battle-music'), gain: 1, bpm: 117.5, beatsPerBar: 4, loop: true, seamless: true, desc: 'boss: Epic Boss Battle (seamless loop)' },
  'boss-final': { ...O('the-final-battle'), gain: 1, bpm: 161.5, beatsPerBar: 4, loop: true, loopEnd: 144.5, loopCrossfade: 2.5, desc: 'final boss (The Sovereign): The Final Battle' },
};
