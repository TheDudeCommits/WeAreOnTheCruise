import * as THREE from 'three';
import type { AmmoKind, ShipState, Vec3, WorldState } from '../../core/contracts';
import { getShipSpec } from '../../content';
import type { OceanSampler, SimulationEvent } from '../../simulation';
import { MOBY_PRESSURE_RADIUS } from '../../simulation/specials';

const PRESSURE_SEGMENTS = 96;
const PRESSURE_ROWS = 4;
const PRESSURE_CAPACITY = 20;
const PRESSURE_VERTICES = (PRESSURE_SEGMENTS + 1) * PRESSURE_ROWS;
const PRESSURE_INDICES = PRESSURE_SEGMENTS * (PRESSURE_ROWS - 1) * 6;
const PRESSURE_RADII = [.76, .91, .974, 1] as const;

interface Puff {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  priority: number;
}

interface WakeTrail {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  contactFoam: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  points: THREE.Vector3[];
  lastPosition: THREE.Vector3;
  width: number;
  links: boolean[];
  detached: boolean;
}

interface ShockRing {
  active: boolean;
  position: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

export interface NavalFxViewOptions {
  projectileCapacity?: number;
  puffCapacity?: number;
  wakeSegments?: number;
  waveSampler?: OceanSampler;
}

/** Pooled projectile, smoke, splash, and persistent wake renderer. */
export class NavalFxView {
  readonly root = new THREE.Group();

  private readonly projectileMesh: THREE.InstancedMesh;
  private readonly trailMesh: THREE.InstancedMesh;
  private readonly puffMesh: THREE.InstancedMesh;
  private readonly ringMesh: THREE.InstancedMesh;
  private readonly specialHalos: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly specialJets: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly specialParticles: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly pressureFronts: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private pressureFrontCount = 0;
  private readonly specialEmissionTimes = new Map<string, number>();
  private readonly projectileCapacity: number;
  private readonly puffs: Puff[];
  private readonly rings: ShockRing[];
  private readonly wakeSegments: number;
  private readonly wakes = new Map<string, WakeTrail>();
  private readonly dummy = new THREE.Object3D();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly direction = new THREE.Vector3();
  private readonly specialPosition = new THREE.Vector3();
  private readonly specialScale = new THREE.Vector3();
  private readonly specialOrientation = new THREE.Quaternion();
  private readonly specialJetRotation = new THREE.Quaternion();
  private readonly specialEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly horizontal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly identityRotation = new THREE.Quaternion();
  private readonly projectileColor = new THREE.Color();
  private readonly damageSpawnTime = new Map<string, number>();
  private readonly ships = new Map<string, ShipState>();
  private waveSampler?: OceanSampler;
  private lastTime = 0;
  private readonly sprayTimes = new Map<string, number>();

  constructor(scene: THREE.Scene, options: NavalFxViewOptions = {}) {
    this.root.name = 'naval-fx';
    scene.add(this.root);
    this.projectileCapacity = Math.max(24, options.projectileCapacity ?? 180);
    this.wakeSegments = Math.max(12, options.wakeSegments ?? 42);
    this.waveSampler = options.waveSampler;

    const projectileGeometry = new THREE.IcosahedronGeometry(0.52, 1);
    const projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.projectileMesh = new THREE.InstancedMesh(projectileGeometry, projectileMaterial, this.projectileCapacity);
    this.projectileMesh.name = 'pooled-projectiles';
    this.projectileMesh.frustumCulled = false;
    this.projectileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.projectileMesh);

    const trailGeometry = new THREE.CylinderGeometry(0.07, 0.22, 2.8, 6, 1, true);
    const trailMaterial = new THREE.MeshBasicMaterial({ color: 0xdedbd2, transparent: true, opacity: 0.34, depthWrite: false });
    this.trailMesh = new THREE.InstancedMesh(trailGeometry, trailMaterial, this.projectileCapacity);
    this.trailMesh.name = 'pooled-projectile-trails';
    this.trailMesh.frustumCulled = false;
    this.trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.trailMesh);

