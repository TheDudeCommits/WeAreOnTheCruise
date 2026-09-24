/**
 * Elite affixes (FOES-owned): swift, armored, volatile, vampiric, shielded, splitting, burning, commander.
 * rollAffixes runs when an elite spawns (meta-spawn.spawnScaled; debug-spawned elites roll lazily here),
 * updateAffixes once per tick after the enemy AI, onAffixDeath when an elite is sunk (progression.onEnemyKilled).
 *
 *   swift      ×speed and quicker reloads (ai.ts baseSpeed / reloadTime).
 *   armored    +armour (CORE's flat armour: small shots glance off) and more hull.
 *   volatile   sinking lights a telegraphed ring; it blows up when the ring completes (friendlies and ships alike).
 *   vampiric   heals a slice of its hull whenever one of its shots lands (tracked in ai-foes.ts) or its hull rams you.
 *   shielded   a regenerating bubble on top of the hull: e.hp = hull + bubble, and damage empties the bubble first
 *              (bookkept here every tick); the bubble regrows after a quiet spell, slower once broken.
 *   splitting  2–3 skiffs (lantern wisps for Gloam ships) escape the wreck.
 *   burning    drops burning water astern while under way.
 *   commander  rallies ships within AURA_RADIUS: faster, tighter, quicker-reloading, harder-hitting guns.
 *
 * AI scratch keys (numbers only; renderers may read them): affixRolled, shield, shieldMax, realHp (hull without the
 * bubble), shieldHit (s of hit shimmer), shieldCd (s until regen), vampT (s of heal glow), trailT, vcd.
 */
import { AFFIXES, AFFIX_TUNING } from '../content/enemies';
import { ELITE_AFFIX_IDS, type EliteAffixId, type EnemyId } from '../ids';
import type { EnemyState, RunState } from '../types';
import type { SimContext } from './context';
import { blastFriendlies, foeRuntime } from './ai-foes';
import { enemyDamageScale, spawnScaled } from './meta-spawn';
import { TAU, fwdX, fwdZ, headingTo, openWaterNear, rand } from './meta-steer';
import { updateNamedCaptains } from './bounty';

// ───────────────────────── Per-run scratch ─────────────────────────

const JOB_CAP = 32;
const JOB_VOLATILE = 1;

interface Job { kind: number; t: number; x: number; z: number; r: number; dmg: number; src: number }

interface AffixRuntime {
  jobs: Job[];
  /** Affix count override for the next roll (named bounty captains roll two). */
  forceCount: number;
}

const STORES = new WeakMap<RunState, AffixRuntime>();

function affixRuntime(c: SimContext): AffixRuntime {
  let rt = STORES.get(c.state);
  if (!rt) {
    rt = { jobs: Array.from({ length: JOB_CAP }, () => ({ kind: 0, t: 0, x: 0, z: 0, r: 0, dmg: 0, src: 0 })), forceCount: 0 };
    STORES.set(c.state, rt);
  }
  return rt;
}

/** Makes the next rollAffixes in this run roll `count` affixes (named captains). */
export function forceNextAffixCount(c: SimContext, count: number): void { affixRuntime(c).forceCount = count; }

export function hasAffix(e: EnemyState, id: EliteAffixId): boolean {
  const a = e.affixes;
  return a.length > 0 && (a[0] === id || a[1] === id);
}

// ───────────────────────── QA hook ─────────────────────────

/**
 * Browser QA: `window.__FOES_QA__ = { affixes: ['shielded', 'commander'] }` forces the affixes of the next elites
 * (`named: true` makes the next elite a named captain); the hook also receives `sim` (this run's SimContext) every tick
 * so capture scripts can stage scenes. Absent in normal play.
 */
export interface FoesQa { affixes?: EliteAffixId[]; named?: boolean; sim?: SimContext }
export function foesQa(): FoesQa | null {
  const g = globalThis as { __FOES_QA__?: FoesQa };
  return g.__FOES_QA__ ?? null;
}

// ───────────────────────── Rolls ─────────────────────────

const PICK: EliteAffixId[] = [];

/** Affixes that make no sense on a class (stationary batteries cannot trail fire or sail faster, etc.). */
function allowed(c: SimContext, e: EnemyState, id: EliteAffixId): boolean {
  const def = c.content.enemies[e.defId];
  if (def.behavior === 'stationary') return id !== 'swift' && id !== 'burning';
  if (e.defId === 'lantern-wisp') return id === 'swift' || id === 'volatile' || id === 'vampiric' || id === 'burning';
  if (def.behavior === 'kamikaze') return id !== 'vampiric' && id !== 'volatile';
  return true;
}

