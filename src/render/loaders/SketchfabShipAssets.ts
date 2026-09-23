import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SKETCHFAB_SHIPS } from '../../content/sketchfabShips';
import type { ShipKind } from '../../core/contracts';

/** Full downloaded ship models. UV artwork, mesh silhouettes and source hierarchy survive intake. */
export class SketchfabShipAssets {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly pending = new Map<string, Promise<THREE.Group>>();
  private readonly sources = new Set<THREE.Group>();
  private readonly loaded = new Set<string>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly gradient = new THREE.DataTexture(new Uint8Array([100, 163, 218, 255]), 4, 1, THREE.RedFormat);
  private disposed = false;
  private readonly fill = { value: .38 };
  readonly status = new Map<ShipKind, 'loading' | 'ready' | 'error'>();

  constructor() {
    this.gradient.minFilter = this.gradient.magFilter = THREE.NearestFilter;
    this.gradient.generateMipmaps = false;
    this.gradient.needsUpdate = true;
  }

  private load(kind: ShipKind, detail: 'high' | 'low'): Promise<THREE.Group> {
    const key = `${kind}:${detail}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    this.status.set(kind, 'loading');
    const promise = this.loader.loadAsync(`/assets/sketchfab/${kind}${detail === 'low' ? '-low' : ''}.glb`).then(gltf => {
      const converted = new Map<THREE.Material, THREE.MeshToonMaterial>();
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const convert = (material: THREE.Material): THREE.MeshToonMaterial => {
          const cached = converted.get(material);
          if (cached) return cached;
          const source = material as THREE.MeshStandardMaterial;
          for (const value of Object.values(source)) if (value instanceof THREE.Texture) this.textures.add(value);
          const toon = new THREE.MeshToonMaterial({
            name: `Sketchfab:${material.name}`,
            color: source.color ?? 0xffffff, map: source.map ?? null,
            normalMap: source.normalMap ?? null, normalScale: source.normalScale?.clone().multiplyScalar(.42),
            aoMap: source.aoMap ?? null, aoMapIntensity: .45,
            emissive: source.emissive ?? 0x000000, emissiveMap: source.emissiveMap ?? null,
            emissiveIntensity: Math.min(.15, source.emissiveIntensity ?? 0),
            gradientMap: this.gradient, vertexColors: source.vertexColors,
            side: THREE.DoubleSide, transparent: source.transparent,
            opacity: source.opacity, alphaTest: source.alphaTest,
          });
          converted.set(material, toon);
          toon.onBeforeCompile = shader => {
            shader.uniforms.uCruiseAssetFill = this.fill;
            shader.fragmentShader = 'uniform float uCruiseAssetFill;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * vec3(.93,.96,1.0) * uCruiseAssetFill;\n#include <opaque_fragment>');
          };
          toon.customProgramCacheKey = () => 'cruise-source-toon-01';
          material.dispose();
          return toon;
        };
        object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
        object.receiveShadow = true;
        object.userData.assetSource = SKETCHFAB_SHIPS[kind]!.uid;
      });
      this.sources.add(gltf.scene);
      if (this.disposed) { this.release(gltf.scene); return gltf.scene; }
      // A vessel is ready only when both detail variants have loaded.
      this.loaded.add(key);
      if (['high','low'].every(level=>this.loaded.has(`${kind}:${level}`))) this.status.set(kind, 'ready');
      return gltf.scene;
    }).catch(error => {
      this.pending.delete(key);
      this.status.set(kind, 'error');
      throw new Error(`The downloaded ${kind} model could not load. No substitute ship was created.`, { cause: error });
    });
    this.pending.set(key, promise);
    return promise;
  }

  async mount(kind: ShipKind, detail: 'high' | 'low', target: THREE.Group, alive: () => boolean, castShadow: boolean, configure?: (instance:THREE.Group)=>void): Promise<void> {
    const source = await this.load(kind, detail);
    if (this.disposed || !alive()) return;
    const instance = source.clone(true);
    instance.name = `sketchfab-ship:${kind}`;
    instance.userData.source = SKETCHFAB_SHIPS[kind];
    instance.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = castShadow; });
    configure?.(instance);
    target.add(instance);
    target.userData.assetReady = true;
  }

  async prepare(kind:ShipKind): Promise<void> { await Promise.all([this.load(kind,'high'),this.load(kind,'low')]); }

  async ready(): Promise<void> { await Promise.all(this.pending.values()); }
  setExposure(exposure: number): void { this.fill.value = .38 * exposure; }

  /** Localized weathering stays on source UV surfaces; each vessel owns its damage state. */
  bindDamage(instance:THREE.Group,kind:ShipKind):{ uniform:{value:THREE.Vector4};inverse:{value:THREE.Matrix4};dispose:()=>void } {
    const uniform={value:new THREE.Vector4()};
    const inverse={value:new THREE.Matrix4()};
    const materials=new Map<THREE.Material,THREE.Material>();
    instance.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const convert=(source:THREE.Material)=>{
        if(materials.has(source))return materials.get(source)!;
        const material=source.clone();
        material.onBeforeCompile=(shader,renderer)=>{
          source.onBeforeCompile(shader,renderer);
          shader.uniforms.uCruiseDamage=uniform;
          shader.uniforms.uCruiseHullInverse=inverse;
          shader.vertexShader='varying vec3 vCruiseHullPosition;uniform mat4 uCruiseHullInverse;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCruiseHullPosition = (uCruiseHullInverse * modelMatrix * vec4(position,1.)).xyz;');
          shader.fragmentShader='varying vec3 vCruiseHullPosition;uniform vec4 uCruiseDamage;\n'+shader.fragmentShader;
          const sourcePaint=kind==='baratie'?`
            vec3 p=vCruiseHullPosition;
            vec3 localNormal=normalize(cross(dFdx(p),dFdy(p)));
            bool floorFace=abs(localNormal.y)>.65;
            vec3 paint=vec3(.68,.43,.19);
            if(p.y<10.)paint=vec3(.025,.16,.09);
            else if(abs(p.x)>20.)paint=floorFace?vec3(.3,.13,.045):vec3(.87,.77,.55);
            else if(p.y<32.)paint=floorFace?(p.y>26.?vec3(.39,.045,.035):vec3(.3,.13,.045)):vec3(.68,.43,.19);
            else paint=abs(localNormal.z)>.62?vec3(.88,.78,.59):vec3(.12,.042,.02);
            if(p.z< -23.&&p.y>10.&&p.y<24.&&abs(p.x)<13.)paint=vec3(.73,.2,.27);
            diffuseColor.rgb=paint;
          `:kind==='moby-dick'?`
            if(vCruiseHullPosition.z< -27.&&vCruiseHullPosition.y> -7.&&vCruiseHullPosition.y<24.)diffuseColor.rgb=vec3(.72,.78,.8);
          `:'';
          shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
            ${sourcePaint}
            float sideDamage=vCruiseHullPosition.x<0.0?uCruiseDamage.z:uCruiseDamage.w;
            float damage=max(uCruiseDamage.x*.72,sideDamage);
            float mottling=sin(vCruiseHullPosition.x*1.3+sin(vCruiseHullPosition.z*.48))*sin(vCruiseHullPosition.y*1.1+vCruiseHullPosition.z*.73);
            float scorch=smoothstep(1.05-damage*1.4,1.15-damage*.65,mottling)*damage;
            float body=1.-smoothstep(10.,19.,vCruiseHullPosition.y);
            diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.22,.16,.12),scorch*body);
            diffuseColor.rgb*=1.-uCruiseDamage.y*.22*(1.-body);
          `);
        };
        material.customProgramCacheKey=()=>source.customProgramCacheKey()+'-source-damage-02-'+kind;
        materials.set(source,material);return material;
      };
      object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
    });
    return {uniform,inverse,dispose:()=>{for(const material of materials.values())material.dispose();}};
  }

  private release(source: THREE.Group): void {
    source.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const source of this.sources) this.release(source);
    for (const texture of this.textures) texture.dispose();
    this.gradient.dispose();
    this.sources.clear(); this.textures.clear(); this.pending.clear(); this.loaded.clear();
  }
}
