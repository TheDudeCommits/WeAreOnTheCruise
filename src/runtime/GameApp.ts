import * as THREE from 'three';
import { AudioDirector } from '../audio';
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
  GameSimulation,
  type OceanSampler,
  type SimulationEvent,
} from '../simulation';
import { Hud, type VoyageAction } from '../ui';
import { selectAimTarget } from '../render/camera/AimGuide';
import type { ControlSettings } from '../input/controls';
import { readySurfaceTextures, disposeSurfaceTextures } from '../render/npr/surfaceTextures';
import { atmosphereFor } from '../render/world/Atmosphere';
import type { AppConfig } from './AppConfig';
import { toPresentationEvents } from './eventAdapter';
import { createShipMaterialSet } from './shipPresentation';

const CAMERA_PRESETS: readonly CameraPreset[] = ['chase', 'broadside', 'bow', 'deck', 'cinematic', 'overhead'];
const VOYAGE_SAVE_KEY = 'cruise.voyage.v1';

/** Preserve the exact rejected bytes without replacing an earlier recovery copy. */
export function preserveRejectedVoyage(storage: Pick<Storage, 'getItem' | 'setItem'>, raw: string): string {
  const prefix = 'cruise.voyage.recovery.v1';
  let key = prefix;
  for (let suffix = 1; ; suffix += 1) {
    const existing = storage.getItem(key);
    if (existing === raw) return key;
    if (existing === null) break;
    key = `${prefix}.${suffix}`;
  }
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('Recovery copy was not preserved');
  return key;
}

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
  private saveTime = 0;
  private saveSignature = '';
  private restored = false;
  private saveBlocked = false;
  private hemisphere!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private atmosphereWeather?: WorldState['weather'];
  private get persistentSession():boolean { return !this.options.captureMode && !new URLSearchParams(location.search).has('scene'); }
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
    if(this.persistentSession){
      let saved: string | null = null;
      try { saved = localStorage.getItem(VOYAGE_SAVE_KEY); }
      catch { this.saveBlocked = true; this.root.dataset.save = 'unavailable'; }
      if (saved !== null) {
        try { this.restored = this.simulation.restoreSave(JSON.parse(saved)); }
        catch { this.restored = false; }
        if (!this.restored) {
          try {
            this.root.dataset.saveRecoveryKey = preserveRejectedVoyage(localStorage, saved);
            this.root.dataset.saveRecovery = 'preserved';
          } catch {
            // Storage may be full. Protect the original primary value instead of overwriting it.
            this.saveBlocked = true;
            this.root.dataset.saveRecovery = 'protected';
          }
        }
      }
      if(!this.restored)this.simulation.returnToHarbor();
    }
    this.rendererHost = new RendererHost(this.root, this.options.captureMode, this.options.quality === 'performance');
    this.rendererHost.setAdaptiveQualityEnabled(!this.options.captureMode && this.options.quality !== 'capture');
    this.installLighting();
    this.world = new WorldRenderer(this.rendererHost.scene, { seedNumber: this.simulation.getState().seedNumber });
    const oceanSampler: OceanSampler = { sample: (x, z, time) => this.world.sampleOcean(x, z, time) };
    this.simulation.setWaveSampler(oceanSampler);

    this.fleet = new ShipFleetView(this.rendererHost.scene, {
      castShadow: this.options.quality !== 'performance',
      materialFactory: (kind, palette) => createShipMaterialSet(kind, palette, this.shipMaterials),
    });
    this.fx = new NavalFxView(this.rendererHost.scene, { waveSampler: oceanSampler });
    this.raceCourse = new RaceCourseView(this.rendererHost.scene, this.simulation.getRaceCourse(), { waveSampler: oceanSampler });
    this.cameraRig = new CameraRig(this.rendererHost.camera, this.rendererHost.renderer.domElement, this.rendererHost.scene,(x,z,time)=>oceanSampler.sample(x,z,time).height);
    // Selective geometry contours replace the full-scene normal/Sobel pass.
    // The old normal override did not deform the ocean and outlined submerged hulls.

    this.audio = new AudioDirector();
    this.hud = new Hud(this.root, {
      captureMode: this.options.captureMode,
      skipIntro: this.restored,
      initialShip: this.player()?.kind ?? 'thousand-sunny',
      onLaunch: async (kind) => {
        this.selectShip(kind);
        if(this.persistentSession && !this.simulation.getState().voyage)this.simulation.returnToHarbor();
        this.setCamera(this.simulation.getState().voyage?.phase==='harbor'?'cinematic':'chase');
        this.setPaused(false);
      },
      onPreviewShip: (kind) => { this.selectShip(kind); this.setCamera('cinematic'); },
      onVoyageAction: (action) => this.voyageAction(action),
      onSettingsChange: (settings) => this.applyControlSettings(settings),
      onAimChange: (side) => this.input?.setAim(side),
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
      if(action==='pause'){if(pressed) this.hud.togglePauseMenu();}
      else this.handleAction(action, pressed);
    });
    this.input.attach();
    window.addEventListener('keydown', this.onCameraKey, { passive: false });
    window.addEventListener('beforeunload', this.onBeforeUnload, { once: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
    this.applyControlSettings(this.hud.settings);

    if(this.options.captureMode) await this.setScene(this.scene);
    else { this.setCamera(this.restored&&this.simulation.getState().voyage?.phase!=='harbor'?'chase':'cinematic'); this.renderFrame(1/60,true); }
    await this.fleet.ready();
    await readySurfaceTextures();
    this.renderFrame(1/60,true);
    // Compile pooled, currently hidden effects before the player can activate
    // them. compileAsync traverses these objects without changing visibility.
    await this.rendererHost.renderer.compileAsync(this.fx.root, this.rendererHost.camera, this.rendererHost.scene);
    if(this.restored) this.hud.showVoyage();
    const beginPaused = this.options.captureMode || this.hud.isBlockingInput;
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
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    this.saveProgress();
    this.input.detach();
    this.cameraRig.dispose();
    this.hud.destroy();
    this.audio.destroy();
    this.edgeComposer?.dispose();
    this.raceCourse.dispose();
    this.fx.dispose();
    this.fleet.dispose();
    this.world.dispose();
    for (const material of this.shipMaterials) material.dispose();
    this.shipMaterials.clear();
    disposeSurfaceTextures();
    this.rendererHost.dispose();
    delete window.__CRUISE_DEBUG__;
  }

  private readonly loop = (now: number): void => {
    if (this.disposed) return;
    const delta = Math.min(0.1, Math.max(0, (now - this.lastFrameAt) / 1000));
    this.lastFrameAt = now;
    this.updateInputGate();
    this.input.pollGamepad();
    const aim=this.input.getAimState();
    this.simulation.setAim(aim.side,aim.adjustment);
    if (this.impactFreeze > 0) this.impactFreeze = Math.max(0, this.impactFreeze - delta);
    else this.simulation.update(delta);
    this.renderFrame(delta);
    this.saveTime += delta;
    const state=this.simulation.getState();
    const key=`${state.voyage?.id}:${state.voyage?.phase}:${state.voyage?.leg}:${state.progression?.bankedCoins}`;
    if(this.saveTime>2 || key!==this.saveSignature){this.saveProgress();this.saveTime=0;this.saveSignature=key;}
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
      features: state.worldFeatures,
    });
    if(this.atmosphereWeather!==state.weather){
      this.atmosphereWeather=state.weather;const p=atmosphereFor(state.weather);
      this.hemisphere.color.setHex(p.horizon);this.hemisphere.intensity=.9*p.exposure;
      this.sun.color.setHex(p.sun);this.sun.intensity=2*p.exposure;
    }
    this.sun.target.position.set(player.position.x, 0, player.position.z);
    this.sun.position.set(player.position.x - 225, 410, player.position.z + 175);
    this.fleet.sync(state, state.elapsed);
    this.fx.sync(state, state.elapsed);
    this.raceCourse.update(state.elapsed);
    this.raceCourse.setActiveCheckpoint(state.race.checkpoint);
    const cameraSubject = this.options.captureMode && this.scene === 'moby-scale'
      ? state.ships.find((ship) => ship.kind === 'moby-dick') ?? player
      : player;
    const aim=this.input?.getAimState()??{adjustment:0};
    const target = selectAimTarget(player, state.ships, aim, state.combat?.weakPointTargetId ?? player.targetId);
    this.cameraRig.setAim(aim.side,aim.adjustment,target,this.hud?.settings.aimAssist??true);
    this.cameraRig.update(cameraSubject, Math.max(delta, 1 / 240), state.elapsed, immediateCamera);
    const speedRatio = Math.min(1, Math.abs(player.speed) / Math.max(1, player.maxSpeed));
    const cameraPreset = CAMERA_PRESETS[this.cameraPresetIndex];
    const desiredFov = 53 + speedRatio * 8 + (state.mode === 'combat' ? 3 : 0) + (cameraPreset === 'overhead' ? 10 : 0);
    this.rendererHost.camera.fov = THREE.MathUtils.lerp(this.rendererHost.camera.fov, desiredFov, immediateCamera ? 1 : 1 - Math.exp(-3.5 * delta));
    this.rendererHost.camera.updateProjectionMatrix();
    this.hud.update(state, delta);
    this.hud.setAim(aim,player,target);
    this.updateInputGate();
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
    if(!this.options.captureMode && this.simulation.getState().voyage && ['encounter','route','reward'].includes(this.simulation.getState().voyage!.phase)) throw new Error('Finish or extract from this voyage first.');
    this.scene = scene;
    this.simulation.loadScenario(scene,{preservePlayer:!this.options.captureMode});
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
    this.simulation.selectPlayerShip(kind);
    if(this.hud)this.renderFrame(1/60,true);
    this.saveProgress();
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
    if (!this.options.captureMode && (this.simulation.getState().paused || this.hud?.isBlockingInput)) return;
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
    if(paused)this.simulation.clearActions();
    this.updateInputGate();
    if(paused)this.saveProgress();
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
    if (width === this.viewportWidth && height === this.viewportHeight) return;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.world.setViewport(width, height);
    this.edgeComposer?.setSize(width, height);
  }

  private installLighting(): void {
    const hemisphere = this.hemisphere = new THREE.HemisphereLight(0xbfefff, 0x08416a, 1.2);
    const sun = this.sun = new THREE.DirectionalLight(0xffedb0, 2.4);
    sun.position.set(-320, 520, 260);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = this.options.quality !== 'performance';
    sun.shadow.mapSize.set(2048,2048);
    Object.assign(sun.shadow.camera,{left:-125,right:125,top:125,bottom:-125,near:1,far:900});
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias=.16; sun.shadow.bias=-.00018; sun.shadow.radius=1.4;
    this.rendererHost.scene.add(hemisphere, sun, sun.target);
  }

  private updateInputGate(): void {
    const enabled=!this.simulation.getState().paused && !this.hud?.isBlockingInput;
    this.input?.setEnabled(enabled);this.cameraRig?.setInteractionEnabled(enabled);
  }

  private applyControlSettings(settings:Readonly<ControlSettings>):void {
    this.input?.setBindings(settings.keyBindings);this.cameraRig?.setComfort(settings.cameraShake);
  }

  private async voyageAction(action:VoyageAction):Promise<void> {
    let accepted:boolean|void;
    switch(action.type){
      case 'start': accepted=this.simulation.startVoyage(action.contractId,action.buildId);break;
      case 'route': accepted=this.simulation.chooseRoute(action.routeId);break;
      case 'collect': accepted=this.simulation.collectEncounterReward();break;
      case 'reward': accepted=this.simulation.chooseReward(action.upgradeId);break;
      case 'extract': accepted=this.simulation.extractVoyage();break;
      case 'harbor': accepted=this.simulation.returnToHarbor();break;
      case 'refit': accepted=this.simulation.buyRefit(action.refitId);break;
      case 'crew': accepted=this.simulation.setCrewPreset(action.preset);break;
      case 'resolve': accepted=this.simulation.resolveDisabledShip(action.shipId,action.resolution);break;
    }
    if(accepted===false)throw new Error('That order is not available here.');
    this.raceCourse.setCourse(this.simulation.getRaceCourse());
    if(action.type==='route')this.setCamera('chase');
    this.renderFrame(1/60,true);this.saveProgress();
  }

  private saveProgress():void {
    if(!this.persistentSession || !this.simulation || this.saveBlocked)return;
    try {localStorage.setItem(VOYAGE_SAVE_KEY,JSON.stringify(this.simulation.exportSave()));this.root.dataset.save='saved';}
    catch {this.root.dataset.save='unavailable';}
  }

  private readonly onPageHide=():void=>{this.setPaused(true);this.saveProgress();};

  private readonly onVisibilityChange=():void=>{if(document.hidden){this.setPaused(true);this.saveProgress();}};

  private installDebugBridge(): void {
    const bridge: CruiseDebugBridge = {
      version: 1,
      ready: false,
      setScene: async (scene) => this.setScene(scene),
      getScene: () => this.scene,
      getState: () => this.simulation.snapshot(),
      getMetrics: () => ({ ...this.metrics }),
      getAim: () => this.cameraRig.getAimDebug(),
      selectShip: (kind) => this.selectShip(kind),
      action: (action, pressed = true) => this.handleAction(action, pressed),
      setPaused: (paused) => this.setPaused(paused),
      step: (frames = 1) => {
        this.simulation.step(frames);
        this.renderFrame(Math.max(1, frames) / 60, true);
      },
      setCamera: (preset) => this.setCamera(preset),
      voyage: (action, id, choice) => {
        const commands:Record<string,VoyageAction>={start:{type:'start',contractId:id??'dawn-blockade',buildId:(choice??'precision') as 'precision'},route:{type:'route',routeId:id??''},reward:{type:'reward',upgradeId:id??''},collect:{type:'collect'},extract:{type:'extract'},harbor:{type:'harbor'},refit:{type:'refit',refitId:id??''},crew:{type:'crew',preset:(id??'balanced') as 'balanced'},resolve:{type:'resolve',shipId:id??'',resolution:(choice??'salvage') as 'salvage'}};
        return commands[action] ? this.voyageAction(commands[action]).then(()=>true).catch(()=>false) : Promise.resolve(false);
      },
      exportSave: () => this.simulation.exportSave(),
      restoreSave: (value) => {const ok=this.simulation.restoreSave(value);if(ok){this.raceCourse.setCourse(this.simulation.getRaceCourse());this.renderFrame(1/60,true);this.saveProgress();}return ok;},
    };
    window.__CRUISE_DEBUG__ = bridge;
  }

  private readonly onCameraKey = (event: KeyboardEvent): void => {
    if(event.defaultPrevented || this.hud?.isBlockingInput || this.simulation.getState().paused || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= CAMERA_PRESETS.length) return;
    event.preventDefault();
    this.setCamera(CAMERA_PRESETS[index]);
  };

  private readonly onBeforeUnload = (): void => this.dispose();
}
