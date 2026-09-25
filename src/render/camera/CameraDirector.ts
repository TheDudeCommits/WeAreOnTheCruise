/**
 * Camera director (LOOK-owned in round 1, IMPACT in round 2; the RenderSystem + CameraServices surface is contract).
 *
 * Run: a readable survivor-game tactical camera at 44° with velocity look-ahead, a lazy heading follow (turns read on
 * screen, then the view catches up), smooth critically-damped motion, island occlusion avoidance (the camera rises
 * over cliffs), RMB orbit and wheel zoom. Framing (round 2):
 *  - Hero size: distance = 118 → 172 m with the fight + (length − 40) × 1.8 + mast height, and never so close that the
 *    hull (bow to stern seen from astern, waterline to deck) is taller than 18% of the frame; capped a third of the
 *    way into the fog band so thick weather never swallows the ship.
 *  - Bosses: while a surfaced boss is within ~330 m the view looks 40–60% of the way to it, drops 4° of pitch and pulls
 *    to the closest distance that keeps the hero in the HUD-safe centre and the whole boss hull in frame (so the boss
 *    stays big). A boss that newly enters framing gets a 1.2 s arrival beat: 70% toward it, 2° lower, a slight
 *    pull-out, then it settles.
 *  - settings.cinematicCamera (off by default): with fewer than ~8 enemies within 250 m the pitch eases to 33° and the
 *    view tilts up so the horizon, sky and islands sit along the top of the frame; back to 44° in a melee or a boss
 *    fight.
 * Shake is applied AFTER damping as trauma-shaped positional + rotational noise (respecting settings.cameraShake);
 * FOV kicks punch in and settle; focusOn(x, z, t) frames the player with a point of interest.
 * Title/harbor: a slow, low showcase orbit framed by the ship's measured mast height and length.
 * Every smoothing step runs on the render clock, so sim slow-motion never stalls or jerks the camera.
 */
import * as THREE from 'three';
import { SHIPS } from '../../game/content';
import type { ShipId } from '../../game/ids';
import type { BossState, IslandDef } from '../../game/types';
import type { CameraServices, FrameContext, RenderHostHandles, RenderSystem } from '../frame';

const deg = THREE.MathUtils.degToRad;
/** 44°: enough overview for a survivor fight, low enough that hull sides and sails still read. */
const TACTICAL_PITCH = deg(44);
/** Cinematic option: a lower camera while the sea is quiet (the horizon enters the top of the frame). */
const CINEMATIC_PITCH = deg(33);
const MIN_PITCH = deg(22);
const MAX_PITCH = deg(72);
const TACTICAL_FOV = 50;
const SHOWCASE_FOV = 36;
/** Largest share of the frame height the hero's hull may take (IMPACT round 2). */
const HERO_FRAME = 0.18;
/** A surfaced boss within this range (minus a third of its length) is framed with the hero. */
const BOSS_RANGE = 330;
const BOSS_ARRIVAL = 1.2;
const BOSS_PITCH = deg(-4);

const smooth01 = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Smooth pseudo-noise in [-1, 1] (sum of incommensurate sines; allocation-free). */
function wobble(t: number, seed: number): number {
  return (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.73 + seed * 2.9) * 0.2);
}