    const puffCapacity = Math.max(48, options.puffCapacity ?? 240);
    const puffGeometry = new THREE.SphereGeometry(1, 10, 7);
    const puffMaterial = new THREE.ShaderMaterial({
      name: 'SoftBillowingSmoke', transparent: true, depthWrite: false,
      vertexShader: `varying vec3 vTint; varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
      void main(){
      #ifdef USE_INSTANCING_COLOR
       vTint=instanceColor;
      #else
       vTint=vec3(1.);
      #endif
      vLocal=position; vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.); vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);vView=-mv.xyz;gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vTint; varying vec3 vNormal; varying vec3 vView; varying vec3 vLocal;
      void main(){float facing=max(0.,dot(normalize(vNormal),normalize(vView)));float billow=.7+.3*sin(vLocal.x*8.+sin(vLocal.z*6.))*sin(vLocal.y*9.);float alpha=pow(facing,1.9)*.22*billow;gl_FragColor=vec4(vTint,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
    });
    this.puffMesh = new THREE.InstancedMesh(puffGeometry, puffMaterial, puffCapacity);
    this.puffMesh.name = 'pooled-smoke-and-spray';
    this.puffMesh.setColorAt(0,new THREE.Color(0xffffff));
    this.puffMesh.count=0;
    this.puffMesh.frustumCulled = false;
    this.puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs = Array.from({ length: puffCapacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      size: 1,
      color: new THREE.Color(),
      priority: 0,
    }));
    this.root.add(this.puffMesh);

    const ringCapacity = 48;
    this.ringMesh = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.76, 1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.58, depthWrite: false, side: THREE.DoubleSide }),
      ringCapacity,
    );
    this.ringMesh.name = 'pooled-combat-shock-rings';
    this.ringMesh.frustumCulled = false;
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings = Array.from({ length: ringCapacity }, () => ({
      active: false,
      position: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      size: 1,
      color: new THREE.Color(),
    }));
    this.root.add(this.ringMesh);
    this.specialHalos = this.makeSpecialPool('special-charge-and-resurface-rings', new THREE.TorusGeometry(1, .035, 5, 40), 128);
    const jetGeometry = new THREE.ConeGeometry(1, 1, 14, 1, true);
    jetGeometry.translate(0, -.5, 0);
    this.specialJets = this.makeSpecialPool('sunny-stern-pressure-jets', jetGeometry, 120);
    this.specialParticles = this.makeSpecialPool('special-foam-exhaust-and-bubbles', new THREE.SphereGeometry(1, 10, 7), 384);
    this.pressureFronts = this.makePressureFronts();
  }

  setWaveSampler(sampler: OceanSampler | undefined): void {
    this.waveSampler = sampler;
  }

  sync(state: WorldState, time = state.elapsed): void {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.ships.clear();
    for (const ship of state.ships) this.ships.set(ship.id, ship);
    this.syncProjectiles(state);
    this.spawnDamageSmoke(state, time);
    this.updatePuffs(dt);
    this.updateRings(dt);
    this.syncWakes(state, time);
    this.syncSpecials(state, time);
  }

  consume(events: readonly SimulationEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'cannon-fired': {
          const ship = this.ships.get(event.shipId);
          const sideSign = event.side === 'port' ? -1 : 1;
          const forwardX = ship ? -Math.sin(ship.heading) : 0;
          const forwardZ = ship ? -Math.cos(ship.heading) : -1;
          const starboardX = ship ? Math.cos(ship.heading) : 1;
          const starboardZ = ship ? -Math.sin(ship.heading) : 0;
          const count = Math.max(1, event.count);
          for (let index = 0; index < count; index += 1) {
            const muzzle = event.position;
            const bias = event.side === 'bow'
              ? { x: forwardX * 4.5, y: 0.8, z: forwardZ * 4.5 }
              : { x: starboardX * sideSign * 4.2, y: 0.7, z: starboardZ * sideSign * 4.2 };
            this.spawnBurst(muzzle, 7, 0xf0e8d5, 2.4, 2.3, event.shipId.length * 19 + index * 31, 1.8, bias, ship?.isPlayer ? 3 : 2);
            this.spawnBurst(muzzle, 3, 0xffe7a0, 2.5, 0.2, event.count * 11 + index * 17, 1.4, bias, ship?.isPlayer ? 3 : 2);
          }
          break;
        }
        case 'projectile-impact':
          this.spawnBurst(event.position, event.ammo === 'explosive' ? 24 : 14, event.ammo === 'explosive' ? 0xff693f : 0x302735, 3.7, 1.55, event.projectileId, event.weakPoint ? 2.7 : 2.05, { x: 0, y: 2.8, z: 0 });
          this.spawnBurst(event.position, event.weakPoint ? 16 : 8, event.weakPoint ? 0xffe36b : 0xd6a46a, 5.2, 0.72, event.projectileId + 101, event.weakPoint ? 2.1 : 1.25);
          this.spawnRing(event.position, event.weakPoint ? 8.5 : 5.2, event.weakPoint ? 0xffef72 : 0xff8b4e, event.weakPoint ? 0.7 : 0.48);
          break;
        case 'water-impact':
          this.spawnBurst(event.position, event.projectileId === 0 ? 26 : 14, 0xeafaff, event.projectileId === 0 ? 4.8 : 3.1, 1.35, event.projectileId + 17, event.projectileId === 0 ? 3.6 : 2.25, { x: 0, y: 4.8, z: 0 });
          this.spawnRing(event.position, event.projectileId === 0 ? 11 : 6.5, 0xeafaff, 0.85);
          break;
        case 'ram':
          this.spawnBurst(event.position, 32, 0xf1e3c1, Math.min(7, 2.8 + event.force * 0.18), 1.5, event.attackerId.length + event.targetId.length, 3.2, { x: 0, y: 3.5, z: 0 });
          this.spawnRing(event.position, Math.min(15, 7 + event.force * 0.3), 0xffe6a3, 0.9);
          break;
        case 'special': {
          const ship = this.ships.get(event.shipId);
          if (ship && event.name === 'coup-de-burst') {
            const spec = getShipSpec(ship.kind);
            for (const side of [-.23, 0, .23]) {
              const nozzle = this.shipPoint(ship, side * spec.beam, spec.draft * .05 + .8, spec.length * .48);
              this.spawnBurst(nozzle, 9, 0xffefd0, 3.2, 1.7, side * 100 + 37, 2.8, { x: Math.sin(ship.heading) * 26, y: .3, z: Math.cos(ship.heading) * 26 }, 3);
            }
          } else if (event.name === 'submerge-dash') {
            const surface = { ...event.position, y: this.waveSampler?.sample(event.position.x, event.position.z, this.lastTime).height ?? 0 };
            this.spawnBurst(surface, 22, 0xe9f5df, 3.5, 1.1, 71, 1.5, { x: 0, y: 2.2, z: 0 }, 2);
          } else if (event.name !== 'tremor-broadside') {
            this.spawnBurst(event.position, 38, 0x58efff, 6.2, 1.65, event.name.length, 3.4, { x: 0, y: 3, z: 0 });
            this.spawnRing(event.position, 15, 0x58efff, 1.1);
          }
          // Moby's traveling surface comes from pressureWave state, not an
          // activation explosion that would imply an instantaneous gameplay hit.
          break;
        }
        case 'special-impact':
          this.spawnBurst(event.position, 15, 0xf8f0df, 5, 1.25, event.shipId.length * 73, 2.2, { x: 0, y: 4, z: 0 }, 3);
          break;
        case 'repair':
          this.spawnBurst(event.position, 4, 0xf6dc77, 0.8, 0.65, event.shipId.length);
          break;
        case 'ship-disabled':
          this.spawnBurst(event.position, 42, 0x211f2a, 4.5, 4.2, event.shipId.length * 3, 3.8, { x: 0, y: 4.2, z: 0 });
          this.spawnBurst(event.position, 18, event.surrendered ? 0xe9e1c7 : 0xff6a39, 3.4, 1.2, event.shipId.length * 13, 2.4);
          this.spawnRing(event.position, 13, event.surrendered ? 0xf6efcf : 0xff643e, 1.2);
          break;
        case 'checkpoint':
        case 'race-finished':
          break;
      }
    }
  }

  dispose(): void {
    for (const wake of this.wakes.values()) {
      wake.mesh.geometry.dispose();
      wake.mesh.material.dispose();
      wake.contactFoam.geometry.dispose();
      wake.contactFoam.material.dispose();
    }
    this.wakes.clear();
    this.projectileMesh.geometry.dispose();
    (this.projectileMesh.material as THREE.Material).dispose();
    this.trailMesh.geometry.dispose();
    (this.trailMesh.material as THREE.Material).dispose();
    this.puffMesh.geometry.dispose();
    (this.puffMesh.material as THREE.Material).dispose();
    this.ringMesh.geometry.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    for (const mesh of [this.specialHalos, this.specialJets, this.specialParticles, this.pressureFronts]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.specialEmissionTimes.clear();
    this.root.removeFromParent();
  }

  private makeSpecialPool(name: string, geometry: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    geometry.setAttribute('fxOpacity', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('fxStyle', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.ShaderMaterial({ name, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float fxOpacity;attribute float fxStyle;varying float vOpacity;varying float vStyle;varying vec3 vColor;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      void main(){vOpacity=fxOpacity;vStyle=fxStyle;vColor=instanceColor;vUv=uv;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.);vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `varying float vOpacity;varying float vStyle;varying vec3 vColor;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      void main(){float grain=.88+.12*sin(vUv.x*57.+sin(vUv.y*23.)*2.);float facing=abs(dot(normalize(vNormal),normalize(vView)));vec3 color=vColor;float alpha=vOpacity*grain;
      if(vStyle>.5){float light=.7+.3*max(0.,dot(normalize(vNormal),normalize(vec3(-.4,.9,.3))));color*=light;alpha*=smoothstep(.0,.18,facing);}
      if(vStyle>1.5){float rim=pow(1.-facing,2.);float glint=pow(max(0.,dot(normalize(vNormal),normalize(vec3(-.5,.8,.4)))),22.);color=mix(vColor,vec3(1.),glint);alpha=vOpacity*(rim*.85+glint*.8+.035);}
      gl_FragColor=vec4(color,alpha);
      #include <colorspace_fragment>
      }`,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = name; mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, new THREE.Color());
    this.root.add(mesh);
    return mesh;
  }

  private specialInstance(mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>, position: Vec3, scale: Vec3, rotation: THREE.Quaternion, color: number, opacity: number, style = 0): void {
    const index = mesh.count;
    if (index >= mesh.instanceMatrix.count || opacity <= .001) return;
    this.dummy.position.set(position.x, position.y, position.z); this.dummy.scale.set(scale.x, scale.y, scale.z); this.dummy.quaternion.copy(rotation); this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix); this.projectileColor.setHex(color); mesh.setColorAt(index, this.projectileColor);
    (mesh.geometry.getAttribute('fxOpacity') as THREE.InstancedBufferAttribute).setX(index, opacity);
    (mesh.geometry.getAttribute('fxStyle') as THREE.InstancedBufferAttribute).setX(index, style);
    mesh.count += 1;
  }

  private shipPoint(ship: ShipState, x: number, y: number, z: number): THREE.Vector3 {
    this.specialEuler.set(ship.pitch, ship.heading, ship.roll);
    return this.specialPosition.set(x, y, z).applyEuler(this.specialEuler).add(ship.position);
  }

  private makePressureFronts(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRESSURE_VERTICES * PRESSURE_CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('fxOpacity', new THREE.BufferAttribute(new Float32Array(PRESSURE_VERTICES * PRESSURE_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(PRESSURE_VERTICES * PRESSURE_CAPACITY * 2);
    for (let front = 0; front < PRESSURE_CAPACITY; front++) for (let segment = 0; segment <= PRESSURE_SEGMENTS; segment++) for (let row = 0; row < PRESSURE_ROWS; row++) {
      const index = (front * PRESSURE_VERTICES + segment * PRESSURE_ROWS + row) * 2;
      uv[index] = segment / PRESSURE_SEGMENTS; uv[index + 1] = row / (PRESSURE_ROWS - 1);
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const indices = new Uint16Array(PRESSURE_INDICES * PRESSURE_CAPACITY);
    let cursor = 0;
    for (let front = 0; front < PRESSURE_CAPACITY; front++) for (let segment = 0; segment < PRESSURE_SEGMENTS; segment++) for (let row = 0; row < PRESSURE_ROWS - 1; row++) {
      const a = front * PRESSURE_VERTICES + segment * PRESSURE_ROWS + row, b = a + PRESSURE_ROWS;
      for (const index of [a, b, a + 1, b, b + 1, a + 1]) indices[cursor++] = index;
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      name: 'SurfaceFollowingPressureCrest', transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'attribute float fxOpacity;varying float vOpacity;varying vec2 vUv;void main(){vOpacity=fxOpacity;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform float uTime;varying float vOpacity;varying vec2 vUv;
      float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);}
      void main(){
      float n=noise(vec2(vUv.x*117.,vUv.y*13.-uTime*2.7));float threads=noise(vec2(vUv.x*247.,vUv.y*8.-uTime*4.));
      float lip=1.-smoothstep(.035,.15,abs(vUv.y-.66)+(n-.5)*.12);
      float streak=pow(max(0.,sin(vUv.x*690.+n*6.)),8.)*(1.-smoothstep(.60,.78,vUv.y))*smoothstep(.19,.51,vUv.y);
      float foam=max(lip,streak*.5);foam=max(foam,(1.-smoothstep(.045,.13,abs(n-.54)))*smoothstep(.8,.99,vUv.y)*.7);
      float facing=.76+.24*sin(vUv.x*6.28318+.9);vec3 water=mix(vec3(.015,.30,.45),vec3(.025,.77,.73),smoothstep(.05,.55,vUv.y))*facing;
      water=mix(water,vec3(.14,.89,.79),threads*.16);vec3 color=mix(water,vec3(1.,.975,.86),foam);
      gl_FragColor=vec4(color,vOpacity*(.82+foam*.18));
      #include <colorspace_fragment>
      }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'moby-authoritative-pressure-front'; mesh.frustumCulled = false; mesh.visible = false;
    this.root.add(mesh); return mesh;
  }

  private writePressureFront(origin: Vec3, radius: number, opacity: number, time: number): void {
    if (this.pressureFrontCount >= PRESSURE_CAPACITY || radius <= 0 || opacity <= .001) return;
    const positions = this.pressureFronts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const opacities = this.pressureFronts.geometry.getAttribute('fxOpacity') as THREE.BufferAttribute;
    const offset = this.pressureFrontCount++ * PRESSURE_VERTICES;
    for (let segment = 0; segment <= PRESSURE_SEGMENTS; segment++) {
      const angle = segment / PRESSURE_SEGMENTS * Math.PI * 2, cos = Math.cos(angle), sin = Math.sin(angle);
      for (let row = 0; row < PRESSURE_ROWS; row++) {
        const r = radius * PRESSURE_RADII[row], x = origin.x + cos * r, z = origin.z + sin * r;
        const water = this.waveSampler?.sample(x, z, time).height ?? 0;
        const height = Math.min(13, radius * .14) * (.87 + Math.sin(angle * 13 + time * 2.1) * .085 + Math.sin(angle * 29 - time * 3.2) * .045);
        const crest = row === 1 ? height * .72 : row === 2 ? height : .22;
        const index = offset + segment * PRESSURE_ROWS + row;
        // Every vertex follows the actual water, with a raised physical crest.
        // The outside row remains exactly on the authoritative XZ damage front.
        positions.setXYZ(index, x, water + crest, z);
        opacities.setX(index, opacity * (row === 0 ? .08 : row === 1 ? .88 : row === 2 ? 1 : .65));
        if (row === 2 && segment < PRESSURE_SEGMENTS && segment % 4 === 0) {
          const toss = (time * 1.4 + segment * .371) % 1;
          this.specialParticle(x, water + crest + .5 + Math.sin(toss * Math.PI) * 3.5, z, 1.3 + toss * 1.8, 1.7 + toss, 1.1 + toss * 1.3, 0xfff5d9, opacity * (1 - toss) * .8);
        }
      }
    }
  }

  private specialParticle(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, opacity: number, bubble = false): void {
    this.specialPosition.set(x, y, z); this.specialScale.set(sx, sy, sz);
    this.specialInstance(this.specialParticles, this.specialPosition, this.specialScale, this.identityRotation, color, opacity, bubble ? 2 : 1);
  }

  /** Phase-local meshes are bounded and survive capture skips/save restoration. */
  private syncSpecials(state: WorldState, time: number): void {
    for (const mesh of [this.specialHalos, this.specialJets, this.specialParticles]) mesh.count = 0;
    this.pressureFrontCount = 0;
    const horizontal = this.horizontal;
    const ids = new Set<string>();
    for (const ship of state.ships) {
      ids.add(ship.id);
      const phase = ship.specialPhase;
      if (!phase || ship.surrendered) { this.specialEmissionTimes.delete(ship.id); continue; }
      const progress = Math.max(0, Math.min(1, phase.elapsed / phase.duration));
      const spec = getShipSpec(ship.kind);
      const surface = this.waveSampler?.sample(ship.position.x, ship.position.z, time).height ?? 0;
      const center = { x: ship.position.x, y: surface + .35, z: ship.position.z };
      if (ship.kind === 'thousand-sunny') {
        const orientation = this.specialOrientation.setFromEuler(this.specialEuler.set(ship.pitch, ship.heading, ship.roll));
        const jetRotation = this.specialJetRotation.setFromUnitVectors(this.up, this.direction.set(0, 0, -1).applyQuaternion(orientation));
        const aftX = Math.sin(ship.heading), aftZ = Math.cos(ship.heading);
        const emit = phase.phase === 'active' && time - (this.specialEmissionTimes.get(ship.id) ?? -10) > .11;
        if (emit) this.specialEmissionTimes.set(ship.id, time);
        for (const side of [-.23, 0, .23]) {
          const nozzle = this.shipPoint(ship, side * spec.beam, spec.draft * .05 + .8, spec.length * .48);
          const nx = nozzle.x, ny = nozzle.y, nz = nozzle.z;
          const charge = phase.phase === 'windup' ? progress : phase.phase === 'active' ? 1 - progress * .65 : (1 - progress) * .25;
          for (let ring = 0; ring < 2; ring++) {
            const radius = 1.2 + charge * 2.5 + ring * (.8 + .35 * Math.sin(time * 15));
            this.specialInstance(this.specialHalos, nozzle, { x: radius, y: radius, z: radius }, orientation, ring ? 0xffa653 : 0xfff4cc, (.35 + charge * .5) * (phase.phase === 'recovery' ? 1 - progress : 1));
          }
          if (phase.phase === 'active') {
            const length = (55 + Math.sin(progress * Math.PI) * 28) * (1 - progress * .28);
            this.specialInstance(this.specialJets, nozzle, { x: 4.6, y: length, z: 4.6 }, jetRotation, 0xffb158, .5 * (1 - progress * .5));
            this.specialInstance(this.specialJets, nozzle, { x: 2.55, y: length * .9, z: 2.55 }, jetRotation, 0xffedaf, .87 * (1 - progress * .5));
            this.specialInstance(this.specialJets, nozzle, { x: 1.15, y: length * .72, z: 1.15 }, jetRotation, 0xffffe9, .95 * (1 - progress * .5));
            if (emit) this.spawnBurst({ x: nx + aftX * 20, y: ny + .6, z: nz + aftZ * 20 }, 2, 0xffefcf, 2.7, 1.65, Math.floor(time * 100) + Math.round(side * 100), 3.3, { x: aftX * 11, y: .8, z: aftZ * 11 }, 1);
          }
          this.specialParticle(nx, ny, nz, 1.2 + charge * 1.8, 1.2 + charge * 1.8, 1.2 + charge * 1.8, 0xffffdb, charge * .9);
          if (phase.phase !== 'windup') for (let lobe = 0; lobe < 6; lobe++) {
            const t = lobe / 5, distance = 14 + t * 51 + (phase.phase === 'recovery' ? progress * 28 : 0);
            const drift = Math.sin(time * 5 + lobe * 2.4 + side * 11), size = 1.2 + t * 3.9;
            const fade = phase.phase === 'recovery' ? (1 - progress) * .48 : .48 * (1 - t * .45);
            this.specialParticle(nx + aftX * distance + Math.cos(ship.heading) * drift * t * 2, ny + t * 2.4 + drift * .45, nz + aftZ * distance - Math.sin(ship.heading) * drift * t * 2, size, size * .75, size * 1.35, 0xfff4d8, fade);
          }
        }
      } else if (ship.kind === 'polar-tang') {
        const recovery = phase.phase === 'recovery';
        const depth = surface - ship.position.y;
        const emergence = recovery ? Math.max(0, 1 - Math.abs(depth - 3) / 12) : 0;
        const co = Math.cos(ship.heading), si = Math.sin(ship.heading);
        // Only the real hull drives this disturbance. No substitute submarine
        // or above-water silhouette is rendered while the hull is submerged.
        for (let index = 0; index < 28; index++) {
          const angle = index / 28 * Math.PI * 2, variation = Math.sin(index * 2.37 + time * 2.6);
          const ringScale = recovery ? 1.1 + emergence * .28 : phase.phase === 'windup' ? 1.35 - progress * .4 : .42;
          const lx = Math.sin(angle) * spec.beam * .56 * ringScale, lz = Math.cos(angle) * spec.length * .4 * ringScale;
          const x = ship.position.x + lx * co + lz * si, z = ship.position.z - lx * si + lz * co;
          const water = this.waveSampler?.sample(x, z, time).height ?? surface;
          const strength = recovery ? .45 + emergence * .55 : phase.phase === 'windup' ? .3 + progress * .5 : .3;
          const size = (1.1 + variation * .25) * (recovery ? 1.8 : 1);
          this.specialParticle(x, water + .35 + emergence * (.7 + Math.max(0, variation) * 2), z, size * 1.8, .4 + emergence * (1.5 + Math.max(0, variation) * 2.7), size, index % 3 ? 0xfff7dd : 0xa8ead8, strength);
          if (recovery && emergence > .12 && index % 2 === 0) {
            const age = (time * 1.15 + index * .163) % 1;
            const spread = 1 + age * .2;
            this.specialParticle(ship.position.x + (x - ship.position.x) * spread, water + 1 + Math.sin(age * Math.PI) * (3.5 + emergence * 5), ship.position.z + (z - ship.position.z) * spread, .45 + age * .5, .8 + age * .8, .45 + age * .5, 0xffffe9, (1 - age) * emergence * .85);
          }
        }
        if (phase.phase === 'active') for (let index = 0; index < 22; index++) {
          const age = (phase.elapsed * .8 + index * .137) % 1, along = (index % 6) * 3.3;
          const x = ship.position.x + si * along + co * Math.sin(index * 3.1) * 3, z = ship.position.z + co * along - si * Math.sin(index * 3.1) * 3;
          const water = this.waveSampler?.sample(x, z, time).height ?? surface;
          const size = .2 + age * .62;
          this.specialParticle(x, water + .25 + age * 4.5, z, size, size, size, 0xe4fff6, (1 - age) * .8, true);
        }
        if (recovery && emergence > .35 && time - (this.specialEmissionTimes.get(ship.id) ?? -10) > .17) {
          this.specialEmissionTimes.set(ship.id, time);
          this.spawnBurst(center, 5, 0xf9f0d8, 4.8, 1.2, Math.floor(time * 100), 1.65, { x: 0, y: 4.8 + Math.max(0, ship.verticalSpeed) * .2, z: 0 }, 1);
        }
      } else if (ship.kind === 'moby-dick') {
        if (phase.phase === 'windup') {
          // Outer range marker telegraphs the real maximum radius; inward rings
          // gather pressure before the traveling front can damage anything.
          this.specialInstance(this.specialHalos, center, { x: MOBY_PRESSURE_RADIUS, y: MOBY_PRESSURE_RADIUS, z: 1 }, horizontal, 0xf2dfb9, .14 + progress * .12);
          for (let ring = 0; ring < 2; ring++) {
            const radius = spec.beam * .8 + (1 - progress) * (34 + ring * 15);
            this.specialInstance(this.specialHalos, center, { x: radius, y: radius, z: 1 }, horizontal, 0xfff3d7, .4 + progress * .3);
          }
        } else if (phase.pressureWave) {
          const wave = phase.pressureWave;
          this.writePressureFront(wave.origin, wave.radius, phase.phase === 'active' ? .82 : .5 * (1 - progress), time);
        }
      }
    }
    for (const id of this.specialEmissionTimes.keys()) if (!ids.has(id)) this.specialEmissionTimes.delete(id);
    for (const mesh of [this.specialHalos, this.specialJets, this.specialParticles]) {
      mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      (mesh.geometry.getAttribute('fxOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (mesh.geometry.getAttribute('fxStyle') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    this.pressureFronts.visible = this.pressureFrontCount > 0;
    this.pressureFronts.material.uniforms.uTime!.value = time;
    this.pressureFronts.geometry.setDrawRange(0, this.pressureFrontCount * PRESSURE_INDICES);
    for (const name of ['position', 'fxOpacity']) {
      const attribute = this.pressureFronts.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, this.pressureFrontCount * PRESSURE_VERTICES * attribute.itemSize); attribute.needsUpdate = true;
    }
  }

  private syncProjectiles(state: WorldState): void {
    const count = Math.min(this.projectileCapacity, state.projectiles.length);
    for (let index = 0; index < count; index += 1) {
      const projectile = state.projectiles[index];
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z);
      const scale = projectile.ammo === 'heavy' ? 1.25 : projectile.ammo === 'explosive' ? 1.1 : projectile.ammo === 'chain' ? 0.7 : 0.92;
      this.dummy.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
      this.dummy.scale.setScalar(scale);
      this.dummy.quaternion.identity();
      this.dummy.updateMatrix();
      this.projectileMesh.setMatrixAt(index, this.dummy.matrix);
      this.projectileColor.setHex(ammoColor(projectile.ammo));
      this.projectileMesh.setColorAt(index, this.projectileColor);

      this.direction.set(projectile.velocity.x, projectile.velocity.y, projectile.velocity.z).normalize();
      this.dummy.position.set(
        projectile.position.x - this.direction.x * 1.35,
        projectile.position.y - this.direction.y * 1.35,
        projectile.position.z - this.direction.z * 1.35,
      );
      this.dummy.quaternion.setFromUnitVectors(this.up, this.direction);
      this.dummy.scale.set(1, Math.min(2.1, speed / 48), 1);
      this.dummy.updateMatrix();
      this.trailMesh.setMatrixAt(index, this.dummy.matrix);
    }
    this.projectileMesh.count = count;
    this.trailMesh.count = count;
    this.projectileMesh.instanceMatrix.needsUpdate = true;
    this.trailMesh.instanceMatrix.needsUpdate = true;
    if (this.projectileMesh.instanceColor) this.projectileMesh.instanceColor.needsUpdate = true;
  }

  private updatePuffs(dt: number): void {
    let rendered = 0;
    for (const puff of this.puffs) {
      if (!puff.active) continue;
      puff.life -= dt;
      if (puff.life <= 0) {
        puff.active = false;
        continue;
      }
      puff.position.addScaledVector(puff.velocity, dt);
      puff.velocity.y += dt * 0.38;
      puff.velocity.multiplyScalar(Math.exp(-dt * 0.7));
      const age = 1 - puff.life / puff.maxLife;
      const size = puff.size * (0.5 + age * 1.6) * Math.sin(Math.min(Math.PI * 0.5, (1 - age) * Math.PI));
      this.dummy.position.copy(puff.position);
      this.dummy.quaternion.identity();
      this.dummy.scale.set(Math.max(.01,size)*(1+age*.22),Math.max(.01,size)*(.75+age*.55),Math.max(.01,size));
      this.dummy.updateMatrix();
      this.puffMesh.setMatrixAt(rendered, this.dummy.matrix);
      this.puffMesh.setColorAt(rendered, puff.color);
      rendered += 1;
    }
    this.puffMesh.count = rendered;
    this.puffMesh.instanceMatrix.needsUpdate = true;
    if (this.puffMesh.instanceColor) this.puffMesh.instanceColor.needsUpdate = true;
  }

  private updateRings(dt: number): void {
    let rendered = 0;
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.life -= dt;
      if (ring.life <= 0) {
        ring.active = false;
        continue;
      }
      const age = 1 - ring.life / ring.maxLife;
      const scale = ring.size * (0.12 + age * 1.25);
      this.dummy.position.copy(ring.position);
      this.dummy.position.y += age * ring.size * 0.08;
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.ringMesh.setMatrixAt(rendered, this.dummy.matrix);
      this.ringMesh.setColorAt(rendered, ring.color);
      rendered += 1;
    }
    this.ringMesh.count = rendered;
    this.ringMesh.instanceMatrix.needsUpdate = true;
    if (this.ringMesh.instanceColor) this.ringMesh.instanceColor.needsUpdate = true;
  }

  private syncWakes(state: WorldState, time: number): void {
    const active = new Set<string>();
    for (const ship of state.ships) {
      active.add(ship.id);
      let wake = this.wakes.get(ship.id);
      if (!wake) {
        wake = this.createWake(ship);
        this.wakes.set(ship.id, wake);
        this.root.add(wake.mesh, wake.contactFoam);
      }
      const stern = this.sternPosition(ship);
      if (wake.points[0] && wake.points[0].distanceTo(stern) > 160) { wake.points.length=0; wake.links.length=0; }
      const surface = this.waveSampler?.sample(ship.position.x, ship.position.z, time).height ?? 0;
      const detached = ship.kind === 'polar-tang' && ship.position.y < surface - 3 || ship.kind === 'thousand-sunny' && ship.specialPhase?.phase === 'active' && ship.specialPhase.elapsed < .6;
      wake.width = getShipSpec(ship.kind).beam * .42;
      if (detached) wake.detached = true;
      const speedRatio=Math.min(1,Math.abs(ship.speed)/Math.max(1,ship.maxSpeed));
      if (speedRatio>.12 && time-(this.sprayTimes.get(ship.id)??-10)>.10 && !ship.surrendered && !detached) {
        this.sprayTimes.set(ship.id,time);
        const spec=getShipSpec(ship.kind);
        for(const side of [-1,1]) {
          const x=ship.position.x-Math.sin(ship.heading)*spec.length*.4+Math.cos(ship.heading)*side*spec.beam*.3;
          const z=ship.position.z-Math.cos(ship.heading)*spec.length*.4-Math.sin(ship.heading)*side*spec.beam*.3;
          const y=this.waveSampler?.sample(x,z,time).height??ship.position.y;
          this.spawnBurst({x,y:y+.3,z},2,0xfff6df,1.2,.7,Math.floor(time*20)+side,.38+speedRatio*.45,{x:Math.cos(ship.heading)*side*2.3,y:1.3+speedRatio*1.2,z:-Math.sin(ship.heading)*side*2.3},0);
        }
      }
      wake.mesh.material.uniforms.uTime!.value=time;
      wake.mesh.material.uniforms.uBurst!.value=ship.kind==='thousand-sunny' && ship.specialPhase && ship.specialPhase.phase!=='windup' ? 1 : 0;
      (wake.mesh.material.uniforms.uColor!.value as THREE.Color).setHex(state.weather==='night'?0x83b9ce:state.weather==='storm'?0xc5d6d5:0xfff7e0);
      if (!detached && (wake.detached || wake.points.length === 0 || wake.lastPosition.distanceToSquared(stern) > 1.7 * 1.7)) {
        if (wake.points.length > 0) wake.links.unshift(!wake.detached);
        wake.detached = false;
        wake.points.unshift(stern);
        wake.lastPosition.copy(stern);
        if (wake.points.length > this.wakeSegments) wake.points.length = this.wakeSegments;
        if (wake.links.length >= this.wakeSegments) wake.links.length = this.wakeSegments - 1;
      } else if (!detached && wake.points[0]) {
        wake.points[0].copy(stern);
      }
      this.updateWakeGeometry(wake, ship, time);
      if (detached) wake.contactFoam.visible = false;
    }
    for (const [id, wake] of this.wakes) {
      if (active.has(id)) continue;
      wake.mesh.geometry.dispose();
      wake.mesh.material.dispose();
      wake.contactFoam.geometry.dispose();
      wake.contactFoam.material.dispose();
      wake.contactFoam.removeFromParent();
      wake.mesh.removeFromParent();
      this.wakes.delete(id);
    }
  }

  private createWake(ship: ShipState): WakeTrail {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.wakeSegments * 2 * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const indices: number[] = [];
    for (let index = 0; index < this.wakeSegments - 1; index += 1) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1);
    }
    geometry.setIndex(indices);
    const uv=new Float32Array(this.wakeSegments*4);
    for(let i=0;i<this.wakeSegments;i++){uv[i*4]=0;uv[i*4+1]=i/(this.wakeSegments-1);uv[i*4+2]=1;uv[i*4+3]=i/(this.wakeSegments-1);}
    geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      name:'ConnectedWakeFoam',transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{uTime:{value:0},uOpacity:{value:.6},uBurst:{value:0},uColor:{value:new THREE.Color(0xfff7e0)}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`uniform float uTime; uniform float uOpacity;uniform float uBurst;uniform vec3 uColor;varying vec2 vUv;
      void main(){float edge=abs(vUv.x-.5)*2.;float lines=sin(vUv.y*96.-uTime*3.+sin(vUv.x*31.)*2.)*.5+.5;
      float fringe=smoothstep(.05,.4,edge)*(1.-smoothstep(.82,1.,edge));
      float alpha=(.1+fringe*(.42+lines*.48))*(1.-smoothstep(.35,1.,vUv.y))*uOpacity;
      alpha*=mix(1.,smoothstep(.15,.75,lines*(.55+.45*sin(vUv.x*37.+vUv.y*17.))),uBurst);
      gl_FragColor=vec4(uColor,alpha);
      #include <colorspace_fragment>
      }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `wake:${ship.id}`;
    mesh.frustumCulled = false;
    const spec = getShipSpec(ship.kind);
    const contactGeometry=new THREE.BufferGeometry();
    contactGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(33*2*3),3).setUsage(THREE.DynamicDrawUsage));
    const contactUV=new Float32Array(33*4),contactIndices:number[]=[];
    for(let i=0;i<=32;i++){contactUV[i*4]=i/32;contactUV[i*4+1]=0;contactUV[i*4+2]=i/32;contactUV[i*4+3]=1;if(i<32){const k=i*2;contactIndices.push(k,k+1,k+2,k+1,k+3,k+2);}}
    contactGeometry.setAttribute('uv',new THREE.BufferAttribute(contactUV,2));contactGeometry.setIndex(contactIndices);
    const contactMaterial=new THREE.ShaderMaterial({name:'HullDisplacementFoam',transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{uTime:{value:0},uOpacity:{value:.6},uColor:{value:new THREE.Color(0xfff7e0)}},vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`uniform float uTime;uniform float uOpacity;uniform vec3 uColor;varying vec2 vUv;
      float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
      float turbulence=noise(vec2(vUv.x*74.-uTime*.22,vUv.y*5.))+noise(vec2(vUv.x*167.,vUv.y*13.+uTime*.7))*.35;
      float fringe=1.-smoothstep(.25,.96,vUv.y+turbulence*.24);
      float lace=1.-smoothstep(.035,.13,abs(turbulence-.63));
      float foam=(fringe*.6+lace*.35)*(1.-smoothstep(.87,1.,vUv.y));
      gl_FragColor=vec4(uColor,foam*uOpacity);
      #include <colorspace_fragment>
      }`});
    const contactFoam=new THREE.Mesh(contactGeometry,contactMaterial);contactFoam.name=`hull-contact-foam:${ship.id}`;contactFoam.frustumCulled=false;contactFoam.renderOrder=-4;
    return {
      mesh,
      contactFoam,
      points: [],
      lastPosition: new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0),
      width: spec.beam * 0.42,
      links: [],
      detached: false,
    };
  }

  private updateWakeGeometry(wake: WakeTrail, ship: ShipState, time: number): void {
    const spec=getShipSpec(ship.kind),speed=Math.min(1,Math.abs(ship.speed)/Math.max(1,ship.maxSpeed));
    const foamPositions=wake.contactFoam.geometry.getAttribute('position') as THREE.BufferAttribute;
    const co=Math.cos(ship.heading),si=Math.sin(ship.heading);
    for(let i=0;i<=32;i++){
      const a=i/32*Math.PI*2,ax=Math.sin(a),az=Math.cos(a);
      for(let edge=0;edge<2;edge++){
        const width=-.20+edge*(.8+speed*1.3);
        const lx=ax*(spec.beam*.445+width),lz=az*(spec.length*.475+width);
        const x=ship.position.x+lx*co+lz*si,z=ship.position.z-lx*si+lz*co;
        const y=this.waveSampler?.sample(x,z,time).height??ship.position.y;
        foamPositions.setXYZ(i*2+edge,x,y+.15,z);
      }
    }
    foamPositions.needsUpdate=true;
    wake.contactFoam.material.uniforms.uTime!.value=time;
    wake.contactFoam.material.uniforms.uOpacity!.value=.45+speed*.35;
    (wake.contactFoam.material.uniforms.uColor!.value as THREE.Color).copy(wake.mesh.material.uniforms.uColor!.value);
    wake.contactFoam.visible=ship.finish?.state!=='sunk';
    const positions = wake.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = wake.points.length;
    for (let index = 0; index < count; index += 1) {
      const point = wake.points[index];
      const previous = wake.points[Math.max(0, index - 1)] ?? point;
      const next = wake.points[Math.min(count - 1, index + 1)] ?? point;
      const dx = next.x - previous.x;
      const dz = next.z - previous.z;
      const length = Math.hypot(dx, dz) || 1;
      const spread = wake.width * (0.52 + index / Math.max(1, this.wakeSegments - 1) * 1.4);
      const fadeNarrow = 1 - Math.pow(index / Math.max(1, count), 2) * 0.45;
      const sideX = -dz / length * spread * fadeNarrow;
      const sideZ = dx / length * spread * fadeNarrow;
      const waveY = this.waveSampler?.sample(point.x, point.z, time).height ?? point.y;
      positions.setXYZ(index * 2, point.x + sideX, waveY + 0.12, point.z + sideZ);
      positions.setXYZ(index * 2 + 1, point.x - sideX, waveY + 0.12, point.z - sideZ);
    }
    positions.needsUpdate = true;
    const indices = wake.mesh.geometry.getIndex()!;
    let indexCount = 0;
    for (let index = 0; index < count - 1; index++) {
      if (!wake.links[index]) continue;
      const offset = index * 2;
      for (const vertex of [offset, offset + 2, offset + 1, offset + 2, offset + 3, offset + 1]) indices.setX(indexCount++, vertex);
    }
    indices.needsUpdate = true;
    wake.mesh.geometry.setDrawRange(0, indexCount);
    wake.mesh.material.uniforms.uOpacity!.value = 0.35 + Math.min(0.65, Math.abs(ship.speed) / Math.max(1, ship.maxSpeed) * 0.7);
    wake.mesh.visible = Math.abs(ship.speed) > 0.8 && count > 1;
  }

  private sternPosition(ship: ShipState): THREE.Vector3 {
    const spec = getShipSpec(ship.kind);
    return new THREE.Vector3(
      ship.position.x + Math.sin(ship.heading) * spec.length * 0.48,
      ship.position.y,
      ship.position.z + Math.cos(ship.heading) * spec.length * 0.48,
    );
  }

  private spawnDamageSmoke(state: WorldState, time: number): void {
    for (const ship of state.ships) {
      if (ship.damage.hull < 0.56) continue;
      const previous = this.damageSpawnTime.get(ship.id) ?? -10;
      const interval = 0.68 - Math.min(0.4, ship.damage.hull * 0.42);
      if (time - previous < interval) continue;
      this.damageSpawnTime.set(ship.id, time);
      const position = { x: ship.position.x, y: ship.position.y + getShipSpec(ship.kind).draft * 0.9 + 2, z: ship.position.z };
      const severe = ship.damage.hull > 0.82;
      const layers = severe ? 3 : 1;
      for (let layer = 0; layer < layers; layer += 1) {
        this.spawnBurst(
          { x: position.x + layer * 0.35, y: position.y + layer * 2.15, z: position.z - layer * 0.3 },
          severe ? (layer === 0 ? 3 : 2) : 2,
          severe ? (layer === 2 ? 0x4b4654 : 0x181722) : 0x484250,
          0.95 + layer * 0.18,
          2.8 + layer * 0.35,
          Math.floor(time * 10) + ship.id.length + layer * 19,
          severe ? 2.8 + layer * 0.9 : 1.75,
          { x: 0, y: 1.8 + layer, z: 0 },
          1,
        );
      }
    }
  }

  private spawnBurst(
    position: Vec3,
    count: number,
    color: number,
    speed: number,
    life: number,
    seed: number,
    sizeScale = 1,
    bias?: Vec3,
    priority = 2,
  ): void {
    for (let index = 0; index < count; index += 1) {
      // Reserve most of the fixed pool for gameplay events. A crowded fleet's
      // continuous bow spray must not suppress muzzle smoke and hit feedback.
      const reserve = Math.floor(this.puffs.length * .55);
      let puff = this.puffs.find((candidate, slot) => !candidate.active && (priority > 0 || slot >= reserve));
      if(!puff && priority>0)puff=this.puffs.reduce<Puff|undefined>((best,candidate)=>candidate.priority<priority&&(!best||candidate.priority<best.priority||candidate.priority===best.priority&&candidate.life<best.life)?candidate:best,undefined);
      if (!puff) return;
      const angle = pseudo(seed + index * 17) * Math.PI * 2;
      const lift = 0.35 + pseudo(seed + index * 31) * 0.9;
      const magnitude = speed * (0.45 + pseudo(seed + index * 47) * 0.75);
      puff.active = true;
      puff.priority = priority;
      puff.position.set(position.x, position.y, position.z);
      puff.velocity.set(
        Math.cos(angle) * magnitude + (bias?.x ?? 0),
        lift * magnitude + (bias?.y ?? 0),
        Math.sin(angle) * magnitude + (bias?.z ?? 0),
      );
      puff.maxLife = life * (0.7 + pseudo(seed + index * 61) * 0.6);
      puff.life = puff.maxLife;
      puff.size = (0.65 + pseudo(seed + index * 79) * 1.15) * sizeScale;
      puff.color.setHex(color);
    }
  }

  private spawnRing(position: Vec3, size: number, color: number, life: number): void {
    const ring = this.rings.find((candidate) => !candidate.active);
    if (!ring) return;
    ring.active = true;
    ring.position.set(position.x, position.y, position.z);
    ring.life = life;
    ring.maxLife = life;
    ring.size = size;
    ring.color.setHex(color);
  }
}

function ammoColor(ammo: AmmoKind): number {
  if (ammo === 'chain') return 0x343947;
  if (ammo === 'heavy') return 0x332b32;
  if (ammo === 'explosive') return 0xff653f;
  return 0x292735;
}

function pseudo(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}
