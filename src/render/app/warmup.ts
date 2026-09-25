/**
 * Shader and asset warm-up (PERF-owned). GameApp calls warmup() once, when the harbor first shows. Every step runs in
 * idle time between harbor frames (loaders/idle.ts), so input and the harbor's own frames are never blocked:
 *
 *  1. Enemy models: every manifest hull, prop and dressed look the fleet requested at start-up.
 *  2. Captain hulls: the five hero ships AI captains may sail (never the player's own while others are free; none
 *     when captains are off), each baked in idle slices into the session cache the run reads.
 *  3. Bosses: the boss GLBs and the Tidewyrm head (no longer loaded at boot), then one prepared visual per boss, so a
 *     boss spawn is a re-parent instead of a 30 ms build.
 *  4. Programs: the scene (one top-level group per idle slice) and the prepared bosses, compiled for the colour pass
 *     and the ink prepass with the real targets bound, both instance-colour variants of instanced meshes, then one
 *     shadow-map update with a dummy caster per depth-program variant. Hero templates that load later (a ship switch
 *     in the harbor) are compiled the moment they arrive.
 *  5. Textures: every texture of the scene and the prepared bosses uploaded now (initTexture), one per idle period
 *     (spaced 250 ms apart once a run is on), not on first draw.
 * Order: GPU work first (bosses, programs, textures) — a player may set sail within seconds — then hero models and the
 * captain hull bakes (network and sliced CPU).
 *
 * `window.__PERF__.warmup` reports the phases; see scripts/perf/probe.mjs.
 */
import * as THREE from 'three';
import { SHIPS } from '../../game/content';
import { CAPTAIN_SHIPS } from '../../game/content/captains';
import { captainSetting } from '../../game/sim/captains-runtime';
import type { GameApp } from '../../runtime/GameApp';
import { idleSlice, sleep } from '../loaders/idle';
import { heroTemplateListeners } from '../loaders/SketchfabShipAssets';
import { captainBakeCache, prebakeCaptainHull } from '../ships/fleet/Captains';
import { postStackFor } from './PostStack';
import { activeHost } from './RendererHost';

interface Phase { name: string; ms: number; at: number; programs: number }

export const warmupStatus = {
  started: 0,
  finished: 0,
  phases: [] as Phase[],
  programs: { before: 0, after: 0 },
  textures: 0,
  templates: [] as { kind: string; ms: number; programs: number }[],
  errors: [] as string[],
};

function programCount(renderer: THREE.WebGLRenderer): number { return renderer.info.programs?.length ?? 0; }

