/**
 * Application shell (lead-owned): screens, the frame loop, and the wiring between sim, render systems, UI,
 * audio and input. Modules talk to each other only through the contracts in src/render/frame.ts,
 * src/ui/contracts.ts and src/audio/contracts.ts.
 */
import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { CONTENT } from '../game/content';
import type { MetaUpgradeId, SeaId, ShipId } from '../game/ids';
import { applyRunResult, loadProfile, loadSettings, purchaseUpgrade, saveProfile, saveSettings, unlockShip } from '../game/meta/save';
import { Sim } from '../game/sim/Sim';
import type { MetaProfile, RunResult, SeaState, Settings, SimEvent } from '../game/types';
import { Input } from '../input/Input';
import { RendererHost } from '../render/app/RendererHost';
import { PostStack } from '../render/app/PostStack';
import { CameraDirector } from '../render/camera/CameraDirector';
import type { AppScreen, AtmosphereState, FrameContext, QualityTier, RenderServices, RenderSystem } from '../render/frame';
import { FxSystem } from '../render/fx/FxSystem';
import { OceanSystem } from '../render/ocean/OceanSystem';
import { ShipSystem } from '../render/ships/ShipSystem';
import { SkySystem } from '../render/sky/SkySystem';
import { WorldVisuals } from '../render/world/WorldVisuals';
import type { ScreenPoint, UiCallbacks } from '../ui/contracts';
import { Ui } from '../ui/Ui';
import { IslandField } from '../world/IslandField';
import type { AppConfig } from './AppConfig';
import { installDebugBridge } from './debugBridge';

const MENU_SEA: SeaState = {
  weather: 'clear', nextWeather: 'clear', blend: 1, waveScale: 0.75, windDir: 0.6, windStrength: 0.5,
  timeOfDay: 16.5, fog: 0, rain: 0, lightningSerial: 0,
};

export class GameApp {
  readonly host: RendererHost;
  readonly post: PostStack;
  readonly sky = new SkySystem();
  readonly ocean = new OceanSystem();
  readonly worldVisuals = new WorldVisuals();
  readonly ships = new ShipSystem();
  readonly fx = new FxSystem();
  readonly camera = new CameraDirector();
  readonly ui = new Ui();
  readonly audio = new AudioEngine();
  readonly input: Input;
  world: IslandField;
  sim: Sim | null = null;
  profile: MetaProfile;
  settings: Settings;
  screen: AppScreen = 'boot';
  selectedShip: ShipId;
  result: RunResult | null = null;
  ready = false;

