import * as THREE from 'three';
import { AudioDirector } from '../audio';
import { getShipSpec } from '../content';
import type {
  CruiseDebugBridge,
  DebugScene,
  GameMetrics,
  InputAction,
  ShipKind,
  WorldState,
} from '../core/contracts';
import { InputController } from '../input';
import { RendererHost } from '../render/app/RendererHost';
import { CameraRig, type CameraPreset } from '../render/camera/CameraRig';
import { NavalFxView, RaceCourseView } from '../render/fx';
import { CelEdgeComposer } from '../render/npr';
import { ShipFleetView } from '../render/ships';
import { WorldRenderer } from '../render/world';
import {
  defaultCombatRoleForShip,
  defaultFactionForShip,
  GameSimulation,
  type OceanSampler,
  type SimulationEvent,
} from '../simulation';
import { Hud } from '../ui';
import type { AppConfig } from './AppConfig';
import { toPresentationEvents } from './eventAdapter';
import { createShipMaterialSet, ensureShipInk } from './shipPresentation';

const CAMERA_PRESETS: readonly CameraPreset[] = ['chase', 'broadside', 'bow', 'deck', 'cinematic', 'overhead'];

export class GameApp {
  private rendererHost!: RendererHost;
  private cameraRig!: CameraRig;
  private edgeComposer?: CelEdgeComposer;
  private simulation!: GameSimulation;
  private world!: WorldRenderer;
  private fleet!: ShipFleetView;
  private fx!: NavalFxView;
  private raceCourse!: RaceCourseView;
  private input!: InputController;
  private hud!: Hud;
  private audio!: AudioDirector;
  private metrics: GameMetrics = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, entities: 0, chunks: 0 };
  private scene: DebugScene;
  private frameRequest = 0;
  private lastFrameAt = 0;
  private cameraPresetIndex = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private impactFreeze = 0;
  private disposed = false;
  private readonly shipMaterials = new Set<THREE.Material>();

  constructor(private readonly root: HTMLElement, private readonly options: AppConfig) {
    this.scene = options.initialScene;
  }

  async start(): Promise<void> {
    this.root.innerHTML = '';
    this.root.dataset.quality = this.options.quality;
    document.documentElement.dataset.capture = String(this.options.captureMode);

    this.simulation = new GameSimulation(this.options.seed);
    this.simulation.loadScenario(this.scene);
    this.rendererHost = new RendererHost(this.root, this.options.captureMode, this.options.quality === 'performance');
    this.rendererHost.setAdaptiveQualityEnabled(!this.options.captureMode && this.options.quality !== 'capture');
    this.installLighting();
    this.world = new WorldRenderer(this.rendererHost.scene, { seedNumber: this.simulation.getState().seedNumber });
    const oceanSampler: OceanSampler = { sample: (x, z, time) => this.world.sampleOcean(x, z, time) };
    this.simulation.setWaveSampler(oceanSampler);

    this.fleet = new ShipFleetView(this.rendererHost.scene, {
      castShadow: false,
      materialFactory: (kind, palette) => createShipMaterialSet(kind, palette, this.shipMaterials),
    });
    this.fx = new NavalFxView(this.rendererHost.scene, { waveSampler: oceanSampler });
    this.raceCourse = new RaceCourseView(this.rendererHost.scene, this.simulation.getRaceCourse(), { waveSampler: oceanSampler });
    this.cameraRig = new CameraRig(this.rendererHost.camera, this.rendererHost.renderer.domElement);
    if (this.options.quality !== 'performance') this.installEdgeComposer();

    this.audio = new AudioDirector();
    this.hud = new Hud(this.root, {
      captureMode: this.options.captureMode,
      initialShip: this.player()?.kind ?? 'thousand-sunny',
      onLaunch: async (kind) => {
        this.selectShip(kind);
        this.setPaused(false);
      },
      onAction: (action, pressed) => this.handleAction(action, pressed ?? true),
      onPauseChange: (paused) => this.setPaused(paused),
      onMuteToggle: () => { this.audio.toggleMuted(); },
      onUserGesture: async () => { await this.audio.unlock(); },
      onSceneChange: async (scene) => {
        await this.setScene(scene);
        this.setPaused(false);
      },
    });
    this.hud.element.hidden = !this.options.showHud;

    this.input = new InputController((action, pressed) => {
      if (action !== 'pause') this.handleAction(action, pressed);
    });
    this.input.attach();
    window.addEventListener('keydown', this.onCameraKey, { passive: false });
    window.addEventListener('beforeunload', this.onBeforeUnload, { once: true });

    await this.setScene(this.scene);
    const beginPaused = this.options.captureMode || this.hud.isIntroOpen;
    this.setPaused(beginPaused);
    this.installDebugBridge();
    if (window.__CRUISE_DEBUG__) window.__CRUISE_DEBUG__.ready = true;

    if (!this.options.captureMode) {
      this.lastFrameAt = performance.now();
      this.frameRequest = requestAnimationFrame(this.loop);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    window.removeEventListener('keydown', this.onCameraKey);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.input.detach();
    this.hud.destroy();
    this.audio.destroy();
    this.edgeComposer?.dispose();
    this.raceCourse.dispose();
    this.fx.dispose();
    this.fleet.dispose();
    this.world.dispose();
    for (const material of this.shipMaterials) material.dispose();
    this.shipMaterials.clear();
    this.rendererHost.dispose();
    delete window.__CRUISE_DEBUG__;
  }

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    const delta = Math.min(0.1, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    this.input.pollGamepad();
    if (this.impactFreeze > 0) this.impactFreeze = Math.max(0, this.impactFreeze - delta);
    else this.simulation.update(delta);
    this.renderFrame(delta);
    this.frameRequest = requestAnimationFrame(this.loop);
  };

  private renderFrame(delta: number, immediateCamera = false): void {
    const state = this.simulation.getState();
    const player = this.player();
    if (!player) return;

    this.world.update({
      time: state.elapsed,
      focus: player.position,
      camera: this.rendererHost.camera,
      weather: state.weather,
      windDirection: state.windDirection,
      windStrength: state.windStrength,
      currentDirection: state.currentDirection,
      currentStrength: state.currentStrength,
      islands: state.islands,
    });
    this.fleet.sync(state, state.elapsed);
    this.fx.sync(state, state.elapsed);
    this.raceCourse.update(state.elapsed);
    this.raceCourse.setActiveCheckpoint(state.race.checkpoint);
    const cameraSubject = this.options.captureMode && this.scene === 'moby-scale'
      ? state.ships.find((ship) => ship.kind === 'moby-dick') ?? player
      : player;
    this.cameraRig.update(cameraSubject, Math.max(delta, 1 / 240), state.elapsed, immediateCamera);
    const speedRatio = Math.min(1, Math.abs(player.speed) / Math.max(1, player.maxSpeed));
    const cameraPreset = CAMERA_PRESETS[this.cameraPresetIndex];
    const desiredFov = 53 + speedRatio * 8 + (state.mode === 'combat' ? 3 : 0) + (cameraPreset === 'overhead' ? 10 : 0);
    this.rendererHost.camera.fov = THREE.MathUtils.lerp(this.rendererHost.camera.fov, desiredFov, immediateCamera ? 1 : 1 - Math.exp(-3.5 * delta));
    this.rendererHost.camera.updateProjectionMatrix();
    this.hud.update(state, delta);
    this.audio.update(state, delta);
    this.processEvents(this.simulation.drainEvents(), state);
    this.updateViewport();
    this.rendererHost.render(() => {
      if (this.edgeComposer) this.edgeComposer.render(delta);
      else this.rendererHost.renderer.render(this.rendererHost.scene, this.rendererHost.camera);
    });
    this.metrics = this.rendererHost.getMetrics(state.ships.length + state.projectiles.length, this.world.getChunkCount());
  }

  private processEvents(events: readonly SimulationEvent[], state: WorldState): void {
    if (!events.length) return;
    this.fx.consume(events);
    for (const event of events) {
      for (const presentation of toPresentationEvents(event, state)) {
        this.hud.push(presentation);
        this.audio.handle(presentation);
      }
      const dx = 'position' in event ? event.position.x - (state.ships.find((ship) => ship.id === state.playerId)?.position.x ?? 0) : 0;
      const dz = 'position' in event ? event.position.z - (state.ships.find((ship) => ship.id === state.playerId)?.position.z ?? 0) : 0;
      const proximity = 1 - THREE.MathUtils.clamp(Math.hypot(dx, dz) / 620, 0, 0.88);
      if (event.type === 'cannon-fired') this.cameraRig.impulse(event.shipId === state.playerId ? 0.78 : 0.08 + proximity * 0.12);
      if (event.type === 'projectile-impact') {
        this.cameraRig.impulse(0.18 + proximity * (event.weakPoint ? 1.05 : 0.62));
        if (event.shipId === state.playerId || event.combo) {
          this.impactFreeze = Math.max(this.impactFreeze, event.weakPoint ? 0.07 : 0.035);
        }
      }
      if (event.type === 'ram') {
        this.cameraRig.impulse(0.32 + proximity * 0.82);
        if (event.attackerId === state.playerId || event.targetId === state.playerId) this.impactFreeze = Math.max(this.impactFreeze, 0.085);
      }
      if (event.type === 'special') {
        this.cameraRig.impulse(event.shipId === state.playerId ? 1.2 : 0.24 + proximity * 0.5);
        if (event.shipId === state.playerId) this.impactFreeze = Math.max(this.impactFreeze, 0.06);
      }
    }
  }

  private async setScene(scene: DebugScene): Promise<void> {
    this.scene = scene;
    this.simulation.loadScenario(scene);
    this.raceCourse?.setCourse(this.simulation.getRaceCourse());
    if (this.options.captureMode) this.primeCaptureScene(scene);
    this.simulation.setPaused(this.options.captureMode);
    this.renderFrame(1 / 60, true);
  }

  private primeCaptureScene(scene: DebugScene): void {
    if (scene === 'sunny-broadside') {
      this.simulation.setAction('fire-port', true);
      this.simulation.setAction('fire-starboard', true);
      this.simulation.step(1);
      this.simulation.setAction('fire-port', false);
      this.simulation.setAction('fire-starboard', false);
      this.simulation.step(14);
      return;
    }
    if (scene === 'damaged-ship') {
      this.simulation.step(50);
      const damagedPlayer = this.player();
      if (damagedPlayer) {
        damagedPlayer.roll = 0.19;
        damagedPlayer.pitch = -0.055;
      }
      return;
    }
    if (scene === 'fleet-battle') {
      // Stage the deterministic proof frame after the formations have closed
      // and exchanged multiple volleys, rather than during the opening sail.
      this.simulation.step(600);
      this.simulation.step(600);
      this.simulation.step(180);
      this.simulation.drainEvents();
      this.simulation.step(20);
      return;
    }
    const frames: Partial<Record<DebugScene, number>> = {
      'calm-sailing': 120,
      'storm-sailing': 150,
      'moby-scale': 45,
      'island-discovery': 30,
      'race-rough': 60,
      'crew-closeup': 60,
      'night-encounter': 100,
      'perf-fleet': 140,
    };
    this.simulation.step(frames[scene] ?? 0);
  }

  private selectShip(kind: ShipKind): void {
    const player = this.player();
    if (!player) return;
    const spec = getShipSpec(kind);
    player.kind = kind;
    player.name = spec.displayName;
    player.mass = spec.mass;
    player.maxSpeed = spec.maxSpeed;
    player.speed = Math.min(player.speed, spec.maxSpeed);
    player.faction = defaultFactionForShip(kind);
    player.combatRole = defaultCombatRoleForShip(kind);
    this.renderFrame(1 / 60, true);
  }

  private handleAction(action: InputAction, pressed: boolean): void {
    if (action === 'pause') {
      this.setPaused(pressed);
      return;
    }
    if (!pressed) {
      this.simulation.setAction(action, false);
      return;
    }
    if (action === 'camera-left') {
      this.setCamera(CAMERA_PRESETS[(this.cameraPresetIndex + CAMERA_PRESETS.length - 1) % CAMERA_PRESETS.length]);
      return;
    }
    if (action === 'camera-right') {
      this.setCamera(CAMERA_PRESETS[(this.cameraPresetIndex + 1) % CAMERA_PRESETS.length]);
      return;
    }
    if (action === 'camera-reset') {
      this.setCamera('chase');
      return;
    }
    this.simulation.setAction(action, true);
  }

  private setPaused(paused: boolean): void {
    this.simulation.setPaused(paused);
    this.hud?.setPaused(paused);
  }

  private setCamera(preset: CameraPreset): void {
    this.cameraPresetIndex = CAMERA_PRESETS.indexOf(preset);
    this.cameraRig.setPreset(preset);
    if (this.options.captureMode) this.renderFrame(1 / 60, true);
  }

  private player() {
    const state = this.simulation.getState();
    return state.ships.find((ship) => ship.id === state.playerId);
  }

  private updateViewport(): void {
    const { width, height } = this.rendererHost.getViewport();
    if (this.options.quality !== 'performance') {
      for (const ship of this.simulation.getState().ships) {
        const model = this.fleet.getModel(ship.id);
        if (model) ensureShipInk(model, width, height);
      }
    }
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.world.setViewport(width, height);
    this.edgeComposer?.setSize(width, height);
  }

  private installLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xbfefff, 0x08416a, 1.2);
    const sun = new THREE.DirectionalLight(0xffedb0, 2.4);
    sun.position.set(-320, 520, 260);
    sun.target.position.set(0, 0, 0);
    this.rendererHost.scene.add(hemisphere, sun, sun.target);
  }

  private installEdgeComposer(): void {
    try {
      const viewport = this.rendererHost.getViewport();
      this.edgeComposer = new CelEdgeComposer(
        this.rendererHost.renderer,
        this.rendererHost.scene,
        this.rendererHost.camera,
        {
          width: viewport.width,
          height: viewport.height,
          lineColor: 0x101522,
          lineOpacity: 0.34,
          depthSensitivity: 34,
          normalSensitivity: 1.05,
          colorSensitivity: 0.22,
        },
      );
    } catch {
      this.edgeComposer = undefined;
    }
  }

  private installDebugBridge(): void {
    const bridge: CruiseDebugBridge = {
      version: 1,
      ready: false,
      setScene: async (scene) => this.setScene(scene),
      getScene: () => this.scene,
      getState: () => this.simulation.snapshot(),
      getMetrics: () => ({ ...this.metrics }),
      selectShip: (kind) => this.selectShip(kind),
      action: (action, pressed = true) => this.handleAction(action, pressed),
      setPaused: (paused) => this.setPaused(paused),
      step: (frames = 1) => {
        this.simulation.step(frames);
        this.renderFrame(Math.max(1, frames) / 60, true);
      },
      setCamera: (preset) => this.setCamera(preset),
    };
    window.__CRUISE_DEBUG__ = bridge;
  }

  private readonly onCameraKey = (event: KeyboardEvent): void => {
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= CAMERA_PRESETS.length) return;
    event.preventDefault();
    this.setCamera(CAMERA_PRESETS[index]);
  };

  private readonly onBeforeUnload = (): void => this.dispose();
}
