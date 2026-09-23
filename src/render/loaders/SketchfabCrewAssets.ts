import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import crewSources from '../../../scripts/assets/sketchfab-crew.json';
import type { ShipKind, ShipState } from '../../core/contracts';
import { polarCrewSheltered } from '../../simulation/specials';

type CrewId = 'luffy' | 'nami' | 'sanji' | 'whitebeard';
type Station = { id:CrewId; x:number; z:number; ceiling:number; heading?:number };
const STATIONS: Partial<Record<ShipKind, readonly Station[]>> = {
  'thousand-sunny': [{id:'luffy',x:0,z:-11,ceiling:13},{id:'nami',x:-4,z:-2,ceiling:13},{id:'sanji',x:4,z:3,ceiling:13}],
  'going-merry': [{id:'luffy',x:0,z:-7,ceiling:10},{id:'nami',x:-3,z:-8,ceiling:10},{id:'sanji',x:2,z:4,ceiling:10}],
  'moby-dick': [{id:'whitebeard',x:0,z:-12,ceiling:32}],
  'baratie': [{id:'sanji',x:0,z:-13,ceiling:20}],
};

/** The ray is limited to the intended deck, so upper sails cannot become a floor. */
export function sourceDeckContact(source:THREE.Object3D, x:number,z:number,ceiling:number):THREE.Vector3|undefined {
  source.updateWorldMatrix(true,true);
  const inverse = source.matrixWorld.clone().invert();
  const origin = source.localToWorld(new THREE.Vector3(x,ceiling,z));
  const direction = new THREE.Vector3(0,-1,0).transformDirection(source.matrixWorld);
  const ray = new THREE.Raycaster(origin,direction,0,ceiling+2);
  for (const hit of ray.intersectObject(source,true)) {
    if (!hit.face || hit.object.userData.isInvertedHullOutline) continue;
    const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
    if (normal.dot(direction) > -.5) continue;
    const local = hit.point.clone().applyMatrix4(inverse);
    if (local.y > 1 && local.y < ceiling) return local;
  }
  return undefined;
}

export class SketchfabCrewAssets {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly pending = new Map<CrewId,Promise<GLTF>>();
  private readonly sources = new Set<GLTF>();
  private disposed = false;

  private load(id:CrewId):Promise<GLTF> {
    const cached=this.pending.get(id); if(cached)return cached;
    const promise=this.loader.loadAsync(`/assets/sketchfab/crew/${id}.glb`).then(gltf=>{
      this.sources.add(gltf); if(this.disposed)this.release(gltf); return gltf;
    }).catch(error=>{this.pending.delete(id);throw error;});
    this.pending.set(id,promise); return promise;
  }
  async prepare(kind:ShipKind):Promise<void> { await Promise.all((STATIONS[kind]??[]).map(s=>this.load(s.id))); }
  async ready():Promise<void> { await Promise.all(this.pending.values()); }

  async mount(kind:ShipKind, target:THREE.Group, alive:()=>boolean,
    register:(update:(state:ShipState,time:number,dt:number)=>void,dispose:()=>void)=>void):Promise<void> {
    const ship=target.getObjectByName(`sketchfab-ship:${kind}`);
    if(!ship)return;
    for(const station of STATIONS[kind]??[]) {
      const gltf=await this.load(station.id);
      if(this.disposed||!alive())return;
      const contact=sourceDeckContact(ship,station.x,station.z,station.ceiling);
      // No invisible floor, floating figurine, or primitive fallback when a source has no deck here.
      if(!contact){target.userData.crewContactError=`No deck at ${station.id}'s station`;continue;}
      const source=crewSources.find(s=>s.id===station.id)!;
      const character=clone(gltf.scene), rig=new THREE.Group();
      rig.name=`crew:${station.id}`;rig.userData.assetSource=source.uid;
      rig.userData.sourceTitle=source.title;rig.userData.deckContact=contact.toArray();
      rig.add(character);
      const mixer=new THREE.AnimationMixer(character);
      const clip=gltf.animations.find(c=>c.name===source.animation)??gltf.animations.find(c=>/idle/i.test(c.name));
      if(clip){mixer.clipAction(clip).play();mixer.update(0);}
      character.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(character), center=bounds.getCenter(new THREE.Vector3());
      const scale=source.height/Math.max(.001,bounds.max.y-bounds.min.y);
      character.scale.multiplyScalar(scale);
      character.position.add(new THREE.Vector3(-center.x,-bounds.min.y,-center.z).multiplyScalar(scale));
      rig.rotation.y=station.heading??Math.PI;
      rig.position.copy(contact);rig.position.y+=.025;
      const materials=new Set<THREE.Material>();
      character.traverse(object=>{
        if(!(object instanceof THREE.Mesh))return;
        object.castShadow=true;object.receiveShadow=true;
        const convert=(original:THREE.Material)=>{
          const material=(original as THREE.MeshStandardMaterial).clone();
          material.roughness=.88;material.metalness=0;
          if(material.emissiveIntensity)material.emissiveIntensity=Math.min(.12,material.emissiveIntensity);
          materials.add(material);return material;
        };
        object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
      });
      target.add(rig);
      register((state,time,dt)=>{
        rig.visible=!polarCrewSheltered(state);
        if(!rig.visible||!target.visible)return;
        mixer.update(dt);
        rig.rotation.z=-state.rudder*.045+Math.sin(time*1.8)*.006;
        rig.rotation.x=state.brace>.1?.08:0;
        rig.userData.activeStation=station.id==='luffy'||station.id==='whitebeard'?'helm':station.id==='sanji'?'repair':'navigation';
      },()=>{mixer.stopAllAction();mixer.uncacheRoot(character);for(const material of materials)material.dispose();});
    }
  }
  private release(gltf:GLTF):void {
    const textures=new Set<THREE.Texture>();
    gltf.scene.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      object.geometry.dispose();
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);
        material.dispose();
      }
    });for(const texture of textures)texture.dispose();
  }
  dispose():void {this.disposed=true;for(const source of this.sources)this.release(source);this.sources.clear();this.pending.clear();}
}