  private readonly systems: RenderSystem[];
  private readonly atmosphere: AtmosphereState = {
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.3), sunColor: new THREE.Color(0xfff2cf), sunIntensity: 2, ambientColor: new THREE.Color(0xbfdcff),
    skyColor: new THREE.Color(0x1a6fd0), horizonColor: new THREE.Color(0xa9dbef), fogColor: new THREE.Color(0xa9dbef),
    fogNear: 400, fogFar: 2400, night: 0, storm: 0, flash: 0,
  };
  private readonly services: RenderServices;
  private readonly raycaster = new THREE.Raycaster();
  private readonly waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = new THREE.Vector3();
  private readonly projectVec = new THREE.Vector3();
  private readonly frameEvents: SimEvent[] = [];
  private renderTime = 0;
  private lastFrame = performance.now();
  private raf = 0;
  private paused = false;
  private fps = 60;
  private menuHeading = 0;
  /** QA/bridge input override (steer/aim) that wins over live input until `until` (render time). */
  inputOverride: { steer?: number; aimX?: number; aimZ?: number; until: number } | null = null;

  constructor(private readonly root: HTMLElement, readonly config: AppConfig) {
    this.host = new RendererHost(root, config.captureMode, config.quality === 'low');
    this.post = new PostStack(this.host.renderer);
    this.profile = loadProfile();
    this.settings = loadSettings();
    this.selectedShip = this.profile.lastShip;
    this.world = new IslandField(config.seed);
    this.input = new Input(this.host.renderer.domElement);
    this.systems = [this.sky, this.ocean, this.worldVisuals, this.ships, this.fx, this.camera];
    this.services = {
      ocean: this.ocean,
      camera: this.camera,
      post: this.post,
      ships: this.ships,
      requestSlowMo: (scale, duration) => this.sim?.requestTimeScale(scale, duration),
    };
  }

  async start(): Promise<void> {
    const handles = { renderer: this.host.renderer, scene: this.host.scene, camera: this.host.camera };
    for (const system of this.systems) await system.init(handles);
    this.ui.mount(this.root, this.uiCallbacks());
    if (!this.config.showUi) this.root.classList.add('hide-ui');
    this.input.attach();
    this.audio.setSettings(this.settings);
    await this.ships.preload(CONTENT.ships[this.selectedShip].modelKey).catch(() => undefined);
    // Compile every program with the real post targets bound so the first frames don't hitch.
    await this.post.precompile(this.host.scene, this.host.camera).catch(() => undefined);
    installDebugBridge(this);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.setScreen('title');
    if (this.config.autoRun) this.startRun(this.config.autoRun.ship, this.config.autoRun.sea);
    this.ready = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  renderClock(): number { return this.renderTime; }

  setScreen(screen: AppScreen): void {
    this.screen = screen;
    this.ui.setScreen(screen);
  }

  startRun(shipId: ShipId, seaId: SeaId): void {
    if (!this.profile.unlockedShips.includes(shipId)) return;
    this.selectedShip = shipId;
    this.profile.lastShip = shipId;
    this.profile.lastSea = seaId;
    saveProfile(this.profile);
    this.world = new IslandField(`${this.config.seed}:${this.profile.runs}`);
    this.sim = new Sim({ seed: this.world.seed, shipId, seaId, meta: this.profile, world: this.world });
    if (this.config.god) this.sim.debug.god(true);
    this.result = null;
    this.paused = false;
    this.setScreen('run');
  }

  private finishRun(): void {
    const sim = this.sim;
    if (!sim) return;
    const result = sim.result();
    if (!result) return;
    result.newUnlocks = applyRunResult(this.profile, result);
    saveProfile(this.profile);
    this.result = result;
    this.setScreen('results');
  }

  private uiCallbacks(): UiCallbacks {
    return {
      onUserGesture: () => { void this.audio.unlock().then(() => this.audio.setSettings(this.settings)).catch(() => undefined); },
      onGoToHarbor: () => this.setScreen('harbor'),
      onSelectShip: (id) => { this.selectedShip = id; this.profile.lastShip = id; saveProfile(this.profile); },
      onStartRun: (ship, sea) => this.startRun(ship, sea),
      onChooseCard: (index) => { this.sim?.chooseCard(index); },
      onReroll: () => { this.sim?.reroll(); },
      onBanish: (index) => { this.sim?.banish(index); },
      onPause: (paused) => { this.paused = paused; this.sim?.setPaused(paused); },
      onRetire: () => { this.sim?.retire(); },
      onReturnToHarbor: () => { this.sim = null; this.setScreen('harbor'); },
      onPurchaseUpgrade: (id: MetaUpgradeId) => { if (purchaseUpgrade(this.profile, id)) saveProfile(this.profile); },
      onUnlockShip: (id) => { if (unlockShip(this.profile, id)) { this.selectedShip = id; saveProfile(this.profile); } },
      onSettingsChange: (settings) => { this.settings = settings; saveSettings(settings); this.audio.setSettings(settings); },
    };
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.tick(dt);
  };

  /** One frame of the whole app (also used by the debug bridge for deterministic stepping). */
  tick(dt: number): void {
    this.renderTime += dt;
    this.fps += ((dt > 0 ? 1 / dt : 60) - this.fps) * 0.05;
    const run = this.sim?.state ?? null;
    this.input.setEnabled(this.screen === 'run' && !this.ui.blockingInput && run?.status === 'running');

    // Input → sim.
    if (this.sim && run && this.screen === 'run') {
      const snap = this.input.read();
      this.updateAim(snap.pointerX, snap.pointerY, snap.usingGamepad, snap.stickAimX, snap.stickAimY);
      const o = this.inputOverride && this.inputOverride.until > this.renderTime ? this.inputOverride : null;
      if (o?.aimX !== undefined && o.aimZ !== undefined) this.aimPoint.set(o.aimX, 0, o.aimZ);
      this.sim.setInput({ steer: o?.steer ?? snap.steer, throttleAxis: snap.throttleAxis, aimX: this.aimPoint.x, aimZ: this.aimPoint.z, broadsideHeld: snap.broadsideHeld });
      for (const action of this.input.drainActions()) this.sim.press(action);
      if (!this.paused) this.sim.step(dt);
    }
    this.frameEvents.length = 0;
    if (this.sim) for (const e of this.sim.drainEvents()) this.frameEvents.push(e);
    if (run && (run.status === 'dead' || run.status === 'victory') && this.screen === 'run' && this.frameEvents.some((e) => e.type === 'run-ended')) {
      window.setTimeout(() => this.finishRun(), 1800);
    }

    // Render.
    const focus = run
      ? { x: run.player.x, z: run.player.z, heading: run.player.heading, speed: run.player.speed }
      : { x: 0, z: 0, heading: (this.menuHeading += dt * 0.02), speed: 0 };
    const viewport = this.host.getViewport();
    const ctx: FrameContext = {
      time: this.renderTime, dt, screen: this.screen, run: this.screen === 'run' || this.screen === 'results' ? run : null,
      events: this.frameEvents, sea: run?.sea ?? MENU_SEA, focus, menuShip: run ? null : this.selectedShip,
      aim: { x: this.aimPoint.x, z: this.aimPoint.z }, world: this.world, quality: this.quality(), settings: this.settings,
      viewport: { width: viewport.width, height: viewport.height, dpr: this.host.renderer.getPixelRatio() },
      atmosphere: this.atmosphere, services: this.services,
    };
    for (const system of this.systems) system.update(ctx);
    this.post.update(ctx);
    this.host.render(() => this.post.render(this.host.scene, this.host.camera));

    // UI + audio.
    this.ui.update({
      screen: this.screen, time: this.renderTime, dt, run: ctx.run, events: this.frameEvents, profile: this.profile,
      settings: this.settings, result: this.result, selectedShip: this.selectedShip, fps: this.fps,
      world: ctx.run ? this.world : null, project: (x, y, z, out) => this.project(x, y, z, out),
    });
    const cam = this.host.camera;
    const forward = cam.getWorldDirection(this.projectVec);
    this.audio.update({
      screen: this.screen, time: this.renderTime, dt, run: ctx.run, events: this.frameEvents,
      listener: { x: cam.position.x, y: cam.position.y, z: cam.position.z, forwardX: forward.x, forwardZ: forward.z },
    });
  }

  private updateAim(ndcX: number, ndcY: number, gamepad: boolean, stickX: number, stickY: number): void {
    const p = this.sim!.state.player;
    if (gamepad) {
      if (stickX || stickY) {
        const cam = this.host.camera;
        const yaw = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
        const ax = stickX * Math.cos(yaw) + stickY * Math.sin(yaw);
        const az = -stickX * Math.sin(yaw) + stickY * Math.cos(yaw);
        this.aimPoint.set(p.x + ax * 130, 0, p.z + az * 130);
      }
      return;
    }
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.host.camera);
    if (!this.raycaster.ray.intersectPlane(this.waterPlane, this.aimPoint)) this.aimPoint.set(p.x, 0, p.z - 100);
  }

  project(x: number, y: number, z: number, out: ScreenPoint): ScreenPoint {
    const v = this.projectVec.set(x, y, z).project(this.host.camera);
    const vp = this.host.getViewport();
    out.x = (v.x * 0.5 + 0.5) * vp.width;
    out.y = (-v.y * 0.5 + 0.5) * vp.height;
    out.visible = v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
    return out;
  }

  private quality(): QualityTier {
    const q = this.settings.quality !== 'auto' ? this.settings.quality : this.config.quality;
    return q === 'auto' ? 'high' : q;
  }

  private readonly onVisibility = (): void => {
    if (document.hidden && this.sim && this.screen === 'run' && this.sim.state.status === 'running') {
      this.paused = true; this.sim.setPaused(true);
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.detach();
    for (const system of this.systems) system.dispose();
    this.ui.dispose();
    this.audio.dispose();
    this.post.dispose();
    this.host.dispose();
  }
}