export function rollAffixes(c: SimContext, e: EnemyState): void {
  if (e.ai.affixRolled === 1) return;
  e.ai.affixRolled = 1;
  const rt = affixRuntime(c);
  const forced = foesQa()?.affixes;
  const list = e.affixes;
  list.length = 0;
  const count = rt.forceCount > 0 ? rt.forceCount : c.state.time / 60 >= AFFIX_TUNING.twoFrom ? 2 : 1;
  rt.forceCount = 0;
  if (forced && forced.length) {
    for (const id of forced) if (list.length < 2 && !list.includes(id)) list.push(id);
  } else {
    for (let n = 0; n < count; n++) {
      PICK.length = 0;
      let total = 0;
      for (const id of ELITE_AFFIX_IDS) if (!list.includes(id) && allowed(c, e, id)) { PICK.push(id); total += AFFIXES[id].weight; }
      if (total <= 0) break;
      let r = c.random() * total;
      let pick = PICK[PICK.length - 1]!;
      for (const id of PICK) { r -= AFFIXES[id].weight; if (r <= 0) { pick = id; break; } }
      list.push(pick);
    }
  }
  applyAffixes(e);
}

/** One-off stat changes when an affix is rolled. */
function applyAffixes(e: EnemyState): void {
  const T = AFFIX_TUNING;
  if (hasAffix(e, 'armored')) {
    e.armor += T.armoredArmor;
    e.hp *= T.armoredHp;
    e.maxHp *= T.armoredHp;
  }
  if (hasAffix(e, 'shielded')) {
    const bubble = e.maxHp * T.shield;
    e.ai.shieldMax = bubble;
    e.ai.shield = bubble;
    e.ai.realHp = e.hp;
    e.ai.shieldCd = 0;
    e.hp += bubble;
  }
  // Ironclads remember their unarmoured value after the roll (see ai-foes.ts).
  if (e.ai.armor0 !== undefined) e.ai.armor0 = e.armor;
}

// ───────────────────────── Tick ─────────────────────────

export function updateAffixes(c: SimContext): void {
  const q = foesQa();
  if (q) q.sim = c;
  const fr = foeRuntime(c);
  fr.cmdN = 0;
  const enemies = c.state.enemies;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (e.life !== 'alive') continue;
    if (e.elite && e.ai.affixRolled !== 1) rollAffixes(c, e);
    if (e.affixes.length === 0) continue;
    const ai = e.ai;
    if (hasAffix(e, 'shielded')) shieldTick(c, e);
    if (hasAffix(e, 'commander') && fr.cmdN < fr.cmdX.length && e.hidden < 1) {
      fr.cmdX[fr.cmdN] = e.x; fr.cmdZ[fr.cmdN] = e.z; fr.cmdId[fr.cmdN] = e.id; fr.cmdN++;
    }
    if (hasAffix(e, 'burning')) burnTrail(c, e);
    if (hasAffix(e, 'vampiric')) {
      // A fresh hull contact with the player (CORE sets contactCd) that hurt: feed on it.
      const cd = ai.contactCd ?? 0;
      if (cd > (ai.vcd ?? 0) + 0.05 && c.state.player.sinceHit < 0.1) vampFeed(e);
      ai.vcd = cd;
    }
    if ((ai.vampT ?? 0) > 0) ai.vampT! -= c.dt;
    if ((ai.shieldHit ?? 0) > 0) ai.shieldHit! -= c.dt;
  }
  runJobs(c);
  updateNamedCaptains(c);
}

function vampFeed(e: EnemyState): void {
  const heal = Math.min(e.maxHp - (e.hp - (e.ai.shield ?? 0)), e.maxHp * AFFIX_TUNING.vampHeal);
  if (heal <= 0) return;
  e.hp += heal;
  if (e.ai.realHp !== undefined) e.ai.realHp += heal;
  e.ai.vampT = 0.7;
}