export class CameraDirector implements RenderSystem, CameraServices {
  readonly name = 'camera';
  private camera!: THREE.PerspectiveCamera;
  private canvas!: HTMLCanvasElement;
  // User input.
  private userYaw = 0;
  private userPitch = 0;
  private zoom = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  // Smoothed state.
  private followYaw = 0;
  private yaw = 0;
  private pitch = TACTICAL_PITCH;
  private distance = 140;
  private fov = TACTICAL_FOV;
  private pressure = 0;
  private liftPitch = 0;
  /** 0..1 blend toward framing the nearest live boss together with the ship. */
  private bossFrame = 0;
  private readonly bossPoint = new THREE.Vector2();
  private bossHeading = 0;
  private bossLength = 90;
  /** Smoothed look weight toward the framed boss (0.4 base … 0.6). */
  private bossWeight = 0.4;
  /** Hero-size distance without the fight term (m): boss framing never comes closer than half of it. */
  private heroBase = 180;
  /** Boss currently framed (−1 none) and the time left of its arrival beat. */
  private bossId = -1;
  private arrival = 0;
  /** Hero measurements (world metres above the water), smoothed; re-measured every frame from ShipServices. */
  private mastH = 0;
  private deckH = 0;
  /** 0..1 blend toward the cinematic band (settings.cinematicCamera) and the look-up tilt it brings (radians). */
  private cinematic = 0;
  private tilt = 0;
  /** Diagnostics for QA probes: last framing decision. */
  readonly framing = { heroDistance: 0, hullFrame: 0, bossFit: 0, bossWeight: 0, beat: 0, cinematic: 0, fogCap: 0, distance: 0, mastH: 0 };
  private readonly fitPts = new Float32Array(8 * 3);
  private readonly anchor = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly lookAhead = new THREE.Vector2();
  private readonly position = new THREE.Vector3(0, 90, 150);
  private initialized = false;
  private lastScreen = '';
  private showcaseYaw = 0.6;
  /** Harbor framing: fraction of the half-width the ship sits right of centre (the fleet panel covers the left). */
  private showcaseShift = 0;
  // Effects.
  private shakeAmp = 0;
  private shakeTime = 0;
  private shakeDuration = 0.35;
  private shakeClock = 0;
  private kickAmount = 0;
  private kickTime = 0;
  private kickDuration = 0.35;
  private readonly focusPoint = new THREE.Vector2();
  private focusTime = 0;
  private focusDuration = 0;
  // Scratch.
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly quat = new THREE.Quaternion();
  private readonly islands: IslandDef[] = [];

