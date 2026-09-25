/**
 * Headless balance runs (META). `npx tsx scripts/balance-sim.ts [options]`
 *
 * A bot captain sails real Sim runs: it keeps the enemy mass (or the boss) on a beam at gun range, dodges
 * telegraphed circles/lines and rams, braces before hits, boosts out of danger, fires the manual broadside, uses
 * special/ultimate, collects treasure and picks cards by a heuristic. It prints level, kills, live enemies and hull
 * at 1/5/10/12/15 min, death times and boss kill times, then per-sea summaries against the targets.
 *
 * Options:
 *   --seeds N            seeds per ship×sea (default 4)
 *   --ships a,b          ship ids (default dawn-ram,sunlion)
 *   --seas a,b|all       sea ids (default all)
 *   --minutes M          run length cap (default 16)
 *   --proxy auto|on|off  stand-in damage for weapons with no CORE behaviour yet (default auto: a weapon that dealt
 *                        no damage 12 s after it was taken gets a proxy based on its content table)
 *   --meta none|mid      harbor upgrades (default none; mid = a few ranks everywhere)
 *   --json FILE          also write the raw results
 *   --verbose            per-run event log
 *   --tank               diagnostic: hull ×100 so the bot survives; prints damage taken per minute as % of the
 *                        real hull (use it to tune incoming damage without deaths cutting runs short)
 *   --captains N         AI captains sailing with the bot (0–4, default 0); adds captain kills, sinkings and the
 *                        share of the fleet's attention on the player to the report
 *   --jobs N             run each sea × ship in parallel child processes, N at a time (default 6)
 *   --heat N             heat level 0–8 (REPLAY): sea balance + heat rules through src/game/meta/voyage.ts
 *   --tune JSON          tuning experiment without editing content: numbers merged into the live tables, e.g.
 *                        '{"SEA_BALANCE":{"the-gloam":{"enemyDamage":0.9}},"CAPTAIN":{"firePerCaptain":0.5}}'
 *                        (tables: SEA_BALANCE, DIRECTOR, BOSS_HP_MUL, CAPTAIN, ECONOMY, CHESTS, RARE_DROPS, HEAT, EVENT_TUNING)
 *
 * Every run also keeps a doubloon ledger (wages, kill/elite/boss/event drops, chests, victory purse, cards) so the
 * summary shows where the economy's income comes from.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT } from '../src/game/content';
import { CHESTS, ECONOMY, RARE_DROPS } from '../src/game/content/rewards';
import { BOSS_HP_MUL, DIRECTOR, EVENT_TUNING, HEAT, SEA_BALANCE } from '../src/game/content/director';
import { CAPTAIN } from '../src/game/content/captains';
import type { BossId, SeaId, ShipId, WeaponId } from '../src/game/ids';
import { SEA_IDS } from '../src/game/ids';
import { defaultProfile } from '../src/game/meta/save';
import { startVoyage } from '../src/game/meta/voyage';
import { Sim } from '../src/game/sim/Sim';
import { captainRuntime, configureCaptains } from '../src/game/sim/captains-runtime';
import { cooldownMul, damageMul, doubloonMul, extraAmount, rangeMul } from '../src/game/sim/stats';
import type { CardOffer, ContentDb, MetaProfile, SimEvent, WeaponSlot } from '../src/game/types';
import { IslandField } from '../src/world/IslandField';

// ───────────────────────── CLI ─────────────────────────

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};
const flag = (name: string): boolean => args.includes(`--${name}`);

const SEEDS = Math.max(1, Number(opt('seeds', '4')));
const SHIPS = opt('ships', 'dawn-ram,sunlion').split(',') as ShipId[];
const SEAS = (opt('seas', 'all') === 'all' ? [...SEA_IDS] : opt('seas', '').split(',')) as SeaId[];
const MINUTES = Number(opt('minutes', '16'));
const PROXY = opt('proxy', 'auto') as 'auto' | 'on' | 'off';
const META = opt('meta', 'none') as 'none' | 'mid';
const JSON_OUT = opt('json', '');
const VERBOSE = flag('verbose');
const TANK = flag('tank');
const SOURCES = flag('sources');
const TANK_MUL = 100;
const CAPTAINS = Math.max(0, Math.min(4, Math.floor(Number(opt('captains', '0')) || 0)));
const JOBS = Math.max(1, Math.floor(Number(opt('jobs', SEAS.length * SHIPS.length > 1 ? '6' : '1')) || 1));
const HEAT_LEVEL = Math.max(0, Math.min(8, Math.floor(Number(opt('heat', '0')) || 0)));
const TUNE = opt('tune', '');

/** Merges numbers from `patch` into `target` (nested objects recurse; anything else is ignored). */
function mergeNumbers(target: Record<string, unknown>, patch: Record<string, unknown>, path: string): void {
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === 'number' && typeof target[k] === 'number') target[k] = v;
    else if (v && typeof v === 'object' && target[k] && typeof target[k] === 'object') mergeNumbers(target[k] as Record<string, unknown>, v as Record<string, unknown>, `${path}.${k}`);
    else throw new Error(`--tune: ${path}.${k} is not a number in the live table`);
  }
}
if (TUNE) {
  const tables: Record<string, unknown> = { SEA_BALANCE, DIRECTOR, BOSS_HP_MUL, CAPTAIN, ECONOMY, CHESTS, RARE_DROPS, HEAT, EVENT_TUNING };
  const patch = JSON.parse(TUNE) as Record<string, Record<string, unknown>>;
  for (const [name, value] of Object.entries(patch)) {
    if (!tables[name]) throw new Error(`--tune: unknown table ${name}`);
    mergeNumbers(tables[name] as Record<string, unknown>, value, name);
  }
}

function contentFor(ship: ShipId): ContentDb {
  if (!TANK) return CONTENT;
  return { ...CONTENT, ships: { ...CONTENT.ships, [ship]: { ...CONTENT.ships[ship], hp: CONTENT.ships[ship].hp * TANK_MUL } } };
}

const CHECKPOINTS = [1, 3, 5, 10, 12, 15] as const;

// ───────────────────────── Geometry ─────────────────────────

const TAU = Math.PI * 2;
const wrap = (a: number): number => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const headingOf = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// ───────────────────────── Bot ─────────────────────────