export async function warmup(app: GameApp): Promise<void> {
  if (warmupStatus.started) return;
  warmupStatus.started = performance.now();
  const renderer = app.host.renderer, scene = app.host.scene, camera = app.host.camera;
  const post = postStackFor(renderer);
  if (!post) return;
  warmupStatus.programs.before = programCount(renderer);
  installPerfBridge(app);

  // Hero templates that arrive later (a ship switch in the harbor, a run's ship) compile the moment they load.
  heroTemplateListeners.add((template) => {
    const t0 = performance.now();
    void post.precompile(scene, camera, template.scene).then(() => post.warmShadowVariants(template.scene)).then(async () => {
      await uploadTextures(app, template.scene, new Set());
      warmupStatus.templates.push({ kind: template.kind, ms: Math.round(performance.now() - t0), programs: programCount(renderer) });
    }).catch((error: unknown) => warmupStatus.errors.push(`template ${template.kind}: ${String(error)}`));
  });

  const phase = async (name: string, task: () => Promise<unknown>) => {
    const t0 = performance.now();
    try {
      await task();
    } catch (error) {
      warmupStatus.errors.push(`${name}: ${String(error)}`);
      console.warn(`[perf] warm-up ${name} failed`, error);
    }
    warmupStatus.phases.push({ name, ms: Math.round(performance.now() - t0), at: Math.round(performance.now() - warmupStatus.started), programs: programCount(renderer) });
  };

  // Let the harbor transition settle first. GPU work (programs, uploads) goes first — a player may set sail within
  // seconds — then the network-and-CPU work (hero models, captain hull bakes), which runs in idle slices anyway.
  await sleep(500);
  await phase('fleet-models', () => app.ships.fleet.ready());
  let bosses: THREE.Group | null = null;
  await phase('bosses', async () => { bosses = await app.ships.bosses.warm(); });
  await phase('programs', async () => {
    // One top-level group per idle slice (a whole-scene compile is ~10 ms of main thread).
    for (const child of [...scene.children]) {
      await idleSlice();
      if (child.parent === scene) await post.precompile(scene, camera, child);
    }
    if (bosses) { await idleSlice(); await post.precompile(scene, camera, bosses); }
    await idleSlice();
    await Promise.race([post.warmShadowVariants(scene), sleep(3000)]);
    if (bosses) await Promise.race([post.warmShadowVariants(bosses), sleep(3000)]);
  });
  await phase('textures', async () => {
    const seen = new Set<THREE.Texture>();
    for (const child of [...scene.children, ...(bosses ? [bosses] : [])]) warmupStatus.textures += await uploadTextures(app, child, seen);
  });
  // Hero models of the ships the player can sail — the selected one and up to two more unlocked ones (a fresh
  // profile's two starters) — so a run's ship is parsed, compiled and uploaded already. Capped for memory; skipped
  // once a run is under way (its hero is loaded by then).
  await phase('heroes', async () => {
    const ships = [app.selectedShip, ...app.profile.unlockedShips.filter((id) => id !== app.selectedShip)].slice(0, 3);
    for (const id of ships) {
      if (app.screen === 'run') break;
      await idleSlice();
      await app.ships.preload(SHIPS[id].modelKey).catch(() => undefined);
    }
  });
  await phase('captain-hulls', async () => {
    // Captains never sail the player's ship while others are free (5 free ships, at most 4 captains), and a
    // captain-less setting needs no hulls. Each bake downloads that hero's GLBs, so only the candidates are baked.
    if (captainSetting(app.settings) === 0) return;
    const order = CAPTAIN_SHIPS.filter((id) => id !== app.selectedShip);
    for (const id of order) {
      const ship = SHIPS[id];
      await idleSlice();
      await prebakeCaptainHull(ship.modelKey, ship.length);
    }
  });
  if (bosses) app.ships.bosses.releaseWarmupRoot(bosses);
  warmupStatus.programs.after = programCount(renderer);
  warmupStatus.finished = performance.now();
}

/**
 * Uploads the textures under `root` one per idle period (a 2048² atlas plus mips is a few ms of GPU work; a batch of
 * them in one task stalls the next frame's submit). During a run the uploads are also spaced 250 ms apart.
 * Returns how many were uploaded.
 */
async function uploadTextures(app: GameApp, root: THREE.Object3D, seen: Set<THREE.Texture>): Promise<number> {
  const post = postStackFor(app.host.renderer);
  if (!post) return 0;
  const list: THREE.Texture[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture && value.image && !seen.has(value)) { seen.add(value); list.push(value); }
    }
  });
  for (const texture of list) {
    await idleSlice(1000);
    if (app.screen === 'run') await sleep(250);
    post.uploadTexture(texture);
  }
  return list.length;
}

/**
 * Warms objects that are not in the scene yet (prepared boss visuals on a run started without the harbor): compiles
 * their colour, ink and shadow-depth programs against the live scene and uploads their textures, in idle time.
 */
export async function warmObjects(root: THREE.Object3D): Promise<void> {
  const host = activeHost();
  const post = host ? postStackFor(host.renderer) : undefined;
  if (!host || !post) return;
  await idleSlice();
  await post.precompile(host.scene, host.camera, root);
  await Promise.race([post.warmShadowVariants(root), sleep(3000)]);
  const seen = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture && value.image) seen.add(value);
    }
  });
  // One upload per idle period, spaced: this runs during a run (quiet opening minute).
  for (const texture of seen) { await idleSlice(1000); await sleep(250); post.uploadTexture(texture); }
}

/** window.__PERF__: QA hooks for scripts/perf/* (pass split, warm-up phases, bake cache, GPU pass timing). */
function installPerfBridge(app: GameApp): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { __PERF__?: Record<string, unknown> };
  const bridge = w.__PERF__ ?? {};
  Object.assign(bridge, {
    warmup: () => ({ ...warmupStatus, elapsed: warmupStatus.finished ? Math.round(warmupStatus.finished - warmupStatus.started) : null }),
    captainBakes: () => captainBakeCache(),
    bossSources: () => app.ships.sources(),
    bossBuilds: () => ({ ...app.ships.bosses.buildStats }),
  });
  w.__PERF__ = bridge;
}