  init(host: RenderHostHandles): void {
    this.camera = host.camera;
    this.canvas = host.renderer.domElement;
    // Counters only (every build): the last framing decision, for the evidence probes.
    (globalThis as { __CRUISE_CAMERA__?: unknown }).__CRUISE_CAMERA__ = this.framing;
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(ctx: FrameContext): void {
    const dt = Math.min(0.1, Math.max(0, ctx.dt));
    const menu = ctx.screen === 'title' || ctx.screen === 'harbor' || ctx.screen === 'boot';
    if (ctx.screen !== this.lastScreen) {
      if (!menu && (this.lastScreen === 'title' || this.lastScreen === 'harbor' || this.lastScreen === '')) {
        // Entering a run: start the follow yaw behind the ship so the dolly-in reads.
        this.followYaw = ctx.focus.heading;
      }
      this.lastScreen = ctx.screen;
    }
    if (menu) this.updateShowcase(ctx, dt);
    else this.updateTactical(ctx, dt);
    this.applyEffects(ctx, dt);
  }

  // ───────────── Tactical ─────────────

  private updateTactical(ctx: FrameContext, dt: number): void {
    const run = ctx.run;
    const focus = ctx.focus;
    const shipLength = run ? SHIPS[run.shipId]?.length ?? 40 : 40;
    const enemies = run ? run.enemies.length + run.bosses.length * 12 : 0;
    this.pressure = damp(this.pressure, THREE.MathUtils.clamp(enemies / 60, 0, 1), 0.6, dt);

    // Lazy heading follow: turns read on screen before the view catches up.
    const headingError = wrapAngle(focus.heading - this.followYaw);
    this.followYaw = wrapAngle(this.followYaw + headingError * (1 - Math.exp(-dt * 0.9)));
    const yawTarget = this.followYaw + this.userYaw;
    this.yaw = wrapAngle(this.yaw + wrapAngle(yawTarget - this.yaw) * (1 - Math.exp(-dt * 5)));

    // Look-ahead along the direction of travel.
    const speed = Math.max(0, focus.speed);
    const ahead = Math.min(38, speed * 1.35);
    const fx = -Math.sin(focus.heading) * ahead, fz = -Math.cos(focus.heading) * ahead;
    this.lookAhead.x = damp(this.lookAhead.x, fx, 1.6, dt);
    this.lookAhead.y = damp(this.lookAhead.y, fz, 1.6, dt);

    const boss = run ? this.nearestBoss(run, focus.x, focus.z) : null;

    // Cinematic band (option): a lower camera with the horizon at the top while the sea is quiet.
    let quiet = false;
    if (run && ctx.settings.cinematicCamera === true && !boss) {
      let near = 0;
      for (const e of run.enemies) {
        if (e.life !== 'alive' || e.hidden >= 1) continue;
        const dx = e.x - focus.x, dz = e.z - focus.z;
        if (dx * dx + dz * dz < 250 * 250 && ++near >= 8) break;
      }
      quiet = near < 8;
    }
    this.cinematic = damp(this.cinematic, quiet ? 1 : 0, quiet ? 0.7 : 1.8, dt);
    const cine = smooth01(this.cinematic);
    this.tilt = damp(this.tilt, cine * deg(12), 2.5, dt);
    this.framing.cinematic = cine;
    // In the band the look-ahead shrinks, so the ship keeps clear of the skill bar at the bottom.
    const aheadK = 1 - cine * 0.7;
    const basePitch = THREE.MathUtils.clamp(THREE.MathUtils.lerp(TACTICAL_PITCH, CINEMATIC_PITCH, cine) + this.userPitch, MIN_PITCH, MAX_PITCH);

    // Framing: hull size + the fight, never a hull taller than 18% of the frame.
    this.measureHero(ctx, shipLength, dt);
    let distance = this.heroDistance(ctx, shipLength, basePitch) * this.zoom;
    this.framing.heroDistance = distance;
    let tx = focus.x + this.lookAhead.x * aheadK, tz = focus.z + this.lookAhead.y * aheadK;
    if (this.focusTime > 0) {
      const k = this.focusEnvelope();
      const px = this.focusPoint.x, pz = this.focusPoint.y;
      tx = THREE.MathUtils.lerp(tx, focus.x * 0.4 + px * 0.6, k);
      tz = THREE.MathUtils.lerp(tz, focus.z * 0.4 + pz * 0.6, k);
      distance = Math.max(distance, THREE.MathUtils.lerp(distance, Math.hypot(px - focus.x, pz - focus.z) * 1.05 + 60, k));
    }
    // Boss framing: while a surfaced boss is within reach, look 40% of the way to it (up to 70% when that frames both
    // hulls closer), drop 4° of pitch and pull to the closest distance that keeps both hulls in frame. A boss that
    // newly enters framing gets a 1.2 s arrival beat.
    if (boss && boss.id !== this.bossId) { this.bossId = boss.id; this.arrival = BOSS_ARRIVAL; }
    else if (!boss && this.bossFrame < 0.02) this.bossId = -1;
    this.arrival = Math.max(0, this.arrival - dt);
    this.bossFrame = damp(this.bossFrame, boss ? 1 : 0, boss ? 1.4 : 0.8, dt);
    if (boss) { this.bossPoint.set(boss.x, boss.z); this.bossHeading = boss.heading; this.bossLength = boss.length; }
    let pitchOffset = 0;
    this.framing.beat = 0;
    if (this.bossFrame > 0.01) {
      const k = smooth01(this.bossFrame);
      const since = BOSS_ARRIVAL - this.arrival;
      const beat = this.arrival > 0 ? Math.min(smooth01(since / 0.3), smooth01(this.arrival / 0.5)) : 0;
      this.framing.beat = beat;
      const bx = this.bossPoint.x - focus.x, bz = this.bossPoint.y - focus.z;
      pitchOffset = (BOSS_PITCH - deg(2) * beat) * k;
      const pitchB = basePitch + pitchOffset;
      // The boss is the centrepiece: the camera may come to half the hero-size distance (the hero's silhouette then
      // takes up to about a third of the frame height) so the boss hull stays large; never beyond 460 m.
      const nearest = Math.max(110, this.heroBase * 0.5 * this.zoom);
      // Look weight: the 40% base, or up to 60% when that brings the camera closer to the boss with both hulls in frame.
      const cpB = Math.cos(pitchB), spB = Math.sin(pitchB), syB = Math.sin(this.yaw), cyB = Math.cos(this.yaw);
      let bestW = 0.4, bestD = Infinity;
      for (let w = 0.4; w <= 0.601; w += 0.05) {
        const lx = focus.x + bx * w, lz = focus.z + bz * w;
        const d = THREE.MathUtils.clamp(this.fitBoth(ctx, focus, lx, lz, pitchB), nearest, 460);
        const cx = lx + syB * cpB * d - this.bossPoint.x, cz = lz + cyB * cpB * d - this.bossPoint.y;
        const toBoss = Math.hypot(cx, spB * d, cz);
        if (toBoss < bestD * 0.97) { bestD = toBoss; bestW = w; }
      }
      this.bossWeight = damp(this.bossWeight, bestW, 1.5, dt);
      const w = Math.max(this.bossWeight, 0.4 + 0.3 * beat);
      this.framing.bossWeight = w;
      tx = THREE.MathUtils.lerp(tx, focus.x + bx * w, k);
      tz = THREE.MathUtils.lerp(tz, focus.z + bz * w, k);
      const fit = this.fitBoth(ctx, focus, focus.x + bx * w, focus.z + bz * w, pitchB);
      this.framing.bossFit = fit;
      const bossDistance = THREE.MathUtils.clamp(fit * (1 + 0.12 * beat), nearest, 460);
      distance = THREE.MathUtils.lerp(distance, bossDistance, k);
    }
    this.distance = damp(this.distance, distance, 2.2, dt);
    this.framing.distance = this.distance;
    this.target.x = damp(this.target.x, tx, 5.5, dt);
    this.target.z = damp(this.target.z, tz, 5.5, dt);
    this.target.y = damp(this.target.y, 2, 4, dt);
    if (!this.initialized) { this.target.set(tx, 2, tz); this.distance = distance; this.initialized = true; }

    // Occlusion: rise over islands between the camera and the ship.
    const needed = this.occlusionPitch(ctx, basePitch);
    const lift = Math.max(0, needed - basePitch);
    this.liftPitch = damp(this.liftPitch, lift, lift > this.liftPitch ? 6 : 1.2, dt);
    this.pitch = damp(this.pitch, THREE.MathUtils.clamp(basePitch + this.liftPitch + pitchOffset, MIN_PITCH, MAX_PITCH), 4, dt);
    this.fov = damp(this.fov, TACTICAL_FOV, 2.5, dt);

    this.place(ctx, dt, 4.5);
  }

  /** Hero mast and deck heights above the water (measured model via ShipServices anchors; length-based fallbacks). */
  private measureHero(ctx: FrameContext, length: number, dt: number): void {
    const ships = ctx.services.ships;
    const water = ctx.services.ocean.heightAt(ctx.focus.x, ctx.focus.z);
    let mast = length * 0.45, deck = Math.max(2.5, length * 0.1);
    if (ships.anchor(0, 'mast', this.anchor)) mast = Math.max(mast, this.anchor.y - water);
    if (ships.anchor(0, 'deck', this.anchor)) deck = THREE.MathUtils.clamp(this.anchor.y - water, 1.5, 20);
    const first = this.mastH === 0;
    this.mastH = first ? mast : damp(this.mastH, mast, 1.5, dt);
    this.framing.mastH = this.mastH;
    this.deckH = first ? deck : damp(this.deckH, deck, 1.5, dt);
  }

  /**
   * Camera distance for the hero alone: 118 → 172 m with the fight, + (length − 40) × 1.8 + mast height; never so close
   * that the hull (bow → stern seen from astern at this pitch, plus the freeboard) exceeds HERO_FRAME of the frame
   * height; never deeper than a third of the way into the fog band.
   */
  private heroDistance(ctx: FrameContext, length: number, pitch: number): number {
    const fight = THREE.MathUtils.lerp(0, 54, this.pressure);
    const brief = 118 + Math.max(0, length - 40) * 1.8 + this.mastH;
    // Hull footprint seen from astern at any heading the lazy follow allows (the diagonal covers turns), grown by the
    // tier scale; the look-ahead brings the hull nearer the camera than the target, so it is added back as depth.
    const run = ctx.run;
    const beam = run ? SHIPS[run.shipId]?.beam ?? length * 0.3 : length * 0.3;
    const grown = 1 + (run?.player.tier ?? 0) * 0.025;
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const half = Math.hypot(length, beam) * grown * 0.5 * sp;
    // Seen from astern: the hull runs from the stern at the waterline up to the bow at deck height; the whole silhouette
    // up to the higher of that bow and the mast tops (amidships). Both must fit HERO_FRAME of the frame height.
    const hull = half * 2 + this.deckH * cp;
    const silhouette = half + Math.max(half + this.deckH * cp, this.mastH * cp);
    const tanV = Math.tan(deg(TACTICAL_FOV) * 0.5);
    const clampD = Math.max(hull, silhouette) / (HERO_FRAME * 2 * tanV) + Math.hypot(this.lookAhead.x, this.lookAhead.y) * cp;
    const a = ctx.atmosphere;
    const fogCap = Math.max(170, a.fogNear + (a.fogFar - a.fogNear) * 0.3);
    this.framing.fogCap = fogCap;
    this.heroBase = Math.min(Math.max(brief, clampD), fogCap);
    const d = Math.min(Math.max(brief, clampD) + fight, fogCap);
    this.framing.hullFrame = Math.max(hull, silhouette) / (2 * tanV * d);
    return d;
  }

  /**
   * Closest camera distance (looking at (tx, tz) from the current yaw at `pitch`) that keeps the hero (bow, stern,
   * mast top) inside the HUD-safe centre (76% × 72% of the half-frame) and the framed boss hull (bow, stern, a top
   * point) inside 92% × 90%.
   */
  private fitBoth(ctx: FrameContext, focus: FrameContext['focus'], tx: number, tz: number, pitch: number): number {
    const p = this.fitPts;
    const hf = -Math.sin(focus.heading), hz = -Math.cos(focus.heading);
    const L = ctx.run ? SHIPS[ctx.run.shipId]?.length ?? 40 : 40;
    const bfx = -Math.sin(this.bossHeading), bfz = -Math.cos(this.bossHeading);
    const BL = this.bossLength;
    // hero: bow, stern (deck), mast top
    p[0] = focus.x + hf * L * 0.5; p[1] = this.deckH; p[2] = focus.z + hz * L * 0.5;
    p[3] = focus.x - hf * L * 0.5; p[4] = this.deckH; p[5] = focus.z - hz * L * 0.5;
    p[6] = focus.x; p[7] = this.mastH; p[8] = focus.z;
    // boss: bow, stern (near the water), superstructure top
    const bx = this.bossPoint.x, bz = this.bossPoint.y;
    p[9] = bx + bfx * BL * 0.5; p[10] = 3; p[11] = bz + bfz * BL * 0.5;
    p[12] = bx - bfx * BL * 0.5; p[13] = 3; p[14] = bz - bfz * BL * 0.5;
    p[15] = bx; p[16] = BL * 0.18; p[17] = bz;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // camera axes: forward (camera → target), right, up
    const fx = -sy * cp, fy = -sp, fz = -cy * cp;
    const rx = cy, rz = -sy;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const tanV = Math.tan(deg(TACTICAL_FOV) * 0.5);
    const aspect = ctx.viewport.width / Math.max(1, ctx.viewport.height);
    let d = 0;
    for (let i = 0; i < 6; i++) {
      // the hero stays inside the HUD-safe centre (roster top right, gauges and skill bar along the bottom)
      const mx = i < 3 ? 0.76 : 0.92, my = i < 3 ? 0.72 : 0.9;
      const qx = p[i * 3]! - tx, qy = p[i * 3 + 1]! - 2, qz = p[i * 3 + 2]! - tz;
      const x = qx * rx + qz * rz;
      const y = qx * ux + qy * uy + qz * uz;
      const depth = qx * fx + qy * fy + qz * fz;
      d = Math.max(d, Math.abs(x) / (mx * tanV * aspect) - depth, Math.abs(y) / (my * tanV) - depth);
    }
    return d;
  }

  /** The nearest live, surfaced boss within framing range of (x, z), or null. */
  private nearestBoss(run: NonNullable<FrameContext['run']>, x: number, z: number): Readonly<BossState> | null {
    let best: Readonly<BossState> | null = null;
    let bestD = BOSS_RANGE;
    for (const b of run.bosses) {
      if (b.life !== 'alive' || b.submerged > 0.7) continue;
      const d = Math.hypot(b.x - x, b.z - z) - b.length * 0.3;
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  /** Minimum pitch that keeps the line of sight from the camera to the target clear of island tops. */
  private occlusionPitch(ctx: FrameContext, pitch: number): number {
    const world = ctx.world;
    const cosP = Math.cos(pitch);
    const dirX = Math.sin(this.yaw), dirZ = Math.cos(this.yaw);
    const horizontal = this.distance * cosP;
    world.islandsNear(this.target.x + dirX * horizontal * 0.5, this.target.z + dirZ * horizontal * 0.5, horizontal * 0.5 + 40, this.islands);
    if (!this.islands.length) return pitch;
    let required = pitch;
    const samples = 14;
    for (let i = 1; i <= samples; i++) {
      const d = (i / samples) * horizontal;
      const x = this.target.x + dirX * d, z = this.target.z + dirZ * d;
      if (world.shoreDistance(x, z, 30) > 12) continue;
      let height = 0;
      for (const island of this.islands) {
        if (Math.hypot(x - island.x, z - island.z) < island.radius + 12) height = Math.max(height, island.height);
      }
      if (height <= 0) continue;
      const clearance = height + 18 - this.target.y;
      required = Math.max(required, Math.atan2(clearance, d));
    }
    return required;
  }

  // ───────────── Showcase ─────────────

  private updateShowcase(ctx: FrameContext, dt: number): void {
    const id = (ctx.menuShip ?? 'sunlion') as ShipId;
    const length = SHIPS[id]?.length ?? 46;
    this.showcaseYaw += dt * 0.07;
    this.yaw = wrapAngle(this.yaw + wrapAngle(this.showcaseYaw + this.userYaw - this.yaw) * (1 - Math.exp(-dt * 1.5)));
    this.pitch = damp(this.pitch, THREE.MathUtils.clamp(0.13 + this.userPitch * 0.5, 0.04, 0.6), 1.5, dt);
    this.tilt = damp(this.tilt, 0, 3, dt);
    // Framed by the measured model: the length (+ margin) or, for tall ships, the waterline → mast top with 8% headroom
    // at the depth of the nearest masts (they stand along the hull, up to half a length closer than the centre).
    this.measureHero(ctx, length, dt);
    const halfHeight = (this.mastH * 0.5) / 0.84;
    const fit = Math.max(length * 1.15 + 22, halfHeight / Math.tan(deg(SHOWCASE_FOV) * 0.5) + length * 0.45);
    const centreY = this.mastH * 0.48;
    this.distance = damp(this.distance, fit * THREE.MathUtils.clamp(this.zoom, 0.7, 1.6), 1.5, dt);
    this.framing.distance = this.distance;
    this.framing.heroDistance = fit;
    this.fov = damp(this.fov, SHOWCASE_FOV, 1.5, dt);
    this.target.x = damp(this.target.x, ctx.focus.x, 3, dt);
    this.target.z = damp(this.target.z, ctx.focus.z, 3, dt);
    this.target.y = damp(this.target.y, centreY, 3, dt);
    if (!this.initialized) { this.target.set(ctx.focus.x, centreY, ctx.focus.z); this.initialized = true; }
    this.place(ctx, dt, 2.2);
    // Harbor: the fleet panel covers the left ~45% and the WANTED poster the right edge; frame the ship in the gap.
    this.showcaseShift = damp(this.showcaseShift, ctx.screen === 'harbor' ? 0.26 : 0, 2, dt);
    if (this.showcaseShift > 1e-3) {
      const aspect = ctx.viewport.width / Math.max(1, ctx.viewport.height);
      const s = this.showcaseShift * this.distance * Math.tan(THREE.MathUtils.degToRad(this.fov) / 2) * aspect;
      this.lookTarget.x -= Math.cos(this.yaw) * s;
      this.lookTarget.z += Math.sin(this.yaw) * s;
    }
  }

  // ───────────── Placement + effects ─────────────

  private place(ctx: FrameContext, dt: number, rate: number): void {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.desired.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + sp * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    const water = ctx.services.ocean.heightAt(this.desired.x, this.desired.z);
    this.desired.y = Math.max(this.desired.y, water + 3.5);
    if (!Number.isFinite(this.position.x) || this.position.distanceToSquared(this.desired) > 1e7) this.position.copy(this.desired);
    this.position.x = damp(this.position.x, this.desired.x, rate, dt);
    this.position.y = damp(this.position.y, this.desired.y, rate, dt);
    this.position.z = damp(this.position.z, this.desired.z, rate, dt);
    this.lookTarget.copy(this.target);
  }

  private applyEffects(ctx: FrameContext, dt: number): void {
    const cam = this.camera;
    cam.position.copy(this.position);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lookTarget);
    // Cinematic band: tilt the view up so the horizon sits along the top of the frame (the ship moves down).
    if (this.tilt > 1e-4) cam.rotateX(this.tilt);

    // Shake after damping: trauma² envelope, positional + rotational (roll strongest).
    this.shakeClock += dt;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const setting = THREE.MathUtils.clamp(ctx.settings.cameraShake ?? 1, 0, 1.5);
      const k = this.shakeTime / this.shakeDuration;
      const trauma = this.shakeAmp * k * k * setting;
      if (trauma > 1e-4) {
        const t = this.shakeClock * 22;
        this.right.setFromMatrixColumn(cam.matrixWorld, 0);
        this.up.setFromMatrixColumn(cam.matrixWorld, 1);
        const scale = 0.012 * this.distance;
        cam.position.addScaledVector(this.right, wobble(t, 1.3) * trauma * scale);
        cam.position.addScaledVector(this.up, wobble(t, 7.1) * trauma * scale * 0.8);
        this.euler.set(wobble(t, 3.7) * trauma * 0.012, wobble(t, 5.3) * trauma * 0.012, wobble(t * 0.8, 9.1) * trauma * 0.045);
        this.quat.setFromEuler(this.euler);
        cam.quaternion.multiply(this.quat);
      }
    } else {
      this.shakeAmp = 0;
    }

    // FOV kick: fast attack, eased release.
    let kick = 0;
    if (this.kickTime > 0) {
      this.kickTime = Math.max(0, this.kickTime - dt);
      const elapsed = this.kickDuration - this.kickTime;
      const attack = Math.min(1, elapsed / 0.05);
      const release = Math.pow(this.kickTime / this.kickDuration, 1.4);
      kick = this.kickAmount * attack * release;
    }
    if (this.focusTime > 0) this.focusTime = Math.max(0, this.focusTime - dt);
    const fov = this.fov + kick;
    const near = ctx.screen === 'run' || ctx.screen === 'results' ? 2 : 0.8;
    if (Math.abs(cam.fov - fov) > 0.001 || cam.near !== near || cam.far !== 6000) {
      cam.fov = fov; cam.near = near; cam.far = 6000;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  private focusEnvelope(): number {
    const elapsed = this.focusDuration - this.focusTime;
    const inK = Math.min(1, elapsed / 0.6);
    const outK = Math.min(1, this.focusTime / 0.8);
    const k = Math.min(inK, outK);
    return k * k * (3 - 2 * k);
  }

  // ───────────── CameraServices ─────────────

  shake(strength: number, duration = 0.35): void {
    if (!(strength > 0)) return;
    const current = this.shakeTime > 0 ? this.shakeAmp * (this.shakeTime / this.shakeDuration) ** 2 : 0;
    const next = Math.min(1.6, Math.max(strength, current + strength * 0.35));
    this.shakeAmp = next;
    this.shakeDuration = Math.max(0.08, duration);
    this.shakeTime = this.shakeDuration;
  }

  kick(fovDegrees: number, duration = 0.35): void {
    if (!(Math.abs(fovDegrees) > 0)) return;
    const current = this.kickTime > 0 ? this.kickAmount * Math.pow(this.kickTime / this.kickDuration, 1.4) : 0;
    this.kickAmount = THREE.MathUtils.clamp(Math.max(fovDegrees, current + fovDegrees * 0.4), -12, 14);
    this.kickDuration = Math.max(0.08, duration);
    this.kickTime = this.kickDuration;
  }

  focusOn(x: number, z: number, duration: number): void {
    this.focusPoint.set(x, z);
    this.focusDuration = Math.max(0.5, duration);
    this.focusTime = this.focusDuration;
  }

  /** Lab/QA: resets user orbit/zoom. */
  resetView(): void { this.userYaw = 0; this.userPitch = 0; this.zoom = 1; }

  /** Lab/QA: pins the showcase orbit angle (radians, world yaw of the camera offset) and snaps to it. */
  setShowcaseAngle(yaw: number, snap = true): void {
    this.showcaseYaw = yaw;
    if (snap) { this.yaw = yaw + this.userYaw; this.initialized = false; }
  }

  private readonly onContext = (event: Event) => event.preventDefault();
  private readonly onDown = (event: PointerEvent) => {
    if (event.button !== 2) return;
    this.dragging = true; this.lastX = event.clientX; this.lastY = event.clientY;
  };
  private readonly onUp = (event: PointerEvent) => { if (event.button === 2) this.dragging = false; };
  private readonly onMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    this.userYaw = wrapAngle(this.userYaw - (event.clientX - this.lastX) * 0.005);
    this.userPitch = THREE.MathUtils.clamp(this.userPitch + (event.clientY - this.lastY) * 0.004, MIN_PITCH - TACTICAL_PITCH, MAX_PITCH - TACTICAL_PITCH);
    this.lastX = event.clientX; this.lastY = event.clientY;
  };
  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + Math.sign(event.deltaY) * 0.08), 0.6, 1.9);
  };

  dispose(): void {
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