const PASSIVE_PRIORITY: Record<string, number> = {
  'master-gunner': 66, 'powder-monkeys': 63, 'ironwood-hull': 60, 'deep-stores': 57, shipwright: 52, 'weather-eye': 46,
  'long-barrels': 45, 'lucky-doubloon': 42, 'figurehead-fury': 41, 'salvage-nets': 40, 'cloudsilk-sails': 36, 'drill-master': 30,
  momentum: 38, 'clipper-rigging': 35, 'trade-winds': 33, 'racing-keel': 32,
};
const RARITY_BONUS: Record<string, number> = { common: 0, rare: 8, epic: 16, legendary: 26 };
const BALLISTIC = new Set(['enemy-mortar', 'boss-shell']);

interface BotStats { braces: number; boosts: number; volleys: number; specials: number; ultimates: number; rerolls: number }

export class Bot {
  readonly stats: BotStats = { braces: 0, boosts: 0, volleys: 0, specials: 0, ultimates: 0, rerolls: 0 };
  private readonly acquired = new Map<WeaponId, number>();
  readonly proxied = new Set<WeaponId>();
  private proxyTimer = 0;
  private readonly branchPref: 'A' | 'B';

  constructor(private readonly sim: Sim, seed: string) {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) | 0;
    this.branchPref = h & 1 ? 'A' : 'B';
    this.acquired.set(sim.state.player.weapons[0]!.id, 0);
  }

  onWeaponAcquired(id: WeaponId, time: number): void {
    if (!this.acquired.has(id)) this.acquired.set(id, time);
  }

  /** Decides steering, gear, skills. Called every sim tick (cheap early-out between decisions). */
  drive(): void {
    const sim = this.sim, s = sim.state, p = s.player;
    if (!p.alive || s.tick % 3 !== 0) return;

    // Threat picture.
    let cx = 0, cz = 0, cw = 0, near = 0, nearestD = Infinity;
    let rx = 0, rz = 0, urgent = 0;
    for (const e of s.enemies) {
      if (e.life !== 'alive' || e.ai.limbo === 1) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz) || 1;
      if (d > 330) continue;
      const w = 1 / (d + 40);
      cx += dx * w; cz += dz * w; cw += w;
      if (d < 120) near++;
      if (d < nearestD) nearestD = d;
      // Rams and fire ships: push away from anything closing fast at close range.
      const closing = -((e.vx - p.vx) * dx + (e.vz - p.vz) * dz) / d;
      const lit = e.defId === 'fireship' && e.ai.mode === 1;
      if (d < 80 && (lit || (closing > 9 && (e.defId === 'skiff' || e.defId === 'wyrmling' || e.defId === 'corsair-brig')))) {
        const k = ((80 - d) / 80) * (lit ? 3.2 : 1.2);
        rx -= (dx / d) * k; rz -= (dz / d) * k;
        if (lit && d < 45) urgent = Math.max(urgent, 1);
      }
      // Keep hulls apart: contact damage is the easiest damage to avoid.
      const personal = p.radius + e.radius + 22;
      if (d < personal) { const k = ((personal - d) / personal) * 1.4; rx -= (dx / d) * k; rz -= (dz / d) * k; }
    }
    // AI captains: give allied hulls room too (they yield, but ramming them wastes the turn).
    for (const cap of s.captains) {
      if (!cap.alive) continue;
      const dx = cap.x - p.x, dz = cap.z - p.z, d = Math.hypot(dx, dz) || 1;
      const personal = (p.length + cap.length) * 0.5 + 12;
      if (d < personal) { const k = ((personal - d) / personal) * 1.2; rx -= (dx / d) * k; rz -= (dz / d) * k; }
    }
    const boss = s.bosses.find((b) => b.life === 'alive');
    const bossD = boss ? Math.hypot(boss.x - p.x, boss.z - p.z) : Infinity;

    // Telegraphs: step out of circles/rings and off lines.
    for (const t of s.telegraphs) {
      if (!t.alive || t.team !== 'enemy') continue;
      const left = t.duration - t.time;
      if (t.shape === 'line') {
        const fx = -Math.sin(t.angle), fz = -Math.cos(t.angle);
        const px = p.x - t.x, pz = p.z - t.z;
        const along = px * fx + pz * fz;
        if (along < -p.radius || along > t.length + p.radius) continue;
        const nx = -fz, nz = fx;
        const lat = px * nx + pz * nz;
        const reach = t.radius + p.radius + 5;
        if (Math.abs(lat) >= reach) continue;
        const k = ((reach - Math.abs(lat)) / reach + 0.35) * (left < 1 ? 3.2 : 1.6);
        const sgn = lat >= 0 ? 1 : -1;
        rx += nx * sgn * k; rz += nz * sgn * k;
        urgent = Math.max(urgent, left < 0.9 ? 1 : 0.5);
      } else {
        const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz) || 1;
        const reach = t.radius + p.radius * 0.6 + 4;
        if (d >= reach) continue;
        const k = ((reach - d) / reach + 0.35) * (left < 1 ? 3.2 : 1.6);
        rx += (dx / d) * k; rz += (dz / d) * k;
        urgent = Math.max(urgent, left < 0.9 ? 1 : 0.5);
      }
    }

    // Base course: keep the boss / enemy mass on a beam at gun range; otherwise go treasure hunting.
    let heading = p.heading;
    const orbit = (tx: number, tz: number, d: number, R: number) => {
      const hb = headingOf(tx, tz);
      const h1 = hb + Math.PI / 2, h2 = hb - Math.PI / 2;
      let h = Math.abs(wrap(h1 - p.heading)) < Math.abs(wrap(h2 - p.heading)) ? h1 : h2;
      const toward = Math.sign(wrap(hb - h)) || 1;
      h += toward * clamp((d - R) / 60, -1, 1) * 0.7;
      return h;
    };
    // Survival mode (like a human at low hull): wider orbits, stay off the boss, grab repairs.
    const hurt = p.hp / p.maxHp < 0.35;
    const target = this.pickupTarget(hurt ? Math.max(nearestD, 120) : nearestD);
    if (boss && bossD < 480) heading = orbit(boss.x - p.x, boss.z - p.z, bossD, (hurt ? 190 : 105) + boss.radius);
    else if (cw > 0 && nearestD < 260) {
      const mx = cx / cw, mz = cz / cw, md = Math.hypot(mx, mz) || 1;
      heading = orbit(mx, mz, Math.min(nearestD + 20, md * 2), hurt ? 150 : 95);
      if (target && (target.d < 60 || hurt)) heading = headingOf(target.x - p.x, target.z - p.z);
    } else if (target) heading = headingOf(target.x - p.x, target.z - p.z);
    else heading = p.heading + Math.sin(s.time * 0.1) * 0.3;

    let vx = -Math.sin(heading) + rx * 1.6, vz = -Math.cos(heading) + rz * 1.6;
    heading = headingOf(vx, vz);
    heading = this.avoidLand(heading);
    sim.setInput({ steer: clamp(wrap(heading - p.heading) * 2.2, -1, 1) });

    // Gear: half sail turns tightest; full sail to escape, travel or loot.
    const hpFrac = p.hp / p.maxHp;
    // Full sail is the default (speed spoils enemy aim and outruns skiffs); half sail to hold a boss on the beam.
    const wantFull = urgent >= 1 || !(boss && bossD < 260) || hpFrac < 0.3;
    if (wantFull && p.gear < 2) sim.press('gear-up');
    else if (!wantFull && p.gear > 1) sim.press('gear-down');
    else if (p.gear === 0) sim.press('gear-up');

    const sk = p.skills;
    if (urgent >= 1 && sk.boost.cooldown <= 0) { sim.press('boost'); this.stats.boosts++; }
    if (sk.brace.cooldown <= 0 && this.incoming()) { sim.press('brace'); this.stats.braces++; }

    // Manual full broadside at the fuller beam.
    if (sk.broadside.cooldown <= 0) {
      const side = this.bestBeam(boss);
      if (side) { sim.setInput({ aimX: side.x, aimZ: side.z }); sim.press('broadside'); this.stats.volleys++; }
    }
    if (sk.special.cooldown <= 0 && (near >= 5 || bossD < 160 || hpFrac < 0.4)) {
      if (cw > 0) sim.setInput({ aimX: p.x + cx / cw * 3, aimZ: p.z + cz / cw * 3 });
      sim.press('special'); this.stats.specials++;
    }
    if (sk.ultimate.charge >= 1 && (near >= 8 || bossD < 200)) { sim.press('ultimate'); this.stats.ultimates++; }
  }

  private pickupTarget(nearestEnemy: number): { x: number; z: number; d: number } | null {
    const p = this.sim.state.player;
    let best: { x: number; z: number; d: number } | null = null;
    let bestScore = Infinity;
    for (const k of this.sim.state.pickups) {
      if (!k.alive || k.magnet) continue;
      const d = Math.hypot(k.x - p.x, k.z - p.z);
      if (d > 260) continue;
      const score = d / (k.kind === 'chest' ? 4 : k.kind === 'repair' && p.hp < p.maxHp * 0.6 ? 3 : 1);
      const hurtRepair = k.kind === 'repair' && p.hp < p.maxHp * 0.5;
      if (score < bestScore && (nearestEnemy > 90 || d < 70 || hurtRepair)) { bestScore = score; best = { x: k.x, z: k.z, d }; }
    }
    return best;
  }

  private avoidLand(h: number): number {
    const sim = this.sim, p = sim.state.player;
    const clear = (hh: number) => {
      const fx = -Math.sin(hh), fz = -Math.cos(hh);
      return sim.world.isWater(p.x + fx * 35, p.z + fz * 35, p.radius + 4) && sim.world.isWater(p.x + fx * 75, p.z + fz * 75, p.radius + 4);
    };
    if (clear(h)) return h;
    for (const k of [0.5, 1, 1.5, 2.1, 2.8]) {
      if (clear(h + k)) return h + k;
      if (clear(h - k)) return h - k;
    }
    return h + Math.PI;
  }

  private incoming(): boolean {
    const s = this.sim.state, p = s.player;
    for (const pr of s.projectiles) {
      if (!pr.alive || pr.team !== 'enemy' || BALLISTIC.has(pr.kind)) continue;
      const dx = p.x - pr.x, dz = p.z - pr.z, d = Math.hypot(dx, dz);
      if (d > 40) continue;
      const closing = (pr.vx * dx + pr.vz * dz) / (d || 1);
      if (closing > 0 && (d - p.radius) / closing < 0.3) return true;
    }
    for (const t of s.telegraphs) {
      if (!t.alive || t.team !== 'enemy' || t.shape === 'line') continue;
      if (t.duration - t.time < 0.3 && Math.hypot(p.x - t.x, p.z - t.z) < t.radius + p.radius) return true;
    }
    for (const e of s.enemies) {
      if (e.life !== 'alive' || e.defId !== 'fireship' || e.ai.mode !== 1) continue;
      if (Math.hypot(e.x - p.x, e.z - p.z) < 30) return true;
    }
    return false;
  }

  private bestBeam(boss: { x: number; z: number; radius: number } | undefined): { x: number; z: number } | null {
    const s = this.sim.state, p = s.player;
    const sx = Math.cos(p.heading), sz = -Math.sin(p.heading), fx = -Math.sin(p.heading), fz = -Math.cos(p.heading);
    let port = 0, stbd = 0, pX = 0, pZ = 0, sX = 0, sZ = 0;
    const consider = (x: number, z: number, weight: number, radius: number) => {
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1;
      if (d > 165 + radius) return;
      if (Math.abs((dx * fx + dz * fz) / d) > 0.6) return;
      if (dx * sx + dz * sz >= 0) { stbd += weight; sX += x * weight; sZ += z * weight; }
      else { port += weight; pX += x * weight; pZ += z * weight; }
    };
    for (const e of s.enemies) if (e.life === 'alive' && e.ai.limbo !== 1) consider(e.x, e.z, 1, e.radius);
    if (boss) consider(boss.x, boss.z, 5, boss.radius);
    if (Math.max(port, stbd) < 3) return null;
    return port > stbd ? { x: pX / port, z: pZ / port } : { x: sX / stbd, z: sZ / stbd };
  }

  /** Card heuristic: overdrive > branch > weapon levels > new weapons > key passives > chips; heal when low. */
  pickCard(offers: readonly CardOffer[]): number {
    const p = this.sim.state.player;
    const hpFrac = p.hp / p.maxHp;
    let best = 0, bestScore = -Infinity;
    offers.forEach((o, i) => {
      let score = 0;
      switch (o.kind) {
        case 'weapon-overdrive': score = 100; break;
        case 'weapon-branch': score = 90 + (o.branch === this.branchPref ? 1 : 0); break;
        case 'weapon-level': score = 72 + (o.id === 'broadside' ? 6 : 0) + ((o.level ?? 0) >= 4 ? 3 : 0); break;
        case 'new-weapon': score = PROXY === 'off' && this.proxied.size > 0 ? 20 : p.weapons.length < 3 ? 85 : p.weapons.length < 5 ? 74 : 60; break;
        case 'passive-rank': case 'new-passive': {
          // A human-ish build: weapons first, but passives keep pace (and defence when the hull has suffered).
          score = (PASSIVE_PRIORITY[o.id] ?? 30) + (o.kind === 'passive-rank' ? 4 : 0);
          if (p.weapons.length >= p.passives.length + 2) score += 18;
          if ((o.id === 'ironwood-hull' || o.id === 'shipwright') && hpFrac < 0.65) score += 16;
          break;
        }
        case 'chip': score = 18 + (RARITY_BONUS[o.rarity] ?? 0) + (o.stat === 'damage' || o.stat === 'cooldown' ? 8 : 0); break;
        case 'heal': score = hpFrac < 0.45 ? 85 : 8; break;
        case 'doubloons': score = 4; break;
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  shouldReroll(offers: readonly CardOffer[]): boolean {
    return this.sim.state.rerolls > 0 && offers.every((o) => o.kind === 'chip' || o.kind === 'doubloons');
  }

  /**
   * Stand-in damage for weapons CORE has not implemented yet (see --proxy). DPS comes from the weapon's own table
   * (damage × count / cooldown with the player's multipliers) × an efficiency factor, applied every 0.5 s to the
   * nearest targets in range.
   */
  proxyTick(dt: number): void {
    const sim = this.sim, s = sim.state, p = s.player;
    for (const slot of p.weapons) {
      if (this.proxied.has(slot.id) || slot.id === 'broadside') continue;
      const since = this.acquired.get(slot.id);
      if (since === undefined) { this.acquired.set(slot.id, s.time); continue; }
      if (PROXY === 'off') continue;
      if (PROXY === 'on' || (s.time - since > 12 && !(s.stats.damageByWeapon[slot.id]! > 0))) this.proxied.add(slot.id);
    }
    this.proxyTimer -= dt;
    if (this.proxyTimer > 0 || !p.alive) return;
    this.proxyTimer = 0.5;
    for (const slot of p.weapons) if (this.proxied.has(slot.id)) this.proxyFire(slot);
  }

  private proxyFire(slot: WeaponSlot): void {
    const sim = this.sim, p = sim.state.player;
    const def = CONTENT.weapons[slot.id];
    const lvl = def.levels[Math.max(1, Math.min(6, slot.level)) - 1]!;
    const st = p.stats;
    const area = def.tags.includes('area');
    // Contact weapons only land when ramming (~one ram every 5 s); everything else fires on its table cooldown.
    let dps = def.tags.includes('contact')
      ? lvl.damage * (lvl.extra?.ramMultiplier ?? 1) * 0.1 * damageMul(st)
      : ((lvl.damage * (lvl.count + extraAmount(st))) / (lvl.cooldown * cooldownMul(st))) * damageMul(st) * 0.55 * (area ? 1.8 : 1);
    if (slot.overdrive) dps *= 1.5;
    if (slot.branch) dps *= 1.1;
    const range = Math.max(150, lvl.range) * rangeMul(st);
    const targets: { t: Parameters<Sim['damageTarget']>[0]; d: number }[] = [];
    for (const e of sim.state.enemies) {
      if (e.life !== 'alive' || e.ai.limbo === 1) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d <= range) targets.push({ t: e, d });
    }
    for (const b of sim.state.bosses) {
      if (b.life !== 'alive' || b.submerged > 0.6) continue;
      const d = Math.hypot(b.x - p.x, b.z - p.z) - b.radius;
      if (d <= range) targets.push({ t: b, d });
    }
    if (targets.length === 0) return;
    targets.sort((a, b) => a.d - b.d);
    const n = Math.min(area ? 3 : 1, targets.length);
    const each = (dps * 0.5) / (area ? 1.8 : 1);
    for (let i = 0; i < n; i++) sim.damageTarget(targets[i]!.t, each, { weapon: slot.id });
  }
}

// ───────────────────────── Runs ─────────────────────────

interface Checkpoint { minute: number; level: number; kills: number; alive: number; hp: number; weapons: number; capKills: number; xp: number }

interface RunReport {
  ship: ShipId;
  sea: SeaId;
  seed: string;
  outcome: 'victory' | 'dead' | 'timeout';
  endTime: number;
  died: number | null;
  revives: number;
  checkpoints: Checkpoint[];
  bosses: { boss: BossId; spawned: number; killed: number | null }[];
  maxAlive12: number;
  doubloons: number;
  bounty: number;
  loadout: string[];
  proxied: string[];
  damageByWeapon: Record<string, number>;
  /** Hull damage taken by source (enemy class, boss, or 'hazard'/'other'). */
  damageTaken: Record<string, number>;
  /** Damage taken per minute as a fraction of max hull. */
  hullPerMinute: number[];
  /** Hull fraction taken per minute by source. */
  sourcesPerMinute: Record<string, number>[];
  /** Enemy shots fired / hits on the player, by projectile kind (flat shots only have a hit count). */
  shots: Record<string, { fired: number; hits: number; volleys: number }>;
  bot: BotStats;
  /** Pace: first player weapon hit, first enemy within 150 m, level-up times (s), seconds with nothing within 200 m. */
  firstHit: number | null;
  firstNear: number | null;
  levelTimes: number[];
  idle: number;
  /** XP value dropped as coins vs collected. */
  xpDropped: number;
  xpCollected: number;
  ms: number;
  /** AI captains: kills (all captains), sinkings, share of enemy attention on the player, captain levels at the end. */
  captains: { kills: number; sinkings: number; playerShare: number; levels: number[]; dealt: number; taken: number; byPlayer: number; hostile: number };
  /** Doubloons banked by source: wages, kill, elite, boss, event, chest, victory, card, other. */
  income: Record<string, number>;
}

/**
 * Doubloon ledger: doubloon pickups are tagged at spawn by what else happened that tick (a boss or elite sinking, a
 * kill, otherwise a set piece or point of interest) and credited when collected; chests and wages are read from
 * their own events and clock. Whatever is left of the tick's doubloon delta is the victory purse (the final boss
 * banks directly) or 'other'.
 */
class IncomeLedger {
  readonly income: Record<string, number> = {};
  private readonly origin = new Map<number, string>();
  private lastMinute = 0;
  /** Doubloons banked outside sim.step (a queued chest opening inside chooseCard): its event drains next step. */
  private carry = 0;

  add(key: string, amount: number): void { if (amount) this.income[key] = (this.income[key] ?? 0) + amount; }

  /** A card choice (or chest close) that banked `delta`: a doubloon card is 'card'; the rest is a queued chest. */
  choice(offer: CardOffer | undefined, delta: number): void {
    const card = offer?.kind === 'doubloons' ? Math.min(delta, Math.round(offer.amount ?? 0)) : 0;
    this.add('card', card);
    this.carry += delta - card;
  }

  /** Call after each sim step with that step's events and the doubloon delta it produced. */
  tick(sim: Sim, events: readonly SimEvent[], delta: number): void {
    let bossKill = false, eliteKill = false, kill = false;
    for (const e of events) {
      if (e.type === 'boss-defeated') bossKill = true;
      else if (e.type === 'enemy-killed') { kill = true; if (e.elite) eliteKill = true; }
    }
    let known = 0;
    for (const e of events) {
      if (e.type === 'pickup-spawned' && e.kind === 'doubloon') this.origin.set(e.id, bossKill ? 'boss' : eliteKill ? 'elite' : kill ? 'kill' : 'event');
      else if (e.type === 'pickup-collected' && e.kind === 'doubloon') {
        const amount = Math.max(1, Math.round(e.value * ECONOMY.plunder * doubloonMul(sim.state.player.stats)));
        this.add(this.origin.get(e.id) ?? 'event', amount);
        this.origin.delete(e.id);
        known += amount;
      } else if (e.type === 'chest-opened') {
        const purse = e.rewards.find((r) => r.kind === 'doubloons')?.amount ?? 0;
        this.add('chest', purse);
        known += purse;
      }
    }
    const minute = Math.floor(sim.state.time / 60);
    if (minute > this.lastMinute) {
      const wage = Math.round(ECONOMY.minuteWage * doubloonMul(sim.state.player.stats)) * (minute - this.lastMinute);
      this.lastMinute = minute;
      this.add('wages', wage);
      known += wage;
    }
    const rest = delta + this.carry - known;
    this.carry = 0;
    if (rest !== 0) this.add(bossKill ? 'victory' : 'other', rest);
  }
}

function metaProfile(): MetaProfile {
  const m = defaultProfile();
  if (META === 'mid') {
    m.upgrades = {
      hull: 3, powder: 3, gunnery: 2, sails: 1, salvage: 2, wisdom: 2, fortune: 1, charts: 1, 'second-wind': 1,
      'copper-sheathing': 1, 'storm-sails': 1, 'rudder-chains': 1,
    };
  }
  return m;
}

export function runOne(ship: ShipId, sea: SeaId, seed: string, onTick?: (sim: Sim) => void): RunReport {
  const t0 = Date.now();
  const world = new IslandField(seed, { sea });
  const sim = new Sim({ seed, shipId: ship, seaId: sea, meta: metaProfile(), world, content: contentFor(ship) });
  configureCaptains(sim.state, CAPTAINS);
  startVoyage(sim, sim.meta, { heat: HEAT_LEVEL });
  const perMinute: number[] = [];
  const shots: Record<string, { fired: number; hits: number; volleys: number }> = {};
  const sourcesPerMinute: Record<string, number>[] = [];
  const addSource = (key: string, amount: number) => {
    const m = Math.floor(sim.state.time / 60);
    const row = (sourcesPerMinute[m] ??= {});
    row[key] = (row[key] ?? 0) + amount / (sim.state.player.maxHp / (TANK ? TANK_MUL : 1));
    damageTaken[key] = (damageTaken[key] ?? 0) + amount;
  };
  const shot = (k: string) => (shots[k] ??= { fired: 0, hits: 0, volleys: 0 });
  const bot = new Bot(sim, seed);
  const ledger = new IncomeLedger();
  const checkpoints: Checkpoint[] = [];
  const bosses: RunReport['bosses'] = [];
  let died: number | null = null, revives = 0, maxAlive12 = 0, next = 0;
  let firstHit: number | null = null, firstNear: number | null = null, idle = 0, xpDropped = 0;
  const levelTimes: number[] = [];
  const sourceKind = new Map<number, string>();
  const damageTaken: Record<string, number> = {};
  const limit = MINUTES * 60;
  let prevTime = 0;
  while (sim.state.time < limit) {
    const s = sim.state;
    if (s.status === 'levelup' && s.offers) {
      if (bot.shouldReroll(s.offers)) { sim.reroll(); bot.stats.rerolls++; continue; }
      const before = s.stats.doubloons;
      const pick = bot.pickCard(s.offers);
      const offer = s.offers[pick];
      sim.chooseCard(pick);
      ledger.choice(offer, s.stats.doubloons - before);
      continue;
    }
    if (s.status === 'chest') {
      const before = s.stats.doubloons;
      sim.chooseCard(0);
      ledger.choice(undefined, s.stats.doubloons - before);
      continue;
    }
    if (s.status !== 'running') break;
    bot.drive();
    bot.proxyTick(1 / 60);
    const purseBefore = s.stats.doubloons;
    sim.step(1 / 60);
    onTick?.(sim);
    let unsourced = 0;
    const stepEvents = sim.drainEvents();
    ledger.tick(sim, stepEvents, s.stats.doubloons - purseBefore);
    for (const e of stepEvents) {
      if (e.type === 'enemy-fired') { const k = shot(e.projectile); k.fired += e.count; k.volleys++; }
      if (e.type === 'projectile-hit' && e.team === 'enemy' && e.targetId === 0) shot(e.projectile).hits++;
      if (e.type === 'player-hit') {
        const m = Math.floor(sim.state.time / 60);
        perMinute[m] = (perMinute[m] ?? 0) + e.amount / (sim.state.player.maxHp / (TANK ? TANK_MUL : 1));
      }
      if (e.type === 'damage' && e.weapon !== undefined && e.target > 0 && firstHit === null) firstHit = sim.state.time;
      else if (e.type === 'level-up') levelTimes.push(sim.state.time);
      else if (e.type === 'pickup-spawned' && e.kind.startsWith('xp-')) xpDropped += e.value;
      if (e.type === 'enemy-spawned') sourceKind.set(e.id, e.defId);
      else if (e.type === 'player-hit') {
        if (e.source === undefined) { if (unsourced) addSource('mortar/hazard', unsourced); unsourced = e.amount; }
        else addSource(sourceKind.get(e.source) ?? 'unknown', e.amount);
      } else if (e.type === 'projectile-hit' && e.targetId === 0 && e.team === 'enemy' && unsourced) {
        addSource(e.projectile, unsourced);
        unsourced = 0;
      }
      if (e.type === 'boss-spawned') { bosses.push({ boss: e.boss, spawned: sim.state.time, killed: null }); sourceKind.set(e.id, `boss:${e.boss}`); }
      else if (e.type === 'boss-defeated') { const b = bosses.find((x) => x.boss === e.boss && x.killed === null); if (b) b.killed = sim.state.time; }
      else if (e.type === 'weapon-changed' && e.isNew) bot.onWeaponAcquired(e.weapon, sim.state.time);
      else if (e.type === 'player-died') { if (e.reviving) revives++; else died = sim.state.time; }
      if (VERBOSE && (e.type === 'director-event' || e.type === 'boss-spawned' || e.type === 'boss-defeated' || e.type === 'boss-phase' || e.type === 'player-died')) {
        console.log(`  [${ship}/${sea}/${seed}] ${sim.state.time.toFixed(1)}s ${e.type} ${JSON.stringify(e).slice(0, 120)}`);
      }
    }
    if (unsourced) addSource('mortar/hazard', unsourced);
    {
      const p = sim.state.player;
      let nearest = Infinity;
      for (const e of sim.state.enemies) if (e.life === 'alive' && e.hidden < 1) nearest = Math.min(nearest, Math.hypot(e.x - p.x, e.z - p.z));
      for (const b of sim.state.bosses) if (b.life === 'alive') nearest = Math.min(nearest, Math.hypot(b.x - p.x, b.z - p.z) - b.radius);
      if (firstNear === null && nearest <= 150) firstNear = sim.state.time;
      if (sim.state.time > 10 && nearest > 200 && p.alive) idle += sim.state.time - prevTime;
      prevTime = sim.state.time;
    }
    const minute = sim.state.time / 60;
    if (minute >= 11 && minute <= 13) maxAlive12 = Math.max(maxAlive12, sim.state.enemies.filter((e) => e.life === 'alive').length);
    while (next < CHECKPOINTS.length && minute >= CHECKPOINTS[next]!) {
      const p = sim.state.player;
      checkpoints.push({
        minute: CHECKPOINTS[next]!, level: p.level, kills: sim.state.stats.kills,
        alive: sim.state.enemies.filter((e) => e.life === 'alive').length, hp: p.hp / p.maxHp, weapons: p.weapons.length,
        capKills: sim.state.captains.reduce((a, k) => a + k.kills, 0),
        xp: Math.round(sim.state.stats.xpCollected),
      });
      next++;
    }
  }
  const s = sim.state;
  return {
    ship, sea, seed,
    outcome: s.status === 'victory' ? 'victory' : s.status === 'dead' ? 'dead' : 'timeout',
    endTime: s.time, died, revives, checkpoints, bosses, maxAlive12,
    doubloons: s.stats.doubloons, bounty: s.stats.bounty,
    loadout: [...s.player.weapons.map((w) => `${w.id}:${w.level}${w.branch ?? ''}${w.overdrive ? '*' : ''}`), ...s.player.passives.map((x) => `${x.id}:${x.rank}`)],
    proxied: [...bot.proxied],
    damageByWeapon: Object.fromEntries(Object.entries(s.stats.damageByWeapon).map(([k, v]) => [k, Math.round(v ?? 0)])),
    damageTaken: Object.fromEntries(Object.entries(damageTaken).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
    hullPerMinute: Array.from({ length: Math.ceil(s.time / 60) }, (_, i) => perMinute[i] ?? 0),
    sourcesPerMinute: Array.from({ length: Math.ceil(s.time / 60) }, (_, i) => sourcesPerMinute[i] ?? {}),
    shots,
    bot: bot.stats, firstHit, firstNear, levelTimes, idle, xpDropped: Math.round(xpDropped), xpCollected: Math.round(s.stats.xpCollected),
    ms: Date.now() - t0,
    captains: (() => {
      const rt = captainRuntime(s);
      return {
        kills: s.captains.reduce((a, k) => a + k.kills, 0), sinkings: rt.sinkings,
        playerShare: rt.ticksPlayer + rt.ticksCaptains > 0 ? rt.ticksPlayer / (rt.ticksPlayer + rt.ticksCaptains) : 1,
        levels: s.captains.map((k) => k.level), dealt: Math.round(s.captains.reduce((a, k) => a + (k.ai.dealt ?? 0), 0)),
        taken: Math.round(s.captains.reduce((a, k) => a + (k.ai.taken ?? 0), 0)),
        byPlayer: rt.sunkByPlayer, hostile: Math.round(rt.hostileTime),
      };
    })(),
    income: ledger.income,
  };
}

// ───────────────────────── Report ─────────────────────────

const pad = (v: string | number, n: number): string => String(v).padStart(n);
const fmtTime = (t: number | null): string => (t === null ? '—' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
const cp = (r: RunReport, m: number) => r.checkpoints.find((c) => c.minute === m);
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : '—');
const f0 = (v: number | null): string => (v !== null && Number.isFinite(v) ? v.toFixed(0) : '—');
/** Mean seconds between level-ups whose time falls in [from, to] (NaN with fewer than 2). */
function levelGap(times: readonly number[], from: number, to: number): number {
  const w = times.filter((t) => t >= from && t <= to);
  return w.length >= 2 ? (w[w.length - 1]! - w[0]!) / (w.length - 1) : NaN;
}
/** Pace targets (PACE round 1): first hit 5–8 s, first level-up ≤ 20 s, gaps 15–25 s early / 40–60 s late. */
const EARLY: readonly [number, number] = [0, 180];
const LATE: readonly [number, number] = [600, 900];

/** One per-run report line (plus the pace line and, with --verbose, the loadout and fire details). */
function printRun(r: RunReport): void {
  const L = (m: number) => pad(cp(r, m)?.level ?? '—', m >= 10 ? 4 : 3);
  const K = (m: number) => cp(r, m)?.kills ?? '—';
  const A = (m: number) => cp(r, m)?.alive ?? '—';
  const H = (m: number) => { const c = cp(r, m); return c ? Math.round(c.hp * 100) : '—'; };
  const boss = (id: BossId) => { const b = r.bosses.find((x) => x.boss === id); return b ? (b.killed !== null ? `${Math.round(b.killed - b.spawned)}` : 'alive') : '—'; };
  console.log(
    `${r.sea.padEnd(17)} ${r.ship.padEnd(16)} ${r.seed.padEnd(5)} ${L(1)} ${L(3)} ${L(5)} ${L(10)} ${L(15)} | ${String(`${K(5)}/${K(10)}/${K(15)}`).padEnd(15)} | ${String(`${A(5)}/${A(10)}/${r.maxAlive12}/${A(15)}`).padEnd(19)} | ${String(`${H(5)}/${H(10)}/${H(15)}`).padEnd(13)} | ${fmtTime(r.died).padEnd(6)} | ${pad(boss('iron-warden'), 6)} ${pad(boss('tidewyrm'), 8)} ${pad(boss('sovereign'), 9)}      | ${pad(r.doubloons, 4)} | ${r.outcome}${r.revives ? ` (+${r.revives} revive)` : ''}`
    + (CAPTAINS ? ` | capK ${cp(r, 5)?.capKills ?? '—'}/${cp(r, 10)?.capKills ?? '—'}/${cp(r, 15)?.capKills ?? '—'} sunk ${r.captains.sinkings} focus ${Math.round(r.captains.playerShare * 100)}% capL ${r.captains.levels.join(',')} taken ${r.captains.taken} rival ${r.captains.hostile}s/${r.captains.byPlayer}` : ''),
  );
  console.log(
    `   pace: hit ${f1(r.firstHit ?? NaN)} s · near ${f1(r.firstNear ?? NaN)} s · L2 ${f0(r.levelTimes[0] ?? null)} s · gap early ${f0(levelGap(r.levelTimes, ...EARLY))} s / late ${f0(levelGap(r.levelTimes, ...LATE))} s · idle ${f0(r.idle)} s · xp ${r.xpCollected}/${r.xpDropped} (${Math.round((100 * r.xpCollected) / Math.max(1, r.xpDropped))}%)`,
  );
  if (VERBOSE) {
    console.log(`   loadout ${r.loadout.join(' ')} proxied=[${r.proxied.join(',')}] bot=${JSON.stringify(r.bot)} ${r.ms}ms`);
    console.log(`   dealt ${JSON.stringify(r.damageByWeapon)} taken ${JSON.stringify(r.damageTaken)}`);
    console.log(`   enemy fire ${Object.entries(r.shots).map(([k, v]) => `${k}: ${v.volleys} volleys, ${v.fired} shots, ${v.hits} hits (${Math.round((100 * v.hits) / Math.max(1, v.fired))}%)`).join(' · ')}`);
    console.log(`   income ${JSON.stringify(r.income)}`);
  }
}

const INCOME_KEYS = ['wages', 'kill', 'elite', 'boss', 'event', 'chest', 'victory', 'card', 'other'] as const;

function printSummary(reports: readonly RunReport[], seas: readonly SeaId[]): void {
  console.log('\nSummary per sea (targets: first hit 5–8 s, first level ≤ 20 s, level gaps 15–25 s early (0–3 min) / 40–60 s late (10–15 min), L 25–35 @15; alive 60–90 @12; bosses 45–120 s; deaths: some on Sunward, more on Stormwrack/Gloam)');
  for (const sea of seas) {
    const rs = reports.filter((r) => r.sea === sea);
    if (rs.length === 0) continue;
    const lv = (m: number) => mean(rs.map((r) => cp(r, m)?.level).filter((v): v is number => v !== undefined));
    const deaths = rs.filter((r) => r.died !== null);
    const bossStat = (id: BossId) => {
      const times = rs.map((r) => r.bosses.find((b) => b.boss === id)).filter((b) => b && b.killed !== null).map((b) => b!.killed! - b!.spawned);
      const met = rs.filter((r) => r.bosses.some((b) => b.boss === id)).length;
      return met ? `${times.length}/${met} killed, ${times.length ? `${Math.round(Math.min(...times))}–${Math.round(Math.max(...times))} s (avg ${Math.round(mean(times))})` : '—'}` : 'not reached';
    };
    console.log(`${sea}: L@5 ${f1(lv(5))} · L@10 ${f1(lv(10))} · L@15 ${f1(lv(15))} · alive@12 max ${f1(mean(rs.map((r) => r.maxAlive12)))} · deaths ${deaths.length}/${rs.length}${deaths.length ? ` (avg ${fmtTime(mean(deaths.map((r) => r.died!)))})` : ''} · ◈ avg ${Math.round(mean(rs.map((r) => r.doubloons)))} · victories ${rs.filter((r) => r.outcome === 'victory').length}`);
    const kl = (m: number) => mean(rs.map((r) => cp(r, m)?.kills).filter((v): v is number => v !== undefined));
    const ck = (m: number) => mean(rs.map((r) => cp(r, m)?.capKills).filter((v): v is number => v !== undefined));
    console.log(`   player kills @5/10/15 ${f1(kl(5))}/${f1(kl(10))}/${f1(kl(15))}` + (CAPTAINS ? ` · captain kills @5/10/15 ${f1(ck(5))}/${f1(ck(10))}/${f1(ck(15))} · player kill share @15 ${Math.round((100 * kl(15)) / Math.max(1, kl(15) + ck(15)))}% · captain sinkings avg ${f1(mean(rs.map((r) => r.captains.sinkings)))} (by the player ${f1(mean(rs.map((r) => r.captains.byPlayer)))}) · hostile ${Math.round(mean(rs.map((r) => r.captains.hostile)))} s · fleet attention on player ${Math.round(100 * mean(rs.map((r) => r.captains.playerShare)))}%` : ''));
    console.log(`   Iron Warden ${bossStat('iron-warden')} · Tidewyrm ${bossStat('tidewyrm')} · Sovereign ${bossStat('sovereign')}`);
    const m = (f: (r: RunReport) => number) => f1(mean(rs.map(f).filter((v) => Number.isFinite(v))));
    console.log(`   pace: first hit ${m((r) => r.firstHit ?? NaN)} s · first near ${m((r) => r.firstNear ?? NaN)} s · first level ${m((r) => r.levelTimes[0] ?? NaN)} s · gap early ${m((r) => levelGap(r.levelTimes, ...EARLY))} s · late ${m((r) => levelGap(r.levelTimes, ...LATE))} s · idle ${m((r) => r.idle)} s · xp collected ${m((r) => (100 * r.xpCollected) / Math.max(1, r.xpDropped))}% · kills@15 ${m((r) => cp(r, 15)?.kills ?? NaN)}`);
    const wins = rs.filter((r) => r.outcome === 'victory');
    const lost = rs.filter((r) => r.outcome !== 'victory');
    const inc = INCOME_KEYS.map((k) => `${k} ${Math.round(mean(rs.map((r) => r.income?.[k] ?? 0)))}`).join(' · ');
    console.log(`   ◈ income per run: ${inc} · victories avg ${wins.length ? Math.round(mean(wins.map((r) => r.doubloons))) : '—'} · others avg ${lost.length ? Math.round(mean(lost.map((r) => r.doubloons))) : '—'}`);
  }
}

/** Runs each sea × ship in its own child process (same options), then merges the reports in the usual order. */
async function runParallel(): Promise<RunReport[]> {
  const dir = mkdtempSync(join(tmpdir(), 'balance-sim-'));
  const script = process.argv[1]!;
  const base: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--seas' || a === '--ships' || a === '--json' || a === '--jobs') { i++; continue; }
    base.push(a);
  }
  const jobs = SEAS.flatMap((sea) => SHIPS.map((ship) => ({ sea, ship, key: `${sea}__${ship}` })));
  const outputs = new Map<string, string>();
  const queue = [...jobs];
  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const file = join(dir, `${job.key}.json`);
      const child = spawn(process.execPath, [...process.execArgv, script, ...base, '--seas', job.sea, '--ships', job.ship, '--jobs', '1', '--json', file, '--child'], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      const code = await new Promise<number>((res) => child.on('close', (c) => res(c ?? 1)));
      if (code !== 0) throw new Error(`balance-sim child for ${job.key} exited with ${code}`);
      outputs.set(job.key, out);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, worker));
  const reports: RunReport[] = [];
  for (const job of jobs) {
    process.stdout.write(outputs.get(job.key) ?? '');
    reports.push(...(JSON.parse(readFileSync(join(dir, `${job.key}.json`), 'utf8')) as RunReport[]));
  }
  rmSync(dir, { recursive: true, force: true });
  return reports;
}

/** CLI entry: runs only when this file is executed directly (so the bot can be imported by other scripts). */
async function main(): Promise<void> {
  const child = flag('child');
  let reports: RunReport[] = [];
  if (!child) {
    console.log(`balance-sim: seeds=${SEEDS} ships=${SHIPS.join(',')} seas=${SEAS.join(',')} minutes=${MINUTES} proxy=${PROXY} meta=${META} captains=${CAPTAINS} heat=${HEAT_LEVEL}${TUNE ? ` tune=${TUNE}` : ''}`);
    console.log('sea               ship             seed  L@1 L@3 L@5 L@10 L@15 | kills@5/10/15   | alive@5/10/12max/15 | hp%@5/10/15   | died   | warden tidewyrm sovereign (s)  | ◈    | outcome');
  }
  if (!child && JOBS > 1 && SEAS.length * SHIPS.length > 1) reports = await runParallel();
  else {
    for (const sea of SEAS) {
      for (const ship of SHIPS) {
        for (let i = 0; i < SEEDS; i++) {
          const r = runOne(ship, sea, `bal-${i + 1}`);
          reports.push(r);
          printRun(r);
        }
      }
    }
  }
  if (child) { if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(reports)); return; }
  printSummary(reports, SEAS);
  if (TANK) {
    console.log('\nIncoming damage per minute (% of max hull), mean over runs:');
    for (const sea of SEAS) {
      const rs = reports.filter((r) => r.sea === sea);
      const len = Math.max(...rs.map((r) => r.hullPerMinute.length));
      const row: string[] = [];
      for (let m = 0; m < len; m++) row.push(`${m}:${Math.round(mean(rs.map((r) => r.hullPerMinute[m] ?? 0)) * 100)}`);
      console.log(`${sea}: ${row.join(' ')}`);
    }
  }
  if (SOURCES) {
    console.log('\nTop damage sources per minute (% of max hull, mean over runs):');
    for (const sea of SEAS) {
      const rs = reports.filter((r) => r.sea === sea);
      const len = Math.max(...rs.map((r) => r.sourcesPerMinute.length));
      console.log(sea);
      for (let m = 0; m < len; m++) {
        const sum: Record<string, number> = {};
        for (const r of rs) for (const [k, v] of Object.entries(r.sourcesPerMinute[m] ?? {})) sum[k] = (sum[k] ?? 0) + v / rs.length;
        const top = Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${Math.round(v * 100)}`);
        console.log(`  ${m}: ${top.join(' · ')}`);
      }
    }
  }
  const proxied = new Set(reports.flatMap((r) => r.proxied));
  if (proxied.size) console.log(`\nProxy damage stood in for: ${[...proxied].join(', ')} (no CORE behaviour detected). Re-run after merging CORE with --proxy auto.`);
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(reports, null, 2)); console.log(`wrote ${JSON_OUT}`); }
}

if ((process.argv[1] ?? '').replace(/\\/g, '/').endsWith('scripts/balance-sim.ts')) void main().catch((err: unknown) => { console.error(err); process.exit(1); });