/** Shield bookkeeping: damage since the last tick empties the bubble first; the bubble regrows after a quiet spell. */
function shieldTick(c: SimContext, e: EnemyState): void {
  const T = AFFIX_TUNING;
  const ai = e.ai;
  const max = ai.shieldMax ?? 0;
  let s = ai.shield ?? 0;
  const real = ai.realHp ?? e.hp - s;
  const lost = real + s - e.hp;
  if (lost > 0 && s > 0) {
    s -= Math.min(s, lost);
    ai.shieldHit = 0.3;
    ai.shieldCd = s <= 0 ? T.shieldBreakDelay : T.shieldDelay;
  } else if (lost > 0) ai.shieldCd = Math.max(ai.shieldCd ?? 0, T.shieldDelay * 0.5);
  let hull = e.hp - s;
  ai.shieldCd = (ai.shieldCd ?? 0) - c.dt;
  if (ai.shieldCd <= 0 && s < max) s = Math.min(max, s + max * T.shieldRegen * c.dt);
  if (hull > e.maxHp) hull = e.maxHp;
  ai.shield = s;
  ai.realHp = hull;
  e.hp = hull + s;
}

function burnTrail(c: SimContext, e: EnemyState): void {
  const T = AFFIX_TUNING;
  const ai = e.ai;
  ai.trailT = (ai.trailT ?? rand(c, 0, T.trailEvery)) - c.dt;
  if (ai.trailT > 0 || e.speed < 2 || e.hidden >= 1) return;
  ai.trailT = T.trailEvery;
  const back = e.length * 0.55;
  c.spawnHazard({
    kind: 'fire-patch', team: 'enemy', x: e.x - fwdX(e.heading) * back, z: e.z - fwdZ(e.heading) * back,
    radius: T.trailRadius, ttl: T.trailTtl, damage: T.trailDamage * enemyDamageScale(c), tick: 0.5,
  });
}

// ───────────────────────── Death ─────────────────────────

export function onAffixDeath(c: SimContext, e: EnemyState): void {
  const T = AFFIX_TUNING;
  if (hasAffix(e, 'volatile')) {
    const job = freeJob(c);
    if (job) {
      job.kind = JOB_VOLATILE; job.t = T.volatileFuse; job.x = e.x; job.z = e.z; job.r = T.volatileRadius;
      job.dmg = T.volatileDamage * enemyDamageScale(c); job.src = e.id;
      c.addTelegraph({ shape: 'ring', team: 'enemy', x: e.x, z: e.z, radius: T.volatileRadius, length: T.volatileRadius * 0.1, duration: T.volatileFuse });
    }
  }
  if (hasAffix(e, 'splitting')) {
    const kind: EnemyId = e.faction === 'wraith' ? 'lantern-wisp' : 'skiff';
    const n = Math.min(T.splitMax, T.splitMin + (c.random() < 0.5 ? 1 : 0));
    const p = c.state.player;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + c.random() * 0.8, r = e.radius + 6;
      const spot = openWaterNear(c, e.x + Math.sin(a) * r, e.z + Math.cos(a) * r, 6, 4);
      if (!spot) continue;
      const s = spawnScaled(c, kind, spot.x, spot.z, { heading: headingTo(p.x - spot.x, p.z - spot.z) });
      if (s) { s.ai.t = rand(c, 0.2, 0.8); s.ai.flank = (k / Math.max(1, n - 1) - 0.5) * 2; }
    }
  }
  e.ai.shield = 0;
}

function freeJob(c: SimContext): Job | null {
  for (const j of affixRuntime(c).jobs) if (j.kind === 0) return j;
  return null;
}

function runJobs(c: SimContext): void {
  const jobs = affixRuntime(c).jobs;
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i]!;
    if (j.kind === 0) continue;
    j.t -= c.dt;
    if (j.t > 0) continue;
    if (j.kind === JOB_VOLATILE) {
      c.emit({ type: 'explosion', x: j.x, z: j.z, radius: j.r, kind: 'powder', team: 'enemy' });
      blastFriendlies(c, j.x, j.z, j.r, j.dmg, j.src);
      // Chain reactions: the blast rocks every ship nearby too.
      for (const o of c.state.enemies) {
        if (o.life !== 'alive' || o.hidden >= 1) continue;
        const d = Math.hypot(o.x - j.x, o.z - j.z) - o.radius;
        if (d <= j.r) c.damageTarget(o, j.dmg * 1.5, { knockback: 6, fromX: j.x, fromZ: j.z });
      }
    }
    j.kind = 0;
  }
}
